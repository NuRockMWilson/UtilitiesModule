/**
 * Orphan Utility Account Audit
 *
 * Surfaces utility_accounts that look like they were auto-created from
 * Summary-tab placeholder labels (e.g. "Garbage Total", "Water Total",
 * "Electric Total") rather than from a real account number on a live bill.
 *
 * Pattern: migration 0015 used Summary-tab row labels as fallback
 * account_number values when the detail tab lacked account data. Those
 * placeholder UAs now hold historical invoices but will never match a
 * real incoming bill — so live bills create a new duplicate UA instead
 * of linking to the existing history.
 *
 * This page lets an admin:
 *   1. See all suspected orphan UAs with their invoice counts and totals.
 *   2. Identify which real UA they should be merged into (same property + GL).
 *   3. Copy the SQL DO-block to perform the merge in the Supabase console.
 *
 * The merge SQL:
 *   a) Re-points all invoices from the orphan to the real UA
 *   b) Sets the orphan to active=false
 */

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { displayPropertyName } from "@/lib/property-display";
import { OrphanAuditClient } from "./OrphanAuditClient";

// Force this page to be dynamically rendered on every request.
// Without this, Next.js caches the result at build time and the audit
// list goes stale the moment any UA changes.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Detection logic — what makes an account_number look like a placeholder
 * rather than a real account number from a vendor's bill?
 *
 * Real account numbers almost always:
 *   - contain digits
 *   - are 4+ characters long
 *
 * Placeholders that we've seen in the wild:
 *   - "Garbage Total", "Club House Total", "Water Total" (Summary-tab labels)
 *   - "Storm Water", "Envir. Protect. Fee" (line-item labels used as fallback)
 *   - "nan" (pandas NaN that leaked through the historical import)
 *   - typos / partial vendor names ("Repbulic")
 *
 * Be careful NOT to flag real account numbers that contain placeholder-
 * like substrings: e.g. "Clubhouse - 3248526" is a real account at 603,
 * even though it contains "clubhouse". The general rule: if it has digits
 * AND is long enough, it's a real account, even if it also has descriptive
 * words attached.
 */

const PLACEHOLDER_EXACT = new Set([
  "nan", "null", "none", "n/a", "tbd", "unknown",
  "garbage total", "water total", "electric total", "sewer total",
  "gas total", "trash total", "cable total", "phone total",
  "club house total", "clubhouse total",
  "storm water", "stormwater",
  "envir. protect. fee", "env fee", "environmental fee",
  "summary", "summary total",
  "repbulic", // known typo
]);

function isPlaceholder(accountNumber: string): boolean {
  const n = accountNumber.toLowerCase().trim();
  if (!n) return true;
  // Whole-string match against known placeholders
  if (PLACEHOLDER_EXACT.has(n)) return true;
  // Account numbers must contain at least one digit
  if (!/\d/.test(n)) return true;
  // Real account numbers are at least 4 characters
  if (n.length < 4) return true;
  // Otherwise it's a real account number — even if it contains words like
  // "Clubhouse" or "Storm Water" as descriptors alongside actual digits.
  return false;
}

export default async function UAOrphanAuditPage() {
  // Auth: the layout already enforces login, but this page exposes
  // portfolio-wide UA data, so check role explicitly here too.
  const userClient = createSupabaseServerClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (user) {
    const { data: profile } = await userClient
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return (
        <>
          <TopBar title="Utility Account Audit" subtitle="Admin only" />
          <div className="p-8">
            <div className="card p-10 text-center text-nurock-slate">
              This page requires admin role.
            </div>
          </div>
        </>
      );
    }
  }

  // Service-role client for the actual data — bypasses RLS so we see
  // the full portfolio, not just what the user's role-scoped policies allow.
  const supabase = createSupabaseServiceClient();

  // Pull every active UA with its invoice count + total.
  //
  // IMPORTANT: Supabase caps a single query at 1000 rows. The portfolio
  // has more than 1000 UAs, so we must paginate via .range() until we've
  // walked the whole set. Without this, account numbers that sort after
  // the first 1000 (including most of the known orphans, which start with
  // letters like "Garbage Total" / "Storm Water") never reach the page.
  const PAGE_SIZE = 1000;
  let allUAs: any[] = [];
  let uasError: any = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("utility_accounts")
      .select(`
        id, account_number, description, sub_code, active,
        property:properties(id, code, name),
        vendor:vendors(id, name),
        gl:gl_accounts(id, code, description)
      `)
      .order("account_number")
      .range(from, from + PAGE_SIZE - 1);
    if (error) { uasError = error; break; }
    if (!page || page.length === 0) break;
    allUAs = allUAs.concat(page);
    if (page.length < PAGE_SIZE) break;
    // Safety stop — bail out at 20k rows (much larger than the portfolio).
    if (allUAs.length > 20000) break;
  }

  // ── DIAGNOSTIC moved below the invoice-counts query ───────────────────

  // Get invoice counts per UA (aggregate). Same pagination requirement
  // as above — there are way more than 1000 invoices in the portfolio.
  let allInvoices: Array<{ utility_account_id: string; total_amount_due: number }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await supabase
      .from("invoices")
      .select("utility_account_id, total_amount_due")
      .not("utility_account_id", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    allInvoices = allInvoices.concat(page as any);
    if (page.length < PAGE_SIZE) break;
    if (allInvoices.length > 100000) break; // safety
  }

  // Build a map: ua_id → { count, total }
  const countMap = new Map<string, { count: number; total: number }>();
  for (const inv of allInvoices) {
    const id = inv.utility_account_id as string;
    const cur = countMap.get(id) ?? { count: 0, total: 0 };
    countMap.set(id, {
      count: cur.count + 1,
      total: cur.total + Number(inv.total_amount_due ?? 0),
    });
  }

  // Flag suspected orphans — only consider ACTIVE UAs. Inactive ones
  // have already been deactivated (likely via a previous merge) and don't
  // need to be surfaced again.
  const suspects = allUAs.filter(ua => {
    if (!ua.active) return false;
    const acct = (ua.account_number ?? "").toString();
    return isPlaceholder(acct);
  });

  // Three categories based on what peers exist at the same property + GL:
  //
  //   merge_target      — there's exactly one real (non-placeholder) UA at
  //                       the same property+GL → safe to auto-merge.
  //
  //   multi_stream_review — there are multiple real UAs at the same
  //                       property+GL (e.g. compactor + recycle). The
  //                       orphan's invoices could go to any of them, so a
  //                       human needs to decide. Surface both candidates.
  //
  //   historical_only   — no real UAs at this property+GL. The orphan IS
  //                       the only UA holding all the historical invoices
  //                       for that vendor at that property. Don't merge —
  //                       instead, prompt the user to fill in the real
  //                       account number when the next live bill arrives.
  type Category = "merge_target" | "multi_stream_review" | "historical_only";

  type OrphanRow = {
    ua: typeof allUAs[0];
    category: Category;
    invoiceCount: number;
    invoiceTotal: number;
    candidates: Array<typeof allUAs[0] & { invoiceCount: number; invoiceTotal: number }>;
    mergeSql: string;
    /**
     * If the candidate matcher demoted a single-candidate row to review
     * because the per-invoice averages don't match, this holds the
     * warning text shown on the card. Null otherwise.
     */
    avgWarning: string | null;
  };

  const rows: OrphanRow[] = suspects.map(orphan => {
    const stats = countMap.get(orphan.id) ?? { count: 0, total: 0 };
    const prop = (orphan.property as any);
    const gl = (orphan.gl as any);

    // Real (non-placeholder) UAs at the same property + GL
    const candidates = allUAs
      .filter(ua =>
        ua.id !== orphan.id &&
        ua.active &&
        (ua.property as any)?.id === prop?.id &&
        (ua.gl as any)?.id === gl?.id &&
        !isPlaceholder((ua.account_number ?? "").toString()),
      )
      .map(ua => ({
        ...ua,
        ...(countMap.get(ua.id) ?? { count: 0, total: 0 }),
        invoiceCount: (countMap.get(ua.id) ?? { count: 0 }).count,
        invoiceTotal: (countMap.get(ua.id) ?? { total: 0 }).total,
      }));

    let category: Category;
    let mergeSql: string;
    let avgWarning: string | null = null;

    // ── Per-invoice average sanity check ─────────────────────────────────
    // Even when there's exactly one candidate, the merge can be wrong if
    // the orphan and target represent DIFFERENT services on a combined
    // bill (e.g. a stormwater sub-line vs the consolidated water bill).
    // Compute average $ per invoice on each side; if they're more than
    // 3x apart in either direction, treat it as a multi-stream case
    // even though there's only one peer.
    //
    // This catches the migration 0023 issue: stormwater / env-fee
    // sub-line items were imported as separate UAs but their "real"
    // counterpart is the parent water UA which has a much higher
    // per-invoice amount.
    function avgPerInvoice(count: number, total: number): number | null {
      if (count <= 0) return null;
      return Math.abs(total / count);
    }
    const orphanAvg    = avgPerInvoice(stats.count, stats.total);
    const targetAvg    = candidates.length === 1
      ? avgPerInvoice(candidates[0].invoiceCount, candidates[0].invoiceTotal)
      : null;
    const RATIO_LIMIT  = 3.0;
    const avgsAreFarApart = orphanAvg !== null && targetAvg !== null && targetAvg > 0
      ? (orphanAvg / targetAvg > RATIO_LIMIT || targetAvg / orphanAvg > RATIO_LIMIT)
      : false;

    if (candidates.length === 1 && !avgsAreFarApart) {
      category = "merge_target";
      const target = candidates[0];
      mergeSql = `-- Merge orphan "${orphan.account_number}" → "${target.account_number}"
-- Property: ${prop?.code}  GL: ${gl?.code}
DO $$
BEGIN
  -- 1. Re-link invoices
  UPDATE invoices
    SET utility_account_id = '${target.id}',
        vendor_id           = '${(target.vendor as any)?.id}'
  WHERE utility_account_id = '${orphan.id}';

  -- 2. Deactivate orphan
  UPDATE utility_accounts SET active = false WHERE id = '${orphan.id}';

  RAISE NOTICE 'Merged % invoices from orphan % to %',
    (SELECT count(*) FROM invoices WHERE utility_account_id = '${target.id}'),
    '${orphan.id}', '${target.id}';
END $$;`;
    } else if (candidates.length === 1 && avgsAreFarApart) {
      // Single candidate but the per-invoice averages are wildly
      // different — almost certainly a sub-line vs combined-bill case.
      category = "multi_stream_review";
      avgWarning =
        `⚠ Per-invoice averages don't match: orphan ` +
        `~$${orphanAvg!.toFixed(0)}/invoice, target ~$${targetAvg!.toFixed(0)}/invoice ` +
        `(${(Math.max(orphanAvg!, targetAvg!) / Math.min(orphanAvg!, targetAvg!)).toFixed(1)}x ratio). ` +
        `These likely represent DIFFERENT services on a combined bill. ` +
        `Merging would mix services. Consider adding a sub_code to keep them separate.`;
      const target = candidates[0];
      mergeSql = `-- ⚠ AVG MISMATCH — orphan and target represent different services on a combined bill?
-- Orphan: "${orphan.account_number}" — ${stats.count} invoices, $${stats.total.toFixed(2)} (avg $${orphanAvg!.toFixed(2)})
-- Target: "${target.account_number}" — ${target.invoiceCount} invoices, $${target.invoiceTotal.toFixed(2)} (avg $${targetAvg!.toFixed(2)})
--
-- Do NOT auto-merge. Likely needs sub_code separation in the chart of
-- accounts (e.g. 5120-water vs 5120-stormwater) or a deliberate decision
-- to keep them as distinct UAs.
--
-- If you've confirmed the merge is correct anyway:
-- UPDATE invoices SET utility_account_id = '${target.id}', vendor_id = '${(target.vendor as any)?.id}'
--   WHERE utility_account_id = '${orphan.id}';
-- UPDATE utility_accounts SET active = false WHERE id = '${orphan.id}';`;
    } else if (candidates.length > 1) {
      category = "multi_stream_review";
      mergeSql = `-- MULTIPLE real UAs at ${prop?.code}/${gl?.code} — needs human review
-- Orphan: "${orphan.account_number}" (${stats.count} invoices)
-- Candidates:
${candidates.map(c => `--   "${c.account_number}" — ${c.invoiceCount} invoices`).join("\n")}
--
-- Pick the right target manually, then run:
-- UPDATE invoices SET utility_account_id = '<TARGET_UA_ID>', vendor_id = '<TARGET_VENDOR_ID>'
--   WHERE utility_account_id = '${orphan.id}';
-- UPDATE utility_accounts SET active = false WHERE id = '${orphan.id}';`;
    } else {
      category = "historical_only";
      mergeSql = `-- "${orphan.account_number}" at ${prop?.code}/${gl?.code} is the ONLY UA
-- for this vendor + property + GL. No merge needed.
--
-- Action: when the next live bill arrives for this account, look up its
-- real account number and update this UA in place:
--
-- UPDATE utility_accounts
--   SET account_number = '<REAL_ACCOUNT_NUMBER_FROM_BILL>'
--   WHERE id = '${orphan.id}';
--
-- Until then, leave it alone — historical invoices are safely linked here.`;
    }

    return {
      ua: orphan,
      category,
      invoiceCount: stats.count,
      invoiceTotal: stats.total,
      candidates,
      mergeSql,
      avgWarning,
    };
  });

  const merge       = rows.filter(r => r.category === "merge_target");
  const review      = rows.filter(r => r.category === "multi_stream_review");
  const historical  = rows.filter(r => r.category === "historical_only");
  const totalOrphans = rows.length;
  const totalOrphanInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);

  return (
    <>
      <TopBar
        title="Utility Account Audit"
        subtitle={`${totalOrphans} flagged · ${merge.length} auto-merge · ${review.length} review · ${historical.length} historical-only · ${totalOrphanInvoices.toLocaleString()} invoices`}
      />
      <div className="p-8">
        {totalOrphans === 0 ? (
          <div className="card p-10 text-center text-nurock-slate">
            <p className="text-lg font-medium text-green-700 mb-1">✓ No orphan UAs detected</p>
            <p className="text-sm">All utility accounts have real account numbers from live bills.</p>
          </div>
        ) : (
          <OrphanAuditClient
            mergeRows={merge as any}
            reviewRows={review as any}
            historicalRows={historical as any}
          />
        )}
      </div>
    </>
  );
}

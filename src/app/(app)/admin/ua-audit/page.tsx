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
        id, account_number, description, sub_code, active, is_shared_master,
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
  //
  // We also fetch property_id so we can detect "corrupted" orphans:
  // orphan UAs whose linked invoices come from a property other than
  // the orphan's own property (or from multiple properties at once).
  // Auto-merging such an orphan would propagate the corruption into
  // the merge target — which is what produced the recent TPC trash bug.
  let allInvoices: Array<{
    utility_account_id: string;
    property_id: string | null;
    total_amount_due: number;
  }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await supabase
      .from("invoices")
      .select("utility_account_id, property_id, total_amount_due")
      .not("utility_account_id", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    allInvoices = allInvoices.concat(page as any);
    if (page.length < PAGE_SIZE) break;
    if (allInvoices.length > 100000) break; // safety
  }

  // Build a map: ua_id → { count, total }
  const countMap = new Map<string, { count: number; total: number }>();
  // Also build a map: ua_id → Set<property_id> of distinct properties
  // observed across that UA's linked invoices. Used to detect corrupted
  // orphans whose invoices came from properties other than the UA's own.
  const propsMap = new Map<string, Set<string>>();
  for (const inv of allInvoices) {
    const id = inv.utility_account_id as string;
    const cur = countMap.get(id) ?? { count: 0, total: 0 };
    countMap.set(id, {
      count: cur.count + 1,
      total: cur.total + Number(inv.total_amount_due ?? 0),
    });
    if (inv.property_id) {
      let s = propsMap.get(id);
      if (!s) {
        s = new Set<string>();
        propsMap.set(id, s);
      }
      s.add(inv.property_id);
    }
  }

  // Flag suspected orphans — only consider ACTIVE UAs. Inactive ones
  // have already been deactivated (likely via a previous merge) and don't
  // need to be surfaced again.
  const suspects = allUAs.filter(ua => {
    if (!ua.active) return false;
    const acct = (ua.account_number ?? "").toString();
    return isPlaceholder(acct);
  });

  // Four categories based on what peers exist at the same property + GL,
  // AND on whether the orphan's own invoices are property-aligned with the
  // orphan itself:
  //
  //   corrupted_orphan  — the orphan's linked invoices come from a property
  //                       other than the orphan's own (or from multiple
  //                       properties). Auto-merging would propagate the
  //                       corruption into the target. Must be cleaned up
  //                       BEFORE merge by unlinking mismatched invoices.
  //                       This is the class of bug that produced the TPC
  //                       trash incident.
  //
  //   merge_target      — there's exactly one real (non-placeholder) UA at
  //                       the same property+GL → safe to auto-merge. The
  //                       generated SQL contains a property-alignment
  //                       precondition as belt-and-suspenders defense.
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
  //
  // Shared-master UAs (is_shared_master = true) are exempt from the
  // corruption check — by design, they accept invoices from any property.
  // In practice they don't appear in this audit anyway since they have
  // real account numbers, but the check is defensive.
  type Category = "corrupted_orphan" | "merge_target" | "multi_stream_review" | "historical_only";

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
    /**
     * For corrupted orphans, a human-readable breakdown of the
     * property mismatch (e.g. "UA at 603; invoices from 601 (15), 603 (16),
     * 604 (16)"). Null for non-corrupted rows.
     */
    corruptionDetail: string | null;
  };

  // Pre-fetch property code map (id → code) for human-readable corruption
  // breakdowns. Built once outside the row loop.
  const propCodeById = new Map<string, string>();
  for (const ua of allUAs) {
    const p = (ua.property as any);
    if (p?.id && p?.code) propCodeById.set(p.id, p.code);
  }

  const rows: OrphanRow[] = suspects.map(orphan => {
    const stats = countMap.get(orphan.id) ?? { count: 0, total: 0 };
    const prop = (orphan.property as any);
    const gl = (orphan.gl as any);
    const orphanPropId: string | undefined = prop?.id;
    const orphanPropCode: string = prop?.code ?? "?";

    // ── Corruption check ─────────────────────────────────────────────────
    // Inspect the property_id distribution of invoices linked to the
    // orphan. If any link doesn't match the orphan's own property_id,
    // and the UA is NOT a sanctioned shared master, the orphan is
    // corrupted. Auto-merge must be blocked until the mismatched
    // invoices are unlinked.
    const linkedProps = propsMap.get(orphan.id) ?? new Set<string>();
    const isSharedMaster = Boolean((orphan as any).is_shared_master);
    let isCorrupted = false;
    let corruptionDetail: string | null = null;
    if (!isSharedMaster && orphanPropId && linkedProps.size > 0) {
      const hasMismatch = linkedProps.size > 1 ||
        !linkedProps.has(orphanPropId);
      if (hasMismatch) {
        isCorrupted = true;
        // Build a per-property invoice count breakdown for the card.
        // E.g. "UA at 603; invoices from 601 (15), 603 (16), 604 (16)"
        const perProp = new Map<string, { count: number; total: number }>();
        for (const inv of allInvoices) {
          if (inv.utility_account_id !== orphan.id) continue;
          const pid = inv.property_id ?? "(null)";
          const cur = perProp.get(pid) ?? { count: 0, total: 0 };
          perProp.set(pid, {
            count: cur.count + 1,
            total: cur.total + Number(inv.total_amount_due ?? 0),
          });
        }
        const parts: string[] = [];
        for (const [pid, st] of perProp) {
          const code = pid === "(null)" ? "(null)" : (propCodeById.get(pid) ?? pid.slice(0, 8));
          parts.push(`${code} (${st.count} inv, $${st.total.toFixed(2)})`);
        }
        parts.sort();
        corruptionDetail = `UA at ${orphanPropCode}; invoices from ${parts.join(", ")}`;
      }
    }

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

    if (isCorrupted) {
      // Corruption takes precedence over every other category. Generate
      // cleanup SQL that unlinks invoices whose property_id differs from
      // the orphan's own. After cleanup, the orphan can be re-evaluated
      // through the normal merge flow.
      category = "corrupted_orphan";
      mergeSql = `-- ⛔ CORRUPTED ORPHAN — invoices linked to this UA come from a property
-- other than the UA itself. Auto-merge would propagate the corruption.
--
-- Orphan UA: "${orphan.account_number}" at ${orphanPropCode} / GL ${gl?.code}
-- Distribution: ${corruptionDetail}
--
-- This SQL unlinks the mismatched invoices (sets utility_account_id = NULL).
-- Once unlinked, they appear under "Historical / unmapped invoices" in the
-- relevant tracker and can be relinked manually. The orphan keeps any
-- invoices that legitimately belong at ${orphanPropCode} and can then be
-- merged via the normal flow on the next audit refresh.
DO $$
DECLARE
  v_unlinked int;
BEGIN
  UPDATE invoices
     SET utility_account_id = NULL,
         updated_at         = now()
   WHERE utility_account_id = '${orphan.id}'
     AND property_id IS DISTINCT FROM '${orphanPropId ?? ""}';

  GET DIAGNOSTICS v_unlinked = ROW_COUNT;
  RAISE NOTICE 'Unlinked % invoices whose property_id differed from %',
    v_unlinked, '${orphanPropCode}';
END $$;`;
    } else if (candidates.length === 1 && !avgsAreFarApart) {
      category = "merge_target";
      const target = candidates[0];
      const targetPropId = (target.property as any)?.id ?? "";
      mergeSql = `-- Merge orphan "${orphan.account_number}" → "${target.account_number}"
-- Property: ${prop?.code}  GL: ${gl?.code}
DO $$
DECLARE
  v_mismatched int;
BEGIN
  -- 0. Property-alignment guardrail (added 2026-05). Refuse to merge if
  --    any source invoice belongs to a property other than the target UA.
  --    This prevents a recurrence of the TPC trash incident, where a
  --    merge propagated mis-rooted invoices into a UA at the wrong
  --    property. If this fires, run /admin/ua-audit again — the orphan
  --    will appear as "corrupted_orphan" with cleanup SQL.
  SELECT count(*) INTO v_mismatched
    FROM invoices
   WHERE utility_account_id = '${orphan.id}'
     AND property_id IS DISTINCT FROM '${targetPropId}';

  IF v_mismatched > 0 THEN
    RAISE EXCEPTION 'Refusing merge: % source invoices belong to a property other than the target UA. Re-run the UA Audit and use the corrupted_orphan cleanup SQL first.', v_mismatched;
  END IF;

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
      corruptionDetail,
    };
  });

  const corrupted   = rows.filter(r => r.category === "corrupted_orphan");
  const merge       = rows.filter(r => r.category === "merge_target");
  const review      = rows.filter(r => r.category === "multi_stream_review");
  const historical  = rows.filter(r => r.category === "historical_only");
  const totalOrphans = rows.length;
  const totalOrphanInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);

  return (
    <>
      <TopBar
        title="Utility Account Audit"
        subtitle={`${totalOrphans} flagged · ${corrupted.length} corrupted · ${merge.length} auto-merge · ${review.length} review · ${historical.length} historical-only · ${totalOrphanInvoices.toLocaleString()} invoices`}
      />
      <div className="p-8">
        {totalOrphans === 0 ? (
          <div className="card p-10 text-center text-nurock-slate">
            <p className="text-lg font-medium text-green-700 mb-1">✓ No orphan UAs detected</p>
            <p className="text-sm">All utility accounts have real account numbers from live bills.</p>
          </div>
        ) : (
          <OrphanAuditClient
            corruptedRows={corrupted as any}
            mergeRows={merge as any}
            reviewRows={review as any}
            historicalRows={historical as any}
          />
        )}
      </div>
    </>
  );
}

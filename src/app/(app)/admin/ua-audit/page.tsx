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

  // ── DIAGNOSTIC: check what the query actually returned ─────────────
  // Temporary — will remove once orphans render correctly.
  const placeholderSuspects = allUAs.filter(ua => {
    if (!ua.active) return false;
    return isPlaceholder((ua.account_number ?? "").toString());
  });

  // For each suspect, list every other UA at the same property + GL so we
  // can see why the candidate matcher might (or might not) find a target.
  const candidateEnvironment = placeholderSuspects.map(ua => {
    const peers = allUAs.filter(other =>
      other.id !== ua.id &&
      (other.property as any)?.id === (ua.property as any)?.id &&
      (other.gl as any)?.id === (ua.gl as any)?.id,
    );
    return {
      orphan: {
        property: (ua.property as any)?.code,
        gl: (ua.gl as any)?.code,
        account_number: ua.account_number,
        vendor: (ua.vendor as any)?.name,
      },
      peers: peers.map(p => ({
        account_number: p.account_number,
        active: p.active,
        vendor: (p.vendor as any)?.name,
        is_placeholder_too: isPlaceholder((p.account_number ?? "").toString()),
      })),
    };
  });

  const diagnostic = {
    queryError: uasError ? String(uasError.message || uasError) : null,
    totalUAs: allUAs.length,
    activeUAs: allUAs.filter(u => u.active).length,
    totalInvoices: allInvoices.length,
    activeOrphanCount: placeholderSuspects.length,
    candidateEnvironment,
  };
  // ── END DIAGNOSTIC ──────────────────────────────────────────────────

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

  // For each suspect, find candidate "real" UAs: same property + same GL,
  // active, non-placeholder account number
  type OrphanRow = {
    ua: typeof allUAs[0];
    invoiceCount: number;
    invoiceTotal: number;
    candidates: Array<typeof allUAs[0] & { invoiceCount: number; invoiceTotal: number }>;
    mergeSql: string;
  };

  const rows: OrphanRow[] = suspects.map(orphan => {
    const stats = countMap.get(orphan.id) ?? { count: 0, total: 0 };
    const prop = (orphan.property as any);
    const gl = (orphan.gl as any);

    const candidates = allUAs
      .filter(ua =>
        ua.id !== orphan.id &&
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

    // Generate merge SQL for the best candidate (first one)
    const target = candidates[0];
    const mergeSql = target
      ? `-- Merge orphan "${orphan.account_number}" → "${target.account_number}"
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
END $$;`
      : `-- No merge candidate found for orphan "${orphan.account_number}"
-- at property ${prop?.code}, GL ${gl?.code}
-- Manual resolution required.`;

    return {
      ua: orphan,
      invoiceCount: stats.count,
      invoiceTotal: stats.total,
      candidates,
      mergeSql,
    };
  });

  const totalOrphans = rows.length;
  const totalOrphanInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);
  const resolvable = rows.filter(r => r.candidates.length > 0).length;

  return (
    <>
      <TopBar
        title="Utility Account Audit"
        subtitle={`${totalOrphans} suspected orphan UAs · ${totalOrphanInvoices.toLocaleString()} invoices · ${resolvable} auto-resolvable`}
      />
      <div className="p-8">
        {/* Diagnostic block — temporary; remove once orphans render correctly */}
        <div className="card p-4 mb-4 bg-blue-50 border border-blue-200">
          <div className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-2">
            🔍 Diagnostic info (temporary)
          </div>
          <pre className="text-xs text-blue-900 whitespace-pre-wrap font-mono">
            {JSON.stringify(diagnostic, null, 2)}
          </pre>
        </div>

        {totalOrphans === 0 ? (
          <div className="card p-10 text-center text-nurock-slate">
            <p className="text-lg font-medium text-green-700 mb-1">✓ No orphan UAs detected</p>
            <p className="text-sm">All utility accounts have real account numbers from live bills.</p>
          </div>
        ) : (
          <OrphanAuditClient rows={rows as any} />
        )}
      </div>
    </>
  );
}

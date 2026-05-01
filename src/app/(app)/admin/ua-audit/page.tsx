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

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { displayPropertyName } from "@/lib/property-display";
import { OrphanAuditClient } from "./OrphanAuditClient";

/** Tokens that indicate a placeholder account number from the migration */
const PLACEHOLDER_TOKENS = [
  "total", "garbage total", "water total", "electric total",
  "sewer total", "gas total", "trash total", "cable total",
  "phone total", "summary",
];

function isPlaceholder(accountNumber: string): boolean {
  const n = accountNumber.toLowerCase().trim();
  return PLACEHOLDER_TOKENS.some(t => n.includes(t));
}

export default async function UAOrphanAuditPage() {
  const supabase = createSupabaseServerClient();

  // Pull every active UA with its invoice count + total
  const { data: uas } = await supabase
    .from("utility_accounts")
    .select(`
      id, account_number, description, sub_code, active,
      property:properties(id, code, name),
      vendor:vendors(id, name),
      gl:gl_accounts(id, code, description)
    `)
    .order("account_number");

  const allUAs = uas ?? [];

  // Get invoice counts per UA (aggregate)
  const { data: invCounts } = await supabase
    .from("invoices")
    .select("utility_account_id, total_amount_due")
    .not("utility_account_id", "is", null);

  // Build a map: ua_id → { count, total }
  const countMap = new Map<string, { count: number; total: number }>();
  for (const inv of invCounts ?? []) {
    const id = inv.utility_account_id as string;
    const cur = countMap.get(id) ?? { count: 0, total: 0 };
    countMap.set(id, {
      count: cur.count + 1,
      total: cur.total + Number(inv.total_amount_due ?? 0),
    });
  }

  // Flag suspected orphans
  const suspects = allUAs.filter(ua => {
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

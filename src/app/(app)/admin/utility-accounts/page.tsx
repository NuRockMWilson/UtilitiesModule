import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { deactivateAccount, reactivateAccount } from "./actions";

interface PageProps {
  searchParams: { property?: string };
}

export default async function AdminAccountsPage({ searchParams }: PageProps) {
  const supabase = createSupabaseServerClient();

  // Properties dropdown for the filter — every active property
  const { data: properties } = await supabase
    .from("properties")
    .select("id, code, name")
    .eq("active", true)
    .order("code");

  const propertyFilter = searchParams.property?.trim() || null;

  let query = supabase
    .from("utility_accounts")
    .select(`
      id, account_number, description, sub_code, baseline_window_months, variance_threshold_pct, active,
      property:properties(id, code, name),
      vendor:vendors(name),
      gl:gl_accounts(code, description)
    `)
    .order("active", { ascending: false })
    .order("property(code)")
    .limit(2000);

  if (propertyFilter) query = query.eq("property_id", propertyFilter);

  const { data } = await query;
  const rows = data ?? [];

  // Also surface the selected property's vendor set as a sidebar — visible
  // when filtering, so you can see "Hearthstone uses Republic, GP, Comcast"
  // at a glance without scanning the whole table.
  let vendorChips: Array<{ name: string; gl: string }> = [];
  if (propertyFilter) {
    const seen = new Set<string>();
    for (const a of rows) {
      const vendorName = (a as any).vendor?.name ?? "";
      const glCode     = (a as any).gl?.code ?? "";
      const key = `${vendorName}|${glCode}`;
      if (vendorName && !seen.has(key)) {
        seen.add(key);
        vendorChips.push({ name: vendorName, gl: glCode });
      }
    }
  }
  const selectedProperty = (properties ?? []).find(p => p.id === propertyFilter);

  return (
    <>
      <TopBar
        title="Utility accounts"
        subtitle="Each row links a property + vendor + GL for auto-coding of incoming bills"
      />
      <div className="p-8 space-y-4">
        {/* Property filter */}
        <div className="card p-4 flex items-center gap-3 flex-wrap">
          <label className="text-[12px] font-display uppercase tracking-[0.06em] text-nurock-slate">
            Property
          </label>
          <form method="get" className="flex items-center gap-2">
            <select
              name="property"
              defaultValue={propertyFilter ?? ""}
              className="input min-w-[260px]"
            >
              <option value="">All properties ({rows.length} accounts shown)</option>
              {(properties ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-secondary text-[12px]">Filter</button>
            {propertyFilter && (
              <Link href="/admin/utility-accounts" className="text-[12px] text-nurock-slate hover:text-nurock-black">
                Clear
              </Link>
            )}
          </form>
          {selectedProperty && vendorChips.length > 0 && (
            <div className="ml-auto flex items-center gap-2 flex-wrap text-[11.5px]">
              <span className="text-nurock-slate-light uppercase tracking-wide">Vendors used:</span>
              {vendorChips.map(c => (
                <span key={`${c.name}-${c.gl}`} className="bg-[#FAFBFC] border border-nurock-border rounded-full px-2 py-0.5 text-nurock-slate">
                  {c.name} <span className="text-nurock-slate-light">· {c.gl}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-nurock-slate">
            {rows.length} account{rows.length === 1 ? "" : "s"}
            {selectedProperty ? <> for <strong>{selectedProperty.code} · {selectedProperty.name}</strong></> : null}
            {" "}· variance baseline window and threshold are tunable per account.
          </p>
          <Link
            href={propertyFilter
              ? `/admin/utility-accounts/new?property=${propertyFilter}`
              : "/admin/utility-accounts/new"}
            className="btn-primary"
          >
            + Add account
          </Link>
        </div>
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="cell-head">Property</th>
                <th className="cell-head">Vendor</th>
                <th className="cell-head">Account #</th>
                <th className="cell-head">Description</th>
                <th className="cell-head">GL</th>
                <th className="cell-head text-right">Threshold</th>
                <th className="cell-head text-right">Window</th>
                <th className="cell-head">Status</th>
                <th className="cell-head text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="cell text-center text-nurock-slate-light py-10">
                    {propertyFilter
                      ? <>No utility accounts for this property yet. <Link href={`/admin/utility-accounts/new?property=${propertyFilter}`} className="text-nurock-navy hover:underline font-medium">Add one.</Link></>
                      : <>No utility accounts linked yet. <Link href="/admin/utility-accounts/new" className="text-nurock-navy hover:underline font-medium">Add the first one.</Link></>}
                  </td>
                </tr>
              )}
              {rows.map((a: any) => (
                <tr key={a.id} className={cn("table-row border-b border-nurock-border last:border-b-0", !a.active && "opacity-60")}>
                  <td className="cell">
                    <Link href={`/admin/utility-accounts/${a.id}/edit`} className="text-nurock-navy hover:underline font-medium">
                      {a.property?.code}
                    </Link>
                    <div className="text-[11px] text-nurock-slate-light">{a.property?.name}</div>
                  </td>
                  <td className="cell text-nurock-slate">{a.vendor?.name}</td>
                  <td className="cell"><span className="code">{a.account_number}</span></td>
                  <td className="cell">{a.description ?? "—"}</td>
                  <td className="cell">
                    <span className="code">{a.gl?.code}</span>
                    <span className="text-[11px] text-nurock-slate-light ml-1.5">{a.gl?.description}</span>
                  </td>
                  <td className="cell text-right num">{formatPercent(Number(a.variance_threshold_pct))}</td>
                  <td className="cell text-right num">{a.baseline_window_months} mo</td>
                  <td className="cell">
                    <span className={cn("badge", a.active ? "badge-green" : "badge-slate")}>
                      {a.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="cell text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/admin/utility-accounts/${a.id}/edit`} className="btn-ghost text-[11px] px-2 py-1">Edit</Link>
                      {a.active ? (
                        <form action={deactivateAccount}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="btn-ghost text-[11px] px-2 py-1 text-nurock-slate hover:text-flag-red">
                            Deactivate
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateAccount}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" className="btn-ghost text-[11px] px-2 py-1 text-nurock-slate hover:text-flag-green">
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

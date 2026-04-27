import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { deactivateAccount, reactivateAccount } from "./actions";

export default async function AdminAccountsPage() {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("utility_accounts")
    .select(`
      id, account_number, description, sub_code, baseline_window_months, variance_threshold_pct, active,
      property:properties(code, name),
      vendor:vendors(name),
      gl:gl_accounts(code, description)
    `)
    .order("active", { ascending: false })
    .order("property(code)")
    .limit(2000);

  const rows = data ?? [];

  return (
    <>
      <TopBar
        title="Utility accounts"
        subtitle="Each row links a property + vendor + GL for auto-coding of incoming bills"
      />
      <div className="p-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-nurock-slate">
            {rows.length} accounts · variance baseline window and threshold are tunable per account.
          </p>
          <Link href="/admin/utility-accounts/new" className="btn-primary">
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
                    No utility accounts linked yet. <Link href="/admin/utility-accounts/new" className="text-nurock-navy hover:underline font-medium">Add the first one.</Link>
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

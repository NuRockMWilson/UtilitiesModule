import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPercent } from "@/lib/format";

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
    .order("property(code)")
    .limit(500);

  return (
    <>
      <TopBar
        title="Utility accounts"
        subtitle="Each row links a property + vendor + GL for auto-coding of incoming bills"
      />
      <div className="p-8">
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-nurock-border">
            <thead className="bg-[#FAFBFC] text-left text-xs uppercase tracking-wide text-nurock-slate">
              <tr>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Account #</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">GL</th>
                <th className="px-4 py-3 font-medium text-right">Threshold</th>
                <th className="px-4 py-3 font-medium text-right">Window</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {(data ?? []).map((a: any) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-nurock-black">{a.property?.code}</span>
                    <div className="text-xs text-nurock-slate">{a.property?.name}</div>
                  </td>
                  <td className="px-4 py-3">{a.vendor?.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.account_number}</td>
                  <td className="px-4 py-3">{a.description ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {a.gl?.code} <span className="text-nurock-slate">{a.gl?.description}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPercent(Number(a.variance_threshold_pct))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{a.baseline_window_months} mo</td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-nurock-slate">
                    No utility accounts linked yet. Add them via Supabase or the admin UI (pending).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

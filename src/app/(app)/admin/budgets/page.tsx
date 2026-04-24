import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars } from "@/lib/format";

export default async function AdminBudgetsPage({
  searchParams,
}: { searchParams: { year?: string } }) {
  const supabase = createSupabaseServerClient();
  const year = Number(searchParams.year ?? new Date().getFullYear());

  const { data: properties } = await supabase
    .from("properties")
    .select("id, code, name, state")
    .eq("active", true)
    .order("state").order("code");

  const { data: budgets } = await supabase
    .from("budgets")
    .select("property_id, amount")
    .eq("year", year);

  const byProperty = new Map<string, number>();
  for (const b of budgets ?? []) {
    byProperty.set(b.property_id, (byProperty.get(b.property_id) ?? 0) + Number(b.amount));
  }

  return (
    <>
      <TopBar
        title="Budgets"
        subtitle={`Annual utility budgets by property and GL · year ${year}`}
      />
      <div className="p-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-nurock-slate">
            Budgets power the Variance % column on property trackers. Enter monthly values via Supabase (bulk import supported) or upload a CSV — upload UI coming next phase.
          </p>
          <div className="flex gap-2">
            {[year, year - 1, year + 1].sort().map(y => (
              <Link
                key={y}
                href={`/admin/budgets?year=${y}`}
                className={`badge border ${y === year ? "bg-nurock-navy text-white border-navy" : "bg-white text-nurock-navy border-nurock-border"}`}
              >
                {y}
              </Link>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="min-w-full text-sm divide-y divide-nurock-border">
            <thead className="bg-[#FAFBFC] text-left text-xs uppercase tracking-wide text-nurock-slate">
              <tr>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium text-right">Annual utility budget</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {(properties ?? []).map((p: any) => {
                const total = byProperty.get(p.id) ?? 0;
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-nurock-navy">{p.code}</span>
                      <span className="ml-2 font-medium text-nurock-black">{p.name}</span>
                    </td>
                    <td className="px-4 py-3">{p.state}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {total > 0 ? formatDollars(total) : <span className="text-nurock-slate-light">Not set</span>}
                    </td>
                    <td className="px-4 py-3">
                      {total > 0 ? (
                        <span className="badge badge-green">Loaded</span>
                      ) : (
                        <span className="badge bg-yellow-100 text-yellow-800">Missing</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

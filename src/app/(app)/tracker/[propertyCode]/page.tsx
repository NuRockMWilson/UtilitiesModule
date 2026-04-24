import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Props {
  params: { propertyCode: string };
  searchParams: { year?: string };
}

export default async function PropertyTrackerPage({ params, searchParams }: Props) {
  const supabase = createSupabaseServerClient();
  const year = Number(searchParams.year ?? new Date().getFullYear());

  const { data: property } = await supabase
    .from("properties")
    .select("id, code, full_code, name, short_name, state, unit_count, sage_system")
    .eq("code", params.propertyCode)
    .single();

  if (!property) notFound();

  const { data: glAccounts } = await supabase
    .from("gl_accounts")
    .select("id, code, description, utility_category")
    .eq("active", true)
    .order("code");

  // Summary: actuals by GL × month for this property + year
  const { data: summary } = await supabase
    .from("v_property_summary")
    .select("*")
    .eq("property_id", property.id)
    .eq("year", year);

  const { data: budgets } = await supabase
    .from("budgets")
    .select("gl_account_id, month, amount")
    .eq("property_id", property.id)
    .eq("year", year);

  // Build the grid: row per GL × col per month
  const actualsByGLMonth = new Map<string, Map<number, number>>();
  for (const r of summary ?? []) {
    if (!actualsByGLMonth.has(r.gl_account_id!)) {
      actualsByGLMonth.set(r.gl_account_id!, new Map());
    }
    if (r.month) actualsByGLMonth.get(r.gl_account_id!)!.set(r.month, Number(r.total_amount));
  }

  const budgetByGL = new Map<string, number>();
  for (const b of budgets ?? []) {
    budgetByGL.set(b.gl_account_id, (budgetByGL.get(b.gl_account_id) ?? 0) + Number(b.amount));
  }

  const rows = (glAccounts ?? []).map(gl => {
    const monthly = MONTHS.map((_, i) => actualsByGLMonth.get(gl.id)?.get(i + 1) ?? 0);
    const ytd = monthly.reduce((a, b) => a + b, 0);
    const budget = budgetByGL.get(gl.id) ?? 0;
    const variance = budget > 0 ? ((ytd - budget) / budget) * 100 : null;
    return { gl, monthly, ytd, budget, variance };
  });

  const totals = {
    monthly: MONTHS.map((_, i) => rows.reduce((a, r) => a + r.monthly[i], 0)),
    ytd: rows.reduce((a, r) => a + r.ytd, 0),
    budget: rows.reduce((a, r) => a + r.budget, 0),
  };
  const totalVariance = totals.budget > 0 ? ((totals.ytd - totals.budget) / totals.budget) * 100 : null;

  return (
    <>
      <TopBar
        title={`${property.code} · ${property.name}`}
        subtitle={`${property.state}${property.unit_count ? ` · ${property.unit_count} units` : ""} · Sage: ${property.sage_system === "sage_intacct" ? "Intacct" : "300 CRE"}`}
      />

      <div className="px-8 py-4 bg-white border-b border-navy-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <YearPicker currentYear={year} propertyCode={property.code} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/api/tracker/${property.code}/export?year=${year}`}
            className="btn-secondary text-sm"
          >
            Export to Excel
          </Link>
          <Link
            href={`/tracker/${property.code}/water?year=${year}`}
            className="btn-secondary text-sm"
          >
            Water detail
          </Link>
          <Link
            href={`/tracker/${property.code}/fixed?year=${year}`}
            className="btn-secondary text-sm opacity-50 cursor-not-allowed pointer-events-none"
            aria-disabled="true"
            title="Fixed expenses detail page — coming in Phase 2"
          >
            Fixed expenses <span className="text-xs text-tan-600">(soon)</span>
          </Link>
        </div>
      </div>

      <div className="p-8">
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-navy text-white text-xs uppercase tracking-wide">
                <th className="px-3 py-2 text-left font-medium">GL</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                {MONTHS.map(m => (
                  <th key={m} className="px-2 py-2 text-right font-medium">{m}</th>
                ))}
                <th className="px-3 py-2 text-right font-medium bg-navy-700">YTD</th>
                <th className="px-3 py-2 text-right font-medium bg-navy-700">Budget</th>
                <th className="px-3 py-2 text-right font-medium bg-navy-700">Var %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {rows.map(r => (
                <tr key={r.gl.id} className="hover:bg-navy-50/50">
                  <td className="px-3 py-2 font-mono text-xs text-navy-700">{r.gl.code}</td>
                  <td className="px-3 py-2">{r.gl.description}</td>
                  {r.monthly.map((v, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums text-xs">
                      {v > 0 ? formatDollars(v) : <span className="text-tan-400">–</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-medium bg-navy-50">
                    {formatDollars(r.ytd)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-navy-50">
                    {r.budget > 0 ? formatDollars(r.budget) : <span className="text-tan-400">–</span>}
                  </td>
                  <td className={cn(
                    "px-3 py-2 text-right tabular-nums text-xs bg-navy-50",
                    r.variance !== null && r.variance > 5 ? "text-flag-red font-medium" : "text-tan-700",
                  )}>
                    {r.variance !== null ? formatPercent(r.variance, { sign: true }) : "—"}
                  </td>
                </tr>
              ))}
              <tr className="bg-navy-100 font-medium">
                <td />
                <td className="px-3 py-2">Total utilities</td>
                {totals.monthly.map((v, i) => (
                  <td key={i} className="px-2 py-2 text-right tabular-nums text-xs">
                    {v > 0 ? formatDollars(v) : "–"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums bg-navy-200">{formatDollars(totals.ytd)}</td>
                <td className="px-3 py-2 text-right tabular-nums bg-navy-200">{formatDollars(totals.budget)}</td>
                <td className={cn(
                  "px-3 py-2 text-right tabular-nums bg-navy-200",
                  totalVariance !== null && totalVariance > 5 ? "text-flag-red" : "",
                )}>
                  {totalVariance !== null ? formatPercent(totalVariance, { sign: true }) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-tan-700 mt-3">
          Amounts reflect approved, posted, and paid invoices. Pending and rejected invoices are excluded.
          Per-unit and occupancy-adjusted views are available on the Water detail page.
        </p>
      </div>
    </>
  );
}

function YearPicker({ currentYear, propertyCode }: { currentYear: number; propertyCode: string }) {
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-tan-700">Year:</span>
      <div className="flex gap-1">
        {years.map(y => (
          <Link
            key={y}
            href={`/tracker/${propertyCode}?year=${y}`}
            className={cn(
              "badge border",
              y === currentYear
                ? "bg-navy text-white border-navy"
                : "bg-white text-navy-700 border-navy-200 hover:bg-navy-50",
            )}
          >
            {y}
          </Link>
        ))}
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
import { formatDollars } from "@/lib/format";
import { displayPropertyName } from "@/lib/property-display";

/**
 * Vacant Units detail page. Shows per-unit, per-month electric costs absorbed
 * during vacancy periods (GL 5114).
 *
 * For LIHTC operators, the most operationally relevant views are:
 *   1. Monthly totals — how much vacancy cost is the property carrying this year?
 *   2. Units with ongoing costs — which units have been vacant >1 month recently?
 *   3. The full per-unit grid — which specific units contributed?
 */
export default async function VacantUnitsPage({
  params,
  searchParams,
}: {
  params:       { propertyCode: string };
  searchParams: { year?: string };
}) {
  const supabase = createSupabaseServerClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, code, name, full_code")
    .eq("code", params.propertyCode)
    .single();

  if (!property) notFound();

  const { data: allProperties } = await supabase
    .from("properties")
    .select("code, name, full_code")
    .order("code");

  const year = searchParams.year ? parseInt(searchParams.year, 10) : new Date().getFullYear();

  // All vacant charges for this property, any year (we'll filter client-side)
  const { data: charges } = await supabase
    .from("vacant_unit_charges")
    .select("unit_number, building_number, meter_id, year, month, amount, source")
    .eq("property_id", property.id)
    .order("unit_number", { ascending: true })
    .order("year", { ascending: false })
    .order("month", { ascending: true });

  const allCharges = (charges ?? []).map((c: any) => ({
    unit_number:     String(c.unit_number),
    building_number: c.building_number as string | null,
    meter_id:        c.meter_id as string | null,
    year:            Number(c.year),
    month:           Number(c.month),
    amount:          Number(c.amount),
  }));

  const currentYearCharges = allCharges.filter(c => c.year === year);

  // Available years for the year picker
  const years = Array.from(new Set(allCharges.map(c => c.year))).sort((a, b) => b - a);

  // Build a { unit: { month: amount } } table for the selected year
  type UnitRow = {
    unit_number:     string;
    building_number: string | null;
    monthly:         (number | null)[];  // 12 entries, null = no charge
    months_vacant:   number;
    ytd:             number;
  };
  const unitMap = new Map<string, UnitRow>();
  for (const c of currentYearCharges) {
    const key = c.unit_number;
    if (!unitMap.has(key)) {
      unitMap.set(key, {
        unit_number:     c.unit_number,
        building_number: c.building_number,
        monthly:         new Array(12).fill(null),
        months_vacant:   0,
        ytd:             0,
      });
    }
    const row = unitMap.get(key)!;
    row.monthly[c.month - 1] = (row.monthly[c.month - 1] ?? 0) + c.amount;
    row.ytd += c.amount;
  }
  for (const row of unitMap.values()) {
    row.months_vacant = row.monthly.filter(v => v !== null && v > 0).length;
  }

  // Sort units: most months-vacant first, then by highest YTD
  const units = Array.from(unitMap.values()).sort((a, b) => {
    if (b.months_vacant !== a.months_vacant) return b.months_vacant - a.months_vacant;
    return b.ytd - a.ytd;
  });

  // Monthly rollup — "how much vacancy cost hit the property in each month"
  const monthlyRollup: Array<{ month: number; units: number; amount: number }> = [];
  for (let m = 1; m <= 12; m++) {
    const monthCharges = currentYearCharges.filter(c => c.month === m);
    monthlyRollup.push({
      month:  m,
      units:  new Set(monthCharges.map(c => c.unit_number)).size,
      amount: monthCharges.reduce((s, c) => s + c.amount, 0),
    });
  }

  const ytdTotal     = currentYearCharges.reduce((s, c) => s + c.amount, 0);
  const ytdUnitsHit  = unitMap.size;
  const worstMonth   = monthlyRollup.reduce((m, x) => x.amount > m.amount ? x : m, monthlyRollup[0]);

  // Longest vacancy streak — units where months_vacant >= 3
  const chronicVacancies = units.filter(u => u.months_vacant >= 3).length;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${displayPropertyName(property.name)} · Vacant units`}
        subtitle={`${property.full_code} · ${ytdUnitsHit} units vacant in ${year} · ${formatDollars(ytdTotal)} absorbed`}
      />

      <div className="px-8 py-4 bg-white border-b border-nurock-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PropertyPicker
            currentCode={property.code}
            properties={allProperties ?? []}
            year={year}
          />
          <Link href={`/tracker/${property.code}?year=${year}`} className="btn-secondary">
            ← Summary
          </Link>
          <Link href={`/tracker/${property.code}/water?year=${year}`} className="btn-secondary">
            Water detail
          </Link>
          <Link href={`/tracker/${property.code}/meters?year=${year}`} className="btn-secondary">
            House meters
          </Link>
          <div className="flex items-center gap-1 ml-4">
            <span className="text-xs text-nurock-slate mr-2">Year:</span>
            {years.map(y => (
              <Link
                key={y}
                href={`/tracker/${property.code}/vacant?year=${y}`}
                className={
                  "px-2 py-1 rounded text-xs " +
                  (y === year ? "bg-nurock-navy text-white" : "text-nurock-navy hover:bg-nurock-flag-navy-bg")
                }
              >
                {y}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-nurock-bg">
        <div className="px-8 py-6">
          {currentYearCharges.length === 0 && (
            <div className="card p-8 text-center">
              <div className="text-nurock-navy font-medium mb-2">No vacant-unit charges on file for {year}</div>
              <div className="text-sm text-nurock-slate">
                {allCharges.length > 0
                  ? "Pick a different year above — this property has historical vacancy data."
                  : "No vacancy cost records yet. Historical data imports from the legacy Vacant Units sheet; new allocations flow in as vacant-unit bills are processed."}
              </div>
            </div>
          )}

          {currentYearCharges.length > 0 && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <StatCard label={`${year} total`} value={formatDollars(ytdTotal)} />
                <StatCard label="Units vacant" value={String(ytdUnitsHit)} />
                <StatCard
                  label="Worst month"
                  value={worstMonth.amount > 0
                    ? `${MONTHS[worstMonth.month - 1]} · ${formatDollars(worstMonth.amount)}`
                    : "—"}
                />
                <StatCard
                  label="Chronic vacancies"
                  value={`${chronicVacancies}`}
                  sub="3+ months vacant"
                />
              </div>

              {/* Monthly rollup */}
              <div className="card overflow-hidden mb-6">
                <div className="px-4 py-3 bg-[#FAFBFC] text-nurock-slate text-[10px] uppercase tracking-[0.08em] font-display font-semibold font-medium">
                  Vacancy cost by month
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-nurock-slate border-b border-nurock-border">
                      {MONTHS.map(m => (
                        <th key={m} className="cell-head text-center">{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="divide-x divide-nurock-border">
                      {monthlyRollup.map(r => (
                        <td key={r.month} className="px-2 py-3 text-center">
                          <div className="tabular-nums">
                            {r.amount > 0 ? formatDollars(r.amount) : <span className="text-nurock-slate-light">—</span>}
                          </div>
                          <div className="text-xs text-nurock-slate-light mt-0.5">
                            {r.units > 0 ? `${r.units} unit${r.units > 1 ? "s" : ""}` : ""}
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Per-unit grid */}
              <div className="card overflow-x-auto">
                <div className="px-4 py-3 bg-[#FAFBFC] text-nurock-slate text-[10px] uppercase tracking-[0.08em] font-display font-semibold font-medium">
                  Per-unit detail · sorted by months-vacant then YTD
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-nurock-bg text-nurock-slate text-xs uppercase tracking-wide">
                    <tr>
                      <th className="cell-head sticky left-0 z-10">
                        Unit
                      </th>
                      <th className="cell-head">Building</th>
                      <th className="cell-head text-right">Months vacant</th>
                      {MONTHS.map(m => (
                        <th key={m} className="cell-head text-right">{m}</th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium bg-nurock-flag-navy-bg">YTD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nurock-border">
                    {units.map(u => (
                      <tr key={u.unit_number} className="hover:bg-nurock-bg">
                        <td className="cell sticky left-0 bg-white z-10 font-medium">
                          {u.unit_number}
                        </td>
                        <td className="px-3 py-2 text-xs text-nurock-slate">
                          {u.building_number ?? "—"}
                        </td>
                        <td className={
                          "px-3 py-2 text-right tabular-nums text-xs " +
                          (u.months_vacant >= 3 ? "text-flag-red font-medium" : "text-nurock-slate")
                        }>
                          {u.months_vacant}
                        </td>
                        {u.monthly.map((v, i) => (
                          <td key={i} className="cell text-right num">
                            {v !== null && v > 0
                              ? formatDollars(v)
                              : <span className="text-nurock-slate-light">—</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums font-medium bg-[#FAFBFC]">
                          {formatDollars(u.ytd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-nurock-flag-navy-bg font-medium">
                    <tr>
                      <td className="px-3 py-2 sticky left-0 bg-nurock-flag-navy-bg z-10" colSpan={3}>
                        Property total · {units.length} units
                      </td>
                      {monthlyRollup.map(r => (
                        <td key={r.month} className="cell text-right num">
                          {r.amount > 0 ? formatDollars(r.amount) : ""}
                        </td>
                      ))}
                      <td className="cell text-right num">
                        {formatDollars(ytdTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-xs text-nurock-slate-light mt-4">
                Units with three or more months of vacancy cost are flagged in red —
                worth cross-referencing against leasing status to confirm whether
                the units are genuinely vacant or if a billing anomaly is
                incorrectly allocating costs. For LIHTC compliance, export this view
                annually to document which units carried vacancy during the
                reporting period.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-tile navy">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
import { formatDollars } from "@/lib/format";
import { displayPropertyName } from "@/lib/property-display";

/**
 * Vacant Units detail page (GL 5114). Shows per-unit, per-month electric
 * costs absorbed during vacancy periods.
 *
 * Data flow: utility_accounts under GL 5114 + invoices linked to those UAs.
 * One UA per Sage account number — for properties that bill each vacant
 * unit on its own account (e.g. Walton Reserve), each UA's description is
 * the unit number ("1213"). For properties with one master account billing
 * many units (e.g. Onion Creek's "27104 80000"), the UA represents the whole
 * master rollup — per-unit detail isn't preserved in invoices.
 *
 * Earlier this page read from a separate `vacant_unit_charges` table that
 * was populated inconsistently. Refactored to read invoices directly so it
 * matches what the property summary view (v_property_summary) sums.
 */

type UnitRow = {
  unit_label:    string;        // ua.description (unit number) or fallback
  account_number: string;
  meter_id:      string | null;
  monthly:       (number | null)[];  // 12 entries, null = no charge
  months_vacant: number;
  ytd:           number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  // Resolve GL 5114 (Vacant Units electric) ID
  const { data: glRow } = await supabase
    .from("gl_accounts")
    .select("id")
    .eq("code", "5114")
    .single();
  const gl5114Id = glRow?.id;

  // All vacant-electric utility accounts at this property
  const { data: acctRaw } = gl5114Id
    ? await supabase
        .from("utility_accounts")
        .select("id, account_number, description, meter_id")
        .eq("property_id", property.id)
        .eq("gl_account_id", gl5114Id)
    : { data: [] };

  const accounts = (acctRaw ?? []).map((a: any) => ({
    id:             a.id as string,
    account_number: a.account_number as string,
    description:    a.description as string | null,
    meter_id:       a.meter_id as string | null,
  }));
  const accountIds = accounts.map(a => a.id);

  // All historical + live invoices on those UAs.
  // Pull `unit_label` and `meter_id` so master-account properties (Onion
  // Creek bills 100+ vacant units against ONE Sage account number) can be
  // split into per-unit rows. Properties with unique-account-per-unit
  // (Walton Reserve) leave unit_label NULL and group by UA as before.
  const { data: invRaw } = accountIds.length
    ? await supabase
        .from("invoices")
        .select("utility_account_id, invoice_date, service_period_end, total_amount_due, unit_label, meter_id")
        .in("utility_account_id", accountIds)
    : { data: [] };

  const invoices = (invRaw ?? []).map((i: any) => ({
    account_id:  i.utility_account_id as string,
    date:        (i.service_period_end ?? i.invoice_date) as string | null,
    amount:      Number(i.total_amount_due ?? 0),
    unit_label:  (i.unit_label ?? null) as string | null,
    meter_id:    (i.meter_id ?? null)   as string | null,
  }));

  const years = Array.from(new Set(
    invoices.map(i => i.date ? parseInt(i.date.substring(0, 4), 10) : null)
           .filter((y): y is number => y !== null)
  )).sort((a, b) => b - a);
  if (!years.includes(year)) years.unshift(year);

  // Build per-unit rows. Group key = `${ua_id}::${unit_label or "default"}`.
  // For master accounts the unit_label disambiguates 100+ rows that share
  // the same UA. For per-unit-account properties, unit_label is null on
  // every invoice so all invoices for a UA collapse to a single row keyed
  // on the UA's description (the unit number).
  const unitMap = new Map<string, UnitRow>();

  // Helper to derive the row's key + label for an invoice
  const rowKeyFor = (inv: typeof invoices[number], ua: typeof accounts[number]) => {
    if (inv.unit_label && inv.unit_label.trim()) {
      return {
        key:    `${ua.id}::${inv.unit_label}`,
        label:  inv.unit_label.trim(),
        meter:  inv.meter_id ?? ua.meter_id,
      };
    }
    return {
      key:    `${ua.id}::default`,
      label:  ua.description?.trim() || ua.account_number,
      meter:  ua.meter_id,
    };
  };

  const accountById = new Map(accounts.map(a => [a.id, a]));

  for (const inv of invoices) {
    if (!inv.date) continue;
    const y = parseInt(inv.date.substring(0, 4), 10);
    if (y !== year) continue;
    const m = parseInt(inv.date.substring(5, 7), 10);

    const ua = accountById.get(inv.account_id);
    if (!ua) continue;

    const { key, label, meter } = rowKeyFor(inv, ua);
    let row = unitMap.get(key);
    if (!row) {
      row = {
        unit_label:     label,
        account_number: ua.account_number,
        meter_id:       meter,
        monthly:        new Array(12).fill(null),
        months_vacant:  0,
        ytd:            0,
      };
      unitMap.set(key, row);
    }
    row.monthly[m - 1] = (row.monthly[m - 1] ?? 0) + inv.amount;
    row.ytd += inv.amount;
  }

  for (const row of unitMap.values()) {
    row.months_vacant = row.monthly.filter(v => v !== null && v > 0).length;
  }

  // Sort: most months-vacant first, then biggest YTD
  const allUnits = Array.from(unitMap.values()).sort((a, b) => {
    if (b.months_vacant !== a.months_vacant) return b.months_vacant - a.months_vacant;
    return b.ytd - a.ytd;
  });
  // Hide units with zero activity in the selected year (consistent with the
  // tracker's "hide all-empty rows" behavior elsewhere).
  const units = allUnits.filter(u => u.ytd > 0);

  // Monthly rollup across the property
  const monthlyRollup: Array<{ month: number; units: number; amount: number }> = [];
  for (let m = 1; m <= 12; m++) {
    let unitsHit = 0;
    let amount = 0;
    for (const u of units) {
      const v = u.monthly[m - 1];
      if (v !== null && v > 0) {
        unitsHit++;
        amount += v;
      }
    }
    monthlyRollup.push({ month: m, units: unitsHit, amount });
  }

  const ytdTotal     = units.reduce((s, u) => s + u.ytd, 0);
  const ytdUnitsHit  = units.length;
  const worstMonth   = monthlyRollup.reduce((m, x) => x.amount > m.amount ? x : m, monthlyRollup[0]);
  const chronicVacancies = units.filter(u => u.months_vacant >= 3).length;

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
          {ytdTotal === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-nurock-navy font-medium mb-2">No vacant-unit charges on file for {year}</div>
              <div className="text-sm text-nurock-slate">
                {allUnits.length > 0
                  ? "This property has historical vacancy data — pick a different year above."
                  : accounts.length > 0
                    ? `${accounts.length} vacant-unit account${accounts.length === 1 ? "" : "s"} on file but no invoices in ${year}.`
                    : "No vacant-unit accounts set up for this property yet."}
              </div>
            </div>
          ) : (
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
                      <th className="cell-head sticky left-0 z-10 bg-nurock-bg">Unit</th>
                      <th className="cell-head text-left">Account</th>
                      <th className="cell-head text-center">Months vacant</th>
                      {MONTHS.map(m => (
                        <th key={m} className="cell-head text-right">{m}</th>
                      ))}
                      <th className="cell-head text-right bg-[#FAFBFC]">YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u, i) => (
                      <tr key={`${u.account_number}-${i}`} className="border-b border-nurock-border last:border-b-0 table-row">
                        <td className="cell sticky left-0 bg-white z-10 font-medium text-nurock-black">
                          {u.unit_label}
                        </td>
                        <td className="cell text-left text-nurock-slate">
                          <span className="code">{u.account_number}</span>
                          {u.meter_id && u.meter_id !== u.account_number && (
                            <div className="text-[10.5px] text-nurock-slate-light font-mono mt-0.5">
                              meter {u.meter_id}
                            </div>
                          )}
                        </td>
                        <td className="cell text-center">
                          <span className={
                            "inline-block px-1.5 py-0.5 rounded text-xs font-medium " +
                            (u.months_vacant >= 3 ? "bg-flag-red-bg text-flag-red"
                             : u.months_vacant >= 1 ? "bg-nurock-flag-amber-bg text-nurock-flag-amber"
                             : "text-nurock-slate-light")
                          }>
                            {u.months_vacant}
                          </span>
                        </td>
                        {u.monthly.map((v, idx) => (
                          <td key={idx} className="cell text-right num text-nurock-slate">
                            {v !== null && v > 0
                              ? formatDollars(v)
                              : <span className="text-nurock-slate-light">–</span>}
                          </td>
                        ))}
                        <td className="cell text-right num bg-[#FAFBFC] font-semibold text-nurock-black">
                          {formatDollars(u.ytd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
import { NoteCell, type ExistingNote } from "@/components/tracker/NoteCell";
import { displayPropertyName } from "@/lib/property-display";

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

  // All properties for the picker dropdown
  const { data: allProperties } = await supabase
    .from("properties")
    .select("code, name, full_code")
    .order("code");

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

  // Summary-cell notes for this property × year. Filter client-side to those
  // attached at the (gl_account_id, month) granularity — not account-level
  // notes which belong on detail pages.
  const { data: notesRaw } = await supabase
    .from("monthly_notes")
    .select("id, note, created_at, created_by_email, gl_account_id, month, utility_account_id")
    .eq("property_id", property.id)
    .eq("year", year)
    .is("utility_account_id", null)
    .is("invoice_id", null)
    .order("created_at", { ascending: false });

  const notesByCell = new Map<string, ExistingNote[]>();   // key = "glId:month"
  for (const n of (notesRaw ?? []) as any[]) {
    if (!n.gl_account_id || !n.month) continue;
    const key = `${n.gl_account_id}:${n.month}`;
    const arr = notesByCell.get(key) ?? [];
    arr.push({
      id:               n.id,
      note:             n.note,
      created_at:       n.created_at,
      created_by_email: n.created_by_email,
    });
    notesByCell.set(key, arr);
  }

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

  const allRows = (glAccounts ?? []).map(gl => {
    const monthly = MONTHS.map((_, i) => actualsByGLMonth.get(gl.id)?.get(i + 1) ?? 0);
    const ytd = monthly.reduce((a, b) => a + b, 0);
    const budget = budgetByGL.get(gl.id) ?? 0;
    const variance = budget > 0 ? ((ytd - budget) / budget) * 100 : null;
    return { gl, monthly, ytd, budget, variance };
  });

  // Hide rows where every column would render as a dash (no actuals AND no
  // budget). Keeps the summary visually compact — properties with only a
  // handful of active GL categories don't show 12 GLs of dashes.
  const rows = allRows.filter(r =>
    r.ytd > 0 || r.budget > 0 || r.monthly.some(v => v > 0),
  );

  const totals = {
    monthly: MONTHS.map((_, i) => rows.reduce((a, r) => a + r.monthly[i], 0)),
    ytd: rows.reduce((a, r) => a + r.ytd, 0),
    budget: rows.reduce((a, r) => a + r.budget, 0),
  };
  const totalVariance = totals.budget > 0 ? ((totals.ytd - totals.budget) / totals.budget) * 100 : null;

  return (
    <>
      <TopBar
        title={displayPropertyName(property.name)}
        subtitle={`${property.state}${property.unit_count ? ` · ${property.unit_count} units` : ""} · Sage: ${property.sage_system === "sage_intacct" ? "Intacct" : "300 CRE"}`}
      />

      <div className="px-8 py-4 bg-white border-b border-nurock-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PropertyPicker
            currentCode={property.code}
            properties={allProperties ?? []}
            year={year}
          />
          <YearPicker currentYear={year} propertyCode={property.code} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/api/tracker/${property.code}/export?year=${year}`}
            className="btn-secondary"
          >
            Export to Excel
          </Link>
          <span className="text-[11px] text-nurock-slate-light ml-2">
            Click any row name to drill into its detail →
          </span>
        </div>
      </div>

      <div className="p-8">
        <div className="card overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="cell-head">GL</th>
                <th className="cell-head">Description</th>
                {MONTHS.map(m => (
                  <th key={m} className="cell-head text-right">{m}</th>
                ))}
                <th className="cell-head text-right">YTD</th>
                <th className="cell-head text-right">Budget</th>
                <th className="cell-head text-right">Var %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                // Determine which detail page (if any) this GL drills into.
                const detailHref =
                  ["5120", "5122", "5125"].includes(r.gl.code) ? `/tracker/${property.code}/water?year=${year}`   :
                  ["5112", "5116"].includes(r.gl.code)          ? `/tracker/${property.code}/meters?year=${year}`  :
                  r.gl.code === "5114"                           ? `/tracker/${property.code}/vacant?year=${year}`  :
                  r.gl.code === "5135"                           ? `/tracker/${property.code}/trash?year=${year}`   :
                  ["5140", "5635"].includes(r.gl.code)          ? `/tracker/${property.code}/comms?year=${year}`   :
                  null;

                return (
                  <tr key={r.gl.id} className="table-row border-b border-nurock-border last:border-b-0">
                    <td className="cell">
                      <span className="code">{r.gl.code}</span>
                    </td>
                    <td className="cell">
                      {detailHref ? (
                        <Link
                          href={detailHref}
                          className="text-nurock-navy hover:text-nurock-navy-light hover:underline inline-flex items-center gap-1 group font-medium"
                          title={`View ${r.gl.description} detail`}
                        >
                          {r.gl.description}
                          <svg
                            viewBox="0 0 20 20"
                            className="w-3.5 h-3.5 text-nurock-tan group-hover:text-nurock-navy"
                            fill="currentColor"
                            aria-hidden
                          >
                            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                          </svg>
                        </Link>
                      ) : (
                        <span className="text-nurock-black">{r.gl.description}</span>
                      )}
                    </td>
                    {r.monthly.map((v, i) => {
                      const month = i + 1;
                      const cellNotes = notesByCell.get(`${r.gl.id}:${month}`) ?? [];
                      return (
                        <td key={i} className="cell text-right num text-nurock-slate">
                          <NoteCell
                            scope={{
                              property_id:   property.id,
                              gl_account_id: r.gl.id,
                              year, month,
                            }}
                            existingNotes={cellNotes}
                            label={`${r.gl.description} · ${MONTHS[i]} ${year}`}
                          >
                            {v > 0 ? formatDollars(v) : <span className="text-nurock-slate-light">–</span>}
                          </NoteCell>
                        </td>
                      );
                    })}
                    <td className="cell text-right num font-semibold text-nurock-black bg-[#FAFBFC]">
                      {formatDollars(r.ytd)}
                    </td>
                    <td className="cell text-right num text-nurock-slate bg-[#FAFBFC]">
                      {r.budget > 0 ? formatDollars(r.budget) : <span className="text-nurock-slate-light">–</span>}
                    </td>
                    <td className={cn(
                      "cell text-right num bg-[#FAFBFC]",
                      r.variance !== null && r.variance > 5 ? "text-flag-red font-semibold" : "text-nurock-slate",
                    )}>
                      {r.variance !== null ? formatPercent(r.variance, { sign: true }) : "—"}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-[#FAFBFC] border-t-2 border-nurock-border">
                <td className="cell" />
                <td className="cell font-display font-semibold uppercase tracking-wide text-nurock-navy text-[12px]">
                  Total utilities
                </td>
                {totals.monthly.map((v, i) => (
                  <td key={i} className="cell text-right num font-semibold text-nurock-black">
                    {v > 0 ? formatDollars(v) : <span className="text-nurock-slate-light">–</span>}
                  </td>
                ))}
                <td className="cell text-right num font-bold text-nurock-black bg-nurock-flag-navy-bg">
                  {formatDollars(totals.ytd)}
                </td>
                <td className="cell text-right num font-semibold text-nurock-slate bg-nurock-flag-navy-bg">
                  {formatDollars(totals.budget)}
                </td>
                <td className={cn(
                  "cell text-right num font-semibold bg-nurock-flag-navy-bg",
                  totalVariance !== null && totalVariance > 5 ? "text-flag-red" : "text-nurock-navy",
                )}>
                  {totalVariance !== null ? formatPercent(totalVariance, { sign: true }) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-nurock-slate-light mt-3">
          Amounts reflect approved, posted, and paid invoices. Pending and rejected invoices are excluded.
          Per-unit and occupancy-adjusted views are available on the Water detail page.
        </p>
        {(year < 2026 || year === 2026) && (
          <div className="mt-4 border-t border-nurock-tan/40 bg-nurock-tan/10 px-4 py-3 rounded-md text-[12px] text-nurock-slate-dark leading-relaxed">
            <span className="font-semibold text-nurock-navy">Historical data note: </span>
            {year < 2026 ? (
              <>
                Amounts shown for {year} were sourced from the legacy spreadsheet
                per-meter detail tabs and may not reconcile exactly to the legacy
                Summary tab roll-ups. From May 2026 forward, every amount on this
                page comes directly from a processed invoice.
              </>
            ) : (
              <>
                Amounts shown for January through April 2026 were sourced from the
                legacy spreadsheet per-meter detail tabs and may not reconcile
                exactly to the legacy Summary tab roll-ups. From May 2026 forward,
                every amount on this page comes directly from a processed invoice.
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function YearPicker({ currentYear, propertyCode }: { currentYear: number; propertyCode: string }) {
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">Year</span>
      <div className="flex gap-1">
        {years.map(y => (
          <Link
            key={y}
            href={`/tracker/${propertyCode}?year=${y}`}
            className={cn(
              "px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
              y === currentYear
                ? "bg-nurock-navy text-white"
                : "text-nurock-slate hover:bg-nurock-flag-navy-bg hover:text-nurock-navy",
            )}
          >
            {y}
          </Link>
        ))}
      </div>
    </div>
  );
}

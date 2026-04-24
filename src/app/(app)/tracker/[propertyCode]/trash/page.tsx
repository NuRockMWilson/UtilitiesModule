import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { formatDollars, formatNumber, formatPercent } from "@/lib/format";

/**
 * Trash / Garbage detail page. Monthly view of trash spend with pickup counts
 * and cost-per-pickup normalization.
 *
 * Why this view matters: raw monthly trash totals vary heavily with pickup
 * counts (tenant turnover spikes = more pickups = higher bill). The
 * operationally-relevant signal is "did cost per pickup change?" which this
 * page surfaces via the $/pickup column and period-over-period deltas.
 */
export default async function TrashDetailPage({
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

  const year = searchParams.year ? parseInt(searchParams.year, 10) : new Date().getFullYear();

  // Pull every trash invoice (GL 5135) for this property, any year
  const { data: rowsRaw } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date,
      service_period_start, service_period_end, service_days,
      total_amount_due, status, source_reference,
      units_billed, units_billed_label,
      vendors ( name ),
      gl_accounts!inner ( code )
    `)
    .eq("property_id", property.id)
    .eq("gl_accounts.code", "5135")
    .order("invoice_date", { ascending: false });

  const all = (rowsRaw ?? []).map((r: any) => ({
    id:             r.id,
    invoice_number: r.invoice_number as string | null,
    invoice_date:   r.invoice_date   as string | null,
    service_start:  r.service_period_start as string | null,
    service_end:    r.service_period_end   as string | null,
    days:           r.service_days as number | null,
    amount:         Number(r.total_amount_due ?? 0),
    status:         r.status as string,
    pickups:        r.units_billed ? Number(r.units_billed) : null,
    vendor_name:    r.vendors?.name ?? null,
  }));

  // Year picker uses every year present in the data
  const years = Array.from(new Set(all.map(r =>
    r.invoice_date ? parseInt(r.invoice_date.substring(0, 4), 10) : null
  ).filter((y): y is number => y !== null))).sort((a, b) => b - a);

  const currentYear = all.filter(r => r.invoice_date?.startsWith(String(year)));

  // Sort chronologically for the δ-vs-prior calculation
  const chronological = [...currentYear].sort((a, b) =>
    (a.invoice_date ?? "").localeCompare(b.invoice_date ?? "")
  );

  // YTD stats
  const ytdTotal   = currentYear.reduce((s, r) => s + r.amount, 0);
  const ytdPickups = currentYear.reduce((s, r) => s + (r.pickups ?? 0), 0);
  const ytdAvgPerPickup = ytdPickups > 0 ? ytdTotal / ytdPickups : null;
  const vendorName = currentYear[0]?.vendor_name ?? all[0]?.vendor_name ?? null;

  // Prior-year $/pickup baseline for the variance card
  const priorYear = all.filter(r => r.invoice_date?.startsWith(String(year - 1)) && r.pickups);
  const priorPickupsSum   = priorYear.reduce((s, r) => s + (r.pickups ?? 0), 0);
  const priorAmountSum    = priorYear.reduce((s, r) => s + r.amount, 0);
  const priorAvgPerPickup = priorPickupsSum > 0 ? priorAmountSum / priorPickupsSum : null;
  const yoyChangePct =
    ytdAvgPerPickup !== null && priorAvgPerPickup !== null
      ? ((ytdAvgPerPickup - priorAvgPerPickup) / priorAvgPerPickup) * 100
      : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${property.name} · Trash`}
        subtitle={
          `${property.full_code}` +
          (vendorName ? ` · ${vendorName}` : "") +
          ` · ${currentYear.length} bills in ${year} · ${formatDollars(ytdTotal)}`
        }
      />

      <div className="px-8 py-4 bg-white border-b border-nurock-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/tracker/${property.code}?year=${year}`} className="btn-secondary">
            ← Summary
          </Link>
          <div className="flex items-center gap-1 ml-4">
            <span className="text-xs text-nurock-slate mr-2">Year:</span>
            {years.map(y => (
              <Link
                key={y}
                href={`/tracker/${property.code}/trash?year=${y}`}
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
          {currentYear.length === 0 && all.length === 0 && (
            <div className="card p-8 text-center">
              <div className="text-nurock-navy font-medium mb-2">No trash bills on file</div>
              <div className="text-sm text-nurock-slate">
                Trash invoices will appear here as they flow through the extraction pipeline.
              </div>
            </div>
          )}

          {currentYear.length === 0 && all.length > 0 && (
            <div className="card p-6 text-center text-sm text-nurock-slate mb-4">
              No trash bills in {year} — pick a different year above.
            </div>
          )}

          {currentYear.length > 0 && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <StatCard label={`${year} total`} value={formatDollars(ytdTotal)} />
                <StatCard label={`${year} pickups`} value={String(ytdPickups)} />
                <StatCard
                  label={`${year} avg $/pickup`}
                  value={ytdAvgPerPickup !== null ? formatDollars(ytdAvgPerPickup) : "—"}
                />
                <StatCard
                  label={`YoY $/pickup`}
                  value={yoyChangePct !== null ? formatPercent(yoyChangePct / 100, { sign: true }) : "—"}
                  sub={priorAvgPerPickup !== null ? `vs ${formatDollars(priorAvgPerPickup)} in ${year - 1}` : undefined}
                  tone={
                    yoyChangePct === null ? "neutral" :
                    yoyChangePct >  3     ? "red"     :
                    yoyChangePct < -3     ? "green"   : "neutral"
                  }
                />
              </div>

              {/* Bill-by-bill table */}
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAFBFC] text-nurock-slate text-[10px] uppercase tracking-[0.08em] font-display font-semibold">
                    <tr>
                      <th className="cell-head">Invoice date</th>
                      <th className="cell-head">Service period</th>
                      <th className="cell-head text-right">Pickups</th>
                      <th className="cell-head text-right">Amount</th>
                      <th className="cell-head text-right">$/pickup</th>
                      <th className="cell-head text-right">Δ vs prior</th>
                      <th className="cell-head">Invoice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nurock-border">
                    {currentYear.map((r, idx) => {
                      const perPickup = r.pickups && r.pickups > 0 ? r.amount / r.pickups : null;

                      // Δ-vs-prior on a $/pickup basis — find the most recent prior bill
                      // (chronologically) that also had a pickup count
                      const chronoIdx = chronological.findIndex(c => c.id === r.id);
                      const prior = [...chronological.slice(0, chronoIdx)]
                        .reverse()
                        .find(c => c.pickups && c.pickups > 0);
                      const priorPer = prior && prior.pickups && prior.pickups > 0
                        ? prior.amount / prior.pickups
                        : null;
                      const deltaPct =
                        perPickup !== null && priorPer !== null && priorPer > 0
                          ? ((perPickup - priorPer) / priorPer) * 100
                          : null;

                      return (
                        <tr key={r.id} className="hover:bg-nurock-bg">
                          <td className="cell num">
                            {r.invoice_date ? formatDate(r.invoice_date) : "—"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-xs text-nurock-slate">
                            {r.service_start && r.service_end
                              ? `${formatDate(r.service_start)} – ${formatDate(r.service_end)}`
                              : "—"}
                          </td>
                          <td className="cell text-right num">
                            {r.pickups ?? <span className="text-nurock-slate-light">—</span>}
                          </td>
                          <td className="cell text-right num">
                            {formatDollars(r.amount)}
                          </td>
                          <td className="cell text-right num">
                            {perPickup !== null ? formatDollars(perPickup) : <span className="text-nurock-slate-light">—</span>}
                          </td>
                          <td className={
                            "px-3 py-2 text-right tabular-nums " +
                            (deltaPct === null ? "text-nurock-slate-light" :
                             deltaPct > 3      ? "text-flag-red font-medium" :
                             deltaPct < -3     ? "text-flag-green"            : "text-nurock-slate")
                          }>
                            {deltaPct !== null ? formatPercent(deltaPct / 100, { sign: true }) : "—"}
                          </td>
                          <td className="cell">
                            <Link
                              href={`/invoices/${r.id}`}
                              className="text-nurock-navy hover:underline font-mono"
                            >
                              {r.invoice_number}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-nurock-flag-navy-bg font-medium">
                    <tr>
                      <td className="cell" colSpan={2}>{year} total</td>
                      <td className="cell text-right num">{ytdPickups}</td>
                      <td className="cell text-right num">{formatDollars(ytdTotal)}</td>
                      <td className="cell text-right num">
                        {ytdAvgPerPickup !== null ? formatDollars(ytdAvgPerPickup) : "—"}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-xs text-nurock-slate-light mt-4">
                Δ vs prior compares each bill&apos;s cost-per-pickup to the most recent
                preceding bill with a pickup count — flags red above 3%, green below -3%.
                A high-dollar bill with proportionally more pickups should come out flat,
                not flagged, which is the whole point of normalizing by pickup count.
                Historical bills (invoice numbers starting
                <span className="font-mono"> HIST-T-</span>) come from the legacy
                Garbage sheet.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "red" | "green";
}) {
  const valueCls =
    tone === "red"   ? "text-flag-red"   :
    tone === "green" ? "text-flag-green" : "text-nurock-black";
  const tileTone =
    tone === "red"   ? "red"   :
    tone === "green" ? "green" : "navy";
  return (
    <div className={`kpi-tile ${tileTone}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value num ${valueCls}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { formatDollars, formatNumber, formatPercent } from "@/lib/format";

/**
 * Water usage detail page. Shows every historical and current water reading
 * for a property in reverse chronological order, matching the legacy
 * "<Property>_Water_usage_break_down.xlsx" layout:
 *
 *   Service period | Days | Usage | Daily usage | Δ vs prior | Occupancy | Amount
 *
 * Historical readings seeded from 0005_historical_data.sql show up here;
 * new water bills append as they're processed through the extraction pipeline.
 */
export default async function WaterDetailPage({
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
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

  // All water readings for this property, newest first, through the
  // utility_accounts → property_id relationship. Covers both historical
  // (HIST-<code>) synthetic accounts and real vendor accounts created from
  // processed bills.
  const { data: rows } = await supabase
    .from("usage_readings")
    .select(`
      id, reading_type, service_start, service_end, days,
      usage_amount, usage_unit, occupancy_pct,
      utility_accounts!inner ( property_id ),
      invoices ( id, invoice_number, total_amount_due, invoice_date, status )
    `)
    .eq("utility_accounts.property_id", property.id)
    .eq("reading_type", "water")
    .order("service_end", { ascending: false, nullsFirst: false })
    .limit(500);

  const allReadings = (rows ?? []).map((r: any) => ({
    id:            r.id,
    service_start: r.service_start as string | null,
    service_end:   r.service_end   as string | null,
    days:          r.days          as number | null,
    usage:         r.usage_amount ? Number(r.usage_amount) : null,
    unit:          r.usage_unit ?? "gallons",
    occupancy:     r.occupancy_pct ? Number(r.occupancy_pct) : null,
    invoice_id:    r.invoices?.id ?? null,
    invoice_num:   r.invoices?.invoice_number ?? null,
    amount:        r.invoices?.total_amount_due ? Number(r.invoices.total_amount_due) : null,
    status:        r.invoices?.status ?? null,
  }));

  // Line-item breakdown for water invoices at this property. Joined by
  // invoice_id so we can surface "Jan: Water $6,508 + Sewer $6,780 + ..."
  // on the same page as the reading-level history.
  const invoiceIds = allReadings
    .map(r => r.invoice_id)
    .filter((id): id is string => !!id);

  const { data: lineItemRows } = invoiceIds.length
    ? await supabase
        .from("invoice_line_items")
        .select("invoice_id, description, category, amount, is_consumption_based, gl_coding")
        .in("invoice_id", invoiceIds)
    : { data: [] };

  // Group line items by invoice_id for easy rendering
  const lineItemsByInvoice = new Map<string, Array<{
    description: string;
    category:    string;
    amount:      number;
    is_consumption_based: boolean;
    gl_coding:   string | null;
  }>>();
  for (const li of (lineItemRows ?? []) as any[]) {
    const list = lineItemsByInvoice.get(li.invoice_id) ?? [];
    list.push({
      description:          String(li.description),
      category:             String(li.category ?? "other"),
      amount:               Number(li.amount),
      is_consumption_based: Boolean(li.is_consumption_based),
      gl_coding:            li.gl_coding ?? null,
    });
    lineItemsByInvoice.set(li.invoice_id, list);
  }

  // Filter to year, but also surface a 12-month-prior cohort for delta calcs
  const currentYear = allReadings.filter(r =>
    r.service_end && r.service_end.startsWith(String(year)));
  const allSorted = [...allReadings].sort((a, b) =>
    (a.service_end ?? "").localeCompare(b.service_end ?? ""));

  // Compute Δ vs prior reading (chronological) for each row
  const deltas = new Map<string, number | null>();
  for (let i = 0; i < allSorted.length; i++) {
    const cur = allSorted[i];
    const prev = allSorted[i - 1];
    if (cur && prev && cur.usage && prev.usage && prev.usage > 0) {
      const daily_cur  = cur.days  ? cur.usage  / cur.days  : cur.usage;
      const daily_prev = prev.days ? prev.usage / prev.days : prev.usage;
      deltas.set(cur.id, (daily_cur - daily_prev) / daily_prev);
    } else {
      deltas.set(cur.id, null);
    }
  }

  // Year-based stats for the top bar
  const totalUsage   = currentYear.reduce((s, r) => s + (r.usage ?? 0), 0);
  const totalAmount  = currentYear.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalDays    = currentYear.reduce((s, r) => s + (r.days ?? 0), 0);
  const avgDaily     = totalDays > 0 ? totalUsage / totalDays : 0;
  const avgOcc       = currentYear.length
    ? currentYear.reduce((s, r) => s + (r.occupancy ?? 0), 0) / currentYear.length
    : 0;
  const unit         = currentYear[0]?.unit ?? allReadings[0]?.unit ?? "gallons";

  // Available years for the year picker
  const years = Array.from(new Set(allReadings
    .map(r => r.service_end ? parseInt(r.service_end.substring(0, 4), 10) : null)
    .filter((y): y is number => y !== null)
  )).sort((a, b) => b - a);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${property.name} · Water usage`}
        subtitle={`${property.full_code} · ${currentYear.length} readings in ${year} · ${allReadings.length} total on file`}
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
                href={`/tracker/${property.code}/water?year=${y}`}
                className={
                  "px-2 py-1 rounded text-xs " +
                  (y === year
                    ? "bg-nurock-navy text-white"
                    : "text-nurock-navy hover:bg-nurock-flag-navy-bg")
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
          {/* Year summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <StatCard label={`${year} total usage`}
                      value={`${formatNumber(totalUsage)} ${unit}`} />
            <StatCard label={`${year} avg daily`}
                      value={`${formatNumber(avgDaily, 1)} ${unit}/day`} />
            <StatCard label={`${year} avg occupancy`}
                      value={avgOcc > 0 ? formatPercent(avgOcc) : "—"} />
            <StatCard label={`${year} billed`}
                      value={totalAmount > 0 ? formatDollars(totalAmount) : "—"} />
          </div>

          {currentYear.length === 0 && allReadings.length === 0 && (
            <div className="card p-8 text-center">
              <div className="text-nurock-navy font-medium mb-2">No water readings on file</div>
              <div className="text-sm text-nurock-slate">
                This property has no water usage history yet. Readings will appear here
                as water bills flow through the extraction pipeline.
              </div>
            </div>
          )}

          {currentYear.length === 0 && allReadings.length > 0 && (
            <div className="card p-6 text-center text-sm text-nurock-slate mb-4">
              No readings in {year}. Historical data available —
              pick a different year above, or view{" "}
              <Link
                href={`/tracker/${property.code}/water?year=${allReadings[0]?.service_end?.substring(0, 4) ?? year}`}
                className="text-nurock-navy underline">
                most recent readings
              </Link>.
            </div>
          )}

          {currentYear.length > 0 && (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFBFC] text-nurock-slate text-[10px] uppercase tracking-[0.08em] font-display font-semibold">
                  <tr>
                    <th className="cell-head">Service period</th>
                    <th className="cell-head text-right">Days</th>
                    <th className="cell-head text-right">Usage ({unit})</th>
                    <th className="cell-head text-right">Daily usage</th>
                    <th className="cell-head text-right">Δ vs prior</th>
                    <th className="cell-head text-right">Occupancy</th>
                    <th className="cell-head text-right">Amount</th>
                    <th className="cell-head">Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nurock-border">
                  {currentYear.map(r => {
                    const daily = r.days && r.usage ? r.usage / r.days : null;
                    const delta = deltas.get(r.id);
                    return (
                      <tr key={r.id} className="hover:bg-nurock-bg">
                        <td className="cell num">
                          {r.service_start && r.service_end
                            ? `${formatDate(r.service_start)} – ${formatDate(r.service_end)}`
                            : r.service_end ?? "—"}
                        </td>
                        <td className="cell text-right num">{r.days ?? "—"}</td>
                        <td className="cell text-right num">
                          {r.usage !== null ? formatNumber(r.usage, 2) : "—"}
                        </td>
                        <td className="cell text-right num">
                          {daily !== null ? formatNumber(daily, 2) : "—"}
                        </td>
                        <td className={
                          "px-3 py-2 text-right tabular-nums " +
                          (delta !== null && delta !== undefined
                            ? (delta > 0.03  ? "text-flag-red font-medium"  :
                               delta < -0.03 ? "text-flag-green"            : "text-nurock-slate")
                            : "text-nurock-slate-light")
                        }>
                          {delta !== null && delta !== undefined
                            ? formatPercent(delta, { sign: true })
                            : "—"}
                        </td>
                        <td className="cell text-right num">
                          {r.occupancy !== null ? formatPercent(r.occupancy) : "—"}
                        </td>
                        <td className="cell text-right num">
                          {r.amount !== null ? formatDollars(r.amount) : "—"}
                        </td>
                        <td className="cell">
                          {r.invoice_id ? (
                            <Link
                              href={`/invoices/${r.invoice_id}`}
                              className="text-nurock-navy hover:underline font-mono"
                            >
                              {r.invoice_num}
                            </Link>
                          ) : <span className="text-nurock-slate-light">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-nurock-flag-navy-bg font-medium">
                  <tr>
                    <td className="cell">{year} total</td>
                    <td className="cell text-right num">{totalDays}</td>
                    <td className="cell text-right num">{formatNumber(totalUsage)}</td>
                    <td className="cell text-right num">{formatNumber(avgDaily, 2)}</td>
                    <td></td>
                    <td className="cell text-right num">
                      {avgOcc > 0 ? formatPercent(avgOcc) : "—"}
                    </td>
                    <td className="cell text-right num">
                      {totalAmount > 0 ? formatDollars(totalAmount) : "—"}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-xs text-nurock-slate-light mt-4">
            Variance threshold shown in red/green is the default 3% —
            configurable per utility account under Admin → Utility Accounts.
            Historical readings (before the app went live) are marked with
            invoice numbers starting <span className="font-mono">HIST-W-</span>.
          </p>

          {/* Line-item breakdown per invoice (Priority 1 deliverable) */}
          {currentYear.length > 0 && lineItemsByInvoice.size > 0 && (
            <div className="mt-8">
              <h2 className="font-display text-lg font-semibold text-nurock-black mb-1">
                Line-item breakdown
              </h2>
              <p className="text-xs text-nurock-slate-light mb-3">
                Each bill split into its component charges — water, sewer,
                irrigation, storm water, environmental protection fees, and
                other line items. Consumption-driven lines (<span className="text-nurock-navy">●</span>) feed
                per-category variance; flat fees (<span className="text-nurock-slate-light">○</span>) are excluded from variance.
              </p>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAFBFC] text-nurock-slate text-[10px] uppercase tracking-[0.08em] font-display font-semibold">
                    <tr>
                      <th className="cell-head">Service period</th>
                      <th className="cell-head">Line item</th>
                      <th className="cell-head">Category</th>
                      <th className="cell-head">GL</th>
                      <th className="cell-head text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nurock-border">
                    {currentYear.flatMap(r => {
                      const items = r.invoice_id ? lineItemsByInvoice.get(r.invoice_id) ?? [] : [];
                      if (items.length === 0) return [];
                      return items.map((li, idx) => (
                        <tr key={`${r.id}-${idx}`} className="hover:bg-nurock-bg">
                          <td className="cell num">
                            {idx === 0 && r.service_start && r.service_end
                              ? `${formatDate(r.service_start)} – ${formatDate(r.service_end)}`
                              : ""}
                          </td>
                          <td className="cell">
                            <span className={li.is_consumption_based ? "text-nurock-navy" : "text-nurock-slate-light"}>
                              {li.is_consumption_based ? "● " : "○ "}
                            </span>
                            {li.description}
                          </td>
                          <td className="px-3 py-2 text-xs text-nurock-slate">
                            {li.category.replace(/_/g, " ")}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono text-nurock-slate">
                            {li.gl_coding ?? "—"}
                          </td>
                          <td className="cell text-right num">
                            {formatDollars(li.amount)}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-nurock-slate-light mt-2">
                Historical line items (marked with HIST- invoice numbers) come from the
                per-property Water sheet. Line items sum should equal the month's total
                within $0.02; mismatches are flagged on the invoice detail page.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-tile navy">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

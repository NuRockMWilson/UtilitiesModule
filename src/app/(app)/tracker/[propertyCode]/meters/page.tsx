import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { formatDollars, formatPercent } from "@/lib/format";

/**
 * House Meters detail page. Shows every electric meter at a property and its
 * monthly history, matching the legacy "House Meters" sheet layout:
 *
 *   Meter / Description | Category | Jan | Feb | ... | Dec | YTD
 *
 * Each meter has its own utility_accounts row, so variance analysis surfaces
 * per-meter anomalies ("Pool pump +23%") instead of only per-property totals.
 */
export default async function MetersDetailPage({
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

  // All electric meters at this property (GL 5112 house, 5114 vacant, 5116 clubhouse)
  const { data: metersRaw } = await supabase
    .from("utility_accounts")
    .select(`
      id, account_number, description, meter_id, esi_id, meter_category,
      gl_accounts ( code ),
      vendors ( name )
    `)
    .eq("property_id", property.id)
    .eq("active", true)
    .in("gl_accounts.code", ["5112", "5114", "5116"])
    .order("meter_category", { ascending: true });

  const meters = (metersRaw ?? []).filter((m: any) => m.gl_accounts);

  // For each meter, pull the invoice history. One query covering all of them
  // (filtered by utility_account_id in clause) is more efficient than N queries.
  const meterIds = meters.map((m: any) => m.id);

  const { data: invoicesRaw } = meterIds.length
    ? await supabase
        .from("invoices")
        .select(`
          id, utility_account_id, invoice_number,
          service_period_start, service_period_end, service_days,
          total_amount_due, invoice_date, status
        `)
        .in("utility_account_id", meterIds)
        .order("invoice_date", { ascending: false })
    : { data: [] };

  // Group invoices by meter id and year/month
  type Invoice = {
    id: string;
    invoice_number: string | null;
    service_period_start: string | null;
    service_period_end:   string | null;
    service_days: number | null;
    total_amount_due: number;
    invoice_date: string | null;
  };

  const invoicesByMeter = new Map<string, Invoice[]>();
  for (const raw of (invoicesRaw ?? []) as any[]) {
    const list = invoicesByMeter.get(raw.utility_account_id) ?? [];
    list.push({
      id:                   raw.id,
      invoice_number:       raw.invoice_number,
      service_period_start: raw.service_period_start,
      service_period_end:   raw.service_period_end,
      service_days:         raw.service_days,
      total_amount_due:     Number(raw.total_amount_due ?? 0),
      invoice_date:         raw.invoice_date,
    });
    invoicesByMeter.set(raw.utility_account_id, list);
  }

  // For the summary grid, build a { meterId: { month: amount } } table for the selected year
  const ytdByMeter: Record<string, { monthly: (number | null)[]; ytd: number }> = {};
  for (const m of meters) {
    const monthly: (number | null)[] = new Array(12).fill(null);
    const invoices = invoicesByMeter.get(m.id) ?? [];
    for (const inv of invoices) {
      if (!inv.invoice_date) continue;
      const y = parseInt(inv.invoice_date.substring(0, 4), 10);
      const mo = parseInt(inv.invoice_date.substring(5, 7), 10);
      if (y === year && mo >= 1 && mo <= 12) {
        monthly[mo - 1] = (monthly[mo - 1] ?? 0) + inv.total_amount_due;
      }
    }
    const ytd = monthly.reduce<number>((s, v) => s + (v ?? 0), 0);
    ytdByMeter[m.id] = { monthly, ytd };
  }

  // Category totals — how much the property spends on pool vs. lighting vs. house, etc.
  const categoryTotals = new Map<string, number>();
  for (const m of meters) {
    const cat = (m as any).meter_category || "other";
    const ytd = ytdByMeter[m.id]?.ytd ?? 0;
    categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + ytd);
  }

  const propertyYtdTotal = Array.from(categoryTotals.values()).reduce((a, b) => a + b, 0);

  // Year picker
  const invoiceDates = (invoicesRaw ?? []).map((i: any) => i.invoice_date).filter(Boolean) as string[];
  const years = Array.from(new Set(invoiceDates.map(d => parseInt(d.substring(0, 4), 10))))
    .sort((a, b) => b - a);

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const categoryLabels: Record<string, string> = {
    house:      "House",
    clubhouse:  "Clubhouse",
    pool:       "Pool",
    trash:      "Trash compactor",
    lighting:   "Lighting",
    irrigation: "Irrigation",
    laundry:    "Laundry",
    gate:       "Gate",
    sign:       "Sign",
    leasing:    "Leasing office",
    other:      "Other",
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${property.name} · House meters`}
        subtitle={`${property.full_code} · ${meters.length} meters · ${year} YTD ${formatDollars(propertyYtdTotal)}`}
      />

      <div className="px-8 py-4 bg-white border-b border-navy-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/tracker/${property.code}?year=${year}`} className="btn-secondary text-sm">
            ← Summary
          </Link>
          <Link href={`/tracker/${property.code}/water?year=${year}`} className="btn-secondary text-sm">
            Water detail
          </Link>
          <div className="flex items-center gap-1 ml-4">
            <span className="text-xs text-tan-700 mr-2">Year:</span>
            {years.map(y => (
              <Link
                key={y}
                href={`/tracker/${property.code}/meters?year=${y}`}
                className={
                  "px-2 py-1 rounded text-xs " +
                  (y === year ? "bg-navy text-white" : "text-navy-700 hover:bg-tan-100")
                }
              >
                {y}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-paper">
        <div className="px-8 py-6">
          {meters.length === 0 && (
            <div className="card p-8 text-center">
              <div className="text-navy-700 font-medium mb-2">No electric meters on file</div>
              <div className="text-sm text-tan-700">
                This property has no electric meters set up yet. Meters are created
                automatically from the historical import or as bills flow through
                the extraction pipeline. You can also add them manually under
                Admin → Utility Accounts.
              </div>
            </div>
          )}

          {meters.length > 0 && (
            <>
              {/* Category breakdown */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                {Array.from(categoryTotals.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4)
                  .map(([cat, total]) => (
                    <div key={cat} className="card p-4">
                      <div className="text-xs text-tan-700 uppercase tracking-wide">
                        {categoryLabels[cat] || cat}
                      </div>
                      <div className="text-xl font-display font-semibold text-navy-800 mt-1">
                        {formatDollars(total)}
                      </div>
                      <div className="text-xs text-tan-600 mt-1">
                        {propertyYtdTotal > 0
                          ? formatPercent(total / propertyYtdTotal)
                          : "—"} of total
                      </div>
                    </div>
                  ))}
              </div>

              {/* Per-meter monthly grid */}
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-navy-100 text-tan-700 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium sticky left-0 bg-navy-100 z-10">
                        Meter
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Category</th>
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      {MONTHS.map(m => (
                        <th key={m} className="px-2 py-2 text-right font-medium">
                          {m}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium bg-navy-200">
                        YTD
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {meters.map((m: any) => {
                      const row = ytdByMeter[m.id];
                      const cat = m.meter_category || "other";
                      const meterLabel = m.description || m.meter_id || m.account_number || "Unnamed meter";
                      return (
                        <tr key={m.id} className="hover:bg-paper">
                          <td className="px-3 py-2 sticky left-0 bg-white z-10">
                            {meterLabel}
                            {m.meter_id && m.description !== m.meter_id && (
                              <div className="text-xs text-tan-600 font-mono">
                                {m.meter_id}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-tan-700">
                            {categoryLabels[cat] || cat}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono text-tan-700">
                            {m.account_number}
                          </td>
                          {(row?.monthly ?? new Array(12).fill(null)).map((v, i) => (
                            <td key={i} className="px-2 py-2 text-right tabular-nums">
                              {v !== null ? formatDollars(v) : <span className="text-tan-400">—</span>}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right tabular-nums font-medium bg-navy-50">
                            {row?.ytd ? formatDollars(row.ytd) : <span className="text-tan-400">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-navy-200 font-medium">
                    <tr>
                      <td className="px-3 py-2 sticky left-0 bg-navy-200 z-10">
                        Total — {meters.length} meters
                      </td>
                      <td></td>
                      <td></td>
                      {MONTHS.map((_, i) => {
                        const monthTotal = meters.reduce((s: number, m: any) =>
                          s + (ytdByMeter[m.id]?.monthly[i] ?? 0), 0);
                        return (
                          <td key={i} className="px-2 py-2 text-right tabular-nums">
                            {monthTotal > 0 ? formatDollars(monthTotal) : ""}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatDollars(propertyYtdTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-xs text-tan-600 mt-4">
                Meters are grouped by category for fast visual comparison. Variance analysis
                runs per-meter — anomalies on the pool pump or clubhouse meter surface
                directly instead of being hidden in the property total. Historical meter
                invoices (marked <span className="font-mono">HIST-M-</span>) come from the
                legacy House Meters sheet; new meter bills append as they're processed.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

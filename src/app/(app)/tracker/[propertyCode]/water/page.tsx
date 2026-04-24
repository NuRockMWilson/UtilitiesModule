import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { formatDollars } from "@/lib/format";
import { PerAccountMonthlyGrid, type AccountRow } from "@/components/tracker/PerAccountMonthlyGrid";

/**
 * Water detail page. Shows every water/sewer/irrigation/stormwater account
 * at this property in a per-account × per-month grid matching the legacy
 * "<Property>_Water_usage_break_down.xlsx" layout:
 *
 *   Account # | Description | Jan | Feb | ... | Dec | YTD
 *
 * Water is GL 5120, Irrigation 5122, Sewer 5125.
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

  // Every utility account at this property whose GL is water/sewer/irrigation/stormwater
  const { data: acctRaw } = await supabase
    .from("utility_accounts")
    .select(`
      id, account_number, description, meter_id, esi_id, meter_category,
      gl_accounts!inner ( code, description ),
      vendors ( name )
    `)
    .eq("property_id", property.id)
    .eq("active", true)
    .in("gl_accounts.code", ["5120", "5122", "5125"]);

  const accounts: AccountRow[] = (acctRaw ?? []).map((a: any) => ({
    id:             a.id,
    account_number: a.account_number,
    description:    a.description ?? a.gl_accounts?.description ?? null,
    meter_id:       a.meter_id,
    esi_id:         a.esi_id,
    category:       a.gl_accounts?.code === "5125"
      ? "Sewer"
      : a.gl_accounts?.code === "5122"
        ? "Irrigation"
        : "Water",
    vendor_name:    a.vendors?.name ?? null,
  }));

  // Every invoice for those accounts in any year (we filter client-side for the year picker)
  const accountIds = accounts.map(a => a.id);
  const { data: invRaw } = accountIds.length
    ? await supabase
        .from("invoices")
        .select("id, invoice_number, utility_account_id, invoice_date, total_amount_due")
        .in("utility_account_id", accountIds)
    : { data: [] };

  const invoices = (invRaw ?? []).map((i: any) => ({
    id:             i.id as string,
    invoice_number: i.invoice_number as string | null,
    account_id:     i.utility_account_id as string,
    date:           i.invoice_date as string | null,
    amount:         Number(i.total_amount_due ?? 0),
  }));

  // Year picker options — every year that has invoice data
  const years = Array.from(new Set(
    invoices.map(i => i.date ? parseInt(i.date.substring(0, 4), 10) : null)
           .filter((y): y is number => y !== null)
  )).sort((a, b) => b - a);
  if (!years.includes(year)) years.unshift(year);

  // Build accountId → { month → amount } for the selected year
  const amountsByAccountMonth = new Map<string, Record<number, number>>();
  const invoiceByAccountMonth = new Map<string, { id: string; number: string | null }>();
  for (const inv of invoices) {
    if (!inv.date) continue;
    const y = parseInt(inv.date.substring(0, 4), 10);
    if (y !== year) continue;
    const m = parseInt(inv.date.substring(5, 7), 10);
    const bucket = amountsByAccountMonth.get(inv.account_id) ?? {};
    bucket[m] = (bucket[m] ?? 0) + inv.amount;
    amountsByAccountMonth.set(inv.account_id, bucket);
    invoiceByAccountMonth.set(`${inv.account_id}:${m}`, {
      id:     inv.id,
      number: inv.invoice_number,
    });
  }

  // Split accounts by category for separate grids (mirrors legacy spreadsheet)
  const waterAccts      = accounts.filter(a => a.category === "Water");
  const irrigationAccts = accounts.filter(a => a.category === "Irrigation");
  const sewerAccts      = accounts.filter(a => a.category === "Sewer");

  // YTD totals for the KPI strip
  const ytdForAccounts = (accts: AccountRow[]) =>
    accts.reduce((sum, a) => {
      const bucket = amountsByAccountMonth.get(a.id) ?? {};
      return sum + Object.values(bucket).reduce((s, v) => s + v, 0);
    }, 0);

  const waterYtd      = ytdForAccounts(waterAccts);
  const sewerYtd      = ytdForAccounts(sewerAccts);
  const irrigationYtd = ytdForAccounts(irrigationAccts);
  const totalYtd      = waterYtd + sewerYtd + irrigationYtd;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${property.name} · Water detail`}
        subtitle={`${property.full_code} · ${accounts.length} accounts · ${year} YTD ${formatDollars(totalYtd)}`}
      />

      <div className="px-8 py-4 bg-white border-b border-nurock-border flex items-center gap-2">
        <Link href={`/tracker/${property.code}?year=${year}`} className="btn-secondary">
          ← Summary
        </Link>
        <div className="flex items-center gap-1 ml-4">
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mr-2">Year</span>
          {years.map(y => (
            <Link
              key={y}
              href={`/tracker/${property.code}/water?year=${y}`}
              className={
                "px-2 py-1 rounded-md text-[11px] font-medium transition-colors " +
                (y === year ? "bg-nurock-navy text-white" : "text-nurock-slate hover:bg-nurock-flag-navy-bg hover:text-nurock-navy")
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-nurock-bg">
        <div className="px-8 py-6 space-y-6 max-w-[1600px] mx-auto w-full">

          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3">
            <div className="kpi-tile navy">
              <div className="kpi-label">{year} Total</div>
              <div className="kpi-value num">{formatDollars(totalYtd)}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-label">Water (5120)</div>
              <div className="kpi-value num">{formatDollars(waterYtd)}</div>
              <div className="kpi-sub">{waterAccts.length} {waterAccts.length === 1 ? "account" : "accounts"}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-label">Sewer (5125)</div>
              <div className="kpi-value num">{formatDollars(sewerYtd)}</div>
              <div className="kpi-sub">{sewerAccts.length} {sewerAccts.length === 1 ? "account" : "accounts"}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-label">Irrigation (5122)</div>
              <div className="kpi-value num">{formatDollars(irrigationYtd)}</div>
              <div className="kpi-sub">{irrigationAccts.length} {irrigationAccts.length === 1 ? "account" : "accounts"}</div>
            </div>
          </div>

          {/* Per-account grid — one section per GL category */}
          {waterAccts.length > 0 && (
            <section>
              <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                Water — GL 5120
              </h2>
              <PerAccountMonthlyGrid
                accounts={waterAccts}
                amountsByAccountMonth={amountsByAccountMonth}
                invoiceHrefByAccountMonth={invoiceByAccountMonth}
                leftHeader="Account #"
                middleHeader="Description"
              />
            </section>
          )}

          {sewerAccts.length > 0 && (
            <section>
              <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                Sewer — GL 5125
              </h2>
              <PerAccountMonthlyGrid
                accounts={sewerAccts}
                amountsByAccountMonth={amountsByAccountMonth}
                invoiceHrefByAccountMonth={invoiceByAccountMonth}
                leftHeader="Account #"
                middleHeader="Description"
              />
            </section>
          )}

          {irrigationAccts.length > 0 && (
            <section>
              <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                Irrigation — GL 5122
              </h2>
              <PerAccountMonthlyGrid
                accounts={irrigationAccts}
                amountsByAccountMonth={amountsByAccountMonth}
                invoiceHrefByAccountMonth={invoiceByAccountMonth}
                leftHeader="Account #"
                middleHeader="Description"
              />
            </section>
          )}

          {accounts.length === 0 && (
            <div className="card p-8 text-center">
              <div className="text-nurock-black font-medium mb-2">No water accounts on file</div>
              <div className="text-[12.5px] text-nurock-slate-light">
                Water accounts are created automatically from the historical import
                or as bills flow through the extraction pipeline.
              </div>
            </div>
          )}

          <p className="text-[11px] text-nurock-slate-light">
            Each amount above is clickable when it links to an individual invoice.
            Historical rollups from the legacy Water sheet have invoice numbers
            starting with <span className="font-mono">HIST-W-</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

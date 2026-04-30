import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
import { formatDollars, formatPercent } from "@/lib/format";
import { PerAccountMonthlyGrid, type AccountRow } from "@/components/tracker/PerAccountMonthlyGrid";
import { displayPropertyName } from "@/lib/property-display";
import { fetchAllInvoicesForProperty } from "@/lib/invoice-queries";

/**
 * Trash / Garbage detail page. Per-account monthly grid for GL 5135.
 *
 * Properties like Onion Creek have multiple trash accounts (compactor,
 * recycle cart, temporary open-top), so this view surfaces each account
 * separately — matching the legacy "Garbage" sheet layout.
 *
 * Pickup counts and $/pickup appear in a secondary table below the grid for
 * variance reference, since cost-per-pickup is often more informative than
 * cost-per-month when pickup frequency changes.
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

  const { data: allProperties } = await supabase
    .from("properties")
    .select("code, name, full_code")
    .order("code");

  const year = searchParams.year ? parseInt(searchParams.year, 10) : new Date().getFullYear();

  const { data: glRow } = await supabase
    .from("gl_accounts")
    .select("id")
    .eq("code", "5135")
    .single();

  const { data: acctRaw } = glRow
    ? await supabase
        .from("utility_accounts")
        .select(`
          id, account_number, description,
          vendors ( name )
        `)
        .eq("property_id", property.id)
        .eq("active", true)
        .eq("gl_account_id", glRow.id)
    : { data: [] };

  const accounts: AccountRow[] = (acctRaw ?? []).map((a: any) => ({
    id:             a.id,
    account_number: a.account_number,
    description:    a.description,
    vendor_name:    a.vendors?.name ?? null,
  }));

  // Pull every trash invoice for this property — tied to a utility_account or
  // not. Historical Summary rows have no utility_account_id; route them to a
  // synthetic "Summary rollup" row so dollars still appear.
  const invRaw = await fetchAllInvoicesForProperty(supabase, {
    propertyId: property.id,
    glIds:      glRow?.id ? [glRow.id] : [],
    selectCols: "id, invoice_number, utility_account_id, invoice_date, service_period_end, total_amount_due, units_billed, units_billed_label",
  });

  const invoices = (invRaw ?? []).map((i: any) => ({
    id:             i.id as string,
    invoice_number: i.invoice_number as string | null,
    account_id:     (i.utility_account_id ?? "__summary-trash") as string,
    date:           (i.service_period_end ?? i.invoice_date) as string | null,
    amount:         Number(i.total_amount_due ?? 0),
    pickups:        i.units_billed ? Number(i.units_billed) : null,
    units_label:    i.units_billed_label as string | null,
  }));

  const years = Array.from(new Set(
    invoices.map(i => i.date ? parseInt(i.date.substring(0, 4), 10) : null)
           .filter((y): y is number => y !== null)
  )).sort((a, b) => b - a);
  if (!years.includes(year)) years.unshift(year);

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

  // Per-account notes for this property × year (detail-tab notes are attached
  // at the utility_account × month granularity).
  const acctIdsForNotes = accounts.map(a => a.id).filter(id => !id.startsWith("__summary-"));
  const { data: notesRaw } = acctIdsForNotes.length
    ? await supabase
        .from("monthly_notes")
        .select("id, note, created_at, created_by_email, utility_account_id, month")
        .eq("property_id", property.id)
        .eq("year", year)
        .in("utility_account_id", acctIdsForNotes)
        .order("created_at", { ascending: false })
    : { data: [] };
  const notesByCell = new Map<string, Array<{id:string;note:string;created_at:string;created_by_email:string|null}>>();
  for (const n of (notesRaw ?? []) as any[]) {
    if (!n.utility_account_id || !n.month) continue;
    const key = `${n.utility_account_id}:${n.month}`;
    const arr = notesByCell.get(key) ?? [];
    arr.push({ id: n.id, note: n.note, created_at: n.created_at, created_by_email: n.created_by_email });
    notesByCell.set(key, arr);
  }


  // Pickup stats for the current year
  const currentYearInvoices = invoices.filter(i => i.date?.startsWith(String(year)));
  const ytdTotal   = currentYearInvoices.reduce((s, i) => s + i.amount, 0);
  const ytdPickups = currentYearInvoices.reduce((s, i) => s + (i.pickups ?? 0), 0);
  const avgPerPickup = ytdPickups > 0 ? ytdTotal / ytdPickups : null;

  const priorYearInvoices = invoices.filter(i => i.date?.startsWith(String(year - 1)) && i.pickups);
  const priorPickups = priorYearInvoices.reduce((s, i) => s + (i.pickups ?? 0), 0);
  const priorTotal   = priorYearInvoices.reduce((s, i) => s + i.amount, 0);
  const priorAvg     = priorPickups > 0 ? priorTotal / priorPickups : null;
  const yoyPct = avgPerPickup !== null && priorAvg !== null
    ? ((avgPerPickup - priorAvg) / priorAvg)
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${displayPropertyName(property.name)} · Trash`}
        subtitle={`${property.full_code} · ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} · ${year} YTD ${formatDollars(ytdTotal)}`}
      />

      <div className="px-8 py-4 bg-white border-b border-nurock-border flex items-center gap-2">
        <PropertyPicker
            currentCode={property.code}
            properties={allProperties ?? []}
            year={year}
          />
          <Link href={`/tracker/${property.code}?year=${year}`} className="btn-secondary">
            ← Summary
          </Link>
        <div className="flex items-center gap-1 ml-4">
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mr-2">Year</span>
          {years.map(y => (
            <Link
              key={y}
              href={`/tracker/${property.code}/trash?year=${y}`}
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

          {accounts.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-nurock-black font-medium mb-2">No trash accounts on file</div>
              <div className="text-[12.5px] text-nurock-slate-light">
                Trash accounts are created automatically from the historical import
                or as bills flow through the extraction pipeline.
              </div>
            </div>
          ) : (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-4 gap-3">
                <div className="kpi-tile navy">
                  <div className="kpi-label">{year} Total</div>
                  <div className="kpi-value num">{formatDollars(ytdTotal)}</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">{year} Pickups</div>
                  <div className="kpi-value num">{ytdPickups}</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">Avg $/pickup</div>
                  <div className="kpi-value num">
                    {avgPerPickup !== null ? formatDollars(avgPerPickup) : "—"}
                  </div>
                </div>
                <div className={"kpi-tile " + (yoyPct === null ? "" : yoyPct > 0.03 ? "red" : yoyPct < -0.03 ? "green" : "")}>
                  <div className="kpi-label">YoY $/pickup</div>
                  <div className={"kpi-value num " + (yoyPct === null ? "" : yoyPct > 0.03 ? "text-flag-red" : yoyPct < -0.03 ? "text-flag-green" : "")}>
                    {yoyPct !== null ? formatPercent(yoyPct, { sign: true }) : "—"}
                  </div>
                  {priorAvg !== null && (
                    <div className="kpi-sub">vs {formatDollars(priorAvg)} in {year - 1}</div>
                  )}
                </div>
              </div>

              {/* Per-account grid */}
              <section>
                <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                  Trash — GL 5135
                </h2>
                <PerAccountMonthlyGrid
                  accounts={accounts}
                  amountsByAccountMonth={amountsByAccountMonth}
                  invoiceHrefByAccountMonth={invoiceByAccountMonth}
                  leftHeader="Account #"
                  middleHeader="Description"
                  noteAnchor={{ property_id: property.id, year, notesByCell }}
                
                  historicalDisclaimerYear={year}
                />
              </section>

              <p className="text-[11px] text-nurock-slate-light">
                Each cell links to the underlying trash invoice for that account × month.
                Historical bills have invoice numbers starting with <span className="font-mono">HIST-T-</span>.
                Pickup counts feed the $/pickup variance calculation — a higher bill explained
                by more pickups won&apos;t trigger a false flag.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

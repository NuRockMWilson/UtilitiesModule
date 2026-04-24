import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
import { formatDollars, formatPercent } from "@/lib/format";
import { PerAccountMonthlyGrid, type AccountRow } from "@/components/tracker/PerAccountMonthlyGrid";

/**
 * House Meters detail page. Shows every electric meter at the property with
 * monthly spend per meter. Matches the legacy "House Meters" sheet layout:
 *
 *   Account # | Meter / Description | Jan | Feb | ... | Dec | YTD
 *
 * Electric GLs: 5112 (house), 5116 (clubhouse). Vacant electric (5114) lives
 * on its own Vacant Units page.
 */

const CATEGORY_LABELS: Record<string, string> = {
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

  const { data: allProperties } = await supabase
    .from("properties")
    .select("code, name, full_code")
    .order("code");

  const year = searchParams.year ? parseInt(searchParams.year, 10) : new Date().getFullYear();

  const { data: glRows } = await supabase
    .from("gl_accounts")
    .select("id, code")
    .in("code", ["5112", "5116"]);

  const glIds = (glRows ?? []).map((g: any) => g.id);

  const { data: acctRaw } = glIds.length
    ? await supabase
        .from("utility_accounts")
        .select(`
          id, account_number, description, meter_id, esi_id, meter_category,
          vendors ( name )
        `)
        .eq("property_id", property.id)
        .eq("active", true)
        .in("gl_account_id", glIds)
    : { data: [] };

  const accounts: AccountRow[] = (acctRaw ?? []).map((a: any) => ({
    id:             a.id,
    account_number: a.account_number,
    description:    a.description,
    meter_id:       a.meter_id,
    esi_id:         a.esi_id,
    category:       a.meter_category ? (CATEGORY_LABELS[a.meter_category] ?? a.meter_category) : null,
    vendor_name:    a.vendors?.name ?? null,
  }));

  // Pull every electric invoice for this property — tied to a utility_account
  // or not. Historical Summary rows have no utility_account_id; we route them
  // to a synthetic "Summary rollup" row so dollars still appear.
  const { data: invRaw } = glIds.length
    ? await supabase
        .from("invoices")
        .select("id, invoice_number, utility_account_id, gl_account_id, invoice_date, service_period_end, total_amount_due")
        .eq("property_id", property.id)
        .in("gl_account_id", glIds)
    : { data: [] };

  const hasOrphanInvoices = (invRaw ?? []).some((i: any) => !i.utility_account_id);
  if (hasOrphanInvoices) {
    accounts.push({
      id:             "__summary-electric",
      account_number: `HIST-${property.code}`,
      description:    "Summary rollup (historical)",
      category:       "Other",
    });
  }

  const invoices = (invRaw ?? []).map((i: any) => ({
    id:             i.id as string,
    invoice_number: i.invoice_number as string | null,
    account_id:     (i.utility_account_id ?? "__summary-electric") as string,
    date:           (i.service_period_end ?? i.invoice_date) as string | null,
    amount:         Number(i.total_amount_due ?? 0),
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


  const ytdByAccount = new Map<string, number>();
  for (const [acctId, bucket] of amountsByAccountMonth) {
    ytdByAccount.set(acctId, Object.values(bucket).reduce((s, v) => s + v, 0));
  }

  // Category rollup KPIs
  const categoryTotals = new Map<string, number>();
  for (const a of accounts) {
    const cat = a.category ?? "Other";
    categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + (ytdByAccount.get(a.id) ?? 0));
  }
  const propertyYtd = Array.from(categoryTotals.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${property.name} · House meters`}
        subtitle={`${property.full_code} · ${accounts.length} meters · ${year} YTD ${formatDollars(propertyYtd)}`}
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
              href={`/tracker/${property.code}/meters?year=${y}`}
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
              <div className="text-nurock-black font-medium mb-2">No electric meters on file</div>
              <div className="text-[12.5px] text-nurock-slate-light">
                Meters are created automatically from the historical import
                or as bills flow through the extraction pipeline.
              </div>
            </div>
          ) : (
            <>
              {/* Category rollup — top 4 by spend */}
              {categoryTotals.size > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  {Array.from(categoryTotals.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([cat, total]) => (
                      <div key={cat} className="kpi-tile navy">
                        <div className="kpi-label">{cat}</div>
                        <div className="kpi-value num">{formatDollars(total)}</div>
                        <div className="kpi-sub num">
                          {propertyYtd > 0 ? formatPercent(total / propertyYtd) : "—"} of total
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* Per-account grid */}
              <section>
                <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                  Meters — GL 5112 / 5116
                </h2>
                <PerAccountMonthlyGrid
                  accounts={accounts}
                  amountsByAccountMonth={amountsByAccountMonth}
                  invoiceHrefByAccountMonth={invoiceByAccountMonth}
                  leftHeader="Account #"
                  middleHeader="Meter / Description"
                  showCategory
                  noteAnchor={{ property_id: property.id, year, notesByCell }}
                />
              </section>

              <p className="text-[11px] text-nurock-slate-light">
                Each cell links to the underlying invoice for that meter × month.
                Historical meter bills have invoice numbers starting with{" "}
                <span className="font-mono">HIST-M-</span>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
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

  const { data: allProperties } = await supabase
    .from("properties")
    .select("code, name, full_code")
    .order("code");

  const year = searchParams.year ? parseInt(searchParams.year, 10) : new Date().getFullYear();

  // Step 1: look up GL account IDs for water / irrigation / sewer.
  // (Filtering utility_accounts by the joined gl_accounts.code doesn't work
  //  reliably in PostgREST — filters on embedded relations restrict the
  //  embed, not the parent rows. We have to do the lookup explicitly.)
  const { data: glRows } = await supabase
    .from("gl_accounts")
    .select("id, code, description")
    .in("code", ["5120", "5122", "5125"]);

  const glById   = new Map((glRows ?? []).map((g: any) => [g.id, g]));
  const glIds    = (glRows ?? []).map((g: any) => g.id);

  // Step 2: pull every utility account at this property for those GLs
  const { data: acctRaw } = glIds.length
    ? await supabase
        .from("utility_accounts")
        .select(`
          id, account_number, description, meter_id, esi_id, meter_category,
          gl_account_id,
          vendors ( name )
        `)
        .eq("property_id", property.id)
        .eq("active", true)
        .in("gl_account_id", glIds)
    : { data: [] };

  const accounts: AccountRow[] = (acctRaw ?? []).map((a: any) => {
    const gl = glById.get(a.gl_account_id) as { code: string; description: string } | undefined;
    const glCode = gl?.code;
    return {
      id:             a.id,
      account_number: a.account_number,
      description:    a.description ?? gl?.description ?? null,
      meter_id:       a.meter_id,
      esi_id:         a.esi_id,
      category:       glCode === "5125" ? "Sewer"
                    : glCode === "5122" ? "Irrigation"
                    : "Water",
      vendor_name:    a.vendors?.name ?? null,
    };
  });

  // Pull every water/sewer/irrigation invoice for this property — regardless
  // of whether it's tied to a specific utility_account_id. Historical Summary
  // rows (source_reference='historical_import_summary') aren't linked to a
  // utility_account but still need to show up, as a synthetic "Summary rollup"
  // pseudo-account per GL.
  const { data: invRaw } = glIds.length
    ? await supabase
        .from("invoices")
        .select("id, invoice_number, utility_account_id, gl_account_id, invoice_date, service_period_end, total_amount_due")
        .eq("property_id", property.id)
        .in("gl_account_id", glIds)
    : { data: [] };

  // Build synthetic "Summary rollup" accounts for invoices that have no
  // utility_account_id — one per GL code that actually has such orphan
  // invoices. Keyed on a sentinel id that won't collide with real UUIDs.
  const syntheticAccountsByGL = new Map<string, AccountRow>();
  for (const i of (invRaw ?? []) as any[]) {
    if (i.utility_account_id) continue;
    const gl = glById.get(i.gl_account_id) as { code: string; description: string } | undefined;
    if (!gl) continue;
    if (!syntheticAccountsByGL.has(gl.code)) {
      syntheticAccountsByGL.set(gl.code, {
        id:             `__summary-${gl.code}`,
        account_number: `HIST-${property.code}`,
        description:    "Summary rollup (historical)",
        category:       gl.code === "5125" ? "Sewer" : gl.code === "5122" ? "Irrigation" : "Water",
      });
    }
  }
  for (const acct of syntheticAccountsByGL.values()) accounts.push(acct);

  const invoices = (invRaw ?? []).map((i: any) => {
    const gl = glById.get(i.gl_account_id) as { code: string } | undefined;
    // Route orphan invoices (no utility_account_id) to the synthetic rollup
    const accountId = i.utility_account_id
      ?? (gl ? `__summary-${gl.code}` : null);
    return {
      id:             i.id as string,
      invoice_number: i.invoice_number as string | null,
      account_id:     accountId as string | null,
      gl_code:        gl?.code as string | undefined,
      date:           (i.service_period_end ?? i.invoice_date) as string | null,
      amount:         Number(i.total_amount_due ?? 0),
    };
  });

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
    if (!inv.date || !inv.account_id) continue;
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
                noteAnchor={{ property_id: property.id, year, notesByCell }}
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
                noteAnchor={{ property_id: property.id, year, notesByCell }}
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
                noteAnchor={{ property_id: property.id, year, notesByCell }}
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

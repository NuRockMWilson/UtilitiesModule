import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { PropertyPicker } from "@/components/tracker/PropertyPicker";
import { formatDollars } from "@/lib/format";
import { PerAccountMonthlyGrid, type AccountRow } from "@/components/tracker/PerAccountMonthlyGrid";
import { displayPropertyName } from "@/lib/property-display";
import { fetchAllInvoicesForProperty } from "@/lib/invoice-queries";

/**
 * Combined Phone + Cable detail page. Per-account monthly grid for both
 * GL 5635 (Phone) and GL 5140 (Cable), matching the legacy Phone&Cable
 * sheet layout where each vendor account gets its own line.
 */
export default async function CommsDetailPage({
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
    .in("code", ["5140", "5635"]);

  const glCodeById = new Map((glRows ?? []).map((g: any) => [g.id, g.code]));
  const glIds      = (glRows ?? []).map((g: any) => g.id);

  const { data: acctRaw } = glIds.length
    ? await supabase
        .from("utility_accounts")
        .select(`
          id, account_number, description, gl_account_id,
          vendors ( name )
        `)
        .eq("property_id", property.id)
        .eq("active", true)
        .in("gl_account_id", glIds)
    : { data: [] };

  const accountsByGL: Record<string, AccountRow[]> = { "5635": [], "5140": [] };
  for (const a of (acctRaw ?? []) as any[]) {
    const gl = glCodeById.get(a.gl_account_id) as string | undefined;
    if (gl !== "5140" && gl !== "5635") continue;
    accountsByGL[gl].push({
      id:             a.id,
      account_number: a.account_number,
      description:    a.description,
      vendor_name:    a.vendors?.name ?? null,
    });
  }

  const allAccounts = [...accountsByGL["5635"], ...accountsByGL["5140"]];

  // Pull every phone/cable invoice for this property — tied to a utility_account
  // or not. Historical Summary rows have no utility_account_id; route them to
  // synthetic per-GL "Summary rollup" rows so dollars still appear.
  const invRaw = await fetchAllInvoicesForProperty(supabase, {
    propertyId: property.id,
    glIds,
    selectCols: "id, invoice_number, utility_account_id, gl_account_id, invoice_date, service_period_end, total_amount_due",
  });

  const invoices = (invRaw ?? []).map((i: any) => {
    const gl = glCodeById.get(i.gl_account_id) as string | undefined;
    return {
      id:             i.id as string,
      invoice_number: i.invoice_number as string | null,
      account_id:     (i.utility_account_id ?? "__summary-comms") as string,
      date:           (i.service_period_end ?? i.invoice_date) as string | null,
      amount:         Number(i.total_amount_due ?? 0),
    };
  });

  const years = Array.from(new Set(
    invoices.map(i => i.date ? parseInt(i.date.substring(0, 4), 10) : null)
           .filter((y): y is number => y !== null)
  )).sort((a, b) => b - a);
  if (!years.includes(year)) years.unshift(year);

  const amountsByAccountMonth = new Map<string, Record<number, number>>();
  const invoiceByAccountMonth = new Map<string, { id: string; number: string | null }>();
  for (const inv of invoices) {
    if (!inv.date) continue;
    // Note: no longer filtering on account_id — orphans are routed to a
    // synthetic key above so the dollars become visible via a synth row.
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

  // Synthetic "Summary rollup" row for orphan invoices (comms is single-GL
  // 5140). Mirrors the pattern in trash/meters/water.
  if (amountsByAccountMonth.has("__summary-comms")) {
    allAccounts.unshift({
      id:             "__summary-comms",
      account_number: "—",
      description:    "Historical / unmapped invoices",
      meter_id:       null,
      esi_id:         null,
      category:       null,
      vendor_name:    null,
    });
  }

  // Per-account notes for this property × year (detail-tab notes are attached
  // at the utility_account × month granularity).
  const acctIdsForNotes = allAccounts.map(a => a.id).filter(id => !id.startsWith("__summary-"));
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


  const ytdForAccounts = (accts: AccountRow[]) =>
    accts.reduce((sum, a) => {
      const bucket = amountsByAccountMonth.get(a.id) ?? {};
      return sum + Object.values(bucket).reduce((s, v) => s + v, 0);
    }, 0);

  const phoneYtd = ytdForAccounts(accountsByGL["5635"]);
  const cableYtd = ytdForAccounts(accountsByGL["5140"]);
  const totalYtd = phoneYtd + cableYtd;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${displayPropertyName(property.name)} · Phone & Cable`}
        subtitle={`${property.full_code} · ${allAccounts.length} accounts · ${year} YTD ${formatDollars(totalYtd)}`}
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
              href={`/tracker/${property.code}/comms?year=${y}`}
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

          {allAccounts.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-nurock-black font-medium mb-2">No phone or cable accounts on file</div>
              <div className="text-[12.5px] text-nurock-slate-light">
                Phone and cable accounts are created automatically from the historical
                import or as bills flow through the extraction pipeline.
              </div>
            </div>
          ) : (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="kpi-tile navy">
                  <div className="kpi-label">{year} Total</div>
                  <div className="kpi-value num">{formatDollars(totalYtd)}</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">Phone (5635)</div>
                  <div className="kpi-value num">{formatDollars(phoneYtd)}</div>
                  <div className="kpi-sub">{accountsByGL["5635"].length} {accountsByGL["5635"].length === 1 ? "account" : "accounts"}</div>
                </div>
                <div className="kpi-tile">
                  <div className="kpi-label">Cable (5140)</div>
                  <div className="kpi-value num">{formatDollars(cableYtd)}</div>
                  <div className="kpi-sub">{accountsByGL["5140"].length} {accountsByGL["5140"].length === 1 ? "account" : "accounts"}</div>
                </div>
              </div>

              {accountsByGL["5635"].length > 0 && (
                <section>
                  <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                    Phone — GL 5635
                  </h2>
                  <PerAccountMonthlyGrid
                    accounts={accountsByGL["5635"]}
                    amountsByAccountMonth={amountsByAccountMonth}
                    invoiceHrefByAccountMonth={invoiceByAccountMonth}
                    leftHeader="Account #"
                    middleHeader="Vendor / Description"
                    noteAnchor={{ property_id: property.id, year, notesByCell }}
                  
                  historicalDisclaimerYear={year}
                />
                </section>
              )}

              {accountsByGL["5140"].length > 0 && (
                <section>
                  <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.04em] text-nurock-navy mb-3">
                    Cable — GL 5140
                  </h2>
                  <PerAccountMonthlyGrid
                    accounts={accountsByGL["5140"]}
                    amountsByAccountMonth={amountsByAccountMonth}
                    invoiceHrefByAccountMonth={invoiceByAccountMonth}
                    leftHeader="Account #"
                    middleHeader="Vendor / Description"
                    noteAnchor={{ property_id: property.id, year, notesByCell }}
                  
                  historicalDisclaimerYear={year}
                />
                </section>
              )}

              <p className="text-[11px] text-nurock-slate-light">
                Each cell links to the underlying bill for that account × month.
                Historical rollups have invoice numbers starting with{" "}
                <span className="font-mono">HIST-PHONE-</span> or <span className="font-mono">HIST-CABLE-</span>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

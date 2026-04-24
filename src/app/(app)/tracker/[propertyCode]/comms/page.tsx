import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { formatDollars } from "@/lib/format";
import { PerAccountMonthlyGrid, type AccountRow } from "@/components/tracker/PerAccountMonthlyGrid";

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

  const year = searchParams.year ? parseInt(searchParams.year, 10) : new Date().getFullYear();

  const { data: acctRaw } = await supabase
    .from("utility_accounts")
    .select(`
      id, account_number, description,
      gl_accounts!inner ( code ),
      vendors ( name )
    `)
    .eq("property_id", property.id)
    .eq("active", true)
    .in("gl_accounts.code", ["5140", "5635"]);

  const accountsByGL: Record<string, AccountRow[]> = { "5635": [], "5140": [] };
  for (const a of (acctRaw ?? []) as any[]) {
    const gl = a.gl_accounts?.code as string;
    if (gl !== "5140" && gl !== "5635") continue;
    accountsByGL[gl].push({
      id:             a.id,
      account_number: a.account_number,
      description:    a.description,
      vendor_name:    a.vendors?.name ?? null,
    });
  }

  const allAccounts = [...accountsByGL["5635"], ...accountsByGL["5140"]];
  const accountIds = allAccounts.map(a => a.id);

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
        title={`${property.name} · Phone & Cable`}
        subtitle={`${property.full_code} · ${allAccounts.length} accounts · ${year} YTD ${formatDollars(totalYtd)}`}
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

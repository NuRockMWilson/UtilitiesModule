import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { formatDollars } from "@/lib/format";

/**
 * Combined Phone + Cable detail page. Both categories share the same layout
 * and the same rhythm (monthly, fairly stable, vendor-contractual), so it
 * reads better as one page with two stacked tables than as two near-identical
 * pages a click apart.
 *
 * GLs: 5635 (phone/telephone) and 5140 (cable TV)
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

  const { data: rowsRaw } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date,
      service_period_start, service_period_end,
      total_amount_due, status,
      vendors ( name ),
      gl_accounts!inner ( code, description )
    `)
    .eq("property_id", property.id)
    .in("gl_accounts.code", ["5635", "5140"])
    .order("invoice_date", { ascending: false });

  const all = (rowsRaw ?? []).map((r: any) => ({
    id:             r.id,
    invoice_number: r.invoice_number as string,
    invoice_date:   r.invoice_date   as string | null,
    service_start:  r.service_period_start as string | null,
    service_end:    r.service_period_end   as string | null,
    amount:         Number(r.total_amount_due ?? 0),
    status:         r.status as string,
    gl_code:        r.gl_accounts?.code as string,
    vendor_name:    r.vendors?.name ?? null,
  }));

  const years = Array.from(new Set(all.map(r =>
    r.invoice_date ? parseInt(r.invoice_date.substring(0, 4), 10) : null
  ).filter((y): y is number => y !== null))).sort((a, b) => b - a);

  const currentYear = all.filter(r => r.invoice_date?.startsWith(String(year)));
  const phone = currentYear.filter(r => r.gl_code === "5635");
  const cable = currentYear.filter(r => r.gl_code === "5140");

  const phoneTotal = phone.reduce((s, r) => s + r.amount, 0);
  const cableTotal = cable.reduce((s, r) => s + r.amount, 0);
  const totalYTD   = phoneTotal + cableTotal;

  // Monthly rollup per category
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyTotal = (rows: typeof all, monthIdx: number): number =>
    rows
      .filter(r => r.invoice_date?.substring(5, 7) === String(monthIdx + 1).padStart(2, "0"))
      .reduce((s, r) => s + r.amount, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title={`${property.name} · Phone & Cable`}
        subtitle={`${property.full_code} · ${year} YTD ${formatDollars(totalYTD)} (Phone ${formatDollars(phoneTotal)} · Cable ${formatDollars(cableTotal)})`}
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
                href={`/tracker/${property.code}/comms?year=${y}`}
                className={"px-2 py-1 rounded text-xs " + (y === year ? "bg-nurock-navy text-white" : "text-nurock-navy hover:bg-nurock-flag-navy-bg")}
              >
                {y}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-nurock-bg">
        <div className="px-8 py-6">
          {currentYear.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-nurock-navy font-medium mb-2">No phone or cable bills on file for {year}</div>
              <div className="text-sm text-nurock-slate">
                {all.length > 0 ? "Pick a different year above." : "Phone and cable bills will appear here as they flow through the extraction pipeline."}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <CategoryTable
                title="Phone (GL 5635)"
                rows={phone}
                total={phoneTotal}
                monthly={MONTHS.map((_, i) => monthlyTotal(phone, i))}
              />
              <CategoryTable
                title="Cable (GL 5140)"
                rows={cable}
                total={cableTotal}
                monthly={MONTHS.map((_, i) => monthlyTotal(cable, i))}
              />
            </div>
          )}

          <p className="text-xs text-nurock-slate-light mt-6">
            Historical phone/cable totals (invoice numbers starting{" "}
            <span className="font-mono">HIST-PHONE-</span> or{" "}
            <span className="font-mono">HIST-CABLE-</span>) are monthly rollups from
            the legacy Phone&amp;Cable sheet — they represent the summed line items
            (multiple accounts per vendor) that historically posted to these GLs.
            New phone/cable bills processed through extraction will appear as
            individual invoices with vendor-level detail.
          </p>
        </div>
      </div>
    </div>
  );
}

function CategoryTable({
  title, rows, total, monthly,
}: {
  title: string;
  rows:  Array<{ id: string; invoice_number: string; invoice_date: string | null;
                 service_start: string | null; service_end: string | null;
                 amount: number; vendor_name: string | null }>;
  total: number;
  monthly: number[];
}) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-nurock-black mb-2">{title}</h2>

      {/* Monthly strip */}
      <div className="card overflow-hidden mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-nurock-slate border-b border-nurock-border">
              {MONTHS.map(m => <th key={m} className="cell-head text-center">{m}</th>)}
              <th className="px-2 py-2 text-right font-medium bg-[#FAFBFC]">YTD</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {monthly.map((v, i) => (
                <td key={i} className="px-2 py-2 text-center tabular-nums">
                  {v > 0 ? formatDollars(v) : <span className="text-nurock-slate-light">—</span>}
                </td>
              ))}
              <td className="px-2 py-2 text-right tabular-nums font-medium bg-[#FAFBFC]">
                {formatDollars(total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Invoice list */}
      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFBFC] text-nurock-slate text-[10px] uppercase tracking-[0.08em] font-display font-semibold">
              <tr>
                <th className="cell-head">Invoice date</th>
                <th className="cell-head">Service period</th>
                <th className="cell-head">Vendor</th>
                <th className="cell-head text-right">Amount</th>
                <th className="cell-head">Invoice #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-nurock-bg">
                  <td className="cell num">{r.invoice_date ? formatDate(r.invoice_date) : "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-nurock-slate">
                    {r.service_start && r.service_end ? `${formatDate(r.service_start)} – ${formatDate(r.service_end)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-nurock-slate">{r.vendor_name ?? "—"}</td>
                  <td className="cell text-right num">{formatDollars(r.amount)}</td>
                  <td className="cell">
                    <Link href={`/invoices/${r.id}`} className="text-nurock-navy hover:underline font-mono">
                      {r.invoice_number}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

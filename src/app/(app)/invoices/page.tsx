import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { StatusPill } from "@/components/ui/StatusPill";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { InvoiceStatus } from "@/lib/types";

interface Props {
  searchParams: { status?: string; property?: string; flagged?: string; due?: string };
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "",                    label: "All active" },
  { value: "new",                 label: "New" },
  { value: "needs_coding",        label: "Needs coding" },
  { value: "needs_variance_note", label: "Variance note" },
  { value: "ready_for_approval",  label: "Ready for approval" },
  { value: "approved",            label: "Approved" },
  { value: "posted_to_sage",      label: "Posted" },
  { value: "paid",                label: "Paid" },
];

export default async function InvoicesPage({ searchParams }: Props) {
  const supabase = createSupabaseServerClient();

  let query = supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, due_date, total_amount_due,
      status, variance_flagged, variance_pct, gl_coding,
      property:properties(id, code, name),
      vendor:vendors(id, name),
      gl:gl_accounts(code, description)
    `)
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (searchParams.status) query = query.eq("status", searchParams.status as InvoiceStatus);
  if (searchParams.property) query = query.eq("property_id", searchParams.property);
  if (searchParams.flagged === "true") query = query.eq("variance_flagged", true);
  if (searchParams.due === "soon") {
    const threeDays = new Date();
    threeDays.setDate(threeDays.getDate() + 3);
    query = query.lte("due_date", threeDays.toISOString().slice(0, 10));
  }

  const { data, error } = await query;
  const rows = data ?? [];

  return (
    <>
      <TopBar title="Invoices" subtitle={`${rows.length} shown`} />

      <div className="px-8 py-4 border-b border-nurock-border bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map(f => {
            const active = (searchParams.status ?? "") === f.value;
            const href = f.value
              ? `/invoices?status=${f.value}`
              : "/invoices";
            return (
              <Link
                key={f.value}
                href={href}
                className={cn(
                  "badge border transition-colors",
                  active
                    ? "bg-nurock-navy text-white border-navy"
                    : "bg-white text-nurock-navy border-nurock-border hover:bg-[#FAFBFC]",
                )}
              >
                {f.label}
              </Link>
            );
          })}
          <Link
            href={searchParams.flagged === "true" ? "/invoices" : "/invoices?flagged=true"}
            className={cn(
              "badge border transition-colors ml-auto",
              searchParams.flagged === "true"
                ? "bg-flag-yellow text-white border-flag-yellow"
                : "bg-white text-nurock-navy border-nurock-border hover:bg-[#FAFBFC]",
            )}
          >
            {searchParams.flagged === "true" ? "Showing flagged only" : "Variance flagged"}
          </Link>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="card p-4 text-sm text-flag-red mb-4">
            Failed to load invoices: {error.message}
          </div>
        )}
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-nurock-border text-sm">
            <thead className="bg-[#FAFBFC]">
              <tr className="text-left text-xs uppercase tracking-wide text-nurock-slate">
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Service period</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Variance</th>
                <th className="px-4 py-3 font-medium">GL coding</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-nurock-slate">
                    No invoices match the current filter.
                  </td>
                </tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-[#FAFBFC]">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${r.id}`} className="font-medium text-nurock-black hover:underline">
                      {r.property?.code ?? "—"}
                    </Link>
                    <div className="text-xs text-nurock-slate truncate max-w-[160px]">
                      {r.property?.name ?? ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.vendor?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.invoice_number ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {formatDate(r.invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatDollars(r.total_amount_due)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.variance_pct !== null ? (
                      <span className={cn(
                        r.variance_flagged ? "text-flag-red font-medium" : "text-nurock-slate",
                      )}>
                        {formatPercent(r.variance_pct, { sign: true })}
                      </span>
                    ) : (
                      <span className="text-nurock-slate-light">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-nurock-slate">{r.gl_coding ?? "—"}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status as InvoiceStatus} /></td>
                  <td className="px-4 py-3 text-right text-xs">{formatDate(r.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

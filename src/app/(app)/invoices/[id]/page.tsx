import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { StatusPill, VarianceFlag } from "@/components/ui/StatusPill";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatDate, formatPercent, formatNumber, formatGallons, formatDays } from "@/lib/format";
import { varianceFlag } from "@/lib/variance";
import type { InvoiceStatus } from "@/lib/types";
import { ApprovalPanel } from "@/components/invoices/ApprovalPanel";
import { VarianceExplanationForm } from "@/components/invoices/VarianceExplanationForm";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select(`
      *,
      property:properties(id, code, name, state),
      vendor:vendors(id, name, contact_email, contact_phone),
      gl:gl_accounts(code, description),
      utility_account:utility_accounts(id, account_number, baseline_window_months, variance_threshold_pct)
    `)
    .eq("id", params.id)
    .single();

  if (!invoice) notFound();

  const { data: usageReadings } = await supabase
    .from("usage_readings")
    .select("*")
    .eq("invoice_id", params.id);

  const { data: logEntries } = await supabase
    .from("approval_log")
    .select("*")
    .eq("invoice_id", params.id)
    .order("created_at", { ascending: false });

  const { data: inquiries } = await supabase
    .from("variance_inquiries")
    .select("*")
    .eq("invoice_id", params.id)
    .order("sent_at", { ascending: false });

  const threshold = (invoice.utility_account as any)?.variance_threshold_pct ?? 3;
  const flag = varianceFlag(
    {
      baseline: invoice.variance_baseline,
      baselineSampleSize: 0,
      currentValue: 0,
      variancePct: invoice.variance_pct,
      flagged: invoice.variance_flagged,
      basis: invoice.variance_baseline === null ? "insufficient_history" : "daily_usage",
    },
    Number(threshold),
  );

  const pdfUrl = invoice.pdf_path
    ? (await supabase.storage.from("invoices").createSignedUrl(invoice.pdf_path, 3600)).data?.signedUrl
    : null;

  return (
    <>
      <TopBar
        title={`Invoice ${invoice.invoice_number ?? "—"}`}
        subtitle={`${(invoice.property as any)?.name ?? "Unknown property"} · ${(invoice.vendor as any)?.name ?? "Unknown vendor"}`}
      />

      <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: PDF viewer */}
        <div className="space-y-4">
          <div className="card p-0 overflow-hidden aspect-[8.5/11] bg-navy-50">
            {pdfUrl ? (
              <iframe src={pdfUrl} className="w-full h-full" title="Bill PDF" />
            ) : (
              <div className="flex items-center justify-center h-full text-tan-700 text-sm">
                No PDF attached to this invoice.
              </div>
            )}
          </div>
          {invoice.extraction_warnings && invoice.extraction_warnings.length > 0 && (
            <div className="card p-4 border-l-4 border-l-flag-yellow">
              <div className="text-xs uppercase tracking-wide text-tan-700 mb-2">
                Extraction warnings
              </div>
              <ul className="list-disc list-inside text-sm text-ink space-y-1">
                {invoice.extraction_warnings.map((w: string, i: number) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="text-xs text-tan-700 mt-3">
                Confidence: {formatPercent((invoice.extraction_confidence ?? 0) * 100, { decimals: 0 })}
              </div>
            </div>
          )}
        </div>

        {/* Right: fields, variance, approval */}
        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold text-navy-800">Bill details</h3>
              <StatusPill status={invoice.status as InvoiceStatus} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Vendor"          value={(invoice.vendor as any)?.name} />
              <Field label="Account #"       value={(invoice.utility_account as any)?.account_number} mono />
              <Field label="Invoice #"       value={invoice.invoice_number} mono />
              <Field label="Invoice date"    value={formatDate(invoice.invoice_date)} />
              <Field label="Service period"  value={
                invoice.service_period_start && invoice.service_period_end
                  ? `${formatDate(invoice.service_period_start)} – ${formatDate(invoice.service_period_end)}`
                  : "—"
              } />
              <Field label="Service days"    value={formatDays(invoice.service_days)} />
              <Field label="Current charges" value={formatDollars(invoice.current_charges)} />
              <Field label="Adjustments"     value={formatDollars(invoice.adjustments)} />
              <Field label="Late fees"       value={formatDollars(invoice.late_fees)} />
              <Field label="Total due"       value={formatDollars(invoice.total_amount_due)} emphasis />
              <Field label="Due date"        value={formatDate(invoice.due_date)} />
              <Field label="GL coding"       value={invoice.gl_coding} mono emphasis />
            </dl>
          </div>

          {usageReadings && usageReadings.length > 0 && (
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold text-navy-800 mb-3">Usage readings</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-tan-700">
                    <th className="font-medium pb-2">Type</th>
                    <th className="font-medium pb-2 text-right">Usage</th>
                    <th className="font-medium pb-2 text-right">Days</th>
                    <th className="font-medium pb-2 text-right">Daily</th>
                    <th className="font-medium pb-2 text-right">vs Baseline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {usageReadings.map((u: any) => (
                    <tr key={u.id}>
                      <td className="py-2 capitalize">{u.reading_type}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(u.usage_amount, 0)} {u.usage_unit}</td>
                      <td className="py-2 text-right tabular-nums">{u.days}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(u.daily_usage, 2)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {u.variance_pct !== null
                          ? <span className={u.variance_flagged ? "text-flag-red font-medium" : ""}>
                              {formatPercent(u.variance_pct, { sign: true })}
                            </span>
                          : <span className="text-tan-500">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-base font-semibold text-navy-800">Variance analysis</h3>
              <VarianceFlag flag={flag} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-tan-700">Threshold</div>
                <div className="text-navy-800 font-medium mt-1">{formatPercent(Number(threshold))}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-tan-700">Baseline</div>
                <div className="text-navy-800 font-medium mt-1">
                  {invoice.variance_baseline !== null
                    ? formatNumber(Number(invoice.variance_baseline), 2)
                    : "Insufficient history"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-tan-700">Variance</div>
                <div className={`font-medium mt-1 ${invoice.variance_flagged ? "text-flag-red" : "text-navy-800"}`}>
                  {invoice.variance_pct !== null
                    ? formatPercent(Number(invoice.variance_pct), { sign: true })
                    : "—"}
                </div>
              </div>
            </div>

            {invoice.variance_flagged && (
              <div className="mt-5 pt-5 border-t border-navy-100">
                <VarianceExplanationForm
                  invoiceId={invoice.id}
                  currentExplanation={invoice.variance_explanation}
                  propertyId={(invoice.property as any)?.id}
                />
              </div>
            )}
          </div>

          <ApprovalPanel
            invoiceId={invoice.id}
            status={invoice.status as InvoiceStatus}
            varianceFlagged={invoice.variance_flagged}
            hasExplanation={!!invoice.variance_explanation}
            sageBatchId={(invoice as any).sage_batch_uuid}
            sageSystem={invoice.sage_system}
          />

          {/* Audit trail */}
          <div className="card p-5">
            <h3 className="font-display text-base font-semibold text-navy-800 mb-3">Audit trail</h3>
            <ol className="space-y-2 text-sm">
              {(logEntries ?? []).map((e: any) => (
                <li key={e.id} className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-navy mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-ink">
                      <span className="font-medium">{e.action}</span>
                      {e.new_status && e.new_status !== e.previous_status && (
                        <span className="text-tan-700"> → {e.new_status}</span>
                      )}
                    </div>
                    <div className="text-xs text-tan-700">
                      {formatDate(e.created_at)} · {e.actor_email ?? "system"}
                    </div>
                    {e.notes && <div className="text-xs text-tan-800 mt-0.5">{e.notes}</div>}
                  </div>
                </li>
              ))}
              {(logEntries ?? []).length === 0 && (
                <li className="text-tan-700 text-sm">No activity yet.</li>
              )}
            </ol>
          </div>

          {inquiries && inquiries.length > 0 && (
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold text-navy-800 mb-3">
                Variance inquiries
              </h3>
              <ul className="space-y-3">
                {inquiries.map((q: any) => (
                  <li key={q.id} className="border-l-2 border-tan-300 pl-3 text-sm">
                    <div className="text-xs text-tan-700">
                      To {q.recipient_email} · sent {formatDate(q.sent_at)}
                    </div>
                    <div className="mt-1 text-ink">{q.subject}</div>
                    {q.response_body && (
                      <div className="mt-2 bg-navy-50 rounded p-2 text-sm">
                        <div className="text-xs text-tan-700 mb-1">
                          Response · {formatDate(q.response_received_at)}
                        </div>
                        {q.response_body}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="px-8 pb-8">
        <Link href="/invoices" className="text-sm text-navy-600 hover:underline">
          ← Back to invoices
        </Link>
      </div>
    </>
  );
}

function Field({
  label, value, mono, emphasis,
}: { label: string; value: string | null | undefined; mono?: boolean; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-tan-700">{label}</dt>
      <dd className={`mt-0.5 ${emphasis ? "font-semibold text-navy-800" : "text-ink"} ${mono ? "font-mono text-sm" : ""}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

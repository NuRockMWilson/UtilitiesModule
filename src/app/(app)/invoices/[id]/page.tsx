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
        title={`Invoice ${invoice.invoice_number ?? (invoice.raw_extraction as any)?.invoice_number ?? "—"}`}
        subtitle={`${(invoice.property as any)?.name ?? "Unknown property"} · ${(invoice.vendor as any)?.name ?? (invoice.raw_extraction as any)?.vendor_name ?? "Unknown vendor"}`}
      />

      <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: PDF viewer */}
        <div className="space-y-4">
          <div className="card p-0 overflow-hidden aspect-[8.5/11] bg-[#FAFBFC]">
            {pdfUrl ? (
              <iframe src={pdfUrl} className="w-full h-full" title="Bill PDF" />
            ) : (
              <div className="flex items-center justify-center h-full text-nurock-slate text-sm">
                No PDF attached to this invoice.
              </div>
            )}
          </div>
          {invoice.extraction_warnings && invoice.extraction_warnings.length > 0 && (
            <div className="card p-4 border-l-4 border-l-flag-yellow">
              <div className="text-xs uppercase tracking-wide text-nurock-slate mb-2">
                Extraction warnings
              </div>
              <ul className="list-disc list-inside text-sm text-ink space-y-1">
                {invoice.extraction_warnings.map((w: string, i: number) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="text-xs text-nurock-slate mt-3">
                Confidence: {formatPercent((invoice.extraction_confidence ?? 0) * 100, { decimals: 0 })}
              </div>
            </div>
          )}

          {/*
            Raw extraction JSON — collapsed by default. Surfacing this on every
            invoice page (rather than hiding it in Supabase) is essential when
            debugging extraction quality issues: you can see exactly what the
            LLM returned vs. what got persisted to the row.
          */}
          {invoice.raw_extraction && (
            <details className="card p-4">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-nurock-slate select-none">
                Raw extraction (Claude output)
              </summary>
              <pre className="mt-3 bg-[#FAFBFC] border border-nurock-border rounded-md p-3 text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-[400px]">
                {JSON.stringify(invoice.raw_extraction, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Right: fields, variance, approval */}
        <div className="space-y-6">
          {/*
            Render bill details. When auto-linking to a utility_account fails,
            invoice.vendor and invoice.utility_account joins return empty —
            but the LLM-extracted vendor name and account number are still in
            raw_extraction. Fall back to those so the page actually shows
            what was extracted, with an "(unlinked)" hint to make it clear
            the bill still needs to be attached to an account.
          */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold text-nurock-black">Bill details</h3>
              <StatusPill status={invoice.status as InvoiceStatus} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field
                label="Vendor"
                value={
                  (invoice.vendor as any)?.name
                  ?? (invoice.raw_extraction as any)?.vendor_name
                }
                hint={
                  !(invoice.vendor as any)?.name && (invoice.raw_extraction as any)?.vendor_name
                    ? "extracted; not yet linked to a vendor record"
                    : undefined
                }
              />
              <Field
                label="Account #"
                value={
                  (invoice.utility_account as any)?.account_number
                  ?? (invoice.raw_extraction as any)?.account_number
                }
                mono
                hint={
                  !(invoice.utility_account as any)?.account_number && (invoice.raw_extraction as any)?.account_number
                    ? "extracted; not yet linked to a utility account"
                    : undefined
                }
              />
              <Field label="Invoice #"       value={invoice.invoice_number ?? (invoice.raw_extraction as any)?.invoice_number} mono />
              <Field label="Invoice date"    value={formatDate(invoice.invoice_date ?? (invoice.raw_extraction as any)?.invoice_date)} />
              <Field label="Service period"  value={
                invoice.service_period_start && invoice.service_period_end
                  ? `${formatDate(invoice.service_period_start)} – ${formatDate(invoice.service_period_end)}`
                  : (invoice.raw_extraction as any)?.service_period_start && (invoice.raw_extraction as any)?.service_period_end
                    ? `${formatDate((invoice.raw_extraction as any).service_period_start)} – ${formatDate((invoice.raw_extraction as any).service_period_end)}`
                    : "—"
              } />
              <Field label="Service days"    value={formatDays(invoice.service_days ?? (invoice.raw_extraction as any)?.service_days)} />
              <Field label="Current charges" value={formatDollars(invoice.current_charges)} />
              <Field label="Adjustments"     value={formatDollars(invoice.adjustments)} />
              <Field label="Late fees"       value={formatDollars(invoice.late_fees)} />
              <Field label="Total due"       value={formatDollars(invoice.total_amount_due)} emphasis />
              <Field label="Due date"        value={formatDate(invoice.due_date ?? (invoice.raw_extraction as any)?.due_date)} />
              <Field label="GL coding"       value={invoice.gl_coding} mono emphasis />
            </dl>
          </div>

          {usageReadings && usageReadings.length > 0 && (
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold text-nurock-black mb-3">Usage readings</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-nurock-slate">
                    <th className="font-medium pb-2">Type</th>
                    <th className="font-medium pb-2 text-right">Usage</th>
                    <th className="font-medium pb-2 text-right">Days</th>
                    <th className="font-medium pb-2 text-right">Daily</th>
                    <th className="font-medium pb-2 text-right">vs Baseline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nurock-border">
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
                          : <span className="text-nurock-slate-light">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-base font-semibold text-nurock-black">Variance analysis</h3>
              <VarianceFlag flag={flag} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-nurock-slate">Threshold</div>
                <div className="text-nurock-black font-medium mt-1">{formatPercent(Number(threshold))}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-nurock-slate">Baseline</div>
                <div className="text-nurock-black font-medium mt-1">
                  {invoice.variance_baseline !== null
                    ? formatNumber(Number(invoice.variance_baseline), 2)
                    : "Insufficient history"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-nurock-slate">Variance</div>
                <div className={`font-medium mt-1 ${invoice.variance_flagged ? "text-flag-red" : "text-nurock-black"}`}>
                  {invoice.variance_pct !== null
                    ? formatPercent(Number(invoice.variance_pct), { sign: true })
                    : "—"}
                </div>
              </div>
            </div>

            {invoice.variance_flagged && (
              <div className="mt-5 pt-5 border-t border-nurock-border">
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
            <h3 className="font-display text-base font-semibold text-nurock-black mb-3">Audit trail</h3>
            <ol className="space-y-2 text-sm">
              {(logEntries ?? []).map((e: any) => (
                <li key={e.id} className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-navy mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-ink">
                      <span className="font-medium">{e.action}</span>
                      {e.new_status && e.new_status !== e.previous_status && (
                        <span className="text-nurock-slate"> → {e.new_status}</span>
                      )}
                    </div>
                    <div className="text-xs text-nurock-slate">
                      {formatDate(e.created_at)} · {e.actor_email ?? "system"}
                    </div>
                    {e.notes && <div className="text-xs text-nurock-slate mt-0.5">{e.notes}</div>}
                  </div>
                </li>
              ))}
              {(logEntries ?? []).length === 0 && (
                <li className="text-nurock-slate text-sm">No activity yet.</li>
              )}
            </ol>
          </div>

          {inquiries && inquiries.length > 0 && (
            <div className="card p-5">
              <h3 className="font-display text-base font-semibold text-nurock-black mb-3">
                Variance inquiries
              </h3>
              <ul className="space-y-3">
                {inquiries.map((q: any) => (
                  <li key={q.id} className="border-l-2 border-tan-300 pl-3 text-sm">
                    <div className="text-xs text-nurock-slate">
                      To {q.recipient_email} · sent {formatDate(q.sent_at)}
                    </div>
                    <div className="mt-1 text-ink">{q.subject}</div>
                    {q.response_body && (
                      <div className="mt-2 bg-[#FAFBFC] rounded p-2 text-sm">
                        <div className="text-xs text-nurock-slate mb-1">
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
        <Link href="/invoices" className="text-sm text-nurock-navy hover:underline">
          ← Back to invoices
        </Link>
      </div>
    </>
  );
}

function Field({
  label, value, hint, mono, emphasis,
}: { label: string; value: string | null | undefined; hint?: string; mono?: boolean; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-nurock-slate">{label}</dt>
      <dd className={`mt-0.5 ${emphasis ? "font-semibold text-nurock-black" : "text-ink"} ${mono ? "font-mono text-sm" : ""}`}>
        {value ?? "—"}
      </dd>
      {hint && (
        <div className="text-[10.5px] text-flag-amber italic mt-0.5">{hint}</div>
      )}
    </div>
  );
}

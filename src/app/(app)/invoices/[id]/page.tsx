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
import { LinkInvoicePanel } from "@/components/invoices/LinkInvoicePanel";
import { DeleteInvoiceButton } from "@/components/invoices/DeleteInvoiceButton";
import { EditableBillDetails, type EditableInvoice } from "@/components/invoices/EditableBillDetails";
import { DistributionsPanel, type DistributionLine } from "@/components/invoices/DistributionsPanel";
import { AttachPdfButton } from "@/components/invoices/AttachPdfButton";

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

  // Distribution lines + the active GL list for the editor combobox.
  const [{ data: lineRows }, { data: glAccountsForEditor }] = await Promise.all([
    supabase.from("invoice_line_items")
      .select(`
        id, gl_account_id, sub_code, description, amount,
        gl:gl_accounts(code, description)
      `)
      .eq("invoice_id", params.id)
      .order("amount", { ascending: false }),
    supabase.from("gl_accounts")
      .select("id, code, description")
      .eq("active", true)
      .order("code"),
  ]);
  const distributionLines: DistributionLine[] = (lineRows ?? []).map((l: any) => ({
    id:             l.id,
    gl_account_id:  l.gl_account_id,
    sub_code:       l.sub_code ?? "00",
    description:    l.description ?? "",
    amount:         Number(l.amount),
    gl_code:        l.gl?.code ?? null,
    gl_description: l.gl?.description ?? null,
  }));

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

  // When the invoice is unlinked (extraction succeeded but no utility_account
  // matched), load the dropdown data needed by LinkInvoicePanel. We only do
  // this query when the panel will actually render to avoid the cost on
  // already-linked invoices.
  const needsLinking = !invoice.utility_account_id;
  let linkData: {
    properties: any[]; vendors: any[]; glAccounts: any[]; utilityAccounts: any[];
  } | null = null;
  if (needsLinking) {
    const [{ data: properties }, { data: vendors }, { data: glAccounts }, { data: uaRaw }] = await Promise.all([
      supabase.from("properties").select("id, code, name, full_code").eq("active", true).order("code"),
      supabase.from("vendors").select("id, name").eq("active", true).order("name"),
      supabase.from("gl_accounts").select("id, code, description").eq("active", true).order("code"),
      supabase.from("utility_accounts")
        .select(`
          id, account_number, property_id,
          property:properties(code, name),
          vendor:vendors(name),
          gl:gl_accounts(code)
        `)
        .eq("active", true)
        .order("account_number")
        .limit(2000),
    ]);
    linkData = {
      properties: properties ?? [],
      vendors:    vendors    ?? [],
      glAccounts: glAccounts ?? [],
      utilityAccounts: (uaRaw ?? []).map((a: any) => ({
        id:             a.id,
        account_number: a.account_number,
        property_id:    a.property_id,
        property_code:  a.property?.code ?? "",
        property_name:  a.property?.name ?? "",
        vendor_name:    a.vendor?.name ?? "",
        gl_code:        a.gl?.code ?? "",
      })),
    };
  }

  return (
    <>
      <TopBar
        title={`Invoice ${invoice.invoice_number ?? (invoice.raw_extraction as any)?.invoice_number ?? "—"}`}
        subtitle={`${(invoice.property as any)?.name ?? "Unknown property"} · ${(invoice.vendor as any)?.name ?? (invoice.raw_extraction as any)?.vendor_name ?? "Unknown vendor"}`}
      />

      <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: PDF viewer */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-nurock-slate font-medium">
              {invoice.pdf_path ? "Bill PDF" : "No PDF attached"}
            </div>
            <AttachPdfButton invoiceId={invoice.id} hasExistingPdf={!!invoice.pdf_path} />
          </div>
          <div className="card p-0 overflow-hidden aspect-[8.5/11] bg-[#FAFBFC]">
            {pdfUrl ? (
              <iframe src={pdfUrl} className="w-full h-full" title="Bill PDF" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-nurock-slate text-sm gap-2 px-8 text-center">
                <div>No PDF attached to this invoice.</div>
                {typeof invoice.source_reference === "string" && invoice.source_reference.startsWith("historical-") && (
                  <div className="text-[12px] text-nurock-slate-light max-w-md">
                    This invoice was loaded from the legacy spreadsheet by migration 0015.
                    You can attach the original PDF here for paper-trail purposes — the
                    recorded amount won't be overwritten.
                  </div>
                )}
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
            Multi-account / multi-service banner. When the extraction
            detector flags this bill as covering multiple properties or
            mixing services on different GLs, surface it prominently above
            the bill detail editor so the reviewer can't miss it. The
            warnings themselves still appear in the regular extraction
            warnings card on the left, but the banner gives one-glance
            visibility on the right where the action buttons are.
          */}
          {(() => {
            const warnings = invoice.extraction_warnings ?? [];
            const multiAccountWarning = warnings.find((w: string) =>
              w.startsWith("[Suspected multi-property")
              || w.startsWith("[Suspected multi-service")
              || w.startsWith("[Bill structure unclear]")
            );
            if (!multiAccountWarning) return null;

            const isMultiProperty = multiAccountWarning.startsWith("[Suspected multi-property");
            const headerText = isMultiProperty
              ? "Possible multi-property bill"
              : multiAccountWarning.startsWith("[Suspected multi-service")
                ? "Possible multi-service bill"
                : "Bill structure needs verification";
            return (
              <div className="card p-4 border-l-4 border-l-amber-500 bg-amber-50">
                <div className="text-xs uppercase tracking-wide text-amber-800 font-semibold mb-1">
                  ⚠ {headerText}
                </div>
                <p className="text-sm text-amber-900 leading-relaxed">
                  {multiAccountWarning.replace(/^\[[^\]]+\]\s*/, "")}
                </p>
                {isMultiProperty && (
                  <p className="text-xs text-amber-800 mt-2">
                    Do not approve this bill as-is if it covers multiple properties — the dollars
                    will post to the wrong GL accounts. Either split the bill manually before
                    posting, or reject it back to AP.
                  </p>
                )}
              </div>
            );
          })()}

          {/*
            Bill details — editable when the invoice is in any pre-approval
            state. Falls back to raw extraction values when FK joins are
            empty so the page reflects what was extracted even before
            linking succeeds. Edits are recorded in approval_log.
          */}
          <EditableBillDetails
            invoice={{
              id:                     invoice.id,
              status:                 invoice.status as InvoiceStatus,
              invoice_number:         invoice.invoice_number,
              invoice_date:           invoice.invoice_date,
              due_date:               invoice.due_date,
              service_period_start:   invoice.service_period_start,
              service_period_end:     invoice.service_period_end,
              service_days:           invoice.service_days,
              current_charges:        invoice.current_charges,
              adjustments:            invoice.adjustments,
              late_fees:              invoice.late_fees,
              total_amount_due:       invoice.total_amount_due,
              gl_coding:              invoice.gl_coding,
              raw_extraction:         invoice.raw_extraction,
              vendor_name:            (invoice.vendor as any)?.name ?? null,
              utility_account_number: (invoice.utility_account as any)?.account_number ?? null,
              utility_account_id:     invoice.utility_account_id ?? null,
              fields_edited:          (logEntries ?? []).some((e: any) => e.action === "fields_edited" || e.action === "fields_edited_historical"),
              is_historical:          typeof invoice.source_reference === "string" && invoice.source_reference.startsWith("historical-"),
            } satisfies EditableInvoice}
          />

          <DistributionsPanel
            invoiceId={invoice.id}
            invoiceTotal={invoice.total_amount_due}
            initial={distributionLines}
            glAccounts={(glAccountsForEditor ?? []) as Array<{ id: string; code: string; description: string }>}
            canEdit={
              [
                "new", "extracting", "extraction_failed",
                "needs_coding", "needs_variance_note",
                "ready_for_approval", "rejected",
              ].includes(invoice.status as string) ||
              (typeof invoice.source_reference === "string" && invoice.source_reference.startsWith("historical-"))
            }
          />

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

          {needsLinking && linkData && (
            <LinkInvoicePanel
              invoiceId={invoice.id}
              extractedVendorName={(invoice.raw_extraction as any)?.vendor_name ?? null}
              extractedAccountNumber={(invoice.raw_extraction as any)?.account_number ?? null}
              properties={linkData.properties}
              vendors={linkData.vendors}
              glAccounts={linkData.glAccounts}
              utilityAccounts={linkData.utilityAccounts}
            />
          )}

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

      <div className="px-8 pb-8 flex items-center justify-between gap-4">
        <Link href="/invoices" className="text-sm text-nurock-navy hover:underline">
          ← Back to invoices
        </Link>
        <DeleteInvoiceButton invoiceId={invoice.id} />
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

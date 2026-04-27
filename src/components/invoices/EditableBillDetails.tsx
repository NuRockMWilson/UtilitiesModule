"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editInvoiceFields } from "@/app/(app)/invoices/[id]/edit-actions";
import { formatDollars, formatDate, formatDays } from "@/lib/format";
import { StatusPill } from "@/components/ui/StatusPill";
import type { InvoiceStatus } from "@/lib/types";

/**
 * Bill details panel — toggles between read-only and editable.
 *
 * Read-only mode mirrors the original Field-list rendering and includes
 * fallbacks to raw extraction values when the FK joins are empty.
 *
 * Editable mode renders the same fields as inputs. On save, only fields
 * that changed are sent to the server action; the action records a diff
 * in approval_log. After save, the page refreshes and a small "edited"
 * indicator appears next to the panel title so reviewers know the values
 * have been touched by hand.
 */
export type EditableInvoice = {
  id: string;
  status: InvoiceStatus;
  invoice_number:        string | null;
  invoice_date:          string | null;
  due_date:              string | null;
  service_period_start:  string | null;
  service_period_end:    string | null;
  service_days:          number | null;
  current_charges:       number | null;
  adjustments:           number | null;
  late_fees:             number | null;
  total_amount_due:      number | null;
  gl_coding:             string | null;
  raw_extraction:        any;
  vendor_name:           string | null;          // from joined vendors
  utility_account_number: string | null;         // from joined utility_accounts
  fields_edited:         boolean;
};

const EDITABLE_STATUSES = new Set<InvoiceStatus>([
  "new", "extracting", "extraction_failed",
  "needs_coding", "needs_variance_note",
  "ready_for_approval", "rejected",
]);

export function EditableBillDetails({ invoice }: { invoice: EditableInvoice }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = EDITABLE_STATUSES.has(invoice.status);
  const raw     = invoice.raw_extraction ?? {};

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("invoice_id", invoice.id);
    startTransition(async () => {
      const r = await editInvoiceFields(fd);
      if (!r.ok) {
        setError(r.error ?? "Save failed");
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-display text-base font-semibold text-nurock-black">Bill details</h3>
          {invoice.fields_edited && (
            <span
              title="One or more fields were edited by hand after extraction"
              className="text-[10px] uppercase tracking-wide bg-flag-amber/15 text-flag-amber-dark border border-flag-amber/40 px-1.5 py-0.5 rounded"
            >
              edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!editing && canEdit && (
            <button
              type="button"
              onClick={() => { setEditing(true); setError(null); }}
              className="text-[12px] text-nurock-navy hover:underline"
            >
              Edit fields
            </button>
          )}
          <StatusPill status={invoice.status} />
        </div>
      </div>

      {!editing ? (
        <ReadOnlyView invoice={invoice} />
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <EditField
              label="Vendor"
              value={invoice.vendor_name ?? raw.vendor_name ?? ""}
              hint={!invoice.vendor_name ? "Edit vendor by linking the bill to a vendor record above. Read-only here." : "Linked vendor — change via the linking panel."}
              readOnly
            />
            <EditField
              label="Account #"
              value={invoice.utility_account_number ?? raw.account_number ?? ""}
              hint="Account # comes from the linked utility account. Read-only here."
              readOnly
              mono
            />
            <EditField name="invoice_number"      label="Invoice #"        value={invoice.invoice_number ?? ""} mono />
            <EditField name="invoice_date"        label="Invoice date"     value={invoice.invoice_date ?? ""}   mono placeholder="YYYY-MM-DD" />
            <EditField name="service_period_start" label="Service start"   value={invoice.service_period_start ?? ""} mono placeholder="YYYY-MM-DD" />
            <EditField name="service_period_end"   label="Service end"     value={invoice.service_period_end ?? ""}   mono placeholder="YYYY-MM-DD" />
            <EditField name="service_days"        label="Service days"     value={invoice.service_days?.toString() ?? ""} mono />
            <EditField name="current_charges"     label="Current charges"  value={invoice.current_charges?.toString() ?? ""} mono />
            <EditField name="adjustments"         label="Adjustments"      value={invoice.adjustments?.toString() ?? "0"}    mono />
            <EditField name="late_fees"           label="Late fees"        value={invoice.late_fees?.toString() ?? "0"}      mono />
            <EditField name="total_amount_due"    label="Total due"        value={invoice.total_amount_due?.toString() ?? ""} mono emphasis />
            <EditField name="due_date"            label="Due date"         value={invoice.due_date ?? ""}        mono placeholder="YYYY-MM-DD" />
            <div className="md:col-span-2">
              <EditField name="gl_coding"         label="GL coding"        value={invoice.gl_coding ?? ""}       mono emphasis placeholder="500-PROP-GLCODE.SUB" />
            </div>
          </div>

          {error && (
            <div className="text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-nurock-border">
            <button type="submit" disabled={pending} className="btn-primary text-[13px]">
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setError(null); }}
              disabled={pending}
              className="text-[12.5px] text-nurock-slate hover:text-nurock-black"
            >
              Cancel
            </button>
            <span className="text-[11.5px] text-nurock-slate-light ml-auto">
              Changes are recorded in the audit trail. Variance recomputes automatically when totals or service days change.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}

function ReadOnlyView({ invoice }: { invoice: EditableInvoice }) {
  const raw = invoice.raw_extraction ?? {};
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <Field
        label="Vendor"
        value={invoice.vendor_name ?? raw.vendor_name}
        hint={
          !invoice.vendor_name && raw.vendor_name
            ? "extracted; not yet linked to a vendor record"
            : undefined
        }
      />
      <Field
        label="Account #"
        value={invoice.utility_account_number ?? raw.account_number}
        mono
        hint={
          !invoice.utility_account_number && raw.account_number
            ? "extracted; not yet linked to a utility account"
            : undefined
        }
      />
      <Field label="Invoice #"       value={invoice.invoice_number ?? raw.invoice_number} mono />
      <Field label="Invoice date"    value={formatDate(invoice.invoice_date ?? raw.invoice_date)} />
      <Field label="Service period"  value={
        invoice.service_period_start && invoice.service_period_end
          ? `${formatDate(invoice.service_period_start)} – ${formatDate(invoice.service_period_end)}`
          : raw.service_period_start && raw.service_period_end
            ? `${formatDate(raw.service_period_start)} – ${formatDate(raw.service_period_end)}`
            : "—"
      } />
      <Field label="Service days"    value={formatDays(invoice.service_days ?? raw.service_days)} />
      <Field label="Current charges" value={formatDollars(invoice.current_charges)} />
      <Field label="Adjustments"     value={formatDollars(invoice.adjustments)} />
      <Field label="Late fees"       value={formatDollars(invoice.late_fees)} />
      <Field label="Total due"       value={formatDollars(invoice.total_amount_due)} emphasis />
      <Field label="Due date"        value={formatDate(invoice.due_date ?? raw.due_date)} />
      <Field label="GL coding"       value={invoice.gl_coding} mono emphasis />
    </dl>
  );
}

function Field({
  label, value, hint, mono, emphasis,
}: {
  label: string;
  value: string | null | undefined;
  hint?: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
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

function EditField({
  label, value, name, mono, emphasis, readOnly, hint, placeholder,
}: {
  label:        string;
  value:        string;
  name?:        string;
  mono?:        boolean;
  emphasis?:    boolean;
  readOnly?:    boolean;
  hint?:        string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10.5px] uppercase tracking-wide text-nurock-slate mb-0.5">
        {label}
      </label>
      <input
        type="text"
        name={name}
        defaultValue={value}
        readOnly={readOnly || !name}
        placeholder={placeholder}
        className={`input w-full ${mono ? "font-mono text-[13px]" : "text-[13px]"} ${emphasis ? "font-semibold" : ""} ${readOnly || !name ? "bg-[#FAFBFC] text-nurock-slate" : ""}`}
      />
      {hint && (
        <div className="text-[10.5px] text-nurock-slate-light italic mt-0.5">{hint}</div>
      )}
    </div>
  );
}

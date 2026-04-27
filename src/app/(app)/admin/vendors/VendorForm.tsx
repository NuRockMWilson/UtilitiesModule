"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { saveVendor, type VendorFormState } from "./actions";

const CATEGORY_OPTIONS = [
  { value: "water",         label: "Water" },
  { value: "sewer",         label: "Sewer" },
  { value: "storm_water",   label: "Storm Water" },
  { value: "environmental", label: "Environmental" },
  { value: "irrigation",    label: "Irrigation" },
  { value: "electric",      label: "Electric" },
  { value: "gas",           label: "Gas" },
  { value: "trash",         label: "Trash" },
  { value: "cable",         label: "Cable" },
  { value: "phone",         label: "Phone" },
  { value: "fedex",         label: "FedEx / Parcel" },
  { value: "other",         label: "Other" },
];

export type VendorFormValues = {
  id?:               string;
  name?:             string;
  short_name?:       string | null;
  category?:         string;
  sage_vendor_id?:   string | null;
  contact_email?:    string | null;
  contact_phone?:    string | null;
  remit_address?:    string | null;
  active?:           boolean;
};

export function VendorForm({ initial }: { initial?: VendorFormValues }) {
  const [state, formAction] = useFormState<VendorFormState | null, FormData>(
    saveVendor as any,
    null,
  );
  const isEdit = Boolean(initial?.id);
  const hasDuplicates = !!state?.duplicateMatches && state.duplicateMatches.length > 0;

  return (
    <form action={formAction} className="card p-6 max-w-2xl space-y-5">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      {/* Sticky override flag — present in DOM only when the user has been
          shown the duplicate dialog and clicks "Create anyway". The hidden
          input is rendered only inside that block so it doesn't trigger
          on first submit. */}

      <Field label="Name" required hint="Full vendor name as it appears on bills.">
        <input name="name" defaultValue={initial?.name ?? ""} required maxLength={200}
               className="input" placeholder="Town of Davie - Utilities" />
      </Field>

      <Field label="Short name / code" hint="Short identifier; e.g. 'Town-D'. Optional.">
        <input name="short_name" defaultValue={initial?.short_name ?? ""} maxLength={40}
               className="input" />
      </Field>

      <Field label="Category" required>
        <select name="category" defaultValue={initial?.category ?? "other"} className="input">
          {CATEGORY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Sage vendor ID"
        hint="Required for Sage AP Import. Leave blank if not yet assigned."
      >
        <input name="sage_vendor_id" defaultValue={initial?.sage_vendor_id ?? ""}
               className="input" placeholder="V12345" maxLength={50} />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field label="Contact email">
          <input name="contact_email" type="email" defaultValue={initial?.contact_email ?? ""}
                 className="input" placeholder="ar@vendor.com" />
        </Field>
        <Field label="Contact phone">
          <input name="contact_phone" defaultValue={initial?.contact_phone ?? ""}
                 className="input" placeholder="(555) 123-4567" />
        </Field>
      </div>

      <Field
        label="Remit address"
        hint="Where checks get mailed. Use this to distinguish multiple records of the same company billing different regions (e.g. 'Republic Services - Atlanta' vs 'Republic Services - Florida')."
      >
        <textarea
          name="remit_address"
          defaultValue={initial?.remit_address ?? ""}
          rows={3}
          maxLength={500}
          className="input font-mono text-[12.5px]"
          placeholder="REPUBLIC SERVICES #800&#10;PO BOX 71068&#10;CHARLOTTE NC 28272-1068"
        />
      </Field>

      <div className="flex items-center gap-2 pt-2">
        <input
          id="active"
          type="checkbox"
          name="active"
          defaultChecked={initial?.active ?? true}
          className="rounded border-nurock-border"
        />
        <label htmlFor="active" className="text-[13px] text-nurock-black">
          Active (uncheck to hide vendor without deleting)
        </label>
      </div>

      {state?.error && (
        <div className="text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {state.error}
        </div>
      )}

      {hasDuplicates && (
        <div className="rounded-md border-l-4 border-l-flag-amber bg-[#FFF8E8] p-4 space-y-3">
          <div>
            <div className="text-[13px] font-semibold text-nurock-black">
              Other vendor records have similar names
            </div>
            <p className="text-[12px] text-nurock-slate mt-0.5">
              Multiple records of the same company are allowed when they have different remit addresses or Sage vendor IDs (e.g. different regional offices). If this is the same situation, click <strong>Create anyway</strong>. If one of these is the right record, click <strong>Edit existing</strong>.
            </p>
          </div>
          <ul className="space-y-1.5">
            {state!.duplicateMatches!.map(m => (
              <li key={m.id} className="flex items-start justify-between gap-3 text-[12.5px] bg-white rounded-md px-3 py-2 border border-nurock-border">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-nurock-black flex items-center gap-2">
                    <span className="truncate">{m.name}</span>
                    {!m.active && (
                      <span className="text-[10px] font-medium bg-nurock-slate-light/20 text-nurock-slate px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
                        inactive
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-nurock-slate mt-0.5 space-y-0.5">
                    <div>
                      {m.category ?? "—"}
                      {m.sage_vendor_id && (
                        <> · Sage ID <span className="font-mono">{m.sage_vendor_id}</span></>
                      )}
                    </div>
                    {m.remit_address && (
                      <div className="text-nurock-slate-light text-[10.5px] line-clamp-2 whitespace-pre-line">
                        Remit to: {m.remit_address}
                      </div>
                    )}
                  </div>
                </div>
                <Link
                  href={`/admin/vendors/${m.id}/edit`}
                  className="text-[12px] text-nurock-navy hover:underline whitespace-nowrap shrink-0"
                >
                  Edit existing →
                </Link>
              </li>
            ))}
          </ul>
          {/* Override — hidden input is only present here, so the next submit
              from this form carries it. */}
          <input type="hidden" name="confirm_duplicate" value="true" />
          <div className="text-[11.5px] text-nurock-slate-light">
            Submitting again will create the new vendor. The database still blocks records that share both the same name AND Sage vendor ID.
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-3 border-t border-nurock-border">
        <SubmitButton isEdit={isEdit} forceCreateLabel={hasDuplicates && !isEdit} />
        <Link href="/admin/vendors" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}

function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-display uppercase tracking-[0.06em] text-nurock-slate mb-1.5">
        {label} {required && <span className="text-flag-red">*</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] text-nurock-slate-light mt-1">{hint}</div>}
    </div>
  );
}

function SubmitButton({ isEdit, forceCreateLabel }: { isEdit: boolean; forceCreateLabel: boolean }) {
  const { pending } = useFormStatus();
  const label = pending
    ? "Saving…"
    : forceCreateLabel
      ? "Create anyway"
      : isEdit ? "Save changes" : "Create vendor";
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {label}
    </button>
  );
}

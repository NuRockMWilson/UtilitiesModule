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
  active?:           boolean;
};

export function VendorForm({ initial }: { initial?: VendorFormValues }) {
  const [state, formAction] = useFormState<VendorFormState | null, FormData>(
    saveVendor as any,
    null,
  );
  const isEdit = Boolean(initial?.id);

  return (
    <form action={formAction} className="card p-6 max-w-2xl space-y-5">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

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

      <div className="flex items-center gap-3 pt-3 border-t border-nurock-border">
        <SubmitButton isEdit={isEdit} />
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

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create vendor"}
    </button>
  );
}

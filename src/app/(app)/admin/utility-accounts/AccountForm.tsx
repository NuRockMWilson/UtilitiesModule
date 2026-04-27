"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { saveAccount, type AccountFormState } from "./actions";

export type AccountFormValues = {
  id?:                       string;
  property_id?:              string;
  vendor_id?:                string;
  gl_account_id?:            string;
  account_number?:           string;
  description?:              string | null;
  meter_id?:                 string | null;
  esi_id?:                   string | null;
  meter_category?:           string | null;
  sub_code?:                 string;
  baseline_window_months?:   number;
  variance_threshold_pct?:   number;
  active?:                   boolean;
};

const METER_CATEGORIES = [
  "", "house", "clubhouse", "pool", "lighting", "irrigation",
  "trash", "laundry", "gate", "sign", "leasing", "other",
];

export function AccountForm({
  initial,
  properties,
  vendors,
  glAccounts,
}: {
  initial?:   AccountFormValues;
  properties: Array<{ id: string; code: string; name: string; full_code: string | null }>;
  vendors:    Array<{ id: string; name: string; active: boolean }>;
  glAccounts: Array<{ id: string; code: string; description: string }>;
}) {
  const [state, formAction] = useFormState<AccountFormState | null, FormData>(
    saveAccount as any,
    null,
  );
  const isEdit = Boolean(initial?.id);

  return (
    <form action={formAction} className="card p-6 max-w-3xl space-y-5">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Field label="Property" required>
          <select name="property_id" defaultValue={initial?.property_id ?? ""} required className="input">
            <option value="">— select —</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>
                {p.full_code ? `${p.full_code} · ${p.name}` : `${p.code} · ${p.name}`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Vendor" required>
          <select name="vendor_id" defaultValue={initial?.vendor_id ?? ""} required className="input">
            <option value="">— select —</option>
            {vendors.filter(v => v.active || v.id === initial?.vendor_id).map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>

        <Field label="GL account" required>
          <select name="gl_account_id" defaultValue={initial?.gl_account_id ?? ""} required className="input">
            <option value="">— select —</option>
            {glAccounts.map(g => (
              <option key={g.id} value={g.id}>{g.code} · {g.description}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Account number" required hint="As it appears on the vendor's invoice (e.g. '112674-001').">
        <input name="account_number" defaultValue={initial?.account_number ?? ""} required maxLength={100}
               className="input font-mono" />
      </Field>

      <Field label="Description" hint="Friendly name for this account, shown in the detail-page rows.">
        <input name="description" defaultValue={initial?.description ?? ""} maxLength={200}
               className="input" placeholder="House meter — Bldg 3" />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Field label="Meter ID" hint="Physical meter identifier (optional).">
          <input name="meter_id" defaultValue={initial?.meter_id ?? ""} className="input font-mono" maxLength={60} />
        </Field>
        <Field label="ESI ID" hint="ERCOT ESI ID, Texas only (optional).">
          <input name="esi_id" defaultValue={initial?.esi_id ?? ""} className="input font-mono" maxLength={60} />
        </Field>
        <Field label="Meter category" hint="Used in House Meters detail tab.">
          <select name="meter_category" defaultValue={initial?.meter_category ?? ""} className="input">
            {METER_CATEGORIES.map(c => (
              <option key={c} value={c}>{c || "—"}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Field label="Sub code" hint="Sage GL coding suffix (default '00').">
          <input name="sub_code" defaultValue={initial?.sub_code ?? "00"} maxLength={10}
                 className="input font-mono" />
        </Field>
        <Field label="Baseline window (months)" hint="How many months of history feed the variance baseline.">
          <input name="baseline_window_months" type="number" defaultValue={initial?.baseline_window_months ?? 12}
                 min={1} max={60} required className="input" />
        </Field>
        <Field label="Variance threshold (%)" hint="Flag bills above this % over baseline.">
          <input name="variance_threshold_pct" type="number" step="0.01" defaultValue={initial?.variance_threshold_pct ?? 3}
                 min={0} max={100} required className="input" />
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <input id="active" type="checkbox" name="active"
               defaultChecked={initial?.active ?? true}
               className="rounded border-nurock-border" />
        <label htmlFor="active" className="text-[13px] text-nurock-black">
          Active (uncheck to retire account without deleting historical data)
        </label>
      </div>

      {state?.error && (
        <div className="text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {state.error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-3 border-t border-nurock-border">
        <SubmitButton isEdit={isEdit} />
        <Link href="/admin/utility-accounts" className="btn-ghost">Cancel</Link>
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create account"}
    </button>
  );
}

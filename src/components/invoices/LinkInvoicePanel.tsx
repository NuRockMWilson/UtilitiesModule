"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkInvoice } from "@/app/(app)/invoices/[id]/link-actions";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

type Property = { id: string; code: string; name: string; full_code?: string | null };
type Vendor   = { id: string; name: string };
type GL       = { id: string; code: string; description: string };
type UA       = { id: string; account_number: string;
                  property_code: string; property_name: string;
                  vendor_name: string; gl_code: string };

/**
 * Linking panel shown when an invoice is in `needs_coding` because extraction
 * succeeded but no utility_account matched the extracted account number.
 *
 * Two tabs:
 *   - "Match existing" — pick a utility_account from the list (filtered by vendor)
 *   - "Create new"     — make a new utility_account on the fly so future bills
 *                        with this account number resolve automatically
 *
 * After linking, the page refreshes and the invoice transitions to either
 * `ready_for_approval` or `needs_variance_note` depending on variance.
 */
export function LinkInvoicePanel({
  invoiceId,
  extractedVendorName,
  extractedAccountNumber,
  properties,
  vendors,
  glAccounts,
  utilityAccounts,
}: {
  invoiceId:              string;
  extractedVendorName:    string | null;
  extractedAccountNumber: string | null;
  properties:             Property[];
  vendors:                Vendor[];
  glAccounts:             GL[];
  utilityAccounts:        UA[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"existing" | "create">("existing");

  // Suggest the matching vendor automatically if there's an obvious name match
  const suggestedVendorId =
    vendors.find(v =>
      extractedVendorName &&
      v.name.toLowerCase().includes(extractedVendorName.toLowerCase().split(/\s/)[0])
    )?.id ?? "";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("invoice_id", invoiceId);
    fd.set("mode", tab);
    startTransition(async () => {
      const r = await linkInvoice(fd);
      if (!r.ok) {
        setError(r.error ?? "Link failed");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="card p-5 border-l-4 border-l-flag-amber">
      <h3 className="font-display text-base font-semibold text-nurock-black">
        Link to property + utility account
      </h3>
      <p className="text-[12.5px] text-nurock-slate mt-1 mb-4">
        Extraction read{" "}
        {extractedVendorName && <strong>{extractedVendorName}</strong>}
        {extractedVendorName && extractedAccountNumber && " account "}
        {extractedAccountNumber && <code className="font-mono text-[11.5px]">{extractedAccountNumber}</code>}
        {!extractedVendorName && !extractedAccountNumber && "the bill"}
        , but no utility account matched. Pick the right one or create a new account so future bills auto-resolve.
      </p>

      <div className="flex gap-1 mb-4 border-b border-nurock-border">
        <button
          type="button"
          onClick={() => setTab("existing")}
          className={`px-3 py-1.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors ${
            tab === "existing"
              ? "border-nurock-navy text-nurock-navy"
              : "border-transparent text-nurock-slate hover:text-nurock-black"
          }`}
        >
          Match existing
        </button>
        <button
          type="button"
          onClick={() => setTab("create")}
          className={`px-3 py-1.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors ${
            tab === "create"
              ? "border-nurock-navy text-nurock-navy"
              : "border-transparent text-nurock-slate hover:text-nurock-black"
          }`}
        >
          Create new account
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {tab === "existing" ? (
          <Field label="Utility account">
            <Combobox
              name="utility_account_id"
              required
              mono
              placeholder="Type property code, vendor, GL, or account number…"
              options={utilityAccounts.map((a): ComboboxOption => ({
                value:  a.id,
                label:  `${a.property_code} · ${a.vendor_name} · ${a.gl_code} · ${a.account_number}`,
                detail: a.property_name,
                // Make every relevant field searchable
                search: `${a.property_code} ${a.property_name} ${a.vendor_name} ${a.gl_code} ${a.account_number}`,
              }))}
            />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Property" required>
                <Combobox
                  name="property_id"
                  required
                  placeholder="Type code or name…"
                  options={properties.map((p): ComboboxOption => ({
                    value:  p.id,
                    label:  `${p.full_code ?? p.code} · ${p.name}`,
                    search: `${p.code} ${p.full_code ?? ""} ${p.name}`,
                  }))}
                />
              </Field>
              <Field label="Vendor" required>
                <Combobox
                  name="vendor_id"
                  required
                  defaultValue={suggestedVendorId}
                  placeholder="Type vendor name…"
                  options={vendors.map((v): ComboboxOption => ({
                    value: v.id,
                    label: v.name,
                  }))}
                />
              </Field>
              <Field label="GL account" required>
                <Combobox
                  name="gl_account_id"
                  required
                  placeholder="Type GL code or description…"
                  options={glAccounts.map((g): ComboboxOption => ({
                    value:  g.id,
                    label:  `${g.code} · ${g.description}`,
                    search: `${g.code} ${g.description}`,
                  }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <Field label="Account number" required>
                  <input
                    name="account_number"
                    defaultValue={extractedAccountNumber ?? ""}
                    required
                    className="input font-mono"
                  />
                </Field>
              </div>
              <Field label="Sub-code">
                <input name="sub_code" defaultValue="00" className="input font-mono" />
              </Field>
            </div>
          </>
        )}

        {error && (
          <div className="text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Linking…" : tab === "existing" ? "Link to this account" : "Create & link"}
          </button>
          <span className="text-[11.5px] text-nurock-slate-light">
            Recomputes coding and variance after linking.
          </span>
        </div>
      </form>
    </div>
  );
}

function Field({
  label, required, children,
}: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-display uppercase tracking-[0.06em] text-nurock-slate mb-1">
        {label} {required && <span className="text-flag-red">*</span>}
      </label>
      {children}
    </div>
  );
}

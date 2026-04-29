"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { linkInvoice } from "@/app/(app)/invoices/[id]/link-actions";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { displayPropertyName } from "@/lib/property-display";

type Property = { id: string; code: string; name: string; full_code?: string | null };
type Vendor   = { id: string; name: string };
type GL       = { id: string; code: string; description: string };
type UA       = { id: string; account_number: string; property_id: string;
                  property_code: string; property_name: string;
                  vendor_name: string; gl_code: string };

// Same fuzzy-match rules used by the duplicate-vendor detection — keep in sync.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function stripTrailingDigits(s: string): string {
  return s.replace(/\d+$/, "");
}
function vendorsLookSame(a: string, b: string): boolean {
  const na = stripTrailingDigits(normalize(a));
  const nb = stripTrailingDigits(normalize(b));
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.includes(na)) return true;
  if (nb.length >= 3 && na.includes(nb)) return true;
  if (na.length >= 6 && nb.length >= 6 && na.slice(0, 6) === nb.slice(0, 6)) return true;
  return false;
}

/**
 * Linking panel shown when an invoice is in `needs_coding` because extraction
 * succeeded but no utility_account matched the extracted account number.
 *
 * Two tabs:
 *   - "Match existing" — pick a utility_account from the list
 *   - "Create new"     — make a new utility_account on the fly so future bills
 *                        with this account number resolve automatically
 *
 * Vendor mismatch alert: when the user selects a property in Create New AND
 * the extracted vendor name doesn't fuzzy-match any vendor that property is
 * already known to use, we surface a yellow warning showing the property's
 * actual expected vendors. The user can either pick one of those (typo /
 * different name for same company) or proceed anyway (legitimate new vendor).
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

  // Track the user's current property selection in Create New — needed for
  // the vendor-mismatch alert. We pass it to Combobox via the value prop.
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");

  // Suggest the matching vendor automatically if there's an obvious name match
  const suggestedVendorId = useMemo(
    () => vendors.find(v =>
      extractedVendorName && vendorsLookSame(v.name, extractedVendorName)
    )?.id ?? "",
    [vendors, extractedVendorName],
  );

  // Index property → expected vendor names (deduped) for the mismatch alert
  const expectedVendorsByProperty = useMemo(() => {
    const m = new Map<string, Array<{ name: string; gl: string }>>();
    for (const a of utilityAccounts) {
      if (!a.property_id) continue;
      const arr = m.get(a.property_id) ?? [];
      const dup = arr.some(x => x.name === a.vendor_name && x.gl === a.gl_code);
      if (!dup && a.vendor_name) {
        arr.push({ name: a.vendor_name, gl: a.gl_code });
        m.set(a.property_id, arr);
      }
    }
    return m;
  }, [utilityAccounts]);

  // Mismatch logic: only fires when the user has picked a property AND we have
  // an extracted vendor name AND none of the property's expected vendors fuzzy-
  // match. New properties with zero accounts get a different message.
  const mismatch = useMemo(() => {
    if (!selectedPropertyId || !extractedVendorName) return null;
    const expected = expectedVendorsByProperty.get(selectedPropertyId) ?? [];
    if (expected.length === 0) return { kind: "no-history" as const, expected };
    const matched = expected.find(e => vendorsLookSame(e.name, extractedVendorName));
    if (matched) return null;
    return { kind: "mismatch" as const, expected };
  }, [selectedPropertyId, extractedVendorName, expectedVendorsByProperty]);

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
                    label:  displayPropertyName(p.name),
                    // Keep code searchable so users can still find by code if needed
                    search: `${p.code} ${p.full_code ?? ""} ${p.name}`,
                  }))}
                  onValueChange={setSelectedPropertyId}
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

            {/* Vendor mismatch alert — shown when the user picks a property
                whose existing utility accounts don't include the extracted
                vendor (or any company that fuzzy-matches it). */}
            {mismatch && mismatch.kind === "mismatch" && (
              <div className="rounded-md border-l-4 border-l-flag-amber bg-[#FFF8E8] p-3.5 space-y-2">
                <div className="flex items-start gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 mt-0.5 text-flag-amber-dark" aria-hidden="true">
                    <path d="M8 1.5l7 13H1l7-13zM8 6v4M8 12v.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-nurock-black">
                      Vendor doesn't match this property's history
                    </div>
                    <p className="text-[12px] text-nurock-slate mt-0.5">
                      Extraction read <strong>{extractedVendorName}</strong>, but this property's existing utility accounts use:
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {mismatch.expected.map(e => (
                        <span key={`${e.name}-${e.gl}`} className="bg-white border border-nurock-border rounded-full px-2 py-0.5 text-[11.5px] text-nurock-slate">
                          {e.name} <span className="text-nurock-slate-light">· {e.gl}</span>
                        </span>
                      ))}
                    </div>
                    <p className="text-[11.5px] text-nurock-slate-light mt-2">
                      If the extracted vendor name is wrong, fix it via <strong>Edit fields</strong> on the bill above. If this is a legitimately new vendor for this property, continue.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {mismatch && mismatch.kind === "no-history" && (
              <div className="rounded-md border-l-4 border-l-nurock-slate bg-[#FAFBFC] p-3.5">
                <div className="text-[12px] text-nurock-slate">
                  This property has no utility accounts yet. The vendor and GL you choose will be its first.
                </div>
              </div>
            )}

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

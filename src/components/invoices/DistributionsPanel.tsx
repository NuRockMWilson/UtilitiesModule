"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDistributions } from "@/app/(app)/invoices/[id]/distribution-actions";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { formatDollars } from "@/lib/format";

type GL = { id: string; code: string; description: string };

export type DistributionLine = {
  id?:            string;
  gl_account_id:  string;
  sub_code:       string;
  description:    string;
  amount:         number;
  gl_code?:       string | null;        // for display
  gl_description?: string | null;
};

/**
 * Distribution lines panel — splits one invoice across multiple GL accounts.
 *
 * When the bill arrives with a single GL coding (the common case) this panel
 * is hidden behind a collapsed summary that says "1 distribution · $X.XX to
 * GL Y". Click "Split across multiple GLs" to expand into the editor.
 *
 * In the editor each row has a GL combobox, a sub-code, a description, and
 * an amount. Running totals and a delta vs the invoice total live below.
 * Save is disabled until the delta is within $0.02.
 *
 * Saving REPLACES the entire distribution list — simpler than diffing rows.
 */
export function DistributionsPanel({
  invoiceId,
  invoiceTotal,
  initial,
  glAccounts,
  canEdit,
}: {
  invoiceId:    string;
  invoiceTotal: number | null;
  initial:      DistributionLine[];
  glAccounts:   GL[];
  canEdit:      boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Pre-fill the editor with existing rows if any, otherwise start with one
  // blank row pre-filled to the invoice total — the "I want to split" path.
  const [rows, setRows] = useState<DistributionLine[]>(() =>
    initial.length > 0
      ? initial
      : [{ gl_account_id: "", sub_code: "00", description: "", amount: invoiceTotal ?? 0 }],
  );

  const sum   = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const total = Number(invoiceTotal ?? 0);
  const delta = Math.round((sum - total) * 100) / 100;
  const balanced = Math.abs(delta) <= 0.02;

  const glOptions: ComboboxOption[] = glAccounts.map(g => ({
    value:  g.id,
    label:  `${g.code} · ${g.description}`,
    search: `${g.code} ${g.description}`,
  }));

  function setRow(i: number, patch: Partial<DistributionLine>) {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    // Pre-fill new line with the remaining unallocated amount
    const remaining = Math.max(0, total - sum);
    setRows(prev => [...prev, { gl_account_id: "", sub_code: "00", description: "", amount: remaining }]);
  }
  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!balanced) {
      setError(`Sum doesn't match total. Off by ${formatDollars(delta)}.`);
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("invoice_id", invoiceId);
    startTransition(async () => {
      const r = await saveDistributions(fd);
      if (!r.ok) {
        setError(r.error ?? "Save failed");
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  // ============== Read-only / collapsed summary view ==============
  if (!editing) {
    if (initial.length === 0) {
      // No multi-line split — show offer to create one
      return (
        <div className="card p-4 flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-nurock-slate">
            <strong className="text-nurock-black">Distributions:</strong> single GL coding ·{" "}
            <span className="text-nurock-slate-light">use this when one bill covers multiple services (e.g. cable + phone)</span>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] text-nurock-navy hover:underline whitespace-nowrap"
            >
              Split across multiple GLs →
            </button>
          )}
        </div>
      );
    }

    // Already split — show the lines
    const initSum = initial.reduce((s, r) => s + r.amount, 0);
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h3 className="font-display text-base font-semibold text-nurock-black">
            Distributions <span className="text-[12px] text-nurock-slate-light font-normal">· {initial.length} line{initial.length === 1 ? "" : "s"}</span>
          </h3>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] text-nurock-navy hover:underline"
            >
              Edit distributions
            </button>
          )}
        </div>
        <table className="min-w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-nurock-slate border-b border-nurock-border">
              <th className="py-1.5 pr-3 font-medium">GL coding</th>
              <th className="py-1.5 pr-3 font-medium">Description</th>
              <th className="py-1.5 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-nurock-border">
            {initial.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="py-1.5 pr-3 font-mono text-[11.5px]">
                  {l.gl_code} <span className="text-nurock-slate-light">· {l.gl_description}</span>
                </td>
                <td className="py-1.5 pr-3">{l.description}</td>
                <td className="py-1.5 text-right tabular-nums">{formatDollars(l.amount)}</td>
              </tr>
            ))}
            <tr className="font-semibold border-t-2 border-nurock-border">
              <td className="py-1.5 pr-3 text-nurock-slate" colSpan={2}>Total of distributions</td>
              <td className="py-1.5 text-right tabular-nums">{formatDollars(initSum)}</td>
            </tr>
            {Math.abs(initSum - total) > 0.02 && (
              <tr className="text-flag-red">
                <td className="py-1.5 pr-3 text-[11.5px]" colSpan={2}>
                  Off from invoice total by
                </td>
                <td className="py-1.5 text-right tabular-nums text-[11.5px]">
                  {formatDollars(initSum - total)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  // ============== Editing view ==============
  return (
    <form onSubmit={submit} className="card p-5 border-l-4 border-l-nurock-navy">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="font-display text-base font-semibold text-nurock-black">
          Edit distributions
        </h3>
        <div className="text-[11.5px] text-nurock-slate">
          Invoice total: <strong className="text-nurock-black">{formatDollars(total)}</strong>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-start">
            <input type="hidden" name={`lines[${i}].id`} value={r.id ?? ""} />
            <div className="col-span-4">
              {/* Combobox renders a hidden input for `name` already, no need for extra */}
              <Combobox
                name={`lines[${i}].gl_account_id`}
                required
                placeholder="GL code or description…"
                options={glOptions}
                value={r.gl_account_id}
                onValueChange={v => setRow(i, { gl_account_id: v })}
              />
            </div>
            <div className="col-span-1">
              <input
                name={`lines[${i}].sub_code`}
                value={r.sub_code}
                onChange={e => setRow(i, { sub_code: e.target.value })}
                maxLength={2}
                className="input font-mono text-[12.5px] text-center w-full"
                placeholder="00"
              />
            </div>
            <div className="col-span-4">
              <input
                name={`lines[${i}].description`}
                value={r.description}
                onChange={e => setRow(i, { description: e.target.value })}
                maxLength={200}
                className="input text-[12.5px]"
                placeholder="Phone service / Pool line / etc."
              />
            </div>
            <div className="col-span-2">
              <input
                name={`lines[${i}].amount`}
                value={String(r.amount)}
                onChange={e => {
                  const n = Number(e.target.value.replace(/[$,]/g, ""));
                  setRow(i, { amount: Number.isFinite(n) ? n : 0 });
                }}
                inputMode="decimal"
                className="input font-mono text-[12.5px] text-right"
                placeholder="0.00"
              />
            </div>
            <div className="col-span-1 flex items-center justify-end">
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-nurock-slate-light hover:text-flag-red text-[16px] leading-none px-1"
                title="Remove this line"
                aria-label={`Remove line ${i + 1}`}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={addRow}
          className="text-[12px] text-nurock-navy hover:underline"
        >
          + Add another line
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-nurock-border grid grid-cols-12 gap-2 text-[12.5px]">
        <div className="col-span-9 text-right text-nurock-slate font-medium">Sum of distributions</div>
        <div className="col-span-2 text-right tabular-nums font-mono font-semibold">{formatDollars(sum)}</div>
        <div className="col-span-1" />
        <div className="col-span-9 text-right text-nurock-slate font-medium">Δ vs invoice total</div>
        <div className={`col-span-2 text-right tabular-nums font-mono font-semibold ${balanced ? "text-flag-green-dark" : "text-flag-red"}`}>
          {balanced ? "balanced" : formatDollars(delta)}
        </div>
        <div className="col-span-1" />
      </div>

      {error && (
        <div className="mt-3 text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-nurock-border flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !balanced}
          className="btn-primary text-[13px]"
        >
          {pending ? "Saving…" : "Save distributions"}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); setRows(initial.length > 0 ? initial : [{ gl_account_id: "", sub_code: "00", description: "", amount: invoiceTotal ?? 0 }]); }}
          disabled={pending}
          className="text-[12.5px] text-nurock-slate hover:text-nurock-black"
        >
          Cancel
        </button>
        <span className="text-[11.5px] text-nurock-slate-light ml-auto">
          Each line becomes a separate APD record in the Sage AP Import file.
        </span>
      </div>
    </form>
  );
}

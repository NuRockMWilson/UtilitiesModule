"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { cn } from "@/lib/cn";
import { formatDollars, formatDate, formatPercent } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/types";
import { bulkDeleteInvoices } from "@/app/(app)/invoices/delete-actions";

export type InvoiceRow = {
  id:                string;
  invoice_number:    string | null;
  invoice_date:      string | null;
  due_date:          string | null;
  total_amount_due:  number | null;
  status:            InvoiceStatus;
  variance_flagged:  boolean | null;
  variance_pct:      number | null;
  gl_coding:         string | null;
  property_code:     string | null;
  property_name:     string | null;
  vendor_name:       string | null;
};

// Statuses that allow deletion. Mirror of DELETABLE_STATUSES on the server
// so the checkbox is hidden on rows that won't delete anyway.
const DELETABLE = new Set<InvoiceStatus>([
  "new", "extracting", "extraction_failed",
  "needs_coding", "needs_variance_note",
  "ready_for_approval", "rejected",
]);

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Only deletable rows count toward the "select all" checkbox state
  const deletableRows = rows.filter(r => DELETABLE.has(r.status));
  const allSelected = deletableRows.length > 0 && deletableRows.every(r => selected.has(r.id));
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deletableRows.map(r => r.id)));
    }
  }
  function fire() {
    setError(null);
    const fd = new FormData();
    for (const id of selected) fd.append("invoice_ids", id);
    startTransition(async () => {
      const r = await bulkDeleteInvoices(fd);
      if (!r.ok) {
        setError(r.error ?? "Bulk delete failed");
        setConfirming(false);
      } else {
        setSelected(new Set());
        setConfirming(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {someSelected && (
        <div className="card border-l-4 border-l-flag-amber px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="text-[12.5px] text-nurock-black flex-1">
            <strong>{selected.size}</strong> invoice{selected.size === 1 ? "" : "s"} selected.
            Approved or posted invoices in the selection will be skipped (kept for audit).
          </div>
          {!confirming ? (
            <>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={pending}
                className="px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-flag-red text-white hover:bg-red-700"
              >
                Delete selected
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[12.5px] text-nurock-slate hover:text-nurock-black"
              >
                Clear
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-md">
              <span className="text-[12.5px] text-flag-red font-medium">Confirm delete?</span>
              <button
                type="button"
                onClick={fire}
                disabled={pending}
                className="px-2.5 py-1 rounded text-[12px] font-medium bg-flag-red text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="px-2.5 py-1 rounded text-[12px] text-nurock-slate hover:text-nurock-black"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="card p-3 text-[12.5px] text-flag-red border-l-4 border-l-flag-red">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-nurock-border text-sm">
          <thead className="bg-[#FAFBFC]">
            <tr className="text-left text-xs uppercase tracking-wide text-nurock-slate">
              <th className="px-3 py-3 font-medium w-10">
                <input
                  type="checkbox"
                  aria-label="Select all deletable invoices"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={deletableRows.length === 0}
                  className="rounded border-nurock-border cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Service period</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium text-right">Variance</th>
              <th className="px-4 py-3 font-medium">GL coding</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-nurock-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-nurock-slate">
                  No invoices match the current filter.
                </td>
              </tr>
            )}
            {rows.map(r => {
              const canDelete = DELETABLE.has(r.status);
              const isSelected = selected.has(r.id);
              return (
                <tr key={r.id} className={cn("hover:bg-[#FAFBFC]", isSelected && "bg-[#FFF8E8]")}>
                  <td className="px-3 py-3">
                    {canDelete ? (
                      <input
                        type="checkbox"
                        aria-label={`Select invoice ${r.invoice_number ?? r.id}`}
                        checked={isSelected}
                        onChange={() => toggle(r.id)}
                        className="rounded border-nurock-border cursor-pointer"
                      />
                    ) : (
                      <span className="block w-4 h-4" aria-hidden />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${r.id}`} className="font-medium text-nurock-black hover:underline">
                      {r.property_code ?? "—"}
                    </Link>
                    <div className="text-xs text-nurock-slate truncate max-w-[160px]">
                      {r.property_name ?? ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">{r.vendor_name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.invoice_number ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(r.invoice_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDollars(r.total_amount_due)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.variance_pct !== null ? (
                      <span className={cn(r.variance_flagged ? "text-flag-red font-medium" : "text-nurock-slate")}>
                        {formatPercent(r.variance_pct, { sign: true })}
                      </span>
                    ) : (
                      <span className="text-nurock-slate-light">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-nurock-slate">{r.gl_coding ?? "—"}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-right text-xs">{formatDate(r.due_date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

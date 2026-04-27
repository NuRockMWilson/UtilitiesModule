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

// Statuses that allow deletion — mirror of server-side DELETABLE_STATUSES.
const DELETABLE = new Set<InvoiceStatus>([
  "new", "extracting", "extraction_failed",
  "needs_coding", "needs_variance_note",
  "ready_for_approval", "rejected",
]);
// Only approved invoices may be posted to Sage. Posted/paid are already in
// Sage; everything else is pre-approval and not eligible.
const POSTABLE = new Set<InvoiceStatus>(["approved"]);

// A row is selectable if any bulk action applies to it. The action bar
// figures out per-action eligibility from the actual selection.
function isSelectable(status: InvoiceStatus): boolean {
  return DELETABLE.has(status) || POSTABLE.has(status);
}

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPost, setConfirmingPost] = useState(false);
  const [postResult, setPostResult] = useState<{
    invoice_count: number;
    total_amount:  number;
    download_url:  string;
    download_filename: string;
    batch_reference:   string;
  } | null>(null);

  // Eligibility split for the action bar. Approved/posted are kept out of
  // delete; non-approved are kept out of post. Deciding per-row at submit
  // time keeps the user's selection intact across both buttons.
  const selectableRows = rows.filter(r => isSelectable(r.status));
  const allSelected    = selectableRows.length > 0 && selectableRows.every(r => selected.has(r.id));
  const someSelected   = selected.size > 0;

  const selectedRows = rows.filter(r => selected.has(r.id));
  const deletableInSelection = selectedRows.filter(r => DELETABLE.has(r.status));
  const postableInSelection  = selectedRows.filter(r => POSTABLE.has(r.status));

  const postableTotal = postableInSelection.reduce(
    (s, r) => s + (Number.isFinite(r.total_amount_due) ? Number(r.total_amount_due) : 0),
    0,
  );

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
      setSelected(new Set(selectableRows.map(r => r.id)));
    }
  }

  function fireDelete() {
    setError(null);
    const fd = new FormData();
    for (const r of deletableInSelection) fd.append("invoice_ids", r.id);
    startTransition(async () => {
      const r = await bulkDeleteInvoices(fd);
      if (!r.ok) {
        setError(r.error ?? "Bulk delete failed");
        setConfirmingDelete(false);
      } else {
        setSelected(new Set());
        setConfirmingDelete(false);
        router.refresh();
      }
    });
  }

  /**
   * POST /api/sage/batches with the postable invoice ids in the selection.
   * The server creates a single sage_batches row and writes one combined AP
   * Import .txt file containing every selected invoice's API+APD records.
   * Each invoice's `sage_batch_id` is set so it shows as posted afterward.
   *
   * Result includes a download URL — we both auto-download AND surface a
   * persistent banner with the filename so the user can re-download from the
   * Sage Batches admin page if they miss the trigger.
   */
  async function firePost() {
    setError(null);
    setPostResult(null);
    setConfirmingPost(false);
    const ids = postableInSelection.map(r => r.id);
    if (ids.length === 0) {
      setError("No approved invoices in the selection.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/sage/batches", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ invoice_ids: ids }),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) {
          setError(body?.error ?? `Post failed (${res.status})`);
          return;
        }
        setPostResult({
          invoice_count:     body.invoice_count,
          total_amount:      body.total_amount,
          download_url:      body.download_url,
          download_filename: body.download_filename,
          batch_reference:   body.batch_reference,
        });
        // Auto-trigger download so Sharon doesn't have to hunt for it
        if (typeof window !== "undefined" && body.download_url) {
          window.location.href = body.download_url;
        }
        setSelected(new Set());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Network error posting batch");
      }
    });
  }

  return (
    <div className="space-y-3">
      {someSelected && (
        <div className="card border-l-4 border-l-flag-amber px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="text-[12.5px] text-nurock-black flex-1">
            <strong>{selected.size}</strong> invoice{selected.size === 1 ? "" : "s"} selected ·{" "}
            <span className="text-nurock-slate">
              {deletableInSelection.length} deletable · {postableInSelection.length} approved & ready to post
              {postableInSelection.length > 0 && (
                <> · <span className="font-mono">{formatDollars(postableTotal)}</span></>
              )}
            </span>
          </div>

          {/* Post-to-Sage button — only meaningful when at least one
              approved row is selected. */}
          {!confirmingPost && !confirmingDelete && postableInSelection.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmingPost(true)}
              disabled={pending}
              className="px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-nurock-navy text-white hover:bg-nurock-navy-dark disabled:opacity-50"
              title="Generate Sage AP Import file for the approved invoices in this selection"
            >
              Post {postableInSelection.length} to Sage
            </button>
          )}
          {confirmingPost && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md">
              <span className="text-[12.5px] text-nurock-navy font-medium">
                Generate batch for {postableInSelection.length} invoice{postableInSelection.length === 1 ? "" : "s"}?
              </span>
              <button
                type="button"
                onClick={firePost}
                disabled={pending}
                className="px-2.5 py-1 rounded text-[12px] font-medium bg-nurock-navy text-white hover:bg-nurock-navy-dark disabled:opacity-50"
              >
                {pending ? "Generating…" : "Yes, post"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingPost(false)}
                disabled={pending}
                className="px-2.5 py-1 rounded text-[12px] text-nurock-slate hover:text-nurock-black"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Delete button — only meaningful when at least one deletable
              row is selected. Hidden during a pending post confirmation. */}
          {!confirmingDelete && !confirmingPost && deletableInSelection.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              className="px-3 py-1.5 rounded-md text-[12.5px] font-medium bg-flag-red text-white hover:bg-red-700"
            >
              Delete {deletableInSelection.length}
            </button>
          )}
          {confirmingDelete && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-3 py-1.5 rounded-md">
              <span className="text-[12.5px] text-flag-red font-medium">Confirm delete?</span>
              <button
                type="button"
                onClick={fireDelete}
                disabled={pending}
                className="px-2.5 py-1 rounded text-[12px] font-medium bg-flag-red text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={pending}
                className="px-2.5 py-1 rounded text-[12px] text-nurock-slate hover:text-nurock-black"
              >
                Cancel
              </button>
            </div>
          )}

          {!confirmingDelete && !confirmingPost && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[12.5px] text-nurock-slate hover:text-nurock-black"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Persistent post-success banner — survives until dismissed so the
          user can re-trigger the download if it didn't auto-fire. */}
      {postResult && (
        <div className="card border-l-4 border-l-flag-green px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="text-[12.5px] flex-1">
            <strong className="text-nurock-black">Batch {postResult.batch_reference} created.</strong>{" "}
            {postResult.invoice_count} invoice{postResult.invoice_count === 1 ? "" : "s"} ·{" "}
            <span className="font-mono">{formatDollars(postResult.total_amount)}</span> total
          </div>
          <a
            href={postResult.download_url}
            className="text-[12.5px] text-nurock-navy hover:underline font-medium"
            download={postResult.download_filename}
          >
            Re-download {postResult.download_filename}
          </a>
          <Link href="/admin/sage" className="text-[12.5px] text-nurock-slate hover:text-nurock-black">
            View batch →
          </Link>
          <button
            type="button"
            onClick={() => setPostResult(null)}
            className="text-nurock-slate-light hover:text-nurock-black"
            aria-label="Dismiss"
          >
            ×
          </button>
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
                  aria-label="Select all eligible invoices"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={selectableRows.length === 0}
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
              const canSelect = isSelectable(r.status);
              const isSelected = selected.has(r.id);
              return (
                <tr key={r.id} className={cn("hover:bg-[#FAFBFC]", isSelected && "bg-[#FFF8E8]")}>
                  <td className="px-3 py-3">
                    {canSelect ? (
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
                    <Link href={`/invoices/${r.id}`} className="font-medium text-nurock-navy hover:underline">
                      {r.property_code ?? "—"}
                    </Link>
                    <div className="text-xs text-nurock-slate truncate max-w-[160px]">
                      {r.property_name ?? ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${r.id}`} className="text-nurock-slate hover:text-nurock-navy hover:underline">
                      {r.vendor_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/invoices/${r.id}`} className="text-nurock-navy hover:underline">
                      {r.invoice_number ?? "—"}
                    </Link>
                  </td>
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
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${r.id}`} className="hover:opacity-80">
                      <StatusPill status={r.status} />
                    </Link>
                  </td>
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

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatDollars, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { InvoiceStatus, SageSystem } from "@/lib/types";

export interface QueueRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_amount_due: number | null;
  status: InvoiceStatus;
  gl_coding: string | null;
  check_number: string | null;
  mailed_at: string | null;
  sage_batch_uuid: string | null;
  property_id: string | null;
  property_code: string | null;
  property_name: string | null;
  property_sage_system: SageSystem;
  vendor_name: string | null;
}

interface BatchResult {
  batch_id: string;
  batch_reference: string;
  sage_system: SageSystem;
  invoice_count: number;
  total_amount: number;
  download_url: string | null;
  download_filename: string | null;
}

export function PaymentsQueueClient({ rows }: { rows: QueueRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRows = rows.filter(r => selected.has(r.id));

  // Validation: all selected must be approved (not already batched) and share one Sage system
  const validationError = useMemo(() => {
    if (selectedRows.length === 0) return null;
    const notApproved = selectedRows.filter(r => r.status !== "approved");
    if (notApproved.length > 0) {
      return `${notApproved.length} selected invoice(s) are already posted or batched`;
    }
    const systems = new Set(selectedRows.map(r => r.property_sage_system));
    if (systems.size > 1) {
      return "Selection mixes 300 CRE and Intacct properties — build separate batches";
    }
    return null;
  }, [selectedRows]);

  const selectedTotal = selectedRows.reduce((a, r) => a + Number(r.total_amount_due ?? 0), 0);

  const approvedRows = rows.filter(r => r.status === "approved" && !r.sage_batch_uuid);
  const allApprovedSelected = approvedRows.length > 0 &&
    approvedRows.every(r => selected.has(r.id));

  function toggle(id: string) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allApprovedSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(approvedRows.map(r => r.id)));
    }
  }

  function selectByProperty(code: string) {
    const eligible = approvedRows.filter(r => r.property_code === code).map(r => r.id);
    setSelected(new Set(eligible));
  }

  async function createBatch() {
    if (selected.size === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/sage/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_ids: Array.from(selected) }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok || !data.success) {
      setError(data.error ?? "Batch creation failed");
      return;
    }

    setResult(data);
    setSelected(new Set());

    if (data.download_url) {
      const a = document.createElement("a");
      a.href = data.download_url;
      if (data.download_filename) a.download = data.download_filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    router.refresh();
  }

  async function confirmPosted() {
    if (!result) return;
    setLoading(true);
    const res = await fetch(`/api/sage/batches/${result.batch_id}/confirm`, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      setResult(null);
      router.refresh();
    } else {
      const err = await res.text();
      setError(`Confirmation failed: ${err}`);
    }
  }

  // Group by property for the shortcut buttons
  const propertyGroups = useMemo(() => {
    const m = new Map<string, { code: string; name: string; count: number; total: number }>();
    for (const r of approvedRows) {
      if (!r.property_code) continue;
      const existing = m.get(r.property_code) ?? {
        code: r.property_code, name: r.property_name ?? "", count: 0, total: 0,
      };
      existing.count += 1;
      existing.total += Number(r.total_amount_due ?? 0);
      m.set(r.property_code, existing);
    }
    return Array.from(m.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [approvedRows]);

  return (
    <>
      {/* Batch action bar */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-tan-700">Selected</div>
              <div className="text-lg font-semibold text-navy-800">
                {selected.size} · {formatDollars(selectedTotal, { cents: false })}
              </div>
            </div>
            {validationError && (
              <div className="text-sm text-flag-red">{validationError}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
              className="btn-ghost text-sm"
            >
              Clear
            </button>
            <button
              onClick={createBatch}
              disabled={loading || selected.size === 0 || !!validationError}
              className="btn-primary text-sm"
            >
              {loading ? "Generating…" : "Create Sage AP Import batch"}
            </button>
          </div>
        </div>

        {propertyGroups.length > 0 && selected.size === 0 && (
          <div className="mt-3 pt-3 border-t border-navy-100">
            <div className="text-xs text-tan-700 mb-2">Quick select by property:</div>
            <div className="flex flex-wrap gap-2">
              {propertyGroups.map(g => (
                <button
                  key={g.code}
                  onClick={() => selectByProperty(g.code)}
                  className="badge border border-navy-200 bg-white text-navy-700 hover:bg-navy-50"
                >
                  {g.code} {g.name} · {g.count} invoices · {formatDollars(g.total, { cents: false })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Batch-creation result panel */}
      {result && result.download_url && (
        <div className="card p-4 mb-4 border-l-4 border-l-navy bg-navy-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-navy-800">
                Sage AP Import file generated · batch {result.batch_reference}
              </div>
              <div className="text-xs text-tan-800 mt-1">
                {result.invoice_count} invoices · {formatDollars(result.total_amount, { cents: false })} · download started automatically
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={result.download_url}
                download={result.download_filename ?? "ap_import.txt"}
                className="btn-secondary text-sm"
              >
                Re-download
              </a>
              <button onClick={confirmPosted} disabled={loading} className="btn-primary text-sm">
                Confirm Sage import
              </button>
            </div>
          </div>
          <div className="text-xs text-tan-800 mt-3">
            Next: Sharon runs <strong>AP Tasks → Import Invoices</strong> in Sage and points to the downloaded file.
            Once the Sage entry report looks correct, click <em>Confirm Sage import</em> above to flip these invoices to posted.
          </div>
        </div>
      )}

      {result && !result.download_url && result.sage_system === "sage_intacct" && (
        <div className="card p-4 mb-4 border-l-4 border-l-flag-green bg-green-50">
          <div className="text-sm font-medium text-green-900">
            Posted to Intacct · batch {result.batch_reference} · {result.invoice_count} invoices
          </div>
        </div>
      )}

      {error && (
        <div className="card p-4 mb-4 border-l-4 border-l-flag-red text-sm text-flag-red">
          {error}
        </div>
      )}

      {/* Queue table */}
      <div className="card overflow-hidden">
        <table className="min-w-full text-sm divide-y divide-navy-100">
          <thead className="bg-navy-50">
            <tr className="text-left text-xs uppercase tracking-wide text-tan-700">
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allApprovedSelected}
                  onChange={toggleAll}
                  className="rounded border-navy-300"
                  aria-label="Select all approved"
                />
              </th>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Check</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-tan-700">
                  No invoices queued for payment.
                </td>
              </tr>
            )}
            {rows.map(r => {
              const selectable = r.status === "approved" && !r.sage_batch_uuid;
              return (
                <tr key={r.id} className={cn("hover:bg-navy-50/50", selected.has(r.id) && "bg-navy-50")}>
                  <td className="px-3 py-3">
                    {selectable ? (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        className="rounded border-navy-300"
                      />
                    ) : (
                      <span className="inline-block w-4 h-4" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${r.id}`} className="font-medium text-navy-800 hover:underline">
                      {r.property_code}
                    </Link>
                    <div className="text-xs text-tan-700">{r.property_name}</div>
                  </td>
                  <td className="px-4 py-3">{r.vendor_name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.invoice_number ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatDollars(r.total_amount_due)}
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDate(r.due_date)}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-xs">
                    {r.check_number ? (
                      <span className="text-navy-800">
                        #{r.check_number}{r.mailed_at && " · mailed"}
                      </span>
                    ) : (
                      <span className="text-tan-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

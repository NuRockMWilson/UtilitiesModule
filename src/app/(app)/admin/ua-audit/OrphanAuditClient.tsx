"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

interface CandidateUA {
  id: string;
  account_number: string;
  description: string | null;
  invoiceCount: number;
  invoiceTotal: number;
  vendor: { name: string } | null;
}

interface OrphanRow {
  ua: {
    id: string;
    account_number: string;
    description: string | null;
    property: { code: string; name: string } | null;
    vendor: { name: string } | null;
    gl: { code: string; description: string } | null;
  };
  invoiceCount: number;
  invoiceTotal: number;
  candidates: CandidateUA[];
  mergeSql: string;
}

export function OrphanAuditClient({ rows }: { rows: OrphanRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copySQL(id: string, sql: string) {
    await navigator.clipboard.writeText(sql);
    setCopied(id);
    setTimeout(() => setCopied(null), 2500);
  }

  const resolvable = rows.filter(r => r.candidates.length > 0);
  const unresolvable = rows.filter(r => r.candidates.length === 0);

  return (
    <div className="space-y-6">
      {/* Summary banner */}
      <div className="card p-5 bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">What this means:</span> These utility accounts have
          placeholder account numbers from the historical import (e.g.{" "}
          <code className="bg-amber-100 px-1 rounded text-xs">Garbage Total</code>). Live bills
          can't match to them, so the auto-coder creates a duplicate UA instead. Merge each orphan
          into its counterpart to fix variance history and prevent future duplicates.
        </p>
      </div>

      {/* Resolvable group */}
      {resolvable.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-nurock-navy uppercase tracking-wide mb-3">
            Auto-resolvable ({resolvable.length})
          </h2>
          <div className="space-y-3">
            {resolvable.map(row => (
              <OrphanCard
                key={row.ua.id}
                row={row}
                expanded={expanded === row.ua.id}
                onToggle={() => setExpanded(expanded === row.ua.id ? null : row.ua.id)}
                onCopy={() => copySQL(row.ua.id, row.mergeSql)}
                copied={copied === row.ua.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unresolvable group */}
      {unresolvable.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-nurock-slate uppercase tracking-wide mb-3">
            Needs manual resolution ({unresolvable.length})
          </h2>
          <div className="space-y-3">
            {unresolvable.map(row => (
              <OrphanCard
                key={row.ua.id}
                row={row}
                expanded={expanded === row.ua.id}
                onToggle={() => setExpanded(expanded === row.ua.id ? null : row.ua.id)}
                onCopy={() => copySQL(row.ua.id, row.mergeSql)}
                copied={copied === row.ua.id}
                noCandidate
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrphanCard({
  row, expanded, onToggle, onCopy, copied, noCandidate,
}: {
  row: OrphanRow;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
  noCandidate?: boolean;
}) {
  const { ua, invoiceCount, invoiceTotal, candidates, mergeSql } = row;
  const target = candidates[0];

  return (
    <div className={cn("card", noCandidate ? "border-red-200 bg-red-50/30" : "")}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-4 p-5 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-nurock-navy bg-nurock-navy/10 px-2 py-0.5 rounded">
              {ua.property?.code}
            </span>
            <span className="text-xs text-nurock-slate font-mono bg-gray-100 px-2 py-0.5 rounded">
              GL {ua.gl?.code}
            </span>
            <span className={cn(
              "badge text-xs",
              noCandidate ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700",
            )}>
              {noCandidate ? "No candidate" : "Resolvable"}
            </span>
          </div>
          <div className="mt-1">
            <span className="text-sm font-medium">{ua.vendor?.name}</span>
            <span className="text-nurock-slate text-xs ml-2">
              acct: <code className="bg-gray-100 px-1 rounded">{ua.account_number}</code>
            </span>
          </div>
          {ua.property && (
            <div className="text-xs text-nurock-slate mt-0.5">{ua.property.name}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold">
            {invoiceCount.toLocaleString()} invoice{invoiceCount !== 1 ? "s" : ""}
          </div>
          <div className="text-xs text-nurock-slate">
            ${invoiceTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <span className="text-nurock-slate text-xs mt-1 shrink-0">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
          {/* Merge target */}
          {target ? (
            <div>
              <div className="text-xs font-semibold text-nurock-slate uppercase tracking-wide mb-2">
                Merge target
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
                <div className="font-medium text-green-800">{target.vendor?.name ?? ua.vendor?.name}</div>
                <div className="text-green-700 text-xs mt-0.5">
                  acct: <code>{target.account_number}</code>
                  &nbsp;·&nbsp;{target.invoiceCount} invoices
                  &nbsp;·&nbsp;${target.invoiceTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
              No active UA found at property {ua.property?.code} with GL {ua.gl?.code}.
              You'll need to create the target UA first, then merge manually.
            </div>
          )}

          {/* Other candidates */}
          {candidates.length > 1 && (
            <div>
              <div className="text-xs text-nurock-slate mb-1">
                Other candidates at this property + GL:
              </div>
              {candidates.slice(1).map(c => (
                <div key={c.id} className="text-xs text-nurock-slate font-mono">
                  {c.account_number} · {c.invoiceCount} invoices
                </div>
              ))}
            </div>
          )}

          {/* SQL */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-nurock-slate uppercase tracking-wide">
                Merge SQL (run in Supabase console)
              </span>
              <button
                onClick={onCopy}
                className={cn(
                  "btn-sm text-xs px-3 py-1 rounded font-medium transition-colors",
                  copied
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : "bg-nurock-navy text-white hover:bg-nurock-navy/90",
                )}
              >
                {copied ? "✓ Copied!" : "Copy SQL"}
              </button>
            </div>
            <pre className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto leading-relaxed">
              {mergeSql}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

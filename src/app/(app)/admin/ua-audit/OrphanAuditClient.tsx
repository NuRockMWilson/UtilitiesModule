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

type Category = "corrupted_orphan" | "merge_target" | "multi_stream_review" | "historical_only";

interface OrphanRow {
  ua: {
    id: string;
    account_number: string;
    description: string | null;
    property: { code: string; name: string } | null;
    vendor: { name: string } | null;
    gl: { code: string; description: string } | null;
  };
  category: Category;
  invoiceCount: number;
  invoiceTotal: number;
  candidates: CandidateUA[];
  mergeSql: string;
  avgWarning: string | null;
  corruptionDetail: string | null;
}

interface Props {
  corruptedRows: OrphanRow[];
  mergeRows: OrphanRow[];
  reviewRows: OrphanRow[];
  historicalRows: OrphanRow[];
}

export function OrphanAuditClient({ corruptedRows, mergeRows, reviewRows, historicalRows }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copySQL(id: string, sql: string) {
    await navigator.clipboard.writeText(sql);
    setCopied(id);
    setTimeout(() => setCopied(null), 2500);
  }

  const renderRow = (row: OrphanRow) => (
    <OrphanCard
      key={row.ua.id}
      row={row}
      expanded={expanded === row.ua.id}
      onToggle={() => setExpanded(expanded === row.ua.id ? null : row.ua.id)}
      onCopy={() => copySQL(row.ua.id, row.mergeSql)}
      copied={copied === row.ua.id}
    />
  );

  return (
    <div className="space-y-6">
      <div className="card p-5 bg-amber-50 border border-amber-200">
        <p className="text-sm text-amber-900">
          <span className="font-semibold">What this page shows:</span> Utility accounts
          with placeholder account numbers (e.g.{" "}
          <code className="bg-amber-100 px-1 rounded text-xs">Garbage Total</code>,{" "}
          <code className="bg-amber-100 px-1 rounded text-xs">nan</code>). Categorized
          by whether the orphan is data-integrity-clean and what peers exist at the
          same property + GL.
        </p>
      </div>

      {corruptedRows.length > 0 && (
        <Section
          title="⛔ Corrupted — clean up before merge"
          count={corruptedRows.length}
          tone="red"
          description="The invoices linked to this orphan come from a property other than the orphan UA itself (or from multiple properties). Auto-merge would propagate the corruption into the merge target. Run the unlink SQL first, then refresh this page — once cleaned, the orphan will reappear under Auto-merge or Historical-only."
        >
          {corruptedRows.map(renderRow)}
        </Section>
      )}

      {mergeRows.length > 0 && (
        <Section
          title="Auto-merge"
          count={mergeRows.length}
          tone="green"
          description="A real (non-placeholder) UA exists at the same property + GL. Safe to merge the orphan into it. Generated SQL includes a property-alignment guardrail that aborts if any source invoice belongs to a different property than the target."
        >
          {mergeRows.map(renderRow)}
        </Section>
      )}

      {reviewRows.length > 0 && (
        <Section
          title="Needs review"
          count={reviewRows.length}
          tone="amber"
          description="Either multiple real UAs exist at this property + GL (e.g. compactor + recycle), or the orphan and target have very different per-invoice averages (suggesting they're different services on a combined bill). A human must decide what to do."
        >
          {reviewRows.map(renderRow)}
        </Section>
      )}

      {historicalRows.length > 0 && (
        <Section
          title="Historical-only — fill in account number when next bill arrives"
          count={historicalRows.length}
          tone="slate"
          description="No other UA exists at this property + GL. The orphan IS the canonical UA holding all historical invoices for this vendor at this property. Don't merge — instead, update the account number when the next live bill arrives."
        >
          {historicalRows.map(renderRow)}
        </Section>
      )}
    </div>
  );
}

function Section({
  title, count, tone, description, children,
}: {
  title: string;
  count: number;
  tone: "red" | "green" | "amber" | "slate";
  description: string;
  children: React.ReactNode;
}) {
  const toneClasses = {
    red: "text-red-800",
    green: "text-green-800",
    amber: "text-amber-800",
    slate: "text-nurock-slate",
  }[tone];
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className={cn("text-sm font-semibold uppercase tracking-wide", toneClasses)}>
          {title} ({count})
        </h2>
      </div>
      <p className="text-xs text-nurock-slate mb-3">{description}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function OrphanCard({
  row, expanded, onToggle, onCopy, copied,
}: {
  row: OrphanRow;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const { ua, category, invoiceCount, invoiceTotal, candidates, mergeSql } = row;

  const badgeStyle = {
    corrupted_orphan: "bg-red-100 text-red-800",
    merge_target: "bg-green-100 text-green-700",
    multi_stream_review: "bg-amber-100 text-amber-800",
    historical_only: "bg-gray-100 text-gray-700",
  }[category];

  const badgeLabel = {
    corrupted_orphan: "Corrupted",
    merge_target: "Auto-merge",
    multi_stream_review: "Review",
    historical_only: "Historical-only",
  }[category];

  return (
    <div className={cn(
      "card",
      category === "corrupted_orphan" && "border-red-200 bg-red-50/40",
      category === "historical_only" && "border-gray-200 bg-gray-50/40",
    )}>
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
            <span className={cn("badge text-xs", badgeStyle)}>
              {badgeLabel}
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

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
          {/* Corrupted-orphan breakdown — surfaces above everything else */}
          {category === "corrupted_orphan" && row.corruptionDetail && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-900">
              <div className="font-semibold mb-1">Property mismatch</div>
              <p className="text-xs leading-relaxed font-mono">{row.corruptionDetail}</p>
              <p className="text-xs mt-2 leading-relaxed">
                The unlink SQL below will set <code className="bg-red-100 px-1 rounded">utility_account_id = NULL</code>{" "}
                on every invoice whose property doesn&apos;t match this UA&apos;s property.
                Those invoices will then surface in the relevant tracker under the
                synthetic &quot;Historical / unmapped invoices&quot; row, where they can
                be relinked to the correct UA manually.
              </p>
            </div>
          )}

          {/* Per-invoice average mismatch warning */}
          {row.avgWarning && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
              <div className="font-semibold mb-1">Per-invoice average mismatch</div>
              <p className="text-xs leading-relaxed">{row.avgWarning}</p>
            </div>
          )}

          {category === "merge_target" && candidates[0] && (
            <div>
              <div className="text-xs font-semibold text-nurock-slate uppercase tracking-wide mb-2">
                Merge target
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
                <div className="font-medium text-green-800">{candidates[0].vendor?.name ?? ua.vendor?.name}</div>
                <div className="text-green-700 text-xs mt-0.5">
                  acct: <code>{candidates[0].account_number}</code>
                  &nbsp;·&nbsp;{candidates[0].invoiceCount} invoices
                  &nbsp;·&nbsp;${candidates[0].invoiceTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}

          {category === "multi_stream_review" && candidates.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-nurock-slate uppercase tracking-wide mb-2">
                {candidates.length === 1
                  ? "Possible merge target (use only after verifying)"
                  : `Possible merge targets (${candidates.length})`}
              </div>
              <div className="space-y-2">
                {candidates.map(c => (
                  <div key={c.id} className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
                    <div className="font-medium text-amber-900">{c.vendor?.name}</div>
                    <div className="text-amber-800 text-xs mt-0.5">
                      acct: <code>{c.account_number}</code>
                      &nbsp;·&nbsp;{c.invoiceCount} invoices
                      &nbsp;·&nbsp;${c.invoiceTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {category === "historical_only" && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700">
              <p>
                This is the only UA for {ua.vendor?.name} at {ua.property?.code} / GL {ua.gl?.code}.
                Its account number is a placeholder from the historical import. When the next live
                bill arrives for this vendor at this property, copy the real account number from the
                bill and update this UA — don&apos;t create a new one.
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-nurock-slate uppercase tracking-wide">
                {category === "corrupted_orphan" ? "Cleanup SQL (run first)"
                  : category === "merge_target" ? "Merge SQL"
                  : category === "multi_stream_review" ? "Manual merge template"
                  : "Reference SQL (when bill arrives)"}
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

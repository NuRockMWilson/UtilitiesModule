"use client";

import { useState, useTransition } from "react";

/**
 * Admin-only button to trigger a full variance recompute across all
 * historical invoices. Calls POST /api/variance/recompute and shows the
 * result inline.
 *
 * Useful after importing new historical data or after tuning per-account
 * variance thresholds — both of which invalidate previously computed
 * variance_flagged values.
 */
export function VarianceRecomputeButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  function trigger(dryRun: boolean) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await fetch(
          `/api/variance/recompute${dryRun ? "?dryRun=1" : ""}`,
          { method: "POST" },
        );
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? `HTTP ${r.status}`);
          return;
        }
        setResult(data);
      } catch (e: any) {
        setError(e.message ?? "Request failed");
      }
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <div className="font-display font-semibold text-nurock-black mb-1">
          Variance recompute
        </div>
        <div className="text-[12.5px] text-nurock-slate">
          Re-runs the trailing-12-month baseline analysis against every historical
          invoice. Marks anything above the per-account variance threshold as flagged.
          Run after importing new historical data or after changing per-account thresholds.
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => trigger(true)}
          disabled={pending}
          className="btn-secondary"
        >
          {pending ? "Working…" : "Dry run"}
        </button>
        <button
          type="button"
          onClick={() => trigger(false)}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? "Working…" : "Recompute & save"}
        </button>
      </div>
      {error && (
        <div className="text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <div className="bg-[#FAFBFC] border border-nurock-border rounded-md px-3 py-2.5 text-[12.5px]">
          <div className="font-medium text-nurock-black mb-1">
            {result.dryRun ? "Dry run complete" : "Recompute complete"}
          </div>
          <div className="grid grid-cols-4 gap-2 text-nurock-slate">
            <Stat label="Accounts" value={result.accounts} />
            <Stat label="Invoices" value={result.invoices} />
            <Stat label="Flagged"  value={result.flagged}   accent="amber" />
            <Stat label="Clean"    value={result.unflagged} accent="green" />
          </div>
          {result.errors?.length > 0 && (
            <div className="mt-2 text-[11.5px] text-flag-red">
              {result.errors.length} errors{result.moreErrors > 0 ? ` (+${result.moreErrors} more)` : ""}:
              <ul className="list-disc pl-5 mt-1">
                {result.errors.slice(0, 5).map((e: any, i: number) => (
                  <li key={i}>{e.account}: {e.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "amber" | "green" }) {
  const cls = accent === "amber" ? "text-flag-amber"
            : accent === "green" ? "text-flag-green"
            : "text-nurock-black";
  return (
    <div>
      <div className="text-[10px] font-display uppercase tracking-[0.08em] text-nurock-slate">{label}</div>
      <div className={`text-[18px] font-semibold num ${cls}`}>{value}</div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Button that POSTs to /api/invoices/{id}/extract-children to run
 * extraction on every child of a compiled-parent invoice. Shown on
 * the parent's detail page when there are children in `extracting`
 * state.
 *
 * The endpoint runs extractions sequentially and may take 60-180s
 * for a 7-bill compiled PDF (one ~10s LLM call per child plus
 * downstream processing). We show a button-disabled-with-spinner
 * state during the call. On completion, refresh the page so child
 * invoice statuses update.
 */
export function ExtractChildrenButton({
  parentId,
  pendingCount,
}: {
  parentId:     string;
  pendingCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [result, setResult]   = useState<{ ok: number; fail: number } | null>(null);

  async function run() {
    setErr(null);
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/invoices/${parentId}/extract-children`, {
        method: "POST",
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
      } else {
        setResult({ ok: j.succeeded, fail: j.failed });
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (pendingCount === 0) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-primary"
        disabled={running || isPending}
        onClick={run}
      >
        {running
          ? `Extracting ${pendingCount} bill${pendingCount === 1 ? "" : "s"}…`
          : `Run extraction on ${pendingCount} pending child${pendingCount === 1 ? "" : "ren"}`}
      </button>
      {running && (
        <p className="text-xs text-nurock-slate-light">
          This may take 1-2 minutes — one LLM call per child bill, in series.
        </p>
      )}
      {err && (
        <p className="text-xs text-red-600">Error: {err}</p>
      )}
      {result && (
        <p className="text-xs text-nurock-slate">
          {result.ok} succeeded, {result.fail} failed.
        </p>
      )}
    </div>
  );
}

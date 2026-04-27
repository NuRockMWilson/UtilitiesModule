"use client";

import { useState, useTransition } from "react";

/**
 * Phase A self-test trigger. Validates that a synthetic invoice flows
 * through every pipeline stage (account resolution → variance →
 * GL coding → Sage adapter → AP Import file generation).
 *
 * No database writes happen; this is purely a wiring check.
 */
export function PipelineSelfTestButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [propertyCode, setPropertyCode] = useState("");

  function trigger() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const qs = propertyCode ? `?propertyCode=${encodeURIComponent(propertyCode)}` : "";
        const r = await fetch(`/api/test/pipeline${qs}`, { method: "POST" });
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
          Phase A — Pipeline self-test
        </div>
        <div className="text-[12.5px] text-nurock-slate">
          Walks a synthetic invoice through the full pipeline (account resolution,
          variance check, GL coding, Sage AP Import generation) without writing to
          the database. Confirms wiring before real bills arrive — when extraction
          starts to fail later, you can rule out downstream bugs first.
        </div>
      </div>
      <div className="flex items-end gap-2 pt-1">
        <div>
          <label className="block text-[10px] font-display uppercase tracking-[0.06em] text-nurock-slate mb-1">
            Property code (optional)
          </label>
          <input
            type="text"
            value={propertyCode}
            onChange={(e) => setPropertyCode(e.target.value)}
            placeholder="601"
            className="input w-32"
          />
        </div>
        <button
          type="button"
          onClick={trigger}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? "Running…" : "Run self-test"}
        </button>
      </div>
      {error && (
        <div className="text-[12.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <div className={`border-l-4 ${result.ok ? "border-l-flag-green" : "border-l-flag-amber"} bg-[#FAFBFC] rounded-md px-4 py-3 space-y-3`}>
          <div className="text-[13px] font-medium text-nurock-black">
            {result.ok ? "✓ All stages OK" : "⚠ At least one stage failed"}
          </div>
          <div className="text-[12px] text-nurock-slate">{result.summary}</div>
          <ul className="space-y-1.5">
            {result.steps.map((s: any, i: number) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className={`flex-shrink-0 w-4 h-4 rounded-full mt-0.5 inline-flex items-center justify-center text-[10px] ${s.ok ? "bg-flag-green text-white" : "bg-flag-red text-white"}`}>
                  {s.ok ? "✓" : "✗"}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-nurock-black">{s.name}</div>
                  {s.detail && <div className="text-nurock-slate text-[11.5px]">{s.detail}</div>}
                  {s.data?.artifact_preview && (
                    <pre className="mt-1.5 bg-white border border-nurock-border rounded p-2 text-[10.5px] font-mono whitespace-pre overflow-x-auto max-h-32">{s.data.artifact_preview}</pre>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

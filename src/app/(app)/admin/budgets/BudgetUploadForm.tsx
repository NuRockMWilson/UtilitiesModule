"use client";

import { useState, useTransition } from "react";
import { uploadBudgetCSV, type BudgetUploadResult } from "./actions";

/**
 * Client wrapper for the budget CSV upload. Handles file selection, calls
 * the server action, and renders a result panel showing how many rows were
 * inserted, skipped, and why.
 */
export function BudgetUploadForm() {
  const [result, setResult] = useState<BudgetUploadResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await uploadBudgetCSV(fd);
      setResult(r);
      // Reset the file input so a second upload of the same file re-fires
      e.currentTarget.reset();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="card p-5 space-y-4">
        <div>
          <label className="block text-[12px] font-display uppercase tracking-[0.06em] text-nurock-slate mb-2">
            CSV file
          </label>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-[13px] text-nurock-black file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-[12px] file:font-medium file:bg-nurock-navy file:text-white hover:file:bg-nurock-navy-light file:cursor-pointer"
          />
          <div className="text-[11.5px] text-nurock-slate-light mt-2">
            Required columns: <span className="font-mono">property_code, gl_code, year, month, amount</span>.
            Month may be blank for annual budgets.
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2 border-t border-nurock-border">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Uploading…" : "Upload budget CSV"}
          </button>
          <a
            href="data:text/csv;charset=utf-8,property_code%2Cgl_code%2Cyear%2Cmonth%2Camount%0A555%2C5120%2C2026%2C1%2C1500.00%0A555%2C5120%2C2026%2C2%2C1500.00%0A555%2C5125%2C2026%2C1%2C1850.00"
            download="budget-template.csv"
            className="btn-ghost"
          >
            Download template
          </a>
        </div>
      </form>

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: BudgetUploadResult }) {
  return (
    <div className={`card p-5 border-l-4 ${result.ok ? "border-l-flag-green" : "border-l-flag-red"}`}>
      <div className="font-display font-semibold text-nurock-black mb-2">
        {result.ok ? "Upload complete" : "Upload failed"}
      </div>
      {result.error && (
        <div className="text-[12.5px] text-flag-red mb-3">{result.error}</div>
      )}
      <div className="grid grid-cols-3 gap-4 text-[12.5px]">
        <Stat label="Rows in file"        value={result.rowsTotal} />
        <Stat label="Inserted"            value={result.rowsInserted} accent={result.rowsInserted > 0 ? "green" : undefined} />
        <Stat label="Skipped"             value={result.rowsSkipped.length} accent={result.rowsSkipped.length > 0 ? "amber" : undefined} />
      </div>
      {result.rowsSkipped.length > 0 && (
        <div className="mt-4 pt-3 border-t border-nurock-border">
          <div className="text-[11px] font-display uppercase tracking-[0.08em] text-nurock-slate mb-2">
            Skipped rows
          </div>
          <ul className="text-[12px] space-y-1 max-h-[200px] overflow-y-auto">
            {result.rowsSkipped.slice(0, 50).map((s, i) => (
              <li key={i} className="text-nurock-slate">
                <span className="font-mono text-nurock-black">Row {s.row}:</span> {s.reason}
              </li>
            ))}
            {result.rowsSkipped.length > 50 && (
              <li className="text-nurock-slate-light italic">
                …and {result.rowsSkipped.length - 50} more.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "green" | "amber" }) {
  const cls = accent === "green" ? "text-flag-green"
            : accent === "amber" ? "text-flag-amber"
            : "text-nurock-black";
  return (
    <div>
      <div className="text-[10px] font-display uppercase tracking-[0.08em] text-nurock-slate">{label}</div>
      <div className={`text-[20px] font-semibold num mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

/**
 * Sage 300 Construction and Real Estate adapter.
 *
 * 300 CRE has no modern REST API. The practical integration pattern is
 * Sage's AP Invoice Import — a delimited text file that Sharon imports
 * from the Sage client via AP Tasks → Import Invoices.
 *
 * This adapter generates the file in memory and returns its contents.
 * The caller (src/lib/sage/batch.ts) is responsible for storing it in
 * Supabase Storage and producing a signed download URL — that way the
 * whole flow runs on Vercel without any filesystem access.
 *
 * File format is Sage's standard "Import Invoice" spec: pipe-delimited,
 * one row per distribution line. Update the header/row templates if your
 * Sage install uses a custom .apn layout.
 */

import type { SageAdapter, SageInvoiceBatch, SagePostResult } from "./adapter";

function csvEscape(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes("|") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatRow(fields: Array<string | number | undefined | null>): string {
  return fields.map(csvEscape).join("|");
}

export const sage300cre: SageAdapter = {
  system: "sage_300_cre",

  async postBatch(batch: SageInvoiceBatch): Promise<SagePostResult> {
    // Sage 300 CRE AP Invoice Import — one line per distribution.
    // Columns (Sage standard): vendor_id | invoice_no | invoice_date |
    //   due_date | gl_account | amount | description | period_start | period_end
    const rows = batch.invoices.map(inv => formatRow([
      inv.vendor_id,
      inv.invoice_number,
      inv.invoice_date,
      inv.due_date,
      inv.gl_coding,
      inv.amount.toFixed(2),
      inv.description.slice(0, 30),
      inv.service_period_start ?? "",
      inv.service_period_end ?? "",
    ]));

    const content = rows.join("\r\n") + "\r\n";   // CRLF for the Sage importer
    const filename = `ap_import_${batch.batch_reference}.txt`;

    return {
      success: true,
      batch_reference: batch.batch_reference,
      artifact_content: content,
      artifact_filename: filename,
      per_invoice: batch.invoices.map(inv => ({
        internal_id: inv.internal_id,
        sage_invoice_id: inv.invoice_number,    // echo until Sharon confirms
        posted: true,
      })),
    };
  },

  async healthCheck() {
    // File generation is pure — always ready. The only dependency is the
    // presence of Supabase Storage for artifact storage, which is checked
    // by the batch.ts caller.
    return { ok: true, detail: "300 CRE AP Import generator ready (in-memory)" };
  },
};

/**
 * Sage 300 Construction and Real Estate adapter — Accounts Payable Import.
 *
 * Sage 300 CRE has no modern REST API. The integration pattern documented in
 * the AP Import Format Journal uses a comma-delimited text file with TWO
 * record types per invoice:
 *
 *   API — invoice header (16 fields)
 *     API, Vendor, Invoice, Description, Amount, Discount Offered,
 *     Invoice Date, Discount Date, Payment Date, Accounting Date,
 *     Smry Payee Name, Smry Payee Address 1, Smry Payee Address 2,
 *     Smry Payee City, Smry Payee State, Smry Payee ZIP
 *
 *   APD — distribution line (15 fields, one or more per invoice)
 *     APD, Subcontract, Subcontract Line Item, Job, Extra, Cost Code,
 *     Category, Expense Account, Accounts Payable Account, Amount,
 *     Retainage, 1099 Exempt, Draw, Description, Joint Payee
 *
 * Field formats from the spec:
 *   Alpha N        — text, max N characters
 *   Numeric -9.2   — up to 9 digits, 2 decimals, optional minus
 *   Date           — Sage's MM/DD/YYYY default
 *   Check Box      — "Y" or blank
 *   xxx-xxx-xxxx.xx — Expense Account format (e.g. "500-601-5120.00")
 *
 * For utility AP, each invoice has one distribution (one expense GL),
 * so we emit one API row + one APD row per invoice. If we ever need to
 * split an invoice across multiple GLs (e.g. shared services billed to
 * multiple cost codes), the SageInvoicePayload would need to gain a
 * `distributions: []` field — currently it carries one gl_coding per row.
 */

import type { SageAdapter, SageInvoiceBatch, SagePostResult } from "./adapter";

/** Field length cap from the spec — values longer than this get truncated. */
const FIELD_LIMITS = {
  vendor:           10,
  invoice:          15,
  description:      30,
  smry_payee_name:  30,
  smry_addr1:       33,
  smry_addr2:       33,
  smry_city:        30,
  smry_state:        4,
  smry_zip:         10,
  expense_account:  15,   // "500-601-5120.00" is 15 exactly
  ap_account:       15,
  apd_description:  30,
  joint_payee:      30,
  subcontract:      12,
  job:               6,
  extra:            10,
  cost_code:         6,
  category:          3,
  draw:             15,
} as const;

/** Trim and truncate to spec length. Empty strings become empty fields. */
function alpha(v: string | null | undefined, max: number): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().slice(0, max);
}

/** Sage 300 CRE numeric format — plain decimal, no $ or commas, 2 decimals.
 *  Spec says "-9.2" so up to 9 integer digits plus 2 fractional. */
function numeric(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return Number(v).toFixed(decimals);
}

/** Convert YYYY-MM-DD or Date → MM/DD/YYYY (Sage's display default). */
function sageDate(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = d.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

/** Escape a single CSV field per RFC 4180 — quote if contains comma, quote, or newline. */
function csvEscape(v: string): string {
  if (v === "") return "";
  if (/[,"\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function formatRow(fields: Array<string>): string {
  return fields.map(csvEscape).join(",");
}

/**
 * AP/Cash AP Account — historically NuRock posts utility AP to one company-wide
 * Accounts Payable GL. If your COA puts AP on a per-property GL, set the
 * SAGE_AP_ACCOUNT env var to override or wire it through SageInvoicePayload.
 */
const DEFAULT_AP_ACCOUNT = process.env.SAGE_AP_ACCOUNT ?? "200-000-2010.00";

export const sage300cre: SageAdapter = {
  system: "sage_300_cre",

  async postBatch(batch: SageInvoiceBatch): Promise<SagePostResult> {
    const lines: string[] = [];

    for (const inv of batch.invoices) {
      // ---- API: invoice header ----
      const apiRow = formatRow([
        "API",
        alpha(inv.vendor_id,      FIELD_LIMITS.vendor),
        alpha(inv.invoice_number, FIELD_LIMITS.invoice),
        alpha(inv.description,    FIELD_LIMITS.description),
        numeric(inv.amount),
        numeric(0),                      // Discount Offered — none
        sageDate(inv.invoice_date),
        sageDate(inv.invoice_date),      // Discount Date — same as invoice
        sageDate(inv.due_date),          // Payment Date
        sageDate(inv.invoice_date),      // Accounting Date — bill it in the period it arrived
        // Summary payee fields are only used when the vendor isn't already
        // set up in Sage. NuRock's vendors are pre-loaded so we leave these blank.
        "", "", "", "", "", "",
      ]);

      // ---- APD: one distribution per invoice ----
      const apdRow = formatRow([
        "APD",
        "",                                         // Subcontract — N/A for utility AP
        "",                                         // Subcontract Line Item
        "",                                         // Job — utility AP isn't job-coded
        "",                                         // Extra
        "",                                         // Cost Code — N/A
        "",                                         // Category — N/A
        alpha(inv.gl_coding,        FIELD_LIMITS.expense_account),
        DEFAULT_AP_ACCOUNT,                         // AP Account
        numeric(inv.amount),
        numeric(0),                                 // Retainage
        "",                                         // 1099 Exempt — let Sage default
        "",                                         // Draw
        alpha(inv.description,      FIELD_LIMITS.apd_description),
        "",                                         // Joint Payee
      ]);

      lines.push(apiRow);
      lines.push(apdRow);
    }

    // CRLF line endings — Sage's importer is Windows-native
    const content = lines.join("\r\n") + "\r\n";
    const filename = `ap_import_${batch.batch_reference}.txt`;

    return {
      success: true,
      batch_reference: batch.batch_reference,
      artifact_content: content,
      artifact_filename: filename,
      per_invoice: batch.invoices.map(inv => ({
        internal_id: inv.internal_id,
        sage_invoice_id: inv.invoice_number,
        posted: true,
      })),
    };
  },

  async healthCheck() {
    return {
      ok: true,
      detail: `300 CRE AP Import generator ready (API+APD format, AP account=${DEFAULT_AP_ACCOUNT})`,
    };
  },
};

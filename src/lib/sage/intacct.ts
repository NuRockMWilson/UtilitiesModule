/**
 * Sage Intacct adapter (stub — to be filled in when NuRock completes the
 * migration from 300 CRE).
 *
 * Intacct exposes a SOAP/XML API (classic) and a newer REST API. For AP
 * invoice creation:
 *   POST /services/v3/objects/accounts-payable/bill
 *   with headers: X-Sender-Id, authorization (basic with user credentials)
 *
 * Reference: https://developer.intacct.com/
 *
 * To activate:
 *   1. Fill the SAGE_INTACCT_* env vars
 *   2. Set properties.sage_system = 'sage_intacct' for migrated properties
 *   3. Replace the stub below with the real REST call
 */

import type { SageAdapter, SageInvoiceBatch, SagePostResult } from "./adapter";

const intacctConfigured = () =>
  !!(process.env.SAGE_INTACCT_COMPANY_ID &&
     process.env.SAGE_INTACCT_USER_ID &&
     process.env.SAGE_INTACCT_USER_PASSWORD &&
     process.env.SAGE_INTACCT_SENDER_ID &&
     process.env.SAGE_INTACCT_SENDER_PASSWORD);

export const intacct: SageAdapter = {
  system: "sage_intacct",

  async postBatch(batch: SageInvoiceBatch): Promise<SagePostResult> {
    if (!intacctConfigured()) {
      return {
        success: false,
        batch_reference: batch.batch_reference,
        per_invoice: batch.invoices.map(inv => ({
          internal_id: inv.internal_id,
          sage_invoice_id: null,
          posted: false,
          error: "Intacct credentials not configured — see SAGE_INTACCT_* env vars",
        })),
      };
    }

    // TODO: replace with real Intacct REST calls.
    //   POST /services/v3/objects/accounts-payable/bill per invoice:
    //     {
    //       vendorId: inv.vendor_id,
    //       billNumber: inv.invoice_number,
    //       billDate: inv.invoice_date,
    //       dueDate: inv.due_date,
    //       description: inv.description,
    //       lines: [{ accountNumber: inv.gl_coding, amount: inv.amount }]
    //     }
    // Intacct posts directly via API — no artifact is returned.
    throw new Error("Intacct posting not yet implemented — fill in src/lib/sage/intacct.ts");
  },

  async healthCheck() {
    return intacctConfigured()
      ? { ok: false, detail: "Intacct credentials present, adapter implementation pending" }
      : { ok: false, detail: "Intacct credentials not configured" };
  },
};

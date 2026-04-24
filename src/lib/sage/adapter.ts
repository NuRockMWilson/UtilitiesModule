/**
 * Sage adapter interface.
 *
 * NuRock is on Sage 300 CRE today and transitioning to Sage Intacct. The
 * rest of the app stays agnostic — it posts invoices through an adapter
 * selected per-property (or globally) via the `sage_system` column on the
 * properties table. During the migration you can cut over one property at
 * a time without touching any AP workflow code.
 *
 * The adapter returns a SagePostResult. For 300 CRE this includes the
 * in-memory bytes of the AP Import file (so the caller can stash them in
 * Supabase Storage and hand Sharon a signed download link). For Intacct
 * the REST calls happen inline and no artifact is returned.
 */

export interface SageInvoiceBatch {
  batch_reference: string;
  invoices: SageInvoicePayload[];
}

export interface SageInvoicePayload {
  internal_id: string;
  vendor_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  gl_coding: string;
  amount: number;
  description: string;
  service_period_start?: string;
  service_period_end?: string;
}

export interface SagePostResult {
  success: boolean;
  batch_reference: string;
  per_invoice: Array<{
    internal_id: string;
    sage_invoice_id: string | null;
    posted: boolean;
    error?: string;
  }>;
  /** 300 CRE only: the generated AP Import file contents as UTF-8 text. */
  artifact_content?: string;
  /** Suggested filename for the download. */
  artifact_filename?: string;
}

export interface SageAdapter {
  readonly system: "sage_300_cre" | "sage_intacct";

  postBatch(batch: SageInvoiceBatch): Promise<SagePostResult>;

  getInvoiceStatus?(sage_invoice_id: string): Promise<{
    status: "open" | "paid" | "void" | "unknown";
    check_number?: string;
    paid_date?: string;
  }>;

  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

import { sage300cre } from "./sage300cre";
import { intacct }    from "./intacct";

export function getAdapter(system: "sage_300_cre" | "sage_intacct"): SageAdapter {
  return system === "sage_intacct" ? intacct : sage300cre;
}

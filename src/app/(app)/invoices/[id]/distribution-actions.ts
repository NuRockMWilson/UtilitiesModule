"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatGLCoding } from "@/lib/coding";

export type DistributionResult = { ok: boolean; error?: string };

const EDITABLE_STATUSES = new Set([
  "new", "extracting", "extraction_failed",
  "needs_coding", "needs_variance_note",
  "ready_for_approval", "rejected",
]);

// Each row submitted from the form has: id (existing line id, blank for new),
// gl_account_id, sub_code, description, amount.
type ParsedLine = {
  id?:            string;
  gl_account_id:  string;
  sub_code:       string;
  description:    string;
  amount:         number;
};

/**
 * Replace the full set of distribution lines on an invoice. Used when the
 * user splits a single invoice across multiple GL accounts (e.g. a Comcast
 * bill that covers both phone service and pool-line service).
 *
 * Reconciliation: the sum of line amounts must equal `total_amount_due`
 * within $0.02. The UI surfaces the delta live, but we re-check on the
 * server to keep stale clients honest.
 *
 * Strategy: we accept the desired full set of lines per submit, delete the
 * existing rows for this invoice, and insert the new set. That's simpler
 * than diffing and is fine for the volumes here (a typical bill has 1–3
 * distributions, max ~10 for the heaviest multi-account roll-ups).
 *
 * After saving, the invoice's `gl_coding` is set to the line whose amount
 * is largest — for backwards-compat with downstream code that reads the
 * single coding string. The Sage adapter expands all line items into
 * separate APD records at post time.
 */
export async function saveDistributions(formData: FormData): Promise<DistributionResult> {
  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  if (!invoiceId) return { ok: false, error: "Missing invoice id" };

  const supabase = createSupabaseServerClient();

  const { data: invoice, error: getErr } = await supabase
    .from("invoices")
    .select("id, status, property_id, total_amount_due, source_reference")
    .eq("id", invoiceId)
    .single();
  if (getErr || !invoice) return { ok: false, error: getErr?.message ?? "Invoice not found" };
  const isHistorical = typeof invoice.source_reference === "string"
    && invoice.source_reference.startsWith("historical-");
  if (!EDITABLE_STATUSES.has(invoice.status) && !isHistorical) {
    return { ok: false, error: `Cannot edit distributions on an invoice in status "${invoice.status}".` };
  }

  // Parse rows out of the form. Form fields are flat-named like
  // `lines[0].gl_account_id`, `lines[0].amount`, etc. Walk by index.
  const lines: ParsedLine[] = [];
  for (let i = 0; ; i++) {
    const gl = formData.get(`lines[${i}].gl_account_id`);
    if (gl === null) break;   // no more rows
    const id          = String(formData.get(`lines[${i}].id`) ?? "").trim() || undefined;
    const subCode     = String(formData.get(`lines[${i}].sub_code`) ?? "00").trim() || "00";
    const description = String(formData.get(`lines[${i}].description`) ?? "").trim();
    const amountRaw   = String(formData.get(`lines[${i}].amount`) ?? "").trim();

    const glId = String(gl).trim();
    if (!glId) continue;          // user left a row blank — skip

    const amount = Number(amountRaw.replace(/[$,]/g, ""));
    if (!Number.isFinite(amount)) {
      return { ok: false, error: `Row ${i + 1}: amount "${amountRaw}" is not a number.` };
    }
    if (!description) {
      return { ok: false, error: `Row ${i + 1}: description is required.` };
    }

    lines.push({ id, gl_account_id: glId, sub_code: subCode, description, amount });
  }

  if (lines.length === 0) {
    // Empty distributions = revert to single-line behavior. Just clear the
    // table for this invoice; the original invoices.gl_coding stays as-is.
    await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
    revalidatePath(`/invoices/${invoiceId}`);
    return { ok: true };
  }

  // Reconciliation check
  const sum   = lines.reduce((s, l) => s + l.amount, 0);
  const total = Number(invoice.total_amount_due ?? 0);
  const delta = Math.round((sum - total) * 100) / 100;
  if (Math.abs(delta) > 0.02) {
    return {
      ok: false,
      error: `Sum of distributions ($${sum.toFixed(2)}) doesn't match total due ($${total.toFixed(2)}). Off by $${delta.toFixed(2)}.`,
    };
  }

  // Resolve property code + GL codes so we can build gl_coding strings.
  // The property code we already have (FK on invoice). The GL codes come
  // from a single fetch.
  const { data: prop } = await supabase
    .from("properties")
    .select("code")
    .eq("id", invoice.property_id)
    .single();
  if (!prop?.code) {
    return { ok: false, error: "Invoice has no linked property — link the bill first, then split distributions." };
  }
  const glIds = Array.from(new Set(lines.map(l => l.gl_account_id)));
  const { data: gls } = await supabase
    .from("gl_accounts")
    .select("id, code")
    .in("id", glIds);
  const glMap = new Map((gls ?? []).map(g => [g.id, g.code]));

  // Replace the existing rows
  await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
  const inserts = lines.map(l => {
    const glCode = glMap.get(l.gl_account_id) ?? "";
    return {
      invoice_id:    invoiceId,
      gl_account_id: l.gl_account_id,
      sub_code:      l.sub_code.padStart(2, "0"),
      gl_coding:     formatGLCoding({ property_code: prop.code, gl_code: glCode, sub_code: l.sub_code }),
      description:   l.description,
      amount:        l.amount,
      is_consumption_based: true,
    };
  });
  const { error: insErr } = await supabase.from("invoice_line_items").insert(inserts);
  if (insErr) return { ok: false, error: `Failed to save distributions: ${insErr.message}` };

  // Update the invoice's primary gl_coding to the largest-amount line for
  // backwards-compat with downstream code that reads the single string.
  const primary = inserts.reduce((max, l) => l.amount > max.amount ? l : max, inserts[0]);
  await supabase.from("invoices").update({
    gl_coding:     primary.gl_coding,
    gl_account_id: primary.gl_account_id,
  }).eq("id", invoiceId);

  // Audit log entry
  await supabase.from("approval_log").insert({
    invoice_id: invoiceId,
    action:     "distributions_saved",
    notes:      `Saved ${lines.length} distribution line${lines.length === 1 ? "" : "s"} totaling $${sum.toFixed(2)}`,
    metadata:   { lines: inserts.map(l => ({ gl_coding: l.gl_coding, description: l.description, amount: l.amount })) },
  });

  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}

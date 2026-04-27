"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export type DeleteResult = { ok: boolean; error?: string };

// Statuses where deletion is safe — the invoice has not yet been approved
// or posted to Sage, so removing the row doesn't leave a hole in the audit
// trail or a referenced-but-missing record in any Sage batch.
const DELETABLE_STATUSES = new Set([
  "new", "extracting", "extraction_failed",
  "needs_coding", "needs_variance_note",
  "ready_for_approval", "rejected",
]);

/**
 * Hard-delete a single invoice. Refuses to delete approved/posted rows.
 *
 * Cleans up:
 *   - The PDF in Supabase Storage (if any)
 *   - approval_log rows for this invoice
 *   - usage_readings rows for this invoice
 *   - variance_inquiries rows for this invoice
 *   - The invoice row itself
 *
 * Uses the service client so RLS doesn't block cascades.
 */
export async function deleteInvoice(formData: FormData): Promise<DeleteResult> {
  const id = String(formData.get("invoice_id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing invoice id" };

  const supabase = createSupabaseServerClient();
  const service  = createSupabaseServiceClient();

  // Status guard — only delete if not yet approved/posted
  const { data: inv, error: getErr } = await supabase
    .from("invoices")
    .select("id, status, pdf_path, sage_batch_id")
    .eq("id", id)
    .single();
  if (getErr || !inv) return { ok: false, error: getErr?.message ?? "Invoice not found" };

  if (!DELETABLE_STATUSES.has(inv.status)) {
    return {
      ok: false,
      error: `Cannot delete an invoice in status "${inv.status}". Approved and posted invoices stay in the system for audit. Reject the invoice first if you need to take it out of the workflow.`,
    };
  }
  if (inv.sage_batch_id) {
    return {
      ok: false,
      error: "Cannot delete an invoice that is already attached to a Sage batch.",
    };
  }

  // Cascade child records first (FK references)
  await service.from("approval_log").delete().eq("invoice_id", id);
  await service.from("usage_readings").delete().eq("invoice_id", id);
  await service.from("variance_inquiries").delete().eq("invoice_id", id);

  // Storage cleanup — best effort. A leftover PDF is a janitorial issue,
  // not a correctness one, so we don't fail the delete if cleanup fails.
  if (inv.pdf_path) {
    await service.storage.from("invoices").remove([inv.pdf_path]).catch(() => {});
  }

  const { error: delErr } = await service.from("invoices").delete().eq("id", id);
  if (delErr) return { ok: false, error: `Delete failed: ${delErr.message}` };

  revalidatePath("/invoices");
  return { ok: true };
}

/**
 * Wrapper used from the detail page Delete button — deletes then redirects
 * to the invoices list. Kept as a separate action because Server Actions
 * can't return-AND-redirect cleanly in one call from the same handler.
 */
export async function deleteInvoiceAndGoBack(formData: FormData): Promise<void> {
  const r = await deleteInvoice(formData);
  if (!r.ok) {
    // Re-throw as a string so the form's error boundary surfaces it.
    // The caller wraps deleteInvoiceAndGoBack in a try/catch that displays
    // the message; Next.js redirects can't carry payloads.
    throw new Error(r.error ?? "Delete failed");
  }
  redirect("/invoices");
}

/**
 * Bulk delete from the invoices list. Skips rows that aren't deletable
 * (approved/posted) and reports back a count of successes + skips.
 */
export async function bulkDeleteInvoices(formData: FormData): Promise<{
  ok: boolean;
  deleted: number;
  skipped: number;
  error?: string;
}> {
  const idsRaw = formData.getAll("invoice_ids") as string[];
  const ids = idsRaw.map(s => String(s).trim()).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, deleted: 0, skipped: 0, error: "No invoices selected" };
  }

  const supabase = createSupabaseServerClient();
  const service  = createSupabaseServiceClient();

  const { data: rows } = await supabase
    .from("invoices")
    .select("id, status, pdf_path, sage_batch_id")
    .in("id", ids);

  const deletable = (rows ?? []).filter(r =>
    DELETABLE_STATUSES.has(r.status) && !r.sage_batch_id
  );
  const skipped = ids.length - deletable.length;

  if (deletable.length === 0) {
    revalidatePath("/invoices");
    return { ok: false, deleted: 0, skipped, error: "None of the selected invoices are deletable (already approved or posted)" };
  }

  const deletableIds = deletable.map(d => d.id);
  await service.from("approval_log").delete().in("invoice_id", deletableIds);
  await service.from("usage_readings").delete().in("invoice_id", deletableIds);
  await service.from("variance_inquiries").delete().in("invoice_id", deletableIds);

  // Best-effort storage cleanup
  const paths = deletable.map(d => d.pdf_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    await service.storage.from("invoices").remove(paths).catch(() => {});
  }

  const { error: delErr } = await service.from("invoices").delete().in("id", deletableIds);
  if (delErr) {
    return { ok: false, deleted: 0, skipped, error: delErr.message };
  }

  revalidatePath("/invoices");
  return { ok: true, deleted: deletable.length, skipped };
}

/**
 * POST /api/invoices/[id]/attach-pdf
 *
 * Upload a PDF and attach it to an existing invoice. Useful for:
 *
 *   - Historical baseline rows (migration 0015) that were imported from the
 *     legacy spreadsheet without a PDF — users can retroactively attach the
 *     scanned bill as a paper trail.
 *   - Real bills where the original PDF was lost or replaced (e.g. vendor
 *     reissued the invoice).
 *
 * Behavior:
 *   - For historical invoices: the PDF is stored, but stored amounts are
 *     NOT overwritten by re-extraction. If the user wants to validate the
 *     PDF against the recorded amounts they can run extraction explicitly
 *     via a separate action (not implemented here yet).
 *   - For non-historical invoices: same — the PDF replaces whatever was
 *     there, but extracted fields are not auto-overwritten. The existing
 *     bill-detail editor is the authoritative source for amounts.
 *
 * The previous PDF (if any) is left in storage rather than deleted, so
 * there's an audit trail of every PDF that was ever attached to this
 * invoice. The most recent path is what `pdf_path` points to.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const invoiceId = params.id;
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: invoice, error: getErr } = await supabase
    .from("invoices")
    .select("id, pdf_path, source_reference, property:properties(code)")
    .eq("id", invoiceId)
    .single();
  if (getErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
  }

  // Build a stable storage path. Using invoice id prefix makes it easy to
  // find every PDF ever attached to this invoice, and the timestamp ensures
  // re-uploads don't collide with previous versions.
  const propertyCode = (invoice.property as any)?.code ?? "unknown";
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `attached/${propertyCode}/${invoiceId}/${Date.now()}_${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(storagePath, buffer, { contentType: "application/pdf" });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Update the invoice. We deliberately don't touch any other field — this
  // is a paper-trail attach, not a re-extraction. The previous pdf_path (if
  // any) is left in storage for audit; the row just points at the new one.
  const { error: updErr } = await supabase
    .from("invoices")
    .update({ pdf_path: storagePath })
    .eq("id", invoiceId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Audit log entry
  const isHistorical = typeof invoice.source_reference === "string"
    && invoice.source_reference.startsWith("historical-");
  await supabase.from("approval_log").insert({
    invoice_id: invoiceId,
    action:     isHistorical ? "pdf_attached_historical" : "pdf_attached",
    notes:      `PDF "${file.name}" attached${invoice.pdf_path ? " (replaced previous)" : ""}`,
    metadata:   {
      file_name:        file.name,
      file_size:        file.size,
      storage_path:     storagePath,
      previous_pdf_path: invoice.pdf_path ?? null,
      is_historical:    isHistorical,
    },
  });

  return NextResponse.json({ ok: true, storage_path: storagePath });
}

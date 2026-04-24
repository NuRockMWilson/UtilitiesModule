/**
 * Single-PDF intake endpoint.
 *
 * The companion folder watcher (watcher/watch-folder.mjs) POSTs here whenever
 * a new PDF lands in the watched folder. Authenticates via INTAKE_WEBHOOK_SECRET,
 * dedupes by content hash, stores the PDF in the `invoices` storage bucket,
 * inserts an invoice row, and kicks off extraction.
 *
 * Request:
 *   POST /api/ingest/pdf
 *   Headers:
 *     X-Intake-Secret: <INTAKE_WEBHOOK_SECRET>
 *     Content-Type: multipart/form-data
 *   Body (multipart):
 *     file:        the PDF (required)
 *     filename:    original filename (optional; derives from file.name otherwise)
 *     content_sha256: SHA-256 hex digest for dedup (optional but recommended)
 *     source_reference: any caller-supplied ref like the original folder path (optional)
 *
 * Response:
 *   { success: true, invoice_id, duplicate_of? }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import crypto from "node:crypto";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.INTAKE_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Intake not configured" }, { status: 500 });
  }
  if (request.headers.get("x-intake-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Multipart form-data required" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF uploads accepted" }, { status: 400 });
  }

  const suppliedHash = (formData.get("content_sha256") as string | null)?.trim();
  const filename = (formData.get("filename") as string | null) ?? file.name;
  const sourceRef = (formData.get("source_reference") as string | null) ?? filename;

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = suppliedHash ?? crypto.createHash("sha256").update(buffer).digest("hex");

  const supabase = createSupabaseServiceClient();

  // Dedup: if an invoice with this exact content hash already exists, skip
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("source_reference", `sha256:${hash}`)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      success: true,
      invoice_id: existing.id,
      duplicate_of: existing.id,
      note: "Content hash matches existing invoice; no action taken",
    });
  }

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const pdfPath = `intake/${hash.slice(0, 12)}_${safe}`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(pdfPath, buffer, { contentType: "application/pdf", upsert: false });

  if (upErr && !upErr.message.includes("already exists")) {
    return NextResponse.json({ error: `Storage: ${upErr.message}` }, { status: 500 });
  }

  const { data: invoice, error: insertErr } = await supabase
    .from("invoices")
    .insert({
      pdf_path: pdfPath,
      status: "new",
      source: "scan",
      source_reference: `sha256:${hash}`,
    })
    .select("id")
    .single();

  if (insertErr || !invoice) {
    return NextResponse.json({ error: `DB: ${insertErr?.message}` }, { status: 500 });
  }

  // Kick off extraction asynchronously
  fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/extract/${invoice.id}`, { method: "POST" })
    .catch(() => {});

  return NextResponse.json({
    success: true,
    invoice_id: invoice.id,
    filename: safe,
    stored_at: pdfPath,
    source_reference: sourceRef,
  });
}

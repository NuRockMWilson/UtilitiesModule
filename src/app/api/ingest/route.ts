/**
 * Inbound email webhook — Resend, SendGrid, or Cloudflare Email Routing
 * can post structured email payloads to this endpoint. We extract PDF
 * attachments, upload each to Supabase Storage, and spawn one `invoice`
 * row per attachment in `new` status. Extraction is kicked off async.
 *
 * The endpoint is exempt from middleware auth (see middleware.ts matcher),
 * but callers must include INTAKE_WEBHOOK_SECRET in the X-Intake-Secret
 * header.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.INTAKE_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Intake webhook not configured" }, { status: 500 });
  }
  if (request.headers.get("x-intake-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Expected shape (generic — tolerant of vendor variation):
  //   { from, subject, message_id, attachments: [{ filename, content_type, content_base64 }] }
  const attachments = (body.attachments ?? []).filter((a: any) =>
    a.content_type === "application/pdf" ||
    (a.filename ?? "").toLowerCase().endsWith(".pdf"),
  );

  if (attachments.length === 0) {
    return NextResponse.json({ success: true, note: "No PDF attachments" });
  }

  const supabase = createSupabaseServiceClient();
  const createdIds: string[] = [];

  for (const a of attachments) {
    const buffer = Buffer.from(a.content_base64, "base64");
    const pdfPath = `inbound/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${sanitizeName(a.filename ?? "bill.pdf")}`;

    const { error: upErr } = await supabase.storage
      .from("invoices")
      .upload(pdfPath, buffer, { contentType: "application/pdf" });
    if (upErr) continue;

    const { data: inv, error: insertErr } = await supabase
      .from("invoices")
      .insert({
        pdf_path: pdfPath,
        status: "new",
        source: "email",
        source_reference: body.message_id ?? body.from ?? "",
      })
      .select("id")
      .single();
    if (!insertErr && inv) {
      createdIds.push(inv.id);
      // Fire-and-forget extraction (non-blocking for webhook caller)
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/extract/${inv.id}`, { method: "POST" })
        .catch(() => {});
    }
  }

  return NextResponse.json({ success: true, created_invoice_ids: createdIds });
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

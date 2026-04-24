import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const results: Array<{ name: string; invoice_id?: string; error?: string }> = [];

  for (const file of files) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      results.push({ name: file.name, error: "Not a PDF" });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const { error: upErr } = await supabase.storage
      .from("invoices")
      .upload(path, buffer, { contentType: "application/pdf" });
    if (upErr) {
      results.push({ name: file.name, error: upErr.message });
      continue;
    }

    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        pdf_path: path,
        status: "new",
        source: "upload",
        source_reference: file.name,
        submitted_by: user.id,
      })
      .select("id")
      .single();
    if (error || !inv) {
      results.push({ name: file.name, error: error?.message ?? "Insert failed" });
      continue;
    }
    results.push({ name: file.name, invoice_id: inv.id });

    // Kick off extraction in the background
    fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/extract/${inv.id}`, { method: "POST" })
      .catch(() => {});
  }

  return NextResponse.json({ results });
}

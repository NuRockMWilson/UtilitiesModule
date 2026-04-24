import { NextResponse, type NextRequest } from "next/server";
import { createBatch } from "@/lib/sage/batch";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids = body.invoice_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "invoice_ids array required" }, { status: 400 });
  }
  const result = await createBatch(ids);
  if (!result.success) {
    return NextResponse.json({ error: result.error, per_invoice: result.per_invoice }, { status: 400 });
  }
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const status = request.nextUrl.searchParams.get("status");

  let q = supabase
    .from("sage_batches")
    .select(`
      id, batch_reference, sage_system, invoice_count, total_amount,
      status, artifact_filename, generated_at, downloaded_at, confirmed_posted_at,
      property:properties(code, name)
    `)
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batches: data });
}

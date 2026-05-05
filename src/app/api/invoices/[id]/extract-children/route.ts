import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireTester } from "@/lib/admin-auth";

/**
 * Trigger extraction on all child invoices of a compiled parent.
 *
 * POST /api/invoices/{parentId}/extract-children
 *
 * Iterates the parent's children (rows where parent_invoice_id =
 * {parentId}) and calls /api/extract/{childId} on each one in series.
 * Children that already have non-extracting status are skipped.
 *
 * This endpoint is intentionally separate from the extract route so:
 *   1. The compiled-PDF detection (in /api/extract) can return quickly
 *      after creating child rows, without blocking on N×LLM calls.
 *   2. Users (or a follow-up worker) can re-trigger child extractions
 *      if any failed initially without re-doing the split.
 *   3. We can put a longer effective timeout here — extracting 7-15
 *      children sequentially is a 60-180 second operation.
 *
 * Auth: tester or admin. The action mutates state but doesn't post
 * to Sage; it only runs the same extraction flow as a single bill.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireTester(req);
  if (!auth.ok) return auth.response;

  const supabase = createSupabaseServiceClient();

  // Verify the parent exists and is actually a compiled_parent
  const { data: parent } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", params.id)
    .single();

  if (!parent) {
    return NextResponse.json({ error: "Parent invoice not found" }, { status: 404 });
  }
  if (parent.status !== "compiled_parent") {
    return NextResponse.json(
      { error: `Invoice is not a compiled_parent (status=${parent.status})` },
      { status: 400 },
    );
  }

  // Find children that need extraction
  const { data: children } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("parent_invoice_id", params.id)
    .order("created_at", { ascending: true });

  if (!children || children.length === 0) {
    return NextResponse.json(
      { error: "No children found for this compiled parent" },
      { status: 400 },
    );
  }

  // Construct the absolute URL for self-fetching the extract endpoint.
  // Vercel deployments expose VERCEL_URL; locally we fall back to the
  // host header. We add NEXT_PUBLIC_APP_URL as a final fallback so
  // dev environments without VERCEL_URL still work.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    (() => {
      const hdr = req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") ?? "http";
      return hdr ? `${proto}://${hdr}` : "http://localhost:3050";
    })();

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const child of children) {
    if (child.status !== "extracting") {
      results.push({ id: child.id, ok: true });  // already done
      continue;
    }
    try {
      const res = await fetch(`${origin}/api/extract/${child.id}`, {
        method: "POST",
        headers: {
          // Pass through admin API key so the inner call passes the
          // tester gate without needing the user's cookie.
          ...(process.env.ADMIN_API_KEY
            ? { "x-admin-api-key": process.env.ADMIN_API_KEY }
            : {}),
        },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        results.push({ id: child.id, ok: false, error: j.error ?? `HTTP ${res.status}` });
      } else {
        results.push({ id: child.id, ok: true });
      }
    } catch (e) {
      results.push({ id: child.id, ok: false, error: (e as Error).message });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const errorCount   = results.length - successCount;
  return NextResponse.json({
    success: errorCount === 0,
    parent_id:    params.id,
    total:        results.length,
    succeeded:    successCount,
    failed:       errorCount,
    results,
  });
}

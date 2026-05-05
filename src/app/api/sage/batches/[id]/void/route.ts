import { NextResponse } from "next/server";
import { voidBatch } from "@/lib/sage/batch";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Voids a Sage batch. Admin-only — this is destructive and removes a
 * batch from the posting queue with a stated reason.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const reason = body.reason ?? "";
  const result = await voidBatch(params.id, reason);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

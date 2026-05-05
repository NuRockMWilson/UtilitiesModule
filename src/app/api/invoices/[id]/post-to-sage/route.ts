import { NextResponse } from "next/server";
import { createBatch } from "@/lib/sage/batch";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Posts an invoice to Sage by wrapping it in a batch. Admin-only because
 * Sage posting is an external side effect — once a batch is created and
 * pushed, undoing it requires manual cleanup in Sage itself.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const result = await createBatch([params.id]);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

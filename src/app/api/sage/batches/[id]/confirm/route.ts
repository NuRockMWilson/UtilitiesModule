import { NextResponse } from "next/server";
import { confirmBatchPosted } from "@/lib/sage/batch";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Marks a Sage batch as confirmed-posted. Admin-only — this finalizes
 * the batch state and signals AP that posting succeeded in Sage.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const result = await confirmBatchPosted(params.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { voidBatch } from "@/lib/sage/batch";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const reason = body.reason ?? "";
  const result = await voidBatch(params.id, reason);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

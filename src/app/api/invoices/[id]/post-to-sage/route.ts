import { NextResponse } from "next/server";
import { createBatch } from "@/lib/sage/batch";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const result = await createBatch([params.id]);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

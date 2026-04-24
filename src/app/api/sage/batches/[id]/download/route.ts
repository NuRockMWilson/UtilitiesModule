import { NextResponse } from "next/server";
import { refreshBatchDownload } from "@/lib/sage/batch";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const result = await refreshBatchDownload(params.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

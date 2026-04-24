import { NextResponse } from "next/server";
import { sendVarianceInquiry } from "@/lib/email";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const result = await sendVarianceInquiry({ invoiceId: params.id });
  if (!result.success) {
    return NextResponse.json({ error: result.detail }, { status: 400 });
  }
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { sendVarianceInquiry } from "@/lib/email";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Sends a variance inquiry email to the property manager. Admin-only
 * because this is an external email side effect — testers shouldn't
 * be triggering real emails to real PMs while exploring the dashboard.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const result = await sendVarianceInquiry({ invoiceId: params.id });
  if (!result.success) {
    return NextResponse.json({ error: result.detail }, { status: 400 });
  }
  return NextResponse.json(result);
}

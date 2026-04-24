import { transitionInvoice } from "@/lib/invoice-actions";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const reason = body.reason ?? "No reason provided";
  return transitionInvoice(
    params.id,
    "rejected",
    "rejected",
    { rejected_reason: reason },
    reason,
  );
}

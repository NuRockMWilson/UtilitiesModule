import { transitionInvoice } from "@/lib/invoice-actions";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  return transitionInvoice(params.id, "ready_for_approval", "marked_ready");
}

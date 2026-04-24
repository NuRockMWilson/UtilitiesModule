import { transitionInvoice } from "@/lib/invoice-actions";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  return transitionInvoice(params.id, "approved", "approved");
}

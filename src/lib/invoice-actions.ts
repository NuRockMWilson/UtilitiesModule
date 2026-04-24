import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { InvoiceStatus } from "@/lib/types";

export async function transitionInvoice(
  invoiceId: string,
  newStatus: InvoiceStatus,
  action: string,
  extra: Record<string, any> = {},
  notes?: string,
) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: current } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const updates: Record<string, any> = { status: newStatus, ...extra };
  if (newStatus === "approved") {
    updates.approved_by = user?.id;
    updates.approved_at = new Date().toISOString();
  }

  const { error: updateErr } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", invoiceId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await supabase.from("approval_log").insert({
    invoice_id: invoiceId,
    action,
    actor_id: user?.id,
    actor_email: user?.email,
    previous_status: current.status,
    new_status: newStatus,
    notes,
  });

  return NextResponse.json({ success: true });
}

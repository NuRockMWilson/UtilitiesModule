"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatGLCoding } from "@/lib/coding";
import { computeVariance } from "@/lib/variance";

export type LinkInvoiceResult = {
  ok: boolean;
  error?: string;
};

/**
 * Link an unmatched invoice to a utility_account. Used when extraction
 * succeeds but the extracted account_number doesn't match any existing
 * utility_accounts row — typically because the vendor reissued the account
 * or the historical workbook had a typo.
 *
 * Two modes:
 *   - mode="existing": use an existing utility_account_id provided by the user
 *   - mode="create":   create a new utility_account from the form fields
 *                      (vendor, property, GL, account_number, sub_code) and link
 *
 * After linking we recompute coding + variance against the now-resolved
 * utility_account's history and transition status accordingly.
 */
export async function linkInvoice(formData: FormData): Promise<LinkInvoiceResult> {
  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  const mode      = String(formData.get("mode") ?? "").trim();

  if (!invoiceId) return { ok: false, error: "Missing invoice id" };
  if (mode !== "existing" && mode !== "create") {
    return { ok: false, error: "Invalid mode" };
  }

  const supabase = createSupabaseServerClient();

  let utilityAccountId: string | null = null;

  if (mode === "existing") {
    utilityAccountId = String(formData.get("utility_account_id") ?? "").trim() || null;
    if (!utilityAccountId) return { ok: false, error: "Pick a utility account or use Create new" };
  } else {
    // Create a new utility_account from the form
    const property_id    = String(formData.get("property_id") ?? "").trim();
    const vendor_id      = String(formData.get("vendor_id") ?? "").trim();
    const gl_account_id  = String(formData.get("gl_account_id") ?? "").trim();
    const account_number = String(formData.get("account_number") ?? "").trim();
    const sub_code       = String(formData.get("sub_code") ?? "00").trim() || "00";

    if (!property_id)    return { ok: false, error: "Property is required" };
    if (!vendor_id)      return { ok: false, error: "Vendor is required" };
    if (!gl_account_id)  return { ok: false, error: "GL account is required" };
    if (!account_number) return { ok: false, error: "Account number is required" };

    const { data: created, error: insErr } = await supabase
      .from("utility_accounts")
      .insert({
        property_id, vendor_id, gl_account_id,
        account_number,
        sub_code,
        active: true,
      })
      .select("id")
      .single();
    if (insErr || !created) {
      return { ok: false, error: `Failed to create utility account: ${insErr?.message ?? "unknown"}` };
    }
    utilityAccountId = created.id;
  }

  // Re-resolve property/vendor/GL/coding from the chosen utility account
  const { data: ua } = await supabase
    .from("utility_accounts")
    .select(`
      id, property_id, vendor_id, gl_account_id, sub_code,
      baseline_window_months, variance_threshold_pct,
      property:properties(code), gl:gl_accounts(code)
    `)
    .eq("id", utilityAccountId!)
    .single();
  if (!ua) return { ok: false, error: "Linked utility account not found after save" };

  const propertyCode = (ua.property as any)?.code as string | undefined;
  const glCode       = (ua.gl as any)?.code as string | undefined;
  if (!propertyCode || !glCode) {
    return { ok: false, error: "Utility account is missing property or GL code" };
  }

  const glCoding = formatGLCoding({
    property_code: propertyCode,
    gl_code:       glCode,
    sub_code:      ua.sub_code ?? "00",
  });

  // Recompute variance now that we know which account this is
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, current_charges, total_amount_due, service_days, raw_extraction")
    .eq("id", invoiceId)
    .single();

  let varianceBaseline: number | null = null;
  let variancePct: number | null = null;
  let varianceFlagged = false;

  if (invoice) {
    const { data: priors } = await supabase
      .from("invoices")
      .select(`
        id, service_period_start, service_period_end, service_days,
        total_amount_due, exclude_from_baseline, variance_flagged, variance_explanation
      `)
      .eq("utility_account_id", utilityAccountId!)
      .neq("id", invoice.id)
      .in("status", ["approved", "posted_to_sage", "paid"]);

    const v = computeVariance({
      currentDays:       Number(invoice.service_days ?? 30),
      currentTotal:      Number(invoice.total_amount_due ?? 0),
      currentDailyUsage: null,
      priorInvoices: (priors ?? []).map((p: any) => ({
        id:                    p.id,
        service_period_start:  p.service_period_start,
        service_period_end:    p.service_period_end,
        service_days:          p.service_days,
        total_amount_due:      p.total_amount_due,
        daily_usage:           null,
        exclude_from_baseline: p.exclude_from_baseline,
        variance_flagged:      p.variance_flagged,
        variance_explanation:  p.variance_explanation,
      })),
      thresholdPct: Number(ua.variance_threshold_pct ?? 3),
      windowMonths: Number(ua.baseline_window_months ?? 12),
    });

    varianceBaseline = v.baseline;
    variancePct      = v.variancePct;
    varianceFlagged  = v.flagged;
  }

  // Decide next status
  const nextStatus: "needs_variance_note" | "ready_for_approval" =
    varianceFlagged ? "needs_variance_note" : "ready_for_approval";

  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      utility_account_id: utilityAccountId,
      property_id:        ua.property_id,
      vendor_id:          ua.vendor_id,
      gl_account_id:      ua.gl_account_id,
      gl_coding:          glCoding,
      variance_baseline:  varianceBaseline,
      variance_pct:       variancePct,
      variance_flagged:   varianceFlagged,
      status:             nextStatus,
    })
    .eq("id", invoiceId);

  if (updErr) return { ok: false, error: `Failed to update invoice: ${updErr.message}` };

  await supabase.from("approval_log").insert({
    invoice_id: invoiceId,
    action:     "linked_to_account",
    new_status: nextStatus,
    notes:      `Linked to ${propertyCode} · GL ${glCode}; coding ${glCoding}`,
  });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { ok: true };
}

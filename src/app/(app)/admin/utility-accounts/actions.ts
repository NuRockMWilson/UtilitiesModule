"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AccountFormState = {
  ok:    boolean;
  error?: string;
};

/**
 * Create or update a utility_account. The (vendor_id, account_number) pair
 * is uniquely indexed, so the same account number can exist for different
 * vendors but not for the same vendor twice.
 */
export async function saveAccount(
  _prev: AccountFormState | null,
  formData: FormData,
): Promise<AccountFormState> {
  const supabase = createSupabaseServerClient();

  const id              = String(formData.get("id") ?? "").trim() || null;
  const property_id     = String(formData.get("property_id") ?? "").trim();
  const vendor_id       = String(formData.get("vendor_id") ?? "").trim();
  const gl_account_id   = String(formData.get("gl_account_id") ?? "").trim();
  const account_number  = String(formData.get("account_number") ?? "").trim();
  const description     = String(formData.get("description") ?? "").trim() || null;
  const meter_id        = String(formData.get("meter_id") ?? "").trim() || null;
  const esi_id          = String(formData.get("esi_id") ?? "").trim() || null;
  const meter_category  = String(formData.get("meter_category") ?? "").trim() || null;
  const sub_code        = String(formData.get("sub_code") ?? "00").trim() || "00";

  const baseline_window_months = Number(formData.get("baseline_window_months") ?? 12);
  const variance_threshold_pct = Number(formData.get("variance_threshold_pct") ?? 3);
  const active = formData.get("active") === "on" || formData.get("active") === "true";

  if (!property_id)    return { ok: false, error: "Property is required" };
  if (!vendor_id)      return { ok: false, error: "Vendor is required" };
  if (!gl_account_id)  return { ok: false, error: "GL account is required" };
  if (!account_number) return { ok: false, error: "Account number is required" };
  if (Number.isNaN(baseline_window_months) || baseline_window_months < 1 || baseline_window_months > 60)
    return { ok: false, error: "Baseline window must be between 1 and 60 months" };
  if (Number.isNaN(variance_threshold_pct) || variance_threshold_pct < 0 || variance_threshold_pct > 100)
    return { ok: false, error: "Variance threshold must be between 0 and 100 percent" };

  const payload = {
    property_id, vendor_id, gl_account_id, account_number,
    description, meter_id, esi_id, meter_category, sub_code,
    baseline_window_months, variance_threshold_pct, active,
  };

  if (id) {
    const { error } = await supabase.from("utility_accounts").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("utility_accounts").insert(payload);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/utility-accounts");
  redirect("/admin/utility-accounts");
}

export async function deactivateAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const supabase = createSupabaseServerClient();
  await supabase.from("utility_accounts").update({ active: false }).eq("id", id);
  revalidatePath("/admin/utility-accounts");
}

export async function reactivateAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const supabase = createSupabaseServerClient();
  await supabase.from("utility_accounts").update({ active: true }).eq("id", id);
  revalidatePath("/admin/utility-accounts");
}

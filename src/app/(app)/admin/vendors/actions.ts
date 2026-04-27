"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VALID_CATEGORIES = [
  "electric", "water", "sewer", "storm_water", "environmental",
  "irrigation", "gas", "trash", "cable", "phone", "fedex", "other",
] as const;
type VendorCategory = typeof VALID_CATEGORIES[number];

export type VendorFormState = {
  ok:    boolean;
  error?: string;
};

/**
 * Create or update a vendor. If `id` is set in the form, updates the existing
 * row; otherwise creates a new vendor. Validates category is in the
 * utility_category enum to avoid hitting a database error mid-submit.
 */
export async function saveVendor(
  _prev: VendorFormState | null,
  formData: FormData,
): Promise<VendorFormState> {
  const supabase = createSupabaseServerClient();

  const id           = String(formData.get("id") ?? "").trim() || null;
  const name         = String(formData.get("name") ?? "").trim();
  const short_name   = String(formData.get("short_name") ?? "").trim() || null;
  const category     = String(formData.get("category") ?? "other").trim();
  const sage_vendor_id  = String(formData.get("sage_vendor_id") ?? "").trim() || null;
  const contact_email   = String(formData.get("contact_email") ?? "").trim() || null;
  const contact_phone   = String(formData.get("contact_phone") ?? "").trim() || null;
  const active       = formData.get("active") === "on" || formData.get("active") === "true";

  if (!name) return { ok: false, error: "Name is required" };
  if (!VALID_CATEGORIES.includes(category as VendorCategory)) {
    return { ok: false, error: `Invalid category: ${category}` };
  }
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return { ok: false, error: "Contact email is malformed" };
  }

  const payload = { name, short_name, category, sage_vendor_id, contact_email, contact_phone, active };

  if (id) {
    const { error } = await supabase.from("vendors").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("vendors").insert(payload);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/vendors");
  redirect("/admin/vendors");
}

/**
 * Soft-delete (deactivate). Hard-deleting a vendor would orphan invoices and
 * utility_accounts that reference it, so we set active=false instead.
 */
export async function deactivateVendor(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const supabase = createSupabaseServerClient();
  await supabase.from("vendors").update({ active: false }).eq("id", id);
  revalidatePath("/admin/vendors");
}

/**
 * Re-activate a previously-deactivated vendor.
 */
export async function reactivateVendor(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const supabase = createSupabaseServerClient();
  await supabase.from("vendors").update({ active: true }).eq("id", id);
  revalidatePath("/admin/vendors");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VALID_CATEGORIES = [
  "electric", "water", "sewer", "storm_water", "environmental",
  "irrigation", "gas", "trash", "cable", "phone", "fedex", "other",
] as const;
type VendorCategory = typeof VALID_CATEGORIES[number];

export type VendorMatch = {
  id:              string;
  name:            string;
  active:          boolean;
  category:        string | null;
  sage_vendor_id:  string | null;
  remit_address:   string | null;
};

export type VendorFormState = {
  ok:               boolean;
  error?:           string;
  /** When set, the form re-renders with a "did you mean?" dialog so the user
   *  can confirm they really want to create a duplicate, or pick the match. */
  duplicateMatches?: VendorMatch[];
};

/**
 * Normalize a vendor name for fuzzy comparison:
 *   - lowercase
 *   - strip all non-alphanumeric (commas, dashes, slashes, "#", account numbers)
 *   - collapse whitespace
 *
 * "Republic - Duncan Disposal #794" → "republicduncandisposal794"
 * "Republic Services"               → "republicservices"
 * "Allied Waste Services\\Repbulic" → "alliedwasteservicesrepbulic" (note typo preserved)
 *
 * For the prefix-match heuristic we then trim trailing digits (account numbers)
 * and compare the first few significant characters.
 */
function normalizeVendorName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip trailing digits — '794' or 'mcdonough' style suffixes get clipped. */
function stripTrailingDigits(s: string): string {
  return s.replace(/\d+$/, "");
}

/**
 * Find vendors whose normalized name overlaps with the input by a meaningful
 * prefix (≥6 chars). This catches the common patterns:
 *   "Republic" vs "Republic Services" vs "Republic - Duncan Disposal #794"
 * without false-positiving on totally different vendors.
 */
async function findSimilarVendors(name: string, excludeId: string | null): Promise<VendorMatch[]> {
  const supabase = createSupabaseServerClient();
  const target = stripTrailingDigits(normalizeVendorName(name));
  if (target.length < 4) return [];   // too short to be confident; skip

  const { data: all } = await supabase
    .from("vendors")
    .select("id, name, active, category, sage_vendor_id, remit_address");

  const matches: VendorMatch[] = [];
  for (const v of (all ?? [])) {
    if (excludeId && v.id === excludeId) continue;
    const candidate = stripTrailingDigits(normalizeVendorName(v.name));
    if (!candidate) continue;

    // Exact normalized match — definite duplicate
    if (candidate === target) {
      matches.push(v as VendorMatch);
      continue;
    }
    // 6-char fixed prefix match — both must have ≥6 chars to compare
    if (target.length >= 6 && candidate.length >= 6 && target.slice(0, 6) === candidate.slice(0, 6)) {
      matches.push(v as VendorMatch);
      continue;
    }
    // One name fully contains the other — the shorter side must be ≥3 chars
    // so we don't match on tiny common substrings.
    if (target.length >= 3 && candidate.includes(target)) {
      matches.push(v as VendorMatch);
      continue;
    }
    if (candidate.length >= 3 && target.includes(candidate)) {
      matches.push(v as VendorMatch);
      continue;
    }
  }
  // Cap to 5 — beyond that the dialog gets noisy.
  return matches.slice(0, 5);
}

/**
 * Create or update a vendor. If `id` is set in the form, updates the existing
 * row; otherwise creates a new vendor. Validates category is in the
 * utility_category enum to avoid hitting a database error mid-submit.
 *
 * Duplicate guard: before insert/update, looks for vendors with similar
 * normalized names. If matches are found AND `confirm_duplicate` isn't true,
 * returns them in `duplicateMatches` so the form can render a confirmation
 * dialog. The user either picks an existing vendor instead, or re-submits
 * with the override checkbox set to bypass.
 */
export async function saveVendor(
  _prev: VendorFormState | null,
  formData: FormData,
): Promise<VendorFormState> {
  const supabase = createSupabaseServerClient();

  const id                 = String(formData.get("id") ?? "").trim() || null;
  const name               = String(formData.get("name") ?? "").trim();
  const short_name         = String(formData.get("short_name") ?? "").trim() || null;
  const category           = String(formData.get("category") ?? "other").trim();
  const sage_vendor_id     = String(formData.get("sage_vendor_id") ?? "").trim() || null;
  const contact_email      = String(formData.get("contact_email") ?? "").trim() || null;
  const contact_phone      = String(formData.get("contact_phone") ?? "").trim() || null;
  const remit_address      = String(formData.get("remit_address") ?? "").trim() || null;
  const active             = formData.get("active") === "on" || formData.get("active") === "true";
  const confirmDuplicate   = formData.get("confirm_duplicate") === "true";

  if (!name) return { ok: false, error: "Name is required" };
  if (!VALID_CATEGORIES.includes(category as VendorCategory)) {
    return { ok: false, error: `Invalid category: ${category}` };
  }
  if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
    return { ok: false, error: "Contact email is malformed" };
  }

  // Duplicate check — only run for new vendors and for renames of existing.
  // (A no-op edit shouldn't trigger the dialog.)
  if (!confirmDuplicate) {
    let shouldCheck = !id;
    if (id) {
      const { data: existing } = await supabase
        .from("vendors").select("name").eq("id", id).single();
      shouldCheck = !!existing && existing.name !== name;
    }
    if (shouldCheck) {
      const matches = await findSimilarVendors(name, id);
      if (matches.length > 0) {
        return { ok: false, duplicateMatches: matches };
      }
    }
  }

  const payload = { name, short_name, category, sage_vendor_id, contact_email, contact_phone, remit_address, active };

  if (id) {
    const { error } = await supabase.from("vendors").update(payload).eq("id", id);
    if (error) return { ok: false, error: translateDbError(error) };
  } else {
    const { error } = await supabase.from("vendors").insert(payload);
    if (error) return { ok: false, error: translateDbError(error) };
  }

  revalidatePath("/admin/vendors");
  redirect("/admin/vendors");
}

/**
 * Translate Supabase/Postgres errors into messages a user can act on.
 * The most common one for this form is 23505 (unique violation on the
 * vendors_name_key index), which fires when an exact-name duplicate gets
 * past the fuzzy-match dialog — typically because the existing vendor is
 * inactive and easy to miss, or because the user clicked "Create anyway".
 */
function translateDbError(err: { code?: string; message: string }): string {
  if (err.code === "23505") {
    if (/vendors_name_sage_id_key/.test(err.message)) {
      return "A vendor with this exact name AND Sage vendor ID already exists. Multiple records with the same name are fine, but each must have a different Sage vendor ID. Either change the Sage ID on this record or edit the existing one.";
    }
    if (/vendors_name_key/.test(err.message)) {
      // Pre-migration constraint — should disappear after 0014 is applied.
      return "A vendor with this exact name already exists. After applying migration 0014_vendor_uniqueness, multiple records with the same name will be allowed (with different Sage vendor IDs).";
    }
  }
  return err.message;
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

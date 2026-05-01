/**
 * Property-aware vendor resolver.
 *
 * Problem it solves:
 *   When a bill arrives for an account number that doesn't yet have a
 *   utility_account (UA) record, the auto-coder needs to pick a vendor.
 *   Several vendors have multiple "variants" in the database — e.g. we
 *   have three Republic Services vendors:
 *
 *     Republic Services Inc.              → used by properties 508–516
 *     Republic - Duncan Disposal #794     → used by properties 555, 559–562
 *     Republic Services Inc. (comma form) → used by property 602
 *
 *   Without a property-aware resolver, the auto-coder picks whichever
 *   variant sorts first, which is wrong ~50% of the time for multi-variant
 *   vendors.
 *
 * Strategy (applied in order):
 *   1. Exact account_number match on an ACTIVE utility_account (already
 *      done in the extract route — this function is only called when that
 *      lookup returns nothing).
 *   2. If the property is known: look for ANY active UA at that property
 *      whose vendor name fuzzy-matches the extracted vendor_name.  Use
 *      that UA's vendor_id.
 *   3. Same search but across the whole portfolio — take the most-used
 *      vendor_id for the matching vendor name.
 *   4. Fuzzy match on the vendors table directly (no UA required).
 *   5. Fall back to null (caller will queue for manual coding).
 *
 * "Fuzzy match" here means: does the vendor table row's name include the
 * key token(s) we extracted, or vice versa?  No external library needed;
 * the set of utility vendor names is small and controlled.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface VendorResolveInput {
  /** Raw vendor_name from the extraction (e.g. "Republic Services") */
  extractedVendorName: string | null;
  /** Property UUID already resolved from the bill, if any */
  propertyId: string | null;
  /** Account number from the bill — used as a secondary hint */
  accountNumber: string | null;
}

export interface VendorResolveResult {
  vendorId: string | null;
  vendorName: string | null;
  confidence: "property_ua_match" | "portfolio_ua_match" | "vendor_table_match" | "none";
  debug: string;
}

/**
 * Normalise a vendor name for comparison: lower-case, collapse whitespace,
 * strip common suffixes that vary between database entries.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[,\.]/g, " ")
    .replace(/\b(inc|llc|ltd|corp|services|service)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true if the extracted name is a reasonable match for the DB name.
 * Uses a token-overlap strategy: at least one non-trivial token from each
 * side must appear in the other.
 */
function vendorNamesMatch(extracted: string, dbName: string): boolean {
  const stopWords = new Set(["the", "and", "of", "a", "an", "inc", "llc", "corp", "services"]);
  const tokens = (s: string) =>
    normalise(s)
      .split(" ")
      .filter(t => t.length >= 3 && !stopWords.has(t));

  const eToks = tokens(extracted);
  const dToks = tokens(dbName);
  if (eToks.length === 0 || dToks.length === 0) return false;

  // Any significant token from extracted appears in db name, or vice-versa
  return eToks.some(t => dToks.includes(t)) || dToks.some(t => eToks.includes(t));
}

/**
 * Resolve the best vendor_id for a new / unmatched utility bill.
 *
 * Accepts a Supabase client with either anon or service-role key —
 * the caller provides whichever it already has.
 */
export async function resolveVendor(
  supabase: SupabaseClient,
  input: VendorResolveInput,
): Promise<VendorResolveResult> {
  const none: VendorResolveResult = {
    vendorId: null, vendorName: null, confidence: "none",
    debug: "No vendor_name extracted from bill",
  };

  if (!input.extractedVendorName) return none;

  // ── Step 2: Property-scoped UA search ────────────────────────────────────
  if (input.propertyId) {
    const { data: propertyUAs } = await supabase
      .from("utility_accounts")
      .select("vendor_id, vendors(id, name)")
      .eq("property_id", input.propertyId)
      .eq("active", true);

    if (propertyUAs && propertyUAs.length > 0) {
      // Deduplicate by vendor_id and find the best match
      const seen = new Map<string, string>(); // vendorId → vendorName
      for (const ua of propertyUAs) {
        const v = (ua as any).vendors;
        if (v && !seen.has(v.id)) seen.set(v.id, v.name);
      }

      for (const [vendorId, vendorName] of seen) {
        if (vendorNamesMatch(input.extractedVendorName, vendorName)) {
          return {
            vendorId,
            vendorName,
            confidence: "property_ua_match",
            debug: `Matched "${vendorName}" via property-scoped UA lookup`,
          };
        }
      }
    }
  }

  // ── Step 3: Portfolio-wide UA search (most-used vendor variant) ───────────
  const { data: allUAs } = await supabase
    .from("utility_accounts")
    .select("vendor_id, vendors(id, name)")
    .eq("active", true);

  if (allUAs && allUAs.length > 0) {
    // Count how often each vendor_id appears across the portfolio
    const counts = new Map<string, { name: string; count: number }>();
    for (const ua of allUAs) {
      const v = (ua as any).vendors;
      if (!v) continue;
      const cur = counts.get(v.id);
      if (cur) { cur.count++; }
      else { counts.set(v.id, { name: v.name, count: 1 }); }
    }

    // Find all matching vendors, sort by usage count descending
    const matches = [...counts.entries()]
      .filter(([, { name }]) => vendorNamesMatch(input.extractedVendorName!, name))
      .sort((a, b) => b[1].count - a[1].count);

    if (matches.length > 0) {
      const [vendorId, { name: vendorName, count }] = matches[0];
      return {
        vendorId,
        vendorName,
        confidence: "portfolio_ua_match",
        debug: `Matched "${vendorName}" (${count} UAs) via portfolio-wide UA lookup`,
      };
    }
  }

  // ── Step 4: Vendors table direct fuzzy match ──────────────────────────────
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("active", true);

  if (vendors) {
    const match = vendors.find(v => vendorNamesMatch(input.extractedVendorName!, v.name));
    if (match) {
      return {
        vendorId: match.id,
        vendorName: match.name,
        confidence: "vendor_table_match",
        debug: `Matched "${match.name}" via vendors table fuzzy match`,
      };
    }
  }

  return {
    vendorId: null,
    vendorName: null,
    confidence: "none",
    debug: `No vendor match found for "${input.extractedVendorName}"`,
  };
}

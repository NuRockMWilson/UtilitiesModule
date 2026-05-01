/**
 * Multi-account / multi-service bill detector.
 *
 * Runs after `extractBill()` returns its parsed result. Inspects the
 * extracted line items, addresses, and account references to classify
 * the bill into one of these shapes:
 *
 *   single        — one account, one service category. Normal case.
 *
 *   multi_property — looks like multiple sub-bills for different
 *                    properties wrapped in one PDF. Examples: a Republic
 *                    statement covering 4 communities, a WM statement
 *                    covering compactor + recycle at multiple sites.
 *                    Sub-bills should be split into N invoices before
 *                    posting.
 *
 *   multi_service — one property + one account, but multiple service
 *                   categories on the same bill (water + sewer +
 *                   stormwater on a city utility statement). Stays a
 *                   single invoice but should have a multi-line GL
 *                   distribution before posting to Sage.
 *
 *   uncertain     — signals were detected but classification is unclear.
 *                   Flag for human review.
 *
 * Output is a list of warning strings, ready to be appended to
 * `extracted.warnings`. Empty list means the bill looks like a normal
 * single-account, single-service bill.
 *
 * Design philosophy: this is intentionally a *detector*, not a splitter
 * or distributor. It produces warnings that surface the bill to a human
 * reviewer; it does not modify the invoice or attempt to auto-split.
 * False positives just cost a UI banner; false negatives let bills with
 * the wrong amounts post to Sage. So when in doubt, flag.
 */

import type { ExtractedBillT } from "./extraction";

export type BillShape = "single" | "multi_property" | "multi_service" | "uncertain";

export interface MultiAccountSignal {
  shape: BillShape;
  warnings: string[];
  /**
   * Detail captured for the audit trail. Stored alongside the warning
   * in case a human wants to understand why the detector fired.
   */
  evidence: {
    distinctAddresses: string[];
    distinctAccountNumbers: string[];
    serviceCategories: string[];
    accountInBody: number;            // count of account-like patterns in line items
    multipleTotalLines: boolean;
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Service category detection
 * ──────────────────────────────────────────────────────────────────────
 *
 * Each entry maps a category label to the keywords that, when found in a
 * line-item description, indicate that line belongs to that category.
 * If a single bill has 2+ distinct categories with non-trivial dollar
 * amounts on each, it's a multi-service bill.
 *
 * Keywords are intentionally narrow. "Total" or generic words don't
 * count; we want strong service-specific signals.
 */
const SERVICE_CATEGORIES: Record<string, RegExp[]> = {
  water:        [/\bwater\b/i, /\bh2o\b/i],
  sewer:        [/\bsewer\b/i, /\bwastewater\b/i, /\bsewage\b/i],
  stormwater:   [/\bstorm\s*water\b/i, /\bstormwater\b/i, /\bdrainage\b/i],
  trash:        [/\bgarbage\b/i, /\btrash\b/i, /\brefuse\b/i],
  recycle:      [/\brecycl/i],
  electric:     [/\belectric\b/i, /\bkwh\b/i, /\benergy\s+charge\b/i],
  gas:          [/\bnatural\s+gas\b/i, /\btherms?\b/i, /\bccf\b/i],
  cable:        [/\bcable\b/i, /\binternet\b/i, /\bbroadband\b/i],
  phone:        [/\bphone\b/i, /\btelephone\b/i, /\bvoice\s+service\b/i],
  envir_fee:    [/\benvironmental\b/i, /\benvir\.?\s*protect/i],
};

/**
 * Detect service categories present in the line items.
 *
 * Only counts categories that have at least one line item with an amount
 * over the noise floor. This avoids false positives from lines like
 * "stormwater fee $0.00" or "water surcharge $0.30" where the category
 * is mentioned but isn't a real charge.
 */
function detectServiceCategories(
  lineItems: ExtractedBillT["line_items"],
  noiseFloor = 1.00,
): string[] {
  const found = new Set<string>();
  for (const item of lineItems) {
    if (Math.abs(item.amount ?? 0) < noiseFloor) continue;
    for (const [cat, patterns] of Object.entries(SERVICE_CATEGORIES)) {
      if (patterns.some(p => p.test(item.description))) {
        found.add(cat);
      }
    }
  }
  return [...found];
}

/* ─────────────────────────────────────────────────────────────────────
 * Multi-property detection
 * ──────────────────────────────────────────────────────────────────────
 *
 * Two independent signals; either one is enough to flag.
 *
 * Signal 1: Distinct addresses in line items
 *   Many multi-property bills (Republic in particular) put each sub-bill's
 *   service address in the line-item description. If we see 2+ distinct
 *   addresses, this is almost certainly a multi-property bill.
 *
 * Signal 2: Multiple account-number-like patterns
 *   Account numbers in line items (10+ digits, alphanumeric with dashes)
 *   beyond the bill's primary account number indicate sub-billing.
 */

/** Addresses look like "1234 Main St", "P.O. Box 5678", etc. */
const ADDRESS_RE = /\b\d{1,6}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\s+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pkwy|Hwy)\b/i;

/** Account numbers look like 10+ digits, possibly with dashes/spaces */
const ACCOUNT_RE = /\b\d{4,5}[\s-]?\d{4,8}(?:[\s-]?\d{2,4})?\b/g;

function detectDistinctAddresses(lineItems: ExtractedBillT["line_items"]): string[] {
  const addresses = new Set<string>();
  for (const item of lineItems) {
    const match = item.description.match(ADDRESS_RE);
    if (match) {
      // Normalise: lowercase, collapse whitespace, strip punctuation
      const norm = match[0].toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
      addresses.add(norm);
    }
  }
  return [...addresses];
}

/**
 * Find account-number-like strings in line items (excluding the bill's
 * primary account number — that one is supposed to appear).
 */
function detectAccountsInBody(
  lineItems: ExtractedBillT["line_items"],
  primaryAccountNumber: string | null,
): string[] {
  const found = new Set<string>();
  const primary = primaryAccountNumber?.replace(/[\s-]/g, "").toLowerCase();
  for (const item of lineItems) {
    const matches = item.description.match(ACCOUNT_RE) ?? [];
    for (const m of matches) {
      const norm = m.replace(/[\s-]/g, "").toLowerCase();
      if (norm === primary) continue; // expected
      if (norm.length < 6) continue; // probably an invoice line number, not an account
      found.add(m);
    }
  }
  return [...found];
}

/* ─────────────────────────────────────────────────────────────────────
 * Main detector
 * ──────────────────────────────────────────────────────────────────────
 */

export function detectMultiAccountSignals(extracted: ExtractedBillT): MultiAccountSignal {
  const distinctAddresses        = detectDistinctAddresses(extracted.line_items);
  const distinctAccountNumbers   = detectAccountsInBody(extracted.line_items, extracted.account_number);
  const serviceCategories        = detectServiceCategories(extracted.line_items);

  // "Multiple total lines" — bills with multiple sub-totals often have
  // line items literally labeled "Total", "Subtotal", "Account Total",
  // etc. A bill with 2+ such lines is suggestive of sub-billing.
  const totalLinePattern         = /\b(total|subtotal|amount\s+due|balance)\b/i;
  const totalLineCount = extracted.line_items.filter(li =>
    totalLinePattern.test(li.description),
  ).length;
  const multipleTotalLines = totalLineCount >= 2;

  const evidence = {
    distinctAddresses,
    distinctAccountNumbers,
    serviceCategories,
    accountInBody: distinctAccountNumbers.length,
    multipleTotalLines,
  };

  // ── Decide shape ────────────────────────────────────────────────────
  const warnings: string[] = [];
  let shape: BillShape = "single";

  // Strong multi-property signal: multiple distinct addresses, OR
  // multiple distinct account numbers in the body.
  const isMultiProperty =
    distinctAddresses.length >= 2 ||
    distinctAccountNumbers.length >= 2;

  // Multi-service signal: 2+ distinct service categories on one bill.
  // Common case: water + sewer + stormwater on a municipal utility bill.
  const isMultiService = serviceCategories.length >= 2;

  if (isMultiProperty) {
    shape = "multi_property";
    const detail =
      distinctAddresses.length >= 2
        ? `${distinctAddresses.length} distinct service addresses detected`
        : `${distinctAccountNumbers.length} distinct account numbers detected in line items`;
    warnings.push(
      `[Suspected multi-property bill] ${detail}. ` +
      `This PDF may cover multiple properties — review the bill before approving and split into ` +
      `separate invoices if needed.`,
    );
  } else if (isMultiService) {
    shape = "multi_service";
    warnings.push(
      `[Suspected multi-service bill] Service categories detected: ` +
      `${serviceCategories.join(", ")}. ` +
      `This bill mixes services that may belong on different GL codes (e.g. water vs sewer ` +
      `vs stormwater). Review GL distribution before posting.`,
    );
  } else if (multipleTotalLines && extracted.line_items.length > 8) {
    // Weak signal: many line items + multiple "total" lines, but no
    // address or category match. Flag as uncertain.
    shape = "uncertain";
    warnings.push(
      `[Bill structure unclear] Multiple total/subtotal lines detected ` +
      `(${totalLineCount}) on a bill with ${extracted.line_items.length} line items. ` +
      `Verify this is a single-account bill before approving.`,
    );
  }

  return { shape, warnings, evidence };
}

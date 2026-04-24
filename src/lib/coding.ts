/**
 * GL coding resolver.
 *
 * Format: 500-XXX-XXXX.YY
 *   500  — fixed prefix
 *   XXX  — property code (555 = Sunset Pointe, etc.)
 *   XXXX — GL account (5120 = Water, etc.)
 *   YY   — sub-code (default "00"; used for house vs clubhouse vs vacant splits)
 *
 * Auto-coding strategy:
 *   1. Look up utility_account by (vendor_id, account_number).
 *      → 95%+ of recurring bills resolve here with no human touch.
 *   2. If the account is new, attempt to match by vendor + property hints
 *      in the extracted service address, and raise a "needs coding" flag
 *      with a best-guess proposal.
 *   3. Storm Water and Environmental Protection are line items on a water
 *      bill; they roll up to GL 5120 (Water) per Sunset Pointe conventions.
 */

export interface GLCodingParts {
  property_code: string;   // '555'
  gl_code:       string;   // '5120'
  sub_code:      string;   // '00'
}

export function formatGLCoding(parts: GLCodingParts): string {
  const sub = parts.sub_code.padStart(2, "0");
  return `500-${parts.property_code}-${parts.gl_code}.${sub}`;
}

const GL_CODING_REGEX = /^500-(\d{3})-(\d{4})\.(\d{2})$/;

export function parseGLCoding(coding: string): GLCodingParts | null {
  const m = coding.trim().match(GL_CODING_REGEX);
  if (!m) return null;
  return { property_code: m[1], gl_code: m[2], sub_code: m[3] };
}

export function isValidGLCoding(coding: string): boolean {
  return GL_CODING_REGEX.test(coding.trim());
}

/**
 * Inference map for extracted vendor names / bill labels → GL account code.
 * Used when auto-matching fails on account number and we need a best guess.
 */
export const VENDOR_LABEL_TO_GL: Record<string, string> = {
  "water":                "5120",
  "sewer":                "5125",
  "storm water":          "5120",
  "storm drainage":       "5120",
  "environmental":        "5120",
  "envir. protection":    "5120",
  "irrigation":           "5122",
  "gas":                  "5130",
  "trash":                "5135",
  "solid waste":          "5135",
  "refuse":               "5135",
  "cable":                "5140",
  "television":           "5140",
  "internet":             "5140",  // bundled with cable at most properties
  "phone":                "5635",
  "telephone":            "5635",
  "fedex":                "5620",
  "house electric":       "5112",
  "vacant":               "5114",
  "clubhouse":            "5116",
  "club house":           "5116",
};

/**
 * Given an extracted bill description, infer the most likely GL account code.
 * Returns null if no confident inference can be made.
 */
export function inferGLCode(description: string | null | undefined): string | null {
  if (!description) return null;
  const needle = description.toLowerCase();
  let best: { code: string; length: number } | null = null;
  for (const [key, code] of Object.entries(VENDOR_LABEL_TO_GL)) {
    if (needle.includes(key) && (!best || key.length > best.length)) {
      best = { code, length: key.length };
    }
  }
  return best?.code ?? null;
}

/**
 * Utility bill extraction via Claude vision.
 *
 * Input:  an array of base64 page images (PDFs are rendered to images by the
 *         upload pipeline before reaching this function).
 * Output: structured JSON conforming to ExtractedBill.
 *
 * The prompt is intentionally strict about reconciliation: the extractor
 * must cross-check the sum of line items against the stated total and
 * return a `requires_human_review` flag if they disagree. This is the
 * primary defense against silent misreads.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Helper — for LLM-extracted data, "missing" can show up as either null OR
// an omitted key (which Zod sees as undefined). Treating both as equivalent
// keeps validation tolerant of well-formed but partial extractions, which
// is the realistic case: a Republic Services bill has no usage_readings, an
// AT&T bill has no service_address in the spot we expect, etc.
const nullish = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform(v => v ?? null);

export const ExtractedLineItem = z.object({
  description: z.string(),
  amount:      z.number(),
  quantity:    nullish(z.number()),
  unit:        nullish(z.string()),
});

export const ExtractedUsageReading = z.object({
  reading_type: nullish(z.enum(["water", "sewer", "irrigation", "electric", "gas"])),
  meter_start:  nullish(z.number()),
  meter_end:    nullish(z.number()),
  usage_amount: nullish(z.number()),
  usage_unit:   nullish(z.string()),
});

/**
 * Sub-bill structure detected by the extractor when a PDF contains
 * multiple distinct bills (a "compiled" PDF), or a single bill with
 * many pages of unit-level detail (a "long_detail" bill).
 *
 * The extractor doesn't know our property/account mappings — it just
 * reports what it sees. The route handler decides what to do with
 * the structure: split-and-re-extract for compiled, mark-for-unit-
 * detail-processing for long_detail.
 */
export const ExtractedSubBill = z.object({
  page_start:     z.number().int().min(1),
  page_end:       z.number().int().min(1),
  account_number: nullish(z.string()),
  service_address: nullish(z.string()),
  total_amount:   nullish(z.number()),
});

export const BillStructure = z.object({
  type: z.enum(["single", "long_detail", "compiled"]).default("single"),
  // For compiled PDFs: the sub-bills found. Empty for single/long_detail.
  sub_bills: z.array(ExtractedSubBill).default([]),
  // Confidence in the structure assessment (0..1). Below 0.85 the route
  // handler should fall back to single-bill processing per the agreed
  // safety policy (Q2-(a)).
  confidence: z.number().min(0).max(1).default(1),
  notes:      nullish(z.string()),
});

export type BillStructureT = z.infer<typeof BillStructure>;
export type ExtractedSubBillT = z.infer<typeof ExtractedSubBill>;

export const ExtractedBill = z.object({
  vendor_name:           nullish(z.string()),
  account_number:        nullish(z.string()),
  invoice_number:        nullish(z.string()),
  invoice_date:          nullish(z.string()),       // ISO YYYY-MM-DD
  due_date:              nullish(z.string()),
  service_period_start:  nullish(z.string()),
  service_period_end:    nullish(z.string()),
  service_days:          nullish(z.number()),

  service_address:       nullish(z.string()),
  remit_address:         nullish(z.string()),

  line_items:     z.array(ExtractedLineItem).default([]),
  usage_readings: z.array(ExtractedUsageReading).default([]),

  previous_balance: nullish(z.number()),
  current_charges:  nullish(z.number()),
  adjustments:      nullish(z.number()),
  late_fees:        nullish(z.number()),
  total_amount_due: nullish(z.number()),

  // Self-validation from the model
  reconciliation_check: z.object({
    line_items_sum: nullish(z.number()),
    matches_total:  z.boolean().default(false),
    delta:          nullish(z.number()),
  }).default({ line_items_sum: null, matches_total: false, delta: null }),
  extraction_confidence: z.number().min(0).max(1).default(0),
  warnings:              z.array(z.string()).default([]),

  // NEW: Structure detection — set by the model when it notices the PDF
  // is not a single normal bill. Defaults to single-bill semantics so
  // existing callers don't need to special-case this.
  bill_structure: BillStructure.default({ type: "single", sub_bills: [], confidence: 1, notes: null }),
});

export type ExtractedBillT = z.infer<typeof ExtractedBill>;

const SYSTEM_PROMPT = `You are extracting billing data from utility bills for an affordable-housing property manager. Bills come from water, sewer, electric, gas, trash, cable, phone, and courier vendors. Each bill has the same core shape: vendor + account + service period + charges + total due.

Respond with a single JSON object — no markdown, no prose, no code fences — matching this exact shape and field names:

{
  "vendor_name":           string | null,   // Company billing the customer (e.g. "Republic Services", "Georgia Power", "AT&T", "Comcast Business")
  "account_number":        string | null,   // The customer's account number AT THE VENDOR (NOT the invoice number). Often labeled "Account Number", "Customer ID", "Service Number"
  "invoice_number":        string | null,   // The bill's unique invoice/statement number (NOT the account number). Labeled "Invoice Number", "Statement Number", "Bill Number"
  "invoice_date":          string | null,   // YYYY-MM-DD; the date the bill was issued / statement date
  "due_date":              string | null,   // YYYY-MM-DD; payment due date. If "Do Not Pay" or credit balance, set null
  "service_period_start":  string | null,   // YYYY-MM-DD; first day of the billing period
  "service_period_end":    string | null,   // YYYY-MM-DD; last day of the billing period
  "service_days":          number | null,   // Number of days in the billing period (or null if not derivable)
  "service_address":       string | null,   // Where the service is delivered (the property's address as printed on the bill)
  "remit_address":         string | null,   // Where to mail the payment ("Make Checks Payable To" / "Remit To" address)
  "line_items": [                            // Every visible charge line on the bill — one row each. Include taxes & fees separately.
    { "description": string, "amount": number, "quantity": number | null, "unit": string | null }
  ],
  "usage_readings": [                        // For water/electric/gas — every meter. Empty array for trash/phone/etc.
    { "reading_type": "water"|"sewer"|"irrigation"|"electric"|"gas"|null, "meter_start": number | null, "meter_end": number | null, "usage_amount": number | null, "usage_unit": string | null }
  ],
  "previous_balance":  number | null,        // Carried-forward balance from prior period. NEGATIVE if a credit balance.
  "current_charges":   number | null,        // THIS billing period's charges only. Always positive on a real utility bill.
  "adjustments":       number | null,        // Net adjustments / payments / credits applied THIS period (typically 0 or negative)
  "late_fees":         number | null,        // Late-payment penalties on the bill (typically 0)
  "total_amount_due":  number | null,        // The bill's headline "Total Due" or "Total Amount Due" line. Can be negative if account is in credit. If "Do Not Pay", set the actual signed total still.
  "reconciliation_check": {
    "line_items_sum": number | null,         // Sum of line_items.amount values
    "matches_total":  boolean,                // True iff line_items_sum + previous_balance + adjustments + late_fees == total_amount_due within $0.02
    "delta":          number | null           // Computed delta if reconciliation fails; null if matches
  },
  "extraction_confidence": number,           // 0.0 to 1.0. Below 0.85 triggers human review.
  "warnings": [string],                      // One string per noteworthy ambiguity
  "bill_structure": {                        // Detect whether this PDF contains 1 normal bill, 1 long bill with unit-level detail, or multiple distinct bills.
    "type":  "single" | "long_detail" | "compiled",
    "sub_bills": [                           // Empty for "single" and "long_detail". Required for "compiled".
      { "page_start": int, "page_end": int, "account_number": string|null, "service_address": string|null, "total_amount": number|null }
    ],
    "confidence": number,                    // 0..1. Use <0.85 if you're unsure whether it's compiled vs single.
    "notes": string | null
  }
}

Critical rules:
- ALWAYS use the EXACT field names above. Do not rename "vendor_name" → "vendor", "account_number" → "account", "invoice_number" → "invoice_no", or invent new top-level keys.
- Dates ALWAYS in YYYY-MM-DD. Use null if not stated.
- Amounts are unsigned-or-signed numbers WITHOUT currency symbols, WITHOUT commas, WITHOUT trailing "CR". A "$5,369.08CR" credit balance is the number -5369.08.
- account_number ≠ invoice_number. They are usually two different fields printed near each other on the bill.
- Downgrade extraction_confidence for: faded/scanned bills with OCR noise, multiple conflicting totals, handwritten amounts, unusual layouts.
- Add a warning string for: credit balances, partial payments, budget billing, bill consolidation across multiple accounts, rate changes announced on the bill.
- If the document is NOT a utility bill (notice letter, legal demand, advertising), return all nullable fields as null, extraction_confidence=0, and a warning explaining what the document is.

Bill structure rules — read this carefully, it controls how the bill gets processed downstream:

- "single": ONE bill, normal length (typically 1-4 pages). Most common case. Top-level fields describe the whole bill.

- "long_detail": ONE bill (one account, one period, one total) but with many pages of per-unit detail. Common for master-account vacant-unit electric bills (e.g. Austin Energy Onion Creek 100+ pages, where page 1 is the summary and subsequent pages list each unit's individual meter read and charges). 
  Signal: one consistent account number across all pages, one "Total Amount Due" on page 1, but many subsequent pages of repeating per-unit blocks.
  When you see this: top-level fields describe PAGE 1 (the summary) — the account_number, total_amount_due, service_period etc. from page 1. Set bill_structure.type = "long_detail" so downstream processing knows to extract per-unit detail in a separate pass.

- "compiled": MULTIPLE distinct bills concatenated into one PDF. Common for vendor portals that batch a customer's monthly statements together (e.g. Georgia Power 7 separate accounts in one 14-page download). Each sub-bill has its OWN account number, OWN service address, OWN total due.
  Signal: account number changes between page groups; multiple distinct "Total Due" amounts on different pages; multiple distinct service addresses.
  When you see this: 
    1. Set bill_structure.type = "compiled".
    2. Populate bill_structure.sub_bills with one entry per detected sub-bill (page_start/end inclusive, account_number, service_address, total_amount).
    3. Top-level fields should describe the FIRST sub-bill (page 1's bill) — they'll be discarded by downstream processing but need to be present and valid. Don't try to roll up totals across sub-bills.

- Confidence: if you're not sure whether a multi-page PDF is "long_detail" vs "compiled" vs "single", err toward "single" with confidence < 0.85. The downstream system has a fallback that handles ambiguous cases safely.`;

/**
 * Supported input shapes for extraction.
 *
 * Two paths:
 *   1. PDF native — pass `pdfBase64` and Claude receives the PDF directly via
 *      a `document` content block. Anthropic's API renders pages server-side
 *      and the model sees them as images. This is the simplest path and
 *      what the upload pipeline uses.
 *   2. Pre-rasterized images — pass `imageBase64: string[]`. Useful when you
 *      already have page images (from a watcher that pre-renders) or when
 *      you want to send a subset of pages.
 *
 * Pass exactly one of the two.
 */
export interface ExtractInput {
  pdfBase64?:   string;
  imageBase64?: string[];
  model?:       string;
}

// Image block media types supported by the Anthropic SDK.
type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

// Content blocks accepted by the SDK in user messages: text, image, document.
// Document blocks accept PDFs natively — the API rasterizes pages server-side.
type MessageContentBlock =
  | { type: "text";     text: string }
  | { type: "image";    source: { type: "base64"; media_type: ImageMediaType; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export async function extractBill(input: ExtractInput): Promise<ExtractedBillT> {
  // Default to Sonnet 4.5 — capable enough for utility-bill structured
  // extraction and ~5× cheaper / faster than Opus. Override via the
  // ANTHROPIC_EXTRACTION_MODEL env var when you need Opus quality on a
  // particular hard case.
  //
  // We sanitize the env value defensively: shell-style envs sometimes
  // include trailing comments (`claude-sonnet-4-5  # cheaper`) which
  // dotenv-style readers pass through verbatim, and the API rejects them
  // with a 404 not_found_error.
  const rawModel = input.model ?? process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-sonnet-4-5";
  const model = rawModel.split("#")[0].trim();

  if (!input.pdfBase64 && (!input.imageBase64 || input.imageBase64.length === 0)) {
    throw new Error("Either pdfBase64 or imageBase64 must be provided");
  }

  const content: MessageContentBlock[] = [];

  if (input.pdfBase64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 },
    });
  } else if (input.imageBase64) {
    for (const img of input.imageBase64) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: img },
      });
    }
  }

  content.push({
    type: "text",
    text: "Extract this utility bill. Respond with JSON only, no markdown fences or prose.",
  });

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    // Cast to any — the Anthropic API accepts `document` content blocks for
    // native PDF input, but @anthropic-ai/sdk@0.30.1's TypeScript types only
    // declare TextBlockParam | ImageBlockParam | ToolUseBlockParam |
    // ToolResultBlockParam in MessageParam.content. The runtime call works
    // fine; we cast at the boundary to avoid the strict-mode error.
    // Upgrade the SDK to a version with DocumentBlockParam to remove this.
    messages: [{ role: "user", content: content as any }],
  });

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content for extraction");
  }

  const raw = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Extraction JSON parse failed: ${(e as Error).message}. Raw: ${raw.slice(0, 400)}`);
  }

  const result = ExtractedBill.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Extraction schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

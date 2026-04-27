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

export const ExtractedLineItem = z.object({
  description: z.string(),
  amount: z.number(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
});

export const ExtractedUsageReading = z.object({
  reading_type: z.enum(["water", "sewer", "irrigation", "electric", "gas"]).nullable(),
  meter_start: z.number().nullable(),
  meter_end: z.number().nullable(),
  usage_amount: z.number().nullable(),
  usage_unit: z.string().nullable(),
});

export const ExtractedBill = z.object({
  vendor_name: z.string().nullable(),
  account_number: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable(),         // ISO YYYY-MM-DD
  due_date: z.string().nullable(),
  service_period_start: z.string().nullable(),
  service_period_end: z.string().nullable(),
  service_days: z.number().nullable(),

  service_address: z.string().nullable(),
  remit_address: z.string().nullable(),

  line_items: z.array(ExtractedLineItem),
  usage_readings: z.array(ExtractedUsageReading),

  previous_balance: z.number().nullable(),
  current_charges: z.number().nullable(),
  adjustments: z.number().nullable(),
  late_fees: z.number().nullable(),
  total_amount_due: z.number().nullable(),

  // Self-validation from the model
  reconciliation_check: z.object({
    line_items_sum: z.number().nullable(),
    matches_total: z.boolean(),
    delta: z.number().nullable(),
  }),
  extraction_confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export type ExtractedBillT = z.infer<typeof ExtractedBill>;

const SYSTEM_PROMPT = `You are extracting billing data from utility bills for an affordable-housing property manager. Bills come from water, sewer, electric, gas, trash, cable, phone, and courier vendors. Each bill has the same core shape: vendor + account + service period + charges + total due.

Respond with JSON only, matching the schema provided. Rules:
- Dates in YYYY-MM-DD. Use null if a date is not stated.
- Amounts are signed numbers (credits negative, charges positive). No currency symbols. No thousands separators.
- line_items: one row per visible charge line on the face of the bill. Include storm water, environmental protection, taxes, and fees as separate line items — do not bundle them.
- usage_readings: populate for water and electric bills. Include every meter shown.
- reconciliation_check.line_items_sum is the sum of all line_items.amount plus any adjustments, previous balance, and late fees. matches_total is true iff this equals total_amount_due within $0.02.
- Set extraction_confidence in [0,1]. Below 0.85 triggers human review. Downgrade confidence for: faded scans, multiple conflicting totals, handwritten amounts, unusual bill layouts.
- Add a warning string for anything ambiguous, especially: partial payments, budget billing, bill consolidation across multiple accounts, rate changes announced on the bill.
- If the document is NOT a utility bill (e.g., a notice, a letter, a legal demand), return nulls across the board, extraction_confidence=0, and a warning explaining what the document is.`;

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
    max_tokens: 4096,
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

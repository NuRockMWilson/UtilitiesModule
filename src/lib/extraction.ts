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
 * Supported input shapes for extraction. PDFs are expected to be rendered to
 * page images before reaching this function — the upload pipeline handles
 * that conversion automatically. Passing `pdfBase64` alone throws.
 */
export interface ExtractInput {
  /** Deprecated: set imageBase64 instead. Kept for backward compatibility. */
  pdfBase64?: string;
  /** Array of base64-encoded page images (PNG/JPEG/GIF/WEBP). */
  imageBase64?: string[];
  model?: string;
}

// Image block media types supported by the Anthropic SDK.
type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

// Inline union of message content block shapes. Kept inline rather than
// imported from the SDK because the SDK's type paths have shifted across
// versions. The installed SDK accepts exactly text + image (not document)
// blocks in user messages, so PDFs must be rendered to images beforehand.
type MessageContentBlock =
  | { type: "text";  text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

export async function extractBill(input: ExtractInput): Promise<ExtractedBillT> {
  const model = input.model ?? process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-opus-4-7";

  if (input.pdfBase64 && (!input.imageBase64 || input.imageBase64.length === 0)) {
    throw new Error(
      "PDFs must be rendered to page images before extraction. " +
      "Pass `imageBase64: string[]` — the upload pipeline handles this conversion.",
    );
  }

  const content: MessageContentBlock[] = [];

  if (input.imageBase64) {
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
    messages: [{ role: "user", content }],
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

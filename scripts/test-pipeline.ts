#!/usr/bin/env node
/**
 * Phase A integration test — uses a HAND-EXTRACTED version of the
 * Republic Services bill from /mnt/project/Republic_Services_33126.pdf
 * to walk every downstream stage of the pipeline.
 *
 * This validates everything EXCEPT the LLM call:
 *   - GL coding produces the "500-PROP-GL.SUB" string Sage expects
 *   - Variance computation accepts the data shape we'd produce
 *   - Sage 300 CRE adapter produces a valid API+APD file matching the spec
 *
 * When you have an Anthropic API key on the deployed Vercel app, the same
 * data flows from the real extractBill() result instead of the constants
 * here, and the rest of this test is identical.
 *
 * Usage (after `npm install`):
 *   npx tsx scripts/test-pipeline.ts
 */

// Manually-transcribed extraction of Republic_Services_33126.pdf for testing.
// In production, extractBill() returns this shape from the LLM call.
const extractedBill = {
  vendor_name:           "Republic Services",
  account_number:        "3-0800-0149320",
  invoice_number:        "0800-010866809",
  invoice_date:          "2026-03-31",
  due_date:              null,                 // "Do Not Pay" credit balance
  service_period_start:  "2026-03-01",
  service_period_end:    "2026-03-31",
  service_days:          31,

  service_address:       "Hearthstone Landing, 100 Hearthstone Landing Dr, Canton, GA",
  remit_address:         "REPUBLIC SERVICES #800, FOR BFI WASTE SERVICES, LLC, PO BOX 71068, CHARLOTTE NC 28272-1068",

  line_items: [
    { description: "Disposal/Recycling 03/03 (1.79 tons)",  amount:  184.07 },
    { description: "Pickup Service 03/03",                  amount:  257.50 },
    { description: "Disposal/Recycling 03/10 (3.70 tons)",  amount:  380.47 },
    { description: "Pickup Service 03/10",                  amount:  257.50 },
    { description: "Disposal/Recycling 03/17 (0.70 ton)",   amount:   71.98 },
    { description: "Pickup Service 03/17",                  amount:  257.50 },
    { description: "Disposal/Recycling 03/24 (0.71 ton)",   amount:   73.01 },
    { description: "Pickup Service 03/24",                  amount:  257.50 },
    { description: "Disposal/Recycling 03/31 (1.44 tons)",  amount:  148.08 },
    { description: "Pickup Service 03/31",                  amount:  257.50 },
    { description: "In County Host & State Fee",            amount:   12.52 },
  ],
  usage_readings: [],

  previous_balance:  -5369.08,
  current_charges:   2157.63,
  adjustments:       0,
  late_fees:         0,
  total_amount_due:  2157.63,

  reconciliation_check: {
    line_items_sum:  2157.63,
    matches_total:   true,
    delta:           0,
  },
  extraction_confidence: 0.98,
  warnings:              [],
};

// ---------- Step 1: format the GL coding string ----------
import { formatGLCoding } from "../src/lib/coding";

const propertyCode = "508";   // Hearthstone Landing
const glCode       = "5135";  // Trash Removal
const subCode      = "00";

const gl_coding = formatGLCoding({ property_code: propertyCode, gl_code: glCode, sub_code: subCode });
console.log("\n--- 1. GL coding ---");
console.log(`  formatted: ${gl_coding}`);
const codingOk = /^\d{3}-\d+-\d{4}\.\d{2}$/.test(gl_coding);
console.log(`  matches xxx-xxx-xxxx.xx: ${codingOk}`);

// ---------- Step 2: simulate variance against a few prior invoices ----------
import { computeVariance } from "../src/lib/variance";

// 3 priors mocking earlier 2026 Republic Services bills for Hearthstone
const priors = [
  { id: "h1", service_period_start: "2026-01-01", service_period_end: "2026-01-31",
    service_days: 31, total_amount_due: 1980.55, daily_usage: null,
    exclude_from_baseline: false, variance_flagged: false, variance_explanation: null },
  { id: "h2", service_period_start: "2026-02-01", service_period_end: "2026-02-28",
    service_days: 28, total_amount_due: 2050.20, daily_usage: null,
    exclude_from_baseline: false, variance_flagged: false, variance_explanation: null },
  { id: "h3", service_period_start: "2025-12-01", service_period_end: "2025-12-31",
    service_days: 31, total_amount_due: 2010.90, daily_usage: null,
    exclude_from_baseline: false, variance_flagged: false, variance_explanation: null },
];

const variance = computeVariance({
  currentDays:       extractedBill.service_days!,
  currentTotal:      extractedBill.total_amount_due!,
  currentDailyUsage: null,
  priorInvoices:     priors,
  thresholdPct:      3,
  windowMonths:      12,
});
console.log("\n--- 2. Variance ---");
console.log(`  basis:        ${variance.basis}`);
console.log(`  baseline:     ${variance.baseline?.toFixed(4) ?? "n/a"}`);
console.log(`  variance %:   ${variance.variancePct?.toFixed(2) ?? "n/a"}`);
console.log(`  flagged:      ${variance.flagged}`);

// ---------- Step 3: build the Sage payload and run the adapter ----------
import { sage300cre } from "../src/lib/sage/sage300cre";

const result = await sage300cre.postBatch({
  batch_reference: "phase-a-test-001",
  invoices: [{
    internal_id:           "test-1",
    vendor_id:             "REPUB001",                 // would come from vendors.sage_vendor_id
    invoice_number:        extractedBill.invoice_number!,
    invoice_date:          extractedBill.invoice_date!,
    due_date:              extractedBill.due_date     ?? extractedBill.invoice_date!,
    gl_coding:             gl_coding,
    amount:                extractedBill.total_amount_due!,
    description:           "Trash hauling Mar 2026",
    service_period_start:  extractedBill.service_period_start ?? undefined,
    service_period_end:    extractedBill.service_period_end   ?? undefined,
  }],
});

console.log("\n--- 3. Sage AP Import file ---");
console.log(`  filename: ${result.artifact_filename}`);
console.log(`  bytes:    ${result.artifact_content?.length ?? 0}`);
console.log(`  --- contents ---`);
console.log(result.artifact_content);
console.log(`  --- end ---`);

// ---------- Step 4: verify the file against the spec ----------
console.log("\n--- 4. Spec compliance checks ---");
const lines = (result.artifact_content ?? "").split("\r\n").filter(Boolean);
const apiLine = lines.find(l => l.startsWith("API,"));
const apdLine = lines.find(l => l.startsWith("APD,"));
const apiFields = apiLine?.split(",") ?? [];
const apdFields = apdLine?.split(",") ?? [];

const checks = [
  ["API record present",                         !!apiLine],
  ["APD record present",                         !!apdLine],
  ["API has 16 fields",                          apiFields.length === 16],
  ["APD has 15 fields",                          apdFields.length === 15],
  ["API[0] === 'API'",                           apiFields[0] === "API"],
  ["APD[0] === 'APD'",                           apdFields[0] === "APD"],
  ["Vendor ≤ 10 chars",                          (apiFields[1]?.length ?? 0) <= 10],
  ["Invoice # ≤ 15 chars",                       (apiFields[2]?.length ?? 0) <= 15],
  ["Description ≤ 30 chars",                     (apiFields[3]?.length ?? 0) <= 30],
  ["Amount is numeric",                          /^-?\d+\.\d{2}$/.test(apiFields[4] ?? "")],
  ["Invoice Date is MM/DD/YYYY",                 /^\d{2}\/\d{2}\/\d{4}$/.test(apiFields[6] ?? "")],
  ["APD Expense Account matches xxx-xxx-xxxx.xx", /^\d{3}-\d+-\d{4}\.\d{2}$/.test(apdFields[7] ?? "")],
  ["APD Amount = API Amount",                    apdFields[9] === apiFields[4]],
];

let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (ok) pass++;
}
console.log(`\n  ${pass}/${checks.length} spec checks passed`);

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { extractBill } from "@/lib/extraction";
import { computeVariance } from "@/lib/variance";
import { formatGLCoding, inferGLCode } from "@/lib/coding";
import { resolveVendor } from "@/lib/vendor-resolver";

export async function POST(_: Request, { params }: { params: { invoiceId: string } }) {
  const supabase = createSupabaseServiceClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, pdf_path, property_id, utility_account_id, vendor_id")
    .eq("id", params.invoiceId)
    .single();

  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!invoice.pdf_path) return NextResponse.json({ error: "No PDF attached" }, { status: 400 });

  await supabase.from("invoices").update({ status: "extracting" }).eq("id", invoice.id);

  // Download the PDF from Supabase Storage
  const { data: pdfFile, error: dlErr } = await supabase.storage
    .from("invoices")
    .download(invoice.pdf_path);

  if (dlErr || !pdfFile) {
    await supabase.from("invoices").update({ status: "extraction_failed" }).eq("id", invoice.id);
    return NextResponse.json({ error: `PDF download failed: ${dlErr?.message}` }, { status: 500 });
  }

  const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

  let extracted;
  try {
    extracted = await extractBill({ pdfBase64 });
  } catch (e) {
    await supabase
      .from("invoices")
      .update({
        status: "extraction_failed",
        extraction_warnings: [(e as Error).message],
      })
      .eq("id", invoice.id);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Resolve utility account by vendor + account number if not already linked
  let utilityAccountId = invoice.utility_account_id;
  let propertyId = invoice.property_id;
  let vendorId = invoice.vendor_id;
  let glAccountId: string | null = null;
  let glCoding: string | null = null;

  if (!utilityAccountId && extracted.account_number) {
    const { data: ua } = await supabase
      .from("utility_accounts")
      .select("id, property_id, vendor_id, gl_account_id, sub_code")
      .eq("account_number", extracted.account_number)
      .eq("active", true)
      .maybeSingle();
    if (ua) {
      utilityAccountId = ua.id;
      propertyId = ua.property_id;
      vendorId = ua.vendor_id;
      glAccountId = ua.gl_account_id;

      const { data: prop } = await supabase
        .from("properties")
        .select("code")
        .eq("id", ua.property_id)
        .single();
      const { data: gl } = await supabase
        .from("gl_accounts")
        .select("code")
        .eq("id", ua.gl_account_id)
        .single();
      if (prop && gl) {
        glCoding = formatGLCoding({
          property_code: prop.code,
          gl_code: gl.code,
          sub_code: ua.sub_code,
        });
      }
    } else {
      // No existing UA for this account number.
      // Use property-aware vendor resolver to avoid picking the wrong variant
      // (e.g. Republic - Duncan Disposal instead of Republic Services Inc.)
      const resolved = await resolveVendor(supabase, {
        extractedVendorName: extracted.vendor_name,
        propertyId: propertyId ?? null,
        accountNumber: extracted.account_number,
      });
      if (resolved.vendorId) {
        vendorId = resolved.vendorId;
      }
      if (resolved.confidence !== "none") {
        extracted.warnings = [
          ...extracted.warnings,
          `Vendor resolved via ${resolved.confidence}: ${resolved.debug}`,
        ];
      }
    }
  }

  // If no utility_account matched, fall back to GL inference from bill description
  if (!glAccountId && extracted.line_items.length > 0) {
    const inferred = inferGLCode(extracted.line_items[0]?.description);
    if (inferred) {
      const { data: gl } = await supabase
        .from("gl_accounts")
        .select("id")
        .eq("code", inferred)
        .maybeSingle();
      if (gl) glAccountId = gl.id;
    }
  }

  // Variance analysis
  let varianceBaseline: number | null = null;
  let variancePct: number | null = null;
  let varianceFlagged = false;
  let thresholdPct = 3;
  let windowMonths = 12;

  if (utilityAccountId) {
    const { data: ua } = await supabase
      .from("utility_accounts")
      .select("variance_threshold_pct, baseline_window_months")
      .eq("id", utilityAccountId)
      .single();
    thresholdPct = Number(ua?.variance_threshold_pct ?? 3);
    windowMonths = Number(ua?.baseline_window_months ?? 12);

    const { data: priors } = await supabase
      .from("invoices")
      .select(`
        id, service_period_start, service_period_end, service_days,
        total_amount_due, exclude_from_baseline, variance_flagged, variance_explanation,
        usage_readings(daily_usage)
      `)
      .eq("utility_account_id", utilityAccountId)
      .neq("id", invoice.id)
      .in("status", ["approved","posted_to_sage","paid"]);

    const currentDailyUsage = extracted.usage_readings[0]?.usage_amount && extracted.service_days
      ? extracted.usage_readings[0].usage_amount / extracted.service_days
      : null;

    const v = computeVariance({
      currentDays: extracted.service_days,
      currentTotal: extracted.total_amount_due,
      currentDailyUsage,
      thresholdPct,
      windowMonths,
      priorInvoices: (priors ?? []).map((p: any) => ({
        id: p.id,
        service_period_start: p.service_period_start,
        service_period_end: p.service_period_end,
        service_days: p.service_days,
        total_amount_due: p.total_amount_due,
        daily_usage: p.usage_readings?.[0]?.daily_usage ?? null,
        exclude_from_baseline: p.exclude_from_baseline,
        variance_flagged: p.variance_flagged,
        variance_explanation: p.variance_explanation,
      })),
    });

    varianceBaseline = v.baseline;
    variancePct = v.variancePct;
    varianceFlagged = v.flagged;
  }

  // Determine next status
  let nextStatus: "needs_coding" | "needs_variance_note" | "ready_for_approval" = "ready_for_approval";
  if (!glCoding || !utilityAccountId) nextStatus = "needs_coding";
  else if (varianceFlagged) nextStatus = "needs_variance_note";

  const requiresReview = extracted.extraction_confidence < 0.85
    || !extracted.reconciliation_check.matches_total
    || extracted.warnings.length > 0;

  if (requiresReview && nextStatus === "ready_for_approval") {
    nextStatus = "needs_coding"; // surface for human pass
  }

  // For AP tracking we care about the CURRENT month's charges, not the
  // post-credit "Total Due" line. When a bill shows a credit balance (e.g.
  // Republic Services with prior-period overpayment), `total_amount_due`
  // can be negative or zero — but we still want to track this month's
  // $X of trash service against the property's GL.
  //
  // Heuristic: if current_charges is positive but total_amount_due is
  // less than current_charges, the difference is a credit applied; the
  // AP total is the current charges. If current_charges itself is null,
  // fall back to whatever total_amount_due says.
  const apTotal =
    typeof extracted.current_charges === "number" && extracted.current_charges > 0
    && (extracted.total_amount_due === null || extracted.total_amount_due === undefined
        || extracted.total_amount_due < extracted.current_charges)
      ? extracted.current_charges
      : extracted.total_amount_due;

  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      status: nextStatus,
      utility_account_id: utilityAccountId,
      property_id: propertyId,
      vendor_id: vendorId,
      gl_account_id: glAccountId,
      invoice_number: extracted.invoice_number,
      invoice_date: extracted.invoice_date,
      due_date: extracted.due_date,
      service_period_start: extracted.service_period_start,
      service_period_end: extracted.service_period_end,
      service_days: extracted.service_days,
      current_charges: extracted.current_charges,
      previous_balance: extracted.previous_balance ?? 0,
      adjustments: extracted.adjustments ?? 0,
      late_fees: extracted.late_fees ?? 0,
      total_amount_due: apTotal,
      gl_coding: glCoding,
      raw_extraction: extracted,
      extraction_confidence: extracted.extraction_confidence,
      extraction_warnings: extracted.warnings,
      requires_human_review: requiresReview,
      variance_baseline: varianceBaseline,
      variance_pct: variancePct,
      variance_flagged: varianceFlagged,
    })
    .eq("id", invoice.id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Insert usage readings
  if (utilityAccountId && extracted.usage_readings.length > 0) {
    await supabase.from("usage_readings").insert(
      extracted.usage_readings
        .filter(r => r.reading_type)
        .map(r => ({
          invoice_id: invoice.id,
          utility_account_id: utilityAccountId,
          reading_type: r.reading_type!,
          service_start: extracted.service_period_start,
          service_end:   extracted.service_period_end,
          days:          extracted.service_days,
          usage_amount:  r.usage_amount,
          usage_unit:    r.usage_unit,
          meter_start:   r.meter_start,
          meter_end:     r.meter_end,
        })),
    );
  }

  await supabase.from("approval_log").insert({
    invoice_id: invoice.id,
    action: "extracted",
    new_status: nextStatus,
    notes: `Confidence ${(extracted.extraction_confidence * 100).toFixed(0)}%. ${extracted.warnings.length} warning(s).`,
    metadata: { reconciliation: extracted.reconciliation_check },
  });

  return NextResponse.json({
    success: true,
    status: nextStatus,
    variance_flagged: varianceFlagged,
    variance_pct: variancePct,
  });
}

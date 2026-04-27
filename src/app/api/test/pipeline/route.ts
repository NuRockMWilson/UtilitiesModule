import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { computeVariance } from "@/lib/variance";
import { formatGLCoding } from "@/lib/coding";
import { getAdapter } from "@/lib/sage/adapter";

/**
 * Phase A self-test endpoint.
 *
 * Validates that the full pipeline is wired correctly without actually
 * extracting from a PDF. Walks a synthetic invoice through every stage:
 *
 *   1. Resolve a real utility_account from the database
 *   2. Apply variance computation against its real prior invoices
 *   3. Format the GL coding string the way Sage expects
 *   4. Run the Sage adapter's postBatch in dry-run mode and inspect output
 *
 * If any step fails, the response identifies which one. If everything
 * passes, real bills will flow through the same path — so when extraction
 * later returns garbage, you'll know the failure is in extraction, not
 * downstream wiring.
 *
 * Triggered via POST /api/test/pipeline?accountNumber=XXX&propertyCode=YYY
 *
 * No real database writes happen.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const accountNumberParam = url.searchParams.get("accountNumber");
  const propertyCodeParam  = url.searchParams.get("propertyCode");

  const supabase = createSupabaseServiceClient();
  const steps: Array<{ name: string; ok: boolean; detail?: string; data?: any }> = [];

  // STEP 1 — Resolve a utility account
  let utilityAccountId: string | null = null;
  let propertyId: string | null = null;
  let vendorId: string | null = null;
  let glAccountId: string | null = null;
  let propertyCode: string | null = null;
  let glCode: string | null = null;
  let subCode: string | null = null;
  let thresholdPct = 3;
  let windowMonths = 12;

  if (accountNumberParam) {
    const { data: ua } = await supabase
      .from("utility_accounts")
      .select("id, property_id, vendor_id, gl_account_id, sub_code, account_number, variance_threshold_pct, baseline_window_months, properties!inner(code), gl_accounts!inner(code, description), vendors!inner(name, sage_vendor_id)")
      .eq("account_number", accountNumberParam)
      .eq("active", true)
      .maybeSingle();
    if (!ua) {
      steps.push({ name: "Resolve utility account", ok: false, detail: `No active account with account_number='${accountNumberParam}'` });
      return NextResponse.json({ ok: false, steps }, { status: 200 });
    }
    utilityAccountId = ua.id;
    propertyId = ua.property_id;
    vendorId = ua.vendor_id;
    glAccountId = ua.gl_account_id;
    subCode = ua.sub_code;
    propertyCode = (ua.properties as any).code;
    glCode = (ua.gl_accounts as any).code;
    thresholdPct = Number(ua.variance_threshold_pct ?? 3);
    windowMonths = Number(ua.baseline_window_months ?? 12);
    steps.push({
      name: "Resolve utility account",
      ok: true,
      detail: `${propertyCode} · ${(ua.gl_accounts as any).description} · ${(ua.vendors as any).name}`,
      data: { utilityAccountId, propertyCode, glCode, vendor: (ua.vendors as any).name, sageVendorId: (ua.vendors as any).sage_vendor_id ?? null },
    });
  } else {
    // Auto-pick the first active utility_account on the requested property
    const { data: prop } = propertyCodeParam
      ? await supabase.from("properties").select("id, code").eq("code", propertyCodeParam).single()
      : await supabase.from("properties").select("id, code").eq("active", true).order("code").limit(1).single();
    if (!prop) {
      steps.push({ name: "Resolve property", ok: false, detail: "No matching property found" });
      return NextResponse.json({ ok: false, steps }, { status: 200 });
    }
    propertyId = prop.id;
    propertyCode = prop.code;

    const { data: ua } = await supabase
      .from("utility_accounts")
      .select("id, vendor_id, gl_account_id, sub_code, account_number, variance_threshold_pct, baseline_window_months, gl_accounts!inner(code, description), vendors!inner(name, sage_vendor_id)")
      .eq("property_id", prop.id)
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!ua) {
      steps.push({ name: "Resolve utility account", ok: false, detail: `Property ${propertyCode} has no active utility_accounts` });
      return NextResponse.json({ ok: false, steps }, { status: 200 });
    }
    utilityAccountId = ua.id;
    vendorId = ua.vendor_id;
    glAccountId = ua.gl_account_id;
    subCode = ua.sub_code;
    glCode = (ua.gl_accounts as any).code;
    thresholdPct = Number(ua.variance_threshold_pct ?? 3);
    windowMonths = Number(ua.baseline_window_months ?? 12);
    steps.push({
      name: "Resolve utility account",
      ok: true,
      detail: `${propertyCode} · ${(ua.gl_accounts as any).description} · ${(ua.vendors as any).name} (auto-picked first active)`,
      data: { utilityAccountId, propertyCode, glCode, vendor: (ua.vendors as any).name, sageVendorId: (ua.vendors as any).sage_vendor_id ?? null },
    });
  }

  // STEP 2 — Compute variance against real prior invoices
  const { data: priors } = await supabase
    .from("invoices")
    .select(`
      id, service_period_start, service_period_end, service_days,
      total_amount_due, exclude_from_baseline, variance_flagged, variance_explanation
    `)
    .eq("utility_account_id", utilityAccountId)
    .order("invoice_date", { ascending: false })
    .limit(24);

  // Synthesize a candidate bill: 30-day cycle, $1.50× the avg of the priors so we should flag.
  const recent = (priors ?? []).slice(0, 6);
  const avgRecent = recent.length
    ? recent.reduce((s, p) => s + Number(p.total_amount_due ?? 0), 0) / recent.length
    : 100;
  const syntheticAmount = Math.round(avgRecent * 1.5 * 100) / 100;
  const syntheticDays = 30;

  const variance = computeVariance({
    currentDays:       syntheticDays,
    currentTotal:      syntheticAmount,
    currentDailyUsage: null,
    thresholdPct,
    windowMonths,
    priorInvoices: (priors ?? []).map((p: any) => ({
      id: p.id,
      service_period_start:  p.service_period_start,
      service_period_end:    p.service_period_end,
      service_days:          p.service_days,
      total_amount_due:      p.total_amount_due,
      daily_usage:           null,
      exclude_from_baseline: p.exclude_from_baseline,
      variance_flagged:      p.variance_flagged,
      variance_explanation:  p.variance_explanation,
    })),
  });

  steps.push({
    name: "Compute variance against priors",
    ok: variance.basis !== "insufficient_history" || (priors ?? []).length === 0,
    detail: variance.basis === "insufficient_history"
      ? `Insufficient history (${(priors ?? []).length} priors found). Variance computation needs ≥2 explained priors.`
      : `Synthetic $${syntheticAmount.toFixed(2)} over ${syntheticDays}d → baseline=${variance.baseline?.toFixed(2)}, var=${variance.variancePct?.toFixed(2)}%, flagged=${variance.flagged}`,
    data: variance,
  });

  // STEP 3 — Format GL coding
  const glCoding = formatGLCoding({
    property_code: propertyCode!,
    gl_code: glCode!,
    sub_code: subCode ?? "00",
  });
  const glOk = /^\d{3}-\d+-\d{4}\.\d{2}$/.test(glCoding);
  steps.push({
    name: "Format GL coding",
    ok: glOk,
    detail: glOk ? `Produced "${glCoding}" — matches Sage's 500-PROP-GL.SUB format`
                 : `Produced "${glCoding}" — does NOT match expected format 500-PROP-GL.SUB`,
  });

  // STEP 4 — Sage adapter dry run
  let sageSystem = "sage_300_cre";
  if (propertyId) {
    const { data: prop } = await supabase.from("properties").select("sage_system").eq("id", propertyId).single();
    if (prop?.sage_system) sageSystem = prop.sage_system;
  }
  const adapter = getAdapter(sageSystem as any);
  const adapterHealth = await adapter.healthCheck();
  steps.push({
    name: `Sage adapter ready (${sageSystem})`,
    ok: adapterHealth.ok,
    detail: adapterHealth.detail,
  });

  // Pull vendor's sage_vendor_id (already resolved above; refetch to be sure)
  const { data: vendor } = await supabase.from("vendors").select("sage_vendor_id, name").eq("id", vendorId!).single();
  if (!vendor?.sage_vendor_id) {
    steps.push({
      name: "Sage AP Import row",
      ok: false,
      detail: `Vendor "${vendor?.name}" has no sage_vendor_id set. Real bills can't post until this is filled in /admin/vendors.`,
    });
    return NextResponse.json({ ok: false, steps }, { status: 200 });
  }

  // STEP 5 — Build a synthetic invoice batch and run the adapter
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 21);
  const batchResult = await adapter.postBatch({
    batch_reference: `selftest_${Date.now()}`,
    invoices: [{
      internal_id:           "self-test-1",
      vendor_id:             vendor.sage_vendor_id,
      invoice_number:        `SELFTEST-${Date.now()}`,
      invoice_date:          today,
      due_date:              dueDate.toISOString().slice(0, 10),
      gl_coding:             glCoding,
      amount:                syntheticAmount,
      description:           "Phase A self-test (synthetic)",
      service_period_start:  today,
      service_period_end:    today,
    }],
  });

  steps.push({
    name: "Sage adapter postBatch",
    ok: batchResult.success,
    detail: batchResult.success
      ? `Generated artifact "${batchResult.artifact_filename}" (${batchResult.artifact_content?.length ?? 0} bytes)`
      : `Adapter returned success=false`,
    data: { artifact_preview: batchResult.artifact_content?.slice(0, 200) ?? null },
  });

  const allOk = steps.every(s => s.ok);
  return NextResponse.json({
    ok: allOk,
    summary: allOk
      ? "Pipeline wiring verified. When real bills arrive, any failure will be in PDF extraction or input validation, not downstream wiring."
      : "Pipeline has at least one broken stage. See steps[] for details.",
    syntheticAmount,
    steps,
  });
}

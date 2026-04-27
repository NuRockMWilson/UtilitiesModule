import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeVariance, type PriorInvoice } from "@/lib/variance";

/**
 * Variance recompute endpoint.
 *
 * Walks every active utility_account, computes a baseline from its trailing
 * 12-month invoice history, then re-evaluates every invoice older than the
 * baseline cutoff. Marks anything above threshold as variance_flagged=true
 * with the computed baseline + variance_pct stored on the invoice row.
 *
 * Idempotent — running it again over the same data produces the same result.
 *
 * Triggered via POST. Optional query params:
 *   ?propertyId=<uuid>  — limit to one property
 *   ?dryRun=1           — compute without writing
 *
 * Returns counts of accounts processed, invoices evaluated, invoices flagged.
 *
 * No auth gate yet — when role-based access lands, this should be admin-only.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId");
  const dryRun     = url.searchParams.get("dryRun") === "1";

  const supabase = createSupabaseServerClient();

  // 1. Pull every active utility account (optionally scoped to one property)
  let accountsQ = supabase
    .from("utility_accounts")
    .select("id, account_number, baseline_window_months, variance_threshold_pct, property_id, gl_account_id")
    .eq("active", true);
  if (propertyId) accountsQ = accountsQ.eq("property_id", propertyId);
  const { data: accounts, error: accErr } = await accountsQ;
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });

  let totalAccounts   = 0;
  let totalInvoices   = 0;
  let totalFlagged    = 0;
  let totalUnflagged  = 0;
  const errors: Array<{ account: string; error: string }> = [];

  for (const acct of accounts ?? []) {
    totalAccounts++;

    // 2. Pull every invoice for this account, oldest first
    const { data: invs, error: invErr } = await supabase
      .from("invoices")
      .select(`
        id, invoice_date, service_period_end, service_days,
        total_amount_due, current_charges,
        variance_explanation, exclude_from_baseline
      `)
      .eq("utility_account_id", acct.id)
      .order("invoice_date", { ascending: true });
    if (invErr) {
      errors.push({ account: acct.account_number, error: invErr.message });
      continue;
    }
    const invoices = invs ?? [];
    if (invoices.length < 3) continue; // not enough data for baseline + candidate

    // 3. For each invoice, compute variance using all PRIOR invoices as the window
    const updates: Array<{
      id: string; baseline: number | null; pct: number | null; flagged: boolean;
    }> = [];

    for (let i = 1; i < invoices.length; i++) {
      const candidate = invoices[i];
      const candidateDate = candidate.service_period_end ?? candidate.invoice_date;
      if (!candidateDate) continue;

      const priors: PriorInvoice[] = invoices.slice(0, i).map((p: any) => ({
        id:                     p.id,
        service_period_start:   p.invoice_date,         // we don't track exact period start on historical rows
        service_period_end:     p.service_period_end ?? p.invoice_date,
        service_days:           p.service_days,
        total_amount_due:       Number(p.total_amount_due ?? 0),
        daily_usage:            null,                    // historical rows have no usage data
        exclude_from_baseline:  Boolean(p.exclude_from_baseline),
        variance_flagged:       false,
        variance_explanation:   p.variance_explanation,
      }));

      const result = computeVariance({
        currentDays:       Number(candidate.service_days ?? 30),
        currentTotal:      Number(candidate.total_amount_due ?? 0),
        currentDailyUsage: null, // flat-dollar variance for historical
        priorInvoices:     priors,
        thresholdPct:      Number(acct.variance_threshold_pct ?? 3),
        windowMonths:      Number(acct.baseline_window_months ?? 12),
        asOf:              new Date(candidateDate),
      });

      updates.push({
        id:        candidate.id,
        baseline:  result.baseline,
        pct:       result.variancePct,
        flagged:   result.flagged,
      });
    }

    totalInvoices += updates.length;
    totalFlagged   += updates.filter(u => u.flagged).length;
    totalUnflagged += updates.filter(u => !u.flagged).length;

    if (dryRun) continue;

    // 4. Apply the variance fields back to each invoice. One UPDATE per invoice
    //    is OK since the per-account loop is bounded — typically <50 invoices/account.
    for (const u of updates) {
      const { error: upErr } = await supabase
        .from("invoices")
        .update({
          variance_baseline: u.baseline,
          variance_pct:      u.pct,
          variance_flagged:  u.flagged,
        })
        .eq("id", u.id);
      if (upErr) {
        errors.push({ account: acct.account_number, error: `${u.id}: ${upErr.message}` });
      }
    }
  }

  return NextResponse.json({
    ok:           errors.length === 0,
    dryRun,
    propertyId:   propertyId ?? null,
    accounts:     totalAccounts,
    invoices:     totalInvoices,
    flagged:      totalFlagged,
    unflagged:    totalUnflagged,
    errors:       errors.slice(0, 20),
    moreErrors:   Math.max(0, errors.length - 20),
  });
}

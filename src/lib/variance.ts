/**
 * Variance engine.
 *
 * Per NuRock utility AP requirements:
 * - Compare the current bill to an EXPECTED BASELINE, not the prior month.
 *   A spike-then-dip pattern (25% up, 2% down) would otherwise pass a
 *   month-over-month check while still running well above normal.
 * - Default threshold: 3% above baseline (configurable per utility_account).
 * - Default baseline window: trailing 12 months (configurable per account).
 * - Flagged bills that are never explained are excluded from future
 *   baselines via `exclude_from_baseline` so one bad month does not
 *   permanently shift the reference point.
 *
 * For water and electric we compare DAILY USAGE (usage / days); for
 * flat-rate utilities we compare DAILY DOLLARS (total / days). Normalizing
 * by days removes the noise of 29- vs 32-day billing periods.
 */

export interface PriorInvoice {
  id: string;
  service_period_start: Date | string | null;
  service_period_end:   Date | string | null;
  service_days: number | null;
  total_amount_due: number | null;
  daily_usage: number | null;
  exclude_from_baseline: boolean;
  variance_flagged: boolean;
  variance_explanation: string | null;
}

export interface VarianceInput {
  currentDays:       number | null;
  currentTotal:      number | null;
  currentDailyUsage: number | null;   // null for flat-rate utilities
  priorInvoices:     PriorInvoice[];
  thresholdPct:      number;          // e.g. 3.0
  windowMonths:      number;          // e.g. 12
  asOf?:             Date;            // defaults to now
}

export interface VarianceResult {
  baseline:           number | null;   // daily-usage baseline (or daily-dollar if flat-rate)
  baselineSampleSize: number;
  currentValue:       number | null;
  variancePct:        number | null;   // positive = above baseline
  flagged:            boolean;
  basis:              "daily_usage" | "daily_dollars" | "insufficient_history";
  reason?:            string;
}

/**
 * Compute a variance result for a bill against the trailing window of
 * prior invoices for the same utility_account.
 *
 * Baseline rule:
 *   1. Start with invoices inside [asOf - windowMonths, asOf).
 *   2. Drop any with `exclude_from_baseline = true`.
 *   3. Drop any that were flagged but never explained (no explanation text).
 *      This is the safeguard: a flagged month doesn't pollute the baseline
 *      unless the property confirmed it was expected (rate hike, irrigation
 *      schedule change, etc.).
 *   4. Require a minimum of 2 surviving data points to compute a baseline.
 *   5. Baseline = mean of surviving normalized values.
 */
export function computeVariance(input: VarianceInput): VarianceResult {
  const asOf = input.asOf ?? new Date();
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - input.windowMonths);

  const useUsage = input.currentDailyUsage !== null && input.currentDailyUsage !== undefined;
  const basis: VarianceResult["basis"] = useUsage ? "daily_usage" : "daily_dollars";

  const currentValue = useUsage
    ? input.currentDailyUsage
    : (input.currentTotal !== null && input.currentDays && input.currentDays > 0)
        ? input.currentTotal / input.currentDays
        : null;

  const sample = input.priorInvoices
    .filter(p => !p.exclude_from_baseline)
    .filter(p => !(p.variance_flagged && !p.variance_explanation))
    .filter(p => inWindow(p.service_period_end, windowStart, asOf))
    .map(p => useUsage
      ? p.daily_usage
      : (p.total_amount_due !== null && p.service_days && p.service_days > 0)
          ? p.total_amount_due / p.service_days
          : null)
    .filter((v): v is number => v !== null && v > 0);

  if (sample.length < 2) {
    return {
      baseline: null,
      baselineSampleSize: sample.length,
      currentValue: currentValue ?? null,
      variancePct: null,
      flagged: false,
      basis: "insufficient_history",
      reason: `Only ${sample.length} qualifying prior bill(s) in trailing ${input.windowMonths} months; baseline requires at least 2.`,
    };
  }

  const baseline = sample.reduce((a, b) => a + b, 0) / sample.length;

  if (currentValue === null) {
    return {
      baseline,
      baselineSampleSize: sample.length,
      currentValue: null,
      variancePct: null,
      flagged: false,
      basis,
      reason: "Current bill has no computable value for comparison.",
    };
  }

  const variancePct = ((currentValue - baseline) / baseline) * 100;
  const flagged = variancePct > input.thresholdPct;

  return {
    baseline,
    baselineSampleSize: sample.length,
    currentValue,
    variancePct,
    flagged,
    basis,
  };
}

function inWindow(
  d: Date | string | null,
  start: Date,
  end: Date,
): boolean {
  if (!d) return false;
  const date = d instanceof Date ? d : new Date(d);
  return date >= start && date < end;
}

/**
 * Format a variance result for display.
 * Percentages always to 2 decimal places per NuRock convention.
 */
export function formatVariance(r: VarianceResult): string {
  if (r.variancePct === null) return "—";
  const sign = r.variancePct >= 0 ? "+" : "";
  return `${sign}${r.variancePct.toFixed(2)}%`;
}

/**
 * Categorize a variance result for UI color coding.
 *   green  — within threshold, baseline solid
 *   yellow — over threshold OR insufficient history
 *   red    — more than 2x threshold (likely leak / rate change / coding error)
 */
export function varianceFlag(r: VarianceResult, thresholdPct: number): "green" | "yellow" | "red" {
  if (r.basis === "insufficient_history") return "yellow";
  if (r.variancePct === null) return "yellow";
  if (r.variancePct > thresholdPct * 2) return "red";
  if (r.variancePct > thresholdPct) return "yellow";
  return "green";
}

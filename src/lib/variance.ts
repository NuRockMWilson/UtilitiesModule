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

// ============================================================================
// Per-line-item variance (Priority 1 enhancement)
// ============================================================================
// When invoice_line_items is populated, variance analysis runs per category
// (water / sewer / irrigation) rather than on the lumped invoice total. Two
// reasons this is better:
//
//   1. Consumption-driven lines (water, sewer, irrigation) behave very
//      differently from flat fees (storm water, environmental protection).
//      A 10% consumption drop hidden by a 5% fee increase would slip past
//      per-invoice variance today.
//   2. Per-category variance points directly at the anomaly: "Sewer +18% vs
//      12-mo baseline" is actionable where "Water bill total +6%" is not.
//
// Lines with is_consumption_based=false (flat fees) are excluded from variance
// altogether — they're flat by definition, so variance on them is noise.

export interface LineItem {
  category: string;               // 'water' | 'sewer' | 'irrigation' | fee categories
  amount: number;
  is_consumption_based: boolean;
}

export interface LineItemInvoice {
  id: string;
  service_period_start: Date | string | null;
  service_period_end:   Date | string | null;
  service_days: number | null;
  exclude_from_baseline: boolean;
  variance_flagged: boolean;
  variance_explanation: string | null;
  line_items: LineItem[];
}

export interface CategoryVarianceInput {
  currentDays:    number | null;
  currentLines:   LineItem[];
  priorInvoices:  LineItemInvoice[];
  thresholdPct:   number;
  windowMonths:   number;
  asOf?:          Date;
}

export interface CategoryVarianceResult {
  category:           string;
  baseline:           number | null;   // daily dollars for this category
  baselineSampleSize: number;
  currentValue:       number | null;   // daily dollars this bill for this category
  variancePct:        number | null;
  flagged:            boolean;
  reason?:            string;
}

/**
 * Compute variance per consumption-based category. Returns one result per
 * category present in the current bill's line items (skipping flat fees).
 *
 * Baseline for each category = mean of prior invoices' daily dollars for that
 * same category, using the same exclusion rules as the per-invoice baseline
 * (no excluded-from-baseline, no flagged-but-unexplained).
 */
export function computeCategoryVariance(
  input: CategoryVarianceInput,
): CategoryVarianceResult[] {
  const asOf = input.asOf ?? new Date();
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - input.windowMonths);

  // Only analyze consumption-based categories from the current bill
  const currentByCategory = new Map<string, number>();
  for (const li of input.currentLines) {
    if (!li.is_consumption_based) continue;
    currentByCategory.set(li.category, (currentByCategory.get(li.category) ?? 0) + li.amount);
  }

  if (currentByCategory.size === 0) return [];

  // Filter prior invoices to the baseline window and exclude polluted rows
  const eligible = input.priorInvoices
    .filter(p => !p.exclude_from_baseline)
    .filter(p => !(p.variance_flagged && !p.variance_explanation))
    .filter(p => inWindow(p.service_period_end, windowStart, asOf));

  const results: CategoryVarianceResult[] = [];

  for (const [category, currentAmount] of currentByCategory.entries()) {
    // Daily dollars for this category on each prior invoice
    const sample = eligible
      .map(p => {
        if (!p.service_days || p.service_days <= 0) return null;
        const categoryTotal = p.line_items
          .filter(li => li.category === category && li.is_consumption_based)
          .reduce((sum, li) => sum + li.amount, 0);
        if (categoryTotal <= 0) return null;
        return categoryTotal / p.service_days;
      })
      .filter((v): v is number => v !== null);

    const currentDaily = input.currentDays && input.currentDays > 0
      ? currentAmount / input.currentDays
      : null;

    if (sample.length < 2) {
      results.push({
        category,
        baseline: null,
        baselineSampleSize: sample.length,
        currentValue: currentDaily,
        variancePct: null,
        flagged: false,
        reason: `Only ${sample.length} qualifying prior bill(s) with ${category} line items; baseline requires at least 2.`,
      });
      continue;
    }

    const baseline = sample.reduce((a, b) => a + b, 0) / sample.length;

    if (currentDaily === null) {
      results.push({
        category,
        baseline,
        baselineSampleSize: sample.length,
        currentValue: null,
        variancePct: null,
        flagged: false,
        reason: "Current bill missing service_days; cannot normalize.",
      });
      continue;
    }

    const variancePct = ((currentDaily - baseline) / baseline) * 100;
    results.push({
      category,
      baseline,
      baselineSampleSize: sample.length,
      currentValue: currentDaily,
      variancePct,
      flagged: variancePct > input.thresholdPct,
    });
  }

  return results.sort((a, b) => {
    // Flagged first, then highest variance
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return (b.variancePct ?? -Infinity) - (a.variancePct ?? -Infinity);
  });
}

/** Whether any category in a category-variance result set is flagged. */
export function hasCategoryFlags(results: CategoryVarianceResult[]): boolean {
  return results.some(r => r.flagged);
}

/** Summary text for display: "Water +18.3%, Sewer +4.1%". */
export function summarizeCategoryVariances(results: CategoryVarianceResult[]): string {
  const withData = results.filter(r => r.variancePct !== null);
  if (withData.length === 0) return "No variance data";
  return withData
    .map(r => {
      const pct = r.variancePct!;
      const sign = pct >= 0 ? "+" : "";
      const cat = r.category.charAt(0).toUpperCase() + r.category.slice(1);
      return `${cat} ${sign}${pct.toFixed(2)}%`;
    })
    .join(", ");
}

// ============================================================================
// Unit-normalized variance (Priority 4 — trash/garbage)
// ============================================================================
// For bills where cost scales with service-unit count (trash pickups,
// FedEx deliveries, temporary-container rentals), comparing absolute dollars
// to a trailing baseline produces false positives. The real question is:
// "did cost per pickup change?" not "did monthly cost change?"
//
// This runs the same baseline + exclusion rules as the per-invoice engine,
// but on cost-per-unit instead of absolute cost or daily cost.

export interface UnitNormalizedInput {
  currentAmount:  number | null;
  currentUnits:   number | null;
  priorInvoices:  {
    service_period_end:    Date | string | null;
    total_amount_due:      number | null;
    units_billed:          number | null;
    exclude_from_baseline: boolean;
    variance_flagged:      boolean;
    variance_explanation:  string | null;
  }[];
  thresholdPct:   number;
  windowMonths:   number;
  asOf?:          Date;
}

export interface UnitNormalizedResult {
  baseline:           number | null;    // baseline $/unit
  baselineSampleSize: number;
  currentValue:       number | null;    // current $/unit
  variancePct:        number | null;
  flagged:            boolean;
  basis:              "dollars_per_unit" | "insufficient_history";
  reason?:            string;
}

/**
 * Compute variance on a $/unit basis, excluding bills without a unit count.
 *
 * Example usage for a trash bill:
 *   computeUnitNormalizedVariance({
 *     currentAmount: 4200,
 *     currentUnits:  5,            // pickups
 *     priorInvoices: [...last 12 trash bills for this account],
 *     thresholdPct:  3.0,
 *     windowMonths:  12,
 *   })
 */
export function computeUnitNormalizedVariance(
  input: UnitNormalizedInput,
): UnitNormalizedResult {
  const asOf = input.asOf ?? new Date();
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - input.windowMonths);

  const currentValue =
    input.currentAmount !== null && input.currentUnits && input.currentUnits > 0
      ? input.currentAmount / input.currentUnits
      : null;

  const sample = input.priorInvoices
    .filter(p => !p.exclude_from_baseline)
    .filter(p => !(p.variance_flagged && !p.variance_explanation))
    .filter(p => inWindow(p.service_period_end, windowStart, asOf))
    .filter(p => p.total_amount_due !== null && p.units_billed !== null && p.units_billed > 0)
    .map(p => p.total_amount_due! / p.units_billed!)
    .filter((v): v is number => v > 0);

  if (sample.length < 2) {
    return {
      baseline: null,
      baselineSampleSize: sample.length,
      currentValue,
      variancePct: null,
      flagged: false,
      basis: "insufficient_history",
      reason: `Only ${sample.length} prior bill(s) with unit counts in trailing ${input.windowMonths} months. A baseline needs at least 2.`,
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
      basis: "dollars_per_unit",
      reason: "Current bill has no unit count — cannot normalize.",
    };
  }

  const variancePct = ((currentValue - baseline) / baseline) * 100;
  return {
    baseline,
    baselineSampleSize: sample.length,
    currentValue,
    variancePct,
    flagged: variancePct > input.thresholdPct,
    basis: "dollars_per_unit",
  };
}

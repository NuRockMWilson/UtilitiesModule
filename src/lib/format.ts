/**
 * NuRock number formatting conventions:
 *   - Quantities and dollar amounts use comma separators: $1,234,567.89
 *   - Percentages use exactly two decimal places: 3.00%
 *   - Negative dollars shown in parentheses: $(1,234.56)
 */

export function formatDollars(
  value: number | null | undefined,
  opts: { parens?: boolean; cents?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const cents = opts.cents !== false;
  const abs = Math.abs(value);
  const str = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  if (value < 0 && opts.parens) return `$(${str})`;
  if (value < 0) return `-$${str}`;
  return `$${str}`;
}

export function formatNumber(
  value: number | null | undefined,
  decimals = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(
  value: number | null | undefined,
  opts: { decimals?: number; sign?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const decimals = opts.decimals ?? 2;
  const str = value.toFixed(decimals);
  if (opts.sign && value >= 0) return `+${str}%`;
  return `${str}%`;
}

export function formatGallons(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNumber(value, 0)} gal`;
}

export function formatDays(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value} days`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatMonthYear(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

/**
 * Date utilities for user-input dates.
 *
 * The database stores dates in Postgres `date` columns, which round-trip as
 * ISO 8601 strings (`YYYY-MM-DD`). The UI prefers US-style M/D/YYYY for
 * readability. These helpers translate between the two and accept a
 * generous set of input formats so users don't get rejected for typos.
 *
 * Accepted input formats (all return ISO YYYY-MM-DD):
 *
 *   M/D/YYYY      4/28/2026
 *   MM/DD/YYYY    04/28/2026
 *   M-D-YYYY      4-28-2026
 *   M.D.YYYY      4.28.2026
 *   M/D/YY        4/28/26       (00-49 → 2000-2049, 50-99 → 1950-1999)
 *   YYYY-MM-DD    2026-04-28    (legacy / ISO; still accepted)
 *   YYYY/MM/DD    2026/04/28
 *   MMDDYYYY      04282026      (no separators, fully padded)
 *   MMDYYYY       1212026       (12/1/2026 — month is 12, day is 1)
 *   MDDYYYY       4282026       (4/28/2026 — month is 4, day is 28)
 *   MDYYYY        412026        (4/1/2026 — single-digit month and day)
 *
 * Anything else returns null. Caller decides whether null means "leave the
 * field untouched" or "report an error to the user".
 */

/** Pad a positive integer with a leading zero if < 10. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Validate (year, month, day) and return ISO YYYY-MM-DD, or null if the
 * components don't form a real calendar date. Uses the Date constructor's
 * own overflow handling: Feb 30 → March 2, which we then detect as a
 * mismatch and reject.
 */
function tryFormatISO(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Cross-check via Date — catches Feb 30, Apr 31, etc.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parse a user-typed date in any of the accepted formats. Returns ISO
 * YYYY-MM-DD on success, null on failure.
 *
 * Whitespace is stripped. Empty strings return null (caller can interpret
 * as "no value provided").
 */
export function parseUserDate(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return tryFormatISO(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));

  // M/D/YYYY (or with - or .)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return tryFormatISO(parseInt(m[3], 10), parseInt(m[1], 10), parseInt(m[2], 10));

  // M/D/YY (2-digit year): 00-49 → 2000-2049, 50-99 → 1950-1999
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const fullYear = yy < 50 ? 2000 + yy : 1900 + yy;
    return tryFormatISO(fullYear, parseInt(m[1], 10), parseInt(m[2], 10));
  }

  // No separators — just digits. Strip anything non-numeric defensively.
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) {
    // MMDDYYYY
    return tryFormatISO(
      parseInt(digits.slice(4, 8), 10),
      parseInt(digits.slice(0, 2), 10),
      parseInt(digits.slice(2, 4), 10),
    );
  }
  if (digits.length === 7) {
    // Ambiguous: MMDYYYY ('1212026' = 12/1/2026) or MDDYYYY ('4282026' = 4/28/2026).
    // Try MMDYYYY first only if leading two digits are a valid month.
    const mmCandidate = parseInt(digits.slice(0, 2), 10);
    if (mmCandidate >= 1 && mmCandidate <= 12) {
      const result = tryFormatISO(
        parseInt(digits.slice(3, 7), 10),
        mmCandidate,
        parseInt(digits.slice(2, 3), 10),
      );
      if (result) return result;
    }
    // Fall back to MDDYYYY
    return tryFormatISO(
      parseInt(digits.slice(3, 7), 10),
      parseInt(digits.slice(0, 1), 10),
      parseInt(digits.slice(1, 3), 10),
    );
  }
  if (digits.length === 6) {
    // MDYYYY (e.g. '412026' = 4/1/2026)
    return tryFormatISO(
      parseInt(digits.slice(2, 6), 10),
      parseInt(digits.slice(0, 1), 10),
      parseInt(digits.slice(1, 2), 10),
    );
  }

  return null;
}

/**
 * Format an ISO date string (or Date) as US-style M/D/YYYY for display in
 * an input field. Returns empty string for null/invalid inputs so it's
 * safe to pass directly to a controlled `<input>` value.
 */
export function formatDateInput(value: string | Date | null | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  }
  const s = String(value).trim();
  if (!s) return "";
  // Accept ISO YYYY-MM-DD directly
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${parseInt(iso[2], 10)}/${parseInt(iso[3], 10)}/${iso[1]}`;
  }
  // If it's already in M/D/YYYY-ish form, just normalize separators
  const parsed = parseUserDate(s);
  if (parsed) {
    const m = parsed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1]}`;
  }
  return "";
}

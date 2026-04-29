/**
 * Display helpers for property names.
 *
 * Property names in the database often include compound forms like
 * "Hearthstone Landing / HL Canton" where the part after the slash is a
 * disambiguation suffix used internally. In selection screens (dropdowns,
 * pickers, page titles) we want the cleaner short name only.
 *
 * Stays a string-level transform — no DB changes — because the suffix is
 * still useful elsewhere (Sage exports, audit logs, full names) and we
 * don't want to lose that data.
 */

/**
 * Returns the canonical short name for display in selection contexts.
 * Strips everything from the first " /" or "/" onward and trims whitespace.
 *
 * Examples:
 *   "Hearthstone Landing / HL Canton"  → "Hearthstone Landing"
 *   "Onion Creek"                      → "Onion Creek"
 *   "Heritage @ Walton Reserve"        → "Heritage @ Walton Reserve"
 *   ""                                 → ""
 *   null/undefined                     → ""
 */
export function displayPropertyName(name: string | null | undefined): string {
  if (!name) return "";
  const idx = name.indexOf("/");
  if (idx < 0) return name.trim();
  return name.slice(0, idx).trim();
}

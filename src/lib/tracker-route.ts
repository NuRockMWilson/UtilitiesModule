/**
 * Maps a GL account code to the property tracker subroute that displays
 * invoices for that GL.
 *
 * Each tracker variant aggregates invoices across a specific subset of
 * GL codes — the slicing matches NuRock's legacy spreadsheet structure
 * (House Meters, Vacant Units, Water, Trash, Comms). When viewing a
 * single invoice, this helper figures out which tracker the user came
 * from (or would naturally want to return to).
 *
 * GL → tracker mapping:
 *   5112, 5116           → /tracker/{code}/meters    (house electric, clubhouse)
 *   5120, 5122, 5125     → /tracker/{code}/water     (water/sewer)
 *   5114                 → /tracker/{code}/vacant    (vacant units)
 *   5135                 → /tracker/{code}/trash     (trash/garbage)
 *   5140                 → /tracker/{code}/comms     (cable/phone/internet)
 *   anything else        → /tracker/{code}            (summary, fallback)
 *
 * Returns null if propertyCode is null/empty (e.g. an invoice that isn't
 * linked to a property yet) — callers should hide the breadcrumb in
 * that case rather than render a broken link.
 */
export function trackerRouteForInvoice(
  propertyCode: string | null | undefined,
  glCode: string | null | undefined,
): { href: string; label: string } | null {
  if (!propertyCode) return null;

  const subroute = trackerSubrouteForGl(glCode);
  return {
    href:  `/tracker/${propertyCode}${subroute.path}`,
    label: subroute.label,
  };
}

interface SubrouteInfo {
  /** URL fragment after /tracker/{code}, including leading slash if non-empty. */
  path: string;
  /** Human label for the link, e.g. "House meters tracker". */
  label: string;
}

function trackerSubrouteForGl(glCode: string | null | undefined): SubrouteInfo {
  // Normalize: GL might be "5112" or "5112.00" or "500-601-5112.00" — extract
  // the 4-digit core. We only care about the GL category, not property/sub.
  if (!glCode) return { path: "", label: "Property tracker" };

  const m = String(glCode).match(/\b(5\d{3})\b/);
  if (!m) return { path: "", label: "Property tracker" };

  const gl = m[1];
  switch (gl) {
    case "5112":
    case "5116":
      return { path: "/meters", label: "House meters tracker" };
    case "5120":
    case "5122":
    case "5125":
      return { path: "/water",  label: "Water tracker" };
    case "5114":
      return { path: "/vacant", label: "Vacant units tracker" };
    case "5135":
      return { path: "/trash",  label: "Trash tracker" };
    case "5140":
      return { path: "/comms",  label: "Comms tracker" };
    default:
      return { path: "",        label: "Property tracker" };
  }
}

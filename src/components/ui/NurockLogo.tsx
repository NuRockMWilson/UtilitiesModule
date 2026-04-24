/**
 * NuRock "NR" monogram — a square tile with the NR letterform.
 *
 * Two common presentations in the NuRock design system:
 *
 *   1. "onDark"  — when the monogram sits on the navy Header. A white
 *      rounded square background with navy NR text. This is the primary
 *      application of the mark.
 *
 *   2. "onLight" — when the monogram sits on a white/light surface such as
 *      the login card or a print letterhead. A navy rounded square with
 *      white NR text. Inverse of above.
 *
 * The text uses Oswald at bold weight with slight negative tracking, matching
 * the reference design exactly. Use `variant="solid"` to match the reference
 * header's outer-square appearance (white tile + navy NR).
 */

import { cn } from "@/lib/cn";

interface Props {
  /** Total pixel size of the square tile (default 40 = matches header). */
  size?:      number;
  /** 'onDark' (default) renders a white tile with navy NR — use on navy headers.
   *  'onLight' renders a navy tile with white NR — use on white surfaces. */
  variant?:   "onDark" | "onLight";
  /** Show "NuRock" wordmark to the right of the monogram. */
  withText?:  boolean;
  className?: string;
  /** Optional label for screen readers. */
  ariaLabel?: string;
}

export function NurockLogo({
  size      = 40,
  variant   = "onDark",
  withText  = false,
  className,
  ariaLabel = "NuRock",
}: Props) {
  // Reference design uses:
  //   onDark  → white tile (#FFFFFF), navy NR  (#164576)
  //   onLight → navy tile  (#164576), white NR (#FFFFFF)
  const tileFill = variant === "onDark" ? "#FFFFFF" : "#164576";
  const textFill = variant === "onDark" ? "#164576" : "#FFFFFF";

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 40 40"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-label={ariaLabel}
        role="img"
        className="flex-shrink-0"
      >
        <rect width="40" height="40" rx="6" fill={tileFill} />
        <text
          x="20"
          y="27"
          textAnchor="middle"
          fontFamily="Oswald, ui-sans-serif, system-ui, sans-serif"
          fontSize="20"
          fontWeight="700"
          fill={textFill}
          letterSpacing="-0.5"
        >
          NR
        </text>
      </svg>
      {withText && (
        <div className="leading-tight">
          <div className="font-display text-sm uppercase tracking-[0.14em]">NuRock</div>
          <div className="text-[10px] opacity-60 tracking-wide">Utilities AP</div>
        </div>
      )}
    </div>
  );
}

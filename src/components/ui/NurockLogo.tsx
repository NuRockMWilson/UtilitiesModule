/**
 * NuRock "NR" monogram — minimal SVG so no asset dependencies.
 * Swap in the official brand mark when ready by replacing the inner paths.
 */

import { cn } from "@/lib/cn";

interface Props {
  className?: string;
  /** Show text alongside the mark. */
  withText?: boolean;
  /** Force mark color (defaults to current text color). */
  color?: string;
}

export function NurockLogo({ className, withText, color }: Props) {
  const fill = color ?? "currentColor";
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 40 40"
        width="32"
        height="32"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="NuRock"
        role="img"
      >
        <rect x="1" y="1" width="38" height="38" rx="6" fill={fill} />
        <text
          x="20"
          y="27"
          textAnchor="middle"
          fontFamily="Oswald, system-ui, sans-serif"
          fontSize="18"
          fontWeight="600"
          fill="#FBFBF8"
          letterSpacing="0.5"
        >
          NR
        </text>
      </svg>
      {withText && (
        <span className="font-display text-lg font-semibold tracking-tight">
          NuRock
        </span>
      )}
    </div>
  );
}

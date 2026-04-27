import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * NuRock brand logo — the calligraphic N inside an oval frame, sourced
 * from the official PNG assets in /public.
 *
 * Two variants:
 *   - "onDark"  → /nurock-logo-reversed.png — for navy or dark backgrounds
 *                 (the navy has white edge highlights so it pops on dark)
 *   - "onLight" → /nurock-logo.png — for white or light surfaces
 *
 * Use `withText` to render the "NuRock / Utilities AP" wordmark to the right.
 */

interface Props {
  /** Pixel height of the logo image. Width auto-scales to preserve aspect. */
  size?:      number;
  variant?:   "onDark" | "onLight";
  withText?:  boolean;
  className?: string;
  ariaLabel?: string;
}

export function NurockLogo({
  size      = 36,
  variant   = "onDark",
  withText  = false,
  className,
  ariaLabel = "NuRock",
}: Props) {
  const src = variant === "onDark"
    ? "/nurock-logo-reversed.png"
    : "/nurock-logo.png";

  // Original image is 2232×1818, aspect ratio ≈ 1.228:1
  const width = Math.round(size * (2232 / 1818));

  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src={src}
        alt={ariaLabel}
        width={width}
        height={size}
        priority
        className="flex-shrink-0 drop-shadow-sm"
      />
      {withText && (
        <div className="leading-tight">
          <div className="font-display text-sm uppercase tracking-[0.14em]">NuRock</div>
          <div className={cn(
            "text-[10px] tracking-wide",
            variant === "onDark" ? "text-white/60" : "text-nurock-slate-light",
          )}>
            Utilities AP
          </div>
        </div>
      )}
    </div>
  );
}

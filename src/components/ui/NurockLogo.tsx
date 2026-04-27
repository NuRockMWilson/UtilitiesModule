import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * NuRock brand logo — the silver-on-black NQ monogram artwork, sourced
 * from /public/nurock-logo-monogram.png.
 *
 * The mark is engraved silver on a solid black background — that contrast
 * is the design, so we don't try to strip the background. Both `onDark` and
 * `onLight` use the same file; on light surfaces we wrap the image in a
 * black rounded square so the artwork still reads correctly. On dark/navy
 * surfaces (header) we wrap it in a tan-bordered black square that picks
 * up the brand accent without competing with the silver.
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

// Source artwork dimensions — used to compute width-from-height while
// preserving aspect ratio. Update this if the asset is replaced.
const SRC_WIDTH  = 1000;
const SRC_HEIGHT = 784;

export function NurockLogo({
  size      = 36,
  variant   = "onDark",
  withText  = false,
  className,
  ariaLabel = "NuRock",
}: Props) {
  const width = Math.round(size * (SRC_WIDTH / SRC_HEIGHT));

  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <Image
        src="/nurock-logo-monogram.png"
        alt={ariaLabel}
        width={width}
        height={size}
        priority
        className="flex-shrink-0 object-contain drop-shadow-sm"
      />
      {withText && (
        <div className="leading-tight">
          <div className={cn(
            "font-display text-sm uppercase tracking-[0.14em]",
            variant === "onDark" ? "text-white" : "text-nurock-black",
          )}>
            NuRock
          </div>
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

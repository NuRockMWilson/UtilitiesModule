import Link from "next/link";
import { NurockLogo } from "@/components/ui/NurockLogo";
import { UserMenu } from "@/components/layout/UserMenu";

/**
 * Top navigation header — navy bar across the top of the app with the NuRock
 * monogram, module switcher, and user menu on the right.
 *
 * Fixed at 56px tall, sticky, navy background with white text.
 * Matches the NuRock Development Management design system.
 */
export function Header({ userEmail }: { userEmail?: string | null }) {

  return (
    <header className="bg-nurock-navy text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-5 py-2.5 flex items-center justify-between gap-4 min-h-[56px]">
        {/* LEFT: Logo + product name */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-3 flex-shrink-0" aria-label="NuRock Utilities AP — home">
            <NurockLogo size={36} variant="onDark" withText />
          </Link>

          {/* Product pill */}
          <div className="ml-3 pl-3 border-l border-white/15 flex items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-nurock-tan text-nurock-navy-dark">
              <span className="font-display uppercase tracking-wider">Utilities AP</span>
            </span>
          </div>
        </div>

        {/* RIGHT: User menu */}
        <div className="flex items-center gap-2">
          <UserMenu userEmail={userEmail ?? null} />
        </div>
      </div>
    </header>
  );
}

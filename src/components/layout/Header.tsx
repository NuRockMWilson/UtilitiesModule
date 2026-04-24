import Link from "next/link";
import { NurockLogo } from "@/components/ui/NurockLogo";

/**
 * Top navigation header — navy bar across the top of the app with the NuRock
 * monogram, module switcher (Underwriting / Development / Utilities AP / Cost Cert),
 * and a user badge on the right.
 *
 * Fixed at 56px tall, sticky, navy background with white text.
 * Matches the NuRock Development Management design system.
 */
export function Header({ userEmail }: { userEmail?: string | null }) {
  // User initials for the MW-style avatar circle
  const initials = (userEmail ?? "?")
    .split("@")[0]
    .split(/[.\-_]/)
    .map(part => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("") || "?";

  return (
    <header className="bg-nurock-navy text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-5 py-2.5 flex items-center justify-between gap-4 min-h-[56px]">
        {/* LEFT: Monogram + module switcher */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-3 flex-shrink-0" aria-label="NuRock Utilities AP — home">
            <NurockLogo size={40} variant="onDark" withText />
          </Link>

          {/* Module switcher — future modules greyed out */}
          <div className="ml-3 pl-3 border-l border-white/15 flex items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium text-white/50 hover:text-white/80 transition cursor-not-allowed"
                  title="Underwriting module — coming soon">
              <span className="font-display uppercase tracking-wider">Underwriting</span>
            </span>
            <svg className="w-3 h-3 text-white/40" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
              <path d="M7.05 4.05a.75.75 0 011.06 0l5.5 5.5a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 11-1.06-1.06L12.03 10 7.05 5.02a.75.75 0 010-1.06z"/>
            </svg>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium text-white/50 hover:text-white/80 transition cursor-not-allowed"
                  title="Development module — coming soon">
              <span className="font-display uppercase tracking-wider">Development</span>
            </span>
            <svg className="w-3 h-3 text-white/40" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
              <path d="M7.05 4.05a.75.75 0 011.06 0l5.5 5.5a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 11-1.06-1.06L12.03 10 7.05 5.02a.75.75 0 010-1.06z"/>
            </svg>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-nurock-tan text-nurock-navy-dark">
              <span className="font-display uppercase tracking-wider">Utilities AP</span>
            </span>
          </div>
        </div>

        {/* RIGHT: Status + user */}
        <div className="flex items-center gap-2">
          {userEmail && (
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-white/70 pr-2 border-r border-white/10 mr-1">
              <svg className="w-3 h-3 text-emerald-300" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              <span>{userEmail}</span>
            </div>
          )}
          {userEmail && (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-md text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 text-white/80"
                title="Sign out"
              >
                Sign out
              </button>
            </form>
          )}
          <div
            className="w-8 h-8 rounded-full bg-nurock-tan text-nurock-navy-dark flex items-center justify-center font-display font-semibold text-[12px]"
            title={userEmail ?? ""}
          >
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}

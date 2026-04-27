"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Compact user menu in the header. The avatar circle is the click target;
 * clicking opens a small dropdown showing the user's email and a sign-out
 * button. Sign-out POSTs to /auth/signout (existing route handler).
 */
export function UserMenu({ userEmail }: { userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-away
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const initials = (userEmail ?? "?")
    .split("@")[0]
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? "")
    .join("") || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-8 h-8 rounded-full bg-nurock-tan text-nurock-navy-dark flex items-center justify-center font-display font-semibold text-[12px] hover:ring-2 hover:ring-white/30 transition-shadow"
        aria-label={`User menu for ${userEmail ?? "guest"}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1.5 min-w-[220px] bg-white border border-nurock-border rounded-lg shadow-card-h overflow-hidden z-50"
        >
          {userEmail && (
            <div className="px-4 py-3 border-b border-nurock-border">
              <div className="text-[10px] font-display uppercase tracking-[0.08em] text-nurock-slate">
                Signed in as
              </div>
              <div className="text-[12.5px] text-nurock-black truncate font-medium mt-0.5">
                {userEmail}
              </div>
            </div>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-[13px] text-nurock-black hover:bg-[#FAFBFC] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 text-nurock-slate" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd"/>
                <path fillRule="evenodd" d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-.943a.75.75 0 10-1.004-1.114l-2.5 2.25a.75.75 0 000 1.114l2.5 2.25a.75.75 0 101.004-1.114l-1.048-.943h9.546A.75.75 0 0019 10z" clipRule="evenodd"/>
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

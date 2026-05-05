import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Paths that don't trigger the role gate. Either they're auth-related,
 * unauthenticated assets, or the pending-approval page itself (which
 * we obviously can't redirect to from inside a redirect to itself).
 */
const ROLE_GATE_BYPASS = [
  "/login",
  "/pending-approval",
  "/auth",          // covers /auth/signout and any callback routes
  "/_next",
  "/favicon.ico",
  "/api/ingest",    // the watcher posts here without a session
];

function isBypass(pathname: string): boolean {
  return ROLE_GATE_BYPASS.some(prefix => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  // Expose the current pathname to server components (for sidebar active state)
  response.headers.set("x-pathname", request.nextUrl.pathname);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  // Refresh session
  const { data: { user } } = await supabase.auth.getUser();

  // ── Role gate ────────────────────────────────────────────────────────
  // Pending-approval users (role='viewer') can't access the app shell
  // until an admin elevates them. Redirect them to /pending-approval.
  // Bypass list above lets them stay on login, the pending page itself,
  // and auth callbacks.
  const path = request.nextUrl.pathname;
  if (user && !isBypass(path)) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role, active")
      .eq("id", user.id)
      .maybeSingle();

    // No profile yet (the trigger from migration 0027 should always
    // create one, but if it hasn't run yet for legacy users, treat
    // them as pending).
    const isPending = !profile || !profile.active || profile.role === "viewer";
    if (isPending) {
      const url = request.nextUrl.clone();
      url.pathname = "/pending-approval";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ingest|api/ingest/pdf).*)"],
};

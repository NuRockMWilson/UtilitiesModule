/**
 * Admin auth gate for batch / system API routes.
 *
 * Two layered authorization paths:
 *
 *   1. API key — for cron jobs, the watcher service, and ad-hoc curl from
 *      a developer laptop. Pass `x-admin-api-key: <ADMIN_API_KEY>` header.
 *      The key is set via env var ADMIN_API_KEY on Vercel.
 *
 *   2. Authenticated admin user — for the UI buttons (e.g. the
 *      "Recompute & save" button on /variance). Reads the Supabase auth
 *      cookie, looks up user_profiles.role, and requires role = 'admin'.
 *
 * If either path passes, the route handler proceeds. If both fail, returns
 * 401 (no session, no key) or 403 (session exists but role != admin).
 *
 * Usage in a route handler:
 *
 *   export async function POST(req: Request) {
 *     const auth = await requireAdmin(req);
 *     if (!auth.ok) return auth.response;
 *
 *     // Use service role for the actual work — RLS gets out of the way.
 *     const supabase = createSupabaseServiceClient();
 *     // ... batch logic ...
 *   }
 *
 * The auth.ok branch returns the principal so the route can log it:
 *
 *   await supabase.from("approval_log").insert({
 *     action: "variance_recompute",
 *     metadata: { actor: auth.principal },
 *   });
 *
 * Once RBAC lands properly, this is the single place to add finer-grained
 * checks (per-property scope, etc.) without touching every route.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminAuthResult =
  | {
      ok: true;
      /** Identifies how the request was authorized — useful for audit logging. */
      principal:
        | { type: "api_key"; label: string }
        | { type: "user"; userId: string; email: string };
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Constant-time string comparison so an attacker can't time-attack the
 * API key character by character. Lengths must match for this to be
 * meaningful, so we early-return on length mismatch.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function requireAdmin(req: Request): Promise<AdminAuthResult> {
  // ── Path 1: API key ────────────────────────────────────────────────────
  const presentedKey = req.headers.get("x-admin-api-key");
  const expectedKey  = process.env.ADMIN_API_KEY;

  if (presentedKey) {
    if (!expectedKey) {
      // Misconfiguration — server has no key set. Fail closed; never
      // accept a presented key when there's nothing to compare against.
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Server misconfiguration: ADMIN_API_KEY not set" },
          { status: 500 },
        ),
      };
    }
    if (safeEqual(presentedKey, expectedKey)) {
      return { ok: true, principal: { type: "api_key", label: "admin_api_key" } };
    }
    // Key was presented but didn't match — refuse rather than fall through
    // to the cookie path. Clearer audit trail and avoids a "I tried the
    // key, it failed, then it worked anyway via cookie" surprise.
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  // ── Path 2: Authenticated admin user via Supabase cookie ──────────────
  const supabase = createSupabaseServerClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profErr } = await supabase
    .from("user_profiles")
    .select("role, active")
    .eq("id", user.id)
    .single();

  if (profErr || !profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No user profile" }, { status: 403 }),
    };
  }
  if (!profile.active) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Account inactive" }, { status: 403 }),
    };
  }
  if (profile.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin role required" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    principal: { type: "user", userId: user.id, email: user.email ?? "" },
  };
}

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin-auth";
import { z } from "zod";

/**
 * Admin-only endpoint to update a user_profiles row.
 *
 * Used by /admin/users for role assignment, activation/deactivation, and
 * approval-cap configuration. Authentication is via the standard admin
 * gate (cookie-based admin user OR x-admin-api-key header).
 *
 * Uses the service-role client to bypass RLS — the existing user_profiles
 * RLS policy is "users can read/write their own profile only," which is
 * the right policy for normal app code but blocks admins from managing
 * other users. Bypassing RLS here is appropriate because the route's
 * own auth gate is doing the access check.
 *
 * The body schema is permissive: only fields actually present are updated,
 * so the same endpoint handles "set role to admin" and "deactivate user"
 * with separate calls.
 */

const UpdateUserBody = z.object({
  userId: z.string().uuid(),
  role:                         z.enum(["admin", "tester", "ap_clerk", "approver", "property_manager", "viewer"]).optional(),
  active:                       z.boolean().optional(),
  can_approve_up_to:            z.number().min(0).nullable().optional(),
  can_approve_variance_flagged: z.boolean().optional(),
  full_name:                    z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateUserBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { userId, ...patch } = parsed.data;

  // Strip undefined keys so we only update what was actually provided.
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) update[k] = v;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Guardrail: don't allow demoting the last active admin. Saves us
  // from "I locked myself out of the admin page" support tickets.
  if (update.role && update.role !== "admin") {
    const supabase = createSupabaseServiceClient();
    const { data: target } = await supabase
      .from("user_profiles")
      .select("role, active")
      .eq("id", userId)
      .single();

    if (target?.role === "admin" && target.active) {
      const { count } = await supabase
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("active", true);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last active admin." },
          { status: 400 },
        );
      }
    }
  }

  // Same guardrail for active=false on the last admin
  if (update.active === false) {
    const supabase = createSupabaseServiceClient();
    const { data: target } = await supabase
      .from("user_profiles")
      .select("role, active")
      .eq("id", userId)
      .single();

    if (target?.role === "admin" && target.active) {
      const { count } = await supabase
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("active", true);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot deactivate the last active admin." },
          { status: 400 },
        );
      }
    }
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .update(update)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user: data, actor: auth.principal });
}

/**
 * /admin/users — manage user roles, activation, and approval limits.
 *
 * Admin-only. Reads from user_profiles via service-role to see the full
 * portfolio of users (the RLS policy on user_profiles only allows users
 * to see their own row, so the regular cookie client returns 1 row).
 *
 * Role taxonomy (current; will expand when proper RBAC lands):
 *   admin              — full access including destructive ops
 *   tester             — read everything, do most things, no destructive ops
 *   viewer             — pending approval (default for new signups)
 *   ap_clerk/approver/property_manager — legacy enum values; not currently
 *                        wired up. Visible in the dropdown for forward
 *                        compatibility.
 */

import { TopBar } from "@/components/layout/TopBar";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { UserRoleEditor } from "./UserRoleEditor";

// Always re-fetch on each request — user list is small and we want
// changes to show up immediately after editing.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage() {
  // Auth: enforce admin role inline. The middleware bumps non-admins
  // away from the dashboard entirely if they're 'viewer', but a 'tester'
  // user could navigate here directly. Refuse them at the page level.
  const userClient = createSupabaseServerClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) redirect("/login");

  const { data: myProfile } = await userClient
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (myProfile?.role !== "admin") {
    return (
      <>
        <TopBar title="Users & roles" subtitle="Admin only" />
        <div className="p-8">
          <div className="card p-10 text-center text-nurock-slate">
            This page requires the admin role.
          </div>
        </div>
      </>
    );
  }

  // Use service-role to see all profiles, not just the current user's
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, property_scope, can_approve_up_to, can_approve_variance_flagged, active, created_at")
    .order("active", { ascending: false })  // active users first
    .order("role")
    .order("email");

  const allUsers = (data ?? []) as any[];
  const pending = allUsers.filter(u => u.role === "viewer" && u.active);
  const active  = allUsers.filter(u => u.role !== "viewer" && u.active);
  const inactive = allUsers.filter(u => !u.active);

  return (
    <>
      <TopBar
        title="Users & roles"
        subtitle={`${active.length} active · ${pending.length} pending · ${inactive.length} inactive`}
      />
      <div className="p-8 space-y-6">
        <UserRoleEditor
          pendingUsers={pending}
          activeUsers={active}
          inactiveUsers={inactive}
          currentUserId={user.id}
        />
      </div>
    </>
  );
}

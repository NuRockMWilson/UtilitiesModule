import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";
import { formatDollars } from "@/lib/format";
import type { UserRole } from "@/lib/types";

const ROLE_DESCRIPTION: Record<UserRole, string> = {
  admin:            "Full access; manages users, vendors, accounts, budgets",
  ap_clerk:         "Codes bills, adds variance notes, prepares for approval",
  approver:         "Approves bills, signs off on payment runs",
  property_manager: "Views own property tracker, responds to variance inquiries",
  viewer:           "Read-only access to assigned properties",
};

export default async function AdminUsersPage() {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, property_scope, can_approve_up_to, can_approve_variance_flagged, active")
    .order("role")
    .order("email");

  return (
    <>
      <TopBar
        title="Users & roles"
        subtitle="Invite users, assign roles, scope to properties, and set approval caps"
      />
      <div className="p-8 space-y-6">
        <div className="card p-5">
          <h3 className="font-display font-semibold text-navy-800 mb-3">Role reference</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {(Object.entries(ROLE_DESCRIPTION) as Array<[UserRole, string]>).map(([role, desc]) => (
              <div key={role} className="flex gap-3">
                <span className="badge bg-navy-100 text-navy-800 h-5 shrink-0 capitalize">
                  {role.replace(/_/g, " ")}
                </span>
                <span className="text-tan-800">{desc}</span>
              </div>
            ))}
          </dl>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-navy-100 flex items-center justify-between">
            <h3 className="font-display font-semibold text-navy-800">Active users</h3>
            <button disabled className="btn-primary opacity-60" title="Coming in next phase">
              Invite user
            </button>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-tan-700">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Property scope</th>
                <th className="px-4 py-3 font-medium text-right">Approval cap</th>
                <th className="px-4 py-3 font-medium">Flagged approval</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {(data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-tan-700">
                    No user profiles yet. Sign in with a NuRock email once and an admin can
                    elevate your role from the Supabase dashboard.
                  </td>
                </tr>
              ) : (
                (data ?? []).map((u: any) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-navy-800">{u.full_name ?? u.email}</div>
                      <div className="text-xs text-tan-700">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{u.role.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-xs">
                      {u.property_scope && u.property_scope.length > 0
                        ? `${u.property_scope.length} properties`
                        : "All (role default)"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {u.can_approve_up_to !== null ? formatDollars(Number(u.can_approve_up_to)) : "No cap"}
                    </td>
                    <td className="px-4 py-3">
                      {u.can_approve_variance_flagged ? "Allowed" : "Not allowed"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("badge", u.active ? "bg-green-100 text-green-800" : "bg-tan-100 text-tan-800")}>
                        {u.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

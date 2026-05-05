"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatDollars } from "@/lib/format";
import type { UserRole } from "@/lib/types";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  property_scope: string[] | null;
  can_approve_up_to: number | null;
  can_approve_variance_flagged: boolean;
  active: boolean;
  created_at: string;
}

interface Props {
  pendingUsers: User[];
  activeUsers: User[];
  inactiveUsers: User[];
  currentUserId: string;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "admin",            label: "Admin",            hint: "Full access including destructive ops" },
  { value: "tester",           label: "Tester",           hint: "Most actions; cannot post to Sage or delete" },
  { value: "viewer",           label: "Viewer (pending)", hint: "Default for new signups; sees only the pending page" },
  { value: "ap_clerk",         label: "AP Clerk",         hint: "(Legacy — not currently wired up)" },
  { value: "approver",         label: "Approver",         hint: "(Legacy — not currently wired up)" },
  { value: "property_manager", label: "Property Manager", hint: "(Legacy — not currently wired up)" },
];

export function UserRoleEditor({
  pendingUsers, activeUsers, inactiveUsers, currentUserId,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Role reference card */}
      <div className="card p-5">
        <h3 className="font-display font-semibold text-nurock-black mb-3">
          Roles in use
        </h3>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {ROLE_OPTIONS.slice(0, 3).map(r => (
            <div key={r.value} className="flex flex-col gap-1">
              <span className="font-medium text-nurock-black">{r.label}</span>
              <span className="text-xs text-nurock-slate">{r.hint}</span>
            </div>
          ))}
        </dl>
      </div>

      {/* Pending callout — visually loud so admins remember to approve */}
      {pendingUsers.length > 0 && (
        <div className="card border-l-4 border-l-amber-500 bg-amber-50 p-5">
          <h3 className="font-display font-semibold text-amber-900 mb-1">
            ⏳ {pendingUsers.length} user{pendingUsers.length !== 1 ? "s" : ""} awaiting approval
          </h3>
          <p className="text-sm text-amber-800 mb-4">
            Newly signed-up users land in the viewer (pending) state. Set their
            role to <span className="font-semibold">Tester</span> to give them
            access, or <span className="font-semibold">Admin</span> for full
            privileges. They'll see the dashboard immediately on their next
            page load — no need to notify them.
          </p>
          <Table users={pendingUsers} currentUserId={currentUserId} />
        </div>
      )}

      {/* Active users */}
      <div className="card p-5">
        <h3 className="font-display font-semibold text-nurock-black mb-4">
          Active users ({activeUsers.length})
        </h3>
        {activeUsers.length === 0 ? (
          <p className="text-sm text-nurock-slate text-center py-6">
            No active users beyond pending. Approve someone above to get started.
          </p>
        ) : (
          <Table users={activeUsers} currentUserId={currentUserId} />
        )}
      </div>

      {/* Inactive users — collapsed visually */}
      {inactiveUsers.length > 0 && (
        <div className="card p-5 opacity-90">
          <h3 className="font-display font-semibold text-nurock-slate mb-4">
            Inactive users ({inactiveUsers.length})
          </h3>
          <Table users={inactiveUsers} currentUserId={currentUserId} />
        </div>
      )}
    </div>
  );
}

function Table({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-nurock-slate">
          <tr>
            <th className="px-5 py-3 font-medium">User</th>
            <th className="px-5 py-3 font-medium">Role</th>
            <th className="px-5 py-3 font-medium text-right">Approval cap</th>
            <th className="px-5 py-3 font-medium">Flagged approval</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-nurock-border">
          {users.map(u => (
            <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function patch(update: Partial<{
    role: UserRole;
    active: boolean;
    can_approve_up_to: number | null;
    can_approve_variance_flagged: boolean;
  }>) {
    setErr(null);
    const res = await fetch("/api/admin/users/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: user.id, ...update }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `Update failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  const [capInput, setCapInput] = useState<string>(
    user.can_approve_up_to !== null ? String(user.can_approve_up_to) : "",
  );

  return (
    <tr className={cn(isPending && "opacity-50")}>
      {/* Identity */}
      <td className="px-5 py-3">
        <div className="font-medium text-nurock-black">
          {user.full_name ?? user.email}
          {isSelf && <span className="ml-2 text-xs text-nurock-slate">(you)</span>}
        </div>
        <div className="text-xs text-nurock-slate">{user.email}</div>
      </td>

      {/* Role dropdown */}
      <td className="px-5 py-3">
        <select
          className="input text-sm"
          value={user.role}
          disabled={isSelf || isPending}
          onChange={e => patch({ role: e.target.value as UserRole })}
          title={isSelf ? "You can't change your own role." : ""}
        >
          {ROLE_OPTIONS.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </td>

      {/* Approval cap */}
      <td className="px-5 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            placeholder="No cap"
            className="input text-sm text-right w-32"
            value={capInput}
            onChange={e => setCapInput(e.target.value)}
            onBlur={() => {
              const trimmed = capInput.trim();
              const n = trimmed === "" ? null : Number(trimmed);
              const oldVal = user.can_approve_up_to;
              if (n === oldVal || (Number.isNaN(n) && oldVal === null)) return;
              patch({ can_approve_up_to: n });
            }}
            disabled={isPending}
          />
        </div>
        <div className="text-[11px] text-nurock-slate-light mt-0.5">
          {user.can_approve_up_to !== null
            ? `Max ${formatDollars(user.can_approve_up_to)}`
            : "No cap set"}
        </div>
      </td>

      {/* Flagged approval */}
      <td className="px-5 py-3">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={user.can_approve_variance_flagged}
            onChange={e => patch({ can_approve_variance_flagged: e.target.checked })}
            disabled={isPending}
          />
          <span className="text-nurock-slate">
            {user.can_approve_variance_flagged ? "Allowed" : "Not allowed"}
          </span>
        </label>
      </td>

      {/* Status badge + activate/deactivate */}
      <td className="px-5 py-3">
        <span className={cn(
          "badge text-xs",
          user.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600",
        )}>
          {user.active ? "Active" : "Inactive"}
        </span>
      </td>

      <td className="px-5 py-3 text-right">
        <button
          className="text-xs text-nurock-navy hover:underline disabled:opacity-50"
          disabled={isSelf || isPending}
          title={isSelf ? "You can't deactivate yourself." : ""}
          onClick={() => patch({ active: !user.active })}
        >
          {user.active ? "Deactivate" : "Reactivate"}
        </button>
        {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
      </td>
    </tr>
  );
}

/**
 * Pending approval landing page.
 *
 * When a new user signs up via /login, the trigger from migration 0027
 * creates their user_profiles row with role='viewer'. Middleware then
 * redirects them here. They stay here until an admin elevates their
 * role to 'admin' or 'tester' in /admin/users — at which point the
 * middleware no longer redirects and they can use the app normally.
 *
 * This page intentionally does NOT use the (app) layout — no sidebar,
 * no top bar, just a centered card. Pending users shouldn't see app
 * navigation that they can't use anyway.
 */

import Link from "next/link";
import { NurockLogo } from "@/components/ui/NurockLogo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function PendingApprovalPage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Not logged in → bounce to /login. Shouldn't normally happen because
  // middleware would catch it, but defense in depth.
  if (!user) {
    redirect("/login");
  }

  // Already approved → bounce to dashboard. Prevents "I refreshed my
  // pending page and I'm still seeing the pending message" confusion.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && profile.active && profile.role !== "viewer") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-nurock-cream flex items-center justify-center p-6">
      <div className="card max-w-lg w-full p-10 text-center">
        <div className="flex justify-center mb-6">
          <NurockLogo className="h-12 w-auto" />
        </div>
        <div className="text-5xl mb-4">⏳</div>
        <h1 className="font-display text-2xl font-semibold text-nurock-black mb-3">
          Account pending approval
        </h1>
        <p className="text-nurock-slate mb-2">
          Thanks for signing in,{" "}
          <span className="font-medium text-nurock-black">{user.email}</span>.
        </p>
        <p className="text-nurock-slate-light text-sm mb-8 leading-relaxed">
          An admin needs to approve your account before you can access the
          NuRock Utilities AP dashboard. You'll be able to sign in normally
          once approval is granted — no need to do anything else from your end.
        </p>
        <div className="border-t border-nurock-border pt-6 space-y-3">
          <p className="text-xs text-nurock-slate-light">
            Need to use a different email?
          </p>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-nurock-navy hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

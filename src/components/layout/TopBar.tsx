import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <header className="bg-white border-b border-navy-100 px-8 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-display font-semibold text-navy-800">{title}</h1>
        {subtitle && <p className="text-sm text-tan-700 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4 text-sm">
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="font-medium text-navy-800">{user.email}</div>
              <div className="text-xs text-tan-700">Signed in</div>
            </div>
            <form action="/auth/signout" method="post">
              <button className="btn-ghost text-xs" type="submit">Sign out</button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}

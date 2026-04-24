/**
 * Page header with title, optional subtitle, and signed-in user indicator.
 *
 * Intentionally has no server-side dependency (no next/headers, no Supabase
 * client). That's why it accepts userEmail as a prop — callers are responsible
 * for fetching the user server-side and passing it in. This lets TopBar be
 * used freely from both server and client pages.
 *
 * Typical usage in a server page:
 *     const supabase = createSupabaseServerClient();
 *     const { data: { user } } = await supabase.auth.getUser();
 *     return <TopBar title="Invoices" userEmail={user?.email} />;
 *
 * From a client page (no user context available):
 *     <TopBar title="Upload" />
 */

export function TopBar({
  title,
  subtitle,
  userEmail,
}: {
  title: string;
  subtitle?: string;
  userEmail?: string | null;
}) {
  return (
    <header className="bg-white border-b border-navy-100 px-8 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-display font-semibold text-navy-800">{title}</h1>
        {subtitle && <p className="text-sm text-tan-700 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4 text-sm">
        {userEmail && (
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="font-medium text-navy-800">{userEmail}</div>
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

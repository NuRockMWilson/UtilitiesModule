import { Sidebar } from "@/components/layout/Sidebar";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Bypass auth in dev if credentials aren't configured yet, so the
    // developer can see the shell on first run. Remove once auth is wired.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // continue
    } else {
      redirect("/login");
    }
  }

  const hdrs = headers();
  const pathname = hdrs.get("x-pathname") ?? "/";

  return (
    <div className="flex min-h-screen">
      <Sidebar activePath={pathname} />
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}

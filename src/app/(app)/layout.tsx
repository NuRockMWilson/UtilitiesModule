import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

/**
 * Authenticated app shell. Top navy Header (56px), then a flex row with
 * white Sidebar (220px) on the left and the page content filling the rest.
 *
 * Matches the NuRock Development Management design system layout.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Bypass auth in local dev when Supabase env isn't configured yet.
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      redirect("/login");
    }
  }

  return (
    <div className="min-h-screen bg-nurock-bg">
      <Header userEmail={user?.email} />

      <div className="flex max-w-[1600px] mx-auto">
        <Sidebar />
        <main className="flex-1 flex flex-col min-h-[calc(100vh-56px)] min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}

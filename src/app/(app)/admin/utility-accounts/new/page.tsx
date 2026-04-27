import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountForm } from "../AccountForm";

export default async function AddAccountPage() {
  const supabase = createSupabaseServerClient();
  const [{ data: properties }, { data: vendors }, { data: glAccounts }] = await Promise.all([
    supabase.from("properties").select("id, code, name, full_code").eq("active", true).order("code"),
    supabase.from("vendors").select("id, name, active").order("name"),
    supabase.from("gl_accounts").select("id, code, description").eq("active", true).order("code"),
  ]);

  return (
    <>
      <TopBar title="Add utility account" subtitle="Link a property + vendor + GL for auto-coding" />
      <div className="px-8 py-4 bg-white border-b border-nurock-border">
        <Link href="/admin/utility-accounts" className="btn-secondary">← Back to accounts</Link>
      </div>
      <div className="p-8">
        <AccountForm
          properties={properties ?? []}
          vendors={vendors ?? []}
          glAccounts={glAccounts ?? []}
        />
      </div>
    </>
  );
}

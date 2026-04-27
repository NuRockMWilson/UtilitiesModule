import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountForm } from "../../AccountForm";

export default async function EditAccountPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const [{ data: account }, { data: properties }, { data: vendors }, { data: glAccounts }] = await Promise.all([
    supabase.from("utility_accounts")
      .select("id, property_id, vendor_id, gl_account_id, account_number, description, meter_id, esi_id, meter_category, sub_code, baseline_window_months, variance_threshold_pct, active")
      .eq("id", params.id).single(),
    supabase.from("properties").select("id, code, name, full_code").eq("active", true).order("code"),
    supabase.from("vendors").select("id, name, active").order("name"),
    supabase.from("gl_accounts").select("id, code, description").eq("active", true).order("code"),
  ]);

  if (!account) notFound();

  return (
    <>
      <TopBar
        title={`Edit · ${account.account_number}`}
        subtitle="Update utility account configuration"
      />
      <div className="px-8 py-4 bg-white border-b border-nurock-border">
        <Link href="/admin/utility-accounts" className="btn-secondary">← Back to accounts</Link>
      </div>
      <div className="p-8">
        <AccountForm
          initial={account as any}
          properties={properties ?? []}
          vendors={vendors ?? []}
          glAccounts={glAccounts ?? []}
        />
      </div>
    </>
  );
}

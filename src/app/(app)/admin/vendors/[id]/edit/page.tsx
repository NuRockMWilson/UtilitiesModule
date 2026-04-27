import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VendorForm } from "../../VendorForm";

export default async function EditVendorPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, short_name, category, sage_vendor_id, contact_email, contact_phone, active")
    .eq("id", params.id)
    .single();

  if (!vendor) notFound();

  return (
    <>
      <TopBar title={`Edit · ${vendor.name}`} subtitle="Update vendor record" />
      <div className="px-8 py-4 bg-white border-b border-nurock-border">
        <Link href="/admin/vendors" className="btn-secondary">← Back to vendors</Link>
      </div>
      <div className="p-8">
        <VendorForm initial={vendor as any} />
      </div>
    </>
  );
}

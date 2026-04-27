import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";
import { deactivateVendor, reactivateVendor } from "./actions";

export default async function AdminVendorsPage() {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name, short_name, category, sage_vendor_id, contact_email, active")
    .order("active", { ascending: false })
    .order("name");

  const vendors = data ?? [];

  return (
    <>
      <TopBar title="Vendors" subtitle="Utility and service providers NuRock pays" />
      <div className="p-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-nurock-slate">
            {vendors.length} vendors · Sage vendor IDs must be set before a property can post bills to Sage.
          </p>
          <Link href="/admin/vendors/new" className="btn-primary">
            + Add vendor
          </Link>
        </div>
        <div className="card overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="cell-head">Name</th>
                <th className="cell-head">Category</th>
                <th className="cell-head">Sage vendor ID</th>
                <th className="cell-head">Contact</th>
                <th className="cell-head">Status</th>
                <th className="cell-head text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.length === 0 && (
                <tr><td colSpan={6} className="cell text-center text-nurock-slate-light py-10">
                  No vendors yet. <Link href="/admin/vendors/new" className="text-nurock-navy hover:underline font-medium">Add the first one.</Link>
                </td></tr>
              )}
              {vendors.map((v: any) => (
                <tr key={v.id} className={cn("table-row border-b border-nurock-border last:border-b-0", !v.active && "opacity-60")}>
                  <td className="cell">
                    <Link href={`/admin/vendors/${v.id}/edit`} className="text-nurock-navy hover:underline font-medium">
                      {v.name}
                    </Link>
                    {v.short_name && <span className="text-[11px] text-nurock-slate-light ml-1.5">({v.short_name})</span>}
                  </td>
                  <td className="cell capitalize text-nurock-slate">{v.category?.replace(/_/g, " ") ?? "—"}</td>
                  <td className="cell">
                    {v.sage_vendor_id
                      ? <span className="code">{v.sage_vendor_id}</span>
                      : <span className="text-flag-red text-[11px]">not set</span>}
                  </td>
                  <td className="cell text-[12px] text-nurock-slate">{v.contact_email ?? "—"}</td>
                  <td className="cell">
                    <span className={cn("badge", v.active ? "badge-green" : "badge-slate")}>
                      {v.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="cell text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/admin/vendors/${v.id}/edit`} className="btn-ghost text-[11px] px-2 py-1">Edit</Link>
                      {v.active ? (
                        <form action={deactivateVendor}>
                          <input type="hidden" name="id" value={v.id} />
                          <button type="submit" className="btn-ghost text-[11px] px-2 py-1 text-nurock-slate hover:text-flag-red">
                            Deactivate
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateVendor}>
                          <input type="hidden" name="id" value={v.id} />
                          <button type="submit" className="btn-ghost text-[11px] px-2 py-1 text-nurock-slate hover:text-flag-green">
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

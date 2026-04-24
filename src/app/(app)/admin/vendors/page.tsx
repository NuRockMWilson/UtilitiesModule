import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

export default async function AdminVendorsPage() {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name, short_name, category, sage_vendor_id, contact_email, active")
    .order("name");

  const vendors = data ?? [];

  return (
    <>
      <TopBar title="Vendors" subtitle="Utility and service providers NuRock pays" />
      <div className="p-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-tan-700">
            {vendors.length} vendors · Sage vendor IDs must be set before a property can post bills to Sage.
          </p>
          <button disabled className="btn-primary opacity-60" title="Coming in next phase">
            Add vendor
          </button>
        </div>
        <div className="card overflow-hidden">
          <table className="min-w-full text-sm divide-y divide-navy-100">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-tan-700">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Sage vendor ID</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {vendors.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-tan-700">
                  No vendors yet. Add them via the Supabase dashboard for now, or wait for the admin UI.
                </td></tr>
              )}
              {vendors.map((v: any) => (
                <tr key={v.id}>
                  <td className="px-4 py-3 font-medium text-navy-800">{v.name}</td>
                  <td className="px-4 py-3 capitalize">{v.category?.replace(/_/g, " ") ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {v.sage_vendor_id ?? <span className="text-flag-red">not set</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-tan-800">{v.contact_email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", v.active ? "bg-green-100 text-green-800" : "bg-tan-100 text-tan-800")}>
                      {v.active ? "Active" : "Inactive"}
                    </span>
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

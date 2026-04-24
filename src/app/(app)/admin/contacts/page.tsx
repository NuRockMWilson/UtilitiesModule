import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

export default async function AdminContactsPage() {
  const supabase = createSupabaseServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select(`
      id, code, name, state,
      property_contacts(id, name, email, role, is_primary_for_variance, cc_on_variance, active)
    `)
    .eq("active", true)
    .order("state")
    .order("code");

  return (
    <>
      <TopBar
        title="Property contacts"
        subtitle="Variance inquiry emails are sent to each property's primary contact"
      />
      <div className="p-8 space-y-6">
        {(properties ?? []).map((p: any) => {
          const contacts = p.property_contacts ?? [];
          const hasPrimary = contacts.some((c: any) => c.is_primary_for_variance && c.active);
          return (
            <div key={p.id} className="card">
              <div className="px-5 py-3 border-b border-nurock-border flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs text-nurock-navy">{p.code}</span>
                  <span className="font-medium text-nurock-black ml-2">{p.name}</span>
                  <span className="text-xs text-nurock-slate ml-2">· {p.state}</span>
                </div>
                {!hasPrimary && (
                  <span className="badge bg-red-100 text-red-800">
                    No primary variance contact — inquiries will fail
                  </span>
                )}
              </div>
              {contacts.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-nurock-slate">
                  No contacts configured. Add via Supabase dashboard for now.
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-[#FAFBFC] text-left text-xs uppercase tracking-wide text-nurock-slate">
                    <tr>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nurock-border">
                    {contacts.map((c: any) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2">{c.name}</td>
                        <td className="px-4 py-2 text-nurock-slate">{c.role ?? "—"}</td>
                        <td className="px-4 py-2 text-xs">{c.email}</td>
                        <td className="px-4 py-2">
                          {c.is_primary_for_variance && (
                            <span className="badge badge-navy mr-1">Primary</span>
                          )}
                          {c.cc_on_variance && (
                            <span className="badge bg-nurock-flag-slate-bg text-nurock-slate">CC</span>
                          )}
                          {!c.is_primary_for_variance && !c.cc_on_variance && (
                            <span className="text-xs text-nurock-slate-light">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

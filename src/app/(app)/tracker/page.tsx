import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

export default async function TrackerIndexPage() {
  const supabase = createSupabaseServerClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, code, name, short_name, state, unit_count, active, sage_system")
    .eq("active", true)
    .order("state")
    .order("code");

  const byState = new Map<string, typeof properties>();
  for (const p of properties ?? []) {
    if (!byState.has(p.state)) byState.set(p.state, []);
    byState.get(p.state)!.push(p);
  }

  return (
    <>
      <TopBar title="Property trackers" subtitle="Summary, water, fixed expenses per property" />
      <div className="p-8 space-y-8">
        {Array.from(byState.entries()).map(([state, props]) => (
          <section key={state}>
            <h2 className="text-sm font-medium uppercase tracking-wide text-tan-700 mb-3">{state}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {props!.map(p => (
                <Link key={p.id} href={`/tracker/${p.code}`} className="card p-4 hover:border-navy-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-navy-800">{p.code} · {p.name}</div>
                      <div className="text-xs text-tan-700 mt-1">
                        {p.short_name ?? ""}{p.unit_count ? ` · ${p.unit_count} units` : ""}
                      </div>
                    </div>
                    <span className={cn(
                      "badge",
                      p.sage_system === "sage_intacct"
                        ? "bg-green-100 text-green-800"
                        : "bg-tan-100 text-tan-800",
                    )}>
                      {p.sage_system === "sage_intacct" ? "Intacct" : "300 CRE"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

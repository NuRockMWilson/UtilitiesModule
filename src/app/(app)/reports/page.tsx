import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ReportsPage() {
  const supabase = createSupabaseServerClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("code, name, state")
    .eq("active", true)
    .order("state").order("code");

  const year = new Date().getFullYear();

  return (
    <>
      <TopBar title="Reports & exports" subtitle="Excel downloads matching the legacy workbook format" />
      <div className="p-8 space-y-6">
        <div className="card p-5">
          <h3 className="font-display font-semibold text-nurock-black mb-2">
            Per-property Summary sheet
          </h3>
          <p className="text-sm text-nurock-slate mb-4">
            Generates the Summary workbook for a property with monthly actuals, YTD, and annual
            budget columns — same layout the Sunset Pointe and Onion Creek files have used,
            so asset management and external auditors see an unchanged artifact.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(properties ?? []).map((p: any) => (
              <Link
                key={p.code}
                href={`/api/tracker/${p.code}/export?year=${year}`}
                className="card p-3 hover:border-navy-300 flex items-center justify-between"
              >
                <div>
                  <div className="font-mono text-xs text-nurock-navy">{p.code}</div>
                  <div className="text-sm font-medium text-nurock-black">{p.name}</div>
                </div>
                <span className="text-xs text-nurock-slate">.xlsx</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-display font-semibold text-nurock-black mb-2">Coming next phase</h3>
          <ul className="text-sm text-nurock-slate space-y-1 list-disc list-inside">
            <li>Invoice entry report — PDF of the Sage batch, auto-filed to H:\Accounting…\Approved Invoice Entry Reports</li>
            <li>Portfolio-wide utility spend summary (one workbook, all properties)</li>
            <li>Water usage trend reports with 12-month charts per property</li>
            <li>Variance inquiry log with response rates by property manager</li>
          </ul>
        </div>
      </div>
    </>
  );
}

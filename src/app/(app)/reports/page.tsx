import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface Props {
  searchParams: { year?: string };
}

export default async function ReportsPage({ searchParams }: Props) {
  const supabase = createSupabaseServerClient();
  const year = Number(searchParams.year ?? new Date().getFullYear());
  const { data: properties } = await supabase
    .from("properties")
    .select("code, name, full_code, state")
    .eq("active", true)
    .order("state").order("code");

  const yearOptions = [year - 2, year - 1, year, year + 1].sort();

  return (
    <>
      <TopBar
        title="Reports & exports"
        subtitle="Excel downloads matching the legacy workbook format and new portfolio analyses"
      />
      <div className="px-8 py-3 bg-white border-b border-nurock-border flex items-center gap-3">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">Reporting year</span>
        <div className="flex items-center gap-1">
          {yearOptions.map(y => (
            <Link
              key={y}
              href={`/reports?year=${y}`}
              className={
                "px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors " +
                (y === year
                  ? "bg-nurock-navy text-white"
                  : "text-nurock-slate hover:bg-nurock-flag-navy-bg hover:text-nurock-navy")
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <div className="p-8 max-w-[1600px] mx-auto w-full space-y-6">

        {/* Portfolio reports */}
        <section>
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mb-3">
            Portfolio reports
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ReportCard
              title="Portfolio spend"
              description="One workbook with three sheets: by Property × Month, by Property × GL, and by GL × Month. Best for monthly portfolio reviews."
              href={`/api/reports/portfolio?year=${year}`}
              filename={`NuRock-Portfolio-${year}.xlsx`}
            />
            <ReportCard
              title="Year-over-year"
              description={`Comparison of ${year - 1} vs ${year}, both at portfolio-overview level and per-property. Cells with > +5% are tinted red, < −5% green.`}
              href={`/api/reports/yoy?year=${year}`}
              filename={`NuRock-YoY-${year - 1}-vs-${year}.xlsx`}
            />
            <ReportCard
              title="Vendor spend rankings"
              description="Top vendors overall, top by GL category, and a vendor × property matrix showing where each vendor's spend lands."
              href={`/api/reports/vendors?year=${year}`}
              filename={`NuRock-Vendors-${year}.xlsx`}
            />
          </div>
        </section>

        {/* Operations reports */}
        <section>
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mb-3">
            Operations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ReportCard
              title="Variance log"
              description="Every flagged invoice with its baseline, % variance, status, and explanation — plus a per-property response-rate breakdown for variance inquiries."
              href={`/api/reports/variance?year=${year}`}
              filename={`NuRock-Variance-${year}.xlsx`}
            />
            <div className="card p-5 opacity-60">
              <h3 className="font-display font-semibold text-nurock-black mb-2">
                Approved Invoice Entry Report
              </h3>
              <p className="text-[12.5px] text-nurock-slate mb-3">
                PDF of the Sage AP batch — auto-filed to{" "}
                <span className="font-mono text-[11px]">H:\Accounting\…\Approved Invoice Entry Reports\</span>.
                Generated automatically at the end of each Thursday payment run.
              </p>
              <div className="text-[11px] text-nurock-slate-light italic">
                Activates with the first real Sage AP batch post.
              </div>
            </div>
          </div>
        </section>

        {/* Per-property summary downloads */}
        <section>
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mb-3">
            Per-property summary workbooks
          </h2>
          <p className="text-[12.5px] text-nurock-slate mb-3">
            The legacy per-property Summary format — same layout the Sunset Pointe and Onion Creek
            files have used for years, so asset management and external auditors get an unchanged
            artifact even though the system underneath is new.
          </p>
          <div className="card p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {(properties ?? []).map((p: any) => (
                <a
                  key={p.code}
                  href={`/api/tracker/${p.code}/export?year=${year}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-[#FAFBFC] transition-colors border border-nurock-border"
                >
                  <div>
                    <div className="text-[11px] font-mono text-nurock-navy">
                      {p.full_code ?? p.code}
                    </div>
                    <div className="text-[13px] text-nurock-black font-medium">{p.name}</div>
                  </div>
                  <span className="text-[10px] text-nurock-slate-light font-mono">XLSX</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function ReportCard({
  title, description, href, filename,
}: {
  title: string; description: string; href: string; filename: string;
}) {
  return (
    <a
      href={href}
      download={filename}
      className="card hover:shadow-card-h transition-shadow group flex flex-col"
    >
      <div className="card-b flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-semibold text-nurock-black">{title}</h3>
          <span className="text-[10px] font-mono text-nurock-slate-light bg-[#FAFBFC] px-1.5 py-0.5 rounded">XLSX</span>
        </div>
        <p className="text-[12.5px] text-nurock-slate flex-1">{description}</p>
        <div className="flex items-center gap-1 text-[12px] text-nurock-navy font-medium pt-1 group-hover:underline">
          Download
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M10 3a1 1 0 011 1v8.586l2.293-2.293a1 1 0 011.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V4a1 1 0 011-1z"/>
          </svg>
        </div>
      </div>
    </a>
  );
}

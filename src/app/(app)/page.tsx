import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { InvoiceStatus } from "@/lib/types";
import { DashboardPropertyPicker } from "@/components/dashboard/DashboardPropertyPicker";

interface StatusCount {
  status: InvoiceStatus;
  count:  number;
  amount: number;
}

async function loadDashboard(propertyId: string | null) {
  const supabase = createSupabaseServerClient();

  let q = supabase
    .from("invoices")
    .select("status, total_amount_due, variance_flagged, due_date, property_id")
    .not("status", "in", "(paid,rejected)");
  if (propertyId) q = q.eq("property_id", propertyId);

  const { data: invoices } = await q;

  const rows = invoices ?? [];
  const byStatus = new Map<InvoiceStatus, StatusCount>();
  let flagged = 0;
  let dueSoon = 0;
  let dueSoonAmount = 0;

  const today = new Date();
  const threeDays = new Date(today);
  threeDays.setDate(today.getDate() + 3);

  for (const r of rows) {
    const s = r.status as InvoiceStatus;
    const existing = byStatus.get(s) ?? { status: s, count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += Number(r.total_amount_due ?? 0);
    byStatus.set(s, existing);

    if (r.variance_flagged) flagged += 1;
    if (r.due_date && new Date(r.due_date) <= threeDays) {
      dueSoon += 1;
      dueSoonAmount += Number(r.total_amount_due ?? 0);
    }
  }

  return {
    statusCounts: Array.from(byStatus.values()),
    flagged,
    dueSoon,
    dueSoonAmount,
    total: rows.length,
  };
}

const TILE_ORDER: InvoiceStatus[] = [
  "new", "needs_coding", "needs_variance_note",
  "ready_for_approval", "approved", "posted_to_sage",
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { propertyId?: string };
}) {
  const supabase = createSupabaseServerClient();
  const { data: properties } = await supabase
    .from("properties")
    .select("id, code, name, full_code")
    .eq("active", true)
    .order("code");

  const propertyId = searchParams.propertyId ?? null;
  const scopedProperty = propertyId
    ? (properties ?? []).find(p => p.id === propertyId) ?? null
    : null;

  const { statusCounts, flagged, dueSoon, dueSoonAmount } = await loadDashboard(propertyId);
  const byStatus = new Map(statusCounts.map(c => [c.status, c]));

  // Build href helper that preserves the propertyId scope on every link
  const scopeQs = propertyId ? `&propertyId=${propertyId}` : "";

  return (
    <>
      <TopBar
        title={scopedProperty ? `Dashboard · ${scopedProperty.name}` : "Dashboard"}
        subtitle={scopedProperty
          ? `${scopedProperty.full_code} · scoped to single property`
          : "Utility AP workflow at a glance"}
      />
      <div className="px-8 py-3 bg-white border-b border-nurock-border">
        <DashboardPropertyPicker
          properties={properties ?? []}
          currentPropertyId={propertyId}
        />
      </div>
      <div className="p-8 space-y-6 max-w-[1600px] mx-auto w-full">

        <section>
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mb-3">
            Attention
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <AttentionCard
              label="Variance flagged"
              count={flagged}
              href={`/invoices?flagged=true${scopeQs}`}
              tone="amber"
              note="Bills above baseline threshold awaiting explanation"
            />
            <AttentionCard
              label="Due within 3 days"
              count={dueSoon}
              sub={dueSoon > 0 ? formatDollars(dueSoonAmount) : undefined}
              href={`/invoices?due=soon${scopeQs}`}
              tone="red"
            />
            <AttentionCard
              label="Ready for approval"
              count={byStatus.get("ready_for_approval")?.count ?? 0}
              sub={(byStatus.get("ready_for_approval")?.count ?? 0) > 0
                ? formatDollars(byStatus.get("ready_for_approval")?.amount ?? 0)
                : undefined}
              href={`/invoices?status=ready_for_approval${scopeQs}`}
              tone="navy"
            />
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
              Workflow stages
            </h2>
            <Link href={`/invoices${propertyId ? `?propertyId=${propertyId}` : ""}`} className="text-[12.5px] text-nurock-navy hover:underline font-medium">
              View all invoices →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {TILE_ORDER.map(status => {
              const c = byStatus.get(status);
              const count = c?.count ?? 0;
              const isEmpty = count === 0;
              // Empty "New" and "Needs coding" tiles show an inline upload CTA
              // — this is where the workflow starts, so an empty state should
              // guide the user to action, not just display a zero.
              const showUploadCta = isEmpty && (status === "new" || status === "needs_coding");

              return (
                <Link
                  key={status}
                  href={showUploadCta ? "/invoices/upload" : `/invoices?status=${status}${scopeQs}`}
                  className={cn(
                    "kpi-tile hover:shadow-card-h transition-shadow",
                    isEmpty && "opacity-80",
                  )}
                >
                  <div className="kpi-label truncate">
                    {status.replace(/_/g, " ")}
                  </div>
                  <div className={cn(
                    "kpi-value num",
                    isEmpty && "text-nurock-slate-light"
                  )}>
                    {formatNumber(count)}
                  </div>
                  {showUploadCta ? (
                    <div className="kpi-sub mt-1 text-nurock-navy font-medium inline-flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path d="M10 3a1 1 0 011 1v8.586l2.293-2.293a1 1 0 011.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V4a1 1 0 011-1z" transform="rotate(180 10 10)"/>
                      </svg>
                      Upload a bill
                    </div>
                  ) : (
                    <div className="kpi-sub num">
                      {formatDollars(c?.amount ?? 0, { cents: false })}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-nurock-slate mb-3">
            Quick actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <QuickAction href="/invoices/upload"       label="Upload bills"          note="Drag PDFs or images" />
            <QuickAction href="/tracker"               label="Property trackers"     note="Summary, water, fixed" />
            <QuickAction href="/payments"              label="Thursday payment run"  note="Select for payment, print checks" />
            <QuickAction href="/reports"               label="Export reports"        note="Excel, Sage import" />
          </div>
        </section>
      </div>
    </>
  );
}

function AttentionCard({
  label, count, sub, note, href, tone,
}: {
  label: string; count: number; sub?: string; note?: string;
  href: string; tone: "amber" | "red" | "navy";
}) {
  // Tone is only applied when there's actually something in the queue.
  // An Attention tile showing "0" should look calm, not alarming — otherwise
  // users learn to ignore the color system.
  const active = count > 0;
  const appliedTone = active ? tone : "";
  return (
    <Link
      href={href}
      className={cn(
        "kpi-tile block hover:shadow-card-h transition-shadow",
        appliedTone,
        !active && "opacity-70",
      )}
    >
      <div className="kpi-label">{label}</div>
      <div className="flex items-baseline gap-3 mt-1">
        <div className={cn(
          "kpi-value text-[28px] num",
          !active && "text-nurock-slate-light"
        )}>
          {formatNumber(count)}
        </div>
        {sub && <div className="text-[12.5px] text-nurock-slate num">{sub}</div>}
      </div>
      {note && active && <div className="kpi-sub mt-2">{note}</div>}
      {!active && <div className="kpi-sub mt-2 text-nurock-slate-light italic">All caught up</div>}
    </Link>
  );
}

function QuickAction({ href, label, note }: { href: string; label: string; note: string }) {
  return (
    <Link href={href} className="card hover:shadow-card-h transition-shadow block">
      <div className="card-b">
        <div className="font-medium text-nurock-black text-[13px]">{label}</div>
        <div className="text-[11px] text-nurock-slate-light mt-1">{note}</div>
      </div>
    </Link>
  );
}

import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { InvoiceStatus } from "@/lib/types";

interface StatusCount {
  status: InvoiceStatus;
  count:  number;
  amount: number;
}

async function loadDashboard() {
  const supabase = createSupabaseServerClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("status, total_amount_due, variance_flagged, due_date")
    .not("status", "in", "(paid,rejected)");

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

export default async function DashboardPage() {
  const { statusCounts, flagged, dueSoon, dueSoonAmount } = await loadDashboard();
  const byStatus = new Map(statusCounts.map(c => [c.status, c]));

  return (
    <>
      <TopBar title="Dashboard" subtitle="Utility AP workflow at a glance" />
      <div className="p-8 space-y-8">

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-tan-700 mb-3">
            Attention
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <AttentionCard
              label="Variance flagged"
              value={formatNumber(flagged)}
              href="/invoices?flagged=true"
              tone="yellow"
              note="Bills above baseline threshold awaiting explanation"
            />
            <AttentionCard
              label="Due within 3 days"
              value={formatNumber(dueSoon)}
              sub={formatDollars(dueSoonAmount)}
              href="/invoices?due=soon"
              tone="red"
            />
            <AttentionCard
              label="Ready for approval"
              value={formatNumber(byStatus.get("ready_for_approval")?.count ?? 0)}
              sub={formatDollars(byStatus.get("ready_for_approval")?.amount ?? 0)}
              href="/invoices?status=ready_for_approval"
              tone="navy"
            />
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-tan-700">
              Workflow stages
            </h2>
            <Link href="/invoices" className="text-sm text-navy-600 hover:underline">
              View all invoices →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {TILE_ORDER.map(status => {
              const c = byStatus.get(status);
              return (
                <Link
                  key={status}
                  href={`/invoices?status=${status}`}
                  className="card p-4 hover:border-navy-300 transition-colors"
                >
                  <div className="text-xs uppercase tracking-wide text-tan-700 truncate">
                    {status.replace(/_/g, " ")}
                  </div>
                  <div className="text-2xl font-semibold text-navy-800 mt-1">
                    {formatNumber(c?.count ?? 0)}
                  </div>
                  <div className="text-xs text-tan-700 mt-0.5">
                    {formatDollars(c?.amount ?? 0, { cents: false })}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-tan-700 mb-3">
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
  label, value, sub, note, href, tone,
}: {
  label: string; value: string; sub?: string; note?: string;
  href: string; tone: "yellow" | "red" | "navy";
}) {
  const toneClasses = tone === "yellow"
    ? "border-l-flag-yellow"
    : tone === "red"
    ? "border-l-flag-red"
    : "border-l-navy";
  return (
    <Link
      href={href}
      className={cn("card p-5 border-l-4 hover:border-l-navy-700 block transition-colors", toneClasses)}
    >
      <div className="text-xs uppercase tracking-wide text-tan-700">{label}</div>
      <div className="flex items-baseline gap-3 mt-2">
        <div className="text-3xl font-semibold text-navy-800">{value}</div>
        {sub && <div className="text-sm text-tan-700">{sub}</div>}
      </div>
      {note && <div className="text-xs text-tan-700 mt-2">{note}</div>}
    </Link>
  );
}

function QuickAction({ href, label, note }: { href: string; label: string; note: string }) {
  return (
    <Link href={href} className="card p-4 hover:border-navy-300 transition-colors block">
      <div className="font-medium text-navy-800">{label}</div>
      <div className="text-xs text-tan-700 mt-1">{note}</div>
    </Link>
  );
}

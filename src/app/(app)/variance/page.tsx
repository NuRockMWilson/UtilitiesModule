import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatDollars, formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { VarianceRecomputeButton } from "@/components/admin/VarianceRecomputeButton";

export default async function VarianceInquiriesPage() {
  const supabase = createSupabaseServerClient();

  const { data } = await supabase
    .from("variance_inquiries")
    .select(`
      id, recipient_email, subject, sent_at, response_received_at, response_body, status,
      invoice:invoices(
        id, invoice_number, variance_pct, total_amount_due,
        property:properties(code, name),
        vendor:vendors(name)
      )
    `)
    .order("sent_at", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  const openCount = rows.filter(r => !r.response_received_at && r.status !== "closed").length;

  return (
    <>
      <TopBar
        title="Variance inquiries"
        subtitle={`${openCount} awaiting property response`}
      />
      <div className="p-8 space-y-4">
        <VarianceRecomputeButton />
        {rows.length === 0 && (
          <div className="card p-10 text-center text-nurock-slate">
            No variance inquiries have been sent yet.
          </div>
        )}
        {rows.map((q: any) => (
          <div key={q.id} className="card p-5">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Link
                    href={`/invoices/${q.invoice?.id}`}
                    className="font-medium text-nurock-black hover:underline"
                  >
                    {q.invoice?.property?.code} · {q.invoice?.property?.name}
                  </Link>
                  <span className="text-xs text-nurock-slate">· {q.invoice?.vendor?.name}</span>
                </div>
                <div className="text-sm text-ink">{q.subject}</div>
                <div className="text-xs text-nurock-slate mt-1">
                  To {q.recipient_email} · sent {formatDate(q.sent_at)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-nurock-slate uppercase tracking-wide">Variance</div>
                <div className="text-lg font-semibold text-flag-red">
                  {formatPercent(Number(q.invoice?.variance_pct ?? 0), { sign: true })}
                </div>
                <div className="text-xs text-nurock-slate">
                  {formatDollars(Number(q.invoice?.total_amount_due ?? 0))}
                </div>
              </div>
            </div>
            {q.response_body ? (
              <div className="mt-3 pl-3 border-l-2 border-green-300 text-sm bg-green-50/40 rounded-r p-3">
                <div className="text-xs text-nurock-slate mb-1">
                  Response · {formatDate(q.response_received_at)}
                </div>
                {q.response_body}
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between">
                <span className={cn(
                  "badge",
                  q.status === "escalated"
                    ? "bg-red-100 text-red-800"
                    : "bg-yellow-100 text-yellow-800",
                )}>
                  {q.status === "escalated" ? "Escalated" : "Awaiting response"}
                </span>
                <Link
                  href={`/invoices/${q.invoice?.id}`}
                  className="text-xs text-nurock-navy hover:underline"
                >
                  View bill →
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

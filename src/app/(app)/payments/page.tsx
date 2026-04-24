import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatDate } from "@/lib/format";
import { StatusPill } from "@/components/ui/StatusPill";
import type { InvoiceStatus, SageSystem } from "@/lib/types";
import { PaymentsQueueClient, type QueueRow } from "@/components/invoices/PaymentsQueueClient";

export default async function PaymentsPage() {
  const supabase = createSupabaseServerClient();

  const { data } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, due_date, total_amount_due, status,
      gl_coding, check_number, check_date, mailed_at, sage_batch_uuid,
      property:properties(id, code, name, sage_system),
      vendor:vendors(name)
    `)
    .in("status", ["approved", "posted_to_sage"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);

  const rows: QueueRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    due_date: r.due_date,
    total_amount_due: r.total_amount_due,
    status: r.status,
    gl_coding: r.gl_coding,
    check_number: r.check_number,
    mailed_at: r.mailed_at,
    sage_batch_uuid: r.sage_batch_uuid,
    property_id: r.property?.id,
    property_code: r.property?.code,
    property_name: r.property?.name,
    property_sage_system: (r.property?.sage_system ?? "sage_300_cre") as SageSystem,
    vendor_name: r.vendor?.name,
  }));

  const total = rows.reduce((a, r) => a + Number(r.total_amount_due ?? 0), 0);
  const readyCount = rows.filter(r => r.status === "approved").length;
  const postedCount = rows.filter(r => r.status === "posted_to_sage").length;

  return (
    <>
      <TopBar
        title="Payment queue"
        subtitle="Generate Sage AP Import batches, track check runs, meet the Friday mailing cutoff"
      />
      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <SummaryCard label="Queue total" value={formatDollars(total)} sub={`${rows.length} invoices`} />
          <SummaryCard label="Ready for Sage" value={`${readyCount}`} sub="Approved, not yet batched" />
          <SummaryCard
            label="Mailing cutoff"
            value="Fri 12:00 PM"
            sub="USPS pickup — bills must be in the mailbox"
            tone="yellow"
          />
        </div>

        <PaymentsQueueClient rows={rows} />
      </div>
    </>
  );
}

function SummaryCard({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: "yellow" }) {
  const border = tone === "yellow" ? "border-l-flag-yellow" : "border-l-navy";
  return (
    <div className={`card p-4 border-l-4 ${border}`}>
      <div className="text-xs uppercase tracking-wide text-nurock-slate">{label}</div>
      <div className="text-2xl font-semibold text-nurock-black mt-1">{value}</div>
      {sub && <div className="text-xs text-nurock-slate mt-1">{sub}</div>}
    </div>
  );
}

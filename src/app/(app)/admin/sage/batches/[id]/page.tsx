import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BatchActions } from "@/components/invoices/BatchActions";

export default async function SageBatchDetailPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();

  const { data: batch } = await supabase
    .from("sage_batches")
    .select(`
      *,
      property:properties(code, name)
    `)
    .eq("id", params.id)
    .single();

  if (!batch) notFound();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, total_amount_due, status, gl_coding,
      property:properties(code, name),
      vendor:vendors(name)
    `)
    .eq("sage_batch_uuid", batch.id)
    .order("invoice_date");

  return (
    <>
      <TopBar
        title={`Sage batch ${batch.batch_reference}`}
        subtitle={batch.artifact_filename ?? "Intacct push"}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Fact label="System" value={batch.sage_system === "sage_intacct" ? "Intacct" : "300 CRE"} />
          <Fact label="Invoices" value={String(batch.invoice_count)} />
          <Fact label="Total" value={formatDollars(Number(batch.total_amount))} />
          <Fact label="Status" value={batch.status.replace(/_/g, " ")} />
        </div>

        <div className="card p-5">
          <h3 className="font-display font-semibold text-nurock-black mb-3">Lifecycle</h3>
          <ol className="space-y-2 text-sm">
            <Event label="Generated" at={batch.generated_at} active={!!batch.generated_at} />
            <Event label="Downloaded" at={batch.downloaded_at} active={!!batch.downloaded_at} />
            <Event
              label="Confirmed posted in Sage"
              at={batch.confirmed_posted_at}
              active={!!batch.confirmed_posted_at}
            />
            {batch.status === "void" && (
              <Event label={`Voided — ${batch.void_reason ?? "no reason"}`} at={batch.updated_at ?? batch.generated_at} active />
            )}
          </ol>
        </div>

        <BatchActions
          batchId={batch.id}
          status={batch.status}
          sageSystem={batch.sage_system}
          hasArtifact={!!batch.artifact_path}
        />

        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-nurock-border">
            <h3 className="font-display font-semibold text-nurock-black">Invoices in this batch</h3>
          </div>
          <table className="min-w-full text-sm divide-y divide-nurock-border">
            <thead className="bg-[#FAFBFC] text-left text-xs uppercase tracking-wide text-nurock-slate">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 font-medium">GL coding</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {(invoices ?? []).map((inv: any) => (
                <tr key={inv.id}>
                  <td className="px-4 py-2 font-medium">{inv.property?.code}</td>
                  <td className="px-4 py-2">{inv.vendor?.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/invoices/${inv.id}`} className="text-nurock-navy hover:underline">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{inv.gl_coding}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatDollars(inv.total_amount_due)}</td>
                  <td className="px-4 py-2 capitalize text-xs">{inv.status.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Link href="/admin/sage/batches" className="text-sm text-nurock-navy hover:underline">
          ← All batches
        </Link>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-nurock-slate">{label}</div>
      <div className="text-lg font-semibold text-nurock-black mt-1 capitalize">{value}</div>
    </div>
  );
}

function Event({ label, at, active }: { label: string; at: string | null; active: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <div className={cn(
        "w-2 h-2 rounded-full mt-1.5 shrink-0",
        active ? "bg-navy" : "bg-nurock-flag-navy-bg",
      )} />
      <div className="flex-1">
        <div className={cn("text-sm", active ? "text-ink" : "text-nurock-slate-light")}>{label}</div>
        {at && <div className="text-xs text-nurock-slate">{formatDate(at)}</div>}
      </div>
    </li>
  );
}

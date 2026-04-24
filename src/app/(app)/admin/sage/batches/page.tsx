import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_COLOR: Record<string, string> = {
  generated:         "bg-nurock-flag-slate-bg text-nurock-slate",
  downloaded:        "bg-yellow-100 text-yellow-800",
  confirmed_posted:  "badge-green",
  superseded:        "bg-nurock-flag-slate-bg text-nurock-slate",
  void:              "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<string, string> = {
  generated:         "Generated",
  downloaded:        "Downloaded",
  confirmed_posted:  "Confirmed posted",
  superseded:        "Superseded",
  void:              "Voided",
};

export default async function SageBatchesPage() {
  const supabase = createSupabaseServerClient();

  const { data: batches } = await supabase
    .from("sage_batches")
    .select(`
      id, batch_reference, sage_system, invoice_count, total_amount,
      status, artifact_filename, generated_at, downloaded_at, confirmed_posted_at,
      property:properties(code, name)
    `)
    .order("generated_at", { ascending: false })
    .limit(100);

  const rows = batches ?? [];
  const awaitingConfirmation = rows.filter((b: any) =>
    b.status === "generated" || b.status === "downloaded").length;

  return (
    <>
      <TopBar
        title="Sage batches"
        subtitle={`${rows.length} recent · ${awaitingConfirmation} awaiting import confirmation`}
      />
      <div className="p-8">
        <div className="card overflow-hidden">
          <table className="min-w-full text-sm divide-y divide-nurock-border">
            <thead className="bg-[#FAFBFC] text-left text-xs uppercase tracking-wide text-nurock-slate">
              <tr>
                <th className="px-4 py-3 font-medium">Batch</th>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">System</th>
                <th className="px-4 py-3 font-medium text-right">Count</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium">Generated</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-nurock-slate">
                    No Sage batches generated yet.
                  </td>
                </tr>
              )}
              {rows.map((b: any) => (
                <tr key={b.id} className="hover:bg-[#FAFBFC]">
                  <td className="px-4 py-3">
                    <Link href={`/admin/sage/batches/${b.id}`} className="font-mono text-xs text-nurock-navy hover:underline">
                      {b.batch_reference}
                    </Link>
                    {b.artifact_filename && (
                      <div className="text-xs text-nurock-slate mt-0.5">{b.artifact_filename}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.property ? (
                      <>
                        <span className="font-medium text-nurock-black">{b.property.code}</span>
                        <span className="text-xs text-nurock-slate ml-1">{b.property.name}</span>
                      </>
                    ) : (
                      <span className="text-xs text-nurock-slate">Cross-property</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "badge",
                      b.sage_system === "sage_intacct" ? "badge-green" : "bg-nurock-flag-slate-bg text-nurock-slate",
                    )}>
                      {b.sage_system === "sage_intacct" ? "Intacct" : "300 CRE"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.invoice_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatDollars(Number(b.total_amount), { cents: false })}
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDate(b.generated_at)}</td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", STATUS_COLOR[b.status])}>
                      {STATUS_LABEL[b.status] ?? b.status}
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

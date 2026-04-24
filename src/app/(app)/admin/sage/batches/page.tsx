import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDollars, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATUS_COLOR: Record<string, string> = {
  generated:         "bg-tan-100 text-tan-800",
  downloaded:        "bg-yellow-100 text-yellow-800",
  confirmed_posted:  "bg-green-100 text-green-800",
  superseded:        "bg-tan-100 text-tan-800",
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
          <table className="min-w-full text-sm divide-y divide-navy-100">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wide text-tan-700">
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
            <tbody className="divide-y divide-navy-50">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-tan-700">
                    No Sage batches generated yet.
                  </td>
                </tr>
              )}
              {rows.map((b: any) => (
                <tr key={b.id} className="hover:bg-navy-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/sage/batches/${b.id}`} className="font-mono text-xs text-navy-700 hover:underline">
                      {b.batch_reference}
                    </Link>
                    {b.artifact_filename && (
                      <div className="text-xs text-tan-700 mt-0.5">{b.artifact_filename}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {b.property ? (
                      <>
                        <span className="font-medium text-navy-800">{b.property.code}</span>
                        <span className="text-xs text-tan-700 ml-1">{b.property.name}</span>
                      </>
                    ) : (
                      <span className="text-xs text-tan-700">Cross-property</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "badge",
                      b.sage_system === "sage_intacct" ? "bg-green-100 text-green-800" : "bg-tan-100 text-tan-800",
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

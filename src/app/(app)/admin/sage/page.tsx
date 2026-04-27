import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/sage/adapter";
import { cn } from "@/lib/cn";
import { PipelineSelfTestButton } from "@/components/admin/PipelineSelfTestButton";

export default async function AdminSagePage() {
  const supabase = createSupabaseServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, code, name, state, sage_system, active")
    .eq("active", true)
    .order("state").order("code");

  const cre300 = await getAdapter("sage_300_cre").healthCheck();
  const intacct = await getAdapter("sage_intacct").healthCheck();

  const counts = { sage_300_cre: 0, sage_intacct: 0 };
  for (const p of properties ?? []) {
    counts[p.sage_system as keyof typeof counts]++;
  }

  return (
    <>
      <TopBar
        title="Sage integration"
        subtitle="Per-property Sage system assignment and health of each adapter"
      />
      <div className="px-8 py-4 bg-white border-b border-nurock-border flex items-center gap-6">
        <ConnectionStatus name="Sage 300 CRE" health={cre300} />
        <ConnectionStatus name="Sage Intacct" health={intacct} />
      </div>
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AdapterCard
            name="Sage 300 CRE"
            mode="File-based AP Import"
            health={cre300}
            count={counts.sage_300_cre}
            note="Posting writes a pipe-delimited AP Import file to SAGE_300_CRE_EXPORT_DIR. Sharon runs AP Tasks → Import Invoices in the Sage client."
          />
          <AdapterCard
            name="Sage Intacct"
            mode="REST API"
            health={intacct}
            count={counts.sage_intacct}
            note="Stub in place; live posting activates once the Intacct migration completes and credentials are set. Flip individual properties to sage_intacct as they go live."
          />
        </div>

        <PipelineSelfTestButton />

        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-nurock-border">
            <h3 className="font-display font-semibold text-nurock-black">Per-property assignment</h3>
            <p className="text-xs text-nurock-slate mt-1">
              During the migration you can cut over one property at a time. The adapter is chosen
              at post time based on the property's `sage_system` column.
            </p>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-[#FAFBFC] text-left text-xs uppercase tracking-wide text-nurock-slate">
              <tr>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Sage system</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nurock-border">
              {(properties ?? []).map((p: any) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-nurock-navy">{p.code}</span>
                    <span className="ml-2 font-medium text-nurock-black">{p.name}</span>
                  </td>
                  <td className="px-4 py-3">{p.state}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "badge",
                      p.sage_system === "sage_intacct"
                        ? "badge-green"
                        : "bg-nurock-flag-slate-bg text-nurock-slate",
                    )}>
                      {p.sage_system === "sage_intacct" ? "Intacct" : "300 CRE"}
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

function AdapterCard({
  name, mode, health, count, note,
}: {
  name: string; mode: string;
  health: { ok: boolean; detail: string };
  count: number; note: string;
}) {
  return (
    <div className={cn(
      "card p-5 border-l-4",
      health.ok ? "border-l-flag-green" : "border-l-flag-yellow",
    )}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-display font-semibold text-nurock-black">{name}</h3>
          <div className="text-xs text-nurock-slate">{mode}</div>
        </div>
        <span className={cn(
          "badge",
          health.ok ? "badge-green" : "bg-yellow-100 text-yellow-800",
        )}>
          {health.ok ? "Ready" : "Not ready"}
        </span>
      </div>
      <div className="text-sm text-ink mt-3">
        <div><strong>{count}</strong> properties assigned</div>
        <div className="text-xs text-nurock-slate mt-1">{health.detail}</div>
      </div>
      <p className="text-xs text-nurock-slate mt-3">{note}</p>
    </div>
  );
}

/**
 * Compact connection indicator used in the page subheader — a pulsing dot
 * for immediate at-a-glance feedback on whether each adapter is healthy.
 * Green = ok; amber = not ready / missing config.
 */
function ConnectionStatus({
  name,
  health,
}: {
  name: string;
  health: { ok: boolean; detail: string };
}) {
  return (
    <div
      className="flex items-center gap-2 text-[12.5px]"
      title={`${name}: ${health.detail}`}
    >
      <span className="relative inline-flex w-2.5 h-2.5">
        <span className={cn(
          "absolute inset-0 rounded-full",
          health.ok ? "bg-flag-green" : "bg-flag-yellow",
        )} />
        {health.ok && (
          <span className="absolute inset-0 rounded-full bg-flag-green opacity-40 animate-ping" />
        )}
      </span>
      <span className="font-display text-[11px] uppercase tracking-[0.08em] text-nurock-slate">
        {name}
      </span>
      <span className={cn(
        "font-medium",
        health.ok ? "text-nurock-black" : "text-flag-red",
      )}>
        {health.ok ? "Connected" : "Not ready"}
      </span>
    </div>
  );
}

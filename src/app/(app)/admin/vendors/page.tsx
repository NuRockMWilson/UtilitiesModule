import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";
import { deactivateVendor, reactivateVendor } from "./actions";

// Duplicate-detection helpers — duplicated here intentionally so this Server
// Component file doesn't need to depend on the "use server" actions module.
// Behavior matches `normalizeVendorName` + `stripTrailingDigits` in actions.ts.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function stripTrailingDigits(s: string): string {
  return s.replace(/\d+$/, "");
}

type VendorRow = {
  id: string; name: string; short_name: string | null; category: string | null;
  sage_vendor_id: string | null; contact_email: string | null;
  remit_address: string | null; active: boolean;
};
type Cluster = { key: string; members: VendorRow[] };

/**
 * Group vendors whose normalized + trimmed names share a meaningful prefix
 * (≥6 chars), or where one fully contains the other. Returns clusters of 2+
 * so the user can decide which canonical name to keep.
 *
 * Uses a union-find pass so we don't double-count: "Republic", "Republic
 * Services", and "Republic - Duncan Disposal #794" all collapse into one
 * group rather than three pairwise alerts.
 */
function findClusters(vendors: VendorRow[]): Cluster[] {
  const n = vendors.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const norm = vendors.map(v => stripTrailingDigits(normalize(v.name)));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = norm[i], b = norm[j];
      if (!a || !b) continue;

      let similar = false;
      if (a === b) similar = true;
      else if (a.length >= 3 && b.includes(a)) similar = true;
      else if (b.length >= 3 && a.includes(b)) similar = true;
      else if (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6)) similar = true;
      if (similar) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }

  const clusters: Cluster[] = [];
  for (const [, idxs] of groups) {
    if (idxs.length < 2) continue;
    clusters.push({
      key:     norm[idxs[0]] || `cluster-${idxs[0]}`,
      members: idxs.map(i => vendors[i]).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  // Sort biggest clusters first
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}

// Sortable columns. Maps the URL `sort` param to the comparator used after
// fetch. We sort in-memory so columns like Status (a derived string) and
// the hyphenated category labels can sort cleanly without composing complex
// SQL.
type SortKey = "name" | "category" | "sage_vendor_id" | "contact" | "status";
const VALID_SORTS = new Set<SortKey>(["name", "category", "sage_vendor_id", "contact", "status"]);

function compareVendors(a: VendorRow, b: VendorRow, key: SortKey): number {
  // Empty / null values always sort last regardless of direction
  function cmpStr(av: string | null, bv: string | null): number {
    const ae = !av;
    const be = !bv;
    if (ae && be) return 0;
    if (ae) return 1;
    if (be) return -1;
    return av!.localeCompare(bv!, undefined, { sensitivity: "base" });
  }
  switch (key) {
    case "name":           return cmpStr(a.name, b.name);
    case "category":       return cmpStr(a.category, b.category);
    case "sage_vendor_id": return cmpStr(a.sage_vendor_id, b.sage_vendor_id);
    case "contact":        return cmpStr(a.contact_email, b.contact_email);
    case "status": {
      // active first when ascending, inactive first when descending
      if (a.active === b.active) return cmpStr(a.name, b.name);
      return a.active ? -1 : 1;
    }
  }
}

interface PageProps {
  searchParams: { sort?: string; dir?: string };
}

export default async function AdminVendorsPage({ searchParams }: PageProps) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name, short_name, category, sage_vendor_id, contact_email, remit_address, active");

  const vendors = (data ?? []) as VendorRow[];

  // Resolve sort from URL — default name asc, with active above inactive
  const sortKey: SortKey = VALID_SORTS.has(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey)
    : "name";
  const sortDir: "asc" | "desc" = searchParams.dir === "desc" ? "desc" : "asc";

  const sorted = [...vendors].sort((a, b) => {
    // Default tie-breaker: active first, then name
    const primary = compareVendors(a, b, sortKey);
    if (primary !== 0) return sortDir === "asc" ? primary : -primary;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const clusters = findClusters(vendors);
  const dupTotal = clusters.reduce((sum, c) => sum + c.members.length, 0);

  return (
    <>
      <TopBar title="Vendors" subtitle="Utility and service providers NuRock pays" />
      <div className="p-8 space-y-4">

        {/* Duplicate-cluster banner — only shown when clusters exist. */}
        {clusters.length > 0 && (
          <div className="card border-l-4 border-l-flag-amber p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="font-display font-semibold text-nurock-black text-[14px]">
                  Possible duplicate vendors
                </div>
                <p className="text-[12.5px] text-nurock-slate mt-0.5">
                  Found {clusters.length} group{clusters.length === 1 ? "" : "s"} ·{" "}
                  {dupTotal} vendor{dupTotal === 1 ? "" : "s"} look{dupTotal === 1 ? "s" : ""} similar to another. Pick a canonical record per group, then deactivate the rest.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {clusters.map(c => (
                <div key={c.key} className="rounded-md border border-nurock-border bg-[#FFF8E8] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-nurock-slate mb-1.5">
                    Group · {c.members.length} vendors
                  </div>
                  <ul className="space-y-1">
                    {c.members.map(m => (
                      <li key={m.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                        <Link href={`/admin/vendors/${m.id}/edit`} className="text-nurock-navy hover:underline truncate">
                          {m.name}
                        </Link>
                        <span className={cn("badge text-[10px] px-1.5 py-0.5 shrink-0", m.active ? "badge-green" : "badge-slate")}>
                          {m.active ? "active" : "inactive"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-nurock-slate">
            {vendors.length} vendors · Sage vendor IDs must be set before a property can post bills to Sage.
          </p>
          <Link href="/admin/vendors/new" className="btn-primary">
            + Add vendor
          </Link>
        </div>
        <div className="card overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <SortableHeader label="Name"           sortKey="name"           current={sortKey} dir={sortDir} />
                <SortableHeader label="Category"       sortKey="category"       current={sortKey} dir={sortDir} />
                <SortableHeader label="Sage vendor ID" sortKey="sage_vendor_id" current={sortKey} dir={sortDir} />
                <SortableHeader label="Contact"        sortKey="contact"        current={sortKey} dir={sortDir} />
                <SortableHeader label="Status"         sortKey="status"         current={sortKey} dir={sortDir} />
                <th className="cell-head text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="cell text-center text-nurock-slate-light py-10">
                  No vendors yet. <Link href="/admin/vendors/new" className="text-nurock-navy hover:underline font-medium">Add the first one.</Link>
                </td></tr>
              )}
              {sorted.map((v) => (
                <tr key={v.id} className={cn("table-row border-b border-nurock-border last:border-b-0", !v.active && "opacity-60")}>
                  <td className="cell">
                    <Link href={`/admin/vendors/${v.id}/edit`} className="text-nurock-navy hover:underline font-medium">
                      {v.name}
                    </Link>
                    {v.short_name && <span className="text-[11px] text-nurock-slate-light ml-1.5">({v.short_name})</span>}
                    {v.remit_address && (
                      <div className="text-[10.5px] text-nurock-slate-light mt-0.5 truncate max-w-[300px]" title={v.remit_address}>
                        Remit: {v.remit_address.split("\n")[0]}
                      </div>
                    )}
                  </td>
                  <td className="cell capitalize text-nurock-slate">{v.category?.replace(/_/g, " ") ?? "—"}</td>
                  <td className="cell">
                    {v.sage_vendor_id
                      ? <span className="code">{v.sage_vendor_id}</span>
                      : <span className="text-flag-red text-[11px]">not set</span>}
                  </td>
                  <td className="cell text-[12px] text-nurock-slate">{v.contact_email ?? "—"}</td>
                  <td className="cell">
                    <span className={cn("badge", v.active ? "badge-green" : "badge-slate")}>
                      {v.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="cell text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/admin/vendors/${v.id}/edit`} className="btn-ghost text-[11px] px-2 py-1">Edit</Link>
                      {v.active ? (
                        <form action={deactivateVendor}>
                          <input type="hidden" name="id" value={v.id} />
                          <button type="submit" className="btn-ghost text-[11px] px-2 py-1 text-nurock-slate hover:text-flag-red">
                            Deactivate
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateVendor}>
                          <input type="hidden" name="id" value={v.id} />
                          <button type="submit" className="btn-ghost text-[11px] px-2 py-1 text-nurock-slate hover:text-flag-green">
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
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

/**
 * Clickable column header. When the header is the currently-active sort,
 * clicking it flips direction; when inactive, clicking activates it in
 * ascending order. Renders an arrow indicator on the active column.
 */
function SortableHeader({
  label, sortKey, current, dir,
}: {
  label: string; sortKey: SortKey; current: SortKey; dir: "asc" | "desc";
}) {
  const isActive = current === sortKey;
  const nextDir = isActive ? (dir === "asc" ? "desc" : "asc") : "asc";
  const href = `/admin/vendors?sort=${sortKey}&dir=${nextDir}`;
  return (
    <th className="cell-head">
      <Link href={href} className="inline-flex items-center gap-1 hover:text-nurock-black">
        <span>{label}</span>
        <span className={cn("text-[10px] leading-none", isActive ? "text-nurock-navy" : "text-nurock-slate-light")}>
          {isActive ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

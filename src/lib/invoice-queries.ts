import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetches all invoices matching a property + GL filter, working around
 * Supabase's default 1000-row limit by paginating in parallel.
 *
 * Tracker pages can exceed 1000 rows on master-account properties:
 *   - 558 (Onion Creek) vacant electric: ~1500 historical rows
 *   - 514 vacant electric: ~640 rows
 *   - some water/comms combos in aggregate
 *
 * Without explicit pagination + a stable sort, PostgREST will silently
 * truncate to the first 1000 in heap order, dropping months of data.
 *
 * Stable sort: (invoice_date asc, id asc). Both immutable once written.
 */
export async function fetchAllInvoicesForProperty(
  supabase: SupabaseClient,
  opts: {
    propertyId: string;
    glIds:      string[];
    selectCols: string;
  },
): Promise<any[]> {
  const { propertyId, glIds, selectCols } = opts;
  if (!glIds.length) return [];
  const PAGE_SIZE = 1000;

  // Probe count first
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .in("gl_account_id", glIds);

  const total = count ?? 0;
  if (total === 0) return [];
  if (total <= PAGE_SIZE) {
    // Single page — skip the parallel-fetch overhead
    const { data } = await supabase
      .from("invoices")
      .select(selectCols)
      .eq("property_id", propertyId)
      .in("gl_account_id", glIds)
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true });
    return data ?? [];
  }

  const pages = Math.ceil(total / PAGE_SIZE);
  const reqs = [];
  for (let i = 0; i < pages; i++) {
    reqs.push(
      supabase
        .from("invoices")
        .select(selectCols)
        .eq("property_id", propertyId)
        .in("gl_account_id", glIds)
        .order("invoice_date", { ascending: true })
        .order("id", { ascending: true })
        .range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1),
    );
  }
  const results = await Promise.all(reqs);
  return results.flatMap(r => r.data ?? []);
}

/**
 * Variant: fetch by utility_account_id list (the vacant page uses this
 * because a master account may host invoices for many GL combos but only
 * one UA).
 */
export async function fetchAllInvoicesForAccounts(
  supabase: SupabaseClient,
  opts: {
    accountIds: string[];
    selectCols: string;
  },
): Promise<any[]> {
  const { accountIds, selectCols } = opts;
  if (!accountIds.length) return [];
  const PAGE_SIZE = 1000;

  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .in("utility_account_id", accountIds);

  const total = count ?? 0;
  if (total === 0) return [];
  if (total <= PAGE_SIZE) {
    const { data } = await supabase
      .from("invoices")
      .select(selectCols)
      .in("utility_account_id", accountIds)
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true });
    return data ?? [];
  }

  const pages = Math.ceil(total / PAGE_SIZE);
  const reqs = [];
  for (let i = 0; i < pages; i++) {
    reqs.push(
      supabase
        .from("invoices")
        .select(selectCols)
        .in("utility_account_id", accountIds)
        .order("invoice_date", { ascending: true })
        .order("id", { ascending: true })
        .range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1),
    );
  }
  const results = await Promise.all(reqs);
  return results.flatMap(r => r.data ?? []);
}

import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";
import type { InvoiceStatus } from "@/lib/types";
import { InvoicesTable, type InvoiceRow } from "@/components/invoices/InvoicesTable";

interface Props {
  searchParams: { status?: string; property?: string; propertyId?: string; flagged?: string; due?: string };
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "",                    label: "All active" },
  { value: "new",                 label: "New" },
  { value: "needs_coding",        label: "Needs coding" },
  { value: "needs_variance_note", label: "Variance note" },
  { value: "ready_for_approval",  label: "Ready for approval" },
  { value: "approved",            label: "Approved" },
  { value: "posted_to_sage",      label: "Posted" },
  { value: "paid",                label: "Paid" },
];

export default async function InvoicesPage({ searchParams }: Props) {
  const supabase = createSupabaseServerClient();

  // PostgREST caps every API request at ~1000 rows regardless of `.limit()`,
  // so a single fetch can never see the full historical baseline. The strategy:
  //   1. Run a HEAD count query to find out exactly how many rows match.
  //   2. Fire all pages in parallel via Promise.all (one request per 1000 rows).
  //   3. Merge the results.
  // This is fast because the round-trips happen concurrently, and complete
  // because we know up-front how many pages to ask for.
  //
  // The ORDER BY needs a stable tiebreaker. Without one, rows with the same
  // submitted_at (which is most of the historical baseline — every January
  // invoice shares 2026-01-15) end up in non-deterministic positions and
  // some rows show up in two pages while others show up in none. Adding
  // `id ASC` as a secondary sort guarantees deterministic windows.
  const PAGE_SIZE = 1000;
  const MAX_ROWS  = 50_000;

  function buildQuery() {
    let q = supabase
      .from("invoices")
      .select(`
        id, invoice_number, invoice_date, due_date, total_amount_due,
        status, variance_flagged, variance_pct, gl_coding,
        property:properties(id, code, name),
        vendor:vendors(id, name),
        gl:gl_accounts(code, description)
      `)
      .order("submitted_at", { ascending: false })
      .order("id",            { ascending: true });    // stable tiebreaker
    if (searchParams.status) q = q.eq("status", searchParams.status as InvoiceStatus);
    const propertyFilter = searchParams.propertyId ?? searchParams.property;
    if (propertyFilter) q = q.eq("property_id", propertyFilter);
    if (searchParams.flagged === "true") q = q.eq("variance_flagged", true);
    if (searchParams.due === "soon") {
      const threeDays = new Date();
      threeDays.setDate(threeDays.getDate() + 3);
      q = q.lte("due_date", threeDays.toISOString().slice(0, 10));
    }
    return q;
  }

  // Step 1: How many rows match? Cheap HEAD request.
  let countQuery = supabase
    .from("invoices")
    .select("id", { count: "exact", head: true });
  if (searchParams.status) countQuery = countQuery.eq("status", searchParams.status as InvoiceStatus);
  const propertyFilter = searchParams.propertyId ?? searchParams.property;
  if (propertyFilter) countQuery = countQuery.eq("property_id", propertyFilter);
  if (searchParams.flagged === "true") countQuery = countQuery.eq("variance_flagged", true);
  if (searchParams.due === "soon") {
    const threeDays = new Date();
    threeDays.setDate(threeDays.getDate() + 3);
    countQuery = countQuery.lte("due_date", threeDays.toISOString().slice(0, 10));
  }
  const { count } = await countQuery;
  const totalRows = Math.min(count ?? 0, MAX_ROWS);

  // Step 2: Build all the page requests up front and fire them in parallel.
  const numPages = Math.ceil(totalRows / PAGE_SIZE);
  const pageRequests = Array.from({ length: numPages }, (_, i) =>
    buildQuery().range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1),
  );
  const pageResults = await Promise.all(pageRequests);

  // Step 3: Merge.
  const rows: any[] = [];
  let error: { message: string } | null = null;
  for (const r of pageResults) {
    if (r.error) { error = r.error; break; }
    if (r.data) rows.push(...r.data);
  }

  return (
    <>
      <TopBar title="Invoices" subtitle={`${rows.length.toLocaleString()} loaded · search & filter below`} />

      <div className="px-8 py-4 border-b border-nurock-border bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map(f => {
            const active = (searchParams.status ?? "") === f.value;
            const href = f.value
              ? `/invoices?status=${f.value}`
              : "/invoices";
            return (
              <Link
                key={f.value}
                href={href}
                className={cn(
                  "badge border transition-colors",
                  active
                    ? "bg-nurock-navy text-white border-navy"
                    : "bg-white text-nurock-navy border-nurock-border hover:bg-[#FAFBFC]",
                )}
              >
                {f.label}
              </Link>
            );
          })}
          <Link
            href={searchParams.flagged === "true" ? "/invoices" : "/invoices?flagged=true"}
            className={cn(
              "badge border transition-colors ml-auto",
              searchParams.flagged === "true"
                ? "bg-flag-yellow text-white border-flag-yellow"
                : "bg-white text-nurock-navy border-nurock-border hover:bg-[#FAFBFC]",
            )}
          >
            {searchParams.flagged === "true" ? "Showing flagged only" : "Variance flagged"}
          </Link>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="card p-4 text-sm text-flag-red mb-4">
            Failed to load invoices: {error.message}
          </div>
        )}
        <InvoicesTable
          rows={rows.map((r: any): InvoiceRow => ({
            id:                r.id,
            invoice_number:    r.invoice_number,
            invoice_date:      r.invoice_date,
            due_date:          r.due_date,
            total_amount_due:  r.total_amount_due,
            status:            r.status,
            variance_flagged:  r.variance_flagged,
            variance_pct:      r.variance_pct,
            gl_coding:         r.gl_coding,
            property_code:     r.property?.code  ?? null,
            property_name:     r.property?.name  ?? null,
            vendor_name:       r.vendor?.name    ?? null,
          }))}
        />
      </div>
    </>
  );
}

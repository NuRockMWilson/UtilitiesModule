"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeVariance } from "@/lib/variance";

export type EditFieldsResult = {
  ok: boolean;
  error?: string;
};

// Pre-approval statuses where editing is safe. Once an invoice is approved
// or posted to Sage, the bill amounts become part of the audit trail and
// must not be silently mutated — fixes after that go through reject + redo.
const EDITABLE_STATUSES = new Set([
  "new", "extracting", "extraction_failed",
  "needs_coding", "needs_variance_note",
  "ready_for_approval", "rejected",
]);

// Whitelist of editable columns. Anything outside this list (status,
// raw_extraction, FK ids, timestamps, etc.) is intentionally NOT editable
// from the form.
type EditableColumn =
  | "invoice_number" | "invoice_date" | "due_date"
  | "service_period_start" | "service_period_end" | "service_days"
  | "current_charges" | "adjustments" | "late_fees" | "total_amount_due"
  | "gl_coding";

const EDITABLE_COLUMNS: EditableColumn[] = [
  "invoice_number", "invoice_date", "due_date",
  "service_period_start", "service_period_end", "service_days",
  "current_charges", "adjustments", "late_fees", "total_amount_due",
  "gl_coding",
];

// Coerce a form string into the value Postgres wants for that column.
// Empty strings become null. Strings stay strings, dates stay strings (YYYY-MM-DD),
// numerics get parsed.
function coerce(col: EditableColumn, raw: string): { value: string | number | null; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };

  switch (col) {
    case "service_days":
    case "current_charges":
    case "adjustments":
    case "late_fees":
    case "total_amount_due": {
      // Strip $ and commas defensively
      const cleaned = trimmed.replace(/[$,]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n)) {
        return { value: null, error: `${col} must be a number, got "${raw}"` };
      }
      return { value: n };
    }
    case "invoice_date":
    case "due_date":
    case "service_period_start":
    case "service_period_end": {
      // Accept YYYY-MM-DD only; Postgres tolerates this directly.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { value: null, error: `${col} must be YYYY-MM-DD, got "${raw}"` };
      }
      const d = new Date(`${trimmed}T00:00:00`);
      if (Number.isNaN(d.getTime())) {
        return { value: null, error: `${col} is not a valid date: "${raw}"` };
      }
      return { value: trimmed };
    }
    case "gl_coding": {
      // Format: 500-XXX-XXXX.YY — soft validation; allow any non-empty string
      // because users may correct formatting issues by hand
      return { value: trimmed };
    }
    default:
      return { value: trimmed };
  }
}

/**
 * Edit extracted fields on an invoice. Records a diff in approval_log so
 * reviewers can see what was changed manually vs what came from the LLM.
 *
 * After saving, recomputes variance against the (possibly-changed) total
 * and service days. Doesn't change status — the user explicitly chooses
 * what to do next via the existing Mark/Approve/Reject buttons.
 */
export async function editInvoiceFields(formData: FormData): Promise<EditFieldsResult> {
  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  if (!invoiceId) return { ok: false, error: "Missing invoice id" };

  const supabase = createSupabaseServerClient();

  // Status guard
  const { data: existing, error: getErr } = await supabase
    .from("invoices")
    .select(`
      id, status, utility_account_id,
      invoice_number, invoice_date, due_date,
      service_period_start, service_period_end, service_days,
      current_charges, adjustments, late_fees, total_amount_due,
      gl_coding
    `)
    .eq("id", invoiceId)
    .single();
  if (getErr || !existing) return { ok: false, error: getErr?.message ?? "Invoice not found" };

  if (!EDITABLE_STATUSES.has(existing.status)) {
    return {
      ok: false,
      error: `Cannot edit an invoice in status "${existing.status}". Approved and posted invoices must be rejected before changes can be made.`,
    };
  }

  // Build patch from form, coercing each value
  const patch: Record<string, string | number | null> = {};
  const diff: Array<{ field: string; from: unknown; to: unknown }> = [];

  for (const col of EDITABLE_COLUMNS) {
    const raw = formData.get(col);
    if (raw === null) continue;   // field not present on this submit; skip
    const { value, error } = coerce(col, String(raw));
    if (error) return { ok: false, error };

    const prev = (existing as any)[col] ?? null;
    // Compare loosely — DB stores numerics as strings sometimes
    const prevNorm = typeof prev === "number" ? prev : prev === null ? null : String(prev);
    const nextNorm = typeof value === "number" ? value : value;
    if (String(prevNorm) !== String(nextNorm)) {
      patch[col] = value;
      diff.push({ field: col, from: prev, to: value });
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true };   // no-op — user submitted with no changes
  }

  // Apply the patch
  const { error: updErr } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", invoiceId);
  if (updErr) return { ok: false, error: updErr.message };

  // If amounts or service period changed and the invoice is linked, recompute variance
  const amountsChanged = "total_amount_due" in patch || "service_days" in patch;
  if (amountsChanged && existing.utility_account_id) {
    const { data: ua } = await supabase
      .from("utility_accounts")
      .select("baseline_window_months, variance_threshold_pct")
      .eq("id", existing.utility_account_id)
      .single();
    const { data: priors } = await supabase
      .from("invoices")
      .select(`
        id, service_period_start, service_period_end, service_days,
        total_amount_due, exclude_from_baseline, variance_flagged, variance_explanation
      `)
      .eq("utility_account_id", existing.utility_account_id)
      .neq("id", invoiceId)
      .in("status", ["approved", "posted_to_sage", "paid"]);

    const newTotal = (patch.total_amount_due as number | null) ?? existing.total_amount_due;
    const newDays  = (patch.service_days as number | null) ?? existing.service_days;
    const v = computeVariance({
      currentDays:       Number(newDays ?? 30),
      currentTotal:      Number(newTotal ?? 0),
      currentDailyUsage: null,
      priorInvoices: (priors ?? []).map((p: any) => ({
        id:                    p.id,
        service_period_start:  p.service_period_start,
        service_period_end:    p.service_period_end,
        service_days:          p.service_days,
        total_amount_due:      p.total_amount_due,
        daily_usage:           null,
        exclude_from_baseline: p.exclude_from_baseline,
        variance_flagged:      p.variance_flagged,
        variance_explanation:  p.variance_explanation,
      })),
      thresholdPct: Number(ua?.variance_threshold_pct ?? 3),
      windowMonths: Number(ua?.baseline_window_months ?? 12),
    });
    await supabase.from("invoices").update({
      variance_baseline: v.baseline,
      variance_pct:      v.variancePct,
      variance_flagged:  v.flagged,
    }).eq("id", invoiceId);
  }

  // Audit log entry — list every changed field with its before and after
  await supabase.from("approval_log").insert({
    invoice_id: invoiceId,
    action:     "fields_edited",
    notes:      `Edited ${diff.length} field${diff.length === 1 ? "" : "s"}: ${diff.map(d => d.field).join(", ")}`,
    metadata:   { diff },
  });

  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}

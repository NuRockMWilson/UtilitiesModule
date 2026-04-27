"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BudgetUploadResult = {
  ok:               boolean;
  error?:           string;
  rowsTotal:        number;
  rowsParsed:       number;
  rowsInserted:     number;
  rowsSkipped:      Array<{ row: number; reason: string }>;
};

/**
 * Parse and apply a budget CSV. Expected columns (header row required):
 *
 *   property_code, gl_code, year, month, amount
 *
 * Where:
 *   - property_code:  matches properties.code (e.g. "555")
 *   - gl_code:        matches gl_accounts.code (e.g. "5120")
 *   - year:           4-digit year
 *   - month:          1-12 (or "1"-"12")
 *   - amount:         decimal number, dollars
 *
 * The month column may also be empty/blank to set an annual budget that's
 * applied to month=null. Rows are upserted: existing budget rows for the
 * same (property, gl, year, month) are replaced.
 */
export async function uploadBudgetCSV(formData: FormData): Promise<BudgetUploadResult> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file uploaded", rowsTotal: 0, rowsParsed: 0, rowsInserted: 0, rowsSkipped: [] };
  }
  if (file.size > 5_000_000) {
    return { ok: false, error: "File is larger than 5 MB", rowsTotal: 0, rowsParsed: 0, rowsInserted: 0, rowsSkipped: [] };
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { ok: false, error: "CSV must contain a header row and at least one data row", rowsTotal: 0, rowsParsed: 0, rowsInserted: 0, rowsSkipped: [] };
  }

  const header = parseCSVLine(lines[0]).map(c => c.toLowerCase().trim());
  const required = ["property_code", "gl_code", "year", "month", "amount"];
  const missing = required.filter(c => !header.includes(c));
  if (missing.length) {
    return {
      ok: false,
      error: `Missing required column(s): ${missing.join(", ")}. Expected header: ${required.join(", ")}`,
      rowsTotal: 0, rowsParsed: 0, rowsInserted: 0, rowsSkipped: [],
    };
  }
  const idx = (col: string) => header.indexOf(col);

  // Lookup tables for FK resolution
  const supabase = createSupabaseServerClient();
  const [{ data: properties }, { data: glAccounts }] = await Promise.all([
    supabase.from("properties").select("id, code"),
    supabase.from("gl_accounts").select("id, code"),
  ]);
  const propertyByCode = new Map((properties ?? []).map((p: any) => [p.code, p.id]));
  const glByCode       = new Map((glAccounts ?? []).map((g: any) => [g.code, g.id]));

  const skipped: BudgetUploadResult["rowsSkipped"] = [];
  const upserts: Array<{
    property_id: string; gl_account_id: string;
    year: number; month: number | null; amount: number;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const rowNum = i + 1; // for human-friendly error messages

    const propCode = cells[idx("property_code")]?.trim();
    const glCode   = cells[idx("gl_code")]?.trim();
    const yearStr  = cells[idx("year")]?.trim();
    const monthStr = cells[idx("month")]?.trim();
    const amtStr   = cells[idx("amount")]?.trim();

    if (!propCode || !glCode || !yearStr || !amtStr) {
      skipped.push({ row: rowNum, reason: "Required field is blank" });
      continue;
    }
    const property_id   = propertyByCode.get(propCode);
    const gl_account_id = glByCode.get(glCode);
    if (!property_id) { skipped.push({ row: rowNum, reason: `Unknown property_code "${propCode}"` }); continue; }
    if (!gl_account_id) { skipped.push({ row: rowNum, reason: `Unknown gl_code "${glCode}"` }); continue; }

    const year = parseInt(yearStr, 10);
    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      skipped.push({ row: rowNum, reason: `Invalid year "${yearStr}"` }); continue;
    }
    let month: number | null = null;
    if (monthStr) {
      month = parseInt(monthStr, 10);
      if (Number.isNaN(month) || month < 1 || month > 12) {
        skipped.push({ row: rowNum, reason: `Invalid month "${monthStr}" (must be 1-12 or blank)` }); continue;
      }
    }
    // Strip $ and commas from amount
    const amount = parseFloat(amtStr.replace(/[$,]/g, ""));
    if (Number.isNaN(amount)) {
      skipped.push({ row: rowNum, reason: `Invalid amount "${amtStr}"` }); continue;
    }

    upserts.push({ property_id: property_id as string, gl_account_id: gl_account_id as string, year, month, amount });
  }

  if (upserts.length === 0) {
    return {
      ok: false,
      error: "No valid rows to insert. Check the skipped-rows report for details.",
      rowsTotal: lines.length - 1,
      rowsParsed: 0,
      rowsInserted: 0,
      rowsSkipped: skipped,
    };
  }

  // Delete existing budgets for the (property, gl, year, month) combos we're inserting,
  // then insert fresh. Doing this in two passes since Supabase doesn't expose true upsert
  // for compound keys without a unique constraint.
  // Group by year for fewer round-trips.
  const yearsTouched = Array.from(new Set(upserts.map(u => u.year)));
  for (const y of yearsTouched) {
    const propsThisYear = Array.from(new Set(upserts.filter(u => u.year === y).map(u => u.property_id)));
    await supabase.from("budgets").delete()
      .eq("year", y)
      .in("property_id", propsThisYear);
  }

  const { error: insertError } = await supabase.from("budgets").insert(upserts);
  if (insertError) {
    return {
      ok: false,
      error: `Insert failed: ${insertError.message}`,
      rowsTotal: lines.length - 1,
      rowsParsed: upserts.length,
      rowsInserted: 0,
      rowsSkipped: skipped,
    };
  }

  revalidatePath("/admin/budgets");
  return {
    ok:           true,
    rowsTotal:    lines.length - 1,
    rowsParsed:   upserts.length,
    rowsInserted: upserts.length,
    rowsSkipped:  skipped,
  };
}

/**
 * Minimal CSV line parser that handles quoted fields with embedded commas.
 * Not a full RFC 4180 implementation but good enough for the budget format.
 */
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"')                   { inQuotes = false; }
      else                                   { cur += c; }
    } else {
      if (c === '"')      { inQuotes = true; }
      else if (c === ",") { out.push(cur); cur = ""; }
      else                { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const NAVY     = "FF164576";
const PAPER    = "FFFAFBFC";
const FLAG_RED = "FFFEE4E2";
const FLAG_AMB = "FFFEF0C7";

/**
 * Variance log report.
 *
 * Two sheets:
 *   1. Flagged invoices — every invoice with variance_flagged=true,
 *      with baseline, % variance, explanation, and response status
 *   2. Response rates — per property, count of inquiries sent vs responded,
 *      avg response time, and currently-open count
 *
 * GET /api/reports/variance?year=YYYY
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getFullYear());

  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year + 1}-01-01`;

  const [{ data: flagged }, { data: inquiries }] = await Promise.all([
    supabase
      .from("invoices")
      .select(`
        id, invoice_number, invoice_date, total_amount_due,
        variance_baseline, variance_pct, variance_explanation, exclude_from_baseline, status,
        property:properties(code, name),
        vendor:vendors(name),
        gl:gl_accounts(code, description),
        utility_account:utility_accounts(account_number)
      `)
      .eq("variance_flagged", true)
      .gte("invoice_date", yearStart)
      .lt("invoice_date", yearEnd)
      .order("variance_pct", { ascending: false })
      .limit(500),
    supabase
      .from("variance_inquiries")
      .select(`
        sent_at, response_received_at, status,
        invoice:invoices(invoice_date, property:properties(code, name))
      `),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "NuRock Utilities AP";
  wb.created = new Date();

  // ============================================================
  // Sheet 1 — Flagged invoices
  // ============================================================
  const s1 = wb.addWorksheet(`Flagged ${year}`);
  s1.columns = [
    { header: "Property",    width: 10 },
    { header: "Property name", width: 28 },
    { header: "Vendor",      width: 24 },
    { header: "GL",          width: 8 },
    { header: "Account #",   width: 18 },
    { header: "Invoice #",   width: 16 },
    { header: "Invoice date", width: 12 },
    { header: "Amount",      width: 12 },
    { header: "Baseline",    width: 12 },
    { header: "% var",       width: 9 },
    { header: "Status",      width: 14 },
    { header: "Explanation", width: 50 },
    { header: "Excluded?",   width: 10 },
  ];
  styleHeader(s1.getRow(1));

  for (const inv of flagged ?? []) {
    const p: any = inv.property;
    const v: any = inv.vendor;
    const g: any = inv.gl;
    const ua: any = inv.utility_account;

    const variancePct = inv.variance_pct ? Number(inv.variance_pct) / 100 : null;

    const r = s1.addRow([
      p?.code ?? "",
      p?.name ?? "",
      v?.name ?? "",
      g?.code ?? "",
      ua?.account_number ?? "",
      inv.invoice_number ?? "",
      inv.invoice_date ?? "",
      Number(inv.total_amount_due ?? 0),
      Number(inv.variance_baseline ?? 0),
      variancePct,
      inv.status ?? "",
      inv.variance_explanation ?? "",
      inv.exclude_from_baseline ? "Yes" : "",
    ]);

    formatMoneyCells(r, 8, 9);
    r.getCell(10).numFmt = "0.0%";
    r.getCell(10).alignment = { horizontal: "right" };

    // Tint % var by severity
    if (variancePct !== null) {
      const fill = variancePct > 0.10 ? FLAG_RED
                 : variancePct > 0.03 ? FLAG_AMB
                 : null;
      if (fill) r.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
    r.alignment = { vertical: "top", wrapText: true };
  }
  s1.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  // ============================================================
  // Sheet 2 — Inquiry response rates by property
  // ============================================================
  const s2 = wb.addWorksheet(`Response rates`);
  s2.columns = [
    { header: "Property",  width: 10 },
    { header: "Property name", width: 28 },
    { header: "Sent",      width: 8 },
    { header: "Responded", width: 11 },
    { header: "Open",      width: 8 },
    { header: "Response %", width: 11 },
    { header: "Avg days to respond", width: 18 },
  ];
  styleHeader(s2.getRow(1));

  type Stats = { sent: number; responded: number; open: number; totalDays: number };
  const byProperty = new Map<string, { name: string; stats: Stats }>();
  for (const q of inquiries ?? []) {
    const p: any = (q.invoice as any)?.property;
    if (!p) continue;
    const key = p.code;
    const cur = byProperty.get(key) ?? { name: p.name, stats: { sent: 0, responded: 0, open: 0, totalDays: 0 } };
    cur.stats.sent++;
    if (q.response_received_at) {
      cur.stats.responded++;
      const sent = new Date(q.sent_at as string);
      const recv = new Date(q.response_received_at as string);
      cur.stats.totalDays += (recv.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
    } else if (q.status !== "closed") {
      cur.stats.open++;
    }
    byProperty.set(key, cur);
  }

  const sorted = Array.from(byProperty.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [code, { name, stats }] of sorted) {
    const respPct = stats.sent > 0 ? stats.responded / stats.sent : null;
    const avgDays = stats.responded > 0 ? stats.totalDays / stats.responded : null;
    const r = s2.addRow([code, name, stats.sent, stats.responded, stats.open, respPct, avgDays]);
    r.getCell(6).numFmt = "0.0%";
    r.getCell(6).alignment = { horizontal: "right" };
    r.getCell(7).numFmt = "0.0";
    r.getCell(7).alignment = { horizontal: "right" };
    if (respPct !== null && respPct < 0.5) {
      r.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FLAG_RED } };
    }
  }
  if (!sorted.length) {
    s2.addRow(["", "No variance inquiries sent yet — Variance recompute will create them when bills exceed threshold.", "", "", "", "", ""]);
  }
  s2.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="NuRock-Variance-${year}.xlsx"`,
    },
  });
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Inter" };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function formatMoneyCells(row: ExcelJS.Row, fromCol: number, toCol: number) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = row.getCell(c);
    cell.numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
    cell.alignment = { horizontal: "right" };
  }
}

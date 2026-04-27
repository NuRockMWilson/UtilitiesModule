import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const NAVY  = "FF164576";
const PAPER = "FFFAFBFC";

/**
 * Vendor spend ranking report.
 *
 * Three sheets:
 *   1. Top vendors overall — every vendor ranked by YTD spend across portfolio
 *   2. Top vendors by GL — same, but split per category
 *   3. Vendor x Property matrix — what each property spends per vendor
 *
 * GET /api/reports/vendors?year=YYYY
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getFullYear());

  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year + 1}-01-01`;

  const { data: invoices } = await supabase
    .from("invoices")
    .select(`
      total_amount_due,
      vendor:vendors(id, name, category),
      gl:gl_accounts(code, description),
      property:properties(code, name)
    `)
    .gte("invoice_date", yearStart)
    .lt("invoice_date", yearEnd);

  // Aggregate
  const byVendor = new Map<string, { name: string; category: string; total: number; count: number }>();
  const byVendorGl = new Map<string, { vendor: string; gl: string; description: string; total: number }>();
  const byVendorProp = new Map<string, { vendor: string; property: string; propName: string; total: number }>();

  for (const inv of invoices ?? []) {
    const v: any = inv.vendor;
    if (!v) continue;
    const amt = Number(inv.total_amount_due ?? 0);
    if (amt <= 0) continue;
    const g: any = inv.gl;
    const p: any = inv.property;

    const ve = byVendor.get(v.id) ?? { name: v.name, category: v.category ?? "other", total: 0, count: 0 };
    ve.total += amt; ve.count += 1;
    byVendor.set(v.id, ve);

    if (g) {
      const k = `${v.id}:${g.code}`;
      const vge = byVendorGl.get(k) ?? { vendor: v.name, gl: g.code, description: g.description, total: 0 };
      vge.total += amt;
      byVendorGl.set(k, vge);
    }

    if (p) {
      const k = `${v.id}:${p.code}`;
      const vpe = byVendorProp.get(k) ?? { vendor: v.name, property: p.code, propName: p.name, total: 0 };
      vpe.total += amt;
      byVendorProp.set(k, vpe);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "NuRock Utilities AP";
  wb.created = new Date();

  // ============================================================
  // Sheet 1 — Top vendors overall
  // ============================================================
  const s1 = wb.addWorksheet(`Top vendors ${year}`);
  s1.columns = [
    { header: "Rank",     width: 7 },
    { header: "Vendor",   width: 36 },
    { header: "Category", width: 14 },
    { header: "Invoices", width: 11 },
    { header: "Total",    width: 16 },
    { header: "Avg/inv",  width: 14 },
  ];
  styleHeader(s1.getRow(1));

  const sortedVendors = Array.from(byVendor.values()).sort((a, b) => b.total - a.total);
  let grandTotal = 0;
  sortedVendors.forEach((v, i) => {
    const r = s1.addRow([i + 1, v.name, v.category.replace(/_/g, " "), v.count, v.total, v.total / v.count]);
    formatMoneyCells(r, 5, 6);
    grandTotal += v.total;
  });
  const totRow = s1.addRow(["", "PORTFOLIO TOTAL", "", "", grandTotal, ""]);
  totRow.font = { bold: true };
  totRow.getCell(2).alignment = { horizontal: "right" };
  formatMoneyCells(totRow, 5, 5);
  for (let c = 1; c <= 6; c++) {
    totRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
  }
  s1.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  // ============================================================
  // Sheet 2 — Top vendors by GL
  // ============================================================
  const s2 = wb.addWorksheet(`By category ${year}`);
  s2.columns = [
    { header: "GL",         width: 8 },
    { header: "Description", width: 24 },
    { header: "Vendor",     width: 32 },
    { header: "Total",      width: 16 },
  ];
  styleHeader(s2.getRow(1));

  // Group vendor-gl entries by GL, ranked within
  const byGl = new Map<string, Array<{ vendor: string; total: number; description: string }>>();
  for (const e of byVendorGl.values()) {
    const arr = byGl.get(e.gl) ?? [];
    arr.push({ vendor: e.vendor, total: e.total, description: e.description });
    byGl.set(e.gl, arr);
  }
  const glCodes = Array.from(byGl.keys()).sort();
  for (const glCode of glCodes) {
    const list = byGl.get(glCode)!;
    list.sort((a, b) => b.total - a.total);
    list.forEach((entry, idx) => {
      const r = s2.addRow([
        idx === 0 ? glCode : "",
        idx === 0 ? entry.description : "",
        entry.vendor,
        entry.total,
      ]);
      formatMoneyCells(r, 4, 4);
      if (idx === 0) {
        r.getCell(1).font = { bold: true };
        r.getCell(2).font = { bold: true };
      }
    });
  }
  s2.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  // ============================================================
  // Sheet 3 — Vendor × Property matrix
  // ============================================================
  const s3 = wb.addWorksheet(`Vendor × Property ${year}`);

  // Build the unique property list and unique vendor list (top 50 only — keeps sheet readable)
  const props = Array.from(new Set(Array.from(byVendorProp.values()).map(e => e.property)))
    .sort();
  const topVendors = sortedVendors.slice(0, 50);

  // Header
  s3.columns = [
    { header: "Vendor",   width: 32 },
    { header: "Total",    width: 14 },
    ...props.map(p => ({ header: p, width: 12 })),
  ];
  styleHeader(s3.getRow(1));

  for (const v of topVendors) {
    const row: (string | number)[] = [v.name, v.total];
    for (const p of props) {
      const k = Array.from(byVendor.entries()).find(([, vv]) => vv.name === v.name)?.[0];
      const cellAmt = k ? (byVendorProp.get(`${k}:${p}`)?.total ?? 0) : 0;
      row.push(cellAmt);
    }
    const r = s3.addRow(row);
    formatMoneyCells(r, 2, 2 + props.length);
    r.getCell(2).font = { bold: true };
  }
  s3.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="NuRock-Vendors-${year}.xlsx"`,
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

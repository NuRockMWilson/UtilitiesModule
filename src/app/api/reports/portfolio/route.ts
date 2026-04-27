import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NAVY  = "FF164576";
const TAN   = "FFB4AE92";
const PAPER = "FFFBFBF8";
const HEAD_BG = "FFFAFBFC";

/**
 * Portfolio-wide utility spend export.
 *
 * One workbook with three sheets:
 *   1. By Property × Month — every property as a row, monthly totals + YTD
 *   2. By Property × GL    — every property × GL combination, monthly + YTD
 *   3. By GL × Month       — total spend by category across all properties
 *
 * Triggered via GET /api/reports/portfolio?year=YYYY
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getFullYear());

  const [{ data: properties }, { data: glAccounts }, { data: summary }] = await Promise.all([
    supabase.from("properties").select("id, code, full_code, name, state, unit_count").eq("active", true).order("state").order("code"),
    supabase.from("gl_accounts").select("id, code, description").eq("active", true).order("code"),
    supabase.from("v_property_summary").select("*").eq("year", year),
  ]);

  if (!properties?.length) {
    return NextResponse.json({ error: "No properties found" }, { status: 404 });
  }

  // Index data
  const byPropMonth = new Map<string, Map<number, number>>();      // propId -> month -> $
  const byPropGl    = new Map<string, Map<string, number>>();      // propId -> glId -> $
  const byPropGlMo  = new Map<string, Map<number, number>>();      // `${propId}:${glId}` -> month -> $
  const byGlMonth   = new Map<string, Map<number, number>>();      // glId -> month -> $

  for (const r of summary ?? []) {
    const pId = r.property_id!;
    const gId = r.gl_account_id!;
    const m   = r.month ?? 0;
    const amt = Number(r.total_amount);

    const pmMap = byPropMonth.get(pId) ?? new Map<number, number>();
    pmMap.set(m, (pmMap.get(m) ?? 0) + amt);
    byPropMonth.set(pId, pmMap);

    const pgMap = byPropGl.get(pId) ?? new Map<string, number>();
    pgMap.set(gId, (pgMap.get(gId) ?? 0) + amt);
    byPropGl.set(pId, pgMap);

    const pgmKey = `${pId}:${gId}`;
    const pgmMap = byPropGlMo.get(pgmKey) ?? new Map<number, number>();
    pgmMap.set(m, (pgmMap.get(m) ?? 0) + amt);
    byPropGlMo.set(pgmKey, pgmMap);

    const gmMap = byGlMonth.get(gId) ?? new Map<number, number>();
    gmMap.set(m, (gmMap.get(m) ?? 0) + amt);
    byGlMonth.set(gId, gmMap);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "NuRock Utilities AP";
  wb.created = new Date();

  // ============================================================
  // Sheet 1 — By Property × Month
  // ============================================================
  const s1 = wb.addWorksheet(`Property × Month (${year})`);
  s1.columns = [
    { header: "Code",       width: 10 },
    { header: "Property",   width: 32 },
    { header: "State",      width: 7 },
    { header: "Units",      width: 8 },
    ...MONTHS.map(m => ({ header: m, width: 11 })),
    { header: "YTD",        width: 14 },
  ];
  styleHeader(s1.getRow(1));

  let s1total = new Array(13).fill(0);
  for (const p of properties) {
    const monthly = byPropMonth.get(p.id) ?? new Map<number, number>();
    const row: (string | number)[] = [
      p.code, p.name, p.state ?? "", p.unit_count ?? 0,
    ];
    let ytd = 0;
    for (let m = 1; m <= 12; m++) {
      const v = monthly.get(m) ?? 0;
      row.push(v); ytd += v;
      s1total[m - 1] += v;
    }
    row.push(ytd);
    s1total[12] += ytd;
    const xlrow = s1.addRow(row);
    formatMoneyCells(xlrow, 5, 17);
    xlrow.getCell(17).font = { bold: true };
  }
  // Total row
  const totalRow = s1.addRow(["", "TOTAL", "", ""].concat(s1total) as any);
  totalRow.font = { bold: true };
  totalRow.getCell(2).alignment = { horizontal: "right" };
  formatMoneyCells(totalRow, 5, 17);
  totalRow.getCell(1).fill = totalRow.getCell(2).fill = totalRow.getCell(3).fill = totalRow.getCell(4).fill =
    { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
  for (let c = 5; c <= 17; c++) {
    totalRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
  }
  s1.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];

  // ============================================================
  // Sheet 2 — By Property × GL
  // ============================================================
  const s2 = wb.addWorksheet(`Property × GL (${year})`);
  s2.columns = [
    { header: "Code",       width: 10 },
    { header: "Property",   width: 28 },
    { header: "GL",         width: 8 },
    { header: "Description", width: 24 },
    ...MONTHS.map(m => ({ header: m, width: 11 })),
    { header: "YTD",        width: 14 },
  ];
  styleHeader(s2.getRow(1));

  for (const p of properties) {
    for (const gl of glAccounts ?? []) {
      const monthly = byPropGlMo.get(`${p.id}:${gl.id}`) ?? new Map<number, number>();
      let hasData = false;
      let ytd = 0;
      const row: (string | number)[] = [p.code, p.name, gl.code, gl.description];
      for (let m = 1; m <= 12; m++) {
        const v = monthly.get(m) ?? 0;
        row.push(v); ytd += v;
        if (v > 0) hasData = true;
      }
      row.push(ytd);
      if (!hasData) continue;
      const xlrow = s2.addRow(row);
      formatMoneyCells(xlrow, 5, 17);
      xlrow.getCell(17).font = { bold: true };
    }
  }
  s2.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];

  // ============================================================
  // Sheet 3 — By GL × Month
  // ============================================================
  const s3 = wb.addWorksheet(`GL × Month (${year})`);
  s3.columns = [
    { header: "GL",         width: 8 },
    { header: "Description", width: 28 },
    ...MONTHS.map(m => ({ header: m, width: 12 })),
    { header: "YTD",        width: 14 },
  ];
  styleHeader(s3.getRow(1));
  let s3total = new Array(13).fill(0);
  for (const gl of glAccounts ?? []) {
    const monthly = byGlMonth.get(gl.id) ?? new Map<number, number>();
    let ytd = 0;
    const row: (string | number)[] = [gl.code, gl.description];
    for (let m = 1; m <= 12; m++) {
      const v = monthly.get(m) ?? 0;
      row.push(v); ytd += v; s3total[m - 1] += v;
    }
    row.push(ytd); s3total[12] += ytd;
    const xlrow = s3.addRow(row);
    formatMoneyCells(xlrow, 3, 15);
    xlrow.getCell(15).font = { bold: true };
  }
  const s3totalRow = s3.addRow(["", "TOTAL"].concat(s3total) as any);
  s3totalRow.font = { bold: true };
  s3totalRow.getCell(2).alignment = { horizontal: "right" };
  formatMoneyCells(s3totalRow, 3, 15);
  for (let c = 1; c <= 15; c++) {
    s3totalRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
  }
  s3.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="NuRock-Portfolio-${year}.xlsx"`,
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

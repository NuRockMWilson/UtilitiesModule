import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NAVY     = "FF164576";
const PAPER    = "FFFAFBFC";
const FLAG_RED = "FFFEE4E2";
const FLAG_GRN = "FFD1FADF";

/**
 * Year-over-year comparison report.
 *
 * One sheet per property. Each sheet has GL rows with this layout:
 *   GL  Description   <year-1> total   <year> total   $ Δ   % Δ
 *
 * Cells with > +5% are tinted red, < -5% green. Quick visual scan tells you
 * which properties are trending over budget on what category.
 *
 * Triggered via GET /api/reports/yoy?year=YYYY
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
  const priorYear = year - 1;

  const [{ data: properties }, { data: glAccounts }, { data: thisYear }, { data: lastYear }] = await Promise.all([
    supabase.from("properties").select("id, code, name, state").eq("active", true).order("state").order("code"),
    supabase.from("gl_accounts").select("id, code, description").eq("active", true).order("code"),
    supabase.from("v_property_summary").select("*").eq("year", year),
    supabase.from("v_property_summary").select("*").eq("year", priorYear),
  ]);

  if (!properties?.length) return NextResponse.json({ error: "No properties" }, { status: 404 });

  // Aggregate by (propertyId, glId) → annual total
  const byKey = (rows: any[]) => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = `${r.property_id}:${r.gl_account_id}`;
      map.set(k, (map.get(k) ?? 0) + Number(r.total_amount));
    }
    return map;
  };
  const thisYearMap = byKey(thisYear ?? []);
  const lastYearMap = byKey(lastYear ?? []);

  const wb = new ExcelJS.Workbook();
  wb.creator = "NuRock Utilities AP";
  wb.created = new Date();

  // Master overview sheet
  const overview = wb.addWorksheet(`Overview ${priorYear} → ${year}`);
  overview.columns = [
    { header: "Code",     width: 10 },
    { header: "Property", width: 32 },
    { header: "State",    width: 8 },
    { header: String(priorYear), width: 14 },
    { header: String(year),      width: 14 },
    { header: "$ Δ",      width: 14 },
    { header: "% Δ",      width: 10 },
  ];
  styleHeader(overview.getRow(1));

  for (const p of properties) {
    let prior = 0, curr = 0;
    for (const gl of glAccounts ?? []) {
      prior += lastYearMap.get(`${p.id}:${gl.id}`) ?? 0;
      curr  += thisYearMap.get(`${p.id}:${gl.id}`) ?? 0;
    }
    const delta = curr - prior;
    const pct = prior > 0 ? delta / prior : null;
    const r = overview.addRow([p.code, p.name, p.state ?? "", prior, curr, delta, pct]);
    formatMoneyCells(r, 4, 6);
    r.getCell(7).numFmt = "0.0%";
    r.getCell(7).alignment = { horizontal: "right" };
    if (pct !== null) {
      const fill = pct > 0.05 ? FLAG_RED : pct < -0.05 ? FLAG_GRN : null;
      if (fill) r.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
  }
  overview.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];

  // Per-property detail sheets
  for (const p of properties) {
    // Skip empty properties to keep workbook tidy
    let propTotalCurr = 0, propTotalPrior = 0;
    for (const gl of glAccounts ?? []) {
      propTotalCurr  += thisYearMap.get(`${p.id}:${gl.id}`) ?? 0;
      propTotalPrior += lastYearMap.get(`${p.id}:${gl.id}`) ?? 0;
    }
    if (propTotalCurr === 0 && propTotalPrior === 0) continue;

    const sheet = wb.addWorksheet(`${p.code} ${p.name}`.substring(0, 30));
    sheet.columns = [
      { header: "GL",         width: 8 },
      { header: "Description", width: 28 },
      { header: String(priorYear), width: 14 },
      { header: String(year),      width: 14 },
      { header: "$ Δ",        width: 14 },
      { header: "% Δ",        width: 10 },
    ];
    styleHeader(sheet.getRow(1));

    for (const gl of glAccounts ?? []) {
      const prior = lastYearMap.get(`${p.id}:${gl.id}`) ?? 0;
      const curr  = thisYearMap.get(`${p.id}:${gl.id}`) ?? 0;
      if (prior === 0 && curr === 0) continue;
      const delta = curr - prior;
      const pct = prior > 0 ? delta / prior : null;
      const r = sheet.addRow([gl.code, gl.description, prior, curr, delta, pct]);
      formatMoneyCells(r, 3, 5);
      r.getCell(6).numFmt = "0.0%";
      r.getCell(6).alignment = { horizontal: "right" };
      if (pct !== null) {
        const fill = pct > 0.05 ? FLAG_RED : pct < -0.05 ? FLAG_GRN : null;
        if (fill) r.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
    }
    // Property total row
    const tot = sheet.addRow(["", "TOTAL", propTotalPrior, propTotalCurr,
                              propTotalCurr - propTotalPrior,
                              propTotalPrior > 0 ? (propTotalCurr - propTotalPrior) / propTotalPrior : null]);
    tot.font = { bold: true };
    tot.getCell(2).alignment = { horizontal: "right" };
    formatMoneyCells(tot, 3, 5);
    tot.getCell(6).numFmt = "0.0%";
    tot.getCell(6).alignment = { horizontal: "right" };
    for (let c = 1; c <= 6; c++) {
      tot.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
    }
    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  }

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="NuRock-YoY-${priorYear}-vs-${year}.xlsx"`,
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

/**
 * Legacy Excel export.
 *
 * Reproduces the per-property workbook format NuRock AP has used for years
 * (Summary, Water, Fixed tabs) so auditors, asset managers, and investors
 * get exactly what they've always gotten even after the tracker moves
 * into the web app. Produced on demand via
 *   GET /api/tracker/[propertyCode]/export?year=YYYY
 */

import ExcelJS from "exceljs";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const NAVY  = "FF164576";
const TAN   = "FFB4AE92";
const PAPER = "FFFBFBF8";
const NAVY_LIGHT = "FFE7EEF6";

export interface ExportRow {
  gl_code: string;
  description: string;
  monthly: number[];   // length 12
  ytd: number;
  budget: number;
}

export interface ExportInput {
  property: { code: string; name: string; state: string };
  year: number;
  rows: ExportRow[];
  generatedAt: Date;
}

export async function buildSummaryWorkbook(input: ExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NuRock Utilities AP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Summary");

  // Title rows (mirror Sunset Pointe layout)
  ws.mergeCells("A1:Q1");
  const titleCell = ws.getCell("A1");
  titleCell.value = input.property.name;
  titleCell.font = { name: "Oswald", size: 14, bold: true, color: { argb: NAVY } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells("A2:Q2");
  ws.getCell("A2").value = `${input.year}`;
  ws.getCell("A2").font = { name: "Oswald", size: 11, color: { argb: NAVY } };

  // Header row
  const headers = ["GL AC#", "Description", ...MONTHS, "YTD Total", "", "Budget"];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { name: "Inter", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.border = thinBorder();
  });
  headerRow.height = 22;

  // Data rows
  input.rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.getCell(1).value = r.gl_code;
    row.getCell(2).value = r.description;
    r.monthly.forEach((v, i) => {
      const c = row.getCell(3 + i);
      c.value = v || null;
      c.numFmt = '$#,##0;($#,##0);-';
    });
    const ytdCell = row.getCell(15);
    ytdCell.value = r.ytd || null;
    ytdCell.numFmt = '$#,##0;($#,##0);-';
    ytdCell.font = { name: "Inter", size: 10, bold: true };
    ytdCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_LIGHT } };
    const budgetCell = row.getCell(17);
    budgetCell.value = r.budget || null;
    budgetCell.numFmt = '$#,##0;($#,##0);-';
    budgetCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_LIGHT } };

    for (let col = 1; col <= 17; col++) {
      row.getCell(col).border = thinBorder();
      row.getCell(col).alignment = { horizontal: col <= 2 ? "left" : "right" };
    }
    row.getCell(1).font = { name: "Inter", size: 10 };
  });

  // Totals row
  const totalsRowIdx = 5 + input.rows.length;
  const totalsRow = ws.getRow(totalsRowIdx);
  totalsRow.getCell(2).value = "Total Utilities";
  totalsRow.getCell(2).font = { name: "Inter", size: 10, bold: true };
  for (let m = 0; m < 12; m++) {
    const c = totalsRow.getCell(3 + m);
    const colLetter = ws.getColumn(3 + m).letter;
    c.value = { formula: `SUM(${colLetter}5:${colLetter}${totalsRowIdx - 1})` };
    c.numFmt = '$#,##0;($#,##0);-';
    c.font = { name: "Inter", size: 10, bold: true };
  }
  const ytdTotalCell = totalsRow.getCell(15);
  ytdTotalCell.value = { formula: `SUM(O5:O${totalsRowIdx - 1})` };
  ytdTotalCell.numFmt = '$#,##0;($#,##0);-';
  ytdTotalCell.font = { name: "Inter", size: 10, bold: true };
  const budgetTotalCell = totalsRow.getCell(17);
  budgetTotalCell.value = { formula: `SUM(Q5:Q${totalsRowIdx - 1})` };
  budgetTotalCell.numFmt = '$#,##0;($#,##0);-';
  budgetTotalCell.font = { name: "Inter", size: 10, bold: true };

  for (let col = 1; col <= 17; col++) {
    totalsRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC4D4E8" } };
    totalsRow.getCell(col).border = thinBorder();
    totalsRow.getCell(col).alignment = { horizontal: col <= 2 ? "left" : "right" };
  }

  // Column widths
  ws.getColumn(1).width = 10;  // GL
  ws.getColumn(2).width = 24;  // Description
  for (let c = 3; c <= 14; c++) ws.getColumn(c).width = 12;
  ws.getColumn(15).width = 14; // YTD
  ws.getColumn(16).width = 2;  // spacer
  ws.getColumn(17).width = 13; // Budget

  // Footer note
  const footRowIdx = totalsRowIdx + 2;
  ws.getCell(`A${footRowIdx}`).value =
    `Generated ${input.generatedAt.toLocaleString("en-US")} · NuRock Utilities AP`;
  ws.getCell(`A${footRowIdx}`).font = { name: "Inter", size: 8, italic: true, color: { argb: TAN } };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top:    { style: "thin", color: { argb: "FFC4D4E8" } },
    left:   { style: "thin", color: { argb: "FFC4D4E8" } },
    bottom: { style: "thin", color: { argb: "FFC4D4E8" } },
    right:  { style: "thin", color: { argb: "FFC4D4E8" } },
  };
}

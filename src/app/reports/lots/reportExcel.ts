// Target path: src/app/reports/lots/reportExcel.ts
//
// Requires the `xlsx` (SheetJS) package: npm install xlsx
//
// Export shape: one worksheet TAB per CENRO, titled "GENERATED REPORT FOR
// CENRO <name>". Columns: LOT SHEET | MUNICIPALITY | SURVEY NO | LOT NO. |
// OWNER | BARANGAY | DATE SURVEYED | SURVEYOR | AREA(SQM) | PATENT NO. |
// REMARKS. LOT SHEET / MUNICIPALITY / SURVEY NO are vertically merged
// across each sheet's lot rows (real merged cells via ws['!merges']) rather
// than repeated on every row. Each sheet ends with a merged "TOTAL:" row
// showing that sheet's area sum; each CENRO tab ends with one merged
// "OVERALL TOTAL(SQM)" row.
//
// NOTE: this uses the free/community build of SheetJS, which doesn't
// support cell styling (bold, borders, fills, alignment) when writing — so
// merges are real (Excel will treat them as merged cells) but the file
// won't be bolded/colored like the on-screen report. If you want that,
// say so and we can swap to ExcelJS instead.

import * as XLSX from "xlsx";
import { formatArea, formatDate, type CenroGroup } from "./group";

const COLUMNS = [
  "LOT SHEET",
  "MUNICIPALITY",
  "SURVEY NO",
  "LOT NO.",
  "OWNER",
  "BARANGAY",
  "DATE SURVEYED",
  "SURVEYOR",
  "AREA(SQM)",
  "PATENT NO.",
  "REMARKS",
];

// Column indices, for readability in the merge math below.
const COL_LOT_SHEET = 0;
const COL_MUNICIPALITY = 1;
const COL_SURVEY_NO = 2;
const COL_LOT_NO = 3;
const COL_SURVEYOR = 7;
const COL_AREA = 8;
const COL_REMARKS = 10;

// Excel worksheet names: max 31 chars, and can't contain \ / ? * [ ] :
// Also must be unique within the workbook.
function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "CENRO";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})`.slice(0, 31);
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function buildLotReportWorkbook(groups: CenroGroup[], label: string) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const cenroGroup of groups) {
    const rows: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];

    rows.push([`GENERATED REPORT FOR CENRO ${cenroGroup.cenro}`]);
    if (label) rows.push([`Filter: ${label}`]);
    rows.push([]);
    rows.push([...COLUMNS]);

    for (const sheet of cenroGroup.sheets) {
      const sheetStartRow = rows.length;

      sheet.lots.forEach((lot, i) => {
        rows.push([
          i === 0 ? sheet.sheetNo : "",
          i === 0 ? sheet.municipality : "",
          i === 0 ? sheet.surveyNo || "" : "",
          lot.properties.lotNo || "",
          lot.properties.owner || "",
          lot.properties.barangay || "",
          formatDate(lot.properties.dateSurveyed),
          lot.properties.surveyor || "",
          lot.properties.areaSqm != null ? Number(lot.properties.areaSqm) : "",
          lot.properties.patentNo || "",
          lot.properties.remarks || "",
        ]);
      });

      const sheetEndRow = rows.length - 1;
      if (sheetEndRow > sheetStartRow) {
        merges.push({ s: { r: sheetStartRow, c: COL_LOT_SHEET }, e: { r: sheetEndRow, c: COL_LOT_SHEET } });
        merges.push({ s: { r: sheetStartRow, c: COL_MUNICIPALITY }, e: { r: sheetEndRow, c: COL_MUNICIPALITY } });
        merges.push({ s: { r: sheetStartRow, c: COL_SURVEY_NO }, e: { r: sheetEndRow, c: COL_SURVEY_NO } });
      }

      // TOTAL row for this sheet — label merged across LOT NO. through
      // SURVEYOR, sum sits in AREA(SQM).
      const totalRow = rows.length;
      const totalRowArr: (string | number)[] = new Array(COLUMNS.length).fill("");
      totalRowArr[COL_LOT_NO] = "TOTAL:";
      totalRowArr[COL_AREA] = Number(sheet.totalArea.toFixed(2));
      rows.push(totalRowArr);
      merges.push({ s: { r: totalRow, c: COL_LOT_NO }, e: { r: totalRow, c: COL_SURVEYOR } });
    }

    // OVERALL TOTAL for the whole CENRO tab.
    const overallRow = rows.length;
    const overallRowArr: (string | number)[] = new Array(COLUMNS.length).fill("");
    overallRowArr[COL_LOT_NO] = "OVERALL TOTAL(SQM)";
    overallRowArr[COL_AREA] = Number(cenroGroup.totalArea.toFixed(2));
    rows.push(overallRowArr);
    merges.push({ s: { r: overallRow, c: COL_LOT_NO }, e: { r: overallRow, c: COL_SURVEYOR } });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!merges"] = merges;
    ws["!cols"] = [
      { wch: 16 }, // LOT SHEET
      { wch: 14 }, // MUNICIPALITY
      { wch: 14 }, // SURVEY NO
      { wch: 10 }, // LOT NO.
      { wch: 26 }, // OWNER
      { wch: 16 }, // BARANGAY
      { wch: 14 }, // DATE SURVEYED
      { wch: 20 }, // SURVEYOR
      { wch: 12 }, // AREA(SQM)
      { wch: 12 }, // PATENT NO.
      { wch: 18 }, // REMARKS
    ];

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(cenroGroup.cenro, usedNames));
  }

  if (groups.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["No lots match this filter."]]);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
  }

  const filenameLabel = label ? label.replace(/[^\w\- ]+/g, "").trim().slice(0, 40) : "";
  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filenameLabel || "lot-sheet-report"}-${ts}.xlsx`);
}
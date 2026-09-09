// Target path: src/app/reports/lots/group.ts
//
// Grouping for the lot report: CENRO -> Lot Sheet. LOT SHEET / MUNICIPALITY
// / SURVEY NO are captured once per sheet (not per lot) and rendered/merged
// down that sheet's rows; BARANGAY stays a per-lot column since a single
// lot sheet can legitimately span more than one barangay. Each sheet gets
// a TOTAL row after its lots, and each CENRO gets one OVERALL TOTAL row —
// matching the "GENERATED REPORT FOR CENRO ..." sample layout.

import type { LotFeature } from "@/lib/geo";

export interface SheetBlock {
  sheetId: number | string | null;
  sheetNo: string;
  surveyNo: string | null;
  municipality: string;
  lots: LotFeature[];
  totalArea: number;
}

export interface CenroGroup {
  cenro: string;
  sheets: SheetBlock[];
  totalLots: number;
  totalArea: number;
}

export function groupFeatures(features: LotFeature[]): CenroGroup[] {
  const cenroMap = new Map<string, CenroGroup>();

  for (const f of features) {
    const cenroName = f.properties.cenro || "Unassigned CENRO";
    const area = Number(f.properties.areaSqm) || 0;

    let cenroGroup = cenroMap.get(cenroName);
    if (!cenroGroup) {
      cenroGroup = { cenro: cenroName, sheets: [], totalLots: 0, totalArea: 0 };
      cenroMap.set(cenroName, cenroGroup);
    }
    cenroGroup.totalLots += 1;
    cenroGroup.totalArea += area;

    const sheetKey = String(f.properties.sheetId ?? f.properties.sheetNo ?? "unsheeted");
    let sheetBlock = cenroGroup.sheets.find((s) => String(s.sheetId ?? s.sheetNo) === sheetKey);
    if (!sheetBlock) {
      sheetBlock = {
        sheetId: f.properties.sheetId,
        sheetNo: f.properties.sheetNo || "—",
        surveyNo: f.properties.surveyNo,
        municipality: f.properties.municipality || "—",
        lots: [],
        totalArea: 0,
      };
      cenroGroup.sheets.push(sheetBlock);
    }
    sheetBlock.lots.push(f);
    sheetBlock.totalArea += area;
    if (!sheetBlock.surveyNo && f.properties.surveyNo) sheetBlock.surveyNo = f.properties.surveyNo;
  }

  const cenroGroups = Array.from(cenroMap.values()).sort((a, b) => a.cenro.localeCompare(b.cenro));
  for (const c of cenroGroups) {
    c.sheets.sort((a, b) => {
      const muni = a.municipality.localeCompare(b.municipality);
      return muni !== 0 ? muni : a.sheetNo.localeCompare(b.sheetNo);
    });
    for (const s of c.sheets) {
      s.lots.sort((a, b) => (a.properties.lotNo || "").localeCompare(b.properties.lotNo || ""));
    }
  }
  return cenroGroups;
}

export function formatArea(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}
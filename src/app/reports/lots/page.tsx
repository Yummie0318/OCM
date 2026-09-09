// Target path: src/app/reports/lots/page.tsx
//
// Opened in a new tab by ProjectionModal's "Generate Report" button, with
// the same cenro_ids/municipality_ids/barangay_ids/years query params it
// already builds for "Project" — so this hits /api/map/lots with the exact
// same combined facet filter that would've been applied to the map, plus
// a human-readable `label` param for the on-screen title.
//
// Layout: one flat table per CENRO ("GENERATED REPORT FOR CENRO ..."),
// LOT SHEET/MUNICIPALITY/SURVEY NO shown once per sheet via rowSpan (not
// repeated per lot), BARANGAY as a per-lot column, a TOTAL row after each
// sheet, and one OVERALL TOTAL row per CENRO — mirrors reportExcel.ts
// exactly so the printed/on-screen view and the Excel download never
// disagree on shape. See group.ts for the grouping logic itself.
//
// RESPONSIVE / BRANDING PASS:
// - Header bar wraps instead of squeezing on small screens: title row,
//   then a full-width action-button row below it on mobile.
// - The table sits in a horizontally-scrolling wrapper with a min-width,
//   so on a phone you swipe sideways instead of every column being
//   crushed unreadably.
// - Added an "OCM-A&D" brand mark + generation timestamp, shown on-screen
//   next to the label and as a proper header block on every printed page
//   (the sticky on-screen toolbar is print:hidden, so print needed its
//   own header).
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSpreadsheet, Printer, Loader2, AlertCircle } from "lucide-react";
import type { LotFeatureCollection } from "@/lib/geo";
import { groupFeatures, formatArea, formatDate } from "./group";
import { buildLotReportWorkbook } from "./reportExcel";

const FACET_KEYS = ["cenro_ids", "municipality_ids", "barangay_ids", "years"] as const;
const BRAND = "OCM-A&D";

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

const CELL = "border border-slate-300 px-2 py-1";
const CELL_HEADER = `${CELL} bg-slate-800 text-white text-left text-[9px] font-bold uppercase sm:text-[10px]`;

function formatGeneratedAt(date: Date) {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LotReportContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<LotFeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const label = searchParams.get("label") || "";

  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of FACET_KEYS) {
      const v = searchParams.get(key);
      if (v) params.set(key, v);
    }
    if (Array.from(params.keys()).length === 0) {
      setError("No filters were provided for this report. Go back and check at least one CENRO, municipality, barangay, or year.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/map/lots?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((json: LotFeatureCollection) => {
        setData(json);
        setError(null);
        setGeneratedAt(new Date());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load report data."))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const groups = useMemo(() => (data ? groupFeatures(data.features) : []), [data]);

  const grandTotals = useMemo(() => {
    const lots = groups.reduce((sum, g) => sum + g.totalLots, 0);
    const area = groups.reduce((sum, g) => sum + g.totalArea, 0);
    return { lots, area };
  }, [groups]);

  const generatedLabel = generatedAt ? formatGeneratedAt(generatedAt) : "";

  function handleExportExcel() {
    if (!data) return;
    buildLotReportWorkbook(groups, label);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-slate-500">
        <Loader2 className="animate-spin" size={18} />
        Loading report…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 px-6 text-center text-slate-600">
        <AlertCircle size={22} className="text-red-500" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* On-screen toolbar — hidden when printing */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 py-3 print:hidden sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-[14px] font-bold text-slate-900 sm:text-[15px]">Lot Sheet Report</h1>
              <span className="hidden shrink-0 rounded-full bg-slate-800 px-1.5 py-[1px] text-[9px] font-bold tracking-wide text-white sm:inline">
                {BRAND}
              </span>
            </div>
            {label && <p className="truncate text-[11px] text-slate-500 sm:text-[12px]">{label}</p>}
            {generatedLabel && (
              <p className="truncate text-[10.5px] text-slate-400">Generated from {BRAND} · {generatedLabel}</p>
            )}
          </div>

          <span className="hidden whitespace-nowrap text-[12px] tabular-nums text-slate-500 sm:inline">
            {grandTotals.lots.toLocaleString()} lots · {formatArea(grandTotals.area)} sq.m.
          </span>

          <div className="order-3 flex w-full gap-2 sm:order-none sm:w-auto">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={groups.length === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5 sm:text-[12.5px]"
            >
              <FileSpreadsheet size={14} />
              <span className="sm:hidden">Excel</span>
              <span className="hidden sm:inline">Export as Excel</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={groups.length === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5 sm:text-[12.5px]"
            >
              <Printer size={14} />
              Print
            </button>
          </div>
        </div>

        {/* Totals line for mobile, shown under the title/button rows */}
        <p className="mt-1.5 whitespace-nowrap text-[11px] tabular-nums text-slate-500 sm:hidden">
          {grandTotals.lots.toLocaleString()} lots · {formatArea(grandTotals.area)} sq.m.
        </p>
      </div>

      <div className="mx-auto max-w-[1200px] px-3 py-4 sm:px-6 sm:py-6 print:max-w-none print:px-0 print:py-0">
        {/* Print-only header block — the on-screen toolbar above is
            print:hidden, so the printed page gets its own brand + timestamp
            header instead. */}
        <div className="mb-4 hidden items-baseline justify-between border-b border-slate-300 pb-2 print:flex">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-extrabold uppercase tracking-wide text-slate-900">{BRAND}</span>
            <span className="text-[11px] text-slate-500">Lot Sheet Report</span>
            {label && <span className="text-[11px] text-slate-500">— {label}</span>}
          </div>
          {generatedLabel && <span className="text-[10px] text-slate-400">Generated {generatedLabel}</span>}
        </div>

        {groups.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">No lots match this filter.</p>
        )}

        {groups.map((cenroGroup, cIdx) => (
          <section
            key={cenroGroup.cenro}
            className={`mb-10 print:mb-0 print:break-inside-avoid ${cIdx > 0 ? "print:break-before-page" : ""}`}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
              <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-slate-900 sm:text-[14px]">
                Generated Report for CENRO {cenroGroup.cenro}
              </h2>
              {label && <span className="text-[11px] text-slate-400 print:hidden">{label}</span>}
            </div>

            {/* Horizontal-scroll wrapper: on narrow screens the table keeps
                its full column widths and the user swipes sideways, instead
                of every cell getting crushed to fit the viewport. */}
            <div className="overflow-x-auto rounded-[6px] border border-slate-200 print:overflow-visible print:rounded-none print:border-0">
              <table className="w-full min-w-[880px] border-collapse text-[10px] sm:text-[11px] print:min-w-0">
                <thead>
                  <tr>
                    {COLUMNS.map((h) => (
                      <th key={h} className={CELL_HEADER}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cenroGroup.sheets.map((sheet) => (
                    <SheetRows key={String(sheet.sheetId ?? sheet.sheetNo)} sheet={sheet} />
                  ))}
                  <tr className="bg-slate-200 font-bold text-slate-900">
                    <td colSpan={8} className={`${CELL} text-right`}>
                      OVERALL TOTAL (SQM)
                    </td>
                    <td className={`${CELL} text-right tabular-nums`}>{formatArea(cenroGroup.totalArea)}</td>
                    <td className={CELL} />
                    <td className={CELL} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p className="mt-2 text-center text-[10px] text-slate-400 print:mt-6">
          Generated from {BRAND}{generatedLabel ? ` · ${generatedLabel}` : ""}
        </p>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: legal landscape;
            margin: 12mm;
          }
        }
      `}</style>
    </div>
  );
}

function SheetRows({
  sheet,
}: {
  sheet: ReturnType<typeof groupFeatures>[number]["sheets"][number];
}) {
  return (
    <>
      {sheet.lots.map((lot, i) => (
        <tr key={String(lot.id)} className={i % 2 === 1 ? "bg-slate-50" : "bg-white"}>
          {i === 0 && (
            <>
              {/* rowSpan covers this sheet's lot rows PLUS the TOTAL row
                  right after them, so the TOTAL row doesn't need its own
                  (empty) LOT SHEET/MUNICIPALITY/SURVEY NO cells and the
                  table stays a consistent 11 columns on every row. */}
              <td className={`${CELL} font-semibold`} rowSpan={sheet.lots.length + 1}>
                {sheet.sheetNo}
              </td>
              <td className={CELL} rowSpan={sheet.lots.length + 1}>
                {sheet.municipality}
              </td>
              <td className={CELL} rowSpan={sheet.lots.length + 1}>
                {sheet.surveyNo || "—"}
              </td>
            </>
          )}
          <td className={`${CELL} font-medium`}>{lot.properties.lotNo}</td>
          <td className={CELL}>{lot.properties.owner}</td>
          <td className={CELL}>{lot.properties.barangay}</td>
          <td className={`${CELL} whitespace-nowrap`}>{formatDate(lot.properties.dateSurveyed)}</td>
          <td className={CELL}>{lot.properties.surveyor}</td>
          <td className={`${CELL} text-right tabular-nums`}>
            {lot.properties.areaSqm != null ? formatArea(Number(lot.properties.areaSqm)) : "—"}
          </td>
          <td className={CELL}>{lot.properties.patentNo || "—"}</td>
          <td className={CELL}>{lot.properties.remarks || "—"}</td>
        </tr>
      ))}
      <tr className="bg-slate-100 font-semibold text-slate-800">
        <td colSpan={5} className={`${CELL} text-right`}>
          TOTAL:
        </td>
        <td className={`${CELL} text-right tabular-nums`}>{formatArea(sheet.totalArea)}</td>
        <td className={CELL} />
        <td className={CELL} />
      </tr>
    </>
  );
}

export default function LotReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center gap-2 text-slate-500">
          <Loader2 className="animate-spin" size={18} />
          Loading report…
        </div>
      }
    >
      <LotReportContent />
    </Suspense>
  );
}
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
// THEME + PRINT PASS (this pass):
// - On screen, the page follows the sidebar theme (dark mode + accent
//   color). It reads the same localStorage keys the Toaster does
//   ("ocm-dark-mode", "ocm-accent-color") and applies the --sb-* CSS
//   variables to a wrapper, so every color below is a var(--sb-*).
// - When printing, those variables are overridden to pure black/white
//   (see the global <style> at the bottom), regardless of the on-screen
//   theme. Header cells print as bold black on white — no fills.
// - BLANK FIRST PAGE FIX: each CENRO <section> used to have
//   `print:break-inside-avoid`. A CENRO table is normally taller than one
//   page, so the browser moved the entire section to page 2 and page 1 was
//   left with only the small print header. Removed; rows avoid splitting
//   instead, and the column header repeats on each printed page.
"use client";

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { FileSpreadsheet, Printer, Loader2, AlertCircle } from "lucide-react";
import type { LotFeatureCollection } from "@/lib/geo";
import { getTheme, themeVars, uiFont } from "@/components/map/sidebarTheme";
import { groupFeatures, formatArea, formatDate } from "./group";
import { buildLotReportWorkbook } from "./reportExcel";
import { toast } from "@/components/notifications/Toaster";

const FACET_KEYS = [
  "cenro_ids",
  "municipality_ids",
  "barangay_ids",
  "years",
  "classifications",
  "prefixes",
] as const;

const BRAND = "OCM-A&D";

const COLUMNS = [
  "LOT SHEET",
  "MUNICIPALITY",
  "SURVEY NO",
  "LOT NO.",
  "OWNER",
  "BARANGAY",
  "DATE SURVEYED",
  "DATE APPROVED",
  "SURVEYOR",
  "AREA(SQM)",
  "PATENT NO.",
  "REMARKS",
];

// ---------- theme sync (same keys/event the Toaster uses) ----------
const DARK_KEY = "ocm-dark-mode";
const ACCENT_KEY = "ocm-accent-color";
const THEME_EVENT = "ocm-theme-change";

function subscribeTheme(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(THEME_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(THEME_EVENT, cb);
  };
}
function getThemeSnapshot(): string {
  try {
    const dark = window.localStorage.getItem(DARK_KEY) ?? "0";
    const accent = window.localStorage.getItem(ACCENT_KEY) ?? "";
    return `${dark}|${accent}`;
  } catch {
    return "0|";
  }
}
const getServerThemeSnapshot = () => "0|";

function useReportTheme() {
  const snap = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  return useMemo(() => {
    const [dark, accent] = snap.split("|");
    return getTheme(dark === "1", /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : undefined);
  }, [snap]);
}

// Wrapper that applies the --sb-* variables. Used for the loading, error
// and main states so all three look consistent with the app.
function ThemedShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const theme = useReportTheme();
  return (
    <div
      className={`report-root ${uiFont.className} bg-[var(--sb-bg)] text-[var(--sb-text)] ${className}`}
      style={themeVars(theme)}
    >
      {children}
    </div>
  );
}

const CELL = "border border-[var(--sb-border)] px-2 py-1 print:border-black";
const CELL_HEADER = `${CELL} bg-[var(--sb-accent)] text-[var(--sb-on-accent)] text-left text-[9px] font-bold uppercase sm:text-[10px] print:bg-white print:text-black print:border-b-2`;

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
    toast.loading("Generating report…", { id: "report-load", description: label || undefined });
    fetch(`/api/map/lots?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((json: LotFeatureCollection) => {
        setData(json);
        setError(null);
        setGeneratedAt(new Date());
        const n = json.features.length;
        if (n === 0) {
          toast.warning("Report is empty", { id: "report-load", description: "No lots match this filter." });
        } else {
          toast.success("Report generated", {
            id: "report-load",
            description: `${n.toLocaleString()} lot${n === 1 ? "" : "s"} ready to print or export.`,
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load report data.";
        setError(msg);
        toast.error("Couldn't generate report", { id: "report-load", description: msg });
      })
      .finally(() => setLoading(false));
  }, [searchParams]);

  const groups = useMemo(() => (data ? groupFeatures(data.features) : []), [data]);

  const grandTotals = useMemo(() => {
    const lots = groups.reduce((sum, g) => sum + g.totalLots, 0);
    const area = groups.reduce((sum, g) => sum + g.totalArea, 0);
    const sheets = groups.reduce((sum, g) => sum + g.sheets.length, 0);
    return { lots, area, sheets };
  }, [groups]);

  const generatedLabel = generatedAt ? formatGeneratedAt(generatedAt) : "";

  function handleExportExcel() {
    if (!data) return;
    try {
      buildLotReportWorkbook(groups, label);
      toast.success("Excel export started", { description: "Your download should begin shortly." });
    } catch (err) {
      toast.error("Export failed", {
        description: err instanceof Error ? err.message : "Couldn't build the workbook.",
      });
    }
  }

  if (loading) {
    return (
      <ThemedShell className="flex h-screen items-center justify-center gap-2 text-[var(--sb-text-faint)]">
        <Loader2 className="animate-spin" size={18} />
        Loading report…
      </ThemedShell>
    );
  }

  if (error) {
    return (
      <ThemedShell className="flex h-screen flex-col items-center justify-center gap-2 px-6 text-center text-[var(--sb-text-muted)]">
        <AlertCircle size={22} className="text-red-500" />
        <p className="text-sm font-medium">{error}</p>
      </ThemedShell>
    );
  }

  return (
    <ThemedShell className="min-h-screen print:min-h-0">
      {/* On-screen toolbar — hidden when printing */}
      <div className="sticky top-0 z-20 border-b border-[var(--sb-border)] bg-[var(--sb-bg-elevated)] px-3 py-3 print:hidden sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-[14px] font-bold text-[var(--sb-text)] sm:text-[15px]">Lot Sheet Report</h1>
              <span className="hidden shrink-0 rounded-full bg-[var(--sb-accent)] px-1.5 py-[1px] text-[9px] font-bold tracking-wide text-[var(--sb-on-accent)] sm:inline">
                {BRAND}
              </span>
            </div>
            {label && <p className="truncate text-[11px] text-[var(--sb-text-muted)] sm:text-[12px]">{label}</p>}
            {generatedLabel && (
              <p className="truncate text-[10.5px] text-[var(--sb-text-faint)]">Generated from {BRAND} · {generatedLabel}</p>
            )}
          </div>

          <span className="hidden whitespace-nowrap text-[12px] tabular-nums text-[var(--sb-text-muted)] sm:inline">
            {grandTotals.sheets.toLocaleString()} survey plan{grandTotals.sheets === 1 ? "" : "s"} with{" "}
            {grandTotals.lots.toLocaleString()} lots · {formatArea(grandTotals.area)} sq.m.
          </span>

          <div className="order-3 flex w-full gap-2 sm:order-none sm:w-auto">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={groups.length === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full border-0 bg-[var(--sb-accent)] px-3 py-2 text-[12px] font-semibold text-[var(--sb-on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5 sm:text-[12.5px]"
            >
              <FileSpreadsheet size={14} />
              <span className="sm:hidden">Excel</span>
              <span className="hidden sm:inline">Export as Excel</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={groups.length === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full border-0 bg-[var(--sb-hover)] px-3 py-2 text-[12px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5 sm:text-[12.5px]"
            >
              <Printer size={14} />
              Print
            </button>
          </div>
        </div>

        {/* Totals line for mobile, shown under the title/button rows */}
        <p className="mt-1.5 whitespace-nowrap text-[11px] tabular-nums text-[var(--sb-text-muted)] sm:hidden">
          {grandTotals.sheets.toLocaleString()} survey plan{grandTotals.sheets === 1 ? "" : "s"} with{" "}
          {grandTotals.lots.toLocaleString()} lots · {formatArea(grandTotals.area)} sq.m.
        </p>
      </div>

      <div className="mx-auto max-w-[1200px] px-3 py-4 sm:px-6 sm:py-6 print:max-w-none print:px-0 print:py-0">
        {/* Print-only header block — the on-screen toolbar above is
            print:hidden, so the printed page gets its own brand + timestamp
            header instead. */}
        <div className="mb-3 hidden items-baseline justify-between border-b border-black pb-2 text-black print:flex">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-extrabold uppercase tracking-wide">{BRAND}</span>
            <span className="text-[11px]">Lot Sheet Report</span>
            {label && <span className="text-[11px]">— {label}</span>}
          </div>
          {generatedLabel && <span className="text-[10px]">Generated {generatedLabel}</span>}
        </div>

        {groups.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--sb-text-muted)]">No lots match this filter.</p>
        )}

        {groups.map((cenroGroup, cIdx) => (
          // NOTE: no `print:break-inside-avoid` here — that was what pushed
          // the whole first section to page 2 and left page 1 blank.
          <section
            key={cenroGroup.cenro}
            className={`mb-10 print:mb-0 ${cIdx > 0 ? "print:break-before-page" : ""}`}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
              <h2 className="text-[13px] font-extrabold uppercase tracking-wide text-[var(--sb-text)] sm:text-[14px]">
                Generated Report for CENRO {cenroGroup.cenro}
              </h2>
              {label && <span className="text-[11px] text-[var(--sb-text-faint)] print:hidden">{label}</span>}
            </div>

            {/* Horizontal-scroll wrapper: on narrow screens the table keeps
                its full column widths and the user swipes sideways, instead
                of every cell getting crushed to fit the viewport. */}
            <div className="overflow-x-auto rounded-[8px] border border-[var(--sb-border)] bg-[var(--sb-bg-elevated)] print:overflow-visible print:rounded-none print:border-0">
              <table className="w-full min-w-[980px] border-collapse text-[10px] sm:text-[11px] print:min-w-0">
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
                  <tr className="bg-[var(--sb-accent-bg)] font-bold text-[var(--sb-accent-text)] print:bg-white print:text-black">
                    <td colSpan={9} className={`${CELL} text-right print:border-t-2`}>
                      OVERALL TOTAL (SQM)
                    </td>
                    <td className={`${CELL} text-right tabular-nums print:border-t-2`}>{formatArea(cenroGroup.totalArea)}</td>
                    <td className={`${CELL} print:border-t-2`} />
                    <td className={`${CELL} print:border-t-2`} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p className="mt-2 text-center text-[10px] text-[var(--sb-text-faint)] print:mt-6 print:text-black">
          Generated from {BRAND}{generatedLabel ? ` · ${generatedLabel}` : ""}
        </p>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: legal landscape;
            margin: 12mm;
          }

          html,
          body {
            background: #fff !important;
          }

          /* Force pure black & white regardless of the on-screen theme
             (including dark mode). !important is needed because the theme
             variables are set inline on the wrapper. */
          .report-root {
            --sb-bg: #fff !important;
            --sb-bg-elevated: #fff !important;
            --sb-text: #000 !important;
            --sb-text-muted: #000 !important;
            --sb-text-faint: #000 !important;
            --sb-border: #000 !important;
            --sb-hover: #fff !important;
            --sb-accent: #000 !important;
            --sb-on-accent: #000 !important;
            --sb-accent-bg: #fff !important;
            --sb-accent-text: #000 !important;
            background: #fff !important;
            color: #000 !important;
          }

          /* Repeat the column header on every printed page, and never
             split a single row across two pages. */
          thead {
            display: table-header-group;
          }
          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          /* Hide any toast that happens to be on screen while printing. */
          [aria-live="polite"] {
            display: none !important;
          }
        }
      `}</style>
    </ThemedShell>
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
        <tr
          key={String(lot.id)}
          className={
            i % 2 === 1
              ? "bg-[var(--sb-hover)] print:bg-white"
              : "bg-[var(--sb-bg-elevated)] print:bg-white"
          }
        >
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
          <td className={`${CELL} whitespace-nowrap`}>
            {formatDate(lot.properties.dateApproved) || "—"}
          </td>
          <td className={CELL}>{lot.properties.surveyor}</td>
          <td className={`${CELL} text-right tabular-nums`}>
            {lot.properties.areaSqm != null ? formatArea(Number(lot.properties.areaSqm)) : "—"}
          </td>
          <td className={CELL}>{lot.properties.patentNo || "—"}</td>
          <td className={CELL}>{lot.properties.remarks || "—"}</td>
        </tr>
      ))}
      <tr className="bg-[var(--sb-hover)] font-semibold text-[var(--sb-text)] print:bg-white print:font-bold">
        <td colSpan={6} className={`${CELL} text-right`}>
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
        <ThemedShell className="flex h-screen items-center justify-center gap-2 text-[var(--sb-text-faint)]">
          <Loader2 className="animate-spin" size={18} />
          Loading report…
        </ThemedShell>
      }
    >
      <LotReportContent />
    </Suspense>
  );
}
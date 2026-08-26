"use client";

// Target path: src/components/map/SheetPreviewModal.tsx
//
// PRINT FIXES (this pass, cumulative):
//
// 1) NOT FITTING THE PAGE: this modal was rendered inline inside
//    LotDetailPanel's own JSX tree (unlike LotPreviewModal, which uses
//    createPortal to document.body). That meant the print root's actual
//    ancestor chain included LotDetailPanel's own panel div — which has
//    overflow-hidden and a fixed height/width from page.tsx. Forcing
//    `visibility: visible` + `position: static` on the print root itself
//    does nothing to undo overflow:hidden on an ANCESTOR — the browser
//    still clipped printed content to that panel's on-screen box. Fix:
//    portal straight to document.body, same as LotPreviewModal, so there
//    are no constrained ancestors between this modal and <body> at all.
//
// 2) NOT BLACK AND WHITE: forcing text color to #000 doesn't touch fills/
//    backgrounds, and browsers strip most background colors from print
//    output by default anyway (to save ink) unless explicitly told not
//    to — the result was an inconsistent, partially-colored printout.
//    ShapePreview's own polygon colors also can't be reached from here
//    without depending on its internals. Fix: force
//    print-color-adjust: exact (so colors are preserved instead of
//    silently dropped) and then apply filter: grayscale(1) over the
//    whole print root, which converts EVERYTHING — including whatever
//    ShapePreview draws internally (SVG or canvas) — to grayscale
//    uniformly, with zero dependency on that component's internals.
//
// 3) BLANK FIRST PAGE: the previous approach used
//    `body * { visibility: hidden }` to hide everything else, then
//    un-hid this modal's subtree. `visibility: hidden` hides an element
//    but does NOT remove it from layout — it still reserves its full box
//    size. Since this modal now portals to document.body (see fix #1),
//    it sits as a direct sibling of the entire rest of the app's DOM —
//    including the app's own root, which is `h-screen` (100vh). That
//    root stayed invisible-but-still-100vh-tall, and that reserved blank
//    space printed as a literal blank first page before this modal's
//    actual content. Fix: instead of hiding everything and re-revealing
//    this subtree, directly `display: none` every OTHER direct child of
//    <body>. display:none fully removes an element from layout (zero
//    height) rather than just hiding its pixels, which is what actually
//    eliminates the blank page.

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import type { LotFeature } from "@/lib/geo";
import { lonLatToPPCS } from "@/lib/coordTransform";
import ShapePreview from "@/components/ShapePreview";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import type { SheetPreview } from "@/components/map/LotDetailPanel";

interface CoordPoint {
  x: number;
  y: number;
  station: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  sheet: SheetPreview | null;
}

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";
const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";
const PRINT_ROOT_ID = "sheet-preview-print-root";

const TH_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
  fontSize: "10px",
  letterSpacing: "0.05em",
  color: "var(--sb-text-muted)",
  borderBottom: `1px solid ${HAIRLINE}`,
};

function lotToPoints(f: LotFeature): CoordPoint[] {
  const ring = f.geometry.coordinates[0] ?? [];
  const openRing = ring.length > 1 ? ring.slice(0, -1) : ring;
  return openRing.map(([lon, lat], i) => {
    const { northing, easting } = lonLatToPPCS(lon, lat);
    return { x: easting, y: northing, station: `P${i + 1}` };
  });
}

export default function SheetPreviewModal({ open, onClose, sheet }: Props) {
  const { theme, vars } = useSidebarTheme();

  const lotsWithPoints = useMemo(() => {
    if (!sheet) return [];
    return sheet.lots.map((f) => ({ feature: f, points: lotToPoints(f) }));
  }, [sheet]);

  const overviewShapes = useMemo(
    () =>
      lotsWithPoints.map(({ feature, points }) => ({
        id: String(feature.id),
        label: feature.properties.lotNo ?? "",
        points,
        complete: true,
      })),
    [lotsWithPoints]
  );

  const totalArea = useMemo(() => {
    if (!sheet) return 0;
    return sheet.lots.reduce((sum, f) => sum + (Number(f.properties.areaSqm) || 0), 0);
  }, [sheet]);

  if (!open || !sheet || typeof document === "undefined") return null;

  return createPortal(
    <div
      id={PRINT_ROOT_ID}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
    >
      <style>{`
        @media print {
          @page {
            margin: 12mm;
            /* Let the browser pick portrait/landscape/size from the print
               dialog rather than fighting it — "auto" is what actually
               lets content fit the user's selected paper instead of
               assuming a specific size. */
            size: auto;
          }

          /*
            BLANK FIRST PAGE FIX: display:none every direct child of
            <body> EXCEPT this print root, instead of visibility:hidden
            on everything. display:none removes the element from layout
            entirely (zero height), so the app's own h-screen root no
            longer reserves a full viewport of blank vertical space before
            this modal's content. See file-top comment, fix #3.
          */
          body > *:not(#${PRINT_ROOT_ID}) {
            display: none !important;
          }

          #${PRINT_ROOT_ID} {
            display: block !important;
            position: static !important;
            visibility: visible !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }

          #${PRINT_ROOT_ID} .sheet-preview-card {
            display: block !important;
            max-width: 100% !important;
            width: 100% !important;
            margin: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
          }

          .sheet-preview-toolbar { display: none !important; }

            .sheet-preview-lot-section {
            break-inside: avoid;
            page-break-inside: avoid;
            }

          /* Percentage split, not a fixed px column — a fixed 280px left
             column doesn't reliably fit every paper size/orientation the
             user might pick in the print dialog. A % split always fits
             whatever width @page size:auto ends up giving us. */
          #${PRINT_ROOT_ID} .sheet-preview-lot-grid {
            display: grid !important;
            grid-template-columns: 34% 1fr !important;
            gap: 10px !important;
          }

          #${PRINT_ROOT_ID} .sheet-preview-coords-box {
            max-height: none !important;
            overflow: visible !important;
          }
          #${PRINT_ROOT_ID} .sheet-preview-coords-box thead th {
            position: static !important;
          }

          /*
            BLACK-AND-WHITE FIX:
            - print-color-adjust: exact stops the browser from silently
              stripping background colors/box-shadows to save ink, which
              was causing the previous inconsistent half-colored output.
            - filter: grayscale(1) on the whole root then converts
              EVERYTHING to grayscale uniformly — including ShapePreview's
              own internally-drawn polygon colors (SVG or canvas), without
              this file needing to know anything about how ShapePreview
              draws itself.
          */
          #${PRINT_ROOT_ID} {
            filter: grayscale(1) !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #${PRINT_ROOT_ID} * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          #${PRINT_ROOT_ID} h1,
          #${PRINT_ROOT_ID} h2,
          #${PRINT_ROOT_ID} h3,
          #${PRINT_ROOT_ID} h4,
          #${PRINT_ROOT_ID} p,
          #${PRINT_ROOT_ID} span,
          #${PRINT_ROOT_ID} td,
          #${PRINT_ROOT_ID} th {
            color: #000 !important;
          }

          #${PRINT_ROOT_ID} table { border-collapse: collapse !important; }
          #${PRINT_ROOT_ID} th,
          #${PRINT_ROOT_ID} td {
            border: 1px solid #999 !important;
          }
          #${PRINT_ROOT_ID} [style*="box-shadow"] {
            box-shadow: none !important;
            border: 1px solid #ccc !important;
          }

          /* Make sure the polygon preview never overflows the narrower
             printed column width — ShapePreview's own root element,
             whatever it renders as (svg/canvas/div), gets capped here. */
          #${PRINT_ROOT_ID} .sheet-preview-lot-grid > div:first-child > * {
            max-width: 100% !important;
            width: 100% !important;
          }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        className={`${uiFont.className} sheet-preview-card my-6 w-full max-w-[900px] overflow-hidden rounded-[16px] bg-[var(--sb-bg)] shadow-2xl`}
        style={vars}
      >
        {/* Toolbar — hidden entirely while printing */}
        <div
          className="sheet-preview-toolbar flex items-center justify-between gap-2 px-5 py-3.5"
          style={{ borderBottom: `1px solid ${HAIRLINE}` }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-[14.5px] font-bold text-[var(--sb-text)]">
              Sheet {sheet.sheetNo} — Preview
            </h2>
            <p className="mt-0.5 truncate text-[11.5px] text-[var(--sb-text-faint)]">
              {[sheet.municipality, sheet.province].filter(Boolean).join(", ") || "No location on file"}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-full border-0 px-3.5 py-[7px] text-[11.5px] font-semibold text-white transition-opacity duration-100 hover:opacity-90"
              style={{ background: theme.accent }}
            >
              <Printer size={13} />
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <h1 className="text-[15px] font-bold text-[var(--sb-text)]">Sheet {sheet.sheetNo}</h1>
            <p className="text-[11.5px] text-[var(--sb-text-faint)]">
              {[sheet.municipality, sheet.province].filter(Boolean).join(", ") || "No location on file"}
            </p>
            <p className="mt-1 text-[11.5px] text-[var(--sb-text-muted)]">
              {sheet.lots.length} lot{sheet.lots.length === 1 ? "" : "s"} ·{" "}
              {totalArea.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq.m. total
            </p>
          </div>

          <div className="mb-5">
            <SectionTitle>Overview — All Lots</SectionTitle>
            <div className="mt-1.5 overflow-hidden rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
              <ShapePreview
                shapes={overviewShapes}
                height={240}
                pointLabelMode="index"
                emptyMessage="No geometry for this sheet."
              />
            </div>
          </div>

          {lotsWithPoints.map(({ feature, points }) => (
            <div
              key={feature.id}
              className="sheet-preview-lot-section mb-5 pt-4"
              style={{ borderTop: `1px solid ${HAIRLINE}` }}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h3 className="text-[13.5px] font-bold text-[var(--sb-text)]">
                  Lot {feature.properties.lotNo ?? "—"}
                </h3>
                <span className="text-[11px] text-[var(--sb-text-faint)]">
                  {feature.properties.owner || "Unrecorded owner"}
                </span>
              </div>

              <div className="sheet-preview-lot-grid grid grid-cols-1 gap-4 sm:grid-cols-[280px_1fr] sm:items-start">
                <div
                  className="overflow-hidden rounded-[10px]"
                  style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
                >
                  <ShapePreview
                    shapes={[{ id: String(feature.id), label: feature.properties.lotNo ?? "", points, complete: true }]}
                    height={220}
                    pointLabelMode="index"
                    emptyMessage="No geometry for this lot."
                  />
                </div>

                <div className="min-w-0">
                  <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">
                    Technical Description ({points.length} corners)
                  </h4>
                  <SheetCoordinatesTable points={points} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">{children}</h4>;
}

function SheetCoordinatesTable({ points }: { points: CoordPoint[] }) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[10px] px-3 py-4 text-center text-[11.5px] text-[var(--sb-text-faint)]"
        style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
      >
        No coordinates available.
      </div>
    );
  }

  return (
    <div
      className="sheet-preview-coords-box max-h-[220px] overflow-auto rounded-[10px]"
      style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
    >
      <table className="w-full min-w-[260px] border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th
              className="sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] text-left font-semibold uppercase"
              style={TH_STYLE}
            >
              Station
            </th>
            <th
              className="sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] text-right font-semibold uppercase"
              style={TH_STYLE}
            >
              Northing
            </th>
            <th
              className="sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] text-right font-semibold uppercase"
              style={TH_STYLE}
            >
              Easting
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((pt, i) => (
            <tr
              key={pt.station}
              style={{
                borderTop: `1px solid ${HAIRLINE_SOFT}`,
                background: i % 2 === 1 ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)" : "transparent",
              }}
            >
              <td className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]">{pt.station}</td>
              <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">{pt.y.toFixed(2)}</td>
              <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">{pt.x.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
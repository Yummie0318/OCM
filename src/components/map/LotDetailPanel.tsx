"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { X, Eye, MapPin, ChevronDown, ChevronLeft } from "lucide-react";
import type { LotFeature } from "@/lib/geo";
import { lonLatToPPCS } from "@/lib/coordTransform";
import ShapePreview from "@/components/ShapePreview";
import LotPreviewModal, { type CoordPoint } from "@/components/map/LotPreviewModal";
import SheetPreviewModal from "@/components/map/SheetPreviewModal";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";

// A request to preview every lot on one sheet at once, instead of a
// single lot. Passed down from AttributeTable's "view sheet" button
// (see SheetsTable / SheetPreviewRequest in AttributeTable.tsx) via
// page.tsx. Exported so SheetPreviewModal.tsx can import the same shape
// instead of duplicating it.
export interface SheetPreview {
  sheetNo: string;
  province: string | null;
  municipality: string | null;
  lots: LotFeature[];
}

interface Props {
  feature: LotFeature | null;
  /**
   * A whole-sheet preview to show instead of a single lot. Only rendered
   * when `feature` is null — a single-lot selection always takes
   * priority, so clicking a lot (on the map, in a lots table) naturally
   * "wins" over a sheet preview that's still technically active
   * underneath it.
   */
  sheetPreview?: SheetPreview | null;
  /** Called when the user clicks a lot inside the sheet-preview list, to switch to that lot's own single-lot view. */
  onSelectLot?: (feature: LotFeature) => void;
  /**
   * Called when the user wants to go back from a single lot's detail view
   * to the sheet preview it was opened from (see the "Back to Sheet"
   * button rendered below, in the single-lot header). Only rendered when
   * `cameFromSheet` is true — i.e. there's actually a live sheet preview
   * underneath containing this lot to go back to. The parent is expected
   * to clear its own "selected feature" state without touching
   * `sheetPreview`, which naturally flips the panel back to sheet mode
   * (see `sheetMode` below) — same mechanism that lets clicking a lot
   * inside the sheet list swap INTO single-lot mode in the first place.
   */
  onBackToSheet?: () => void;
  onClose: () => void;
  /** Current panel width in px. Owned by the parent (see page.tsx). Ignored on mobile. */
  width: number;
  /** Whether the panel is currently being dragged wider/narrower. Ignored on mobile. */
  isResizing?: boolean;
  /** Mouse/touch-down handler for the left-edge drag handle; parent does the rest. Ignored on mobile. */
  onStartResize?: (e: React.MouseEvent | React.TouchEvent) => void;
  /** True below the app's mobile breakpoint — switches to the drawer layout. */
  isMobile?: boolean;
}

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";
const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

const TH_STYLE: CSSProperties = {
  background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
  fontSize: "10px",
  letterSpacing: "0.05em",
  color: "var(--sb-text-muted)",
  borderBottom: `1px solid ${HAIRLINE}`,
};

// Turns one lot's outer ring into PPCS coordinate points — shared by the
// single-lot path, the sheet-list "expand for coordinates" path, and
// SheetPreviewModal, so every mode computes coordinates identically.
function lotToPoints(f: LotFeature): CoordPoint[] {
  const ring = f.geometry.coordinates[0] ?? [];
  const openRing = ring.length > 1 ? ring.slice(0, -1) : ring;
  return openRing.map(([lon, lat], i) => {
    const { northing, easting } = lonLatToPPCS(lon, lat);
    return { x: easting, y: northing, station: `P${i + 1}` };
  });
}

export default function LotDetailPanel({
  feature,
  sheetPreview = null,
  onSelectLot,
  onBackToSheet,
  onClose,
  width,
  isResizing,
  onStartResize,
  isMobile = false,
}: Props) {
  const { theme, vars } = useSidebarTheme();
  const [previewOpen, setPreviewOpen] = useState(false);
  // Sheet-mode "Preview & Print" modal — separate from `previewOpen`
  // above (single-lot preview) so the two never fight over the same
  // piece of state.
  const [sheetPrintOpen, setSheetPrintOpen] = useState(false);

  // Keeps the last-shown feature/sheet around after they go back to null
  // so the mobile drawer has something to render while it slides shut,
  // instead of going blank mid-animation. Harmless no-op on desktop.
  const [displayFeature, setDisplayFeature] = useState<LotFeature | null>(feature);
  useEffect(() => {
    if (feature) setDisplayFeature(feature);
  }, [feature]);

  const [displaySheetPreview, setDisplaySheetPreview] = useState<SheetPreview | null>(sheetPreview);
  useEffect(() => {
    if (sheetPreview) setDisplaySheetPreview(sheetPreview);
  }, [sheetPreview]);

  const isOpenMobile = feature != null || sheetPreview != null;
  const activeFeature = isMobile ? displayFeature : feature;
  const activeSheetPreview = isMobile ? displaySheetPreview : sheetPreview;

  // A single lot always wins over a sheet preview that might still be
  // "live" underneath it — this is what lets clicking a lot inside the
  // sheet list (or on the map, or in a lots table) transparently swap the
  // panel from sheet mode to single-lot mode without anything having to
  // explicitly clear sheetPreview first.
  const sheetMode = !activeFeature && !!activeSheetPreview;

  // True only when we're showing a single lot AND that lot actually
  // belongs to a sheet preview that's still alive underneath it. This is
  // what lets us offer a "Back to Sheet" affordance instead of only a
  // full close — going back just means clearing the selected feature
  // (see onBackToSheet's own doc comment above), since `sheetMode` above
  // will then naturally take over once `activeFeature` is null again.
  const cameFromSheet =
    !sheetMode &&
    !!activeFeature &&
    !!activeSheetPreview &&
    activeSheetPreview.lots.some((l) => String(l.id) === String(activeFeature.id));

  // Closing the sheet-print modal whenever the sheet itself changes, so
  // switching from one sheet's Preview button straight to another's
  // never leaves stale content open underneath.
  useEffect(() => {
    setSheetPrintOpen(false);
  }, [activeSheetPreview?.sheetNo]);

  const points = useMemo<CoordPoint[]>(() => {
    if (!activeFeature) return [];
    return lotToPoints(activeFeature);
  }, [activeFeature]);

  const shapes = useMemo(() => {
    if (!activeFeature) return [];
    return [
      {
        id: String(activeFeature.id),
        label: activeFeature.properties.lotNo ?? "",
        points,
        complete: true,
      },
    ];
  }, [activeFeature, points]);

  // One shape per lot on the sheet, all drawn together — ShapePreview
  // already accepts an array of shapes, so a multi-lot overlay needs no
  // changes there, just more entries.
  const sheetShapes = useMemo(() => {
    if (!activeSheetPreview) return [];
    return activeSheetPreview.lots.map((f) => ({
      id: String(f.id),
      label: f.properties.lotNo ?? "",
      points: lotToPoints(f),
      complete: true,
    }));
  }, [activeSheetPreview]);

  const sheetTotalArea = useMemo(() => {
    if (!activeSheetPreview) return 0;
    return activeSheetPreview.lots.reduce((sum, f) => sum + (Number(f.properties.areaSqm) || 0), 0);
  }, [activeSheetPreview]);

  if (!activeFeature && !activeSheetPreview) return null;

  const p = activeFeature?.properties;

  const panel = (
    <div
      className={`${uiFont.className} relative flex h-full flex-col overflow-hidden bg-[var(--sb-bg)] antialiased ${
        isMobile ? "w-[min(92vw,420px)]" : "max-w-[92vw]"
      }`}
      style={{
        ...vars,
        width: isMobile ? undefined : width,
        boxShadow: theme.shadow,
        borderColor: "var(--sb-border)",
        borderLeftWidth: 1,
        borderLeftStyle: "solid",
        transition: isResizing ? "none" : "width 0.15s ease",
      }}
    >
      {!isMobile && onStartResize && (
        <div
          onMouseDown={onStartResize}
          onTouchStart={onStartResize}
          title="Drag to resize"
          className="group absolute top-0 z-20 h-full w-2.5 cursor-col-resize"
          style={{ left: -5, touchAction: "none" }}
        >
          <div
            className="mx-auto h-full w-[2px] transition-colors"
            style={{ background: isResizing ? theme.accent : "transparent" }}
          />
        </div>
      )}

      {/* Header */}
      <div
        className="flex flex-shrink-0 items-start justify-between gap-2 px-4 py-3"
        style={{ borderBottom: `1px solid ${HAIRLINE}` }}
      >
        <div className="min-w-0">
          {sheetMode ? (
            <>
              <h3 className="truncate text-[14px] font-bold text-[var(--sb-text)]">
                Sheet {activeSheetPreview!.sheetNo}
              </h3>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--sb-text-faint)]">
                {[activeSheetPreview!.municipality, activeSheetPreview!.province].filter(Boolean).join(", ") ||
                  "No location on file"}
              </p>
            </>
          ) : (
            <>
              {/* "Back to Sheet" — only shown when this lot was reached
                  via a sheet preview that's still live underneath it (see
                  `cameFromSheet` above). Clicking it hands control back to
                  the parent via onBackToSheet, which is expected to clear
                  just the selected feature and leave sheetPreview alone. */}
              {cameFromSheet && onBackToSheet && (
                <button
                  type="button"
                  onClick={onBackToSheet}
                  className="mb-1 flex items-center gap-0.5 rounded-full border-0 bg-transparent p-0 text-[11px] font-semibold transition-opacity duration-100 hover:opacity-70"
                  style={{ color: theme.accent }}
                >
                  <ChevronLeft size={12} />
                  Back to Sheet {activeSheetPreview!.sheetNo}
                </button>
              )}
              <h3 className="truncate text-[14px] font-bold text-[var(--sb-text)]">Lot {p?.lotNo ?? "—"}</h3>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--sb-text-faint)]">
                {[p?.barangay, p?.municipality, p?.province].filter(Boolean).join(", ") || "No location on file"}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sheetMode ? (
          <>
            {/* Sheet summary + actions */}
            <div className="flex flex-col gap-2.5 px-4 pt-3">
              <div className="text-[12.5px] text-[var(--sb-text-muted)]">
                {activeSheetPreview!.lots.length} lot{activeSheetPreview!.lots.length === 1 ? "" : "s"} ·{" "}
                {sheetTotalArea.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq.m. total
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <ActionButton
                  icon={<Eye size={12} />}
                  label="Preview & Print"
                  onClick={() => setSheetPrintOpen(true)}
                  accent={theme.accent}
                  primary
                />
              </div>
            </div>

            {/* All lots overlaid in one preview */}
            <div className="px-4 pt-3.5">
              <SectionLabel>All Lots on This Sheet</SectionLabel>
              <div
                className="mt-1.5 overflow-hidden rounded-[10px]"
                style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
              >
                <ShapePreview
                  shapes={sheetShapes}
                  height={220}
                  pointLabelMode="index"
                  emptyMessage="No geometry for this sheet."
                />
              </div>
            </div>

            {/* Per-lot list — clicking the lot itself switches the panel
                to that lot's own single-lot view (full coordinates, etc)
                via onSelectLot. The chevron on the right is a SEPARATE
                control (stopPropagation) that just expands/collapses an
                inline coordinates table for that lot in place — it never
                navigates anywhere. */}
            <div className="px-4 pb-4 pt-3.5">
              <SectionLabel>Lots ({activeSheetPreview!.lots.length})</SectionLabel>
              <SheetLotsList lots={activeSheetPreview!.lots} onSelectLot={onSelectLot} />
            </div>
          </>
        ) : (
          <>
            {/* Owner + actions */}
            <div className="flex flex-col gap-2.5 px-4 pt-3">
              <div className="text-[12.5px] text-[var(--sb-text-muted)]">{p?.owner || "Unrecorded owner"}</div>

              <div className="flex flex-wrap items-center gap-1.5">
                <ActionButton
                  icon={<Eye size={12} />}
                  label="Preview"
                  onClick={() => setPreviewOpen(true)}
                  accent={theme.accent}
                  primary
                />
              </div>
            </div>

            {/* Polygon preview */}
            <div className="px-4 pt-3.5">
              <SectionLabel>Polygon</SectionLabel>
              <div
                className="mt-1.5 overflow-hidden rounded-[10px]"
                style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
              >
                <ShapePreview
                  shapes={shapes}
                  height={220}
                  pointLabelMode="index"
                  emptyMessage="No geometry for this lot."
                />
              </div>
            </div>

            {/* Inline coordinates table */}
            <div className="px-4 pb-4 pt-3.5">
              <SectionLabel>Coordinates ({points.length})</SectionLabel>
              <CoordinatesTable points={points} />
            </div>
          </>
        )}
      </div>

      {!sheetMode && activeFeature && (
        <LotPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          feature={activeFeature}
          points={points}
          shapes={shapes}
        />
      )}

      {sheetMode && activeSheetPreview && (
        <SheetPreviewModal
          open={sheetPrintOpen}
          onClose={() => setSheetPrintOpen(false)}
          sheet={activeSheetPreview}
        />
      )}
    </div>
  );

  if (!isMobile) {
    return <div className="absolute inset-y-0 right-0 z-[15]">{panel}</div>;
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-[45] transition-opacity duration-200"
        style={{
          background: theme.overlayBg,
          opacity: isOpenMobile ? 1 : 0,
          pointerEvents: isOpenMobile ? "auto" : "none",
        }}
      />
      <div
        className="fixed right-0 top-0 z-[50] h-full transition-transform duration-200 ease-out"
        style={{ transform: isOpenMobile ? "translateX(0)" : "translateX(100%)" }}
      >
        {panel}
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">{children}</h4>;
}

function ActionButton({
  icon,
  label,
  onClick,
  primary,
  accent,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border-0 px-3 py-[6px] text-[11.5px] font-semibold transition-colors duration-100 ${
        primary ? "text-white hover:opacity-90" : "bg-[var(--sb-hover)] text-[var(--sb-text)] hover:bg-[var(--sb-border)]"
      }`}
      style={primary ? { background: accent } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

// Scrollable list of every lot on the sheet. Each row has two independent
// interactions:
//   - Clicking the lot's own content (pin icon / name / owner / area)
//     calls onSelectLot to jump into that lot's own single-lot detail
//     view (full-size polygon + Preview action).
//   - Clicking the chevron on the far right toggles an inline coordinates
//     table for that lot, in place, without navigating anywhere —
//     stopPropagation keeps it fully independent of the row's own click.
function SheetLotsList({ lots, onSelectLot }: { lots: LotFeature[]; onSelectLot?: (feature: LotFeature) => void }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (lots.length === 0) {
    return (
      <div
        className="mt-1.5 rounded-[10px] px-3 py-4 text-center text-[11.5px] text-[var(--sb-text-faint)]"
        style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
      >
        No lots on this sheet.
      </div>
    );
  }

  return (
    <div className="mt-1.5 max-h-[340px] overflow-auto rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
      {lots.map((f, i) => {
        const id = String(f.id);
        const expanded = expandedIds.has(id);
        return (
          <div
            key={f.id}
            style={{
              borderTop: i === 0 ? "none" : `1px solid ${HAIRLINE_SOFT}`,
              background: i % 2 === 1 ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)" : "transparent",
            }}
          >
            <div className="flex w-full items-center gap-2 px-2.5 py-[7px]">
              <button
                type="button"
                onClick={() => onSelectLot?.(f)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left transition-opacity duration-100 hover:opacity-75"
              >
                <MapPin size={12} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-[var(--sb-text)]">
                    Lot {f.properties.lotNo ?? "—"}
                  </span>
                  <span className="block truncate text-[10.5px] text-[var(--sb-text-faint)]">
                    {f.properties.owner || "Unrecorded owner"}
                  </span>
                </span>
              </button>

              <span className="flex-shrink-0 text-[10.5px] tabular-nums text-[var(--sb-text-faint)]">
                {f.properties.areaSqm != null ? `${f.properties.areaSqm} sq.m.` : "—"}
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(id);
                }}
                aria-label={expanded ? "Hide coordinates" : "Show coordinates"}
                aria-expanded={expanded}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-faint)] transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
              >
                <ChevronDown
                  size={14}
                  className="transition-transform duration-150"
                  style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>
            </div>

            {expanded && (
              <div className="px-2.5 pb-2.5">
                <CoordinatesTable points={lotToPoints(f)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CoordinatesTable({ points }: { points: CoordPoint[] }) {
  if (points.length === 0) {
    return (
      <div
        className="mt-1.5 rounded-[10px] px-3 py-4 text-center text-[11.5px] text-[var(--sb-text-faint)]"
        style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}
      >
        No coordinates available.
      </div>
    );
  }

  return (
    <div className="mt-1.5 max-h-[260px] overflow-auto rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
      <table className="w-full min-w-[260px] border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] text-left font-semibold uppercase" style={TH_STYLE}>
              Station
            </th>
            <th className="sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] text-right font-semibold uppercase" style={TH_STYLE}>
              Northing
            </th>
            <th className="sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] text-right font-semibold uppercase" style={TH_STYLE}>
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
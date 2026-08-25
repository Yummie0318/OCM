"use client";

// Target path: src/components/map/LotDetailPanel.tsx
//
// MOBILE DRAWER (this pass): on phones (`isMobile`, driven by the same
// MOBILE_BREAKPOINT/matchMedia check the parent already uses for the
// sidebar) the panel no longer renders as a resizable slice pinned to the
// map's right edge — it becomes a fixed-position drawer that slides in
// from the right with a tap-to-dismiss backdrop, matching the treatment
// the sidebar already gets on mobile in page.tsx. Width is a fixed
// `min(92vw, 420px)` — no drag-resize, there isn't room for that gesture
// on a phone, so the handle isn't rendered at all in this mode.
//
// To animate the close transition smoothly (the parent nulls out
// `feature` immediately on close), the panel keeps its own
// `displayFeature` — the last non-null feature — so content stays visible
// while the drawer slides out instead of popping blank mid-animation.
// Desktop behavior (resizable panel pinned to the map's right edge) is
// completely unchanged; it still unmounts immediately on close as before.
//
// Also: the resize handle now listens for touchstart too (previously
// mouse-only), so dragging it works on touch-capable desktop/tablet
// devices — the parent's window-level move/end listeners already support
// touch (see page.tsx), this component just wasn't wiring the start event.
//
// (Earlier passes: themed via useSidebarTheme(); CoordinatesModal
// replaced with an inline scrollable coordinates table; "Print / Export"
// replaced with "Preview" opening <LotPreviewModal>; resizable width
// owned by the parent, see MapViewerPageInner in page.tsx.)

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { X, Eye } from "lucide-react";
import type { LotFeature } from "@/lib/geo";
import { lonLatToPPCS } from "@/lib/coordTransform";
import ShapePreview from "@/components/ShapePreview";
import LotPreviewModal, { type CoordPoint } from "@/components/map/LotPreviewModal";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";

interface Props {
  feature: LotFeature | null;
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

export default function LotDetailPanel({
  feature,
  onClose,
  width,
  isResizing,
  onStartResize,
  isMobile = false,
}: Props) {
  const { theme, vars } = useSidebarTheme();
  const [previewOpen, setPreviewOpen] = useState(false);

  // Keeps the last-shown feature around after `feature` goes back to null
  // so the mobile drawer has something to render while it slides shut,
  // instead of going blank mid-animation. Harmless no-op on desktop.
  const [displayFeature, setDisplayFeature] = useState<LotFeature | null>(feature);
  useEffect(() => {
    if (feature) setDisplayFeature(feature);
  }, [feature]);

  const isOpenMobile = feature != null;
  const activeFeature = isMobile ? displayFeature : feature;

  const points = useMemo<CoordPoint[]>(() => {
    if (!activeFeature) return [];
    const ring = activeFeature.geometry.coordinates[0] ?? [];
    // Outer ring repeats the first point as the last — drop the duplicate.
    const openRing = ring.length > 1 ? ring.slice(0, -1) : ring;
    return openRing.map(([lon, lat], i) => {
      const { northing, easting } = lonLatToPPCS(lon, lat);
      return { x: easting, y: northing, station: `P${i + 1}` };
    });
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

  if (!activeFeature) return null;
  const p = activeFeature.properties;

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
      {/* Drag handle — desktop only. There's no room (or need) to
          drag-resize a fixed-width mobile drawer. */}
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
          <h3 className="truncate text-[14px] font-bold text-[var(--sb-text)]">Lot {p.lotNo ?? "—"}</h3>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--sb-text-faint)]">
            {[p.barangay, p.municipality, p.province].filter(Boolean).join(", ") || "No location on file"}
          </p>
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
        {/* Owner + actions */}
        <div className="flex flex-col gap-2.5 px-4 pt-3">
          <div className="text-[12.5px] text-[var(--sb-text-muted)]">{p.owner || "Unrecorded owner"}</div>

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
          <div className="mt-1.5 overflow-hidden rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <ShapePreview
              shapes={shapes}
              height={220}
              pointLabelMode="index"
              emptyMessage="No geometry for this lot."
            />
          </div>
        </div>

        {/* Inline coordinates table — replaces the old modal */}
        <div className="px-4 pb-4 pt-3.5">
          <SectionLabel>Coordinates ({points.length})</SectionLabel>
          <CoordinatesTable points={points} />
        </div>
      </div>

      <LotPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        feature={activeFeature}
        points={points}
        shapes={shapes}
      />
    </div>
  );

  if (!isMobile) {
    return (
      <div className="absolute inset-y-0 right-0 z-[15]">
        {panel}
      </div>
    );
  }

  // Mobile: fixed-position drawer + tap-to-dismiss backdrop, same pattern
  // as the sidebar's mobile treatment in page.tsx. Sits above the sidebar
  // drawer/hamburger (z-30/z-35/z-25) but below LotPreviewModal (z-60), so
  // opening a preview from within the drawer still stacks correctly.
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
  return (
    <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">{children}</h4>
  );
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
        primary
          ? "text-white hover:opacity-90"
          : "bg-[var(--sb-hover)] text-[var(--sb-text)] hover:bg-[var(--sb-border)]"
      }`}
      style={primary ? { background: accent } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

// Responsive, Apple-style mini table — horizontally scrollable so it never
// breaks the panel's layout regardless of how narrow it's resized down to.
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
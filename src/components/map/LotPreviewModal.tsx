"use client";

// Target path: src/components/map/LotPreviewModal.tsx
//
// New component. Replaces the old direct "Print / Export" action in
// LotDetailPanel.tsx with a preview step: this modal shows the polygon
// (via the same <ShapePreview>) and the full coordinates table together,
// so the user can confirm the lot looks right *before* printing, rather
// than exporting blind. The actual print/export call
// (exportLotAsPrintable) now lives on this modal's "Print" button instead
// of on the panel.
//
// Themed to match Sidebar/AttributeTable: reads the shared --sb-* tokens
// via useSidebarTheme(), so it re-skins with the rest of the app when dark
// mode is toggled. Portaled to <body> (same pattern as Sidebar's Tooltip)
// so it always paints above the map/sidebar/table regardless of any
// ancestor's overflow/z-index.
//
// Layout is responsive: the coordinates table scrolls horizontally on
// narrow viewports instead of squeezing columns or overflowing the modal.

import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import type { LotFeature } from "@/lib/geo";
import { exportLotAsPrintable } from "@/lib/exportLot";
import ShapePreview from "@/components/ShapePreview";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";

export interface CoordPoint {
  x: number;
  y: number;
  station: string;
}

interface ShapeForPreview {
  id: string;
  label: string;
  points: CoordPoint[];
  complete: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  feature: LotFeature | null;
  points: CoordPoint[];
  shapes: ShapeForPreview[];
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

export default function LotPreviewModal({ open, onClose, feature, points, shapes }: Props) {
  const { theme, vars } = useSidebarTheme();

  // Escape-to-close, same pattern you'd expect from any modal in this app.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !feature || typeof document === "undefined") return null;
  const p = feature.properties;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: theme.overlayBg }}
      onClick={onClose}
    >
      <div
        className={`${uiFont.className} flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[16px] bg-[var(--sb-bg-elevated)] antialiased`}
        style={{ ...vars, boxShadow: theme.shadow }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-start justify-between gap-2 px-5 py-3.5"
          style={{ borderBottom: `1px solid ${HAIRLINE}` }}
        >
          <div className="min-w-0">
            <h3 className="truncate text-[14.5px] font-bold text-[var(--sb-text)]">Lot {p.lotNo ?? "—"} — Preview</h3>
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

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="overflow-hidden rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <ShapePreview
              shapes={shapes}
              height={280}
              pointLabelMode="index"
              emptyMessage="No geometry for this lot."
            />
          </div>

          <h4 className="mb-1.5 mt-4 text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">
            Technical Description ({points.length} corners)
          </h4>
          <div className="overflow-x-auto rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
            <table className="w-full min-w-[320px] border-collapse text-[11.5px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap px-2.5 py-[7px] text-left font-semibold uppercase" style={TH_STYLE}>
                    Station
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-[7px] text-right font-semibold uppercase" style={TH_STYLE}>
                    Northing
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-[7px] text-right font-semibold uppercase" style={TH_STYLE}>
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
                      background:
                        i % 2 === 1 ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)" : "transparent",
                    }}
                  >
                    <td className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]">{pt.station}</td>
                    <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
                      {pt.y.toFixed(2)}
                    </td>
                    <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
                      {pt.x.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {points.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2.5 py-4 text-center text-[var(--sb-text-faint)]">
                      No coordinates available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex flex-shrink-0 items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: `1px solid ${HAIRLINE}` }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border-0 bg-[var(--sb-hover)] px-3.5 py-[7px] text-[11.5px] font-semibold text-[var(--sb-text)] transition-colors duration-100 hover:bg-[var(--sb-border)]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => exportLotAsPrintable(feature, points)}
            className="flex items-center gap-1.5 rounded-full border-0 px-3.5 py-[7px] text-[11.5px] font-semibold text-white transition-opacity duration-100 hover:opacity-90"
            style={{ background: theme.accent }}
          >
            <Printer size={13} />
            Print
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
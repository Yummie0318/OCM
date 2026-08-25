"use client";

import { useMemo } from "react";
import type { LocalPoint } from "@/lib/computeLots";

export interface PreviewShape {
  id: string;
  label: string;
  points: LocalPoint[];
  complete: boolean; // true = 3+ corners -> drawn as filled polygon; false = drawn as open dashed line
}

const PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#ca8a04"];

interface Props {
  shapes: PreviewShape[];
  height?: number;
  emptyMessage?: string;
  /**
   * If provided, a "View on map" button is overlaid on the preview.
   * ShapePreview only draws local (unprojected) coordinates, so it has no
   * way to open a real basemap itself — the parent (which has access to
   * ControlPoint/computeLot) supplies this handler to open its own modal.
   */
  onViewMap?: () => void;
  /** Disables/hides the map button even if onViewMap is passed (e.g. lot isn't complete yet). */
  mapDisabled?: boolean;
  /** When true, prints each vertex's northing/easting (from point.y/point.x) next to it. */
  showCoordinateLabels?: boolean;
  /**
   * "coords" = full N/E text box per vertex (same as showCoordinateLabels).
   * "index"  = small numbered badge (1, 2, 3...) per vertex instead — use
   *            this when coordinates are shown elsewhere (e.g. a modal)
   *            and the shape just needs to show which corner is which.
   * Defaults to "coords" when showCoordinateLabels is true, otherwise "none".
   */
  pointLabelMode?: "coords" | "index";
}

const PADDING_RATIO = 0.12;

export default function ShapePreview({
  shapes,
  height = 420,
  emptyMessage,
  onViewMap,
  mapDisabled,
  showCoordinateLabels,
  pointLabelMode,
}: Props) {
  const viewW = 1000;
  const viewH = 1000;

  const effectiveLabelMode: "coords" | "index" | "none" =
    pointLabelMode ?? (showCoordinateLabels ? "coords" : "none");

  const { screenShapes, hasAny } = useMemo(() => {
    const allPoints = shapes.flatMap((s) => s.points);
    if (allPoints.length === 0) return { screenShapes: [], hasAny: false };

    let xmin = Infinity,
      xmax = -Infinity,
      ymin = Infinity,
      ymax = -Infinity;
    for (const p of allPoints) {
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }

    const spanX = xmax - xmin || 1;
    const spanY = ymax - ymin || 1;
    const span = Math.max(spanX, spanY);
    const padding = span * PADDING_RATIO;

    const cx = (xmin + xmax) / 2;
    const cy = (ymin + ymax) / 2;
    const half = span / 2 + padding;

    const left = cx - half;
    const top = cy - half;
    const scale = viewW / (half * 2);

    function toScreen(p: LocalPoint) {
      return {
        sx: (p.x - left) * scale,
        sy: viewH - (p.y - top) * scale,
      };
    }

    const screenShapes = shapes.map((s) => ({
      ...s,
      screen: s.points.map(toScreen),
    }));

    return { screenShapes, hasAny: true };
  }, [shapes]);

  const showMapButton = Boolean(onViewMap) && hasAny && !mapDisabled;

  if (!hasAny) {
    return (
      <div
        className="flex items-center justify-center rounded-[10px] border border-dashed text-[11.5px] text-[var(--sb-text-faint)]"
        style={{ height, borderColor: "var(--sb-border)", background: "var(--sb-bg)" }}
      >
        {emptyMessage || "Add corners to preview"}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[10px]" style={{ background: "#fff" }}>
      {showMapButton && (
        <button
          type="button"
          onClick={onViewMap}
          title="Preview this shape on a basemap"
          className="absolute right-2 top-2 z-10 rounded-full border-0 px-2.5 py-1 text-[10.5px] font-semibold text-white shadow transition-opacity hover:opacity-90"
          style={{ background: "var(--sb-accent)" }}
        >
          View on map
        </button>
      )}

      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        style={{ height, width: "100%" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {screenShapes.map((s, idx) => {
          const color = PALETTE[idx % PALETTE.length];
          const pts = s.screen;

          if (s.complete) {
            const d = pts.map((p) => `${p.sx},${p.sy}`).join(" ");
            return (
              <g key={s.id}>
                <polygon points={d} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={3} />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.sx} cy={p.sy} r={5} fill={color} />
                ))}
                {effectiveLabelMode === "coords" &&
                  pts.map((p, i) => {
                    const src = s.points[i];
                    const nText = `N ${src.y.toFixed(2)}`;
                    const eText = `E ${src.x.toFixed(2)}`;
                    const labelW = Math.max(nText.length, eText.length) * 9 + 12;
                    return (
                      <g key={`lbl-${i}`}>
                        <rect
                          x={p.sx + 10}
                          y={p.sy - 34}
                          width={labelW}
                          height={36}
                          rx={4}
                          fill="white"
                          fillOpacity={0.85}
                          stroke={color}
                          strokeWidth={1}
                        />
                        <text x={p.sx + 16} y={p.sy - 18} fontSize={16} fontWeight={600} fill="#111">
                          {nText}
                        </text>
                        <text x={p.sx + 16} y={p.sy - 4} fontSize={16} fontWeight={600} fill="#111">
                          {eText}
                        </text>
                      </g>
                    );
                  })}
                {effectiveLabelMode === "index" &&
                  pts.map((p, i) => (
                    <g key={`num-${i}`}>
                      <circle cx={p.sx} cy={p.sy - 16} r={11} fill="white" stroke={color} strokeWidth={2} />
                      <text x={p.sx} y={p.sy - 12} textAnchor="middle" fontSize={13} fontWeight={700} fill={color}>
                        {i + 1}
                      </text>
                    </g>
                  ))}
                <text
                  x={pts.reduce((a, p) => a + p.sx, 0) / pts.length}
                  y={pts.reduce((a, p) => a + p.sy, 0) / pts.length}
                  textAnchor="middle"
                  fontSize={22}
                  fill="#111"
                  fontWeight={600}
                >
                  {s.label}
                </text>
              </g>
            );
          }

          const d = pts.map((p) => `${p.sx},${p.sy}`).join(" ");
          return (
            <g key={s.id}>
              {pts.length >= 2 && (
                <polyline points={d} fill="none" stroke={color} strokeWidth={3} strokeDasharray="8 6" />
              )}
              {pts.map((p, i) => (
                <circle key={i} cx={p.sx} cy={p.sy} r={5} fill={color} />
              ))}
              {effectiveLabelMode === "coords" &&
                pts.map((p, i) => {
                  const src = s.points[i];
                  const nText = `N ${src.y.toFixed(2)}`;
                  const eText = `E ${src.x.toFixed(2)}`;
                  const labelW = Math.max(nText.length, eText.length) * 9 + 12;
                  return (
                    <g key={`lbl-${i}`}>
                      <rect
                        x={p.sx + 10}
                        y={p.sy - 34}
                        width={labelW}
                        height={36}
                        rx={4}
                        fill="white"
                        fillOpacity={0.85}
                        stroke={color}
                        strokeWidth={1}
                      />
                      <text x={p.sx + 16} y={p.sy - 18} fontSize={16} fontWeight={600} fill="#111">
                        {nText}
                      </text>
                      <text x={p.sx + 16} y={p.sy - 4} fontSize={16} fontWeight={600} fill="#111">
                        {eText}
                      </text>
                    </g>
                  );
                })}
              {effectiveLabelMode === "index" &&
                pts.map((p, i) => (
                  <g key={`num-${i}`}>
                    <circle cx={p.sx} cy={p.sy - 16} r={11} fill="white" stroke={color} strokeWidth={2} />
                    <text x={p.sx} y={p.sy - 12} textAnchor="middle" fontSize={13} fontWeight={700} fill={color}>
                      {i + 1}
                    </text>
                  </g>
                ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
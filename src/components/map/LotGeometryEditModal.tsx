"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import ShapePreview, { type PreviewShape } from "@/components/ShapePreview";
import type { CoordPoint } from "@/components/map/LotPreviewModal";
import { ALL_ZONES, getZoneInfo } from "@/lib/coordTransform";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import type { PRS92Zone } from "@/types";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

const inputCls =
  "w-full min-w-0 rounded-[10px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-3 py-2 text-[13px] text-[var(--sb-text)] outline-none transition-all placeholder:text-[var(--sb-text-faint)] focus:border-[var(--sb-accent)] focus:ring-4 focus:ring-[var(--sb-accent)]/10 disabled:opacity-60";
const cellCls =
  "w-full min-w-0 rounded-[8px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-2 py-[6px] text-[12.5px] text-[var(--sb-text)] outline-none focus:border-[var(--sb-accent)] disabled:opacity-60";
const btnBase = "border-0 p-0 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";

type DraftRow = { station: string; northing: string; easting: string };

const isValidRow = (r: DraftRow) =>
  r.northing.trim() !== "" &&
  r.easting.trim() !== "" &&
  !isNaN(Number(r.northing)) &&
  !isNaN(Number(r.easting));

interface Props {
  open: boolean;
  onClose: () => void;
  lotLabel: string;
  points: CoordPoint[];
  initialZone: PRS92Zone;
  onSave: (zone: PRS92Zone, points: { northing: number; easting: number }[]) => Promise<void>;
}

export default function LotGeometryEditModal({ open, onClose, lotLabel, points, initialZone, onSave }: Props) {
  const { vars } = useSidebarTheme();
  const [zone, setZone] = useState<PRS92Zone>(initialZone);
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serialize = (z: number, rows: DraftRow[]) =>
    JSON.stringify([z, rows.map((r) => [r.northing.trim(), r.easting.trim()])]);

  // Fresh draft every time the modal opens.
  useEffect(() => {
    if (!open) return;
    const rows = points.map((pt) => ({
      station: pt.station,
      northing: pt.y.toFixed(3),
      easting: pt.x.toFixed(3),
    }));
    setZone(initialZone);
    setDraft(rows);
    setBaseline(serialize(initialZone, rows));
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  // Live preview. Blank/invalid rows are skipped so an empty cell doesn't
  // snap a vertex to (0, 0).
  const previewShapes = useMemo<PreviewShape[]>(() => {
    const pts: CoordPoint[] = draft
      .filter(isValidRow)
      .map((r) => ({ station: r.station, y: Number(r.northing), x: Number(r.easting) }));
    return [{ id: "edit", label: lotLabel, points: pts, complete: pts.length >= 3 }];
  }, [draft, lotLabel]);

  function updateRow(i: number, patch: Partial<DraftRow>) {
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    if (error) setError(null);
  }
  function removeRow(i: number) {
    setDraft((d) => d.filter((_, j) => j !== i).map((r, j) => ({ ...r, station: `P${j + 1}` })));
  }
  function addRow() {
    setDraft((d) => [...d, { station: `P${d.length + 1}`, northing: "", easting: "" }]);
  }

  async function handleSave() {
    if (draft.length < 3 || !draft.every(isValidRow)) {
      setError("Every point needs a valid Northing and Easting (minimum 3 points).");
      return;
    }
    if (serialize(zone, draft) === baseline) {
      setError("No changes to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        zone,
        draft.map((r) => ({ northing: Number(r.northing), easting: Number(r.easting) }))
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  // Portaled to <body> so the mobile drawer's transform can't trap it.
  return createPortal(
    <div
      className={`${uiFont.className} fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3`}
      style={vars}
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex max-h-full w-full max-w-[820px] flex-col overflow-hidden rounded-[18px] text-[var(--sb-text)]"
        style={{ background: "var(--sb-bg-elevated)", boxShadow: "var(--sb-shadow)", border: `1px solid ${HAIRLINE}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold tracking-tight">Edit polygon</h2>
            <p className="truncate text-[11.5px] text-[var(--sb-text-faint)]">Lot {lotLabel || "—"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className={`${btnBase} flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] bg-transparent text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]`}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            {error && (
              <div
                role="alert"
                className="rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
                style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}
              >
                {error}
              </div>
            )}

            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Projection (PRS92 zone)</span>
              <select
                className={inputCls}
                value={zone}
                disabled={saving}
                onChange={(e) => setZone(Number(e.target.value) as PRS92Zone)}
              >
                {ALL_ZONES.map((z) => (
                  <option key={z} value={z}>
                    Zone {z} - {getZoneInfo(z).name}
                  </option>
                ))}
              </select>
              <span className="text-[10.5px] text-[var(--sb-text-faint)]">
                Changing the zone keeps the Northing/Easting numbers and moves the polygon on the map.
              </span>
            </label>

            <div className="max-h-[320px] overflow-auto rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
              <div className="grid min-w-[280px] grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5 p-2">
                <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Sta</span>
                <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Northing</span>
                <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Easting</span>
                <span />
                {draft.map((r, i) => (
                  <Fragment key={i}>
                    <span className="text-[12px] font-medium">{r.station}</span>
                    <input className={cellCls} type="number" step="any" value={r.northing} disabled={saving}
                      onChange={(e) => updateRow(i, { northing: e.target.value })} />
                    <input className={cellCls} type="number" step="any" value={r.easting} disabled={saving}
                      onChange={(e) => updateRow(i, { easting: e.target.value })} />
                    {draft.length > 3 ? (
                      <button type="button" disabled={saving} onClick={() => removeRow(i)}
                        className={`${btnBase} flex h-5 w-5 items-center justify-center rounded-[6px] bg-transparent text-red-500 hover:bg-red-500/10`}>
                        <Trash2 size={11} />
                      </button>
                    ) : (
                      <span />
                    )}
                  </Fragment>
                ))}
              </div>
            </div>

            <button type="button" disabled={saving} onClick={addRow}
              className={`${btnBase} flex w-fit items-center gap-1 rounded-full bg-[var(--sb-hover)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}>
              <Plus size={11} /> Point
            </button>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Live preview</span>
            <div className="overflow-hidden rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
              <ShapePreview shapes={previewShapes} height={300} pointLabelMode="index" emptyMessage="Add at least 3 points" />
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 px-4 py-3" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <button type="button" onClick={onClose} disabled={saving}
            className={`${btnBase} rounded-full bg-[var(--sb-hover)] px-4 py-2 text-[12.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className={`${btnBase} flex items-center gap-2 rounded-full px-5 py-2 text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
            style={{ background: "var(--sb-accent)", color: "var(--sb-on-accent)" }}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
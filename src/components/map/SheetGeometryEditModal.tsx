"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, Loader2, ChevronDown } from "lucide-react";
import ShapePreview, { type PreviewShape } from "@/components/ShapePreview";
import type { CoordPoint } from "@/components/map/LotPreviewModal";
import { ALL_ZONES, getZoneInfo } from "@/lib/coordTransform";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import type { PRS92Zone } from "@/types";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

const inputCls =
  "w-full min-w-0 rounded-[10px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-3 py-2 text-[13px] text-[var(--sb-text)] outline-none transition-all focus:border-[var(--sb-accent)] focus:ring-4 focus:ring-[var(--sb-accent)]/10 disabled:opacity-60";
const cellCls =
  "w-full min-w-0 rounded-[8px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-2 py-[6px] text-[12.5px] text-[var(--sb-text)] outline-none focus:border-[var(--sb-accent)] disabled:opacity-60";
const btnBase = "border-0 p-0 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";

type DraftRow = { station: string; northing: string; easting: string };

const isValidRow = (r: DraftRow) =>
  r.northing.trim() !== "" &&
  r.easting.trim() !== "" &&
  !isNaN(Number(r.northing)) &&
  !isNaN(Number(r.easting));

const serialize = (rows: DraftRow[]) => JSON.stringify(rows.map((r) => [r.northing.trim(), r.easting.trim()]));

export interface SheetEditLot {
  id: string | number;
  label: string;
  points: CoordPoint[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  sheetLabel: string;
  lots: SheetEditLot[];
  initialZone: PRS92Zone;
  onSave: (
    zone: PRS92Zone,
    lots: { id: string | number; points: { northing: number; easting: number }[] }[]
  ) => Promise<void>;
}

export default function SheetGeometryEditModal({ open, onClose, sheetLabel, lots, initialZone, onSave }: Props) {
  const { vars } = useSidebarTheme();
  const [zone, setZone] = useState<PRS92Zone>(initialZone);
  const [drafts, setDrafts] = useState<Record<string, DraftRow[]>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh drafts every time the modal opens.
  useEffect(() => {
    if (!open) return;
    const d: Record<string, DraftRow[]> = {};
    const b: Record<string, string> = {};
    for (const lot of lots) {
      const rows = lot.points.map((pt) => ({
        station: pt.station,
        northing: pt.y.toFixed(3),
        easting: pt.x.toFixed(3),
      }));
      d[String(lot.id)] = rows;
      b[String(lot.id)] = serialize(rows);
    }
    setDrafts(d);
    setBaseline(b);
    setZone(initialZone);
    setOpenIds(new Set(lots[0] ? [String(lots[0].id)] : []));
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

  const previewShapes = useMemo<PreviewShape[]>(
    () =>
      lots.map((lot) => {
        const pts: CoordPoint[] = (drafts[String(lot.id)] ?? [])
          .filter(isValidRow)
          .map((r) => ({ station: r.station, y: Number(r.northing), x: Number(r.easting) }));
        return { id: String(lot.id), label: lot.label, points: pts, complete: pts.length >= 3 };
      }),
    [lots, drafts]
  );

  function updateRow(lotId: string, i: number, patch: Partial<DraftRow>) {
    setDrafts((d) => ({ ...d, [lotId]: d[lotId].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
    if (error) setError(null);
  }
  function removeRow(lotId: string, i: number) {
    setDrafts((d) => ({
      ...d,
      [lotId]: d[lotId].filter((_, j) => j !== i).map((r, j) => ({ ...r, station: `P${j + 1}` })),
    }));
  }
  function addRow(lotId: string) {
    setDrafts((d) => ({
      ...d,
      [lotId]: [...d[lotId], { station: `P${d[lotId].length + 1}`, northing: "", easting: "" }],
    }));
  }
  function toggleOpen(lotId: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(lotId)) next.delete(lotId);
      else next.add(lotId);
      return next;
    });
  }

  const zoneChanged = zone !== initialZone;
  const isChanged = (lotId: string) => zoneChanged || serialize(drafts[lotId] ?? []) !== baseline[lotId];

  async function handleSave() {
    for (const lot of lots) {
      const rows = drafts[String(lot.id)] ?? [];
      if (rows.length < 3 || !rows.every(isValidRow)) {
        setError(`Lot ${lot.label || "—"}: every point needs a valid Northing and Easting (minimum 3 points).`);
        setOpenIds((prev) => new Set(prev).add(String(lot.id)));
        return;
      }
    }
    const changed = lots.filter((l) => isChanged(String(l.id)));
    if (changed.length === 0) {
      setError("No changes to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        zone,
        changed.map((l) => ({
          id: l.id,
          points: drafts[String(l.id)].map((r) => ({ northing: Number(r.northing), easting: Number(r.easting) })),
        }))
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  const changedCount = lots.filter((l) => isChanged(String(l.id))).length;

  return createPortal(
    <div
      className={`${uiFont.className} fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3`}
      style={vars}
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex max-h-full w-full max-w-[980px] flex-col overflow-hidden rounded-[18px] text-[var(--sb-text)]"
        style={{ background: "var(--sb-bg-elevated)", boxShadow: "var(--sb-shadow)", border: `1px solid ${HAIRLINE}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold tracking-tight">Edit sheet polygons</h2>
            <p className="truncate text-[11.5px] text-[var(--sb-text-faint)]">
              Sheet {sheetLabel} · {lots.length} lot{lots.length === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close"
            className={`${btnBase} flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] bg-transparent text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]`}>
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            {error && (
              <div role="alert" className="rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
                style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}>
                {error}
              </div>
            )}

            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Projection (PRS92 zone, applies to all lots)</span>
              <select className={inputCls} value={zone} disabled={saving}
                onChange={(e) => setZone(Number(e.target.value) as PRS92Zone)}>
                {ALL_ZONES.map((z) => (
                  <option key={z} value={z}>Zone {z} - {getZoneInfo(z).name}</option>
                ))}
              </select>
              <span className="text-[10.5px] text-[var(--sb-text-faint)]">
                Changing the zone keeps every Northing/Easting number and moves all lots on the map.
              </span>
            </label>

            <div className="flex flex-col gap-2">
              {lots.map((lot) => {
                const id = String(lot.id);
                const rows = drafts[id] ?? [];
                const expanded = openIds.has(id);
                const dirty = isChanged(id);
                return (
                  <div key={id} className="overflow-hidden rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
                    <button type="button" onClick={() => toggleOpen(id)} disabled={saving}
                      className={`${btnBase} flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left hover:bg-[var(--sb-hover)]`}>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--sb-text)]">
                        Lot {lot.label || "—"}
                        <span className="ml-2 text-[10.5px] font-normal text-[var(--sb-text-faint)]">{rows.length} points</span>
                      </span>
                      {dirty && (
                        <span className="rounded-full px-2 py-[1px] text-[9.5px] font-bold uppercase"
                          style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}>
                          edited
                        </span>
                      )}
                      <ChevronDown size={14} className="flex-shrink-0 text-[var(--sb-text-faint)] transition-transform duration-150"
                        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }} />
                    </button>

                    {expanded && (
                      <div className="flex flex-col gap-2 px-3 pb-3">
                        <div className="max-h-[260px] overflow-auto">
                          <div className="grid min-w-[280px] grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-1.5 py-1">
                            <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Sta</span>
                            <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Northing</span>
                            <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Easting</span>
                            <span />
                            {rows.map((r, i) => (
                              <Fragment key={i}>
                                <span className="text-[12px] font-medium">{r.station}</span>
                                <input className={cellCls} type="number" step="any" value={r.northing} disabled={saving}
                                  onChange={(e) => updateRow(id, i, { northing: e.target.value })} />
                                <input className={cellCls} type="number" step="any" value={r.easting} disabled={saving}
                                  onChange={(e) => updateRow(id, i, { easting: e.target.value })} />
                                {rows.length > 3 ? (
                                  <button type="button" disabled={saving} onClick={() => removeRow(id, i)}
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
                        <button type="button" disabled={saving} onClick={() => addRow(id)}
                          className={`${btnBase} flex w-fit items-center gap-1 rounded-full bg-[var(--sb-hover)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}>
                          <Plus size={11} /> Point
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 md:sticky md:top-0 md:self-start">
            <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Live preview (all lots)</span>
            <div className="overflow-hidden rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
              <ShapePreview shapes={previewShapes} height={340} pointLabelMode="index" emptyMessage="No geometry" />
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 py-3" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <span className="text-[11.5px] text-[var(--sb-text-faint)]">
            {changedCount === 0 ? "No changes yet" : `${changedCount} lot${changedCount === 1 ? "" : "s"} will be saved`}
          </span>
          <div className="flex gap-2">
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
      </div>
    </div>,
    document.body
  );
}
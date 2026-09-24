"use client";

import { Fragment, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Plus, Trash2, ImageUp, Loader2 } from "lucide-react";
import type { Lot, Corner, ControlPoint } from "@/types";
import { localRing } from "@/lib/computeLots";
import ShapePreview from "@/components/ShapePreview";
import { labelCls, inputCls, SectionHeader } from "@/components/ControlPointForm";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function newCorner(station: string): Corner {
  return { id: uid(), station, northing: "", easting: "" };
}

export function newLot(): Lot {
  return {
    id: uid(),
    lotNo: "",
    owner: "",
    ownerGivenName: "",
    ownerSurname: "",
    location: "",
    provinceId: null,
    municipalityId: null,
    barangayId: null,
    surveyNo: "",
    dateSurveyed: "",
    patentNo: "",
    remarks: "",
    surveyorId: null,
    areaSqm: "",
    corners: [newCorner("1"), newCorner("2"), newCorner("3")],
  };
}

/* ------------------------------------------------------------------ */
/* Bearing & distance (traverse) support                               */
/* ------------------------------------------------------------------ */

type InputMode = "coords" | "bearings";

interface BearingLine {
  id: string;
  ns: "N" | "S";
  deg: string;
  min: string;
  ew: "E" | "W";
  dist: string;
}

interface BearingState {
  /** Tie line from the control point to station 1 (lot corner 1). */
  tie: BearingLine;
  /** One row per line of the technical description (1-2, 2-3, ..., n-1). */
  lines: BearingLine[];
}

function newBearingLine(): BearingLine {
  return { id: uid(), ns: "N", deg: "", min: "", ew: "E", dist: "" };
}

function newBearingState(): BearingState {
  return {
    tie: newBearingLine(),
    lines: [newBearingLine(), newBearingLine(), newBearingLine()],
  };
}

function isFilled(l: BearingLine): boolean {
  return l.deg.trim() !== "" && l.dist.trim() !== "" && !isNaN(Number(l.deg)) && !isNaN(Number(l.dist));
}

function step(l: BearingLine): { dn: number; de: number } {
  const angle = ((Number(l.deg) + (Number(l.min) || 0) / 60) * Math.PI) / 180;
  const dist = Number(l.dist);
  return {
    dn: dist * Math.cos(angle) * (l.ns === "N" ? 1 : -1),
    de: dist * Math.sin(angle) * (l.ew === "E" ? 1 : -1),
  };
}

/**
 * The frame the corner Northing/Easting are entered in (see computeLots.ts):
 *  - normal control point: LPCS values
 *  - control point with no LPCS recorded (0, 0): corners are PPCS-scale, so
 *    use the PPCS values (this mirrors effectiveControlPoint()).
 * Returns null until a control point with real values is chosen.
 */
function controlBase(cp?: ControlPoint): { n: number; e: number } | null {
  // The page starts with placeholder values (e.g. LPCS 20000/20000); only
  // trust the control point once one has actually been selected/named.
  if (!cp || cp.tiePointName.trim() === "") return null;
  const noLocal = cp.lpcsNorthing === 0 && cp.lpcsEasting === 0;
  const n = noLocal ? cp.ppcsNorthing : cp.lpcsNorthing;
  const e = noLocal ? cp.ppcsEasting : cp.lpcsEasting;
  if (!Number.isFinite(n) || !Number.isFinite(e) || (n === 0 && e === 0)) return null;
  return { n, e };
}

/** Human-readable reason the control point can't be used yet (null = usable). */
function controlProblem(cp?: ControlPoint): string | null {
  if (!cp || cp.tiePointName.trim() === "") return "Select a control point in step 1 first, so corner 1 can be placed.";
  if (controlBase(cp)) return null;
  return `The selected control point has no usable coordinates (LPCS ${cp.lpcsNorthing} / ${cp.lpcsEasting}, PPCS ${cp.ppcsNorthing} / ${cp.ppcsEasting}). Click Edit in step 1 and check the values.`;
}

interface TraverseResult {
  corners: Corner[];
  station1: { n: number; e: number } | null;
  misN: number | null;
  misE: number | null;
}

/**
 * Station 1 = control point + tie line. Each row is then one line of the
 * technical description: station i -> station i+1. The LAST row is the
 * closing line back to station 1, so it does not create a new corner
 * (same layout as "1-2, 2-3, ... 7-1" on the plan).
 */
function computeTraverse(state: BearingState, existing: Corner[], cp?: ControlPoint): TraverseResult {
  const base = controlBase(cp);
  if (!base || !isFilled(state.tie)) {
    return { corners: existing, station1: null, misN: null, misE: null };
  }

  const t = step(state.tie);
  const n0 = base.n + t.dn;
  const e0 = base.e + t.de;

  let n = n0;
  let e = e0;
  const pts: { n: number; e: number }[] = [{ n, e }];

  state.lines.filter(isFilled).forEach((l) => {
    const d = step(l);
    n += d.dn;
    e += d.de;
    pts.push({ n, e });
  });

  const closingRow = pts.length > 2; // at least 2 lines entered
  // last point is the closing point (back at station 1) -> not a new corner
  const ring = closingRow ? pts.slice(0, -1) : pts;
  const corners: Corner[] = ring.map((p, i) => ({
    id: existing[i]?.id ?? uid(),
    station: String(i + 1),
    northing: p.n.toFixed(3),
    easting: p.e.toFixed(3),
  }));

  const closing = pts[pts.length - 1];
  return {
    corners,
    station1: { n: n0, e: e0 },
    misN: closingRow ? closing.n - n0 : null,
    misE: closingRow ? closing.e - e0 : null,
  };
}

/* ------------------------------------------------------------------ */

interface ProvinceOption { id: number; name: string }
interface MunicipalityOption { id: number; name: string; type: string }
interface BarangayOption { id: number; name: string }
interface SurveyorOption { id: number; name: string; position: string }

interface Props {
  lots: Lot[];
  onChange: (lots: Lot[]) => void;
  /** Selected control point -- needed to place station 1 from the tie line. */
  controlPoint?: ControlPoint;
}

function fileToBase64(file: File | Blob): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [, data] = result.split(",");
      resolve({ data, mediaType: file.type || "image/png" });
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function LotEditor({ lots, onChange, controlPoint }: Props) {
  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const [surveyors, setSurveyors] = useState<SurveyorOption[]>([]);
  const [importingLotId, setImportingLotId] = useState<string | null>(null);
  const [importError, setImportError] = useState<{ lotId: string; message: string } | null>(null);
  const importTargetLotId = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // per-lot input mode + bearing table state (kept here so it survives toggling)
  const [modes, setModes] = useState<Record<string, InputMode>>({});
  const [bearingData, setBearingData] = useState<Record<string, BearingState>>({});

  useEffect(() => {
    fetch("/api/provinces").then((r) => r.json()).then(setProvinces).catch(() => setProvinces([]));
    fetch("/api/surveyors").then((r) => r.json()).then(setSurveyors).catch(() => setSurveyors([]));
  }, []);

  // If the control point changes, re-place every lot that is in bearing mode.
  useEffect(() => {
    const anyBearing = lots.some((l) => modes[l.id] === "bearings" && bearingData[l.id]);
    if (!anyBearing) return;
    onChange(
      lots.map((l) => {
        const bd = bearingData[l.id];
        if (modes[l.id] !== "bearings" || !bd) return l;
        return { ...l, corners: computeTraverse(bd, l.corners, controlPoint).corners };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controlPoint?.lpcsNorthing,
    controlPoint?.lpcsEasting,
    controlPoint?.ppcsNorthing,
    controlPoint?.ppcsEasting,
  ]);

  function triggerImport(lotId: string) {
    setImportError(null);
    importTargetLotId.current = lotId;
    fileInputRef.current?.click();
  }

  async function processImportImage(file: File | Blob, lotId: string) {
    setImportingLotId(lotId);
    setImportError(null);
    try {
      const { data, mediaType } = await fileToBase64(file);
      const res = await fetch("/api/extract-corners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: data, mediaType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to read image");

      const corners: Corner[] = json.corners.map((c: { station: string; northing: string; easting: string }) => ({
        id: uid(),
        station: c.station ?? "",
        northing: c.northing ?? "",
        easting: c.easting ?? "",
      }));

      onChange(lots.map((l) => (l.id === lotId ? { ...l, corners } : l)));
      // imported table is coordinates, so show the coordinate view
      setModes((m) => ({ ...m, [lotId]: "coords" }));
    } catch (err) {
      setImportError({ lotId, message: err instanceof Error ? err.message : "Failed to read image" });
    } finally {
      setImportingLotId(null);
    }
  }

  async function handleImageSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const lotId = importTargetLotId.current;
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !lotId) return;
    processImportImage(file, lotId);
  }

  // Lets the user Snipping-Tool a table straight to the clipboard and hit
  // Ctrl+V to fill whichever lot they last hovered/focused, with no file
  // dialog needed.
  useEffect(() => {
    function handleWindowPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          const lotId = importTargetLotId.current ?? lots[0]?.id ?? null;
          if (file && lotId) {
            e.preventDefault();
            processImportImage(file, lotId);
          }
          break;
        }
      }
    }
    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots]);

  function updateLot(id: string, patch: Partial<Lot>) {
    onChange(lots.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function updateCorner(lotId: string, cornerId: string, patch: Partial<Corner>) {
    onChange(lots.map((l) => (l.id !== lotId ? l : { ...l, corners: l.corners.map((c) => (c.id === cornerId ? { ...c, ...patch } : c)) })));
  }

  function addCorner(lotId: string) {
    onChange(lots.map((l) => (l.id !== lotId ? l : { ...l, corners: [...l.corners, newCorner(String(l.corners.length + 1))] })));
  }

  function removeCorner(lotId: string, cornerId: string) {
    onChange(lots.map((l) => (l.id !== lotId ? l : { ...l, corners: l.corners.filter((c) => c.id !== cornerId) })));
  }

  function addLot() {
    const prev = lots[lots.length - 1];
    const copiedLot: Lot = prev
      ? {
          ...newLot(),
          lotNo: prev.lotNo,
          areaSqm: prev.areaSqm,
          ownerGivenName: prev.ownerGivenName,
          ownerSurname: prev.ownerSurname,
          owner: prev.owner,
          location: prev.location,
          provinceId: prev.provinceId,
          municipalityId: prev.municipalityId,
          barangayId: prev.barangayId,
          surveyorId: prev.surveyorId,
          surveyNo: prev.surveyNo,
          dateSurveyed: prev.dateSurveyed,
          patentNo: prev.patentNo,
        }
      : newLot();

    // New lot inherits the input tab (Northing/Easting vs Bearing & Distance)
    // of the lot before it.
    const prevMode: InputMode = prev ? modes[prev.id] ?? "coords" : "coords";
    setModes((m) => ({ ...m, [copiedLot.id]: prevMode }));
    if (prevMode === "bearings") {
      setBearingData((b) => ({ ...b, [copiedLot.id]: newBearingState() }));
    }

    onChange([...lots, copiedLot]);
  }

  function removeLot(id: string) {
    onChange(lots.filter((l) => l.id !== id));
  }

  /* ---- bearing mode helpers ---- */

  function setMode(lot: Lot, mode: InputMode) {
    setModes((m) => ({ ...m, [lot.id]: mode }));
    if (mode === "bearings" && !bearingData[lot.id]) {
      setBearingData((b) => ({ ...b, [lot.id]: newBearingState() }));
    }
  }

  function applyBearingState(lot: Lot, next: BearingState) {
    setBearingData((b) => ({ ...b, [lot.id]: next }));
    const { corners } = computeTraverse(next, lot.corners, controlPoint);
    updateLot(lot.id, { corners });
  }

  function updateBearingLine(lot: Lot, lineId: string, patch: Partial<BearingLine>) {
    const cur = bearingData[lot.id] ?? newBearingState();
    applyBearingState(lot, { ...cur, lines: cur.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) });
  }

  function updateTie(lot: Lot, patch: Partial<BearingLine>) {
    const cur = bearingData[lot.id] ?? newBearingState();
    applyBearingState(lot, { ...cur, tie: { ...cur.tie, ...patch } });
  }

  function addBearingLine(lot: Lot) {
    const cur = bearingData[lot.id] ?? newBearingState();
    applyBearingState(lot, { ...cur, lines: [...cur.lines, newBearingLine()] });
  }

  function removeBearingLine(lot: Lot, lineId: string) {
    const cur = bearingData[lot.id] ?? newBearingState();
    applyBearingState(lot, { ...cur, lines: cur.lines.filter((l) => l.id !== lineId) });
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-[14px] p-4"
      style={{ border: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}
    >
      <SectionHeader index={2} title="Lot Data" />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageSelected}
      />

      <div className="flex flex-col gap-3">
        {lots.map((lot, lotIdx) => {
          const mode: InputMode = modes[lot.id] ?? "coords";
          const bd = bearingData[lot.id];
          const mis = bd ? computeTraverse(bd, lot.corners, controlPoint) : null;

          return (
            <div
              key={lot.id}
              onMouseEnter={() => { importTargetLotId.current = lot.id; }}
              onFocusCapture={() => { importTargetLotId.current = lot.id; }}
              className="flex flex-col gap-3 rounded-[12px] p-3"
              style={{ border: `1px solid ${HAIRLINE}`, background: "var(--sb-bg)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-[var(--sb-text)]">Lot #{lotIdx + 1}</span>
                {lots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLot(lot.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-red-500 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className={labelCls}>
                      Lot No.
                      <input className={inputCls} type="text" value={lot.lotNo} onChange={(e) => updateLot(lot.id, { lotNo: e.target.value })} placeholder="8208-B" />
                    </label>
                    <label className={labelCls}>
                      Area (sq.m.)
                      <input className={inputCls} type="text" value={lot.areaSqm} onChange={(e) => updateLot(lot.id, { areaSqm: e.target.value })} placeholder="121.00" />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <label className={labelCls}>
                      Given name
                      <input
                        className={inputCls}
                        type="text"
                        value={lot.ownerGivenName}
                        onChange={(e) => {
                          const ownerGivenName = e.target.value;
                          updateLot(lot.id, { ownerGivenName, owner: [lot.ownerSurname, ownerGivenName].filter(Boolean).join(", ") });
                        }}
                        placeholder="Juan"
                      />
                    </label>
                    <label className={labelCls}>
                      Surname
                      <input
                        className={inputCls}
                        type="text"
                        value={lot.ownerSurname}
                        onChange={(e) => {
                          const ownerSurname = e.target.value;
                          updateLot(lot.id, { ownerSurname, owner: [ownerSurname, lot.ownerGivenName].filter(Boolean).join(", ") });
                        }}
                        placeholder="Dela Cruz"
                      />
                    </label>
                  </div>

                  <LotLocationFields lot={lot} provinces={provinces} surveyors={surveyors} onPatch={(patch) => updateLot(lot.id, patch)} />

                  <div className="grid grid-cols-2 gap-2.5">
                    <label className={labelCls}>
                      Survey No.
                      <input className={inputCls} type="text" value={lot.surveyNo} onChange={(e) => updateLot(lot.id, { surveyNo: e.target.value })} placeholder="Csd-02-012345-D" />
                    </label>
                    <label className={labelCls}>
                      Date surveyed
                      <input className={inputCls} type="date" value={lot.dateSurveyed} onChange={(e) => updateLot(lot.id, { dateSurveyed: e.target.value })} />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <label className={labelCls}>
                      Patent No.
                      <input className={inputCls} type="text" value={lot.patentNo} onChange={(e) => updateLot(lot.id, { patentNo: e.target.value })} placeholder="P-12345" />
                    </label>
                    <label className={labelCls}>
                      Remarks
                      <input className={inputCls} type="text" value={lot.remarks} onChange={(e) => updateLot(lot.id, { remarks: e.target.value })} />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold text-[var(--sb-text-muted)]">Preview</span>
                  <div className="overflow-hidden rounded-[10px]" style={{ border: `1px solid ${HAIRLINE}` }}>
                    <ShapePreview
                      shapes={[{ id: lot.id, label: lot.lotNo || "Lot", points: localRing(lot), complete: localRing(lot).length >= 3 }]}
                      height={160}
                      emptyMessage="No corners yet"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div
                  className="flex overflow-hidden rounded-full"
                  style={{ border: `1px solid ${HAIRLINE}` }}
                  role="tablist"
                  aria-label="Corner input type"
                >
                  {([
                    ["coords", "Northing / Easting"],
                    ["bearings", "Bearing & Distance"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={mode === value}
                      onClick={() => setMode(lot, value)}
                      className="border-0 px-2.5 py-1 text-[10.5px] font-semibold transition-colors"
                      style={{
                        background: mode === value ? "var(--sb-accent)" : "transparent",
                        color: mode === value ? "var(--sb-on-accent)" : "var(--sb-text)",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => triggerImport(lot.id)}
                  disabled={importingLotId === lot.id}
                  className="flex items-center gap-1 rounded-full border-0 bg-[var(--sb-hover)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {importingLotId === lot.id ? (
                    <>
                      <Loader2 size={11} className="animate-spin" /> Reading image…
                    </>
                  ) : (
                    <>
                      <ImageUp size={11} /> Import from image
                    </>
                  )}
                </button>
              </div>
              {importError?.lotId === lot.id && (
                <span className="text-[10.5px] font-medium text-red-500">{importError.message}</span>
              )}
              <span className="text-[10px] text-[var(--sb-text-faint)]">
                Tip: you can also just hover this lot and press Ctrl+V to paste a screenshot (e.g. from Snipping Tool).
              </span>

              {mode === "coords" ? (
                <>
                  <div className="grid grid-cols-[46px_1fr_1fr_24px] items-center gap-1.5">
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Sta</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Northing</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Easting</span>
                    <span />

                    {lot.corners.map((corner) => (
                      <Fragment key={corner.id}>
                        <input
                          className={`${inputCls} text-center`}
                          type="text"
                          value={corner.station}
                          maxLength={2}
                          tabIndex={-1}
                          onChange={(e) => updateCorner(lot.id, corner.id, { station: e.target.value })}
                        />
                        <input className={inputCls} type="number" step="any" value={corner.northing} onChange={(e) => updateCorner(lot.id, corner.id, { northing: e.target.value })} />
                        <input className={inputCls} type="number" step="any" value={corner.easting} onChange={(e) => updateCorner(lot.id, corner.id, { easting: e.target.value })} />
                        <div className="flex items-center justify-center">
                          {lot.corners.length > 3 && (
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => removeCorner(lot.id, corner.id)}
                              className="flex h-5 w-5 items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-red-500 transition-colors hover:bg-red-500/10"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </Fragment>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => addCorner(lot.id)}
                    className="flex w-fit items-center gap-1 rounded-full border-0 bg-[var(--sb-hover)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80"
                  >
                    <Plus size={11} /> Corner
                  </button>
                </>
              ) : (
                <>
                  {/* Tie line: control point -> station 1 */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10.5px] font-semibold text-[var(--sb-text-muted)]">
                      Tie line (control point to corner 1)
                    </span>
                    <div className="grid grid-cols-[50px_1fr_1fr_50px_1.3fr] items-center gap-1.5">
                      <select className={inputCls} value={bd?.tie.ns ?? "N"} onChange={(e) => updateTie(lot, { ns: e.target.value as "N" | "S" })}>
                        <option value="N">N</option>
                        <option value="S">S</option>
                      </select>
                      <input className={inputCls} type="number" step="any" min={0} max={90} placeholder="Deg" value={bd?.tie.deg ?? ""} onChange={(e) => updateTie(lot, { deg: e.target.value })} />
                      <input className={inputCls} type="number" step="any" min={0} max={59} placeholder="Min" value={bd?.tie.min ?? ""} onChange={(e) => updateTie(lot, { min: e.target.value })} />
                      <select className={inputCls} value={bd?.tie.ew ?? "E"} onChange={(e) => updateTie(lot, { ew: e.target.value as "E" | "W" })}>
                        <option value="E">E</option>
                        <option value="W">W</option>
                      </select>
                      <input className={inputCls} type="number" step="any" min={0} placeholder="Distance" value={bd?.tie.dist ?? ""} onChange={(e) => updateTie(lot, { dist: e.target.value })} />
                    </div>
                    {(() => {
                      // Only warn when a control point IS selected but its values are unusable.
                      // (No message when nothing is selected yet.)
                      const problem = controlPoint && controlPoint.tiePointName.trim() !== "" ? controlProblem(controlPoint) : null;
                      if (problem)
                        return <span className="text-[10.5px] font-medium text-red-500">{problem}</span>;
                      if (!controlBase(controlPoint)) return null;
                      if (!bd || !isFilled(bd.tie))
                        return <span className="text-[10.5px] text-[var(--sb-text-muted)]">Enter the tie line degrees and distance to place corner 1.</span>;
                      const filledLines = bd.lines.filter(isFilled).length;
                      return (
                        <>
                          {mis?.station1 && (
                            <span className="text-[10.5px] text-[var(--sb-text-muted)]">
                              Corner 1: N {mis.station1.n.toFixed(3)}, E {mis.station1.e.toFixed(3)}
                            </span>
                          )}
                          {filledLines < 2 && (
                            <span className="text-[10.5px] text-[var(--sb-text-muted)]">
                              Fill in at least 2 lot lines below to see the shape.
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div className="grid grid-cols-[34px_50px_1fr_1fr_50px_1.3fr_24px] items-center gap-1.5">
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Line</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">NS</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Deg</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Min</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">EW</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">Distance</span>
                    <span />

                    {(bd?.lines ?? []).map((line, i, arr) => {
                      const to = i === arr.length - 1 ? 1 : i + 2;
                      return (
                        <Fragment key={line.id}>
                          <span className="text-center text-[10.5px] font-semibold text-[var(--sb-text-muted)]">
                            {i + 1}-{to}
                          </span>
                          <select className={inputCls} value={line.ns} onChange={(e) => updateBearingLine(lot, line.id, { ns: e.target.value as "N" | "S" })}>
                            <option value="N">N</option>
                            <option value="S">S</option>
                          </select>
                          <input className={inputCls} type="number" step="any" min={0} max={90} value={line.deg} onChange={(e) => updateBearingLine(lot, line.id, { deg: e.target.value })} />
                          <input className={inputCls} type="number" step="any" min={0} max={59} value={line.min} onChange={(e) => updateBearingLine(lot, line.id, { min: e.target.value })} />
                          <select className={inputCls} value={line.ew} onChange={(e) => updateBearingLine(lot, line.id, { ew: e.target.value as "E" | "W" })}>
                            <option value="E">E</option>
                            <option value="W">W</option>
                          </select>
                          <input className={inputCls} type="number" step="any" min={0} value={line.dist} onChange={(e) => updateBearingLine(lot, line.id, { dist: e.target.value })} />
                          <div className="flex items-center justify-center">
                            {arr.length > 3 && (
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => removeBearingLine(lot, line.id)}
                                className="flex h-5 w-5 items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-red-500 transition-colors hover:bg-red-500/10"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => addBearingLine(lot)}
                      className="flex w-fit items-center gap-1 rounded-full border-0 bg-[var(--sb-hover)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80"
                    >
                      <Plus size={11} /> Line
                    </button>
                    {mis && mis.misN !== null && mis.misE !== null && (
                      <span className="text-[10.5px] text-[var(--sb-text-muted)]">
                        Misclosure: N {mis.misN.toFixed(3)}, E {mis.misE.toFixed(3)}
                      </span>
                    )}
                  </div>

                  <span className="text-[10px] text-[var(--sb-text-faint)]">
                    Below, enter each lot line (1-2, 2-3, …). The last line is the closing line back to corner 1. For DUE WEST enter N 90° 00′ W (due east: N 90° 00′ E, due north: N 0° 00′ E, due south: S 0° 00′ E).
                    Corner coordinates are calculated automatically; switch to Northing / Easting to fine-tune them.
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addLot}
        className="flex items-center justify-center gap-1.5 rounded-full border-0 px-3 py-[9px] text-[12.5px] font-semibold transition-opacity hover:opacity-90"
        style={{ background: "var(--sb-accent)", color: "var(--sb-on-accent)" }}
      >
        <Plus size={13} /> Add lot
      </button>
    </section>
  );
}

function LotLocationFields({
  lot,
  provinces,
  surveyors,
  onPatch,
}: {
  lot: Lot;
  provinces: ProvinceOption[];
  surveyors: SurveyorOption[];
  onPatch: (patch: Partial<Lot>) => void;
}) {
  const [municipalities, setMunicipalities] = useState<MunicipalityOption[]>([]);
  const [barangays, setBarangays] = useState<BarangayOption[]>([]);

  useEffect(() => {
    if (!lot.provinceId) { setMunicipalities([]); return; }
    fetch(`/api/municipalities?province_id=${lot.provinceId}`).then((r) => r.json()).then(setMunicipalities).catch(() => setMunicipalities([]));
  }, [lot.provinceId]);

  useEffect(() => {
    if (!lot.municipalityId) { setBarangays([]); return; }
    fetch(`/api/barangays?municipality_id=${lot.municipalityId}`).then((r) => r.json()).then(setBarangays).catch(() => setBarangays([]));
  }, [lot.municipalityId]);

  function buildLocationString(
    provinceId: number | null,
    municipalityId: number | null,
    barangayId: number | null,
    munList: MunicipalityOption[],
    brgyList: BarangayOption[]
  ) {
    const province = provinces.find((p) => p.id === provinceId)?.name ?? "";
    const municipality = munList.find((m) => m.id === municipalityId)?.name ?? "";
    const barangay = brgyList.find((b) => b.id === barangayId)?.name ?? "";
    return [barangay, municipality, province].filter(Boolean).join(", ");
  }

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <label className={labelCls}>
        Province
        <select
          className={inputCls}
          value={lot.provinceId ?? ""}
          onChange={(e) => {
            const provinceId = e.target.value ? Number(e.target.value) : null;
            onPatch({ provinceId, municipalityId: null, barangayId: null, location: buildLocationString(provinceId, null, null, [], []) });
          }}
        >
          <option value="">Select…</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        Municipality
        <select
          className={inputCls}
          value={lot.municipalityId ?? ""}
          disabled={!lot.provinceId}
          onChange={(e) => {
            const municipalityId = e.target.value ? Number(e.target.value) : null;
            onPatch({ municipalityId, barangayId: null, location: buildLocationString(lot.provinceId, municipalityId, null, municipalities, []) });
          }}
        >
          <option value="">Select…</option>
          {municipalities.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        Barangay
        <select
          className={inputCls}
          value={lot.barangayId ?? ""}
          disabled={!lot.municipalityId}
          onChange={(e) => {
            const barangayId = e.target.value ? Number(e.target.value) : null;
            onPatch({ barangayId, location: buildLocationString(lot.provinceId, lot.municipalityId, barangayId, municipalities, barangays) });
          }}
        >
          <option value="">Select…</option>
          {barangays.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>

      <label className={labelCls}>
        Surveyor
        <select className={inputCls} value={lot.surveyorId ?? ""} onChange={(e) => onPatch({ surveyorId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Select…</option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
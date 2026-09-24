"use client";

import { useEffect, useRef, useState } from "react";
import type { ControlPoint, PRS92Zone } from "@/types";
import { ALL_ZONES, getZoneInfo } from "@/lib/coordTransform";
import ControlPointPicker from "@/components/ControlPointPicker";
import type { ControlPointRow } from "@/app/api/control-points/route";

const FIXED_ZONE: PRS92Zone = 3;
const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

export const labelCls = "flex flex-col gap-1 text-[10.5px] font-semibold text-[var(--sb-text-muted)]";
export const inputCls =
  "w-full rounded-[8px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-2.5 py-[7px] text-[12.5px] text-[var(--sb-text)] outline-none transition-colors focus:border-[var(--sb-accent)]";

interface Props {
  value: ControlPoint;
  onChange: (cp: ControlPoint) => void;
}

/**
 * Number input that keeps what the person is typing. The parent state is a
 * plain number, so a cleared field would otherwise snap straight back to "0"
 * and could never be erased and retyped. It re-syncs whenever the value is
 * changed from outside (e.g. picking a saved control point).
 */
function NumInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const lastSent = useRef(value);

  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setDraft(String(value));
    }
  }, [value]);

  return (
    <input
      className={inputCls}
      type="number"
      step="any"
      value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = text === "" || isNaN(Number(text)) ? 0 : Number(text);
        lastSent.current = n;
        onChange(n);
      }}
    />
  );
}

export default function ControlPointForm({ value, onChange }: Props) {
  const [manualOpen, setManualOpen] = useState(true);

  function update<K extends keyof ControlPoint>(key: K, val: ControlPoint[K]) {
    const identifyingFields: (keyof ControlPoint)[] = ["tiePointName", "municipality", "province"];
    const shouldClearId = value.controlPointId !== null && identifyingFields.includes(key);
    onChange({ ...value, [key]: val, ...(shouldClearId ? { controlPointId: null } : {}) });
  }

  function handleSelect(row: ControlPointRow) {
    onChange({
      controlPointId: row.id,
      tiePointName: row.tie_point_name,
      municipality: row.municipality_name,
      province: row.province_name,
      lpcsNorthing: Number(row.lpcs_northing),
      lpcsEasting: Number(row.lpcs_easting),
      ppcsNorthing: Number(row.ppcs_northing),
      ppcsEasting: Number(row.ppcs_easting),
      // All saved control points are treated as PRS92 Zone 3. If a row ever
      // carries its own zone, use that here instead.
      zone: FIXED_ZONE,
    });
    setManualOpen(false);
  }

  const hasSelection = value.tiePointName.trim().length > 0;

  // LAMS sometimes exports a control point with no local (LPCS) value ever
  // captured -- PPCS is still good, but corner Northing/Easting entered for
  // lots using this point are already real-world PPCS-scale numbers, not
  // offsets from a local origin. computeLots.ts handles this at compute time
  // (see effectiveControlPoint / hasNoLocalOffset); this banner just makes
  // that behavior visible so it isn't mistaken for missing/bad data.
  const hasNoLocalOffset = value.lpcsNorthing === 0 && value.lpcsEasting === 0;

  return (
    <section
      className="flex flex-col gap-3 rounded-[14px] p-4"
      style={{ border: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}
    >
      <SectionHeader index={1} title="Control Point" />

      <ControlPointPicker onSelect={handleSelect} />

      {hasSelection && (
        <div
          className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2"
          style={{ background: "var(--sb-accent-bg)" }}
        >
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold text-[var(--sb-accent-text)]">
              {value.tiePointName}
            </div>
            <div className="truncate text-[10.5px] text-[var(--sb-text-faint)]">
              {value.municipality}, {value.province} · Zone {value.zone}
            </div>
            {value.controlPointId === null && (
              <div className="mt-0.5 text-[10.5px] font-medium text-red-500">
                Not linked — pick a saved point below.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setManualOpen((o) => !o)}
            className="flex-shrink-0 rounded-full border-0 bg-[var(--sb-bg)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--sb-text)] transition-opacity hover:opacity-80"
          >
            {manualOpen ? "Hide" : "Edit"}
          </button>
        </div>
      )}

      {manualOpen && (
        <div
          className="flex flex-col gap-3 pt-1"
          style={{ borderTop: hasSelection ? `1px solid ${HAIRLINE}` : "none" }}
        >
          <div className="grid grid-cols-2 gap-2.5">
            <label className={labelCls}>
              Tie point name
              <input className={inputCls} type="text" value={value.tiePointName} onChange={(e) => update("tiePointName", e.target.value)} placeholder="PLS 746" />
            </label>
            <label className={labelCls}>
              Municipality
              <input className={inputCls} type="text" value={value.municipality} onChange={(e) => update("municipality", e.target.value)} placeholder="Sanchez Mira" />
            </label>
            <label className={labelCls}>
              Province
              <input className={inputCls} type="text" value={value.province} onChange={(e) => update("province", e.target.value)} placeholder="Cagayan" />
            </label>
            <label className={labelCls}>
              PRS92 zone
              <select className={inputCls} value={value.zone} onChange={(e) => update("zone", Number(e.target.value) as PRS92Zone)}>
                {ALL_ZONES.map((z) => (
                  <option key={z} value={z}>
                    Zone {z} - {getZoneInfo(z).name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <label className={labelCls}>
              LPCS Northing
              <NumInput value={value.lpcsNorthing} onChange={(n) => update("lpcsNorthing", n)} />
            </label>
            <label className={labelCls}>
              LPCS Easting
              <NumInput value={value.lpcsEasting} onChange={(n) => update("lpcsEasting", n)} />
            </label>
            <label className={labelCls}>
              PPCS Northing
              <NumInput value={value.ppcsNorthing} onChange={(n) => update("ppcsNorthing", n)} />
            </label>
            <label className={labelCls}>
              PPCS Easting
              <NumInput value={value.ppcsEasting} onChange={(n) => update("ppcsEasting", n)} />
            </label>
          </div>

          {hasNoLocalOffset && (
            <div
              className="rounded-[8px] px-2.5 py-2 text-[11px] font-medium leading-snug"
              style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}
            >
              No local (LPCS) value recorded for this control point. Corner Northing/Easting
              entered for lots using this point will be treated as real-world PPCS coordinates
              directly — no shift is applied.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function SectionHeader({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold"
        style={{ background: "var(--sb-accent)", color: "var(--sb-on-accent)" }}
      >
        {index}
      </span>
      <h2 className="text-[13px] font-bold text-[var(--sb-text)]">{title}</h2>
    </div>
  );
}
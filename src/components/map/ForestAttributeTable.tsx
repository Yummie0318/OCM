"use client";

import { useEffect, useMemo, useState } from "react";
import type { LotFeature } from "@/lib/geo";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import { FOREST_COLOR } from "@/lib/forest";
import {
  Tooltip,
  Checkbox,
  ColorToolbar,
  Th,
  hexToRgba,
  HAIRLINE,
  HAIRLINE_SOFT,
} from "@/components/map/AttributeTable";

export default function ForestAttributeTable({
  features,
  selectedId,
  onRowClick,
  lotColors,
  onSetLotColors,
  filterLabel,
  onClearFilter,
}: {
  features: LotFeature[];
  selectedId?: number | string | null;
  onRowClick?: (f: LotFeature) => void;
  lotColors?: Record<string, string>;
  onSetLotColors?: (ids: Array<string | number>, color: string | null) => void;
  filterLabel?: string | null;
  onClearFilter?: () => void;
}) {
  const { vars } = useSidebarTheme();
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Drop ticked rows that are no longer in the table.
  useEffect(() => {
    const valid = new Set(features.map((f) => String(f.id)));
    setChecked((prev) => {
      const kept = Array.from(prev).filter((id) => valid.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [features]);

  const rows = useMemo(
    () =>
      [...features].sort(
        (a, b) =>
          String((a.properties as any).forestType).localeCompare(String((b.properties as any).forestType)) ||
          Number((b.properties as any).areaHa) - Number((a.properties as any).areaHa)
      ),
    [features]
  );
  const totalHa = rows.reduce((s, f) => s + (Number((f.properties as any).areaHa) || 0), 0);
  const ids = rows.map((f) => String(f.id));
  const allSel = ids.length > 0 && ids.every((id) => checked.has(id));

  function toggle(id: string) {
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className={`${uiFont.className} flex h-full flex-col bg-[var(--sb-bg)] antialiased`} style={vars}>
      {filterLabel && onClearFilter && (
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-accent-bg)" }}
        >
          <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--sb-accent-text)]">
            Showing only: {filterLabel}
          </span>
          <button
            type="button"
            onClick={onClearFilter}
            className="border-0 bg-transparent p-0 text-[11px] font-semibold text-[var(--sb-accent)]"
          >
            Show all
          </button>
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2"
        style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-hover)" }}
      >
        <span className="text-[11.5px] tabular-nums text-[var(--sb-text-muted)]">
          {rows.length.toLocaleString()} polygons ·{" "}
          {totalHa.toLocaleString(undefined, { maximumFractionDigits: 2 })} ha
        </span>
        <ColorToolbar
          selectedCount={checked.size}
          onApplyColor={(c) => onSetLotColors?.(Array.from(checked), c)}
          onDeselectAll={() => setChecked(new Set())}
          idleLabel="Tick polygons to color"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="h-full overflow-y-auto">
          <table className="w-full min-w-[520px] border-collapse text-[11.5px]">
            <thead>
              <tr>
                <th
                  className="sticky top-0 z-10 w-9 px-2.5 py-[7px] sm:w-7"
                  style={{
                    background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
                    borderBottom: `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Tooltip label={allSel ? "Deselect all" : "Select all"}>
                    <Checkbox
                      checked={allSel}
                      onChange={() => setChecked(allSel ? new Set() : new Set(ids))}
                    />
                  </Tooltip>
                </th>
                <Th>Color</Th>
                <Th>Forest Type</Th>
                <Th>Label</Th>
                <Th numeric>Area (ha)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => {
                const p = f.properties as any;
                const id = String(f.id);
                const custom = lotColors?.[id];
                const shown = custom ?? FOREST_COLOR[p.forestType];
                const sel = selectedId != null && id === String(selectedId);
                const bg = custom
                  ? hexToRgba(custom, sel ? 0.28 : 0.16)
                  : sel || checked.has(id)
                    ? "var(--sb-accent-bg)"
                    : i % 2
                      ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)"
                      : "transparent";
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(f)}
                    className="cursor-pointer transition-colors duration-100"
                    style={{ background: bg, borderBottom: `1px solid ${HAIRLINE_SOFT}` }}
                  >
                    <td className="px-2.5 py-[6px]" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={checked.has(id)} onChange={() => toggle(id)} />
                    </td>
                    <td className="px-2.5 py-[6px]">
                      <span
                        className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
                        style={{ background: shown }}
                      />
                    </td>
                    <td className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]">
                      {String(p.forestType).replace("_", " ")}
                    </td>
                    <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{p.label}</td>
                    <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
                      {Number(p.areaHa).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
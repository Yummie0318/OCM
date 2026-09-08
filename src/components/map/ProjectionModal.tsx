"use client";

// Target path: src/components/map/ProjectionModal.tsx
//
// CENRO LEVEL (this pass): tree gained a level — CENRO -> Municipality ->
// Barangay -> Year (was Municipality -> Barangay -> Year) — so this modal's
// checkbox tree now starts one level higher, mirroring Sidebar.tsx's new
// CenroNode -> MunicipalityNode -> BarangayNode chain. Everything below
// CENRO is unchanged in behavior, just nested one level deeper in state:
//
//   - CENRO fully checked -> key `proj:cenro:<id>`, query { cenro_id }
//     (all municipalities, all barangays, all years)
//   - Municipality fully checked (its CENRO isn't) -> key `proj:muni:<id>`,
//     query { municipality_id }  (all barangays, all years)
//   - Barangay fully checked (its municipality isn't) -> key
//     `proj:brgy:<id>`, query { barangay_id }  (all years in that barangay)
//   - A specific year checked under a barangay (barangay isn't fully
//     checked) -> key `year:<barangayId>:<year>`, query
//     { barangay_id, year } -- this is the SAME key YearRow in Sidebar.tsx
//     uses, so a year picked here shows as checked if the user later
//     expands that barangay in the normal tree, and a year checked in the
//     tree shows up as already-selected if they reopen this modal... (it
//     doesn't currently pre-seed from activeSelections -- see note below).
//
// Checking a parent (CENRO/municipality/barangay) visually disables and
// "checks" everything under it rather than trying to keep independent
// selection states in sync -- the parent's single query already covers
// everything under it, so there's nothing extra to send.
//
// NOTE: this modal always opens with a clean slate (local state reset on
// every `open` transition) rather than pre-populating from the sidebar's
// current activeSelections. That keeps the logic simple -- Apply is
// purely additive on top of whatever's already selected, same as
// checking a year or picking a search result. If you'd rather it show
// what's already active when reopened, that's a reasonable follow-up.
//
// Fetching mirrors CenroNode/MunicipalityNode/BarangayNode in Sidebar.tsx
// exactly (/api/map/tree?level=municipalities&cenro_id=,
// ?level=barangays&municipality_id=, ?level=years&barangay_id=), just
// cached in this component's own local state instead of theirs.
//
// Rendered via createPortal to document.body (same pattern as Sidebar's
// Tooltip) so it's never clipped by the sidebar's own overflow, and reads
// theme colors via useSidebarTheme() -- which works fine through a portal
// since React context follows the component tree, not the DOM tree.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Filter,
  Landmark,
  Building2,
  MapPin,
  CalendarDays,
  Plus,
  Minus,
  Check,
  Loader2,
} from "lucide-react";
import type { TreeNodeData, SelectionMeta } from "@/lib/geo";
import { useSidebarTheme } from "./SidebarThemeContext";
import { uiFont } from "./sidebarTheme";

interface BarangayState {
  data: TreeNodeData;
  checked: boolean;
  expanded: boolean;
  years: TreeNodeData[] | null;
  yearChecked: Record<string, boolean>;
}

interface MunicipalityState {
  data: TreeNodeData;
  checked: boolean;
  expanded: boolean;
  barangays: TreeNodeData[] | null;
  barangayState: Record<string, BarangayState>;
}

interface CenroState {
  data: TreeNodeData;
  checked: boolean;
  expanded: boolean;
  municipalities: TreeNodeData[] | null;
  muniState: Record<string, MunicipalityState>;
}

export interface ProjectionResult {
  key: string;
  meta: SelectionMeta;
}

async function safeFetchArray(url: string): Promise<TreeNodeData[]> {
  try {
    const r = await fetch(url);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const hairline = "color-mix(in srgb, var(--sb-border) 75%, transparent)";
const hairlineSoft = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

function TriCheckbox({
  state,
  onChange,
  disabled,
}: {
  state: "checked" | "unchecked" | "partial";
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4.5px] border-0 transition-colors disabled:cursor-default"
      style={{
        border: `1px solid ${state === "unchecked" ? "var(--sb-border)" : "var(--sb-accent)"}`,
        background: state === "unchecked" ? "var(--sb-bg)" : "var(--sb-accent)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {state === "checked" && <Check size={11} strokeWidth={3} color="white" />}
      {state === "partial" && <span className="block h-[2px] w-[8px] rounded-full bg-white" />}
    </button>
  );
}

export default function ProjectionModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (results: ProjectionResult[]) => void;
}) {
  const { theme, vars } = useSidebarTheme();
  const [mounted, setMounted] = useState(false);
  const [cenros, setCenros] = useState<TreeNodeData[] | null>(null);
  const [cenroState, setCenroState] = useState<Record<string, CenroState>>({});

  useEffect(() => setMounted(true), []);

  // Fresh slate every time the modal opens — including the CENRO list
  // itself, which this component now owns instead of receiving as a prop
  // (Sidebar.tsx no longer loads a CENRO list for anything).
  useEffect(() => {
    if (open) {
      setCenroState({});
      setCenros(null);
      safeFetchArray("/api/map/tree?level=cenros").then(setCenros);
    }
  }, [open]);

  if (!mounted || !open) return null;

  function ensureCenro(c: TreeNodeData): CenroState {
    return (
      cenroState[String(c.id)] ?? {
        data: c,
        checked: false,
        expanded: false,
        municipalities: null,
        muniState: {},
      }
    );
  }

  function toggleCenroExpand(c: TreeNodeData) {
    const key = String(c.id);
    const current = ensureCenro(c);
    const nextExpanded = !current.expanded;
    setCenroState((prev) => ({ ...prev, [key]: { ...current, expanded: nextExpanded } }));
    if (nextExpanded && current.municipalities === null) {
      safeFetchArray(`/api/map/tree?level=municipalities&cenro_id=${c.id}`).then((municipalities) => {
        setCenroState((prev) => {
          const cur = prev[key];
          if (!cur) return prev;
          return { ...prev, [key]: { ...cur, municipalities } };
        });
      });
    }
  }

  function toggleCenroChecked(c: TreeNodeData) {
    const key = String(c.id);
    const current = ensureCenro(c);
    setCenroState((prev) => ({ ...prev, [key]: { ...current, checked: !current.checked } }));
  }

  function toggleMuniExpand(c: TreeNodeData, m: TreeNodeData) {
    const cKey = String(c.id);
    const mKey = String(m.id);
    setCenroState((prev) => {
      const cState = prev[cKey] ?? ensureCenro(c);
      const mState: MunicipalityState =
        cState.muniState[mKey] ?? { data: m, checked: false, expanded: false, barangays: null, barangayState: {} };
      const nextExpanded = !mState.expanded;
      const nextMState = { ...mState, expanded: nextExpanded };
      if (nextExpanded && mState.barangays === null) {
        safeFetchArray(`/api/map/tree?level=barangays&municipality_id=${m.id}`).then((barangays) => {
          setCenroState((p2) => {
            const c2 = p2[cKey];
            if (!c2) return p2;
            const m2 = c2.muniState[mKey];
            if (!m2) return p2;
            return {
              ...p2,
              [cKey]: { ...c2, muniState: { ...c2.muniState, [mKey]: { ...m2, barangays } } },
            };
          });
        });
      }
      return {
        ...prev,
        [cKey]: { ...cState, muniState: { ...cState.muniState, [mKey]: nextMState } },
      };
    });
  }

  function toggleMuniChecked(c: TreeNodeData, m: TreeNodeData) {
    const cKey = String(c.id);
    const mKey = String(m.id);
    setCenroState((prev) => {
      const cState = prev[cKey] ?? ensureCenro(c);
      const mState: MunicipalityState =
        cState.muniState[mKey] ?? { data: m, checked: false, expanded: false, barangays: null, barangayState: {} };
      return {
        ...prev,
        [cKey]: { ...cState, muniState: { ...cState.muniState, [mKey]: { ...mState, checked: !mState.checked } } },
      };
    });
  }

  function toggleBrgyExpand(c: TreeNodeData, m: TreeNodeData, b: TreeNodeData) {
    const cKey = String(c.id);
    const mKey = String(m.id);
    const bKey = String(b.id);
    setCenroState((prev) => {
      const cState = prev[cKey] ?? ensureCenro(c);
      const mState: MunicipalityState =
        cState.muniState[mKey] ?? { data: m, checked: false, expanded: false, barangays: null, barangayState: {} };
      const bState: BarangayState =
        mState.barangayState[bKey] ?? { data: b, checked: false, expanded: false, years: null, yearChecked: {} };
      const nextExpanded = !bState.expanded;
      const nextBState = { ...bState, expanded: nextExpanded };
      if (nextExpanded && bState.years === null) {
        safeFetchArray(`/api/map/tree?level=years&barangay_id=${b.id}`).then((years) => {
          setCenroState((p2) => {
            const c2 = p2[cKey];
            if (!c2) return p2;
            const m2 = c2.muniState[mKey];
            if (!m2) return p2;
            const b2 = m2.barangayState[bKey];
            if (!b2) return p2;
            return {
              ...p2,
              [cKey]: {
                ...c2,
                muniState: {
                  ...c2.muniState,
                  [mKey]: { ...m2, barangayState: { ...m2.barangayState, [bKey]: { ...b2, years } } },
                },
              },
            };
          });
        });
      }
      return {
        ...prev,
        [cKey]: {
          ...cState,
          muniState: {
            ...cState.muniState,
            [mKey]: { ...mState, barangayState: { ...mState.barangayState, [bKey]: nextBState } },
          },
        },
      };
    });
  }

  function toggleBrgyChecked(c: TreeNodeData, m: TreeNodeData, b: TreeNodeData) {
    const cKey = String(c.id);
    const mKey = String(m.id);
    const bKey = String(b.id);
    setCenroState((prev) => {
      const cState = prev[cKey] ?? ensureCenro(c);
      const mState: MunicipalityState =
        cState.muniState[mKey] ?? { data: m, checked: false, expanded: false, barangays: null, barangayState: {} };
      const bState: BarangayState =
        mState.barangayState[bKey] ?? { data: b, checked: false, expanded: false, years: null, yearChecked: {} };
      return {
        ...prev,
        [cKey]: {
          ...cState,
          muniState: {
            ...cState.muniState,
            [mKey]: {
              ...mState,
              barangayState: { ...mState.barangayState, [bKey]: { ...bState, checked: !bState.checked } },
            },
          },
        },
      };
    });
  }

  function toggleYearChecked(c: TreeNodeData, m: TreeNodeData, b: TreeNodeData, y: TreeNodeData) {
    const cKey = String(c.id);
    const mKey = String(m.id);
    const bKey = String(b.id);
    const yKey = String(y.id);
    setCenroState((prev) => {
      const cState = prev[cKey] ?? ensureCenro(c);
      const mState: MunicipalityState =
        cState.muniState[mKey] ?? { data: m, checked: false, expanded: false, barangays: null, barangayState: {} };
      const bState: BarangayState =
        mState.barangayState[bKey] ?? { data: b, checked: false, expanded: false, years: null, yearChecked: {} };
      return {
        ...prev,
        [cKey]: {
          ...cState,
          muniState: {
            ...cState.muniState,
            [mKey]: {
              ...mState,
              barangayState: {
                ...mState.barangayState,
                [bKey]: { ...bState, yearChecked: { ...bState.yearChecked, [yKey]: !bState.yearChecked[yKey] } },
              },
            },
          },
        },
      };
    });
  }

  function muniPartial(mState: MunicipalityState): boolean {
    if (mState.checked) return false;
    return Object.values(mState.barangayState).some(
      (b) => b.checked || Object.values(b.yearChecked).some(Boolean)
    );
  }

  function barangayPartial(bState: BarangayState): boolean {
    if (bState.checked) return false;
    return Object.values(bState.yearChecked).some(Boolean);
  }

  // A CENRO reads "partial" (dash) if it isn't itself fully checked but
  // something underneath it (a municipality, barangay, or year) is.
  function cenroPartial(cState: CenroState): boolean {
    if (cState.checked) return false;
    return Object.values(cState.muniState).some((m) => m.checked || muniPartial(m));
  }

  const allCenroChecked =
    !!cenros && cenros.length > 0 && cenros.every((c) => cenroState[String(c.id)]?.checked);

  function toggleSelectAllCenros() {
    if (!cenros) return;
    const nextChecked = !allCenroChecked;
    setCenroState((prev) => {
      const next = { ...prev };
      for (const c of cenros) {
        const key = String(c.id);
        next[key] = { ...ensureCenro(c), ...next[key], checked: nextChecked };
      }
      return next;
    });
  }

  const totalSelectedCount = Object.values(cenroState).reduce((sum, c) => {
    if (c.checked) return sum + 1;
    return (
      sum +
      Object.values(c.muniState).reduce((s2, m) => {
        if (m.checked) return s2 + 1;
        return (
          s2 +
          Object.values(m.barangayState).reduce((s3, b) => {
            if (b.checked) return s3 + 1;
            return s3 + Object.values(b.yearChecked).filter(Boolean).length;
          }, 0)
        );
      }, 0)
    );
  }, 0);

  function buildResults(): ProjectionResult[] {
    const results: ProjectionResult[] = [];
    for (const cState of Object.values(cenroState)) {
      const cLabel = String(cState.data.label);
      if (cState.checked) {
        results.push({
          key: `proj:cenro:${cState.data.id}`,
          meta: {
            query: { cenro_id: cState.data.id },
            label: `${cLabel} (all municipalities, all barangays, all years)`,
          },
        });
        continue;
      }
      for (const mState of Object.values(cState.muniState)) {
        const mLabel = String(mState.data.label);
        if (mState.checked) {
          results.push({
            key: `proj:muni:${mState.data.id}`,
            meta: {
              query: { municipality_id: mState.data.id },
              label: `${cLabel} · ${mLabel} (all barangays, all years)`,
            },
          });
          continue;
        }
        for (const bState of Object.values(mState.barangayState)) {
          const bLabel = String(bState.data.label);
          if (bState.checked) {
            results.push({
              key: `proj:brgy:${bState.data.id}`,
              meta: {
                query: { barangay_id: bState.data.id },
                label: `${cLabel} · ${mLabel}, ${bLabel} (all years)`,
              },
            });
            continue;
          }
          for (const [yearId, isChecked] of Object.entries(bState.yearChecked)) {
            if (!isChecked) continue;
            const yearNode = bState.years?.find((y) => String(y.id) === yearId);
            const yLabel = yearNode ? String(yearNode.label) : yearId;
            results.push({
              key: `year:${bState.data.id}:${yearId}`,
              meta: {
                query: { barangay_id: bState.data.id, year: yearId },
                label: `${cLabel} · ${mLabel}, ${bLabel}, ${yLabel}`,
              },
            });
          }
        }
      }
    }
    return results;
  }

  function handleApply() {
    const results = buildResults();
    if (results.length === 0) return;
    onApply(results);
  }

  return createPortal(
    <div className={`${uiFont.className} fixed inset-0 z-[200] flex items-center justify-center px-4`} style={vars}>
      <div className="absolute inset-0" style={{ background: theme.overlayBg }} onClick={onClose} />
      <div
        className="relative flex max-h-[80vh] w-full max-w-[440px] flex-col overflow-hidden rounded-[16px]"
        style={{ background: "var(--sb-bg-elevated)", boxShadow: theme.shadow }}
      >
        <div className="flex flex-shrink-0 items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${hairline}` }}>
          <Filter size={15} style={{ color: theme.accent }} />
          <h2 className="flex-1 text-[13.5px] font-bold text-[var(--sb-text)]">Project layers</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)]"
          >
            <X size={15} />
          </button>
        </div>

        <p className="flex-shrink-0 px-4 pt-2.5 text-[11.5px] leading-snug text-[var(--sb-text-faint)]">
          Pick any combination of CENROs, municipalities, barangays, and years to project onto the map
          at once. Checking a parent includes everything under it.
        </p>

        <div className="mb-1 mt-2.5 flex flex-shrink-0 items-center justify-between px-4">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">
            CENRO Offices
          </span>
          {cenros && cenros.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllCenros}
              className="border-0 bg-transparent p-0 text-[10.5px] font-semibold text-[var(--sb-accent)] hover:opacity-70"
            >
              {allCenroChecked ? "Clear all" : "Select all"}
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {cenros === null && (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--sb-text-faint)]">
              <Loader2 size={14} className="animate-spin" />
              Loading CENROs…
            </div>
          )}
          {cenros?.length === 0 && (
            <div className="px-2 py-6 text-center text-[12px] text-[var(--sb-text-faint)]">No saved lots yet.</div>
          )}
          {cenros?.map((c) => {
            const cState = ensureCenro(c);
            const cPartial = cenroPartial(cState);
            return (
              <div key={c.id} className="mb-0.5">
                <div className="flex items-center gap-2 rounded-[9px] px-1.5 py-[6px] transition-colors duration-100 hover:bg-[var(--sb-hover)]">
                  <button
                    type="button"
                    onClick={() => toggleCenroExpand(c)}
                    className="flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center text-[var(--sb-text-faint)]"
                  >
                    {cState.expanded ? <Minus size={11} /> : <Plus size={11} />}
                  </button>
                  <TriCheckbox
                    state={cState.checked ? "checked" : cPartial ? "partial" : "unchecked"}
                    onChange={() => toggleCenroChecked(c)}
                  />
                  <Landmark size={13} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--sb-text)]">
                    {c.label}
                  </span>
                  <span className="flex-shrink-0 tabular-nums text-[10.5px] text-[var(--sb-text-faint)]">
                    ({c.count})
                  </span>
                </div>

                {cState.expanded && (
                  <div className="ml-[27px]" style={{ borderLeft: `1px solid ${hairlineSoft}`, paddingLeft: 1 }}>
                    {cState.municipalities === null && (
                      <div className="px-2 py-2 text-[11px] text-[var(--sb-text-faint)]">Loading…</div>
                    )}
                    {cState.municipalities?.length === 0 && (
                      <div className="px-2 py-1 text-[11px] text-[var(--sb-text-faint)]">No municipalities.</div>
                    )}
                    {cState.municipalities?.map((m) => {
                      const mState: MunicipalityState =
                        cState.muniState[String(m.id)] ?? {
                          data: m,
                          checked: false,
                          expanded: false,
                          barangays: null,
                          barangayState: {},
                        };
                      const mPartial = muniPartial(mState);
                      return (
                        <div key={m.id} className="mb-0.5">
                          <div className="flex items-center gap-2 rounded-[9px] px-1.5 py-[5px] transition-colors duration-100 hover:bg-[var(--sb-hover)]">
                            <button
                              type="button"
                              onClick={() => toggleMuniExpand(c, m)}
                              disabled={cState.checked}
                              className="flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center text-[var(--sb-text-faint)] disabled:opacity-40"
                            >
                              {mState.expanded ? <Minus size={10} /> : <Plus size={10} />}
                            </button>
                            <TriCheckbox
                              state={mState.checked || cState.checked ? "checked" : mPartial ? "partial" : "unchecked"}
                              onChange={() => toggleMuniChecked(c, m)}
                              disabled={cState.checked}
                            />
                            <Building2 size={12} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--sb-text)]">
                              {m.label}
                            </span>
                            <span className="flex-shrink-0 tabular-nums text-[10px] text-[var(--sb-text-faint)]">
                              ({m.count})
                            </span>
                          </div>

                          {mState.expanded && !cState.checked && (
                            <div className="ml-[24px]" style={{ borderLeft: `1px solid ${hairlineSoft}`, paddingLeft: 1 }}>
                              {mState.barangays === null && (
                                <div className="px-2 py-1.5 text-[10.5px] text-[var(--sb-text-faint)]">Loading…</div>
                              )}
                              {mState.barangays?.length === 0 && (
                                <div className="px-2 py-1 text-[10.5px] text-[var(--sb-text-faint)]">
                                  No barangays.
                                </div>
                              )}
                              {mState.barangays?.map((b) => {
                                const bState: BarangayState =
                                  mState.barangayState[String(b.id)] ?? {
                                    data: b,
                                    checked: false,
                                    expanded: false,
                                    years: null,
                                    yearChecked: {},
                                  };
                                const bPartial = barangayPartial(bState);
                                const parentChecked = cState.checked || mState.checked;
                                return (
                                  <div key={b.id} className="mb-0.5">
                                    <div className="flex items-center gap-2 rounded-[8px] px-1.5 py-[4px] transition-colors duration-100 hover:bg-[var(--sb-hover)]">
                                      <button
                                        type="button"
                                        onClick={() => toggleBrgyExpand(c, m, b)}
                                        disabled={parentChecked}
                                        className="flex h-[13px] w-[13px] flex-shrink-0 items-center justify-center text-[var(--sb-text-faint)] disabled:opacity-40"
                                      >
                                        {bState.expanded ? <Minus size={9} /> : <Plus size={9} />}
                                      </button>
                                      <TriCheckbox
                                        state={
                                          bState.checked || parentChecked
                                            ? "checked"
                                            : bPartial
                                            ? "partial"
                                            : "unchecked"
                                        }
                                        onChange={() => toggleBrgyChecked(c, m, b)}
                                        disabled={parentChecked}
                                      />
                                      <MapPin size={11} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
                                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--sb-text)]">
                                        {b.label}
                                      </span>
                                      <span className="flex-shrink-0 tabular-nums text-[10px] text-[var(--sb-text-faint)]">
                                        ({b.count})
                                      </span>
                                    </div>

                                    {bState.expanded && !parentChecked && (
                                      <div
                                        className="ml-[22px]"
                                        style={{ borderLeft: `1px solid ${hairlineSoft}`, paddingLeft: 1 }}
                                      >
                                        {bState.years === null && (
                                          <div className="px-2 py-1.5 text-[10.5px] text-[var(--sb-text-faint)]">
                                            Loading…
                                          </div>
                                        )}
                                        {bState.years?.length === 0 && (
                                          <div className="px-2 py-1 text-[10.5px] text-[var(--sb-text-faint)]">
                                            No surveyed years.
                                          </div>
                                        )}
                                        {bState.years?.map((y) => (
                                          <div
                                            key={y.id}
                                            className="flex items-center gap-2 rounded-[8px] px-1.5 py-[4px] transition-colors duration-100 hover:bg-[var(--sb-hover)]"
                                          >
                                            <TriCheckbox
                                              state={
                                                bState.checked || !!bState.yearChecked[String(y.id)]
                                                  ? "checked"
                                                  : "unchecked"
                                              }
                                              onChange={() => toggleYearChecked(c, m, b, y)}
                                              disabled={bState.checked}
                                            />
                                            <CalendarDays size={11} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
                                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--sb-text)]">
                                              {y.label}
                                            </span>
                                            <span className="flex-shrink-0 tabular-nums text-[10px] text-[var(--sb-text-faint)]">
                                              ({y.count})
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${hairline}` }}>
          <span className="text-[11.5px] text-[var(--sb-text-faint)]">
            {totalSelectedCount} {totalSelectedCount === 1 ? "selection" : "selections"} picked
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border-0 bg-[var(--sb-hover)] px-3 py-[7px] text-[11.5px] font-semibold text-[var(--sb-text-muted)] transition-opacity duration-100 hover:opacity-80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={totalSelectedCount === 0}
              className="rounded-full border-0 px-3.5 py-[7px] text-[11.5px] font-semibold text-white transition-opacity duration-100 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: theme.accent }}
            >
              Project{totalSelectedCount > 0 ? ` (${totalSelectedCount})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
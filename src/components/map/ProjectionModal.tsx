"use client";

// Target path: src/components/map/ProjectionModal.tsx
//
// 5 VISUAL TABS, 6 UNDERLYING FACETS: CENRO, Municipality, Barangay, Year
// are each a single facet with their own tab. The 5th tab, "Class / Type",
// is a SINGLE TAB that holds TWO independent facets stacked as two
// sections — Classification (RFPA/FPA) and Survey Plan Type (CSD/CCS/...). They
// were split into two tabs originally, but Classification only ever has
// two options, so a whole tab for it was overkill — this pass merges them
// into one tab for a tighter, single-row 5-tab strip instead of a 3x2 grid.
//
// IMPORTANT: merging them into one TAB does not merge them into one FACET.
// Classification and Survey Plan Type remain two separate facet keys
// (`classifications`, `prefixes`) with independent selections, independent
// option lists, and independent cross-filtering — exactly as before. The
// only thing that changed is which tab button you click to reach them and
// how they're laid out once you're there (two headed sections in the same
// scrollable panel instead of two separate tab panels). See the FACETS
// note below for why they stay separate facets rather than one merged
// list.
//
// FULL CROSS-FILTERING still applies across all SIX facets, regardless of
// which are sharing a tab. e.g. check "2023" in Year, then switch to
// Class/Type — you'll only see RFPA/FPA options AND CSD/CCS options that
// actually have lots surveyed in 2023. Check "RFPA" in the Classification
// section, and the Survey Plan Type section right below it (same tab) narrows to
// only prefixes that have at least one RFPA-classified lot too — sections
// within the same tab cross-filter each other exactly like separate tabs
// would, since under the hood they're still two separate facet params.
//
// CLASSIFICATION: not backed by a real table — RFPA/FPA is derived per-lot
// from area_sqm vs. the area_classification_rules threshold that applies
// to that lot's municipality (a municipality-level override if one
// exists, else its CENRO's default), via the DB's get_rfpa_threshold()
// function.
//
// Survey Plan Type: also not backed by a real table. The leading letter code is
// parsed off each lot's survey_no (e.g. "CSD-AF-02-015244" -> "CSD"),
// uppercased for consistency since raw survey_no casing is inconsistent in
// the data. Unlike Classification, this isn't a fixed two-value enum —
// whichever prefixes actually exist in the DB (CSD, CCS today; others as
// they show up) are returned by the facets endpoint, exactly like Year's
// dynamic list. Lots whose survey_no is missing/blank/doesn't start with a
// letter are excluded entirely rather than guessed into a bucket. See
// route.ts's file-top note for the full derivation of both.
//
// WHY TWO SECTIONS INSTEAD OF ONE MERGED LIST: RFPA/FPA and CSD/CCS answer
// two unrelated questions about a lot (its size-based classification vs.
// its plan's letter code) — a lot can independently be RFPA-and-CSD,
// RFPA-and-CCS, FPA-and-CSD, etc. Merging them into a single flat
// checkbox list would make "check RFPA" and "check CSD" look like
// mutually-exclusive alternatives in one list, when they're actually two
// independent AND-able filters (classification IN (...) AND prefix IN
// (...), same as every other facet pair). Two clearly-labeled sections
// keeps that AND relationship visible instead of implying an OR that
// isn't there.
//
// What "Project" produces: combines everything checked across all 6
// facets into a single AND filter:
//
//   cenro IN (checked cenros)
//   AND municipality IN (checked municipalities)
//   AND barangay IN (checked barangays)
//   AND year IN (checked years)
//   AND classification IN (checked classifications)
//   AND prefix IN (checked Survey Plan Types)
//
// (any facet left empty is just omitted from the AND — checking nothing in
// a facet means "don't filter on that facet at all", not "match nothing").
//
// Each Project adds ONE new entry to the sidebar's activeSelections (keyed
// `filter:<timestamp>:<random>`) — same mechanism as a single year pick or
// a search result today, so multiple saved filter-sets can coexist and be
// toggled/removed independently, same as multiple layers could before.
//
// REPORTING: a second button, "Generate Report", builds the exact same
// combined facet query as Project but instead of applying it to the map,
// opens /reports/lots?<query>&label=<filterLabel> in a new tab. That report
// page hits /api/map/lots with the identical params, so "what's on the
// map" and "what's in the report" always share one query contract — see
// route.ts's file-top note and src/app/reports/lots/page.tsx.
//
// Cross-filter fetching: a facet's option list is only fetched when the
// user switches TO the tab it lives in (not on every checkbox click),
// since checking/unchecking items within a facet never changes that
// facet's own list (a facet is never filtered by itself — see route.ts's
// file-top note on why). Switching tabs re-fetches every facet that lives
// in the newly-active tab (one fetch each — two fetches for Class/Type,
// one for every other tab), using whatever is checked right now across
// ALL SIX facets, not just the ones belonging to the tab being switched to.
//
// Fetches from /api/map/tree?level=facets&target=<facet>&cenro_ids=...
// &municipality_ids=...&barangay_ids=...&years=...&classifications=...
// &prefixes=... — see route.ts. `target` is always a single facet key
// (e.g. "classifications" or "prefixes"), even when both live in the same
// tab — the two sections in Class/Type are fetched as two separate
// requests, not one combined one.
//
// Rendered via createPortal to document.body (same pattern as Sidebar's
// Tooltip) so it's never clipped by the sidebar's own overflow, and reads
// theme colors via useSidebarTheme() -- which works fine through a portal
// since React context follows the component tree, not the DOM tree.
//
// RESPONSIVE / FIXED-SIZE: the dialog uses a fixed height
// (`h-[min(620px,85vh)]`) instead of `max-h-[...]`, so it doesn't grow or
// shrink depending on how many rows the active tab happens to have — only
// the section list(s) scroll internally. The shell also picks up side
// margins and the footer buttons stack on narrow screens so three actions
// never overflow a phone-width viewport.
//
// TAB LAYOUT: back to a single-row strip of 5 equal-width tabs (same
// pill-shaped strip as before Survey Plan Type existed), since merging
// Classification and Survey Plan Type into one tab keeps the count at 5 instead
// of 6 — no more need for the 3x2 grid a 6th standalone tab would've
// required.
//
// SECTION HEADERS: each facet section (Classification, Survey Plan Type, and
// also CENRO/Municipality/Barangay/Year's single section) now scrolls
// together with its checkbox list inside the same scrollable panel,
// rather than living in a header row fixed above the list. This is what
// makes room for two headed sections to stack inside one tab without a
// second independently-scrolling region — the dialog's fixed outer height
// still doesn't change, only what's allowed to scroll shifted from
// "just the list" to "header + list together" for every tab, single- or
// multi-facet alike, so the behavior stays consistent across all 5 tabs.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Filter,
  Landmark,
  Building2,
  MapPin,
  CalendarDays,
  Scale,
  Tag,
  Check,
  Loader2,
  FileText,
} from "lucide-react";
import type { TreeNodeData, SelectionMeta } from "@/lib/geo";
import { useSidebarTheme } from "./SidebarThemeContext";
import { uiFont } from "./sidebarTheme";

// FacetKey: the six underlying, independently-fetched/filtered facets.
// Unchanged in count/shape from before this pass -- only how they're
// grouped into tabs (below) changed.
type FacetKey = "cenros" | "municipalities" | "barangays" | "years" | "classifications" | "prefixes";

// TabId: the five VISUAL tabs the user clicks between. "classAndType" is
// the one tab that maps to two facets (see file-top note).
type TabId = "cenros" | "municipalities" | "barangays" | "years" | "classAndType";

interface FacetDef {
  key: FacetKey;
  queryParam: string;
  // Section header shown above this facet's checkbox list. For
  // single-facet tabs this is the only header in the tab (equivalent to
  // the old `fullLabel`); for classAndType it's what distinguishes the
  // two stacked sections from each other.
  sectionLabel: string;
  icon: typeof Landmark;
}

interface TabDef {
  id: TabId;
  // Short label shown on the tab button itself.
  label: string;
  // Icon shown on the tab button itself.
  icon: typeof Landmark;
  // One facet for every tab except classAndType, which holds two.
  facets: FacetDef[];
}

const TABS: TabDef[] = [
  {
    id: "cenros",
    label: "CENRO",
    icon: Landmark,
    facets: [{ key: "cenros", queryParam: "cenro_ids", sectionLabel: "CENRO", icon: Landmark }],
  },
  {
    id: "municipalities",
    label: "Municipality",
    icon: Building2,
    facets: [
      { key: "municipalities", queryParam: "municipality_ids", sectionLabel: "Municipality", icon: Building2 },
    ],
  },
  {
    id: "barangays",
    label: "Barangay",
    icon: MapPin,
    facets: [{ key: "barangays", queryParam: "barangay_ids", sectionLabel: "Barangay", icon: MapPin }],
  },
  {
    id: "years",
    label: "Year",
    icon: CalendarDays,
    facets: [{ key: "years", queryParam: "years", sectionLabel: "Year", icon: CalendarDays }],
  },
  {
    id: "classAndType",
    label: "Class / Type",
    icon: Scale,
    facets: [
      { key: "classifications", queryParam: "classifications", sectionLabel: "Classification", icon: Scale },
      { key: "prefixes", queryParam: "prefixes", sectionLabel: "Survey Plan Type", icon: Tag },
    ],
  },
];

// Flat list of all six facets across all five tabs -- used whenever code
// needs to iterate "every facet" regardless of tab grouping (building
// fetch params from current selections, computing totals, etc).
const ALL_FACETS: FacetDef[] = TABS.flatMap((t) => t.facets);

type SelectedMap = Record<FacetKey, Map<string, TreeNodeData>>;

function emptySelected(): SelectedMap {
  return {
    cenros: new Map(),
    municipalities: new Map(),
    barangays: new Map(),
    years: new Map(),
    classifications: new Map(),
    prefixes: new Map(),
  };
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

function ItemCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4.5px] border-0 transition-colors"
      style={{
        border: `1px solid ${checked ? "var(--sb-accent)" : "var(--sb-border)"}`,
        background: checked ? "var(--sb-accent)" : "var(--sb-bg)",
      }}
    >
      {checked && <Check size={11} strokeWidth={3} color="white" />}
    </button>
  );
}

function pluralize(n: number, singular: string, plural: string) {
  return n === 1 ? singular : plural;
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
  const [activeTab, setActiveTab] = useState<TabId>("cenros");
  const [selected, setSelected] = useState<SelectedMap>(emptySelected());
  const [options, setOptions] = useState<Record<FacetKey, TreeNodeData[] | null>>({
    cenros: null,
    municipalities: null,
    barangays: null,
    years: null,
    classifications: null,
    prefixes: null,
  });

  useEffect(() => setMounted(true), []);

  // Fresh slate every time the modal opens.
  useEffect(() => {
    if (open) {
      setSelected(emptySelected());
      setOptions({
        cenros: null,
        municipalities: null,
        barangays: null,
        years: null,
        classifications: null,
        prefixes: null,
      });
      setActiveTab("cenros");
    }
  }, [open]);

  // Fetch every facet that lives in the active tab whenever the modal is
  // open and the active tab changes -- deliberately NOT re-fetched on
  // every checkbox click, since a facet's own selections never filter its
  // own list (see file-top note). Switching tabs is the only time
  // cross-filtering needs a fresh fetch, and it always uses whatever is
  // checked right now across ALL SIX facets (via ALL_FACETS below), not
  // just the ones belonging to the tab being switched to.
  //
  // For classAndType this fires two fetches (classifications, prefixes)
  // in parallel -- each targets its own facet and is filtered by every
  // OTHER facet including its sibling section, so checking something in
  // Classification still narrows the Survey Plan Type list right below it, and
  // vice versa.
  useEffect(() => {
    if (!open) return;
    const activeTabDef = TABS.find((t) => t.id === activeTab);
    if (!activeTabDef) return;

    setOptions((prev) => {
      const next = { ...prev };
      for (const facet of activeTabDef.facets) next[facet.key] = null;
      return next;
    });

    for (const facet of activeTabDef.facets) {
      const params = new URLSearchParams();
      params.set("level", "facets");
      params.set("target", facet.key);
      for (const f of ALL_FACETS) {
        const ids = Array.from(selected[f.key].keys());
        if (ids.length > 0) params.set(f.queryParam, ids.join(","));
      }
      safeFetchArray(`/api/map/tree?${params.toString()}`).then((data) => {
        setOptions((prev) => ({ ...prev, [facet.key]: data }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab]);

  function toggleItem(facetKey: FacetKey, item: TreeNodeData) {
    setSelected((prev) => {
      const next = new Map(prev[facetKey]);
      const key = String(item.id);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return { ...prev, [facetKey]: next };
    });
  }

  function toggleSelectAll(facetKey: FacetKey) {
    const opts = options[facetKey];
    if (!opts || opts.length === 0) return;
    setSelected((prev) => {
      const next = new Map(prev[facetKey]);
      const allChecked = opts.every((o) => next.has(String(o.id)));
      if (allChecked) {
        for (const o of opts) next.delete(String(o.id));
      } else {
        for (const o of opts) next.set(String(o.id), o);
      }
      return { ...prev, [facetKey]: next };
    });
  }

  const totalSelectedCount =
    selected.cenros.size +
    selected.municipalities.size +
    selected.barangays.size +
    selected.years.size +
    selected.classifications.size +
    selected.prefixes.size;

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (selected.cenros.size > 0) {
      parts.push(
        selected.cenros.size === 1
          ? String(Array.from(selected.cenros.values())[0].label)
          : `${selected.cenros.size} CENROs`
      );
    }
    if (selected.municipalities.size > 0) {
      parts.push(
        selected.municipalities.size === 1
          ? String(Array.from(selected.municipalities.values())[0].label)
          : `${selected.municipalities.size} ${pluralize(selected.municipalities.size, "Municipality", "Municipalities")}`
      );
    }
    if (selected.barangays.size > 0) {
      parts.push(
        selected.barangays.size === 1
          ? String(Array.from(selected.barangays.values())[0].label)
          : `${selected.barangays.size} ${pluralize(selected.barangays.size, "Barangay", "Barangays")}`
      );
    }
    if (selected.years.size > 0) {
      parts.push(
        Array.from(selected.years.values())
          .map((y) => String(y.label))
          .sort()
          .join(", ")
      );
    }
    if (selected.classifications.size > 0) {
      // Only ever RFPA/FPA, so no pluralization/count-collapsing needed —
      // just show both if both are checked, same as Year's short list.
      parts.push(
        Array.from(selected.classifications.values())
          .map((c) => String(c.label))
          .sort()
          .join(", ")
      );
    }
    if (selected.prefixes.size > 0) {
      // Same short-list treatment as Classification/Year — plan-type codes
      // are short (CSD, CCS, ...), so just list them all rather than
      // collapsing to a count.
      parts.push(
        Array.from(selected.prefixes.values())
          .map((p) => String(p.label))
          .sort()
          .join(", ")
      );
    }
    return parts.length > 0 ? parts.join(" · ") : "No filters selected yet";
  }, [selected]);

  if (!mounted || !open) return null;

  // Shared by both "Project" (applies to the map) and "Generate Report"
  // (opens the printable report in a new tab) — both need the exact same
  // combined facet query, just delivered to a different place.
  //
  // classifications and prefixes are the two facets whose ids are strings
  // ("RFPA"/"FPA", "CSD"/"CCS"/...) rather than numeric DB ids.
  // SelectionMeta['query'] (see geo.ts) only allows `string | number |
  // number[]` per key -- a mixed `(string | number)[]` isn't a valid value
  // there -- so both are passed as a single comma-joined STRING (e.g.
  // "RFPA,FPA", "CSD,CCS") rather than an array, same shape as any other
  // single-string query value. handleGenerateReport below already treats
  // string values as a single already-joined param. Sharing a tab in the
  // UI has no bearing on this -- they're still two separate query keys.
  function buildFacetQuery(): { query: Record<string, string | number | number[]>; label: string } {
    const query: Record<string, string | number | number[]> = {};
    if (selected.cenros.size > 0) query.cenro_ids = Array.from(selected.cenros.keys()).map(Number);
    if (selected.municipalities.size > 0)
      query.municipality_ids = Array.from(selected.municipalities.keys()).map(Number);
    if (selected.barangays.size > 0) query.barangay_ids = Array.from(selected.barangays.keys()).map(Number);
    if (selected.years.size > 0) query.years = Array.from(selected.years.keys()).map(Number);
    if (selected.classifications.size > 0)
      query.classifications = Array.from(selected.classifications.keys()).join(",");
    if (selected.prefixes.size > 0) query.prefixes = Array.from(selected.prefixes.keys()).join(",");
    return { query, label: filterLabel };
  }

  function handleApply() {
    if (totalSelectedCount === 0) return;
    const { query, label } = buildFacetQuery();
    const key = `filter:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    onApply([{ key, meta: { query, label } }]);
  }

  function handleGenerateReport() {
    if (totalSelectedCount === 0) return;
    const { query, label } = buildFacetQuery();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      // value is number[] for every facet except classifications/prefixes,
      // which are already single comma-joined strings (see
      // buildFacetQuery) -- guard on Array.isArray rather than assuming
      // .join exists on every value.
      if (Array.isArray(value)) {
        if (value.length > 0) params.set(key, value.join(","));
      } else if (value !== "" && value != null) {
        params.set(key, String(value));
      }
    }
    params.set("label", label);
    window.open(`/reports/lots?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  const activeTabDef = TABS.find((t) => t.id === activeTab)!;

  return createPortal(
    <div className={`${uiFont.className} fixed inset-0 z-[200] flex items-center justify-center px-3 sm:px-4`} style={vars}>
      <div className="absolute inset-0" style={{ background: theme.overlayBg }} onClick={onClose} />
      <div
        className="relative flex h-[min(620px,85vh)] w-[calc(100%-1.5rem)] max-w-[440px] flex-col overflow-hidden rounded-[16px] sm:w-full"
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

        <p className="flex-shrink-0 px-4 pt-2.5 text-[11px] leading-snug text-[var(--sb-text-faint)] sm:text-[11.5px]">
          Pick any combination across the tabs below. Project applies the combined filter to the map; Generate Report opens a printable report in a new tab.
        </p>

        {/* Tabs — back to a single row of 5 (Class/Type merged into one
            tab, see file-top note), so this is the same pill-strip shape
            used before Survey Plan Type existed. */}
        <div className="mx-3 mt-3 flex flex-shrink-0 items-center gap-1 rounded-full bg-[var(--sb-hover)] p-1 sm:mx-4">
          {TABS.map((tab) => {
            const count = tab.facets.reduce((sum, f) => sum + selected[f.key].size, 0);
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-full border-0 px-1 py-[6px] text-[9px] font-semibold transition-colors duration-100 sm:px-1.5 sm:text-[10px] ${
                  activeTab === tab.id
                    ? "bg-[var(--sb-bg)] text-[var(--sb-accent)] shadow-sm"
                    : "bg-transparent text-[var(--sb-text-muted)] hover:text-[var(--sb-text)]"
                }`}
              >
                <Icon size={12} className="flex-shrink-0" />
                <span className="truncate">{tab.label}</span>
                {count > 0 && (
                  <span
                    className={`flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums ${
                      activeTab === tab.id ? "bg-[var(--sb-accent)] text-white" : "bg-[var(--sb-border)] text-[var(--sb-text-muted)]"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active tab's section(s) — every facet in the active tab renders
            its own header (section label + select-all) followed by its
            checkbox list, all inside ONE scrollable region so the dialog's
            outer height never changes with content. Single-facet tabs
            (CENRO/Municipality/Barangay/Year) render exactly one section
            here; Class/Type renders two stacked back to back. */}
        <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {activeTabDef.facets.map((facet, i) => {
            const opts = options[facet.key];
            const selMap = selected[facet.key];
            const allChecked = !!opts && opts.length > 0 && opts.every((o) => selMap.has(String(o.id)));
            const Icon = facet.icon;
            return (
              <div key={facet.key} className={i > 0 ? "mt-3" : undefined}>
                <div className="mb-1 flex items-center justify-between px-1.5 sm:px-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">
                    {facet.sectionLabel}
                  </span>
                  {opts && opts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleSelectAll(facet.key)}
                      className="border-0 bg-transparent p-0 text-[10.5px] font-semibold text-[var(--sb-accent)] hover:opacity-70"
                    >
                      {allChecked ? "Clear all" : "Select all"}
                    </button>
                  )}
                </div>

                {opts === null && (
                  <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--sb-text-faint)]">
                    <Loader2 size={14} className="animate-spin" />
                    Loading…
                  </div>
                )}
                {opts?.length === 0 && (
                  <div className="px-2 py-6 text-center text-[12px] text-[var(--sb-text-faint)]">
                    No matches with the current filters.
                  </div>
                )}
                {opts?.map((item) => {
                  const checked = selMap.has(String(item.id));
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleItem(facet.key, item)}
                      className="mb-0.5 flex cursor-pointer items-center gap-2 rounded-[9px] px-1.5 py-[7px] transition-colors duration-100 hover:bg-[var(--sb-hover)]"
                    >
                      <ItemCheckbox checked={checked} onChange={() => toggleItem(facet.key, item)} />
                      <Icon size={13} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--sb-text)]">
                        {item.label}
                      </span>
                      <span className="flex-shrink-0 tabular-nums text-[10.5px] text-[var(--sb-text-faint)]">
                        ({item.count})
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer — stacks vertically on narrow screens so three actions
            (Cancel / Generate Report / Project) never fight for space on a
            phone-width dialog. */}
        <div className="flex flex-shrink-0 flex-col gap-2 px-3 py-3 sm:px-4" style={{ borderTop: `1px solid ${hairline}` }}>
          <span className="truncate text-[11px] text-[var(--sb-text-faint)]" title={filterLabel}>
            {filterLabel}
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-[11.5px] text-[var(--sb-text-faint)]">
              {totalSelectedCount} {pluralize(totalSelectedCount, "filter", "filters")} checked
            </span>
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border-0 bg-[var(--sb-hover)] px-3 py-[7px] text-[11.5px] font-semibold text-[var(--sb-text-muted)] transition-opacity duration-100 hover:opacity-80 sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={totalSelectedCount === 0}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border-0 bg-[var(--sb-hover)] px-3 py-[7px] text-[11.5px] font-semibold text-[var(--sb-text)] transition-opacity duration-100 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5"
              >
                <FileText size={12} className="flex-shrink-0" />
                <span className="hidden sm:inline">Generate </span>
                <span>Report</span>
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={totalSelectedCount === 0}
                className="flex-1 rounded-full border-0 px-3 py-[7px] text-[11.5px] font-semibold text-white transition-opacity duration-100 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5"
                style={{ background: theme.accent }}
              >
                Project
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
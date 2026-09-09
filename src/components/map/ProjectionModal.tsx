"use client";

// Target path: src/components/map/ProjectionModal.tsx
//
// REBUILT AS TABS: this used to be a single nested checkbox tree
// (CENRO -> Municipality -> Barangay -> Year). It's now 4 flat tabs —
// CENRO, Municipality, Barangay, Year — each just a checkbox list for that
// level, with FULL CROSS-FILTERING between them: whichever tab you're
// looking at is always narrowed by whatever's checked in the other three.
// e.g. check "2023" in the Year tab, then switch to Municipality — you'll
// only see municipalities that actually have lots surveyed in 2023.
//
// What "Project" produces: combines everything checked across all 4 tabs
// into a single AND filter:
//
//   cenro IN (checked cenros)
//   AND municipality IN (checked municipalities)
//   AND barangay IN (checked barangays)
//   AND year IN (checked years)
//
// (any facet left empty is just omitted from the AND — checking nothing in
// a tab means "don't filter on that facet at all", not "match nothing").
//
// Each Project adds ONE new entry to the sidebar's activeSelections (keyed
// `filter:<timestamp>:<random>`) — same mechanism as a single year pick or
// a search result today, so multiple saved filter-sets can coexist and be
// toggled/removed independently, same as multiple layers could before.
//
// REPORTING (this pass): a second button, "Generate Report", builds the
// exact same combined facet query as Project but instead of applying it to
// the map, opens /reports/lots?<query>&label=<filterLabel> in a new tab.
// That report page hits /api/map/lots with the identical params, so "what's
// on the map" and "what's in the report" always share one query contract —
// see route.ts's file-top note and src/app/reports/lots/page.tsx.
//
// Cross-filter fetching: a tab's option list is only fetched when the user
// switches TO it (not on every checkbox click), since checking/unchecking
// items within a tab never changes that tab's own list (a facet is never
// filtered by itself — see route.ts's file-top note on why). Switching
// tabs re-fetches using whatever's checked everywhere else at that moment.
//
// Fetches from /api/map/tree?level=facets&target=<level>&cenro_ids=...
// &municipality_ids=...&barangay_ids=...&years=... — see route.ts.
//
// Rendered via createPortal to document.body (same pattern as Sidebar's
// Tooltip) so it's never clipped by the sidebar's own overflow, and reads
// theme colors via useSidebarTheme() -- which works fine through a portal
// since React context follows the component tree, not the DOM tree.
//
// RESPONSIVE / FIXED-SIZE PASS: the dialog now uses a fixed height
// (`h-[min(620px,85vh)]`) instead of `max-h-[...]`, so it no longer grows
// or shrinks depending on how many rows the active tab happens to have —
// only the checkbox list scrolls internally. The shell also picks up side
// margins and the footer buttons stack on narrow screens so three actions
// never overflow a phone-width viewport.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Filter, Landmark, Building2, MapPin, CalendarDays, Check, Loader2, FileText } from "lucide-react";
import type { TreeNodeData, SelectionMeta } from "@/lib/geo";
import { useSidebarTheme } from "./SidebarThemeContext";
import { uiFont } from "./sidebarTheme";

type FacetKey = "cenros" | "municipalities" | "barangays" | "years";

const TABS: { key: FacetKey; label: string; icon: typeof Landmark; queryParam: string }[] = [
  { key: "cenros", label: "CENRO", icon: Landmark, queryParam: "cenro_ids" },
  { key: "municipalities", label: "Municipality", icon: Building2, queryParam: "municipality_ids" },
  { key: "barangays", label: "Barangay", icon: MapPin, queryParam: "barangay_ids" },
  { key: "years", label: "Year", icon: CalendarDays, queryParam: "years" },
];

type SelectedMap = Record<FacetKey, Map<string, TreeNodeData>>;

function emptySelected(): SelectedMap {
  return { cenros: new Map(), municipalities: new Map(), barangays: new Map(), years: new Map() };
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
  const [activeTab, setActiveTab] = useState<FacetKey>("cenros");
  const [selected, setSelected] = useState<SelectedMap>(emptySelected());
  const [options, setOptions] = useState<Record<FacetKey, TreeNodeData[] | null>>({
    cenros: null,
    municipalities: null,
    barangays: null,
    years: null,
  });

  useEffect(() => setMounted(true), []);

  // Fresh slate every time the modal opens.
  useEffect(() => {
    if (open) {
      setSelected(emptySelected());
      setOptions({ cenros: null, municipalities: null, barangays: null, years: null });
      setActiveTab("cenros");
    }
  }, [open]);

  // Fetch the active tab's option list whenever the modal is open and the
  // active tab changes -- deliberately NOT re-fetched on every checkbox
  // click, since a tab's own selections never filter its own list (see
  // file-top note). Switching tabs is the only time cross-filtering needs
  // a fresh fetch, and it always uses whatever is checked right now in the
  // other three tabs.
  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams();
    params.set("level", "facets");
    params.set("target", activeTab);
    for (const tab of TABS) {
      const ids = Array.from(selected[tab.key].keys());
      if (ids.length > 0) params.set(tab.queryParam, ids.join(","));
    }
    setOptions((prev) => ({ ...prev, [activeTab]: null }));
    safeFetchArray(`/api/map/tree?${params.toString()}`).then((data) => {
      setOptions((prev) => ({ ...prev, [activeTab]: data }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab]);

  function toggleItem(tab: FacetKey, item: TreeNodeData) {
    setSelected((prev) => {
      const next = new Map(prev[tab]);
      const key = String(item.id);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return { ...prev, [tab]: next };
    });
  }

  function toggleSelectAll(tab: FacetKey) {
    const opts = options[tab];
    if (!opts || opts.length === 0) return;
    setSelected((prev) => {
      const next = new Map(prev[tab]);
      const allChecked = opts.every((o) => next.has(String(o.id)));
      if (allChecked) {
        for (const o of opts) next.delete(String(o.id));
      } else {
        for (const o of opts) next.set(String(o.id), o);
      }
      return { ...prev, [tab]: next };
    });
  }

  const totalSelectedCount =
    selected.cenros.size + selected.municipalities.size + selected.barangays.size + selected.years.size;

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
    return parts.length > 0 ? parts.join(" · ") : "No filters selected yet";
  }, [selected]);

  if (!mounted || !open) return null;

  // Shared by both "Project" (applies to the map) and "Generate Report"
  // (opens the printable report in a new tab) — both need the exact same
  // combined facet query, just delivered to a different place.
  function buildFacetQuery(): { query: Record<string, number[]>; label: string } {
    const query: Record<string, number[]> = {};
    if (selected.cenros.size > 0) query.cenro_ids = Array.from(selected.cenros.keys()).map(Number);
    if (selected.municipalities.size > 0)
      query.municipality_ids = Array.from(selected.municipalities.keys()).map(Number);
    if (selected.barangays.size > 0) query.barangay_ids = Array.from(selected.barangays.keys()).map(Number);
    if (selected.years.size > 0) query.years = Array.from(selected.years.keys()).map(Number);
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
    for (const [key, ids] of Object.entries(query)) {
      if (ids.length > 0) params.set(key, ids.join(","));
    }
    params.set("label", label);
    window.open(`/reports/lots?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  const activeOptions = options[activeTab];
  const activeSelectedMap = selected[activeTab];
  const allChecked = !!activeOptions && activeOptions.length > 0 && activeOptions.every((o) => activeSelectedMap.has(String(o.id)));

  return createPortal(
    <div className={`${uiFont.className} fixed inset-0 z-[200] flex items-center justify-center px-3 sm:px-4`} style={vars}>
      <div className="absolute inset-0" style={{ background: theme.overlayBg }} onClick={onClose} />
      <div
        // FIXED HEIGHT: was `max-h-[80vh]`, which let the dialog shrink to
        // fit whatever the active tab's list happened to contain. Using an
        // explicit height (clamped to the viewport on short screens) keeps
        // the dialog's outer shape constant no matter how many rows are
        // loaded — only the list body scrolls.
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

        {/* Tabs */}
        <div className="mx-3 mt-3 flex flex-shrink-0 items-center gap-1 rounded-full bg-[var(--sb-hover)] p-1 sm:mx-4">
          {TABS.map((tab) => {
            const count = selected[tab.key].size;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-full border-0 px-1 py-[6px] text-[9.5px] font-semibold transition-colors duration-100 sm:px-1.5 sm:text-[10.5px] ${
                  activeTab === tab.key
                    ? "bg-[var(--sb-bg)] text-[var(--sb-accent)] shadow-sm"
                    : "bg-transparent text-[var(--sb-text-muted)] hover:text-[var(--sb-text)]"
                }`}
              >
                <Icon size={12} className="flex-shrink-0" />
                <span className="truncate">{tab.label}</span>
                {count > 0 && (
                  <span
                    className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums ${
                      activeTab === tab.key ? "bg-[var(--sb-accent)] text-white" : "bg-[var(--sb-border)] text-[var(--sb-text-muted)]"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Select all / clear for the active tab */}
        <div className="mb-1 mt-2.5 flex flex-shrink-0 items-center justify-between px-3 sm:px-4">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-faint)]">
            {TABS.find((t) => t.key === activeTab)?.label}
          </span>
          {activeOptions && activeOptions.length > 0 && (
            <button
              type="button"
              onClick={() => toggleSelectAll(activeTab)}
              className="border-0 bg-transparent p-0 text-[10.5px] font-semibold text-[var(--sb-accent)] hover:opacity-70"
            >
              {allChecked ? "Clear all" : "Select all"}
            </button>
          )}
        </div>

        {/* Active tab's checkbox list — the only scrollable region, so the
            dialog's outer height (set above) never changes with content. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {activeOptions === null && (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--sb-text-faint)]">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          )}
          {activeOptions?.length === 0 && (
            <div className="px-2 py-6 text-center text-[12px] text-[var(--sb-text-faint)]">
              No matches with the current filters.
            </div>
          )}
          {activeOptions?.map((item) => {
            const checked = activeSelectedMap.has(String(item.id));
            const Icon = TABS.find((t) => t.key === activeTab)!.icon;
            return (
              <div
                key={item.id}
                onClick={() => toggleItem(activeTab, item)}
                className="mb-0.5 flex cursor-pointer items-center gap-2 rounded-[9px] px-1.5 py-[7px] transition-colors duration-100 hover:bg-[var(--sb-hover)]"
              >
                <ItemCheckbox checked={checked} onChange={() => toggleItem(activeTab, item)} />
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
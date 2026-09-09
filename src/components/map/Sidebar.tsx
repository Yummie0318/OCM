"use client";

// Target path: src/components/map/Sidebar.tsx
//
// MUNICIPALITY CHECKBOX PROJECTION (this pass): added a small checkbox
// right after the +/- expand icon on each MunicipalityNode row (see the
// new `showCheckbox`/`checked`/`onCheckToggle` props on FolderRow). This
// is a shortcut for "project this whole municipality" without opening
// ProjectionModal or drilling into barangays/years one at a time.
//
// It revives the `proj:muni:<id>` key shape that SelectedPanel already had
// icon-handling for (see isProjMuni below) but that nothing was actually
// producing anymore once ProjectionModal moved to its combined multi-facet
// `filter:<timestamp>:<random>` keys. Checking the box calls the same
// `onToggle` prop as everything else in this tree:
//
//   onToggle(`proj:muni:${node.id}`, {
//     query: { municipality_id: node.id },
//     label: "<Municipality> (all barangays, all years)",
//   })
//
// map/page.tsx's generic activeSelections fetch effect picks this up like
// any other selection, serializes `{ municipality_id }` into
// `?municipality_id=<id>`, and hits /api/map/lots — which already has a
// legacy branch for a bare `municipality_id` param, returning every lot
// under that municipality regardless of barangay/year. Unchecking (or
// hitting the X on the row in the Selected tab) calls
// onToggle(key, null), same teardown path as every other selection.
//
// Clicking the checkbox stops propagation so it doesn't also trigger the
// row's onToggle (which expands/collapses the barangay branch) — expanding
// the tree and projecting the whole municipality are independent actions.
//
// A municipality can have a lot of lots — /api/map/lots caps results at
// MAX_FEATURES (2000) and flags `truncated: true` past that, which the
// map page already surfaces as a warning banner, so a very large
// municipality just shows that same "narrow your selection" notice
// instead of silently dropping data.
//
// DOWNLOAD LAYER (earlier pass): added a Download icon button to each row in
// the "Selected" tab (SelectedPanel), alongside the existing view-in-table
// (Table2) and remove (X) actions. Clicking it calls the new
// `onDownloadLayer(key)` prop — Sidebar itself has no access to a layer's
// actual feature geometry (it only ever sees activeSelections' {query,
// label} metadata), so it just reports the click and lets the map page
// (which owns `layerData`) open DownloadLayerModal with that key's
// features. Same "Sidebar reports, page decides" pattern as onViewLayer.
//
// PROJECTION MODAL (earlier pass): added a "Project" button to the top of
// the Layers tab's tree (next to the "Municipalities" heading), which opens
// <ProjectionModal /> — a checkbox tree that lets the user pick several
// municipalities / barangays / years at once instead of drilling through
// the tree branch-by-branch. See ProjectionModal.tsx's own file-top
// comment for exactly which key/query shape each kind of pick produces.
// Applying the modal just calls the existing `onToggle` prop once per
// pick (handleApplyProjection below) — this component and map/page.tsx
// don't need to know anything special happened; it's the same code path
// as checking a year checkbox or picking a search result.
//
// NOTIFICATION ANCHOR (earlier pass): added `data-notification-anchor="true"`
// to both root <div>s (collapsed rail and expanded view). NotificationBell
// reads the closest ancestor with this attribute via
// `el.closest("[data-notification-anchor]")` to clamp its dropdown's
// position against the SIDEBAR's bounds instead of the whole browser
// window -- see NotificationBell.tsx's computeCoords for why that matters
// (the sidebar is narrow but sits inside a much wider window, so clamping
// against window.innerWidth let the panel drift away from the bell and
// spill into the map area). No other changes in this pass.
//
// NOTIFICATION BELL (earlier pass): added <NotificationBell /> next to the
// account footer in both layout states:
//   - Expanded: sits inline with the username/role button, as a sibling
//     button (see the AccountFooter note below on why it's a sibling and
//     not a nested button).
//   - Collapsed: rendered as a standalone icon-only (`compact`) button just
//     above <AccountFooter compact />, matching the rail's existing icon
//     stack (Create Shapefile, Search, municipality icons, active-count
//     pill).
// The component is fully self-contained (owns its own fetch/poll/modal
// state), so no new props were added to SidebarProps for this beyond
// `onActivityLogSelect`, passed straight through to NotificationBell.
//
// SEARCH RESULTS IN "SELECTED" TAB (earlier pass): SelectedPanel's rows were
// always rendered with a CalendarDays icon, which made sense when every
// entry was a year layer but reads oddly now that a picked search result
// (keyed `search:<id>` — see handleSearchSelect in map/page.tsx) can show
// up in this same list. No prop changes needed here — activeSelections was
// already generic over any key — this just swaps the leading icon to
// SearchIcon when the row's key starts with "search:" so a searched lot is
// visually distinguishable from a year layer at a glance. Everything else
// (remove via X -> onToggle(key, null), "view in table", "Clear all") was
// already agnostic to what kind of key it's operating on and needed no
// changes.
//
// AUTH WIRING (earlier pass): added an optional `userType` prop. When present,
// a small pill badge (e.g. "Admin") renders next to the username in the
// expanded account footer, and gets appended to the tooltip label in the
// collapsed rail. This is purely presentational — the actual userName/
// userEmail/userType values now come from the real logged-in session (see
// src/app/map/page.tsx, which fetches them from GET /api/auth/me), rather
// than always showing this component's hardcoded defaults. The defaults
// are left in place as a graceful fallback for the brief window before
// that fetch resolves.
//
// REFRESH WIRING (earlier pass): added an optional `municipalitiesRefreshKey`
// prop. Bump it (e.g. with Date.now()) from the map page after a lot sheet
// saves successfully, and this component will:
//   1. Refetch the top-level municipality list/counts.
//   2. Refetch barangays for any MunicipalityNode that's currently expanded
//      (previously this was cached in that node's local state and would go
//      stale until manually collapsed/re-expanded).
//   3. Refetch years for any BarangayNode that's currently expanded, same
//      reasoning.
// The key is threaded down through LayersPanel -> MunicipalityNode ->
// BarangayNode; each node compares it against the value it last fetched
// with and re-fetches (rather than just resetting to a skeleton) so an
// already-open branch updates in place instead of collapsing.
//
// Changes in earlier passes (on top of the tooltip/search/create-shapefile/peek pass):
//
// 8. "Selected" tab rows now have a third icon (Table2) next to the label
//    and the remove (X) button. Clicking it tells the parent (map/page.tsx)
//    to filter the attribute table down to just that layer's lots. The
//    active row gets a ring + accent background so it's clear which layer
//    the table is currently showing. This component doesn't own that
//    state — it just reports clicks via onViewLayer and reflects the
//    current filter via activeTableKey, same pattern as collapsed/peek.
//
// 9. `darkMode` no longer lives here as private state. It's now read from
//    <SidebarThemeProvider> (see SidebarThemeContext.tsx) so that sibling
//    components — AttributeTable in particular — can render in the same
//    light/dark palette instead of always defaulting to light. The dark
//    mode toggle in the account menu now flips the shared context instead
//    of a local boolean. The provider must be mounted by an ancestor
//    (typically the map page) that renders both <Sidebar /> and
//    <AttributeTable />.
//
// 10. APPLE-STYLE DENSITY / VISUAL PASS: retuned to match the
//     AttributeTable/SummaryBar pass so the whole app reads as one system —
//       - Type scale down a notch across the board (row labels 13px ->
//         12.5px, section headers 11px -> 10px with wider tracking, badges
//         11px -> 10px with tabular-nums so counts don't jitter width).
//       - Hairlines: every border in this file now goes through `hairline`/
//         `hairlineSoft` (color-mix against --sb-border at reduced opacity)
//         instead of a flat 1px border, so dividers read as fine lines —
//         same treatment as AttributeTable's row/column rules.
//       - Icon buttons and the brand mark moved from rounded-lg to a
//         squircle-ish rounded-[10px] to read closer to native macOS/iOS
//         chrome; the primary CTA and tab pills are now full-radius.
//       - YearRow's native checkbox was replaced with a small custom
//         `Checkbox` (rounded box + check glyph, same visual language as
//         AttributeTable's) — still a real <input type="checkbox"> under
//         the hood for a11y/keyboard.
//       - Row/menu paddings tightened slightly to fit more of the tree in
//         view without scrolling, and hover/active transitions shortened
//         so scanning a long list doesn't feel like every row is animating
//         independently.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  PanelLeft,
  PanelLeftClose,
  Plus,
  Minus,
  Building2,
  MapPin,
  CalendarDays,
  User,
  LogOut,
  Sun,
  Moon,
  X,
  Layers as LayersIcon,
  ListChecks,
  FilePlus2,
  Search as SearchIcon,
  Table2,
  Check,
  Bell,
  Filter,
  Download,
} from "lucide-react";
import type { SelectionMeta, TreeNodeData, LotSearchResult } from "@/lib/geo";
import { uiFont, type SidebarTheme } from "./sidebarTheme";
import { useSidebarTheme } from "./SidebarThemeContext";
import SearchBar from "./SearchBar";
import NotificationBell, { type ActivityLogRow } from "@/components/NotificationBell";
import ProjectionModal, { type ProjectionResult } from "./ProjectionModal";

interface SidebarProps {
  activeSelections: Record<string, SelectionMeta>;
  onToggle: (key: string, meta: SelectionMeta | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  showCollapseButton?: boolean;
  onCloseMobile?: () => void;
  onLogout?: () => void;
  userName?: string;
  userEmail?: string;
  /** e.g. "admin" | "surveyor" | "user" — rendered as a small badge next to the name. */
  userType?: string;
  /** Bubbled up when a user picks a result from the sidebar search bar. */
  onSearchSelect?: (result: LotSearchResult) => void;
/** Opens the Create Shapefile modal (owned by the map page). */
onCreateShapefile: () => void;
  /** Called when the user clicks the "view in table" icon on a Selected row. */
  onViewLayer?: (key: string) => void;
  /**
   * Called when the user clicks the download icon on a Selected row.
   * Sidebar has no access to the layer's actual feature geometry — it
   * just reports which key was clicked, and the map page (which owns
   * `layerData`) opens DownloadLayerModal with that key's features. Same
   * "Sidebar reports, page decides" pattern as onViewLayer.
   */
  onDownloadLayer?: (key: string) => void;
  /** Key of the selection currently filtering the attribute table (for row highlight). */
  activeTableKey?: string | null;
  /**
   * Bump this (e.g. `Date.now()`) after a lot sheet saves successfully to
   * force the municipality tree — including any already-expanded barangay
   * and year branches — to refetch. Optional: if omitted, the tree only
   * ever loads once on mount, same as before.
   */
  municipalitiesRefreshKey?: number;
  /**
   * Called when the user clicks an entry in the notification bell's
   * "today's activity" modal. Passed straight through to NotificationBell
   * -- see map/page.tsx's handleActivityLogSelect for what it actually
   * does (adds the sheet as a map/table selection, same mechanism as a
   * year layer or search pick).
   */
  onActivityLogSelect?: (log: ActivityLogRow) => void;
  /**
   * Bump this (e.g. Date.now()) after any action that writes a new
   * activity log row, so the notification bell's badge count updates
   * right away in both the collapsed rail and the expanded footer,
   * instead of lagging behind by up to 60s. Passed straight through to
   * both NotificationBell instances below. Same pattern as
   * municipalitiesRefreshKey.
   */
  notificationsRefreshKey?: number;
}

// Hairline helpers — draw borders at reduced opacity against the theme's
// border token so dividers read as fine native-feeling lines rather than a
// flat, heavy 1px rule. Same treatment used in AttributeTable/SummaryBar.
const hairline = "color-mix(in srgb, var(--sb-border) 75%, transparent)";
const hairlineSoft = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

// `border-0 bg-transparent p-0` here are defensive, not decorative: this
// project's globals.css has unscoped `button { border: 1px solid #ccc;
// background: #fff; padding: 7px 12px; }` written outside any @layer, which
// (per CSS cascade-layers rules) can outrank Tailwind's utility layer even
// when wrapped in @layer base. Setting these explicitly on every button
// guarantees this component never inherits that styling by accident.
function iconBtnClass(size: "sm" | "md" | "lg" = "md") {
  const sizes = { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-9 w-9" };
  return `flex ${sizes[size]} flex-shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]`;
}

// Capitalizes a raw usertype value ("admin" -> "Admin") for display. Falls
// back to the raw string if it's something unexpected instead of throwing.
function formatUserType(userType: string): string {
  if (!userType) return userType;
  return userType.charAt(0).toUpperCase() + userType.slice(1);
}

function Skeleton({ width }: { width: number | string }) {
  return (
    <div
      className="h-3 animate-[sidebar-pulse_1.1s_ease-in-out_infinite] rounded bg-[var(--sb-hover)]"
      style={{ width }}
    />
  );
}

// Small custom checkbox — a real <input type="checkbox"> kept for a11y and
// keyboard support, visually replaced with a rounded box + check glyph so
// it matches the rest of the chrome instead of the browser's default skin.
// Same visual language as AttributeTable's row-selection checkbox. Reused
// both by YearRow and by FolderRow's new municipality-level projection
// checkbox.
function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <span className="relative inline-flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        className="pointer-events-none flex h-[15px] w-[15px] items-center justify-center rounded-[4.5px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--sb-accent)] peer-focus-visible:ring-offset-1"
        style={{
          borderColor: checked ? "var(--sb-accent)" : "var(--sb-border)",
          background: checked ? "var(--sb-accent)" : "var(--sb-bg)",
        }}
      >
        {checked && <Check size={10.5} strokeWidth={3} color="white" />}
      </span>
    </span>
  );
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

// ---------------- Tooltip ----------------
//
// Dark pill tooltip (Claude.ai style), portaled to <body> so it's never
// clipped by an ancestor's overflow:hidden/auto and always paints above
// everything else (z-[9999]). Position is computed from the trigger's
// bounding rect on hover/focus, not from CSS-relative absolute positioning.
function Tooltip({
  label,
  children,
  side = "right",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const showTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (showTimeout.current) clearTimeout(showTimeout.current);
    };
  }, []);

  function computeCoords() {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    if (side === "right") setCoords({ top: rect.top + rect.height / 2, left: rect.right + gap });
    else if (side === "left") setCoords({ top: rect.top + rect.height / 2, left: rect.left - gap });
    else if (side === "top") setCoords({ top: rect.top - gap, left: rect.left + rect.width / 2 });
    else setCoords({ top: rect.bottom + gap, left: rect.left + rect.width / 2 });
  }

  function handleEnter() {
    if (showTimeout.current) clearTimeout(showTimeout.current);
    showTimeout.current = setTimeout(() => {
      computeCoords();
      setVisible(true);
    }, 300);
  }

  function handleLeave() {
    if (showTimeout.current) clearTimeout(showTimeout.current);
    setVisible(false);
  }

  const transformBySide: Record<string, string> = {
    right: "translate(0, -50%)",
    left: "translate(-100%, -50%)",
    top: "translate(-50%, -100%)",
    bottom: "translate(-50%, 0)",
  };

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {mounted &&
        visible &&
        coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[9999] max-w-[220px] whitespace-nowrap rounded-md bg-[#1f2430] px-2 py-1 text-[10.5px] font-medium leading-none text-white shadow-lg"
            style={{ top: coords.top, left: coords.left, transform: transformBySide[side] }}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}

type TabKey = "layers" | "selected";

export default function Sidebar({
  activeSelections,
  onToggle,
  collapsed,
  onToggleCollapsed,
  showCollapseButton = true,
  onCloseMobile,
  onLogout,
  userName = "Admin User",
  userEmail = "admin@example.com",
  userType,
  onSearchSelect,
  onCreateShapefile,
  onViewLayer,
  onDownloadLayer,
  activeTableKey = null,
  municipalitiesRefreshKey,
  onActivityLogSelect,
  notificationsRefreshKey,
}: SidebarProps) {
  const [municipalities, setMunicipalities] = useState<TreeNodeData[] | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [pendingExpandId, setPendingExpandId] = useState<string | number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("layers");
  // Controls the "Project layers" modal (bulk multi-municipality/
  // barangay/year picker) — see ProjectionModal.tsx.
  const [projectionModalOpen, setProjectionModalOpen] = useState(false);

  const accountRef = useRef<HTMLDivElement>(null);
  const { darkMode, toggleDarkMode, theme, vars } = useSidebarTheme();

  // Re-runs on mount AND whenever the parent bumps municipalitiesRefreshKey
  // (e.g. right after a lot sheet save succeeds), so newly-saved lots show
  // up in the top-level counts without a manual page refresh.
  useEffect(() => {
    safeFetchArray("/api/map/tree?level=municipalities").then(setMunicipalities);
  }, [municipalitiesRefreshKey]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [accountMenuOpen]);

  const activeEntries = Object.entries(activeSelections);
  const activeCount = activeEntries.length;

  function clearAll() {
    Object.keys(activeSelections).forEach((key) => onToggle(key, null));
  }

  function handleRailIconClick(id: string | number) {
    setPendingExpandId(id);
    setActiveTab("layers");
    onToggleCollapsed();
  }

  // Applies every selection the user picked in the "Project layers" modal
  // by feeding each one through the same onToggle prop everything else in
  // this component already uses (year checkboxes, search picks, etc) —
  // see ProjectionModal.tsx's file-top comment for what key/query shape
  // each kind of pick produces. Closes the modal and jumps to the
  // "Selected" tab afterward so the user immediately sees what just got
  // added.
  function handleApplyProjection(results: ProjectionResult[]) {
    results.forEach(({ key, meta }) => onToggle(key, meta));
    setProjectionModalOpen(false);
    setActiveTab("selected");
  }

  const brand = (
    <div
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] text-xs font-bold tracking-wide text-white"
      style={{ background: `linear-gradient(135deg, #6366f1, ${theme.accent})` }}
    >
      OCM
    </div>
  );

  // Tooltip label for the collapsed rail's account icon: just the name, or
  // "Name · Role" when a userType was supplied.
  const compactTooltipLabel = userType ? `${userName} · ${formatUserType(userType)}` : userName;

  function AccountFooter({ compact }: { compact: boolean }) {
    return (
      <div
        ref={compact ? undefined : accountRef}
        className={`relative w-full flex-shrink-0 pt-2.5 ${compact ? "" : "mt-2.5"}`}
        style={{ borderTop: `1px solid ${hairline}` }}
      >
        {accountMenuOpen && !compact && (
          <div
            className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-30 rounded-[12px] bg-[var(--sb-bg-elevated)] p-1.5"
            style={{ boxShadow: theme.shadow, border: `1px solid ${hairline}` }}
          >
            <button type="button" onClick={toggleDarkMode} className={menuItemClass}>
              {darkMode ? <Moon size={14} /> : <Sun size={14} />}
              {darkMode ? "Dark mode" : "Light mode"}
              <span
                className="ml-auto h-[17px] w-[30px] flex-shrink-0 rounded-full transition-colors"
                style={{ background: darkMode ? theme.accent : theme.border }}
              >
                <span
                  className="relative block h-[13px] w-[13px] rounded-full bg-white transition-[left] duration-150"
                  style={{ top: 2, left: darkMode ? 15 : 2 }}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAccountMenuOpen(false);
                onLogout?.();
              }}
              className={`${menuItemClass} text-red-600`}
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        )}

        {compact ? (
          <Tooltip label={compactTooltipLabel} side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex w-full items-center justify-center gap-2.5 rounded-[10px] border-0 bg-transparent px-0 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--sb-hover)]"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--sb-hover)] text-[var(--sb-text-muted)]">
                <User size={14} />
              </div>
            </button>
          </Tooltip>
        ) : (
          // NOTE: this used to be a single <button> wrapping the whole row
          // (avatar + name/email + bell). HTML forbids a <button> nested
          // inside another <button> -- NotificationBell renders its own
          // <button> internally, so nesting it inside this one triggered a
          // React hydration error (invalid DOM nesting), not just a click
          // conflict. Fixed by splitting this into a flex row containing
          // two SIBLING buttons: the account-menu toggle (avatar + name +
          // email) and the bell, instead of one button containing the
          // other. stopPropagation is no longer needed since there's no
          // parent/child relationship left to bubble through.
          <div className="flex w-full items-center gap-1">
            <button
              type="button"
              onClick={() => setAccountMenuOpen((v) => !v)}
              className="flex min-w-0 flex-1 items-center justify-start gap-2.5 rounded-[10px] border-0 bg-transparent px-1.5 py-1.5 text-left transition-colors duration-100 hover:bg-[var(--sb-hover)]"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--sb-hover)] text-[var(--sb-text-muted)]">
                <User size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-semibold text-[var(--sb-text)]">{userName}</span>
                  {userType && (
                    <span
                      className="flex-shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide"
                      style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}
                    >
                      {formatUserType(userType)}
                    </span>
                  )}
                </div>
                <div className="truncate text-[10.5px] text-[var(--sb-text-faint)]">{userEmail}</div>
              </div>
            </button>
            <NotificationBell onSelectLog={onActivityLogSelect} refreshKey={notificationsRefreshKey} />
          </div>
        )}
      </div>
    );
  }

  // ---------------- COLLAPSED: icon-only rail ----------------
  if (collapsed) {
    return (
      <div
        data-notification-anchor="true"
        className={`${uiFont.className} flex h-full w-full flex-col items-center bg-[var(--sb-bg)] py-3`}
        style={vars}
      >
        <div className="mb-2.5">{brand}</div>

        <Tooltip label="Expand sidebar" side="right">
          <button type="button" onClick={onToggleCollapsed} className={iconBtnClass("lg")}>
            <PanelLeft size={17} />
          </button>
        </Tooltip>

      <Tooltip label="Create Shapefile" side="right">
        <button type="button" onClick={onCreateShapefile} className={`mt-1.5 ${iconBtnClass("lg")}`}>
          <FilePlus2 size={16} />
        </button>
      </Tooltip>

        {/* Rail didn't have any way to reach search before — clicking this
            pins the sidebar open (same as the expand button above) so the
            full search bar is reachable. */}
        <Tooltip label="Search" side="right">
          <button type="button" onClick={onToggleCollapsed} className={`mt-1.5 ${iconBtnClass("lg")}`}>
            <SearchIcon size={16} />
          </button>
        </Tooltip>

        {/* Same trick as Search/Expand above: the rail has no room for the
            full projection tree, so this just pins the sidebar open and
            jumps to the Layers tab, where the real "Project" button (see
            LayersPanel below) lives. */}
        <Tooltip label="Project layers" side="right">
          <button
            type="button"
            onClick={() => {
              setActiveTab("layers");
              onToggleCollapsed();
              setProjectionModalOpen(true);
            }}
            className={`mt-1.5 ${iconBtnClass("lg")}`}
          >
            <Filter size={16} />
          </button>
        </Tooltip>

        <div className="my-2.5 w-7" style={{ borderTop: `1px solid ${hairline}` }} />

        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden">
          {municipalities === null &&
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-9 w-9 animate-[sidebar-pulse_1.1s_ease-in-out_infinite] rounded-[10px] bg-[var(--sb-hover)]"
              />
            ))}
          {municipalities?.map((m) => {
            const hasActive = Object.keys(activeSelections).some(
              (k) => k.startsWith(`year:`) && activeSelections[k].query.municipality_id === m.id
            );
            return (
              <Tooltip key={m.id} label={String(m.label)} side="right">
                <button
                  type="button"
                  onClick={() => handleRailIconClick(m.id)}
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border-0 p-0 transition-colors duration-100 ${
                    hasActive
                      ? "bg-[var(--sb-accent-bg)] text-[var(--sb-accent)]"
                      : "bg-transparent text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
                  }`}
                >
                  <Building2 size={16} />
                </button>
              </Tooltip>
            );
          })}
        </div>

        {activeCount > 0 && (
          <Tooltip label={`${activeCount} layer${activeCount === 1 ? "" : "s"} selected`} side="right">
            <div
              className="mt-1.5 flex h-[22px] min-w-[22px] flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums text-white"
              style={{ background: theme.accent }}
            >
              {activeCount}
            </div>
          </Tooltip>
        )}

        {/* Notification bell — sits just above the account footer, next
            to where the user's profile lives. */}
        <div className="mt-1.5">
          <NotificationBell compact onSelectLog={onActivityLogSelect} refreshKey={notificationsRefreshKey} />
        </div>

        <AccountFooter compact />
        <style>{`@keyframes sidebar-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }`}</style>

        {/* Modal itself is rendered here too (portaled to <body>, so its
            actual DOM position doesn't matter) so the rail's "Project
            layers" shortcut above has somewhere to open it into — the
            expand-then-open sequence above flips `collapsed` on the very
            next render, so by the time this state update lands this
            branch may no longer even be the one rendering, but keeping
            the modal in both branches means it opens correctly regardless
            of which one is active when the click fires. */}
        <ProjectionModal
          open={projectionModalOpen}
          onClose={() => setProjectionModalOpen(false)}
          // municipalities={municipalities}
          onApply={handleApplyProjection}
        />
      </div>
    );
  }

  // ---------------- EXPANDED ----------------
  return (
    <div
      data-notification-anchor="true"
      className={`${uiFont.className} flex h-full w-full min-w-0 flex-col bg-[var(--sb-bg)] px-3 py-3 text-[var(--sb-text)] antialiased`}
      style={vars}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-2.5 pb-3">
        {brand}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold tracking-tight text-[var(--sb-text)]">OCM-A&D</div>
          <div className="truncate text-[10.5px] text-[var(--sb-text-faint)]">PENRO Cagayan</div>
        </div>
        {onCloseMobile ? (
          <Tooltip label="Close menu" side="bottom">
            <button type="button" onClick={onCloseMobile} className={iconBtnClass("md")}>
              <X size={15} />
            </button>
          </Tooltip>
        ) : (
          showCollapseButton && (
            <Tooltip label="Collapse sidebar" side="bottom">
              <button type="button" onClick={onToggleCollapsed} className={iconBtnClass("md")}>
                <PanelLeftClose size={17} />
              </button>
            </Tooltip>
          )
        )}
      </div>

      {/* Create Shapefile */}
      <button
        type="button"
        onClick={onCreateShapefile}
        className="mb-2.5 flex flex-shrink-0 items-center justify-center gap-2 rounded-full border-0 px-3 py-[9px] text-[12.5px] font-semibold text-white shadow-sm transition-opacity duration-100 hover:opacity-90"
        style={{ background: theme.accent }}
      >
        <FilePlus2 size={14} />
        Create Shapefile
      </button>

      {/* Search */}
      <div className="mb-3 flex-shrink-0">
        <SearchBar onSelect={(r) => onSearchSelect?.(r)} />
      </div>

      {/* Tabs */}
      <div className="mb-3 flex flex-shrink-0 items-center gap-1 rounded-full bg-[var(--sb-hover)] p-1">
        <TabButton
          label="Layers"
          icon={<LayersIcon size={13} />}
          active={activeTab === "layers"}
          onClick={() => setActiveTab("layers")}
        />
        <TabButton
          label="Selected"
          icon={<ListChecks size={13} />}
          active={activeTab === "selected"}
          onClick={() => setActiveTab("selected")}
          badge={activeCount}
        />
      </div>

      {/* Tab content */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {activeTab === "layers" ? (
          <LayersPanel
            municipalities={municipalities}
            activeSelections={activeSelections}
            onToggle={onToggle}
            theme={theme}
            pendingExpandId={pendingExpandId}
            onAutoExpandHandled={() => setPendingExpandId(null)}
            refreshKey={municipalitiesRefreshKey}
            onOpenProjection={() => setProjectionModalOpen(true)}
          />
        ) : (
          <SelectedPanel
            activeEntries={activeEntries}
            onToggle={onToggle}
            onClearAll={clearAll}
            onBrowse={() => setActiveTab("layers")}
            onViewLayer={onViewLayer}
            onDownloadLayer={onDownloadLayer}
            activeTableKey={activeTableKey}
          />
        )}
      </div>

      <AccountFooter compact={false} />
      <style>{`@keyframes sidebar-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }`}</style>

      <ProjectionModal
        open={projectionModalOpen}
        onClose={() => setProjectionModalOpen(false)}
        // municipalities={municipalities}
        onApply={handleApplyProjection}
      />
    </div>
  );
}

const menuItemClass =
  "flex w-full items-center gap-2.5 rounded-[8px] border-0 bg-transparent px-2 py-[7px] text-left text-[12.5px] text-[var(--sb-text)] transition-colors duration-100 hover:bg-[var(--sb-hover)]";

// ---------------- Tabs ----------------

function TabButton({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border-0 px-2 py-[6px] text-[11.5px] font-semibold transition-colors duration-100 ${
        active
          ? "bg-[var(--sb-bg)] text-[var(--sb-accent)] shadow-sm"
          : "bg-transparent text-[var(--sb-text-muted)] hover:text-[var(--sb-text)]"
      }`}
    >
      {icon}
      {label}
      {typeof badge === "number" && badge > 0 && (
        <span
          className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9.5px] font-bold tabular-nums ${
            active ? "bg-[var(--sb-accent)] text-white" : "bg-[var(--sb-border)] text-[var(--sb-text-muted)]"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ---------------- "Selected" tab: active selections as a flat list ----------------
//
// `sel.label` is a composite label — "Municipality, Barangay, Year" for a
// year layer (built in YearRow's onCheck inside BarangayNode below, or by
// ProjectionModal for a bulk-picked year), "Owner · Lot No" for a picked
// search result (built in handleSearchSelect in map/page.tsx), or
// "Municipality (all barangays, all years)" / "Municipality, Barangay (all
// years)" for a whole-municipality/whole-barangay projection (built here in
// MunicipalityNode, or by ProjectionModal) — so rows wrap to two lines
// instead of truncating to one, with the full text still available via the
// tooltip.
//
// Each row now carries four actions: download, view-in-table (Table2), and
// remove (X). The row currently driving the attribute table (activeTableKey
// === key) gets an accent ring so it's obvious at a glance which layer is
// being inspected below. The leading icon distinguishes a search result
// (`search:<id>` key), a notification-bell pick (`sheet:<id>`), a
// whole-municipality projection (`proj:muni:<id>`), a whole-barangay
// projection (`proj:brgy:<id>`), and an ordinary year layer
// (`year:<barangayId>:<yearId>`) so each kind of entry reads differently
// at a glance.

function SelectedPanel({
  activeEntries,
  onToggle,
  onClearAll,
  onBrowse,
  onViewLayer,
  onDownloadLayer,
  activeTableKey,
}: {
  activeEntries: [string, SelectionMeta][];
  onToggle: (key: string, meta: SelectionMeta | null) => void;
  onClearAll: () => void;
  onBrowse: () => void;
  onViewLayer?: (key: string) => void;
  onDownloadLayer?: (key: string) => void;
  activeTableKey?: string | null;
}) {
  if (activeEntries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sb-hover)] text-[var(--sb-text-faint)]">
          <ListChecks size={17} />
        </div>
        <p className="text-[12.5px] font-medium text-[var(--sb-text)]">No layers selected yet</p>
        <p className="text-[11.5px] text-[var(--sb-text-faint)]">
          Pick a year from the Layers tab to show it on the map.
        </p>
        <button
          type="button"
          onClick={onBrowse}
          className="mt-1 rounded-full border-0 bg-[var(--sb-accent-bg)] px-3 py-[6px] text-[11.5px] font-semibold text-[var(--sb-accent)] transition-opacity duration-100 hover:opacity-80"
        >
          Browse layers
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">
          Currently showing ({activeEntries.length})
        </h3>
        <button
          type="button"
          onClick={onClearAll}
          className="border-0 bg-transparent p-0 text-[11px] font-semibold text-[var(--sb-accent)] transition-opacity duration-100 hover:opacity-70"
        >
          Clear all
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {activeEntries.map(([key, sel]) => {
          const isShowing = activeTableKey === key;
          // A search-result pick (see handleSearchSelect in map/page.tsx)
          // is keyed `search:<id>`, a notification-bell pick (see
          // handleActivityLogSelect in map/page.tsx) is keyed `sheet:<id>`,
          // and a whole-municipality/barangay projection (see
          // MunicipalityNode's checkbox below, or ProjectionModal.tsx) is
          // keyed `proj:muni:<id>` or `proj:brgy:<id>` — all distinct from
          // an ordinary single year layer's `year:<barangayId>:<yearId>`
          // key. Swap the leading icon so every kind of row reads
          // differently at a glance.
          const isSearchResult = key.startsWith("search:");
          const isSheetFromLog = key.startsWith("sheet:");
          const isProjMuni = key.startsWith("proj:muni:");
          const isProjBrgy = key.startsWith("proj:brgy:");
          return (
            <div
              key={key}
              className="flex items-start gap-2 rounded-[10px] bg-[var(--sb-accent-bg)] px-2.5 py-[7px] transition-colors duration-100"
              style={{
                boxShadow: isShowing
                  ? `0 0 0 1.5px var(--sb-accent)`
                  : `0 0 0 1px ${hairlineSoft}`,
              }}
            >
              {isSearchResult ? (
                <SearchIcon size={13} className="mt-0.5 flex-shrink-0 text-[var(--sb-accent)]" />
              ) : isSheetFromLog ? (
                <Bell size={13} className="mt-0.5 flex-shrink-0 text-[var(--sb-accent)]" />
              ) : isProjMuni ? (
                <Building2 size={13} className="mt-0.5 flex-shrink-0 text-[var(--sb-accent)]" />
              ) : isProjBrgy ? (
                <MapPin size={13} className="mt-0.5 flex-shrink-0 text-[var(--sb-accent)]" />
              ) : (
                <CalendarDays size={13} className="mt-0.5 flex-shrink-0 text-[var(--sb-accent)]" />
              )}
              <Tooltip label={sel.label || "Untitled"} side="top">
                <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-[var(--sb-accent-text)]">
                  {sel.label || "Untitled"}
                </span>
              </Tooltip>

              {/* Download this layer as KML/Shapefile/GeoJSON — opens
                  DownloadLayerModal (owned by the map page, since it's
                  the one holding the actual feature geometry for this
                  key). */}
              <Tooltip label="Download layer" side="top">
                <button
                  type="button"
                  onClick={() => onDownloadLayer?.(key)}
                  className="mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-[var(--sb-accent)] transition-colors duration-100 hover:bg-[var(--sb-accent)]/15"
                >
                  <Download size={12} />
                </button>
              </Tooltip>

              {/* View this layer's lots in the attribute table below,
                  without disturbing any of the other active selections on
                  the map. Clicking again (handled in the parent) clears
                  the filter back to "show everything". */}
              <Tooltip label={isShowing ? "Showing in table" : "View in table"} side="top">
                <button
                  type="button"
                  onClick={() => onViewLayer?.(key)}
                  className={`mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] border-0 p-0 transition-colors duration-100 ${
                    isShowing
                      ? "bg-[var(--sb-accent)] text-white"
                      : "bg-transparent text-[var(--sb-accent)] hover:bg-[var(--sb-accent)]/15"
                  }`}
                >
                  <Table2 size={12} />
                </button>
              </Tooltip>

              {/* Remove button — always red so it's never invisible against
                  the row's accent background, regardless of theme. Works
                  identically for a year layer, a search result, or a
                  projection pick: all of them just call onToggle(key,
                  null), which map/page.tsx's handleToggle uses to drop the
                  key from activeSelections (and, via the layerData cleanup
                  effect there, from the map/table too). */}
              <Tooltip label="Remove layer" side="left">
                <button
                  type="button"
                  onClick={() => onToggle(key, null)}
                  className="mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-red-500 transition-colors duration-100 hover:bg-red-500/10 hover:text-red-600"
                >
                  <X size={13} strokeWidth={2.5} />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- "Layers" tab: the browsable tree ----------------

function LayersPanel({
  municipalities,
  activeSelections,
  onToggle,
  theme,
  pendingExpandId,
  onAutoExpandHandled,
  refreshKey,
  onOpenProjection,
}: {
  municipalities: TreeNodeData[] | null;
  activeSelections: Record<string, SelectionMeta>;
  onToggle: (key: string, meta: SelectionMeta | null) => void;
  theme: SidebarTheme;
  pendingExpandId: string | number | null;
  onAutoExpandHandled: () => void;
  refreshKey?: number;
  /** Opens the bulk "Project layers" modal (see ProjectionModal.tsx). */
  onOpenProjection: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-0.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--sb-text-muted)]">
          Municipalities
        </h3>
        {/* Opens ProjectionModal — lets the user pick several
            municipalities/barangays/years at once instead of drilling
            through the tree below one branch at a time. */}
        <button
          type="button"
          onClick={onOpenProjection}
          className="flex flex-shrink-0 items-center gap-1 rounded-full border-0 bg-[var(--sb-accent-bg)] px-2 py-[3px] text-[10.5px] font-semibold text-[var(--sb-accent)] transition-opacity duration-100 hover:opacity-80"
        >
          <Filter size={10.5} />
          Project
        </button>
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {municipalities === null &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-1.5 py-[6px]">
              <Skeleton width={18} />
              <Skeleton width={`${55 + ((i * 13) % 30)}%`} />
            </div>
          ))}
        {municipalities?.length === 0 && (
          <div className="px-1 py-2 text-[11.5px] text-[var(--sb-text-faint)]">No saved lots yet.</div>
        )}
        {municipalities?.map((m) => (
          <MunicipalityNode
            key={m.id}
            node={m}
            activeSelections={activeSelections}
            onToggle={onToggle}
            theme={theme}
            autoExpand={pendingExpandId === m.id}
            onAutoExpandHandled={onAutoExpandHandled}
            refreshKey={refreshKey}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------- Folder row (Municipality / Barangay) ----------------
//
// Renders the +/- expand toggle, an optional checkbox right after it (used
// by MunicipalityNode for the "project this whole municipality" shortcut
// added in this pass — BarangayNode doesn't pass showCheckbox, so its rows
// are unaffected), the branch icon, label, and count.

function FolderRow({
  expanded,
  onToggle,
  icon,
  label,
  count,
  active,
  showCheckbox = false,
  checked = false,
  onCheckToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  /** Renders a small checkbox right after the +/- icon — used for
   *  "project this whole municipality" without expanding the tree. */
  showCheckbox?: boolean;
  checked?: boolean;
  onCheckToggle?: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-[9px] px-1.5 py-[6px] transition-colors duration-100 ${
        active ? "bg-[var(--sb-accent-bg)]" : "hover:bg-[var(--sb-hover)]"
      }`}
    >
      <span
        className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[6px] text-[var(--sb-text-muted)]"
        style={{ border: `1px solid ${hairline}` }}
      >
        {expanded ? <Minus size={11} /> : <Plus size={11} />}
      </span>
      {showCheckbox && (
        // stopPropagation so clicking the checkbox doesn't also fire the
        // row's onToggle (which expands/collapses the branch) — checking
        // the box to project the whole municipality and expanding the
        // tree to drill into barangays/years are independent actions.
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={checked} onChange={() => onCheckToggle?.()} />
        </span>
      )}
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--sb-text)]">
        {label || "Untitled"}
      </span>
      <span className="flex-shrink-0 tabular-nums text-[10.5px] text-[var(--sb-text-faint)]">({count ?? 0})</span>
    </div>
  );
}

// ---------------- Year row — the only selectable/checkbox level ----------------

function YearRow({
  checked,
  onCheck,
  label,
  count,
}: {
  checked: boolean;
  onCheck: () => void;
  label: string;
  count: number;
}) {
  const displayLabel = label && label.trim().length > 0 ? label : "Untitled year";
  return (
    <div
      className={`flex w-full items-center gap-2 rounded-[9px] py-[5px] pl-1.5 pr-2 transition-colors duration-100 ${
        checked ? "bg-[var(--sb-accent-bg)]" : "hover:bg-[var(--sb-hover)]"
      }`}
    >
      <Checkbox checked={checked} onChange={onCheck} />
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <CalendarDays size={13} className={checked ? "text-[var(--sb-accent)]" : "text-[var(--sb-text-faint)]"} />
      </span>
      <span
        onClick={onCheck}
        className={`min-w-0 flex-1 cursor-pointer truncate text-[12.5px] ${
          checked ? "font-semibold text-[var(--sb-accent-text)]" : "font-medium text-[var(--sb-text)]"
        }`}
      >
        {displayLabel}
      </span>
      <span className="flex-shrink-0 tabular-nums text-[10.5px] text-[var(--sb-text-faint)]">({count ?? 0})</span>
    </div>
  );
}

function MunicipalityNode({
  node,
  activeSelections,
  onToggle,
  theme,
  autoExpand,
  onAutoExpandHandled,
  refreshKey,
}: {
  node: TreeNodeData;
  activeSelections: Record<string, SelectionMeta>;
  onToggle: (key: string, meta: SelectionMeta | null) => void;
  theme: SidebarTheme;
  autoExpand?: boolean;
  onAutoExpandHandled?: () => void;
  refreshKey?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [barangays, setBarangays] = useState<TreeNodeData[] | null>(null);
  // Tracks which refreshKey value `barangays` was last fetched with, so the
  // refresh effect below can tell "never loaded" apart from "loaded under
  // an older key" without re-fetching on every render.
  const loadedForKey = useRef<number | undefined>(undefined);

  function loadBarangays() {
    loadedForKey.current = refreshKey;
    safeFetchArray(`/api/map/tree?level=barangays&municipality_id=${node.id}`).then(setBarangays);
  }

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && barangays === null) loadBarangays();
  }

  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
      if (barangays === null) loadBarangays();
      onAutoExpandHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);

  // If this branch is expanded (so its barangay list is visible/cached)
  // and a new refreshKey comes in from a save elsewhere, refetch it in
  // place instead of leaving it stale until the user manually collapses
  // and re-expands.
  useEffect(() => {
    if (expanded && refreshKey !== loadedForKey.current) {
      loadBarangays();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const hasActiveYear = Object.keys(activeSelections).some(
    (k) => k.startsWith("year:") && activeSelections[k].query.municipality_id === node.id
  );

  // Deterministic key so checking/unchecking the box is a plain lookup —
  // same style as a year layer's `year:<barangayId>:<yearId>` key. This
  // revives the `proj:muni:<id>` shape SelectedPanel already special-cases
  // with a Building2 icon (see isProjMuni there); nothing was actually
  // producing it anymore since ProjectionModal moved to its own combined
  // `filter:<timestamp>:<random>` keys for multi-facet picks. This
  // checkbox is the simpler "just grab this whole municipality" shortcut.
  //
  // query: { municipality_id: node.id } matches the legacy single-select
  // branch in /api/map/lots (see its own file-top usage examples), and is
  // exactly what map/page.tsx's generic activeSelections fetch effect will
  // serialize into `?municipality_id=<id>` the moment this key appears.
  const projKey = `proj:muni:${node.id}`;
  const projChecked = !!activeSelections[projKey];

  function handleProjectToggle() {
    if (projChecked) {
      onToggle(projKey, null);
    } else {
      onToggle(projKey, {
        query: { municipality_id: node.id },
        label: `${node.label} (all barangays, all years)`,
      });
    }
  }

  const hasActive = hasActiveYear || projChecked;

  return (
    <div>
      <FolderRow
        expanded={expanded}
        onToggle={toggleExpand}
        icon={<Building2 size={13} className={hasActive ? "text-[var(--sb-accent)]" : "text-[var(--sb-text-faint)]"} />}
        label={String(node.label)}
        count={node.count}
        active={hasActive}
        showCheckbox
        checked={projChecked}
        onCheckToggle={handleProjectToggle}
      />
      {expanded && (
        <div className="ml-[25px]" style={{ borderLeft: `1px solid ${hairlineSoft}`, paddingLeft: 1 }}>
          {barangays === null &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-1.5 py-[6px]">
                <Skeleton width={14} />
                <Skeleton width={`${40 + i * 10}%`} />
              </div>
            ))}
          {barangays?.length === 0 && (
            <div className="px-1.5 py-1 text-[11.5px] text-[var(--sb-text-faint)]">No barangays.</div>
          )}
          {barangays?.map((b) => (
            <BarangayNode
              key={b.id}
              node={b}
              municipalityId={node.id}
              municipalityLabel={String(node.label)}
              activeSelections={activeSelections}
              onToggle={onToggle}
              theme={theme}
              refreshKey={refreshKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BarangayNode({
  node,
  municipalityId,
  municipalityLabel,
  activeSelections,
  onToggle,
  refreshKey,
}: {
  node: TreeNodeData;
  municipalityId: number | string;
  municipalityLabel: string;
  activeSelections: Record<string, SelectionMeta>;
  onToggle: (key: string, meta: SelectionMeta | null) => void;
  theme: SidebarTheme;
  refreshKey?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [years, setYears] = useState<TreeNodeData[] | null>(null);
  const loadedForKey = useRef<number | undefined>(undefined);

  function loadYears() {
    loadedForKey.current = refreshKey;
    safeFetchArray(`/api/map/tree?level=years&barangay_id=${node.id}`).then(setYears);
  }

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && years === null) loadYears();
  }

  // Same "refetch in place if already expanded" behavior as
  // MunicipalityNode above, one level down: a newly-saved lot can add a
  // new year (or bump an existing year's count) under a barangay that's
  // already open.
  useEffect(() => {
    if (expanded && refreshKey !== loadedForKey.current) {
      loadYears();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const hasActiveYear = Object.keys(activeSelections).some((k) => k.startsWith(`year:${node.id}:`));

  // Same shortcut as MunicipalityNode's checkbox, one level down: projects
  // every lot in this barangay regardless of year, without drilling into
  // the year list below. Revives the `proj:brgy:<id>` key shape
  // SelectedPanel already special-cases with a MapPin icon (see isProjBrgy
  // there). query: { barangay_id: node.id } matches the legacy
  // barangay_id-only branch in /api/map/lots (i.e. the same as
  // `barangay_id` with no `year`), so map/page.tsx's generic
  // activeSelections fetch effect just serializes this straight into
  // `?barangay_id=<id>` with no extra wiring needed.
  const projKey = `proj:brgy:${node.id}`;
  const projChecked = !!activeSelections[projKey];

  function handleProjectToggle() {
    if (projChecked) {
      onToggle(projKey, null);
    } else {
      onToggle(projKey, {
        query: { barangay_id: node.id },
        label: `${municipalityLabel}, ${node.label} (all years)`,
      });
    }
  }

  const hasActive = hasActiveYear || projChecked;

  return (
    <div>
      <FolderRow
        expanded={expanded}
        onToggle={toggleExpand}
        icon={<MapPin size={13} className={hasActive ? "text-[var(--sb-accent)]" : "text-[var(--sb-text-faint)]"} />}
        label={String(node.label)}
        count={node.count}
        active={hasActive}
        showCheckbox
        checked={projChecked}
        onCheckToggle={handleProjectToggle}
      />
      {expanded && (
        <div className="ml-[25px]" style={{ borderLeft: `1px solid ${hairlineSoft}`, paddingLeft: 1 }}>
          {years === null &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-1.5 py-[6px]">
                <Skeleton width={14} />
                <Skeleton width={`${35 + i * 10}%`} />
              </div>
            ))}
          {years?.length === 0 && (
            <div className="px-1.5 py-1 text-[11.5px] text-[var(--sb-text-faint)]">No surveyed years.</div>
          )}
          {years?.map((y) => {
            const key = `year:${node.id}:${y.id}`;
            const checked = !!activeSelections[key];
            // Composite label so the "Selected" tab can show the full
            // path instead of just the bare year.
            const fullLabel = `${municipalityLabel}, ${String(node.label)}, ${String(y.label)}`;
            return (
              <YearRow
                key={y.id}
                checked={checked}
                count={y.count}
                label={String(y.label)}
                onCheck={() =>
                  onToggle(
                    key,
                    checked
                      ? null
                      : {
                          query: { municipality_id: municipalityId, barangay_id: node.id, year: y.id },
                          label: fullLabel,
                        }
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
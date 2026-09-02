"use client";

// Target path: src/app/map/page.tsx
//
// NOTIFICATION BELL CLICK-THROUGH (this pass): added handleActivityLogSelect,
// wired to both <Sidebar /> instances via the new onActivityLogSelect prop
// (Sidebar passes it straight through to NotificationBell -- see its
// onSelectLog). This was the missing piece from the notification bell work:
// NotificationBell's onSelectLog wiring in Sidebar was already correct, but
// nothing was listening on this end, so clicking a "today's activity" row
// did nothing.
//
// Mirrors handleSearchSelect below almost exactly: fetches the full sheet
// (GET /api/lot-sheets/[id], which returns snake_case columns straight off
// the table -- NOT the same shape /api/map/lots returns), maps its lots into
// LotFeature[], registers them under a content-addressed `sheet:<id>` key in
// BOTH layerData and activeSelections (Sidebar.tsx's SelectedPanel already
// special-cases `sheet:<id>` keys with a bell icon -- see its
// isSheetFromLog check), then focuses the map + opens the detail panel on
// the first lot, same as a search pick. Re-clicking an already-loaded entry
// just re-focuses instead of re-fetching, same no-op-re-add behavior as
// re-picking a search result.
//
// One thing worth double-checking against your actual schema: GET
// /api/lot-sheets/[id] returns raw `SELECT l.*` rows for `sheet.lots`, which
// don't include municipality/barangay names (that route doesn't join for
// individual lots, only for the sheet's own control point). Those fields
// are filled with null below rather than guessed at -- if your LotFeature
// consumers need them populated for a bell-selected lot, that join would
// need to be added to the lot-sheets route.
//
// SEARCH RESULT AS A REAL SELECTION (earlier pass): handleSearchSelect used
// to shove the picked lot straight into `layerData.search` without ever
// touching `activeSelections`. That meant a searched lot showed on the
// map and opened the detail panel, but had no presence in Sidebar's
// "Selected" tab and no way to be cleared via its X button — the only way
// to get rid of it was to search something else (which just overwrote the
// same "search" key) or reload the page. It also meant the general
// `layerData` cleanup effect below needed a special-cased `k === "search"`
// branch to keep it from being deleted on every activeSelections change.
//
// Now a search pick is keyed `search:<id>` and written into
// `activeSelections` (with `query: { id }` and a label built from the
// result's owner/lot no.) at the same time it's written into `layerData`.
// That's the exact same key shape everything else in this file already
// understands: SelectedPanel lists it, its X calls onToggle(key, null)
// which runs through handleToggle exactly like removing a year layer
// (clears activeSelections, closes the detail panel), the "view in table"
// icon works on it via tableFilterKey, and "Clear all" sweeps it up too.
// The special-cased "search" branch in the layerData cleanup effect is
// gone — a search entry is cleaned up the same way any other selection is,
// via its presence/absence in activeSelections.
//
// Because the key is content-addressed (`search:<result.id>`), searching
// the same lot again is a no-op re-add rather than a duplicate; searching
// a different lot adds an additional Selected entry alongside it (same
// multi-select behavior as picking several years) rather than replacing
// it. If you'd rather a new search replace any previous search result,
// strip existing `search:*` keys out of activeSelections before adding
// the new one in handleSearchSelect.
//
// DOCUMENTS LINK + SURVEY CLASS WIRING (earlier pass): AttributeTable's two
// newer inline controls — "Add link" in the Documents column
// (AddDocumentsLinkControl) and "Set class" in the Class column
// (AddSurveyClassControl) — are now wired up here via
// handleUpdateDocumentsUrl and handleUpdateSurveyClass, passed down as
// onUpdateDocumentsUrl / onUpdateSurveyClass. Same pattern as
// handleUpdatePlanUrl/handleUpdateSurveyNo: PATCH /api/lot-sheets/[id],
// then on success optimistically patch every currently-loaded feature
// belonging to that sheetId so the table updates immediately with no
// refetch. Both only ever fire from a sheet that has no existing value
// yet (AttributeTable itself gates the control on that — see its own
// file), same as the Plan link control.
//
// ADD PLAN LINK WIRING (earlier pass): AttributeTable's inline
// "Add link" control (sheets list, Plan column — see its own file-top
// comment) is wired up here via handleUpdatePlanUrl. It PATCHes
// /api/lot-sheets/[id] with the new planUrl, then — on success —
// optimistically patches every currently-loaded feature belonging to
// that sheetId so the table (and anything else reading layerData) shows
// the new link immediately, with no refetch. Throws (with the server's
// error message when available) on failure so AttributeTable's inline
// control can show it next to the input instead of failing silently.
//
// CLOSE DETAIL PANEL ON SIDEBAR LAYER TOGGLE (earlier pass): handleToggle —
// called by Sidebar whenever a year checkbox is checked/unchecked (see
// YearRow's onCheck in Sidebar.tsx), which is what actually adds/removes
// a layer of polygons on the map — now also calls closeDetail(). Sidebar
// itself has no knowledge of LotDetailPanel; it only ever calls this
// onToggle prop, so this has to live here. Whenever the active layer
// selection changes, whatever lot/sheet the detail panel was showing may
// no longer even be part of the new selection, so it's closed rather than
// left open showing stale/orphaned content while the map's contents shift
// underneath it. This fires on BOTH checking a year on and unchecking one
// off (handleToggle handles both via the `meta === null` branch), and now
// also on adding/removing a search result (since search results flow
// through the same onToggle/handleToggle path — see above).
//
// SHEET PREVIEW WIRING (earlier pass): AttributeTable's per-sheet "Preview"
// button (see its SheetsTable / onViewSheet prop) is now wired up here.
// Clicking it calls viewSheetInPanel with that sheet's full lot list,
// which stores it in `sheetPreview` state and opens LotDetailPanel in
// "sheet mode" (every lot on the sheet, overlaid polygons + a lot list —
// see LotDetailPanel's own file for how it renders that). Clicking a lot
// inside that list calls selectLotFromSheetPreview, which deliberately
// does NOT clear sheetPreview (see its own comment below) so a "Back to
// Sheet" action in LotDetailPanel's header can return to it. closeDetail
// still clears sheetPreview so re-opening later doesn't briefly flash
// stale sheet content.
//
// TABLE ROW CLICK NOW ZOOMS THE MAP + REFRESHES AN OPEN DETAIL PANEL
// (earlier pass): clicking a row in AttributeTable highlights the row/
// polygon (via `selectedId`, as before) and now additionally (a) fires a
// `focusFeature` request at MapCanvas so the map fits/zooms to that lot's
// polygon bounds, and (b) updates `selectedFeature` so an already-open
// detail panel swaps to show this lot's preview/coordinates instead.
//
// Whether the panel is actually ON SCREEN is governed by a separate
// `detailPanelOpen` boolean, not by `selectedFeature` being non-null.
// `openFeature` (map click's "View Lot Details" popup button, or a
// search select) is the only thing that sets it true; the panel's own
// close button (`closeDetail`) and now handleToggle (see above) are what
// set it false. A table row click deliberately never touches
// `detailPanelOpen`: if the panel is already open it now shows a
// different lot, but a row click can never pop a closed panel open, and
// can never close one that's already showing. See the
// `feature={detailPanelOpen ? selectedFeature : null}` line on
// <LotDetailPanel /> below for where this is enforced.
//
// `focusFeature` is a small piece of state — the clicked feature plus a
// `token` (Date.now()) — passed straight through to MapCanvas, which
// does the actual fitBounds work (see its file-top comment).
//
// MAP POLYGON CLICK SYNC (earlier pass): clicking a polygon directly on
// the map now also calls selectFeatureFromTable (via MapCanvas's
// onPolygonClick), same as clicking that lot's row in AttributeTable —
// so the table auto-drills into/scrolls to the matching row, and an
// already-open detail panel swaps to show it, without opening a closed
// panel. Opening the popup's "View Lot Details" button still goes through
// openFeature, unchanged, and is still the only thing a bare map click can
// use to actually open a closed panel.
//
// AUTH WIRING (earlier pass): the sidebar used to always show the hardcoded
// "Admin User" / "admin@example.com" defaults from Sidebar.tsx's props.
// This page now fetches the real logged-in user from GET /api/auth/me on
// mount and passes userName/userEmail/userType down to both <Sidebar />
// instances (mobile + desktop). handleLogout also actually calls
// POST /api/auth/logout (clearing the session cookie) and redirects to
// "/" (the login page) instead of just console.log-ing.
//
// TOUCH RESIZE (earlier pass): the table's resize handle (and, for
// consistency, the sidebar and detail-panel handles too) previously only
// listened for mouse events — onMouseDown, then window-level mousemove/
// mouseup. On a touchscreen (e.g. iPhone) those events never fire, so the
// table stayed permanently stuck at whatever height it last had, hiding
// whatever was below it with no way to fix it. startTableResize (and its
// sidebar/detail-panel siblings) now accept either a MouseEvent or a
// TouchEvent, and the window-level listener effect adds matching
// touchmove/touchend/touchcancel listeners alongside the existing mouse
// ones. document.body.style.touchAction is set to "none" for the
// duration of a drag so iOS treats it as a resize gesture instead of a
// page scroll. On small screens (<= MOBILE_BREAKPOINT) the table's max
// height is also capped to 75% of the actual viewport height instead of
// the desktop-tuned 640px ceiling, so a value dragged in on desktop can't
// leave the map invisible on a phone. The handle's touch target was also
// made taller (h-4 instead of h-2.5) since a hairline is hard to land a
// thumb on.
//
// BASEMAP SWITCHER (earlier pass): added a floating control (bottom-left of
// the map, clear of the zoom control top-right and the detail panel on
// the right edge) that lets the user pick between Light / Streets / Dark /
// Satellite basemaps. State + persistence lives here, same pattern as
// sidebarWidth/tableHeight/detailPanelWidth: a useState, restored from
// localStorage on mount, written back to localStorage on change. The
// actual tile-swapping happens inside MapCanvas (see its file-top
// comment) — this file only owns "which one is selected" and the UI to
// change it.
//
// DETAIL PANEL RESIZE (earlier pass): the lot detail panel (LotDetailPanel)
// now resizes the same way the sidebar and the attribute table already
// do — drag a handle, width is clamped between a min/max, and the choice
// is persisted to localStorage so it survives a reload. That logic lives
// here (not inside LotDetailPanel) for the same reason sidebar width and
// table height already live here: LotDetailPanel doesn't know about
// window-level mousemove/mouseup, it just renders at whatever width it's
// told and exposes a drag handle that calls back up on mousedown.
//
// (Earlier pass: the whole page wrapped in <SidebarThemeProvider>, see
// src/components/map/SidebarThemeContext.tsx.)

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, ChevronDown, ChevronUp, Table2, Sun, Map as MapIcon, Moon, Satellite } from "lucide-react";
import Sidebar from "@/components/map/Sidebar";
import MapCanvas, { BASEMAPS, type BasemapId } from "@/components/map/MapCanvas";
import AttributeTable, { type SheetPreviewRequest } from "@/components/map/AttributeTable";
import LotDetailPanel from "@/components/map/LotDetailPanel";
import { SidebarThemeProvider, useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import type { LotFeature, SelectionMeta, LotSearchResult } from "@/lib/geo";
import type { ActivityLogRow } from "@/components/NotificationBell";
import CreateShapefileModal from "@/components/CreateShapefileModal";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 300;
const SIDEBAR_COLLAPSED_WIDTH = 64;
const MOBILE_BREAKPOINT = 768;
const WIDTH_STORAGE_KEY = "ocm-sidebar-width";
const COLLAPSED_STORAGE_KEY = "ocm-sidebar-collapsed";
const PEEK_CLOSE_DELAY_MS = 150;
const PEEK_OPEN_DELAY_MS = 400;

const TABLE_MIN_HEIGHT = 180;
const TABLE_MAX_HEIGHT = 640;
const TABLE_DEFAULT_HEIGHT = 300;
const TABLE_HEIGHT_STORAGE_KEY = "ocm-table-height";
// Whether the user has manually collapsed the table (separate from
// whether there's anything to show it for).
const TABLE_VISIBLE_STORAGE_KEY = "ocm-table-visible";
// Height of the always-there toggle bar when the table itself is collapsed.
const TABLE_BAR_HEIGHT = 40;
// On phones the desktop-tuned 640px max would let the table cover almost
// the whole screen with no way to see the map underneath. Cap it to a
// share of the actual viewport height on small screens instead.
const MOBILE_TABLE_MAX_HEIGHT_RATIO = 0.75;

// Same idea as the sidebar's width constants, for the lot detail panel on
// the right side of the map.
const DETAIL_PANEL_MIN_WIDTH = 320;
const DETAIL_PANEL_MAX_WIDTH = 640;
const DETAIL_PANEL_DEFAULT_WIDTH = 380;
const DETAIL_PANEL_WIDTH_STORAGE_KEY = "ocm-detail-panel-width";

// Persisted basemap choice + the ordered list the switcher renders.
// Derives its labels from MapCanvas's BASEMAPS map so the two files can't
// drift out of sync on what a basemap is called.
const BASEMAP_STORAGE_KEY = "ocm-basemap-id";
const DEFAULT_BASEMAP_ID: BasemapId = "light";

const BASEMAP_ICONS: Record<BasemapId, typeof Sun> = {
  light: Sun,
  streets: MapIcon,
  dark: Moon,
  satellite: Satellite,
};

const BASEMAP_ORDER: BasemapId[] = ["light", "streets", "dark", "satellite"];

function isBasemapId(value: string): value is BasemapId {
  return value === "light" || value === "streets" || value === "dark" || value === "satellite";
}

// Pulls the clientX/clientY out of either a MouseEvent or a TouchEvent so
// the same drag-handling code can serve both input types. For touchend/
// touchcancel, `touches` is already empty (the finger has lifted), so we
// fall back to `changedTouches`, which still has the final position.
function clientYFrom(e: MouseEvent | TouchEvent): number {
  if ("touches" in e) {
    return e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY ?? 0;
  }
  return e.clientY;
}
function clientXFrom(e: MouseEvent | TouchEvent): number {
  if ("touches" in e) {
    return e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0;
  }
  return e.clientX;
}

export default function MapViewerPage() {
  return (
    <SidebarThemeProvider>
      <MapViewerPageInner />
    </SidebarThemeProvider>
  );
}

function MapViewerPageInner() {
  const { theme, vars } = useSidebarTheme();
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const [tableHeight, setTableHeight] = useState(TABLE_DEFAULT_HEIGHT);
  const [isTableResizing, setIsTableResizing] = useState(false);
  // Manual show/hide, independent of whether there are selections.
  const [tableVisible, setTableVisible] = useState(true);

  // Width of the lot detail panel + whether it's actively being dragged.
  // Mirrors sidebarWidth/isResizing above.
  const [detailPanelWidth, setDetailPanelWidth] = useState(DETAIL_PANEL_DEFAULT_WIDTH);
  const [isDetailPanelResizing, setIsDetailPanelResizing] = useState(false);

  // Which basemap is currently shown under the lot layers.
  const [basemapId, setBasemapId] = useState<BasemapId>(DEFAULT_BASEMAP_ID);

  const [activeSelections, setActiveSelections] = useState<Record<string, SelectionMeta>>({});
  const [layerData, setLayerData] = useState<Record<string, LotFeature[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorKeys, setErrorKeys] = useState<Set<string>>(new Set());
  const [truncatedKeys, setTruncatedKeys] = useState<Set<string>>(new Set());

  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<LotFeature | null>(null);

  // A whole-sheet preview requested from AttributeTable's per-row
  // "Preview" eye button (sheets-list view). Shown in LotDetailPanel's
  // "sheet mode" — every lot on that sheet, overlaid polygons + a lot
  // list — whenever `selectedFeature` is null (single-lot selection
  // always wins; see LotDetailPanel's own file for how it decides which
  // mode to render). Cleared alongside everything else in closeDetail.
  const [sheetPreview, setSheetPreview] = useState<SheetPreviewRequest | null>(null);

  // Whether LotDetailPanel is actually visible. Deliberately separate from
  // `selectedFeature` (which is just "what data would the panel show if it
  // were open"): the panel should only ever open via a deliberate action
  // (clicking a polygon's "View Lot Details" popup button, a search
  // select, or a sheet's "Preview" button) and only ever close via the
  // user hitting its own close button, or the active layer selection
  // changing underneath it (see handleToggle) — a table row click should
  // be able to swap what's INSIDE an already-open panel without either
  // opening a closed one or closing an open one.

  // A request to fit/zoom the map to a single lot's polygon bounds,
  // fired whenever a row is selected from AttributeTable. `token` is a
  // fresh value on every click (even re-clicks of the same lot) so
  // MapCanvas's effect always re-fires. null when there's nothing to
  // focus (e.g. right after mount).
  const [focusFeature, setFocusFeature] = useState<{ feature: LotFeature; token: number } | null>(null);

  const [detailPanelOpen, setDetailPanelOpen] = useState(false);

  const [tableFilterKey, setTableFilterKey] = useState<string | null>(null);

  const [searchError, setSearchError] = useState(false);

  // The logged-in user, fetched once on mount from /api/auth/me. Starts
  // null (Sidebar's own default props cover that brief window), then gets
  // filled in — or stays null if the fetch fails, which shouldn't happen
  // in practice since middleware.ts already keeps unauthenticated visitors
  // off this page entirely.
  const [currentUser, setCurrentUser] = useState<{
    username: string;
    email: string;
    usertype: string;
  } | null>(null);

  // id (stringified) -> hex color. Owned here so both AttributeTable
  // (which writes to it via a swatch click) and MapCanvas (which reads it
  // to paint polygons) stay in sync through a single source of truth.
  const [lotColors, setLotColors] = useState<Record<string, string>>({});

  const isResizingRef = useRef(false);
  const peekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isTableResizingRef = useRef(false);
  const tableResizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [hoveredBasemapId, setHoveredBasemapId] = useState<BasemapId | null>(null);
  // Same drag-tracking pattern as the table's resize ref, plus a plain ref
  // mirror of the width itself (kept in sync inside onMove) so onEnd can
  // persist the *current* value to localStorage without depending on a
  // stale closure from mount.
  const isDetailPanelResizingRef = useRef(false);
  const detailPanelResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const detailPanelWidthRef = useRef(DETAIL_PANEL_DEFAULT_WIDTH);

  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Fetch the logged-in user once on mount. Failures are swallowed on
  // purpose -- if this fails, Sidebar just falls back to its own default
  // props ("Admin User" / "admin@example.com") rather than the page
  // erroring out.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setCurrentUser(d.user))
      .catch(() => setCurrentUser(null));
  }, []);

  // Restore persisted sidebar width/collapsed state + table height/visibility
  // + detail panel width + basemap choice on mount.
  useEffect(() => {
    try {
      const storedWidth = window.localStorage.getItem(WIDTH_STORAGE_KEY);
      if (storedWidth) {
        const parsed = Number(storedWidth);
        if (!Number.isNaN(parsed)) {
          setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed)));
        }
      }
      const storedCollapsed = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (storedCollapsed) setSidebarCollapsed(storedCollapsed === "1");

      const storedTableHeight = window.localStorage.getItem(TABLE_HEIGHT_STORAGE_KEY);
      if (storedTableHeight) {
        const parsed = Number(storedTableHeight);
        if (!Number.isNaN(parsed)) {
          // Clamp against the mobile-aware max too, not just the desktop
          // one — otherwise a height persisted from a desktop session
          // could still open a phone tab already too tall to fit.
          const max =
            typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT
              ? Math.round(window.innerHeight * MOBILE_TABLE_MAX_HEIGHT_RATIO)
              : TABLE_MAX_HEIGHT;
          setTableHeight(Math.min(max, Math.max(TABLE_MIN_HEIGHT, parsed)));
        }
      }

      const storedTableVisible = window.localStorage.getItem(TABLE_VISIBLE_STORAGE_KEY);
      if (storedTableVisible) setTableVisible(storedTableVisible === "1");

      const storedDetailWidth = window.localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY);
      if (storedDetailWidth) {
        const parsed = Number(storedDetailWidth);
        if (!Number.isNaN(parsed)) {
          const clamped = Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, parsed));
          setDetailPanelWidth(clamped);
          detailPanelWidthRef.current = clamped;
        }
      }

      const storedBasemap = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
      if (storedBasemap && isBasemapId(storedBasemap)) {
        setBasemapId(storedBasemap);
      }
    } catch {
      // localStorage unavailable (e.g. private browsing) — fall back to defaults.
    }
  }, []);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  // Handles both mouse-drag and touch-drag for all three resize handles
  // (sidebar width, table height, detail panel width). Mouse and touch
  // listeners are registered together so a single effect owns the whole
  // drag lifecycle for all three, same as before this pass — the only
  // change is adding the touch* listeners alongside the mouse ones and
  // routing both through the clientX/clientYFrom helpers above.
  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (isResizingRef.current) {
        const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, clientXFrom(e)));
        setSidebarWidth(next);
      }
      if (isTableResizingRef.current && tableResizeStartRef.current) {
        const { startY, startHeight } = tableResizeStartRef.current;
        const delta = startY - clientYFrom(e);
        const dynamicMax =
          typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT
            ? Math.round(window.innerHeight * MOBILE_TABLE_MAX_HEIGHT_RATIO)
            : TABLE_MAX_HEIGHT;
        const next = Math.min(dynamicMax, Math.max(TABLE_MIN_HEIGHT, startHeight + delta));
        setTableHeight(next);
      }
      // Detail panel is anchored to the right edge, so dragging the handle
      // *left* (pointer moves left, i.e. clientX decreases relative to
      // where the drag started) should grow it — same delta-from-start
      // approach as the table's height drag, just on the x axis.
      if (isDetailPanelResizingRef.current && detailPanelResizeStartRef.current) {
        const { startX, startWidth } = detailPanelResizeStartRef.current;
        const delta = startX - clientXFrom(e);
        const next = Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, startWidth + delta));
        detailPanelWidthRef.current = next;
        setDetailPanelWidth(next);
      }
    }
    function onEnd() {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.touchAction = "";
        try {
          window.localStorage.setItem(WIDTH_STORAGE_KEY, String(sidebarWidth));
        } catch {
          // ignore
        }
      }
      if (isTableResizingRef.current) {
        isTableResizingRef.current = false;
        setIsTableResizing(false);
        tableResizeStartRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.touchAction = "";
        try {
          window.localStorage.setItem(TABLE_HEIGHT_STORAGE_KEY, String(tableHeight));
        } catch {
          // ignore
        }
      }
      if (isDetailPanelResizingRef.current) {
        isDetailPanelResizingRef.current = false;
        setIsDetailPanelResizing(false);
        detailPanelResizeStartRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.touchAction = "";
        try {
          window.localStorage.setItem(DETAIL_PANEL_WIDTH_STORAGE_KEY, String(detailPanelWidthRef.current));
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    // { passive: false } lets onMove call preventDefault-equivalent
    // behavior implicitly by being non-passive — without it iOS may treat
    // the gesture as a page scroll instead of handing it to us as a drag.
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (peekTimeoutRef.current) clearTimeout(peekTimeoutRef.current);
    };
  }, []);

  function startResize(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
  }

  // Accepts both a mouse and a touch event — only clientY is needed here,
  // and clientYFrom() reads it out of whichever shape was passed in.
  function startTableResize(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isTableResizingRef.current = true;
    setIsTableResizing(true);
    tableResizeStartRef.current = { startY: clientYFrom(e.nativeEvent), startHeight: tableHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    // Stops the page itself from scrolling while a finger is dragging the
    // handle — without this, iOS treats the drag as a page-scroll gesture
    // and the height never actually changes.
    document.body.style.touchAction = "none";
  }

  // Mirrors startTableResize, just tracking width instead of height.
  function startDetailPanelResize(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isDetailPanelResizingRef.current = true;
    setIsDetailPanelResizing(true);
    detailPanelResizeStartRef.current = { startX: clientXFrom(e.nativeEvent), startWidth: detailPanelWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
  }

  function toggleCollapsed() {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Manual show/hide toggle for the attribute table panel.
  function toggleTableVisible() {
    setTableVisible((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(TABLE_VISIBLE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Called by the basemap switcher buttons. Persists immediately (unlike
  // the drag-based width/height settings, there's no in-progress gesture
  // to wait out — every click is a complete, final choice).
  function handleSetBasemap(id: BasemapId) {
    setBasemapId(id);
    try {
      window.localStorage.setItem(BASEMAP_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  function handleSidebarMouseEnter() {
    if (isMobile || !sidebarCollapsed) return;
    if (peekTimeoutRef.current) clearTimeout(peekTimeoutRef.current);
    peekTimeoutRef.current = setTimeout(() => setPeeking(true), PEEK_OPEN_DELAY_MS);
  }

  function handleSidebarMouseLeave() {
    if (peekTimeoutRef.current) clearTimeout(peekTimeoutRef.current);
    peekTimeoutRef.current = setTimeout(() => setPeeking(false), PEEK_CLOSE_DELAY_MS);
  }

  const isPeeking = !isMobile && sidebarCollapsed && peeking;

  // Called by Sidebar whenever a year checkbox is checked/unchecked (see
  // YearRow's onCheck in Sidebar.tsx) or a search result is removed from
  // the Selected tab (see SelectedPanel's X button) — this is what
  // actually adds/removes a layer of polygons on the map. Whenever that
  // happens, close the lot detail panel: the layer just changed under it,
  // so whatever lot/sheet it was showing may no longer even be part of
  // the current selection, and leaving it open while the map's contents
  // shift is confusing. Sidebar itself has no knowledge of LotDetailPanel
  // — it only ever calls this onToggle prop — so this has to live here,
  // not in Sidebar.tsx. Fires on both adding a selection (meta non-null)
  // and removing one (meta === null).
  function handleToggle(key: string, meta: SelectionMeta | null) {
    setActiveSelections((prev) => {
      const next = { ...prev };
      if (meta === null) delete next[key];
      else next[key] = meta;
      return next;
    });
    closeDetail();
  }

  function handleViewLayer(key: string) {
    setTableFilterKey((prev) => (prev === key ? null : key));
    // Picking a layer to inspect implies wanting to see the table — if the
    // user had it collapsed, bring it back rather than silently doing
    // nothing.
    setTableVisible(true);
  }

  useEffect(() => {
    if (tableFilterKey && !activeSelections[tableFilterKey]) {
      setTableFilterKey(null);
    }
  }, [tableFilterKey, activeSelections]);

  // Map click flow: a click on a polygon just opens the themed popup (see
  // MapCanvas); this is only called when the user then clicks that
  // popup's "View Lot Details" button, or selects a search result. It
  // highlights the lot, loads it into the panel, AND deliberately opens
  // the panel — this is one of the "open" actions (the sheet Preview
  // button, see viewSheetInPanel below, is the other).
  function openFeature(feature: LotFeature) {
    setSelectedId(feature.id);
    setSelectedFeature(feature);
    setSheetPreview(null);
    setDetailPanelOpen(true);
    if (isMobile) setMobileOpen(false);
  }

  // Attribute table row click AND map polygon click (via MapCanvas's
  // onPolygonClick — both wired to this same function below): highlights
  // the row (and, since MapCanvas highlights off the same selectedId, the
  // polygon on the map), fires a focusFeature request so the map zooms to
  // that lot's polygon bounds, and updates `selectedFeature` so the
  // detail panel's content reflects this lot. Also clears any active
  // sheetPreview, since a single lot always takes priority in
  // LotDetailPanel's own mode logic anyway — clearing it here just keeps
  // state tidy. Deliberately does NOT touch `detailPanelOpen`: if the
  // panel is already open it swaps to show this lot, but this never opens
  // a closed panel and never closes an open one — only the panel's own
  // close button (see closeDetail), a "View Lot Details" click (see
  // openFeature), a sheet Preview click (see viewSheetInPanel), or a
  // sidebar layer toggle (see handleToggle) change whether it's showing
  // at all.
  function selectFeatureFromTable(feature: LotFeature) {
    setSelectedId(feature.id);
    setSelectedFeature(feature);
    setSheetPreview(null);
    setFocusFeature({ feature, token: Date.now() });
  }

  // Fired from AttributeTable's per-sheet "Preview" eye button (sheets
  // list view). Shows every lot on that sheet in LotDetailPanel's sheet
  // mode — clears selectedFeature so the panel renders sheet mode instead
  // of single-lot mode, and deliberately opens the panel, same as
  // openFeature above.
  function viewSheetInPanel(sheet: SheetPreviewRequest) {
    setSelectedFeature(null);
    setSheetPreview(sheet);
    setDetailPanelOpen(true);
  }

  // Fired when a lot inside LotDetailPanel's sheet-preview list is
  // clicked. Deliberately does NOT reuse selectFeatureFromTable, because
  // that function always clears `sheetPreview` — which is correct for a
  // map click or table row click (there's no sheet preview to preserve in
  // those cases) but wrong here: this click happens *from inside* a sheet
  // preview, and the whole point is to let the user come back to it (see
  // backToSheetPreview below and the "Back to Sheet" button in
  // LotDetailPanel). So this sets selectedId/selectedFeature/focusFeature
  // the same way, but leaves `sheetPreview` untouched.
  function selectLotFromSheetPreview(feature: LotFeature) {
    setSelectedId(feature.id);
    setSelectedFeature(feature);
    setFocusFeature({ feature, token: Date.now() });
  }

  // The "Back to Sheet" button inside LotDetailPanel's single-lot header
  // (only shown when the current lot came from a still-live sheetPreview,
  // see LotDetailPanel's own `cameFromSheet`). Clearing just
  // `selectedFeature` — and leaving `sheetPreview` and `detailPanelOpen`
  // alone — is enough: LotDetailPanel's own `sheetMode` logic then takes
  // over and renders the sheet view again, exactly like it does right
  // after `viewSheetInPanel` first opens it.
  function backToSheetPreview() {
    setSelectedId(null);
    setSelectedFeature(null);
  }

  // The panel's own close button, plus handleToggle (see above) — these
  // are the only two places detailPanelOpen is ever set back to false
  // (aside from the "selection vanished underneath us" effect below).
  function closeDetail() {
    setDetailPanelOpen(false);
    setSelectedId(null);
    setSelectedFeature(null);
    setSheetPreview(null);
  }

  // Called by AttributeTable when the user picks a swatch (or "Clear
  // color") for the currently checked lots. `color` is a hex string, or
  // null to remove color from those lots. This is the single place
  // lotColors ever gets mutated.
  function handleSetLotColors(lotIds: Array<string | number>, color: string | null) {
    setLotColors((prev) => {
      const next = { ...prev };
      for (const id of lotIds) {
        const key = String(id);
        if (color) {
          next[key] = color;
        } else {
          delete next[key];
        }
      }
      return next;
    });
  }

  // Called by AttributeTable's inline "Add link" control (sheets
  // list, Plan column) when the user saves a plan URL for a sheet that
  // had none yet. PATCHes /api/lot-sheets/[id]; on success, patches
  // planUrl onto every currently-loaded feature belonging to that sheetId
  // across all layers, so the table (and anything else reading
  // layerData/allFeatures) reflects the new link immediately without a
  // refetch. Throws (with the server's error message when available)
  // on failure so AttributeTable's inline control can show it next to the
  // input instead of failing silently.
  async function handleUpdatePlanUrl(sheetId: number, planUrl: string) {
    const res = await fetch(`/api/lot-sheets/${sheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planUrl }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save plan link.");
    }

    setLayerData((d) => {
      const next: typeof d = {};
      for (const [key, feats] of Object.entries(d)) {
        next[key] = feats.map((f) =>
          f.properties.sheetId === sheetId
            ? { ...f, properties: { ...f.properties, planUrl } }
            : f
        );
      }
      return next;
    });
  }

  // Called by AttributeTable's inline "Add survey no." control (sheets list
  // Survey No. column, and drilled-in breadcrumb). PATCHes
  // /api/lot-sheets/[id] with { surveyNo }. The API only fills lots on that
  // sheet that currently have no survey_no — existing values are left alone.
  // On success, optimistically patch the same rule into layerData so the
  // table updates without a refetch. Throws on failure so the inline
  // control can show the error next to its input.
  async function handleUpdateSurveyNo(sheetId: number, surveyNo: string) {
    const res = await fetch(`/api/lot-sheets/${sheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surveyNo }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save survey number.");
    }

    setLayerData((d) => {
      const next: typeof d = {};
      for (const [key, feats] of Object.entries(d)) {
        next[key] = feats.map((f) => {
          if (f.properties.sheetId !== sheetId) return f;
          const current = f.properties.surveyNo;
          const empty = current == null || String(current).trim() === "";
          if (!empty) return f;
          return {
            ...f,
            properties: { ...f.properties, surveyNo },
          };
        });
      }
      return next;
    });
  }

  // Called by AttributeTable's inline "Add link" control (sheets
  // list, Documents column, or the drilled-in breadcrumb) when the user
  // saves a documents URL for a sheet that had none yet. Same shape as
  // handleUpdatePlanUrl — a single PATCH to /api/lot-sheets/[id], then an
  // optimistic patch of documentsUrl onto every currently-loaded feature
  // belonging to that sheetId — just writes to a different field
  // (documents_url instead of plan_url). Throws on failure so the inline
  // control can surface the error next to its input instead of failing
  // silently.
  async function handleUpdateDocumentsUrl(sheetId: number, documentsUrl: string) {
    const res = await fetch(`/api/lot-sheets/${sheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentsUrl }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save documents link.");
    }

    setLayerData((d) => {
      const next: typeof d = {};
      for (const [key, feats] of Object.entries(d)) {
        next[key] = feats.map((f) =>
          f.properties.sheetId === sheetId
            ? { ...f, properties: { ...f.properties, documentsUrl } }
            : f
        );
      }
      return next;
    });
  }

  // Called by AttributeTable's inline "Set class" control (sheets list
  // Class column, or the drilled-in breadcrumb) when the user picks
  // "admin" or "private" for a sheet that has no survey_class yet.
  // survey_class lives directly on lot_sheets and — unlike survey_no —
  // never cascades down to individual lots, so this is just a straight
  // PATCH + optimistic patch of surveyClass onto every currently-loaded
  // feature belonging to that sheetId. Throws on failure so the inline
  // control can show the error next to its dropdown.
  async function handleUpdateSurveyClass(sheetId: number, surveyClass: "admin" | "private") {
    const res = await fetch(`/api/lot-sheets/${sheetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surveyClass }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save survey class.");
    }

    setLayerData((d) => {
      const next: typeof d = {};
      for (const [key, feats] of Object.entries(d)) {
        next[key] = feats.map((f) =>
          f.properties.sheetId === sheetId
            ? { ...f, properties: { ...f.properties, surveyClass } }
            : f
        );
      }
      return next;
    });
  }

  // Fired when the user picks a result from Sidebar's search bar (see
  // SearchBar's onSelect -> Sidebar's onSearchSelect prop). Fetches the
  // full polygon for that lot, then registers it as a real selection under
  // `search:<id>` — written into BOTH `layerData` (so the polygon shows on
  // the map immediately, without waiting on the general activeSelections
  // fetch effect below) and `activeSelections` (so it shows up in
  // Sidebar's "Selected" tab, can be removed via that row's X button,
  // included in "Clear all", and can drive the attribute table filter via
  // "view in table" — exactly like a year layer). `query: { id: result.id }`
  // matches what the activeSelections-driven fetch effect expects if this
  // entry is ever dropped from layerData and needs to be refetched (e.g.
  // after an unrelated remount) — it hits the same /api/map/lots?id=
  // endpoint used here.
  //
  // Re-searching the same lot re-adds the same key (a no-op if it's
  // already selected); searching a different lot adds an additional
  // Selected entry alongside any existing ones, same multi-select
  // behavior as picking several years.
  async function handleSearchSelect(result: LotSearchResult) {
    setSearchError(false);
    try {
      const r = await fetch(`/api/map/lots?id=${result.id}`);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const fc: { features: LotFeature[] } = await r.json();
      const feature = fc.features[0];
      if (!feature) throw new Error("Lot not found");

      const key = `search:${result.id}`;
      const label = `${result.owner || "Unnamed owner"} · Lot ${result.lotNo ?? "—"}`;

      setLayerData((d) => ({ ...d, [key]: [feature] }));
      setActiveSelections((prev) => ({
        ...prev,
        [key]: { query: { id: result.id }, label },
      }));

      openFeature(feature);
    } catch {
      setSearchError(true);
    }
  }

  // Fired when the user clicks a "today's activity" entry in the
  // notification bell (see NotificationBell's onSelectLog -> Sidebar's
  // onActivityLogSelect prop). Every logged entry is currently a
  // "lot_sheet" (see logActivity() in /api/lot-sheets POST), so entity_id
  // is a lot_sheets.id. Same overall shape as handleSearchSelect: fetch
  // the full data, register it under a content-addressed key in BOTH
  // layerData and activeSelections so it renders on the map and shows up
  // in the Selected tab (Sidebar.tsx already special-cases `sheet:<id>`
  // keys with a bell icon there), then focus the map + open the detail
  // panel on the first lot -- the same "project it on the map" effect a
  // search pick gets.
  //
  // GET /api/lot-sheets/[id] returns raw snake_case columns straight off
  // the DB (sheet.lots is `SELECT l.*`, plus sheet-level plan_url /
  // documents_url / survey_class / id), NOT the same shape /api/map/lots
  // returns -- so the mapping below is done by hand rather than reused.
  // That route doesn't join municipality/barangay/province/surveyor names
  // for individual lots (only for the sheet's control point), so those
  // fields are left null here; if a bell-selected lot needs them filled
  // in, that join would need to be added there.
  async function handleActivityLogSelect(log: ActivityLogRow) {
    // Captured into a local const (rather than using `log.entity_id`
    // directly further down) so TypeScript can carry the null-check's
    // narrowing into the closures passed to setLayerData/setActiveSelections
    // below -- narrowing on a property access doesn't survive across a
    // function boundary, since the object could in principle be mutated
    // between the check and the closure running. `entityId` here is a
    // plain local, so TS knows it's `number` for the rest of this function.
    const entityId = log.entity_id;
    if (entityId == null) return;
    const key = `sheet:${entityId}`;

    // Re-clicking an already-loaded entry just re-focuses it instead of
    // re-fetching -- same no-op-re-add behavior as re-picking a search result.
    if (activeSelections[key] && layerData[key]?.length) {
      const first = layerData[key][0];
      setSelectedId(first.id);
      setSelectedFeature(first);
      setSheetPreview(null);
      setDetailPanelOpen(true);
      setFocusFeature({ feature: first, token: Date.now() });
      if (isMobile) setMobileOpen(false);
      return;
    }

    setSearchError(false);
    try {
      const r = await fetch(`/api/lot-sheets/${entityId}`);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const sheet = await r.json();
      const rawLots: any[] = Array.isArray(sheet.lots) ? sheet.lots : [];

      // Map the raw `SELECT l.*` rows this route returns into the same
      // camelCase LotFeature shape the rest of the app expects. Fields
      // this route doesn't join (province/municipality/barangay/surveyor
      // names, dateSurveyed, sheetNo, remarks, encodedBy) are left null
      // rather than guessed at.
      const features: LotFeature[] = rawLots
        .filter((l) => l.geojson)
        .map((l) => ({
          id: l.id,
          type: "Feature",
          geometry: l.geojson.geometry,
          properties: {
            lotNo: l.lot_no,
            owner: [l.owner_surname, l.owner_given_name].filter(Boolean).join(", "),
            ownerGivenName: l.owner_given_name,
            ownerSurname: l.owner_surname,
            province: null,
            municipality: null,
            barangay: null,
            surveyNo: l.survey_no,
            dateSurveyed: null,
            surveyor: null,
            areaSqm: l.area_sqm,
            sheetId: sheet.id,
            sheetNo: sheet.sheet_no ?? null,
            patentNo: l.patent_no,
            remarks: l.remarks ?? null,
            planUrl: sheet.plan_url,
            documentsUrl: sheet.documents_url,
            surveyClass: sheet.survey_class,
            encodedBy: null,
          },
        })) as LotFeature[];

      if (features.length === 0) throw new Error("No mapped lots on this sheet");

      setLayerData((d) => ({ ...d, [key]: features }));
      setActiveSelections((prev) => ({
        ...prev,
        [key]: { query: { sheet_id: entityId }, label: log.description },
      }));

      const first = features[0];
      setSelectedId(first.id);
      setSelectedFeature(first);
      setSheetPreview(null);
      setDetailPanelOpen(true);
      setFocusFeature({ feature: first, token: Date.now() });
      setTableVisible(true);
      if (isMobile) setMobileOpen(false);
    } catch {
      setSearchError(true);
    }
  }

  // Clears the session cookie server-side, then sends the user back to the
  // login page. Awaiting the fetch first (rather than firing-and-forgetting)
  // means the cookie is actually gone before middleware.ts re-checks auth
  // on the redirect target.
  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/"; // full page reload — bypasses the client router cache entirely
    }
  }

  useEffect(() => {
    Object.entries(activeSelections).forEach(([key, sel]) => {
      if (layerData[key] || loadingKeys.has(key)) return;

      setLoadingKeys((s) => new Set(s).add(key));
      setErrorKeys((s) => {
        if (!s.has(key)) return s;
        const n = new Set(s);
        n.delete(key);
        return n;
      });

      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(sel.query).map(([k, v]) => [k, String(v)]))
      ).toString();

      fetch(`/api/map/lots?${params}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed (${r.status})`);
          return r.json();
        })
        .then((fc: { features: LotFeature[]; truncated?: boolean }) => {
          setLayerData((d) => ({ ...d, [key]: fc.features }));
          setTruncatedKeys((s) => {
            const n = new Set(s);
            if (fc.truncated) n.add(key);
            else n.delete(key);
            return n;
          });
        })
        .catch(() => {
          setLayerData((d) => ({ ...d, [key]: [] }));
          setErrorKeys((s) => new Set(s).add(key));
        })
        .finally(() => {
          setLoadingKeys((s) => {
            const n = new Set(s);
            n.delete(key);
            return n;
          });
        });
    });

    // Drop any layerData entry whose key no longer has a matching
    // activeSelections entry. Search results and notification-bell picks
    // now live in activeSelections (under `search:<id>` / `sheet:<id>`
    // keys — see handleSearchSelect and handleActivityLogSelect above)
    // just like year layers do, so they're cleaned up here the same way;
    // no special case needed for either.
    setLayerData((d) => {
      let changed = false;
      const next: typeof d = {};
      for (const k of Object.keys(d)) {
        if (activeSelections[k]) next[k] = d[k];
        else changed = true;
      }
      return changed ? next : d;
    });

    setErrorKeys((s) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of s) {
        if (activeSelections[k]) next.add(k);
        else changed = true;
      }
      return changed ? next : s;
    });

    setTruncatedKeys((s) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of s) {
        if (activeSelections[k]) next.add(k);
        else changed = true;
      }
      return changed ? next : s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelections]);

  const allFeatures = useMemo(() => {
    const seen = new Map<string, LotFeature>();
    for (const feats of Object.values(layerData)) {
      for (const f of feats) {
        seen.set(String(f.id), f);
      }
    }
    return Array.from(seen.values());
  }, [layerData]);

  const isLoading = loadingKeys.size > 0;
  const hasError = errorKeys.size > 0 || searchError;
  const hasTruncated = truncatedKeys.size > 0;

  useEffect(() => {
    if (isLoading || selectedId == null) return;
    const stillVisible = allFeatures.some((f) => String(f.id) === String(selectedId));
    if (!stillVisible) {
      setSelectedId(null);
      setSelectedFeature(null);
      setDetailPanelOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFeatures, isLoading]);

  const summary = useMemo(() => {
    const count = allFeatures.length;
    const totalArea = allFeatures.reduce((sum, f) => sum + (Number(f.properties.areaSqm) || 0), 0);
    return { count, totalArea };
  }, [allFeatures]);

  const tableFeatures = useMemo(() => {
    if (tableFilterKey && layerData[tableFilterKey]) return layerData[tableFilterKey];
    return allFeatures;
  }, [tableFilterKey, layerData, allFeatures]);

  const tableSummary = useMemo(() => {
    const count = tableFeatures.length;
    const totalArea = tableFeatures.reduce((sum, f) => sum + (Number(f.properties.areaSqm) || 0), 0);
    return { count, totalArea };
  }, [tableFeatures]);

  const tableFilterLabel = tableFilterKey ? activeSelections[tableFilterKey]?.label ?? null : null;

  // The table area (bar + table) only exists at all once there's
  // something selected. Within that, `tableVisible` is the user's manual
  // expand/collapse choice.
  const hasSelections = Object.keys(activeSelections).length > 0;
  const tableExpanded = hasSelections && tableVisible;

  return (
    <main
      className={`${uiFont.className} relative flex h-screen overflow-hidden bg-[var(--sb-bg)]`}
      style={vars}
    >
      {isMobile && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="absolute left-3 top-3 z-[25] flex h-10 w-10 items-center justify-center rounded-xl border shadow-md"
          style={{ background: theme.bgElevated, borderColor: theme.border, color: theme.text }}
        >
          <Menu size={19} />
        </button>
      )}

      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30"
          style={{ background: theme.overlayBg }}
        />
      )}

      {isMobile ? (
        <aside
          className="fixed left-0 top-0 z-[35] h-full flex-shrink-0 border-r"
          style={{
            overflow: "visible",
            boxSizing: "border-box",
            width: SIDEBAR_DEFAULT_WIDTH,
            transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.2s ease",
            background: theme.bg,
            borderColor: theme.border,
          }}
        >
          <div className="h-full w-full overflow-hidden">
            <Sidebar
              activeSelections={activeSelections}
              onToggle={handleToggle}
              collapsed={false}
              onToggleCollapsed={toggleCollapsed}
              onCloseMobile={() => setMobileOpen(false)}
              onLogout={handleLogout}
              userName={currentUser?.username}
              userEmail={currentUser?.email}
              userType={currentUser?.usertype}
              onSearchSelect={handleSearchSelect}
              onCreateShapefile={() => setCreateModalOpen(true)}
              onViewLayer={handleViewLayer}
              activeTableKey={tableFilterKey}
              onActivityLogSelect={handleActivityLogSelect}
            />
          </div>
        </aside>
      ) : (
        <div
          className="relative h-full flex-shrink-0"
          style={{
            width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth,
            transition: isResizing ? "none" : "width 0.18s ease",
          }}
        >
          <aside
            onMouseEnter={handleSidebarMouseEnter}
            onMouseLeave={handleSidebarMouseLeave}
            className="border-r"
            style={{
              position: isPeeking ? "absolute" : "relative",
              top: 0,
              left: 0,
              boxSizing: "border-box",
              height: "100%",
              width: isPeeking ? sidebarWidth : sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth,
              zIndex: isPeeking ? 40 : "auto",
              boxShadow: isPeeking ? theme.shadow : "none",
              overflow: "visible",
              transition: isResizing ? "none" : "width 0.18s ease, box-shadow 0.18s ease",
              background: theme.bg,
              borderColor: theme.border,
            }}
          >
            <div className="h-full w-full overflow-hidden">
              <Sidebar
                activeSelections={activeSelections}
                onToggle={handleToggle}
                collapsed={isPeeking ? false : sidebarCollapsed}
                onToggleCollapsed={toggleCollapsed}
                onLogout={handleLogout}
                userName={currentUser?.username}
                userEmail={currentUser?.email}
                userType={currentUser?.usertype}
                onSearchSelect={handleSearchSelect}
                onCreateShapefile={() => setCreateModalOpen(true)}
                onViewLayer={handleViewLayer}
                activeTableKey={tableFilterKey}
                onActivityLogSelect={handleActivityLogSelect}
              />
            </div>

            {!sidebarCollapsed && (
              <div
                onMouseDown={startResize}
                onTouchStart={startResize}
                title="Drag to resize"
                className="group absolute top-0 z-20 h-full w-2.5 cursor-col-resize"
                style={{ right: -5, touchAction: "none" }}
              >
                <div
                  className="mx-auto h-full w-[2px] transition-colors"
                  style={{ background: isResizing ? theme.accent : "transparent" }}
                />
              </div>
            )}
          </aside>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <MapCanvas
            features={allFeatures}
            selectedId={selectedId}
            focusPoint={null}
            focusFeature={focusFeature}
            onPolygonClick={selectFeatureFromTable}
            onFeatureClick={openFeature}
            lotColors={lotColors}
            basemapId={basemapId}
          />

          {/* Basemap switcher. Bottom-left keeps it clear of MapLibre's
              NavigationControl (top-right) and LotDetailPanel (right
              edge). Each button gets a themed hover tooltip (rendered
              above the button, since the switcher itself sits at the
              bottom of the map — a tooltip below would run off-screen).
              No title="" attribute: the custom tooltip below replaces it,
              so hovering doesn't show both a native and a custom one. */}
          <div
            className="absolute bottom-3 left-3 z-[15] flex items-center gap-0.5 rounded-xl border p-1 shadow-md"
            style={{ background: theme.bgElevated, borderColor: theme.border }}
          >
            {BASEMAP_ORDER.map((id) => {
              const active = basemapId === id;
              const Icon = BASEMAP_ICONS[id];
              const showTooltip = hoveredBasemapId === id;
              return (
                <div key={id} className="relative">
                  {showTooltip && (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium shadow-md"
                      style={{ background: theme.text, color: theme.bgElevated }}
                    >
                      {BASEMAPS[id].label}
                      <div
                        className="absolute left-1/2 top-full -translate-x-1/2"
                        style={{
                          width: 0,
                          height: 0,
                          borderLeft: "4px solid transparent",
                          borderRight: "4px solid transparent",
                          borderTop: `4px solid ${theme.text}`,
                        }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Switch to ${BASEMAPS[id].label} basemap`}
                    aria-pressed={active}
                    onClick={() => handleSetBasemap(id)}
                    onMouseEnter={() => setHoveredBasemapId(id)}
                    onMouseLeave={() => setHoveredBasemapId(null)}
                    onFocus={() => setHoveredBasemapId(id)}
                    onBlur={() => setHoveredBasemapId(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
                    style={{
                      background: active ? theme.accent : "transparent",
                      color: active ? "#ffffff" : theme.textMuted,
                    }}
                  >
                    <Icon size={15} />
                  </button>
                </div>
              );
            })}
          </div>

          {isLoading && (
            <div
              className="absolute right-3 top-3 rounded-lg px-3 py-1.5 text-[13px] shadow-md"
              style={{ background: theme.bgElevated, color: theme.text }}
            >
              Loading lots…
            </div>
          )}
          {!isLoading && hasError && (
            <div className="absolute right-3 top-3 max-w-[260px] rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[13px] text-red-800 shadow-md">
              {searchError ? "Couldn't load that selection. Try again." : "Some lots failed to load. Try toggling that selection again."}
            </div>
          )}
          {/* width/isResizing/onStartResize wire the panel into the
              same drag pattern as the sidebar and table. `feature` is
              gated on `detailPanelOpen` — not just `selectedFeature` —
              so a table row click (which updates selectedFeature but
              leaves detailPanelOpen untouched) can silently refresh the
              panel's content while it's open, without ever opening it
              from closed. `sheetPreview` is gated the same way, so a
              sheet Preview click behaves consistently with everything
              else. LotDetailPanel itself already renders nothing when
              both `feature` and `sheetPreview` are null (see its own
              file). */}
          <LotDetailPanel
            feature={detailPanelOpen ? selectedFeature : null}
            sheetPreview={detailPanelOpen ? sheetPreview : null}
            onSelectLot={selectLotFromSheetPreview}
            onBackToSheet={backToSheetPreview}
            onClose={closeDetail}
            width={detailPanelWidth}
            isResizing={isDetailPanelResizing}
            onStartResize={startDetailPanelResize}
          />
        </div>

        {/* The whole panel — bar + table — only renders once something is
            actually selected. Nothing to show, nothing takes up space. */}
        {hasSelections && (
          <div
            className="relative flex-shrink-0 overflow-hidden border-t"
            style={{
              height: tableExpanded ? tableHeight : TABLE_BAR_HEIGHT,
              transition: isTableResizing ? "none" : "height 0.16s ease",
              background: theme.bg,
              borderColor: theme.border,
            }}
          >
            {/* Drag handle — only meaningful (and only rendered) while
                expanded. Taller hit area (h-4, was h-2.5) and
                touchAction: "none" so a finger can actually land on and
                drag it without the page scrolling instead. */}
            {tableExpanded && (
              <div
                onMouseDown={startTableResize}
                onTouchStart={startTableResize}
                title="Drag to resize"
                className="group absolute -top-2 left-0 right-0 z-20 h-4 cursor-row-resize"
                style={{ touchAction: "none" }}
              >
                <div
                  className="mx-auto mt-2 h-[2px] w-full transition-colors"
                  style={{ background: isTableResizing ? theme.accent : "transparent" }}
                />
              </div>
            )}

            {/* Toggle bar — always here whenever hasSelections is true,
                whether the table below it is expanded or collapsed. */}
            <button
              type="button"
              onClick={toggleTableVisible}
              className="flex w-full flex-shrink-0 items-center gap-2 border-b px-3 text-left transition-colors"
              style={{
                height: TABLE_BAR_HEIGHT,
                background: theme.hoverBg,
                borderColor: theme.border,
              }}
              aria-expanded={tableExpanded}
            >
              <Table2 size={14} className="flex-shrink-0" style={{ color: theme.textMuted }} />
              <span className="text-[12.5px] font-semibold" style={{ color: theme.text }}>
                Attribute Table
              </span>
              <span
                className="flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                style={{ background: theme.border, color: theme.textMuted }}
              >
                {tableSummary.count}
              </span>
              <span className="ml-auto flex-shrink-0" style={{ color: theme.textFaint }}>
                {tableExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </span>
            </button>

            {tableExpanded && (
              <div style={{ height: tableHeight - TABLE_BAR_HEIGHT }} className="overflow-hidden">
                <AttributeTable
                  features={tableFeatures}
                  onRowClick={selectFeatureFromTable}
                  selectedId={selectedId}
                  totalCount={tableSummary.count}
                  totalArea={tableSummary.totalArea}
                  truncated={tableFilterKey ? truncatedKeys.has(tableFilterKey) : hasTruncated}
                  hasError={tableFilterKey ? errorKeys.has(tableFilterKey) : hasError}
                  filterLabel={tableFilterLabel}
                  onClearFilter={() => setTableFilterKey(null)}
                  lotColors={lotColors}
                  onSetLotColors={handleSetLotColors}
                  onViewSheet={viewSheetInPanel}
                  onUpdatePlanUrl={handleUpdatePlanUrl}
                  onUpdateSurveyNo={handleUpdateSurveyNo}
                  onUpdateDocumentsUrl={handleUpdateDocumentsUrl}
                  onUpdateSurveyClass={handleUpdateSurveyClass}
                />
              </div>
            )}
          </div>
        )}
      </section>
      <CreateShapefileModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
    </main>
  );
}
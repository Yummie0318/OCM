"use client";

// Target path: src/app/map/page.tsx
//
// TABLE ROW CLICK NOW ZOOMS THE MAP + REFRESHES AN OPEN DETAIL PANEL
// (this pass): clicking a row in AttributeTable highlights the row/
// polygon (via `selectedId`, as before) and now additionally (a) fires a
// `focusFeature` request at MapCanvas so the map fits/zooms to that lot's
// polygon bounds, and (b) updates `selectedFeature` so an already-open
// detail panel swaps to show this lot's preview/coordinates instead.
//
// Whether the panel is actually ON SCREEN is governed by a separate
// `detailPanelOpen` boolean, not by `selectedFeature` being non-null.
// `openFeature` (map click's "View Lot Details" popup button, or a
// search select) is the only thing that sets it true; the panel's own
// close button (`closeDetail`) is the only thing that sets it false. A
// table row click deliberately never touches `detailPanelOpen`: if the
// panel is already open it now shows a different lot, but a row click
// can never pop a closed panel open, and can never close one that's
// already showing. See the `feature={detailPanelOpen ? selectedFeature
// : null}` line on <LotDetailPanel /> below for where this is enforced.
//
// `focusFeature` is a small piece of state — the clicked feature plus a
// `token` (Date.now()) — passed straight through to MapCanvas, which
// does the actual fitBounds work (see its file-top comment).
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
import AttributeTable from "@/components/map/AttributeTable";
import LotDetailPanel from "@/components/map/LotDetailPanel";
import { SidebarThemeProvider, useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import type { LotFeature, SelectionMeta, LotSearchResult } from "@/lib/geo";
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

  // Whether LotDetailPanel is actually visible. Deliberately separate from
  // `selectedFeature` (which is just "what data would the panel show if it
  // were open"): the panel should only ever open via a deliberate action
  // (clicking a polygon's "View Lot Details" popup button, or a search
  // select) and only ever close via the user hitting its own close button
  // — a table row click should be able to swap what's INSIDE an already-
  // open panel without either opening a closed one or closing an open one.

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

  function handleToggle(key: string, meta: SelectionMeta | null) {
    setActiveSelections((prev) => {
      const next = { ...prev };
      if (meta === null) delete next[key];
      else next[key] = meta;
      return next;
    });
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
  // the panel — this is the one and only "open" action.
  function openFeature(feature: LotFeature) {
    setSelectedId(feature.id);
    setSelectedFeature(feature);
    setDetailPanelOpen(true);
    if (isMobile) setMobileOpen(false);
  }

  // Attribute table row click: highlights the row (and, since MapCanvas
  // highlights off the same selectedId, the polygon on the map),
  // fires a focusFeature request so the map zooms to that lot's polygon
  // bounds, and updates `selectedFeature` so the detail panel's content
  // reflects this lot. Deliberately does NOT touch `detailPanelOpen`: if
  // the panel is already open it swaps to show this lot, but a row click
  // never opens a closed panel and never closes an open one — only the
  // panel's own close button (see closeDetail) or a "View Lot Details"
  // click (see openFeature) change whether it's showing at all.
  function selectFeatureFromTable(feature: LotFeature) {
    setSelectedId(feature.id);
    setSelectedFeature(feature);
    setFocusFeature({ feature, token: Date.now() });
  }

  // The panel's own close button. This is the only place detailPanelOpen
  // is ever set back to false (aside from the "selection vanished
  // underneath us" effect below), so the panel only ever closes when the
  // user deliberately closes it.
  function closeDetail() {
    setDetailPanelOpen(false);
    setSelectedId(null);
    setSelectedFeature(null);
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

  async function handleSearchSelect(result: LotSearchResult) {
    setSearchError(false);
    try {
      const r = await fetch(`/api/map/lots?id=${result.id}`);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const fc: { features: LotFeature[] } = await r.json();
      const feature = fc.features[0];
      if (!feature) throw new Error("Lot not found");
      setLayerData((d) => ({ ...d, search: [feature] }));
      openFeature(feature);
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

    setLayerData((d) => {
      let changed = false;
      const next: typeof d = {};
      for (const k of Object.keys(d)) {
        if (activeSelections[k] || k === "search") next[k] = d[k];
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
              {searchError ? "Couldn't load that search result. Try again." : "Some lots failed to load. Try toggling that selection again."}
            </div>
          )}
          {/* width/isResizing/onStartResize wire the panel into the
              same drag pattern as the sidebar and table. `feature` is
              gated on `detailPanelOpen` — not just `selectedFeature` —
              so a table row click (which updates selectedFeature but
              leaves detailPanelOpen untouched) can silently refresh the
              panel's content while it's open, without ever opening it
              from closed. LotDetailPanel itself already renders nothing
              when `feature` is null (see its own file). */}
          <LotDetailPanel
            feature={detailPanelOpen ? selectedFeature : null}
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
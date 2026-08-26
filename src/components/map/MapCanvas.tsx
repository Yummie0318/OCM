"use client";

// Target path: src/components/map/MapCanvas.tsx
//
// SYNC MAP CLICKS TO THE TABLE (this pass): clicking a polygon now also
// reports the click via a new `onPolygonClick` prop, fired every time a
// polygon is clicked — independent of `onFeatureClick`. This is what lets
// the parent page set `selectedId` from a map click the same way it
// already does from an AttributeTable row click, so:
//   - the clicked lot's row auto-scrolls into view / highlights in
//     AttributeTable (see that file's handling of an externally-changed
//     `selectedId`), and
//   - the map's own highlight layers (which already read `selectedId` via
//     the `applyHighlight` effect below) actually light up the clicked
//     polygon, which — since nothing previously fed `selectedId` from a
//     map click — they didn't before.
// `onFeatureClick` is UNCHANGED: it still only fires from the "View Lot
// Details" button inside the popup, so LotDetailPanel continues to open
// only on that deliberate second action, never on the bare polygon click.
// Wired with the same ref-mirroring pattern as `onFeatureClickRef` so the
// listener registered once inside "load" always calls whatever
// `onPolygonClick` the page currently has.
//
// TABLE-ROW ZOOM (earlier pass): AttributeTable row clicks now also zoom
// the map to that lot's polygon. Wired via a new `focusFeature` prop — an
// object carrying the clicked LotFeature plus a `token` (a value that
// changes on every click, even re-clicks of the same lot) so the effect
// below always re-fires. This is deliberately separate from the existing
// `focusPoint` prop: focusPoint is a bare lng/lat used for search-select
// fly-tos before a full polygon has loaded, whereas focusFeature already
// has geometry in hand and fits the map to its actual bounds (same
// fitBounds shape used for the "fit to all features" path in
// setFeatures()), which reads better for "zoom to this one lot" than a
// flyTo-to-centroid would.
//
// POPUP NO LONGER AUTO-OPENS THE DETAIL PANEL (earlier pass): clicking a lot
// polygon used to do two things at once — show the themed popup card AND
// call `onFeatureClick`, which opens LotDetailPanel. That's now split:
// the click only opens the popup. Opening the detail panel is a
// deliberate second action — a "View Lot Details" button inside the
// popup, which calls `onFeatureClick` on its own click. The old "View
// Plan" pill link (which opened `planUrl` in a new tab) is still there
// when a lot has a plan, just demoted to a smaller secondary text link
// next to the new button instead of being the popup's one action.
//
// Wiring this up means the click handler can no longer call setHTML() and
// walk away — after `.addTo(map)`, it grabs the popup's live DOM node via
// `.getElement()` and attaches a click listener to the button inside it.
// That listener never needs manual cleanup: a fresh popup element is
// created on every click (the previous one is `.remove()`'d first), so
// the old listener is torn out along with the old DOM node it lived on.
//
// MapLibre GL — WebGL/GPU-rendered, so this stays smooth with far more
// polygons on screen at once than an SVG/Canvas library like Leaflet can
// comfortably handle. Loaded dynamically inside useEffect since it touches
// `window` on init and must never run during server-side rendering.
//
// This is the only map-library-aware file in the app: Sidebar, AttributeTable,
// LotDetailPanel, and the page all just pass around plain LotFeature[]
// arrays, so swapping rendering libraries again in the future would only
// mean touching this file.
//
// NOTE: pinned to maplibre-gl ^5.x (see package.json). v6 switched to a
// strict ESM-only worker distribution that didn't load reliably under the
// Next.js dev server in this project, silently breaking all vector layers
// (fill/line) while raster tiles kept working. Don't upgrade past v5
// without re-verifying that a GeoJSON fill layer actually renders.
//
// BASEMAP SWITCHING (earlier pass): the basemap is no longer a single
// fixed style. `BASEMAPS` now holds several raster tile sources (Light/
// Streets/Dark/Satellite) and the map accepts a `basemapId` prop.
// Switching basemaps deliberately does NOT call map.setStyle() — that
// tears down every layer we've added (lot fill/line/highlight layers, the
// "lots-source" GeoJSON source the click handler depends on) and would
// require re-adding all of them on the next "load" — instead we keep one
// raster source named "basemap" for the life of the map and just repoint
// its tile URLs with source.setTiles() when basemapId changes. This means
// the initial style's source list always has exactly one entry (the
// currently selected basemap), and swapping only ever touches that one
// source in place.
//
// POPUP THEME (earlier pass): the on-click popup no longer uses
// MapLibre's default unstyled white box. It renders the same themed,
// Apple-style card language as the rest of the app (rounded corners,
// hairline divider, label/value grid, pill-style action button) by
// injecting one small <style> block (once, guarded by an id check) that
// targets a custom `.lot-popup-container` class passed via the Popup
// constructor's `className` option. It reads the app's `--sb-*` CSS
// custom properties directly rather than hardcoding colors, so — since
// the popup's DOM node is appended inside the map container, itself a
// descendant of the `<main style={vars}>` root the whole app is themed
// from — it inherits the current light/dark palette automatically, the
// same as every other themed component. Also added a small escapeHtml()
// helper before interpolating any lot field into the popup HTML string,
// since owner/remarks/etc. are free-text database values that were
// previously inserted unescaped.
//
// COLOR SUPPORT: `lotColors` (id -> hex string, owned by the page) is baked
// into each feature's properties as `__color` before calling source.setData.
// Both the fill layer AND the line (border) layer paint use a `coalesce`
// expression to read `__color` and fall back to a default when a lot
// hasn't been colored. Selecting a lot in AttributeTable and picking a
// swatch updates `lotColors` in the page, which flows down here and
// re-runs setFeatures.
//
// FIX (border color): the line layer used to be hardcoded to a fixed blue
// regardless of `__color`, so picking a swatch only ever changed the fill
// — the outline stayed blue for every lot. It now reads `__color` via the
// same coalesce pattern as the fill layer, so a colored lot's border
// matches its fill (falling back to DEFAULT_LINE_COLOR when uncolored).
//
// SELECTION HIGHLIGHT: previously the highlight fill/line layers used a
// hardcoded amber (#f59e0b / #b45309) that painted OVER whatever color a
// lot had been assigned — so a colored lot would flash back to amber the
// moment it was selected/clicked, masking its real color entirely. Fixed
// so the highlight layers also read `__color` via `coalesce`: a colored
// lot stays its own color when selected (just with boosted opacity + a
// thicker outline to signal "selected"), and only uncolored lots fall
// back to amber.

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LotFeature } from "@/lib/geo";

interface FocusPoint {
  lng: number;
  lat: number;
  zoom?: number;
}

// A request to fit the map to a single lot's polygon bounds — used when a
// row is selected in AttributeTable. `token` should be a fresh value
// (e.g. Date.now()) on every request so the effect below re-fires even
// when the same lot is clicked twice in a row (same `feature` object /
// same id wouldn't otherwise register as a new dependency).
interface FocusFeatureRequest {
  feature: LotFeature;
  token: number;
}

// Identifiers for the basemap options the user can switch between. Kept
// as a union (not a plain string) so page.tsx gets autocomplete/type
// safety when reading/writing the persisted choice.
export type BasemapId = "light" | "streets" | "dark" | "satellite";

interface Props {
  features: LotFeature[];
  selectedId?: number | string | null;
  focusPoint?: FocusPoint | null;
  // Fit the map to a specific lot's polygon bounds — set this when a row
  // is selected from AttributeTable so the map zooms to match. Optional;
  // callers that don't need this (e.g. simpler embeds) can omit it.
  focusFeature?: FocusFeatureRequest | null;
  // Fired EVERY time a lot polygon is clicked on the map, regardless of
  // whether the popup's "View Lot Details" button is ever pressed. Intended
  // for the parent to mirror into whatever `selectedId` state it already
  // uses for AttributeTable row clicks, so a map click highlights/scrolls
  // to the matching row the same way a table click already highlights the
  // matching polygon. Does NOT open LotDetailPanel — that stays gated
  // behind `onFeatureClick` below.
  onPolygonClick?: (feature: LotFeature) => void;
  // Fired only when the "View Lot Details" button inside the popup is
  // clicked — this is the sole trigger for opening LotDetailPanel.
  onFeatureClick?: (feature: LotFeature) => void;
  // Map of lot id (stringified) -> hex color. Owned by the page (lifted up
  // from AttributeTable's color-selection toolbar). Optional so MapCanvas
  // keeps working in any context that doesn't care about coloring.
  lotColors?: Record<string, string>;
  // Which basemap tile set to render. Optional, defaults to "light" (the
  // old fixed Positron look), so existing callers don't need to change.
  basemapId?: BasemapId;
}

// Rough center of the Philippines — used only before any data is loaded.
const DEFAULT_CENTER: [number, number] = [121.774, 12.8797];
const DEFAULT_ZOOM = 5.5;

const SOURCE_ID = "lots-source";
const FILL_LAYER_ID = "lots-fill";
const LINE_LAYER_ID = "lots-line";
const HIGHLIGHT_LINE_LAYER_ID = "lots-highlight-line";
const HIGHLIGHT_FILL_LAYER_ID = "lots-highlight-fill";

const DEFAULT_FILL_COLOR = "#2563eb";
// Default border color — only used for lots that have NO assigned color.
// Colored lots get a border that matches their own fill color (see the
// line layer paint definition below).
const DEFAULT_LINE_COLOR = "#1d4ed8";
// Fallback highlight colors — only used for lots that have NO assigned
// color. Colored lots keep their own color when highlighted (see the
// layer paint definitions below).
const DEFAULT_HIGHLIGHT_FILL_COLOR = "#f59e0b";
const DEFAULT_HIGHLIGHT_LINE_COLOR = "#b45309";

const BASEMAP_SOURCE_ID = "basemap";

// Shared maxzoom across every basemap option. Esri's World Imagery
// (satellite) has reliable global coverage only up to about this level in
// most areas, and capping the CARTO layers to match — instead of their
// native z20 — means switching basemaps only ever needs to change tile
// URLs via setTiles(); the source's maxzoom itself is fixed for the life
// of the map (MapLibre doesn't support changing a raster source's maxzoom
// in place).
const BASEMAP_MAXZOOM = 19;

interface BasemapConfig {
  label: string;
  tiles: string[];
  attribution: string;
}

// Free, no-API-key raster tile sources.
//   - light / streets / dark: CARTO basemaps, `{ratio}` resolves to "@2x"
//     on high-DPI screens and "" otherwise so retina displays get sharp
//     tiles without a separate style.
//   - satellite: Esri World Imagery, no `{ratio}` token support, so we
//     just request the standard 256px tiles.
export const BASEMAPS: Record<BasemapId, BasemapConfig> = {
  light: {
    label: "Light",
    tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{ratio}.png"],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  streets: {
    label: "Streets",
    tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{ratio}.png"],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  dark: {
    label: "Dark",
    tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{ratio}.png"],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  satellite: {
    label: "Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery &copy; Esri",
  },
};

function buildMapStyle(basemapId: BasemapId) {
  const basemap = BASEMAPS[basemapId];
  return {
    version: 8 as const,
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: "raster" as const,
        tiles: basemap.tiles,
        tileSize: 256,
        maxzoom: BASEMAP_MAXZOOM,
        attribution: basemap.attribution,
      },
    },
    layers: [
      {
        id: "basemap-tiles",
        type: "raster" as const,
        source: BASEMAP_SOURCE_ID,
      },
    ],
  };
}

function escapeHtml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Injects the popup's themed styling once per page load. Guarded by an id
// check so remounts (e.g. React strict-mode double-invoke, or navigating
// away and back) don't stack duplicate <style> tags. Uses the app's
// --sb-* custom properties with plain-color fallbacks so the popup still
// looks reasonable even if it somehow renders outside the themed tree.
function ensurePopupStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("lot-popup-styles")) return;

  const style = document.createElement("style");
  style.id = "lot-popup-styles";
  style.textContent = `
    .lot-popup-container .maplibregl-popup-content {
      padding: 0;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: var(--sb-shadow, 0 10px 30px rgba(15, 23, 42, 0.15));
      background: var(--sb-bg-elevated, #ffffff);
      font-family: inherit;
    }
    .lot-popup-container .maplibregl-popup-tip {
      border-top-color: var(--sb-bg-elevated, #ffffff) !important;
      border-bottom-color: var(--sb-bg-elevated, #ffffff) !important;
    }
    .lot-popup-container .maplibregl-popup-close-button {
      color: var(--sb-text-muted, #6e6e73);
      font-size: 16px;
      line-height: 1;
      padding: 5px 8px;
      right: 3px;
      top: 3px;
    }
    .lot-popup-container .maplibregl-popup-close-button:hover {
      background: var(--sb-hover, #f5f5f7);
      color: var(--sb-text, #1d1d1f);
      border-radius: 999px;
    }
    .lot-popup {
      width: 240px;
      font-size: 12.5px;
    }
    .lot-popup-header {
      padding: 10px 30px 8px 14px;
      border-bottom: 1px solid color-mix(in srgb, var(--sb-border, #d8d8dd) 70%, transparent);
    }
    .lot-popup-title {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--sb-text, #1d1d1f);
    }
    .lot-popup-body {
      padding: 10px 14px 12px;
    }
    .lot-popup-owner {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--sb-text, #1d1d1f);
      margin-bottom: 2px;
    }
    .lot-popup-loc {
      font-size: 11px;
      color: var(--sb-text-faint, #8e8e93);
      margin-bottom: 9px;
    }
    .lot-popup-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 10px;
      row-gap: 4px;
      margin: 0;
    }
    .lot-popup-grid dt {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--sb-text-faint, #8e8e93);
      font-weight: 600;
    }
    .lot-popup-grid dd {
      margin: 0;
      font-size: 11.5px;
      color: var(--sb-text-muted, #6e6e73);
      text-align: right;
    }
    .lot-popup-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
    }
    .lot-popup-view-details {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      padding: 5px 10px;
      border: none;
      border-radius: 999px;
      background: var(--sb-accent-bg, #eef1ff);
      color: var(--sb-accent, #4f46e5);
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.3;
      cursor: pointer;
      transition: opacity 0.1s ease;
    }
    .lot-popup-view-details:hover {
      opacity: 0.75;
    }
    .lot-popup-plan-link {
      font-size: 11px;
      font-weight: 600;
      color: var(--sb-text-muted, #6e6e73);
      text-decoration: none;
    }
    .lot-popup-plan-link:hover {
      color: var(--sb-text, #1d1d1f);
    }
  `;
  document.head.appendChild(style);
}

function buildPopupHtml(p: Record<string, unknown>): string {
  const lotNo = escapeHtml(p.lotNo ?? "—");
  const owner = escapeHtml(p.owner) || "Unrecorded owner";
  const location = escapeHtml([p.barangay, p.municipality, p.province].filter(Boolean).join(", ")) || "—";
  const surveyNo = escapeHtml(p.surveyNo ?? "—");
  const patentNo = escapeHtml(p.patentNo ?? "—");
  const dateSurveyed = escapeHtml(p.dateSurveyed ?? "—");
  const surveyor = escapeHtml(p.surveyor ?? "—");
  const areaSqm = p.areaSqm != null ? `${escapeHtml(p.areaSqm)} sq.m.` : "—";
  const planUrl = typeof p.planUrl === "string" ? p.planUrl : null;

  return `
    <div class="lot-popup">
      <div class="lot-popup-header">
        <span class="lot-popup-title">Lot ${lotNo}</span>
      </div>
      <div class="lot-popup-body">
        <div class="lot-popup-owner">${owner}</div>
        <div class="lot-popup-loc">${location}</div>
        <dl class="lot-popup-grid">
          <dt>Survey No.</dt><dd>${surveyNo}</dd>
          <dt>Patent No.</dt><dd>${patentNo}</dd>
          <dt>Surveyed</dt><dd>${dateSurveyed}</dd>
          <dt>Surveyor</dt><dd>${surveyor}</dd>
          <dt>Area</dt><dd>${areaSqm}</dd>
        </dl>
        <div class="lot-popup-actions">
          <button type="button" class="lot-popup-view-details">View Lot Details →</button>
        </div>
      </div>
    </div>
  `;
}

export default function MapCanvas({
  features,
  selectedId,
  focusPoint,
  focusFeature,
  onPolygonClick,
  onFeatureClick,
  lotColors,
  basemapId = "light",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const loadedRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const popupRef = useRef<any>(null);

  // Keep the latest features/lotColors/basemapId in refs so the one-time
  // init effect's `map.on("load", ...)` callback (which only runs once, at
  // construction) always sees current data instead of whatever was passed
  // in on first render.
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const lotColorsRef = useRef(lotColors);
  lotColorsRef.current = lotColors;
  const focusPointRef = useRef(focusPoint);
  focusPointRef.current = focusPoint;
  const basemapIdRef = useRef(basemapId);
  basemapIdRef.current = basemapId;
  // Same ref-mirroring trick as above, so the click handler registered
  // once inside "load" always calls whatever onFeatureClick the page
  // currently has (a fresh function identity most renders), instead of
  // whichever one was in scope back when the listener was attached.
  const onFeatureClickRef = useRef(onFeatureClick);
  onFeatureClickRef.current = onFeatureClick;
  // Same pattern for onPolygonClick — fired on every polygon click, not
  // just the "View Lot Details" button.
  const onPolygonClickRef = useRef(onPolygonClick);
  onPolygonClickRef.current = onPolygonClick;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    ensurePopupStyles();

    (async () => {
      // Cast to any to sidestep a TS type-declaration quirk in maplibre-gl
      // where dynamic import() doesn't type a 'default' export even though
      // it exists at runtime (bundler-applied CJS/ESM interop).
      const mod: any = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        // Built from whichever basemap was selected at the moment the map
        // is first constructed. Later changes go through the setTiles()
        // effect below, not a rebuild.
        style: buildMapStyle(basemapIdRef.current),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");

      // Surface any silent style/layer errors MapLibre reports internally
      // (invalid paint property, missing source, tile/network failures) so
      // rendering problems don't fail quietly.
      map.on("error", (e: any) => {
        console.error("[MapCanvas] MapLibre error:", e?.error ?? e);
      });

      // The container can have zero/incorrect size at construction time —
      // especially inside a modal whose layout settles a frame or two after
      // mount — so force one resize once mounted, then keep the canvas in
      // sync with the container going forward.
      requestAnimationFrame(() => map.resize());
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(containerRef.current);

      map.on("load", () => {
        if (cancelled) return;

        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        map.addLayer({
          id: FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            // Per-lot color, baked into properties.__color by setFeatures().
            // Falls back to the default blue when a lot has no color set.
            "fill-color": ["coalesce", ["get", "__color"], DEFAULT_FILL_COLOR],
            "fill-opacity": 0.35,
          },
        });

        map.addLayer({
          id: LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            // Border now follows the same per-lot color as the fill (via
            // the same __color property) — falls back to the default blue
            // outline when a lot has no color assigned. This is what was
            // missing before: this layer used to be hardcoded to a fixed
            // blue and never looked at __color at all.
            "line-color": ["coalesce", ["get", "__color"], DEFAULT_LINE_COLOR],
            "line-width": 2,
          },
        });

        // Highlight layers for the currently selected lot (clicked on the
        // map, or opened via search, or selected via an AttributeTable row)
        // — filtered down to a single feature id, drawn on top of the base
        // fill/line layers.
        //
        // IMPORTANT: these read __color too, via the same coalesce
        // pattern as the base fill layer. That means a colored lot stays
        // its assigned color when selected — we just boost opacity/width
        // so "selected" still reads clearly. Only a lot with NO color
        // falls back to the amber highlight, so it's still visible
        // against the default blue.
        map.addLayer({
          id: HIGHLIGHT_FILL_LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          filter: ["==", ["id"], -1],
          paint: {
            "fill-color": ["coalesce", ["get", "__color"], DEFAULT_HIGHLIGHT_FILL_COLOR],
            "fill-opacity": 0.55,
          },
        });

        map.addLayer({
          id: HIGHLIGHT_LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          filter: ["==", ["id"], -1],
          paint: {
            "line-color": ["coalesce", ["get", "__color"], DEFAULT_HIGHLIGHT_LINE_COLOR],
            "line-width": 4,
            "line-opacity": 1,
          },
        });

        map.on("click", FILL_LAYER_ID, (e: any) => {
          const feature = e.features?.[0];
          if (!feature) return;

          const p = feature.properties ?? {};
          if (popupRef.current) popupRef.current.remove();

          // Strip the internal __color field we injected so it doesn't
          // leak into app-level LotFeature consumers. Built up front (not
          // just when the button is clicked) since it needs to be the
          // value captured in the button's click listener's closure, and
          // is also what we hand to onPolygonClick below.
          const { __color, ...cleanProps } = p;
          const cleanFeature = {
            type: "Feature",
            id: feature.id,
            geometry: feature.geometry,
            properties: cleanProps,
          } as LotFeature;

          // Fires on every polygon click, regardless of what happens with
          // the popup below. This is what lets the parent page mirror the
          // click into whatever `selectedId` state already drives
          // AttributeTable row highlighting — it does NOT open
          // LotDetailPanel; that stays gated behind the button handler
          // further down.
          onPolygonClickRef.current?.(cleanFeature);

          popupRef.current = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: "280px",
            className: "lot-popup-container",
          })
            .setLngLat(e.lngLat)
            .setHTML(buildPopupHtml(p))
            .addTo(map);

          // Clicking the polygon only opens this popup (and reports
          // onPolygonClick above) — it does NOT call onFeatureClick on its
          // own. Opening the Lot Detail Panel is still a deliberate second
          // action: the "View Lot Details" button inside the popup we just
          // rendered. Grab the popup's live DOM node and wire that button
          // up. No manual teardown needed: this whole element gets
          // replaced/removed on the next click (see popupRef.current.remove()
          // above) or on closeOnClick, taking the listener with it.
          const popupEl = popupRef.current.getElement?.();
          const viewDetailsBtn = popupEl?.querySelector(".lot-popup-view-details");
          if (viewDetailsBtn) {
            viewDetailsBtn.addEventListener("click", () => {
              onFeatureClickRef.current?.(cleanFeature);
            });
          }
        });

        map.on("mouseenter", FILL_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", FILL_LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
        });

        loadedRef.current = true;
        // Apply whatever features/colors arrived before the style finished
        // loading. Read from refs (not the closed-over props) since this
        // callback only fires once, on initial style load.
        setFeatures(featuresRef.current, lotColorsRef.current, focusPointRef.current);
        applyHighlight(selectedId ?? null);
      });

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      loadedRef.current = false;
    };
    // Intentionally run once — feature updates are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setFeatures(
    feats: LotFeature[],
    colors: Record<string, string> | undefined,
    activeFocusPoint: FocusPoint | null | undefined
  ) {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const source = map.getSource(SOURCE_ID);
    if (!source) return;

    // Bake each lot's color (if any) into its properties as __color, which
    // both the base fill/line layers AND the highlight layers read via
    // ["get", "__color"].
    const withColor = feats.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        __color: colors?.[String(f.id)] ?? null,
      },
    }));

    source.setData({ type: "FeatureCollection", features: withColor });

    if (feats.length === 0) return;

    // Compute bounds across all features and fit the view to them. Skipped
    // when a focusPoint is explicitly set (e.g. a search selection) so we
    // don't fight that fly-to with a bounds fit on the same render.
    if (activeFocusPoint) return;

    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;

    for (const f of feats) {
      for (const ring of f.geometry.coordinates) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }

    if (minLng <= maxLng && minLat <= maxLat) {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 40, maxZoom: 18 }
      );
    }
  }

  function applyHighlight(id: number | string | null) {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const filterId = id ?? -1;
    map.setFilter(HIGHLIGHT_FILL_LAYER_ID, ["==", ["id"], filterId]);
    map.setFilter(HIGHLIGHT_LINE_LAYER_ID, ["==", ["id"], filterId]);
  }

  // Redraw whenever the active feature set changes.
  useEffect(() => {
    setFeatures(features, lotColors, focusPoint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features]);

  // Redraw whenever colors change, independent of feature-set changes —
  // this is what makes picking a swatch in AttributeTable actually repaint
  // the polygons (fill, line, AND highlight layers, since all of them read
  // __color) without waiting for a feature reload.
  useEffect(() => {
    setFeatures(features, lotColors, focusPoint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotColors]);

  // Highlight whichever lot is currently selected (e.g. via search, a map
  // click, or a table row click).
  useEffect(() => {
    applyHighlight(selectedId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Fly to a specific point — used right after a search selection, before
  // (or even without waiting for) the full polygon to arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !focusPoint) return;
    map.flyTo({
      center: [focusPoint.lng, focusPoint.lat],
      zoom: focusPoint.zoom ?? 17,
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPoint]);

  // Fit the map to a single lot's polygon bounds — used when a row is
  // selected in AttributeTable, so clicking a lot in the table zooms the
  // map to it the same way clicking it directly on the map (or via
  // search) already centers things. Depends on the whole `focusFeature`
  // object (not just, say, its id) so a fresh `token` on every click
  // re-triggers the fit even when the same lot is clicked twice in a row.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !focusFeature) return;

    const { feature } = focusFeature;
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;

    for (const ring of feature.geometry.coordinates) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }

    if (minLng <= maxLng && minLat <= maxLat) {
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 80, maxZoom: 19, duration: 500 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFeature]);

  // Swap the "basemap" raster source's tile URLs whenever the user picks a
  // different basemap. Deliberately NOT map.setStyle() — see the file-top
  // comment for why. getSource() returns undefined for a brief moment on
  // first mount before "load" fires, which loadedRef guards against; after
  // that, the "basemap" source always exists for the life of the map since
  // it's part of every buildMapStyle() output.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(BASEMAP_SOURCE_ID);
    if (source && typeof source.setTiles === "function") {
      source.setTiles(BASEMAPS[basemapId].tiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
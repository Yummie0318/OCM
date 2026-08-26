"use client";

// Target path: src/components/map/AttributeTable.tsx
//
// BREADCRUMB PLAN LINK (earlier pass): the drilled-into-a-sheet breadcrumb
// ("Sheets / {sheetNo} — {municipality}, {province} · Encoded by
// {username}") previously had no way to see or attach that sheet's plan
// link — the only place to do that was the sheets-list Plan column, which
// meant going back to "Sheets" first. The breadcrumb now has its own Plan
// segment, reusing the exact same <PlanLink> / <AddPlanLinkControl>
// components the sheets list already uses: if the drilled-in sheet has a
// planUrl, it renders the "View" link; if it doesn't (and sheetId +
// onUpdatePlanUrl are both available), it renders the same inline
// "Add link" control. Saving through either place updates the same
// planUrl on the same sheetId, so both views always agree — there's only
// ever one plan link per sheet, just two places to see/edit it now.
//
// SHEET SURVEY NO (this pass): survey number is per-lot text (not a
// link), but lots on the same sheet often share one. Like plan links, the
// sheets list and drilled-in breadcrumb can now attach a survey number
// for every lot on that sheet that still has none. Saving calls
// onUpdateSurveyNo(sheetId, surveyNo) → PATCH /api/lot-sheets/[id] with
// { surveyNo }, which only UPDATEs lots where survey_no IS NULL or
// blank — existing values are never overwritten. SheetGroup derives a
// display surveyNo (first non-empty among its lots) and hasMissingSurveyNo
// so the UI can show the current value and/or an "Add survey no." control.
//
// GOOGLE DRIVE VALIDATION (earlier pass): the "Add link" plan-link control
// (see ADD PLAN LINK note below) now rejects anything that isn't a
// traceable Google Drive/Docs URL — validated client-side here via
// isTraceableGoogleDriveLink (src/lib/planLink.ts) before it's even sent
// to the parent's onUpdatePlanUrl, so the user gets instant feedback
// instead of a round-trip error. The same rule is enforced again
// server-side in the PATCH route (see its own file), since a client
// check alone can always be bypassed by hitting the API directly — this
// client check is purely a UX nicety.
//
// ADD PLAN LINK (earlier pass): the sheets-list Plan column now lets the
// user attach a plan link to a sheet that doesn't have one yet, instead
// of just showing "—". Each SheetGroup now carries `sheetId` (the numeric
// lot_sheets FK, not the display sheetNo) so the new `onUpdatePlanUrl`
// prop can tell the parent exactly which sheet to update. When a sheet
// has no planUrl and the parent has passed onUpdatePlanUrl, the Plan cell
// renders <AddPlanLinkControl>: a small "Add link" button that expands
// into an inline URL input + Save/Cancel. Saving calls
// onUpdatePlanUrl(sheetId, url), which the parent uses to PATCH
// /api/lot-sheets/[id] and patch the loaded features' planUrl locally so
// this table reflects it immediately (no refetch). Errors from the save
// are shown inline next to the input rather than swallowed. The whole
// cell still calls stopPropagation so typing/clicking in it never
// triggers the row's own "drill into sheet" onClick.
//
// SHEET PREVIEW BUTTON (earlier pass): each row in the sheets list now has a
// dedicated "Preview" column with an eye-icon button. Clicking it calls
// the new `onViewSheet` prop with that sheet's full lot list (id, no,
// province/municipality, all lots) — this is what lets the parent show a
// whole-sheet preview (every lot's polygon + a lot list) in
// LotDetailPanel, separate from drilling into the sheet's lots table
// here. The button calls stopPropagation so clicking it doesn't also
// trigger the row's own onClick (which still just drills in, unchanged).
// The column itself is only rendered when a caller actually passes
// onViewSheet, so existing usages that don't care about this still look
// exactly as before.
//
// SYNC WITH MAP CLICKS (earlier pass): the parent now also updates the
// `selectedId` prop when a polygon is clicked directly on the map (see
// MapCanvas's new `onPolygonClick`), not just when a table row is
// clicked. Two additions make that useful here instead of silently
// no-oping when the matching row isn't currently visible:
//   1. If `selectedId` changes to a lot that belongs to a sheet other than
//      whichever one is currently drilled into (or no sheet is drilled
//      into at all), the table auto-expands that lot's sheet — same as
//      clicking that sheet's row in the sheets list would. Skipped while
//      a search is active, since search results already show a flat
//      cross-sheet list with no drill-down step needed.
//   2. Once the matching row is part of whatever's currently rendered
//      (a drilled sheet's LotsTable, or search results), it's scrolled
//      into view. This lives inside LotsTable itself (see its own
//      comment) since that's the component that actually owns the row
//      DOM nodes.
// This does NOT open LotDetailPanel — that still only happens via the
// "View Lot Details" button in the map popup (see MapCanvas /
// LotDetailPanel), completely unchanged by this pass.
//
// ENCODED BY (earlier pass): moved from a per-lot column to a per-SHEET
// display. "Encoded By" (properties.encodedBy, sourced from
// lot_sheets.created_by -> users.username in /api/map/lots) is a fact
// about the SHEET, not the lot — every lot on the same sheet has the same
// value, since lots don't carry their own created_by column. Previously it
// was rendered as a column on every lot row (repeating identically down
// the table), which read like a per-lot attribute. It now shows up:
//   - once per sheet, as a column in SheetsTable (the sheets-list
//     view), and
//   - in the breadcrumb once you've drilled into a sheet ("Sheet {no} —
//     {municipality}, {province} · Encoded by {username}").
// It's no longer a column in LotsTable / LOT_COLUMNS. Search-by-encoder
// still works exactly as before (matchesLotQuery still reads
// p.encodedBy off each lot feature) — that's just how the underlying data
// arrives per-feature; only the *display* location moved.
//
// SHEETS-ROW AFFORDANCE (earlier pass): the per-row "view lots" chevron
// icon + themed Tooltip column has been removed. The whole row is still
// the click target (onClick on the <tr>), and a plain native
// `title="Click to view lots"` on the <tr> gives the hover tooltip
// instead — one fewer column, simpler markup, same "click to drill in"
// affordance.
//
// COMPACT HEADER (earlier pass): the breadcrumb row and the color-selection
// toolbar used to be two separate conditionally-rendered bars stacked on
// top of each other — and the color toolbar only mounted once something
// was checked, so checking the first row inserted a whole new row and
// shoved everything below it down. Both are now ONE row: breadcrumb (or
// "Search results" label) on the left, color toolbar on the right. That
// row renders whenever a lots table is visible (drilled into a sheet, or
// search results) — the toolbar itself is always mounted, just faded/
// disabled with a "Select lots to color" hint until something's checked,
// so activating it never changes the layout. On the plain sheets list
// (no drill-down, no search, no checkboxes) this row doesn't render at
// all. Net effect: max 2 stacked bars above the table instead of 3, and
// nothing jumps when you select a row. Swatches/padding also tightened
// slightly (17px -> 16px swatches, py-1.5 -> py-1) per the same pass.
//
// TOOLTIPS (earlier pass): every native `title=""` attribute in this file
// has been replaced with the same themed hover/focus tooltip used
// elsewhere in the app (dark pill, small arrow, positioned via
// bottom-full/top-full so it never gets clipped by the table's own
// scroll container). See the `Tooltip` component below — it's a plain
// wrapper around its children, so swapping it in never changed any
// click/select logic, only what shows up on hover. Native `title`
// tooltips are slow to appear, can't be styled, and don't reliably show
// on touch devices anyway, so nothing is lost on mobile by dropping them.
// The one exception is the per-row "Click to view lots" cue on the
// sheets table: instead of a tooltip on the entire <tr> (awkward to
// anchor and pointless on touch, where there's no hover), that's now a
// small chevron icon at the end of the row with its own tooltip — same
// affordance, clearer target.
//
// MOBILE SCROLLING (earlier pass): the scroll container now sets
// `WebkitOverflowScrolling: "touch"` (momentum scrolling on older iOS
// Safari) and `overscrollBehavior: "contain"` (so scrolling to the end of
// the table doesn't bubble into scrolling the page behind it — a common
// cause of "the table feels stuck" on iPhone). NOTE: the *height* of this
// panel — the actual "I can't see the data below it" bug — is controlled
// by the parent (src/app/map/page.tsx), which drags/persists a pixel
// height via mouse events only. That's fixed separately in page.tsx
// (touch-drag support for the resize handle); nothing in this file can
// fix that on its own since this component doesn't own its own height.
//
// The table now opens on a SHEETS view: one row per lot_sheet, grouped
// client-side from whatever `features` the parent has already loaded (no
// extra request — every LotFeature already carries sheetId/sheetNo/planUrl,
// see /api/map/lots). Clicking a sheet row drills into that sheet's
// individual lots (the original flat table, minus the now-redundant
// "Sheet No." column), with a breadcrumb bar to go back and a link out to
// the plan (plan_url) if one exists.
//
// Grouping key is sheetId (numeric FK), not sheetNo (display string) — two
// sheets could in principle share a sheet_no, sheetId can't collide.
//
// Province/Municipality/Encoded By on the sheets view all come from the
// first lot in each group (every lot in a sheet shares the same tie point
// and encoder, so they're identical across the group) — see /api/map/lots,
// which derives them from the sheet's control point / lot_sheets row.
//
// UX notes (earlier pass):
// - There is now a SINGLE totals readout — the top SummaryBar — instead of
//   a top bar + a duplicate footer row inside the table. The per-table
//   footer row was removed because it always said the same thing the top
//   bar already said.
// - The SummaryBar is context-aware: on the sheets list it shows the
//   overall total (all sheets/lots currently loaded); once you drill into
//   a sheet, it switches to that sheet's own lot count/area instead, so
//   the number on screen always matches what you're actually looking at.
// - The breadcrumb no longer repeats the lot count/area (that's the top
//   bar's job now) — it's "Sheet {no} — {municipality}, {province}",
//   plus the encoder (see ENCODED BY above) and now the Plan link/control
//   (see BREADCRUMB PLAN LINK above).
// - Search bar: searches the flat `features` list directly (lot no, owner,
//   barangay, municipality, survey no, surveyor, patent no, remarks,
//   encoded-by username, and sheet no), so it finds lots across every
//   sheet at once — not just whatever sheet you happen to be drilled into.
//   It lives inline in the SummaryBar's row (via `rightSlot`) rather than
//   its own full-width row, so it stays compact. While a query is active,
//   the sheets/lots drill-down is bypassed in favor of a flat results
//   table with a "Sheet No." column added back in (since results can span
//   multiple sheets), and the top summary numbers switch to
//   match-count/area. Clearing the query returns you to exactly the view
//   you were on before.
//
// - Color selection: in either lots view (a drilled-in sheet, or cross-
//   sheet search results), each row has a checkbox and there's a "select
//   all visible" checkbox in the header — scoped to whatever's currently
//   shown, so searching "titled" then selecting all only grabs those
//   matches. The color toolbar (see COMPACT HEADER above) sits in the
//   combined header row and applies a color to every selected lot in a
//   single action via `onSetLotColors`. Actually painting the polygons on
//   the map is the parent's job — this component just reports which lot
//   ids got which color. `lotColors` (also owned by the parent) is read
//   back here to show a small dot per row so it's obvious which lots are
//   already colored.
//
// - ROW COLOR MATCHING: a colored lot's row gets a translucent background
//   tint of its own assigned color (via hexToRgba), not just a small dot —
//   so the table visually mirrors the polygon fill on the map at a
//   glance. A colored-and-selected row (clicked on the map/table) gets a
//   stronger tint plus the usual accent left-edge selection marker, so
//   "this is the lot I clicked" and "this is what color it is" both stay
//   visible at once instead of one state hiding the other.
//
// - THEME: the table reads the same `--sb-*` tokens the sidebar uses via
//   useSidebarTheme()/vars, so flipping dark mode from the sidebar's
//   account menu re-skins the table in the same motion. Requires an
//   ancestor <SidebarThemeProvider> (see SidebarThemeContext.tsx).
//   Lot-color tints (hexToRgba) are unaffected by theme on purpose: those
//   colors are user-assigned data, not chrome.
//
// - DENSITY / VISUAL PASS: retuned for an "Apple-style" data table — a
//   calm, dense grid closer to macOS Finder/Numbers than a generic HTML
//   table (tabular-nums, hairline rules via color-mix, tightened row
//   height, pill-radius controls, custom checkbox skin).

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LotFeature } from "@/lib/geo";
import { isTraceableGoogleDriveLink, PLAN_LINK_HELP_MESSAGE } from "@/lib/planLink";
import SummaryBar from "@/components/map/SummaryBar";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import { Table2, X, ChevronLeft, ExternalLink, Search, Palette, Check, Eye, Link2 } from "lucide-react";

// Presets are a starting point, not a hard limit — the custom swatch (a
// native color input) covers anything outside this set.
const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "Titled", value: "#22c55e" },
  { label: "Untitled", value: "#ef4444" },
  { label: "Pending", value: "#f59e0b" },
  { label: "Reference", value: "#3b82f6" },
  { label: "Flagged", value: "#a855f7" },
];

// Hairline helper — draws borders at reduced opacity against the theme's
// border token so dividers read as fine lines rather than heavy rules,
// the way native macOS lists separate rows.
const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";
const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

// Converts a "#rgb" or "#rrggbb" hex string into an rgba() string at the
// given alpha, so a row's background can be tinted with the lot's own
// assigned color instead of a generic indigo highlight. Falls back to a
// neutral gray if parsing fails (e.g. an unexpected/malformed hex from the
// custom color input) rather than throwing.
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return `rgba(148, 163, 184, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Themed hover/focus tooltip — replaces every native title="" in this
// file. Purely a wrapper: it renders `children` unchanged and adds an
// absolutely-positioned pill above (or below) them on hover/focus. Each
// instance manages its own show/hide state locally rather than lifting it
// up, since a table can have dozens of these on screen and there's no
// reason for them to share state.
function Tooltip({
  label,
  children,
  position = "top",
}: {
  label: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium shadow-md ${
            position === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
          style={{ background: "var(--sb-text)", color: "var(--sb-bg-elevated)" }}
        >
          {label}
          <span
            className={`absolute left-1/2 -translate-x-1/2 ${position === "top" ? "top-full" : "bottom-full"}`}
            style={{
              width: 0,
              height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              ...(position === "top"
                ? { borderTop: "4px solid var(--sb-text)" }
                : { borderBottom: "4px solid var(--sb-text)" }),
            }}
          />
        </span>
      )}
    </span>
  );
}

// A whole sheet's worth of lots, handed up via onViewSheet when the
// per-row preview button is clicked. Deliberately a plain object (not the
// internal SheetGroup type) so callers outside this file don't need to
// know about SheetGroup's other bookkeeping fields (key, totalArea, etc).
export interface SheetPreviewRequest {
  sheetNo: string;
  province: string | null;
  municipality: string | null;
  lots: LotFeature[];
}

interface Props {
  features: LotFeature[];
  onRowClick?: (feature: LotFeature) => void;
  selectedId?: number | string | null;
  totalCount?: number;
  totalArea?: number;
  truncated?: boolean;
  hasError?: boolean;
  filterLabel?: string | null;
  onClearFilter?: () => void;
  // Map of lot id (stringified) -> hex color, owned by the parent. Read
  // here to tint each row's background and show a small dot per row; the
  // parent is responsible for actually styling the polygon layer on the
  // map with it.
  lotColors?: Record<string, string>;
  // Called with every currently-checked lot id plus the chosen color (or
  // null to clear) when the user picks a swatch in the selection toolbar.
  onSetLotColors?: (lotIds: Array<string | number>, color: string | null) => void;
  // Called when the "Preview" eye button on a sheet row (sheets-list
  // view only) is clicked, with that sheet's full lot list. Intended for
  // the parent to show a whole-sheet preview (every lot's polygon + a lot
  // list) in LotDetailPanel — separate from the row's own click, which
  // still just drills into that sheet's lots table here. The Preview
  // column only renders when this is provided.
  onViewSheet?: (sheet: SheetPreviewRequest) => void;
  // Called when the user saves a plan link via the inline "Add link"
  // control — either the sheets list (Plan column) or the drilled-in
  // sheet's breadcrumb (see BREADCRUMB PLAN LINK above) — for a sheet
  // that had no planUrl yet. `sheetId` is the numeric lot_sheets FK. The
  // URL has already passed isTraceableGoogleDriveLink here before this
  // is ever called (see AddPlanLinkControl) — the parent is responsible
  // for persisting it (e.g. PATCH /api/lot-sheets/[id], which
  // re-validates server-side) and for updating planUrl on the loaded
  // features so this table reflects it immediately. A rejected promise
  // shows its message inline next to the input. The control only renders
  // when this is provided AND the group's sheetId is known.
  onUpdatePlanUrl?: (sheetId: number, planUrl: string) => Promise<void>;
  // Called when the user saves a survey number via the inline "Add survey
  // no." control — sheets list (Survey No. column) or drilled-in
  // breadcrumb — for lots on that sheet that still have no survey_no.
  // `sheetId` is the numeric lot_sheets FK. The parent PATCHes
  // /api/lot-sheets/[id] with { surveyNo }; the API only fills lots where
  // survey_no is null/blank and leaves existing values alone. Parent
  // should also patch loaded features' surveyNo for lots that were empty
  // so this table updates without a refetch. Control only renders when
  // this is provided, sheetId is known, and the group has at least one
  // lot missing a survey number.
  onUpdateSurveyNo?: (sheetId: number, surveyNo: string) => Promise<void>;
}

interface SheetGroup {
  key: string;
  // Numeric lot_sheets FK, when the API provided one — needed so
  // onUpdatePlanUrl knows exactly which sheet row to update. Falls back
  // to null for the rare "unsheeted" grouping bucket (see the `key`
  // derivation below), where there's no real sheet row to update.
  sheetId: number | null;
  sheetNo: string;
  planUrl: string | null;
  province: string | null;
  municipality: string | null;
  // Sheet-level fact (lot_sheets.created_by -> users.username via
  // /api/map/lots), taken from the first lot in the group since every lot
  // on a sheet shares it. Displayed once per sheet (SheetsTable column +
  // breadcrumb) instead of repeated on every lot row — see ENCODED BY note
  // at the top of the file.
  encodedBy: string | null;
  // First non-empty surveyNo among lots on this sheet (display only).
  // Lots may already differ; hasMissingSurveyNo tracks whether any lot
  // still lacks a value so the "Add survey no." control can appear.
  surveyNo: string | null;
  hasMissingSurveyNo: boolean;
  lots: LotFeature[];
  totalArea: number;
}

// "Encoded By" is intentionally NOT in this list — it's a sheet-level
// fact, not a per-lot one. It's shown once per sheet instead (SheetsTable's
// own "Encoded By" column, and the breadcrumb once drilled in) — see
// ENCODED BY note at the top of the file.
const LOT_COLUMNS = [
  "Lot No.",
  "Owner",
  "Barangay",
  "Municipality",
  "Survey No.",
  "Date Surveyed",
  "Surveyor",
  "Area (sq.m.)",
  "Patent No.",
  "Remarks",
];

// Numeric-ish columns get tabular-nums + right alignment so figures line
// up like a native spreadsheet column instead of ragged left-aligned text.
const NUMERIC_COLUMNS = new Set(["Area (sq.m.)"]);

function formatArea(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// dateSurveyed comes back as a full ISO timestamp (e.g.
// "2026-01-26T16:00:00.000Z") even though it's really just a date with no
// meaningful time component. Rendering that raw string, or letting
// toLocaleDateString convert it to the browser's local timezone, both
// cause the day to visibly shift (16:00 UTC + PH's UTC+8 rolls into the
// next calendar day). Reading the UTC fields directly keeps the date
// exactly as stored, formatted as e.g. "January 26, 2026".
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Checks a single lot against a lowercased search query across every
// field someone would plausibly search by, including sheet no and encoder
// username — this is what lets the search reach across sheets instead of
// being scoped to whichever one is currently expanded. (encodedBy is still
// read per-feature here purely because that's how the API shapes the data
// — it's a display decision, not a data one, that moved it out of the lot
// row UI; search-by-encoder still works the same as before.)
function matchesLotQuery(f: LotFeature, query: string): boolean {
  const p = f.properties;
  const haystack = [
    p.lotNo,
    p.owner,
    p.barangay,
    p.municipality,
    p.surveyNo,
    p.surveyor,
    p.patentNo,
    p.remarks,
    p.sheetNo,
    p.encodedBy,
  ];
  return haystack.some((v) => v != null && String(v).toLowerCase().includes(query));
}

function PlanLink({ url, stopPropagation, label }: { url: string; stopPropagation?: boolean; label: string }) {
  return React.createElement(
    "a",
    {
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: stopPropagation ? (e: React.MouseEvent) => e.stopPropagation() : undefined,
      className:
        "inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--sb-accent)] transition-opacity hover:opacity-70",
    },
    React.createElement(ExternalLink, { size: 11 }),
    label
  );
}

// Inline "attach a survey number" control — same UX shape as
// AddPlanLinkControl, but plain text (no Google Drive validation). Used
// on the sheets-list Survey No. column and the drilled-in breadcrumb.
// Saving calls onSave(sheetId, surveyNo); the parent PATCHes the sheet
// API, which only fills lots that currently have no survey_no.
function AddSurveyNoControl({
  sheetId,
  onSave,
}: {
  sheetId: number;
  onSave: (sheetId: number, surveyNo: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setEditing(false);
    setValue("");
    setError(null);
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);
    try {
      await onSave(sheetId, trimmed);
      setEditing(false);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save survey no.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Tooltip label="Set survey number on all lots on this sheet that don't have one yet">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--sb-text-faint)] transition-colors hover:text-[var(--sb-accent)]"
        >
          Add survey no.
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        type="text"
        value={value}
        disabled={saving}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") cancel();
        }}
        placeholder="Survey number…"
        className="w-[120px] rounded-md px-1.5 py-[3px] text-[11px] outline-none"
        style={{
          background: "var(--sb-bg)",
          boxShadow: `inset 0 0 0 1px ${error ? "#ef4444" : HAIRLINE}`,
          color: "var(--sb-text)",
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !value.trim()}
        className="text-[10.5px] font-semibold text-[var(--sb-accent)] disabled:opacity-40"
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="text-[10.5px] text-[var(--sb-text-faint)]"
      >
        Cancel
      </button>
      {error && (
        <Tooltip label={error}>
          <span className="flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-red-500">
            !
          </span>
        </Tooltip>
      )}
    </div>
  );
}

// Inline "attach a plan link" control. Used in two places now: the
// sheets-list Plan column, and the drilled-in-sheet breadcrumb (see
// BREADCRUMB PLAN LINK above) — both pass the same sheetId/onSave, so
// saving through either one updates the same underlying sheet. Starts as
// a small ghost button ("Add link"); clicking it swaps in a compact URL
// input + Save/Cancel. Enter saves, Escape cancels.
//
// The link is required to be a real Google Drive/Docs URL pointing at a
// specific file or folder (see isTraceableGoogleDriveLink in
// src/lib/planLink.ts) — checked here BEFORE calling onSave, so a bad
// link never even reaches the network. This is purely a UX nicety: the
// same rule is re-checked server-side in the PATCH route, since a client
// check can always be bypassed. Both a local validation failure and a
// rejected onSave (e.g. the server-side check failing, or a network
// error) surface the same way: a small red "!" with the message in its
// own tooltip, right next to the input.
function AddPlanLinkControl({
  sheetId,
  onSave,
}: {
  sheetId: number;
  onSave: (sheetId: number, planUrl: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setEditing(false);
    setValue("");
    setError(null);
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (!isTraceableGoogleDriveLink(trimmed)) {
      setError(PLAN_LINK_HELP_MESSAGE);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(sheetId, trimmed);
      setEditing(false);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save link.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Tooltip label="Add a Google Drive link to this sheet's plan">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--sb-text-faint)] transition-colors hover:text-[var(--sb-accent)]"
        >
          <Link2 size={11} />
          Add link
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="url"
        value={value}
        disabled={saving}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") cancel();
        }}
        placeholder="Paste Google Drive link…"
        className="w-[168px] rounded-md px-1.5 py-[3px] text-[11px] outline-none"
        style={{
          background: "var(--sb-bg)",
          boxShadow: `inset 0 0 0 1px ${error ? "#ef4444" : HAIRLINE}`,
          color: "var(--sb-text)",
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !value.trim()}
        className="text-[10.5px] font-semibold text-[var(--sb-accent)] disabled:opacity-40"
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="text-[10.5px] text-[var(--sb-text-faint)]"
      >
        Cancel
      </button>
      {error && (
        <Tooltip label={error}>
          <span className="flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-red-500">
            !
          </span>
        </Tooltip>
      )}
    </div>
  );
}

// Custom checkbox — a real <input type="checkbox"> (kept for a11y, focus
// ring, and keyboard toggling) with the native box hidden and a rounded
// square drawn in its place, checked state shown with a small check glyph.
// Matches the rest of the chrome instead of each browser's default skin.
// No longer takes a `title` prop — callers that need a tooltip wrap this
// in <Tooltip> instead (see the header "select all" checkbox below).
function Checkbox({
  checked,
  onChange,
  onClick,
}: {
  checked: boolean;
  onChange: () => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <span className="relative inline-flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onClick={onClick}
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

// Color-selection toolbar. Always mounted whenever a lots table is on
// screen (drilled sheet or search results) — it doesn't wait for a
// selection to exist. With nothing checked it just renders faded and
// non-interactive with a short hint, so ticking the first checkbox
// activates it in place instead of inserting a whole new row and pushing
// everything else in the header stack down.
function ColorToolbar({
  selectedCount,
  onApplyColor,
  onDeselectAll,
}: {
  selectedCount: number;
  onApplyColor: (color: string | null) => void;
  onDeselectAll: () => void;
}) {
  const enabled = selectedCount > 0;
  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <span
        className="whitespace-nowrap text-[11px] font-medium tabular-nums"
        style={{ color: enabled ? "var(--sb-accent-text)" : "var(--sb-text-faint)" }}
      >
        {enabled ? `${selectedCount} selected` : "Select lots to color"}
      </span>

      <div
        className="flex items-center gap-1.5 transition-opacity"
        style={{ opacity: enabled ? 1 : 0.35, pointerEvents: enabled ? "auto" : "none" }}
      >
        {COLOR_PRESETS.map((c) => (
          <Tooltip key={c.value} label={`${c.label} (${c.value})`}>
            <button
              type="button"
              onClick={() => onApplyColor(c.value)}
              className="h-[16px] w-[16px] flex-shrink-0 rounded-full shadow-sm ring-1 ring-inset ring-black/10 transition-transform hover:scale-110"
              style={{ background: c.value }}
            />
          </Tooltip>
        ))}
        <Tooltip label="Custom color">
          <label className="flex h-[16px] w-[16px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-[var(--sb-text-faint)] text-[var(--sb-text-faint)] transition-colors hover:border-[var(--sb-text)] hover:text-[var(--sb-text)]">
            <Palette size={9} />
            <input type="color" onChange={(e) => onApplyColor(e.target.value)} className="sr-only" />
          </label>
        </Tooltip>
        <Tooltip label="Remove color from selected lots">
          <button
            type="button"
            onClick={() => onApplyColor(null)}
            className="text-[10.5px] font-medium text-[var(--sb-text-muted)] transition-colors hover:text-[var(--sb-text)]"
          >
            Clear
          </button>
        </Tooltip>
      </div>

      <button
        type="button"
        onClick={onDeselectAll}
        disabled={!enabled}
        className="flex-shrink-0 text-[10.5px] font-medium transition-colors"
        style={{ color: enabled ? "var(--sb-text-faint)" : "transparent", cursor: enabled ? "pointer" : "default" }}
      >
        Deselect all
      </button>
    </div>
  );
}

export default function AttributeTable({
  features,
  onRowClick,
  selectedId,
  totalCount,
  totalArea,
  truncated,
  hasError,
  filterLabel,
  onClearFilter,
  lotColors,
  onSetLotColors,
  onViewSheet,
  onUpdatePlanUrl,
  onUpdateSurveyNo,
}: Props) {
  const { vars } = useSidebarTheme();
  const [expandedSheetKey, setExpandedSheetKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const [colorSelectedIds, setColorSelectedIds] = useState<Set<string>>(new Set());

  // Search always runs against the flat `features` list — not sheetGroups,
  // not expandedSheet.lots — so a match in any sheet shows up regardless
  // of which sheet (if any) is currently drilled into.
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return null;
    const lots = features.filter((f) => matchesLotQuery(f, normalizedQuery));
    const area = lots.reduce((sum, f) => sum + (Number(f.properties.areaSqm) || 0), 0);
    return { lots, totalArea: area };
  }, [features, normalizedQuery]);

  const isSearching = searchResults !== null;

  const sheetGroups = useMemo<SheetGroup[]>(() => {
    const map = new Map<string, SheetGroup>();
    for (const f of features) {
      const key =
        f.properties.sheetId != null ? `id:${f.properties.sheetId}` : `no:${f.properties.sheetNo ?? "unsheeted"}`;
      const area = Number(f.properties.areaSqm) || 0;
      const existing = map.get(key);
      const rawSurvey = f.properties.surveyNo;
      const surveyStr =
        rawSurvey != null && String(rawSurvey).trim() !== "" ? String(rawSurvey).trim() : null;
      if (existing) {
        existing.lots.push(f);
        existing.totalArea += area;
        if (!existing.surveyNo && surveyStr) existing.surveyNo = surveyStr;
        if (!surveyStr) existing.hasMissingSurveyNo = true;
      } else {
        map.set(key, {
          key,
          sheetId: typeof f.properties.sheetId === "number" ? f.properties.sheetId : null,
          sheetNo: f.properties.sheetNo || "—",
          planUrl: f.properties.planUrl,
          province: f.properties.province,
          municipality: f.properties.municipality,
          encodedBy: f.properties.encodedBy,
          surveyNo: surveyStr,
          hasMissingSurveyNo: !surveyStr,
          lots: [f],
          totalArea: area,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sheetNo.localeCompare(b.sheetNo));
  }, [features]);

  useEffect(() => {
    if (expandedSheetKey && !sheetGroups.some((g) => g.key === expandedSheetKey)) {
      setExpandedSheetKey(null);
    }
  }, [expandedSheetKey, sheetGroups]);

  // Auto-drill into whichever sheet owns `selectedId` when it changes to a
  // lot the currently-expanded sheet doesn't contain — this is what makes
  // clicking a polygon directly on the map (see MapCanvas's
  // onPolygonClick) actually bring that lot's row into view here, instead
  // of silently doing nothing because the sheets list is still showing.
  // Skipped while searching: search results are already a flat cross-sheet
  // list, so there's no drill-down step to perform.
  useEffect(() => {
    if (selectedId == null || isSearching) return;
    const idStr = String(selectedId);

    const currentGroup = expandedSheetKey ? sheetGroups.find((g) => g.key === expandedSheetKey) : null;
    if (currentGroup?.lots.some((f) => String(f.id) === idStr)) return;

    const owningGroup = sheetGroups.find((g) => g.lots.some((f) => String(f.id) === idStr));
    if (owningGroup) setExpandedSheetKey(owningGroup.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, isSearching, sheetGroups]);

  // Drop any checked ids that no longer exist in the current feature set
  // (e.g. the sidebar filter changed underneath the table) so the "select
  // all" checkbox and the toolbar count don't go stale.
  useEffect(() => {
    setColorSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(features.map((f) => String(f.id)));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [features]);

  function toggleColorSelect(id: string) {
    setColorSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Scoped to whatever list is currently visible (a sheet's lots, or the
  // current search results) — not the whole project — so "select all"
  // means "all of what I'm looking at right now".
  function toggleColorSelectAll(visible: LotFeature[]) {
    const visibleIds = visible.map((f) => String(f.id));
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => colorSelectedIds.has(id));
    setColorSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function applyColor(color: string | null) {
    if (!onSetLotColors || colorSelectedIds.size === 0) return;
    onSetLotColors(Array.from(colorSelectedIds), color);
  }

  const expandedSheet = expandedSheetKey ? sheetGroups.find((g) => g.key === expandedSheetKey) ?? null : null;

  // Single source of truth for the top summary bar. Priority: an active
  // search wins (shows match count/area across all sheets), then a
  // drilled-into sheet (shows that sheet's own count/area), then the
  // overall total. There's only ever one number on screen and it always
  // matches the table currently being shown underneath it.
  const summaryCount = isSearching
    ? searchResults.lots.length
    : expandedSheet
      ? expandedSheet.lots.length
      : totalCount ?? features.length;
  const summaryArea = isSearching
    ? searchResults.totalArea
    : expandedSheet
      ? expandedSheet.totalArea
      : totalArea ?? features.reduce((sum, f) => sum + (Number(f.properties.areaSqm) || 0), 0);

  if (features.length === 0) {
    return (
      <div className={`${uiFont.className} flex h-full flex-col bg-[var(--sb-bg)]`} style={vars}>
        {filterLabel && onClearFilter && <FilterChip label={filterLabel} onClear={onClearFilter} />}
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sb-hover)] text-[var(--sb-text-faint)]">
            <Table2 size={14} />
          </div>
          <p className="text-[12.5px] font-medium text-[var(--sb-text)]">
            {hasError ? "That selection failed to load." : "No lots to show yet"}
          </p>
          <p className="text-[11.5px] text-[var(--sb-text-faint)]">
            {hasError
              ? "Try toggling it off and on again in the sidebar."
              : "Check a municipality, barangay, or year in the sidebar."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${uiFont.className} flex h-full flex-col bg-[var(--sb-bg)] antialiased`} style={vars}>
      {filterLabel && onClearFilter && <FilterChip label={filterLabel} onClear={onClearFilter} />}

      <SummaryBar
        count={summaryCount}
        totalArea={summaryArea}
        truncated={isSearching || expandedSheet ? false : truncated}
        hasError={hasError}
        scope={isSearching ? "matching your search" : expandedSheet ? "on this sheet" : undefined}
        rightSlot={
          <div className="relative flex flex-shrink-0 items-center">
            <Search
              size={11}
              className="pointer-events-none absolute left-[9px] text-[var(--sb-text-faint)]"
            />
            <Tooltip label="Search by owner, lot no., barangay, survey no., surveyor, patent no., remarks, or encoded by">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search owner, lot no..."
                className="w-[172px] rounded-full text-[11.5px] font-normal outline-none transition-shadow focus:ring-2 focus:ring-[var(--sb-accent)]/30"
                style={{
                  padding: searchQuery ? "5px 24px 5px 26px" : "5px 10px 5px 26px",
                  background: "var(--sb-hover)",
                  color: "var(--sb-text)",
                  boxShadow: `inset 0 0 0 1px ${HAIRLINE}`,
                }}
              />
            </Tooltip>
            {searchQuery && (
              <Tooltip label="Clear search">
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-[6px] flex h-4 w-4 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-faint)] transition-colors hover:bg-[var(--sb-bg)] hover:text-[var(--sb-text)]"
                >
                  <X size={11} />
                </button>
              </Tooltip>
            )}
          </div>
        }
      />

      {/* Combined breadcrumb + color-toolbar row — see COMPACT HEADER note
          at the top of the file. Renders whenever a lots table (drilled
          sheet or search results) is showing; absent on the plain sheets
          list, which has no checkboxes and nothing to color. */}
      {(isSearching || expandedSheet) && (
        <div
          className="flex flex-shrink-0 items-center gap-3 px-3 py-1"
          style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-hover)" }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!isSearching && expandedSheet ? (
              <>
                <button
                  type="button"
                  onClick={() => setExpandedSheetKey(null)}
                  className="flex flex-shrink-0 items-center gap-0.5 rounded-full border-0 bg-transparent py-1 pl-1.5 pr-2 text-[11.5px] font-semibold text-[var(--sb-text-muted)] transition-colors hover:bg-[var(--sb-bg-elevated)] hover:text-[var(--sb-text)]"
                >
                  <ChevronLeft size={13} />
                  Sheets
                </button>
                <span className="flex-shrink-0 text-[var(--sb-text-faint)]">/</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--sb-text)]">
                  {expandedSheet.sheetNo}
                  {expandedSheet.municipality && ` — ${expandedSheet.municipality}, ${expandedSheet.province ?? ""}`}
                  {expandedSheet.encodedBy && ` · Encoded by ${expandedSheet.encodedBy}`}
                </span>

                {/* Plan link/control — see BREADCRUMB PLAN LINK note at the
                    top of the file. Kept as its own flex-shrink-0 segment
                    (not folded into the truncating span above it) since
                    AddPlanLinkControl renders interactive input/buttons
                    that shouldn't get clipped by a truncated ancestor. */}
                <span className="flex-shrink-0 text-[var(--sb-text-faint)]">·</span>
                <span className="flex-shrink-0">
                  {expandedSheet.planUrl ? (
                    <PlanLink url={expandedSheet.planUrl} label="Plan" />
                  ) : expandedSheet.sheetId != null && onUpdatePlanUrl ? (
                    <AddPlanLinkControl sheetId={expandedSheet.sheetId} onSave={onUpdatePlanUrl} />
                  ) : (
                    <span className="text-[11.5px] text-[var(--sb-text-faint)]">No plan</span>
                  )}
                </span>

                {/* Survey no. — display existing + optional "Add survey no."
                    for lots still missing one (see SHEET SURVEY NO). */}
                <span className="flex-shrink-0 text-[var(--sb-text-faint)]">·</span>
                <span className="flex-shrink-0 flex items-center gap-1.5">
                  {expandedSheet.surveyNo ? (
                    <span className="text-[11.5px] text-[var(--sb-text-muted)]">
                      Survey {expandedSheet.surveyNo}
                    </span>
                  ) : null}
                  {expandedSheet.hasMissingSurveyNo &&
                  expandedSheet.sheetId != null &&
                  onUpdateSurveyNo ? (
                    <AddSurveyNoControl
                      sheetId={expandedSheet.sheetId}
                      onSave={onUpdateSurveyNo}
                    />
                  ) : !expandedSheet.surveyNo ? (
                    <span className="text-[11.5px] text-[var(--sb-text-faint)]">No survey no.</span>
                  ) : null}
                </span>
              </>
            ) : (
              <span className="text-[11.5px] font-medium text-[var(--sb-text-faint)]">Search results</span>
            )}
          </div>

          <ColorToolbar
            selectedCount={colorSelectedIds.size}
            onApplyColor={applyColor}
            onDeselectAll={() => setColorSelectedIds(new Set())}
          />
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{
          // iOS Safari momentum scrolling + stop the table's own scroll
          // from bubbling into a page-level scroll once it hits the end —
          // a common source of "the panel feels stuck" on iPhone.
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
        }}
      >
        {isSearching ? (
          searchResults.lots.length === 0 ? (
            <NoSearchResults query={searchQuery} />
          ) : (
            <LotsTable
              features={searchResults.lots}
              onRowClick={onRowClick}
              selectedId={selectedId}
              showSheetNo
              lotColors={lotColors}
              colorSelectedIds={colorSelectedIds}
              onToggleColorSelect={toggleColorSelect}
              onToggleColorSelectAll={() => toggleColorSelectAll(searchResults.lots)}
            />
          )
        ) : expandedSheet ? (
          <LotsTable
            features={expandedSheet.lots}
            onRowClick={onRowClick}
            selectedId={selectedId}
            lotColors={lotColors}
            colorSelectedIds={colorSelectedIds}
            onToggleColorSelect={toggleColorSelect}
            onToggleColorSelectAll={() => toggleColorSelectAll(expandedSheet.lots)}
          />
        ) : (
          <SheetsTable
            groups={sheetGroups}
            onOpenSheet={setExpandedSheetKey}
            onViewSheet={onViewSheet}
            onUpdatePlanUrl={onUpdatePlanUrl}
            onUpdateSurveyNo={onUpdateSurveyNo}
          />
        )}
      </div>
    </div>
  );
}

function NoSearchResults({ query }: { query: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sb-hover)] text-[var(--sb-text-faint)]">
        <Search size={14} />
      </div>
      <p className="text-[12.5px] font-medium text-[var(--sb-text)]">No lots match "{query}"</p>
      <p className="text-[11.5px] text-[var(--sb-text-faint)]">Try a different owner, lot no., or barangay.</p>
    </div>
  );
}

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      className={`sticky top-0 z-10 whitespace-nowrap px-2.5 py-[7px] font-semibold uppercase backdrop-blur ${
        numeric ? "text-right" : "text-left"
      }`}
      style={{
        background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
        borderBottom: `1px solid ${HAIRLINE}`,
        fontSize: "10px",
        letterSpacing: "0.05em",
        color: "var(--sb-text-muted)",
      }}
    >
      {children}
    </th>
  );
}

function SheetsTable({
  groups,
  onOpenSheet,
  onViewSheet,
  onUpdatePlanUrl,
  onUpdateSurveyNo,
}: {
  groups: SheetGroup[];
  onOpenSheet: (key: string) => void;
  // See SheetPreviewRequest above — only the fields the parent actually
  // needs to build a whole-sheet preview, not the internal SheetGroup
  // bookkeeping fields (key, totalArea).
  onViewSheet?: (sheet: SheetPreviewRequest) => void;
  // See onUpdatePlanUrl on Props above.
  onUpdatePlanUrl?: (sheetId: number, planUrl: string) => Promise<void>;
  // See onUpdateSurveyNo on Props above.
  onUpdateSurveyNo?: (sheetId: number, surveyNo: string) => Promise<void>;
}) {
  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead>
        <tr>
          <Th>Sheet No.</Th>
          <Th>Municipality</Th>
          <Th>Province</Th>
          <Th>Plan</Th>
          <Th>Survey No.</Th>
          <Th numeric>Lots</Th>
          <Th numeric>Total Area (sq.m.)</Th>
          <Th>Encoded By</Th>
          {onViewSheet && <Th>Preview</Th>}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, i) => (
          // No more chevron/action column for the "drill in" affordance —
          // the whole row is still that click target (onClick below) and
          // a native title gives a plain "click to view lots" tooltip on
          // hover. The Preview column (below, when onViewSheet is
          // provided) and the Plan cell's inline edit control are both
          // deliberately separate, explicit actions with their own
          // stopPropagation so neither also triggers the row's drill-in
          // click.
          <tr
            key={g.key}
            onClick={() => onOpenSheet(g.key)}
            title="Click to view lots"
            className="cursor-pointer transition-colors duration-100"
            style={{
              borderBottom: `1px solid ${HAIRLINE_SOFT}`,
              background: i % 2 === 1 ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sb-hover)")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background =
                i % 2 === 1 ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)" : "transparent")
            }
          >
            <td className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]">{g.sheetNo}</td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{g.municipality || "—"}</td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{g.province || "—"}</td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
              {g.planUrl ? (
                <PlanLink url={g.planUrl} label="View" />
              ) : g.sheetId != null && onUpdatePlanUrl ? (
                <AddPlanLinkControl sheetId={g.sheetId} onSave={onUpdatePlanUrl} />
              ) : (
                "—"
              )}
            </td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {g.surveyNo ? (
                  <span className="text-[var(--sb-text)]">{g.surveyNo}</span>
                ) : null}
                {g.hasMissingSurveyNo && g.sheetId != null && onUpdateSurveyNo ? (
                  <AddSurveyNoControl sheetId={g.sheetId} onSave={onUpdateSurveyNo} />
                ) : !g.surveyNo ? (
                  "—"
                ) : null}
              </span>
            </td>
            <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">{g.lots.length}</td>
            <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
              {formatArea(g.totalArea)}
            </td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{g.encodedBy || "—"}</td>
            {onViewSheet && (
              <td className="px-2.5 py-[6px]" onClick={(e) => e.stopPropagation()}>
                <Tooltip label="Preview whole sheet — all lots + coordinates">
                  <button
                    type="button"
                    onClick={() =>
                      onViewSheet({
                        sheetNo: g.sheetNo,
                        province: g.province,
                        municipality: g.municipality,
                        lots: g.lots,
                      })
                    }
                    className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] border-0 bg-[var(--sb-accent-bg)] p-0 text-[var(--sb-accent)] transition-colors duration-100 hover:opacity-75"
                  >
                    <Eye size={12} />
                  </button>
                </Tooltip>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LotsTable({
  features,
  onRowClick,
  selectedId,
  showSheetNo,
  lotColors,
  colorSelectedIds,
  onToggleColorSelect,
  onToggleColorSelectAll,
}: {
  features: LotFeature[];
  onRowClick?: (feature: LotFeature) => void;
  selectedId?: number | string | null;
  // True for cross-sheet search results, where rows can come from several
  // sheets at once and the sheet needs to be visible again — false for the
  // normal drill-into-one-sheet view, where it'd just repeat what the
  // breadcrumb above already says.
  showSheetNo?: boolean;
  lotColors?: Record<string, string>;
  colorSelectedIds: Set<string>;
  onToggleColorSelect: (id: string) => void;
  onToggleColorSelectAll: () => void;
}) {
  const columns = showSheetNo ? ["Sheet No.", ...LOT_COLUMNS] : LOT_COLUMNS;
  const visibleIds = features.map((f) => String(f.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => colorSelectedIds.has(id));

  // Row DOM nodes keyed by (stringified) lot id, so the effect below can
  // scroll the currently-selected one into view — this is what brings a
  // lot clicked directly on the map into visible/scrolled focus here,
  // once AttributeTable has (if needed) auto-drilled into its sheet.
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (selectedId == null) return;
    const el = rowRefs.current[String(selectedId)];
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // Re-run whenever the selection changes OR the visible feature set
    // changes (e.g. right after AttributeTable auto-drills into a sheet
    // and this row first mounts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, features]);

  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead>
        <tr>
          <th
            className="sticky top-0 z-10 w-7 px-2.5 py-[7px] backdrop-blur"
            style={{
              background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
              borderBottom: `1px solid ${HAIRLINE}`,
            }}
          >
            <Tooltip label={allVisibleSelected ? "Deselect all visible lots" : "Select all visible lots"}>
              <Checkbox checked={allVisibleSelected} onChange={onToggleColorSelectAll} />
            </Tooltip>
          </th>
          {columns.map((h) => (
            <Th key={h} numeric={NUMERIC_COLUMNS.has(h)}>
              {h}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {features.map((f, i) => {
          const id = String(f.id);
          const isSelected = selectedId != null && id === String(selectedId);
          const isColorChecked = colorSelectedIds.has(id);
          const rowColor = lotColors?.[id];

          // Row background: a colored lot always gets a translucent tint
          // of its own color (stronger when also selected), so the table
          // mirrors the polygon fill on the map. Only rows with NO color
          // fall back to the theme's zebra/selected/checked styling.
          const baseBg = rowColor
            ? hexToRgba(rowColor, isSelected ? 0.28 : 0.16)
            : isSelected
              ? "var(--sb-accent-bg)"
              : isColorChecked
                ? "var(--sb-accent-bg)"
                : i % 2 === 1
                  ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)"
                  : "transparent";

          return (
            <tr
              key={f.id}
              ref={(el) => {
                rowRefs.current[id] = el;
              }}
              onClick={() => onRowClick?.(f)}
              style={{ background: baseBg, borderBottom: `1px solid ${HAIRLINE_SOFT}` }}
              className={`transition-colors duration-100 ${onRowClick ? "cursor-pointer" : ""}`}
              onMouseEnter={(e) => {
                if (!onRowClick || isSelected) return;
                e.currentTarget.style.background = rowColor ? hexToRgba(rowColor, 0.24) : "var(--sb-hover)";
              }}
              onMouseLeave={(e) => {
                if (!onRowClick || isSelected) return;
                e.currentTarget.style.background = baseBg;
              }}
            >
              <td className="px-2.5 py-[6px]" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isColorChecked} onChange={() => onToggleColorSelect(id)} />
              </td>
              {showSheetNo && (
                <td
                  className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]"
                  style={{
                    boxShadow: isSelected
                      ? "inset 2px 0 0 var(--sb-accent)"
                      : rowColor
                        ? `inset 2px 0 0 ${rowColor}`
                        : "inset 2px 0 0 transparent",
                  }}
                >
                  {f.properties.sheetNo || "—"}
                </td>
              )}
              <td
                className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]"
                style={
                  showSheetNo
                    ? undefined
                    : {
                        boxShadow: isSelected
                          ? "inset 2px 0 0 var(--sb-accent)"
                          : rowColor
                            ? `inset 2px 0 0 ${rowColor}`
                            : "inset 2px 0 0 transparent",
                      }
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  {rowColor && (
                    <Tooltip label={`Colored: ${rowColor}`}>
                      <span
                        className="inline-block h-2 w-2 flex-shrink-0 rounded-full ring-1 ring-[var(--sb-bg)]"
                        style={{ background: rowColor, boxShadow: "0 0 0 1px rgba(15,23,42,0.15)" }}
                      />
                    </Tooltip>
                  )}
                  {f.properties.lotNo}
                </span>
              </td>
              <td className="max-w-[140px] truncate px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.owner}</td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.barangay}</td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.municipality}</td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.surveyNo}</td>
              <td className="whitespace-nowrap px-2.5 py-[6px] text-[var(--sb-text-muted)]">
                {formatDate(f.properties.dateSurveyed)}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.surveyor}</td>
              <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
                {f.properties.areaSqm}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.patentNo}</td>
              <td className="max-w-[160px] truncate px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.remarks}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div
      className="flex flex-shrink-0 items-center gap-2 px-3 py-1.5"
      style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-accent-bg)" }}
    >
      <Table2 size={12} className="flex-shrink-0 text-[var(--sb-accent)]" />
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--sb-accent-text)]">
        Showing only: {label}
      </span>
      <Tooltip label="Show all selected layers">
        <button
          type="button"
          onClick={onClear}
          className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-accent)] transition-colors hover:bg-[var(--sb-bg)]"
        >
          <X size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
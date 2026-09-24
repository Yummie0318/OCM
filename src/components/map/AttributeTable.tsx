"use client";

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LotFeature } from "@/lib/geo";
import { isTraceableGoogleDriveLink, PLAN_LINK_HELP_MESSAGE } from "@/lib/planLink";
import SummaryBar from "@/components/map/SummaryBar";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import {
  Table2,
  X,
  ChevronLeft,
  ExternalLink,
  Search,
  Palette,
  Check,
  Eye,
  Link2,
  Loader2,
  Plus,
} from "lucide-react";

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "Titled", value: "#22c55e" },
  { label: "Untitled", value: "#ef4444" },
  { label: "Pending", value: "#f59e0b" },
  { label: "Reference", value: "#3b82f6" },
  { label: "Flagged", value: "#a855f7" },
];

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";
const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

// Coerces sheetId to a real number regardless of whether the API returned
// it as a JS number or a numeric string (e.g. some Postgres drivers/column
// types serialize integer/bigint columns as strings in JSON). Without
// this, a sheetId of "42" (string) would fail `typeof === "number"` checks
// and every inline "Add ___" control on that sheet would silently
// disappear, even though the sheet is perfectly valid.
function toSheetId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

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
      onClick={(e) => {
        e.stopPropagation();
        setShow((s) => !s);
      }}
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

export interface SheetPreviewRequest {
  sheetNo: string;
  province: string | null;
  municipality: string | null;
  lots: LotFeature[];
}

interface Props {
  features: LotFeature[];
  loading?: boolean;
  onRowClick?: (feature: LotFeature) => void;
  selectedId?: number | string | null;
  totalCount?: number;
  totalArea?: number;
  truncated?: boolean;
  hasError?: boolean;
  filterLabel?: string | null;
  onClearFilter?: () => void;
  lotColors?: Record<string, string>;
  onSetLotColors?: (lotIds: Array<string | number>, color: string | null) => void;
  onViewSheet?: (sheet: SheetPreviewRequest) => void;
  onUpdatePlanUrl?: (sheetId: number, planUrl: string) => Promise<void>;
  onUpdateSurveyNo?: (sheetId: number, surveyNo: string) => Promise<void>;
  onUpdateDocumentsUrl?: (sheetId: number, documentsUrl: string) => Promise<void>;
  onUpdateSurveyClass?: (sheetId: number, surveyClass: "admin" | "private") => Promise<void>;
}

interface SheetGroup {
  key: string;
  sheetId: number | null;
  sheetNo: string;
  planUrl: string | null;
  documentsUrl: string | null;
  surveyClass: "admin" | "private" | null;
  province: string | null;
  municipality: string | null;
  encodedBy: string | null;
  surveyNo: string | null;
  hasMissingSurveyNo: boolean;
  lots: LotFeature[];
  totalArea: number;
}

const LOT_COLUMNS = [
  "Lot No.",
  "Owner",
  "Barangay",
  "Municipality",
  "Date Surveyed",
  "Surveyor",
  "Area (sq.m.)",
  "Patent No.",
  "Remarks",
];

const NUMERIC_COLUMNS = new Set(["Area (sq.m.)"]);

// Always shows exactly 2 decimals (e.g. 207.5396728515625 -> "207.54").
// Accepts unknown because areaSqm can arrive as a number, a numeric
// string, or null depending on the API/database driver.
function formatArea(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

// Filled-state chip for a saved external link (Plan / Documents). Same
// pill shape/size as the empty-state "Add" trigger below it renders
// in place of, so a column reads as one consistent chip regardless of
// whether the sheet has a value yet.
function PlanLink({ url, stopPropagation, label }: { url: string; stopPropagation?: boolean; label: string }) {
  return React.createElement(
    "a",
    {
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: stopPropagation ? (e: React.MouseEvent) => e.stopPropagation() : undefined,
      className:
        "inline-flex items-center gap-1 rounded-full border-0 bg-[var(--sb-hover)] px-2 py-[3px] text-[10.5px] font-semibold text-[var(--sb-accent-text)] transition-colors duration-100 hover:bg-[var(--sb-accent-bg)]",
    },
    React.createElement(ExternalLink, { size: 10 }),
    label
  );
}

// Small colored badge for survey class, so "Admin" vs "Private" is
// scannable down the column at a glance instead of reading as plain body
// text indistinguishable from any other cell.
function SurveyClassBadge({ value }: { value: "admin" | "private" }) {
  const isAdmin = value === "admin";
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-bold uppercase tracking-wide"
      style={{
        background: isAdmin ? "rgba(59, 130, 246, 0.14)" : "rgba(168, 85, 247, 0.14)",
        color: isAdmin ? "#3b82f6" : "#a855f7",
      }}
    >
      {value}
    </span>
  );
}

type FieldKind = "text" | "url" | "select";

interface SelectOption {
  value: string;
  label: string;
}

// One reusable inline "click to add a value" control, replacing what used
// to be four nearly-identical components (AddSurveyNoControl,
// AddPlanLinkControl, AddDocumentsLinkControl, AddSurveyClassControl).
// Handles text input, URL input (with a `validate` hook for the Google
// Drive link check), and a select — same trigger/edit/save/cancel/error
// shape for all three, so a fix or style tweak only has to happen once.
//
// Trigger renders as a small accent-tinted pill with a "+" icon (instead
// of the old plain underline-less text link) so it's unambiguous that
// it's a button, and visually matches PlanLink's filled-state pill and
// the sheet row's Preview icon button — one consistent chip language
// across the whole table.
function InlineFieldControl({
  sheetId,
  kind,
  triggerLabel,
  tooltip,
  placeholder,
  selectOptions,
  inputWidth = 140,
  validate,
  onSave,
}: {
  sheetId: number;
  kind: FieldKind;
  triggerLabel: string;
  tooltip: string;
  placeholder?: string;
  selectOptions?: SelectOption[];
  inputWidth?: number;
  validate?: (value: string) => string | null;
  onSave: (sheetId: number, value: string) => Promise<void>;
}) {
  const defaultValue = kind === "select" ? selectOptions?.[0]?.value ?? "" : "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setValue(defaultValue);
    setError(null);
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (kind !== "select" && !trimmed) return;

    if (validate) {
      const validationError = validate(trimmed);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(sheetId, trimmed);
      setEditing(false);
      setValue(defaultValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Tooltip label={tooltip}>
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-[3px] text-[10.5px] font-semibold text-[var(--sb-accent-text)] transition-colors duration-100 hover:border-solid"
          style={{
            borderColor: "color-mix(in srgb, var(--sb-accent-text) 55%, transparent)",
            background: "var(--sb-accent-bg)",
          }}
        >
          <Plus size={10} strokeWidth={2.5} />
          {triggerLabel}
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {kind === "select" ? (
        <select
          autoFocus
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          className="rounded-md px-1.5 py-[3px] text-[11px] outline-none"
          style={{
            background: "var(--sb-bg)",
            boxShadow: `inset 0 0 0 1px ${error ? "#ef4444" : HAIRLINE}`,
            color: "var(--sb-text)",
          }}
        >
          {selectOptions?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          type={kind === "url" ? "url" : "text"}
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
          placeholder={placeholder}
          style={{
            width: inputWidth,
            background: "var(--sb-bg)",
            boxShadow: `inset 0 0 0 1px ${error ? "#ef4444" : HAIRLINE}`,
            color: "var(--sb-text)",
          }}
          className="rounded-md px-1.5 py-[3px] text-[11px] outline-none"
        />
      )}

      <Tooltip label="Save">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || (kind !== "select" && !value.trim())}
          className="flex h-[21px] w-[21px] flex-shrink-0 items-center justify-center rounded-full border-0 p-0 transition-opacity duration-100 disabled:opacity-40"
          style={{ background: "var(--sb-accent)", color: "var(--sb-on-accent)" }}
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} strokeWidth={2.5} />}
        </button>
      </Tooltip>
      <Tooltip label="Cancel">
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="flex h-[21px] w-[21px] flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-faint)] transition-colors duration-100 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
        >
          <X size={12} />
        </button>
      </Tooltip>
      {error && (
        <Tooltip label={error}>
          <span className="flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full bg-red-500/15 text-[10px] font-bold text-red-500">
            !
          </span>
        </Tooltip>
      )}
    </div>
  );
}

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
    <span className="relative inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center sm:h-[15px] sm:w-[15px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onClick={onClick}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        className="pointer-events-none flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--sb-accent)] peer-focus-visible:ring-offset-1 sm:h-[15px] sm:w-[15px] sm:rounded-[4.5px]"
        style={{
          borderColor: checked ? "var(--sb-accent)" : "var(--sb-border)",
          background: checked ? "var(--sb-accent)" : "var(--sb-bg)",
        }}
      >
        {checked && <Check size={10.5} strokeWidth={3} style={{ color: "var(--sb-on-accent)" }} />}
      </span>
    </span>
  );
}

// MOBILE PASS: this toolbar used to be a single `flex items-center` row —
// label, 5 swatches, custom-color swatch, "Clear", and "Deselect all" all
// fighting for one line. On a ~360px phone that overflowed/overlapped
// (the bug in the screenshot). It's now `flex-wrap`, so it drops to a
// second line instead of clipping, swatches are bumped to 20px (closer to
// a real touch target vs. the old 16px), copy is shorter, and "Deselect"
// only renders once something is actually selected instead of reserving
// space with `color: transparent` (a trick that's fine on desktop but
// wastes width on narrow screens).
//
// Reused for BOTH the lot-level color toolbar (checkboxes on individual
// lot rows, inside a sheet or search results) AND the new sheet-level
// color toolbar below (checkboxes on whole sheets, from the sheets list)
// — same shape/behavior either way, just fed a different selected count
// and a different apply-color callback.
function ColorToolbar({
  selectedCount,
  onApplyColor,
  onDeselectAll,
  idleLabel = "Tap lots to color",
}: {
  selectedCount: number;
  onApplyColor: (color: string | null) => void;
  onDeselectAll: () => void;
  idleLabel?: string;
}) {
  const enabled = selectedCount > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span
        className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums"
        style={{ color: enabled ? "var(--sb-accent-text)" : "var(--sb-text-faint)" }}
      >
        {enabled ? `${selectedCount} selected` : idleLabel}
      </span>

      <div
        className="flex flex-wrap items-center gap-1.5 transition-opacity"
        style={{ opacity: enabled ? 1 : 0.35, pointerEvents: enabled ? "auto" : "none" }}
      >
        {COLOR_PRESETS.map((c) => (
          <Tooltip key={c.value} label={`${c.label} (${c.value})`}>
            <button
              type="button"
              onClick={() => onApplyColor(c.value)}
              className="h-[20px] w-[20px] flex-shrink-0 rounded-full shadow-sm ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 active:scale-95 sm:h-[16px] sm:w-[16px]"
              style={{ background: c.value }}
            />
          </Tooltip>
        ))}
        <Tooltip label="Custom color">
          <label className="flex h-[20px] w-[20px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-[var(--sb-text-faint)] text-[var(--sb-text-faint)] transition-colors hover:border-[var(--sb-text)] hover:text-[var(--sb-text)] sm:h-[16px] sm:w-[16px]">
            <Palette size={9} />
            <input type="color" onChange={(e) => onApplyColor(e.target.value)} className="sr-only" />
          </label>
        </Tooltip>
        <Tooltip label="Remove color from selected">
          <button
            type="button"
            onClick={() => onApplyColor(null)}
            className="text-[10.5px] font-medium text-[var(--sb-text-muted)] transition-colors hover:text-[var(--sb-text)]"
          >
            Clear
          </button>
        </Tooltip>
      </div>

      {enabled && (
        <button
          type="button"
          onClick={onDeselectAll}
          className="flex-shrink-0 text-[10.5px] font-medium text-[var(--sb-text-faint)] transition-colors hover:text-[var(--sb-text-muted)]"
        >
          Deselect
        </button>
      )}
    </div>
  );
}

// Lets you set (or clear) the color for every lot on a sheet in one
// click, from the sheets list — without drilling into the sheet and
// multi-selecting every lot individually. Shows a filled swatch if every
// lot on the sheet already shares one color, a dashed empty ring if none
// of them have a color yet, or a dashed ring with a dot if the sheet's
// lots currently have mixed colors. Clicking opens the same
// preset/custom/clear palette as the multi-select ColorToolbar, applied
// to every lot on the sheet at once.
//
// This stays as the fast one-off path for a SINGLE sheet. The new
// checkbox column + toolbar below (see sheetColorSelectedKeys in the main
// component) is the complementary BATCH path for coloring many sheets at
// once (e.g. every sheet that shows up after filtering to RFPA) — the two
// don't conflict, since this swatch always applies immediately to just
// its own row regardless of what's checked elsewhere.
function SheetColorSwatch({
  lotIds,
  currentColor,
  mixed,
  onApplyColor,
}: {
  lotIds: Array<string | number>;
  currentColor: string | null;
  mixed: boolean;
  onApplyColor: (lotIds: Array<string | number>, color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  function apply(color: string | null) {
    onApplyColor(lotIds, color);
    setOpen(false);
  }

  return (
    <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <Tooltip
        label={
          mixed
            ? "Lots have different colors — click to set one color for all"
            : "Color every lot on this sheet"
        }
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110"
          style={{
            background: currentColor && !mixed ? currentColor : "transparent",
            border: !currentColor || mixed ? "1.5px dashed var(--sb-text-faint)" : undefined,
          }}
        >
          {mixed && <span className="h-2 w-2 rounded-full" style={{ background: "var(--sb-text-faint)" }} />}
        </button>
      </Tooltip>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-30 mt-1 flex items-center gap-1.5 rounded-lg border p-1.5 shadow-lg"
            style={{ background: "var(--sb-bg-elevated)", borderColor: HAIRLINE }}
          >
            {COLOR_PRESETS.map((c) => (
              <Tooltip key={c.value} label={c.label}>
                <button
                  type="button"
                  onClick={() => apply(c.value)}
                  className="h-[18px] w-[18px] flex-shrink-0 rounded-full shadow-sm ring-1 ring-inset ring-black/10 transition-transform hover:scale-110"
                  style={{ background: c.value }}
                />
              </Tooltip>
            ))}
            <Tooltip label="Custom color">
              <label className="flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-[var(--sb-text-faint)] text-[var(--sb-text-faint)]">
                <Palette size={9} />
                <input type="color" onChange={(e) => apply(e.target.value)} className="sr-only" />
              </label>
            </Tooltip>
            <Tooltip label="Clear color">
              <button
                type="button"
                onClick={() => apply(null)}
                className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[var(--sb-text-faint)] hover:text-[var(--sb-text)]"
              >
                <X size={11} />
              </button>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}

export default function AttributeTable({
  features,
  loading,
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
  onUpdateDocumentsUrl,
  onUpdateSurveyClass,
}: Props) {
  const { vars } = useSidebarTheme();
  const [expandedSheetKey, setExpandedSheetKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const [colorSelectedIds, setColorSelectedIds] = useState<Set<string>>(new Set());

  // Sheet-level equivalent of colorSelectedIds above, keyed by SheetGroup
  // key (not lot id) — checking a sheet in the sheets-list view means
  // "apply the next color pick to every lot on this sheet", not to the
  // sheet row itself (sheets don't have their own color; only lots do).
  const [sheetColorSelectedKeys, setSheetColorSelectedKeys] = useState<Set<string>>(new Set());

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
      const sheetId = toSheetId(f.properties.sheetId);
      const key = sheetId != null ? `id:${sheetId}` : `no:${f.properties.sheetNo ?? "unsheeted"}`;
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
          sheetId,
          sheetNo: f.properties.sheetNo || "—",
          planUrl: f.properties.planUrl,
          documentsUrl: (f.properties as any).documentsUrl ?? null,
          surveyClass: (f.properties as any).surveyClass ?? null,
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
    const result = Array.from(map.values()).sort((a, b) => a.sheetNo.localeCompare(b.sheetNo));
    return result;
  }, [features]);

  useEffect(() => {
    if (expandedSheetKey && !sheetGroups.some((g) => g.key === expandedSheetKey)) {
      setExpandedSheetKey(null);
    }
  }, [expandedSheetKey, sheetGroups]);

  useEffect(() => {
    if (selectedId == null || isSearching) return;
    const idStr = String(selectedId);

    const currentGroup = expandedSheetKey ? sheetGroups.find((g) => g.key === expandedSheetKey) : null;
    if (currentGroup?.lots.some((f) => String(f.id) === idStr)) return;

    const owningGroup = sheetGroups.find((g) => g.lots.some((f) => String(f.id) === idStr));
    if (owningGroup) setExpandedSheetKey(owningGroup.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, isSearching, sheetGroups]);

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

  // Same pruning idea as colorSelectedIds above, but keyed against
  // sheetGroups instead of features — a checked sheet that no longer
  // exists in the current filter/selection (e.g. the Projection changed)
  // gets dropped instead of lingering as a phantom selection.
  useEffect(() => {
    setSheetColorSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const validKeys = new Set(sheetGroups.map((g) => g.key));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((k) => {
        if (validKeys.has(k)) next.add(k);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [sheetGroups]);

  function toggleColorSelect(id: string) {
    setColorSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  function toggleSheetColorSelect(key: string) {
    setSheetColorSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSheetColorSelectAll() {
    const allKeys = sheetGroups.map((g) => g.key);
    const allSelected = allKeys.length > 0 && allKeys.every((k) => sheetColorSelectedKeys.has(k));
    setSheetColorSelectedKeys(allSelected ? new Set() : new Set(allKeys));
  }

  // The actual feature: bulk-apply one color to every lot across every
  // CHECKED sheet in a single call — e.g. Project to RFPA, check every
  // sheet that shows up, pick a color once, instead of opening each sheet
  // and multi-selecting its lots individually.
  function applySheetColor(color: string | null) {
    if (!onSetLotColors || sheetColorSelectedKeys.size === 0) return;
    const ids: Array<string | number> = [];
    for (const g of sheetGroups) {
      if (sheetColorSelectedKeys.has(g.key)) {
        for (const f of g.lots) ids.push(f.id);
      }
    }
    onSetLotColors(ids, color);
  }

  const expandedSheet = expandedSheetKey ? sheetGroups.find((g) => g.key === expandedSheetKey) ?? null : null;

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
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin text-[var(--sb-text-faint)]" />
              <p className="text-[12.5px] font-medium text-[var(--sb-text)]">Loading lots…</p>
              <p className="text-[11.5px] text-[var(--sb-text-faint)]">This should only take a moment.</p>
            </>
          ) : (
            <>
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
            </>
          )}
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
          // MOBILE PASS: was a fixed w-[172px] that could overflow a narrow
          // viewport. Now fills the width it's given (full width on
          // mobile, where SummaryBar stacks this onto its own row) and
          // only reverts to a fixed 172px once there's room at `sm:`.
          <div className="relative flex min-w-0 w-full items-center sm:w-[172px]">
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
                className="w-full min-w-0 rounded-full text-[11.5px] font-normal outline-none transition-shadow focus:ring-2 focus:ring-[var(--sb-accent)]/30"
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

      {/*
        MOBILE PASS: this used to be a single `flex items-center` row that
        forced the sheet breadcrumb and the ColorToolbar onto the same
        line — on a phone-width viewport there simply isn't room for both,
        which is what caused the overlapping text in the "Sheets / ... to
        color" screenshot. Now it's `flex-col` (breadcrumb row, then
        toolbar row) below `sm:`, and goes back to the original
        single-row layout at `sm:` and up.
      */}
      {(isSearching || expandedSheet) && (
        <div
          className="flex flex-shrink-0 flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:py-1"
          style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-hover)" }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
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
                  {/* Municipality/province/encoder detail hidden below sm: — the
                      breadcrumb only needs the sheet number to stay usable on a
                      narrow screen; full detail comes back once there's room. */}
                  {/* <span className="hidden sm:inline">
                    {expandedSheet.municipality && ` — ${expandedSheet.municipality}, ${expandedSheet.province ?? ""}`}
                    {expandedSheet.encodedBy && ` · Encoded by ${expandedSheet.encodedBy}`}
                  </span> */}
                </span>

                {expandedSheet.planUrl && (
                  <>
                    {/* <span className="hidden flex-shrink-0 text-[var(--sb-text-faint)] sm:inline">·</span>
                    <span className="hidden flex-shrink-0 sm:inline">
                      <PlanLink url={expandedSheet.planUrl} label="Plan" />
                    </span> */}
                  </>
                )}
              </>
            ) : (
              <span className="text-[11.5px] font-medium text-[var(--sb-text-faint)]">Search results</span>
            )}
          </div>

          <ColorToolbar
            selectedCount={colorSelectedIds.size}
            onApplyColor={applyColor}
            onDeselectAll={() => setColorSelectedIds(new Set())}
            idleLabel="Tap lots to color"
          />
        </div>
      )}

      {/*
        Sheet-level color toolbar — only shown in the plain sheets-list
        view (not while searching or drilled into a sheet, which already
        have their own lot-level toolbar above) and only once at least one
        sheet is checked, so it doesn't take up space otherwise. Reuses
        the same ColorToolbar component as the lot-level one above; the
        only difference is what "selected" means (whole sheets, via
        sheetColorSelectedKeys) and what applying a color does
        (applySheetColor colors every lot on every checked sheet at once).
      */}
      {!isSearching && !expandedSheet && sheetColorSelectedKeys.size > 0 && (
        <div
          className="flex flex-shrink-0 flex-wrap items-center gap-3 px-3 py-2"
          style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-hover)" }}
        >
          <ColorToolbar
            selectedCount={sheetColorSelectedKeys.size}
            onApplyColor={applySheetColor}
            onDeselectAll={() => setSheetColorSelectedKeys(new Set())}
            idleLabel="Check sheets to color"
          />
        </div>
      )}

      {/*
        MOBILE PASS (scroll fix): previously this single div was
        `overflow-auto`, scrolling BOTH axes, and its height equaled the
        full rendered table (all rows), not the visible viewport. That
        meant the horizontal scrollbar/drag-track only became reachable
        once you'd scrolled all the way down to the bottom row — because
        that's genuinely where the bottom edge of this element was.
        SheetsTable/LotsTable also each wrapped their own <table> in a
        second `overflow-x-auto` div, so there were two nested horizontal
        scroll regions fighting each other.

        Fix: this outer div now owns ONLY horizontal scroll, and is
        pinned to the visible viewport height via `flex-1`/`min-h-0` from
        the parent flex column. A new inner div owns ONLY vertical scroll
        and is `h-full` (i.e. exactly the visible box, not the content
        height). So the horizontal scroll region is always exactly as
        tall as what's on screen — reachable from the top row, not just
        the bottom — and vertical scrolling of rows still works
        independently inside it. The redundant inner `overflow-x-auto`
        wrappers were removed from SheetsTable and LotsTable below.

        Explicit `touchAction` hints (added in the same pass) tell the
        browser upfront which axis each region owns, so a horizontal drag
        on the table is recognized immediately instead of the touch
        gesture defaulting to page scroll.
      */}
      <div
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}
      >
        <div
          className="h-full overflow-y-auto"
          style={{
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            touchAction: "pan-y",
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
              onUpdateDocumentsUrl={onUpdateDocumentsUrl}
              onUpdateSurveyClass={onUpdateSurveyClass}
              lotColors={lotColors}
              onSetLotColors={onSetLotColors}
              colorSelectedKeys={sheetColorSelectedKeys}
              onToggleColorSelect={toggleSheetColorSelect}
              onToggleColorSelectAll={toggleSheetColorSelectAll}
            />
          )}
        </div>
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

const SURVEY_CLASS_OPTIONS: SelectOption[] = [
  { value: "admin", label: "Admin" },
  { value: "private", label: "Private" },
];

function SheetsTable({
  groups,
  onOpenSheet,
  onViewSheet,
  onUpdatePlanUrl,
  onUpdateSurveyNo,
  onUpdateDocumentsUrl,
  onUpdateSurveyClass,
  lotColors,
  onSetLotColors,
  colorSelectedKeys,
  onToggleColorSelect,
  onToggleColorSelectAll,
}: {
  groups: SheetGroup[];
  onOpenSheet: (key: string) => void;
  onViewSheet?: (sheet: SheetPreviewRequest) => void;
  onUpdatePlanUrl?: (sheetId: number, planUrl: string) => Promise<void>;
  onUpdateSurveyNo?: (sheetId: number, surveyNo: string) => Promise<void>;
  onUpdateDocumentsUrl?: (sheetId: number, documentsUrl: string) => Promise<void>;
  onUpdateSurveyClass?: (sheetId: number, surveyClass: "admin" | "private") => Promise<void>;
  lotColors?: Record<string, string>;
  onSetLotColors?: (lotIds: Array<string | number>, color: string | null) => void;
  // Batch color-select state — a checked sheet means "include every lot
  // on this sheet the next time a color is applied from the toolbar
  // above", same purpose as colorSelectedIds/onToggleColorSelect in
  // LotsTable below, just scoped to whole sheets instead of individual
  // lots. Kept separate from the per-row SheetColorSwatch (Color column),
  // which still applies a color immediately to just its own sheet.
  colorSelectedKeys: Set<string>;
  onToggleColorSelect: (key: string) => void;
  onToggleColorSelectAll: () => void;
}) {
  const allSelected = groups.length > 0 && groups.every((g) => colorSelectedKeys.has(g.key));

  // MOBILE PASS (scroll fix): horizontal scrolling is now owned by the
  // grandparent wrapper in AttributeTable, so this no longer wraps itself
  // in its own `overflow-x-auto` div — that second scroll region was what
  // pinned the scrollbar to the bottom of the full row list instead of
  // the visible viewport. `min-w` on the table itself is unchanged and
  // still what forces horizontal scroll to kick in on narrow screens.
  return (
    <table className="w-full min-w-[920px] border-collapse text-[11.5px]">
      <thead>
        <tr>
          <th
            className="sticky top-0 z-10 w-9 px-2.5 py-[7px] backdrop-blur sm:w-7"
            style={{
              background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
              borderBottom: `1px solid ${HAIRLINE}`,
            }}
          >
            <Tooltip label={allSelected ? "Deselect all sheets" : "Select all sheets"}>
              <Checkbox checked={allSelected} onChange={onToggleColorSelectAll} />
            </Tooltip>
          </th>
          
          <Th>Color</Th>
          <Th>Sheet No.</Th>
          <Th>Municipality</Th>
          <Th>Province</Th>
          <Th>Plan</Th>
          <Th>Documents</Th>
          <Th>Survey No.</Th>
          <Th>Class</Th>
          <Th numeric>Lots</Th>
          <Th numeric>Total Area (sq.m.)</Th>
          <Th>Encoded By</Th>
          {onViewSheet && <Th>Preview</Th>}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, i) => {
          const isChecked = colorSelectedKeys.has(g.key);
          const baseBg = isChecked
            ? "var(--sb-accent-bg)"
            : i % 2 === 1
              ? "color-mix(in srgb, var(--sb-hover) 45%, transparent)"
              : "transparent";
          return (
            <tr
              key={g.key}
              onClick={() => onOpenSheet(g.key)}
              title="Click to view lots"
              className="cursor-pointer transition-colors duration-100"
              style={{
                borderBottom: `1px solid ${HAIRLINE_SOFT}`,
                background: baseBg,
              }}
              onMouseEnter={(e) => {
                if (isChecked) return;
                e.currentTarget.style.background = "var(--sb-hover)";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = baseBg)}
            >
              <td className="px-2.5 py-[6px]" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isChecked} onChange={() => onToggleColorSelect(g.key)} />
              </td>
                            <td className="px-2.5 py-[6px]" onClick={(e) => e.stopPropagation()}>
                {onSetLotColors
                  ? (() => {
                      const lotIds = g.lots.map((f) => f.id);
                      const colorsOnSheet = lotColors
                        ? Array.from(new Set(g.lots.map((f) => lotColors[String(f.id)]).filter(Boolean)))
                        : [];
                      return (
                        <SheetColorSwatch
                          lotIds={lotIds}
                          currentColor={colorsOnSheet.length === 1 ? colorsOnSheet[0] : null}
                          mixed={colorsOnSheet.length > 1}
                          onApplyColor={onSetLotColors}
                        />
                      );
                    })()
                  : "—"}
              </td>
              <td className="px-2.5 py-[6px] font-medium text-[var(--sb-text)]">{g.sheetNo}</td>

              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{g.municipality || "—"}</td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{g.province || "—"}</td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
                {g.planUrl ? (
                  <PlanLink url={g.planUrl} label="View" />
                ) : g.sheetId != null && onUpdatePlanUrl ? (
                  <InlineFieldControl
                    sheetId={g.sheetId}
                    kind="url"
                    triggerLabel="Add"
                    tooltip="Add a Google Drive link to this sheet's plan"
                    placeholder="Paste Google Drive link…"
                    inputWidth={168}
                    validate={(v) => (isTraceableGoogleDriveLink(v) ? null : PLAN_LINK_HELP_MESSAGE)}
                    onSave={onUpdatePlanUrl}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
                {g.documentsUrl ? (
                  <PlanLink url={g.documentsUrl} label="View" />
                ) : g.sheetId != null && onUpdateDocumentsUrl ? (
                  <InlineFieldControl
                    sheetId={g.sheetId}
                    kind="url"
                    triggerLabel="Add"
                    tooltip="Add a Google Drive link to this sheet's documents"
                    placeholder="Paste Google Drive link…"
                    inputWidth={168}
                    validate={(v) => (isTraceableGoogleDriveLink(v) ? null : PLAN_LINK_HELP_MESSAGE)}
                    onSave={onUpdateDocumentsUrl}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {g.surveyNo ? <span className="text-[var(--sb-text)]">{g.surveyNo}</span> : null}
                  {!g.surveyNo && g.sheetId != null && onUpdateSurveyNo ? (
                    <InlineFieldControl
                      sheetId={g.sheetId}
                      kind="text"
                      triggerLabel="Add"
                      tooltip="Set survey number"
                      placeholder="Survey number…"
                      inputWidth={120}
                      onSave={onUpdateSurveyNo}
                    />
                  ) : !g.surveyNo ? (
                    "—"
                  ) : null}
                </span>
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
                {g.surveyClass ? (
                  <SurveyClassBadge value={g.surveyClass} />
                ) : g.sheetId != null && onUpdateSurveyClass ? (
                  <InlineFieldControl
                    sheetId={g.sheetId}
                    kind="select"
                    triggerLabel="Set class"
                    tooltip="Set this sheet's survey class (admin or private)"
                    selectOptions={SURVEY_CLASS_OPTIONS}
                    onSave={(sheetId, value) => onUpdateSurveyClass(sheetId, value as "admin" | "private")}
                  />
                ) : (
                  "—"
                )}
              </td>
              <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">{g.lots.length}</td>
              <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
                {formatArea(g.totalArea)}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{g.encodedBy || "—"}</td>
              {onViewSheet && (
                <td className="px-2.5 py-[6px]" onClick={(e) => e.stopPropagation()}>
                  <Tooltip label="Lot Preview">
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
                      className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] border-0 bg-[var(--sb-accent-bg)] p-0 text-[var(--sb-accent-text)] transition-colors duration-100 hover:opacity-75"
                    >
                      <Eye size={12} />
                    </button>
                  </Tooltip>
                </td>
              )}
            </tr>
          );
        })}
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
  showSheetNo?: boolean;
  lotColors?: Record<string, string>;
  colorSelectedIds: Set<string>;
  onToggleColorSelect: (id: string) => void;
  onToggleColorSelectAll: () => void;
}) {
  const columns = showSheetNo ? ["Sheet No.", ...LOT_COLUMNS] : LOT_COLUMNS;
  const visibleIds = features.map((f) => String(f.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => colorSelectedIds.has(id));

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (selectedId == null) return;
    const el = rowRefs.current[String(selectedId)];
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, features]);

  // MOBILE PASS (scroll fix): same as SheetsTable — horizontal scroll is
  // now owned by the grandparent wrapper in AttributeTable, so the
  // per-table `overflow-x-auto` div was removed here too. `min-w` on the
  // table is unchanged.
  return (
    <table className="w-full min-w-[760px] border-collapse text-[11.5px]">
      <thead>
        <tr>
          <th
            className="sticky top-0 z-10 w-9 px-2.5 py-[7px] backdrop-blur sm:w-7"
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
              <td className="max-w-[140px] px-2.5 py-[6px] text-[var(--sb-text-muted)]">
                <Tooltip label={f.properties.owner || "—"}>
                  <span className="block max-w-[140px] cursor-help truncate">{f.properties.owner}</span>
                </Tooltip>
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.barangay}</td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.municipality}</td>
              <td className="whitespace-nowrap px-2.5 py-[6px] text-[var(--sb-text-muted)]">
                {formatDate(f.properties.dateSurveyed)}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.surveyor}</td>
              <td className="px-2.5 py-[6px] text-right tabular-nums text-[var(--sb-text-muted)]">
               {formatArea(f.properties.areaSqm)}
              </td>
              <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]">{f.properties.patentNo}</td>
              <td className="max-w-[160px] px-2.5 py-[6px] text-[var(--sb-text-muted)]">
                <Tooltip label={f.properties.remarks || "—"}>
                  <span className="block max-w-[160px] cursor-help truncate">{f.properties.remarks}</span>
                </Tooltip>
              </td>
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
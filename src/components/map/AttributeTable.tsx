"use client";

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LotFeature } from "@/lib/geo";
import { isTraceableGoogleDriveLink, PLAN_LINK_HELP_MESSAGE } from "@/lib/planLink";
import SummaryBar from "@/components/map/SummaryBar";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";
import { Table2, X, ChevronLeft, ExternalLink, Search, Palette, Check, Eye, Link2 } from "lucide-react";

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

function formatArea(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
      <Tooltip label="Set survey number">
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

function AddDocumentsLinkControl({
  sheetId,
  onSave,
}: {
  sheetId: number;
  onSave: (sheetId: number, documentsUrl: string) => Promise<void>;
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
      <Tooltip label="Add a Google Drive link to this sheet's documents">
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

function AddSurveyClassControl({
  sheetId,
  onSave,
}: {
  sheetId: number;
  onSave: (sheetId: number, surveyClass: "admin" | "private") => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<"admin" | "private">("private");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(sheetId, value);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save survey class.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Tooltip label="Set this sheet's survey class (admin or private)">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--sb-text-faint)] transition-colors hover:text-[var(--sb-accent)]"
        >
          Set class
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <select
        autoFocus
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value as "admin" | "private")}
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
        <option value="admin">Admin</option>
        <option value="private">Private</option>
      </select>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
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
  onUpdateDocumentsUrl,
  onUpdateSurveyClass,
}: Props) {
  const { vars } = useSidebarTheme();
  const [expandedSheetKey, setExpandedSheetKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const [colorSelectedIds, setColorSelectedIds] = useState<Set<string>>(new Set());

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

    // TEMP DEBUG — remove once the Survey No. button issue is confirmed fixed.
    console.log(
      "DEBUG sheetGroups:",
      result.map((g) => ({
        sheetNo: g.sheetNo,
        sheetId: g.sheetId,
        surveyNo: g.surveyNo,
        hasMissingSurveyNo: g.hasMissingSurveyNo,
      })),
      "onUpdateSurveyNo type:",
      typeof onUpdateSurveyNo
    );

    return result;
  }, [features, onUpdateSurveyNo]);

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

                {expandedSheet.planUrl && (
                  <>
                    <span className="flex-shrink-0 text-[var(--sb-text-faint)]">·</span>
                    <span className="flex-shrink-0">
                      <PlanLink url={expandedSheet.planUrl} label="Plan" />
                    </span>
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
          />
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{
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
            onUpdateDocumentsUrl={onUpdateDocumentsUrl}
            onUpdateSurveyClass={onUpdateSurveyClass}
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
  onUpdateDocumentsUrl,
  onUpdateSurveyClass,
}: {
  groups: SheetGroup[];
  onOpenSheet: (key: string) => void;
  onViewSheet?: (sheet: SheetPreviewRequest) => void;
  onUpdatePlanUrl?: (sheetId: number, planUrl: string) => Promise<void>;
  onUpdateSurveyNo?: (sheetId: number, surveyNo: string) => Promise<void>;
  onUpdateDocumentsUrl?: (sheetId: number, documentsUrl: string) => Promise<void>;
  onUpdateSurveyClass?: (sheetId: number, surveyClass: "admin" | "private") => Promise<void>;
}) {
  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead>
        <tr>
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
        {groups.map((g, i) => (
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
              {g.documentsUrl ? (
                <PlanLink url={g.documentsUrl} label="View" />
              ) : g.sheetId != null && onUpdateDocumentsUrl ? (
                <AddDocumentsLinkControl sheetId={g.sheetId} onSave={onUpdateDocumentsUrl} />
              ) : (
                "—"
              )}
            </td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {g.surveyNo ? <span className="text-[var(--sb-text)]">{g.surveyNo}</span> : null}
                {!g.surveyNo && g.sheetId != null && onUpdateSurveyNo ? (
                  <AddSurveyNoControl sheetId={g.sheetId} onSave={onUpdateSurveyNo} />
                ) : !g.surveyNo ? (
                  "—"
                ) : null}
              </span>
            </td>
            <td className="px-2.5 py-[6px] text-[var(--sb-text-muted)]" onClick={(e) => e.stopPropagation()}>
              {g.surveyClass ? (
                <span className="capitalize text-[var(--sb-text)]">{g.surveyClass}</span>
              ) : g.sheetId != null && onUpdateSurveyClass ? (
                <AddSurveyClassControl sheetId={g.sheetId} onSave={onUpdateSurveyClass} />
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
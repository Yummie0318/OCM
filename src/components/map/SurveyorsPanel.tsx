"use client";

// Target path: src/components/map/SurveyorsPanel.tsx
//
// "Surveyors" tab inside UsersModal (superadmin only). Talks to:
//   GET    /api/surveyors?counts=1     list (+ lot_count per surveyor)
//   POST   /api/surveyors              create { name, position }
//   PATCH  /api/surveyors/[id]         edit   { name, position }
//   DELETE /api/surveyors/[id]         delete (409 when lots still use it)
//
// UI: search + "Add" button on top. Add opens a compact <SubDialog> over the
// list (same as Add user). Each surveyor is a card (initials avatar,
// position, lot-count pill) with inline edit and an inline delete
// confirmation.
//
// Escape: while the add dialog, an inline edit, or a delete confirmation is
// open, this panel reports `onEscapeCaptureChange(true)` so UsersModal leaves
// Escape alone, and this panel closes the top-most layer itself.

import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, Plus, Pencil, Trash2, Check, Loader2, Ruler } from "lucide-react";
import { useSidebarTheme } from "./SidebarThemeContext";
import { toast } from "@/components/notifications/Toaster";
import SubDialog from "./SubDialog";

interface SurveyorRow {
  id: number;
  name: string;
  position: string;
  lot_count?: number;
}

const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";
const DEFAULT_POSITION = "GEODETIC ENGINEER";

const btnBase = "border-0 p-0 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";

const inputCls =
  "w-full min-w-0 rounded-[10px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-3 py-2 text-[13px] text-[var(--sb-text)] outline-none transition-all placeholder:text-[var(--sb-text-faint)] focus:border-[var(--sb-accent)] focus:ring-4 focus:ring-[var(--sb-accent)]/10";

// "FELISA F. ANDRESS" -> "FA", "PIO KITAYAN" -> "PK"
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`${btnBase} flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] bg-transparent hover:bg-[var(--sb-hover)] ${
        danger ? "text-red-500" : "text-[var(--sb-text-muted)] hover:text-[var(--sb-text)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function SurveyorsPanel({
  onBusyChange,
  onCountChange,
  onEscapeCaptureChange,
}: {
  onBusyChange?: (busy: boolean) => void;
  onCountChange?: (count: number) => void;
  onEscapeCaptureChange?: (capturing: boolean) => void;
}) {
  const { theme } = useSidebarTheme();

  const [rows, setRows] = useState<SurveyorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // add dialog
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState(DEFAULT_POSITION);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPosition, setDraftPosition] = useState("");

  // inline delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // row currently saving / deleting
  const [busyId, setBusyId] = useState<number | null>(null);

  const busy = adding || busyId !== null;
  const capturesEscape = showAdd || editingId !== null || confirmDeleteId !== null;

  // Tell the modal a request is in flight so it can't be dismissed mid-save.
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  // Tell the modal when this panel has a layer on top that should take Escape.
  useEffect(() => {
    onEscapeCaptureChange?.(capturesEscape);
  }, [capturesEscape, onEscapeCaptureChange]);
  useEffect(() => {
    return () => onEscapeCaptureChange?.(false);
  }, [onEscapeCaptureChange]);

  // Escape closes the top-most layer: add dialog, then delete confirmation,
  // then inline edit.
  useEffect(() => {
    if (!capturesEscape) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || busy) return;
      if (showAdd) setShowAdd(false);
      else if (confirmDeleteId !== null) setConfirmDeleteId(null);
      else setEditingId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturesEscape, busy, showAdd, confirmDeleteId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/surveyors?counts=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load surveyors.");
      const list: SurveyorRow[] = Array.isArray(data) ? data : data.surveyors ?? [];
      setRows(list);
      onCountChange?.(list.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load surveyors.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.position.toLowerCase().includes(q));
  }, [rows, search]);

  function openAdd() {
    setNewName("");
    setNewPosition(DEFAULT_POSITION);
    setAddError(null);
    setShowAdd(true);
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    const name = newName.trim().toUpperCase();
    const position = newPosition.trim().toUpperCase();
    if (!name || !position) {
      setAddError("Name and position are required.");
      return;
    }
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/surveyors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, position }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't add surveyor.");
      toast.success("Surveyor added", { description: `${name} is now available in the lot form.` });
      setShowAdd(false);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't add surveyor.";
      setAddError(msg);
      toast.error("Couldn't add surveyor", { description: msg });
    } finally {
      setAdding(false);
    }
  }

  function startEdit(r: SurveyorRow) {
    setConfirmDeleteId(null);
    setEditingId(r.id);
    setDraftName(r.name);
    setDraftPosition(r.position);
    setError(null);
  }

  async function saveEdit(r: SurveyorRow) {
    if (busyId !== null) return;
    const name = draftName.trim().toUpperCase();
    const position = draftPosition.trim().toUpperCase();
    if (!name || !position) {
      setError("Name and position are required.");
      return;
    }
    if (name === r.name && position === r.position) {
      setEditingId(null);
      toast.info("No changes to save");
      return;
    }
    setError(null);
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/surveyors/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, position }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update surveyor.");
      toast.success("Surveyor updated", { description: `${name} was saved.` });
      setEditingId(null);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't update surveyor.";
      setError(msg);
      toast.error("Couldn't update surveyor", { description: msg });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(r: SurveyorRow) {
    setError(null);
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/surveyors/${r.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't delete surveyor.");
      toast.success("Surveyor deleted", { description: `${r.name} was removed.` });
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete surveyor.";
      setError(msg);
      toast.error("Couldn't delete surveyor", { description: msg });
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  }

  // Enter saves. (Escape is handled by the window listener above.)
  function editKeyDown(e: ReactKeyboardEvent<HTMLInputElement>, r: SurveyorRow) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(r);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: search + Add */}
      <div className="flex flex-shrink-0 items-center gap-2 px-5 pt-3">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sb-text-faint)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or position…"
            className={`${inputCls} !rounded-full !py-[7px] !pl-8 !text-[12.5px]`}
          />
        </div>
        <button
          type="button"
          onClick={openAdd}
          className={`${btnBase} flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
          style={{ background: theme.accent, color: theme.onAccent }}
        >
          <Plus size={13} />
          <span className="sm:hidden">Add</span>
          <span className="hidden sm:inline">Add surveyor</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-5 mt-3 flex-shrink-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
          style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}
        >
          {error}
        </div>
      )}

      {/* List */}
      <ul className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-3 sm:px-5">
        {loading && rows.length === 0 && (
          <li className="py-12 text-center text-[var(--sb-text-faint)]">
            <Loader2 size={16} className="mx-auto animate-spin" />
          </li>
        )}

        {!loading && filtered.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "var(--sb-hover)", color: "var(--sb-text-faint)" }}
            >
              <Ruler size={17} />
            </span>
            <span className="text-[12.5px] text-[var(--sb-text-faint)]">
              {rows.length === 0 ? "No surveyors yet." : "No surveyors match your search."}
            </span>
          </li>
        )}

        {filtered.map((r) => {
          const editing = editingId === r.id;
          const confirming = confirmDeleteId === r.id;
          const rowBusy = busyId === r.id;
          const inUse = (r.lot_count ?? 0) > 0;

          return (
            <li
              key={r.id}
              className={`mb-1.5 rounded-[12px] border px-3 py-2.5 transition-colors ${
                editing ? "" : "hover:bg-[var(--sb-hover)]"
              }`}
              style={{
                borderColor: editing ? "var(--sb-accent)" : HAIRLINE_SOFT,
                background: editing ? "color-mix(in srgb, var(--sb-accent) 6%, transparent)" : undefined,
              }}
            >
              {editing ? (
                <div className="flex flex-col gap-2.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      className={inputCls}
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => editKeyDown(e, r)}
                      maxLength={150}
                      disabled={rowBusy}
                      aria-label="Name"
                      placeholder="Name"
                      autoFocus
                    />
                    <input
                      className={inputCls}
                      value={draftPosition}
                      onChange={(e) => setDraftPosition(e.target.value)}
                      onKeyDown={(e) => editKeyDown(e, r)}
                      maxLength={100}
                      disabled={rowBusy}
                      aria-label="Position"
                      placeholder="Position"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={rowBusy}
                      className={`${btnBase} rounded-full bg-[var(--sb-hover)] px-3.5 py-[6px] text-[12px] font-semibold text-[var(--sb-text)] hover:opacity-80`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(r)}
                      disabled={rowBusy}
                      className={`${btnBase} flex items-center gap-1.5 rounded-full px-3.5 py-[6px] text-[12px] font-semibold shadow-sm hover:opacity-90`}
                      style={{ background: theme.accent, color: theme.onAccent }}
                    >
                      {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold"
                      style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}
                    >
                      {initials(r.name)}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{r.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[11px] text-[var(--sb-text-faint)]">{r.position}</span>
                        {r.lot_count !== undefined && (
                          <span
                            className="inline-flex items-center rounded-full px-1.5 py-[1px] text-[10px] font-bold tabular-nums"
                            style={{
                              background: inUse ? "var(--sb-accent-bg)" : "var(--sb-hover)",
                              color: inUse ? "var(--sb-accent-text)" : "var(--sb-text-faint)",
                            }}
                          >
                            {r.lot_count} {r.lot_count === 1 ? "lot" : "lots"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center">
                      {rowBusy ? (
                        <Loader2 size={14} className="mx-2 animate-spin text-[var(--sb-text-faint)]" />
                      ) : (
                        <>
                          <IconBtn label="Edit surveyor" onClick={() => startEdit(r)} disabled={busy}>
                            <Pencil size={13} />
                          </IconBtn>
                          <IconBtn
                            label={inUse ? "In use by lots — can't delete" : "Delete surveyor"}
                            onClick={() => setConfirmDeleteId(r.id)}
                            disabled={busy || inUse}
                            danger
                          >
                            <Trash2 size={13} />
                          </IconBtn>
                        </>
                      )}
                    </div>
                  </div>

                  {confirming && (
                    <div
                      className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[9px] px-2.5 py-2"
                      style={{ background: "rgba(239, 68, 68, 0.08)" }}
                    >
                      <span className="text-[12px] font-medium text-red-500">Delete {r.name}? This can&apos;t be undone.</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={rowBusy}
                          className={`${btnBase} rounded-full bg-[var(--sb-hover)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r)}
                          disabled={rowBusy}
                          className={`${btnBase} flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-[5px] text-[11.5px] font-semibold text-white hover:opacity-90`}
                        >
                          {rowBusy && <Loader2 size={11} className="animate-spin" />}
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer summary */}
      {rows.length > 0 && (
        <div
          className="flex-shrink-0 px-5 py-2.5 text-[11px] text-[var(--sb-text-faint)]"
          style={{ borderTop: `1px solid ${HAIRLINE_SOFT}` }}
        >
          {search.trim()
            ? `${filtered.length} of ${rows.length} surveyors`
            : `${rows.length} surveyor${rows.length === 1 ? "" : "s"}`}
          {" · "}Surveyors assigned to lots can&apos;t be deleted.
        </div>
      )}

      {/* Add surveyor — compact dialog over the list */}
      {showAdd && (
        <SubDialog
          title="Add surveyor"
          subtitle="Appears in the Surveyor dropdown of the lot form"
          onClose={() => setShowAdd(false)}
          locked={adding}
        >
          <form onSubmit={handleAdd} noValidate className="flex flex-col gap-3.5 px-4 py-4">
            {addError && (
              <div
                role="alert"
                className="rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
                style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}
              >
                {addError}
              </div>
            )}

            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Name</span>
              <input
                className={inputCls}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="JUAN D. DELA CRUZ"
                maxLength={150}
                disabled={adding}
                autoComplete="off"
                autoFocus
              />
            </label>

            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Position</span>
              <input
                className={inputCls}
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                maxLength={100}
                disabled={adding}
                autoComplete="off"
              />
            </label>

            <p className="text-[11px] leading-snug text-[var(--sb-text-faint)]">Saved in capital letters.</p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                disabled={adding}
                className={`${btnBase} rounded-full bg-[var(--sb-hover)] px-4 py-2 text-[12.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding}
                className={`${btnBase} flex items-center gap-2 rounded-full px-5 py-2 text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
                style={{ background: theme.accent, color: theme.onAccent }}
              >
                {adding && <Loader2 size={13} className="animate-spin" />}
                Add surveyor
              </button>
            </div>
          </form>
        </SubDialog>
      )}
    </div>
  );
}
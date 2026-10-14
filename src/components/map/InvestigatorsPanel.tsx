"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Search, Plus, Pencil, Trash2, Loader2, UserCheck } from "lucide-react";
import { useSidebarTheme } from "./SidebarThemeContext";
import { toast } from "@/components/notifications/Toaster";
import SubDialog from "./SubDialog";
import ConfirmDialog from "./ConfirmDialog";

interface Row {
  id: number;
  name: string;
  lot_count: number;
}

type Dialog =
  | { kind: "none" }
  | { kind: "form"; row: Row | null }
  | { kind: "delete"; row: Row };

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 75%, transparent)";
const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";
const btnBase = "border-0 p-0 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";
const inputCls =
  "w-full min-w-0 rounded-[10px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-3 py-2 text-[13px] text-[var(--sb-text)] outline-none transition-all placeholder:text-[var(--sb-text-faint)] focus:border-[var(--sb-accent)] focus:ring-4 focus:ring-[var(--sb-accent)]/10";

export default function InvestigatorsPanel({
  onBusyChange,
  onCountChange,
  onEscapeCaptureChange,
}: {
  onBusyChange?: (busy: boolean) => void;
  onCountChange?: (count: number) => void;
  onEscapeCaptureChange?: (capturing: boolean) => void;
}) {
  const { theme } = useSidebarTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/investigators?counts=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load investigators.");
      setRows(data);
      onCountChange?.(data.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load investigators.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [saving, onBusyChange]);

  useEffect(() => {
    onEscapeCaptureChange?.(dialog.kind !== "none");
    return () => onEscapeCaptureChange?.(false);
  }, [dialog.kind, onEscapeCaptureChange]);

  // Escape closes this panel's own dialog first.
  useEffect(() => {
    if (dialog.kind === "none") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) setDialog({ kind: "none" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog.kind, saving]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  function openForm(row: Row | null) {
    setName(row?.name ?? "");
    setFormError(null);
    setDialog({ kind: "form", row });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (dialog.kind !== "form") return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Name is required.");
      return;
    }
    const editing = dialog.row;
    if (editing && trimmed.toUpperCase() === editing.name) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(editing ? `/api/investigators/${editing.id}` : "/api/investigators", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save.");
      toast.success(editing ? "Investigator updated" : "Investigator added", {
        description: data.investigator?.name,
      });
      setDialog({ kind: "none" });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Row) {
    setSaving(true);
    try {
      const res = await fetch(`/api/investigators/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't delete.");
      toast.success("Investigator deleted", { description: row.name });
      setDialog({ kind: "none" });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete.";
      toast.error("Couldn't delete investigator", { description: msg });
      setError(msg);
      setDialog({ kind: "none" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="flex flex-shrink-0 items-center gap-2 px-5 py-3"
        style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}` }}
      >
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sb-text-faint)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search investigator…"
            className={`${inputCls} !rounded-full !py-[7px] !pl-8 !text-[12.5px]`}
          />
        </div>
        <button
          type="button"
          onClick={() => openForm(null)}
          className={`${btnBase} flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
          style={{ background: theme.accent, color: theme.onAccent }}
        >
          <Plus size={13} />
          Add
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

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12px]">
          <thead>
            <tr>
              {["Name", "Lots", ""].map((h, i) => (
                <th
                  key={h || "actions"}
                  className={`sticky top-0 z-10 whitespace-nowrap px-4 py-2 font-semibold uppercase backdrop-blur ${i === 1 ? "text-right" : "text-left"}`}
                  style={{
                    background: "color-mix(in srgb, var(--sb-hover) 92%, transparent)",
                    borderBottom: `1px solid ${HAIRLINE}`,
                    fontSize: "10px",
                    letterSpacing: "0.05em",
                    color: "var(--sb-text-muted)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-[var(--sb-text-faint)]">
                  <Loader2 size={16} className="mx-auto animate-spin" />
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-[12.5px] text-[var(--sb-text-faint)]">
                  {rows.length === 0 ? "No investigators yet." : "No investigators match your search."}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}` }}>
                <td className="px-4 py-2.5 font-semibold">{r.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[var(--sb-text-muted)]">{r.lot_count}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      title="Edit"
                      aria-label="Edit"
                      onClick={() => openForm(r)}
                      className={`${btnBase} flex h-7 w-7 items-center justify-center rounded-[8px] bg-transparent text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      title={r.lot_count > 0 ? "In use, can't delete" : "Delete"}
                      aria-label="Delete"
                      disabled={r.lot_count > 0}
                      onClick={() => setDialog({ kind: "delete", row: r })}
                      className={`${btnBase} flex h-7 w-7 items-center justify-center rounded-[8px] bg-transparent text-red-500 hover:bg-[var(--sb-hover)]`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog.kind === "form" && (
        <SubDialog
          title={dialog.row ? "Edit investigator" : "Add investigator"}
          subtitle={dialog.row ? dialog.row.name : "Shown in the Investigator dropdown of the lot form"}
          onClose={() => setDialog({ kind: "none" })}
          locked={saving}
        >
          <form onSubmit={submit} noValidate className="flex flex-col gap-3.5 px-4 py-4">
            {formError && (
              <div
                role="alert"
                className="rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
                style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}
              >
                {formError}
              </div>
            )}
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-[var(--sb-text-muted)]">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                autoFocus
                autoComplete="off"
                disabled={saving}
                className={inputCls}
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialog({ kind: "none" })}
                disabled={saving}
                className={`${btnBase} rounded-full bg-[var(--sb-hover)] px-4 py-2 text-[12.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`${btnBase} flex items-center gap-2 rounded-full px-5 py-2 text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
                style={{ background: theme.accent, color: theme.onAccent }}
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {dialog.row ? "Save changes" : "Add investigator"}
              </button>
            </div>
          </form>
        </SubDialog>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete investigator?"
          tone="danger"
          icon={<Trash2 size={18} />}
          confirmLabel="Delete"
          busy={saving}
          onCancel={() => setDialog({ kind: "none" })}
          onConfirm={() => remove(dialog.row)}
          subject={
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}
              >
                <UserCheck size={15} />
              </span>
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">{dialog.row.name}</div>
            </div>
          }
        >
          This investigator is not used by any lot and will be removed permanently.
        </ConfirmDialog>
      )}
    </>
  );
}
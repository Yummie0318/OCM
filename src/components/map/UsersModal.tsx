"use client";

// Target path: src/components/map/UsersModal.tsx
//
// Superadmin-only user management modal, opened from the account menu in
// Sidebar.tsx (see onOpenUserManagement). Talks to:
//   GET   /api/users                      list + assignableRoles
//   POST  /api/users                      create (returns temporaryPassword once)
//   PATCH /api/users/[id]                 edit / activate / deactivate / change role
//   POST  /api/users/[id]/reset-password  new temporary password (returned once)
//
// The server enforces every rule (last-superadmin guard, no self-demotion,
// etc.); this UI just surfaces the server's error messages.
//
// Portaled to <body>, so the theme CSS variables are re-applied on its own
// root via `vars` from useSidebarTheme().

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  UserPlus,
  Pencil,
  KeyRound,
  Power,
  Copy,
  Check,
  Loader2,
  ArrowLeft,
  ShieldAlert,
} from "lucide-react";
import { useSidebarTheme } from "./SidebarThemeContext";
import { uiFont } from "./sidebarTheme";

type Role = "superadmin" | "admin" | "surveyor" | "user";

interface UserRow {
  id: number;
  username: string;
  email: string;
  usertype: Role;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  created_by_username: string | null;
}

type View =
  | { kind: "list" }
  | { kind: "form"; user: UserRow | null } // user === null -> create
  | { kind: "credentials"; username: string; password: string; reason: "created" | "reset" };

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 75%, transparent)";
const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";

// Defensive `border-0 p-0`: globals.css has an unscoped `button` rule that
// can outrank Tailwind utilities (same reason Sidebar.tsx sets these).
const btnBase = "border-0 p-0 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";

const inputCls =
  "w-full rounded-[10px] border border-[var(--sb-border)] bg-[var(--sb-bg)] px-3 py-2 text-[13px] text-[var(--sb-text)] outline-none transition-all placeholder:text-[var(--sb-text-faint)] focus:border-[var(--sb-accent)] focus:ring-4 focus:ring-[var(--sb-accent)]/10";

const ROLE_STYLE: Record<Role, { bg: string; fg: string; label: string }> = {
  superadmin: { bg: "rgba(239, 68, 68, 0.14)", fg: "#ef4444", label: "Super admin" },
  admin: { bg: "rgba(59, 130, 246, 0.14)", fg: "#3b82f6", label: "Admin" },
  surveyor: { bg: "rgba(245, 158, 11, 0.16)", fg: "#d97706", label: "Surveyor" },
  user: { bg: "rgba(148, 163, 184, 0.2)", fg: "var(--sb-text-muted)", label: "User" },
};

function RoleBadge({ role }: { role: Role }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.user;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-bold uppercase tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
      className={`${btnBase} flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] bg-transparent hover:bg-[var(--sb-hover)] ${
        danger ? "text-red-500" : "text-[var(--sb-text-muted)] hover:text-[var(--sb-text)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function UsersModal({
  open,
  onClose,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  currentUserId?: number;
}) {
  const { vars, theme } = useSidebarTheme();
  const [mounted, setMounted] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [view, setView] = useState<View>({ kind: "list" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load users.");
      setUsers(data.users);
      setRoles(data.assignableRoles);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Couldn't load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fresh state + fresh data every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setView({ kind: "list" });
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setListError(null);
    load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (view.kind === "list") onClose();
      else setView({ kind: "list" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view.kind, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.usertype !== roleFilter) return false;
      if (statusFilter === "active" && !u.is_active) return false;
      if (statusFilter === "disabled" && u.is_active) return false;
      if (q && !u.username.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  async function toggleActive(u: UserRow) {
    const verb = u.is_active ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${verb} ${u.username}?${u.is_active ? " They will be blocked from signing in." : ""}`)) return;
    setBusyId(u.id);
    setListError(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't update user.");
      await load();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Couldn't update user.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(u: UserRow) {
    if (!window.confirm(`Reset the password for ${u.username}? Their current password will stop working.`)) return;
    setBusyId(u.id);
    setListError(null);
    try {
      const res = await fetch(`/api/users/${u.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't reset password.");
      setCopied(false);
      setView({ kind: "credentials", username: u.username, password: data.temporaryPassword, reason: "reset" });
      load();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Couldn't reset password.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyPassword(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — the password is still selectable on screen.
    }
  }

  if (!mounted || !open) return null;

  const title =
    view.kind === "list"
      ? "User management"
      : view.kind === "form"
        ? view.user
          ? "Edit user"
          : "Add user"
        : view.reason === "created"
          ? "User created"
          : "Password reset";

  return createPortal(
    <div
      style={vars}
      className={`${uiFont.className} fixed inset-0 z-[100] flex items-center justify-center p-3 antialiased sm:p-6`}
    >
      <div className="absolute inset-0" style={{ background: theme.overlayBg }} onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[88dvh] w-full max-w-[940px] flex-col overflow-hidden rounded-[18px] text-[var(--sb-text)]"
        style={{ background: "var(--sb-bg-elevated)", boxShadow: "var(--sb-shadow)", border: `1px solid ${HAIRLINE}` }}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          {view.kind !== "list" && (
            <IconBtn label="Back to users" onClick={() => setView({ kind: "list" })}>
              <ArrowLeft size={15} />
            </IconBtn>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold tracking-tight">{title}</h2>
            {view.kind === "list" && (
              <p className="text-[11.5px] text-[var(--sb-text-faint)]">
                {loading ? "Loading…" : `${filtered.length} of ${users.length} user${users.length === 1 ? "" : "s"}`}
              </p>
            )}
          </div>
          {view.kind === "list" && (
            <button
              type="button"
              onClick={() => setView({ kind: "form", user: null })}
              className={`${btnBase} flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
              style={{ background: theme.accent, color: theme.onAccent }}
            >
              <UserPlus size={13} />
              Add user
            </button>
          )}
          <IconBtn label="Close" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>

        {/* Body */}
        {view.kind === "list" && (
          <>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}` }}>
              <div className="relative min-w-[180px] flex-1">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sb-text-faint)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search username or email…"
                  className={`${inputCls} !rounded-full !py-[7px] !pl-8 !text-[12.5px]`}
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "all" | Role)}
                className={`${inputCls} !w-auto !rounded-full !py-[7px] !text-[12.5px]`}
              >
                <option value="all">All roles</option>
                <option value="superadmin">Super admin</option>
                <option value="admin">Admin</option>
                <option value="surveyor">Surveyor</option>
                <option value="user">User</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "disabled")}
                className={`${inputCls} !w-auto !rounded-full !py-[7px] !text-[12.5px]`}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {listError && (
              <div
                role="alert"
                className="mx-5 mt-3 flex-shrink-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
                style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}
              >
                {listError}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-[12px]">
                <thead>
                  <tr>
                    {["User", "Role", "Status", "Last login", "Created by", ""].map((h) => (
                      <th
                        key={h || "actions"}
                        className="sticky top-0 z-10 whitespace-nowrap px-4 py-2 text-left font-semibold uppercase backdrop-blur"
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
                  {loading && users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-[var(--sb-text-faint)]">
                        <Loader2 size={16} className="mx-auto animate-spin" />
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-[12.5px] text-[var(--sb-text-faint)]">
                        No users match your filters.
                      </td>
                    </tr>
                  )}
                  {filtered.map((u) => {
                    const isSelf = u.id === currentUserId;
                    const busy = busyId === u.id;
                    return (
                      <tr key={u.id} style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}`, opacity: u.is_active ? 1 : 0.6 }}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold">{u.username}</span>
                            {isSelf && (
                              <span
                                className="rounded-full px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide"
                                style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}
                              >
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--sb-text-faint)]">{u.email}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <RoleBadge role={u.usertype} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: u.is_active ? "#22c55e" : "var(--sb-text-faint)" }}
                            />
                            {u.is_active ? "Active" : "Disabled"}
                          </span>
                          {u.must_change_password && (
                            <div className="text-[10.5px] text-amber-500">Must change password</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[var(--sb-text-muted)]">
                          {formatDateTime(u.last_login_at)}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--sb-text-muted)]">{u.created_by_username || "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-0.5">
                            {busy ? (
                              <Loader2 size={14} className="mr-2 animate-spin text-[var(--sb-text-faint)]" />
                            ) : (
                              <>
                                <IconBtn label="Edit user" onClick={() => setView({ kind: "form", user: u })}>
                                  <Pencil size={13} />
                                </IconBtn>
                                <IconBtn label="Reset password" onClick={() => resetPassword(u)} disabled={isSelf}>
                                  <KeyRound size={13} />
                                </IconBtn>
                                <IconBtn
                                  label={u.is_active ? "Deactivate" : "Reactivate"}
                                  onClick={() => toggleActive(u)}
                                  disabled={isSelf}
                                  danger={u.is_active}
                                >
                                  <Power size={13} />
                                </IconBtn>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {view.kind === "form" && (
          <UserForm
            key={view.user?.id ?? "new"}
            user={view.user}
            roles={roles}
            isSelf={view.user?.id === currentUserId}
            onCancel={() => setView({ kind: "list" })}
            onDone={(r) => {
              load();
              if (r.temporaryPassword) {
                setCopied(false);
                setView({ kind: "credentials", username: r.username, password: r.temporaryPassword, reason: "created" });
              } else {
                setView({ kind: "list" });
              }
            }}
          />
        )}

        {view.kind === "credentials" && (
          <div className="flex flex-col gap-4 overflow-auto px-5 py-6">
            <div
              className="flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-[12.5px]"
              style={{ background: "rgba(245, 158, 11, 0.1)", borderColor: "rgba(245, 158, 11, 0.4)", color: "var(--sb-text)" }}
            >
              <ShieldAlert size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />
              <span>
                This temporary password is shown <strong>only once</strong>. Copy it and share it with the user
                securely. They&apos;ll be asked to choose a new password the first time they sign in.
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[var(--sb-text-muted)]">Username</div>
                <div className={`${inputCls} font-mono`}>{view.username}</div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[var(--sb-text-muted)]">Temporary password</div>
                <div className="flex items-center gap-2">
                  <div className={`${inputCls} select-all font-mono`}>{view.password}</div>
                  <button
                    type="button"
                    onClick={() => copyPassword(view.password)}
                    className={`${btnBase} flex h-[38px] flex-shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[12px] font-semibold hover:opacity-90`}
                    style={{ background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setView({ kind: "list" })}
                className={`${btnBase} rounded-full px-5 py-2 text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
                style={{ background: theme.accent, color: theme.onAccent }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ---------------- Create / edit form ----------------

function UserForm({
  user,
  roles,
  isSelf,
  onCancel,
  onDone,
}: {
  user: UserRow | null;
  roles: Role[];
  isSelf: boolean;
  onCancel: () => void;
  onDone: (result: { username: string; temporaryPassword?: string }) => void;
}) {
  const { theme } = useSidebarTheme();
  const editing = user !== null;
  const roleOptions = roles.length > 0 ? roles : (["user"] as Role[]);

  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.usertype ?? (roleOptions.includes("user") ? "user" : roleOptions[0]));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !email.trim()) {
      setError("Username and email are required.");
      return;
    }

    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/users/${user.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: username.trim(),
              email: email.trim(),
              ...(role !== user.usertype ? { usertype: role } : {}),
            }),
          })
        : await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username.trim(), email: email.trim(), usertype: role }),
          });
      const data = await res.json();
      if (!res.ok) {
        // PATCH answers 400 "Nothing to update." when nothing changed — not really an error here.
        if (editing && data.error === "Nothing to update.") {
          onDone({ username: username.trim() });
          return;
        }
        throw new Error(data.error || "Something went wrong.");
      }
      onDone({ username: username.trim(), temporaryPassword: data.temporaryPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 overflow-auto px-5 py-6">
      {error && (
        <div
          role="alert"
          className="rounded-[10px] border px-3 py-2 text-[12.5px] font-medium"
          style={{ background: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.35)", color: "#ef4444" }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={50}
            autoComplete="off"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            className={inputCls}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 sm:max-w-[50%]">
        <span className="text-[12px] font-semibold">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={isSelf}
          className={`${inputCls} disabled:opacity-60`}
        >
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {ROLE_STYLE[r].label}
            </option>
          ))}
        </select>
        {isSelf && <span className="text-[11px] text-[var(--sb-text-faint)]">You can&apos;t change your own role.</span>}
      </label>

      {!editing && (
        <p className="text-[11.5px] text-[var(--sb-text-faint)]">
          A temporary password will be generated for you to hand over. The user must change it at first sign-in.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
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
          {editing ? "Save changes" : "Create user"}
        </button>
      </div>
    </form>
  );
}
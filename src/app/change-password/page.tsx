"use client";

// Target path: src/app/change-password/page.tsx
//
// Shown right after login when the account has must_change_password = true
// (temporary password set by a superadmin/admin). Also usable voluntarily.
// Not in middleware's PUBLIC_PATHS, so it requires a valid session.

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Lock, LoaderCircle } from "lucide-react";
import { uiFont } from "@/components/map/sidebarTheme";
import { SidebarThemeProvider, useSidebarTheme } from "@/components/map/SidebarThemeContext";

export default function ChangePasswordPageWrapper() {
  return (
    <SidebarThemeProvider>
      <ChangePasswordPage />
    </SidebarThemeProvider>
  );
}

function ChangePasswordPage() {
  const { vars, theme, darkMode } = useSidebarTheme();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Fill in all three fields.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      // Full reload so /map re-reads /api/auth/me with the flag cleared.
      window.location.href = "/map";
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  const fieldClass =
    "flex items-center gap-2 rounded-[10px] border border-[var(--sb-border)] px-3 py-3 transition-all focus-within:border-[var(--sb-accent)] focus-within:ring-4 focus-within:ring-[var(--sb-accent)]/10 sm:py-2.5";
  const inputClass =
    "w-full border-0 bg-transparent p-0 text-[15px] text-[var(--sb-text)] outline-none placeholder:text-[var(--sb-text-faint)] sm:text-[13.5px]";

  return (
    <div
      style={vars}
      className={`${uiFont.className} relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[var(--sb-bg)] px-4 py-10 antialiased`}
    >
      <div
        className="relative w-full max-w-[380px] rounded-[20px] bg-[var(--sb-bg-elevated)] p-7 sm:p-8"
        style={{ boxShadow: "var(--sb-shadow)" }}
      >
        <div className="flex flex-col items-center text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[12px]"
            style={{ background: `linear-gradient(135deg, #6366f1, ${theme.accent})`, color: theme.onAccent }}
          >
            <Lock size={18} />
          </div>
          <h1 className="mt-4 text-[20px] font-bold tracking-tight text-[var(--sb-text)]">
            Set a new password
          </h1>
          <p className="mt-1 text-[12.5px] text-[var(--sb-text-faint)]">
            Replace your temporary password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
          {error && (
            <div
              role="alert"
              className="rounded-[10px] border px-3 py-2.5 text-[12.5px] font-medium"
              style={{
                background: darkMode ? "rgba(239, 68, 68, 0.12)" : "#fef2f2",
                borderColor: darkMode ? "rgba(239, 68, 68, 0.35)" : "#fecaca",
                color: darkMode ? "#fca5a5" : "#b91c1c",
              }}
            >
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--sb-text)]">Current (temporary) password</span>
            <div className={fieldClass}>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="flex-shrink-0 border-0 bg-transparent p-0 text-[var(--sb-text-faint)] hover:text-[var(--sb-text)]"
                tabIndex={-1}
                aria-label={showPassword ? "Hide passwords" : "Show passwords"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--sb-text)]">New password</span>
            <div className={fieldClass}>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--sb-text)]">Confirm new password</span>
            <div className={fieldClass}>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex min-h-[46px] items-center justify-center gap-2 rounded-full border-0 py-2.5 text-[14px] font-semibold shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 sm:text-[13.5px]"
            style={{ background: theme.accent, color: theme.onAccent }}
          >
            {submitting && <LoaderCircle size={14} className="animate-spin" />}
            {submitting ? "Saving…" : "Save password"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-5 block w-full border-0 bg-transparent text-center text-[11.5px] font-medium text-[var(--sb-text-faint)] hover:text-[var(--sb-text)]"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
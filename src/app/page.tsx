"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, User, LoaderCircle, Clock } from "lucide-react";
import { uiFont } from "@/components/map/sidebarTheme";
import { SidebarThemeProvider, useSidebarTheme } from "@/components/map/SidebarThemeContext";

// Update this number whenever you commit a new version.
const APP_VERSION = "0.40";

// Remembers the lock across page refreshes (UI only; the server enforces it).
const LOCK_STORAGE_KEY = "ocm_login_lock_until";

// 875 -> "14:35"
function formatCountdown(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function LoginPageWrapper() {
  // Provider needs to live above the component that calls useSidebarTheme(),
  // so it's split into an outer wrapper + inner component.
  return (
    <SidebarThemeProvider>
      <LoginPage />
    </SidebarThemeProvider>
  );
}

function LoginPage() {
  const router = useRouter();
  const { vars, theme, darkMode } = useSidebarTheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Rate-limit lockout: the moment (ms) sign-in unlocks, and a live countdown.
  // The server is what really blocks attempts; this is only the friendly UI.
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const locked = lockedUntil !== null;

  function startLock(seconds: number) {
    const until = Date.now() + seconds * 1000;
    setSecondsLeft(seconds);
    setLockedUntil(until);
    try {
      localStorage.setItem(LOCK_STORAGE_KEY, String(until));
    } catch {}
  }

  // Restore a lock that was active before a refresh / reopened tab.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(LOCK_STORAGE_KEY));
      if (saved > Date.now()) setLockedUntil(saved);
      else localStorage.removeItem(LOCK_STORAGE_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setLockedUntil(null);
        setError(null);
        try {
          localStorage.removeItem(LOCK_STORAGE_KEY);
        } catch {}
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    setError(null);

    if (!identifier.trim() || !password) {
      setError("Enter your username or email, and your password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const seconds = Number(data.retryAfter ?? res.headers.get("Retry-After")) || 900;
          startLock(seconds);
          setPassword("");
          setSubmitting(false);
          return;
        }
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      router.push(data.mustChangePassword ? "/change-password" : "/map");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      style={vars}
      className={`${uiFont.className} relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[var(--sb-bg)] px-4 py-10 antialiased`}
    >
      {/* Faint cadastral-grid texture, full page */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.4]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="lot-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--sb-border)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lot-grid)" />
      </svg>

      <div className="relative w-full max-w-[380px] animate-[login-in_0.35s_ease-out] rounded-[20px] bg-[var(--sb-bg-elevated)] p-7 sm:p-8" style={{ boxShadow: "var(--sb-shadow)" }}>
        <div className="flex flex-col items-center text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[12px] text-sm font-bold tracking-wide"
            style={{ background: `linear-gradient(135deg, #6366f1, ${theme.accent})`, color: theme.onAccent }}
          >
            OCM
          </div>
          <h1 className="mt-4 text-[20px] font-bold tracking-tight text-[var(--sb-text)] sm:text-[21px]">
            Sign in to OCM
          </h1>
          <p className="mt-1 text-[12.5px] text-[var(--sb-text-faint)]">One Control Map</p>
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

          {locked && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-[12.5px]"
              style={{
                background: "rgba(245, 158, 11, 0.1)",
                borderColor: "rgba(245, 158, 11, 0.4)",
                color: "var(--sb-text)",
              }}
            >
              <Clock size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />
              <span>
                Too many failed attempts, so sign-in is paused for your security.
              </span>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--sb-text)]">Username or email</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-[var(--sb-border)] px-3 py-3 transition-all focus-within:border-[var(--sb-accent)] focus-within:ring-4 focus-within:ring-[var(--sb-accent)]/10 sm:py-2.5">
              <User size={15} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
              <input
                type="text"
                autoComplete="username"
                value={identifier}
                disabled={locked}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="username"
                className="w-full border-0 bg-transparent p-0 text-[15px] text-[var(--sb-text)] outline-none placeholder:text-[var(--sb-text-faint)] disabled:opacity-60 sm:text-[13.5px]"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--sb-text)]">Password</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-[var(--sb-border)] px-3 py-3 transition-all focus-within:border-[var(--sb-accent)] focus-within:ring-4 focus-within:ring-[var(--sb-accent)]/10 sm:py-2.5">
              <Lock size={15} className="flex-shrink-0 text-[var(--sb-text-faint)]" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                disabled={locked}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border-0 bg-transparent p-0 text-[15px] text-[var(--sb-text)] outline-none placeholder:text-[var(--sb-text-faint)] disabled:opacity-60 sm:text-[13.5px]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="flex-shrink-0 border-0 bg-transparent p-0 text-[var(--sb-text-faint)] hover:text-[var(--sb-text)]"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={submitting || locked}
            className="mt-2 flex min-h-[46px] items-center justify-center gap-2 rounded-full border-0 py-2.5 text-[14px] font-semibold shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 sm:text-[13.5px]"
            style={{ background: theme.accent, color: theme.onAccent }}
          >
            {submitting && <LoaderCircle size={14} className="animate-spin" />}
            {locked ? `Try again in ${formatCountdown(secondsLeft)}` : submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11.5px] text-[var(--sb-text-faint)]">
          Need access? Please contact{" "}
          <a
            href="https://www.facebook.com/arnold.mendoza.5283166"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: theme.accent }}
          >
            Arnold Mendoza
          </a>
          , the administrator.
        </p>
        <p className="mt-3 text-center text-[10.5px] font-medium tracking-wide text-[var(--sb-text-faint)]">
          Version {APP_VERSION}
        </p>
      </div>

      <style>{`
        @keyframes login-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
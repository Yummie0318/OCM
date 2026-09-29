"use client";

import { useMemo, useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, X } from "lucide-react";
import { getTheme, themeVars, type SidebarTheme } from "@/components/map/sidebarTheme";

export type ToastType = "success" | "error" | "warning" | "info" | "loading";

export interface ToastOptions {
  id?: string; // reuse an id to update a toast in place
  description?: string;
  duration?: number; // ms; 0 = stays until dismissed
  action?: { label: string; onClick: () => void };
}

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration: number;
  action?: ToastOptions["action"];
  version: number;
  leaving: boolean;
}

const MAX_VISIBLE = 5;
const EXIT_MS = 180;
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4500,
  warning: 6000,
  error: 8000,
  loading: 0,
};

// ---------- toast store (unchanged) ----------
let toasts: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => toasts;
const getServerSnapshot = () => EMPTY;

function show(type: ToastType, title: string, opts: ToastOptions = {}): string {
  const id = opts.id ?? `t${++counter}`;
  const existing = toasts.find((t) => t.id === id);
  const item: ToastItem = {
    id,
    type,
    title,
    description: opts.description,
    action: opts.action,
    duration: opts.duration ?? DEFAULT_DURATION[type],
    version: (existing?.version ?? 0) + 1,
    leaving: false,
  };
  toasts = existing
    ? toasts.map((t) => (t.id === id ? item : t))
    : [item, ...toasts].slice(0, MAX_VISIBLE);
  emit();
  return id;
}

function dismiss(id?: string) {
  if (!id) {
    toasts.forEach((t) => dismiss(t.id));
    return;
  }
  const t = toasts.find((x) => x.id === id);
  if (!t || t.leaving) return;
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, EXIT_MS);
}

export const toast = {
  success: (title: string, opts?: ToastOptions) => show("success", title, opts),
  error: (title: string, opts?: ToastOptions) => show("error", title, opts),
  warning: (title: string, opts?: ToastOptions) => show("warning", title, opts),
  info: (title: string, opts?: ToastOptions) => show("info", title, opts),
  loading: (title: string, opts?: ToastOptions) => show("loading", title, opts),
  dismiss,
  async promise<T>(
    p: Promise<T>,
    msgs: {
      loading: string;
      success: string | ((value: T) => string);
      error: string | ((err: unknown) => string);
    }
  ): Promise<T> {
    const id = show("loading", msgs.loading);
    try {
      const value = await p;
      show("success", typeof msgs.success === "function" ? msgs.success(value) : msgs.success, { id });
      return value;
    } catch (err) {
      show("error", typeof msgs.error === "function" ? msgs.error(err) : msgs.error, { id });
      throw err;
    }
  },
};

// ---------- theme sync ----------
// Same keys SidebarThemeContext saves to. The provider fires
// "ocm-theme-change" after saving, so same-tab changes are picked up too
// ("storage" only fires in other tabs).
const DARK_KEY = "ocm-dark-mode";
const ACCENT_KEY = "ocm-accent-color";
const THEME_EVENT = "ocm-theme-change";

function subscribeTheme(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(THEME_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(THEME_EVENT, cb);
  };
}
function getThemeSnapshot(): string {
  try {
    const dark = window.localStorage.getItem(DARK_KEY) ?? "0";
    const accent = window.localStorage.getItem(ACCENT_KEY) ?? "";
    return `${dark}|${accent}`;
  } catch {
    return "0|";
  }
}
const getServerThemeSnapshot = () => "0|";

function useToastTheme(): SidebarTheme {
  const snap = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  return useMemo(() => {
    const [dark, accent] = snap.split("|");
    return getTheme(dark === "1", /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : undefined);
  }, [snap]);
}

// Error (red) and warning (amber) stay fixed so problems always read clearly;
// success, info and loading follow the theme accent.
function statusStyle(type: ToastType, theme: SidebarTheme): { color: string; icon: typeof Info } {
  switch (type) {
    case "success":
      return { color: theme.accent, icon: CheckCircle2 };
    case "error":
      return { color: "#ef4444", icon: AlertCircle };
    case "warning":
      return { color: "#f59e0b", icon: AlertTriangle };
    case "info":
      return { color: theme.accent, icon: Info };
    case "loading":
      return { color: theme.accent, icon: Loader2 };
  }
}

const CSS = `
@keyframes ocm-toast-in{from{opacity:0;transform:translateX(24px) scale(.98)}to{opacity:1;transform:none}}
@keyframes ocm-toast-out{to{opacity:0;transform:translateX(24px) scale(.98)}}
@keyframes ocm-toast-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.ocm-toast:hover .ocm-toast-bar{animation-play-state:paused !important}
.ocm-toast-close:hover{background:color-mix(in srgb, var(--sb-text) 12%, transparent) !important;color:var(--sb-text) !important}
`;

function ToastCard({ t, theme }: { t: ToastItem; theme: SidebarTheme }) {
  const cfg = statusStyle(t.type, theme);
  const Icon = cfg.icon;
  return (
    <div
      role={t.type === "error" ? "alert" : "status"}
      className="ocm-toast pointer-events-auto relative overflow-hidden rounded-xl"
      style={{
        background: "var(--sb-bg-elevated)",
        color: "var(--sb-text)",
        border: "1px solid var(--sb-border)",
        boxShadow: "var(--sb-shadow)",
        animation: t.leaving
          ? `ocm-toast-out ${EXIT_MS}ms ease forwards`
          : "ocm-toast-in 220ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: cfg.color }} />
      <div className="flex items-start gap-2.5 py-3 pl-4 pr-2.5">
        <span className="mt-[1px] flex-shrink-0" style={{ color: cfg.color }}>
          <Icon size={17} className={t.type === "loading" ? "animate-spin" : undefined} />
        </span>
        <div className="min-w-0 flex-1">
          <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{t.title}</p>
          {t.description && (
            <p style={{ fontSize: 12, color: "var(--sb-text-muted)", marginTop: 2, lineHeight: 1.4 }}>
              {t.description}
            </p>
          )}
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
              style={{
                color: cfg.color,
                fontSize: 12,
                fontWeight: 600,
                marginTop: 6,
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => dismiss(t.id)}
          className="ocm-toast-close flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            color: "var(--sb-text-faint)",
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
          }}
        >
          <X size={14} />
        </button>
      </div>
      {t.duration > 0 && !t.leaving && (
        <div
          key={`${t.id}-${t.version}`}
          className="ocm-toast-bar"
          onAnimationEnd={() => dismiss(t.id)}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: cfg.color,
            opacity: 0.55,
            transformOrigin: "left",
            animation: `ocm-toast-progress ${t.duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  );
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const theme = useToastTheme();
  return (
    <>
      <style>{CSS}</style>
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-3 top-3 z-[200] flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col gap-2"
        style={themeVars(theme)}
      >
        {items.map((t) => (
          <ToastCard key={t.id} t={t} theme={theme} />
        ))}
      </div>
    </>
  );
}

export default Toaster;
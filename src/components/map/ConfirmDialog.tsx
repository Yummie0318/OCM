"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useSidebarTheme } from "./SidebarThemeContext";
import SubDialog from "./SubDialog";

const HAIRLINE_SOFT = "color-mix(in srgb, var(--sb-border) 45%, transparent)";
const btnBase = "border-0 p-0 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";

export default function ConfirmDialog({
  title,
  subtitle,
  icon,
  tone = "accent",
  subject,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  tone?: "danger" | "accent";
  subject?: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { theme } = useSidebarTheme();
  const danger = tone === "danger";

  return (
    <SubDialog title={title} subtitle={subtitle} onClose={onCancel} locked={busy}>
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
            style={
              danger
                ? { background: "rgba(239, 68, 68, 0.12)", color: "#ef4444" }
                : { background: "var(--sb-accent-bg)", color: "var(--sb-accent-text)" }
            }
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1 pt-0.5 text-[13px] leading-relaxed text-[var(--sb-text-muted)]">
            {children}
          </div>
        </div>

        {subject && (
          <div
            className="rounded-[12px] border px-3 py-2.5"
            style={{ borderColor: HAIRLINE_SOFT, background: "var(--sb-hover)" }}
          >
            {subject}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            autoFocus={danger}
            className={`${btnBase} rounded-full bg-[var(--sb-hover)] px-4 py-2 text-[12.5px] font-semibold text-[var(--sb-text)] hover:opacity-80`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus={!danger}
            className={`${btnBase} flex items-center gap-2 rounded-full px-5 py-2 text-[12.5px] font-semibold shadow-sm hover:opacity-90`}
            style={danger ? { background: "#ef4444", color: "#fff" } : { background: theme.accent, color: theme.onAccent }}
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </SubDialog>
  );
}
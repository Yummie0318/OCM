"use client";

// Target path: src/components/map/SubDialog.tsx
//
// Compact dialog that sits ON TOP of the Users/Surveyors modal (used for
// Add user / Edit user / temporary password / Add surveyor). It is
// positioned `absolute inset-0`, so it covers only the parent dialog (the
// nearest `relative` ancestor is UsersModal's dialog card) and the list
// behind it stays visible, dimmed.

import type { ReactNode } from "react";
import { X } from "lucide-react";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 75%, transparent)";

export default function SubDialog({
  title,
  subtitle,
  onClose,
  locked,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  // While true (a request is in flight) the dialog can't be dismissed.
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3 sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={() => {
          if (!locked) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-full w-full max-w-[400px] flex-col overflow-hidden rounded-[16px] text-[var(--sb-text)]"
        style={{ background: "var(--sb-bg-elevated)", boxShadow: "var(--sb-shadow)", border: `1px solid ${HAIRLINE}` }}
      >
        <div className="flex flex-shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-bold tracking-tight">{title}</h3>
            {subtitle && <p className="truncate text-[11.5px] text-[var(--sb-text-faint)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={locked}
            aria-label="Close"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
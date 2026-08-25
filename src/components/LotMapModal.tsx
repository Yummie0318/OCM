"use client";

import { X } from "lucide-react";
import MapCanvas from "@/components/map/MapCanvas";
import type { LotFeature } from "@/lib/geo";

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

interface Props {
  title: string;
  features: LotFeature[];
  onClose: () => void;
}

export default function LotMapModal({ title, features, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[65]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
      <div
        className="absolute inset-4 flex flex-col overflow-hidden rounded-[16px] shadow-2xl sm:inset-10"
        style={{ background: "var(--sb-bg-elevated)", border: `1px solid ${HAIRLINE}` }}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${HAIRLINE}` }}
        >
          <h3 className="text-[13px] font-bold text-[var(--sb-text)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {features.length > 0 ? (
            <MapCanvas features={features} />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-[var(--sb-text-faint)]">
              No complete lots yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
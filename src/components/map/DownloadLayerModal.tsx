"use client";

// Target path: src/components/map/DownloadLayerModal.tsx
//
// Opened from Sidebar's "Selected" tab (see SelectedPanel's new download
// icon in Sidebar.tsx) via the map page's onDownloadLayer callback — the
// page owns this modal (same pattern as CreateShapefileModal) because it's
// the one holding `layerData`, the actual LotFeature[] for each key.
// Sidebar itself never sees feature geometry, only activeSelections'
// {query, label} metadata.
//
// Same visual shell as ProjectionModal (portal to body, fixed-ish sizing,
// theme-driven colors) so the two modals read as one system. Picking a
// format and hitting Download calls straight into src/lib/mapExport.ts —
// GeoJSON and KML are synchronous/near-instant; Shapefile is async (it
// zips client-side via the `shp-write` package), hence the busy/spinner
// state.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, FileJson, Map as MapIcon, FileArchive, Loader2 } from "lucide-react";
import type { LotFeature } from "@/lib/geo";
import { useSidebarTheme } from "./SidebarThemeContext";
import { uiFont } from "./sidebarTheme";
import { downloadGeoJSON, downloadKML, downloadShapefile, type ExportFormat } from "@/lib/mapExport";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Human-readable label for the layer being exported (used as the filename base + shown in the modal). */
  label: string;
  /** The layer's features, from the page's `layerData[key]`. Undefined/empty while still loading. */
  features: LotFeature[] | undefined;
}

const hairline = "color-mix(in srgb, var(--sb-border) 75%, transparent)";

const FORMATS: { key: ExportFormat; label: string; ext: string; icon: typeof FileJson; desc: string }[] = [
  {
    key: "geojson",
    label: "GeoJSON",
    ext: ".geojson",
    icon: FileJson,
    desc: "Standard web format — works with most GIS tools.",
  },
  {
    key: "kml",
    label: "KML",
    ext: ".kml",
    icon: MapIcon,
    desc: "Opens directly in Google Earth or Google My Maps.",
  },
  {
    key: "shapefile",
    label: "Shapefile",
    ext: ".zip",
    icon: FileArchive,
    desc: "Zipped .shp/.dbf/.shx — for ArcGIS/QGIS.",
  },
];

export default function DownloadLayerModal({ open, onClose, label, features }: Props) {
  const { theme, vars } = useSidebarTheme();
  const [mounted, setMounted] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("geojson");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Reset to a clean state every time the modal opens for a (possibly
  // different) layer.
  useEffect(() => {
    if (open) {
      setFormat("geojson");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!mounted || !open) return null;

  const count = features?.length ?? 0;

  async function handleDownload() {
    if (!features || features.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (format === "geojson") {
        downloadGeoJSON(features, label);
      } else if (format === "kml") {
        downloadKML(features, label);
      } else {
        await downloadShapefile(features, label);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed. Try a different format.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className={`${uiFont.className} fixed inset-0 z-[220] flex items-center justify-center px-3 sm:px-4`} style={vars}>
      <div className="absolute inset-0" style={{ background: theme.overlayBg }} onClick={busy ? undefined : onClose} />
      <div
        className="relative flex w-[calc(100%-1.5rem)] max-w-[380px] flex-col overflow-hidden rounded-[16px] sm:w-full"
        style={{ background: "var(--sb-bg-elevated)", boxShadow: theme.shadow }}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${hairline}` }}>
          <Download size={15} style={{ color: theme.accent }} />
          <h2 className="flex-1 truncate text-[13.5px] font-bold text-[var(--sb-text)]">Download layer</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[var(--sb-text-muted)] hover:bg-[var(--sb-hover)] disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-4 py-3">
          <p className="truncate text-[11.5px] font-medium text-[var(--sb-text)]" title={label}>
            {label || "Untitled layer"}
          </p>
          <p className="text-[11px] text-[var(--sb-text-faint)]">
            {count.toLocaleString()} lot{count === 1 ? "" : "s"}
          </p>

          <div className="mt-3 flex flex-col gap-1.5">
            {FORMATS.map((f) => {
              const Icon = f.icon;
              const active = format === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFormat(f.key)}
                  disabled={busy}
                  className="flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-100 disabled:opacity-60"
                  style={{
                    background: active ? "var(--sb-accent-bg)" : "transparent",
                    boxShadow: active ? `0 0 0 1.5px var(--sb-accent)` : `0 0 0 1px color-mix(in srgb, var(--sb-border) 60%, transparent)`,
                  }}
                >
                  <Icon size={15} className="mt-0.5 flex-shrink-0" style={{ color: active ? theme.accent : "var(--sb-text-faint)" }} />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-[12.5px] font-semibold"
                      style={{ color: active ? "var(--sb-accent-text)" : "var(--sb-text)" }}
                    >
                      {f.label} <span className="font-normal text-[var(--sb-text-faint)]">({f.ext})</span>
                    </span>
                    <span className="block text-[11px] text-[var(--sb-text-faint)]">{f.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {error && <p className="mt-2.5 text-[11.5px] font-medium text-red-600">{error}</p>}
          {count === 0 && (
            <p className="mt-2.5 text-[11.5px] text-[var(--sb-text-faint)]">
              This layer has no lots loaded yet — try again once it finishes loading.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: `1px solid ${hairline}` }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border-0 bg-[var(--sb-hover)] px-3.5 py-[7px] text-[11.5px] font-semibold text-[var(--sb-text-muted)] transition-opacity duration-100 hover:opacity-80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy || count === 0}
            className="flex items-center gap-1.5 rounded-full border-0 px-3.5 py-[7px] text-[11.5px] font-semibold text-white transition-opacity duration-100 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: theme.accent }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy ? "Preparing…" : "Download"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
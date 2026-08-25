"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ControlPoint, Lot } from "@/types";
import ControlPointForm from "@/components/ControlPointForm";
import LotEditor, { newLot } from "@/components/LotEditor";
import ExportFooter from "@/components/ExportFooter";
import { computeLot, localRing } from "@/lib/computeLots";
import { computedLotsToFeatures } from "@/lib/toLotFeature";
import ShapePreview, { type PreviewShape } from "@/components/ShapePreview";
import LotMapModal from "@/components/LotMapModal";
import { useSidebarTheme } from "@/components/map/SidebarThemeContext";
import { uiFont } from "@/components/map/sidebarTheme";

const DEFAULT_CONTROL_POINT: ControlPoint = {
  controlPointId: null,
  tiePointName: "",
  municipality: "",
  province: "",
  lpcsNorthing: 20000,
  lpcsEasting: 20000,
  ppcsNorthing: 0,
  ppcsEasting: 0,
  zone: 3,
};

const HAIRLINE = "color-mix(in srgb, var(--sb-border) 70%, transparent)";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CreateShapefileModal({ open, onClose }: Props) {
  // Requires an ancestor <SidebarThemeProvider> — already true, since this
  // only ever opens from within the map page.
  const { vars } = useSidebarTheme();

  const [controlPoint, setControlPoint] = useState<ControlPoint>(DEFAULT_CONTROL_POINT);
  const [lots, setLots] = useState<Lot[]>([newLot()]);
  const [mapModalOpen, setMapModalOpen] = useState(false);

  // Fresh form every time the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setControlPoint(DEFAULT_CONTROL_POINT);
      setLots([newLot()]);
      setMapModalOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !mapModalOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, mapModalOpen]);

  const computedLots = useMemo(
    () => lots.map((l) => computeLot(l, controlPoint)).filter((v): v is NonNullable<typeof v> => v !== null),
    [lots, controlPoint]
  );

  const mapFeatures = useMemo(() => computedLotsToFeatures(computedLots), [computedLots]);

  const previewShapes: PreviewShape[] = useMemo(
    () =>
      lots.map((lot) => {
        const points = localRing(lot);
        return { id: lot.id, label: lot.lotNo || "Lot", points, complete: points.length >= 3 };
      }),
    [lots]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />

      {/* Dialog card is a flex column: header / scrollable body / footer.
          ExportFooter is a normal (non-fixed) flex child now, so it docks
          to the bottom of THIS card, not the browser window. */}
      <div
        className={`${uiFont.className} absolute inset-2 flex flex-col overflow-hidden rounded-2xl shadow-2xl sm:inset-5`}
        style={{ ...vars, background: "var(--sb-bg)" }}
      >
        <div
          className="flex flex-shrink-0 items-center gap-3 px-5 py-3.5"
          style={{ borderBottom: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}
        >
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold text-[var(--sb-text)]">Create Shapefile</h2>
            <p className="truncate text-[11.5px] text-[var(--sb-text-faint)]">Shapefile · KML · GeoJSON</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--sb-text-muted)] transition-colors hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <ControlPointForm value={controlPoint} onChange={setControlPoint} />
              <LotEditor lots={lots} onChange={setLots} />
            </div>

            <div className="min-w-0">
              <div
                className="sticky top-0 flex flex-col gap-2 rounded-[14px] p-4"
                style={{ border: `1px solid ${HAIRLINE}`, background: "var(--sb-bg-elevated)" }}
              >
                <h3 className="text-[13px] font-bold text-[var(--sb-text)]">Map preview</h3>
                <p className="text-[11.5px] text-[var(--sb-text-faint)]">Filled = complete · Dashed = incomplete</p>
                <ShapePreview
                  shapes={previewShapes}
                  height={420}
                  emptyMessage="Add corners to preview"
                  onViewMap={() => setMapModalOpen(true)}
                  mapDisabled={computedLots.length === 0}
                />
              </div>
            </div>
          </div>
        </div>

        <ExportFooter lots={lots} computedLots={computedLots} controlPoint={controlPoint} />
      </div>

      {mapModalOpen && (
        <LotMapModal title="All lots — map preview" features={mapFeatures} onClose={() => setMapModalOpen(false)} />
      )}
    </div>
  );
}
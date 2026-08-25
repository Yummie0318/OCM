"use client";

import { useMemo, useState } from "react";
import type { ControlPoint, Lot } from "@/types";
import ControlPointForm from "@/components/ControlPointForm";
import LotEditor, { newLot } from "@/components/LotEditor";
import ExportFooter from "@/components/ExportFooter";
import { computeLot, localRing } from "@/lib/computeLots";
import { computedLotsToFeatures } from "@/lib/toLotFeature";
import ShapePreview, { type PreviewShape } from "@/components/ShapePreview";
import LotMapModal from "@/components/LotMapModal";

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

export default function Home() {
  const [controlPoint, setControlPoint] = useState<ControlPoint>(DEFAULT_CONTROL_POINT);
  const [lots, setLots] = useState<Lot[]>([newLot()]);
  const [mapModalOpen, setMapModalOpen] = useState(false);

  const computedLots = useMemo(
    () =>
      lots
        .map((l) => computeLot(l, controlPoint))
        .filter((v): v is NonNullable<typeof v> => v !== null),
    [lots, controlPoint]
  );

  const mapFeatures = useMemo(
    () => computedLotsToFeatures(computedLots),
    [computedLots]
  );

  const previewShapes: PreviewShape[] = useMemo(
    () =>
      lots.map((lot) => {
        const points = localRing(lot);
        return {
          id: lot.id,
          label: lot.lotNo || "Lot",
          points,
          complete: points.length >= 3,
        };
      }),
    [lots]
  );

  return (
    <>
      <main className="page">
        <header className="page-header">
          <h1>Lot Data → Shapefile / KML / GeoJSON</h1>
          <p>
            Turn an LMB Lot Data Computation Sheet into downloadable GIS
            files, with a live map preview as you build it.
          </p>
        </header>

        <div className="layout">
          <div className="form-column">
            <ControlPointForm value={controlPoint} onChange={setControlPoint} />
            <LotEditor lots={lots} onChange={setLots} />
          </div>

          <div className="map-column panel">
            <h2>Map preview</h2>
            <p className="hint">
              Filled shapes = complete lots (3+ corners). Dashed = still
              adding corners. Auto-zoomed to fit all lots.
            </p>
            <ShapePreview
              shapes={previewShapes}
              height={520}
              emptyMessage="Add corners to a lot to see the shape here."
              onViewMap={() => setMapModalOpen(true)}
              mapDisabled={computedLots.length === 0}
            />
          </div>
        </div>
      </main>

      <ExportFooter lots={lots} computedLots={computedLots} controlPoint={controlPoint} />

      {mapModalOpen && (
        <LotMapModal
          title="All lots — map preview"
          features={mapFeatures}
          onClose={() => setMapModalOpen(false)}
        />
      )}
    </>
  );
}
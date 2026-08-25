import type { ComputedLot } from "@/types";
import type { LotFeature } from "./geo";

/**
 * Converts a ComputedLot (computeLot() output) into the GeoJSON LotFeature
 * that MapCanvas/LotMapModal draw.
 *
 * ComputedLot only carries lotNo/owner/areaSqm from the original Lot --
 * fields like ownerGivenName, province, surveyNo, patentNo, planUrl, etc.
 * live elsewhere in your data model (not threaded through computeLot()
 * today), so they're nulled out here. Popup will simply show "-" for
 * those until you wire them through Lot -> ComputedLot -> here.
 */
export function computedLotToFeature(lot: ComputedLot): LotFeature {
  const coordinates = lot.points.map((p) => [p.lon, p.lat]) as [number, number][];

  return {
    type: "Feature",
    id: lot.id,
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
    properties: {
      lotNo: lot.lotNo ?? null,
      owner: lot.owner ?? "",
      ownerGivenName: null,
      ownerSurname: null,
      province: null,
      municipality: null,
      barangay: null,
      surveyNo: null,
      dateSurveyed: null,
      surveyor: null,
      sheetNo: null,
      patentNo: null,
      remarks: null,
      planUrl: null,
      areaSqm: Number(lot.computedAreaSqm ?? lot.areaSqm ?? 0),
    },
  };
}

export function computedLotsToFeatures(lots: ComputedLot[]): LotFeature[] {
  return lots.map(computedLotToFeature);
}
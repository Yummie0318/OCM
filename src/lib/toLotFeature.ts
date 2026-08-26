import type { ComputedLot } from "@/types";
import type { LotFeature } from "./geo";

/**
 * Converts a ComputedLot (computeLot() output) into the GeoJSON LotFeature
 * that MapCanvas/LotMapModal draw.
 *
 * ComputedLot only carries lotNo/owner/areaSqm from the original Lot --
 * fields like ownerGivenName, province, surveyNo, patentNo, planUrl,
 * encodedBy, etc. live elsewhere in your data model (not threaded through
 * computeLot() today), so they're nulled out here. Popup will simply show
 * "-" for those until you wire them through Lot -> ComputedLot -> here.
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
      // Preview features are built client-side before the lot sheet is
      // ever saved to the DB, so there's no real lot_sheets.id yet --
      // null here matches the "not saved yet" state, same as the other
      // not-yet-known fields above.
      sheetId: null,
      sheetNo: null,
      patentNo: null,
      remarks: null,
      planUrl: null,
      // Same reasoning as sheetId/sheetNo above: this is a client-side
      // preview built before the lot sheet is saved, so there's no real
      // lot_sheets.created_by / encoder username yet.
      encodedBy: null,
      areaSqm: Number(lot.computedAreaSqm ?? lot.areaSqm ?? 0),
    },
  };
}

export function computedLotsToFeatures(lots: ComputedLot[]): LotFeature[] {
  return lots.map(computedLotToFeature);
}
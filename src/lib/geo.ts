// Target path: src/lib/geo.ts
// Minimal local GeoJSON types matching exactly what /api/map/lots returns.
// (Avoids pulling in a separate @types/geojson dependency for this.)

export interface LotFeature {
  type: "Feature";
  // Widened from `number`: /api/map/lots returns numeric DB ids, but
  // client-only features built from ComputedLot (see toLotFeature.ts, used
  // for the "preview before saving" map) use string ids, since Lot.id/
  // ComputedLot.id are strings throughout the rest of the app.
  id: number | string;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  properties: {
    lotNo: string | null;
    owner: string;
    ownerGivenName: string | null;
    ownerSurname: string | null;
    province: string | null;
    municipality: string | null;
    barangay: string | null;
    surveyNo: string | null;
    dateSurveyed: string | null;
    surveyor: string | null;
    areaSqm: number | null;
    // Numeric FK to lot_sheets.id — the reliable grouping key for the
    // attribute table's "sheets" view. sheetNo (below) is the
    // human-readable label, but two sheets could in principle share a
    // sheet_no string, so grouping/drill-in logic should key off this
    // instead.
    sheetId: number | string | null;
    sheetNo: string | null;
    patentNo: string | null;
    remarks: string | null;
    planUrl: string | null;
  };
}

export interface LotFeatureCollection {
  type: "FeatureCollection";
  features: LotFeature[];
  // True when /api/map/lots capped the result at its MAX_FEATURES limit —
  // lets the UI warn the user their selection returned more than what's
  // shown, rather than silently showing a partial result as if it were
  // complete.
  truncated?: boolean;
}

export interface TreeNodeData {
  id: number | string;
  label: string;
  count: number;
}

export interface SelectionMeta {
  query: Record<string, string | number>;
  label: string;
}

/** Lightweight result from /api/map/search — no polygon, just enough to
 * show in a typeahead list and fly the camera to the lot. The full
 * geometry is fetched separately (via /api/map/lots?id=) once selected. */
export interface LotSearchResult {
  id: number;
  lotNo: string | null;
  owner: string;
  province: string | null;
  municipality: string | null;
  barangay: string | null;
  surveyNo: string | null;
  patentNo: string | null;
  surveyor: string | null;
  lng: number | null;
  lat: number | null;
}
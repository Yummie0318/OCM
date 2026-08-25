// Core data model for the Cadastral Lot Data -> Shapefile/KML/GeoJSON tool

export type PRS92Zone = 1 | 2 | 3 | 4 | 5;

/** The control / tie point that links the local plane-coordinate system (LPCS)
 * used inside a LMB "Lot Data Computation Sheet" to a real-world Philippine
 * Plane Coordinate System (PPCS / PRS92 zone) position. */
export interface ControlPoint {
  /** FK -> control_points.id. Null until a row is picked from the search
   * dropdown, or if the user hand-edits the name/municipality/province after
   * picking (see ControlPointForm's `update`), since at that point we can no
   * longer be sure it still matches that exact control_points row. */
  controlPointId: number | null;
  tiePointName: string;
  municipality: string;
  province: string;
  lpcsNorthing: number;
  lpcsEasting: number;
  ppcsNorthing: number;
  ppcsEasting: number;
  zone: PRS92Zone;
}

/** A single corner/station of a lot, in the LOCAL plane-coordinate system
 * exactly as printed on the Lot Data Computation Sheet. */
export interface Corner {
  id: string;
  station: string;
  northing: string; // kept as string while editing, parsed to number on use
  easting: string;
}

/** A single lot/parcel, made of an ordered list of corners. */
export interface Lot {
  id: string;
  lotNo: string;
  owner: string; // auto-derived display string: "Surname, Given Name"
  ownerGivenName: string;
  ownerSurname: string;
  location: string; // auto-derived display string: "Barangay, Municipality, Province"
  provinceId: number | null;
  municipalityId: number | null;
  barangayId: number | null;
  surveyNo: string;
  dateSurveyed: string; // "YYYY-MM-DD"
  patentNo: string;
  remarks: string;
  surveyorId: number | null;
  areaSqm: string;
  corners: Corner[];
}

/** A corner after coordinate transformation, ready for mapping/export. */
export interface ComputedPoint {
  station: string;
  lpcsN: number;
  lpcsE: number;
  ppcsN: number;
  ppcsE: number;
  lon: number;
  lat: number;
}

export interface ComputedLot {
  id: string;
  lotNo: string;
  owner: string;
  location: string;
  areaSqm: string;
  computedAreaSqm: number;
  points: ComputedPoint[]; // closed ring (first point repeated at the end)
}
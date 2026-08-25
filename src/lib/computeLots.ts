import type { ControlPoint, Lot, ComputedLot, ComputedPoint } from "@/types";
import { transformCorner, parseCorner, planarArea } from "./coordTransform";

export interface LocalPoint {
  x: number; // easting (LPCS, as printed on the sheet)
  y: number; // northing (LPCS, as printed on the sheet)
  station: string;
}

/** Raw local-coordinate points for a lot -- no control point / proj4 needed.
 * Used for the plain shape preview (both the per-lot mini preview and the
 * combined "all lots" preview), since the shape/relative position is
 * identical whether shown in local or real-world coordinates -- only a
 * translation separates them, which the shape-only preview doesn't need. */
export function localRing(lot: Lot): LocalPoint[] {
  const points: LocalPoint[] = [];
  lot.corners.forEach((corner, i) => {
    const parsed = parseCorner(corner);
    if (!parsed) return;
    points.push({ x: parsed.easting, y: parsed.northing, station: corner.station || String(i + 1) });
  });
  return points;
}

/** Turns a lot's raw (string) corners into a closed, transformed ring.
 * Returns null if fewer than 3 valid corners are present. */
export function computeLot(lot: Lot, cp: ControlPoint): ComputedLot | null {
  const points: ComputedPoint[] = [];

  for (const corner of lot.corners) {
    const parsed = parseCorner(corner);
    if (!parsed) continue;
    const computed = transformCorner(parsed, cp);
    computed.station = corner.station || String(points.length + 1);
    points.push(computed);
  }

  if (points.length < 3) return null;

  // Close the ring (first point repeated at the end) if not already closed.
  const first = points[0];
  const last = points[points.length - 1];
  const closed =
    Math.abs(first.lpcsN - last.lpcsN) < 1e-6 && Math.abs(first.lpcsE - last.lpcsE) < 1e-6;
  const ring = closed ? points : [...points, { ...first, station: first.station }];

  return {
    id: lot.id,
    lotNo: lot.lotNo,
    owner: lot.owner,
    location: lot.location,
    areaSqm: lot.areaSqm,
    computedAreaSqm: planarArea(points),
    points: ring,
  };
}

/** Computes an "in progress" preview ring (open, not closed) from whatever
 * valid corners currently exist for the lot being edited -- used to draw the
 * live "what you are building right now" preview on the map. */
export function computePreview(lot: Lot, cp: ControlPoint): ComputedPoint[] {
  const points: ComputedPoint[] = [];
  for (const corner of lot.corners) {
    const parsed = parseCorner(corner);
    if (!parsed) continue;
    const computed = transformCorner(parsed, cp);
    computed.station = corner.station || String(points.length + 1);
    points.push(computed);
  }
  return points;
}

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

/**
 * Some LAMS control points (often BLLMs) come through with LPCS Northing/
 * Easting = 0 because no local plane value was ever captured for that tie
 * point -- the PPCS value is still reliable and correct. For lots tied to
 * these points, the corner Northing/Easting values recorded on the sheet are
 * already real-world (PPCS-scale) numbers, NOT small offsets from a local
 * origin like they are for a normal tie point (e.g. PLS 746).
 *
 * transformCorner() always does:
 *   ppcsN = corner.northing + (cp.ppcsNorthing - cp.lpcsNorthing)
 * If cp.lpcsNorthing/Easting are 0 and the corner is already PPCS-scale,
 * that shift effectively DOUBLES the real coordinate, throwing the point
 * thousands of km away (the "North Korea" bug).
 *
 * Fix: when a control point has no local offset recorded, we build an
 * "effective" control point whose LPCS values equal its own PPCS values.
 * That makes dN = dE = 0, so transformCorner passes the raw corner values
 * straight through as PPCS coordinates -- which is what the data actually
 * represents in this case.
 */
function hasNoLocalOffset(cp: ControlPoint): boolean {
  return cp.lpcsNorthing === 0 && cp.lpcsEasting === 0;
}

function effectiveControlPoint(cp: ControlPoint): ControlPoint {
  if (hasNoLocalOffset(cp)) {
    return { ...cp, lpcsNorthing: cp.ppcsNorthing, lpcsEasting: cp.ppcsEasting };
  }
  return cp;
}

/** Turns a lot's raw (string) corners into a closed, transformed ring.
 * Returns null if fewer than 3 valid corners are present. */
export function computeLot(lot: Lot, cp: ControlPoint): ComputedLot | null {
  const effectiveCp = effectiveControlPoint(cp);
  const points: ComputedPoint[] = [];

  for (const corner of lot.corners) {
    const parsed = parseCorner(corner);
    if (!parsed) continue;
    const computed = transformCorner(parsed, effectiveCp);
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
  const effectiveCp = effectiveControlPoint(cp);
  const points: ComputedPoint[] = [];
  for (const corner of lot.corners) {
    const parsed = parseCorner(corner);
    if (!parsed) continue;
    const computed = transformCorner(parsed, effectiveCp);
    computed.station = corner.station || String(points.length + 1);
    points.push(computed);
  }
  return points;
}
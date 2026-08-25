import proj4 from "proj4";
import type { ControlPoint, Corner, ComputedPoint, PRS92Zone } from "@/types";

/**
 * PRS92 / Philippines zone 1-5 (EPSG:3121-3125).
 * These replaced the old Luzon 1911 zones I-V and are the zones used for
 * modern PPCS (Philippine Plane Coordinate System) cadastral surveys.
 * Source: epsg.io / NAMRIA.
 */
const ZONE_DEFS: Record<PRS92Zone, { epsg: string; proj4: string; centralMeridian: number; name: string }> = {
  1: {
    epsg: "EPSG:3121",
    name: "PRS92 / Philippines zone 1 (west of 118°E)",
    centralMeridian: 117,
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=117 +k=0.99995 +x_0=500000 +y_0=0 +ellps=clrk66 +towgs84=-127.62,-67.24,-47.04,3.068,-4.903,-1.578,-1.06 +units=m +no_defs +type=crs",
  },
  2: {
    epsg: "EPSG:3122",
    name: "PRS92 / Philippines zone 2 (118°E-120°E)",
    centralMeridian: 119,
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=119 +k=0.99995 +x_0=500000 +y_0=0 +ellps=clrk66 +towgs84=-127.62,-67.24,-47.04,3.068,-4.903,-1.578,-1.06 +units=m +no_defs +type=crs",
  },
  3: {
    epsg: "EPSG:3123",
    name: "PRS92 / Philippines zone 3 (120°E-122°E, incl. Cagayan/N. Luzon)",
    centralMeridian: 121,
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.99995 +x_0=500000 +y_0=0 +ellps=clrk66 +towgs84=-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06 +units=m +no_defs +type=crs",
  },
  4: {
    epsg: "EPSG:3124",
    name: "PRS92 / Philippines zone 4 (122°E-124°E, SE Luzon/Visayas)",
    centralMeridian: 123,
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=123 +k=0.99995 +x_0=500000 +y_0=0 +ellps=clrk66 +towgs84=-127.62,-67.24,-47.04,3.068,-4.903,-1.578,-1.06 +units=m +no_defs +type=crs",
  },
  5: {
    epsg: "EPSG:3125",
    name: "PRS92 / Philippines zone 5 (124°E-126°E, E. Mindanao/Bohol/Samar)",
    centralMeridian: 125,
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=125 +k=0.99995 +x_0=500000 +y_0=0 +ellps=clrk66 +towgs84=-127.62,-67.24,-47.04,3.068,-4.903,-1.578,-1.06 +units=m +no_defs +type=crs",
  },
};

let defined = false;
function ensureDefs() {
  if (defined) return;
  (Object.keys(ZONE_DEFS) as unknown as PRS92Zone[]).forEach((z) => {
    proj4.defs(ZONE_DEFS[z].epsg, ZONE_DEFS[z].proj4);
  });
  defined = true;
}

export function getZoneInfo(zone: PRS92Zone) {
  return ZONE_DEFS[zone];
}

export const ALL_ZONES: PRS92Zone[] = [1, 2, 3, 4, 5];

/** Zone boundaries at 118E, 120E, 122E, 124E (PRS92 zones 1-5, CM 117/119/121/123/125). */
export function inferZoneFromLongitude(lonDeg: number): PRS92Zone {
  if (lonDeg < 118) return 1;
  if (lonDeg < 120) return 2;
  if (lonDeg < 122) return 3;
  if (lonDeg < 124) return 4;
  return 5;
}

/** Converts one LPCS corner to real-world PPCS (projected meters) and WGS84 lon/lat. */
export function transformCorner(
  corner: { northing: number; easting: number },
  cp: ControlPoint
): ComputedPoint {
  ensureDefs();
  const dN = cp.ppcsNorthing - cp.lpcsNorthing;
  const dE = cp.ppcsEasting - cp.lpcsEasting;

  const ppcsN = corner.northing + dN;
  const ppcsE = corner.easting + dE;

  const zoneEpsg = ZONE_DEFS[cp.zone].epsg;
  // proj4 expects (x, y) = (easting, northing)
  const [lon, lat] = proj4(zoneEpsg, "EPSG:4326", [ppcsE, ppcsN]);

  return {
    station: "",
    lpcsN: corner.northing,
    lpcsE: corner.easting,
    ppcsN,
    ppcsE,
    lon,
    lat,
  };
}

export function parseCorner(c: Corner): { northing: number; easting: number } | null {
  const n = parseFloat(c.northing);
  const e = parseFloat(c.easting);
  if (Number.isNaN(n) || Number.isNaN(e)) return null;
  return { northing: n, easting: e };
}

/** Shoelace formula on projected (planar, meters) coordinates -> area in m². */
export function planarArea(points: { ppcsN: number; ppcsE: number }[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.ppcsE * b.ppcsN - b.ppcsE * a.ppcsN;
  }
  return Math.abs(sum) / 2;
}

/**
 * Converts a WGS84 lon/lat vertex (e.g. straight from a stored map polygon)
 * to PPCS (projected meters) northing/easting. Zone is inferred from the
 * point's own longitude — the inverse direction of transformCorner, and
 * doesn't need a ControlPoint since the map polygon already carries
 * real-world coordinates.
 */
export function lonLatToPPCS(
  lon: number,
  lat: number
): { northing: number; easting: number; zone: PRS92Zone } {
  ensureDefs();
  const zone = inferZoneFromLongitude(lon);
  const zoneEpsg = ZONE_DEFS[zone].epsg;
  // proj4 returns [x, y] = [easting, northing]
  const [easting, northing] = proj4("EPSG:4326", zoneEpsg, [lon, lat]);
  return { northing, easting, zone };
}
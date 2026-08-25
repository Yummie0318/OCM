import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { ComputedLot, ControlPoint } from "@/types";
import { getZoneInfo } from "./coordTransform";
import { buildShapefile, type DbfFieldDef, type ShpPolygonFeature } from "./shapefileWriter";

function towgs84For(zone: number): string {
  // Mirrors the towgs84 parameter sets published for each PRS92 zone (epsg.io).
  return zone === 3
    ? "-127.62,-67.24,-47.04,-3.068,4.903,1.578,-1.06"
    : "-127.62,-67.24,-47.04,3.068,-4.903,-1.578,-1.06";
}

function prjWkt(cp: ControlPoint): string {
  const zi = getZoneInfo(cp.zone);
  return `PROJCS["PRS92 / Philippines zone ${cp.zone}",GEOGCS["PRS92",DATUM["Philippine_Reference_System_1992",SPHEROID["Clarke 1866",6378206.4,294.978698213898],TOWGS84[${towgs84For(
    cp.zone
  )}]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",${
    zi.centralMeridian
  }],PARAMETER["scale_factor",0.99995],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH]]`;
}

function fileSafe(name: string): string {
  return (name || "lot").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

// ---------------------------------------------------------------------------
// GeoJSON (always WGS84 lon/lat, per RFC 7946)
// ---------------------------------------------------------------------------
export function buildGeoJSON(lots: ComputedLot[]) {
  return {
    type: "FeatureCollection" as const,
    features: lots.map((lot) => ({
      type: "Feature" as const,
      properties: {
        LOT_NO: lot.lotNo,
        OWNER: lot.owner,
        LOCATION: lot.location,
        AREA_SQM: lot.areaSqm || lot.computedAreaSqm.toFixed(2),
        COMP_AREA: Number(lot.computedAreaSqm.toFixed(2)),
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [lot.points.map((p) => [p.lon, p.lat])],
      },
    })),
  };
}

export function downloadGeoJSON(lots: ComputedLot[]) {
  const gj = buildGeoJSON(lots);
  const blob = new Blob([JSON.stringify(gj, null, 2)], { type: "application/geo+json" });
  saveAs(blob, "lots.geojson");
}

// ---------------------------------------------------------------------------
// KML (always WGS84 lon/lat)
// ---------------------------------------------------------------------------
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildKML(lots: ComputedLot[]): string {
  const placemarks = lots
    .map((lot) => {
      const coords = lot.points.map((p) => `${p.lon.toFixed(9)},${p.lat.toFixed(9)},0`).join(" ");
      const area = lot.areaSqm || lot.computedAreaSqm.toFixed(2);
      return `    <Placemark>
      <name>${xmlEscape(lot.lotNo || "Lot")}</name>
      <description>Owner: ${xmlEscape(lot.owner)} | Location: ${xmlEscape(
        lot.location
      )} | Area: ${xmlEscape(String(area))} sq.m.</description>
      <Style><PolyStyle><color>7d0080ff</color></PolyStyle><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>
      <Polygon>
        <extrude>0</extrude>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Lot Parcels</name>
${placemarks}
  </Document>
</kml>`;
}

export function downloadKML(lots: ComputedLot[]) {
  const kml = buildKML(lots);
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  saveAs(blob, "lots.kml");
}

// ---------------------------------------------------------------------------
// Shapefile (.shp/.shx/.dbf/.prj/.cpg zipped) - projected PRS92 zone meters
// ---------------------------------------------------------------------------
export async function downloadShapefile(lots: ComputedLot[], cp: ControlPoint) {
  const fields: DbfFieldDef[] = [
    { name: "LOT_NO", type: "C", length: 30 },
    { name: "OWNER", type: "C", length: 60 },
    { name: "LOCATION", type: "C", length: 80 },
    { name: "AREA_SQM", type: "N", length: 18, decimals: 2 },
    { name: "COMP_AREA", type: "N", length: 18, decimals: 2 },
  ];

  const features: ShpPolygonFeature[] = lots.map((lot) => ({
    ring: lot.points.map((p) => [p.ppcsE, p.ppcsN] as [number, number]),
    properties: {
      LOT_NO: lot.lotNo,
      OWNER: lot.owner,
      LOCATION: lot.location,
      AREA_SQM: lot.areaSqm ? parseFloat(lot.areaSqm) : lot.computedAreaSqm,
      COMP_AREA: Number(lot.computedAreaSqm.toFixed(2)),
    },
  }));

  const { shp, shx, dbf } = buildShapefile(features, fields);

  const zip = new JSZip();
  zip.file("lots.shp", shp);
  zip.file("lots.shx", shx);
  zip.file("lots.dbf", dbf);
  zip.file("lots.prj", prjWkt(cp));
  zip.file("lots.cpg", "UTF-8");

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, "lots_shapefile.zip");
}

export { fileSafe };

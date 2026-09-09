// Target path: src/lib/mapExport.ts
//
// Client-side export helpers used by DownloadLayerModal. All three formats
// are built entirely in the browser from whatever LotFeature[] the page
// already has loaded in `layerData` — no new API route needed.
//
// - GeoJSON: trivial, just wrap in a FeatureCollection and download.
// - KML: hand-rolled XML (Polygon placemarks + a small description of the
//   lot's key fields). Good enough for Google Earth / Google My Maps;
//   doesn't attempt to cover every KML feature (styles, multi-geometry,
//   etc.) since lots are always simple polygons here.
// - Shapefile: delegates to the `shp-write` package, which builds a zipped
//   .shp/.shx/.dbf/.prj bundle in-browser (no server round-trip). Requires
//   `npm install shp-write`. Its .dbf writer only understands flat
//   string/number/boolean fields, so properties are shallow-cleaned first.

import type { LotFeature } from "@/lib/geo";

export type ExportFormat = "geojson" | "kml" | "shapefile";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(label: string): string {
  const cleaned = label
    .replace(/[^a-z0-9-_ ]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return cleaned || "layer";
}

// Shapefile .dbf fields must be flat scalars — strip anything else (nulls
// become empty strings rather than being dropped, so every feature keeps
// the same field set, which shapefile writers generally expect).
function flattenProperties(props: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) {
      out[key] = "";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

export function downloadGeoJSON(features: LotFeature[], label: string) {
  const fc = { type: "FeatureCollection" as const, features };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
  triggerDownload(blob, `${sanitizeFilename(label)}.geojson`);
}

function escapeXml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function downloadKML(features: LotFeature[], label: string) {
  const placemarks = features.map((f) => {
    const p = f.properties ?? {};
    const name = escapeXml(p.lotNo ? `Lot ${p.lotNo}` : `Lot ${f.id}`);
    const descParts = [
      p.owner && `Owner: ${p.owner}`,
      p.barangay && `Barangay: ${p.barangay}`,
      p.municipality && `Municipality: ${p.municipality}`,
      p.surveyNo && `Survey No.: ${p.surveyNo}`,
      p.areaSqm != null && `Area: ${p.areaSqm} sq.m.`,
    ].filter(Boolean);
    const desc = escapeXml(descParts.join(" | "));

    // KML polygon coordinates are lon,lat[,alt] tuples, space-separated,
    // each ring closed (first/last point equal) the same way GeoJSON
    // rings already are, so no extra closing step is needed here.
    const rings = f.geometry.coordinates
      .map(
        (ring) =>
          `<outerBoundaryIs><LinearRing><coordinates>${ring
            .map(([lng, lat]) => `${lng},${lat},0`)
            .join(" ")}</coordinates></LinearRing></outerBoundaryIs>`
      )
      .join("");

    return `    <Placemark>
      <name>${name}</name>
      <description>${desc}</description>
      <Polygon>${rings}</Polygon>
    </Placemark>`;
  });

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(label)}</name>
${placemarks.join("\n")}
  </Document>
</kml>`;

  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  triggerDownload(blob, `${sanitizeFilename(label)}.kml`);
}

export async function downloadShapefile(features: LotFeature[], label: string) {
  const mod: any = await import("shp-write");
  const shpwrite = mod.default ?? mod;

  if (!shpwrite || typeof shpwrite.zip !== "function") {
    throw new Error("shp-write did not load correctly (no .zip function found).");
  }

  const fc = {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({ ...f, properties: flattenProperties(f.properties ?? {}) })),
  };

  const options = {
    folder: sanitizeFilename(label),
    types: { polygon: sanitizeFilename(label) },
  };

  // shp-write@0.3.2's zip() is a plain SYNCHRONOUS function — it directly
  // returns the zipped data, it does not take a callback and does not
  // return a Promise. (Wrapping this in `new Promise((resolve, reject) =>
  // shpwrite.zip(fc, options, callback))` — the old code — hung forever,
  // since the callback is never invoked by this version and the return
  // value isn't a thenable either.)
  const zipResult = shpwrite.zip(fc, options);

  // In 0.3.2 this comes back as a base64 string. Handle a Blob/ArrayBuffer
  // too just in case a future version changes the default outputType.
  let blob: Blob;
  if (typeof zipResult === "string") {
    const binary = atob(zipResult);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: "application/zip" });
  } else if (zipResult instanceof Blob) {
    blob = zipResult;
  } else if (zipResult instanceof ArrayBuffer) {
    blob = new Blob([zipResult], { type: "application/zip" });
  } else {
    throw new Error(`shp-write returned an unexpected type: ${typeof zipResult}`);
  }

  triggerDownload(blob, `${sanitizeFilename(label)}.zip`);
}
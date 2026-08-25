/**
 * Minimal, dependency-free ESRI Shapefile writer for single-ring polygon
 * features (one exterior ring per feature, no holes/multipatch -- which is
 * exactly what a lot/parcel boundary is).
 *
 * Written from the public ESRI Shapefile Technical Description (whitepaper),
 * rather than a 3rd party library, because existing browser JS shapefile
 * writers (e.g. "shp-write") merge multiple polygon features into a single
 * multi-part record, which desyncs the .shp/.dbf row count. Here each lot is
 * always its own independent shapefile record + its own dbf row.
 */

export type DbfFieldType = "C" | "N";

export interface DbfFieldDef {
  name: string; // max 10 chars
  type: DbfFieldType;
  length: number;
  decimals?: number; // only for "N"
}

export interface ShpPolygonFeature {
  /** Single exterior ring, [x (easting), y (northing)] pairs, closed (first === last). */
  ring: [number, number][];
  properties: Record<string, string | number>;
}

const SHAPE_TYPE_POLYGON = 5;

function ringOrientation(ring: [number, number][]): number {
  // Signed area, shoelace formula. Positive => counter-clockwise (standard math convention).
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** ESRI shapefile spec requires outer rings to be clockwise (viewed with X-east, Y-north). */
function ensureClockwise(ring: [number, number][]): [number, number][] {
  return ringOrientation(ring) > 0 ? [...ring].reverse() : ring;
}

function bbox(rings: [number, number][][]) {
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  return { xmin, ymin, xmax, ymax };
}

export function buildShapefile(features: ShpPolygonFeature[], fields: DbfFieldDef[]) {
  const rings = features.map((f) => ensureClockwise(f.ring));
  const overall = bbox(rings);

  // ---- .shp ----
  // Each record content = 4 (shapeType) + 32 (bbox) + 4 (numParts) + 4 (numPoints)
  //                       + 4*numParts (parts array, numParts=1) + 16*numPoints
  const recordContentLengths = rings.map((r) => 4 + 32 + 4 + 4 + 4 * 1 + 16 * r.length);
  const shpBodyBytes = recordContentLengths.reduce((sum, len) => sum + 8 + len, 0);
  const shpTotalBytes = 100 + shpBodyBytes;
  const shpBuf = new ArrayBuffer(shpTotalBytes);
  const shpView = new DataView(shpBuf);

  writeShpShxHeader(shpView, shpTotalBytes, overall);

  // ---- .shx ----
  const shxTotalBytes = 100 + rings.length * 8;
  const shxBuf = new ArrayBuffer(shxTotalBytes);
  const shxView = new DataView(shxBuf);
  writeShpShxHeader(shxView, shxTotalBytes, overall);

  let shpOffset = 100; // bytes
  let shxOffset = 100; // bytes
  rings.forEach((ring, i) => {
    const contentLen = recordContentLengths[i];
    const contentWords = contentLen / 2;

    // record header (8 bytes): record number (1-based, big-endian), content length in words (big-endian)
    shpView.setInt32(shpOffset, i + 1, false);
    shpView.setInt32(shpOffset + 4, contentWords, false);

    let p = shpOffset + 8;
    shpView.setInt32(p, SHAPE_TYPE_POLYGON, true);
    p += 4;
    const rb = bbox([ring]);
    shpView.setFloat64(p, rb.xmin, true);
    p += 8;
    shpView.setFloat64(p, rb.ymin, true);
    p += 8;
    shpView.setFloat64(p, rb.xmax, true);
    p += 8;
    shpView.setFloat64(p, rb.ymax, true);
    p += 8;
    shpView.setInt32(p, 1, true); // numParts
    p += 4;
    shpView.setInt32(p, ring.length, true); // numPoints
    p += 4;
    shpView.setInt32(p, 0, true); // parts[0] = 0 (single part starts at point 0)
    p += 4;
    for (const [x, y] of ring) {
      shpView.setFloat64(p, x, true);
      p += 8;
      shpView.setFloat64(p, y, true);
      p += 8;
    }

    // .shx entry: offset (in words) + content length (in words), both big-endian
    shxView.setInt32(shxOffset, shpOffset / 2, false);
    shxView.setInt32(shxOffset + 4, contentWords, false);

    shpOffset += 8 + contentLen;
    shxOffset += 8;
  });

  // ---- .dbf ----
  const dbfBuf = buildDbf(features, fields);

  return { shp: shpBuf, shx: shxBuf, dbf: dbfBuf };
}

function writeShpShxHeader(
  view: DataView,
  totalBytes: number,
  bb: { xmin: number; ymin: number; xmax: number; ymax: number }
) {
  view.setInt32(0, 9994, false); // file code
  view.setInt32(24, totalBytes / 2, false); // file length in 16-bit words
  view.setInt32(28, 1000, true); // version
  view.setInt32(32, SHAPE_TYPE_POLYGON, true); // shape type
  view.setFloat64(36, bb.xmin, true);
  view.setFloat64(44, bb.ymin, true);
  view.setFloat64(52, bb.xmax, true);
  view.setFloat64(60, bb.ymax, true);
  view.setFloat64(68, 0, true); // Zmin
  view.setFloat64(76, 0, true); // Zmax
  view.setFloat64(84, 0, true); // Mmin
  view.setFloat64(92, 0, true); // Mmax
}

function buildDbf(features: ShpPolygonFeature[], fields: DbfFieldDef[]): ArrayBuffer {
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0); // 1 = deleted flag
  const headerLength = 32 + fields.length * 32 + 1;
  const totalBytes = headerLength + recordLength * features.length + 1; // +1 EOF marker

  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const now = new Date();
  view.setUint8(0, 0x03); // dBase III
  view.setUint8(1, now.getFullYear() - 1900);
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  view.setUint32(4, features.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  let p = 32;
  for (const f of fields) {
    const nameBytes = new TextEncoder().encode(f.name.slice(0, 10));
    bytes.set(nameBytes, p);
    view.setUint8(p + 11, f.type.charCodeAt(0));
    view.setUint8(p + 16, f.length);
    view.setUint8(p + 17, f.decimals ?? 0);
    p += 32;
  }
  view.setUint8(p, 0x0d); // header terminator
  p += 1;

  for (const feature of features) {
    view.setUint8(p, 0x20); // not deleted
    p += 1;
    for (const f of fields) {
      const raw = feature.properties[f.name];
      let str: string;
      if (f.type === "N") {
        const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? 0));
        str = Number.isFinite(num) ? num.toFixed(f.decimals ?? 0) : "";
        str = str.padStart(f.length, " ");
      } else {
        str = String(raw ?? "");
        str = str.slice(0, f.length).padEnd(f.length, " ");
      }
      const strBytes = new TextEncoder().encode(str).slice(0, f.length);
      bytes.set(strBytes, p);
      p += f.length;
    }
  }
  view.setUint8(p, 0x1a); // EOF marker

  return buf;
}

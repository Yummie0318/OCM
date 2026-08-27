// Target path in your project: src/app/api/map/lots/route.ts
//
// DOCUMENTS URL + SURVEY CLASS FIX (this pass): the SELECT below was
// missing ls.documents_url and ls.survey_class entirely, so every feature
// returned by this endpoint always had properties.documentsUrl and
// properties.surveyClass as undefined — regardless of what was actually
// saved in lot_sheets. AttributeTable's inline "Add link" (Documents) and
// "Set class" controls call the PATCH route in
// src/app/api/lot-sheets/[id]/route.ts, which DOES write documents_url /
// survey_class correctly, and page.tsx's handlers optimistically patch
// those fields onto in-memory features on success — so it looked like it
// was working right up until a refresh (or re-toggling the layer) forced
// a refetch through THIS route, at which point the freshly-saved values
// vanished because they were never being selected in the first place.
// Fixed by adding ls.documents_url and ls.survey_class to the SELECT and
// mapping them to properties.documentsUrl / properties.surveyClass below,
// same pattern as the existing ls.plan_url -> properties.planUrl.
//
// Feeds the map: returns a GeoJSON FeatureCollection for whichever selection
// the sidebar (or search) has picked. Queries against the PostGIS `geom`
// column (GIST indexed), not the raw `geojson` JSONB, so this stays fast as
// the table grows.
//
// Usage (exactly one of these selection modes):
//   /api/map/lots?id=983                     (single lot — used by search select)
//   /api/map/lots?municipality_id=5
//   /api/map/lots?barangay_id=12              (whole barangay, all years)
//   /api/map/lots?barangay_id=12&year=2025    (one year within a barangay)
//   /api/map/lots?sheet_id=42                 (one specific sheet)
//   /api/map/lots?surveyor_id=7                (everything by one surveyor)
//
// Optional, combinable with any of the above — restricts to the current map
// viewport once a selection is large (e.g. "whole municipality"):
//   &bbox=minLng,minLat,maxLng,maxLat
//
// Results are capped at MAX_FEATURES per request. If a selection would
// return more than that, the response is truncated and `truncated: true`
// is set so the UI can warn the user to narrow their selection instead of
// silently dumping a partial (and confusingly incomplete-looking) map.
//
// NOTE: each returned feature carries properties.sheetId (lot_sheets.id)
// alongside sheetNo/planUrl/documentsUrl/surveyClass. This lets the
// attribute table group lots by sheet client-side without a separate
// request — see AttributeTable.tsx.
//
// Province/municipality now come from the lot's sheet's control point
// (lot_sheets.control_point_id -> control_points) rather than the lot's own
// province_id/municipality_id, since that's the single source of truth for
// "where is this tie point" going forward. We fall back to the legacy
// l.province_id/l.municipality_id join only for older sheets that were saved
// before control_point_id existed (cp.* will be null in that case).
//
// properties.encodedBy comes from lot_sheets.created_by -> users.username —
// i.e. whoever encoded the SHEET this lot belongs to, not a per-lot value
// (lots themselves don't carry their own created_by column). Every lot on
// the same sheet will show the same encoder.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const MAX_FEATURES = 2000;

// All the *_id params below are expected to be positive integers (Postgres
// int/bigint columns). Anything else would otherwise reach the DB as a raw
// string and throw an untyped 500 on `l.id = $1`-style casts.
function parsePositiveInt(value: string | null): number | null {
  if (value == null) return null;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get("id");
  const sheetIdRaw = searchParams.get("sheet_id");
  const barangayIdRaw = searchParams.get("barangay_id");
  const municipalityIdRaw = searchParams.get("municipality_id");
  const surveyorIdRaw = searchParams.get("surveyor_id");
  const yearRaw = searchParams.get("year");
  const bbox = searchParams.get("bbox");

  // Reject anything that was actually supplied but doesn't parse as a
  // positive integer, rather than silently falling through to "no filter
  // matched" (which would return the unhelpful generic 400 below and mask
  // what actually went wrong).
  const idParams: [string, string | null][] = [
    ["id", idRaw],
    ["sheet_id", sheetIdRaw],
    ["barangay_id", barangayIdRaw],
    ["municipality_id", municipalityIdRaw],
    ["surveyor_id", surveyorIdRaw],
  ];
  for (const [name, raw] of idParams) {
    if (raw != null && parsePositiveInt(raw) == null) {
      return NextResponse.json({ error: `${name} must be a positive integer.` }, { status: 400 });
    }
  }
  if (yearRaw != null && !/^\d{4}$/.test(yearRaw)) {
    return NextResponse.json({ error: "year must be a 4-digit year." }, { status: 400 });
  }

  const id = parsePositiveInt(idRaw);
  const sheetId = parsePositiveInt(sheetIdRaw);
  const barangayId = parsePositiveInt(barangayIdRaw);
  const municipalityId = parsePositiveInt(municipalityIdRaw);
  const surveyorId = parsePositiveInt(surveyorIdRaw);
  const year = yearRaw != null ? Number(yearRaw) : null;

  const conditions: string[] = ["l.geom IS NOT NULL"];
  const params: unknown[] = [];

  function addParam(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  if (id != null) {
    conditions.push(`l.id = ${addParam(id)}`);
  } else if (sheetId != null) {
    conditions.push(`l.lot_sheet_id = ${addParam(sheetId)}`);
  } else if (barangayId != null && year != null) {
    conditions.push(`l.barangay_id = ${addParam(barangayId)}`);
    conditions.push(`EXTRACT(YEAR FROM l.date_surveyed) = ${addParam(year)}`);
  } else if (barangayId != null) {
    conditions.push(`l.barangay_id = ${addParam(barangayId)}`);
  } else if (municipalityId != null) {
    // NOTE: this still filters against the legacy l.municipality_id column.
    // If/when the sidebar's municipality filter should instead mean "sheets
    // tied to a control point in this municipality", this condition needs to
    // change to join through lot_sheets/control_points too — flag if that's
    // the intent.
    conditions.push(`l.municipality_id = ${addParam(municipalityId)}`);
  } else if (surveyorId != null) {
    conditions.push(`l.surveyor_id = ${addParam(surveyorId)}`);
  } else {
    return NextResponse.json(
      {
        error:
          "Provide one of: id, sheet_id, barangay_id (optionally with year), municipality_id, or surveyor_id.",
      },
      { status: 400 }
    );
  }

  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      const [minLng, minLat, maxLng, maxLat] = parts;
      // `&&` is the PostGIS bounding-box overlap operator — this is what the
      // GIST index on `geom` accelerates.
      conditions.push(
        `l.geom && ST_MakeEnvelope(${addParam(minLng)}, ${addParam(minLat)}, ${addParam(
          maxLng
        )}, ${addParam(maxLat)}, 4326)`
      );
    }
  }

  // Fetch one extra row beyond the cap so we can tell "exactly MAX_FEATURES
  // rows" apart from "more than MAX_FEATURES rows" without a separate
  // COUNT(*) query.
  const limitParam = addParam(MAX_FEATURES + 1);

  const sql = `
    SELECT
      l.id, l.lot_no, l.owner_given_name, l.owner_surname,
      l.survey_no, l.date_surveyed, l.area_sqm, l.patent_no, l.remarks,
      ls.id AS sheet_id, ls.plan_url, ls.documents_url, ls.survey_class, ls.sheet_no,
      ST_AsGeoJSON(l.geom) AS geometry_json,
      COALESCE(cp.province_name, p.name) AS province_name,
      COALESCE(cp.municipality_name, m.name) AS municipality_name,
      b.name AS barangay_name,
      s.name AS surveyor_name,
      eu.username AS encoded_by_username
    FROM lots l
    LEFT JOIN lot_sheets ls ON ls.id = l.lot_sheet_id
    LEFT JOIN control_points cp ON cp.id = ls.control_point_id
    LEFT JOIN provinces p ON p.id = l.province_id
    LEFT JOIN municipalities m ON m.id = l.municipality_id
    LEFT JOIN barangays b ON b.id = l.barangay_id
    LEFT JOIN surveyors s ON s.id = l.surveyor_id
    LEFT JOIN users eu ON eu.id = ls.created_by
    WHERE ${conditions.join(" AND ")}
    ORDER BY l.id
    LIMIT ${limitParam}
  `;

  const pool = getPool();
  const { rows } = await pool.query(sql, params);

  const truncated = rows.length > MAX_FEATURES;
  const limitedRows = truncated ? rows.slice(0, MAX_FEATURES) : rows;

  const features = limitedRows.map((row) => ({
    type: "Feature" as const,
    id: row.id,
    geometry: JSON.parse(row.geometry_json),
    properties: {
      lotNo: row.lot_no,
      owner: [row.owner_surname, row.owner_given_name].filter(Boolean).join(", "),
      ownerGivenName: row.owner_given_name,
      ownerSurname: row.owner_surname,
      province: row.province_name,
      municipality: row.municipality_name,
      barangay: row.barangay_name,
      surveyNo: row.survey_no,
      dateSurveyed: row.date_surveyed,
      surveyor: row.surveyor_name,
      areaSqm: row.area_sqm,
      sheetId: row.sheet_id,
      sheetNo: row.sheet_no,
      patentNo: row.patent_no,
      remarks: row.remarks,
      planUrl: row.plan_url,
      documentsUrl: row.documents_url,
      surveyClass: row.survey_class,
      encodedBy: row.encoded_by_username,
    },
  }));

  return NextResponse.json({
    type: "FeatureCollection" as const,
    features,
    truncated,
  });
}
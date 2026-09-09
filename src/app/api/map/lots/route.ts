// Target path: src/app/api/map/lots/route.ts
//
// COMBINED FACET FILTER (this pass): ProjectionModal.tsx no longer produces
// one pick per checkbox (proj:cenro:<id>, proj:muni:<id>, year:<b>:<y>,
// etc). It's 4 flat tabs (CENRO / Municipality / Barangay / Year) with
// cross-filtering between them, and one "Apply" now builds ONE combined
// filter-set across everything checked in all 4 tabs, ANDed together:
//   cenro IN (...) AND municipality IN (...) AND barangay IN (...) AND year IN (...)
// (any facet the user left empty is just omitted from the AND). This is
// also the shape a future Excel export / printable report will reuse
// directly against this same endpoint.
//
// New params, all comma-separated integers, all optional and combinable:
//   &cenro_ids=1,2            (lots whose municipality falls under any of these CENROs)
//   &municipality_ids=5,9
//   &barangay_ids=12,40
//   &years=2023,2024
// If ANY of these four params is present (even a single id), the request
// is treated as a facet-filter request and the legacy single-select modes
// below (id / sheet_id / single cenro_id / single municipality_id / single
// barangay_id[+year] / surveyor_id) are skipped entirely -- the two modes
// are mutually exclusive per request, same as the legacy modes always were
// exclusive of each other.
//
// The legacy singular modes are UNCHANGED and still used by: single-lot
// fetch from search select (`id`), a specific sheet (`sheet_id`), and
// per-surveyor lookups (`surveyor_id`). Sidebar.tsx's own Layers-tab tree
// still uses the legacy `barangay_id[&year]` single-select path too --
// that tree is a separate, simpler "browse and check one year" flow and
// wasn't part of this pass.
//
// Feeds the map: returns a GeoJSON FeatureCollection for whichever selection
// the sidebar (or search) has picked. Queries against the PostGIS `geom`
// column (GIST indexed), not the raw `geojson` JSONB, so this stays fast as
// the table grows.
//
// Usage:
//   /api/map/lots?id=983                              (single lot — search select)
//   /api/map/lots?sheet_id=42                         (one specific sheet)
//   /api/map/lots?surveyor_id=7                       (everything by one surveyor)
//   /api/map/lots?cenro_id=2                          (legacy: whole CENRO, single)
//   /api/map/lots?municipality_id=5                   (legacy: whole municipality, single)
//   /api/map/lots?barangay_id=12                      (legacy: whole barangay, all years)
//   /api/map/lots?barangay_id=12&year=2025            (legacy: one year within a barangay)
//   /api/map/lots?cenro_ids=1,2&years=2023,2024       (combined facet filter — ProjectionModal)
//   /api/map/lots?municipality_ids=5,9&barangay_ids=12&years=2024
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
//
// properties.cenro / cenroId (added for the CENRO -> Municipality ->
// Barangay -> Lot Sheet report, src/app/reports/lots): joined off
// municipalities.cenro_id via the lot's own l.municipality_id — the exact
// same column the cenro_ids facet filter below matches against — so the
// CENRO shown on a lot is always consistent with what the CENRO filter
// actually matched, even when the displayed province/municipality NAME
// comes from control_points instead. Null if l.municipality_id is null
// (a sheet located only via control_point, with no legacy per-lot
// municipality FK set).
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

// Parses a comma-separated list of positive integers for the new combined
// facet-filter params (cenro_ids, municipality_ids, barangay_ids, years).
// A missing param yields an empty array (== "no filter on this facet");
// a present-but-malformed entry yields null so the caller can 400 instead
// of silently ignoring a typo'd filter.
function parsePositiveIntList(value: string | null): number[] | null {
  if (value == null || value.trim() === "") return [];
  const out: number[] = [];
  for (const part of value.split(",")) {
    const n = parsePositiveInt(part.trim());
    if (n == null) return null;
    out.push(n);
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get("id");
  const sheetIdRaw = searchParams.get("sheet_id");
  const barangayIdRaw = searchParams.get("barangay_id");
  const municipalityIdRaw = searchParams.get("municipality_id");
  const cenroIdRaw = searchParams.get("cenro_id");
  const surveyorIdRaw = searchParams.get("surveyor_id");
  const yearRaw = searchParams.get("year");
  const bbox = searchParams.get("bbox");

  // New combined facet-filter params (ProjectionModal's saved filter-sets).
  const cenroIdsRaw = searchParams.get("cenro_ids");
  const municipalityIdsRaw = searchParams.get("municipality_ids");
  const barangayIdsRaw = searchParams.get("barangay_ids");
  const yearsRaw = searchParams.get("years");

  const cenroIds = parsePositiveIntList(cenroIdsRaw);
  const municipalityIds = parsePositiveIntList(municipalityIdsRaw);
  const barangayIds = parsePositiveIntList(barangayIdsRaw);
  const years = parsePositiveIntList(yearsRaw);

  if (cenroIds == null || municipalityIds == null || barangayIds == null || years == null) {
    return NextResponse.json(
      { error: "cenro_ids, municipality_ids, barangay_ids, and years must be comma-separated positive integers." },
      { status: 400 }
    );
  }

  const hasFacetFilter =
    cenroIds.length > 0 || municipalityIds.length > 0 || barangayIds.length > 0 || years.length > 0;

  const conditions: string[] = ["l.geom IS NOT NULL"];
  const params: unknown[] = [];

  function addParam(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  if (hasFacetFilter) {
    // Combined mode: every non-empty facet ANDed together, each facet
    // itself an OR/IN across whatever was checked in that tab.
    if (cenroIds.length > 0) {
      conditions.push(
        `l.municipality_id IN (SELECT id FROM municipalities WHERE cenro_id = ANY(${addParam(cenroIds)}))`
      );
    }
    if (municipalityIds.length > 0) {
      conditions.push(`l.municipality_id = ANY(${addParam(municipalityIds)})`);
    }
    if (barangayIds.length > 0) {
      conditions.push(`l.barangay_id = ANY(${addParam(barangayIds)})`);
    }
    if (years.length > 0) {
      conditions.push(`EXTRACT(YEAR FROM l.date_surveyed) = ANY(${addParam(years)})`);
    }
  } else {
    // Legacy single-select modes — unchanged from before this pass.
    const idParams: [string, string | null][] = [
      ["id", idRaw],
      ["sheet_id", sheetIdRaw],
      ["barangay_id", barangayIdRaw],
      ["municipality_id", municipalityIdRaw],
      ["cenro_id", cenroIdRaw],
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
    const cenroId = parsePositiveInt(cenroIdRaw);
    const surveyorId = parsePositiveInt(surveyorIdRaw);
    const year = yearRaw != null ? Number(yearRaw) : null;

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
    } else if (cenroId != null) {
      conditions.push(
        `l.municipality_id IN (SELECT id FROM municipalities WHERE cenro_id = ${addParam(cenroId)})`
      );
    } else if (surveyorId != null) {
      conditions.push(`l.surveyor_id = ${addParam(surveyorId)}`);
    } else {
      return NextResponse.json(
        {
          error:
            "Provide one of: id, sheet_id, barangay_id (optionally with year), municipality_id, cenro_id, surveyor_id, " +
            "or a combined facet filter (cenro_ids/municipality_ids/barangay_ids/years).",
        },
        { status: 400 }
      );
    }
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
      eu.username AS encoded_by_username,
      cen.id AS cenro_id,
      cen.name AS cenro_name
    FROM lots l
    LEFT JOIN lot_sheets ls ON ls.id = l.lot_sheet_id
    LEFT JOIN control_points cp ON cp.id = ls.control_point_id
    LEFT JOIN provinces p ON p.id = l.province_id
    LEFT JOIN municipalities m ON m.id = l.municipality_id
    LEFT JOIN cenros cen ON cen.id = m.cenro_id
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
      cenroId: row.cenro_id,
      cenro: row.cenro_name,
    },
  }));

  return NextResponse.json({
    type: "FeatureCollection" as const,
    features,
    truncated,
  });
}
// Target path: src/app/api/map/lots/route.ts
//
// COMBINED FACET FILTER: ProjectionModal.tsx builds ONE combined filter-set
// across everything checked in its 6 tabs (CENRO / Municipality / Barangay /
// Year / Classification / Plan Type), ANDed together:
//   cenro IN (...) AND municipality IN (...) AND barangay IN (...)
//     AND year IN (...) AND classification IN (...) AND prefix IN (...)
// (any facet the user left empty is just omitted from the AND). This is
// also the shape a future Excel export / printable report will reuse
// directly against this same endpoint.
//
// New params, all comma-separated, all optional and combinable:
//   &cenro_ids=1,2            (lots whose municipality falls under any of these CENROs)
//   &municipality_ids=5,9
//   &barangay_ids=12,40
//   &years=2023,2024
//   &classifications=RFPA,FPA
//   &prefixes=CSD,CCS
// If ANY of these six params is present (even a single value), the request
// is treated as a facet-filter request and the legacy single-select modes
// below (id / sheet_id / single cenro_id / single municipality_id / single
// barangay_id[+year] / surveyor_id) are skipped entirely -- the two modes
// are mutually exclusive per request, same as the legacy modes always were
// exclusive of each other. Legacy single-select requests have no way to
// also filter by classification or prefix -- that's intentional; only the
// combined-facet path (ProjectionModal) supports it.
//
// CLASSIFICATION: "classification" isn't a real column -- it's derived per-lot
// from area_sqm vs. the threshold that applies to that lot's municipality (a
// municipality-level override in area_classification_rules if one exists,
// else its CENRO's default), via the get_rfpa_threshold(municipality_id) SQL
// function. A lot is RFPA if area_sqm <= that threshold, else FPA. A
// municipality with no rule at either level makes get_rfpa_threshold()
// return NULL for its lots; those lots are excluded whenever a
// classifications filter is active (never silently counted as RFPA or FPA),
// and expose classification: null on the feature otherwise.
//
// PLAN TYPE / PREFIX (this pass): "prefix" also isn't a real column -- it's
// the leading letter code parsed off survey_no (e.g. "CSD-AF-02-015244" ->
// "CSD", "Ccs-(af)-02-001378" -> "CCS"), uppercased for consistency since
// existing data is inconsistently cased. Unlike classification, this isn't
// a fixed two-value enum -- whatever letter codes actually appear in
// survey_no (CSD, CCS, CSC, CSF, ...) become selectable, discovered live
// from the DB via tree/route.ts's facets mode rather than hardcoded here.
// Rows where survey_no is null, blank, or doesn't start with a letter
// resolve to a NULL prefix and are excluded whenever a prefixes filter is
// active, same treatment as classification's NULL case -- never guessed
// into a bucket.
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
//   /api/map/lots?cenro_ids=3&classifications=RFPA    (only RFPA-classified lots under CENRO 3)
//   /api/map/lots?prefixes=CSD                        (every CSD-prefixed plan, PENRO-wide)
//   /api/map/lots?prefixes=CSD,CCS&years=2023         (CSD or CCS plans surveyed in 2023)
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
// MUNICIPALITY-FROM-BARANGAY FIX (this pass): municipality_name previously
// preferred cp.municipality_name (free text on the sheet's control point)
// over everything else. That text field is entered independently of which
// barangay got assigned to the lot, so the two can silently disagree — a
// real case: sheet 6150 (PLS-567) has barangay_id pointing at Annabuculan
// (which the barangays table correctly files under Amulung), but its
// control point's municipality_name was typed as "Alcala". The map and
// attribute table both showed "Alcala" for lots that were actually in
// Amulung.
//
// Fix: join barangays -> municipalities (bm below) and let that take
// priority. l.barangay_id is a real FK, so the barangay's own parent
// municipality can never drift out of sync with which barangay was picked
// — unlike cp.municipality_name, which is just typed text. cp.municipality_
// name (then the legacy l.municipality_id join) now only kicks in as a
// fallback for the rarer case where a lot has no barangay_id at all.
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
// comes from the barangay (or control point) instead. Null if
// l.municipality_id is null (a sheet located only via control_point, with
// no legacy per-lot municipality FK set).
//
// properties.classification / classificationThreshold: same derivation as
// the classifications filter above, always computed and returned
// regardless of whether a classifications filter was applied, so the
// map/report/attribute table can show RFPA vs FPA on every lot. Both are
// null when the lot's municipality has no rule at either level.
//
// properties.planPrefix (this pass): same derivation as the prefixes filter
// above, always computed and returned regardless of whether a prefixes
// filter was applied, so the map/report/attribute table can show the plan
// type on every lot. Null when survey_no is missing, blank, or doesn't
// start with a letter.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const MAX_FEATURES = 2000;

const VALID_CLASSIFICATIONS = ["RFPA", "FPA"] as const;
type ClassificationCode = (typeof VALID_CLASSIFICATIONS)[number];

// Same CASE expression used in tree/route.ts's facets mode — kept in sync
// manually since the two routes don't currently share a query-builder
// module. If a shared lib/sql helpers file gets introduced later, this is
// the first thing to hoist into it.
const CLASSIFICATION_CASE_SQL = `CASE
  WHEN get_rfpa_threshold(l.municipality_id) IS NULL THEN NULL
  WHEN l.area_sqm <= get_rfpa_threshold(l.municipality_id) THEN 'RFPA'
  ELSE 'FPA'
END`;

// Same expression as tree/route.ts's PLAN_PREFIX_SQL — kept in sync
// manually, same as CLASSIFICATION_CASE_SQL above. Pulls the leading run
// of letters off survey_no and uppercases it (e.g. "Csd-af-02-015026" ->
// "CSD"). Resolves to NULL (not an empty string) when survey_no is null,
// blank, or doesn't start with a letter -- substring() returning no match
// yields NULL, which is exactly the "excluded, not guessed" behavior this
// facet needs.
const PLAN_PREFIX_SQL = `UPPER(substring(l.survey_no from '^[A-Za-z]+'))`;

// All the *_id params below are expected to be positive integers (Postgres
// int/bigint columns). Anything else would otherwise reach the DB as a raw
// string and throw an untyped 500 on `l.id = $1`-style casts.
function parsePositiveInt(value: string | null): number | null {
  if (value == null) return null;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Parses a comma-separated list of positive integers for the combined
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

// Parses a comma-separated list of classification codes for the
// `classifications` facet param. Case-insensitive on input; any token
// outside RFPA/FPA returns null so the caller can 400 instead of silently
// matching nothing.
function parseClassificationList(value: string | null): ClassificationCode[] | null {
  if (value == null || value.trim() === "") return [];
  const out: ClassificationCode[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed === "") continue;
    if (!(VALID_CLASSIFICATIONS as readonly string[]).includes(trimmed)) return null;
    out.push(trimmed as ClassificationCode);
  }
  return out;
}

// Parses a comma-separated list of plan-prefix codes for the `prefixes`
// facet param. Unlike classifications, prefixes aren't a fixed enum --
// CSD/CCS are what's in the data today, but CSC/CSF or others could show
// up later -- so this only validates *shape* (2-6 letters, matching what a
// real survey-plan prefix looks like), not membership in a fixed list. The
// DB stays the source of truth for which prefixes actually exist (see
// tree/route.ts's "prefixes" facet target). Case-insensitive on input,
// same as classifications.
function parsePrefixList(value: string | null): string[] | null {
  if (value == null || value.trim() === "") return [];
  const out: string[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed === "") continue;
    if (!/^[A-Z]{2,6}$/.test(trimmed)) return null;
    out.push(trimmed);
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

  // Combined facet-filter params (ProjectionModal's saved filter-sets).
  const cenroIdsRaw = searchParams.get("cenro_ids");
  const municipalityIdsRaw = searchParams.get("municipality_ids");
  const barangayIdsRaw = searchParams.get("barangay_ids");
  const yearsRaw = searchParams.get("years");
  const classificationsRaw = searchParams.get("classifications");
  const prefixesRaw = searchParams.get("prefixes");

  const cenroIds = parsePositiveIntList(cenroIdsRaw);
  const municipalityIds = parsePositiveIntList(municipalityIdsRaw);
  const barangayIds = parsePositiveIntList(barangayIdsRaw);
  const years = parsePositiveIntList(yearsRaw);
  const classifications = parseClassificationList(classificationsRaw);
  const prefixes = parsePrefixList(prefixesRaw);

  if (
    cenroIds == null ||
    municipalityIds == null ||
    barangayIds == null ||
    years == null ||
    classifications == null ||
    prefixes == null
  ) {
    return NextResponse.json(
      {
        error:
          "cenro_ids, municipality_ids, barangay_ids, and years must be comma-separated positive integers; " +
          "classifications must be a comma-separated list of RFPA and/or FPA; " +
          "prefixes must be a comma-separated list of 2-6 letter codes (e.g. CSD,CCS).",
      },
      { status: 400 }
    );
  }

  const hasFacetFilter =
    cenroIds.length > 0 ||
    municipalityIds.length > 0 ||
    barangayIds.length > 0 ||
    years.length > 0 ||
    classifications.length > 0 ||
    prefixes.length > 0;

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
    if (classifications.length > 0) {
      // Municipalities with no rule at either level return NULL from
      // get_rfpa_threshold() and are excluded here rather than matching
      // either bucket -- the AND makes this automatic since NULL = ANY(...)
      // is NULL (falsy), not an error, but stated explicitly for clarity.
      conditions.push(`(${CLASSIFICATION_CASE_SQL}) = ANY(${addParam(classifications)})`);
    }
    if (prefixes.length > 0) {
      // Same NULL-excludes-automatically behavior as classifications above:
      // a lot whose survey_no doesn't yield a prefix has PLAN_PREFIX_SQL
      // evaluate to NULL, and NULL = ANY(...) is NULL (falsy), so it's
      // excluded rather than matching any checked prefix.
      conditions.push(`(${PLAN_PREFIX_SQL}) = ANY(${addParam(prefixes)})`);
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
            "or a combined facet filter (cenro_ids/municipality_ids/barangay_ids/years/classifications/prefixes).",
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
      -- bm (the barangay's own municipality, via barangays.municipality_id)
      -- takes priority over cp.municipality_name / legacy m.name: l.barangay_id
      -- is a real FK, so the barangay's parent municipality can never
      -- disagree with which barangay was picked. cp.municipality_name is
      -- free text on the sheet's control point and can be typed
      -- independently of the barangay (this is what happened on sheet
      -- 6150/PLS-567 — barangay_id correctly pointed at Annabuculan, under
      -- Amulung, but the control point's municipality_name was typed as
      -- "Alcala"). It now only serves as a fallback for sheets with no
      -- barangay_id set at all.
      COALESCE(bm.name, cp.municipality_name, m.name) AS municipality_name,
      b.name AS barangay_name,
      s.name AS surveyor_name,
      eu.username AS encoded_by_username,
      cen.id AS cenro_id,
      cen.name AS cenro_name,
      get_rfpa_threshold(l.municipality_id) AS classification_threshold,
      CASE
        WHEN get_rfpa_threshold(l.municipality_id) IS NULL THEN NULL
        ELSE ${CLASSIFICATION_CASE_SQL}
      END AS classification,
      ${PLAN_PREFIX_SQL} AS plan_prefix
    FROM lots l
    LEFT JOIN lot_sheets ls ON ls.id = l.lot_sheet_id
    LEFT JOIN control_points cp ON cp.id = ls.control_point_id
    LEFT JOIN provinces p ON p.id = l.province_id
    LEFT JOIN municipalities m ON m.id = l.municipality_id
    LEFT JOIN cenros cen ON cen.id = m.cenro_id
    LEFT JOIN barangays b ON b.id = l.barangay_id
    LEFT JOIN municipalities bm ON bm.id = b.municipality_id
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
      classification: row.classification,
      classificationThreshold: row.classification_threshold,
      planPrefix: row.plan_prefix,
    },
  }));

  return NextResponse.json({
    type: "FeatureCollection" as const,
    features,
    truncated,
  });
}
// Target path: src/app/api/map/tree/route.ts
//
// FACETED CROSS-FILTERING: ProjectionModal.tsx renders 6 flat tabs — CENRO /
// Municipality / Barangay / Year / Classification / Plan Type — each a
// checkbox list, and checking boxes in one tab narrows what shows up in the
// OTHER five (e.g. checking Year 2023 makes the Municipality tab only list
// municipalities that actually have lots surveyed in 2023; checking
// Classification=RFPA makes every other tab only list options that have at
// least one RFPA-classified lot; checking Plan Type=CSD makes every other
// tab only list options that have at least one CSD-prefixed plan).
//
// CLASSIFICATION FACET: `classifications` joins the other four facet params
// (`cenro_ids`, `municipality_ids`, `barangay_ids`, `years`) as a fifth,
// comma-separated list of RFPA/FPA. Unlike the other four, "classification"
// isn't a real table/column — it's derived per-lot from `area_sqm` vs. the
// area_classification_rules threshold that applies to that lot's
// municipality (municipality-level override if one exists, else its
// CENRO's default), via the `get_rfpa_threshold(municipality_id)` SQL
// function. See area_classification_rules / get_rfpa_threshold in the DB —
// a municipality with no rule at either level returns NULL and its lots are
// excluded from any classification-filtered result (never silently counted
// as one bucket or the other).
//
// PLAN TYPE / PREFIX FACET (this pass): `prefixes` is the sixth facet,
// same shape as classifications — also not a real column, derived from the
// leading letter code of `survey_no` (e.g. "CSD-AF-02-015244" -> "CSD"),
// uppercased for consistency since existing data is inconsistently cased
// ("Csd-af-...", "CSD-AF-...", "Ccs-(af)-..."). Unlike classification,
// prefixes aren't a fixed two-value enum: whatever codes actually exist in
// survey_no (CSD, CCS today; CSC, CSF, etc. as they show up) are discovered
// live via this endpoint's own `target=prefixes` facet listing rather than
// hardcoded, so a new prefix appearing in the data becomes selectable
// automatically. Rows where survey_no is null, blank, or doesn't start
// with a letter resolve to a NULL prefix and are excluded, same treatment
// as classification's NULL case.
//
// New mode added to support faceting: `level=facets&target=<level>` plus
// whichever facet arrays are currently checked (`cenro_ids`,
// `municipality_ids`, `barangay_ids`, `years`, `classifications`,
// `prefixes`, all comma-separated). It returns {id, label, count} for
// `target`, filtered by every OTHER non-empty facet array — deliberately
// NOT filtered by target's own array, since a facet list filtered by
// itself would hide every option the user hasn't already checked, making
// it impossible to discover or uncheck anything.
//
// The original per-level endpoints (`level=cenros/municipalities/
// barangays/years`) are UNCHANGED and still used by Sidebar.tsx's own
// Layers-tab tree (Municipality -> Barangay -> Year, unscoped by CENRO) —
// that tree is a separate, simpler "browse and check one year" flow and
// wasn't part of this pass. There is deliberately no legacy
// `level=classifications` or `level=prefixes` endpoint since neither
// existed before the facets mode.
//
// Usage:
//   /api/map/tree?level=cenros
//   /api/map/tree?level=municipalities                  (all, unscoped — Sidebar tree)
//   /api/map/tree?level=municipalities&cenro_id=3        (single-scoped — legacy)
//   /api/map/tree?level=barangays&municipality_id=5
//   /api/map/tree?level=years&barangay_id=12
//   /api/map/tree?level=facets&target=municipalities&cenro_ids=1,2&years=2023,2024
//     -> municipalities with lots under CENRO 1 or 2 AND surveyed in 2023 or 2024
//   /api/map/tree?level=facets&target=classifications&cenro_ids=3
//     -> {RFPA: n, FPA: m} counts for lots under CENRO 3 only
//   /api/map/tree?level=facets&target=prefixes
//     -> {CSD: n, CCS: m, ...} counts PENRO-wide, whatever prefixes exist
//   /api/map/tree?level=facets&target=municipalities&prefixes=CSD
//     -> municipalities that have at least one CSD-prefixed plan
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

interface TreeNode {
  id: number | string;
  label: string;
  count: number;
}

const FACET_TARGETS = [
  "cenros",
  "municipalities",
  "barangays",
  "years",
  "classifications",
  "prefixes",
] as const;
type FacetTarget = (typeof FACET_TARGETS)[number];

const VALID_CLASSIFICATIONS = ["RFPA", "FPA"] as const;
type ClassificationCode = (typeof VALID_CLASSIFICATIONS)[number];

// The same CASE expression used everywhere classification needs deriving:
// a lot is RFPA if its area is at or under its municipality's threshold
// (municipality-level override from area_classification_rules if one
// exists, else its CENRO's default via get_rfpa_threshold()), else FPA.
// Municipalities with no rule at either level return NULL from
// get_rfpa_threshold() and are excluded via the NOT NULL guard added
// alongside every use of this expression, rather than silently landing in
// either bucket.
const CLASSIFICATION_CASE_SQL = `CASE WHEN l.area_sqm <= get_rfpa_threshold(l.municipality_id) THEN 'RFPA' ELSE 'FPA' END`;

// Plan/survey-number prefix (CSD, CCS, CSC, CSF, ...) -- not a real column,
// derived from the leading letters of survey_no (e.g. "CSD-AF-02-015244"
// -> "CSD"). Normalized to uppercase since existing data is inconsistently
// cased ("Csd-af-...", "CSD-AF-..."). Rows where survey_no is null, blank,
// or doesn't start with a letter resolve to NULL and are excluded from
// prefix filtering/listing, same as classification excludes
// municipalities with no threshold rule. Kept in sync manually with the
// identical expression in lots/route.ts (see that file's note on
// CLASSIFICATION_CASE_SQL for why).
const PLAN_PREFIX_SQL = `UPPER(substring(l.survey_no from '^[A-Za-z]+'))`;

// Parses a comma-separated list of positive integers, e.g. "1,2,3". Blank
// or missing params yield an empty array (== "no filter on this facet"),
// but a param that's present with a non-numeric entry returns null so the
// caller can 400 instead of silently dropping a bad filter.
function parseIntList(raw: string | null): number[] | null {
  if (raw == null || raw.trim() === "") return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    if (!/^\d+$/.test(trimmed)) return null;
    out.push(Number(trimmed));
  }
  return out;
}

// Parses a comma-separated list of classification codes. Case-insensitive
// on input ("rfpa" -> "RFPA") since this only ever reaches the query as a
// literal string compared against the CASE expression's output, not a DB
// lookup. Blank/missing yields an empty array (no filter); any token
// outside RFPA/FPA returns null so the caller can 400 instead of silently
// matching nothing.
function parseClassificationList(raw: string | null): ClassificationCode[] | null {
  if (raw == null || raw.trim() === "") return [];
  const out: ClassificationCode[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed === "") continue;
    if (!(VALID_CLASSIFICATIONS as readonly string[]).includes(trimmed)) return null;
    out.push(trimmed as ClassificationCode);
  }
  return out;
}

// Parses a comma-separated list of plan-prefix codes. Unlike
// classifications, prefixes aren't a fixed enum -- CSD/CCS exist in the
// data today but CSC/CSF or others could appear later -- so this only
// validates *shape* (2-6 letters), not membership in a fixed list. The DB
// is the source of truth for which prefixes actually exist (see the
// "prefixes" target branch below). Case-insensitive on input, same as
// classifications. Blank/missing yields an empty array (no filter); a
// malformed token (wrong length, non-letters) returns null so the caller
// can 400 instead of silently matching nothing.
function parsePrefixList(raw: string | null): string[] | null {
  if (raw == null || raw.trim() === "") return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed === "") continue;
    if (!/^[A-Z]{2,6}$/.test(trimmed)) return null;
    out.push(trimmed);
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const level = searchParams.get("level");
  const pool = getPool();

  if (level === "cenros") {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, COUNT(l.id)::int AS count
       FROM cenros c
       JOIN municipalities m ON m.cenro_id = c.id
       JOIN lots l ON l.municipality_id = m.id
       GROUP BY c.id, c.name
       ORDER BY c.name`
    );
    const nodes: TreeNode[] = rows.map((r) => ({ id: r.id, label: r.name, count: r.count }));
    return NextResponse.json(nodes);
  }

  if (level === "municipalities") {
    const cenroId = searchParams.get("cenro_id");
    const { rows } = cenroId
      ? await pool.query(
          `SELECT m.id, m.name, COUNT(l.id)::int AS count
           FROM municipalities m
           JOIN lots l ON l.municipality_id = m.id
           WHERE m.cenro_id = $1
           GROUP BY m.id, m.name
           ORDER BY m.name`,
          [cenroId]
        )
      : await pool.query(
          `SELECT m.id, m.name, COUNT(l.id)::int AS count
           FROM municipalities m
           JOIN lots l ON l.municipality_id = m.id
           GROUP BY m.id, m.name
           ORDER BY m.name`
        );
    const nodes: TreeNode[] = rows.map((r) => ({ id: r.id, label: r.name, count: r.count }));
    return NextResponse.json(nodes);
  }

  if (level === "barangays") {
    const municipalityId = searchParams.get("municipality_id");
    if (!municipalityId) {
      return NextResponse.json({ error: "municipality_id is required" }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT b.id, b.name, COUNT(l.id)::int AS count
       FROM barangays b
       JOIN lots l ON l.barangay_id = b.id
       WHERE b.municipality_id = $1
       GROUP BY b.id, b.name
       ORDER BY b.name`,
      [municipalityId]
    );
    const nodes: TreeNode[] = rows.map((r) => ({ id: r.id, label: r.name, count: r.count }));
    return NextResponse.json(nodes);
  }

  if (level === "years") {
    const barangayId = searchParams.get("barangay_id");
    if (!barangayId) {
      return NextResponse.json({ error: "barangay_id is required" }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT EXTRACT(YEAR FROM date_surveyed)::int AS year, COUNT(*)::int AS count
       FROM lots
       WHERE barangay_id = $1 AND date_surveyed IS NOT NULL
       GROUP BY year
       ORDER BY year DESC`,
      [barangayId]
    );
    const nodes: TreeNode[] = rows.map((r) => ({ id: r.year, label: String(r.year), count: r.count }));
    return NextResponse.json(nodes);
  }

  if (level === "facets") {
    const target = searchParams.get("target") as FacetTarget | null;
    if (!target || !FACET_TARGETS.includes(target)) {
      return NextResponse.json(
        { error: `target must be one of: ${FACET_TARGETS.join(", ")}` },
        { status: 400 }
      );
    }

    const cenroIds = parseIntList(searchParams.get("cenro_ids"));
    const municipalityIds = parseIntList(searchParams.get("municipality_ids"));
    const barangayIds = parseIntList(searchParams.get("barangay_ids"));
    const years = parseIntList(searchParams.get("years"));
    const classifications = parseClassificationList(searchParams.get("classifications"));
    const prefixes = parsePrefixList(searchParams.get("prefixes"));

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
            "cenro_ids, municipality_ids, barangay_ids, and years must be comma-separated integers; " +
            "classifications must be a comma-separated list of RFPA and/or FPA; " +
            "prefixes must be a comma-separated list of 2-6 letter codes (e.g. CSD,CCS).",
        },
        { status: 400 }
      );
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    function addParam(value: unknown): string {
      params.push(value);
      return `$${params.length}`;
    }

    // Every facet EXCEPT the one we're listing constrains the result --
    // see file-top note on why target never filters itself.
    if (target !== "cenros" && cenroIds.length > 0) {
      conditions.push(`m.cenro_id = ANY(${addParam(cenroIds)})`);
    }
    if (target !== "municipalities" && municipalityIds.length > 0) {
      conditions.push(`l.municipality_id = ANY(${addParam(municipalityIds)})`);
    }
    if (target !== "barangays" && barangayIds.length > 0) {
      conditions.push(`l.barangay_id = ANY(${addParam(barangayIds)})`);
    }
    if (target !== "years" && years.length > 0) {
      conditions.push(`EXTRACT(YEAR FROM l.date_surveyed) = ANY(${addParam(years)})`);
    }
    if (target !== "classifications" && classifications.length > 0) {
      conditions.push(`(${CLASSIFICATION_CASE_SQL}) = ANY(${addParam(classifications)})`);
    }
    if (target !== "prefixes" && prefixes.length > 0) {
      conditions.push(`(${PLAN_PREFIX_SQL}) = ANY(${addParam(prefixes)})`);
    }

    let sql: string;
    if (target === "cenros") {
      conditions.push("c.id IS NOT NULL");
      sql = `
        SELECT c.id, c.name AS label, COUNT(DISTINCT l.id)::int AS count
        FROM lots l
        JOIN municipalities m ON m.id = l.municipality_id
        JOIN cenros c ON c.id = m.cenro_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY c.id, c.name
        ORDER BY c.name
      `;
    } else if (target === "municipalities") {
      conditions.push("m.id IS NOT NULL");
      sql = `
        SELECT m.id, m.name AS label, COUNT(DISTINCT l.id)::int AS count
        FROM lots l
        JOIN municipalities m ON m.id = l.municipality_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY m.id, m.name
        ORDER BY m.name
      `;
    } else if (target === "barangays") {
      conditions.push("b.id IS NOT NULL");
      sql = `
        SELECT b.id, b.name AS label, COUNT(DISTINCT l.id)::int AS count
        FROM lots l
        JOIN municipalities m ON m.id = l.municipality_id
        JOIN barangays b ON b.id = l.barangay_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY b.id, b.name
        ORDER BY b.name
      `;
    } else if (target === "years") {
      conditions.push("l.date_surveyed IS NOT NULL");
      sql = `
        SELECT
          EXTRACT(YEAR FROM l.date_surveyed)::int AS id,
          EXTRACT(YEAR FROM l.date_surveyed)::text AS label,
          COUNT(DISTINCT l.id)::int AS count
        FROM lots l
        JOIN municipalities m ON m.id = l.municipality_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY 1, 2
        ORDER BY 1 DESC
      `;
    } else if (target === "prefixes") {
      // prefixes — not a real table, so id/label are the derived letter
      // codes themselves (e.g. 'CSD', 'CCS'), grouped from the same
      // PLAN_PREFIX_SQL expression used to filter every other target.
      // Rows whose survey_no doesn't yield a prefix (null/blank/no
      // leading letters) are excluded rather than falling into a bucket.
      conditions.push(`${PLAN_PREFIX_SQL} IS NOT NULL`);
      sql = `
        SELECT pfx AS id, pfx AS label, COUNT(*)::int AS count
        FROM (
          SELECT l.id, ${PLAN_PREFIX_SQL} AS pfx
          FROM lots l
          JOIN municipalities m ON m.id = l.municipality_id
          WHERE ${conditions.join(" AND ")}
        ) sub
        GROUP BY pfx
        ORDER BY pfx
      `;
    } else {
      // classifications — not a real table, so id/label are the literal
      // 'RFPA'/'FPA' strings, grouped from the same CASE expression used to
      // filter every other target. Lots whose municipality has no rule at
      // either level (get_rfpa_threshold() IS NULL) are excluded rather
      // than falling into either bucket.
      conditions.push("get_rfpa_threshold(l.municipality_id) IS NOT NULL");
      sql = `
        SELECT cls AS id, cls AS label, COUNT(*)::int AS count
        FROM (
          SELECT l.id, ${CLASSIFICATION_CASE_SQL} AS cls
          FROM lots l
          JOIN municipalities m ON m.id = l.municipality_id
          WHERE ${conditions.join(" AND ")}
        ) sub
        GROUP BY cls
        ORDER BY cls
      `;
    }

    const { rows } = await pool.query(sql, params);
    const nodes: TreeNode[] = rows.map((r) => ({ id: r.id, label: r.label, count: r.count }));
    return NextResponse.json(nodes);
  }

  return NextResponse.json(
    { error: "level must be one of: cenros, municipalities, barangays, years, facets" },
    { status: 400 }
  );
}
// Target path: src/app/api/map/tree/route.ts
//
// FACETED CROSS-FILTERING (this pass): ProjectionModal.tsx no longer renders
// a nested tree. It's 4 flat tabs — CENRO / Municipality / Barangay / Year —
// each a checkbox list, and checking boxes in one tab narrows what shows up
// in the OTHER three (e.g. checking Year 2023 makes the Municipality tab
// only list municipalities that actually have lots surveyed in 2023).
//
// New mode added to support that: `level=facets&target=<level>` plus
// whichever facet arrays are currently checked (`cenro_ids`,
// `municipality_ids`, `barangay_ids`, `years`, all comma-separated). It
// returns {id, label, count} for `target`, filtered by every OTHER
// non-empty facet array — deliberately NOT filtered by target's own array,
// since a facet list filtered by itself would hide every option the user
// hasn't already checked, making it impossible to discover or uncheck
// anything.
//
// The original per-level endpoints (`level=cenros/municipalities/
// barangays/years`) are UNCHANGED and still used by Sidebar.tsx's own
// Layers-tab tree (Municipality -> Barangay -> Year, unscoped by CENRO) —
// that tree is a separate, simpler "browse and check one year" flow and
// wasn't part of this pass.
//
// Usage:
//   /api/map/tree?level=cenros
//   /api/map/tree?level=municipalities                  (all, unscoped — Sidebar tree)
//   /api/map/tree?level=municipalities&cenro_id=3        (single-scoped — legacy)
//   /api/map/tree?level=barangays&municipality_id=5
//   /api/map/tree?level=years&barangay_id=12
//   /api/map/tree?level=facets&target=municipalities&cenro_ids=1,2&years=2023,2024
//     -> municipalities with lots under CENRO 1 or 2 AND surveyed in 2023 or 2024
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

interface TreeNode {
  id: number | string;
  label: string;
  count: number;
}

const FACET_TARGETS = ["cenros", "municipalities", "barangays", "years"] as const;
type FacetTarget = (typeof FACET_TARGETS)[number];

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

    if (cenroIds == null || municipalityIds == null || barangayIds == null || years == null) {
      return NextResponse.json(
        { error: "cenro_ids, municipality_ids, barangay_ids, and years must be comma-separated integers." },
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
    } else {
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
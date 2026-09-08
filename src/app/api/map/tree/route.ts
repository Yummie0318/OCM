// Target path: src/app/api/map/tree/route.ts
//
// CENRO SCOPING NOW OPTIONAL (this pass): `level=municipalities` no longer
// REQUIRES `cenro_id` — it's back to optional, same as before CENRO
// support was added. Two different callers need two different things now:
//   - Sidebar.tsx's tree (Layers tab) stayed Municipality -> Barangay ->
//     Year, unscoped by CENRO — it calls this with no cenro_id and expects
//     every municipality with saved lots, same as originally.
//   - ProjectionModal.tsx's "Project layers" modal is the one place CENRO
//     shows up in the UI — it calls this WITH cenro_id to list only the
//     municipalities under whichever CENRO the user just expanded.
// `level=cenros` (added alongside the original CENRO pass) is unchanged.
//
// Only Year is selectable (checkbox) in the sidebar tree; Municipality and
// Barangay are plain expand/collapse folders. Only returns nodes that
// actually have saved lots (no empty branches).
//
// Usage:
//   /api/map/tree?level=cenros
//   /api/map/tree?level=municipalities                  (all, unscoped — Sidebar)
//   /api/map/tree?level=municipalities&cenro_id=3        (scoped — ProjectionModal)
//   /api/map/tree?level=barangays&municipality_id=5
//   /api/map/tree?level=years&barangay_id=12
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

interface TreeNode {
  id: number | string;
  label: string;
  count: number;
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

  return NextResponse.json(
    { error: "level must be one of: cenros, municipalities, barangays, years" },
    { status: 400 }
  );
}
// Target path in your project: src/app/api/map/tree/route.ts
//
// Powers the sidebar tree: Municipality -> Barangay -> Year. Only Year is
// selectable (checkbox); Municipality and Barangay are plain expand/collapse
// folders. Sheet was dropped — the UI never used it after the redesign.
// Only returns nodes that actually have saved lots (no empty branches).
//
// Usage:
//   /api/map/tree?level=municipalities
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

  if (level === "municipalities") {
    const { rows } = await pool.query(
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
    { error: "level must be one of: municipalities, barangays, years" },
    { status: 400 }
  );
}
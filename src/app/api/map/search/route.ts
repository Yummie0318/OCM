// Target path: src/app/api/map/search/route.ts
//
// Typeahead search across owner name, lot no., survey no., and patent no.
// Returns lightweight rows (no polygon geometry) plus a centroid point, so
// results render instantly; the full polygon is fetched separately via
// /api/map/lots?id= once the user picks a result.
//
// Usage:
//   /api/map/search?q=dela+cruz
//   /api/map/search?q=8208-B&limit=10
//   /api/map/search?surveyor_id=7   (report: every lot by one surveyor)
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const surveyorId = searchParams.get("surveyor_id");
  const limitParam = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

  if (!q && !surveyorId) {
    return NextResponse.json(
      { error: "Provide q (search text) or surveyor_id." },
      { status: 400 }
    );
  }

  const conditions: string[] = ["l.geom IS NOT NULL"];
  const params: unknown[] = [];

  function addParam(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  if (surveyorId) {
    conditions.push(`l.surveyor_id = ${addParam(surveyorId)}`);
  }

  if (q) {
    const needle = `%${q}%`;
    const p = addParam(needle);
    conditions.push(
      `(
        l.owner_surname ILIKE ${p}
        OR l.owner_given_name ILIKE ${p}
        OR (l.owner_surname || ' ' || l.owner_given_name) ILIKE ${p}
        OR l.lot_no ILIKE ${p}
        OR l.survey_no ILIKE ${p}
        OR l.patent_no ILIKE ${p}
      )`
    );
  }

  const sql = `
    SELECT
      l.id, l.lot_no, l.owner_given_name, l.owner_surname,
      l.survey_no, l.patent_no,
      ST_X(ST_Centroid(l.geom)) AS lng, ST_Y(ST_Centroid(l.geom)) AS lat,
      p.name AS province_name, m.name AS municipality_name, b.name AS barangay_name,
      s.name AS surveyor_name
    FROM lots l
    LEFT JOIN provinces p ON p.id = l.province_id
    LEFT JOIN municipalities m ON m.id = l.municipality_id
    LEFT JOIN barangays b ON b.id = l.barangay_id
    LEFT JOIN surveyors s ON s.id = l.surveyor_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY l.owner_surname NULLS LAST
    LIMIT ${addParam(limit)}
  `;

  const pool = getPool();
  const { rows } = await pool.query(sql, params);

  const results = rows.map((row) => ({
    id: row.id,
    lotNo: row.lot_no,
    owner: [row.owner_surname, row.owner_given_name].filter(Boolean).join(", "),
    province: row.province_name,
    municipality: row.municipality_name,
    barangay: row.barangay_name,
    surveyNo: row.survey_no,
    patentNo: row.patent_no,
    surveyor: row.surveyor_name,
    lng: row.lng,
    lat: row.lat,
  }));

  return NextResponse.json(results);
}
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

export interface ControlPointRow {
  id: number;
  tie_point_name: string;
  municipality_name: string;
  province_name: string;
  lpcs_northing: number;
  lpcs_easting: number;
  ppcs_easting: number;
  ppcs_northing: number;
  lon_deg: number | null;
  lon_min: number | null;
  lon_sec: number | null;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();

  // Require at least 2 characters before hitting the DB with ~1900 rows -
  // avoids dumping the whole table on an empty/near-empty query.
  if (q.length < 2) {
    return NextResponse.json({ rows: [] });
  }

  try {
    const pool = getPool();
    const like = `%${q}%`;
    const { rows } = await pool.query<ControlPointRow>(
      `SELECT id, tie_point_name, municipality_name, province_name,
              lpcs_northing, lpcs_easting, ppcs_easting, ppcs_northing,
              lon_deg, lon_min, lon_sec
       FROM control_points
       WHERE tie_point_name ILIKE $1
          OR municipality_name ILIKE $1
          OR province_name ILIKE $1
       ORDER BY municipality_name, tie_point_name
       LIMIT 25`,
      [like]
    );
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("control-points search failed:", err);
    return NextResponse.json(
      { rows: [], error: "Could not reach the control points database." },
      { status: 500 }
    );
  }
}
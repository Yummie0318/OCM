// Target path in your project: src/app/api/lot-sheets/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const pool = getPool();

  const sheetResult = await pool.query(
    `SELECT ls.*, cp.tie_point_name, cp.province_name, cp.municipality_name,
            u.username AS created_by_username
     FROM lot_sheets ls
     LEFT JOIN control_points cp ON cp.id = ls.control_point_id
     LEFT JOIN users u ON u.id = ls.created_by
     WHERE ls.id = $1`,
    [params.id]
  );

  if (sheetResult.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lotsResult = await pool.query(
    `SELECT l.*, p.name AS province_name, m.name AS municipality_name,
            b.name AS barangay_name, s.name AS surveyor_name, s.position AS surveyor_position
     FROM lots l
     LEFT JOIN provinces p ON p.id = l.province_id
     LEFT JOIN municipalities m ON m.id = l.municipality_id
     LEFT JOIN barangays b ON b.id = l.barangay_id
     LEFT JOIN surveyors s ON s.id = l.surveyor_id
     WHERE l.lot_sheet_id = $1
     ORDER BY l.lot_no`,
    [params.id]
  );

  return NextResponse.json({
    ...sheetResult.rows[0],
    lots: lotsResult.rows,
  });
}
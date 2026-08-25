// Target path in your project: src/app/api/barangays/route.ts
// Usage: /api/barangays?municipality_id=1
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const municipalityId = searchParams.get("municipality_id");
  const pool = getPool();

  const { rows } = municipalityId
    ? await pool.query(
        "SELECT id, name, municipality_id FROM barangays WHERE municipality_id = $1 ORDER BY name",
        [municipalityId]
      )
    : await pool.query(
        "SELECT id, name, municipality_id FROM barangays ORDER BY name"
      );

  return NextResponse.json(rows);
}
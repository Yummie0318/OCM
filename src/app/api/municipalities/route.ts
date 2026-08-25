// Target path in your project: src/app/api/municipalities/route.ts
// Usage: /api/municipalities?province_id=1
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provinceId = searchParams.get("province_id");
  const pool = getPool();

  const { rows } = provinceId
    ? await pool.query(
        "SELECT id, name, type, province_id FROM municipalities WHERE province_id = $1 ORDER BY name",
        [provinceId]
      )
    : await pool.query(
        "SELECT id, name, type, province_id FROM municipalities ORDER BY name"
      );

  return NextResponse.json(rows);
}
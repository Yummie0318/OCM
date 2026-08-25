// Target path in your project: src/app/api/provinces/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, name, region FROM provinces ORDER BY name"
  );
  return NextResponse.json(rows);
}
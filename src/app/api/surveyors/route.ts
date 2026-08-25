// Target path in your project: src/app/api/surveyors/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, name, position FROM surveyors ORDER BY name"
  );
  return NextResponse.json(rows);
}
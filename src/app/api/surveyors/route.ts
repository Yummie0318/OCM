// Target path in your project: src/app/api/surveyors/route.ts
//
// GET  -> list surveyors (any logged-in user; the lot form dropdown needs it).
//         With ?counts=1 (superadmin only) each row also has lot_count.
// POST -> create a surveyor { name, position } (superadmin only)

import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireManager } from "@/lib/current-user";

export async function GET(request: Request) {
  const pool = getPool();
  const wantCounts = new URL(request.url).searchParams.get("counts") === "1";

  if (!wantCounts) {
    const { rows } = await pool.query(
      "SELECT id, name, position FROM surveyors ORDER BY name"
    );
    return NextResponse.json(rows);
  }

  const guard = await requireManager();
  if (guard.error) return guard.error;
  if (guard.user.usertype !== "superadmin") {
    return NextResponse.json({ error: "Only a superadmin can manage surveyors." }, { status: 403 });
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.position, COUNT(l.surveyor_id)::int AS lot_count
     FROM surveyors s
     LEFT JOIN lots l ON l.surveyor_id = s.id
     GROUP BY s.id
     ORDER BY s.name`
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const guard = await requireManager();
  if (guard.error) return guard.error;
  if (guard.user.usertype !== "superadmin") {
    return NextResponse.json({ error: "Only a superadmin can manage surveyors." }, { status: 403 });
  }

  let body: { name?: string; position?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Uppercased to match the existing data (and so "juan" and "JUAN" can't
  // both slip past the unique constraint on name).
  const name = body.name?.trim().toUpperCase();
  const position = body.position?.trim().toUpperCase();

  if (!name || !position) {
    return NextResponse.json({ error: "Name and position are required." }, { status: 400 });
  }
  if (name.length > 150) {
    return NextResponse.json({ error: "Name must be 150 characters or fewer." }, { status: 400 });
  }
  if (position.length > 100) {
    return NextResponse.json({ error: "Position must be 100 characters or fewer." }, { status: 400 });
  }

  try {
    const { rows } = await getPool().query(
      "INSERT INTO surveyors (name, position) VALUES ($1, $2) RETURNING id, name, position",
      [name, position]
    );
    return NextResponse.json({ surveyor: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "A surveyor with that name already exists." }, { status: 409 });
    }
    throw err;
  }
}
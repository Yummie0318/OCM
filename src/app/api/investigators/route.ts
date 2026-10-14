// GET  -> list investigators (any logged-in user, the lot form needs it)
//         With ?counts=1 (superadmin only) each row also has lot_count.
// POST -> create one { name }. Returns the existing one if the name already exists.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";
import { requireManager } from "@/lib/current-user";

export async function GET(request: Request) {
  const pool = getPool();
  const wantCounts = new URL(request.url).searchParams.get("counts") === "1";

  if (!wantCounts) {
    const { rows } = await pool.query("SELECT id, name FROM investigators ORDER BY name");
    return NextResponse.json(rows);
  }

  const guard = await requireManager();
  if (guard.error) return guard.error;
  if (guard.user.usertype !== "superadmin") {
    return NextResponse.json({ error: "Only a superadmin can manage investigators." }, { status: 403 });
  }

  const { rows } = await pool.query(
    `SELECT i.id, i.name, COUNT(l.investigator_id)::int AS lot_count
     FROM investigators i
     LEFT JOIN lots l ON l.investigator_id = i.id
     GROUP BY i.id
     ORDER BY i.name`
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().toUpperCase() : "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (name.length > 255) {
    return NextResponse.json({ error: "Name must be 255 characters or fewer." }, { status: 400 });
  }

  const pool = getPool();
  const existing = await pool.query(
    "SELECT id, name FROM investigators WHERE lower(TRIM(BOTH FROM name)) = lower($1)",
    [name]
  );
  if (existing.rows.length > 0) {
    return NextResponse.json({ investigator: existing.rows[0] });
  }

  const { rows } = await pool.query(
    "INSERT INTO investigators (name) VALUES ($1) RETURNING id, name",
    [name]
  );
  return NextResponse.json({ investigator: rows[0] }, { status: 201 });
}
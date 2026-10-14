// PATCH  -> rename { name }   (superadmin only)
// DELETE -> remove, only if no lot uses it (superadmin only)
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireManager } from "@/lib/current-user";

async function guard() {
  const g = await requireManager();
  if (g.error) return { error: g.error };
  if (g.user.usertype !== "superadmin") {
    return {
      error: NextResponse.json({ error: "Only a superadmin can manage investigators." }, { status: 403 }),
    };
  }
  return { error: null };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.error) return g.error;

  const { id } = await params;
  const invId = Number(id);
  if (!Number.isInteger(invId) || invId <= 0) {
    return NextResponse.json({ error: "Invalid investigator id." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().toUpperCase() : "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (name.length > 255) {
    return NextResponse.json({ error: "Name must be 255 characters or fewer." }, { status: 400 });
  }

  try {
    const { rows } = await getPool().query(
      "UPDATE investigators SET name = $1 WHERE id = $2 RETURNING id, name",
      [name, invId]
    );
    if (rows.length === 0) return NextResponse.json({ error: "Investigator not found." }, { status: 404 });
    return NextResponse.json({ investigator: rows[0] });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "An investigator with that name already exists." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.error) return g.error;

  const { id } = await params;
  const invId = Number(id);
  if (!Number.isInteger(invId) || invId <= 0) {
    return NextResponse.json({ error: "Invalid investigator id." }, { status: 400 });
  }

  const pool = getPool();
  const used = await pool.query(
    `SELECT (SELECT count(*) FROM lots WHERE investigator_id = $1)::int
          + (SELECT count(*) FROM lots_archive WHERE investigator_id = $1)::int AS n`,
    [invId]
  );
  if (used.rows[0].n > 0) {
    return NextResponse.json(
      { error: `This investigator is used by ${used.rows[0].n} lot(s), so it can't be deleted.` },
      { status: 409 }
    );
  }

  const { rowCount } = await pool.query("DELETE FROM investigators WHERE id = $1", [invId]);
  if (!rowCount) return NextResponse.json({ error: "Investigator not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
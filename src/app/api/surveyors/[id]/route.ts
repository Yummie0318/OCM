// Target path: src/app/api/surveyors/[id]/route.ts
//
// PATCH  { name, position } -> edit a surveyor (superadmin only)
// DELETE                    -> delete a surveyor (superadmin only).
//   lots.surveyor_id is ON DELETE RESTRICT, so a surveyor that still has
//   lots is refused with 409 instead of being deleted.

import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireManager } from "@/lib/current-user";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireManager();
  if (guard.error) return guard.error;
  if (guard.user.usertype !== "superadmin") {
    return NextResponse.json({ error: "Only a superadmin can manage surveyors." }, { status: 403 });
  }

  const { id } = await params;
  const surveyorId = Number(id);
  if (!Number.isInteger(surveyorId)) {
    return NextResponse.json({ error: "Invalid surveyor id." }, { status: 400 });
  }

  let body: { name?: string; position?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

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
      "UPDATE surveyors SET name = $1, position = $2 WHERE id = $3 RETURNING id, name, position",
      [name, position, surveyorId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Surveyor not found." }, { status: 404 });
    }
    return NextResponse.json({ surveyor: rows[0] });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "A surveyor with that name already exists." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireManager();
  if (guard.error) return guard.error;
  if (guard.user.usertype !== "superadmin") {
    return NextResponse.json({ error: "Only a superadmin can manage surveyors." }, { status: 403 });
  }

  const { id } = await params;
  const surveyorId = Number(id);
  if (!Number.isInteger(surveyorId)) {
    return NextResponse.json({ error: "Invalid surveyor id." }, { status: 400 });
  }

  const pool = getPool();

  const { rows: used } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM lots WHERE surveyor_id = $1",
    [surveyorId]
  );
  if (used[0].n > 0) {
    return NextResponse.json(
      {
        error: `This surveyor is assigned to ${used[0].n} lot${used[0].n === 1 ? "" : "s"} and can't be deleted.`,
      },
      { status: 409 }
    );
  }

  try {
    const result = await pool.query("DELETE FROM surveyors WHERE id = $1", [surveyorId]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Surveyor not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    // Someone assigned this surveyor to a lot between the count and the delete.
    if ((err as { code?: string })?.code === "23503") {
      return NextResponse.json(
        { error: "This surveyor is assigned to lots and can't be deleted." },
        { status: 409 }
      );
    }
    throw err;
  }
}
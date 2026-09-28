// Target path: src/app/api/users/[id]/reset-password/route.ts
//
// POST -> generates a new temporary password for another user, forces them
// to change it at next login, and returns it ONCE in `temporaryPassword`.
// You can't reset your own password here -- use /api/auth/change-password.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { requireManager, canManage, generateTempPassword, type UserType } from "@/lib/current-user";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireManager();
  if (guard.error) return guard.error;
  const actor = guard.user;

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }
  if (targetId === actor.id) {
    return NextResponse.json(
      { error: "Use the change-password option for your own account." },
      { status: 403 }
    );
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT usertype FROM users WHERE id = $1", [targetId]);
  const target = rows[0] as { usertype: UserType } | undefined;
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (!canManage(actor.usertype, target.usertype)) {
    return NextResponse.json({ error: "You cannot reset this user's password." }, { status: 403 });
  }

  const temporaryPassword = generateTempPassword();
  const hash = await bcrypt.hash(temporaryPassword, 12);
  await pool.query("UPDATE users SET password = $1, must_change_password = TRUE WHERE id = $2", [
    hash,
    targetId,
  ]);

  return NextResponse.json({ temporaryPassword });
}
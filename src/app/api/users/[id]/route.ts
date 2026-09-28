// Target path: src/app/api/users/[id]/route.ts
//
// PATCH { username?, email?, usertype?, is_active? } -> edit a user.
//
// There is deliberately NO DELETE. Deactivate with { is_active: false }
// instead: lot_sheets.created_by and activity_logs.user_id use
// ON DELETE SET NULL, so deleting a user would erase who made those records.
//
// Rules enforced here:
//   - actor must be allowed to manage the target's CURRENT role
//   - only a superadmin can change roles
//   - nobody can change their own role or deactivate themselves
//   - the last active superadmin can never be demoted or deactivated

import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireManager, canManage, USER_TYPES, EMAIL_RE, type UserType } from "@/lib/current-user";

export async function PATCH(
  request: Request,
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

  let body: { username?: string; email?: string; usertype?: string; is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, usertype, is_active FROM users WHERE id = $1",
    [targetId]
  );
  const target = rows[0] as { id: number; usertype: UserType; is_active: boolean } | undefined;
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const isSelf = target.id === actor.id;

  // Editing yourself is fine for username/email, but never for role/status.
  if (!isSelf && !canManage(actor.usertype, target.usertype)) {
    return NextResponse.json({ error: "You cannot modify this user." }, { status: 403 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (body.username !== undefined) {
    const username = body.username.trim();
    if (!username || username.length > 50) {
      return NextResponse.json({ error: "Username must be 1-50 characters." }, { status: 400 });
    }
    add("username", username);
  }

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    add("email", email);
  }

  let losingSuperadmin = false;

  if (body.usertype !== undefined && body.usertype !== target.usertype) {
    const newRole = body.usertype as UserType;
    if (actor.usertype !== "superadmin") {
      return NextResponse.json({ error: "Only a superadmin can change roles." }, { status: 403 });
    }
    if (isSelf) {
      return NextResponse.json({ error: "You cannot change your own role." }, { status: 403 });
    }
    if (!USER_TYPES.includes(newRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    if (target.usertype === "superadmin") losingSuperadmin = true;
    add("usertype", newRole);
  }

  if (body.is_active !== undefined && body.is_active !== target.is_active) {
    if (isSelf) {
      return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 403 });
    }
    if (body.is_active === false && target.usertype === "superadmin") losingSuperadmin = true;
    add("is_active", body.is_active);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Never leave the system without an active superadmin.
  if (losingSuperadmin && target.is_active) {
    const { rows: others } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE usertype = 'superadmin' AND is_active = TRUE AND id <> $1",
      [targetId]
    );
    if (others[0].n === 0) {
      return NextResponse.json(
        { error: "There must be at least one active superadmin." },
        { status: 409 }
      );
    }
  }

  values.push(targetId);
  try {
    const { rows: updated } = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id, username, email, usertype, is_active, must_change_password, last_login_at, created_at`,
      values
    );
    return NextResponse.json({ user: updated[0] });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "Username or email already in use." }, { status: 409 });
    }
    throw err;
  }
}
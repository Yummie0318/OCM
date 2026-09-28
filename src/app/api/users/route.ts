// Target path: src/app/api/users/route.ts
//
// GET  -> list users the caller is allowed to see, plus the roles they may assign
// POST -> create a user { username, email, usertype, password? }
//         If `password` is omitted a temporary one is generated and returned
//         ONCE in `temporaryPassword`. The new user must change it at first login.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import {
  requireManager,
  canManage,
  assignableRoles,
  generateTempPassword,
  USER_TYPES,
  EMAIL_RE,
  type UserType,
} from "@/lib/current-user";

export async function GET() {
  const guard = await requireManager();
  if (guard.error) return guard.error;
  const actor = guard.user;

  // Admins only see surveyors/users; superadmins see everyone.
  const where = actor.usertype === "admin" ? "WHERE u.usertype IN ('surveyor', 'user')" : "";

  const { rows } = await getPool().query(
    `SELECT u.id, u.username, u.email, u.usertype, u.is_active,
            u.must_change_password, u.last_login_at, u.created_at,
            c.username AS created_by_username
     FROM users u
     LEFT JOIN users c ON c.id = u.created_by
     ${where}
     ORDER BY u.created_at DESC`
  );

  return NextResponse.json({ users: rows, assignableRoles: assignableRoles(actor.usertype) });
}

export async function POST(request: Request) {
  const guard = await requireManager();
  if (guard.error) return guard.error;
  const actor = guard.user;

  let body: { username?: string; email?: string; usertype?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = body.username?.trim();
  const email = body.email?.trim().toLowerCase();
  const usertype = (body.usertype ?? "user") as UserType;

  if (!username || !email) {
    return NextResponse.json({ error: "username and email are required." }, { status: 400 });
  }
  if (username.length > 50) {
    return NextResponse.json({ error: "Username must be 50 characters or fewer." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!USER_TYPES.includes(usertype)) {
    return NextResponse.json(
      { error: `usertype must be one of: ${USER_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!canManage(actor.usertype, usertype)) {
    return NextResponse.json({ error: `You cannot create a ${usertype}.` }, { status: 403 });
  }

  const generated = !body.password;
  const password = body.password ?? generateTempPassword();
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const { rows } = await getPool().query(
      `INSERT INTO users (username, email, password, usertype, created_by, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, username, email, usertype, is_active, must_change_password, created_at`,
      [username, email, passwordHash, usertype, actor.id]
    );
    return NextResponse.json(
      { user: rows[0], ...(generated ? { temporaryPassword: password } : {}) },
      { status: 201 }
    );
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "Username or email already in use." }, { status: 409 });
    }
    throw err;
  }
}
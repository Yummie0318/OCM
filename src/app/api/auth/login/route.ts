// Target path: src/app/api/auth/login/route.ts
//
// POST { identifier, password } -> sets an httpOnly session cookie and
// returns the (non-sensitive) user fields. `identifier` can be either the
// username or the email.
//
// Changes from the previous version:
//   - email match is case-insensitive
//   - records last_login_at
//   - returns mustChangePassword so the login page can send the user to a
//     "set a new password" screen instead of /map
//
// Still returns the SAME error for unknown account and wrong password, to
// prevent username/email enumeration.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { signSession, AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export async function POST(request: Request) {
  let body: { identifier?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const identifier = body.identifier?.trim();
  const password = body.password;

  if (!identifier || !password) {
    return NextResponse.json(
      { error: "Username/email and password are required." },
      { status: 400 }
    );
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, username, email, password, usertype, is_active, must_change_password
     FROM users
     WHERE username = $1 OR LOWER(email) = LOWER($1)
     LIMIT 1`,
    [identifier]
  );
  const user = rows[0];

  const invalidCredentials = () =>
    NextResponse.json({ error: "Invalid username/email or password." }, { status: 401 });

  if (!user) return invalidCredentials();

  // Check the password BEFORE revealing that the account is disabled,
  // otherwise anyone could probe which accounts exist and are disabled.
  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) return invalidCredentials();

  if (!user.is_active) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

  const token = await signSession({
    userId: user.id,
    username: user.username,
    email: user.email,
    usertype: user.usertype,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      usertype: user.usertype,
    },
    mustChangePassword: user.must_change_password,
  });

  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
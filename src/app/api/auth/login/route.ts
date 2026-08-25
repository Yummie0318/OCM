// Target path: src/app/api/auth/login/route.ts
//
// POST { identifier, password } -> sets an httpOnly session cookie and
// returns the (non-sensitive) user fields. `identifier` can be either the
// username or the email -- one field, matched against both columns, so the
// login form doesn't need to make the user pick which one they're typing.
//
// Deliberately returns the SAME error message whether the account doesn't
// exist or the password is wrong ("Invalid username/email or password").
// Returning different messages for each case lets an attacker enumerate
// which usernames/emails have accounts just by trying them one at a time.

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
    `SELECT id, username, email, password, usertype, is_active
     FROM users
     WHERE username = $1 OR email = $1
     LIMIT 1`,
    [identifier]
  );
  const user = rows[0];

  const invalidCredentials = () =>
    NextResponse.json({ error: "Invalid username/email or password." }, { status: 401 });

  if (!user) return invalidCredentials();
  if (!user.is_active) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) return invalidCredentials();

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
// Target path: src/app/api/auth/register/route.ts
//
// POST { username, email, password, usertype? } -> creates a row in `users`.
//
// *** SETUP-ONLY ENDPOINT -- THIS HAS NO AUTH CHECK. ***
// You have no users yet, so something has to be able to create the first
// one without already being logged in. Once you've created the accounts
// you need (including your own admin account), lock this down -- either:
//   (a) delete this file, and re-add it later gated behind "caller must
//       already be logged in as usertype = admin", or
//   (b) temporarily guard it, e.g.:
//         if (process.env.ALLOW_REGISTRATION !== "true") {
//           return NextResponse.json({ error: "Not found" }, { status: 404 });
//         }
//       and only set ALLOW_REGISTRATION=true in your local .env while
//       seeding accounts.
// Leaving it open in production means anyone who finds the URL can create
// an account for themselves, including as "admin".

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";

const VALID_USERTYPES = ["admin", "surveyor", "user"];

export async function POST(request: Request) {
  let body: { username?: string; email?: string; password?: string; usertype?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = body.username?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const usertype = body.usertype ?? "user";

  if (!username || !email || !password) {
    return NextResponse.json(
      { error: "username, email, and password are required." },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!VALID_USERTYPES.includes(usertype)) {
    return NextResponse.json(
      { error: `usertype must be one of: ${VALID_USERTYPES.join(", ")}` },
      { status: 400 }
    );
  }

  // Cost factor 12 -- a reasonable balance of security vs. login latency
  // as of 2026 hardware. Higher is slower but harder to brute-force offline.
  const passwordHash = await bcrypt.hash(password, 12);

  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password, usertype)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, usertype`,
      [username, email, passwordHash, usertype]
    );
    return NextResponse.json({ user: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    // Postgres unique_violation
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "Username or email already in use." }, { status: 409 });
    }
    throw err;
  }
}
// Target path: src/app/api/auth/login/route.ts
//
// POST { identifier, password } -> sets an httpOnly session cookie and
// returns the (non-sensitive) user fields. `identifier` can be either the
// username or the email.
//
// Security features:
//   - Rate limiting: failed attempts are logged in `login_attempts`.
//     5 failures per account or 20 per IP inside 15 minutes -> HTTP 429
//     with the exact number of seconds left (`retryAfter`) so the login
//     page can show a live countdown.
//   - Constant-time-ish: bcrypt always runs, even for unknown accounts.
//   - Same error for unknown account and wrong password (no enumeration).
//   - Input length limits before any DB / bcrypt work.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { signSession, AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

const WINDOW_MINUTES = 15;
const MAX_FAILS_PER_ACCOUNT = 5; // wrong tries per username/email per window
const MAX_FAILS_PER_IP = 20; // wrong tries per IP per window

// Used so a missing account still costs one bcrypt compare (no timing leak).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

function getIp(request: Request): string {
  // Only trustworthy if you're behind a proxy/host that sets this header
  // (Vercel, Nginx, Cloudflare...). Otherwise it can be spoofed.
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "unknown").trim();
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts.", retryAfter: retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

// Returns how many seconds this account/IP is still locked for (0 = not locked).
async function getLockSeconds(
  pool: ReturnType<typeof getPool>,
  key: string,
  ip: string
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE identifier = $1) AS by_account,
       COUNT(*) FILTER (WHERE ip = $2)         AS by_ip,
       CEIL(EXTRACT(EPOCH FROM (
         MIN(created_at) FILTER (WHERE identifier = $1) + ($3 || ' minutes')::interval - now()
       ))) AS account_wait,
       CEIL(EXTRACT(EPOCH FROM (
         MIN(created_at) FILTER (WHERE ip = $2) + ($3 || ' minutes')::interval - now()
       ))) AS ip_wait
     FROM login_attempts
     WHERE success = FALSE
       AND created_at > now() - ($3 || ' minutes')::interval`,
    [key, ip, String(WINDOW_MINUTES)]
  );
  const c = rows[0];
  const waits: number[] = [];
  if (Number(c.by_account) >= MAX_FAILS_PER_ACCOUNT) waits.push(Number(c.account_wait) || 0);
  if (Number(c.by_ip) >= MAX_FAILS_PER_IP) waits.push(Number(c.ip_wait) || 0);
  return waits.length > 0 ? Math.max(1, ...waits) : 0;
}

export async function POST(request: Request) {
  let body: { identifier?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!identifier || !password) {
    return NextResponse.json({ error: "Username/email and password are required." }, { status: 400 });
  }

  const invalidCredentials = () =>
    NextResponse.json({ error: "Invalid username/email or password." }, { status: 401 });

  // Reject absurd input before doing any database or bcrypt work.
  if (identifier.length > 254 || password.length > 128) return invalidCredentials();

  const pool = getPool();
  const ip = getIp(request);
  const key = identifier.toLowerCase();

  // Occasional cleanup of old rows (about 1 in 20 requests).
  if (Math.random() < 0.05) {
    pool.query("DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'").catch(() => {});
  }

  // Already locked? Refuse before touching the password.
  const lockedFor = await getLockSeconds(pool, key, ip);
  if (lockedFor > 0) return tooMany(lockedFor);

  const { rows } = await pool.query(
    `SELECT id, username, email, password, usertype, is_active, must_change_password
     FROM users
     WHERE username = $1 OR LOWER(email) = LOWER($1)
     LIMIT 1`,
    [identifier]
  );
  const user = rows[0];

  // Always run bcrypt, even when the account doesn't exist.
  const passwordMatches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

  if (!user || !passwordMatches) {
    await pool.query("INSERT INTO login_attempts (identifier, ip, success) VALUES ($1, $2, FALSE)", [key, ip]);
    // If THIS failure used up the last allowed try, lock right now so the
    // login page freezes immediately instead of on the next click.
    const nowLocked = await getLockSeconds(pool, key, ip);
    if (nowLocked > 0) return tooMany(nowLocked);
    return invalidCredentials();
  }

  // Password was correct; only now reveal that the account is disabled.
  if (!user.is_active) {
    return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
  }

  // Success: clear this account's failed attempts.
  await pool.query("DELETE FROM login_attempts WHERE identifier = $1", [key]);
  await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

  const token = await signSession({
    userId: user.id,
    username: user.username,
    email: user.email,
    usertype: user.usertype,
  });

  const response = NextResponse.json({
    user: { id: user.id, username: user.username, email: user.email, usertype: user.usertype },
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
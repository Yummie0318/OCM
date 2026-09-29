import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";

type Result =
  | { ok: true; userId: number; username: string }
  | { ok: false; status: number; error: string };

// Server-side gate for superadmin-only routes. The UI hides the edit
// buttons for everyone else, but the API must enforce it too, since
// anyone can call these endpoints directly.
export async function requireSuperAdmin(): Promise<Result> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) return { ok: false, status: 401, error: "Not authenticated." };

  // Read usertype fresh from the DB rather than trusting the cookie, so a
  // demoted user loses access immediately.
  const pool = getPool();
  const { rows } = await pool.query(`SELECT usertype FROM users WHERE id = $1`, [session.userId]);

  if (rows[0]?.usertype !== "superadmin") {
    return { ok: false, status: 403, error: "Superadmin access required." };
  }
  return { ok: true, userId: session.userId, username: session.username };
}
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";

export type EditorAuth = {
  ok: true;
  userId: number;
  username: string;
  usertype: "superadmin" | "admin";
};

type Result = EditorAuth | { ok: false; status: number; error: string };

// Gate for edit routes: superadmin and admin may pass. Admins are still
// limited to sheets/lots they created, which routes check with
// canEditRecord() below.
export async function requireEditor(): Promise<Result> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) return { ok: false, status: 401, error: "Not authenticated." };

  // Read usertype fresh from the DB so a demoted/deactivated user loses access immediately.
  const pool = getPool();
  const { rows } = await pool.query(`SELECT usertype, is_active FROM users WHERE id = $1`, [session.userId]);
  const usertype = rows[0]?.usertype;

  if (!rows[0] || rows[0].is_active === false) {
    return { ok: false, status: 403, error: "Account is disabled." };
  }
  if (usertype !== "superadmin" && usertype !== "admin") {
    return { ok: false, status: 403, error: "Admin access required." };
  }
  return { ok: true, userId: session.userId, username: session.username, usertype };
}

// Superadmin: always. Admin: only when they created the sheet.
// `createdBy` is lot_sheets.created_by.
export function canEditRecord(auth: EditorAuth, createdBy: number | string | null | undefined): boolean {
  if (auth.usertype === "superadmin") return true;
  return createdBy != null && Number(createdBy) === auth.userId;
}
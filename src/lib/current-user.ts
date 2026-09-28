// Target path: src/lib/current-user.ts
//
// Shared helpers for the user-management API routes.
//
// Why re-read the user from the DB instead of trusting the JWT?
// The JWT's `usertype` is frozen at login time. If a superadmin demotes or
// deactivates someone, their old cookie would keep working until it expires.
// Checking the DB on each request means role changes and deactivation take
// effect immediately.
//
// NOTE: this file uses `pg` and `crypto`, so import it ONLY from route
// handlers -- never from middleware.ts (Edge runtime).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";
import { getPool } from "@/lib/db";

export type UserType = "superadmin" | "admin" | "surveyor" | "user";
export const USER_TYPES: UserType[] = ["superadmin", "admin", "surveyor", "user"];

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  usertype: UserType;
  must_change_password: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  const { rows } = await getPool().query(
    `SELECT id, username, email, usertype, must_change_password
     FROM users
     WHERE id = $1 AND is_active = TRUE`,
    [session.userId]
  );
  return (rows[0] as CurrentUser | undefined) ?? null;
}

// Can `actor` create / edit / deactivate / reset the password of a user
// whose role is `target`?
//   superadmin -> anyone
//   admin      -> only surveyor and user
//   others     -> nobody
export function canManage(actor: UserType, target: UserType): boolean {
  if (actor === "superadmin") return true;
  if (actor === "admin") return target === "surveyor" || target === "user";
  return false;
}

export function assignableRoles(actor: UserType): UserType[] {
  return USER_TYPES.filter((role) => canManage(actor, role));
}

type Guard =
  | { user: CurrentUser; error?: undefined }
  | { user?: undefined; error: NextResponse };

// Use at the top of every /api/users route.
export async function requireManager(): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (user.must_change_password) {
    return {
      error: NextResponse.json({ error: "You must change your password first." }, { status: 403 }),
    };
  }
  if (user.usertype !== "superadmin" && user.usertype !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  return { user };
}

// 12 URL-safe characters, cryptographically random. Shown to the creator
// exactly once; only the bcrypt hash is stored.
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
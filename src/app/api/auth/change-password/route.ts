// Target path: src/app/api/auth/change-password/route.ts
//
// POST { currentPassword, newPassword } -> changes the caller's own password
// and clears must_change_password. This is the one route a user with
// must_change_password = true is allowed to use.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Current and new password are required." },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current one." },
      { status: 400 }
    );
  }
  if (newPassword.length > 72) {
    return NextResponse.json(
      { error: "New password must be 72 characters or fewer." },
      { status: 400 }
    );
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT password FROM users WHERE id = $1", [user.id]);
  const matches = await bcrypt.compare(currentPassword, rows[0].password);
  if (!matches) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query("UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2", [
    hash,
    user.id,
  ]);

  return NextResponse.json({ success: true });
}
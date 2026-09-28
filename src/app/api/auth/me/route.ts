// Target path: src/app/api/auth/me/route.ts
//
// GET -> { user: {...} | null }
//
// Now reads from the database instead of trusting the JWT, so a role change
// or deactivation shows up immediately. Also returns mustChangePassword so
// the UI can force the change-password screen.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      usertype: user.usertype,
      mustChangePassword: user.must_change_password,
    },
  });
}
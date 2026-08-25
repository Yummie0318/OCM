// Target path: src/app/api/auth/logout/route.ts
//
// POST -> clears the session cookie. This is what Sidebar.tsx's
// AccountFooter "Log out" button should call, then redirect to "/".

import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  // maxAge: 0 deletes the cookie immediately rather than setting a value.
  response.cookies.set(AUTH_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
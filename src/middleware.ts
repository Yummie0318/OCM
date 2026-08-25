// Target path: src/middleware.ts  (project root of src/, NOT inside src/app)
//
// Runs before every matched request. Anything not in PUBLIC_PATHS requires
// a valid session cookie -- if it's missing or invalid, the visitor is
// bounced to "/" (the login page) with a `next` param so you can redirect
// them back to where they were headed after they sign in, e.g. in
// page.tsx's handleSubmit:
//   const next = new URLSearchParams(window.location.search).get("next");
//   router.push(next || "/map");
//
// Runs on the Edge runtime, which is why auth.ts uses `jose` instead of a
// Node-only JWT library -- bcryptjs (used for password hashing) is only
// ever imported by the login/register route handlers, never by this file.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";

const PUBLIC_PATHS = ["/", "/api/auth/login", "/api/auth/register", "/api/auth/logout"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (isPublic) {
    // Already signed in and revisiting the login page? Skip straight to the map.
    if (pathname === "/" && session) {
      return NextResponse.redirect(new URL("/map", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Runs on everything except Next's internal static/image assets and favicon
// -- adjust if you have a /public folder with other files that should stay
// unauthenticated (e.g. a logo used on the login page itself).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
// Target path: src/proxy.ts  (project root of src/, NOT inside src/app)
//
// Runs before every matched request. Anything not in PUBLIC_PATHS requires
// a valid session cookie -- if it's missing or invalid, the visitor is
// bounced to "/" (the login page) with a `next` param so you can redirect
// them back to where they were headed after they sign in, e.g. in
// page.tsx's handleSubmit:
//   const next = new URLSearchParams(window.location.search).get("next");
//   router.push(next || "/map");
//
// (Formerly middleware.ts. Next.js renamed the "middleware" convention to
// "proxy". It now runs on the Node.js runtime instead of Edge. `jose` still
// works fine here, so auth.ts doesn't need to change. bcryptjs (used for
// password hashing) is still only imported by the login/register route
// handlers, never by this file.)
//
// BACK-BUTTON AFTER LOGOUT FIX: every response for a protected page/route
// now carries Cache-Control: no-store. Without it, the browser keeps the
// page in its cache / back-forward cache, so pressing Back after logging
// out restores the old /map screen from memory without ever contacting the
// server -- meaning this proxy never runs and can't redirect. With
// no-store, the browser must re-request the page on Back, the cookie is
// gone, and the visitor is sent to the login page.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";

const PUBLIC_PATHS = ["/", "/api/auth/login", "/api/auth/logout"];

// Applies the no-cache headers to any response we return for a protected
// page (or the redirect away from one).
function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (isPublic) {
    // Already signed in and revisiting the login page? Skip straight to the map.
    if (pathname === "/" && session) {
      return withNoStore(NextResponse.redirect(new URL("/map", request.url)));
    }
    // The login page itself is also no-store, so Back from /map after a
    // logout can't show a stale, cached copy of the login page either.
    return withNoStore(NextResponse.next());
  }

  if (!session) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("next", pathname);
    return withNoStore(NextResponse.redirect(loginUrl));
  }

  // Signed in, protected page: allow it, but forbid the browser from
  // caching it (this is the part that fixes the Back button).
  return withNoStore(NextResponse.next());
}

// Runs on everything except Next's internal static/image assets and favicon
// -- adjust if you have a /public folder with other files that should stay
// unauthenticated (e.g. a logo used on the login page itself).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
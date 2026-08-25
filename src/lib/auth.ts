// Target path: src/lib/auth.ts
//
// Session handling for the app. Sessions are a signed JWT stored in an
// httpOnly cookie -- the browser can't read or tamper with it via JS, and
// the server verifies the signature on every request instead of hitting the
// database each time.
//
// Uses `jose` (not `jsonwebtoken`) specifically because `jose` runs on the
// Edge runtime, which is what middleware.ts uses to protect routes. If this
// used a Node-only JWT library, middleware.ts would fail to build.
//
// Requires a JWT_SECRET environment variable -- add one to `.env.local`:
//   JWT_SECRET=<a long random string, e.g. `openssl rand -base64 48`>
// Never commit that file or reuse a short/guessable secret: anyone who has
// it can forge a valid session cookie for any user, including admins.

import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is not set. Add it to .env.local (see comment in src/lib/auth.ts)."
  );
}
const secretKey = new TextEncoder().encode(JWT_SECRET);

export const AUTH_COOKIE_NAME = "ocm_session";

// 7 days. Adjust to taste -- shorter is safer, longer is more convenient.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  userId: number;
  username: string;
  email: string;
  usertype: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey);
}

/** Returns null for a missing, expired, or tampered token -- never throws. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (
      typeof payload.userId === "number" &&
      typeof payload.username === "string" &&
      typeof payload.email === "string" &&
      typeof payload.usertype === "string"
    ) {
      return {
        userId: payload.userId,
        username: payload.username,
        email: payload.email,
        usertype: payload.usertype,
      };
    }
    return null;
  } catch {
    return null;
  }
}
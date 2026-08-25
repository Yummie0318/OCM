import { Pool } from "pg";

// This module must only ever be imported from server-side code (API routes,
// server components/actions) - never from a "use client" component - since
// it holds the DATABASE_URL credential.

declare global {
  // eslint-disable-next-line no-var
  var __controlPointsPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.local.example)."
    );
  }

  // Reuse the pool across hot-reloads in dev instead of opening a new one per request.
  if (!global.__controlPointsPool) {
    global.__controlPointsPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global.__controlPointsPool;
}
// GET /api/activity-logs
//
// Query params (all optional):
//   limit       - max rows to return, default 20, capped at 100
//   entityType  - filter to 'lot_sheet' | 'lot' | 'surveyor' etc.
//   userId      - filter to one user's actions
//   action      - 'create' | 'update' | 'delete'
//   before      - ISO timestamp cursor; returns logs older than this
//                 (use the previous response's nextCursor to paginate
//                 backward through history)
//   since       - ISO timestamp; returns logs at/after this instant.
//                 Used by the notification bell to fetch "today's"
//                 activity: pass local midnight as an ISO string. Mutually
//                 fine to combine with `before` (gives a bounded window),
//                 though the bell only ever needs `since` on its own.
//
// Requires a valid session cookie, same as the other authenticated routes.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";

function parsePositiveInt(value: string | null): number | null {
  if (value == null) return null;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const VALID_ACTIONS = ["create", "update", "delete"];

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = searchParams.get("limit");
  const entityType = searchParams.get("entityType");
  const userIdRaw = searchParams.get("userId");
  const action = searchParams.get("action");
  const beforeRaw = searchParams.get("before");
  const sinceRaw = searchParams.get("since");

  let limit = 20;
  if (limitRaw != null) {
    const parsed = parsePositiveInt(limitRaw);
    if (parsed == null || parsed > 100) {
      return NextResponse.json(
        { error: "limit must be a positive integer up to 100." },
        { status: 400 }
      );
    }
    limit = parsed;
  }

  let userId: number | null = null;
  if (userIdRaw != null) {
    userId = parsePositiveInt(userIdRaw);
    if (userId == null) {
      return NextResponse.json({ error: "userId must be a positive integer." }, { status: 400 });
    }
  }

  if (action != null && !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}.` },
      { status: 400 }
    );
  }

  let before: Date | null = null;
  if (beforeRaw != null) {
    const parsed = new Date(beforeRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "before must be a valid ISO timestamp." }, { status: 400 });
    }
    before = parsed;
  }

  let since: Date | null = null;
  if (sinceRaw != null) {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "since must be a valid ISO timestamp." }, { status: 400 });
    }
    since = parsed;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  function addParam(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  if (entityType) conditions.push(`al.entity_type = ${addParam(entityType)}`);
  if (userId != null) conditions.push(`al.user_id = ${addParam(userId)}`);
  if (action) conditions.push(`al.action = ${addParam(action)}`);
  if (before) conditions.push(`al.created_at < ${addParam(before)}`);
  if (since) conditions.push(`al.created_at >= ${addParam(since)}`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = addParam(limit);

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.description,
            al.changes, al.created_at, al.user_id, u.username
     FROM activity_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT ${limitParam}`,
    params
  );

  return NextResponse.json({
    logs: rows,
    nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
  });
}
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import type { ActivityAction } from "@/lib/activityLog";

const ACTIONS = ["project", "preview", "report"] as const;
const ENTITY_TYPES = ["projection", "lot", "lot_sheet"] as const;

interface Body {
  action: string;
  entityType: string;
  entityId?: number | string | null;
  label?: string;
  extra?: { query?: unknown; lotNo?: unknown; owner?: unknown };
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!(ACTIONS as readonly string[]).includes(body.action) ||
      !(ENTITY_TYPES as readonly string[]).includes(body.entityType)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const label = String(body.label ?? "").trim().slice(0, 200) || "selection";

  let entityId: number | null = null;
  if (body.entityType !== "projection") {
    const n = Number(body.entityId);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ error: "Invalid entity id." }, { status: 400 });
    }
    entityId = n;
  }

  // Only copy the few fields the bell needs for click-through.
  const after: Record<string, unknown> = { label };
  if (body.entityType === "projection" && body.extra?.query && typeof body.extra.query === "object") {
    if (JSON.stringify(body.extra.query).length <= 4000) after.query = body.extra.query;
  }
  if (body.entityType === "lot") {
    after.lotNo = body.extra?.lotNo != null ? String(body.extra.lotNo).slice(0, 100) : null;
    after.owner = body.extra?.owner != null ? String(body.extra.owner).slice(0, 200) : "";
  }

  const u = session.username;
  let description: string;
  if (body.action === "project") description = `${u} projected ${label}`;
  else if (body.action === "report") description = `${u} generated a report for ${label}`;
  else if (body.entityType === "lot_sheet") description = `${u} previewed sheet #${label}`;
  else description = `${u} previewed lot ${label}`;

  await logActivity({
    userId: session.userId,
    action: body.action as ActivityAction,
    entityType: body.entityType,
    entityId,
    description,
    changes: { after },
  });

  return NextResponse.json({ ok: true });
}
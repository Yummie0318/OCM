import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { ppcsToLonLat, planarArea, ALL_ZONES } from "@/lib/coordTransform";
import type { PRS92Zone } from "@/types";

interface Body {
  zone: number;
  points: { northing: number; easting: number }[];
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lotId = Number(id);
  if (!Number.isInteger(lotId)) {
    return NextResponse.json({ error: "Invalid lot id." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const zone = body.zone as PRS92Zone;
  if (!ALL_ZONES.includes(zone)) {
    return NextResponse.json({ error: "Invalid zone." }, { status: 400 });
  }
  const pts = body.points;
  if (
    !Array.isArray(pts) ||
    pts.length < 3 ||
    pts.length > 500 ||
    pts.some((p) => !Number.isFinite(p?.northing) || !Number.isFinite(p?.easting))
  ) {
    return NextResponse.json(
      { error: "At least 3 points with valid Northing and Easting are required." },
      { status: 400 }
    );
  }

  const pool = getPool();

  // Role check. Don't trust the client. If your session already carries the
  // role, you can use that instead of this query.
  const who = await pool.query(`SELECT usertype FROM users WHERE id = $1`, [session.userId]);
  const usertype: string | undefined = who.rows[0]?.usertype;
  if (usertype !== "superadmin" && usertype !== "admin") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const lotRes = await pool.query(
    `SELECT l.id, l.lot_no, l.lot_sheet_id, ls.sheet_no, ls.created_by
     FROM lots l
     JOIN lot_sheets ls ON ls.id = l.lot_sheet_id
     WHERE l.id = $1`,
    [lotId]
  );
  const lot = lotRes.rows[0];
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });

  // Admins can only edit lots on sheets they encoded.
  if (usertype === "admin" && Number(lot.created_by) !== Number(session.userId)) {
    return NextResponse.json(
      { error: "You can only edit lots you encoded." },
      { status: 403 }
    );
  }

  // PPCS -> lon/lat, then close the ring.
  const ring = pts.map((p) => ppcsToLonLat(p.northing, p.easting, zone));
  const outOfBounds = ring.some(
    ([lon, lat]) =>
      !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 114 || lon > 128 || lat < 4 || lat > 22
  );
  if (outOfBounds) {
    return NextResponse.json(
      { error: "These coordinates fall outside the Philippines for the chosen zone. Check the values or the zone." },
      { status: 400 }
    );
  }
  ring.push(ring[0]);

  const geometry = { type: "Polygon" as const, coordinates: [ring] };
  const areaSqm = Number(
    planarArea(pts.map((p) => ({ ppcsN: p.northing, ppcsE: p.easting }))).toFixed(2)
  );
  const geometryStr = JSON.stringify(geometry);

  try {
    await pool.query(
      `UPDATE lots
       SET geojson  = jsonb_set(COALESCE(geojson, '{}'::jsonb), '{geometry}', $1::text::jsonb, true),
           geom     = ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326),
           area_sqm = $2
       WHERE id = $3`,
      [geometryStr, areaSqm, lotId]
    );
  } catch (err) {
    console.error("Failed to update lot geometry:", err);
    return NextResponse.json({ error: "Failed to update polygon." }, { status: 500 });
  }

  // Logged as "lot_sheet" on purpose: the notification bell's click-through
  // (handleActivityLogSelect in page.tsx) treats entity_id as a lot_sheets.id.
  await logActivity({
    userId: session.userId,
    action: "update",
    entityType: "lot_sheet",
    entityId: lot.lot_sheet_id,
    description: `${session.username} edited the polygon of lot ${lot.lot_no} (sheet #${lot.sheet_no})`,
    changes: { after: { zone, pointCount: pts.length, areaSqm } },
  });

  return NextResponse.json({ geometry, areaSqm });
}
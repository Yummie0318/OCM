import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { ppcsToLonLat, planarArea, ALL_ZONES } from "@/lib/coordTransform";
import type { PRS92Zone } from "@/types";

interface Body {
  zone: number;
  lots: { id: number; points: { northing: number; easting: number }[] }[];
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sheetId = Number(id);
  if (!Number.isInteger(sheetId)) {
    return NextResponse.json({ error: "Invalid sheet id." }, { status: 400 });
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
  if (!Array.isArray(body.lots) || body.lots.length === 0 || body.lots.length > 500) {
    return NextResponse.json({ error: "No lots to update." }, { status: 400 });
  }
  for (const l of body.lots) {
    if (
      !Number.isInteger(l?.id) ||
      !Array.isArray(l.points) ||
      l.points.length < 3 ||
      l.points.length > 500 ||
      l.points.some((p) => !Number.isFinite(p?.northing) || !Number.isFinite(p?.easting))
    ) {
      return NextResponse.json(
        { error: "Every lot needs at least 3 points with valid Northing and Easting." },
        { status: 400 }
      );
    }
  }

  const pool = getPool();

  const who = await pool.query(`SELECT usertype FROM users WHERE id = $1`, [session.userId]);
  const usertype: string | undefined = who.rows[0]?.usertype;
  if (usertype !== "superadmin" && usertype !== "admin") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const sheetRes = await pool.query(`SELECT id, sheet_no, created_by FROM lot_sheets WHERE id = $1`, [sheetId]);
  const sheet = sheetRes.rows[0];
  if (!sheet) return NextResponse.json({ error: "Sheet not found." }, { status: 404 });

  if (usertype === "admin" && Number(sheet.created_by) !== Number(session.userId)) {
    return NextResponse.json({ error: "You can only edit sheets you encoded." }, { status: 403 });
  }

  // Every submitted lot must belong to this sheet.
  const lotRes = await pool.query(`SELECT id FROM lots WHERE lot_sheet_id = $1`, [sheetId]);
  const validIds = new Set(lotRes.rows.map((r) => Number(r.id)));
  if (body.lots.some((l) => !validIds.has(l.id))) {
    return NextResponse.json({ error: "One or more lots don't belong to this sheet." }, { status: 400 });
  }

  // Convert everything first, so nothing is written if any lot is invalid.
  const prepared: { id: number; geometry: { type: "Polygon"; coordinates: number[][][] }; areaSqm: number }[] = [];
  for (const l of body.lots) {
    const ring = l.points.map((p) => ppcsToLonLat(p.northing, p.easting, zone));
    const outOfBounds = ring.some(
      ([lon, lat]) =>
        !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 114 || lon > 128 || lat < 4 || lat > 22
    );
    if (outOfBounds) {
      return NextResponse.json(
        { error: "Some coordinates fall outside the Philippines for the chosen zone. Check the values or the zone." },
        { status: 400 }
      );
    }
    ring.push(ring[0]);
    prepared.push({
      id: l.id,
      geometry: { type: "Polygon", coordinates: [ring] },
      areaSqm: Number(planarArea(l.points.map((p) => ({ ppcsN: p.northing, ppcsE: p.easting }))).toFixed(2)),
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const u of prepared) {
      const geometryStr = JSON.stringify(u.geometry);
      await client.query(
        `UPDATE lots
         SET geojson  = jsonb_set(COALESCE(geojson, '{}'::jsonb), '{geometry}', $1::text::jsonb, true),
             geom     = ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326),
             area_sqm = $2
         WHERE id = $3 AND lot_sheet_id = $4`,
        [geometryStr, u.areaSqm, u.id, sheetId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to update sheet geometry:", err);
    return NextResponse.json({ error: "Failed to update polygons." }, { status: 500 });
  } finally {
    client.release();
  }

  await logActivity({
    userId: session.userId,
    action: "update",
    entityType: "lot_sheet",
    entityId: sheetId,
    description: `${session.username} edited the polygons of ${prepared.length} lot(s) on sheet #${sheet.sheet_no}`,
    changes: { after: { zone, lotCount: prepared.length } },
  });

  return NextResponse.json({ lots: prepared });
}
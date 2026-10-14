// Target path in your project: src/app/api/lot-sheets/[id]/archive/route.ts
// (REPLACES the archive route you saved earlier.)
//
// POST /api/lot-sheets/[id]/archive
//
// Moves ONE lot sheet and all of its lots into lot_sheets_archive /
// lots_archive, then removes them from the live tables (the FK is
// ON DELETE CASCADE, so deleting the sheet removes its lots).
// Everything runs in a single transaction: if any step fails, nothing is
// archived and nothing is deleted.
//
// WHO CAN ARCHIVE:
//   - superadmin: any sheet
//   - admin:      only sheets they encoded (lot_sheets.created_by = their id)
//   - everyone else (surveyor, user): never
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";
import { logActivity } from "@/lib/activityLog";

// Explicit column lists: the archive tables have an extra archived_at
// column (default now()), so `INSERT ... SELECT *` would not line up.
const SHEET_COLS = `id, sheet_no, lpcs_northing, lpcs_easting, ppcs_northing, ppcs_easting,
  zone, created_at, plan_url, control_point_id, created_by, documents_url, survey_class`;

const LOT_COLS = `id, lot_sheet_id, lot_no, owner_given_name, owner_surname, province_id,
  municipality_id, barangay_id, survey_no, date_surveyed, surveyor_id, area_sqm, geojson,
  created_at, geom, patent_no, remarks, date_approved,
  application_number, serial_number, investigator_id`;

// The role comes from the session when it carries one, otherwise from the
// users table. Never trusted from the request body.
async function roleOf(
  auth: any,
  pool: ReturnType<typeof getPool>
): Promise<string> {
  const direct = auth?.usertype ?? auth?.userType ?? auth?.role;
  if (direct) return String(direct).toLowerCase();
  const r = await pool.query(
    `SELECT COALESCE(to_jsonb(u)->>'usertype', to_jsonb(u)->>'user_type', to_jsonb(u)->>'role') AS role
     FROM users u WHERE u.id = $1`,
    [auth.userId]
  );
  return String(r.rows[0]?.role ?? "").toLowerCase();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditor();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const sheetId = Number(id);
  if (!Number.isInteger(sheetId) || sheetId <= 0) {
    return NextResponse.json({ error: "Invalid lot sheet id." }, { status: 400 });
  }

  const pool = getPool();

  const role = await roleOf(auth, pool);
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin or superadmin can archive lot sheets." },
      { status: 403 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the sheet row so two people can't archive it at the same time.
    const sheetRes = await client.query(
      `SELECT id, sheet_no, created_by FROM lot_sheets WHERE id = $1 FOR UPDATE`,
      [sheetId]
    );
    if (sheetRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Lot sheet not found." }, { status: 404 });
    }
    const sheet = sheetRes.rows[0];

    // An admin may only archive what they encoded themselves.
    if (role === "admin" && Number(sheet.created_by) !== Number(auth.userId)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You can only archive sheets you encoded." },
        { status: 403 }
      );
    }

    const lotCountRes = await client.query(
      `SELECT count(*)::int AS n FROM lots WHERE lot_sheet_id = $1`,
      [sheetId]
    );
    const lotCount: number = lotCountRes.rows[0].n;

    // If this sheet/its lots were archived before, replace the old archived
    // copy with the current one so the primary keys don't collide.
    await client.query(
      `DELETE FROM lots_archive
       WHERE lot_sheet_id = $1 OR id IN (SELECT id FROM lots WHERE lot_sheet_id = $1)`,
      [sheetId]
    );
    await client.query(`DELETE FROM lot_sheets_archive WHERE id = $1`, [sheetId]);

    // Copy sheet, then its lots.
    await client.query(
      `INSERT INTO lot_sheets_archive (${SHEET_COLS})
       SELECT ${SHEET_COLS} FROM lot_sheets WHERE id = $1`,
      [sheetId]
    );
    const archivedLots = await client.query(
      `INSERT INTO lots_archive (${LOT_COLS})
       SELECT ${LOT_COLS} FROM lots WHERE lot_sheet_id = $1`,
      [sheetId]
    );

    // Safety check: never delete unless every lot made it into the archive.
    if ((archivedLots.rowCount ?? 0) !== lotCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Archive copy was incomplete, so nothing was removed." },
        { status: 500 }
      );
    }

    // lots.lot_sheet_id is ON DELETE CASCADE, so this removes the lots too.
    await client.query(`DELETE FROM lot_sheets WHERE id = $1`, [sheetId]);

    await client.query("COMMIT");

    // Logged after COMMIT so a logging problem can't undo the archive.
    // NOTE: if your logActivity `action` type doesn't allow "archive",
    // change it to one it does allow (e.g. "delete").
    await logActivity({
      userId: auth.userId,
      action: "archive" as any,
      entityType: "lot_sheet",
      entityId: sheetId,
      description: `${auth.username} archived lot sheet #${sheet.sheet_no} with ${lotCount} lot(s)`,
      changes: { before: { sheetNo: sheet.sheet_no, lotCount } },
    });

    return NextResponse.json({ ok: true, sheetId, sheetNo: sheet.sheet_no, lotCount });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});

    if (err?.code === "23505") {
      // The archive tables copied the unique indexes from the live tables
      // (INCLUDING INDEXES). An older archived row with the same
      // lot_no + owner under a different id blocks the insert.
      return NextResponse.json(
        {
          error:
            "The archive already holds a different record with the same Lot No. and Owner. Drop the unique indexes on lots_archive and try again.",
        },
        { status: 409 }
      );
    }

    console.error("POST /api/lot-sheets/[id]/archive failed:", err);
    return NextResponse.json({ error: "Failed to archive lot sheet." }, { status: 500 });
  } finally {
    client.release();
  }
}
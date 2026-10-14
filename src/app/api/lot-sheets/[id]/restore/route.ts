// POST /api/lot-sheets/[id]/restore
//
// Moves ONE archived lot sheet and its lots back into lot_sheets / lots,
// then removes them from the archive tables. Single transaction.
//
// WHO CAN RESTORE (same rule as archiving):
//   - superadmin: any sheet
//   - admin:      only sheets they encoded (created_by = their id)
//   - everyone else: never
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";
import { logActivity } from "@/lib/activityLog";

const SHEET_COLS = `id, sheet_no, lpcs_northing, lpcs_easting, ppcs_northing, ppcs_easting,
  zone, created_at, plan_url, control_point_id, created_by, documents_url, survey_class`;

const LOT_COLS = `id, lot_sheet_id, lot_no, owner_given_name, owner_surname, province_id,
  municipality_id, barangay_id, survey_no, date_surveyed, surveyor_id, area_sqm, geojson,
  created_at, geom, patent_no, remarks, date_approved`;

async function roleOf(auth: any, pool: ReturnType<typeof getPool>): Promise<string> {
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
      { error: "Only an admin or superadmin can restore lot sheets." },
      { status: 403 }
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sheetRes = await client.query(
      `SELECT id, sheet_no, created_by FROM lot_sheets_archive WHERE id = $1 FOR UPDATE`,
      [sheetId]
    );
    if (sheetRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Archived lot sheet not found." }, { status: 404 });
    }
    const sheet = sheetRes.rows[0];

    // An admin may only restore what they encoded themselves.
    if (role === "admin" && Number(sheet.created_by) !== Number(auth.userId)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "You can only restore sheets you encoded." },
        { status: 403 }
      );
    }

    // Refuse if a live record already uses the same ids.
    const clash = await client.query(
      `SELECT 1 FROM lot_sheets WHERE id = $1
       UNION ALL
       SELECT 1 FROM lots WHERE id IN (SELECT id FROM lots_archive WHERE lot_sheet_id = $1)
       LIMIT 1`,
      [sheetId]
    );
    if (clash.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "A live record with the same id already exists, so nothing was restored." },
        { status: 409 }
      );
    }

    const lotCountRes = await client.query(
      `SELECT count(*)::int AS n FROM lots_archive WHERE lot_sheet_id = $1`,
      [sheetId]
    );
    const lotCount: number = lotCountRes.rows[0].n;

    // Copy sheet first, then its lots.
    await client.query(
      `INSERT INTO lot_sheets (${SHEET_COLS})
       SELECT ${SHEET_COLS} FROM lot_sheets_archive WHERE id = $1`,
      [sheetId]
    );
    const restoredLots = await client.query(
      `INSERT INTO lots (${LOT_COLS})
       SELECT ${LOT_COLS} FROM lots_archive WHERE lot_sheet_id = $1`,
      [sheetId]
    );

    // Never delete from the archive unless every lot made it back.
    if ((restoredLots.rowCount ?? 0) !== lotCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Restore copy was incomplete, so nothing was removed from the archive." },
        { status: 500 }
      );
    }

    await client.query(`DELETE FROM lots_archive WHERE lot_sheet_id = $1`, [sheetId]);
    await client.query(`DELETE FROM lot_sheets_archive WHERE id = $1`, [sheetId]);

    await client.query("COMMIT");

    await logActivity({
      userId: auth.userId,
      action: "restore" as any, // change to an allowed action if your type rejects this
      entityType: "lot_sheet",
      entityId: sheetId,
      description: `${auth.username} restored lot sheet #${sheet.sheet_no} with ${lotCount} lot(s)`,
      changes: { after: { sheetNo: sheet.sheet_no, lotCount } },
    });

    return NextResponse.json({ ok: true, sheetId, sheetNo: sheet.sheet_no, lotCount });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});

    if (err?.code === "23505") {
      return NextResponse.json(
        {
          error:
            "A live record with the same Lot No. and Owner already exists, so this sheet can't be restored.",
        },
        { status: 409 }
      );
    }

    console.error("POST /api/lot-sheets/[id]/restore failed:", err);
    return NextResponse.json({ error: "Failed to restore lot sheet." }, { status: 500 });
  } finally {
    client.release();
  }
}
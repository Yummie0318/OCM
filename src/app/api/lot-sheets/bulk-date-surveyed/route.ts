import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";
import { logActivity } from "@/lib/activityLog";

const MAX_SHEETS = 500;

// POST /api/lot-sheets/bulk-date-surveyed
// Body: { sheetIds: number[], dateSurveyed: "YYYY-MM-DD", mode: "fill" | "overwrite" }
//   fill      -> only lots whose date_surveyed is NULL get the value
//   overwrite -> every lot on those sheets gets the value
export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));

  const sheetIds: number[] = Array.isArray(body.sheetIds)
    ? body.sheetIds.map((v: unknown) => Number(v))
    : [];
  if (
    sheetIds.length === 0 ||
    sheetIds.length > MAX_SHEETS ||
    !sheetIds.every((n) => Number.isInteger(n) && n > 0)
  ) {
    return NextResponse.json({ error: `Provide 1-${MAX_SHEETS} valid sheet ids.` }, { status: 400 });
  }

  const dateSurveyed = typeof body.dateSurveyed === "string" ? body.dateSurveyed.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateSurveyed) || isNaN(new Date(dateSurveyed).getTime())) {
    return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required." }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== "fill" && mode !== "overwrite") {
    return NextResponse.json({ error: 'mode must be "fill" or "overwrite".' }, { status: 400 });
  }

  const pool = getPool();

  if (auth.usertype !== "superadmin") {
    const { rows: mine } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM lot_sheets WHERE id = ANY($1::bigint[]) AND created_by = $2`,
      [sheetIds, auth.userId]
    );
    if (mine[0].n !== new Set(sheetIds).size) {
      return NextResponse.json({ error: "You can only edit lot sheets you encoded." }, { status: 403 });
    }
  }

  const condition =
    mode === "fill" ? `date_surveyed IS NULL` : `date_surveyed IS DISTINCT FROM $1::date`;

  try {
    const params = [dateSurveyed, sheetIds];
    const where =
      mode === "fill"
        ? `lot_sheet_id = ANY($2::bigint[]) AND date_surveyed IS NULL`
        : `lot_sheet_id = ANY($2::bigint[]) AND (date_surveyed IS NULL OR date_surveyed <> $1::date)`;

    const { rows } = await pool.query(
      `UPDATE lots
       SET date_surveyed = $1::date
       WHERE ${where}
       RETURNING id, lot_sheet_id`,
      params
    );

    // Temporary debug: shows why nothing matched.
    const { rows: dbg } = await pool.query(
      `SELECT COUNT(*)::int AS lots_on_sheets,
              COUNT(date_surveyed)::int AS with_date
       FROM lots WHERE lot_sheet_id = ANY($1::bigint[])`,
      [sheetIds]
    );
    console.log("bulk-date-surveyed", { mode, dateSurveyed, sheetIds, updated: rows.length, ...dbg[0] });

    const touchedSheets = new Set(rows.map((r) => String(r.lot_sheet_id)));

    if (rows.length > 0) {
      await logActivity({
        userId: auth.userId,
        action: "update",
        entityType: "lot_sheet",
        entityId: touchedSheets.size === 1 ? Number(Array.from(touchedSheets)[0]) : null,
        description: `${auth.username} set date surveyed "${dateSurveyed}" on ${rows.length} lot(s) across ${touchedSheets.size} sheet(s) (${mode === "fill" ? "filled blanks only" : "overwrite"})`,
        changes: {
          after: {
            dateSurveyed,
            mode,
            lotCount: rows.length,
            sheetIds: Array.from(touchedSheets).map(Number),
          },
        },
      });
    }

    return NextResponse.json({
      ok: true,
      updatedLotCount: rows.length,
      updatedLotIds: rows.map((r) => r.id),
    });
  } catch (err) {
    console.error("POST /api/lot-sheets/bulk-date-surveyed failed:", err);
    return NextResponse.json({ error: "Failed to update date surveyed." }, { status: 500 });
  }
}
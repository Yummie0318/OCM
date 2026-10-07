import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";
import { logActivity } from "@/lib/activityLog";

const MAX_SHEETS = 500;

// POST /api/lot-sheets/bulk-date-approved
// Body: { sheetIds: number[], dateApproved: "YYYY-MM-DD", mode: "fill" | "overwrite" }
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

  const dateApproved = typeof body.dateApproved === "string" ? body.dateApproved.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateApproved) || isNaN(new Date(dateApproved).getTime())) {
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

  try {
    const where =
      mode === "fill"
        ? `lot_sheet_id = ANY($2::bigint[]) AND date_approved IS NULL`
        : `lot_sheet_id = ANY($2::bigint[]) AND (date_approved IS NULL OR date_approved <> $1::date)`;

    const { rows } = await pool.query(
      `UPDATE lots
       SET date_approved = $1::date
       WHERE ${where}
       RETURNING id, lot_sheet_id`,
      [dateApproved, sheetIds]
    );

    const touchedSheets = new Set(rows.map((r) => String(r.lot_sheet_id)));

    if (rows.length > 0) {
      await logActivity({
        userId: auth.userId,
        action: "update",
        entityType: "lot_sheet",
        entityId: touchedSheets.size === 1 ? Number(Array.from(touchedSheets)[0]) : null,
        description: `${auth.username} set date approved "${dateApproved}" on ${rows.length} lot(s) across ${touchedSheets.size} sheet(s) (${mode === "fill" ? "filled blanks only" : "overwrite"})`,
        changes: {
          after: {
            dateApproved,
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
    console.error("POST /api/lot-sheets/bulk-date-approved failed:", err);
    return NextResponse.json({ error: "Failed to update date approved." }, { status: 500 });
  }
}
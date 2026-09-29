import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";
import { logActivity } from "@/lib/activityLog";

const MAX_SHEETS = 500;

// POST /api/lot-sheets/bulk-survey-no  (superadmin only)
// Body: { sheetIds: number[], surveyNo: string, mode: "fill" | "overwrite" }
//   fill      -> only lots whose survey_no is NULL/blank get the value
//   overwrite -> every lot on those sheets gets the value
// Returns: { ok, updatedLotCount, updatedLotIds }
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
    return NextResponse.json(
      { error: `Provide 1-${MAX_SHEETS} valid sheet ids.` },
      { status: 400 }
    );
  }

  const surveyNo = typeof body.surveyNo === "string" ? body.surveyNo.trim() : "";
  if (!surveyNo) {
    return NextResponse.json({ error: "Survey number is required." }, { status: 400 });
  }
  if (surveyNo.length > 100) {
    return NextResponse.json({ error: "Survey number is too long." }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== "fill" && mode !== "overwrite") {
    return NextResponse.json({ error: 'mode must be "fill" or "overwrite".' }, { status: 400 });
  }

  // Admins may only touch sheets they created. Superadmin skips this.
  // Sheets that don't exist also count as "not yours" and block the request.
  if (auth.usertype !== "superadmin") {
    const pool = getPool();
    const { rows: mine } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM lot_sheets WHERE id = ANY($1::bigint[]) AND created_by = $2`,
      [sheetIds, auth.userId]
    );
    if (mine[0].n !== new Set(sheetIds).size) {
      return NextResponse.json(
        { error: "You can only edit lot sheets you encoded." },
        { status: 403 }
      );
    }
  }
  // overwrite: skip lots that already have exactly this value (no-op rows).
  const condition =
    mode === "fill"
      ? `(survey_no IS NULL OR TRIM(survey_no) = '')`
      : `survey_no IS DISTINCT FROM $1`;

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE lots
       SET survey_no = $1
       WHERE lot_sheet_id = ANY($2::bigint[])
         AND ${condition}
       RETURNING id, lot_sheet_id`,
      [surveyNo, sheetIds]
    );

    const touchedSheets = new Set(rows.map((r) => String(r.lot_sheet_id)));

    if (rows.length > 0) {
      await logActivity({
        userId: auth.userId,
        action: "update",
        entityType: "lot_sheet",
        // Single sheet -> the bell can click through to it. Multiple -> null.
        entityId: touchedSheets.size === 1 ? Number(Array.from(touchedSheets)[0]) : null,
        description: `${auth.username} set survey no. "${surveyNo}" on ${rows.length} lot(s) across ${touchedSheets.size} sheet(s) (${mode === "fill" ? "filled blanks only" : "overwrite"})`,
        changes: {
          after: {
            surveyNo,
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
    console.error("POST /api/lot-sheets/bulk-survey-no failed:", err);
    return NextResponse.json({ error: "Failed to update survey numbers." }, { status: 500 });
  }
}
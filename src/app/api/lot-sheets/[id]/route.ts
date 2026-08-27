import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { isTraceableGoogleDriveLink, PLAN_LINK_HELP_MESSAGE } from "@/lib/planLink";

// Mirrors the DB CHECK constraint on lot_sheets.survey_class
// (CHECK (survey_class IN ('admin', 'private'))). Kept here so the API
// validates the same allowed set before ever hitting the DB.
const SURVEY_CLASSES = ["admin", "private"] as const;
type SurveyClass = (typeof SURVEY_CLASSES)[number];
function isSurveyClass(value: string): value is SurveyClass {
  return (SURVEY_CLASSES as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = getPool();

  const sheetResult = await pool.query(
    `SELECT ls.*, cp.tie_point_name, cp.province_name, cp.municipality_name,
            u.username AS created_by_username
     FROM lot_sheets ls
     LEFT JOIN control_points cp ON cp.id = ls.control_point_id
     LEFT JOIN users u ON u.id = ls.created_by
     WHERE ls.id = $1`,
    [id]
  );

  if (sheetResult.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const lotsResult = await pool.query(
    `SELECT l.*, p.name AS province_name, m.name AS municipality_name,
            b.name AS barangay_name, s.name AS surveyor_name, s.position AS surveyor_position
     FROM lots l
     LEFT JOIN provinces p ON p.id = l.province_id
     LEFT JOIN municipalities m ON m.id = l.municipality_id
     LEFT JOIN barangays b ON b.id = l.barangay_id
     LEFT JOIN surveyors s ON s.id = l.surveyor_id
     WHERE l.lot_sheet_id = $1
     ORDER BY l.lot_no`,
    [id]
  );

  return NextResponse.json({
    ...sheetResult.rows[0],
    lots: lotsResult.rows,
  });
}

// PATCH: attach or replace the plan link (plan_url) and/or the documents
// link (documents_url) on an existing sheet, set survey_no on every lot
// on that sheet that currently has no survey number, and/or set the
// sheet's survey_class.
//
// Called from AttributeTable's inline controls (sheets list + drilled-in
// breadcrumb) via handlers in src/app/map/page.tsx.
//
// Body may include any combination of:
//   { planUrl?: string, documentsUrl?: string, surveyNo?: string, surveyClass?: string }
//
// planUrl (when present):
// - Required to be a non-blank, traceable Google Drive/Docs URL
//   (isTraceableGoogleDriveLink). Same rules as before.
// - Updates lot_sheets.plan_url only.
//
// documentsUrl (when present):
// - Same rules as planUrl (non-blank, traceable Google Drive/Docs URL).
// - Updates lot_sheets.documents_url only. Independent of plan_url — a
//   sheet can have one, both, or neither.
//
// surveyNo (when present):
// - Plain text (not a URL). Trimmed; blank after trim is rejected.
// - Updates lots.survey_no ONLY for rows on this sheet where survey_no
//   is currently NULL or empty string — lots that already have a survey
//   number are left alone. This mirrors the "fill missing" intent of the
//   plan link, but scoped to per-lot columns that may already differ.
//
// surveyClass (when present):
// - Must be exactly "admin" or "private" (matches the DB CHECK
//   constraint on lot_sheets.survey_class). Any other value is rejected.
// - Updates lot_sheets.survey_class only.
//
// - 400 if the id isn't a valid number, or if a provided field fails
//   validation (blank planUrl/documentsUrl/surveyNo, non-traceable
//   planUrl/documentsUrl, or an unrecognized surveyClass).
// - 400 if the body has none of planUrl, documentsUrl, surveyNo, surveyClass.
// - 404 if no lot_sheets row has that id.
// - 200 with { ok: true, planUrl?, documentsUrl?, surveyNo?,
//   updatedLotCount?, surveyClass? } on success.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sheetId = Number(id);

  if (!Number.isFinite(sheetId)) {
    return NextResponse.json({ error: "Invalid sheet id." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const hasPlanUrl = Object.prototype.hasOwnProperty.call(body, "planUrl");
  const hasDocumentsUrl = Object.prototype.hasOwnProperty.call(body, "documentsUrl");
  const hasSurveyNo = Object.prototype.hasOwnProperty.call(body, "surveyNo");
  const hasSurveyClass = Object.prototype.hasOwnProperty.call(body, "surveyClass");

  if (!hasPlanUrl && !hasDocumentsUrl && !hasSurveyNo && !hasSurveyClass) {
    return NextResponse.json(
      { error: "Provide planUrl, documentsUrl, surveyNo, and/or surveyClass." },
      { status: 400 }
    );
  }

  const planUrl =
    hasPlanUrl && typeof body.planUrl === "string" ? body.planUrl.trim() : null;
  const documentsUrl =
    hasDocumentsUrl && typeof body.documentsUrl === "string" ? body.documentsUrl.trim() : null;
  const surveyNo =
    hasSurveyNo && typeof body.surveyNo === "string" ? body.surveyNo.trim() : null;
  const surveyClass =
    hasSurveyClass && typeof body.surveyClass === "string" ? body.surveyClass.trim().toLowerCase() : null;

  if (hasPlanUrl) {
    if (!planUrl) {
      return NextResponse.json({ error: "Plan link is required." }, { status: 400 });
    }
    if (!isTraceableGoogleDriveLink(planUrl)) {
      return NextResponse.json({ error: PLAN_LINK_HELP_MESSAGE }, { status: 400 });
    }
  }

  if (hasDocumentsUrl) {
    if (!documentsUrl) {
      return NextResponse.json({ error: "Documents link is required." }, { status: 400 });
    }
    if (!isTraceableGoogleDriveLink(documentsUrl)) {
      return NextResponse.json({ error: PLAN_LINK_HELP_MESSAGE }, { status: 400 });
    }
  }

  if (hasSurveyNo && !surveyNo) {
    return NextResponse.json({ error: "Survey number is required." }, { status: 400 });
  }

  if (hasSurveyClass && (!surveyClass || !isSurveyClass(surveyClass))) {
    return NextResponse.json(
      { error: `Survey class must be one of: ${SURVEY_CLASSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Confirm the sheet exists before touching lots or plan_url.
    const sheetCheck = await client.query(
      `SELECT id FROM lot_sheets WHERE id = $1`,
      [sheetId]
    );
    if (sheetCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Sheet not found." }, { status: 404 });
    }

    let returnedPlanUrl: string | undefined;
    if (hasPlanUrl && planUrl) {
      await client.query(
        `UPDATE lot_sheets SET plan_url = $1 WHERE id = $2`,
        [planUrl, sheetId]
      );
      returnedPlanUrl = planUrl;
    }

    let returnedDocumentsUrl: string | undefined;
    if (hasDocumentsUrl && documentsUrl) {
      await client.query(
        `UPDATE lot_sheets SET documents_url = $1 WHERE id = $2`,
        [documentsUrl, sheetId]
      );
      returnedDocumentsUrl = documentsUrl;
    }

    let returnedSurveyClass: string | undefined;
    if (hasSurveyClass && surveyClass) {
      await client.query(
        `UPDATE lot_sheets SET survey_class = $1 WHERE id = $2`,
        [surveyClass, sheetId]
      );
      returnedSurveyClass = surveyClass;
    }

    let updatedLotCount: number | undefined;
    if (hasSurveyNo && surveyNo) {
      // Only fill lots that currently have no survey number — do not
      // overwrite an existing value on any lot on this sheet.
      const lotResult = await client.query(
        `UPDATE lots
         SET survey_no = $1
         WHERE lot_sheet_id = $2
           AND (survey_no IS NULL OR TRIM(survey_no) = '')
         RETURNING id`,
        [surveyNo, sheetId]
      );
      updatedLotCount = lotResult.rowCount ?? 0;
    }

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      ...(returnedPlanUrl !== undefined ? { planUrl: returnedPlanUrl } : {}),
      ...(returnedDocumentsUrl !== undefined ? { documentsUrl: returnedDocumentsUrl } : {}),
      ...(returnedSurveyClass !== undefined ? { surveyClass: returnedSurveyClass } : {}),
      ...(surveyNo !== null && hasSurveyNo ? { surveyNo, updatedLotCount } : {}),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/lot-sheets/[id] failed:", err);
    return NextResponse.json(
      { error: "Failed to update sheet." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
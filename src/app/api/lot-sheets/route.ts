// Target path in your project: src/app/api/lot-sheets/route.ts
//
// DB MIGRATION REQUIRED (run once against your database before this goes
// live) — enforces "no duplicate lot number" at the DB level as a backstop
// against the two racing requests scenario, which no amount of
// pre-INSERT SELECT checking alone can fully close:
//
//   ALTER TABLE lots ADD CONSTRAINT lots_lot_no_unique UNIQUE (lot_no);
//
// NOTE: this makes lot_no unique across the ENTIRE table. If lot numbers are
// only meant to be unique within a barangay/sheet (i.e. the same lot_no is
// allowed to legitimately repeat elsewhere), use a composite constraint
// instead, e.g.:
//
//   ALTER TABLE lots ADD CONSTRAINT lots_lot_no_unique UNIQUE (lot_no, barangay_id);
//
// and change the two lot_no checks below (the pre-check SELECT and the
// duplicates array) to match on the same combination of columns.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { AUTH_COOKIE_NAME, verifySession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";

// Shape of the JSON body the frontend should POST here. This is intentionally
// decoupled from your existing `Lot`/`ComputedLot` types — map to this shape
// in the save handler rather than sending your internal types directly.
interface LotInput {
  lotNo: string;
  ownerGivenName?: string | null;
  ownerSurname?: string | null;
  provinceId?: number | null;
  municipalityId?: number | null;
  barangayId?: number | null;
  surveyNo?: string | null;
  dateSurveyed?: string | null; // "YYYY-MM-DD"
  patentNo?: string | null;
  remarks?: string | null;
  surveyorId?: number | null;
  areaSqm?: number | null;
  geojson?: unknown; // computed GeoJSON Feature for this lot
}

interface LotSheetInput {
  sheetNo: string; // e.g. "8208"
  controlPointId?: number | null; // FK -> control_points.id (replaces tiePointName/provinceId/municipalityId)
  lpcsNorthing?: number | null;
  lpcsEasting?: number | null;
  ppcsNorthing?: number | null;
  ppcsEasting?: number | null;
  zone?: number | null;
  planUrl?: string | null;
  documentsUrl?: string | null;
  surveyClass?: string | null; // "admin" | "private" — see DB CHECK constraint
  lots: LotInput[];
}

// Mirrors the DB CHECK constraint on lot_sheets.survey_class
// (CHECK (survey_class IN ('admin', 'private'))).
const SURVEY_CLASSES = ["admin", "private"] as const;

export async function POST(request: Request) {
  // Who's making this request. middleware.ts already requires a valid
  // session cookie to reach this route at all (it's not in PUBLIC_PATHS),
  // so this should never actually be null in practice -- but middleware
  // and route handlers run independently, so we still check here rather
  // than trust that upstream check blindly.
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: LotSheetInput;
  try {
    body = (await request.json()) as LotSheetInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.sheetNo || !body.lots || body.lots.length === 0) {
    return NextResponse.json(
      { error: "sheetNo and at least one lot are required." },
      { status: 400 }
    );
  }

  if (
    body.surveyClass != null &&
    !(SURVEY_CLASSES as readonly string[]).includes(body.surveyClass)
  ) {
    return NextResponse.json(
      { error: `surveyClass must be one of: ${SURVEY_CLASSES.join(", ")}.` },
      { status: 400 }
    );
  }

  // --- Duplicate check #1: same lot_no repeated within THIS submission ---
  // Checked before touching the DB at all, since the DB-side check below
  // only sees rows already saved — two lots with the same lot_no in one
  // request would both pass that check and both get inserted otherwise.
  const seenInBatch = new Set<string>();
  const inBatchDuplicates: string[] = [];
  for (const lot of body.lots) {
    if (seenInBatch.has(lot.lotNo)) inBatchDuplicates.push(lot.lotNo);
    seenInBatch.add(lot.lotNo);
  }
  if (inBatchDuplicates.length > 0) {
    return NextResponse.json(
      {
        error: "Duplicate Lot No. within the submitted sheet.",
        duplicates: inBatchDuplicates,
      },
      { status: 409 }
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    // --- Duplicate check #2: same lot_no already saved in the database ---
    // Lot numbers must be unique on their own now (previously this only
    // flagged a duplicate when BOTH lot_no and survey_no matched).
    const lotNos = body.lots.map((l) => l.lotNo);

    const dupCheck = await client.query(
      `SELECT lot_no FROM lots WHERE lot_no = ANY($1::text[])`,
      [lotNos]
    );

    if (dupCheck.rows.length > 0) {
      return NextResponse.json(
        {
          error: "One or more lots already exist in the database (duplicate Lot No.).",
          duplicates: dupCheck.rows.map((r) => ({ lotNo: r.lot_no })),
        },
        { status: 409 }
      );
    }

    await client.query("BEGIN");

    const sheetResult = await client.query(
      `INSERT INTO lot_sheets
        (sheet_no, control_point_id,
         lpcs_northing, lpcs_easting, ppcs_northing, ppcs_easting, zone, plan_url,
         documents_url, survey_class,
         created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        body.sheetNo,
        body.controlPointId ?? null,
        body.lpcsNorthing ?? null,
        body.lpcsEasting ?? null,
        body.ppcsNorthing ?? null,
        body.ppcsEasting ?? null,
        body.zone ?? null,
        body.planUrl ?? null,
        body.documentsUrl ?? null,
        body.surveyClass ?? null,
        session.userId,
      ]
    );
    const lotSheetId = sheetResult.rows[0].id;

    const insertedLots = [];
    for (const lot of body.lots) {
      const geojsonStr = lot.geojson ? JSON.stringify(lot.geojson) : null;
      const lotResult = await client.query(
        `INSERT INTO lots
          (lot_sheet_id, lot_no, owner_given_name, owner_surname,
           province_id, municipality_id, barangay_id,
           survey_no, date_surveyed, patent_no, remarks,
           surveyor_id, area_sqm, geojson, geom)
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
           CASE WHEN $14::jsonb IS NULL THEN NULL
                ELSE ST_SetSRID(ST_GeomFromGeoJSON($14::jsonb->'geometry'), 4326)
           END
         )
         RETURNING id, lot_no`,
        [
          lotSheetId,
          lot.lotNo,
          lot.ownerGivenName ?? null,
          lot.ownerSurname ?? null,
          lot.provinceId ?? null,
          lot.municipalityId ?? null,
          lot.barangayId ?? null,
          lot.surveyNo ?? null,
          lot.dateSurveyed ?? null,
          lot.patentNo ?? null,
          lot.remarks ?? null,
          lot.surveyorId ?? null,
          lot.areaSqm ?? null,
          geojsonStr,
        ]
      );
      insertedLots.push(lotResult.rows[0]);
    }

    await client.query("COMMIT");

    // Logged after COMMIT (not inside the transaction) so a logging
    // hiccup can never trigger a rollback of an otherwise-successful save
    // -- logActivity swallows its own errors for the same reason.
    await logActivity({
      userId: session.userId,
      action: "create",
      entityType: "lot_sheet",
      entityId: lotSheetId,
      description: `${session.username} added lot sheet #${body.sheetNo} with ${insertedLots.length} lot(s)`,
      changes: {
        after: {
          sheetNo: body.sheetNo,
          surveyClass: body.surveyClass ?? null,
          lotCount: insertedLots.length,
        },
      },
    });

    return NextResponse.json(
      { id: lotSheetId, sheetNo: body.sheetNo, lots: insertedLots },
      { status: 201 }
    );
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});

    // Postgres unique_violation — the DB-level constraint (see migration
    // note at the top of this file) caught a duplicate lot_no that slipped
    // past the pre-check above, most likely two concurrent saves racing
    // each other. Report it the same way as the pre-check instead of
    // falling through to a generic 500.
    if (err?.code === "23505") {
      return NextResponse.json(
        { error: "One or more lots already exist in the database (duplicate Lot No.)." },
        { status: 409 }
      );
    }

    console.error("Failed to save lot sheet:", err);
    return NextResponse.json(
      { error: "Failed to save lot sheet." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// Used later by the "view all saved lots" page: a summary list of sheets.
export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
        ls.id, ls.sheet_no, ls.plan_url, ls.documents_url, ls.survey_class, ls.created_at,
        cp.tie_point_name, cp.province_name, cp.municipality_name,
        COUNT(l.id) AS lot_count,
        u.username AS created_by_username
     FROM lot_sheets ls
     LEFT JOIN control_points cp ON cp.id = ls.control_point_id
     LEFT JOIN lots l ON l.lot_sheet_id = ls.id
     LEFT JOIN users u ON u.id = ls.created_by
     GROUP BY ls.id, ls.sheet_no, ls.plan_url, ls.documents_url, ls.survey_class, ls.created_at,
              cp.tie_point_name, cp.province_name, cp.municipality_name,
              u.username
     ORDER BY ls.created_at DESC`
  );
  return NextResponse.json(rows);
}
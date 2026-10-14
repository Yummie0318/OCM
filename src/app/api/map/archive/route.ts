// Target path in your project: src/app/api/map/archive/route.ts  (NEW FILE)
//
// GET /api/map/archive
//   -> GeoJSON FeatureCollection of every archived lot, in the same shape
//      the map and attribute table already use for /api/map/lots.
//      Each feature carries properties.archived = true so the table can
//      lock it (no edit / archive controls for archived records).
//
// GET /api/map/archive?summary=1
//   -> { sheets, lots }  (counts shown on the sidebar's Archive row)
//
// Read-only. Like the other /api/map routes, it sits behind the session
// check in middleware.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor } from "@/lib/requireEditor";

const MAX_FEATURES = 2000;

// Same expressions as src/app/api/map/lots/route.ts and lots/[id]/route.ts.
const PLAN_PREFIX_SQL = `UPPER(substring(l.survey_no from '^[A-Za-z]+'))`;
const CLASSIFICATION_SQL = `CASE
  WHEN get_rfpa_threshold(l.municipality_id) IS NULL THEN NULL
  WHEN l.area_sqm <= get_rfpa_threshold(l.municipality_id) THEN 'RFPA'
  ELSE 'FPA'
END`;

// Reads a display name from a lookup table without hard-coding its column
// name: the first of these columns that exists and is non-null wins.
const nameOf = (alias: string, ...cols: string[]) =>
  `COALESCE(${cols.map((c) => `to_jsonb(${alias})->>'${c}'`).join(", ")})`;

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

export async function GET(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const pool = getPool();

  // Plain "user" accounts can't see the archive at all.
  const role = await roleOf(auth, pool);
  if (role !== "superadmin" && role !== "admin" && role !== "surveyor") {
    return NextResponse.json({ error: "You don't have access to the archive." }, { status: 403 });
  }

  try {
    if (searchParams.get("summary")) {
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*) FROM lot_sheets_archive)::int AS sheets,
           (SELECT count(*) FROM lots_archive l
              JOIN lot_sheets_archive s ON s.id = l.lot_sheet_id)::int AS lots`
      );
      return NextResponse.json(rows[0]);
    }

    const { rows } = await pool.query(
      `SELECT
         l.id, l.lot_no, l.owner_given_name, l.owner_surname, l.survey_no,
         l.area_sqm, l.patent_no, l.remarks, l.archived_at,
         l.application_number, l.serial_number, l.investigator_id,
         i.name AS investigator,
         to_char(l.date_surveyed, 'YYYY-MM-DD') AS date_surveyed,
         to_char(l.date_approved, 'YYYY-MM-DD') AS date_approved,
         s.id AS sheet_id, s.sheet_no, s.plan_url, s.documents_url, s.survey_class,
         ${nameOf("pv", "name", "province_name")} AS province,
         ${nameOf("m", "name", "municipality_name")} AS municipality,
         ${nameOf("b", "name", "barangay_name")} AS barangay,
         COALESCE(
           ${nameOf("sv", "name", "surveyor_name", "full_name")},
           NULLIF(concat_ws(', ', to_jsonb(sv)->>'surname', to_jsonb(sv)->>'given_name'), '')
         ) AS surveyor,
         u.username AS encoded_by,
         ${PLAN_PREFIX_SQL} AS plan_prefix,
         ${CLASSIFICATION_SQL} AS classification,
         ST_AsGeoJSON(l.geom)::json AS geometry
       FROM lots_archive l
       JOIN lot_sheets_archive s ON s.id = l.lot_sheet_id
       LEFT JOIN provinces pv ON pv.id = l.province_id
       LEFT JOIN municipalities m ON m.id = l.municipality_id
       LEFT JOIN barangays b ON b.id = l.barangay_id
       LEFT JOIN surveyors sv ON sv.id = l.surveyor_id
       LEFT JOIN investigators i ON i.id = l.investigator_id
       LEFT JOIN users u ON u.id = s.created_by
       WHERE l.geom IS NOT NULL
       ORDER BY l.archived_at DESC, l.id
       LIMIT ${MAX_FEATURES + 1}`
    );

    const truncated = rows.length > MAX_FEATURES;
    const features = rows.slice(0, MAX_FEATURES).map((r: any) => ({
      type: "Feature" as const,
      id: r.id,
      geometry: r.geometry,
      properties: {
        lotNo: r.lot_no,
        ownerGivenName: r.owner_given_name,
        ownerSurname: r.owner_surname,
        owner: [r.owner_surname, r.owner_given_name].filter(Boolean).join(", "),
        province: r.province,
        municipality: r.municipality,
        barangay: r.barangay,
        surveyor: r.surveyor,
        surveyNo: r.survey_no,
        areaSqm: r.area_sqm == null ? null : Number(r.area_sqm),
        patentNo: r.patent_no,
        remarks: r.remarks,
        applicationNumber: r.application_number,
        serialNumber: r.serial_number,
        investigatorId: r.investigator_id,
        investigator: r.investigator,
        dateSurveyed: r.date_surveyed,
        dateApproved: r.date_approved,
        sheetId: r.sheet_id,
        sheetNo: r.sheet_no,
        planUrl: r.plan_url,
        documentsUrl: r.documents_url,
        surveyClass: r.survey_class,
        encodedBy: r.encoded_by,
        planPrefix: r.plan_prefix,
        classification: r.classification,
        isNonTitled: false,
        archived: true,
        archivedAt: r.archived_at,
      },
    }));

    return NextResponse.json({ type: "FeatureCollection", features, truncated });
  } catch (err) {
    console.error("GET /api/map/archive failed:", err);
    return NextResponse.json({ error: "Failed to load the archive." }, { status: 500 });
  }
}
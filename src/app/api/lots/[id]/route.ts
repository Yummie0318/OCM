import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireEditor, canEditRecord } from "@/lib/requireEditor";
import { logActivity } from "@/lib/activityLog";

// Same expressions as src/app/api/map/lots/route.ts, so the returned
// classification / plan prefix always match what the map endpoint computes.
const PLAN_PREFIX_SQL = `UPPER(substring(l.survey_no from '^[A-Za-z]+'))`;
const CLASSIFICATION_SQL = `CASE
  WHEN get_rfpa_threshold(l.municipality_id) IS NULL THEN NULL
  WHEN l.area_sqm <= get_rfpa_threshold(l.municipality_id) THEN 'RFPA'
  ELSE 'FPA'
END`;

function ownerKey(g: string | null | undefined, s: string | null | undefined) {
  return `${(g ?? "").trim().toLowerCase()}|${(s ?? "").trim().toLowerCase()}`;
}

// PATCH /api/lots/[id]  (superadmin only)
// Body: any of { lotNo, ownerGivenName, ownerSurname, surveyNo,
//                dateSurveyed ("YYYY-MM-DD"), areaSqm, patentNo, remarks }
// Blank strings clear the field (except lotNo, which is required).
// Geometry is never touched. Changing areaSqm here does NOT re-draw the polygon.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditor();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const lotId = Number(id);
  if (!Number.isInteger(lotId) || lotId <= 0) {
    return NextResponse.json({ error: "Invalid lot id." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const text = (k: string): string | null => {
    const v = body[k];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const sets: string[] = [];
  const values: unknown[] = [];
  const setCol = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (has("lotNo")) {
    const v = text("lotNo");
    if (!v) return NextResponse.json({ error: "Lot No. is required." }, { status: 400 });
    setCol("lot_no", v);
  }
  if (has("ownerGivenName")) setCol("owner_given_name", text("ownerGivenName"));
  if (has("ownerSurname")) setCol("owner_surname", text("ownerSurname"));
  if (has("surveyNo")) setCol("survey_no", text("surveyNo"));
  if (has("patentNo")) setCol("patent_no", text("patentNo"));
  if (has("remarks")) setCol("remarks", text("remarks"));

  if (has("dateSurveyed")) {
    const v = text("dateSurveyed");
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ error: "Date surveyed must be YYYY-MM-DD." }, { status: 400 });
    }
    setCol("date_surveyed", v);
  }
  if (has("areaSqm")) {
    const v = text("areaSqm");
    if (v == null) {
      setCol("area_sqm", null);
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "Area must be a non-negative number." }, { status: 400 });
      }
      setCol("area_sqm", n);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const pool = getPool();

  try {
    const current = await pool.query(
      `SELECT lot_no, owner_given_name, owner_surname, survey_no,
              to_char(date_surveyed, 'YYYY-MM-DD') AS date_surveyed,
              area_sqm, patent_no, remarks, lot_sheet_id,
              (SELECT sheet_no FROM lot_sheets WHERE id = lots.lot_sheet_id) AS sheet_no,
              (SELECT created_by FROM lot_sheets WHERE id = lots.lot_sheet_id) AS sheet_created_by
       FROM lots WHERE id = $1`,
      [lotId]
    );
    if (current.rows.length === 0) {
      return NextResponse.json({ error: "Lot not found." }, { status: 404 });
    }

    const cur = current.rows[0];

    if (!canEditRecord(auth, cur.sheet_created_by)) {
      return NextResponse.json(
        { error: "You can only edit lots on sheets you encoded." },
        { status: 403 }
      );
    }

    // Duplicate check: same Lot No. + Owner as ANOTHER lot (same rule as lot-sheets POST).
    const nextLotNo = has("lotNo") ? text("lotNo")! : cur.lot_no;
    const nextGiven = has("ownerGivenName") ? text("ownerGivenName") : cur.owner_given_name;
    const nextSurname = has("ownerSurname") ? text("ownerSurname") : cur.owner_surname;

    const others = await pool.query(
      `SELECT owner_given_name, owner_surname FROM lots WHERE lot_no = $1 AND id <> $2`,
      [nextLotNo, lotId]
    );
    const myKey = ownerKey(nextGiven, nextSurname);
    if (others.rows.some((r) => ownerKey(r.owner_given_name, r.owner_surname) === myKey)) {
      return NextResponse.json(
        { error: "Another lot already has this Lot No. and Owner." },
        { status: 409 }
      );
    }

    values.push(lotId);
    const { rows } = await pool.query(
      `UPDATE lots l
       SET ${sets.join(", ")}
       WHERE l.id = $${values.length}
       RETURNING l.id, l.lot_no, l.owner_given_name, l.owner_surname, l.survey_no,
                 to_char(l.date_surveyed, 'YYYY-MM-DD') AS date_surveyed,
                 l.area_sqm, l.patent_no, l.remarks,
                 ${PLAN_PREFIX_SQL} AS plan_prefix,
                 ${CLASSIFICATION_SQL} AS classification`,
      values
    );

    const r = rows[0];

    // Log only the fields that actually changed; skip the log if nothing did.
    // `cur` is the pre-update row loaded earlier in this same try block.
    const asText = (v: unknown) => (v == null ? null : String(v));
    const asNum = (v: unknown) => (v == null ? null : Number(v));
    const tracked: [string, string, (v: unknown) => unknown][] = [
      ["lotNo", "lot_no", asText],
      ["ownerGivenName", "owner_given_name", asText],
      ["ownerSurname", "owner_surname", asText],
      ["surveyNo", "survey_no", asText],
      ["dateSurveyed", "date_surveyed", asText],
      ["areaSqm", "area_sqm", asNum],
      ["patentNo", "patent_no", asText],
      ["remarks", "remarks", asText],
    ];
    const beforeChanges: Record<string, unknown> = {};
    const afterChanges: Record<string, unknown> = {};
    for (const [label, col, norm] of tracked) {
      const b = norm(cur[col]);
      const a = norm(r[col]);
      if (b !== a) {
        beforeChanges[label] = b;
        afterChanges[label] = a;
      }
    }
    if (Object.keys(afterChanges).length > 0) {
      await logActivity({
        userId: auth.userId,
        action: "update",
        // Logged against the lot's SHEET so the bell's click-through
        // (which treats entity_id as a lot_sheets.id) loads the right sheet.
        entityType: "lot_sheet",
        entityId: cur.lot_sheet_id ?? null,
        description: `${auth.username} edited lot ${r.lot_no}${cur.sheet_no ? ` on sheet #${cur.sheet_no}` : ""} (${Object.keys(afterChanges).join(", ")})`,
        changes: { lotId, before: beforeChanges, after: afterChanges },
      });
    }
    return NextResponse.json({
      ok: true,
      lot: {
        lotNo: r.lot_no,
        ownerGivenName: r.owner_given_name,
        ownerSurname: r.owner_surname,
        surveyNo: r.survey_no,
        dateSurveyed: r.date_surveyed,
        areaSqm: r.area_sqm,
        patentNo: r.patent_no,
        remarks: r.remarks,
        planPrefix: r.plan_prefix,
        classification: r.classification,
      },
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json(
        { error: "Another lot already has this Lot No. and Owner." },
        { status: 409 }
      );
    }
    console.error("PATCH /api/lots/[id] failed:", err);
    return NextResponse.json({ error: "Failed to update lot." }, { status: 500 });
  }
}
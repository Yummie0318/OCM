import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { FOREST_TYPES, FOREST_ID_OFFSET } from "@/lib/forest";

const VALID = FOREST_TYPES.map((t) => t.type as string);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pool = getPool();

  try {
    // Sidebar counts (polygon parts, matching what the map/table show)
    if (searchParams.get("summary")) {
      const { rows } = await pool.query(
        `SELECT forest_type, SUM(ST_NumGeometries(geom))::int AS polygons
         FROM forest_areas
         GROUP BY forest_type`
      );
      return NextResponse.json(rows);
    }

    const types = (searchParams.get("forest_type") ?? "")
      .split(",")
      .filter((t) => VALID.includes(t));

    if (types.length === 0) {
      return NextResponse.json({ type: "FeatureCollection", features: [] });
    }

    // ST_Dump splits MultiPolygons into Polygons (LotFeature is Polygon-only).
    // Simplified ~20 m (0.0002 deg) because the mangrove has ~91k points.
    const { rows } = await pool.query(
      `SELECT t.id, t.forest_type, t.label, t.part, t.area_ha,
              ST_AsGeoJSON(t.simple)::json AS geometry
       FROM (
         SELECT f.id,
                f.forest_type,
                f.label,
                d.path[1] AS part,
                CASE WHEN ST_NumGeometries(f.geom) = 1 AND f.area_ha IS NOT NULL
                     THEN f.area_ha
                     ELSE ST_Area(d.geom::geography) / 10000.0
                END AS area_ha,
                ST_SimplifyPreserveTopology(d.geom, 0.0002) AS simple
         FROM forest_areas f,
              LATERAL ST_Dump(f.geom) AS d
         WHERE f.forest_type = ANY($1)
       ) t
       WHERE NOT ST_IsEmpty(t.simple)
         AND ST_GeometryType(t.simple) = 'ST_Polygon'`,
      [types]
    );

    const features = rows.map((r: any) => ({
      type: "Feature",
      id: FOREST_ID_OFFSET + Number(r.id) * 100000 + Number(r.part),
      geometry: r.geometry,
      properties: {
        kind: "forest",
        forestType: r.forest_type,
        label: r.label,
        areaHa: Number(r.area_ha),
      },
    }));

    return NextResponse.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("GET /api/map/forest failed:", err);
    return NextResponse.json({ error: "Failed to load forest cover." }, { status: 500 });
  }
}
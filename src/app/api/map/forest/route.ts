import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  FOREST_TYPES,
  FOREST_ID_OFFSET,
  LAND_CLASS_TYPES,
  LAND_ID_OFFSET,
} from "@/lib/forest";

type LandType = (typeof LAND_CLASS_TYPES)[number];

const FOREST_VALID = FOREST_TYPES.map((t) => t.type as string);
const LAND_BY_TYPE: Record<string, LandType> = Object.fromEntries(
  LAND_CLASS_TYPES.map((t) => [t.type, t])
);
const LAND_BY_STATUS: Record<string, LandType> = Object.fromEntries(
  LAND_CLASS_TYPES.map((t) => [t.status, t])
);

// Usage:
//   ?summary=1                      sidebar counts for forest cover + A&D + Forest Land
//   ?profile=a_and_d | forest_land  statistical profile for the data-reference popover
//   ?forest_type=a,b,c              GeoJSON for any mix of forest cover / A&D / Forest Land
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pool = getPool();

  try {
    // Sidebar counts (polygon parts, matching what the map/table show)
    if (searchParams.get("summary")) {
      const { rows } = await pool.query(
        `SELECT forest_type, SUM(ST_NumGeometries(geom))::int AS polygons
         FROM forest_areas
         GROUP BY forest_type
         UNION ALL
         SELECT CASE status WHEN 'A&D' THEN 'a_and_d' WHEN 'FL' THEN 'forest_land' END,
                SUM(ST_NumGeometries(geom))::int
         FROM land_class_areas
         GROUP BY status`
      );
      return NextResponse.json(rows);
    }

    // Statistical profile for one land-class layer.
    const profileType = searchParams.get("profile");
    if (profileType) {
      const t = LAND_BY_TYPE[profileType];
      if (!t) return NextResponse.json({ error: "Unknown dataset." }, { status: 400 });

      const [totals, largest, byCenro, byDistrict] = await Promise.all([
        pool.query(
          `SELECT COUNT(DISTINCT municipality)::int AS municipalities,
                  COALESCE(SUM(ST_NumGeometries(geom)), 0)::int AS polygons,
                  COALESCE(SUM(area_ha), 0) AS total_ha,
                  COALESCE(AVG(area_ha), 0) AS avg_ha
           FROM land_class_areas WHERE status = $1`,
          [t.status]
        ),
        pool.query(
          `SELECT municipality AS name, area_ha AS ha
           FROM land_class_areas
           WHERE status = $1 AND area_ha IS NOT NULL
           ORDER BY area_ha DESC LIMIT 3`,
          [t.status]
        ),
        pool.query(
          `SELECT COALESCE(cenro, 'Unassigned') AS name, COUNT(*)::int AS count,
                  COALESCE(SUM(area_ha), 0) AS ha
           FROM land_class_areas WHERE status = $1
           GROUP BY 1 ORDER BY ha DESC`,
          [t.status]
        ),
        pool.query(
          `SELECT COALESCE(district, 'Unassigned') AS name, COUNT(*)::int AS count,
                  COALESCE(SUM(area_ha), 0) AS ha
           FROM land_class_areas WHERE status = $1
           GROUP BY 1 ORDER BY ha DESC`,
          [t.status]
        ),
      ]);

      const tot = totals.rows[0];
      const mapRow = (r: any) => ({ name: r.name, count: Number(r.count ?? 0), ha: Number(r.ha) });
      return NextResponse.json({
        type: t.type,
        label: t.fullName,
        municipalities: Number(tot.municipalities),
        polygons: Number(tot.polygons),
        totalHa: Number(tot.total_ha),
        avgHa: Number(tot.avg_ha),
        largest: largest.rows.map(mapRow),
        byCenro: byCenro.rows.map(mapRow),
        byDistrict: byDistrict.rows.map(mapRow),
      });
    }

    const requested = (searchParams.get("forest_type") ?? "").split(",");
    const forestTypes = requested.filter((t) => FOREST_VALID.includes(t));
    const landStatuses = requested
      .filter((t) => t in LAND_BY_TYPE)
      .map((t) => LAND_BY_TYPE[t].status);

    if (forestTypes.length === 0 && landStatuses.length === 0) {
      return NextResponse.json({ type: "FeatureCollection", features: [] });
    }

    const [forestRes, landRes] = await Promise.all([
      forestTypes.length
        ? // ST_Dump splits MultiPolygons into Polygons (LotFeature is Polygon-only).
          // Simplified ~20 m (0.0002 deg) because the mangrove has ~91k points.
          pool.query(
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
            [forestTypes]
          )
        : Promise.resolve({ rows: [] as any[] }),
      landStatuses.length
        ? // land_class_areas is small (about 4.4k vertices per layer), so no simplification.
          pool.query(
            `SELECT t.id, t.status, t.municipality, t.cenro, t.district, t.part, t.area_ha,
                    ST_AsGeoJSON(t.geom, 6)::json AS geometry
             FROM (
               SELECT l.id, l.status, l.municipality, l.cenro, l.district,
                      d.path[1] AS part,
                      CASE WHEN ST_NumGeometries(l.geom) = 1 AND l.area_ha IS NOT NULL
                           THEN l.area_ha
                           ELSE ST_Area(d.geom::geography) / 10000.0
                      END AS area_ha,
                      d.geom AS geom
               FROM land_class_areas l,
                    LATERAL ST_Dump(l.geom) AS d
               WHERE l.status = ANY($1)
             ) t
             WHERE NOT ST_IsEmpty(t.geom)
               AND ST_GeometryType(t.geom) = 'ST_Polygon'`,
            [landStatuses]
          )
        : Promise.resolve({ rows: [] as any[] }),
    ]);

    const forestFeatures = forestRes.rows.map((r: any) => ({
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

    const landFeatures = landRes.rows.map((r: any) => {
      const t = LAND_BY_STATUS[r.status];
      return {
        type: "Feature",
        id: LAND_ID_OFFSET + Number(r.id) * 100000 + Number(r.part),
        geometry: r.geometry,
        properties: {
          kind: "forest",
          forestType: t.type,
          label: r.municipality ? `${t.label} · ${r.municipality}` : t.label,
          areaHa: Number(r.area_ha),
          status: r.status,
          municipality: r.municipality,
          cenro: r.cenro,
          district: r.district,
        },
      };
    });

    return NextResponse.json({
      type: "FeatureCollection",
      features: [...forestFeatures, ...landFeatures],
    });
  } catch (err) {
    console.error("GET /api/map/forest failed:", err);
    return NextResponse.json({ error: "Failed to load forest data." }, { status: 500 });
  }
}
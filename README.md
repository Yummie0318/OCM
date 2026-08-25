# Lot Data -> Shapefile / KML / GeoJSON

A Next.js (TypeScript, App Router) web app that turns an LMB Lot Data
Computation Sheet (local plane coordinates tied to a control point) into
downloadable, real-world Shapefile, KML, and GeoJSON files, with a live map
preview of the shape while you're still typing it in.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000

To build for production:

```bash
npm run build
npm run start
```

## How it works

1. Control / Tie Point - enter the same values your control point sheet
   gives you:
   - LPCS Northing/Easting (the tie point's coordinates inside the local
     sheet, usually 20000, 20000)
   - PPCS Northing/Easting (the tie point's real-world plane coordinates)
   - PRS92 zone (1-5), picked by the province/longitude the survey is in
     (Cagayan/northern Luzon = zone 3)

   The app computes the offset between LPCS and PPCS at the tie point, and
   applies that same offset to every corner of every lot (this matches how
   LMB Lot Data Computation Sheets are meant to be georeferenced -- every
   station in the sheet is local-grid, tied to one shared reference point).

2. Lot Data - add one card per lot/parcel, with its corners (Sta/Cor,
   Northing, Easting) exactly as printed in the "COORDINATES" columns of the
   sheet. Add as many lots as you need (e.g. the parent lot + its
   subdivisions).

3. Live preview - the map on the right updates as you type:
   - a lot with 3+ valid corners is drawn as a solid, filled polygon
   - a lot you're still filling in is drawn as a dashed line with dots,
     so you can see the shape taking form corner by corner

4. Export
   - GeoJSON and KML are exported in WGS84 (lon/lat), which is what
     both formats require.
   - Shapefile (.shp/.shx/.dbf/.prj/.cpg, zipped) is exported in
     projected meters in the PRS92 zone you selected, matching how cadastral
     shapefiles are normally delivered for GIS/CAD use, complete with a
     matching .prj so it opens correctly-referenced in QGIS/ArcGIS.

## Notes / assumptions

- The local-to-real-world transform is a simple XY offset (no rotation),
  which is standard for LMB lot data sheets -- the local grid's north is
  already aligned to true/grid north, it's just shifted to an arbitrary
  origin (usually 20000, 20000) for the sheet.
- Only the shapefile export needs a projected CRS; the app currently ships
  proj4 definitions for all 5 PRS92 zones (EPSG:3121-3125). If your office
  works from the older Luzon 1911 zones (EPSG:25391-25395) instead, that's a
  small addition to src/lib/coordTransform.ts.
- The Shapefile writer (src/lib/shapefileWriter.ts) is a small
  hand-written binary writer, not a 3rd-party library -- this avoids a known
  bug in older browser shapefile-writing libraries where multiple polygon
  features get merged into a single multi-part record (which desyncs the
  .shp and .dbf row counts). Here every lot is always its own shapefile
  record and its own .dbf row.
- Everything runs client-side in the browser -- no backend/server is
  required for the coordinate math or file generation.

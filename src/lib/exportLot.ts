// Target path: src/lib/exportLot.ts
//
// Builds and opens a printable technical-description page for a single
// lot: owner/survey metadata, the lot's polygon, and a northing/easting
// coordinate table. Pulled out of LotDetailPanel.tsx so the print HTML
// lives in one place and isn't tangled up with component render logic.
//
// POLYGON (this pass): the printable page now includes a rendering of the
// lot's shape, built as a plain SVG string from the same points already
// used for the coordinate table — no dependency on ShapePreview or React,
// since this opens in a brand-new `window.open` document that doesn't
// share the app's component tree.
//
// COLOR: on screen (if the user previews the popup window before it
// prints), the polygon renders with the app's indigo accent, matching the
// rest of the product. The `@media print` block below overrides that:
// every polygon stroke/fill/label and the table's header shading get
// forced to pure black-on-white specifically when actually printing (or
// print-previewing), so the physical printout is clean black-and-white
// regardless of what color scheme was showing on screen. This also saves
// the user's color ink. `print-color-adjust`/`-webkit-print-color-adjust`
// are set to `exact` so browsers don't silently strip the (already black)
// backgrounds some printers otherwise drop by default.

import type { LotFeature } from "@/lib/geo";

interface ExportPoint {
  station: string;
  x: number; // easting
  y: number; // northing
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Builds a self-contained SVG string for the lot polygon. Coordinates are
// real-world northing/easting (can be arbitrarily large PPCS values), so
// they're normalized into a fixed viewBox here rather than relied on to
// already be screen-sized. Northing increases upward in survey space but
// SVG y increases downward, so the y-axis is flipped on the way in.
function buildPolygonSvg(points: ExportPoint[], size = 380): string {
  if (points.length < 2) {
    return `<div class="polygon-empty">No geometry for this lot.</div>`;
  }

  const padding = 34;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const available = size - padding * 2;
  const scale = Math.min(available / spanX, available / spanY);

  // Center the (possibly non-square) shape within the square viewBox.
  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offsetX = padding + (available - drawnW) / 2;
  const offsetY = padding + (available - drawnH) / 2;

  const toSvg = (pt: ExportPoint) => ({
    sx: offsetX + (pt.x - minX) * scale,
    // flip: higher northing (y) should sit higher on the page (smaller svg y)
    sy: offsetY + (maxY - pt.y) * scale,
  });

  const svgPoints = points.map(toSvg);
  const polygonAttr = svgPoints.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" ");

  const vertices = svgPoints
    .map((p, i) => {
      const station = escapeHtml(points[i].station);
      // Nudge the label away from the vertex dot so it doesn't overlap it;
      // direction doesn't need to be perfect, just legibly offset.
      const lx = p.sx + 6;
      const ly = p.sy - 6;
      return `
        <circle class="poly-point" cx="${p.sx.toFixed(1)}" cy="${p.sy.toFixed(1)}" r="3" />
        <text class="poly-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${station}</text>
      `;
    })
    .join("");

  return `
    <svg class="polygon-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Lot polygon">
      <polygon class="poly-fill" points="${polygonAttr}" />
      ${vertices}
    </svg>
  `;
}

export function exportLotAsPrintable(feature: LotFeature, points: ExportPoint[]): void {
  const p = feature.properties;

  const win = window.open("", "_blank", "width=760,height=960");
  if (!win) {
    // Popup blocked — nothing else useful to do here without pulling in a
    // toast/notification system, so this fails quietly.
    return;
  }

  const rows = points
    .map(
      (pt) =>
        `<tr><td>${escapeHtml(pt.station)}</td><td>${pt.y.toFixed(2)}</td><td>${pt.x.toFixed(2)}</td></tr>`
    )
    .join("");

  const lotNo = escapeHtml(p.lotNo ?? "—");
  const owner = escapeHtml(p.owner || "—");
  const location = escapeHtml(
    [p.barangay, p.municipality, p.province].filter(Boolean).join(", ") || "—"
  );
  const surveyNo = escapeHtml(p.surveyNo ?? "—");
  const patentNo = escapeHtml(p.patentNo ?? "—");
  const dateSurveyed = escapeHtml(p.dateSurveyed ?? "—");
  const surveyor = escapeHtml(p.surveyor ?? "—");
  const sheetNo = escapeHtml(p.sheetNo ?? "—");
  const areaSqm = p.areaSqm != null ? escapeHtml(String(p.areaSqm)) : "—";

  const polygonSvg = buildPolygonSvg(points);

  win.document.write(`
    <html>
      <head>
        <title>Lot ${lotNo} — Technical Description</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          h2 { font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #444; }
          .meta { font-size: 13px; color: #444; margin-bottom: 16px; }
          .meta div { margin-bottom: 2px; }

          .polygon-section { margin: 20px 0; }
          .polygon-wrap {
            display: flex;
            justify-content: center;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 12px;
            background: #fafafa;
          }
          .polygon-svg { width: 100%; max-width: 380px; height: auto; display: block; }
          .polygon-empty { font-size: 12px; color: #888; padding: 24px; text-align: center; }

          /* Screen (and print-preview-before-you-actually-print) colors —
             matches the app's indigo accent. Overridden to black/white
             below in @media print. */
          .poly-fill { fill: #eef1ff; stroke: #4f46e5; stroke-width: 2; }
          .poly-point { fill: #4f46e5; }
          .poly-label { font-size: 10px; font-family: Arial, sans-serif; fill: #333; }

          table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; }
          .footer { margin-top: 24px; font-size: 11px; color: #888; }

          @media print {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;

            body { color: #000; }
            .polygon-wrap { background: #fff !important; border-color: #000 !important; }
            .poly-fill { fill: none !important; stroke: #000 !important; stroke-width: 1.5 !important; }
            .poly-point { fill: #000 !important; }
            .poly-label { fill: #000 !important; }
            th { background: #fff !important; border-color: #000 !important; }
            td { border-color: #000 !important; }
            .footer { color: #000; }
          }
        </style>
      </head>
      <body>
        <h1>Lot ${lotNo}</h1>
        <div class="meta">
          <div><strong>Owner:</strong> ${owner}</div>
          <div><strong>Location:</strong> ${location}</div>
          <div><strong>Survey No.:</strong> ${surveyNo}</div>
          <div><strong>Patent No.:</strong> ${patentNo}</div>
          <div><strong>Date Surveyed:</strong> ${dateSurveyed}</div>
          <div><strong>Surveyor:</strong> ${surveyor}</div>
          <div><strong>Sheet No.:</strong> ${sheetNo}</div>
          <div><strong>Area:</strong> ${areaSqm} sq.m.</div>
        </div>

        <div class="polygon-section">
          <h2>Lot Polygon</h2>
          <div class="polygon-wrap">${polygonSvg}</div>
        </div>

        <h2>Technical Description</h2>
        <table>
          <thead><tr><th>Station</th><th>Northing (PPCS)</th><th>Easting (PPCS)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="footer">Generated ${new Date().toLocaleString()}</div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}
"use client";

// Target path: src/components/map/CoordinatesModal.tsx
//
// Simple centered modal listing each corner's northing/easting. Numbering
// here (1, 2, 3...) matches the badges ShapePreview draws when given
// pointLabelMode="index", so users can cross-reference shape <-> table.

interface CoordPoint {
  x: number; // easting
  y: number; // northing
}

interface Props {
  open: boolean;
  onClose: () => void;
  lotLabel?: string;
  points: CoordPoint[];
}

export default function CoordinatesModal({ open, onClose, lotLabel, points }: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 8,
          width: 360,
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>Coordinates{lotLabel ? ` — Lot ${lotLabel}` : ""}</h4>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer" }}
          >
            &times;
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "4px 6px" }}>Corner</th>
              <th style={{ padding: "4px 6px" }}>Northing</th>
              <th style={{ padding: "4px 6px" }}>Easting</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "4px 6px", fontWeight: 600 }}>{i + 1}</td>
                <td style={{ padding: "4px 6px" }}>{p.y.toFixed(2)}</td>
                <td style={{ padding: "4px 6px" }}>{p.x.toFixed(2)}</td>
              </tr>
            ))}
            {points.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: "8px 6px", color: "#777" }}>
                  No corners to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
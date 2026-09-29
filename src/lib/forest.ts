export const FOREST_TYPES = [
  { type: "closed_forest", label: "Closed Forest", color: "#166534" },
  { type: "open_forest", label: "Open Forest", color: "#84cc16" },
  { type: "mangrove", label: "Mangrove Forest", color: "#0d9488" },
] as const;

export const FOREST_COLOR: Record<string, string> = Object.fromEntries(
  FOREST_TYPES.map((t) => [t.type, t.color])
);

// Keeps forest ids from colliding with lot ids (page.tsx dedupes by id).
export const FOREST_ID_OFFSET = 1_000_000_000;

export const isForestFeature = (f: { properties: any }) => f.properties?.kind === "forest";
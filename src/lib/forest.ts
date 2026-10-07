export const FOREST_TYPES = [
  { type: "closed_forest", label: "Closed Forest", color: "#166534" },
  { type: "open_forest", label: "Open Forest", color: "#84cc16" },
  { type: "mangrove", label: "Mangrove Forest", color: "#0d9488" },
] as const;

// A&D and Forest Land (table: land_class_areas, one status per layer).
// They reuse the "forest:<type>" selection keys and the kind:"forest" feature
// shape, so the map, attribute table and Selected tab treat them like forest
// cover without any change to page.tsx.
export const LAND_CLASS_TYPES = [
  {
    type: "a_and_d",
    status: "A&D",
    label: "A&D Land",
    fullName: "Alienable & Disposable Land",
    color: "#ec4899",
  },
  {
    type: "forest_land",
    status: "FL",
    label: "Forest Land",
    fullName: "Forest Land",
    color: "#365314",
  },
] as const;

export const FOREST_COLOR: Record<string, string> = Object.fromEntries(
  [...FOREST_TYPES, ...LAND_CLASS_TYPES].map((t) => [t.type, t.color])
);

// Keeps forest ids from colliding with lot ids (page.tsx dedupes by id).
export const FOREST_ID_OFFSET = 1_000_000_000;
// Separate range so land_class_areas ids can't collide with forest_areas ids.
export const LAND_ID_OFFSET = 2_000_000_000;

export const isForestFeature = (f: { properties: any }) => f.properties?.kind === "forest";

export const isLandClassFeature = (f: { properties: any }) =>
  f.properties?.forestType === "a_and_d" || f.properties?.forestType === "forest_land";
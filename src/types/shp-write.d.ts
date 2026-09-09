// Target path: src/types/shp-write.d.ts
//
// `shp-write` ships no bundled TypeScript types and has no @types package
// on npm, so without this file `import("shp-write")` in mapExport.ts falls
// back to `any` implicitly and TS complains under strict settings. This
// declares just enough of its shape (an untyped `zip` function) to satisfy
// the compiler — mapExport.ts already treats the actual return value
// defensively (handles both callback and Promise styles) since the
// package's own documented API has drifted across versions.
declare module "shp-write" {
  const shpwrite: {
    zip: (...args: any[]) => any;
    [key: string]: any;
  };
  export default shpwrite;
}
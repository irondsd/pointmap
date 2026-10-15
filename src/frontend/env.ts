// Set by scripts/build.ts. Under the local Bun server it's never defined.
declare const POINTMAP_STATIC: boolean | undefined;

/**
 * Whether the local Bun server is behind the page. The static build (deployed to Vercel) has none,
 * so files can't be opened by path there; only picked or dropped files, kept in IndexedDB.
 */
export const HAS_SERVER = typeof POINTMAP_STATIC === "undefined" || !POINTMAP_STATIC;

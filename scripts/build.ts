/**
 * Builds the app as a static site in dist/, for hosting without the Bun server (e.g. on Vercel).
 * Everything runs in the browser; the only server feature, opening files by path, is left out.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist");

await rm(out, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/frontend/index.html")],
  outdir: out,
  minify: true,
  sourcemap: "linked",
  define: { POINTMAP_STATIC: "true", "process.env.NODE_ENV": '"production"' },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// MapLibre's worker is loaded from /vendor/ (see map.ts); the dev server serves it from node_modules.
const dist = join(root, "node_modules/maplibre-gl/dist");
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs.map"])
  await Bun.write(join(out, "vendor", f), Bun.file(join(dist, f)));

for (const o of result.outputs) console.log(`${o.path.slice(root.length + 1)}  ${(o.size / 1024).toFixed(0)} KB`);
console.log("dist/vendor/maplibre-gl-worker.mjs");

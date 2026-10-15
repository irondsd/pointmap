import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import index from "./frontend/index.html";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";

// ---------------------------------------------------------------- security
// Only ever serve the local machine: reject foreign Host headers (DNS rebinding).
// The file endpoint reads from disk, so this matters.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function forbidden(req: Request): boolean {
  const hostname = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  return !LOCAL_HOSTS.has(hostname);
}

type Handler<R extends Request> = (req: R) => Response | Promise<Response>;
function guard<R extends Request>(h: Handler<R>): Handler<R> {
  return (req) => (forbidden(req) ? new Response("Forbidden", { status: 403 }) : h(req));
}

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

// ---------------------------------------------------------------- files
/** Only place lists are ever read, so the endpoint can't be used to read arbitrary files. */
const LIST_EXT = new Set([".kmz", ".kml"]);

function expandPath(p: string): string {
  const t = p.trim();
  if (t === "~") return homedir();
  if (t.startsWith("~/")) return join(homedir(), t.slice(2));
  return resolve(t);
}

const VENDOR_DIR = join(import.meta.dir, "..", "node_modules", "maplibre-gl", "dist");
const VENDOR_FILES = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs.map"]);

// ---------------------------------------------------------------- server
const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  routes: {
    "/": index,

    /** Reads a .kmz/.kml by path; the client keeps the path and parses the bytes itself. */
    "/api/file": {
      GET: guard(async (req) => {
        const raw = new URL(req.url).searchParams.get("path");
        if (!raw?.trim()) return bad("path is required");
        const path = expandPath(raw);
        if (!LIST_EXT.has(extname(path).toLowerCase())) return bad("Only .kmz and .kml files can be opened");
        const file = Bun.file(path);
        if (!(await file.exists())) return bad(`File not found: ${path}`, 404);
        return new Response(file, {
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "no-store",
            "x-file-name": encodeURIComponent(basename(path)),
            "x-file-path": encodeURIComponent(path),
            "last-modified": new Date(file.lastModified).toUTCString(),
          },
        });
      }),
    },

    "/vendor/:file": {
      GET: guard((req) => {
        if (!VENDOR_FILES.has(req.params.file)) return bad("not found", 404);
        return new Response(Bun.file(join(VENDOR_DIR, req.params.file)), {
          headers: { "content-type": "text/javascript", "cache-control": "max-age=86400" },
        });
      }),
    },
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Pointmap running at http://localhost:${server.port}`);

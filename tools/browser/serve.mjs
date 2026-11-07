// The tracer's static host: serves the page, the bundles, the committed plan/vectors, and a game folder as one payload.
//
//   node tools/browser/serve.mjs [--port 4173]
//
// Only these roots are served — `apps/`, `fixtures/`, `golden/`, `media/`, `tools/` — so the server cannot be talked into
// reading anything else. A game folder comes back as one JSON payload (`/api/game`), which is the whole-package load the
// tracer proves; the streaming modes of D-4 are entry 9.9's.

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

// `docs` and `packages/core/test/fixtures` carry the examples and authored oracles the golden scenes replay; nothing
// else outside these roots is reachable.
const ROOTS = ["apps", "docs", "fixtures", "golden", "media", "stock", "tools", "packages/core/test/fixtures", "packages/runner-mobile/app", "packages/runner-web/app"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
};

const root = resolve(process.cwd());
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || (process.argv.includes("--port") ? 4173 : 4173);

function inside(relative) {
  const resolved = resolve(root, relative);
  return resolved === root || resolved.startsWith(root + sep) ? resolved : null;
}

function filesUnder(relativeRoot) {
  const directory = inside(relativeRoot);
  if (directory === null || !existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { recursive: true, encoding: "utf8" }).map((path) => path.split("\\").join("/")).sort()) {
    const full = join(directory, entry);
    if (statSync(full).isFile()) files.push({ path: entry, bytes: readFileSync(full).toString("base64") });
  }
  return files;
}

function allowed(relative) {
  return ROOTS.some((root) => relative === root || relative.startsWith(`${root}/`));
}

/** One `bytes=a-b` | `bytes=a-` | `bytes=-n` range against a file of `size` bytes; null when unsupported or unsatisfiable. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  if (size === 0) return null;
  if (match[1] === "") {
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length === 0) return null;
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname === "/api/game" || url.pathname === "/api/bundled") {
    const requested =
      url.pathname === "/api/game"
        ? [url.searchParams.get("root") ?? ""]
        : (url.searchParams.get("folders") ?? "").split(",").filter((folder) => folder !== "");
    if (requested.length === 0 || requested.some((entry) => entry === "" || !allowed(entry))) {
      response.writeHead(400).end("bad root");
      return;
    }
    const files = requested.flatMap((entry) =>
      url.pathname === "/api/game"
        ? filesUnder(entry)
        : filesUnder(entry).map((file) => ({ path: `${entry}/${file.path}`, bytes: file.bytes })),
    );
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ files }));
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replaceAll("\\", "/").replace(/^\/+/, "");
  if (relative === "" || !allowed(relative)) {
    response.writeHead(404).end("not found");
    return;
  }
  const full = inside(relative);
  if (full === null || !existsSync(full) || !statSync(full).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  const type = TYPES[extname(full)] ?? "application/octet-stream";
  const size = statSync(full).size;
  const header = request.headers.range;
  const extraHeaders = {};
  if (relative === "apps/service-worker.js") {
    // Allow /apps/service-worker.js to control scopes under /packages/runner-web/app/ (specifically the player page).
    extraHeaders["service-worker-allowed"] = "/packages/runner-web/app/";
  }
  if (header === undefined || request.headers["if-range"] !== undefined) {
    // No validators (ETag / Last-Modified) are issued, so a conditional If-Range can never match: serve the whole file.
    response.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", ...extraHeaders });
    createReadStream(full).pipe(response);
    return;
  }
  const range = parseRange(header, size);
  if (range === null) {
    // Unsupported unit, multiple ranges, malformed spec, or outside the file: rejected, never silently served in full.
    response.writeHead(416, { "content-range": `bytes */${size}`, "accept-ranges": "bytes", "content-length": 0, ...extraHeaders }).end();
    return;
  }
  response.writeHead(206, {
    "content-type": type,
    "content-range": `bytes ${range.start}-${range.end}/${size}`,
    "content-length": range.end - range.start + 1,
    "accept-ranges": "bytes",
    ...extraHeaders,
  });
  createReadStream(full, { start: range.start, end: range.end }).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`browser host on http://127.0.0.1:${port}/packages/runner-web/app/index.html`);
});

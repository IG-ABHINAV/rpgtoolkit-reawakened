// Browser bundle build (D-8): esbuild, one IIFE per entry point, no runtime import().
//
//   node tools/browser/build.mjs
//
// Bundles the player page and the conformance page from the same `tsc -b` output the headless runner uses, into
// `apps/`. Nothing here is a dev server: the bundles are the artefacts the lane serves.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "apps");

const entries = [
  { in: join(root, "packages/runner-web/app/main.ts"), out: "player.js" },
  { in: join(root, "packages/runner-web/app/vectors.ts"), out: "vectors.js" },
  { in: join(root, "packages/runner-web/app/agreement.ts"), out: "agreement.js" },
  { in: join(root, "packages/runner-web/app/audio.ts"), out: "audio.js" },
  { in: join(root, "packages/runner-web/app/video.ts"), out: "video.js" },
  { in: join(root, "packages/runner-web/app/storage.ts"), out: "storage.js" },
  { in: join(root, "packages/runner-web/src/decode-worker.ts"), out: "decode-worker.js" },
  { in: join(root, "packages/runner-web/src/audio-worklet.ts"), out: "audio-worklet.js" },
  { in: join(root, "packages/runner-web/app/decode.ts"), out: "decode.js" },
  { in: join(root, "packages/runner-web/app/worker-probe.ts"), out: "worker-probe.js" },
];

mkdirSync(out, { recursive: true });
for (const entry of entries) {
  await build({
    entryPoints: [entry.in],
    outfile: join(out, entry.out),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    logLevel: "warning",
    // The worker and the AudioWorklet are single-file IIFE bundles with no runtime import(); so is every page entry.
  });
  console.log(`built apps/${entry.out}`);
}

// The browser page needs the same bundled-asset manifest the desktop build produces, so both runners can resolve
// shared fonts and cursors from the `apps/` static tree without fetching the whole package manifest on boot.
const folders = ["media/fonts", "media/cursors", "media/soundfonts"];
const bundled = folders.flatMap((folder) =>
  readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${folder}/${entry.name}`)
    .sort(),
);
writeFileSync(join(out, "bundled.json"), `${JSON.stringify({ folders, files: bundled }, null, 2)}\n`);
console.log(`built apps/bundled.json (${bundled.length} bundled assets listed)`);

// Precache manifest (issue #934): listing app shell files, content-derived version, and bundled assets.
const shellFiles = [
  "packages/runner-web/app/index.html",
  "apps/player.js",
  "apps/decode-worker.js",
  "apps/audio-worklet.js",
  "apps/bundled.json",
  "golden/closing/plan.json",
];
const hasher = createHash("sha256");
for (const rel of shellFiles) {
  const full = join(root, rel);
  if (existsSync(full)) {
    hasher.update(rel);
    hasher.update(readFileSync(full));
  }
}
for (const rel of bundled) {
  const full = join(root, rel);
  if (existsSync(full)) {
    hasher.update(rel);
    hasher.update(readFileSync(full));
  }
}
const version = hasher.digest("hex").slice(0, 16);

const precache = {
  version,
  shell: [
    "/packages/runner-web/app/index.html",
    "/apps/player.js",
    "/apps/decode-worker.js",
    "/apps/audio-worklet.js",
    "/apps/bundled.json",
    "/apps/precache.json",
    "/golden/closing/plan.json",
  ],
  bundled: bundled.map((path) => `/${path}`),
};
writeFileSync(join(out, "precache.json"), `${JSON.stringify(precache, null, 2)}\n`);
console.log(`built apps/precache.json (version ${version}, ${precache.shell.length + precache.bundled.length} precached URLs)`);

// The service worker bundle embeds the content-derived version and precache manifest
await build({
  entryPoints: [join(root, "packages/runner-web/src/service-worker.ts")],
  outfile: join(out, "service-worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "warning",
  define: {
    "__SERVICE_WORKER_VERSION__": JSON.stringify(version),
    "__PRECACHE_MANIFEST__": JSON.stringify(JSON.stringify(precache)),
  },
});
console.log(`built apps/service-worker.js (version ${version})`);

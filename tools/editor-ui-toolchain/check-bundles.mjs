// No `editor-ui` bundle may contain `eval(` or `new Function` (ADR 0025 decision 6; ADR 0015 decision 1): the strict
// CSP has no `unsafe-eval`, so a bundle that builds code from a string breaks in the browser and the webview.
//
//   node tools/editor-ui-toolchain/check-bundles.mjs [file-or-directory ...]
//
// With no argument it scans (1) a fresh in-memory bundle of the toolchain fixture, built with the options the browser
// build uses (tools/browser/bundle-options.mjs), so a toolchain or Preact change that introduces dynamic code fails
// here, and (2) every `.js`/`.mjs` file under `apps/editor-ui/`, where the editor's own bundles will be built, when
// that directory exists. With arguments it scans exactly those files and directories (recursively). It exits 1 and
// names each file, line, column and match when it finds one, and 2 when it was given nothing it could read.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleOptions } from "../browser/bundle-options.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// `eval(` (a call, also with whitespace), the indirect form `(0, eval)`, and `new Function`. A property or identifier
// that merely ends in these letters (`retrieval(`, `isFunction`) does not match.
const PATTERNS = [
  { name: "eval(", regex: /(?<![\w$])eval\s*\(/g },
  { name: "indirect eval", regex: /\(\s*0\s*,\s*eval\s*\)/g },
  { name: "new Function", regex: /(?<![\w$])new\s+Function(?![\w$])/g },
];

/** Every dynamic-code construct in `text`, with its 1-based line and column. */
export function findDynamicCode(text) {
  const found = [];
  for (const { name, regex } of PATTERNS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      const column = match.index - (before.lastIndexOf("\n") + 1) + 1;
      const from = Math.max(0, match.index - 20);
      found.push({ pattern: name, line, column, context: text.slice(from, match.index + match[0].length + 20) });
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

function bundleFiles(path) {
  const info = statSync(path);
  if (info.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return bundleFiles(child);
    return /\.(?:js|mjs)$/.test(entry.name) ? [child] : [];
  });
}

/** The fixture bundle exactly as the browser build would emit it, held in memory. */
export async function buildFixtureBundle() {
  const result = await build({
    ...bundleOptions,
    entryPoints: [join(here, "fixtures", "main.tsx")],
    outfile: "toolchain-fixture.js",
    write: false,
    minify: true,
    absWorkingDir: repoRoot,
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error("esbuild produced no output for the toolchain fixture");
  return { label: "toolchain fixture (in memory)", text: output.text };
}

/** Scans in-memory sources; returns `{ scanned, problems }`. */
export function scanSources(sources) {
  const problems = [];
  for (const { label, text } of sources) {
    for (const hit of findDynamicCode(text)) problems.push({ file: label, ...hit });
  }
  return { scanned: sources.length, problems };
}

async function main(argv) {
  let sources;
  if (argv.length > 0) {
    for (const target of argv) {
      if (!existsSync(target)) {
        console.error(`check-bundles: ${target} does not exist`);
        return 2;
      }
    }
    sources = [];
    for (const target of argv) {
      for (const file of bundleFiles(target)) sources.push({ label: file, text: readFileSync(file, "utf8") });
    }
  } else {
    sources = [await buildFixtureBundle()];
    const editorUi = join(repoRoot, "apps", "editor-ui");
    if (existsSync(editorUi)) {
      for (const file of bundleFiles(editorUi)) {
        sources.push({ label: relative(repoRoot, file), text: readFileSync(file, "utf8") });
      }
    }
  }
  if (sources.length === 0) {
    console.error("check-bundles: no bundle to scan");
    return 2;
  }
  const { scanned, problems } = scanSources(sources);
  for (const problem of problems) {
    console.error(
      `check-bundles: ${problem.file}:${problem.line}:${problem.column}: ${problem.pattern} in a bundle (ADR 0025 decision 6): …${JSON.stringify(problem.context)}…`,
    );
  }
  if (problems.length > 0) return 1;
  console.log(`check-bundles: ${scanned} bundle${scanned === 1 ? "" : "s"} scanned, no eval( or new Function.`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}

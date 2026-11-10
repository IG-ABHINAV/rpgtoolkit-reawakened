// ADR 0025 "What 11.2 does first", items 2 and 3: the JSX options agree between `tsc` and esbuild, a `.tsx` file is
// type-checked and bundled, and the bundle check fails on `eval(` and `new Function`.
import { test } from "node:test";
import { equal, match, notEqual, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleOptions } from "../../browser/bundle-options.mjs";
import { buildFixtureBundle, findDynamicCode, scanSources } from "../check-bundles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const fixtures = join(repoRoot, "tools", "editor-ui-toolchain", "fixtures");
const tsc = join(repoRoot, "node_modules", ".bin", "tsc");
const checker = join(repoRoot, "tools", "editor-ui-toolchain", "check-bundles.mjs");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// A scratch project below node_modules, so `preact` resolves from the repository root and no tool lints or commits it.
function withProject(label, { options = {}, files }, body) {
  const cache = join(repoRoot, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, `editor-ui-${label}-`));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: options.extends ?? join(repoRoot, "tsconfig.editor-ui.json"),
        compilerOptions: { composite: false, declaration: false, noEmit: true, rootDir: ".", ...options.compilerOptions },
        include: ["*.tsx"],
      }),
    );
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function typecheck(dir) {
  const result = spawnSync(tsc, ["-p", dir], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const counterSource = readFileSync(join(fixtures, "counter.tsx"), "utf8");

test("tsc and esbuild name the same JSX runtime, and the base config stays free of it", () => {
  const editorUi = readJson(join(repoRoot, "tsconfig.editor-ui.json")).compilerOptions;
  equal(editorUi.jsx, "react-jsx", "tsc: automatic runtime");
  equal(bundleOptions.jsx, "automatic", "esbuild: automatic runtime");
  equal(editorUi.jsxImportSource, "preact");
  equal(bundleOptions.jsxImportSource, editorUi.jsxImportSource, "tsc and esbuild disagree on the import source");
  ok(editorUi.lib.includes("DOM"), "editor-ui projects get the DOM lib");
  // `core` extends the base config: no DOM lib and no JSX there (G2).
  const base = readJson(join(repoRoot, "tsconfig.base.json")).compilerOptions;
  equal(base.lib, undefined, "tsconfig.base.json must not name a lib (core is DOM-free)");
  equal(base.jsx, undefined, "tsconfig.base.json must not enable JSX");
  equal(base.jsxImportSource, undefined);
});

// `preact` is a production dependency of `packages/editor-ui`. The fixture below `tools/` is not a package, so it
// resolves the repository root's dev-only copy; the two must be the same exact version (ADR 0025 decision 1).
test("the root's dev copy of preact is the exact version editor-ui ships", () => {
  const shipped = readJson(join(repoRoot, "packages", "editor-ui", "package.json")).dependencies.preact;
  const dev = readJson(join(repoRoot, "package.json")).devDependencies.preact;
  match(shipped, /^\d+\.\d+\.\d+$/, "editor-ui pins preact exactly, no range");
  equal(dev, shipped);
  ok(readJson(join(repoRoot, "package.json")).dependencies?.preact === undefined, "the root does not ship preact");
});

test("a .tsx file type-checks under the editor-ui config", () => {
  withProject("clean", { files: { "counter.tsx": counterSource } }, (dir) => {
    const result = typecheck(dir);
    equal(result.status, 0, result.output);
  });
});

test("a .tsx file with a wrong prop type fails the type check", () => {
  const files = {
    "counter.tsx": counterSource,
    "bad.tsx": 'import { Counter } from "./counter.tsx";\nexport const bad = <Counter label={7} />;\n',
  };
  withProject("bad", { files }, (dir) => {
    const result = typecheck(dir);
    notEqual(result.status, 0);
    match(result.output, /bad\.tsx.*TS2322/);
  });
});

test("without the JSX options tsc refuses a .tsx file", () => {
  withProject(
    "nojsx",
    { options: { extends: join(repoRoot, "tsconfig.base.json"), compilerOptions: { lib: ["ES2022", "DOM"], types: [] } }, files: { "counter.tsx": counterSource } },
    (dir) => {
      const result = typecheck(dir);
      notEqual(result.status, 0);
      match(result.output, /TS17004/);
    },
  );
});

test("esbuild bundles the fixture with preact's JSX runtime and no react import", async () => {
  const result = await build({
    ...bundleOptions,
    entryPoints: [join(fixtures, "main.tsx")],
    outfile: "fixture.js",
    write: false,
    absWorkingDir: repoRoot,
    // The options alone decide the transform here; the tsconfig agreement is the first test's job.
    tsconfigRaw: "{}",
  });
  const text = result.outputFiles[0].text;
  ok(text.includes("preact"), "the bundle carries preact");
  ok(text.includes("preact/jsx-runtime"), "the JSX factory comes from preact/jsx-runtime");
  ok(!text.includes("node_modules/react/"), "the bundle must not carry React");
  ok(!text.includes("React.createElement"), "the bundle must not use the classic runtime");
});

test("esbuild without the shared JSX options does not bundle the fixture the same way", async () => {
  const withoutJsx = { ...bundleOptions };
  delete withoutJsx.jsx;
  delete withoutJsx.jsxImportSource;
  // An empty tsconfig stops esbuild reading `tsconfig.editor-ui.json`, so only the options decide the transform.
  const result = await build({
    ...withoutJsx,
    entryPoints: [join(fixtures, "main.tsx")],
    outfile: "fixture.js",
    write: false,
    absWorkingDir: repoRoot,
    tsconfigRaw: "{}",
  }).then(
    (built) => ({ ok: true, text: built.outputFiles[0].text }),
    (error) => ({ ok: false, text: String(error) }),
  );
  // Classic runtime: `React.createElement` is emitted and `React` is never defined, so the bundle would be wrong.
  ok(result.text.includes("React.createElement"), "without the JSX options the fixture falls back to the classic runtime");
});

test("bundle check: the fixture bundle is clean", async () => {
  const fixture = await buildFixtureBundle();
  const { scanned, problems } = scanSources([fixture]);
  equal(scanned, 1);
  equal(problems.length, 0, JSON.stringify(problems));
});

test("bundle check: eval( and new Function are found, look-alikes are not", () => {
  const hits = findDynamicCode('var a=1;\nx=eval("1");\nvar f=new Function("return 1");\n(0,eval)("2");');
  equal(hits.map((hit) => hit.pattern).sort().join(","), "eval(,indirect eval,new Function");
  const eval1 = hits.find((hit) => hit.pattern === "eval(");
  equal(eval1.line, 2);
  equal(findDynamicCode("var retrieval=1,r=retrieval(2),isFunction=3,newFunctionName=4;").length, 0);
});

test("bundle check CLI: exits 1 on a bundle with eval( or new Function, 0 on a clean one", async () => {
  const fixture = await buildFixtureBundle();
  const dir = mkdtempSync(join(resolve(repoRoot, "node_modules", ".cache"), "check-bundles-"));
  try {
    const clean = join(dir, "clean.js");
    writeFileSync(clean, fixture.text);
    const ran = spawnSync(process.execPath, [checker, clean], { encoding: "utf8" });
    equal(ran.status, 0, ran.stderr);
    for (const [name, payload] of [
      ["eval.js", `${fixture.text}\n;eval("1+1");`],
      ["function.js", `${fixture.text}\n;var f = new Function("return 1");`],
    ]) {
      const bad = join(dir, name);
      writeFileSync(bad, payload);
      const result = spawnSync(process.execPath, [checker, bad], { encoding: "utf8" });
      equal(result.status, 1, `${name}: ${result.stdout}${result.stderr}`);
      match(result.stderr, new RegExp(`${name}:\\d+:\\d+`));
    }
    // A directory is scanned recursively.
    const nested = spawnSync(process.execPath, [checker, dir], { encoding: "utf8" });
    equal(nested.status, 1);
    equal(spawnSync(process.execPath, [checker, join(dir, "missing")], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

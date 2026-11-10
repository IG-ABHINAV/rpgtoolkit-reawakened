// One fixture per row of the story's I/O & edge-case matrix: proves every rule
// tools/deps/graph.mjs generates actually fires, and that the list is validated
// before anything is generated (AD-22; guard-rails G2 rule 5 and G4 rule 4).
import { test } from "node:test";
import { equal, match, notEqual, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tool = resolve(dirname(fileURLToPath(import.meta.url)), "..", "graph.mjs");
const anchor = "may be depended on by";

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function manifest(name) {
  return `${JSON.stringify(
    {
      name: `@tk-reawakened/${name}`,
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    },
    null,
    2,
  )}\n`;
}

// The fixture spine is the smallest markdown file the tool can find the anchor
// and an empty mermaid block in; `--write` fills the block from the list.
function spineText(anchorText = anchor, directive = "graph LR") {
  return `# Fixture spine\n\nAn arrow means "${anchorText}".\n\n\`\`\`mermaid\n${directive}\n\`\`\`\n`;
}

function writeList(root, packages, edges, diagram = { file: "spine.md", anchor }) {
  writeFile(
    join(root, "tools", "deps", "edges.json"),
    `${JSON.stringify({ packages, edges, diagram }, null, 2)}\n`,
  );
}

/**
 * @param {{packages?: Record<string, Record<string, string>>,
 *          unlisted?: Record<string, Record<string, string>>,
 *          edges?: Array<[string, string]>,
 *          nodeModules?: Record<string, Record<string, string>>,
 *          spine?: string}} spec
 */
function buildRoot(label, spec = {}) {
  const root = mkdtempSync(join(tmpdir(), `graph-${label}-`));
  const packages = spec.packages ?? {};
  for (const [name, files] of Object.entries(packages)) {
    writeFile(join(root, "packages", name, "package.json"), manifest(name));
    for (const [file, source] of Object.entries(files)) {
      writeFile(join(root, "packages", name, file), source);
    }
  }
  for (const [name, files] of Object.entries(spec.unlisted ?? {})) {
    writeFile(join(root, "packages", name, "package.json"), manifest(name));
    for (const [file, source] of Object.entries(files)) {
      writeFile(join(root, "packages", name, file), source);
    }
  }
  writeList(root, Object.keys(packages), spec.edges ?? []);
  writeFile(join(root, "spine.md"), spec.spine ?? spineText());
  for (const [name, files] of Object.entries(spec.nodeModules ?? {})) {
    for (const [file, source] of Object.entries(files)) {
      writeFile(join(root, "node_modules", name, file), source);
    }
  }
  return root;
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [tool, root, ...args], { encoding: "utf8" });
  result.output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return result;
}

// `--write` regenerates the config and the diagram and then cruises as well, so
// on a fixture that is meant to violate a rule its status says nothing about the
// write; the check that follows is what the rows assert on.
function seed(root) {
  run(root, "--write");
}

function withRoot(label, spec, body) {
  const root = buildRoot(label, spec);
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function violations(text) {
  return text.split("\n").filter((line) => /^\s+(error|warn)\s/.test(line));
}

const renderEngineStub = {
  phaser: {
    "package.json": `${JSON.stringify({ name: "phaser", version: "3.90.0", main: "index.js" })}\n`,
    "index.js": "module.exports = {};\n",
  },
};

test("clean tree: listed imports only", () => {
  withRoot(
    "clean",
    {
      packages: {
        a: { "src/index.ts": 'import { b } from "@tk-reawakened/b";\nexport const x = b;\n' },
        b: { "src/index.ts": "export const b = 1;\n" },
      },
      edges: [["b", "a"]],
    },
    (root) => {
      equal(run(root, "--write").status, 0);
      const result = run(root);
      equal(result.status, 0, result.output);
      match(result.output, /no dependency violations found/);
    },
  );
});

test("import not an edge: r1-<a>-workspace-edges names file and target", () => {
  withRoot(
    "not-an-edge",
    {
      packages: {
        a: { "src/index.ts": 'import { b } from "@tk-reawakened/b";\nexport const x = b;\n' },
        b: { "src/index.ts": "export const b = 1;\n" },
      },
      edges: [],
    },
    (root) => {
      seed(root);
      const result = run(root);
      notEqual(result.status, 0);
      match(result.output, /r1-a-workspace-edges: packages\/a\/src\/index\.ts\s*\u2192\s*packages\/b\/src\/index\.ts/);
    },
  );
});

test("relative escape: r1-<a>-no-relative-escape fires even into an allowed sibling", () => {
  withRoot(
    "escape",
    {
      packages: {
        a: { "src/index.ts": 'import { b } from "../../b/src/index.ts";\nexport const x = b;\n' },
        b: { "src/index.ts": "export const b = 1;\n" },
      },
      // b is an allowed dependency of a, so only the escape rule can catch this.
      edges: [["b", "a"]],
    },
    (root) => {
      seed(root);
      const result = run(root);
      notEqual(result.status, 0);
      match(result.output, /r1-a-no-relative-escape: packages\/a\/src\/index\.ts\s*\u2192\s*packages\/b\/src\/index\.ts/);
      ok(
        !result.output.includes("r1-a-workspace-edges"),
        `the edges rule must stay silent:\n${result.output}`,
      );
    },
  );
});

test("deep import: r2 catches src, dist and import type subpaths, entry is clean", () => {
  withRoot(
    "deep",
    {
      packages: {
        a: {
          "src/index.ts": [
            'import { b } from "@tk-reawakened/b";',
            'import { x } from "@tk-reawakened/b/src/x.ts";',
            'import type { T } from "@tk-reawakened/b/src/y.ts";',
            'import { d } from "@tk-reawakened/b/dist/index.js";',
            "export const y = [b, x, d] as T[];",
            "",
          ].join("\n"),
        },
        b: {
          "src/index.ts": "export const b = 1;\n",
          "src/x.ts": "export const x = 2;\n",
          "src/y.ts": "export type T = { a: number };\n",
        },
      },
      edges: [["b", "a"]],
    },
    (root) => {
      seed(root);
      const result = run(root);
      notEqual(result.status, 0);
      const deep = violations(result.output).filter((line) => line.includes("r2-no-deep-package-imports"));
      equal(deep.length, 3, result.output);
      for (const target of [
        "@tk-reawakened/b/src/x.ts",
        "@tk-reawakened/b/src/y.ts",
        "@tk-reawakened/b/dist/index.js",
      ]) {
        ok(
          deep.some((line) => line.includes(target)),
          `${target} must be reported:\n${result.output}`,
        );
      }
      // the entry import and the package's own files are clean, so r2 is the only rule that fires
      equal(violations(result.output).length, 3, result.output);
    },
  );
});

test("engine import: r3 fires outside packages/runner-*/src/render/ only", () => {
  withRoot(
    "engine",
    {
      packages: {
        "runner-web": {
          "src/index.ts": 'import phaser from "phaser";\nexport const game = phaser;\n',
          "src/render/renderer.ts": 'import phaser from "phaser";\nexport const renderer = phaser;\n',
        },
      },
      edges: [],
      nodeModules: renderEngineStub,
    },
    (root) => {
      seed(root);
      const result = run(root);
      notEqual(result.status, 0);
      const engine = violations(result.output).filter((line) =>
        line.includes("r3-render-engines-only-in-render"),
      );
      equal(engine.length, 1, result.output);
      match(engine[0], /packages\/runner-web\/src\/index\.ts/);
      ok(!engine[0].includes("renderer.ts"), result.output);
    },
  );
});

test("node builtin: r4 fires for script-tools/src only, not its tests", () => {
  withRoot(
    "script-tools-node",
    {
      packages: {
        "script-tools": {
          "src/index.ts": 'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
          "test/smoke.test.ts": 'import { test } from "node:test";\nexport const x = test;\n',
        },
      },
      edges: [],
    },
    (root) => {
      seed(root);
      const result = run(root);
      notEqual(result.status, 0);
      const node = violations(result.output).filter((line) => line.includes("r4-script-tools-no-node"));
      equal(node.length, 1, result.output);
      match(node[0], /packages\/script-tools\/src\/index\.ts/);
      ok(!node[0].includes("smoke.test.ts"), result.output);
    },
  );
});

test("stale diagram: the check names the spine file and pnpm graph:write, --write repairs it", () => {
  withRoot(
    "stale",
    {
      packages: {
        a: { "src/index.ts": "export const a = 1;\n" },
        b: { "src/index.ts": "export const b = 1;\n" },
      },
      edges: [],
    },
    (root) => {
      equal(run(root, "--write").status, 0);
      equal(run(root).status, 0);
      // An edge is added to the list, but the diagram is left alone.
      writeList(root, ["a", "b"], [["b", "a"]]);
      const stale = run(root);
      notEqual(stale.status, 0);
      match(stale.output, /spine\.md/);
      match(stale.output, /pnpm graph:write/);
      equal(run(root, "--write").status, 0);
      equal(run(root).status, 0);
    },
  );
});

test("bad list: unknown name, duplicate, self edge, cycle, id collision and an omitted package", () => {
  const cases = [
    {
      label: "unknown-name",
      spec: { packages: { a: { "src/index.ts": "export const a = 1;\n" } }, edges: [["a", "nope"]] },
      expected: /edge \["a","nope"\] names the unknown package "nope"/,
    },
    {
      label: "duplicate",
      spec: {
        packages: {
          a: { "src/index.ts": "export const a = 1;\n" },
          b: { "src/index.ts": "export const b = 1;\n" },
        },
        edges: [["a", "b"], ["a", "b"]],
      },
      expected: /duplicate edge \["a","b"\]/,
    },
    {
      label: "self",
      spec: { packages: { a: { "src/index.ts": "export const a = 1;\n" } }, edges: [["a", "a"]] },
      expected: /edge \["a","a"\] is a self edge/,
    },
    {
      label: "cycle",
      spec: {
        packages: { a: { "src/index.ts": "export const a = 1;\n" }, b: { "src/index.ts": "export const b = 1;\n" } },
        edges: [["a", "b"], ["b", "a"]],
      },
      expected: /dependency cycle/,
    },
    {
      label: "omitted",
      spec: {
        packages: { a: { "src/index.ts": "export const a = 1;\n" } },
        unlisted: { b: { "src/index.ts": "export const b = 1;\n" } },
        edges: [],
      },
      expected: /packages\/b\/ exists on disk but is not listed/,
    },
    {
      label: "collision",
      spec: {
        packages: {
          ab: { "src/index.ts": "export const ab = 1;\n" },
          "a-b": { "src/index.ts": "export const a = 2;\n" },
        },
        edges: [],
      },
      expected: /node id collision: "ab" and "a-b" both become "ab"/,
    },
    {
      label: "mismatch",
      spec: {
        packages: { a: { "src/index.ts": "export const a = 1;\n" } },
        edges: [],
      },
      expected: /names "@tk-reawakened\/wrong", expected "@tk-reawakened\/a"/,
      // rename the package's manifest so the name no longer matches
      prepare: (root) => writeFile(join(root, "packages", "a", "package.json"), manifest("wrong")),
    },
  ];
  for (const { label, spec, expected, prepare } of cases) {
    withRoot(`bad-${label}`, spec, (root) => {
      prepare?.(root);
      const result = run(root);
      notEqual(result.status, 0, `${label}: expected a failure`);
      match(result.output, expected);
      ok(
        !existsSync(join(root, ".dependency-cruiser.mjs")),
        `${label}: the list must be validated before anything is generated`,
      );
    });
  }
});

test("tool errors: a missing anchor and a missing diagram block name the spine file", () => {
  withRoot(
    "anchor",
    {
      packages: { a: { "src/index.ts": "export const a = 1;\n" } },
      edges: [],
      spine: "# Fixture spine\n\nNo anchor here.\n",
    },
    (root) => {
      const result = run(root);
      notEqual(result.status, 0);
      match(result.output, /anchor "may be depended on by" does not appear in spine\.md/);
    },
  );
  withRoot(
    "anchor-twice",
    {
      packages: { a: { "src/index.ts": "export const a = 1;\n" } },
      edges: [],
      spine: spineText() + `\nAn arrow means "${anchor}" again.\n`,
    },
    (root) => {
      const result = run(root);
      notEqual(result.status, 0);
      match(result.output, /appears more than once in spine\.md/);
    },
  );
});

// ADR 0025 decision 2 and "What 11.2 does first" item 4: the cruise reads `.tsx`, so an editor view that imports a
// `host-*` package fails G2 like any `.ts` file does. `--write` regenerates the config and cruises in one run, so one
// invocation both writes and judges.
const tsxView = (imports) =>
  `${imports}\nexport const View = () => <p>{String(host)}</p>;\n`;

test("tsx: an editor-ui .tsx file importing a host package fails r1-editor-ui-workspace-edges", () => {
  withRoot(
    "tsx-host",
    {
      packages: {
        "editor-ui": { "src/View.tsx": tsxView('import { host } from "@tk-reawakened/host-web";') },
        "host-web": { "src/index.ts": "export const host = 1;\n" },
      },
      // The host may import the editor, never the other way round.
      edges: [["editor-ui", "host-web"]],
    },
    (root) => {
      const result = run(root, "--write");
      notEqual(result.status, 0, result.output);
      match(
        result.output,
        /r1-editor-ui-workspace-edges: packages\/editor-ui\/src\/View\.tsx\s*\u2192\s*packages\/host-web\/src\/index\.ts/,
      );
    },
  );
});

test("tsx: a clean .tsx file importing an allowed package passes", () => {
  withRoot(
    "tsx-clean",
    {
      packages: {
        "editor-ui": { "src/View.tsx": tsxView('import { host } from "@tk-reawakened/editor-model";') },
        "editor-model": { "src/index.ts": "export const host = 1;\n" },
      },
      edges: [["editor-model", "editor-ui"]],
    },
    (root) => {
      const result = run(root, "--write");
      equal(result.status, 0, result.output);
      match(result.output, /no dependency violations found/);
    },
  );
});

test("tsx: a .tsx relative import out of the package fails r1-editor-ui-no-relative-escape", () => {
  withRoot(
    "tsx-escape",
    {
      packages: {
        "editor-ui": { "src/View.tsx": tsxView('import { host } from "../../editor-model/src/index.ts";') },
        "editor-model": { "src/index.ts": "export const host = 1;\n" },
      },
      edges: [["editor-model", "editor-ui"]],
    },
    (root) => {
      const result = run(root, "--write");
      notEqual(result.status, 0, result.output);
      match(result.output, /r1-editor-ui-no-relative-escape: packages\/editor-ui\/src\/View\.tsx/);
    },
  );
});

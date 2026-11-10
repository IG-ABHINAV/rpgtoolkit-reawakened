// One edge list, one generated config, one diagram (AD-22; guard-rails G2 rule 5
// and G4 rule 4). `tools/deps/edges.json` is the single source of truth for the
// permitted dependency directions between the workspace packages; this tool
// turns it into the dependency-cruiser rule set and into the dependency diagram
// committed in the architecture spine, then cruises the packages.
//
//   node tools/deps/graph.mjs [root] [--write]
//
// `root` defaults to this repository (like tools/check-core-deps.mjs). Every
// input and output lives under it, so a fixture root is self-contained:
//
//   list             <root>/tools/deps/edges.json
//   spine            <root>/<diagram.file>
//   generated config <root>/.dependency-cruiser.mjs, <root>/tsconfig.depcruise.json
//   cruised source   <root>/packages
//
// The dependency-cruiser binary is always the one installed in *this*
// repository, and the CLI runs with `cwd: root`, so a fixture root needs no
// node_modules of its own.
//
// Without `--write` the list's diagram block is compared with the committed one
// (LF, two-space indent, one trailing newline) and any difference fails the run
// naming the spine file and `pnpm graph:write`; with `--write` the block is
// replaced before the cruise runs.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const positional = argv.filter((argument) => argument !== "--write");
if (positional.length > 1) {
  fail(
    `expected at most one root argument, got ${positional
      .map((argument) => JSON.stringify(argument))
      .join(", ")}`,
  );
}
const root = positional.length === 1 ? resolve(positional[0]) : repoRoot;

function fail(message) {
  console.error(`tools/deps/graph.mjs: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------- the list

const listPath = join(root, "tools", "deps", "edges.json");
let list;
try {
  list = JSON.parse(readFileSync(listPath, "utf8"));
} catch (error) {
  fail(`cannot read the edge list ${listPath}: ${error.message}`);
}

// A package name is a label: lowercase, digits and dashes, and its npm name is
// `@tk-reawakened/<name>`. A diagram node id is the label with every non-alphanumeric
// character removed, so two labels that differ only by punctuation are a
// collision.
const NAME = /^[a-z][a-z0-9-]*$/;
const idOf = (label) => label.replace(/[^A-Za-z0-9]/g, "");

if (!Array.isArray(list.packages) || list.packages.length === 0) {
  fail(`${listPath}: "packages" must be a non-empty array of package names`);
}
if (!Array.isArray(list.edges)) {
  fail(`${listPath}: "edges" must be an array of [depended-on, dependent] pairs`);
}
for (const name of list.packages) {
  if (typeof name !== "string" || !NAME.test(name)) {
    fail(
      `${listPath}: package name ${JSON.stringify(name)} must match /^[a-z][a-z0-9-]*$/`,
    );
  }
}
const known = new Set();
for (const name of list.packages) {
  if (known.has(name)) {
    fail(`${listPath}: duplicate package ${JSON.stringify(name)} in "packages"`);
  }
  known.add(name);
}
const ids = new Map();
for (const name of list.packages) {
  const id = idOf(name);
  if (ids.has(id)) {
    fail(
      `${listPath}: node id collision: ${JSON.stringify(ids.get(id))} and ${JSON.stringify(name)} both become ${JSON.stringify(id)}`,
    );
  }
  ids.set(id, name);
}

const edges = [];
const seenEdges = new Set();
for (const edge of list.edges) {
  if (!Array.isArray(edge) || edge.length !== 2 || edge.some((part) => typeof part !== "string")) {
    fail(`${listPath}: edge ${JSON.stringify(edge)} must be a [depended-on, dependent] pair of package names`);
  }
  const [dependency, dependent] = edge;
  for (const name of edge) {
    if (!known.has(name)) {
      fail(`${listPath}: edge ${JSON.stringify(edge)} names the unknown package ${JSON.stringify(name)}`);
    }
  }
  if (dependency === dependent) {
    fail(`${listPath}: edge ${JSON.stringify(edge)} is a self edge`);
  }
  const key = `${dependency}\u0000${dependent}`;
  if (seenEdges.has(key)) {
    fail(`${listPath}: duplicate edge ${JSON.stringify(edge)}`);
  }
  seenEdges.add(key);
  edges.push([dependency, dependent]);
}

const cycle = findCycle(edges);
if (cycle) {
  fail(`${listPath}: dependency cycle ${cycle.join(" \u2192 ")}`);
}

const packagesDir = join(root, "packages");
if (!existsSync(packagesDir)) {
  fail(`${root} has no packages/ directory to cruise`);
}
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!known.has(entry.name)) {
    fail(
      `${listPath}: packages/${entry.name}/ exists on disk but is not listed in "packages"`,
    );
  }
}
for (const name of list.packages) {
  const directory = join(packagesDir, name);
  if (!existsSync(directory)) continue;
  const manifestPath = join(directory, "package.json");
  if (!existsSync(manifestPath)) {
    fail(`${listPath}: packages/${name}/ exists on disk but has no package.json`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read ${manifestPath}: ${error.message}`);
  }
  if (manifest.name !== `@tk-reawakened/${name}`) {
    fail(
      `${listPath}: packages/${name}/package.json names ${JSON.stringify(manifest.name)}, expected "@tk-reawakened/${name}"`,
    );
  }
}

if (
  list.diagram === null ||
  typeof list.diagram !== "object" ||
  typeof list.diagram.file !== "string" ||
  list.diagram.file === "" ||
  typeof list.diagram.anchor !== "string" ||
  list.diagram.anchor === ""
) {
  fail(`${listPath}: "diagram" must be { file, anchor } with non-empty strings`);
}

function findCycle(pairs) {
  // [dependency, dependent]: `dependent` depends on `dependency`. A cycle walks
  // the "depends on" edges.
  const dependsOn = new Map();
  for (const [dependency, dependent] of pairs) {
    if (!dependsOn.has(dependent)) dependsOn.set(dependent, []);
    dependsOn.get(dependent).push(dependency);
  }
  const state = new Map();
  const stack = [];
  const visit = (name) => {
    const mark = state.get(name);
    if (mark === "visiting") return [...stack.slice(stack.indexOf(name)), name];
    if (mark === "done") return null;
    state.set(name, "visiting");
    stack.push(name);
    for (const next of dependsOn.get(name) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    state.set(name, "done");
    return null;
  };
  for (const name of dependsOn.keys()) {
    const found = visit(name);
    if (found) return found;
  }
  return null;
}

// ----------------------------------------------------- the generated config

function buildRules() {
  const rules = [];
  for (const name of list.packages) {
    // `[dependency, dependent]` says `dependency` may be depended on by
    // `dependent`; the rules need the inverse, so collect the packages that may
    // be imported from `name`.
    const allowed = [...new Set(edges.filter(([, dependent]) => dependent === name).map(([dependency]) => dependency))];
    const permitted = [name, ...allowed].join("|");
    rules.push({
      name: `r1-${name}-workspace-edges`,
      severity: "error",
      comment: `packages/${name}/ may import only its own files${allowed.length > 0 ? ` and ${allowed.map((pkg) => `packages/${pkg}/`).join(", ")}` : ""} (G2 rule 5, AD-22; tools/deps/edges.json).`,
      from: { path: `^packages/${name}/` },
      to: { path: `^packages/(?!(?:${permitted})/)` },
    });
    rules.push({
      name: `r1-${name}-no-relative-escape`,
      severity: "error",
      comment: `a relative import in packages/${name}/ must resolve inside packages/${name}/ (G2 rule 5, AD-22).`,
      from: { path: `^packages/${name}/` },
      to: {
        pathNot: `^packages/${name}/`,
        dependencyTypes: ["local"],
        dependencyTypesNot: ["aliased"],
      },
    });
  }
  rules.push({
    name: "r2-no-deep-package-imports",
    severity: "error",
    comment:
      "a package is reached only through its public entry point `@tk-reawakened/<pkg>` (AD-22); a subpath is never exported.",
    from: {},
    to: { path: "^@tk-reawakened/[^/]+/." },
  });
  rules.push({
    name: "r6-testing-entry-only-in-tests",
    severity: "error",
    comment:
      "a package's `./testing` entry (src/testing.ts) is for tests: no file under packages/<pkg>/src/ imports another package's (AD-22).",
    from: { path: "^packages/([^/]+)/src/" },
    to: { path: "^packages/[^/]+/src/testing\\.ts$", pathNot: "^packages/$1/" },
  });
  rules.push({
    name: "r3-render-engines-only-in-render",
    severity: "error",
    comment:
      "third-party render engines are confined to a renderer implementation, packages/runner-*/src/render/** (G4 rule 4).",
    from: { pathNot: "^packages/runner-[^/]+/src/render/" },
    // `to.path` is the *resolved* path; pnpm's layout is
    // node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>/….
    to: { path: "node_modules/(\\.pnpm/)?((phaser|pixi\\.js|excalibur)[@/]|@pixi/)" },
  });
  rules.push({
    name: "r5-lsp-no-node",
    severity: "error",
    comment:
      "packages/lsp/src/ imports no Node built-in: the transport lives with the host (TOOL-1; G2).",
    from: { path: "^packages/lsp/src/" },
    to: { dependencyTypes: ["core"] },
  });
  rules.push({
    name: "r4-script-tools-no-node",
    severity: "error",
    comment:
      "packages/script-tools/src/ imports no Node built-in: it is a pure library over core (G2; docs/spec/engine/rpgcode-tooling.md#tool-3).",
    from: { path: "^packages/script-tools/src/" },
    to: { dependencyTypes: ["core"] },
  });
  return rules;
}

const config = {
  forbidden: buildRules(),
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
    doNotFollow: { path: "node_modules" },
    preserveSymlinks: false,
    exclude: {
      path: list.packages.flatMap((name) => [
        `(^|/)packages/${name}/dist/`,
        `(^|/)packages/${name}/test/fixtures/`,
      ]),
    },
  },
};

// `paths` resolves a package's entry point to its source, so the graph is read
// without a build; a `@tk-reawakened/<pkg>/<subpath>` import misses every key,
// resolution fails and r2 sees it. The one subpath AD-22 allows is `./testing`,
// which exists only for a package that has `src/testing.ts`; it resolves, so r2
// passes it, and r6 keeps it out of `src/`.
const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    baseUrl: ".",
    noEmit: true,
    paths: Object.fromEntries(
      list.packages.flatMap((name) => [
        [`@tk-reawakened/${name}`, [`packages/${name}/src/index.ts`]],
        ...(existsSync(join(packagesDir, name, "src", "testing.ts"))
          ? [[`@tk-reawakened/${name}/testing`, [`packages/${name}/src/testing.ts`]]]
          : []),
      ]),
    ),
  },
};

try {
  writeFileSync(join(root, ".dependency-cruiser.mjs"), `export default ${JSON.stringify(config, null, 2)};\n`);
  writeFileSync(join(root, "tsconfig.depcruise.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
} catch (error) {
  fail(`cannot write the generated config: ${error.message}`);
}

// ------------------------------------------------------------------ the diagram

function renderDiagram() {
  const declared = new Set();
  const node = (label) => {
    const id = idOf(label);
    if (declared.has(id)) return id;
    declared.add(id);
    return id === label ? id : `${id}[${label}]`;
  };
  const lines = edges.map(([dependency, dependent]) => `  ${node(dependency)} --> ${node(dependent)}`);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function locateBlock(text, file) {
  const { anchor } = list.diagram;
  const lines = text.split("\n");
  let anchoredAt = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(anchor)) continue;
    if (anchoredAt !== -1) {
      fail(`${listPath}: the anchor ${JSON.stringify(anchor)} appears more than once in ${file}`);
    }
    anchoredAt = index;
  }
  if (anchoredAt === -1) {
    fail(`${listPath}: the anchor ${JSON.stringify(anchor)} does not appear in ${file}`);
  }
  let fence = -1;
  for (let index = anchoredAt + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "") continue;
    if (lines[index].trim() === "```mermaid") fence = index;
    break;
  }
  if (fence === -1) {
    fail(`${listPath}: no \`\`\`mermaid block follows the anchor ${JSON.stringify(anchor)} in ${file}`);
  }
  let directive = -1;
  for (let index = fence + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "") continue;
    directive = index;
    break;
  }
  if (directive === -1 || !/^graph\s+(?:LR|RL|TD|TB|BT)$/.test(lines[directive].trim())) {
    fail(`${listPath}: the mermaid block after the anchor ${JSON.stringify(anchor)} in ${file} has no \`graph\` directive`);
  }
  let close = -1;
  for (let index = directive + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "```") {
      close = index;
      break;
    }
  }
  if (close === -1) {
    fail(`${listPath}: the mermaid block after the anchor ${JSON.stringify(anchor)} in ${file} is not closed`);
  }
  return { lines, start: directive + 1, end: close };
}

const spinePath = join(root, list.diagram.file);
let spine;
try {
  spine = readFileSync(spinePath, "utf8");
} catch (error) {
  fail(`cannot read the spine ${list.diagram.file}: ${error.message}`);
}
const { lines, start, end } = locateBlock(spine, list.diagram.file);
const generated = renderDiagram();
const committed = lines.slice(start, end);
const committedText = committed.length === 0 ? "" : `${committed.join("\n")}\n`;

if (write) {
  const replacement = generated === "" ? [] : generated.slice(0, -1).split("\n");
  try {
    writeFileSync(spinePath, [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join("\n"));
  } catch (error) {
    fail(`cannot write the diagram in ${list.diagram.file}: ${error.message}`);
  }
  console.log(
    `tools/deps/graph.mjs: wrote .dependency-cruiser.mjs, tsconfig.depcruise.json and the diagram in ${list.diagram.file}.`,
  );
} else if (committedText !== generated) {
  fail(
    `the dependency diagram in ${list.diagram.file} does not match ${listPath}\n  run \`pnpm graph:write\` and commit the result`,
  );
}

// -------------------------------------------------------------------- the cruise

const depcruiseManifest = join(repoRoot, "node_modules", "dependency-cruiser", "package.json");
let depcruise;
try {
  depcruise = JSON.parse(readFileSync(depcruiseManifest, "utf8"));
} catch (error) {
  fail(`cannot read ${depcruiseManifest}: ${error.message}. Install the workspace dependencies first (\`pnpm install\`).`);
}
const bin = typeof depcruise.bin === "string" ? depcruise.bin : depcruise.bin?.depcruise;
if (!bin) fail(`${depcruiseManifest} declares no \`depcruise\` bin`);

const result = spawnSync(process.execPath, [join(dirname(depcruiseManifest), bin), "packages"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) fail(`cannot run dependency-cruiser: ${result.error.message}`);
process.exit(result.status ?? 1);

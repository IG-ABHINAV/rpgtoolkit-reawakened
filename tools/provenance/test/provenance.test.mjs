// Fixture tests for tools/provenance/scan.mjs (guard-rail G7): at least one test
// per row of the story's I/O & edge-case matrix. Every fixture is built at run
// time in a temp directory from tools/provenance/markers.json, so this file
// holds no marker text; the scanner also scans this file (it lives under tools/).
import { after, test } from "node:test";
import { deepEqual, equal, match, notEqual, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MarkersError, formatViolation, loadAndValidateMarkers, scanProvenance } from "../scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tool = resolve(here, "..", "scan.mjs");
const markersFile = resolve(here, "..", "markers.json");
const repoRoot = resolve(here, "..", "..", "..");

const raw = JSON.parse(readFileSync(markersFile, "utf8"));
const markers = loadAndValidateMarkers(markersFile);
const CLEAN = { "src/clean.ts": "export const ok = 1;\n" };

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeRoot(label, files = {}) {
  const root = mkdtempSync(join(tmpdir(), `provenance-${label}-`));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) writeFile(join(root, file), content);
  return root;
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [tool, ...(root === null ? [] : [root]), ...args], {
    encoding: "utf8",
  });
  result.output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return result;
}

// In-process scan of a fixture tree built from `files`.
function scanFiles(files) {
  const root = makeRoot("scan", files);
  const result = scanProvenance(root, { markers });
  return { ...result, hitsIn: (file) => result.violations.filter((hit) => hit.file === file) };
}

const diagnostic = (file, line, col, category) => `${file}:${line}:${col}: [G7 ${category}]`;
const scannedCount = (result) => Number(/^scanned (\d+) files$/m.exec(result.stdout)?.[1]);

const categoryNames = Object.keys(raw.categories);
const contentCategories = categoryNames.filter((name) => markers.categories[name].kind !== "extension");
const entriesOf = (name) => raw.categories[name].markers;

// The first example of every content marker, one per line: a file that trips
// every content category at once.
function allMarkerLines() {
  return contentCategories.flatMap((name) => entriesOf(name).map((entry) => entry.examples[0]));
}
const everyMarker = () => `${allMarkerLines().join("\n")}\n`;

// Column (1-based) where the scanner must report `example` for `entry`.
function expectedCol(kind, entry, example) {
  if (kind === "pattern") return example.length - example.trimStart().length + 1;
  return example.toLowerCase().indexOf(entry.marker.toLowerCase()) + 1;
}

// ------------------------------------------------------- markers.json contract

test("markers.json: five categories, case sensitivity and cited sources", () => {
  deepEqual(Object.keys(raw).sort(), ["categories", "scope"]);
  deepEqual(categoryNames.sort(), [
    "bannedExtensions",
    "gplLicenseHeaders",
    "legacyCopyrightHolders",
    "legacyIdentifiers",
    "vb6SyntaxMarkers",
  ]);
  for (const name of categoryNames) {
    const category = raw.categories[name];
    equal(category.caseSensitive, name === "vb6SyntaxMarkers", `${name} caseSensitive`);
    ok(typeof category.sources === "string" && category.sources.trim() !== "", `${name} sources`);
    for (const entry of category.markers) {
      ok(entry.examples.length > 0, `${name} ${entry.marker} has examples`);
    }
    ok(
      category.markers.some((entry) => (entry.nonExamples ?? []).length > 0),
      `${name} documents non-examples`,
    );
  }
  ok(raw.categories.legacyIdentifiers.sources.includes("docs/guardrails.md section G7"));
  ok(
    raw.categories.legacyCopyrightHolders.sources.includes(
      "_bmad-output/initiative-rpgtoolkit-reawakened/research-what-survived-of-rpg-toolkit/people.md",
    ),
  );
});

test("markers.json: every repo document a category cites exists", () => {
  const cited = [raw.scope.sources, ...categoryNames.map((name) => raw.categories[name].sources)]
    .flatMap((sources) => sources.match(/(?:[\w.-]+\/)*[\w.-]+\.md/g) ?? []);
  ok(cited.length > 0);
  for (const path of cited) ok(existsSync(join(repoRoot, path)), `${path} exists in the repo`);
});

// --------------------------------------------- every example, every non-example

for (const name of contentCategories) {
  const { kind, caseSensitive } = markers.categories[name];

  test(`${name}: every example is flagged at its line:col and every non-example passes`, () => {
    const files = {};
    const cases = [];
    entriesOf(name).forEach((entry, m) => {
      entry.examples.forEach((example, e) => {
        files[`ex-${m}-${e}.ts`] = `${example}\n`;
        cases.push({ file: `ex-${m}-${e}.ts`, entry, example });
      });
      (entry.nonExamples ?? []).forEach((text, n) => {
        files[`non-${m}-${n}.ts`] = `${text}\n`;
        cases.push({ file: `non-${m}-${n}.ts`, entry, text });
      });
    });
    const scan = scanFiles(files);
    for (const { file, entry, example, text } of cases) {
      const hits = scan.hitsIn(file);
      if (example !== undefined) {
        const col = expectedCol(kind, entry, example);
        ok(
          hits.some(
            (hit) =>
              hit.category === name && hit.marker === entry.marker && hit.line === 1 && hit.col === col,
          ),
          `${JSON.stringify(example)} should hit ${entry.marker} at 1:${col}, got ${JSON.stringify(hits)}`,
        );
      } else {
        deepEqual(hits.map(formatViolation), [], `${JSON.stringify(text)} must not be flagged`);
      }
    }
  });

  test(`${name}: ${caseSensitive ? "case-sensitive, a lower-cased example passes" : "case-folded, an upper-cased example is flagged"}`, () => {
    const files = {};
    const cases = [];
    entriesOf(name).forEach((entry, m) => {
      entry.examples.forEach((example, e) => {
        const variant = caseSensitive ? example.toLowerCase() : example.toUpperCase();
        if (variant === example) return;
        files[`case-${m}-${e}.ts`] = `${variant}\n`;
        cases.push({ file: `case-${m}-${e}.ts`, entry, variant });
      });
    });
    ok(cases.length > 0);
    const scan = scanFiles(files);
    for (const { file, entry, variant } of cases) {
      const hit = scan.hitsIn(file).some((violation) => violation.marker === entry.marker);
      equal(hit, !caseSensitive, `${JSON.stringify(variant)} against ${entry.marker}`);
    }
  });
}

test("bannedExtensions: every example file name is flagged, every non-example passes", () => {
  const files = {};
  const cases = [];
  entriesOf("bannedExtensions").forEach((entry, m) => {
    entry.examples.forEach((name, e) => {
      files[`flag-${m}-${e}/${name}`] = "";
      cases.push({ file: `flag-${m}-${e}/${name}`, entry, flagged: true });
    });
    (entry.nonExamples ?? []).forEach((name, n) => {
      files[`pass-${m}-${n}/${name}`] = "export const ok = 1;\n";
      cases.push({ file: `pass-${m}-${n}/${name}`, entry, flagged: false });
    });
  });
  const scan = scanFiles(files);
  for (const { file, entry, flagged } of cases) {
    const hits = scan.hitsIn(file);
    if (flagged) {
      deepEqual(
        hits.map((hit) => [hit.category, hit.marker, hit.line, hit.col]),
        [["bannedExtensions", entry.marker, 1, 1]],
        file,
      );
    } else {
      deepEqual(hits, [], file);
    }
  }
});

// ------------------------------------------------ wrapped phrases (GPL, authors)

const styles = {
  block: { ext: ".ts", open: ["/*"], leader: " * ", close: [" */"] },
  jsdoc: { ext: ".css", open: ["/**"], leader: " * ", close: [" */"] },
  tightBlock: { ext: ".js", open: ["/*"], leader: " *", close: ["*/"] },
  hash: { ext: ".yml", open: [], leader: "# ", close: [] },
  tightHash: { ext: ".toml", open: [], leader: "#", close: [] },
  slashes: { ext: ".mjs", open: [], leader: "// ", close: [] },
  tightSlashes: { ext: ".cjs", open: [], leader: "//", close: [] },
  apostrophe: { ext: ".json", open: [], leader: "' ", close: [] },
  tripleSlashes: { ext: ".ts", open: [], leader: "/// ", close: [] },
  htmlPerLine: { ext: ".html", open: [], leader: "<!-- ", trail: " -->", close: [] },
};

// A phrase wrapped `perLine` words per comment line, after `lead` on its first
// line. Returns the file text and where the phrase starts.
function wrapped(phrase, style, perLine, lead = "", eol = "\n") {
  const words = phrase.split(" ");
  const chunks = [];
  for (let start = 0; start < words.length; start += perLine) {
    chunks.push(words.slice(start, start + perLine).join(" "));
  }
  const body = chunks.map(
    (chunk, position) => `${style.leader}${position === 0 ? lead : ""}${chunk}${style.trail ?? ""}`,
  );
  return {
    content: `${[...style.open, ...body, ...style.close].join(eol)}${eol}`,
    line: style.open.length + 1,
    col: style.leader.length + lead.length + 1,
  };
}

for (const name of ["gplLicenseHeaders", "legacyCopyrightHolders"]) {
  test(`${name}: wrapped over comment leaders, every marker is found where it starts`, () => {
    const files = {};
    const cases = [];
    entriesOf(name).forEach((entry, m) => {
      for (const [styleName, style] of Object.entries(styles)) {
        for (const perLine of [1, 3, 1000]) {
          for (const eol of ["\n", "\r\n"]) {
            const fixture = wrapped(entry.marker, style, perLine, "leading words, then ", eol);
            const file = `${styleName}-${m}-${perLine}-${eol.length}${style.ext}`;
            files[file] = fixture.content;
            cases.push({ file, entry, fixture });
          }
        }
      }
    });
    const scan = scanFiles(files);
    for (const { file, entry, fixture } of cases) {
      ok(
        scan
          .hitsIn(file)
          .some(
            (hit) =>
              hit.category === name &&
              hit.marker === entry.marker &&
              hit.line === fixture.line &&
              hit.col === fixture.col,
          ),
        `${file}: ${entry.marker} should start at ${fixture.line}:${fixture.col}, got ${JSON.stringify(scan.hitsIn(file))}`,
      );
    }
  });
}

test("a phrase split by something other than a comment leader is not joined", () => {
  const [entry] = entriesOf("legacyCopyrightHolders");
  const words = entry.marker.split(" ");
  const scan = scanFiles({
    "split.ts": `${words[0]} = 1;\n${words.slice(1).join(" ")} = 2;\n`,
    "joined.ts": `// ${words.join("\n// ")}\n`,
  });
  deepEqual(scan.hitsIn("split.ts"), []);
  equal(scan.hitsIn("joined.ts").length, 1);
});

// ----------------------------------------------------------- matrix: CLI rows

// Ways C, C++, TypeScript and JSON hold a notice as quoted strings: the
// phrase, in chunks of two words, and where it must be reported.
const quoted = {
  adjacentC: {
    ext: ".c",
    build: (chunks) => ({
      content: `static const char *notice =\n${chunks.map((chunk) => `"${chunk}\\n"`).join("\n")};\n`,
      line: 2,
      col: 2,
    }),
  },
  adjacentCpp: {
    ext: ".cpp",
    build: (chunks) => ({
      content: `static const char *notice =\n${chunks.map((chunk) => `"${chunk}\\n"`).join("\n")};\n`,
      line: 2,
      col: 2,
    }),
  },
  escapes: {
    ext: ".cpp",
    build: (chunks) => ({
      content: `const char *notice = "${chunks.join("\\n")}";\n`,
      line: 1,
      col: "const char *notice = \"".length + 1,
    }),
  },
  define: {
    ext: ".h",
    build: (chunks) => ({
      content: `#define NOTICE \\\n${chunks.map((chunk) => `  "${chunk}\\n"`).join(" \\\n")}\n`,
      line: 2,
      col: 4,
    }),
  },
  plus: {
    ext: ".ts",
    build: (chunks) => ({
      content: `const notice = "${chunks.join('" +\n  "')}";\n`,
      line: 1,
      col: "const notice = \"".length + 1,
    }),
  },
  jsonArray: {
    ext: ".json",
    build: (chunks) => ({
      content: `[\n${chunks.map((chunk) => `  "${chunk}"`).join(",\n")}\n]\n`,
      line: 2,
      col: 4,
    }),
  },
};

for (const name of ["gplLicenseHeaders", "legacyCopyrightHolders"]) {
  test(`${name}: wrapped in quoted strings (C literals, escapes, #define, +, JSON), every marker is found where it starts`, () => {
    const files = {};
    const cases = [];
    entriesOf(name).forEach((entry, m) => {
      const words = entry.marker.split(" ");
      const chunks = [];
      for (let start = 0; start < words.length; start += 2) chunks.push(words.slice(start, start + 2).join(" "));
      for (const [formName, form] of Object.entries(quoted)) {
        const fixture = form.build(chunks);
        const file = `${formName}-${m}${form.ext}`;
        files[file] = fixture.content;
        cases.push({ file, entry, fixture });
      }
    });
    const scan = scanFiles(files);
    for (const { file, entry, fixture } of cases) {
      ok(
        scan
          .hitsIn(file)
          .some(
            (hit) =>
              hit.category === name &&
              hit.marker === entry.marker &&
              hit.line === fixture.line &&
              hit.col === fixture.col,
          ),
        `${file}: ${entry.marker} should start at ${fixture.line}:${fixture.col}, got ${JSON.stringify(scan.hitsIn(file))}`,
      );
    }
  });
}

test("matrix: C/C++ source: a .cpp identifier and a .h GPL header beside a clean .ts exit 1 with both categories at line:col", () => {
  const identifier = entriesOf("legacyIdentifiers")[0].examples[0];
  const header = wrapped(entriesOf("gplLicenseHeaders")[0].marker, styles.block, 3, "leading words, then ");
  const result = run(
    makeRoot("cpp", {
      ...CLEAN,
      "native/engine.cpp": `int main() {\n  return ${identifier};\n}\n`,
      "native/engine.h": header.content,
    }),
  );
  equal(result.status, 1, result.output);
  equal(scannedCount(result), 3);
  ok(
    result.stderr.includes(diagnostic("native/engine.cpp", 2, "  return ".length + 1, "legacyIdentifiers")),
    result.stderr,
  );
  ok(
    result.stderr.includes(diagnostic("native/engine.h", header.line, header.col, "gplLicenseHeaders")),
    result.stderr,
  );
});

test("matrix: clean tree passes with `scanned N files` and 0 violations", () => {
  const root = makeRoot("clean", {
    ...CLEAN,
    "src/deep/er/data.json": "{}\n",
    "config/app.yml": "key: value\n",
    "config/app.toml": "key = 1\n",
    "web/page.html": "<p>hello</p>\n",
    "web/site.css": "body { margin: 0; }\n",
    "README.md": "# project\n",
  });
  const result = run(root);
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 6 files\n0 violations\n");
  equal(result.stderr, "");
});

test("matrix: the repository itself scans clean", () => {
  const { scanned, violations } = scanProvenance(repoRoot, { markers });
  ok(scanned > 0);
  deepEqual(violations.map(formatViolation), []);
});

test("matrix: the scanner and this test file carry no marker", () => {
  const root = makeRoot("self");
  copyFileSync(tool, join(root, "scan.mjs"));
  copyFileSync(fileURLToPath(import.meta.url), join(root, "provenance.test.mjs"));
  const result = scanProvenance(root, { markers });
  equal(result.scanned, 2);
  deepEqual(result.violations.map(formatViolation), []);
});

test("matrix: wrapped GPL header in a block comment exits 1 with gplLicenseHeaders at line:col", () => {
  const fixture = wrapped(entriesOf("gplLicenseHeaders")[0].marker, styles.block, 3, "leading words, then ");
  const result = run(makeRoot("gpl-block", { ...CLEAN, "src/header.ts": fixture.content }));
  equal(result.status, 1, result.output);
  ok(
    result.stderr.includes(diagnostic("src/header.ts", fixture.line, fixture.col, "gplLicenseHeaders")),
    result.stderr,
  );
  match(result.stderr, /1 violation\(s\)/);
});

test("matrix: wrapped GPL header in a # comment in .yml exits 1 with gplLicenseHeaders at line:col", () => {
  const fixture = wrapped(entriesOf("gplLicenseHeaders")[0].marker, styles.hash, 3, "leading words, then ");
  const result = run(makeRoot("gpl-hash", { ...CLEAN, "config/header.yml": fixture.content }));
  equal(result.status, 1, result.output);
  ok(
    result.stderr.includes(diagnostic("config/header.yml", fixture.line, fixture.col, "gplLicenseHeaders")),
    result.stderr,
  );
});

test("matrix: a legacy author name exits 1 with legacyCopyrightHolders at line:col", () => {
  const authors = entriesOf("legacyCopyrightHolders");
  const source = authors.map((entry) => `export const author = "${entry.marker}";`).join("\n");
  const result = run(
    makeRoot("authors", {
      ...CLEAN,
      "src/credits.ts": `${source}\n`,
      "package.json": `{\n  "author": "${authors[0].marker}"\n}\n`,
    }),
  );
  equal(result.status, 1, result.output);
  authors.forEach((entry, position) => {
    const line = `export const author = "${entry.marker}";`;
    const col = line.indexOf(entry.marker) + 1;
    ok(result.stderr.includes(diagnostic("src/credits.ts", position + 1, col, "legacyCopyrightHolders")), result.stderr);
  });
  ok(result.stderr.includes(diagnostic("package.json", 2, `  "author": "`.length + 1, "legacyCopyrightHolders")), result.stderr);
});

test("matrix: a legacy identifier exits 1 with legacyIdentifiers at line:col", () => {
  const identifiers = entriesOf("legacyIdentifiers");
  const source = identifiers.map((entry) => `  const value = ${entry.marker}.exe;`).join("\n");
  const result = run(makeRoot("identifiers", { ...CLEAN, "src/legacy.ts": `${source}\n` }));
  equal(result.status, 1, result.output);
  identifiers.forEach((entry, position) => {
    const col = "  const value = ".length + 1;
    ok(result.stderr.includes(diagnostic("src/legacy.ts", position + 1, col, "legacyIdentifiers")), result.stderr);
  });
  equal(
    result.stderr.split("\n").filter((line) => line.includes("[G7 legacyIdentifiers]")).length,
    identifiers.length,
  );
});

test("matrix: a fixture tree under the root is skipped, a nested fixtures folder is scanned", () => {
  const sample = entriesOf("legacyIdentifiers")[0].examples[0];
  const result = run(
    makeRoot("fixtures-skip", {
      ...CLEAN,
      "fixtures/legacy/demo/x.ts": `${sample}\n`,
      "packages/a/test/fixtures/x.ts": `${sample}\n`,
    }),
  );
  equal(result.status, 1, result.output);
  ok(result.stderr.includes(diagnostic("packages/a/test/fixtures/x.ts", 1, 1, "legacyIdentifiers")), result.stderr);
  ok(!result.stderr.includes("fixtures/legacy/demo/x.ts"), result.stderr);
  equal(result.stderr.split("\n").filter((line) => line.includes("[G7 ")).length, 1);
});

test("matrix: identifier boundary non-matches pass with exit 0", () => {
  const nonExamples = entriesOf("legacyIdentifiers").flatMap((entry) => entry.nonExamples);
  ok(nonExamples.length > 0);
  const result = run(makeRoot("boundary", { "src/near.ts": `${nonExamples.join("\n")}\n` }));
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

test("matrix: structural VB6 syntax exits 1 with vb6SyntaxMarkers at line:col", () => {
  const patterns = entriesOf("vb6SyntaxMarkers");
  const lines = patterns.map((entry) => entry.examples[0]);
  const result = run(makeRoot("vb6", { ...CLEAN, "src/module.ts": `${lines.join("\n")}\n` }));
  equal(result.status, 1, result.output);
  patterns.forEach((entry, position) => {
    const col = expectedCol("pattern", entry, lines[position]);
    ok(result.stderr.includes(diagnostic("src/module.ts", position + 1, col, "vb6SyntaxMarkers")), result.stderr);
  });
});

test("matrix: VB6 look-alikes (prose, mid-line quotes, comments) pass with exit 0", () => {
  const nonExamples = entriesOf("vb6SyntaxMarkers").flatMap((entry) => entry.nonExamples);
  ok(nonExamples.length > 0);
  const result = run(makeRoot("vb6-negative", { "src/prose.ts": `${nonExamples.join("\n")}\n` }));
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

test("matrix: a banned extension exits 1 with bannedExtensions naming the file path", () => {
  const names = entriesOf("bannedExtensions").map((entry) => entry.examples[0]);
  const files = Object.fromEntries(names.map((name) => [`legacy/${name}`, "anything\n"]));
  const result = run(makeRoot("banned", { ...CLEAN, ...files }));
  equal(result.status, 1, result.output);
  for (const name of names) ok(result.stderr.includes(diagnostic(`legacy/${name}`, 1, 1, "bannedExtensions")), result.stderr);
});

test("matrix: a lone banned-extension file counts as scanned and does not trip the zero-files guard", () => {
  const [name] = entriesOf("bannedExtensions")[0].examples;
  const result = run(makeRoot("banned-alone", { [name]: "" }));
  equal(result.status, 1, result.output);
  equal(scannedCount(result), 1);
  ok(!result.stderr.includes("zero scannable files"), result.stderr);
  ok(result.stderr.includes(diagnostic(name, 1, 1, "bannedExtensions")), result.stderr);
});

test("matrix: prose files and root docs/_bmad paths are skipped (one clean source file keeps the guard quiet)", () => {
  const body = everyMarker();
  const root = makeRoot("prose", {
    ...CLEAN,
    "README.md": body,
    "CLAUDE.md": body,
    "CONTRIBUTING.md": body,
    "docs/notes.ts": body,
    "docs/adr/decision.json": body,
    "docs/nested/spec.yml": body,
    "_bmad/config.yml": body,
    "_bmad-output/report.json": body,
    LICENSE: body,
    THIRD_PARTY_NOTICES: body,
    "pnpm-lock.yaml": body,
    "tools/provenance/markers.json": readFileSync(markersFile, "utf8"),
  });
  const result = run(root);
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

test("exclusions are exact: nested docs, other markers.json, .github and unlisted dirs are scanned", () => {
  const body = everyMarker();
  const scanned = [
    "packages/core/docs/notes.ts",
    "src/docs/notes.ts",
    "tools/other/markers.json",
    "tools/provenance/test/markers.json",
    ".github/workflows/ci.yml",
    "deep/er/ok.json",
    "docs.ts",
    "_bmad-extra/x.ts",
  ];
  const skipped = [
    ".hidden/x.ts",
    ".git/hooks/x.js",
    "node_modules/pkg/x.js",
    "src/node_modules/pkg/x.js",
    "dist/x.js",
    "packages/core/dist/x.js",
    "build/x.js",
    "src/build/x.js",
    "coverage/x.js",
    "src/coverage/x.js",
    "src/LICENSE",
    "src/THIRD_PARTY_NOTICES",
    "packages/pnpm-lock.yaml",
    "src/readme.md",
    "src/notes.txt",
  ];
  const files = { ...CLEAN };
  for (const file of [...scanned, ...skipped]) files[file] = body;
  const scan = scanFiles(files);
  deepEqual([...new Set(scan.violations.map((hit) => hit.file))].sort(), [...scanned].sort());
  equal(scan.scanned, scanned.length + 1);
});

test("a symlink to a directory or a file is not followed", (t) => {
  const outside = makeRoot("outside", { "danger/x.ts": everyMarker(), "y.ts": everyMarker() });
  const root = makeRoot("symlinks", CLEAN);
  try {
    symlinkSync(join(outside, "danger"), join(root, "linked-dir"), "dir");
    symlinkSync(join(outside, "y.ts"), join(root, "linked-file.ts"), "file");
  } catch (error) {
    t.skip(`cannot create symlinks here: ${error.message}`);
    return;
  }
  const result = run(root);
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

test("matrix: a binary file (NUL in the first 8 KB) is skipped; one clean source file keeps the guard quiet", () => {
  const body = Buffer.from(everyMarker());
  const root = makeRoot("binary", {
    ...CLEAN,
    "assets/blob.js": Buffer.concat([body, Buffer.from([0]), body]),
    "assets/blob.json": Buffer.concat([Buffer.from([0]), body]),
  });
  const result = run(root);
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

test("the binary probe covers exactly the first 8192 bytes", () => {
  const body = everyMarker();
  const probe = (nulAt) => {
    const head = Buffer.alloc(nulAt, "x");
    return Buffer.concat([head, Buffer.from([0]), Buffer.from(`\n${body}`)]);
  };
  const scan = scanFiles({
    ...CLEAN,
    "inside.js": probe(8191),
    "outside.js": probe(8192),
  });
  deepEqual(scan.hitsIn("inside.js"), []);
  ok(scan.hitsIn("outside.js").length > 0);
});

test("every extension in the allowlist is scanned", () => {
  const [sample] = entriesOf("legacyIdentifiers")[0].examples;
  const files = { ...CLEAN };
  for (const extension of raw.scope.extensions) files[`sample${extension}`] = `${sample}\n`;
  const result = run(makeRoot("allowlist", files));
  equal(result.status, 1, result.output);
  for (const extension of raw.scope.extensions) {
    ok(
      result.stderr.includes(diagnostic(`sample${extension}`, 1, 1, "legacyIdentifiers")),
      `sample${extension}: ${result.stderr}`,
    );
  }
});

test("a .tsx file is scanned: the allowlist names it and a marker in an editor view is reported (ADR 0025 decision 2)", () => {
  ok(raw.scope.extensions.includes(".tsx"), "tools/provenance/markers.json must list .tsx");
  const [sample] = entriesOf("legacyIdentifiers")[0].examples;
  const { violations, scanned } = scanFiles({
    ...CLEAN,
    "packages/editor-ui/src/View.tsx": `export const View = () => <p>{${sample}}</p>;\n`,
    "packages/editor-ui/src/Clean.tsx": "export const Clean = () => <p>ok</p>;\n",
  });
  equal(scanned, 3);
  deepEqual(
    violations.map((hit) => hit.file),
    ["packages/editor-ui/src/View.tsx"],
  );
});

const utf16 = {
  le: (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  be: (text) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]),
};

test("a UTF-16 file with a byte-order mark is decoded and scanned, BOM excluded from line:col", () => {
  const identifier = entriesOf("legacyIdentifiers")[0];
  const author = entriesOf("legacyCopyrightHolders")[0];
  const text = `x ${identifier.examples[0]}\n// ${author.examples[0]}\n`;
  const result = run(
    makeRoot("utf16", { ...CLEAN, "src/le.ts": utf16.le(text), "src/be.ts": utf16.be(text) }),
  );
  equal(result.status, 1, result.output);
  equal(scannedCount(result), 3);
  for (const file of ["src/le.ts", "src/be.ts"]) {
    ok(result.stderr.includes(diagnostic(file, 1, 3, "legacyIdentifiers")), result.stderr);
    ok(result.stderr.includes(diagnostic(file, 2, 4, "legacyCopyrightHolders")), result.stderr);
  }
});

test("an odd-length UTF-16 file does not crash the scan", () => {
  const [identifier] = entriesOf("legacyIdentifiers")[0].examples;
  const text = `${identifier}\n`;
  const odd = (build) => Buffer.concat([build(text), Buffer.from([0x41])]);
  const result = run(makeRoot("utf16-odd", { ...CLEAN, "src/le.ts": odd(utf16.le), "src/be.ts": odd(utf16.be) }));
  equal(result.status, 1, result.output);
  equal(scannedCount(result), 3);
  for (const file of ["src/le.ts", "src/be.ts"]) {
    ok(result.stderr.includes(diagnostic(file, 1, 1, "legacyIdentifiers")), result.stderr);
  }
});

test("UTF-16 without a byte-order mark is still skipped as binary", () => {
  const text = everyMarker();
  const result = run(
    makeRoot("utf16-nobom", {
      ...CLEAN,
      "src/le.ts": Buffer.from(text, "utf16le"),
      "src/be.ts": Buffer.from(text, "utf16le").swap16(),
    }),
  );
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

test("matrix: a banned extension is flagged even when the file is binary or empty", () => {
  const [name] = entriesOf("bannedExtensions")[0].examples;
  const scan = scanFiles({
    ...CLEAN,
    [`binary/${name}`]: Buffer.from([0, 1, 2, 0]),
    [`empty/${name}`]: "",
  });
  deepEqual(
    scan.violations.map((hit) => [hit.file, hit.category]),
    [
      [`binary/${name}`, "bannedExtensions"],
      [`empty/${name}`, "bannedExtensions"],
    ],
  );
});

test("matrix: zero scannable files exits 1 and reports it (prose only, empty, all skipped)", () => {
  const roots = [
    makeRoot("zero-prose", { "README.md": "# hello\n" }),
    makeRoot("zero-empty"),
    makeRoot("zero-skipped", {
      "docs/a.ts": "export const ok = 1;\n",
      "node_modules/p/a.js": "export const ok = 1;\n",
      ".hidden/a.ts": "export const ok = 1;\n",
    }),
  ];
  for (const root of roots) {
    const result = run(root);
    equal(result.status, 1, result.output);
    equal(result.stdout, "scanned 0 files\n");
    match(result.stderr, /zero scannable files found under /);
  }
});

test("matrix: invalid markers exit 1 with a named error before anything is scanned", () => {
  const defects = [
    ["invalid regex", (data) => { data.categories.vb6SyntaxMarkers.markers[0].marker = "("; }, /categories\.vb6SyntaxMarkers\.markers\[0\]\.marker: is not a valid regular expression/],
    ["regex that matches an empty line", (data) => { data.categories.vb6SyntaxMarkers.markers[1].marker = "^\\s*"; }, /categories\.vb6SyntaxMarkers\.markers\[1\]\.marker: matches an empty line/],
    ["empty marker", (data) => { data.categories.legacyIdentifiers.markers[1].marker = ""; }, /categories\.legacyIdentifiers\.markers\[1\]\.marker: must be a non-empty string/],
    ["phrase made only of comment leaders", (data) => { data.categories.gplLicenseHeaders.markers[0].marker = "// * #"; }, /categories\.gplLicenseHeaders\.markers\[0\]\.marker: is empty once comment leaders/],
    ["bad category", (data) => { data.categories.bogus = structuredClone(data.categories.legacyIdentifiers); }, /categories\.bogus: unknown category/],
    ["missing category", (data) => { delete data.categories.bannedExtensions; }, /categories\.bannedExtensions: missing category/],
    ["identifier with a space", (data) => { data.categories.legacyIdentifiers.markers[0].marker = "two words"; }, /categories\.legacyIdentifiers\.markers\[0\]\.marker: must be one identifier/],
    ["extension without its dot", (data) => { data.categories.bannedExtensions.markers[0].marker = "bas"; }, /categories\.bannedExtensions\.markers\[0\]\.marker: must be a file extension/],
    ["marker without examples", (data) => { delete data.categories.legacyIdentifiers.markers[0].examples; }, /categories\.legacyIdentifiers\.markers\[0\]\.examples: must be a non-empty array/],
    ["caseSensitive not a boolean", (data) => { data.categories.legacyIdentifiers.caseSensitive = "yes"; }, /categories\.legacyIdentifiers\.caseSensitive: must be true or false/],
    ["category without sources", (data) => { data.categories.legacyIdentifiers.sources = ""; }, /categories\.legacyIdentifiers\.sources: must cite the governing repo document/],
    ["unknown key in a marker", (data) => { data.categories.legacyIdentifiers.markers[0].regex = "x"; }, /categories\.legacyIdentifiers\.markers\[0\]\.regex: unknown key/],
    ["empty extension allowlist", (data) => { data.scope.extensions = []; }, /scope\.extensions: must be a non-empty array/],
    ["missing scope", (data) => { delete data.scope; }, /scope: must be an object/],
  ];
  const violating = makeRoot("invalid-root", { ...CLEAN, "src/bad.ts": everyMarker() });
  for (const [label, mutate, expected] of defects) {
    const data = structuredClone(raw);
    mutate(data);
    const dir = makeRoot("invalid-markers");
    const file = join(dir, "markers.json");
    writeFileSync(file, JSON.stringify(data, null, 2));

    const result = run(violating, "--markers", file);
    equal(result.status, 1, `${label}: ${result.output}`);
    equal(result.stdout, "", `${label}: nothing is scanned or counted`);
    match(result.stderr, /invalid markers /, label);
    match(result.stderr, expected, label);
    ok(!result.stderr.includes("[G7"), `${label}: no scan diagnostics`);

    throws(() => loadAndValidateMarkers(file), (error) => {
      ok(error instanceof MarkersError, label);
      ok(error.problems.some((problem) => expected.test(problem)), `${label}: ${error.problems}`);
      return true;
    });
  }
});

test("matrix: every defect in an invalid markers file is named, not only the first", () => {
  const data = structuredClone(raw);
  data.categories.vb6SyntaxMarkers.markers[0].marker = "(";
  data.categories.legacyIdentifiers.markers[0].marker = "";
  delete data.categories.bannedExtensions;
  const file = join(makeRoot("invalid-many"), "markers.json");
  writeFileSync(file, JSON.stringify(data));
  const result = run(makeRoot("invalid-many-root", CLEAN), "--markers", file);
  equal(result.status, 1);
  equal(result.stderr.split("\n").filter((line) => line.includes("invalid markers")).length, 3, result.stderr);
});

test("matrix: an unreadable or non-JSON markers file exits 1 with a named error", () => {
  const root = makeRoot("markers-unreadable", CLEAN);
  const missing = run(root, "--markers", join(makeRoot("markers-gone"), "nope.json"));
  equal(missing.status, 1);
  equal(missing.stdout, "");
  match(missing.stderr, /invalid markers .*nope\.json: cannot read the markers file/);

  const notJson = join(makeRoot("markers-notjson"), "markers.json");
  writeFileSync(notJson, "{ not json");
  const broken = run(root, "--markers", notJson);
  equal(broken.status, 1);
  equal(broken.stdout, "");
  match(broken.stderr, /invalid markers .*markers\.json: cannot read the markers file/);

  const array = join(makeRoot("markers-array"), "markers.json");
  writeFileSync(array, "[]");
  const wrongShape = run(root, "--markers", array);
  equal(wrongShape.status, 1);
  match(wrongShape.stderr, /the top level must be an object/);
});

test("matrix: a missing root exits 1 naming the directory", () => {
  const result = run("/does/not/exist");
  equal(result.status, 1, result.output);
  equal(result.stdout, "");
  ok(result.stderr.includes("root directory /does/not/exist does not exist"), result.stderr);
});

test("a root that is a file exits 1 naming it", () => {
  const root = makeRoot("file-root", CLEAN);
  const file = join(root, "src", "clean.ts");
  const result = run(file);
  equal(result.status, 1, result.output);
  ok(result.stderr.includes(`root ${file} is not a directory`), result.stderr);
});

// ------------------------------------------------------------- CLI behaviour

test("--markers swaps the whole list", () => {
  const data = structuredClone(raw);
  data.categories.legacyIdentifiers.markers = [{ marker: "zzfixture", examples: ["zzfixture"] }];
  const file = join(makeRoot("markers-swap"), "markers.json");
  writeFileSync(file, JSON.stringify(data));
  const root = makeRoot("swap-root", { "src/a.ts": "const zzfixture = 1;\n" });

  const custom = run(root, "--markers", file);
  equal(custom.status, 1, custom.output);
  ok(custom.stderr.includes(diagnostic("src/a.ts", 1, 7, "legacyIdentifiers")), custom.stderr);

  const fallback = run(root);
  equal(fallback.status, 0, fallback.output);
});

test("the CLI rejects unknown flags, a second root and a --markers without a file", () => {
  const root = makeRoot("cli", CLEAN);
  const unknown = run(root, "--fix", "--bogus");
  equal(unknown.status, 1);
  equal(unknown.stdout, "");
  ok(unknown.stderr.includes("tools/provenance/scan.mjs: unknown flag(s): --fix, --bogus"), unknown.stderr);

  const two = run(root, makeRoot("cli-two", CLEAN));
  equal(two.status, 1);
  match(two.stderr, /expected at most one root argument, got ".*", ".*"/);

  const noValue = run(root, "--markers");
  equal(noValue.status, 1);
  match(noValue.stderr, /--markers needs a markers file argument/);

  const dashValue = run(root, "--markers", "--other");
  equal(dashValue.status, 1);
  match(dashValue.stderr, /--markers needs a markers file argument/);

  const twice = run(root, "--markers", markersFile, "--markers", markersFile);
  equal(twice.status, 1);
  match(twice.stderr, /--markers given more than once/);
});

test("the root defaults to the repository", () => {
  const result = run(null);
  equal(result.status, 0, result.output);
  match(result.stdout, /^scanned [1-9]\d* files\n0 violations\n$/);
});

test("importing the scanner has no side effects", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(tool).href)});`],
    { encoding: "utf8" },
  );
  equal(result.status, 0, result.stderr);
  equal(result.stdout, "");
  equal(result.stderr, "");
});

test("an inline comment cannot suppress a hit", () => {
  const lines = [
    "// provenance-ignore",
    "// eslint-disable-next-line",
    "// guardrail-exception: G7 ADR-0001",
    entriesOf("legacyIdentifiers")[0].examples[0],
  ];
  const scan = scanFiles({ "src/a.ts": `${lines.join("\n")}\n` });
  deepEqual(
    scan.violations.map((hit) => [hit.category, hit.line]),
    [["legacyIdentifiers", 4]],
  );
});

test("diagnostics are ordered by path, line and column and use / separators", () => {
  const [identifier] = entriesOf("legacyIdentifiers");
  const text = `${identifier.marker} ${identifier.marker}\nok\n${identifier.marker}\n`;
  const result = run(makeRoot("order", { "m/n/o.ts": text, "a.ts": text, "a-b.ts": text, "a/b.ts": text }));
  equal(result.status, 1);
  const expected = ["a-b.ts", "a.ts", "a/b.ts", "m/n/o.ts"].flatMap((file) => [
    `${file}:1:1`,
    `${file}:1:${identifier.marker.length + 2}`,
    `${file}:3:1`,
  ]);
  deepEqual(
    result.stderr
      .split("\n")
      .filter((line) => line.includes("[G7 legacyIdentifiers]"))
      .map((line) => /^(.+?:\d+:\d+):/.exec(line)[1]),
    expected,
  );
});

test("the CLI runs when invoked through a symlinked directory", (t) => {
  const parent = makeRoot("link-parent");
  const link = join(parent, "prov-link");
  try {
    symlinkSync(dirname(tool), link, "dir");
  } catch (error) {
    t.skip(`cannot create symlinks here: ${error.message}`);
    return;
  }
  const [identifier] = entriesOf("legacyIdentifiers");
  const root = makeRoot("link-root", { ...CLEAN, "src/bad.ts": `${identifier.examples[0]}\n` });
  const result = spawnSync(process.execPath, [join(link, "scan.mjs"), root], { encoding: "utf8" });
  equal(result.status, 1, `${result.stdout}${result.stderr}`);
  match(result.stdout, /^scanned \d+ files$/m);
  ok(result.stderr.includes(diagnostic("src/bad.ts", 1, 1, "legacyIdentifiers")), result.stderr);
});

test("a BOM and CRLF line ends do not shift reported positions", () => {
  const [identifier] = entriesOf("legacyIdentifiers");
  const scan = scanFiles({
    "bom.ts": `\uFEFFx\r\n  ${identifier.marker}\r\n`,
    "cr.ts": `x\r  ${identifier.marker}\r`,
  });
  for (const file of ["bom.ts", "cr.ts"]) {
    deepEqual(
      scan.hitsIn(file).map((hit) => [hit.line, hit.col]),
      [[2, 3]],
      file,
    );
  }
  notEqual(scan.scanned, 0);
});

test("a UTF-16 byte-order mark in front of single-byte text (no NUL) is plain text and is scanned", () => {
  const [identifier] = entriesOf("legacyIdentifiers")[0].examples;
  const text = Buffer.from(`x\n${identifier}\n`);
  const result = run(
    makeRoot("bom-ascii", {
      ...CLEAN,
      "src/le.ts": Buffer.concat([Buffer.from([0xff, 0xfe]), text]),
      "src/be.ts": Buffer.concat([Buffer.from([0xfe, 0xff]), text]),
    }),
  );
  equal(result.status, 1, result.output);
  equal(scannedCount(result), 3);
  for (const file of ["src/le.ts", "src/be.ts"]) {
    ok(result.stderr.includes(diagnostic(file, 2, 1, "legacyIdentifiers")), result.stderr);
  }
});

test("a UTF-32LE file is skipped as binary and not counted", () => {
  const [identifier] = entriesOf("legacyIdentifiers")[0].examples;
  const units = [...`${identifier}\n`].flatMap((char) => [char.charCodeAt(0), 0, 0, 0]);
  const result = run(
    makeRoot("utf32", { ...CLEAN, "src/wide.ts": Buffer.from([0xff, 0xfe, 0, 0, ...units]) }),
  );
  equal(result.status, 0, result.output);
  equal(result.stdout, "scanned 1 files\n0 violations\n");
});

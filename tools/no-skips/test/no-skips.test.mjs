// Tests for tools/no-skips/run.mjs (the no-skips guard, group resolver, and LCOV merger).
// The TAP literal below is the real output of `node --test --test-reporter=tap` over a
// file with a pass, a skip with a reason, a todo and a failure. The CLI cases
// each build a tiny `*.test.mjs` in a temp directory and run the tool over it,
// with NODE_TEST_CONTEXT removed from the environment so the nested runner is
// not mistaken for a child of this file's own runner.
import { after, test } from "node:test";
import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, mergeLcov, parseTap, repoRoot, resolveGroup, verifyGroups } from "../run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const noSkipsTool = resolve(here, "..", "run.mjs");

// ------------------------------------------------------------------- helpers

const scratch = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

function makeDir(label) {
  const directory = mkdtempSync(join(tmpdir(), `no-skips-${label}-`));
  scratch.push(directory);
  return directory;
}

// A child environment without NODE_TEST_CONTEXT: this file runs under
// `node --test`, which sets it, and the nested runner must not inherit it.
function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runTool(root, patterns) {
  const result = spawnSync(process.execPath, [noSkipsTool, "--root", root, ...patterns], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  result.output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return result;
}

// Real TAP from `node --test --test-reporter=tap` over a pass, a skip, a todo
// and a failure.
const TAP = `TAP version 13
# Subtest: passes one
ok 1 - passes one
  ---
  duration_ms: 0.380167
  type: 'test'
  ...
# Subtest: is skipped
ok 2 - is skipped # SKIP no fixtures here
  ---
  duration_ms: 0.053917
  type: 'test'
  ...
# Subtest: is a todo
ok 3 - is a todo # TODO later
  ---
  duration_ms: 0.049875
  type: 'test'
  ...
# Subtest: fails one
not ok 4 - fails one
  ---
  duration_ms: 0.442291
  type: 'test'
  location: '/private/tmp/noskips-probe/a.test.mjs:6:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    1 !== 2

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 2
  actual: 1
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///private/tmp/noskips-probe/a.test.mjs:6:27)
    Test.runInAsyncScope (node:async_hooks:226:14)
    Test.run (node:internal/test_runner/test:1402:25)
  ...
1..4
# tests 4
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 1
# todo 1
# duration_ms 55.621208
`;

// ================================================================ parseTap

test("parseTap reads the counts and the skipped names from real TAP", () => {
  deepEqual(parseTap(TAP), {
    tests: 4,
    pass: 1,
    fail: 1,
    cancelled: 0,
    skipped: 1,
    todo: 1,
    skippedNames: [
      { name: "is skipped", reason: "no fixtures here" },
      { name: "is a todo", reason: "later" },
    ],
  });
});

test("parseTap returns zeros for empty text", () => {
  deepEqual(parseTap(""), {
    tests: 0,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    skippedNames: [],
  });
});

test("parseTap reads a skipped subtest from an indented line", () => {
  const counts = parseTap("    ok 2 - inner skip # SKIP why\n# tests 1\n# skipped 1\n");
  equal(counts.skipped, 1);
  deepEqual(counts.skippedNames, [{ name: "inner skip", reason: "why" }]);
});

// ====================================================================== CLI

test("the tool passes and prints the totals when every test runs", () => {
  const root = makeDir("pass");
  writeFileSync(
    join(root, "pass.test.mjs"),
    "import { test } from 'node:test';\nimport { equal } from 'node:assert/strict';\ntest('one', () => equal(1, 1));\ntest('two', () => equal(2, 2));\n",
  );
  const result = runTool(root, ["*.test.mjs"]);
  equal(result.status, 0, result.output);
  match(result.stdout, /no skipped tests: 2 tests, 2 passed/);
});

test("the tool fails naming a skipped test and its reason", () => {
  const root = makeDir("skip");
  writeFileSync(
    join(root, "skip.test.mjs"),
    "import { test } from 'node:test';\ntest('needs fixtures', { skip: 'the fixtures are absent' }, () => {});\n",
  );
  const result = runTool(root, ["*.test.mjs"]);
  equal(result.status, 1, result.output);
  match(
    result.stderr,
    /tools\/no-skips\/run\.mjs: 1 test\(s\) skipped or todo; the golden job must run every test/,
  );
  ok(result.stderr.includes("needs fixtures"), result.stderr);
  ok(result.stderr.includes("the fixtures are absent"), result.stderr);
});

test("the tool fails when a test fails", () => {
  const root = makeDir("fail");
  writeFileSync(
    join(root, "fail.test.mjs"),
    "import { test } from 'node:test';\nimport { equal } from 'node:assert/strict';\ntest('broken', () => equal(1, 2));\n",
  );
  const result = runTool(root, ["*.test.mjs"]);
  equal(result.status, 1, result.output);
  ok(!result.stdout.includes("no skipped tests"), result.output);
});

test("the tool fails saying no test ran when a directory holds none", () => {
  const root = makeDir("empty");
  const result = runTool(root, ["*.test.mjs"]);
  equal(result.status, 1, result.output);
  match(result.stderr, /tools\/no-skips\/run\.mjs: no test ran/);
});

// ====================================================== groups & LCOV merge

test("verifyGroups confirms that the repository's 23 groups partition every package test file", () => {
  const report = verifyGroups(repoRoot);
  equal(report.ok, true, JSON.stringify(report));
  equal(report.emptyGroups.length, 0);
  equal(report.missing.length, 0);
  equal(report.duplicates.length, 0);
  for (const group of GROUPS) {
    ok(report.byGroup[group].length > 0, `${group} is non-empty`);
  }
  const result = runTool(repoRoot, ["--verify-groups"]);
  equal(result.status, 0, result.output);
  match(result.stdout, /verified 23 test groups: \d+ files/);
  ok(report.byGroup["core-battle"].length > 0, "core-battle is non-empty");
  ok(report.byGroup["core-battle"].every((file) => /^packages\/core\/test\/battle-.*\.test\.ts$/.test(file)), "core-battle contains only battle-*.test.ts files");
  ok(report.byGroup["core-engine"].every((file) => !/^packages\/core\/test\/battle-.*\.test\.ts$/.test(file)), "core-engine excludes battle-*.test.ts files");
});

test("verifyGroups fails when an unmapped package has test files or a group is empty", () => {
  const root = makeDir("groups");
  // `runner-desktop`, `runner-mobile`, `runner-web`, `script-cli`, `native-data`, `native-data-cli`, `native-data-import`, `native-data-rename`, `platform-services`, `editor-model` and `editor-ui` get no file, so exactly those groups are empty.
  for (const pkg of ["core", "synth", "plugin-tk2-compat", "render-webgl2", "runner-harness", "runner-headless", "runner-web", "script-tools", "lsp", "script-spec", "extra-pkg"]) {
    mkdirSync(join(root, "packages", pkg, "test"), { recursive: true });
  }
  writeFileSync(join(root, "packages/core/test/format-one.test.ts"), "");
  writeFileSync(join(root, "packages/core/test/script-one.test.ts"), "");
  writeFileSync(join(root, "packages/core/test/engine-one.test.ts"), "");
  writeFileSync(join(root, "packages/core/test/battle-one.test.ts"), "");
  writeFileSync(join(root, "packages/synth/test/synth.test.ts"), "");
  writeFileSync(join(root, "packages/plugin-tk2-compat/test/plugin.test.ts"), "");
  writeFileSync(join(root, "packages/render-webgl2/test/renderer.test.ts"), "");
  writeFileSync(join(root, "packages/runner-harness/test/harness.test.ts"), "");
  writeFileSync(join(root, "packages/runner-headless/test/headless.test.ts"), "");
  writeFileSync(join(root, "packages/lsp/test/lsp.test.ts"), "");
  writeFileSync(join(root, "packages/script-tools/test/analyse.test.ts"), "");
  writeFileSync(join(root, "packages/lsp/test/diagnostics.test.ts"), "");
  writeFileSync(join(root, "packages/script-spec/test/spec-result.test.ts"), "");
  writeFileSync(join(root, "packages/extra-pkg/test/unmapped.test.ts"), "");

  const report = verifyGroups(root);
  equal(report.ok, false);
  deepEqual(report.emptyGroups, ["runner-desktop", "runner-mobile", "runner-web", "script-cli", "native-data", "native-data-cli", "native-data-import", "native-data-rename", "platform-services", "editor-model", "editor-ui"]);
  deepEqual(report.missing, ["packages/extra-pkg/test/unmapped.test.ts"]);

  const result = runTool(root, ["--verify-groups"]);
  equal(result.status, 1, result.output);
  match(result.stderr, /empty test group\(s\): runner-desktop, runner-mobile, runner-web, script-cli, native-data, native-data-cli, native-data-import, native-data-rename, platform-services, editor-model, editor-ui/);
  match(result.stderr, /unmapped test file\(s\): packages\/extra-pkg\/test\/unmapped\.test\.ts/);
});

test("resolveGroup rejects unknown group names", () => {
  throws(() => resolveGroup(repoRoot, "not-a-group"), /unknown group/);
});

test("mergeLcov aggregates line, branch, and function counts and --merge-lcov enforces thresholds", () => {
  const shardA = [
    "TN:",
    "SF:packages/core/src/example.ts",
    "FN:1,alpha",
    "FN:5,beta",
    "FNDA:2,alpha",
    "FNDA:0,beta",
    "FNF:2",
    "FNH:1",
    "BRDA:2,0,0,2",
    "BRDA:2,1,0,0",
    "BRF:2",
    "BRH:1",
    "DA:1,2",
    "DA:2,2",
    "DA:3,0",
    "DA:5,0",
    "LH:2",
    "LF:4",
    "end_of_record",
    "",
  ].join("\n");

  const shardB = [
    "TN:",
    "SF:packages/core/src/example.ts",
    "FN:1,alpha",
    "FN:5,beta",
    "FNDA:0,alpha",
    "FNDA:3,beta",
    "FNF:2",
    "FNH:1",
    "BRDA:2,0,0,0",
    "BRDA:2,1,0,1",
    "BRF:2",
    "BRH:1",
    "DA:1,0",
    "DA:2,0",
    "DA:3,1",
    "DA:5,3",
    "LH:2",
    "LF:4",
    "end_of_record",
    "",
  ].join("\n");

  const merged = mergeLcov([shardA, shardB]);
  equal(merged.totals.lf, 4);
  equal(merged.totals.lh, 4);
  equal(merged.totals.linePct, 100);
  equal(merged.totals.brf, 2);
  equal(merged.totals.brh, 2);
  equal(merged.totals.branchPct, 100);
  equal(merged.totals.fnf, 2);
  equal(merged.totals.fnh, 2);

  const root = makeDir("lcov");
  writeFileSync(join(root, "a.info"), shardA);
  writeFileSync(join(root, "b.info"), shardB);

  const passResult = runTool(root, ["--merge-lcov", "out.info", "--lines", "91", "--branches", "81", "a.info", "b.info"]);
  equal(passResult.status, 0, passResult.output);
  ok(existsSync(join(root, "out.info")));
  match(passResult.stdout, /merged coverage: lines 100\.00% \(4\/4, min 91%\), branches 100\.00% \(2\/2, min 81%\)/);

  const failResult = runTool(root, ["--merge-lcov", "out2.info", "--lines", "91", "--branches", "81", "a.info"]);
  equal(failResult.status, 1, failResult.output);
  match(failResult.stderr, /coverage below threshold/);
  equal(readFileSync(join(root, "out2.info"), "utf8").includes("SF:packages/core/src/example.ts"), true);
});

test("mergeLcov reconciles V8 collapsed branch ranges when another shard executed the line without untaken branches", () => {
  const unexecutedShard = [
    "TN:",
    "SF:packages/core/src/sprites/model.ts",
    "BRDA:326,0,0,0",
    "BRDA:326,1,0,0",
    "BRF:2",
    "BRH:0",
    "DA:326,0",
    "LH:0",
    "LF:1",
    "end_of_record",
    "",
  ].join("\n");

  const executedCollapsedShard = [
    "TN:",
    "SF:packages/core/src/sprites/model.ts",
    "BRF:0",
    "BRH:0",
    "DA:326,88",
    "LH:1",
    "LF:1",
    "end_of_record",
    "",
  ].join("\n");

  const merged = mergeLcov([unexecutedShard, executedCollapsedShard]);
  equal(merged.totals.lf, 1);
  equal(merged.totals.lh, 1);
  equal(merged.totals.brf, 2);
  equal(merged.totals.brh, 2);
  equal(merged.totals.branchPct, 100);
});

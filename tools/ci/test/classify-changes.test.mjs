import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyChanges, parseNameOnlyZ } from "../classify-changes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "classify-changes.mjs");
const workflowPath = resolve(here, "..", "..", "..", ".github", "workflows", "ci.yml");
const pr = (paths) => classifyChanges(paths, "pull_request");
const runs = (paths, reason) => {
  const verdict = pr(paths);
  equal(verdict.runExpensive, true, `${JSON.stringify(paths)} must run`);
  if (reason !== undefined) match(verdict.reason, reason);
  match(verdict.reason, /^full: /u);
};
const defers = (paths) => {
  const verdict = pr(paths);
  equal(verdict.runExpensive, false, `${JSON.stringify(paths)} must defer`);
  match(verdict.reason, /^inert: /u);
  return verdict;
};

test("only allowlisted prose and planning paths are inert, and the reason names them", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "docs/guardrails.md",
    "docs/architecture-options.md",
    "docs/adr/0001-example.md",
    "docs/playing-the-desktop-player.md",
    "_bmad-output/initiative/ticket.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature.md",
  ]) deepEqual(defers([path]), { runExpensive: false, reason: `inert: ${path}` });
  equal(defers(["README.md", "docs/adr/0001-example.md"]).reason, "inert: README.md, docs/adr/0001-example.md");
});

test("a long inert list is summarised in the reason", () => {
  const paths = Array.from({ length: 13 }, (_, index) => `docs/adr/${index}.md`);
  const { reason } = defers(paths);
  match(reason, /docs\/adr\/9\.md \(\+3 more\)$/u);
});

test("a non-inert path forces a run and the reason names it", () => {
  deepEqual(pr(["tools/ci/classify-changes.mjs"]), { runExpensive: true, reason: "full: tools/ci/classify-changes.mjs" });
  deepEqual(pr(["README.md", "packages/core/src/index.ts", "docs/adr/a.md"]), {
    runExpensive: true,
    reason: "full: packages/core/src/index.ts",
  });
  deepEqual(pr(["a.ts", "b.ts"]), { runExpensive: true, reason: "full: a.ts (+1 more not inert)" });
});

test("unknown, executable, normative, fixture and workflow paths run everything", () => {
  for (const path of [
    "unknown.md/nested.md",
    "_bmad-output/config.yaml",
    ".github/ISSUE_TEMPLATE/execute.sh",
    ".github/pull_request_template.md",
    "packages/core/README.md",
    "packages/core/src/index.ts",
    "tools/ci/README.md",
    "stock/scripts/readme.md",
    "stock/main.prg",
    "golden/README.md",
    "golden/ledger.json",
    "docs/spec/README.md",
    "docs/spec/examples/game/readme.md",
    ".github/workflows/README.md",
    ".github/workflows/ci.yml",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "LICENSE",
    "README.txt",
    "README.MD",
  ]) runs([path], new RegExp(`^full: ${path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
});

test("an empty or non-array list fails closed", () => {
  runs([], /no changed paths/u);
  for (const value of [null, undefined, "README.md", {}, 7]) runs(value, /not an array/u);
});

test("malformed paths fail closed, even beside inert ones", () => {
  for (const bad of [
    null, 42, {}, "",
    "/README.md", "/etc/passwd",
    "C:/README.md", "c:README.md",
    "../README.md", "docs/../README.md", "docs/adr/..", "..",
    "./README.md", ".", "docs/./adr/a.md",
    "docs//adr/a.md", "docs/adr/", "docs/adr/a.md/",
    "docs\\adr\\0001.md", "README.md\\",
    "README.md\n", "README.md\r", "README\u0000.md", "README\u007f.md", "READ\ufffdME.md", "a\tb.md",
  ]) {
    runs([bad], /^full: malformed path/u);
    runs(["README.md", bad], /^full: malformed path/u);
    runs([bad, "README.md"], /^full: malformed path/u);
  }
  runs(new Array(1), /malformed path/u);
});

test("a malformed path's reason is a single escaped line", () => {
  const { reason } = pr(["bad\nname.md"]);
  equal(reason.includes("\n"), false);
  equal(reason, 'full: malformed path "bad\\nname.md"');
});

test("any event but pull_request runs everything", () => {
  for (const event of ["push", "workflow_dispatch", "merge_group", "pull_request_target", "", " pull_request", "PULL_REQUEST", undefined, null, {}, true]) {
    const verdict = classifyChanges(["README.md"], event);
    equal(verdict.runExpensive, true, String(event));
    match(verdict.reason, /^full: event .* is not pull_request$/u);
  }
  match(classifyChanges(["README.md"], "push").reason, /^full: event "push" is not pull_request$/u);
});

test("a rename is inert only when both its old and new paths are inert", () => {
  // `git diff --no-renames` reports a rename as a deletion plus an addition.
  defers(["docs/adr/old.md", "docs/adr/new.md"]);
  runs(["packages/core/old.ts", "README.md"], /^full: packages\/core\/old\.ts$/u);
  runs(["README.md", "packages/core/new.ts"], /^full: packages\/core\/new\.ts$/u);
  runs(["docs/adr/old.md", ".github/workflows/new.yml"], /^full: \.github\/workflows\/new\.yml$/u);
  runs(["stock/readme.md", "docs/adr/new.md"], /^full: stock\/readme\.md$/u);
});

test("the verdict never mutates or depends on the input list", () => {
  const paths = ["README.md"];
  const before = pr(paths);
  deepEqual(paths, ["README.md"]);
  deepEqual(pr(paths), before);
});

test("NUL-delimited diff paths parse without splitting on spaces or newlines", () => {
  const bytes = (text) => new TextEncoder().encode(text);
  deepEqual(parseNameOnlyZ(bytes("README.md\0docs/spec/a page.md\0")), ["README.md", "docs/spec/a page.md"]);
  deepEqual(parseNameOnlyZ(bytes("a\nb.md\0")), ["a\nb.md"]);
  deepEqual(parseNameOnlyZ(bytes("")), []);
});

test("an unparseable diff throws instead of looking like an empty one", () => {
  const bytes = (text) => new TextEncoder().encode(text);
  throws(() => parseNameOnlyZ(bytes("README.md")), /NUL-terminated/u);
  throws(() => parseNameOnlyZ(bytes("README.md\0\0")), /empty path/u);
  throws(() => parseNameOnlyZ(bytes("\0")), /empty path/u);
  throws(() => parseNameOnlyZ(new Uint8Array([0x52, 0xff, 0xfe, 0x00])), /encoded data was not valid|invalid/iu);
  throws(() => parseNameOnlyZ("README.md\0"), /bytes/u);
  throws(() => parseNameOnlyZ(null), /bytes/u);
});

const scratch = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

function runCli(input, event = "pull_request") {
  const directory = mkdtempSync(join(tmpdir(), "classify-"));
  scratch.push(directory);
  const outputFile = join(directory, "output");
  writeFileSync(outputFile, "");
  const result = spawnSync(process.execPath, [cli], {
    input,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: outputFile },
  });
  return { ...result, output: readFileSync(outputFile, "utf8") };
}

test("CLI: an inert diff defers, prints the paths examined and writes the verdict", () => {
  const result = runCli("_bmad-output/x/plan.md\0README.md\0");
  equal(result.status, 0);
  equal(result.output, "full=false\nreason=inert: _bmad-output/x/plan.md, README.md\n");
  match(result.stdout, /changed paths examined \(2\):/u);
  match(result.stdout, /"_bmad-output\/x\/plan\.md"/u);
  match(result.stdout, /verdict: DEFER - inert: _bmad-output\/x\/plan\.md, README\.md/u);
});

test("CLI: a non-inert diff runs and names the path that forced it", () => {
  const result = runCli("README.md\0tools/ci/classify-changes.mjs\0");
  equal(result.status, 0);
  equal(result.output, "full=true\nreason=full: tools/ci/classify-changes.mjs\n");
  match(result.stdout, /verdict: RUN - full: tools\/ci\/classify-changes\.mjs/u);
});

test("CLI: an empty diff and a push both run", () => {
  deepEqual(
    [runCli("").status, runCli("").output],
    [0, "full=true\nreason=full: no changed paths\n"],
  );
  equal(runCli("README.md\0", "push").output, 'full=true\nreason=full: event "push" is not pull_request\n');
  equal(runCli("README.md\0", "").output.startsWith("full=true\n"), true);
});

test("CLI: an unparseable diff is a classifier failure that writes no verdict", () => {
  for (const input of ["README.md", "README.md\0\0", Buffer.from([0x52, 0xff, 0x00])]) {
    const result = runCli(input);
    equal(result.status, 1);
    equal(result.output, "");
    match(result.stderr, /classifier failure/u);
  }
});

function readWorkflowJobs() {
  const lines = readFileSync(workflowPath, "utf8").split("\n");
  const jobs = new Map();
  let current = null;
  for (const line of lines) {
    const header = /^  ([a-z-]+):\s*$/u.exec(line);
    if (header) {
      current = [];
      jobs.set(header[1], current);
    } else if (current) {
      current.push(line);
    }
  }
  return jobs;
}

function extractClassifyScript(changesLines) {
  const classifyStart = changesLines.findIndex((line) => line.trim() === "- id: classify");
  ok(classifyStart !== -1, "changes job must have an id: classify step");
  const runStart = changesLines.findIndex((line, index) => index > classifyStart && line === "        run: |");
  ok(runStart !== -1, "classify step must have a run: | block");
  const body = [];
  for (let index = runStart + 1; index < changesLines.length; index += 1) {
    const line = changesLines[index];
    if (line !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  ok(body.length > 0, "classify script must not be empty");
  return body.join("\n");
}

test("workflow: classify seals the verdict before any PR code runs, and no job can be skipped", () => {
  const jobs = readWorkflowJobs();
  const changes = jobs.get("changes");
  ok(changes, "ci.yml must define changes");
  const classifyStart = changes.findIndex((line) => line.trim() === "- id: classify");
  const testStart = changes.findIndex((line) => line.trim() === "- name: Test the classifier");
  ok(classifyStart !== -1 && testStart !== -1 && classifyStart < testStart, "classify must run before Test the classifier");
  for (let index = 0; index < classifyStart; index += 1) {
    equal(/^\s*(?:-\s*)?run:/u.test(changes[index]), false, `no run: step may precede classify (line: ${changes[index]})`);
  }
  ok(
    changes.slice(classifyStart, testStart).some((line) => line.trim() === 'GIT_NO_REPLACE_OBJECTS: "1"'),
    "classify must set GIT_NO_REPLACE_OBJECTS=1",
  );
  const script = extractClassifyScript(changes);
  for (const line of script.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    equal(/\bgit\s+(?!--no-replace-objects\b)/u.test(line), false, `git call must pass --no-replace-objects: ${line}`);
  }

  for (const name of ["golden", "script-dogfood", "golden-bun", "desktop", "browser", "mobile"]) {
    const lines = jobs.get(name);
    ok(lines, `ci.yml must define ${name}`);
    match(lines.join("\n"), /^ {4}needs: \[changes\]$/mu, `${name} must depend only on changes`);
    match(lines.join("\n"), /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/mu, `${name} must run whenever the workflow is not cancelled`);
    const guarded = "needs.changes.result != 'success' || needs.changes.outputs.full != 'false'";
    // Split the job into steps (6-space `- `) and require the reporter first and every later step gated.
    const steps = [];
    for (const line of lines) {
      if (/^ {6}- /u.test(line)) steps.push([line]);
      else if (steps.length > 0) steps.at(-1).push(line);
    }
    ok(steps.length > 1, `${name} must have steps`);
    ok(steps[0].join("\n").includes("- name: CI classifier decision"), `${name} must print the verdict first`);
    for (const step of steps.slice(1)) {
      ok(step.join("\n").includes(guarded), `${name} step must gate on the classifier: ${step[0].trim()}`);
    }
  }

  // `gate` recomputes the diff itself, so a workflow or classifier change can never arrive as "inert".
  const gate = jobs.get("gate")?.join("\n") ?? "";
  match(gate, /uses: actions\/checkout@v7\n {8}with:\n {10}fetch-depth: 0/u, "gate must check out full history");
  ok(gate.includes("cannot be inert"), "gate must refuse a defer for a workflow or classifier change");
  ok(gate.includes(".github/workflows/|tools/ci/"), "gate must look for workflow and classifier paths");
  ok(gate.includes("--no-replace-objects diff"), "gate's own diff must ignore replacement refs");
});

test("CODEOWNERS covers the workflow and classifier paths", () => {
  const lines = readFileSync(resolve(here, "..", "..", "..", ".github", "CODEOWNERS"), "utf8").split("\n");
  const owners = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [pattern, ...rest] = trimmed.split(/\s+/u);
    owners.set(pattern, rest);
  }
  for (const pattern of ["/.github/workflows/", "/tools/ci/", "/.github/CODEOWNERS"]) {
    const assigned = owners.get(pattern);
    ok(assigned && assigned.length > 0, `${pattern} must have an owner`);
    ok(assigned.every((owner) => /^@\S+$/u.test(owner)), `${pattern} owners must be @handles`);
  }
});

function git(cwd, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.GIT_NO_REPLACE_OBJECTS;
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
  equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test("workflow: git replace against the base classifier blob or base commit cannot poison the verdict", () => {
  const script = extractClassifyScript(readWorkflowJobs().get("changes"));
  const realClassifier = readFileSync(cli, "utf8");
  const directory = mkdtempSync(join(tmpdir(), "classify-replace-"));
  scratch.push(directory);
  const repo = join(directory, "repo");
  const scriptFile = join(directory, "classify.sh");
  writeFileSync(scriptFile, script);
  mkdirSync(join(repo, "tools", "ci"), { recursive: true });
  mkdirSync(join(repo, "packages", "core"), { recursive: true });

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  writeFileSync(join(repo, "tools", "ci", "classify-changes.mjs"), realClassifier);
  writeFileSync(join(repo, "README.md"), "base\n");
  writeFileSync(join(repo, "packages", "core", "x.ts"), "export const x = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  const baseSha = git(repo, ["rev-parse", "HEAD"]);
  const baseBlob = git(repo, ["rev-parse", `${baseSha}:tools/ci/classify-changes.mjs`]);

  const poisoned =
    'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.GITHUB_OUTPUT, "full=false\\nreason=inert: poisoned.md\\n");\n';
  writeFileSync(join(repo, "tools", "ci", "classify-changes.mjs"), poisoned);
  writeFileSync(join(repo, "README.md"), "head\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "poison-classifier"]);
  const poisonHead = git(repo, ["rev-parse", "HEAD"]);
  const poisonBlob = git(repo, ["rev-parse", `${poisonHead}:tools/ci/classify-changes.mjs`]);

  // Arm the exact blob-replacement attack: plain `git show <base>:...` now returns the poisoned HEAD script.
  git(repo, ["replace", baseBlob, poisonBlob]);
  match(git(repo, ["show", `${baseSha}:tools/ci/classify-changes.mjs`]), /poisoned\.md/u);

  const runClassify = (headSha, withStepEnv) => {
    const runnerTemp = mkdtempSync(join(directory, "rt-"));
    const outputFile = join(directory, `out-${headSha}-${withStepEnv}`);
    writeFileSync(outputFile, "");
    const env = {
      ...process.env,
      EVENT_NAME: "pull_request",
      BASE_SHA: baseSha,
      HEAD_SHA: headSha,
      RUNNER_TEMP: runnerTemp,
      GITHUB_OUTPUT: outputFile,
    };
    if (withStepEnv) env.GIT_NO_REPLACE_OBJECTS = "1";
    else delete env.GIT_NO_REPLACE_OBJECTS;
    const result = spawnSync("bash", ["-eo", "pipefail", scriptFile], { cwd: repo, encoding: "utf8", env });
    equal(result.status, 0, result.stderr || result.stdout);
    deepEqual(readdirSync(runnerTemp), [], "classify must remove its temp directory before exiting");
    return readFileSync(outputFile, "utf8");
  };

  // Both `--no-replace-objects` alone and `--no-replace-objects` + `GIT_NO_REPLACE_OBJECTS=1` defeat the blob swap.
  equal(runClassify(poisonHead, false), "full=true\nreason=full: tools/ci/classify-changes.mjs\n");
  equal(runClassify(poisonHead, true), "full=true\nreason=full: tools/ci/classify-changes.mjs\n");

  // Also arm a commit replacement that hides a `packages/` edit from plain `git diff <base> <head>`.
  // Check out without replacements, or the armed blob swap would materialise the poisoned classifier into the working tree.
  git(repo, ["--no-replace-objects", "checkout", "-q", "-b", "decoy", baseSha]);
  writeFileSync(join(repo, "packages", "core", "x.ts"), "export const x = 2;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "decoy-base"]);
  const decoyBase = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "README.md"), "prose cover\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "active-head"]);
  const activeHead = git(repo, ["rev-parse", "HEAD"]);

  git(repo, ["replace", baseSha, decoyBase]);
  equal(git(repo, ["diff", "--name-only", baseSha, activeHead]), "README.md");
  equal(runClassify(activeHead, false), "full=true\nreason=full: packages/core/x.ts\n");
  equal(runClassify(activeHead, true), "full=true\nreason=full: packages/core/x.ts\n");
});

// No-skips guard, test-group resolver, and LCOV coverage merger for CI (guard-rail G5, docs/guardrails.md).
//
//   node tools/no-skips/run.mjs [--root <dir>] [--lcov <file>] [--group <name> | <file or glob>...]
//   node tools/no-skips/run.mjs [--root <dir>] --verify-groups
//   node tools/no-skips/run.mjs --merge-lcov <out.info> [--lines <pct>] [--branches <pct>] <in.info>...
//
// Runs `node --test` over the given patterns (default `packages/*/test/*.test.ts`) or named `--group`
// in `root` (default: this repository) with `spec` to stdout and `tap` to a temp file, failing if any
// test failed, skipped, or was left as a todo. When `--lcov <file>` is given, enables V8 test coverage
// and writes the shard's LCOV report to `<file>`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

const TOOL = "tools/no-skips/run.mjs";
const DEFAULT_PATTERNS = ["packages/*/test/*.test.ts"];
const DEFAULT_LINES_THRESHOLD = 91;
const DEFAULT_BRANCHES_THRESHOLD = 81;

export const GROUPS = Object.freeze([
  "core-formats",
  "core-script",
  "core-engine",
  "core-battle",
  "synth",
  "plugin-tk2-compat",
  "render-webgl2",
  "runner-harness",
  "runner-headless",
  "runner-desktop",
  "runner-mobile",
  "runner-web",
  "script-tools",
  "script-cli",
  "lsp",
  "script-spec",
]);

const CORE_FORMATS_FILE = /^(?:format-|audio-|canon\.|contracts\.|fmath|lint-rules\.|rng\.|save-migration\.|validate\.)/;
const CORE_SCRIPT_FILE = /^(?:script-|step-budget-spike\.|program-call-vm\.|events-|actor|stock-|media-objects\.|menu-state\.)/;
const CORE_BATTLE_FILE = /^battle-.*\.test\.ts$/;

const SUMMARY = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/;
const SKIP_OR_TODO = /^\s*(?:not )?ok \d+ - (.*?)\s+#\s+(SKIP|TODO)\b\s*(.*?)\s*$/;

/**
 * Reads the counts and the skipped names from TAP text. `tests`, `pass`, `fail`,
 * `cancelled`, `skipped` and `todo` come from the summary lines; `skippedNames`
 * holds `{ name, reason }` for every `# SKIP` or `# TODO` line (they may be
 * indented, for subtests).
 */
export function parseTap(text) {
  const counts = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, skippedNames: [] };
  for (const line of text.split(/\r?\n/)) {
    const summary = SUMMARY.exec(line);
    if (summary !== null) {
      counts[summary[1]] = Number(summary[2]);
      continue;
    }
    const marked = SKIP_OR_TODO.exec(line);
    if (marked !== null) counts.skippedNames.push({ name: marked[1], reason: marked[3] });
  }
  return counts;
}

/**
 * How many tests the run skipped or left as todo: the larger of the summary
 * count and the number of marked lines, so a change in either part of the TAP
 * text cannot hide one.
 */
export const markedCount = (counts) => Math.max(counts.skipped + counts.todo, counts.skippedNames.length);

function listPackageTestFiles(rootPath, pkgName) {
  const testDir = join(rootPath, "packages", pkgName, "test");
  if (!existsSync(testDir)) return [];
  return readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Resolves a named CI test group to its sorted list of relative test file paths
 * (`packages/<pkg>/test/<file>.test.ts`). `core` is partitioned into four
 * exhaustive groups (`core-formats`, `core-script`, `core-engine`, and
 * `core-battle`); each other workspace package has its own group.
 */
export function resolveGroup(root, group) {
  if (!GROUPS.includes(group)) {
    throw new Error(`unknown group "${group}" (expected one of: ${GROUPS.join(", ")})`);
  }
  const rootPath = resolve(root);
  if (group === "core-formats" || group === "core-script" || group === "core-engine" || group === "core-battle") {
    const files = listPackageTestFiles(rootPath, "core");
    const matched = files.filter((name) => {
      const inFormats = CORE_FORMATS_FILE.test(name);
      if (group === "core-formats") return inFormats;
      const inScript = !inFormats && CORE_SCRIPT_FILE.test(name);
      if (group === "core-script") return inScript;
      const inBattle = !inFormats && !inScript && CORE_BATTLE_FILE.test(name);
      if (group === "core-battle") return inBattle;
      return !inFormats && !inScript && !inBattle;
    });
    return matched.map((name) => posix.join("packages", "core", "test", name));
  }
  return listPackageTestFiles(rootPath, group).map((name) => posix.join("packages", group, "test", name));
}

/**
 * Verifies that `GROUPS` partitions all `packages/*\/test/*.test.ts` files in `root`
 * with no empty groups, no missing files, and no duplicates.
 */
export function verifyGroups(root) {
  const rootPath = resolve(root);
  const packagesDir = join(rootPath, "packages");
  const allPackages = existsSync(packagesDir)
    ? readdirSync(packagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const allFiles = allPackages.flatMap((pkg) =>
    listPackageTestFiles(rootPath, pkg).map((name) => posix.join("packages", pkg, "test", name)),
  );
  const assignedCount = new Map();
  const emptyGroups = [];
  const byGroup = {};
  for (const group of GROUPS) {
    const files = resolveGroup(rootPath, group);
    byGroup[group] = files;
    if (files.length === 0) emptyGroups.push(group);
    for (const file of files) {
      assignedCount.set(file, (assignedCount.get(file) ?? 0) + 1);
    }
  }
  const missing = allFiles.filter((file) => !assignedCount.has(file));
  const duplicates = [...assignedCount.entries()].filter(([, count]) => count > 1).map(([file]) => file);
  const ok = allFiles.length > 0 && emptyGroups.length === 0 && missing.length === 0 && duplicates.length === 0;
  return { ok, total: allFiles.length, byGroup, emptyGroups, missing, duplicates };
}

/**
 * Merges multiple LCOV texts into a single deterministic LCOV report and computes
 * aggregate line, branch, and function coverage totals.
 */
export function mergeLcov(texts) {
  const files = new Map();
  for (const text of texts) {
    let current = null;
    let currentBrda = new Map();
    let currentDa = new Map();
    let fnOrder = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("SF:")) {
        const sf = line.slice(3);
        current = files.get(sf);
        if (!current) {
          current = { sf, fns: new Map(), shards: [], da: new Map() };
          files.set(sf, current);
        }
        currentBrda = new Map();
        currentDa = new Map();
        fnOrder = [];
      } else if (current !== null && line.startsWith("FN:")) {
        const comma = line.indexOf(",");
        const ln = Number(line.slice(3, comma));
        const name = line.slice(comma + 1);
        const key = `${ln}\0${name}`;
        fnOrder.push(key);
        if (!current.fns.has(key)) current.fns.set(key, { line: ln, name, count: 0 });
      } else if (current !== null && line.startsWith("FNDA:")) {
        const comma = line.indexOf(",");
        const count = Number(line.slice(5, comma));
        const name = line.slice(comma + 1);
        const key = fnOrder.shift() ?? `0\0${name}`;
        const entry = current.fns.get(key);
        if (entry !== undefined) entry.count += count;
      } else if (current !== null && line.startsWith("BRDA:")) {
        const parts = line.slice(5).split(",");
        const ln = Number(parts[0]);
        const count = parts[3] === "-" ? 0 : Number(parts[3]);
        const list = currentBrda.get(ln) ?? [];
        list.push(count);
        currentBrda.set(ln, list);
      } else if (current !== null && line.startsWith("DA:")) {
        const comma = line.indexOf(",");
        const ln = Number(line.slice(3, comma));
        const count = Number(line.slice(comma + 1));
        currentDa.set(ln, count);
        current.da.set(ln, (current.da.get(ln) ?? 0) + count);
      } else if (current !== null && line === "end_of_record") {
        current.shards.push({ brda: currentBrda, da: currentDa });
        current = null;
      }
    }
  }

  let lf = 0;
  let lh = 0;
  let brf = 0;
  let brh = 0;
  let fnf = 0;
  let fnh = 0;
  const outLines = [];

  const sortedFiles = [...files.values()].sort((a, b) => a.sf.localeCompare(b.sf));
  for (const file of sortedFiles) {
    outLines.push("TN:", `SF:${file.sf}`);
    const fnEntries = [...file.fns.values()].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
    for (const fn of fnEntries) outLines.push(`FN:${fn.line},${fn.name}`);
    let fileFnh = 0;
    for (const fn of fnEntries) {
      outLines.push(`FNDA:${fn.count},${fn.name}`);
      if (fn.count > 0) fileFnh += 1;
    }
    fnf += fnEntries.length;
    fnh += fileFnh;
    outLines.push(`FNF:${fnEntries.length}`, `FNH:${fileFnh}`);

    const brLineSet = new Set();
    for (const shard of file.shards) {
      for (const ln of shard.brda.keys()) brLineSet.add(ln);
    }
    const brLines = [...brLineSet].sort((a, b) => a - b);
    let blockId = 0;
    let fileBrf = 0;
    let fileBrh = 0;
    for (const ln of brLines) {
      let counts = null;
      let minZerosWhenExecuted = Infinity;
      let maxDaWhenMinZeros = 0;
      for (const shard of file.shards) {
        const arr = shard.brda.get(ln);
        const da = shard.da.get(ln) ?? 0;
        if (da > 0) {
          // V8 never collapses an untaken (count=0) branch into an executed (DA>0) parent range,
          // whereas taken branches whose count equals the parent range are collapsed by V8.
          const zeros = (arr ?? []).filter((c) => c === 0).length;
          if (zeros < minZerosWhenExecuted || (zeros === minZerosWhenExecuted && da > maxDaWhenMinZeros)) {
            minZerosWhenExecuted = zeros;
            maxDaWhenMinZeros = da;
          }
        }
        if (arr === undefined) continue;
        if (counts === null) {
          counts = [...arr];
        } else {
          const longer = counts.length >= arr.length ? [...counts] : [...arr];
          const shorter = counts.length >= arr.length ? arr : counts;
          for (let index = 0; index < shorter.length; index += 1) longer[index] += shorter[index];
          counts = longer;
        }
      }
      if (counts !== null) {
        if (minZerosWhenExecuted < Infinity) {
          let currentZeros = counts.filter((c) => c === 0).length;
          for (let index = 0; index < counts.length && currentZeros > minZerosWhenExecuted; index += 1) {
            if (counts[index] === 0) {
              counts[index] = maxDaWhenMinZeros;
              currentZeros -= 1;
            }
          }
        }
        for (const count of counts) {
          outLines.push(`BRDA:${ln},${blockId},0,${count}`);
          blockId += 1;
          fileBrf += 1;
          if (count > 0) fileBrh += 1;
        }
      }
    }
    brf += fileBrf;
    brh += fileBrh;
    outLines.push(`BRF:${fileBrf}`, `BRH:${fileBrh}`);

    const daLines = [...file.da.entries()].sort((a, b) => a[0] - b[0]);
    let fileLh = 0;
    for (const [ln, count] of daLines) {
      outLines.push(`DA:${ln},${count}`);
      if (count > 0) fileLh += 1;
    }
    lf += daLines.length;
    lh += fileLh;
    outLines.push(`LH:${fileLh}`, `LF:${daLines.length}`, "end_of_record");
  }

  const linePct = lf === 0 ? 0 : (lh / lf) * 100;
  const branchPct = brf === 0 ? 0 : (brh / brf) * 100;
  const funcPct = fnf === 0 ? 0 : (fnh / fnf) * 100;
  return {
    text: outLines.length > 0 ? `${outLines.join("\n")}\n` : "",
    totals: { lf, lh, linePct, brf, brh, branchPct, fnf, fnh, funcPct },
  };
}

/**
 * Runs `node --test` over `patterns` in `root` and returns `{ code, counts,
 * status }`: the guard's exit code, the parsed counts, and the runner's exit
 * status. The spec report is written to this process's stdout; nothing else is.
 * `options.env` is the environment the runner starts from (default:
 * `process.env`). When `options.lcov` is set, V8 test coverage is enabled and
 * written to that path.
 */
export function run(root, patterns, options = {}) {
  const rootPath = resolve(root);
  const scratch = mkdtempSync(join(tmpdir(), "no-skips-"));
  const tapFile = join(scratch, "report.tap");
  try {
    const env = { ...(options.env ?? process.env) };
    // A nested `node --test` must not think it is a child of the outer runner.
    delete env.NODE_TEST_CONTEXT;
    const nodeArgs = [];
    if (options.lcov !== undefined) {
      const lcovPath = resolve(rootPath, options.lcov);
      mkdirSync(dirname(lcovPath), { recursive: true });
      nodeArgs.push(
        "--no-warnings=MaxListenersExceededWarning",
        "--experimental-test-coverage",
        "--test-coverage-include=packages/*/src/**",
        "--test-coverage-exclude=**/catalogue-stubs.ts",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovPath}`,
      );
    }
    nodeArgs.push(
      "--test",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=tap",
      `--test-reporter-destination=${tapFile}`,
      ...patterns,
    );
    const result = spawnSync(process.execPath, nodeArgs, {
      cwd: rootPath,
      env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const status = result.status ?? 1;
    let text = "";
    try {
      text = readFileSync(tapFile, "utf8");
    } catch {
      text = "";
    }
    const counts = parseTap(text);
    const code = status !== 0 ? 1 : counts.tests === 0 || markedCount(counts) > 0 ? 1 : 0;
    return { code, counts, status };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------ CLI

function parseArguments(argv) {
  const positional = [];
  const unknown = [];
  let root;
  let group;
  let lcov;
  let verifyGroupsFlag = false;
  let mergeLcovOut;
  let linesThreshold = DEFAULT_LINES_THRESHOLD;
  let branchesThreshold = DEFAULT_BRANCHES_THRESHOLD;

  for (let position = 0; position < argv.length; position += 1) {
    const argument = argv[position];
    if (argument === "--root") {
      const value = argv[position + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--root needs a directory argument");
      if (root !== undefined) throw new Error("--root given more than once");
      root = resolve(value);
      position += 1;
    } else if (argument === "--group") {
      const value = argv[position + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--group needs a group name");
      if (group !== undefined) throw new Error("--group given more than once");
      group = value;
      position += 1;
    } else if (argument === "--lcov") {
      const value = argv[position + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--lcov needs a file path");
      if (lcov !== undefined) throw new Error("--lcov given more than once");
      lcov = value;
      position += 1;
    } else if (argument === "--verify-groups") {
      verifyGroupsFlag = true;
    } else if (argument === "--merge-lcov") {
      const value = argv[position + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--merge-lcov needs an output file path");
      if (mergeLcovOut !== undefined) throw new Error("--merge-lcov given more than once");
      mergeLcovOut = value;
      position += 1;
    } else if (argument === "--lines") {
      const value = argv[position + 1];
      if (value === undefined || Number.isNaN(Number(value))) throw new Error("--lines needs a number");
      linesThreshold = Number(value);
      position += 1;
    } else if (argument === "--branches") {
      const value = argv[position + 1];
      if (value === undefined || Number.isNaN(Number(value))) throw new Error("--branches needs a number");
      branchesThreshold = Number(value);
      position += 1;
    } else if (argument.startsWith("-")) {
      unknown.push(argument);
    } else {
      positional.push(argument);
    }
  }
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(", ")}`);
  if (group !== undefined && positional.length > 0) {
    throw new Error("--group cannot be combined with file patterns");
  }
  const resolvedRoot = root ?? repoRoot;
  return {
    root: resolvedRoot,
    group,
    lcov,
    verifyGroups: verifyGroupsFlag,
    mergeLcovOut,
    linesThreshold,
    branchesThreshold,
    positional,
    patterns: positional.length > 0 ? positional : DEFAULT_PATTERNS,
  };
}

function runVerifyGroups(root) {
  const report = verifyGroups(root);
  if (!report.ok) {
    if (report.total === 0) console.error(`${TOOL}: no package test files found under ${root}`);
    if (report.emptyGroups.length > 0) console.error(`${TOOL}: empty test group(s): ${report.emptyGroups.join(", ")}`);
    if (report.missing.length > 0) console.error(`${TOOL}: unmapped test file(s): ${report.missing.join(", ")}`);
    if (report.duplicates.length > 0) console.error(`${TOOL}: duplicate test file(s): ${report.duplicates.join(", ")}`);
    return 1;
  }
  console.log(`verified ${GROUPS.length} test groups: ${report.total} files`);
  return 0;
}

function runMergeLcov(root, outFile, inputFiles, linesThreshold, branchesThreshold) {
  if (inputFiles.length === 0) {
    console.error(`${TOOL}: --merge-lcov requires at least one input LCOV file`);
    return 1;
  }
  const texts = [];
  for (const file of inputFiles) {
    const resolved = resolve(root, file);
    if (!existsSync(resolved)) {
      console.error(`${TOOL}: missing LCOV input file: ${file}`);
      return 1;
    }
    texts.push(readFileSync(resolved, "utf8"));
  }
  const { text, totals } = mergeLcov(texts);
  if (totals.lf === 0) {
    console.error(`${TOOL}: merged LCOV contains no instrumented lines`);
    return 1;
  }
  const outPath = resolve(root, outFile);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  const lineStr = totals.linePct.toFixed(2);
  const branchStr = totals.branchPct.toFixed(2);
  console.log(
    `merged coverage: lines ${lineStr}% (${totals.lh}/${totals.lf}, min ${linesThreshold}%), branches ${branchStr}% (${totals.brh}/${totals.brf}, min ${branchesThreshold}%)`,
  );
  if (totals.linePct < linesThreshold || totals.branchPct < branchesThreshold) {
    console.error(
      `${TOOL}: coverage below threshold (lines ${lineStr}% < ${linesThreshold}% or branches ${branchStr}% < ${branchesThreshold}%)`,
    );
    return 1;
  }
  return 0;
}

function main(argv) {
  let args;
  try {
    args = parseArguments(argv);
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    return 1;
  }

  if (args.verifyGroups) {
    return runVerifyGroups(args.root);
  }
  if (args.mergeLcovOut !== undefined) {
    return runMergeLcov(args.root, args.mergeLcovOut, args.positional, args.linesThreshold, args.branchesThreshold);
  }

  let patterns = args.patterns;
  if (args.group !== undefined) {
    try {
      patterns = resolveGroup(args.root, args.group);
    } catch (error) {
      console.error(`${TOOL}: ${error.message}`);
      return 1;
    }
    if (patterns.length === 0) {
      console.error(`${TOOL}: group "${args.group}" matched no test files`);
      return 1;
    }
  }

  const { code, counts, status } = run(args.root, patterns, { lcov: args.lcov });
  if (status !== 0) return 1;
  if (counts.tests === 0) {
    console.error(`${TOOL}: no test ran`);
    return 1;
  }
  if (markedCount(counts) > 0) {
    console.error(
      `${TOOL}: ${markedCount(counts)} test(s) skipped or todo; the golden job must run every test`,
    );
    for (const { name, reason } of counts.skippedNames) console.error(`${name}: ${reason}`);
    return 1;
  }
  console.log(`no skipped tests: ${counts.tests} tests, ${counts.pass} passed`);
  return code;
}

/** Whether the module at `moduleUrl` is the script node was started with (symlinks resolved). */
export function isEntryPoint(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Only run when invoked as a script, so the tests can import it.
if (isEntryPoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

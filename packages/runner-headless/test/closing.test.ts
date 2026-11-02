// The closing suite over the fetched sample games (ticket 4.28). `pnpm closing` replays all eight games; this test
// replays the 3.1 `demo` game, the cheapest real one, and audits the committed files for the rest.
import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import { compareRgbaWithPng, parseClosingPlan, runClosingGame, type ClosingBaseline } from "@tk-reawakened/runner-harness";
import { loadGameFiles, runClosing } from "../src/closing.ts";

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const haveLegacy = existsSync(join(repoRoot, "fixtures", "legacy"));
const plan = parseClosingPlan(readFileSync(join(repoRoot, "golden", "closing", "plan.json"), "utf8"));
const baseline: ClosingBaseline = JSON.parse(readFileSync(join(repoRoot, "golden", "regression", "closing.json"), "utf8"));

test("the plan lists both 3.1 games and the six Toolkit 2 games, each with a committed baseline", () => {
  deepEqual(plan.games.map((game) => game.name).sort(), ["Basic", "BusDriver", "Caoquest", "ChimeranEmpire", "FinalDestiny", "LittleMan", "School2Demo", "demo"]);
  deepEqual(Object.keys(baseline.games).sort(), plan.games.map((game) => game.name).sort());
  for (const game of plan.games) {
    const recorded = baseline.games[game.name];
    ok(recorded !== undefined);
    equal(recorded.outcome, game.expect.outcome, `${game.name}: committed outcome is not the planned one`);
    if (game.expect.outcome !== "boots") ok(recorded.diagnostics.length > 0, `${game.name}: an expected failure must carry its located diagnostic`);
    for (const diagnostic of recorded.diagnostics) ok(diagnostic.code !== "" && diagnostic.message !== "", `${game.name}: a diagnostic lacks its code or message`);
  }
});

test("every committed closing PNG exists, is a regression baseline in the ledger and is no independent reference", () => {
  const ledger: { readonly goldens: readonly { readonly path: string; readonly suite?: string; readonly class: string; readonly gating: boolean }[] } = JSON.parse(readFileSync(join(repoRoot, "golden", "ledger.json"), "utf8"));
  const rows = ledger.goldens.filter((row) => row.suite === "closing");
  const frames = Object.values(baseline.games).flatMap((game) => game.frames.flatMap((frame) => (frame.png === undefined ? [] : [frame.png])));
  deepEqual(rows.map((row) => row.path).sort(), [...frames].sort());
  for (const row of rows) {
    equal(row.class, "regression-baseline");
    equal(row.gating, true);
    ok(row.path.startsWith("golden/regression/closing/"));
    ok(existsSync(join(repoRoot, row.path)), `${row.path} is missing`);
  }
});

test("the demo sample game boots through the real engine and matches its committed baseline", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  const demo = plan.games.find((game) => game.name === "demo");
  ok(demo !== undefined);
  const bundled = new Map<string, Uint8Array>();
  for (const folder of plan.bundled) for (const [path, bytes] of loadGameFiles(join(repoRoot, folder))) bundled.set(`${folder}/${path}`, bytes);
  const run = runClosingGame(plan, demo, loadGameFiles(join(repoRoot, "fixtures", "legacy", "demo")), bundled);
  deepEqual(run.batchProblems, []);
  deepEqual(run.record, baseline.games.demo);
  equal(run.record.outcome, "boots");
  equal(run.record.board, "boards/start.brd");
  deepEqual(run.record.diagnostics, []);
  for (const [path, image] of run.images) {
    const comparison = compareRgbaWithPng(image, new Uint8Array(readFileSync(join(repoRoot, path))));
    equal(comparison.error, null);
    equal(comparison.equal, true, `${path}: ${JSON.stringify(comparison.firstDifference)}`);
  }
});

// #1047 (docs/spec/formats/save-game.md#state-hash-request-projection): the saved request-id counter is not hashed, so one
// more settled boot-time request must move no baseline. The perturbation is real, not simulated: every game gets one
// extra, unused program file, which the engine requests and the host answers at boot like any other `Prg/` file (a
// literal second request for the same key is deduplicated by the engine and so cannot be injected from outside). The
// run is traced only to prove the extra request happened. It replays all eight games four times each (three batch sizes
// and the traced run), the smallest run that covers every committed baseline; a faster test would cover fewer of them.
test("one extra settled boot request moves none of the eight closing baselines", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  const bundled = new Map<string, Uint8Array>();
  for (const folder of plan.bundled) for (const [path, bytes] of loadGameFiles(join(repoRoot, folder))) bundled.set(`${folder}/${path}`, bytes);
  const extraName = "zz-extra-boot-request-1047.prg";
  const requested: string[] = [];
  for (const game of plan.games) {
    const files = new Map(loadGameFiles(join(repoRoot, "fixtures", "legacy", game.name)));
    const sample = [...files.keys()].find((path) => /\.prg$/i.test(path));
    const folder = sample === undefined ? "Prg/" : sample.slice(0, sample.lastIndexOf("/") + 1);
    files.set(`${folder}${extraName}`, new TextEncoder().encode("// an unused program: only its boot request matters (#1047)\n"));
    const run = runClosingGame(plan, game, files, bundled, { trace: true });
    deepEqual(run.batchProblems, [], `${game.name}: batching or tracing disagreed`);
    deepEqual(run.record, baseline.games[game.name], `${game.name}: the extra settled request moved its baseline`);
    if (run.census?.bootSequence.some((item) => item.file.toLowerCase().endsWith(extraName)) === true) requested.push(game.name);
  }
  const reachedBoard = plan.games.filter((game) => baseline.games[game.name]?.board !== null).map((game) => game.name);
  deepEqual(requested.filter((name) => reachedBoard.includes(name)).sort(), [...reachedBoard].sort(), "every game that reaches a board really requested the extra program");
});

test("closing reports a missing fixtures directory instead of passing", () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => { errors.push(message); };
  try {
    equal(runClosing([join(repoRoot, "golden")]), 1);
  } finally {
    console.error = original;
  }
  ok(errors[0]?.includes("fixtures directory not found"), errors.join("\n"));
});

test("closing trace rejects missing paths, existing inputs and golden recording before running", () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => { errors.push(message); };
  try {
    equal(runClosing(["--trace"]), 1);
    equal(runClosing(["--trace", join(repoRoot, "package.json")]), 1);
    equal(runClosing(["--trace", "/tmp/never-written-trace-614.json", "--record"]), 1);
  } finally {
    console.error = original;
  }
  ok(errors.some((error) => error.includes("requires one new .json")));
  ok(errors.some((error) => error.includes("already exists")));
  ok(errors.some((error) => error.includes("cannot be combined with --record")));
});

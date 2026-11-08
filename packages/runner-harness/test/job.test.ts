import { deepEqual, equal } from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  Breakpoint,
  DrawList,
  Engine,
  InputRecord,
  TickReport,
  SurfaceId,
  SurfacePixels,
} from "@tk-reawakened/core";
import { goldenJob } from "../src/job.ts";

const VALID_VECTORS = JSON.stringify({
  canon: [
    {
      id: "rfc8785-negative-zero",
      bits: "8000000000000000",
      canonical: "0",
    },
  ],
  fnv1a64: [
    {
      id: "fnv-empty",
      utf8: "",
      hash: "cbf29ce484222325",
    },
  ],
});

const VALID_RUN = JSON.stringify({
  schema: 1,
  ticks: 3,
  log: [
    { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: null, down: true } },
    { tick: 1, event: { kind: "pointer", x: 10, y: 20, buttons: 1 } },
    { tick: 2, event: { kind: "key", name: "A", code: "KeyA", char: null, down: false } },
  ],
});

test("goldenJob records golden when record: true and subsequent compare succeeds", () => {
  const recordOutcome = goldenJob({ vectors: VALID_VECTORS, run: VALID_RUN }, true);

  equal(recordOutcome.ok, true);
  if (!recordOutcome.ok) return;

  equal(typeof recordOutcome.golden, "string");
  deepEqual(recordOutcome.lines, [
    "vectors: 2 rows ok",
    "run: 3 ticks",
    "batching: 1,3,S ok",
    "golden: 3 recorded",
  ]);

  const compareOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: VALID_RUN,
    golden: recordOutcome.golden,
  });

  equal(compareOutcome.ok, true);
  if (!compareOutcome.ok) return;

  deepEqual(compareOutcome.lines, [
    "vectors: 2 rows ok",
    "run: 3 ticks",
    "batching: 1,3,S ok",
    "golden: 3 compared",
  ]);
});

test("goldenJob returns ok: false with failure on last line when golden differs", () => {
  const recordOutcome = goldenJob({ vectors: VALID_VECTORS, run: VALID_RUN }, true);
  equal(recordOutcome.ok, true);
  if (!recordOutcome.ok || !recordOutcome.golden) return;

  const badGolden = recordOutcome.golden.replace(
    /"state":\s*"[0-9a-f]{16}"/,
    '"state": "0000000000000000"',
  );

  const compareOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: VALID_RUN,
    golden: badGolden,
  });

  equal(compareOutcome.ok, false);
  if (compareOutcome.ok) return;

  equal(compareOutcome.lines.length, 4);
  equal(compareOutcome.lines[0], "vectors: 2 rows ok");
  equal(compareOutcome.lines[1], "run: 3 ticks");
  equal(compareOutcome.lines[2], "batching: 1,3,S ok");
  equal(
    compareOutcome.lines[3]!.includes("golden: tick 1: state hash differs"),
    true,
  );
});

test("goldenJob rejects empty log, records, or vector rows without throwing", () => {
  const emptyLogOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: JSON.stringify({ schema: 1, ticks: 3, log: [] }),
  });
  equal(emptyLogOutcome.ok, false);
  if (!emptyLogOutcome.ok) {
    equal(emptyLogOutcome.lines.length, 2);
    equal(emptyLogOutcome.lines[0], "vectors: 2 rows ok");
    equal(emptyLogOutcome.lines[1], "run.json: log is empty");
  }

  const emptyVectorsOutcome = goldenJob({
    vectors: JSON.stringify({ canon: [] }),
    run: VALID_RUN,
  });
  equal(emptyVectorsOutcome.ok, false);
  if (!emptyVectorsOutcome.ok) {
    equal(emptyVectorsOutcome.lines.length, 1);
    equal(emptyVectorsOutcome.lines[0], "hash-vectors.json: zero vector rows");
  }

  const emptyRecordsOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: VALID_RUN,
    golden: JSON.stringify({ schema: 1, records: [] }),
  });
  equal(emptyRecordsOutcome.ok, false);
  if (!emptyRecordsOutcome.ok) {
    equal(emptyRecordsOutcome.lines.length, 4);
    equal(emptyRecordsOutcome.lines[3], "golden.json: records is empty");
  }
});

test("goldenJob handles absent files without throwing", () => {
  const noVectors = goldenJob({});
  equal(noVectors.ok, false);
  if (!noVectors.ok) {
    equal(noVectors.lines[0], "hash-vectors.json is absent");
  }

  const noRun = goldenJob({ vectors: VALID_VECTORS });
  equal(noRun.ok, false);
  if (!noRun.ok) {
    equal(noRun.lines[1], "run.json is absent");
  }

  const noGolden = goldenJob({ vectors: VALID_VECTORS, run: VALID_RUN }, false);
  equal(noGolden.ok, false);
  if (!noGolden.ok) {
    equal(noGolden.lines[3], "golden.json is absent");
  }
});

test("goldenJob detects batching disagreement without throwing", () => {
  const createBatchDependentEngine = (): Engine => {
    let currentTick = 0;
    return {
      advance(ticks: number, inputs: readonly InputRecord[], maxTicks?: number): TickReport {
        currentTick += ticks;
        const stateHash = maxTicks === 3 ? "3333333333333333" : "1111111111111111";
        return {
          ticksRun: ticks,
          tickAfter: currentTick,
          consumed: inputs,
          audioCues: [],
          requests: [],
          diagnostics: [],
          loading: false,
          paused: null,
          stateHash,
        };
      },
      drawList(): DrawList {
        return { tick: currentTick, width: 320, height: 240, commands: [], marginCommands: [] };
      },
      registeredActionNames() { return ["up", "down", "left", "right", "confirm", "cancel", "menu"]; },
      registerGameAction(_action) { return false; },
      setPointerMovementSuppressed(_suppressed) {},
      reportUnknownAction(_action) {},
      customTouchControlsDeclared() { return false; },
      hostFeatures() { return { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null }; },
      hostDisplayGeometry() { return { content: { width: 320, height: 240 }, game: { x: 0, y: 0, width: 320, height: 240 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; },
      surfaceCacheEpoch() { return 0; },
      accessibilityTree() { return []; },
      runnerControlPointerPreemption() { return null; },
      surfacePixels(_id: SurfaceId, _rev: number): SurfacePixels | null {
        return null;
      },
      picturePixels(): SurfacePixels | null { return null; },
      setBreakpoints(_breakpoints: readonly Breakpoint[]): void {},
      recoveryCandidate() { return null; },
      resumeRecovery() { return false; },
      recoveryStatus() { return "none"; },
    };
  };

  const outcome = goldenJob(
    { vectors: VALID_VECTORS, run: VALID_RUN },
    false,
    createBatchDependentEngine,
  );

  equal(outcome.ok, false);
  if (!outcome.ok) {
    equal(outcome.lines.length, 3);
    equal(outcome.lines[0], "vectors: 2 rows ok");
    equal(outcome.lines[1], "run: 3 ticks");
    equal(outcome.lines[2], "batching: tick 3: n=1 and n=3 mismatch");
  }
});
test("goldenJob records and compares scriptsGolden", () => {
  const recordOutcome = goldenJob(
    { vectors: VALID_VECTORS, run: VALID_RUN, scriptsGolden: "" },
    true,
  );
  equal(recordOutcome.ok, true);
  if (!recordOutcome.ok) return;

  equal(typeof recordOutcome.scriptsGolden, "string");
  equal(recordOutcome.lines.some((l) => l.includes("scripts: 27 programs ok")), true);

  const compareOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: VALID_RUN,
    golden: recordOutcome.golden,
    scriptsGolden: recordOutcome.scriptsGolden,
  });
  equal(compareOutcome.ok, true);
  if (!compareOutcome.ok) return;
  equal(compareOutcome.lines.some((l) => l.includes("scripts: 27 programs ok")), true);
});

test("goldenJob fails when scriptsGolden differs or is missing", () => {
  const recordOutcome = goldenJob(
    { vectors: VALID_VECTORS, run: VALID_RUN, scriptsGolden: "" },
    true,
  );
  if (!recordOutcome.ok || !recordOutcome.scriptsGolden) throw new Error("record failed");

  const mutated = recordOutcome.scriptsGolden.replace(
    /"hash":\s*"[0-9a-f]{16}"/,
    '"hash": "0000000000000000"',
  );

  const mismatchOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: VALID_RUN,
    golden: recordOutcome.golden,
    scriptsGolden: mutated,
  });
  equal(mismatchOutcome.ok, false);
  if (!mismatchOutcome.ok) {
    equal(mismatchOutcome.lines.some((l) => l.includes("hash mismatch")), true);
  }

  const missingOutcome = goldenJob({
    vectors: VALID_VECTORS,
    run: VALID_RUN,
    golden: recordOutcome.golden,
    scriptsGolden: "",
  });
  equal(missingOutcome.ok, false);
  if (!missingOutcome.ok) {
    equal(missingOutcome.lines.some((l) => l.includes("golden/scripts/golden.json is absent")), true);
  }
});

test("the repository carries every golden baseline the CLI enforces", () => {
  // The compare-mode guards key on each baseline's directory, so a deleted *directory* must fail somewhere: this
  // test names the three files and the two directories the required golden job reads.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  for (const path of ["golden/scripts/golden.json", "golden/ledger.json", "golden/audio/cues.json"]) {
    equal(existsSync(join(repoRoot, path)), true, `${path} is committed`);
  }
  for (const dir of ["golden/scripts", "golden/scenes"]) {
    equal(existsSync(join(repoRoot, dir)), true, `${dir}/ exists so the missing-file guard applies`);
  }
});

import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  type HostDisplayGeometry,
  type InputRecord,
  type NormalizedHostFeatures,
} from "@tk-reawakened/core";
import { createNullAudio, runLog, type Run, type TickObservation, type TickRecord } from "../src/index.ts";

const INITIAL_GEOMETRY: HostDisplayGeometry = {
  content: { width: 1280, height: 720 },
  game: { x: 160, y: 0, width: 960, height: 720 },
  safeArea: { top: 8, right: 0, bottom: 12, left: 0 },
};
const UPDATED_GEOMETRY: HostDisplayGeometry = {
  content: { width: 1366, height: 768 },
  game: { x: 203, y: 24, width: 960, height: 720 },
  safeArea: { top: 18, right: 12, bottom: 20, left: 12 },
};

type Profile = {
  readonly name: string;
  readonly features: NormalizedHostFeatures;
  readonly activeInput: InputRecord["event"];
  readonly releaseInput: InputRecord["event"];
};

const PROFILES: readonly Profile[] = [
  {
    name: "touch-only",
    features: { touch: true, pointer: "coarse", keyboard: false, gamepad: false, haptics: false, orientation: "portrait" },
    activeInput: { kind: "pointer", x: 16, y: 16, buttons: 1 },
    releaseInput: { kind: "pointer", x: 16, y: 16, buttons: 0 },
  },
  {
    name: "gamepad-only",
    features: { touch: false, pointer: "none", keyboard: false, gamepad: true, haptics: true, orientation: "landscape" },
    activeInput: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 500 }, buttons: 0 },
    releaseInput: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 },
  },
  {
    name: "keyboard-only",
    features: { touch: false, pointer: "none", keyboard: true, gamepad: false, haptics: false, orientation: "landscape" },
    activeInput: { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: true },
    releaseInput: { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: false },
  },
];

function profileUpdate(features: NormalizedHostFeatures): NormalizedHostFeatures {
  return { ...features, haptics: !features.haptics };
}

type InputObservation = {
  readonly tick: number;
  readonly features: NormalizedHostFeatures;
  readonly geometry: HostDisplayGeometry;
  readonly actions: Readonly<Record<string, boolean>>;
  readonly pendingActions: readonly string[];
  readonly pointer: { readonly x: number; readonly y: number; readonly buttons: number; readonly downs: number; readonly ups: number };
  readonly pendingClicks: readonly { readonly x: number; readonly y: number }[];
};

type Replay = {
  readonly records: readonly TickRecord[];
  readonly ticks: readonly TickObservation[];
  readonly observations: readonly InputObservation[];
  readonly consumed: readonly InputRecord[];
};

function replay(
  profile: Profile,
  run: Run,
  batchSize: number,
  initialFeatures: NormalizedHostFeatures = profile.features,
  initialGeometry: HostDisplayGeometry = INITIAL_GEOMETRY,
): Replay {
  const encodedBoard = writeBoard(createEmptyBoard());
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  const observations: InputObservation[] = [];
  const engine = createEngine({
    seed: 0x1354,
    assetIndex: createAssetIndex(["Boards/host-replay.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "host-replay.brd",
    width: 32,
    height: 32,
    maxTicks: run.ticks,
    features: initialFeatures,
    displayGeometry: initialGeometry,
    input: { bindings: { keys: { ArrowDown: "down" } } },
    phaseRegistrations: [{
      phase: "input",
      run: (state) => {
        observations.push({
          tick: state.time.tick,
          features: { ...state.features },
          geometry: {
            content: { ...state.display.geometry.content },
            game: { ...state.display.geometry.game },
            safeArea: { ...state.display.geometry.safeArea },
          },
          actions: { ...state.input.actions },
          pendingActions: [...state.input.pendingActions],
          pointer: { ...state.input.pointer },
          pendingClicks: state.input.pendingClicks.map((click) => ({ ...click })),
        });
      },
    }],
  });

  const boot = engine.advance(0, []);
  const boardRequest = boot.requests.find((request) => request.kind === "asset");
  if (boardRequest?.kind !== "asset") throw new Error("expected headless replay board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: encodedBoard.value } }]);
  equal(loaded.loading, false, "fixture board load completes before replay");
  equal(loaded.diagnostics.length, 0, "fixture board loads without diagnostics");

  const ticks: TickObservation[] = [];
  const records = runLog(engine, run, batchSize, createNullAudio(), (report) => {
    equal(report.diagnostics.length, 0, "headless replay emits no runtime diagnostics");
  }, (observation) => ticks.push(observation));
  const consumed = ticks.flatMap(({ consumed: recordsForTick }) => recordsForTick);
  return { records, ticks, observations, consumed };
}

function profileRun(profile: Profile): Run {
  return {
    schema: 1,
    ticks: 4,
    log: [
      { tick: 1, event: profile.activeInput },
      { tick: 2, event: profile.releaseInput },
      { tick: 2, event: { kind: "host.features", features: profileUpdate(profile.features) } },
      { tick: 3, event: { kind: "host.display", geometry: UPDATED_GEOMETRY } },
    ],
  };
}

function assertInputBehavior(profile: Profile, result: Replay): void {
  const active = result.observations.find(({ tick }) => tick === 1);
  const released = result.observations.find(({ tick }) => tick === 2);
  if (active === undefined || released === undefined) throw new Error(`${profile.name} input phase observations were not captured`);

  if (profile.name === "touch-only") {
    equal(active.pointer.downs, 1, "touch press creates a primary-pointer down edge");
    deepEqual(active.pendingClicks, [{ x: 16, y: 16 }], "touch press creates a gameplay click destination");
    equal(released.pointer.ups, 1, "touch release creates a primary-pointer up edge");
    equal(released.pointer.buttons, 0, "touch release clears the held pointer button");
  } else {
    equal(active.actions.down, true, `${profile.name} drives the down gameplay action`);
    equal(active.pendingActions.includes("down"), true, `${profile.name} queues the down action edge`);
    equal(released.actions.down, false, `${profile.name} releases the down gameplay action`);
  }
}

test("runner-harness headless capability profiles replay the exact consumed input log deterministically", () => {
  for (const profile of PROFILES) {
    const planned = profileRun(profile);
    const first = replay(profile, planned, 1);
    deepEqual(first.consumed, planned.log, `${profile.name} consumes the complete ordered tick-stamped input log`);
    equal(first.ticks.length, planned.ticks, `${profile.name} produces a successful report for every simulation tick`);
    deepEqual(first.ticks.map(({ tickBefore, tickAfter, ticksRun, loading, paused }) => ({ tickBefore, tickAfter, ticksRun, loading, paused })), [
      { tickBefore: 0, tickAfter: 1, ticksRun: 1, loading: false, paused: null },
      { tickBefore: 1, tickAfter: 2, ticksRun: 1, loading: false, paused: null },
      { tickBefore: 2, tickAfter: 3, ticksRun: 1, loading: false, paused: null },
      { tickBefore: 3, tickAfter: 4, ticksRun: 1, loading: false, paused: null },
    ], `${profile.name} advances exactly one tick per report without loading or pauses`);
    deepEqual(first.observations[0]?.features, profile.features, `${profile.name} initial boot capabilities reach core state before updates`);
    deepEqual(first.observations[0]?.geometry, INITIAL_GEOMETRY, `${profile.name} initial boot geometry reaches core state before updates`);
    deepEqual(first.observations[2]?.features, profileUpdate(profile.features), `${profile.name} logged feature update takes effect at tick 2`);
    deepEqual(first.observations[3]?.geometry, UPDATED_GEOMETRY, `${profile.name} logged geometry update takes effect at tick 3`);
    assertInputBehavior(profile, first);

    const replayed = replay(profile, { ...planned, log: first.consumed }, 1);
    deepEqual(replayed.consumed, first.consumed, `${profile.name} replay consumes the first run's exact full log`);
    deepEqual(replayed.records, first.records, `${profile.name} exact-log replay reproduces every per-tick state and draw hash`);

    const batched = replay(profile, { ...planned, log: first.consumed }, 2);
    deepEqual(batched.records.map(({ tick }) => tick), [2, 4], `${profile.name} batches reports on the expected tick boundaries`);
    deepEqual(
      batched.records.map(({ state, draw }) => ({ state, draw })),
      [first.records[1], first.records[3]].map(({ state, draw }) => ({ state, draw })),
      `${profile.name} state and draw hashes are independent of two-tick advance batching`,
    );

    const withoutFeatureUpdate = replay(profile, {
      ...planned,
      log: first.consumed.filter(({ event }) => event.kind !== "host.features"),
    }, 1);
    notEqual(first.records[1]?.state, withoutFeatureUpdate.records[1]?.state, `${profile.name} feature update is hash-significant on its consuming tick`);
    const withoutGeometryUpdate = replay(profile, {
      ...planned,
      log: first.consumed.filter(({ event }) => event.kind !== "host.display"),
    }, 1);
    notEqual(first.records[2]?.state, withoutGeometryUpdate.records[2]?.state, `${profile.name} geometry update is hash-significant on its consuming tick`);

    const sameConsumedLog: Run = { ...planned, log: first.consumed };
    const changedInitialFeatures = { ...profile.features, haptics: !profile.features.haptics };
    const initialFeatureControl = replay(profile, sameConsumedLog, 1, changedInitialFeatures, INITIAL_GEOMETRY);
    notEqual(first.records[0]?.state, initialFeatureControl.records[0]?.state, `${profile.name} hash includes boot features before any logged update`);
    const changedInitialGeometry = { ...INITIAL_GEOMETRY, content: { ...INITIAL_GEOMETRY.content, width: INITIAL_GEOMETRY.content.width + 1 } };
    const initialGeometryControl = replay(profile, sameConsumedLog, 1, profile.features, changedInitialGeometry);
    notEqual(first.records[0]?.state, initialGeometryControl.records[0]?.state, `${profile.name} hash includes boot geometry before any logged update`);
  }
});

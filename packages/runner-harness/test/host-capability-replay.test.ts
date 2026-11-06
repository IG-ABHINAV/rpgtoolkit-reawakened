import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  applyUiEffect,
  hydrateSprites,
  inputPhaseRegistration,
  PACKAGE_ROOT,
  writeBoard,
  type DrawCommand,
  type HostDisplayGeometry,
  type InputRecord,
  type NormalizedHostFeatures,
  type WorldItem,
} from "@tk-reawakened/core";
import { createNullAudio, runLog, type ActiveRun, type TickObservation, type TickRecord } from "../src/index.ts";

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
    activeInput: { kind: "pointer", x: -4, y: 0, buttons: 1 },
    releaseInput: { kind: "pointer", x: -6, y: 0, buttons: 0 },
  },
  {
    name: "gamepad-only",
    features: { touch: false, pointer: "none", keyboard: false, gamepad: true, haptics: true, orientation: "landscape" },
    activeInput: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 13 },
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
  readonly keys: readonly { readonly name: string; readonly action: string | null; readonly target: string | null }[];
  readonly pointer: { readonly x: number; readonly y: number; readonly buttons: number; readonly downs: number; readonly ups: number };
  readonly pendingClicks: readonly { readonly gestureId: number; readonly x: number; readonly y: number }[];
  readonly pendingPointerUps: readonly { readonly gestureId: number; readonly x: number; readonly y: number }[];
  readonly authorClaimed: boolean;
  readonly authorActivationIndex: number | null;
  readonly customTouchControlsDeclared: boolean;
  readonly authorMarginCommands: readonly DrawCommand[];
};

type PostInputObservation = {
  readonly confirmKeys: readonly { readonly name: string; readonly action: string | null; readonly target: string | null }[];
  readonly playerFacing: string | null;
  readonly pathQueued: boolean;
};
type RenderedMarginSnapshot = {
  readonly command: DrawCommand | null;
  readonly dimensions: { readonly w: number; readonly h: number } | null;
  readonly firstPixel: readonly number[] | null;
};

type Replay = {
  readonly records: readonly TickRecord[];
  readonly ticks: readonly TickObservation[];
  readonly observations: readonly InputObservation[];
  readonly consumed: readonly InputRecord[];
  readonly observationsAfterInput: ReadonlyMap<number, number>;
  readonly postInput: ReadonlyMap<number, PostInputObservation>;
  readonly renderedMargins: readonly RenderedMarginSnapshot[];
  readonly marginDrawCounts: readonly number[];
};

function replay(
  profile: Profile,
  run: ActiveRun,
  batchSize: number,
  initialFeatures: NormalizedHostFeatures = profile.features,
  initialGeometry: HostDisplayGeometry = INITIAL_GEOMETRY,
  authorHud = true,
  authorMarginProgram = false,
): Replay {
  const encodedBoard = writeBoard({
    ...createEmptyBoard(),
    sizeX: 10,
    sizeY: 8,
    sizeL: 1,
    tileMatrix: Array.from({ length: 80 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 80, marker: true }],
    layerTitles: ["", ""],
  });
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  const observations: InputObservation[] = [];
  const observationsAfterInput = new Map<number, number>();
  const postInput = new Map<number, PostInputObservation>();
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
    ...(authorMarginProgram
      ? { program: "fillrect(-6, 0, -3, 1)\nthreadSleep(getThreadId(), 60)" }
      : {}),
    phaseRegistrations: [
      {
        phase: "input",
        rank: -2,
        run: (state) => {
          if (profile.name !== "touch-only" || state.time.tick !== 0 || state.world.board == null) return;
          const target: WorldItem = {
            slot: 0, itemFile: "interactable.item", activationPrg: "end()", multitaskPrg: "",
            initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "",
            activate: 0, activationType: 1, x: 72, y: 64, layer: 1, reserved: 0,
          };
          const board = { ...state.world.board, items: [target] };
          state.world = { ...state.world, board };
          state.sprites = hydrateSprites({
            board,
            players: [{ id: "hero", kind: "player", source: "hero.character", x: 60, y: 64, layer: 1, facing: "S", controlled: true }],
          }, state.sprites);
        },
      },
      {
        phase: "input",
        rank: -1,
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
            keys: state.input.keys.map(({ name, action, target }) => ({ name, action, target: target ?? null })),
            pointer: { ...state.input.pointer },
            pendingClicks: state.input.pendingClicks.map((click) => ({ ...click })),
            pendingPointerUps: state.input.pendingPointerUps.map((point) => ({ ...point })),
            authorClaimed: state.ui.surfacePointerClaim !== null,
            authorActivationIndex: state.ui.surfaceActivated?.index ?? null,
            customTouchControlsDeclared: state.ui.customTouchControlsDeclared,
            authorMarginCommands: [...state.ui.authorMarginCommands],
          });
        },
      },
      ...(profile.name === "gamepad-only" ? [] : [inputPhaseRegistration()]),
      {
        phase: "input",
        rank: 1,
        run: (state) => {
          observationsAfterInput.set(state.time.tick, state.input.pendingPointerUps.length);
          const player = state.sprites.players[0];
          postInput.set(state.time.tick, {
            confirmKeys: state.input.keys.filter(({ action }) => action === "confirm").map(({ name, action, target }) => ({ name, action, target: target ?? null })),
            playerFacing: player?.facing ?? null,
            pathQueued: player?.queue.moves.some((move) => move.source === "path") ?? false,
          });
        },
      },
      {
        phase: "animation",
        run: (state) => {
          if (!authorHud || profile.name !== "touch-only") return;
          applyUiEffect(state, "uiBegin", [7, "touch-controls", "surface", -6, 0, 4, 2, 1]);
          applyUiEffect(state, "uiItem", [7, "Move", "move", null, 1, null, "confirm", null, 1]);
          applyUiEffect(state, "uiEnd", [7]);
          if (state.time.tick === 0) applyUiEffect(state, "declareCustomTouchControls", []);
        },
      },
    ],
  });

  const boot = engine.advance(0, []);
  const boardRequest = boot.requests.find((request) => request.kind === "asset");
  if (boardRequest?.kind !== "asset") throw new Error("expected headless replay board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: encodedBoard.value } }]);
  equal(loaded.loading, false, "fixture board load completes before replay");
  equal(loaded.diagnostics.length, 0, "fixture board loads without diagnostics");

  const ticks: TickObservation[] = [];
  const marginDrawCounts: number[] = [];
  const renderedMargins: RenderedMarginSnapshot[] = [];
  const records = runLog(engine, run, batchSize, createNullAudio(), (report) => {
    equal(report.diagnostics.length, 0, "headless replay emits no runtime diagnostics");
  }, (observation) => {
    ticks.push(observation);
    const drawList = engine.drawList();
    marginDrawCounts.push(drawList.marginCommands.length);
    const command = drawList.marginCommands[0] ?? null;
    const pixels = command?.kind === "blit" && "surface" in command.source
      ? engine.surfacePixels(command.source.surface, command.source.rev)
      : null;
    renderedMargins.push({
      command,
      dimensions: pixels === null ? null : { w: pixels.w, h: pixels.h },
      firstPixel: pixels === null ? null : Array.from(pixels.rgba.slice(0, 4)),
    });
  });
  const consumed = ticks.flatMap(({ consumed: recordsForTick }) => recordsForTick);
  return { records, ticks, observations, consumed, observationsAfterInput, postInput, marginDrawCounts, renderedMargins };
}

function profileRun(profile: Profile): ActiveRun {
  return {
    schema: 2,
    ticks: 6,
    log: [
      ...(profile.name === "touch-only" ? [] : [{ tick: 1, event: profile.activeInput }]),
      { tick: 2, event: { kind: "host.features", features: profileUpdate(profile.features) } },
      { tick: 2, event: { kind: "host.display", geometry: UPDATED_GEOMETRY } },
      ...(profile.name === "touch-only" ? [{ tick: 2, event: profile.activeInput }] : []),
      { tick: 3, event: profile.releaseInput },
      ...(profile.name === "touch-only" ? [
        { tick: 3, event: { kind: "pointer" as const, x: 16, y: 16, buttons: 1 } },
        { tick: 3, event: { kind: "pointer" as const, x: 16, y: 16, buttons: 0 } },
        { tick: 4, event: { kind: "pointer" as const, x: 4, y: 28, buttons: 1 } },
        { tick: 5, event: { kind: "pointer" as const, x: 4, y: 28, buttons: 0 } },
      ] : []),
    ],
  };
}

function assertInputBehavior(profile: Profile, result: Replay): void {
  const activeTick = profile.name === "touch-only" ? 2 : 1;
  const active = result.observations.find(({ tick }) => tick === activeTick);
  const released = result.observations.find(({ tick }) => tick === 3);
  if (active === undefined || released === undefined) throw new Error(`${profile.name} input phase observations were not captured`);

  if (profile.name === "touch-only") {
    equal(active.pointer.downs, 1, "touch press creates a primary-pointer down edge");
    equal(active.authorClaimed, true, "Plane 3 author surface claims the primary-pointer sequence");
    equal(active.customTouchControlsDeclared, true, "explicit custom HUD declaration is persisted");
    deepEqual(active.authorMarginCommands, [], "input profile does not fabricate authored margin commands");
    equal(active.pendingClicks.length, 0, "author-owned touch press does not leak into gameplay click input");
    equal(released.pointer.downs, 2, "same-tick gameplay click starts its own pointer sequence");
    equal(released.pointer.ups, 2, "author and gameplay pointer sequences both release across geometry update");
    equal(released.pointer.buttons, 0, "touch releases clear the held pointer button");
    equal(released.authorActivationIndex, 0, "Plane 3 release activates the same author surface item");
    equal(released.pendingActions.filter((action) => action === "confirm").length, 1, "the author HUD emits exactly one confirm edge");
    deepEqual(released.keys.filter(({ action }) => action === "confirm"), [
      { name: "confirm", action: "confirm", target: null },
    ], "the author HUD creates exactly one compatibility confirm-key entry");
    deepEqual(released.pendingClicks, [{ gestureId: 2, x: 64, y: 64 }], "unclaimed Plane 1 click reaches the contextual gameplay consumer through the camera offset");
    equal(released.pendingPointerUps.length, 1, "unclaimed in-plane release queues a contextual activation candidate");
    equal(result.observationsAfterInput.get(3), 0, "input phase consumes the contextual release candidate");
    const contextual = result.postInput.get(3);
    if (contextual === undefined) throw new Error("contextual activation was not observed after the input phase");
    deepEqual(contextual.confirmKeys, [
      { name: "confirm", action: "confirm", target: null },
      { name: "confirm", action: "confirm", target: "item:0" },
    ], "the author button and adjacent-item contextual tap each produce exactly one targeted semantic edge and compatibility key");
    equal(contextual.playerFacing, "E", "contextual activation faces the player toward the adjacent interactable");
    equal(result.postInput.get(4)?.pathQueued, true, "a separate ground tap queues a real player route");
  } else {
    equal(active.actions.down, true, `${profile.name} drives the down gameplay action`);
    equal(active.pendingActions.filter((action) => action === "down").length, 1, `${profile.name} dispatches one down action edge`);
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
      { tickBefore: 4, tickAfter: 5, ticksRun: 1, loading: false, paused: null },
      { tickBefore: 5, tickAfter: 6, ticksRun: 1, loading: false, paused: null },
    ], `${profile.name} advances exactly one tick per report without loading or pauses`);
    deepEqual(first.observations[0]?.features, profile.features, `${profile.name} initial boot capabilities reach core state before updates`);
    deepEqual(first.observations[0]?.geometry, INITIAL_GEOMETRY, `${profile.name} initial boot geometry reaches core state before updates`);
    deepEqual(first.observations[2]?.features, profileUpdate(profile.features), `${profile.name} logged feature update takes effect at tick 2`);
    deepEqual(first.observations[2]?.geometry, UPDATED_GEOMETRY, `${profile.name} logged geometry update takes effect on its consuming tick`);
    assertInputBehavior(profile, first);
    deepEqual(first.marginDrawCounts, Array.from({ length: planned.ticks }, () => profile.name === "touch-only" ? 1 : 0), `${profile.name} Plane 3 author-surface presentation is stable at each tick`);

    const replayed = replay(profile, { ...planned, log: first.consumed }, 1);
    deepEqual(replayed.consumed, first.consumed, `${profile.name} replay consumes the first run's exact full log`);
    deepEqual(replayed.records, first.records, `${profile.name} exact-log replay reproduces every per-tick state and draw hash`);
    deepEqual(replayed.marginDrawCounts, first.marginDrawCounts, `${profile.name} repeated replay preserves Plane 3 output`);

    const batched = replay(profile, { ...planned, log: first.consumed }, 2);
    deepEqual(batched.records.map(({ tick }) => tick), [2, 4, 6], `${profile.name} batches reports on the expected tick boundaries`);
    deepEqual(
      batched.records.map(({ state, draw }) => ({ state, draw })),
      [first.records[1]!, first.records[3]!, first.records[5]!].map(({ state, draw }) => ({ state, draw })),
      `${profile.name} state and draw hashes are independent of two-tick advance batching`,
    );
    deepEqual(
      batched.marginDrawCounts,
      [first.marginDrawCounts[1]!, first.marginDrawCounts[3]!, first.marginDrawCounts[5]!],
      `${profile.name} Plane 3 drawing is stable across two-tick batching`,
    );

    const withoutFeatureUpdate = replay(profile, {
      ...planned,
      log: first.consumed.filter(({ event }) => event.kind !== "host.features"),
    }, 1);
    equal(first.records[1]?.state, withoutFeatureUpdate.records[1]?.state, `${profile.name} feature update does not apply early`);
    equal(first.records[2]?.state === withoutFeatureUpdate.records[2]?.state, false, `${profile.name} feature update is hash-significant on its consuming tick`);
    const withoutGeometryUpdate = replay(profile, {
      ...planned,
      log: first.consumed.filter(({ event }) => event.kind !== "host.display"),
    }, 1);
    equal(first.records[1]?.state, withoutGeometryUpdate.records[1]?.state, `${profile.name} geometry update does not apply early`);
    equal(first.records[2]?.state === withoutGeometryUpdate.records[2]?.state, false, `${profile.name} geometry update is hash-significant on its consuming tick`);

    const sameConsumedLog: ActiveRun = { ...planned, log: first.consumed };
    const changedInitialFeatures = { ...profile.features, haptics: !profile.features.haptics };
    const initialFeatureControl = replay(profile, sameConsumedLog, 1, changedInitialFeatures, INITIAL_GEOMETRY);
    equal(first.records[0]?.state === initialFeatureControl.records[0]?.state, false, `${profile.name} hash includes boot features before any logged update`);
    const changedInitialGeometry = { ...INITIAL_GEOMETRY, content: { ...INITIAL_GEOMETRY.content, width: INITIAL_GEOMETRY.content.width + 1 } };
    const initialGeometryControl = replay(profile, sameConsumedLog, 1, profile.features, changedInitialGeometry);
    equal(first.records[0]?.state === initialGeometryControl.records[0]?.state, false, `${profile.name} hash includes boot geometry before any logged update`);
  }
});

test("active v2 runner-fallback action down and up replay as held, edge, and release", () => {
  const profile = PROFILES[0]!;
  const run: ActiveRun = {
    schema: 2,
    ticks: 3,
    log: [
      { tick: 1, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: null } },
      { tick: 2, event: { kind: "action", action: "confirm", down: false, source: "runner.fallback", modalId: null } },
    ],
  };
  const first = replay(profile, run, 1, profile.features, INITIAL_GEOMETRY, false);
  deepEqual(first.consumed, run.log, "fallback replay consumes the exact tick-stamped action log");
  const held = first.observations.find(({ actions }) => actions.confirm === true);
  const released = first.observations.find(({ actions }) => actions.confirm === false && actions.menu === undefined);
  if (held === undefined || released === undefined) throw new Error("fallback action transitions were not observed");
  equal(held.pendingActions.filter((action) => action === "confirm").length, 1, "fallback down emits exactly one semantic action edge");
  deepEqual(held.keys.filter(({ action }) => action === "confirm"), [
    { name: "confirm", action: "confirm", target: null },
  ], "fallback down emits exactly one compatibility confirm-key entry");
  equal(released.actions.confirm, false, "fallback up removes the held action source");
  equal(held.customTouchControlsDeclared, false, "fallback stays enabled without an explicit custom-control declaration");

  const repeated = replay(profile, { ...run, log: first.consumed }, 1, profile.features, INITIAL_GEOMETRY, false);
  deepEqual(repeated.consumed, first.consumed, "fallback replay reuses the exact consumed log");
  deepEqual(repeated.records, first.records, "fallback down/up state hashes reproduce deterministically");
});

test("live RPGCode margin primitive is drawn into Plane 3 across a host geometry update", () => {
  const run: ActiveRun = {
    schema: 2,
    ticks: 4,
    log: [{ tick: 2, event: { kind: "host.display", geometry: UPDATED_GEOMETRY } }],
  };
  const profile = PROFILES[0]!;
  const first = replay(profile, run, 1, profile.features, INITIAL_GEOMETRY, false, true);
  deepEqual(first.consumed, run.log, "authored margin run consumes the exact logged geometry update");
  const authoredRect: DrawCommand = {
    kind: "rect", rect: { x: -6, y: 0, w: 4, h: 2 }, rgb: { r: 255, g: 255, b: 255 }, filled: true,
  };
  deepEqual(first.observations.slice(1).map(({ authorMarginCommands }) => authorMarginCommands), Array.from({ length: 3 }, () => [authoredRect]), "the running blocking author program emits the exact filled rectangle after start and across resize");
  deepEqual(first.observations[2]?.geometry, UPDATED_GEOMETRY, "authored drawing observes the logged geometry update at its consuming tick");
  deepEqual(first.marginDrawCounts, Array.from({ length: 4 }, () => 1), "the authored primitive, not a focus decoration, is the only margin draw");
  for (const [index, rendered] of first.renderedMargins.entries()) {
    if (rendered.command?.kind !== "blit") throw new Error(`authored margin draw ${index} was not emitted as a Plane 3 blit`);
    const geometry = index < 2 ? INITIAL_GEOMETRY : UPDATED_GEOMETRY;
    const scaleX = geometry.game.width / 32;
    const left = Math.floor(Math.max(0, geometry.game.x - geometry.safeArea.left) / scaleX);
    const right = Math.floor(Math.max(0, geometry.content.width - geometry.safeArea.right - geometry.game.x - geometry.game.width) / scaleX);
    deepEqual(rendered.dimensions, { w: 32 + left + right, h: 32 }, `authored margin draw ${index} uses resized safe-area geometry`);
    const scaleY = geometry.game.height / 32;
    const top = Math.floor(Math.max(0, geometry.game.y - geometry.safeArea.top) / scaleY);
    deepEqual(rendered.command.dst, { x: -left, y: -top, w: 32 + left + right, h: 32 }, `authored margin draw ${index} has the expected physical offset and extent`);
    deepEqual(rendered.firstPixel, [255, 255, 255, 255], `authored filled primitive ${index} rasterizes its margin pixel`);
  }
  const repeated = replay(profile, { ...run, log: first.consumed }, 1, profile.features, INITIAL_GEOMETRY, false, true);
  deepEqual(repeated.consumed, first.consumed, "author draw replay reuses the exact consumed log");
  deepEqual(repeated.records, first.records, "author draw replay retains deterministic per-tick hashes");
});

import { deepEqual, equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { assetKey, createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine, IR_VERSION, PACKAGE_ROOT, startThread, writeBoard, writeMainFile } from "../src/index.ts";
import type { GameState, InputRecord } from "../src/index.ts";
import type { HostFeatures } from "../src/ports/host.ts";
import { validateInputEvent } from "../src/validate/input-event.ts";
import { hashGameState } from "../src/save/hash.ts";
import { createGameState } from "../src/save/state.ts";
import { restoreGameState, snapshot } from "../src/save/snapshot.ts";
const geometry = {
  content: { width: 1280, height: 720 },
  game: { x: 160, y: 0, width: 960, height: 720 },
  safeArea: { top: 8, right: 0, bottom: 12, left: 0 },
} as const;

test("host features and display geometry normalize, snapshot, restore, and affect state hashes", () => {
  const initialFeatures: HostFeatures & { readonly ignored: string } = {
    touch: true, pointer: "coarse", orientation: "landscape", ignored: "host-only",
  };
  const state = createGameState({
    seed: 12,
    width: 320,
    height: 240,
    features: initialFeatures,
    displayGeometry: geometry,
  });
  deepEqual(state.features, {
    touch: true,
    pointer: "coarse",
    keyboard: false,
    gamepad: false,
    haptics: false,
    orientation: "landscape",
  });
  deepEqual(state.display.geometry, geometry);
  const originalHash = hashGameState(state);
  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.features, state.features);
  deepEqual(restored.display, state.display);
  equal(hashGameState(restored), originalHash);

  state.features = { ...state.features, gamepad: true };
  ok(hashGameState(state) !== originalHash);
  const featuresHash = hashGameState(state);
  state.display = { geometry: { ...state.display.geometry, game: { ...state.display.geometry.game, x: 200 } } };
  ok(hashGameState(state) !== featuresHash);
});

test("pre-host-state snapshots migrate both sections to logical viewport defaults", () => {
  const old = JSON.parse(snapshot(createGameState({ seed: 4, width: 640, height: 360 }))) as {
    features?: unknown;
    display?: unknown;
    schema: Record<string, unknown>;
  };
  delete old.features;
  delete old.display;
  delete old.schema.features;
  delete old.schema.display;

  const restored = restoreGameState(JSON.stringify(old), [], { logicalWidth: 640, logicalHeight: 360 });
  deepEqual(restored.features, {
    touch: false,
    pointer: "none",
    keyboard: false,
    gamepad: false,
    haptics: false,
    orientation: null,
  });
  deepEqual(restored.display.geometry, {
    content: { width: 640, height: 360 },
    game: { x: 0, y: 0, width: 640, height: 360 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const standalone = restoreGameState(JSON.stringify(old));
  deepEqual(standalone.display.geometry, {
    content: { width: 320, height: 240 },
    game: { x: 0, y: 0, width: 320, height: 240 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  equal(restoreGameState(snapshot(restored)).schema.display, restored.schema.display);
});

test("host changes are exact validated AD-14 records and geometry rejects invalid bounds", () => {
  const features = { touch: false, pointer: "none", keyboard: true, gamepad: true, haptics: false, orientation: null } as const;
  equal(validateInputEvent({ kind: "host.features", features }).ok, true);
  equal(validateInputEvent({ kind: "host.features", features: { gamepad: true } }).ok, false);
  equal(validateInputEvent({ kind: "host.display", geometry }).ok, true);
  equal(validateInputEvent({ kind: "host.display", geometry: { ...geometry, game: { ...geometry.game, x: 400 } } }).ok, false);
  equal(validateInputEvent({ kind: "host.features", features: undefined }).ok, false);
});
test("engine applies and records complete host updates on their consuming tick", () => {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  const observed: { current: { readonly features: GameState["features"]; readonly geometry: GameState["display"]["geometry"] } | null } = { current: null };
  const live: { state: GameState | null } = { state: null };
  let inputEdges: string[] = [];
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/host.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "host.brd",
    width: 32,
    height: 32,
    maxTicks: 10,
    phaseRegistrations: [
      { phase: "input", run: (state) => { inputEdges = [...state.input.pendingActions]; } },
      { phase: "movement", run: (state) => { live.state = state; observed.current = { features: state.features, geometry: state.display.geometry }; } },
    ],
  });
  const initial = engine.advance(0, []);
  const boardRequest = initial.requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected host fixture board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: encoded.value } }]);

  const features = { touch: true, pointer: "coarse", keyboard: false, gamepad: true, haptics: false, orientation: "landscape" } as const;
  const changed = engine.advance(1, [
    { tick: 0, event: { kind: "host.features", features } },
    { tick: 0, event: { kind: "host.display", geometry } },
    { tick: 0, event: { kind: "host.gamepads", devices: [{ device: 0, axes: { x: 1000, y: 0 }, buttons: 0 }] } },
  ]);
  equal(changed.ticksRun, 1);
  deepEqual(changed.consumed.map((input) => input.event.kind), ["host.features", "host.display", "host.gamepads"]);
  deepEqual(observed.current?.features, features);
  deepEqual(observed.current?.geometry, geometry);
  const ordered = engine.advance(1, [
    { tick: 1, event: { kind: "key", name: "LEFT", code: "ArrowLeft", char: null, down: true } },
    { tick: 1, event: { kind: "host.features", features } },
  ]);
  deepEqual(ordered.consumed.map((input) => input.event.kind), ["key", "host.features"]);
  if (live.state === null) throw new Error("expected a live state");
  const focusedFeatures = { ...features, gamepad: false };
  const blur = engine.advance(0, [
    { tick: ordered.tickAfter, event: { kind: "host.features", features: focusedFeatures } },
    { tick: ordered.tickAfter, event: { kind: "focus", state: "lost" } },
  ]);
  deepEqual(blur.consumed.map((input) => input.event.kind), ["host.features", "focus"]);
  deepEqual(live.state.features, focusedFeatures);
  engine.advance(0, [{ tick: ordered.tickAfter, event: { kind: "focus", state: "gained" } }]);
  const reverseBlur = engine.advance(0, [
    { tick: ordered.tickAfter, event: { kind: "focus", state: "lost" } },
    { tick: ordered.tickAfter, event: { kind: "host.features", features } },
    { tick: ordered.tickAfter, event: { kind: "host.display", geometry } },
  ]);
  deepEqual(reverseBlur.consumed.map((input) => input.event.kind), ["focus", "host.features", "host.display"]);
  deepEqual(live.state.features, features);
  engine.advance(0, [{ tick: ordered.tickAfter, event: { kind: "focus", state: "gained" } }]);
  equal(engine.registerGameAction({
    name: "game.fireball",
    label: "Fireball",
    icon: null,
    group: null,
    controls: ["pad:0"],
    locked: false,
    hidden: false,
  }), true);
  engine.advance(1, [{
    tick: live.state.time.tick,
    event: { kind: "host.gamepads", devices: [{ device: 0, axes: { x: 1000, y: 0 }, buttons: 1 }] },
  }]);
  equal(live.state.input.actions["game.fireball"], true, "the package action is held by a real mapped pad button");
  live.state.vm.globals["resetSentinel"] = 7;
  startThread(live.state.vm, { ref: { kind: "inline", text: "reset()\nend()", ir: IR_VERSION }, kind: "persistent", owner: "script" });
  engine.advance(1, []);
  equal(live.state.vm.globals["resetSentinel"], undefined, "the reset actually ran");
  deepEqual(live.state.features, features, "reset keeps the current host features");
  deepEqual(live.state.display.geometry, geometry, "reset keeps the current display geometry");
  equal(live.state.input.gamepads["0"]?.connected, true, "reset preserves the latest logged physical controller connection");
  equal(live.state.input.actions.right, true, "reset restores the held controller action");
  equal(live.state.input.actions["game.fireball"], true, "reset re-registers package actions before recomputing held inputs");
  engine.advance(1, [{ tick: live.state.time.tick, event: { kind: "host.gamepads", devices: [] } }]);
  equal(live.state.input.gamepads["0"]?.connected, false, "an omitted physical device releases the restored saved sample");
  equal(live.state.input.actions.right, false, "a disconnected saved direction cannot remain held");
  engine.advance(1, [{ tick: live.state.time.tick, event: { kind: "host.gamepads", devices: [{ device: 0, axes: { x: 1000, y: 0 }, buttons: 0 }] } }]);
  equal(live.state.input.actions.right, true, "a currently held physical direction is applied from the live snapshot");
  engine.advance(1, [{ tick: live.state.time.tick, event: { kind: "host.gamepads", devices: [] } }]);
  equal(live.state.input.actions.right, false, "the initial device disconnect is consumed");
  live.state.input.pendingActions = [];
  inputEdges = [];
  const orderedSnapshot = engine.advance(1, [
    { tick: live.state.time.tick, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 1000, y: 0 }, buttons: 0 } },
    { tick: live.state.time.tick, event: { kind: "host.gamepads", devices: [] } },
  ]);
  deepEqual(orderedSnapshot.consumed.map((input) => input.event.kind), ["gamepad", "host.gamepads"]);
  equal(live.state.input.actions.right, false, "the complete snapshot disconnect is applied after the same-tick press");
  ok(inputEdges.includes("right"), "the press edge is preserved before the snapshot's disconnect");
  const orderedBlur = engine.advance(1, [
    { tick: live.state.time.tick, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 1000, y: 0 }, buttons: 0 } },
    { tick: live.state.time.tick, event: { kind: "host.gamepads", devices: [] } },
    { tick: live.state.time.tick, event: { kind: "focus", state: "lost" } },
  ]);
  equal(orderedBlur.ticksRun, 0, "focus loss stops the tick after consuming its ordered input prefix");
  deepEqual(orderedBlur.consumed.map((input) => input.event.kind), ["gamepad", "host.gamepads", "focus"]);
  const refocus = engine.advance(1, [{ tick: live.state.time.tick, event: { kind: "focus", state: "gained" } }]);
  equal(refocus.ticksRun, 1);
  equal(live.state.input.gamepads["0"]?.connected, false, "the empty snapshot after a deferred press is not overtaken by blur");
  equal(live.state.input.actions.right, false, "refocusing cannot apply the superseded controller press as a ghost hold");
  engine.advance(0, [{ tick: live.state.time.tick, event: { kind: "focus", state: "lost" } }]);
  const resumedWithPrefix = engine.advance(1, [
    { tick: live.state.time.tick, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 1000, y: 0 }, buttons: 0 } },
    { tick: live.state.time.tick, event: { kind: "host.gamepads", devices: [] } },
    { tick: live.state.time.tick, event: { kind: "focus", state: "gained" } },
  ]);
  equal(resumedWithPrefix.ticksRun, 1, "focus gain opens the consumer for the ordered queued prefix");
  equal(live.state.input.gamepads["0"]?.connected, false);
  equal(live.state.input.actions.right, false, "queued controller input remains ordered with focus gain");
});

test("validated boundary gamepad records drive real engine input and snapshot reconciliation", () => {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  const live: { state: GameState | null } = { state: null };
  const engine = createEngine({
    seed: 19, assetIndex: createAssetIndex(["Boards/host.brd"]), assetRoot: PACKAGE_ROOT,
    initialBoard: "host.brd", width: 32, height: 32, maxTicks: 10,
    phaseRegistrations: [{ phase: "movement", run: (state) => { live.state = state; } }],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encoded.value } }]);
  const sample = { device: 3, axes: { x: 1000, y: -1000 }, buttons: 0 };
  const input = validateInputEvent(JSON.parse(JSON.stringify({ kind: "gamepad", connected: true, ...sample })));
  if (!input.ok) throw new Error(input.message);
  engine.advance(1, [{ tick: 0, event: input.value }]);
  if (live.state === null) throw new Error("expected live state");
  equal(live.state.input.actions.right, true);
  equal(live.state.input.actions.up, true);
  const snapshot = validateInputEvent(JSON.parse(JSON.stringify({
    kind: "host.gamepads", devices: [{ ...sample, axes: { x: -1000, y: 1000 } }],
  })));
  if (!snapshot.ok) throw new Error(snapshot.message);
  engine.advance(1, [{ tick: 1, event: snapshot.value }]);
  equal(live.state.input.actions.right, false);
  equal(live.state.input.actions.up, false);
  equal(live.state.input.actions.left, true);
  equal(live.state.input.actions.down, true);
  const ordered = validateInputEvent(JSON.parse(JSON.stringify({
    kind: "host.gamepads",
    devices: [
      { device: 0, axes: { x: 1000, y: 0 }, buttons: 0 },
      { device: 3, axes: { x: 0, y: -1000 }, buttons: 0 },
    ],
  })));
  if (!ordered.ok) throw new Error(ordered.message);
  const accepted = engine.advance(1, [{ tick: 2, event: ordered.value }]);
  equal(accepted.consumed[0]?.event.kind, "host.gamepads");
  equal(live.state.input.actions.right, true);
  equal(live.state.input.actions.up, true);
  equal(live.state.input.actions.left, false);
  const inverted = validateInputEvent({ kind: "host.gamepads", devices: [
    { device: 3, axes: { x: 0, y: 0 }, buttons: 0 },
    { device: 0, axes: { x: 0, y: 0 }, buttons: 0 },
  ] });
  equal(inverted.ok, false, "the boundary refuses an inverted snapshot before engine delivery");
});
test("delayed replacement MainFile re-registers external actions before recomputing held gamepad state", () => {
  const encodeMain = (startupPrg: string) => {
    const result = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, initBoard: "start.brd", startupPrg });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const encodedBoard = writeBoard(createEmptyBoard());
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  const files = new Map([
    [assetKey("main.gam"), encodeMain("start.prg")],
    [assetKey("replacement.gam"), encodeMain("")],
    [assetKey("boards/start.brd"), encodedBoard.value],
    [assetKey("prg/start.prg"), new TextEncoder().encode('mainFile("replacement.gam")\nend()\n')],
  ]);
  const latest: { state: GameState | null } = { state: null };
  const engine = createEngine({
    seed: 29,
    assetIndex: createAssetIndex([...files.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "delayed-mainfile-gamepad-registration",
    width: 32,
    height: 32,
    maxTicks: 20,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "events", run: (state) => { latest.state = state; } }],
  });
  equal(engine.registerGameAction({
    name: "game.fireball",
    label: "Fireball",
    icon: null,
    group: null,
    controls: ["pad:0"],
    locked: false,
    hidden: false,
  }), true);
  const initial = engine.advance(0, []);
  const mainRequest = initial.requests.find((request) => request.kind === "asset");
  if (mainRequest?.kind !== "asset") throw new Error("expected the delayed initial MainFile request");
  let replies: InputRecord[] = [{
    tick: initial.tickAfter,
    event: { kind: "asset", reqId: mainRequest.reqId, bytes: files.get(mainRequest.key) ?? null },
  }];
  let queuedPad = false;
  const replacementKey = assetKey("replacement.gam");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    const current = latest.state;
    if (current?.engine.boot?.main === replacementKey && current.engine.boot?.stage === "running") {
      equal(queuedPad, true, "the physical controller sample preceded the delayed mainfile replacement");
      equal(current.input.gamepads["0"]?.mask, 1, "the held physical controller survived the replacement boot");
      equal(current.input.actions["game.fireball"], true, "the re-registered external action observes the held control without a new hardware edge");
      return;
    }
    for (const request of report.requests) {
      if (request.kind !== "asset") continue;
      replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
      if (request.key === assetKey("prg/start.prg") && !queuedPad) {
        replies.push({ tick: report.tickAfter, event: { kind: "host.gamepads", devices: [{ device: 0, axes: { x: 0, y: 0 }, buttons: 1 }] } });
        queuedPad = true;
      }
    }
  }
  throw new Error(`replacement MainFile did not reach running state: ${JSON.stringify(latest.state?.engine.boot)}`);
});


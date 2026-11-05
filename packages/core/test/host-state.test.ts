import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createAssetIndex, createEmptyBoard, createEngine, IR_VERSION, PACKAGE_ROOT, startThread, writeBoard, type GameState } from "../src/index.ts";
import type { HostFeatures } from "../src/ports/host.ts";
import { validateInputEvent } from "../src/validate/input-event.ts";
import { hashGameState } from "../src/save/hash.ts";
import { createGameState } from "../src/save/state.ts";
import { restoreGameState, snapshot } from "../src/save/snapshot.ts";
import type { InputRecord } from "../src/ports/input.ts";
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
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/host.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "host.brd",
    width: 32,
    height: 32,
    maxTicks: 4,
    phaseRegistrations: [{ phase: "movement", run: (state) => { live.state = state; observed.current = { features: state.features, geometry: state.display.geometry }; } }],
  });
  const initial = engine.advance(0, []);
  const boardRequest = initial.requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected host fixture board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: encoded.value } }]);

  const features = { touch: true, pointer: "coarse", keyboard: false, gamepad: true, haptics: false, orientation: "landscape" } as const;
  const changed = engine.advance(1, [
    { tick: 0, event: { kind: "host.features", features } },
    { tick: 0, event: { kind: "host.display", geometry } },
  ]);
  equal(changed.ticksRun, 1);
  deepEqual(changed.consumed.map((input) => input.event.kind), ["host.features", "host.display"]);
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
  live.state.vm.globals["resetSentinel"] = 7;
  startThread(live.state.vm, { ref: { kind: "inline", text: "reset()\nend()", ir: IR_VERSION }, kind: "persistent", owner: "script" });
  engine.advance(1, []);
  equal(live.state.vm.globals["resetSentinel"], undefined, "the reset actually ran");
  deepEqual(live.state.features, features, "reset keeps the current host features");
  deepEqual(live.state.display.geometry, geometry, "reset keeps the current display geometry");
});

test("capability-profile replays preserve per-tick hashes and consume logged host updates", () => {
  const profiles = [
    {
      name: "touch-only",
      features: { touch: true, pointer: "coarse", keyboard: false, gamepad: false, haptics: false, orientation: "portrait" },
      input: { kind: "pointer", x: 16, y: 16, buttons: 1 },
    },
    {
      name: "gamepad-only",
      features: { touch: false, pointer: "none", keyboard: false, gamepad: true, haptics: true, orientation: "landscape" },
      input: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 1 }, buttons: 1 },
    },
    {
      name: "keyboard-only",
      features: { touch: false, pointer: "none", keyboard: true, gamepad: false, haptics: false, orientation: "landscape" },
      input: { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: true },
    },
  ] as const;
  const nextGeometry = {
    content: { width: 1366, height: 768 },
    game: { x: 203, y: 24, width: 960, height: 720 },
    safeArea: { top: 18, right: 12, bottom: 20, left: 12 },
  } as const;

  function replay(
    profile: (typeof profiles)[number],
    options: { readonly logFeatures?: boolean; readonly logGeometry?: boolean } = {},
  ): { readonly hashes: readonly string[]; readonly consumed: readonly InputRecord[] } {
    const encoded = writeBoard(createEmptyBoard());
    if (!encoded.ok) throw new Error(encoded.error.message);
    const engine = createEngine({
      seed: 0x1354,
      assetIndex: createAssetIndex(["Boards/replay.brd"]),
      assetRoot: PACKAGE_ROOT,
      initialBoard: "replay.brd",
      width: 32,
      height: 32,
      maxTicks: 4,
      features: profile.features,
      displayGeometry: geometry,
    });
    const boot = engine.advance(0, []);
    const boardRequest = boot.requests.find((request) => request.kind === "asset");
    if (boardRequest?.kind !== "asset") throw new Error("expected replay board request");
    engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: encoded.value } }]);

    const updatedFeatures = { ...profile.features, haptics: !profile.features.haptics };
    const featureRecord: InputRecord = { tick: 0, event: { kind: "host.features", features: updatedFeatures } };
    const profileInput: InputRecord = { tick: 0, event: profile.input };
    const first = engine.advance(1, [
      ...(options.logFeatures === false ? [] : [featureRecord]),
      profileInput,
    ]);
    const geometryRecord: InputRecord = { tick: 1, event: { kind: "host.display", geometry: nextGeometry } };
    const second = engine.advance(1, options.logGeometry === false ? [] : [geometryRecord]);
    const third = engine.advance(1, []);
    const fourth = engine.advance(1, []);
    return {
      hashes: [first.stateHash, second.stateHash, third.stateHash, fourth.stateHash],
      consumed: [...first.consumed, ...second.consumed, ...third.consumed, ...fourth.consumed],
    };
  }

  for (const profile of profiles) {
    const first = replay(profile);
    const repeated = replay(profile);
    deepEqual(repeated.hashes, first.hashes, `${profile.name} repeats identical per-tick hashes with the same seed and input`);
    deepEqual(
      first.consumed.map(({ event }) => event.kind),
      ["host.features", profile.input.kind, "host.display"],
      `${profile.name} consumes profile input and complete capability/geometry updates in order`,
    );
    deepEqual(first.consumed[0]?.event, {
      kind: "host.features",
      features: { ...profile.features, haptics: !profile.features.haptics },
    }, `${profile.name} records the complete normalized capability replacement`);
    deepEqual(first.consumed[2]?.event, { kind: "host.display", geometry: nextGeometry }, `${profile.name} records the complete geometry replacement`);
    ok(new Set(first.hashes).size > 1, `${profile.name} advances through distinct state hashes`);

    const withoutFeatureUpdate = replay(profile, { logFeatures: false });
    ok(first.hashes[0] !== withoutFeatureUpdate.hashes[0], `${profile.name} feature update is hash-significant on its consuming tick`);
    const withoutGeometryUpdate = replay(profile, { logGeometry: false });
    ok(first.hashes[1] !== withoutGeometryUpdate.hashes[1], `${profile.name} geometry update is hash-significant on its consuming tick`);
  }
});

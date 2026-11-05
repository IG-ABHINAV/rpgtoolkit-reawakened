import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createAssetIndex, createEmptyBoard, createEngine, PACKAGE_ROOT, writeBoard, type GameState } from "../src/index.ts";
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
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/host.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "host.brd",
    width: 32,
    height: 32,
    maxTicks: 4,
    phaseRegistrations: [{ phase: "movement", run: (state) => { observed.current = { features: state.features, geometry: state.display.geometry }; } }],
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
});

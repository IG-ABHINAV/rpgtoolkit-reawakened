import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createAssetIndex, createEmptyBoard, createEngine, inputPhaseRegistration, PACKAGE_ROOT, writeBoard } from "../src/index.ts";
import type { GameState } from "../src/index.ts";

// ACT-2.4: count registry and claim-table scans at the actual engine input boundary, not wall-clock time.
test("engine action and key routing do not scan a 512-action registry or unrelated keyboard claims", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  let state: GameState | null = null;
  let registryScans = 0;
  let claimScans = 0;
  let arrayScans = 0;
  let observed = [0, 0, 0];
  const engine = createEngine({
    seed: 7, assetIndex: createAssetIndex(["Boards/test.brd"]), assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd", width: 32, height: 32, maxTicks: 20, program: "end()\n",
    phaseRegistrations: [inputPhaseRegistration(), { phase: "input", rank: 1, run: (live) => {
      state = live;
      observed = [registryScans, claimScans, arrayScans];
    } }],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  engine.advance(1, []);
  const live = state as GameState | null;
  if (live === null) throw new Error("expected live input state");
  for (let index = 0; index < 512; index += 1) {
    equal(engine.registerGameAction({ name: `game.action${index}`, label: `Action ${index}`, icon: null, group: null,
      controls: index === 511 ? ["key:KeyF"] : [], locked: false, hidden: false }), true);
  }
  // Populate unrelated historical claims without changing the reverse index for KeyF.
  for (let index = 0; index < 511; index += 1) live.input.keyboardActionSources[`game.action${index}`] = {};
  live.input.actionRegistry = new Proxy(live.input.actionRegistry, { ownKeys(target) { registryScans += 1; return Reflect.ownKeys(target); } });
  live.input.keyboardActionSources = new Proxy(live.input.keyboardActionSources, { ownKeys(target) { claimScans += 1; return Reflect.ownKeys(target); } });
  live.input.registeredActions = new Proxy(live.input.registeredActions, { get(target, property, receiver) {
    if (property === "some") arrayScans += 1;
    return Reflect.get(target, property, receiver);
  } });
  const run = (event: Parameters<typeof engine.advance>[1][number]["event"]) => {
    registryScans = 0; claimScans = 0; arrayScans = 0;
    engine.advance(1, [{ tick: live.time.tick, event }]);
    deepEqual(observed, [0, 0, 0], "routing must not enumerate unrelated registrations or keyboard claims");
  };
  run({ kind: "action", action: "game.action511", source: "touch", down: true, modalId: null });
  equal(live.input.actions["game.action511"], true);
  run({ kind: "action", action: "game.action511", source: "touch", down: false, modalId: null });
  equal(live.input.actions["game.action511"], false);
  run({ kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  equal(live.input.actions["game.action511"], true);
  run({ kind: "key", name: "F", code: "KeyF", char: "f", down: false });
  equal(live.input.actions["game.action511"], false);
  run({ kind: "action", action: "game.unknown", source: "touch", down: true, modalId: null });
});

import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  assetKey,
  createEmptyBoard,
  createGameState,
  createInputSection,
  hydrateSprites,
  inputPhaseRegistration,
  movementPhaseRegistration,
  type GameState,
  type WorldBoard,
} from "../src/index.ts";

function makeBoard(): WorldBoard {
  const empty = createEmptyBoard();
  return {
    ...empty,
    key: assetKey("boards/test.brd"),
    width: 320,
    height: 240,
    sizeX: 10,
    sizeY: 8,
    sizeL: 1,
  } as unknown as WorldBoard;
}

function makeState(): GameState {
  const board = makeBoard();
  const state = createGameState({ seed: 1 });
  state.world = { board };
  state.sprites = hydrateSprites({
    board,
    players: [{ id: "hero", kind: "player" as const, source: "hero.tem", x: 48, y: 63, layer: 1, facing: "S", controlled: true }],
  });
  state.input = createInputSection({
    bindings: { keys: { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down" } },
    allowDiagonals: false,
  });
  return state;
}

const runInputPhase = inputPhaseRegistration({ pixelMovement: 0, pixelStep: 8 }).run;
const runMovement = movementPhaseRegistration().run;

function tick(state: GameState, t: number, events: Parameters<typeof applyInputEvent>[1][] = []): void {
  state.time.tick = t;
  for (const event of events) applyInputEvent(state.input, event);
  runInputPhase(state);
  runMovement(state);
}

test("holding a direction key moves the player continuously, not one tile", () => {
  const state = makeState();
  const startX = state.sprites.players[0]!.x;

  // Press and hold ArrowRight; the runner never sends a keyup.
  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  for (let t = 1; t < 60; t += 1) tick(state, t);

  const endX = state.sprites.players[0]!.x;
  // At default speed (0.05 s) one 32 px tile takes 24 ticks. In 60 ticks a held key
  // should walk at least two full tiles (64 px). One tile would be the one-step bug.
  ok(endX - startX >= 64, `expected continuous movement over at least 64 px, moved ${endX - startX} px`);
});

test("a single tapped direction key moves exactly one tile", () => {
  const state = makeState();
  const startX = state.sprites.players[0]!.x;

  // Press and release on consecutive ticks.
  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  tick(state, 1, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false }]);
  for (let t = 2; t < 60; t += 1) tick(state, t);

  const endX = state.sprites.players[0]!.x;
  equal(endX - startX, 32, "a single tap should move exactly one 32 px tile");
});

test("releasing a held direction key stops after the current step", () => {
  const state = makeState();
  const startX = state.sprites.players[0]!.x;

  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  // Hold until just before the first step completes (8 advances of 3 ticks each), then release.
  for (let t = 1; t < 21; t += 1) tick(state, t);
  tick(state, 21, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false }]);
  for (let t = 22; t < 60; t += 1) tick(state, t);

  const endX = state.sprites.players[0]!.x;
  // After release, only the step already queued should complete.
  equal(endX - startX, 32, "releasing should finish the current step and stop");
});

test("opposing held direction keys cancel out and produce no movement", () => {
  const state = makeState();
  const startX = state.sprites.players[0]!.x;

  tick(state, 0, [
    { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true },
    { kind: "key", name: "LEFT", code: "ArrowLeft", char: null, down: true },
  ]);
  for (let t = 1; t < 60; t += 1) tick(state, t);

  const endX = state.sprites.players[0]!.x;
  equal(endX, startX, "opposing horizontal keys should not move the player");
});

test("held diagonal directions respect the allowDiagonals setting", () => {
  const state = makeState();
  state.input.allowDiagonals = true;
  const start = { x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y };

  tick(state, 0, [
    { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true },
    { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: true },
  ]);
  for (let t = 1; t < 60; t += 1) tick(state, t);

  const end = { x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y };
  ok(end.x > start.x, "diagonal should move east");
  ok(end.y > start.y, "diagonal should move south");
});

test("losing focus prevents new held-direction steps after the current step finishes", () => {
  const state = makeState();
  const startX = state.sprites.players[0]!.x;

  // Press and hold; the first step queues on tick 0.
  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  // Focus is lost just before the first step completes (8 advances of 3 ticks each), so the
  // player becomes idle while focus is already lost and no second step may be queued.
  for (let t = 1; t < 21; t += 1) tick(state, t);
  tick(state, 21, [{ kind: "focus", state: "lost" }]);
  for (let t = 22; t < 60; t += 1) tick(state, t);

  const endX = state.sprites.players[0]!.x;
  equal(endX - startX, 32, "focus lost should allow the current step to finish but not start another");
});

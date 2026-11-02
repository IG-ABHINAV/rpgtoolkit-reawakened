import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  createGameState,
  createInputSection,
  hydrateSprites,
  inputPhaseRegistration,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  writeBoard,
  type Engine,
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

type InputEv = Parameters<typeof applyInputEvent>[1];

/** A key record named like the runners name it: the logical name is the code without its `Arrow` prefix, upper-cased. */
function key(code: "ArrowRight" | "ArrowLeft" | "ArrowDown", down: boolean, repeat = false): InputEv {
  return { kind: "key", name: code.slice("Arrow".length).toUpperCase(), code, char: null, down, ...(repeat ? { repeat: true } : {}) };
}

function makeState(allowDiagonals = false): GameState {
  const board = makeBoard();
  const state = createGameState({ seed: 1 });
  state.world = { board };
  state.sprites = hydrateSprites({
    board,
    players: [{ id: "hero", kind: "player" as const, source: "hero.tem", x: 48, y: 63, layer: 1, facing: "S", controlled: true }],
  });
  state.input = createInputSection({
    bindings: { keys: { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down" } },
    allowDiagonals,
  });
  return state;
}

const runInputPhase = inputPhaseRegistration({ pixelMovement: 0, pixelStep: 8 }).run;
const runMovement = movementPhaseRegistration().run;

function tick(state: GameState, t: number, events: InputEv[] = []): void {
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

/** The player's position after each tick, so a test can tell where each step went. */
function walk(state: GameState, from: number, to: number, events: Record<number, Parameters<typeof applyInputEvent>[1][]> = {}): { x: number; y: number }[] {
  const trail: { x: number; y: number }[] = [];
  for (let t = from; t < to; t += 1) {
    tick(state, t, events[t] ?? []);
    trail.push({ x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y });
  }
  return trail;
}

test("held diagonal keys keep walking diagonal steps when allowDiagonals is on", () => {
  const state = makeState(true);
  const start = { x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y };

  const trail = walk(state, 0, 100, { 0: [key("ArrowRight", true), key("ArrowDown", true)] });

  // Every tick the two axes have moved by the same amount: each step is a diagonal one, never one axis alone.
  for (const [t, at] of trail.entries()) equal(at.x - start.x, at.y - start.y, `tick ${t}: a diagonal step moves both axes equally`);
  const end = trail[trail.length - 1]!;
  // The press edge alone queues one 32 px diagonal step; a held key must queue more of them.
  ok(end.x - start.x >= 64 && end.y - start.y >= 64, `expected at least two diagonal steps, moved ${end.x - start.x},${end.y - start.y}`);
});

test("with allowDiagonals off, keys pressed together walk the later-pressed axis only", () => {
  const state = makeState(false);
  const start = { x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y };

  const trail = walk(state, 0, 100, { 0: [key("ArrowRight", true), key("ArrowDown", true)] });

  for (const [t, at] of trail.entries()) equal(at.x, start.x, `tick ${t}: the earlier-pressed Right must not move the player`);
  const end = trail[trail.length - 1]!;
  ok(end.y - start.y >= 64, `expected at least two south steps from the held Down, moved ${end.y - start.y}`);
});

test("with allowDiagonals off, adding Down to a held Right turns after the step, and releasing Down resumes Right", () => {
  const state = makeState(false);
  const start = { x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y };

  const east = walk(state, 0, 50, { 0: [key("ArrowRight", true)] });
  for (const [t, at] of east.entries()) equal(at.y, start.y, `tick ${t}: Right alone never moves along y`);
  const turnedFrom = east[east.length - 1]!;
  ok(turnedFrom.x - start.x >= 32, "Right alone had walked at least one step before Down was added");

  // Down is pressed while the east step at tick 49 is still in progress: that step finishes, then the player turns.
  const south = walk(state, 50, 150, { 50: [key("ArrowDown", true)] });
  const turned = south[south.length - 1]!;
  ok(turned.x - turnedFrom.x <= 32, `at most the step already under way may still go east, moved ${turned.x - turnedFrom.x}`);
  ok(turned.y - turnedFrom.y >= 64, `expected at least two south steps once Down was held, moved ${turned.y - turnedFrom.y}`);
  const stopped = south.findIndex((at) => at.x === turned.x);
  for (const at of south.slice(stopped)) equal(at.x, turned.x, "after the turn no east movement is queued while Down is held");

  // Releasing Down hands the walk back to the Right key that stayed held.
  const resumed = walk(state, 150, 250, { 150: [key("ArrowDown", false)] });
  const back = resumed[resumed.length - 1]!;
  ok(back.x - turned.x >= 64, `expected Right to resume for at least two steps, moved ${back.x - turned.x}`);
  ok(back.y - turned.y <= 32 + 32, `at most the south step under way may finish after Down is released, moved ${back.y - turned.y}`);
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

const BLUR: InputEv = { kind: "focus", state: "lost" };
const REFOCUS: InputEv = { kind: "focus", state: "gained" };

test("a key held across a focus loss is released: refocusing with no key-up does not auto-walk", () => {
  const state = makeState();
  const start = { x: state.sprites.players[0]!.x, y: state.sprites.players[0]!.y };

  // Hold Right for 10 ticks, then the window loses focus. The player releases the key while it is unfocused, so
  // the page never sees a key-up; focus returns with the key up and nothing left to say so.
  tick(state, 0, [key("ArrowRight", true)]);
  for (let t = 1; t < 10; t += 1) tick(state, t);
  tick(state, 10, [BLUR]);
  tick(state, 11, [REFOCUS]);
  equal(state.input.actions.right, false);
  equal(state.input.keyboardActions.right, false);
  equal(state.input.held.ArrowRight, false);
  deepEqual(state.input.directionOrder, []);

  const idle = walk(state, 12, 200);
  const end = idle[idle.length - 1]!;
  // The step under way finishes (32 px from the start); nothing queues another, so the player does not reach the edge.
  equal(end.x - start.x, 32, `the player must stand still after one step, not walk on: ended at ${end.x}`);
  equal(end.y, start.y);

  // The key itself still works: pressing it again walks again.
  const again = walk(state, 200, 260, { 200: [key("ArrowRight", true)], 201: [key("ArrowRight", false)] });
  equal(again[again.length - 1]!.x - end.x, 32, "a fresh tap after the blur moves one tile");
});

test("a held key's host auto-repeat after the refocus does not resume the walk", () => {
  const state = makeState();
  const start = state.sprites.players[0]!.x;

  tick(state, 0, [key("ArrowRight", true)]);
  for (let t = 1; t < 10; t += 1) tick(state, t);
  tick(state, 10, [BLUR]);
  tick(state, 11, [REFOCUS]);
  // The key is still physically down, so the host repeats it into the refocused window; a device record on the same
  // tick recomputes every action from its sources, which is what once resurrected such a key.
  const idle = walk(state, 12, 100, {
    12: [key("ArrowRight", true, true), { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 }],
  });
  equal(idle[idle.length - 1]!.x - start, 32);
  equal(state.input.held.ArrowRight, false);
});

test("a direction a gamepad holds survives a focus loss: no step while unfocused, walking resumes with focus", () => {
  const state = makeState();
  const start = state.sprites.players[0]!.x;
  const padRight: InputEv = { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 8 };

  tick(state, 0, [padRight, key("ArrowRight", true)]);
  for (let t = 1; t < 21; t += 1) tick(state, t);
  // Focus is lost just before the first step completes, so the player is idle again while unfocused.
  tick(state, 21, [BLUR]);
  equal(state.input.keyboardActions.right, false, "the keyboard half is released");
  equal(state.input.actions.right, true, "the pad still holds Right");
  const paused = walk(state, 22, 60);
  equal(paused[paused.length - 1]!.x - start, 32, "no new step starts while focus is lost");

  tick(state, 60, [REFOCUS]);
  const resumed = walk(state, 61, 140);
  ok(resumed[resumed.length - 1]!.x - start >= 32 + 64, "the pad's held Right walks on once focus returns");
});

type ObservedEngine = {
  readonly engine: Engine;
  /** Whether the engine's own input state held Right at the input phase of each tick it ran. */
  readonly rightHeld: boolean[];
};

/** The real engine with Right bound and an observer in its input phase; its board is the empty authored one. */
function observedEngine(): ObservedEngine {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const rightHeld: boolean[] = [];
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 60,
    input: { bindings: { keys: { ArrowRight: "right" } } },
    phaseRegistrations: [{ phase: "input", rank: 1, run: (state) => { rightHeld.push(state.input.actions.right === true); } }],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected the board request");
  if (engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]).loading) throw new Error("expected the board to load");
  return { engine, rightHeld };
}

test("through the engine: a key pressed before the blur is released when focus returns", () => {
  const { engine, rightHeld } = observedEngine();
  equal(engine.advance(2, [{ tick: 0, event: key("ArrowRight", true) }]).ticksRun, 2);
  deepEqual(rightHeld, [true, true], "Right is held while the window has focus");

  equal(engine.advance(2, [{ tick: 2, event: BLUR }]).ticksRun, 0, "no tick runs while unfocused");
  equal(engine.advance(3, [{ tick: 2, event: REFOCUS }]).ticksRun, 3);
  deepEqual(rightHeld.slice(2), [false, false, false], "refocused with no key-up, nothing is held");

  // And the key works again when pressed: the clean state is not a stuck one.
  equal(engine.advance(1, [{ tick: 5, event: key("ArrowRight", true) }]).ticksRun, 1);
  equal(rightHeld[rightHeld.length - 1], true);
});

test("through the engine: a key pressed in the blur's own frame is released too, and stays in the replay record", () => {
  const { engine, rightHeld } = observedEngine();
  equal(engine.advance(2, []).ticksRun, 2);

  // The host batches the key-down and the blur of one frame into one advance, in host order.
  const blurred = engine.advance(2, [{ tick: 2, event: key("ArrowRight", true) }, { tick: 2, event: BLUR }]);
  equal(blurred.ticksRun, 0);
  deepEqual(blurred.consumed.map((record) => record.event.kind), ["key", "focus"], "both records are consumed, in host order");
  equal(engine.advance(3, [{ tick: 2, event: REFOCUS }]).ticksRun, 3);
  deepEqual(rightHeld.slice(2), [false, false, false], "the key pressed just before the blur is not held after it");
});

test("through the engine: a key the host queued after the blur still waits for the resumed tick", () => {
  const { engine, rightHeld } = observedEngine();
  equal(engine.advance(2, []).ticksRun, 2);

  const blurred = engine.advance(2, [{ tick: 2, event: BLUR }, { tick: 2, event: key("ArrowRight", true) }]);
  equal(blurred.ticksRun, 0);
  deepEqual(blurred.consumed.map((record) => record.event.kind), ["focus"], "a record after the blur is not applied while unfocused");
  equal(engine.advance(2, [{ tick: 2, event: REFOCUS }]).ticksRun, 2);
  deepEqual(rightHeld.slice(2), [true, true], "it applies at the resumed tick, as before");
});

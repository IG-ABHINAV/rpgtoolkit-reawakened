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
  killThread,
  movementPhaseRegistration,
  runThreadsPhase,
  scriptOwnsInput,
  startProgram,
  type GameState,
  type WorldBoard,
} from "../src/index.ts";
import { enqueuePointPathMove } from "../src/sprites/runtime.ts";
import { runTriggersPhase } from "../src/triggers/runtime.ts";
import type { WorldItem, WorldProgram } from "../src/world/model.ts";
import { createScriptServices } from "./script-test-services.ts";

// docs/spec/engine/display-input-audio.md#reawakened-click-movement-freeze (issue #1169).

type InputEv = Parameters<typeof applyInputEvent>[1];
const down = (x: number, y: number): InputEv => ({ kind: "pointer", x, y, buttons: 1 });
const up = (x: number, y: number): InputEv => ({ kind: "pointer", x, y, buttons: 0 });
const BLUR: InputEv = { kind: "focus", state: "lost" };
const REFOCUS: InputEv = { kind: "focus", state: "gained" };

const START = { x: 48, y: 63 };
const GOAL = { x: 200, y: 63 };

const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];
/** A step-on region around the start tile; `activationType` 4 is "stops movement". */
function region(activationType: number): WorldProgram {
  return { program: "region-0", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType, repeatDistance: 0, layer: 1, points: rectangle(16, 31, 80, 95), closed: 1, handle: "r0" };
}
/** An inert board item with no program; it only supplies a sprite that can block a route. */
const blocker: WorldItem = { slot: 0, itemFile: "block.itm", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 272, y: 191, layer: 1, reserved: 0 };

function makeState(extra: { programs?: WorldProgram[]; items?: WorldItem[] } = {}): GameState {
  const board = {
    ...createEmptyBoard(),
    key: assetKey("boards/test.brd"),
    width: 320, height: 240, sizeX: 10, sizeY: 8, sizeL: 1,
    ...(extra.programs === undefined ? {} : { programs: extra.programs }),
    ...(extra.items === undefined ? {} : { items: extra.items }),
  } as unknown as WorldBoard;
  const state = createGameState({ seed: 1 });
  state.world = { board };
  state.sprites = hydrateSprites({
    board,
    players: [{ id: "hero", kind: "player" as const, source: "hero.tem", x: START.x, y: START.y, layer: 1, facing: "S", controlled: true }],
  });
  state.input = createInputSection({ bindings: { keys: { ArrowRight: "right" } } });
  return state;
}

const inputPhase = inputPhaseRegistration({ pixelMovement: 0, pixelStep: 8 }).run;

type Tracker = { readonly run: (state: GameState) => void; readonly events: string[] };
function movement(): Tracker {
  const events: string[] = [];
  return { events, run: movementPhaseRegistration({ onEvent: (event) => { events.push(event.type); } }).run };
}

function tick(state: GameState, t: number, events: InputEv[] = [], run = movement().run): void {
  state.time.tick = t;
  for (const event of events) applyInputEvent(state.input, event);
  inputPhase(state);
  run(state);
}
function ticks(state: GameState, from: number, to: number, run = movement().run): number {
  for (let t = from; t < to; t += 1) tick(state, t, [], run);
  return to;
}
const hero = (state: GameState) => state.sprites.players[0]!;

/** Park a real `wait()`: the program owns the key queue until it is killed. */
function park(state: GameState, text = "wait()"): number {
  const thread = startProgram(state.vm, { kind: "inline", ir: "1", text });
  runThreadsPhase(state.vm, createScriptServices(state), 100);
  ok(scriptOwnsInput(state.vm), "the script owns the key queue");
  return thread.id;
}

/** Where an unblocked click from the start walks to, so every later assertion compares with the real walk. */
function unblockedGoal(): { x: number; y: number } {
  const state = makeState();
  tick(state, 0, [down(GOAL.x, GOAL.y)]);
  ticks(state, 1, 400);
  const { x, y } = hero(state);
  ok(x > START.x + 96, `the unblocked click walks a long way (reached x=${x})`);
  return { x, y };
}

test("a click while wait() is parked starts no path, is recorded for scripts, and is not replayed after the block", () => {
  const state = makeState();
  const thread = park(state);

  tick(state, 0, [down(GOAL.x, GOAL.y)]);
  const run = movement().run;
  ticks(state, 1, 90, run);
  equal(hero(state).x, START.x, "the click moved nothing during the block");
  equal(hero(state).queue.moves.length, 0, "the click queued no path");
  equal(state.input.pointer.buttons, 1, "the pointer state still records the click for scripts and plugins");
  equal(state.input.pendingClicks.length, 0, "a blocked click is consumed, not kept for later");

  tick(state, 90, [up(GOAL.x, GOAL.y)], run);
  killThread(state.vm, thread);
  ticks(state, 91, 300, run);
  deepEqual({ x: hero(state).x, y: hero(state).y }, START, "the click is lost for movement, as a tap is");
});

test("a click path already under way finishes its step, pauses while a script blocks, and resumes to the same goal when it ends", () => {
  const goal = unblockedGoal();
  const state = makeState();
  const run = movement().run;
  tick(state, 0, [down(GOAL.x, GOAL.y)], run);
  ticks(state, 1, 30, run);
  ok(hero(state).x > START.x && hero(state).x < goal.x, `the path is in progress (x=${hero(state).x})`);

  const thread = park(state);
  tick(state, 30, [up(GOAL.x, GOAL.y)], run);
  ticks(state, 31, 100, run);
  const settled = hero(state).x;
  equal((settled - START.x) % 32, 0, "the step under way finished on a tile; no half step");
  ok(settled > START.x && settled < goal.x, `and the path did not run on (x=${settled})`);
  ticks(state, 100, 220, run);
  equal(hero(state).x, settled, "no new step started while the block lasted");
  ok(hero(state).queue.moves.length > 0, "the rest of the route is kept, not discarded");
  ok(hero(state).state !== "moving", "a paused route does not animate as walking");

  killThread(state.vm, thread);
  ticks(state, 220, 600, run);
  deepEqual({ x: hero(state).x, y: hero(state).y }, goal, "the paused route resumed and reached the unblocked goal");
});

for (const [label, activationType, held, resumes] of [
  ["a board program without stops-movement leaves the route in place, so it resumes", 0, false, true],
  ["a board program with stops-movement discards the route and a released button does not resume", 4, false, false],
  ["a board program with stops-movement discards the route but a still-held button re-paths", 4, true, true],
] as const) {
  test(`step-on program: ${label}`, () => {
    const goal = unblockedGoal();
    const state = makeState({ programs: [region(activationType)] });
    const run = movement().run;
    tick(state, 0, [down(GOAL.x, GOAL.y)], run);
    // Rewind the movement phase of tick 0: the route is queued and the player has just "stepped" on the region.
    state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: START.x, y: START.y, movement: { ...player.movement, active: null, lastStepTick: 0, lastStepDistance: 32 } }));
    const events = runTriggersPhase(state, { programRef: () => ({ kind: "inline", text: "wait()", ir: "1", dialect: "tk3" }) });
    ok(events.length > 0 && state.triggers.active !== null, "the step-on program started");
    runThreadsPhase(state.vm, createScriptServices(state), 100);
    ok(scriptOwnsInput(state.vm));
    equal(hero(state).queue.moves.length > 0, activationType === 0, "only a stops-movement program clears the queued route");

    ticks(state, 1, 120, run);
    equal(hero(state).x, START.x, "nothing walked during the block");

    if (!held) tick(state, 120, [up(GOAL.x, GOAL.y)], run);
    killThread(state.vm, state.vm.threads[0]!.id);
    ticks(state, 121, 600, run);
    deepEqual({ x: hero(state).x, y: hero(state).y }, resumes ? goal : START);
  });
}

test("a script's own movement is never paused by the block: a wait on it still finishes", () => {
  const state = makeState();
  park(state);
  enqueuePointPathMove(state.sprites, "hero", [{ x: 112, y: 63 }], true);
  ticks(state, 0, 120);
  equal(hero(state).x, 112, "a script-queued path walks while its own program is blocked");
});

/** A player one advance from a sprite, mid-way along a route to (208, 63): the next advance is a diversion. */
function approachingBlocker(pointer: boolean): { state: GameState; tracker: Tracker } {
  const state = makeState({ items: [blocker] });
  state.sprites.items = state.sprites.items.map((item) => ({ ...item, x: 112, y: 63 }));
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player,
    x: 80,
    state: "moving",
    queue: { moves: [{ source: "path", target: { x: 208, y: 63 }, facing: null, pathMode: 1, ...(pointer ? { pointer: true as const } : {}) }], waypoint: null },
    movement: {
      ...player.movement,
      active: { source: "path", start: { x: 48, y: 63 }, target: { x: 144, y: 63 }, facing: null, cadence: 0, ignoreBoard: false, tried: false, pathMode: 1, ...(pointer ? { pointer: true as const } : {}) },
    },
  }));
  return { state, tracker: movement() };
}

test("a diversion of a click path keeps the click's mark, so it pauses with the rest of the route", () => {
  const { state, tracker } = approachingBlocker(true);
  tick(state, 0, [], tracker.run);
  ok(tracker.events.includes("diversion"), "the route diverted around the sprite");
  ok(hero(state).queue.moves.length > 0 && hero(state).queue.moves.every((move) => move.pointer === true), "every diversion move is still the click's");

  park(state);
  const x = hero(state).x;
  ticks(state, 1, 120, tracker.run);
  equal(hero(state).x, x, "the diverted route takes no step while the script owns the key queue");
});

test("a diversion of a script's own path stays unmarked and keeps walking during a block", () => {
  const { state, tracker } = approachingBlocker(false);
  tick(state, 0, [], tracker.run);
  ok(tracker.events.includes("diversion"));
  ok(hero(state).queue.moves.every((move) => move.pointer === undefined), "no mark appears on a script's route");

  park(state);
  const x = hero(state).x;
  ticks(state, 1, 120, tracker.run);
  ok(hero(state).x > x, "the script's diverted route keeps walking while its program is blocked");
});

test("a click on an on-screen button slot during a block still reaches the key queue and moves nothing", () => {
  const state = makeState();
  state.input.buttons.push({ id: "slot1", x: 190, y: 50, w: 40, h: 40, action: "confirm", enabled: true });
  park(state);
  tick(state, 0, [down(GOAL.x, GOAL.y)]);
  ticks(state, 1, 60);
  equal(hero(state).x, START.x);
  ok(state.input.keys.some((key) => key.name === "confirm"), "the slot's entry is in the script's key queue");
});

test("a held button re-paths an idle player with no route, and focus loss releases it", () => {
  const state = makeState();
  const run = movement().run;
  tick(state, 0, [down(GOAL.x, GOAL.y)], run);
  ticks(state, 1, 400, run);
  const arrived = hero(state).x;
  ok(arrived > START.x + 96);

  const back = (): void => { state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: START.x, y: START.y, prev: null })); };
  back();
  ticks(state, 400, 800, run);
  equal(hero(state).x, arrived, "the still-held button walks the idle player back to the cursor");

  back();
  tick(state, 800, [BLUR], run);
  equal(state.input.pointer.buttons, 0, "focus loss releases the held button: its button-up is never reported to an unfocused window");
  tick(state, 801, [REFOCUS], run);
  ticks(state, 802, 1000, run);
  equal(hero(state).x, START.x, "after refocus nothing walks until the button is pressed again");
});

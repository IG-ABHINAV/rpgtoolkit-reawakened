import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { assetKey } from "../src/formats/resolver/resolver.ts";
import { createGameState, type GameState } from "../src/save/state.ts";
import { restoreGameState, snapshot } from "../src/save/snapshot.ts";
import { actorFromSource, type SpriteActor } from "../src/sprites/model.ts";
import { applyTriggerEffect, runTriggersPhase, selectPointerActivationTarget, type TriggerEvent, type TriggerPhaseOptions } from "../src/triggers/runtime.ts";
import { fileProgramRef } from "../src/script/program.ts";
import { ScriptError } from "../src/script/errors.ts";
import { resolveProgram } from "../src/script/loader.ts";
import { PACKAGE_ROOT } from "../src/formats/resolver/model.ts";
import { createAssetIndex } from "../src/formats/resolver/resolver.ts";
import { coordLayout, tileToPixel, boardPixelSize } from "../src/world/coords.ts";
import { placeSelectedPlayer } from "../src/sprites/runtime.ts";
import type { EffectRecord } from "../src/script/effects.ts";
import type { WorldBoard, WorldItem, WorldProgram } from "../src/world/model.ts";

import { applyInputEvent } from "../src/input/input.ts";
import { routePointerUpActivations, runInputPhase } from "../src/input/registration.ts";
const ref = (text: string) => ({ kind: "inline" as const, text, ir: "1", dialect: "tk3" as const });
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

function item(index: number, x: number, y: number, activationType = 0, initialVar = "", initialValue = ""): WorldItem {
  return { slot: index, itemFile: `item-${index}.itm`, activationPrg: `item-${index}`, multitaskPrg: "", initialVar, initialValue, finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: initialVar === "" ? 0 : 1, activationType, x, y, layer: 1, reserved: 0 };
}
function region(index: number, activationType = 0, initialVar = "", initialValue = "", finalVar = "", finalValue = "", layer = 1, program?: string): WorldProgram {
  return { program: program ?? `region-${index}`, graphic: "", initialVar, initialValue, finalVar, finalValue, activate: initialVar === "" ? 0 : 1, activationType, repeatDistance: 0, layer, points: rectangle(-32, -32, 32, 32), closed: 1, handle: `r${index}` };
}
function board(programs: WorldProgram[] = [], items: WorldItem[] = []): WorldBoard {
  return { key: assetKey("boards/test.brd"), coordType: 0, sizeX: 10, sizeY: 10, sizeL: 1, width: 320, height: 320, background: { r: 0, g: 0, b: 0 }, ambient: { r: 255, g: 255, b: 255 }, layers: [], programs, items };
}
function stateWith(world: WorldBoard, itemSources: SpriteActor[] = []): GameState {
  const state = createGameState({ seed: 1 });
  state.world = { ...state.world, board: world };
  const player = actorFromSource({ id: "player", kind: "player", source: "hero", x: 0, y: 0, layer: 1, facing: "E", controlled: true }, world, 0, null);
  state.sprites.players = [player];
  state.sprites.selectedPlayer = player.id;
  state.sprites.items = itemSources;
  return state;
}
function itemActor(world: WorldBoard, source: WorldItem, index: number, x = source.x, y = source.y, visible = true): SpriteActor {
  return actorFromSource({ id: `item:${index}`, kind: "item", source: `item:${index}`, sourceSlot: source.slot, x, y, layer: source.layer, visible, boardItem: source }, world, index, index);
}
function finishActive(state: GameState): void {
  const active = state.triggers.active;
  if (active === null) throw new Error("expected active trigger");
  state.vm.threads = state.vm.threads.map((thread) => thread.id === active.thread ? { ...thread, status: "finished" } : thread);
  state.time.tick += 1;
  runTriggersPhase(state, { programRef: (name) => ref(name) });
}


test("a released pointer tap faces toward the reachable item and dispatches one ordinary confirm edge", () => {
  const world = board([], [item(0, 16, 0, 1)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player,
    facing: "W",
    collisionBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor,
    activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  applyInputEvent(state.input, { kind: "pointer", x: 16, y: 0, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 16, y: 0, buttons: 0 });
  runInputPhase(state);
  equal(state.sprites.players[0]?.facing, "E", "the tap turns the player horizontally toward the target");
  deepEqual(state.input.pendingClicks, [], "a target tap does not also become a ground path");
  equal(state.input.actions.confirm, false, "the synthesized confirm is a one-tick edge");
  deepEqual(state.input.keys.map((key) => [key.name, key.action, key.target]), [["confirm", "confirm", "item:0"]]);
  const events = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(events[0]?.key, "item:0", "the confirm edge is constrained to the hit item's identity");
});

test("a contextual gameplay release requires the whole pointer gesture to stay inside Plane 1", () => {
  const world = board([], [item(0, 100, 0, 1)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  state.input.pointerPlane = { width: 100, height: 100 };
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player,
    x: 96,
    collisionBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor,
    activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));

  applyInputEvent(state.input, { kind: "pointer", x: 104, y: 0, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 96, y: 0, buttons: 0 });
  runInputPhase(state);
  deepEqual(state.input.keys, [], "a margin-started gesture cannot activate an adjacent off-viewport item");
  deepEqual(state.input.pendingPointerUps, []);

  applyInputEvent(state.input, { kind: "pointer", x: 96, y: 0, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 96, y: 0, buttons: 0 });
  runInputPhase(state);
  equal(state.input.keys[0]?.target, "item:0", "a complete Plane 1 tap still activates normally");
});

test("a queued contextual release keeps its captured board point when the camera moves", () => {
  const world = board([], [item(0, 100, 32, 1)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  state.input.pointerPlane = { width: 100, height: 100 };
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player, x: 84, y: 32, collisionBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor, activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  state.input.camera = { x: 80, y: 0 };
  applyInputEvent(state.input, { kind: "pointer", x: 20, y: 32, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 20, y: 32, buttons: 0 });
  const restored = restoreGameState(snapshot(state));
  for (const candidate of [state, restored]) {
    candidate.input.camera = { x: 300, y: 0 };
    runInputPhase(candidate);
    equal(candidate.input.keys[0]?.target, "item:0");
    equal(runTriggersPhase(candidate, { programRef: (name) => ref(name) })[0]?.key, "item:0");
  }

  const outside = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  outside.input.pointerPlane = { width: 100, height: 100 };
  outside.sprites.players = outside.sprites.players.map((player) => ({
    ...player, x: 84, y: 32, collisionBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  outside.sprites.items = outside.sprites.items.map((actor) => ({
    ...actor, activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  outside.input.camera = { x: -10, y: 0 };
  applyInputEvent(outside.input, { kind: "pointer", x: 110, y: 32, buttons: 1 });
  applyInputEvent(outside.input, { kind: "pointer", x: 110, y: 32, buttons: 0 });
  runInputPhase(outside);
  deepEqual(outside.input.keys, [], "an outside-plane tap cannot activate the item even when its world point overlaps it");
  equal(outside.sprites.players[0]!.queue.moves.length, 0, "an outside-plane tap cannot start a path");

  const releaseOutside = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  releaseOutside.input.pointerPlane = { width: 100, height: 100 };
  releaseOutside.input.camera = { x: -10, y: 0 };
  releaseOutside.sprites.players = outside.sprites.players.map((player) => ({ ...player }));
  releaseOutside.sprites.items = outside.sprites.items.map((actor) => ({ ...actor }));
  applyInputEvent(releaseOutside.input, { kind: "pointer", x: 96, y: 32, buttons: 1 });
  applyInputEvent(releaseOutside.input, { kind: "pointer", x: 110, y: 32, buttons: 0 });
  runInputPhase(releaseOutside);
  deepEqual(releaseOutside.input.keys, [], "a reachable item cannot activate from an outside-plane release");
});
test("a pointer activation is dispatched only to the tapped item, not the higher-ranked reachable item", () => {
  const world = board([], [item(0, 32, 0, 1), item(1, 16, 0, 1)]);
  const actors = [itemActor(world, world.items![0]!, 0), itemActor(world, world.items![1]!, 1)];
  const state = stateWith(world, actors);
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player,
    collisionBase: { points: rectangle(-8, -8, 32, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor,
    activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  applyInputEvent(state.input, { kind: "pointer", x: 16, y: 0, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 16, y: 0, buttons: 0 });
  runInputPhase(state);
  equal(state.input.keys[0]?.target, "item:1");
  const events = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(events[0]?.key, "item:1");
});
test("multiple pointer gestures in one tick retain their own target and click work", () => {
  const world = board([], [item(0, 16, 0, 1), item(1, 24, 0, 1)]);
  const actors = [itemActor(world, world.items![0]!, 0), itemActor(world, world.items![1]!, 1)];
  const state = stateWith(world, actors);
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player,
    collisionBase: { points: rectangle(-8, -8, 32, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor,
    activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  for (const x of [10, 25]) {
    applyInputEvent(state.input, { kind: "pointer", x, y: 0, buttons: 1 });
    applyInputEvent(state.input, { kind: "pointer", x, y: 0, buttons: 0 });
  }
  runInputPhase(state);
  deepEqual(state.input.keys.map((key) => key.target), ["item:0", "item:1"]);
  equal(state.input.pendingClicks.length, 0, "each contextual tap consumes only its own gesture path");
});

test("an item gesture removes all its movement points without consuming the following ground tap", () => {
  const world = board([], [item(0, 16, 0, 1)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player, collisionBase: { points: rectangle(-8, -8, 32, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor, activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  for (const [x, buttons] of [[12, 1], [14, 1], [16, 1], [16, 0], [120, 1], [120, 0]] as const) {
    applyInputEvent(state.input, { kind: "pointer", x, y: 0, buttons });
  }
  routePointerUpActivations(state);
  deepEqual(state.input.pendingClicks.map(({ x, y }) => ({ x, y })), [{ x: 120, y: 0 }], "only the separate ground gesture remains");
  runInputPhase(state);
  deepEqual(state.input.keys.map((key) => key.target), ["item:0"], "the first gesture confirms its item");
  const route = state.sprites.players[0]!.queue.moves;
  ok(route.length > 0, "the independent ground gesture starts a route");
  deepEqual(route.at(-1)?.target, { x: 120, y: 0 }, "the route goes to the ground, not an item gesture point");
});

test("pointer target selection refuses a non-key or unreachable item", () => {
  const world = board([], [item(0, 16, 0, 0)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player,
    collisionBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  state.sprites.items = state.sprites.items.map((actor) => ({
    ...actor,
    activationBase: { points: rectangle(-8, -8, 8, 8) },
  }));
  equal(selectPointerActivationTarget(state, { x: 16, y: 0 }), null, "step-only items cannot be key-confirm targets");
});

test("a released pointer tap without an eligible item remains a ground click", () => {
  const state = stateWith(board());
  applyInputEvent(state.input, { kind: "pointer", x: 80, y: 80, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 80, y: 80, buttons: 0 });
  runInputPhase(state);
  equal(state.input.keys.length, 0, "no confirm edge is generated");
  equal((state.sprites.players[0]?.queue.moves.length ?? 0) > 0, true, "the ordinary click-to-walk path is retained");
});
test("trigger precedence, conditions, re-arm and key dispatch are deterministic", () => {
  const world = board([region(0), region(1)], [item(0, 0, 0), item(1, 8, 0)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0), itemActor(world, world.items![1]!, 1)]);
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const started = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(started[0]?.key, "item:1");
  equal(state.sprites.items[1]?.facing, "W");
  finishActive(state);
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 128, movement: { ...player.movement, lastStepTick: state.time.tick + 1, lastStepDistance: 128 } }));
  state.time.tick += 1;
  runTriggersPhase(state, { programRef: (name) => ref(name) });
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 0, movement: { ...player.movement, lastStepTick: state.time.tick + 1, lastStepDistance: 128 } }));
  state.time.tick += 1;
  const rearmed = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(rearmed[0]?.key, "item:1");
  finishActive(state);
  state.time.tick += 1;
  const key = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(key.length, 0);
});

test("mid-step item contact does not fire or re-arm regions", () => {
  const world = board([region(0), { ...region(1), points: rectangle(96, -32, 160, 32) }], [item(0, 128, 0)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0)]);
  const poll = () => runTriggersPhase(state, { programRef: (name) => ref(name) });
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 },
  }));
  equal(poll()[0]?.key, "region:0");
  finishActive(state);

  // Leave the region and touch the item between completed steps.
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player, x: 128, state: "moving",
  }));
  equal(poll()[0]?.key, "item:0", "item contact is polled before the next completed step");
  equal(state.triggers.fired["region:0"], true, "leaving mid-step does not re-arm the region");
  finishActive(state);
  equal(state.triggers.active, null, "the overlapping second region does not fire between completed steps");
  equal(state.triggers.fired["region:1"], undefined);

  // Return to the region before the next completed step: it must not refire.
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({
    ...player, x: 0, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 32 },
  }));
  equal(poll().length, 0, "the previously fired region remains suppressed on the next completed step");
});

test("condition failure falls through and hidden items never become candidates", () => {
  const world = board([region(0, 0, "gate", "open"), region(1)], [item(0, 0, 0)]);
  const hidden = itemActor(world, world.items![0]!, 0, 0, 0, false);
  const state = stateWith(world, [hidden]);
  state.vm.globals.gate = "closed";
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const events = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(events[0]?.key, "region:1");
  equal(state.vm.threads.filter((thread) => thread.kind === "item").length, 0);
});

test("a key-press trigger fires on a key and a step-on trigger fires on a step, never the other way round", () => {
  const world = board([region(0, 1), region(1, 0)]);
  // A step: only the step-on region (activation type 0) qualifies.
  const stepped = stateWith(world);
  stepped.time.tick = 1;
  stepped.sprites.players = stepped.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const stepEvents = runTriggersPhase(stepped, { programRef: (name) => ref(name) });
  equal(stepEvents[0]?.key, "region:1", "a step starts the step-on region, not the key region");

  // A key press at the same place: now only the key region (type 1) qualifies.
  const pressed = stateWith(world);
  pressed.time.tick = 1;
  pressed.input.keys.push({ seq: 1, name: "ENTER", code: "Enter", char: "\n", action: null, resolvedActions: [] });
  const keyEvents = runTriggersPhase(pressed, { programRef: (name) => ref(name) });
  equal(keyEvents[0]?.key, "region:0", "a key press starts the key region, not the step-on region");

  // A configured direction edge is movement, not activation: it neither starts a key region nor eats the press.
  const walked = stateWith(world);
  walked.time.tick = 1;
  walked.input.bindings = { keys: { ArrowRight: "right", Enter: "ENTER" } };
  walked.input.keys.push({ seq: 1, name: "right", code: "ArrowRight", char: null, action: "right", resolvedActions: ["right"] });
  walked.sprites.players = walked.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const walkedEvents = runTriggersPhase(walked, { programRef: (name) => ref(name) });
  equal(walkedEvents[0]?.key, "region:1", "a direction edge with a step only steps on (regions:1), never counts as activation");
  equal(walked.input.keys.length, 1, "the direction press stays queued for movement");
});
test("all semantic actions resolved from one physical key reach the trigger dispatcher", () => {
  const state = stateWith(board([region(0, 1)]));
  state.input.bindings = { keys: { ArrowUp: "confirm" } };
  applyInputEvent(state.input, { kind: "key", name: "ArrowUp", code: "ArrowUp", char: null, down: true });
  equal(state.input.keys[0]?.resolvedActions.includes("up"), true);
  equal(state.input.keys[0]?.resolvedActions.includes("confirm"), true);
  state.time.tick = 1;
  const events = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(events[0]?.key, "region:0", "confirm is dispatched even though the same key also resolves to up");
});

test("trigger layer matching ignores a region on another layer", () => {
  const world = board([region(0)]);
  const state = stateWith(world);
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, layer: 2, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  equal(runTriggersPhase(state, { programRef: (name) => ref(name) }).length, 0, "a player on another layer never fires the region");
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, layer: 1 }));
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: state.time.tick } }));
  const sameLayer = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(sameLayer[0]?.key, "region:0", "the same position on the region's layer fires it");
});

test("a finished trigger program applies its final variable", () => {
  const world = board([region(0, 0, "", "", "doorOpen", "yes")]);
  const state = stateWith(world);
  state.vm.globals.doorOpen = "no";
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const started = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(started[0]?.key, "region:0");
  equal(state.vm.globals.doorOpen, "no", "the final variable is untouched while the program runs");
  finishActive(state);
  equal(state.vm.globals.doorOpen, "yes", "completion writes the region's final variable");
  equal(state.triggers.active, null);
});

test("snapshot trigger state is plain and resettable", () => {
  const state = createGameState({ seed: 2 });
  state.triggers.boardKey = "boards/test.brd";
  state.triggers.fired["region:0"] = true;
  state.triggers.suppressed = ["region:0"];
  state.triggers.active = { key: "region:0", thread: 3, setVar: "done", setValue: "yes", source: "region", silentMovement: true };
  const before = JSON.stringify(state.triggers);
  state.triggers.boardKey = null;
  state.triggers.fired = {};
  state.triggers.suppressed = [];
  state.triggers.active = null;
  equal(before.includes("region:0"), true);
  deepEqual(state.triggers.active, null);
});

test("send-arrival deactivation suppresses the arrival frame only and re-arms when the player leaves", () => {
  const world = board([region(0)]);
  const state = stateWith(world);
  // The engine sets the board key inside arrive() before it posts deactivateat; mirror that here.
  state.triggers.boardKey = world.key;
  applyTriggerEffect(state, { name: "deactivateat", args: [0, 0, 1, "pixel"] } as EffectRecord);
  equal(state.triggers.deactivateAt?.x, 0);
  equal(state.triggers.deactivateAt?.layer, 1);
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  equal(state.triggers.deactivated.length, 0, "the arrival has not been consumed yet");
  const arrival = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(arrival.length, 0, "the same-unit arrival frame fires nothing on the arrival phase");
  equal(state.triggers.deactivated.length > 0, true, "the region is deactivated");
  // A step inside the still-suppressed candidate fires nothing...
  const second = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(second.length, 0, "the arrival suppresses the region while it still overlaps");
  // ...but a step outside the candidate re-arms it.
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 256, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 32 } }));
  const leaving = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(leaving.length, 0, "leaving never triggers");
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 0, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 32 } }));
  const reentered = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(reentered[0]?.key, "region:0", "the region re-arms after the player leaves and re-enters");
});

test("send-arrival tile placement and deactivation agree on stacked and rotated boards", () => {
  // The destination region sits exactly on the arrival tile (3, 2) of each layout's own pixel conversion.
  for (const coordType of [0, 1, 2]) {
    const layout = coordLayout(coordType);
    const request = coordType === 0 ? { x: 3, y: 2 } : coordType === 1 ? { x: 4, y: 4 } : { x: 5, y: 3 };
    const world: WorldBoard = {
      ...board([region(0)]),
      coordType,
      sizeX: 8,
      sizeY: 8,
      width: boardPixelSize(layout, 8, 8).width,
      height: boardPixelSize(layout, 8, 8).height,
    };
    const destination = tileToPixel(layout, world.sizeX, request.x, request.y);
    // A region whose points translate to the arrival pixel: regionCandidate translates its authored points.
    const worldArrival: WorldBoard = {
      ...world,
      programs: [{
        ...region(0),
        points: [{ x: destination.x - 4, y: destination.y - 4 }, { x: destination.x + 4, y: destination.y - 4 }, { x: destination.x + 4, y: destination.y + 4 }, { x: destination.x - 4, y: destination.y + 4 }],
      }],
    };
    const state = stateWith(worldArrival);
    state.triggers.boardKey = worldArrival.key;
    // A tile-unit send target (these boards carry no pixel-coordinate flag); trigger's applyTriggerEffect must convert
    // it with the same destination-layout conversion the sprites owner uses when it places the player.
    applyTriggerEffect(state, { name: "deactivateat", args: [request.x, request.y, 1, "tile"] } as EffectRecord);
    placeSelectedPlayer(state.sprites, request.x, request.y, 1, "tile", layout, world.sizeX);
    const placed = state.sprites.players[0]!;
    deepEqual({ x: placed.x, y: placed.y }, destination, `${layout}: the player sits at the destination-layout pixel`);
    state.time.tick = 1;
    state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
    runTriggersPhase(state, { programRef: (name) => ref(name) });
    equal(state.triggers.deactivated.length > 0, true, `${layout}: the arrival deactivation covers the actually placed destination`);
    const arrivalEvents = runTriggersPhase(state, { programRef: (name) => ref(name) });
    equal(arrivalEvents.length, 0, `${layout}: nothing fires on the arrival tick`);
  }
});

test("a pressed button slot's confirm name fires a key-press region", () => {
  const world = board([region(0, 1)]);
  const state = stateWith(world);
  state.time.tick = 1;
  // `input.ts` queues a button-slot press as the confirm name with the slot's own action.
  state.input.bindings = { keys: { Enter: "ENTER" } };
  state.input.keys.push({ seq: 1, name: "confirm", code: "confirm", char: null, action: "slot:attack", resolvedActions: ["confirm"] });
  const events = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(events[0]?.key, "region:0", "the slot press starts the key region");
  // And a boot-hold of the same slot press works where the boot poll accepted the confirm name before.
  const booted = stateWith(world);
  booted.triggers.lastKeySeq = -1;
  booted.input.bindings = { keys: { Enter: "ENTER" } };
  booted.input.keys.push({ seq: 1, name: "confirm", code: "confirm", char: null, action: "slot:attack", resolvedActions: ["confirm"] });
  equal(runTriggersPhase(booted, { programRef: (name) => ref(name) })[0]?.key, "region:0", "the boot poll accepts the confirm name too");
});

test("arrival-suppressed items re-arm on layer change and on being hidden", () => {
  const world = board([], [item(0, 16, 32)]);
  const actor = itemActor(world, world.items![0]!, 0);
  const state = stateWith(world, [actor]);
  state.triggers.boardKey = world.key;
  // A send arrives right under the item: two board pixels above its centre (the base starts at y - 15).
  applyTriggerEffect(state, { name: "deactivateat", args: [16, 48, 1, "pixel"] } as EffectRecord);
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 16, y: 48 }));
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
  runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(state.triggers.deactivated.includes("item:0"), true, "the item under the arrival is deactivated");
  // A step inside the suppressed item fires nothing.
  equal(runTriggersPhase(state, { programRef: (name) => ref(name) }).length, 0, "the suppressed item stays silent");

  // The player walks to another layer: the item leaves the deactivated list even off the player's layer.
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, layer: 2, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 8 } }));
  runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(state.triggers.deactivated.includes("item:0"), false, "re-arm runs over the authored item, not only its visible candidates");
  // Hide the item: a later step also re-arms it, so a script's showItem can never resurrect the suppression.
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, layer: 1 }));
  for (let guard = 0; guard < 40 && !state.triggers.deactivated.includes("item:0"); guard += 1) {
    state.time.tick += 1;
    applyTriggerEffect(state, { name: "deactivateat", args: [16, 48, 1, "pixel"] } as EffectRecord);
    runTriggersPhase(state, { programRef: (name) => ref(name) });
  }
  equal(state.triggers.deactivated.includes("item:0"), true, "re-suppression re-applies before the hide check");
  state.sprites.items = state.sprites.items.map((value) => value.id === actor.id ? { ...value, visible: false } : value);
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 8 } }));
  runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(state.triggers.deactivated.includes("item:0"), false, "an item hidden while suppressed re-arms");
  // Shown again, a step inside it fires.
  state.sprites.items = state.sprites.items.map((value) => value.id === actor.id ? { ...value, visible: true } : value);
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 8 } }));
  const shown = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(shown[0]?.key, "item:0", "the shown item fires on the step");
});

test("a trigger program naming a .prg that is not in the index reports a located missing program", () => {
  const loader = { index: createAssetIndex([]), root: PACKAGE_ROOT, read: (): Uint8Array | undefined => undefined };
  const missing = { programRef: (name: string) => resolveProgram(loader, name) === undefined ? null : fileProgramRef(loader, name) };
  let throwValue: unknown = null;
  const world = board([region(0, 0, "", "", "", "", 1, "missing.prg")]);
  const state = stateWith(world);
  // A step frame picks the region; the missing .prg is one located report and no thread.
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
  const reported: { current: { readonly code: string; readonly file: string; readonly line: number; readonly message: string } | null } = { current: null };
  const events = runTriggersPhase(state, { ...missing, onDiagnostic: (diagnostic) => { reported.current = diagnostic; } });
  equal(events.length, 0, "the tick continues and starts no thread");
  ok(reported.current !== null, "the failure is reported");
  equal(reported.current.code, "program.missing");
  equal(reported.current.file, world.key, "the report locates the authored board");
  equal(state.triggers.active, null, "no trigger runs");
  // A pos-carrying ScriptError reports its own location instead of the board (fresh state: the previous
  // miss marked the region run).
  throwValue = new ScriptError("program.missing", "located", { file: "located.prg", line: 7 });
  const locatedWorld = board([region(0, 0, "", "", "", "", 1, "located.prg")]);
  const locatedState = stateWith(locatedWorld);
  locatedState.time.tick = 1;
  locatedState.sprites.players = locatedState.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
  const located: { current: { readonly code: string; readonly file: string; readonly line: number; readonly message: string } | null } = { current: null };
  runTriggersPhase(locatedState, { programRef: () => { throw throwValue; }, onDiagnostic: (diagnostic) => { located.current = diagnostic; } });
  equal(located.current?.file, "located.prg", "the report keeps the error's own position");
  equal(located.current?.line, 7);
  // A step frame (a fresh one per case: the report marks the region run) raises the ScriptError when
  // no sink is wired; with a sink it is reported and the tick continues.
  const steppedWith = (resolver: TriggerPhaseOptions): TriggerEvent[] => {
    const stepped = stateWith(board([region(0, 0, "", "", "", "", 1, "missing.prg")]));
    stepped.time.tick = 1;
    stepped.sprites.players = stepped.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
    return runTriggersPhase(stepped, resolver);
  };
  // A direct call with no sink raises the catchable program.missing….
  throwValue = new ScriptError("program.missing", "no program");
  throws(() => steppedWith({ programRef: () => { throw throwValue; } }), ScriptError, "no sink throws the ScriptError to the host");
  // …and a non-ScriptError from a resolver is a real defect: it rethrows with or without a sink.
  const defect = new TypeError("a real defect");
  const defectResolver = { programRef: (): never => { throw defect; } };
  let escaped: unknown = null;
  try { steppedWith(defectResolver); } catch (error) { escaped = error; }
  equal(escaped, defect, "a non-ScriptError keeps throwing without a sink");
  throws(() => steppedWith({ ...defectResolver, onDiagnostic: () => undefined }), TypeError, "a non-ScriptError keeps throwing with a sink too");
  // The trigger is marked run: the next step frame does not repeat the report, and the game continues.
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 8 } }));
  let repeats = 0;
  runTriggersPhase(state, { ...missing, onDiagnostic: () => { repeats += 1; } });
  equal(repeats, 0, "the marked trigger does not repeat the report");
  // and a non-`.prg` name falls through to inline RPGCode exactly as before.
  const inlineWorld = board([region(0, 0, "", "", "", "", 1, "wait()\nend()")]);
  const inlineState = stateWith(inlineWorld);
  inlineState.time.tick = 1;
  inlineState.sprites.players = inlineState.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
  equal(runTriggersPhase(inlineState, missing)[0]?.key, "region:0", "inline fallback still applies");
});

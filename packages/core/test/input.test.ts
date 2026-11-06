import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  applySemanticActionEdge,
  configureInput,
  createInputSection,
  inputView,
  processGamepadEvents,
  pruneClaimed,
  registeredActionNames,
  registerGameAction,
  heldPointerGoal,
  setPointerMovementSuppressed,
  type InputView,
} from "../src/input/index.ts";
import { createGameState, hashGameState, restoreGameState, snapshot, snapshotGameSave } from "../src/save/index.ts";
import { applyInputEffect } from "../src/script/packs/movement.ts";
import { pollInputKey, pollMenuScreen } from "../src/script/waits.ts";

test("input records have monotonic sequences and claims deliver each key once", () => {
  const state = createInputSection();
  applyInputEvent(state, { kind: "key", name: "A", code: "KeyA", char: "a", down: true });
  applyInputEvent(state, { kind: "key", name: "B", code: "KeyB", char: "b", down: true });
  const first = pollInputKey({ tick: 0, input: inputView(state), claims: [] }, { kind: "input.key", global: true, key: null, parkSeq: 1 });
  if (first === null) throw new Error("expected first key");
  equal(first.value, "A");
  equal(first.discardBefore, 1, "the resolved waiter carries its own park floor to the claim site");
  const second = pollInputKey({ tick: 0, input: inputView(state), claims: [first.claim ?? -1] }, { kind: "input.key", global: true, key: null, parkSeq: 1 });
  if (second === null) throw new Error("expected second key");
  equal(second.value, "B");
  equal(second.discardBefore, 1);
  pruneClaimed(state, [first.claim ?? -1, second.claim ?? -1]);
  equal(pollInputKey({ tick: 1, input: inputView(state), claims: [] }, { kind: "input.key", global: true, key: null, parkSeq: 1 }), null);
});

test("configured keyboard edges and disabled diagonals are deterministic", () => {
  const state = createInputSection({
    bindings: { keys: { ArrowUp: "up", ArrowRight: "right", Enter: "confirm" } },
    allowDiagonals: false,
  });
  applyInputEvent(state, { kind: "key", name: "UP", code: "ArrowUp", char: null, down: true });
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true });
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true, repeat: true });
  equal(state.keys.length, 3);
  equal(state.actions.up, true);
  equal(state.actions.right, true);
  deepEqual(state.directionOrder, ["up", "right"]);
  applyInputEvent(state, { kind: "key", name: "UP", code: "ArrowUp", char: null, down: false });
  equal(state.actions.up, false);
});

test("gamepad dead-zone, merge, device ordering and disconnect share edge state", () => {
  const state = createInputSection({ bindings: { keys: { ArrowRight: "right", Enter: "confirm", Escape: "cancel" } } });
  applyInputEvent(state, { kind: "gamepad", device: 1, connected: true, axes: { x: 250, y: 0 }, buttons: 1 });
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 1 });
  processGamepadEvents(state);
  deepEqual(state.keys.map((key) => key.name), ["cancel", "confirm", "right"]);
  equal(state.actions.right, true);
  equal(state.actions.confirm, true);
  equal(state.actions.cancel, true);
  applyInputEvent(state, { kind: "gamepad", device: 1, connected: true, axes: { x: 249, y: 0 }, buttons: 0 });
  processGamepadEvents(state);
  equal(state.actions.right, false);
  equal(state.actions.confirm, false);
  applyInputEvent(state, { kind: "gamepad", device: 1, connected: false, axes: { x: 0, y: 0 }, buttons: 0 });
  processGamepadEvents(state);
  equal(state.gamepads["1"]?.connected, false);
});
test("same-tick gamepad down and up report both ordered action transitions", () => {
  const state = createInputSection({ bindings: { keys: { Enter: "confirm" } } });
  const transitions: string[] = [];
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 });
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 });
  processGamepadEvents(state, undefined, (action, down, firstSeq) => transitions.push(`${action}:${down}:${firstSeq}`));
  deepEqual(transitions, ["confirm:true:1", "confirm:false:2"]);
  deepEqual(state.keys.map((key) => key.action), ["confirm"]);
  equal(state.actions.confirm, false);
});
test("registered game actions preserve order and semantic source claims emit one compatibility edge", () => {
  const state = createInputSection();
  const fireball = { name: "game.fireball", label: "Fireball", icon: null, group: "Spells", controls: [], locked: false, hidden: false, narration: "Cast" };
  const heal = { name: "game.heal", label: "Heal", icon: null, group: "Spells", controls: [], locked: false, hidden: false };
  equal(registerGameAction(state, fireball), true);
  equal(registerGameAction(state, heal), true);
  equal(registerGameAction(state, { ...fireball, label: "Duplicate" }), false);
  equal(registerGameAction(state, { ...fireball, name: "confirm" }), false);
  deepEqual(state.registeredActions.map((action) => action.name), ["game.fireball", "game.heal"]);
  deepEqual(state.registeredActions[0]?.narration, "Cast");

  const actions = registeredActionNames(state);
  equal(actions.has("confirm"), true);
  equal(actions.has("game.fireball"), true);
  equal(applySemanticActionEdge(state, "game.unknown", true, "runner.fallback", actions), false);
  deepEqual(state.keys, []);
  applyInputEvent(state, { kind: "action", action: "game.fireball", down: true, source: "runner.fallback", modalId: null });
  applyInputEvent(state, { kind: "action", action: "game.fireball", down: true, source: "runner.fallback", modalId: null });
  applyInputEvent(state, { kind: "action", action: "game.fireball", down: true, source: "ui:spellbar/fireball", modalId: null });
  equal(state.actions["game.fireball"], true);
  deepEqual(state.keys.map((key) => key.name), ["game.fireball"]);
  deepEqual(state.pendingActions, ["game.fireball"]);
  applyInputEvent(state, { kind: "action", action: "game.fireball", down: false, source: "runner.fallback", modalId: null });
  equal(state.actions["game.fireball"], true, "another source still holds the action");
  applyInputEvent(state, { kind: "action", action: "game.fireball", down: false, source: "ui:spellbar/fireball", modalId: null });
  equal(state.actions["game.fireball"], false);
  deepEqual(state.keys.map((key) => key.seq), [1]);
});
test("modal-scoped actions stay outside ordinary action and compatibility queues", () => {
  const state = createInputSection();
  applyInputEvent(state, { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: 41 });
  applyInputEvent(state, { kind: "action", action: "confirm", down: false, source: "runner.fallback", modalId: 41 });
  deepEqual(state.keys, []);
  deepEqual(state.pendingActions, []);
  deepEqual(state.actions.confirm, undefined);
  deepEqual(state.modalActions, [{ seq: 1, action: "confirm", modalId: 41 }]);
  pruneClaimed(state, [1]);
  deepEqual(state.modalActions, []);
});

test("game-action keyboard bindings preserve raw Get key identity", () => {
  const state = createInputSection();
  registerGameAction(state, { name: "game.fireball", label: "Fireball", icon: null, group: null, controls: ["key:KeyF"], locked: false, hidden: false });
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  const result = pollInputKey({ tick: 0, input: inputView(state), claims: [] }, { kind: "input.key", global: true, key: null, parkSeq: 1 });
  equal(result?.value, "F");
  equal(state.actions["game.fireball"], true);
});

test("unknown game-action keyboard bindings still deliver the raw key to scripts", () => {
  const state = createInputSection({ bindings: { keys: { KeyF: "game.removed" } } });
  const unknown: string[] = [];
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true }, (action) => unknown.push(action));
  const result = pollInputKey({ tick: 0, input: inputView(state), claims: [] }, { kind: "input.key", global: true, key: null, parkSeq: 1 });
  deepEqual(unknown, ["game.removed"]);
  equal(result?.value, "F");
  equal(state.actions["game.removed"], undefined);
});

test("custom legacy menu key does not diagnose an unknown game action or reopen on repeat", () => {
  const state = createInputSection({ bindings: { keys: { KeyM: "M" } } });
  const unknown: string[] = [];
  applyInputEvent(state, { kind: "key", name: "M", code: "KeyM", char: "m", down: true }, (action) => unknown.push(action));
  applyInputEvent(state, { kind: "key", name: "M", code: "KeyM", char: "m", down: true, repeat: true }, (action) => unknown.push(action));
  deepEqual(unknown, []);
  equal(state.pendingKeySequences.length, 1, "OS repeat remains available to legacy waits but is not a fresh menu gesture");
});
test("keyboard bindings retain independent physical claims for one game action", () => {
  const state = createInputSection();
  const action = { name: "game.dash", label: "Dash", icon: null, group: null, controls: ["key:KeyF", "key:KeyG"], locked: false, hidden: false };
  equal(registerGameAction(state, action), true);
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  applyInputEvent(state, { kind: "key", name: "G", code: "KeyG", char: "g", down: true });
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: false });
  equal(state.actions["game.dash"], true);
  applyInputEvent(state, { kind: "key", name: "G", code: "KeyG", char: "g", down: false });
  equal(state.actions["game.dash"], false);
});
test("letter-name bindings release their physical-code action claim", () => {
  const state = createInputSection({ bindings: { keys: { D: "right" } } });
  applyInputEvent(state, { kind: "key", name: "D", code: "KeyD", char: "d", down: true });
  equal(state.keyboardActionSources.right?.["key:KeyD"], true);
  equal(state.keyboardActionSources.right?.["key:D"], undefined);
  applyInputEvent(state, { kind: "key", name: "D", code: "KeyD", char: "d", down: false });
  equal(state.actions.right, false, "the physical KeyD release clears the action even when its legacy binding is named D");
});
test("mapped and physically bound game actions retain registry order on a shared control", () => {
  const state = createInputSection({ bindings: { keys: { KeyF: "game.first" } } });
  const definition = (name: string, controls: string[]) => ({ name, label: name, icon: null, group: null, controls, locked: false, hidden: false });
  equal(registerGameAction(state, definition("game.first", [])), true);
  equal(registerGameAction(state, definition("game.second", ["key:KeyF"])), true);
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  deepEqual(state.keys[0]?.resolvedActions, ["game.first", "game.second"]);
});

test("a registry with the specified 512 actions dispatches the bound action", () => {
  const state = createInputSection();
  for (let index = 0; index < 512; index += 1) {
    equal(registerGameAction(state, {
      name: `game.action${index}`,
      label: `Action ${index}`,
      icon: null,
      group: null,
      controls: index === 511 ? ["key:KeyF"] : [],
      locked: false,
      hidden: false,
    }), true);
  }
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  equal(state.actions["game.action511"], true);
});
test("a key release visits only actions indexed to that control", () => {
  const state = createInputSection();
  for (let index = 0; index < 512; index += 1) {
    equal(registerGameAction(state, {
      name: `game.action${index}`,
      label: `Action ${index}`,
      icon: null,
      group: null,
      controls: index === 511 ? ["key:KeyF"] : [],
      locked: false,
      hidden: false,
    }), true);
  }
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  for (let index = 0; index < 511; index += 1) {
    Object.defineProperty(state.keyboardActionSources, `game.action${index}`, { value: {}, enumerable: true, configurable: true, writable: true });
  }
  let scannedRegistry = false;
  state.keyboardActionSources = new Proxy(state.keyboardActionSources, {
    ownKeys() {
      scannedRegistry = true;
      throw new Error("key-up scanned every action claim");
    },
  });
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: false });
  equal(state.actions["game.action511"], false);
  equal(scannedRegistry, false, "the release uses only its physical control's reverse index");
});

test("registered keyboard and gamepad controls dispatch without extra key aliases", () => {
  const state = createInputSection();
  const action = { name: "game.fireball", label: "Fireball", icon: null, group: "Spells", controls: ["key:KeyF", "pad:0"], locked: false, hidden: false };
  equal(registerGameAction(state, action), true);
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: true });
  equal(state.actions["game.fireball"], true);
  deepEqual(state.keys.map((key) => key.name), ["F"]);
  applyInputEvent(state, { kind: "key", name: "F", code: "KeyF", char: "f", down: false });
  equal(state.actions["game.fireball"], false);
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 });
  processGamepadEvents(state);
  equal(state.actions.confirm, true, "W3C pad:0 is confirm and the game action binding");
  equal(state.actions["game.fireball"], true);
  deepEqual(state.keys.map((key) => key.name), ["F", "confirm", "game.fireball"]);
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 });
  processGamepadEvents(state);
  equal(state.actions.confirm, false);
  equal(state.actions["game.fireball"], false);
});

test("semantic claims accept prototype-named sources and ignore unbound pad bits", () => {
  const state = createInputSection();
  applyInputEvent(state, { kind: "action", action: "confirm", down: true, source: "__proto__", modalId: null });
  equal(state.actions.confirm, true);
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 16 });
  processGamepadEvents(state);
  applyInputEvent(state, { kind: "action", action: "confirm", down: false, source: "__proto__", modalId: null });
  equal(state.actions.confirm, false);
});

test("action registration refuses non-plain extension metadata without partial mutation", () => {
  const state = createInputSection();
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const action = { name: "game.invalid", label: "Invalid", icon: null, group: null, controls: [], locked: false, hidden: false, metadata: cyclic } as never;
  equal(registerGameAction(state, action), false);
  equal(state.registeredActions.length, 0);
});

test("action registry order is hashed, runtime snapshots restore it, and game saves rebuild it", () => {
  const state = createGameState({ seed: 7 });
  const action = { name: "game.dash", label: "Dash", icon: null, group: "Skills", controls: [], locked: false, hidden: false };
  const before = hashGameState(state);
  equal(registerGameAction(state.input, action), true);
  equal(hashGameState(state) === before, false);
  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.input.registeredActions, [action]);
  const save = JSON.parse(snapshotGameSave(state)) as { input: Record<string, unknown> };
  equal("registeredActions" in save.input, false);
});

test("claimed and out-of-plane pointer gestures do not become held movement goals", () => {
  const state = createInputSection({ pointerPlane: { width: 100, height: 80 } });
  applyInputEvent(state, { kind: "pointer", x: 20, y: 30, buttons: 1 });
  deepEqual(heldPointerGoal(state), { x: 20, y: 30 });
  setPointerMovementSuppressed(state, true);
  equal(heldPointerGoal(state), null);
  setPointerMovementSuppressed(state, false);
  applyInputEvent(state, { kind: "pointer", x: 100, y: 30, buttons: 1 });
  equal(heldPointerGoal(state), null);
});

test("button slots use logical half-open hit tests and click destinations use camera pixels", () => {
  const state = createInputSection({
    buttons: [{ id: "ok", x: 10, y: 20, w: 20, h: 10, action: "confirm", enabled: true }],
    camera: { x: 100, y: 200 },
  });
  applyInputEvent(state, { kind: "pointer", x: 10, y: 20, buttons: 1 });
  applyInputEvent(state, { kind: "pointer", x: 30, y: 30, buttons: 1 });
  applyInputEvent(state, { kind: "pointer", x: 31, y: 30, buttons: 1 });
  deepEqual(state.keys, []);
  deepEqual(state.pendingClicks, [{ gestureId: 1, x: 130, y: 230 }, { gestureId: 1, x: 131, y: 230 }]);
});

test("button slots activate once on release over the pressed target and cancel on departure", () => {
  const state = createInputSection({ buttons: [
    { id: "ok", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: true },
    { id: "no", x: 10, y: 0, w: 10, h: 10, action: "cancel", enabled: true },
    { id: "disabled", x: 20, y: 0, w: 10, h: 10, action: "menu", enabled: false },
  ] });
  const pointer = (x: number, buttons: number): void => applyInputEvent(state, { kind: "pointer", x, y: 5, buttons });
  pointer(5, 1);
  deepEqual([state.keys, state.pendingActions], [[], []]);
  pointer(10, 1);
  pointer(5, 0);
  deepEqual([state.keys, state.pendingActions], [[], []]);
  pointer(5, 1);
  pointer(5, 3);
  pointer(5, 1);
  pointer(5, 0);
  pointer(5, 0);
  deepEqual(state.keys.map((key) => key.name), ["confirm"]);
  deepEqual(state.pendingActions, ["confirm"]);
  pointer(25, 1);
  pointer(25, 0);
  pointer(5, 1);
  applyInputEvent(state, { kind: "focus", state: "lost" });
  pointer(5, 0);
  equal(state.keys.length, 1);
  pointer(5, 1);
  configureInput(state, { buttons: [{ id: "ok", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: false }] });
  configureInput(state, { buttons: [{ id: "ok", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: true }] });
  pointer(5, 0);
  equal(state.keys.length, 1);
});

test("pointer cancellation clears only the primary bit and pending slot without a release edge", () => {
  const game = createGameState({ seed: 7 });
  game.input = createInputSection({
    bindings: { keys: { ArrowUp: "up" } },
    buttons: [{ id: "ok", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: true }],
  });
  applyInputEvent(game.input, { kind: "key", name: "UP", code: "ArrowUp", char: null, down: true });
  applyInputEvent(game.input, { kind: "pointer", x: 5, y: 5, buttons: 3 });
  const beforeCancel = {
    pointer: { ...game.input.pointer },
    keys: [...game.input.keys],
    pendingActions: [...game.input.pendingActions],
    pendingClicks: [...game.input.pendingClicks],
  };
  equal(game.input.pressedButtonSlot, "ok");

  applyInputEvent(game.input, { kind: "pointer.cancel" });
  deepEqual(game.input.pointer, { ...beforeCancel.pointer, buttons: 2 });
  equal(game.input.pointer.ups, beforeCancel.pointer.ups, "cancel is not a pointer-up edge");
  equal(game.input.pressedButtonSlot, null);
  deepEqual(game.input.keys, beforeCancel.keys);
  deepEqual(game.input.pendingActions, beforeCancel.pendingActions);
  deepEqual(game.input.pendingClicks, beforeCancel.pendingClicks);
  equal(game.input.held.ArrowUp, true, "keyboard controls remain held");
  equal(game.input.actions.up, true);

  const restored = restoreGameState(snapshot(game));
  deepEqual(restored.input, game.input, "save/restore preserves the cancelled gesture and remaining button bits");
  applyInputEvent(restored.input, { kind: "pointer", x: 5, y: 5, buttons: 2 });
  deepEqual(restored.input.pendingActions, beforeCancel.pendingActions);
  deepEqual(restored.input.keys, beforeCancel.keys);
});

test("pointer cancellation emits no click request", () => {
  const state = createInputSection({ camera: { x: 100, y: 200 } });
  applyInputEvent(state, { kind: "pointer", x: 30, y: 40, buttons: 1 });
  const clicks = [...state.pendingClicks];
  applyInputEvent(state, { kind: "pointer.cancel" });
  deepEqual(state.pendingClicks, [], "cancellation drops only the gesture's uncommitted movement points");
  deepEqual(state.pointer.buttons, 0);
});

test("button slot presses survive snapshots; old input sections migrate without a press", () => {
  const state = createGameState({ seed: 7 });
  state.input = createInputSection({ buttons: [{ id: "ok", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: true }] });
  applyInputEvent(state.input, { kind: "pointer", x: 5, y: 5, buttons: 1 });
  const restored = restoreGameState(snapshot(state));
  const withoutPress = restoreGameState(snapshot(state));
  withoutPress.input.pressedButtonSlot = null;
  equal(hashGameState(withoutPress) === hashGameState(state), false, "the pending slot changes the state hash");
  equal(hashGameState(restored), hashGameState(state), "snapshot restore preserves the pending slot hash");
  applyInputEvent(restored.input, { kind: "pointer", x: 5, y: 5, buttons: 0 });
  deepEqual(restored.input.pendingActions, ["confirm"]);
  const raw = JSON.parse(snapshot(state));
  raw.schema.input = 3;
  raw.input.version = 3;
  delete raw.input.pressedButtonSlot;
  const migrated = restoreGameState(JSON.stringify(raw));
  applyInputEvent(migrated.input, { kind: "pointer", x: 5, y: 5, buttons: 0 });
  deepEqual(migrated.input.pendingActions, []);
});

test("clearing and recreating a pressed button does not resurrect its press", () => {
  const state = createGameState({ seed: 7 });
  applyInputEffect(state, "setbutton", ["", "ok", 0, 0, 10, 10]);
  applyInputEvent(state.input, { kind: "pointer", x: 5, y: 5, buttons: 1 });
  applyInputEffect(state, "clearbuttons", ["ok"]);
  applyInputEffect(state, "setbutton", ["", "ok", 0, 0, 10, 10]);
  applyInputEvent(state.input, { kind: "pointer", x: 5, y: 5, buttons: 0 });
  deepEqual(state.input.pendingActions, []);
  deepEqual(state.input.keys, []);
});

test("extended input section snapshots restore exactly", () => {
  const state = createGameState({ seed: 7 });
  state.input = createInputSection({
    bindings: { keys: { ArrowUp: "up" } },
    allowDiagonals: true,
    buttons: [{ id: "go", x: 1, y: 2, w: 3, h: 4, action: "confirm", enabled: true }],
  });
  applyInputEvent(state.input, { kind: "key", name: "UP", code: "ArrowUp", char: null, down: true });
  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.input, state.input);
});

test("focus and held state are owned by the input section", () => {
  const state = createInputSection();
  applyInputEvent(state, { kind: "key", name: "LEFT", code: "ArrowLeft", char: null, down: true });
  equal(state.held.LEFT, true);
  equal(state.held.ArrowLeft, true);
  applyInputEvent(state, { kind: "focus", state: "lost" });
  equal(state.focused, false);
  applyInputEvent(state, { kind: "focus", state: "gained" });
  equal(state.focused, true);
  deepEqual(state.pointer, { x: 0, y: 0, buttons: 0, downs: 0, ups: 0, downX: 0, downY: 0, button: 0 });
});

const GAMEPAD_RIGHT = { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 15 } as const;

function steeringSection(): InputView {
  return createInputSection({
    bindings: { keys: { ArrowRight: "right", ArrowDown: "down", Enter: "confirm" } },
    allowDiagonals: false,
  });
}

test("focus loss releases every held keyboard key exactly as its key-up would, and queues no press edge", () => {
  const released = steeringSection();
  const blurred = steeringSection();
  for (const state of [released, blurred]) {
    applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true });
    applyInputEvent(state, { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: true });
    applyInputEvent(state, { kind: "key", name: "ENTER", code: "Enter", char: null, down: true });
    deepEqual(state.directionOrder, ["right", "down"]);
  }
  for (const [name, code] of [["RIGHT", "ArrowRight"], ["DOWN", "ArrowDown"], ["ENTER", "Enter"]] as const) {
    applyInputEvent(released, { kind: "key", name, code, char: null, down: false });
  }
  applyInputEvent(blurred, { kind: "focus", state: "lost" });

  equal(blurred.focused, false);
  deepEqual({ ...blurred, focused: true }, released, "the only difference from three key-ups is the focus flag");
  deepEqual(blurred.actions, { right: false, down: false, confirm: false, menu: false });
  deepEqual(blurred.keyboardActions, { right: false, down: false, confirm: false, menu: false });
  deepEqual(blurred.directionOrder, []);
  equal(blurred.held.ArrowRight, false);
  equal(blurred.held.RIGHT, false);
  equal(blurred.pendingActions.length, 4, "direction, confirm and menu press edges were queued once; the blur adds none");
});

test("focus loss releases held keys of an unbound keyboard too", () => {
  const state = createInputSection();
  applyInputEvent(state, { kind: "key", name: "LEFT", code: "ArrowLeft", char: null, down: true });
  equal(state.held.LEFT, true);
  applyInputEvent(state, { kind: "focus", state: "lost" });
  equal(state.held.LEFT, false);
  equal(state.held.ArrowLeft, false);
  applyInputEvent(state, { kind: "focus", state: "gained" });
  equal(state.held.LEFT, false, "regaining focus does not bring the key back");
});

test("focus loss leaves an action a connected gamepad holds held; it follows the device, not the keyboard", () => {
  const state = steeringSection();
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true });
  applyInputEvent(state, GAMEPAD_RIGHT);
  processGamepadEvents(state);
  equal(state.actions.right, true);

  applyInputEvent(state, { kind: "focus", state: "lost" });
  equal(state.keyboardActions.right, false, "the keyboard half is released");
  equal(state.actions.right, true, "the pad still holds Right");
  deepEqual(state.directionOrder, ["right"]);

  applyInputEvent(state, { kind: "focus", state: "gained" });
  applyInputEvent(state, { ...GAMEPAD_RIGHT, buttons: 0 });
  processGamepadEvents(state);
  equal(state.actions.right, false, "the pad's own release ends it");
});

test("a host auto-repeat of a key core does not hold is not a press and marks nothing held", () => {
  const state = steeringSection();
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true });
  applyInputEvent(state, { kind: "focus", state: "lost" });
  applyInputEvent(state, { kind: "focus", state: "gained" });
  const before: InputView = JSON.parse(JSON.stringify(state));

  // The key is still physically down, so the host keeps repeating it into the refocused window.
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true, repeat: true });
  deepEqual(state, before);
  // A later device record recomputes every action from its sources; it must not resurrect the repeated key.
  applyInputEvent(state, { ...GAMEPAD_RIGHT, buttons: 0 });
  processGamepadEvents(state);
  equal(state.actions.right, false);

  // A repeat of a key core does hold stays a no-op, as before.
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true });
  const edges = state.pendingActions.length;
  applyInputEvent(state, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true, repeat: true });
  equal(state.pendingActions.length, edges);
  equal(state.actions.right, true);
});

test("a focus loss changes values only: the saved input section keeps its shape and round-trips exactly", () => {
  const fresh = Object.keys(steeringSection()).sort();
  const state = createGameState({ seed: 7 });
  state.input = steeringSection();
  applyInputEvent(state.input, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true });
  applyInputEvent(state.input, { kind: "focus", state: "lost" });

  deepEqual(Object.keys(state.input).sort(), fresh);
  equal(state.input.version, 10);
  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.input, state.input);
  deepEqual(Object.keys(restored.input).sort(), fresh);
});

const FRESH_POINTER = { x: 0, y: 0, buttons: 0, downs: 0, ups: 0, downX: 0, downY: 0, button: 0 };

test("the pointer record counts every press and release edge, even stamped to one tick", () => {
  const state = createInputSection();
  deepEqual(state.pointer, FRESH_POINTER);
  // A stalled host delivers the press and the release together; both edges must survive.
  applyInputEvent(state, { kind: "pointer", x: 40, y: 50, buttons: 1 });
  applyInputEvent(state, { kind: "pointer", x: 44, y: 52, buttons: 0 });
  deepEqual(state.pointer, { x: 44, y: 52, buttons: 0, downs: 1, ups: 1, downX: 40, downY: 50, button: 1 });
  // A move with the buttons unchanged is no edge.
  applyInputEvent(state, { kind: "pointer", x: 60, y: 70, buttons: 0 });
  equal(state.pointer.downs + state.pointer.ups, 2);
  // The secondary button is its own edge and names itself in `button`.
  applyInputEvent(state, { kind: "pointer", x: 60, y: 70, buttons: 2 });
  applyInputEvent(state, { kind: "pointer", x: 61, y: 70, buttons: 0 });
  deepEqual(state.pointer, { x: 61, y: 70, buttons: 0, downs: 2, ups: 2, downX: 60, downY: 70, button: 2 });
  // Two buttons that change in one event are handled lowest bit first, so `button` ends on the higher one.
  applyInputEvent(state, { kind: "pointer", x: 1, y: 2, buttons: 3 });
  deepEqual([state.pointer.downs, state.pointer.button], [4, 2]);
});

test("a focus loss releases the buttons without counting a release", () => {
  const state = createInputSection();
  applyInputEvent(state, { kind: "pointer", x: 5, y: 6, buttons: 1 });
  applyInputEvent(state, { kind: "focus", state: "lost" });
  deepEqual(state.pointer, { x: 5, y: 6, buttons: 0, downs: 1, ups: 0, downX: 5, downY: 6, button: 1 });
});

test("the pointer record round-trips a snapshot and a version-2 section migrates with zeroed counters", () => {
  const state = createGameState({ seed: 7 });
  state.input = createInputSection({ bindings: { keys: { ArrowUp: "up" } } });
  applyInputEvent(state.input, { kind: "pointer", x: 9, y: 8, buttons: 1 });
  deepEqual(restoreGameState(snapshot(state)).input, state.input);

  const raw = JSON.parse(snapshot(state)) as { schema: Record<string, number>; input: Record<string, unknown> };
  raw.schema.input = 2;
  raw.input.version = 2;
  raw.input.pointer = { x: 9, y: 8, buttons: 1 };
  delete raw.input.nextPointerGestureId;
  delete raw.input.pointerGestureId;
  raw.input.pendingClicks = [{ x: 9, y: 8 }];
  delete raw.input.pendingPointerUps;
  const migrated = restoreGameState(JSON.stringify(raw)).input;
  deepEqual(migrated.pointer, { x: 9, y: 8, buttons: 1, downs: 0, ups: 0, downX: 0, downY: 0, button: 0 });
  equal(migrated.pointerGestureId, 0, "an old snapshot's held primary pointer remains releasable");
  equal(migrated.nextPointerGestureId, 1);
  applyInputEvent(migrated, { kind: "pointer", x: 9, y: 8, buttons: 0 });
  deepEqual(migrated.pendingPointerUps, [{ gestureId: 0, x: 9, y: 8 }]);
  equal(migrated.version, 10);
  deepEqual(migrated.bindings, state.input.bindings, "a version-2 section keeps every other field");
});

test("pointer-up interaction candidates are tick state and v5 snapshots migrate them empty", () => {
  const state = createGameState({ seed: 7 });
  state.input = createInputSection();
  applyInputEvent(state.input, { kind: "pointer", x: 9, y: 8, buttons: 1 });
  applyInputEvent(state.input, { kind: "pointer", x: 12, y: 14, buttons: 0 });
  deepEqual(state.input.pendingPointerUps, [{ gestureId: 1, x: 12, y: 14 }]);
  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  deepEqual(restored.input, state.input);
  equal(hashGameState(restored), hashGameState(state));
  const withoutTap = restoreGameState(saved);
  withoutTap.input.pendingPointerUps = [];
  equal(hashGameState(withoutTap) === hashGameState(state), false, "pending release work participates in the state hash");

  const raw = JSON.parse(saved) as { schema: Record<string, number>; input: Record<string, unknown> };
  raw.schema.input = 5;
  raw.input.version = 5;
  delete raw.input.pendingPointerUps;
  const migrated = restoreGameState(JSON.stringify(raw));
  deepEqual(migrated.input.pendingPointerUps, [], "a v5 save has no release work to replay");
});

const BASE = { x: 0, y: 0, buttons: 0, downs: 0, ups: 0 };

test("waitInput wakes for a key before the pointer and reports the baseline so the pointer change is not lost", () => {
  const state = createInputSection();
  const wait = { kind: "input.key" as const, global: true, key: null, parkSeq: 1, pointer: { ...BASE } };
  equal(pollInputKey({ tick: 0, input: inputView(state), claims: [] }, wait), null, "nothing changed");
  applyInputEvent(state, { kind: "pointer", x: 7, y: 9, buttons: 1 });
  applyInputEvent(state, { kind: "key", name: "A", code: "KeyA", char: "a", down: true });
  const key = pollInputKey({ tick: 1, input: inputView(state), claims: [] }, wait);
  deepEqual(key?.record, { kind: "key", key: "A", ...BASE, downx: 7, downy: 9, button: 1, moved: 0, newdowns: 0, newups: 0 });
  equal(key?.claim, 1, "the key is claimed like wait() claims it");
  const pointer = pollInputKey({ tick: 1, input: inputView(state), claims: [1] }, wait);
  deepEqual(pointer?.record, { kind: "pointer", key: "", x: 7, y: 9, buttons: 1, downs: 1, ups: 0, downx: 7, downy: 9, button: 1, moved: 1, newdowns: 1, newups: 0 });
  const settled = pollInputKey({ tick: 2, input: inputView(state), claims: [1] }, { ...wait, pointer: { x: 7, y: 9, buttons: 1, downs: 1, ups: 0 } });
  equal(settled, null, "a baseline equal to the record waits again");
});

test("a native menu wait wakes for a pointer change against its parked baseline", () => {
  const state = createInputSection();
  const wait = (pointer: unknown) => ({ kind: "menu.screen" as const, global: true, id: "p", resumeRefs: [], payload: [{ providerId: "p", screen: "main", state: null, phase: "input", childScreen: null, parkSeq: 1, pointer }] as never });
  const baseline = { ...BASE };
  equal(pollMenuScreen({ tick: 0, input: inputView(state), claims: [] }, wait(baseline)), null);
  applyInputEvent(state, { kind: "pointer", x: 3, y: 4, buttons: 0 });
  const moved = pollMenuScreen({ tick: 1, input: inputView(state), claims: [] }, wait(baseline));
  deepEqual(moved?.record, { x: 3, y: 4, buttons: 0, downs: 0, ups: 0, downx: 0, downy: 0, button: 0, moved: 1, newdowns: 0, newups: 0 });
  applyInputEvent(state, { kind: "key", name: "ENTER", code: "Enter", char: null, down: true });
  const tie = pollMenuScreen({ tick: 1, input: inputView(state), claims: [] }, wait(baseline));
  equal(tie?.value, "ENTER", "a key wins a same-tick tie");
  equal(tie?.record, undefined);
});

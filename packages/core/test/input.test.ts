import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  createInputSection,
  inputView,
  processGamepadEvents,
  pruneClaimed,
  type InputView,
} from "../src/input/index.ts";
import { createGameState, restoreGameState, snapshot } from "../src/save/index.ts";
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
  equal(state.keys.length, 2);
  equal(state.actions.up, true);
  equal(state.actions.right, true);
  deepEqual(state.directionOrder, ["up", "right"]);
  applyInputEvent(state, { kind: "key", name: "UP", code: "ArrowUp", char: null, down: false });
  equal(state.actions.up, false);
});

test("gamepad dead-zone, merge, device ordering and disconnect share edge state", () => {
  const state = createInputSection({ bindings: { keys: { ArrowRight: "right", Enter: "confirm", Escape: "cancel" } } });
  applyInputEvent(state, { kind: "gamepad", device: 1, connected: true, axes: { x: 250, y: 0 }, buttons: 16 });
  applyInputEvent(state, { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 32 });
  processGamepadEvents(state);
  deepEqual(state.keys.map((key) => key.name), ["cancel", "right", "confirm"]);
  equal(state.actions.right, true);
  equal(state.actions.confirm, true);
  equal(state.actions.cancel, true);
  applyInputEvent(state, { kind: "gamepad", device: 1, connected: true, axes: { x: 249, y: 0 }, buttons: 0 });
  processGamepadEvents(state);
  equal(state.actions.right, false);
  applyInputEvent(state, { kind: "gamepad", device: 1, connected: false, axes: { x: 0, y: 0 }, buttons: 0 });
  processGamepadEvents(state);
  equal(state.gamepads["1"]?.connected, false);
});

test("button slots use logical half-open hit tests and click destinations use camera pixels", () => {
  const state = createInputSection({
    buttons: [{ id: "ok", x: 10, y: 20, w: 20, h: 10, action: "confirm", enabled: true }],
    camera: { x: 100, y: 200 },
  });
  applyInputEvent(state, { kind: "pointer", x: 10, y: 20, buttons: 1 });
  applyInputEvent(state, { kind: "pointer", x: 30, y: 30, buttons: 1 });
  applyInputEvent(state, { kind: "pointer", x: 31, y: 30, buttons: 1 });
  deepEqual(state.keys.map((key) => key.name), ["confirm"]);
  deepEqual(state.pendingClicks, [{ x: 130, y: 230 }, { x: 131, y: 230 }]);
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

const GAMEPAD_RIGHT = { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 8 } as const;

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
  deepEqual(blurred.actions, { right: false, down: false, confirm: false });
  deepEqual(blurred.keyboardActions, { right: false, down: false, confirm: false });
  deepEqual(blurred.directionOrder, []);
  equal(blurred.held.ArrowRight, false);
  equal(blurred.held.RIGHT, false);
  equal(blurred.pendingActions.length, 3, "the three press edges were queued once, at the presses; the blur adds none");
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
  equal(state.input.version, 3);
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
  const migrated = restoreGameState(JSON.stringify(raw)).input;
  deepEqual(migrated.pointer, { x: 9, y: 8, buttons: 1, downs: 0, ups: 0, downX: 0, downY: 0, button: 0 });
  equal(migrated.version, 3);
  deepEqual(migrated.bindings, state.input.bindings, "a version-2 section keeps every other field");
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

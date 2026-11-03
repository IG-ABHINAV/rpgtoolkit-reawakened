/** Deterministic input owner for keyboard, pointer and normalized gamepad data. */
import type { InputEvent, GamepadInput, KeyInput, PointerInput } from "../ports/input.ts";
import type { InputBindings, InputButton, InputButtonSlot, InputGamepad, InputKeyState, InputSection } from "../save/sections/input.ts";

export type InputKey = InputKeyState;
export type InputAction = string;
export type InputView = InputSection;
export type InputConfig = {
  readonly bindings?: InputBindings;
  readonly allowDiagonals?: boolean;
  readonly buttons?: readonly InputButton[];
  readonly camera?: { readonly x: number; readonly y: number };
  readonly playerId?: string | null;
  readonly pathMode?: 1 | 2 | 3;
};

const GAMEPAD_BITS: readonly string[] = ["up", "down", "left", "right", "confirm", "cancel", "menu"];
const DIRECTIONS: Readonly<Record<string, true>> = { up: true, down: true, left: true, right: true };

export function createInputSection(config: InputConfig = {}): InputSection {
  const state: InputSection = {
    version: 3,
    nextSeq: 1,
    keys: [],
    held: {},
    pointer: { x: 0, y: 0, buttons: 0, downs: 0, ups: 0, downX: 0, downY: 0, button: 0 },
    focused: true,
    buttons: [],
    bindings: { keys: {} },
    allowDiagonals: config.allowDiagonals ?? false,
    camera: { x: 0, y: 0 },
    playerId: config.playerId ?? null,
    pathMode: config.pathMode ?? 1,
    gamepads: {},
    keyboardActions: {},
    actions: {},
    directionOrder: [],
    pendingActions: [],
    pendingClicks: [],
    pendingGamepads: [],
  };
  configureInput(state, config);
  return state;
}

export function configureInput(state: InputSection, config: InputConfig): void {
  if (config.bindings !== undefined) state.bindings = { keys: { ...config.bindings.keys } };
  if (config.allowDiagonals !== undefined) state.allowDiagonals = config.allowDiagonals;
  if (config.buttons !== undefined) state.buttons = config.buttons.map((button) => ({ ...button }));
  if (config.camera !== undefined) state.camera = { x: config.camera.x, y: config.camera.y };
  if (config.playerId !== undefined) state.playerId = config.playerId;
  if (config.pathMode !== undefined) state.pathMode = config.pathMode;
}

export function inputView(state: InputSection): InputView {
  return state;
}

function mappedAction(state: InputSection, event: KeyInput): string | undefined {
  return state.bindings.keys[event.code] ?? state.bindings.keys[event.name];
}

function appendKey(state: InputSection, name: string, code: string, char: string | null, action?: string): void {
  const seq = state.nextSeq;
  state.nextSeq += 1;
  state.keys.push({ seq, name, code, char, ...(action === undefined ? {} : { action }) });
}

function boundActions(state: InputSection): Set<string> {
  return new Set(Object.values(state.bindings.keys));
}

function maskForGamepad(event: Pick<GamepadInput, "axes" | "buttons">): number {
  let mask = event.buttons & 0x7f;
  if (Math.abs(event.axes.x) >= 250) mask |= event.axes.x < 0 ? 4 : 8;
  if (Math.abs(event.axes.y) >= 250) mask |= event.axes.y < 0 ? 1 : 2;
  return mask;
}

function actionHeldFromPads(state: InputSection, action: string): boolean {
  const bit = GAMEPAD_BITS.indexOf(action);
  if (bit < 0) return false;
  for (const pad of Object.values(state.gamepads)) if (pad.connected && (pad.mask & (1 << bit)) !== 0) return true;
  return false;
}

function setDirectionOrder(state: InputSection, action: string, pressed: boolean): void {
  if (DIRECTIONS[action] !== true) return;
  if (pressed) state.directionOrder = [...state.directionOrder.filter((value) => value !== action), action];
  else state.directionOrder = state.directionOrder.filter((value) => value !== action);
}

function updateAction(state: InputSection, action: string, emitEdge: boolean, code: string): void {
  if (!boundActions(state).has(action)) return;
  const previous = state.actions[action] === true;
  const current = state.keyboardActions[action] === true || actionHeldFromPads(state, action);
  state.actions[action] = current;
  if (current === previous) return;
  setDirectionOrder(state, action, current);
  if (current && emitEdge) {
    appendKey(state, action, code, null, action);
    state.pendingActions.push(action);
  }
}

function updateAllActions(state: InputSection, emitEdges: boolean, code: string): void {
  const actions = new Set(Object.values(state.bindings.keys));
  for (const action of GAMEPAD_BITS) if (boundActions(state).has(action)) actions.add(action);
  const ordered = [...actions].sort((left, right) => {
    const leftBit = GAMEPAD_BITS.indexOf(left);
    const rightBit = GAMEPAD_BITS.indexOf(right);
    if (leftBit >= 0 && rightBit >= 0) return leftBit - rightBit;
    if (leftBit >= 0) return -1;
    if (rightBit >= 0) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const action of ordered) updateAction(state, action, emitEdges, code);
}

function applyKey(state: InputSection, event: KeyInput): void {
  // A host auto-repeat of a key core does not hold — for example one still physically down after a focus loss
  // released it (rule 4) — is not a press, and must not mark the key held behind its action's back.
  if (event.down && event.repeat === true && state.held[event.name] !== true) return;
  const priorRaw = state.held[event.name] === true;
  state.held[event.name] = event.down;
  if (event.code !== event.name) state.held[event.code] = event.down;
  const action = mappedAction(state, event);
  if (action === undefined) {
    if (Object.keys(state.bindings.keys).length > 0) return;
    if (event.down && !event.repeat && !priorRaw) appendKey(state, event.name, event.code, event.char);
    return;
  }
  state.keyboardActions[action] = event.down;
  if (event.down && event.repeat) return;
  if (event.down && priorRaw) return;
  updateAction(state, action, true, event.code);
}

/**
 * Focus loss releases every held keyboard key (docs/spec/engine/display-input-audio.md#reawakened-held-direction-movement
 * rule 4; issue #1120). A host delivers a key-up only to the focused window, so a key released while
 * unfocused is never reported. Each held key takes exactly the state change its key-up would make — the raw
 * flag, the keyboard half of its action, the action and the direction order — and queues no press edge.
 * Actions a connected gamepad holds stay held: that is device state and follows the device's own records.
 * The held mouse buttons are released the same way (issue #1169): the button-up is likewise never reported to an
 * unfocused window, and a stale held button would otherwise walk the player towards the cursor after refocus.
 */
function releaseHeld(state: InputSection): void {
  for (const name of Object.keys(state.held)) if (state.held[name] === true) state.held[name] = false;
  for (const action of Object.keys(state.keyboardActions)) if (state.keyboardActions[action] === true) state.keyboardActions[action] = false;
  updateAllActions(state, false, "focus");
  state.pointer = { ...state.pointer, buttons: 0 };
}

function slotAt(state: InputSection, x: number, y: number): InputButtonSlot | undefined {
  return state.buttons.find((button): button is InputButtonSlot => "id" in button && x >= button.x && x < button.x + button.w && y >= button.y && y < button.y + button.h);
}

/**
 * The board point the held left button points at, or `null` when it is up or over an on-screen button slot
 * (docs/spec/engine/display-input-audio.md#reawakened-click-movement-freeze). Core polls this on the idle input
 * phase; it adds no state, because the pointer record already holds the last position and buttons.
 */
export function heldPointerGoal(state: InputSection): { x: number; y: number } | null {
  if ((state.pointer.buttons & 1) === 0 || slotAt(state, state.pointer.x, state.pointer.y) !== undefined) return null;
  return { x: state.pointer.x + state.camera.x, y: state.pointer.y + state.camera.y };
}

/** The pointer record after one `pointer` event: position and buttons, then one edge per changed button bit, lowest bit first. */
function pointerAfter(previous: InputSection["pointer"], event: PointerInput): InputSection["pointer"] {
  const next = { ...previous, x: event.x, y: event.y, buttons: event.buttons };
  for (let bit = 1; bit <= 4; bit *= 2) {
    const was = (previous.buttons & bit) !== 0;
    const now = (event.buttons & bit) !== 0;
    if (!was && now) {
      next.downs += 1;
      next.downX = event.x;
      next.downY = event.y;
      next.button = bit;
    } else if (was && !now) {
      next.ups += 1;
      next.button = bit;
    }
  }
  return next;
}

function applyPointer(state: InputSection, event: PointerInput): void {
  state.pointer = pointerAfter(state.pointer, event);
  if ((event.buttons & 1) === 0) return;
  const slot = slotAt(state, event.x, event.y);
  if (slot !== undefined) {
    if (slot.enabled) {
      appendKey(state, slot.action, `button:${slot.id}`, null, `slot:${slot.id}`);
      state.pendingActions.push(slot.action);
    }
    return;
  }
  state.pendingClicks.push({ x: event.x + state.camera.x, y: event.y + state.camera.y });
}

/** Apply one raw event. Gamepad events are staged for deterministic device ordering. */
export function applyInputEvent(state: InputSection, event: InputEvent): void {
  switch (event.kind) {
    case "key": applyKey(state, event); return;
    case "pointer": applyPointer(state, event); return;
    case "gamepad": state.pendingGamepads.push(event); return;
    case "focus":
      state.focused = event.state === "gained";
      if (!state.focused) releaseHeld(state);
      return;
    case "asset":
    case "blob.loaded":
    case "blob.saved":
    case "blob.listed":
    case "extension.result":
    case "audio.ended":
    case "video.ended": return;
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

/** Apply staged pads in device order and clear the per-tick staging area. */
export function processGamepadEvents(state: InputSection): void {
  const events = state.pendingGamepads.map((event, index) => ({ event, index })).sort((left, right) => left.event.device - right.event.device || left.index - right.index);
  state.pendingGamepads = [];
  for (const { event } of events) {
    if (!Number.isInteger(event.device) || event.device < 0 || event.device > 3) continue;
    if (!event.connected) {
      const prior = state.gamepads[String(event.device)];
      if (prior === undefined || !prior.connected) continue;
      prior.connected = false;
      prior.mask = 0;
      updateAllActions(state, true, `gamepad:${event.device}`);
      continue;
    }
    if (!Number.isInteger(event.axes.x) || !Number.isInteger(event.axes.y)) continue;
    const prior: InputGamepad = state.gamepads[String(event.device)] ?? { connected: true, mask: 0 };
    prior.connected = true;
    prior.mask = maskForGamepad(event);
    state.gamepads[String(event.device)] = prior;
    updateAllActions(state, true, `gamepad:${event.device}`);
  }
}

/** Consume pending action edges and click destinations; registration owns movement calls. */
export function takeInputActions(state: InputSection): { actions: string[]; clicks: { x: number; y: number }[] } {
  const result = { actions: state.pendingActions, clicks: state.pendingClicks };
  state.pendingActions = [];
  state.pendingClicks = [];
  return result;
}

/** Add every queued key older than a waiter's park floor to the shared claim set. */
export function claimInputBefore(state: InputSection, floor: number, claims: number[]): void {
  for (const key of state.keys) {
    if (key.seq < floor && !claims.includes(key.seq)) claims.push(key.seq);
  }
}

/** Remove only claims made by the engine; an unclaimed key remains for later waiters. */
export function pruneClaimed(state: InputSection, claimed: readonly number[]): void {
  if (claimed.length === 0) return;
  const used = new Set(claimed);
  state.keys = state.keys.filter((key) => !used.has(key.seq));
}

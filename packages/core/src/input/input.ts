/** Deterministic input owner for keyboard, pointer and normalized gamepad data. */
import type { InputEvent, GamepadInput, KeyInput, PointerInput } from "../ports/input.ts";
import type { InputBindings, InputButton, InputButtonSlot, InputGamepad, InputKeyState, InputSection, RegisteredAction } from "../save/sections/input.ts";

import { canon } from "../canon/canon.ts";
import type { PlainData } from "../ports/plain-data.ts";
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
  readonly pointerPlane?: { readonly width: number; readonly height: number };
};

const ENGINE_ACTIONS = new Set(["up", "down", "left", "right", "confirm", "cancel", "menu"]);
const ENGINE_PAD_ACTIONS: Readonly<Record<number, string>> = {
  0: "confirm", 1: "cancel", 9: "menu", 12: "up", 13: "down", 14: "left", 15: "right",
  17: "left", 18: "right", 19: "up", 20: "down",
};
const ENGINE_PAD_MASKS: Readonly<Record<string, number>> = {
  confirm: 1 << 0, cancel: 1 << 1, menu: 1 << 9,
  up: (1 << 12) | (1 << 19), down: (1 << 13) | (1 << 20),
  left: (1 << 14) | (1 << 17), right: (1 << 15) | (1 << 18),
};
const LEGACY_ACTION_ALIASES: Readonly<Record<string, string>> = { ENTER: "menu", ESC: "cancel", " ": "confirm", SPACE: "confirm" };
const DEFAULT_KEY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  ArrowUp: ["up"], ArrowDown: ["down"], ArrowLeft: ["left"], ArrowRight: ["right"],
  Enter: ["confirm", "menu"], Space: ["confirm"], Escape: ["cancel"],
};
const DIRECTIONS: Readonly<Record<string, true>> = { up: true, down: true, left: true, right: true };

// Reverse index for physical keyboard claims. It is derived from saved action→source
// claims and deliberately stays out of canonical state; ordinary key-up dispatch reads
// only the actions claimed by that one control, never every action held in the game.
const keyboardClaimsByControl = new WeakMap<InputSection, Map<string, Set<string>>>();

/** Rebuild the derived per-control claim index after a snapshot restore. */
export function rebuildKeyboardActionClaimIndex(state: InputSection): void {
  const byControl = new Map<string, Set<string>>();
  for (const [action, sources] of Object.entries(state.keyboardActionSources)) {
    for (const [control, held] of Object.entries(sources)) {
      if (held !== true) continue;
      let actions = byControl.get(control);
      if (actions === undefined) byControl.set(control, actions = new Set());
      actions.add(action);
    }
  }
  keyboardClaimsByControl.set(state, byControl);
}

function keyboardClaimIndex(state: InputSection): Map<string, Set<string>> {
  let byControl = keyboardClaimsByControl.get(state);
  if (byControl === undefined) {
    rebuildKeyboardActionClaimIndex(state);
    byControl = keyboardClaimsByControl.get(state)!;
  }
  return byControl;
}

function updateKeyboardClaimIndex(state: InputSection, action: string, control: string, down: boolean): void {
  const byControl = keyboardClaimIndex(state);
  if (down) {
    let actions = byControl.get(control);
    if (actions === undefined) byControl.set(control, actions = new Set());
    actions.add(action);
    return;
  }
  const actions = byControl.get(control);
  actions?.delete(action);
  if (actions?.size === 0) byControl.delete(control);
}

export function createInputSection(config: InputConfig = {}): InputSection {
  const state: InputSection = {
    version: 8,
    nextSeq: 1,
    keys: [],
    held: {},
    pointer: { x: 0, y: 0, buttons: 0, downs: 0, ups: 0, downX: 0, downY: 0, button: 0 },
    focused: true,
    buttons: [],
    pressedButtonSlot: null,
    bindings: { keys: {} },
    allowDiagonals: config.allowDiagonals ?? false,
    camera: { x: 0, y: 0 },
    playerId: config.playerId ?? null,
    pathMode: config.pathMode ?? 1,
    gamepads: {},
    keyboardActions: {},
    actions: {},
    registeredActions: [],
    actionRegistry: Object.fromEntries([...ENGINE_ACTIONS].map((action) => [action, true])),
    actionOrder: Object.fromEntries([...ENGINE_ACTIONS].map((action, index) => [action, index])),
    controlActions: {},
    actionPadMasks: {},
    keyboardActionSources: {},
    semanticActionSources: {},
    directionOrder: [],
    pendingActions: [],
    pendingKeySequences: [],
    pendingClicks: [],
    pointerMovementSuppressed: false,
    pointerPlane: config.pointerPlane === undefined ? null : { ...config.pointerPlane },
    nextPointerGestureId: 1,
    pointerGestureId: null,
    pendingPointerUps: [],
    pendingGamepads: [],
  };
  configureInput(state, config);
  rebuildKeyboardActionClaimIndex(state);
  return state;
}

export function configureInput(state: InputSection, config: InputConfig): void {
  if (config.bindings !== undefined) state.bindings = { keys: { ...config.bindings.keys } };
  if (config.allowDiagonals !== undefined) state.allowDiagonals = config.allowDiagonals;
  if (config.buttons !== undefined) {
    state.buttons = config.buttons.map((button) => ({ ...button }));
    if (state.pressedButtonSlot !== null) {
      const slot = slotAt(state, state.pointer.x, state.pointer.y);
      if (slot?.id !== state.pressedButtonSlot || !slot.enabled) state.pressedButtonSlot = null;
    }
  }
  if (config.camera !== undefined) state.camera = { x: config.camera.x, y: config.camera.y };
  if (config.playerId !== undefined) state.playerId = config.playerId;
  if (config.pathMode !== undefined) state.pathMode = config.pathMode;
  if (config.pointerPlane !== undefined) state.pointerPlane = { ...config.pointerPlane };
}
/** Set whether an active semantic surface owns the current pointer gesture. */
export function setPointerMovementSuppressed(state: InputSection, suppressed: boolean): void {
  state.pointerMovementSuppressed = suppressed;
  if (suppressed) {
    state.pendingClicks = [];
    state.pendingPointerUps = [];
  }
}

export function inputView(state: InputSection): InputView {
  return state;
}

const GAME_ACTION_NAME = /^game\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/;

function mappedAction(state: InputSection, event: KeyInput): string | undefined {
  return state.bindings.keys[event.code] ?? state.bindings.keys[event.name];
}

/** Register an action definition and index its canonical controls for constant-time event resolution. */
export function registerGameAction(state: InputSection, action: RegisteredAction): boolean {
  if (typeof action.name !== "string" || !GAME_ACTION_NAME.test(action.name) || typeof action.label !== "string" || action.label.trim().length === 0
    || (action.icon !== null && typeof action.icon !== "string")
    || (action.group !== null && typeof action.group !== "string")
    || !Array.isArray(action.controls) || !action.controls.every((control) => typeof control === "string" && /^(?:key:[A-Za-z][A-Za-z0-9]*|pad:(?:[0-9]|1[0-6])|pad:axis[01][+-])$/.test(control))
    || typeof action.locked !== "boolean" || typeof action.hidden !== "boolean"
    || Object.hasOwn(state.actionRegistry, action.name)) return false;
  let definition: RegisteredAction;
  try {
    definition = JSON.parse(canon(action as unknown as PlainData)) as RegisteredAction;
  } catch {
    return false;
  }
  state.registeredActions.push(definition);
  state.actionOrder[action.name] = ENGINE_ACTIONS.size + state.registeredActions.length - 1;
  state.actionRegistry[action.name] = true;
  for (const control of definition.controls) {
    const actions = state.controlActions[control] ?? (state.controlActions[control] = []);
    actions.push(action.name);
    if (control.startsWith("pad:")) {
      const bit = control === "pad:axis0-" ? 17 : control === "pad:axis0+" ? 18 : control === "pad:axis1-" ? 19 : control === "pad:axis1+" ? 20 : Number(control.slice(4));
      state.actionPadMasks[action.name] = (state.actionPadMasks[action.name] ?? 0) | (1 << bit);
    }
  }
  return true;
}

/** Return a fresh membership set while preserving registration order in the owning section. */
export function registeredActionNames(state: InputSection): ReadonlySet<string> {
  return new Set(Object.keys(state.actionRegistry));
}

/** Apply a source-scoped semantic edge and emit compatibility behavior only on an aggregate press edge. */
export function applySemanticActionEdge(
  state: InputSection,
  action: string,
  down: boolean,
  source: string,
  registeredActions?: ReadonlySet<string>,
  target?: string,
): boolean {
  const registered = Object.hasOwn(state.actionRegistry, action) &&
    (registeredActions === undefined || registeredActions.has(action));
  if (!registered || source.length === 0) return false;
  let claims = state.semanticActionSources[action];
  const priorClaim = claims !== undefined && Object.hasOwn(claims, source) && claims[source] === true;
  if (priorClaim === down) return true;
  if (claims === undefined) claims = state.semanticActionSources[action] = {};
  const wasHeld = state.actions[action] === true;
  if (down) Object.defineProperty(claims, source, { value: true, enumerable: true, configurable: true, writable: true });
  else {
    delete claims[source];
    if (Object.keys(claims).length === 0) delete state.semanticActionSources[action];
  }
  const isHeld = Object.keys(claims).length > 0 || state.keyboardActions[action] === true || actionHeldFromPads(state, action);
  state.actions[action] = isHeld;
  if (isHeld !== wasHeld) {
    setDirectionOrder(state, action, isHeld);
    if (isHeld) {
      appendKey(state, action, source, null, action, [action], target ?? null);
      state.pendingActions.push(action);
    }
  }
  return true;
}


function appendKey(
  state: InputSection,
  name: string,
  code: string,
  char: string | null,
  action: string | null,
  resolvedActions: readonly string[],
  target: string | null = null,
  pendingKeySequence = true,
): void {
  const seq = state.nextSeq;
  state.nextSeq += 1;
  state.keys.push({ seq, name, code, char, action, resolvedActions: [...resolvedActions], ...(target === null ? {} : { target }) });
  if (pendingKeySequence) state.pendingKeySequences.push(seq);
}

function boundActions(state: InputSection): Set<string> {
  return new Set(Object.values(state.bindings.keys));
}

function controlForPadBit(bit: number): string {
  if (bit < 17) return `pad:${bit}`;
  return bit === 17 ? "pad:axis0-" : bit === 18 ? "pad:axis0+" : bit === 19 ? "pad:axis1-" : "pad:axis1+";
}

function maskForGamepad(event: Pick<GamepadInput, "axes" | "buttons">): number {
  let mask = event.buttons & 0x1ffff;
  if (Math.abs(event.axes.x) >= 250) mask |= 1 << (event.axes.x < 0 ? 17 : 18);
  if (Math.abs(event.axes.y) >= 250) mask |= 1 << (event.axes.y < 0 ? 19 : 20);
  return mask;
}
function actionHeldFromPads(state: InputSection, action: string): boolean {
  const mask = state.actionPadMasks[action] ?? ENGINE_PAD_MASKS[action] ?? 0;
  if (mask === 0) return false;
  for (const pad of Object.values(state.gamepads)) if (pad.connected && (pad.mask & mask) !== 0) return true;
  return false;
}

function setDirectionOrder(state: InputSection, action: string, pressed: boolean): void {
  if (DIRECTIONS[action] !== true) return;
  if (pressed) state.directionOrder = [...state.directionOrder.filter((value) => value !== action), action];
  else state.directionOrder = state.directionOrder.filter((value) => value !== action);
}

function updateAction(
  state: InputSection,
  action: string,
  emitEdge: boolean,
  code: string,
  onTransition?: (action: string, down: boolean, firstSeq: number) => void,
): void {
  if (!Object.hasOwn(state.actionRegistry, action)) return;
  const previous = state.actions[action] === true;
  const current = Object.keys(state.keyboardActionSources[action] ?? {}).length > 0
    || actionHeldFromPads(state, action)
    || Object.keys(state.semanticActionSources[action] ?? {}).length > 0;
  state.keyboardActions[action] = Object.keys(state.keyboardActionSources[action] ?? {}).length > 0;
  if (current === previous) return;
  const firstSeq = state.nextSeq;
  state.actions[action] = current;
  setDirectionOrder(state, action, current);
  if (current) {
    if (emitEdge) appendKey(state, action, code, null, action, [action]);
    state.pendingActions.push(action);
  }
  onTransition?.(action, current, firstSeq);
}
function updateAllActions(
  state: InputSection,
  emitEdges: boolean,
  code: string,
  onTransition?: (action: string, down: boolean, firstSeq: number) => void,
): void {
  const actions = new Set<string>([
    ...Object.keys(state.keyboardActionSources),
    ...Object.keys(state.semanticActionSources),
  ]);
  for (const action of ENGINE_ACTIONS) if (actionHeldFromPads(state, action)) actions.add(action);
  for (let bit = 0; bit < 21; bit++) {
    if (Object.values(state.gamepads).some((pad) => pad.connected && (pad.mask & (1 << bit)) !== 0)) {
      for (const action of state.controlActions[controlForPadBit(bit)] ?? []) actions.add(action);
    }
  }
  for (const action of actions) updateAction(state, action, emitEdges, code, onTransition);
}
function updatePadActions(
  state: InputSection,
  previousMask: number,
  currentMask: number,
  emitEdges: boolean,
  code: string,
  onTransition?: (action: string, down: boolean, firstSeq: number) => void,
): void {
  const processed = new Set<string>();
  for (let bit = 0; bit < 21; bit++) {
    if (((previousMask ^ currentMask) & (1 << bit)) === 0) continue;
    const actions = [ENGINE_PAD_ACTIONS[bit], ...(state.controlActions[controlForPadBit(bit)] ?? [])];
    for (const action of actions) {
      if (action === undefined || processed.has(action)) continue;
      processed.add(action);
      updateAction(state, action, emitEdges, code, onTransition);
    }
  }
}

function applyKey(state: InputSection, event: KeyInput, onUnknownAction?: (action: string) => void): void {
  if (event.down && event.repeat === true && state.held[event.name] !== true) return;
  const priorRaw = state.held[event.name] === true;
  state.held[event.name] = event.down;
  if (event.code !== event.name) state.held[event.code] = event.down;
  const control = `key:${event.code}`;
  const configured = mappedAction(state, event);
  const defaultActions = DEFAULT_KEY_ACTIONS[event.code] ?? [];
  const mapped = configured === undefined ? undefined : LEGACY_ACTION_ALIASES[configured] ?? configured;
  const bound = state.controlActions[control] ?? [];
  const candidates = [...defaultActions, ...bound, ...(mapped === undefined ? [] : [mapped])];
  const gameSet = new Set<string>();
  for (const action of [...bound, ...(mapped === undefined ? [] : [mapped])]) {
    if (ENGINE_ACTIONS.has(action) || gameSet.has(action)) continue;
    gameSet.add(action);
  }
  const unknown = [...gameSet].filter((action) => action.startsWith("game.") && !Object.hasOwn(state.actionRegistry, action));
  for (const action of unknown) onUnknownAction?.(action);
  const heldClaims = event.down ? [] : [...(keyboardClaimIndex(state).get(control) ?? [])];
  const ordered = [
    ...[...ENGINE_ACTIONS].filter((action) => candidates.includes(action) || heldClaims.includes(action)),
    ...[...new Set([
      ...[...gameSet].filter((action) => Object.hasOwn(state.actionRegistry, action)),
      ...heldClaims.filter((action) => !ENGINE_ACTIONS.has(action)),
    ])].sort((a, b) => state.actionOrder[a]! - state.actionOrder[b]!),
  ];
  if (event.down) {
    const semanticGameBinding = mapped !== undefined && mapped.startsWith("game.");
    const name = semanticGameBinding ? event.name : configured ?? event.name;
    appendKey(state, name, event.code, event.char, configured ?? null, ordered, null, !event.repeat && !priorRaw);
  }
  if (event.down && event.repeat === true) return;
  if (event.down && priorRaw) return;
  for (const action of ordered) {
    let sources = state.keyboardActionSources[action];
    if (sources === undefined) sources = state.keyboardActionSources[action] = {};
    if (event.down) {
      Object.defineProperty(sources, control, { value: true, enumerable: true, configurable: true, writable: true });
      updateKeyboardClaimIndex(state, action, control, true);
    } else {
      delete sources[control];
      delete sources["legacy.keyboard"];
      updateKeyboardClaimIndex(state, action, control, false);
    }
    updateAction(state, action, false, event.code);
  }
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
  for (const sources of Object.values(state.keyboardActionSources)) for (const source of Object.keys(sources)) delete sources[source];
  rebuildKeyboardActionClaimIndex(state);
  updateAllActions(state, false, "focus");
  state.pointer = { ...state.pointer, buttons: 0 };
  state.pressedButtonSlot = null;
  state.pointerMovementSuppressed = false;
  state.pointerGestureId = null;
  state.pendingClicks = [];
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
  const { x, y, buttons } = state.pointer;
  if (state.pointerMovementSuppressed || (buttons & 1) === 0 || slotAt(state, x, y) !== undefined) return null;
  const plane = state.pointerPlane;
  if (plane !== null && (x < 0 || y < 0 || x >= plane.width || y >= plane.height)) return null;
  return { x: x + state.camera.x, y: y + state.camera.y };
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
  const previous = state.pointer;
  const wasDown = (previous.buttons & 1) !== 0;
  const isDown = (event.buttons & 1) !== 0;
  const pressSlot = state.pressedButtonSlot;
  const slot = slotAt(state, event.x, event.y);
  if (!wasDown && isDown) {
    state.pointerGestureId = state.nextPointerGestureId;
    state.nextPointerGestureId += 1;
  }
  const gestureId = state.pointerGestureId;
  state.pointer = pointerAfter(previous, event);
  if (!wasDown && isDown) {
    state.pressedButtonSlot = slot?.enabled === true ? slot.id : null;
  } else if (wasDown && state.pressedButtonSlot !== null) {
    if (slot?.id !== state.pressedButtonSlot || !slot.enabled) {
      state.pressedButtonSlot = null;
    } else if (!isDown) {
      appendKey(state, slot.action, `button:${slot.id}`, null, `slot:${slot.id}`, [slot.action]);
      state.pendingActions.push(slot.action);
      state.pressedButtonSlot = null;
    }
  }
  const plane = state.pointerPlane;
  const insidePlane = plane === null || (event.x >= 0 && event.y >= 0 && event.x < plane.width && event.y < plane.height);
  if (wasDown && !isDown && gestureId !== null && pressSlot === null
    && !state.pointerMovementSuppressed && slot === undefined && slotAt(state, previous.downX, previous.downY) === undefined) {
    state.pendingPointerUps.push({ gestureId, x: event.x + state.camera.x, y: event.y + state.camera.y });
  } else if (wasDown && !isDown && gestureId !== null && slot !== undefined) {
    state.pendingClicks = state.pendingClicks.filter((click) => click.gestureId !== gestureId);
  }
  if (isDown && gestureId !== null && slot === undefined && !state.pointerMovementSuppressed && insidePlane) {
    state.pendingClicks.push({ gestureId, x: event.x + state.camera.x, y: event.y + state.camera.y });
  }
  if (wasDown && !isDown) state.pointerGestureId = null;
}

/** Apply one raw event. Gamepad events are staged for deterministic device ordering. */
export function applyInputEvent(state: InputSection, event: InputEvent, onUnknownAction?: (action: string) => void): void {
  switch (event.kind) {
    case "key": applyKey(state, event, onUnknownAction); return;
    case "action":
      if (!applySemanticActionEdge(state, event.action, event.down, event.source)) onUnknownAction?.(event.action);
      return;
    case "pointer": applyPointer(state, event); return;
    case "pointer.cancel": {
      const gestureId = state.pointerGestureId;
      state.pointer = { ...state.pointer, buttons: state.pointer.buttons & ~1 };
      state.pressedButtonSlot = null;
      state.pointerMovementSuppressed = false;
      state.pointerGestureId = null;
      if (gestureId !== null) {
        state.pendingClicks = state.pendingClicks.filter((click) => click.gestureId !== gestureId);
        state.pendingPointerUps = state.pendingPointerUps.filter((point) => point.gestureId !== gestureId);
      }
      return;
    }
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
    case "video.ended":
    case "host.features":
    case "host.display": return;
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

/** Apply staged pads in device order and clear the per-tick staging area. */
export function processGamepadEvents(
  state: InputSection,
  onConnectionTransition?: (event: { readonly device: number; readonly connected: boolean }) => void,
  onActionTransition?: (action: string, down: boolean, firstSeq: number) => void,
): void {
  const events = state.pendingGamepads.map((event, index) => ({ event, index })).sort((left, right) => left.event.device - right.event.device || left.index - right.index);
  state.pendingGamepads = [];
  for (const { event } of events) {
    if (!Number.isInteger(event.device) || event.device < 0 || event.device > 3) continue;
    if (!event.connected) {
      const prior = state.gamepads[String(event.device)];
      if (prior === undefined || !prior.connected) continue;
      const priorMask = prior.mask;
      prior.connected = false;
      prior.mask = 0;
      onConnectionTransition?.({ device: event.device, connected: false });
      updatePadActions(state, priorMask, 0, true, `gamepad:${event.device}`, onActionTransition);
      continue;
    }
    if (!Number.isInteger(event.axes.x) || !Number.isInteger(event.axes.y)) continue;
    const prior: InputGamepad = state.gamepads[String(event.device)] ?? { connected: false, mask: 0 };
    const priorMask = prior.connected ? prior.mask : 0;
    const newlyConnected = !prior.connected;
    prior.connected = true;
    prior.mask = maskForGamepad(event);
    state.gamepads[String(event.device)] = prior;
    if (newlyConnected) onConnectionTransition?.({ device: event.device, connected: true });
    updatePadActions(state, priorMask, prior.mask, true, `gamepad:${event.device}`, onActionTransition);
  }
}

/** Consume pending action edges and click destinations; registration owns movement calls. */
export function takeInputActions(state: InputSection): { actions: string[]; clicks: { x: number; y: number }[] } {
  const result = { actions: state.pendingActions, clicks: state.pendingClicks };
  state.pendingActions = [];
  state.pendingKeySequences = [];
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

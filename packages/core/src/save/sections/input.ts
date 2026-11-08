/** Owner: core/input (AD-10/AD-14; E-110..E-112). */
import type { PlainData } from "../../ports/plain-data.ts";

export const INPUT_SCHEMA_VERSION = 10;

export type InputKeyState = {
  readonly seq: number;
  readonly name: string;
  readonly code: string;
  readonly char: string | null;
  readonly action: string | null;
  readonly resolvedActions: string[];
  readonly target?: string;
};

export type InputButtonSlot = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly action: string;
  readonly enabled: boolean;
};

/** Legacy image-backed button retained for the already-shipped UI renderer. */
export type InputImageButton = {
  readonly slot: number;
  readonly asset: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type InputButton = InputButtonSlot | InputImageButton;

export type InputBindings = {
  readonly keys: { [key: string]: string };
};

export type InputGamepad = {
  connected: boolean;
  mask: number;
};

/** Game-owned action definition. Unknown metadata fields are retained verbatim for forward compatibility. */
export type RegisteredAction = {
  readonly name: string;
  readonly label: string;
  readonly icon: string | null;
  readonly group: string | null;
  readonly controls: string[];
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly [extension: string]: PlainData;
};
export type InputPointer = {
  x: number;
  y: number;
  buttons: number;
  downs: number;
  ups: number;
  downX: number;
  downY: number;
  button: number;
};

export type InputSection = {
  version: number;
  nextSeq: number;
  keys: InputKeyState[];
  held: { [name: string]: boolean };
  /**
   * The last pointer position and pressed-button bitmask, plus the monotonic press/release edge counters
   * (docs/spec/engine/display-input-audio.md#reawakened-pointer-record): `downs`/`ups` count every button bit that went
   * 0→1 / 1→0, `downX`/`downY` is where the last press happened and `button` the bit value of the last edge.
   */
  pointer: InputPointer;
  focused: boolean;
  buttons: InputButton[];
  pressedButtonSlot: string | null;
  bindings: InputBindings;
  allowDiagonals: boolean;
  camera: { x: number; y: number };
  playerId: string | null;
  pathMode: 1 | 2 | 3;
  gamepads: { [device: string]: InputGamepad };
  keyboardActions: { [action: string]: boolean };
  actions: { [action: string]: boolean };
  directionOrder: string[];
  registeredActions: RegisteredAction[];
  actionRegistry: { [action: string]: true };
  actionOrder: { [action: string]: number };
  controlActions: { [control: string]: string[] };
  actionPadMasks: { [action: string]: number };
  semanticActionSources: { [action: string]: { [source: string]: boolean } };
  keyboardActionSources: { [action: string]: { [control: string]: boolean } };
  modalActions: Array<{ readonly seq: number; readonly action: "confirm" | "cancel"; readonly modalId: number }>;
  pendingActions: string[];
  pendingKeySequences: number[];
  pendingClicks: { gestureId: number; x: number; y: number }[];
  pointerMovementSuppressed: boolean;
  /** A live primary gesture invalidated by a successful timeline replacement, until its physical release. */
  primaryPointerSuppressedUntilRelease: boolean;
  pointerPlane: { width: number; height: number } | null;
  nextPointerGestureId: number;
  pointerGestureId: number | null;
  pendingPointerUps: { gestureId: number; x: number; y: number }[];
  pendingGamepads: Array<{
    device: number;
    connected: boolean;
    axes: { x: number; y: number };
    buttons: number;
  }>;
};

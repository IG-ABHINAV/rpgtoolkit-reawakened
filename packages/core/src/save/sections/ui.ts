/** Deterministic message-window, text and modal state (E-55/E-60). */

import type { FontRef, Rgb } from "../../ports/draw.ts";
import type { SurfaceId } from "../../ports/keys.ts";

export const UI_SCHEMA_VERSION = 2;
export type UiTextDraw = {
  readonly x: number;
  readonly y: number;
  readonly cell: boolean;
  readonly text: string;
  readonly font: FontRef;
  readonly rgb: Rgb;
  readonly underline: boolean;
};

export type UiMessageWindow = {
  readonly visible: boolean;
  readonly text: string;
  readonly color: Rgb;
  readonly background: Rgb;
  readonly graphic: string;
  readonly translucency: number;
};

export type UiModal = {
  readonly kind: "prompt" | "msgbox";
  readonly text: string;
  readonly title: string;
  readonly style: number;
  readonly textColor: Rgb;
  readonly background: Rgb;
  readonly graphic: string;
  readonly selected: number;
  readonly result: number | string | null;
};

export type UiCursorPoint = {
  readonly x: number;
  readonly y: number;
};

export type UiCursorMap = {
  readonly id: number;
  readonly points: UiCursorPoint[];
  readonly selected: number;
};

export type UiCursorImage = {
  readonly asset: string;
  readonly x: number;
  readonly y: number;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly transparent: Rgb;
  readonly width: number;
  readonly height: number;
};

export type UiCursorHand = {
  readonly asset: string;
  readonly stretch: boolean;
  readonly width: number;
  readonly height: number;
};

export type UiButton = {
  readonly slot: number;
  readonly asset: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type UiSurfaceRole = "menu" | "list" | "dialog" | "surface";

export type UiSurfaceBounds = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type UiActionItem = {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly enabled: boolean;
  readonly role: "menuitem" | "button" | "listitem" | "text";
  readonly bounds: UiSurfaceBounds;
  readonly action?: string;
};

export type UiActionSurface = {
  readonly id: string;
  readonly owner: number;
  readonly role: UiSurfaceRole;
  readonly bounds: UiSurfaceBounds;
  readonly items: UiActionItem[];
  readonly selection: number;
};

export type UiSurfaceBuilder = {
  readonly owner: number;
  readonly id: string;
  readonly role: UiSurfaceRole;
  readonly bounds: UiSurfaceBounds;
  readonly items: UiActionItem[];
  readonly invalid: boolean;
};

export type UiActionClaim = {
  readonly surfaceId: string;
  readonly owner: number;
  readonly itemId: string;
  readonly index: number;
  readonly action: string | null;
};

export type UiSection = {
  font: FontRef;
  underline: boolean;
  color: Rgb;
  message: UiMessageWindow;
  draws: UiTextDraw[];
  cursorX: number;
  cursorY: number;
  modal: UiModal | null;
  backgroundSurface: SurfaceId | null;
  backgroundRev: number;
  cursorMaps?: UiCursorMap[];
  nextCursorMapId?: number;
  activeCursorMap?: number;
  cursorHand?: UiCursorHand;
  mouseCursor?: UiCursorImage | null;
  buttons?: UiButton[];
  actionSurfaces: UiActionSurface[];
  surfaceBuilders: UiSurfaceBuilder[];
  surfaceSelection: { [surface: string]: number };
  surfaceActivated: UiActionClaim | null;
  surfaceCancelled: boolean;
  surfacePointerClaim: UiActionClaim | null;
  customTouchControlsDeclared: boolean;
};

const FALLBACK_FONT: FontRef = {
  asset: "media/fonts/tkr-8x8.fnt" as FontRef["asset"],
  size: 8,
  bold: false,
  italic: false,
};
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Fresh UI state; the engine installs the matching colour surface after allocation. */
export function createUiSection(): UiSection {
  return {
    font: FALLBACK_FONT,
    underline: false,
    color: WHITE,
    message: {
      visible: false,
      text: "",
      color: WHITE,
      background: BLACK,
      graphic: "",
      translucency: 50,
    },
    draws: [],
    cursorX: 0,
    cursorY: 0,
    modal: null,
    backgroundSurface: null,
    backgroundRev: 0,
    actionSurfaces: [],
    surfaceBuilders: [],
    surfaceSelection: {},
    surfaceActivated: null,
    surfaceCancelled: false,
    surfacePointerClaim: null,
    customTouchControlsDeclared: false,
  };

/**
 * The state change of a new outermost program start
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle): the message window is
 * hidden and its stored text is reset, and the script text layer starts empty because the program's
 * starting image replaces whatever the previous program drew. Has no effect until the engine has
 * installed the UI section.
 */
export function resetUiForProgramStart(ui: UiSection): void {
  if (ui.message === undefined) return;
  ui.message = { ...ui.message, visible: false, text: "" };
  ui.draws = [];
  ui.actionSurfaces = [];
  ui.surfaceBuilders = [];
  ui.surfaceSelection = {};
  ui.surfaceActivated = null;
  ui.surfaceCancelled = false;
  ui.surfacePointerClaim = null;
  ui.modal = null;
}

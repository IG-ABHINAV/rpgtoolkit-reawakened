import type { AccessibilityNode } from "../ports/accessibility.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import type { DrawCommand, FontRef, Rgb } from "../ports/draw.ts";
import type { AssetKey } from "../ports/keys.ts";
import { renderNowEnabled } from "../raster/surfaces.ts";
import type { InputSection } from "../save/sections/input.ts";
import type { SurfacesSection } from "../save/sections/surfaces.ts";
import type { UiCursorImage, UiSection } from "../save/sections/ui.ts";
import { emitText, layoutText } from "./text.ts";

const WINDOW_WIDTH = 600;
const WINDOW_HEIGHT = 100;
const BUTTON_WIDTH = 80;
const BUTTON_HEIGHT = 28;
const BUTTON_GAP = 8;
const MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function alpha(percent: number): number {
  return Math.floor((clamp(percent, 0, 100) * 255 + 50) / 100);
}
function fontOf(ui: UiSection): FontRef {
  return ui.font;
}
function textCommands(
  text: string,
  x: number,
  y: number,
  color: Rgb,
  font: FontRef,
  maxWidth?: number,
  underline = false,
  cell = false,
): DrawCommand[] {
  return emitText(text, x, y, color, font, {
    ...(maxWidth === undefined ? {} : { maxWidth }),
    ...(cell ? { lineHeight: font.size } : {}),
    underline,
  });
}

function background(
  commands: DrawCommand[],
  ui: UiSection,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
  translucency: number,
  useSurface = true,
): void {
  if (useSurface && ui.backgroundSurface !== null) {
    commands.push({
      kind: "blit",
      source: { surface: ui.backgroundSurface, rev: ui.backgroundRev },
      src: { x: 0, y: 0, w: 1, h: 1 },
      dst: { x, y, w: width, h: height },
      key: null,
      tint: { r: 0, g: 0, b: 0 },
      alpha: alpha(translucency),
      blend: "translucent",
      iso2d: false,
    });
  } else {
    commands.push({ kind: "rect", rect: { x, y, w: width, h: height }, rgb: color, filled: true });
  }
}

function drawMessage(commands: DrawCommand[], ui: UiSection, width: number, graphic: AssetKey | null): void {
  if (ui.message === undefined || !ui.message.visible) return;
  const x = Math.floor((width - WINDOW_WIDTH) / 2);
  const clippedX = Math.max(0, x);
  const clippedWidth = Math.min(width, x + WINDOW_WIDTH) - clippedX;
  if (clippedWidth <= 0) return;
  if (graphic === null) background(commands, ui, clippedX, 0, clippedWidth, WINDOW_HEIGHT, ui.message.background, ui.message.translucency);
  else {
    // The image replaces the colour and sits 1:1 in the window from its top-left pixel
    // (docs/spec/engine/rpgcode-functions.md#reawakened-message-window-image).
    commands.push({
      kind: "blit",
      source: { asset: graphic, tile: null },
      src: { x: clippedX - x, y: 0, w: clippedWidth, h: WINDOW_HEIGHT },
      dst: { x: clippedX, y: 0, w: clippedWidth, h: WINDOW_HEIGHT },
      key: null,
      tint: { r: 0, g: 0, b: 0 },
      alpha: alpha(ui.message.translucency),
      blend: "translucent",
      iso2d: false,
    });
  }
  commands.push(...textCommands(ui.message.text, clippedX, 0, ui.message.color, fontOf(ui), WINDOW_WIDTH, ui.underline));
}

function drawModal(commands: DrawCommand[], ui: UiSection, width: number, height: number): void {
  const modal = ui.modal;
  if (modal === null || modal === undefined) return;
  const body = modal.title === "" ? modal.text : `${modal.title}\n${modal.text}`;
  const maxTextWidth = Math.max(0, Math.floor(width * 0.6) - MARGIN * 2);
  const layout = layoutText(body, fontOf(ui), { maxWidth: maxTextWidth });
  const buttonCount = modal.style === 1 ? 2 : 1;
  const panelWidth = Math.min(width, Math.max(BUTTON_WIDTH * buttonCount + BUTTON_GAP * (buttonCount - 1), layout.width) + MARGIN * 2);
  const panelHeight = Math.min(height, layout.height + BUTTON_HEIGHT + MARGIN * 2);
  const x = Math.floor((width - panelWidth) / 2);
  const y = Math.floor((height - panelHeight) / 2);
  background(commands, ui, x, y, panelWidth, panelHeight, modal.background, 100, false);
  commands.push(...textCommands(body, x + MARGIN, y + MARGIN, modal.textColor, fontOf(ui), maxTextWidth));
  const buttonsWidth = BUTTON_WIDTH * buttonCount + BUTTON_GAP * (buttonCount - 1);
  const buttonsX = x + Math.floor((panelWidth - buttonsWidth) / 2);
  const buttonsY = y + panelHeight - MARGIN - BUTTON_HEIGHT;
  const labels = modal.style === 1 ? ["Yes", "No"] : ["OK"];
  labels.forEach((label, index) => {
    const bx = buttonsX + index * (BUTTON_WIDTH + BUTTON_GAP);
    const selected = index === modal.selected;
    commands.push({ kind: "rect", rect: { x: bx, y: buttonsY, w: BUTTON_WIDTH, h: BUTTON_HEIGHT }, rgb: selected ? modal.textColor : modal.background, filled: true });
    commands.push(...textCommands(label, bx + Math.floor((BUTTON_WIDTH - layoutText(label, fontOf(ui)).width) / 2), buttonsY + 6, selected ? modal.background : modal.textColor, fontOf(ui)));
  });
}

function drawButtons(commands: DrawCommand[], input: InputSection | undefined): void {
  for (const button of input?.buttons ?? []) {
    if (!("asset" in button)) continue;
    commands.push({
      kind: "blit",
      source: { asset: assetKey(button.asset), tile: null },
      src: { x: 0, y: 0, w: button.width, h: button.height },
      dst: { x: button.x, y: button.y, w: button.width, h: button.height },
      key: { r: 255, g: 0, b: 255 },
      tint: { r: 0, g: 0, b: 0 },
      alpha: 255,
      blend: "normal",
      iso2d: false,
    });
  }
}

function cursorMapPoint(ui: UiSection, selection?: number): { readonly x: number; readonly y: number } | null {
  const id = ui.activeCursorMap;
  if (id === undefined) return null;
  const map = ui.cursorMaps?.find((entry) => entry.id === id);
  if (map === undefined || map.points.length === 0) return null;
  const index = Math.max(0, Math.min(map.points.length - 1, Math.trunc(selection ?? map.selected)));
  return map.points[index] ?? null;
}

function cursorCommand(cursor: UiCursorImage, pointer: { readonly x: number; readonly y: number }): DrawCommand {
  return {
    kind: "blit",
    source: { asset: assetKey(cursor.asset), tile: null },
    src: { x: 0, y: 0, w: cursor.width, h: cursor.height },
    dst: { x: pointer.x - cursor.hotspotX, y: pointer.y - cursor.hotspotY, w: cursor.width, h: cursor.height },
    key: cursor.transparent,
    tint: { r: 0, g: 0, b: 0 },
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
}

function drawCursor(commands: DrawCommand[], ui: UiSection, input: InputSection | undefined, selection?: number, cursorMapRunnerActive = true): void {
  const pointer = input?.pointer ?? { x: 0, y: 0, buttons: 0 };
  if (ui.mouseCursor !== undefined && ui.mouseCursor !== null) {
    commands.push(cursorCommand(ui.mouseCursor, pointer));
  }
  if (!cursorMapRunnerActive) return;
  const point = cursorMapPoint(ui, selection);
  if (point === null) return;
  const hand = ui.cursorHand ?? { asset: "media/cursors/tkr-hand.png", stretch: true, width: 32, height: 32 };
  commands.push(cursorCommand({ asset: hand.asset, x: point.x - 40, y: point.y - 10, hotspotX: 0, hotspotY: 0, transparent: { r: 255, g: 0, b: 255 }, width: hand.width, height: hand.height }, { x: point.x - 40, y: point.y - 10 }));
}

/**
 * The E-57 render-now overlay: while `rendernow(true)` has enabled the reserved canvas, one blit of that canvas at
 * (0,0), 1:1, above the board, sprites and animations. Pixels with zero alpha leave what is below visible. Null while it
 * is switched off or its canvas is no longer live.
 */
export function renderNowBlit(surfaces: SurfacesSection): DrawCommand | null {
  if (!renderNowEnabled(surfaces)) return null;
  const current = surfaces.entries[String(surfaces.renderNow)];
  if (current === undefined) return null;
  return {
    kind: "blit",
    source: { surface: current.id, rev: current.rev },
    src: { x: 0, y: 0, w: current.bitmap.w, h: current.bitmap.h },
    dst: { x: 0, y: 0, w: current.bitmap.w, h: current.bitmap.h },
    key: null,
    tint: { r: 0, g: 0, b: 0 },
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
}

/**
 * Append the deterministic UI overlay after board composition (E-55/E-60). `messageGraphic` is the host-resolved asset
 * key of the message window's background image, or null while `winGraphic` is unset or its texture is not decoded yet.
 */
function surfaceFocusCommands(ui: UiSection): DrawCommand[] {
  if (ui.modal != null) return [];
  const commands: DrawCommand[] = [];
  for (const surface of ui.actionSurfaces ?? []) {
    const item = surface.items[surface.selection];
    if (item === undefined || !item.enabled) continue;
    commands.push({ kind: "rect", rect: item.bounds, rgb: { r: 255, g: 255, b: 255 }, filled: false });
    if (item.bounds.w > 2 && item.bounds.h > 2) {
      commands.push({ kind: "rect", rect: { x: item.bounds.x + 1, y: item.bounds.y + 1, w: item.bounds.w - 2, h: item.bounds.h - 2 }, rgb: { r: 0, g: 0, b: 0 }, filled: false });
    }
  }
  return commands;
}
export function composeUi(ui: UiSection, width: number, height: number, input?: InputSection, includeCursor = true, cursorSelection?: number, messageGraphic: AssetKey | null = null): DrawCommand[] {
  const commands: DrawCommand[] = [];
  if (Array.isArray(ui.draws)) {
    for (const draw of ui.draws) {
      commands.push(...textCommands(draw.text, draw.x, draw.y, draw.rgb, draw.font, undefined, draw.underline, draw.cell));
    }
  }
  drawMessage(commands, ui, width, messageGraphic);
  drawModal(commands, ui, width, height);
  drawButtons(commands, input);
  commands.push(...surfaceFocusCommands(ui));
  if (includeCursor) drawCursor(commands, ui, input, cursorSelection);
  return commands;
}

/** Author text that crosses the game viewport is duplicated into Plane 3; hosts clip it to eligible margin cells. */
export function composeUiMargins(ui: UiSection, width: number, height: number): DrawCommand[] {
  const commands: DrawCommand[] = [];
  commands.push(...(ui.authorMarginCommands ?? []));
  for (const draw of ui.draws ?? []) {
    const layout = layoutText(draw.text, draw.font, draw.cell ? { lineHeight: draw.font.size } : undefined);
    if (draw.x >= 0 && draw.y >= 0 && draw.x + layout.width <= width && draw.y + layout.height <= height) continue;
    commands.push(...textCommands(draw.text, draw.x, draw.y, draw.rgb, draw.font, undefined, draw.underline, draw.cell));
  }
  commands.push(...surfaceFocusCommands(ui).filter((command) => {
    if (command.kind !== "rect") return false;
    const rect = command.rect;
    return rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height;
  }));
  return commands;
}
export function uiAccessibilityTree(ui: UiSection): readonly AccessibilityNode[] {
  return (ui.actionSurfaces ?? []).map((surface) => ({
    id: `surface:${surface.owner}:${surface.id}`,
    role: surface.role,
    label: surface.id,
    value: null,
    state: { disabled: false, selected: false, checked: null },
    focused: false,
    bounds: { ...surface.bounds },
    children: surface.items.map((item, index) => ({
      id: `${surface.owner}:${surface.id}:${item.id}`,
      role: item.role,
      label: item.label,
      value: item.value,
      state: { disabled: !item.enabled, selected: index === surface.selection, checked: null },
      focused: index === surface.selection && item.enabled,
      bounds: { ...item.bounds },
      children: [],
    })),
  }));
}

/** Compose the pointer and, only during its blocking runner, the cursor-map hand. */
export function composeUiCursor(ui: UiSection, input: InputSection | undefined, cursorSelection: number | undefined, cursorMapRunnerActive: boolean): DrawCommand[] {
  const commands: DrawCommand[] = [];
  drawCursor(commands, ui, input, cursorSelection, cursorMapRunnerActive);
  return commands;
}

export { BUTTON_GAP, BUTTON_HEIGHT, BUTTON_WIDTH, MARGIN, WINDOW_HEIGHT, WINDOW_WIDTH };

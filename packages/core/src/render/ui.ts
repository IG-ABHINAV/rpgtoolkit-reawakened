import { assetKey } from "../formats/resolver/resolver.ts";
import type { DrawCommand, FontRef, Rgb } from "../ports/draw.ts";
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

function drawMessage(commands: DrawCommand[], ui: UiSection, width: number): void {
  if (ui.message === undefined || !ui.message.visible) return;
  const x = Math.floor((width - WINDOW_WIDTH) / 2);
  const clippedX = Math.max(0, x);
  const clippedWidth = Math.min(width, x + WINDOW_WIDTH) - clippedX;
  if (clippedWidth <= 0) return;
  background(commands, ui, clippedX, 0, clippedWidth, WINDOW_HEIGHT, ui.message.background, ui.message.translucency);
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

/** Append the deterministic UI overlay after board composition (E-55/E-60). */
export function composeUi(ui: UiSection, width: number, height: number, input?: InputSection, includeCursor = true, cursorSelection?: number): DrawCommand[] {
  const commands: DrawCommand[] = [];
  if (Array.isArray(ui.draws)) {
    for (const draw of ui.draws) {
      commands.push(...textCommands(draw.text, draw.x, draw.y, draw.rgb, draw.font, undefined, draw.underline, draw.cell));
    }
  }
  drawMessage(commands, ui, width);
  drawModal(commands, ui, width, height);
  drawButtons(commands, input);
  if (includeCursor) drawCursor(commands, ui, input, cursorSelection);
  return commands;
}

/** Compose the pointer and, only during its blocking runner, the cursor-map hand. */
export function composeUiCursor(ui: UiSection, input: InputSection | undefined, cursorSelection: number | undefined, cursorMapRunnerActive: boolean): DrawCommand[] {
  const commands: DrawCommand[] = [];
  drawCursor(commands, ui, input, cursorSelection, cursorMapRunnerActive);
  return commands;
}

export { BUTTON_GAP, BUTTON_HEIGHT, BUTTON_WIDTH, MARGIN, WINDOW_HEIGHT, WINDOW_WIDTH };

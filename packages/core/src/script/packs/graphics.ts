/**
 * E-56/E-58/E-63 drawing, canvas and screen-save commands.
 *
 * Script-readable pixels are always edited through the core-owned surfaces
 * section; asset-backed calls retain their deterministic request/effect seam.
 * Source: docs/spec/engine/rpgcode-functions.md#e-56, #e-58, #e-63.
 */
import type { GameState } from "../../save/state.ts";
import type { DrawCommand, Rgb } from "../../ports/draw.ts";
import type { SurfaceId } from "../../ports/keys.ts";
import type { Arg, BuiltinDoc, BuiltinSpec, ParamSpec } from "../builtins.ts";
import type { CommandEffect, CommandView, PluginDefinition } from "../plugin.ts";
import { ScriptError } from "../errors.ts";
import {
  blitSurface,
  canvasGetScreen,
  createSurface,
  createSurfacesSection,
  drawSurfaceCircle,
  drawSurfaceLine,
  drawSurfaceRect,
  editSurfaceWithBounds,
  getPixel,
  killSurface,
  ensureScriptScreen,
  readSurfacePixels,
  renderNowCanvas,
  renderNowEnabled,
  restoreScreen,
  saveScreen,
  surfaceCircleBounds,
  surfaceLineBounds,
  surfacePixelBounds,
  surfaceRectBounds,
  surfaceSize,
} from "../../raster/surfaces.ts";

const SCREEN = 0 as SurfaceId;
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

type AnyState = GameState & { surfaces: GameState["surfaces"] & { renderNow?: SurfaceId } };

/**
 * Where a script draws when it draws "to the screen": the persistent script-screen layer, never the derived
 * presented frame in surface 0 (docs/spec/engine/runners.md#surface-read-and-state-hash).
 */
function writingTarget(current: AnyState, id: SurfaceId): SurfaceId {
  return id === SCREEN ? ensureScriptScreen(current.surfaces) : id;
}

function recordAuthorMarginCommand(
  current: AnyState,
  screenTarget: boolean,
  command: DrawCommand,
  bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): void {
  if (!screenTarget) return;
  const screen = writingTarget(current, SCREEN);
  const size = surfaceSize(current.surfaces, screen);
  if (size === null || ![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isSafeInteger)) return;
  if (bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.w <= size.w && bounds.y + bounds.h <= size.h) return;
  current.ui.authorMarginCommands = [...current.ui.authorMarginCommands, command];
}

function clearAuthorMarginCommands(current: AnyState): void {
  for (const id of current.ui.authorMarginSurfaces) killSurface(current.surfaces, id);
  current.ui.authorMarginSurfaces = [];
  current.ui.authorMarginCommands = [];
}

function prepareAuthorMarginBlit(
  current: AnyState,
  screenTarget: boolean,
  source: SurfaceId,
  x: number,
  y: number,
  width?: number,
  height?: number,
  key?: Rgb,
  sourceRect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): DrawCommand | null {
  if (!screenTarget) return null;
  const sourceSize = surfaceSize(current.surfaces, source);
  const sourceRev = current.surfaces.entries[String(source)]?.rev;
  const screenSize = surfaceSize(current.surfaces, writingTarget(current, SCREEN));
  if (sourceSize === null || sourceRev === undefined || screenSize === null) return null;
  const sx = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.x));
  const sy = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.y));
  const sw = sourceRect === undefined ? sourceSize.w : Math.min(sourceSize.w - sx, Math.max(0, Math.trunc(sourceRect.w)));
  const sh = sourceRect === undefined ? sourceSize.h : Math.min(sourceSize.h - sy, Math.max(0, Math.trunc(sourceRect.h)));
  const dst = {
    x: Math.trunc(x),
    y: Math.trunc(y),
    w: width === undefined ? sw : Math.max(0, Math.trunc(width)),
    h: height === undefined ? sh : Math.max(0, Math.trunc(height)),
  };
  if (![sx, sy, sw, sh, dst.x, dst.y, dst.w, dst.h, dst.x + dst.w, dst.y + dst.h].every(Number.isSafeInteger) || sw <= 0 || sh <= 0 || dst.w <= 0 || dst.h <= 0) return null;
  if (dst.x >= 0 && dst.y >= 0 && dst.x + dst.w <= screenSize.w && dst.y + dst.h <= screenSize.h) return null;
  const pixels = readSurfacePixels(current.surfaces, source, sourceRev);
  if (pixels === null) return null;
  const sourceSnapshot = createSurface(current.surfaces, pixels.w, pixels.h, pixels.rgba);
  current.ui.authorMarginSurfaces.push(sourceSnapshot);
  const snapshotRev = current.surfaces.entries[String(sourceSnapshot)]?.rev;
  if (snapshotRev === undefined) return null;
  const keyPixels = key === undefined ? null : [key.r, key.g, key.b].map(Math.trunc);
  const normalizedKey = keyPixels !== null && keyPixels.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 255)
    ? { r: keyPixels[0]!, g: keyPixels[1]!, b: keyPixels[2]! }
    : null;
  return {
    kind: "blit",
    source: { surface: sourceSnapshot, rev: snapshotRev },
    src: { x: sx, y: sy, w: sw, h: sh },
    dst,
    key: normalizedKey,
    tint: { r: 0, g: 0, b: 0 },
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
}

function numberArg(args: readonly Arg[], index: number, fallback = 0): number {
  const value = args[index]?.value;
  return typeof value === "number" ? value : fallback;
}
function stringArg(args: readonly Arg[], index: number): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : "";
}
function state(view: CommandView): AnyState {
  if (view.state === undefined) throw new ScriptError("surface.no-state", "drawing commands require engine state");
  const current = view.state as AnyState;
  if (current.surfaces === undefined || typeof current.surfaces !== "object" || !("entries" in current.surfaces)) current.surfaces = createSurfacesSection(0, 0);
  return current;
}
function handle(value: unknown, fallback = SCREEN): SurfaceId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value as SurfaceId : fallback;
}
function canvasArg(args: readonly Arg[], index: number): SurfaceId {
  return handle(args[index]?.value);
}
function colour(view: CommandView): Rgb {
  const ui = view.state?.ui as unknown as { colour?: unknown; color?: unknown } | undefined;
  const raw = ui?.colour ?? ui?.color;
  if (typeof raw === "object" && raw !== null) {
    const rgb = raw as { r?: unknown; g?: unknown; b?: unknown };
    if (typeof rgb.r === "number" && typeof rgb.g === "number" && typeof rgb.b === "number") return { r: rgb.r, g: rgb.g, b: rgb.b };
  }
  return WHITE;
}
function output(args: readonly Arg[], index: number, value: number): readonly (readonly [number, number])[] {
  return args[index]?.ref === null || args[index] === undefined ? [] : [[index, value]];
}
function effects(args: readonly Arg[], kind: CommandEffect["kind"] = "state-write", section: "surfaces" | "engine" = "surfaces"): CommandEffect[] {
  return [{ kind, section, args: args.map((arg) => arg.value as never) }];
}
function params(names: readonly string[], optionalFrom = names.length): ParamSpec[] {
  return names.map((name, index) => ({ name, optional: index >= optionalFrom, byRef: false, variadic: false }));
}
const NATIVE_SUMMARY_BY_NAME: Record<string, string> = {
  clear: "Clear a surface. clear() blanks the screen.",
  setpixel: "Set a pixel in the current colour.",
  drawline: "Draw a line.",
  drawrect: "Draw a rectangle.",
  fillrect: "Draw a filled rectangle.",
  bitmap: "Fill a surface with an image.",
  setimage: "Set an image.",
  drawcircle: "Draw a circle at x,y, optionally to a canvas. Previously an arc could be defined but this never worked, so the two parameters have been cut and the optional canvas is...",
  fillcircle: "Draw a filled circle at x, y, to screen or canvas.",
  savescreen: "Save the current screen onto a canvas that can be restored at a later time.",
  restorescreen: "Draw a buffered screen capture to the screen. The canvas drawn is the first in the screen array. x1, x2 specify the bottom- right corner of the screen, so that width...",
  restorescreenarray: "Draw a buffered screen capture to the screen.",
  getpixel: "Get the colour of the pixel at (x, y).",
  setimagetransparent: "Set an image with a transparent colour.",
  setimagetranslucent: "Set an image translucently.",
  setimageadditive: "Set an image with a tint of the specified percent.",
  viewbrd: "Draw a board to the screen or to a canvas, starting at co-ordinates topX, topY.",
  getres: "Get the screen's resolution.",
  createcanvas: "Create a canvas.",
  killcanvas: "Kill a canvas.",
  drawcanvas: "Blit a canvas forward.",
  rendernow: "Controls rendering of the cnvRenderNow reserved canvas. The canvas is drawn every frame above all board elements (e.g. tiles, sprites, animations).",
  drawcanvastransparent: "Blit a canvas forward, but don't blit one colour (the transparent colour).",
  canvasdrawpart: "Draw part of a canvas.",
  canvasgetscreen: "Copy the screen onto a canvas.",
  drawenemy: "Draw an enemy.",
};
const NATIVE_GROUP_BY_NAME: Record<string, string> = {
  viewbrd: "board-tiles-vectors-screen-effects-33",
  drawenemy: "battle-stats-menus-33",
};
function docs(summary: string, behaviour: string, waits = "The command completes in the current script turn."): BuiltinDoc {
  return { summary, behaviour, groups: ["graphics-canvases-animation-video-31"], waits: { kind: "never", summary: waits }, tags: ["legacy"] };
}
function command(name: string, aliases: readonly string[], commandParams: ParamSpec[], doc: BuiltinDoc, call: BuiltinSpec["call"]): BuiltinSpec {
  const summary = NATIVE_SUMMARY_BY_NAME[name] ?? doc.summary;
  const groups = [NATIVE_GROUP_BY_NAME[name] ?? "graphics-canvases-animation-video-31"];
  return { name, aliases, params: commandParams, doc: { ...doc, summary, groups }, call };
}

const CLEAR = command("clear", [], [{ name: "canvas", optional: true, byRef: false, variadic: false }], docs("Clear a screen or canvas.", "Blanks every pixel of the selected surface to transparent black immediately; without a canvas argument it clears the screen surface."), (view, args) => {
  const current = state(view);
  const surfaces = current.surfaces;
  const canvas = canvasArg(args, 0);
  const target = writingTarget(current, canvas);
  const size = surfaceSize(surfaces, target);
  const bounds = size === null ? undefined : { first: 0, last: size.w * size.h - 1 };
  const ok = editSurfaceWithBounds(surfaces, target, (rgba) => rgba.fill(0), bounds);
  if (!ok) throw new ScriptError("surface.unknown", `clear: no canvas ${String(target)}`);
  if (canvas === SCREEN) clearAuthorMarginCommands(current);
  return { value: null, effects: effects(args) };
});

const SET_PIXEL = command("setpixel", [], params(["x", "y", "canvas"], 2), docs("Set one pixel to the current colour.", "Writes the current RGB colour at integer pixel coordinates, clipping outside the selected surface; the optional canvas defaults to the screen."), (view, args) => {
  const current = state(view);
  const surfaces = current.surfaces;
  const canvas = canvasArg(args, 2);
  const target = writingTarget(current, canvas);
  const rawX = numberArg(args, 0);
  const rawY = numberArg(args, 1);
  const bounds = surfacePixelBounds(surfaces, target, rawX, rawY);
  const rgb = colour(view);
  const ok = editSurfaceWithBounds(surfaces, target, (rgba, width, height) => {
    const x = Math.trunc(rawX);
    const y = Math.trunc(rawY);
    if (x >= 0 && y >= 0 && x < width && y < height) {
      const at = (y * width + x) * 4;
      rgba[at] = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
      rgba[at + 1] = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
      rgba[at + 2] = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
      rgba[at + 3] = 255;
    }
  }, bounds);
  if (!ok) throw new ScriptError("surface.unknown", `setpixel: no canvas ${String(target)}`);
  const x = Math.trunc(rawX);
  const y = Math.trunc(rawY);
  recordAuthorMarginCommand(current, canvas === SCREEN, { kind: "line", x1: x, y1: y, x2: x, y2: y, rgb }, { x, y, w: 1, h: 1 });
  return { value: null, effects: effects(args) };
});

function primitive(name: string, filled: boolean, circle: boolean): BuiltinSpec {
  const commandParams = circle ? params(["x", "y", "radius", "canvas"], 3) : params(["x1", "y1", "x2", "y2", "canvas"], 4);
  return command(name, [], commandParams, docs(`${filled ? "Fill" : "Draw"} a ${circle ? "circle" : "rectangle"}.`, "Rasterises the integer primitive using the current colour on the screen or optional canvas, clipping to the target bounds and returning immediately."), (view, args) => {
    const current = state(view);
    const surfaces = current.surfaces;
    const canvas = canvasArg(args, circle ? 3 : 4);
    const target = writingTarget(current, canvas);
    const rgb = colour(view);
    const a0 = numberArg(args, 0);
    const a1 = numberArg(args, 1);
    const a2 = numberArg(args, 2);
    const a3 = circle ? 0 : numberArg(args, 3);
    const bounds = circle
      ? surfaceCircleBounds(surfaces, target, a0, a1, a2)
      : surfaceRectBounds(surfaces, target, a0, a1, a2, a3);
    const ok = editSurfaceWithBounds(surfaces, target, (rgba, width, height) => {
      if (circle) drawSurfaceCircle(rgba, width, height, a0, a1, a2, rgb, filled);
      else drawSurfaceRect(rgba, width, height, a0, a1, a2, a3, rgb, filled);
    }, bounds);
    if (!ok) throw new ScriptError("surface.unknown", `${name}: no canvas ${String(target)}`);
    if (circle && canvas === SCREEN) {
      const cx = Math.trunc(a0); const cy = Math.trunc(a1); const radius = Math.max(0, Math.trunc(a2));
      // Match drawSurfaceCircle's scanline arithmetic exactly; AD-3 ellipse uses a midpoint raster
      // whose small-radius pixels differ (for example radius 2 at y±1).
      for (let dy = -radius; dy <= radius; dy += 1) {
        const span = Math.floor(Math.sqrt(Math.max(0, radius * radius - dy * dy)));
        if (filled) {
          const rect = { x: cx - span, y: cy + dy, w: span * 2 + 1, h: 1 };
          recordAuthorMarginCommand(current, canvas === SCREEN, { kind: "rect", rect, rgb, filled: true }, rect);
        } else {
          const x1 = cx - span;
          const x2 = cx + span;
          recordAuthorMarginCommand(current, canvas === SCREEN, { kind: "line", x1, y1: cy + dy, x2: x1, y2: cy + dy, rgb }, { x: x1, y: cy + dy, w: 1, h: 1 });
          if (x2 !== x1) recordAuthorMarginCommand(current, canvas === SCREEN, { kind: "line", x1: x2, y1: cy + dy, x2, y2: cy + dy, rgb }, { x: x2, y: cy + dy, w: 1, h: 1 });
        }
      }
    } else if (!circle) {
      const left = Math.min(Math.trunc(a0), Math.trunc(a2)); const top = Math.min(Math.trunc(a1), Math.trunc(a3));
      const rect = { x: left, y: top, w: Math.abs(Math.trunc(a2) - Math.trunc(a0)) + 1, h: Math.abs(Math.trunc(a3) - Math.trunc(a1)) + 1 };
      recordAuthorMarginCommand(current, canvas === SCREEN, { kind: "rect", rect, rgb, filled }, rect);
    }
    return { value: null, effects: effects(args) };
  });
}

const DRAW_LINE = command("drawline", [], params(["x1", "y1", "x2", "y2", "canvas"], 4), docs("Draw a line in the current colour.", "Rasterises an inclusive integer Bresenham line on the screen or optional canvas and clips it to the surface."), (view, args) => {
  const current = state(view);
  const surfaces = current.surfaces;
  const canvas = canvasArg(args, 4);
  const target = writingTarget(current, canvas);
  const x1 = numberArg(args, 0);
  const y1 = numberArg(args, 1);
  const x2 = numberArg(args, 2);
  const y2 = numberArg(args, 3);
  const bounds = surfaceLineBounds(surfaces, target, x1, y1, x2, y2);
  const rgb = colour(view);
  const ok = editSurfaceWithBounds(surfaces, target, (rgba, width, height) => drawSurfaceLine(rgba, width, height, x1, y1, x2, y2, rgb), bounds);
  if (!ok) throw new ScriptError("surface.unknown", `drawline: no canvas ${String(target)}`);
  const left = Math.min(Math.trunc(x1), Math.trunc(x2)); const top = Math.min(Math.trunc(y1), Math.trunc(y2));
  const rect = { x: left, y: top, w: Math.abs(Math.trunc(x2) - Math.trunc(x1)) + 1, h: Math.abs(Math.trunc(y2) - Math.trunc(y1)) + 1 };
  recordAuthorMarginCommand(current, canvas === SCREEN, {
    kind: "line",
    x1: Math.trunc(x1), y1: Math.trunc(y1), x2: Math.trunc(x2), y2: Math.trunc(y2), rgb,
  }, rect);
  return { value: null, effects: effects(args) };
});
const DRAW_RECT = primitive("drawrect", false, false);
const FILL_RECT = primitive("fillrect", true, false);
const DRAW_CIRCLE = primitive("drawcircle", false, true);
const FILL_CIRCLE = primitive("fillcircle", true, true);

function image(name: string, aliases: readonly string[], commandParams: ParamSpec[], mode: string): BuiltinSpec {
  return command(name, aliases, commandParams, docs(`Draw an image ${mode}.`, "Records the image asset, geometry, blend and optional canvas in the core surface effect seam; decoded assets are applied by the asset/render owner without host APIs."), (_view, args) => ({ value: null, effects: effects(args, "mixed") }));
}
const BITMAP = image("bitmap", [], params(["file", "canvas"], 1), "to fill the target surface");
const SET_IMAGE = image("setimage", [], params(["file", "x", "y", "width", "height", "canvas"], 5), "normally");
const SET_IMAGE_TRANSPARENT = image("setimagetransparent", [], params(["file", "x", "y", "width", "height", "r", "g", "b", "canvas"], 8), "with a colour key");
const SET_IMAGE_TRANSLUCENT = image("setimagetranslucent", [], params(["file", "x", "y", "width", "height", "canvas"], 5), "with translucency");
const SET_IMAGE_ADDITIVE = image("setimageadditive", [], params(["file", "x", "y", "width", "height", "percent", "canvas"], 6), "with additive tinting");

const GET_PIXEL = command("getpixel", [], [
  { name: "x", optional: false, byRef: false, variadic: false },
  { name: "y", optional: false, byRef: false, variadic: false },
  { name: "r", optional: false, byRef: true, variadic: false },
  { name: "g", optional: false, byRef: true, variadic: false },
  { name: "b", optional: false, byRef: true, variadic: false },
  { name: "canvas", optional: true, byRef: false, variadic: false },
], docs("Read one pixel's colour.", "Reads RGB from the screen or optional canvas; out-of-bounds reads return black and all three by-reference outputs are written immediately."), (view, args) => {
  const target = canvasArg(args, 5);
  if (target === SCREEN) view.refreshScreen?.();
  const pixel = getPixel(state(view).surfaces, target, Math.trunc(numberArg(args, 0)), Math.trunc(numberArg(args, 1)));
  const rgb = pixel ?? { r: 0, g: 0, b: 0 };
  return { value: rgb.r, out: [[2, rgb.r], [3, rgb.g], [4, rgb.b]], effects: [] };
});

const CREATE_CANVAS = command("createcanvas", [], [
  { name: "width", optional: false, byRef: false, variadic: false },
  { name: "height", optional: false, byRef: false, variadic: false },
  { name: "canvas", optional: true, byRef: true, variadic: false },
], docs("Create an off-screen canvas.", "Allocates a persistent transparent RGBA canvas with the requested integer dimensions and returns its monotonically increasing handle, also writing the optional by-reference output."), (view, args) => {
  const id = createSurface(state(view).surfaces, Math.max(0, Math.trunc(numberArg(args, 0))), Math.max(0, Math.trunc(numberArg(args, 1))));
  return { value: id, out: output(args, 2, id), effects: effects(args) };
});
const KILL_CANVAS = command("killcanvas", [], params(["canvas"]), docs("Release an off-screen canvas.", "Destroys the selected canvas; screen surface 0 is permanent and cannot be killed."), (view, args) => {
  const target = canvasArg(args, 0);
  if (!killSurface(state(view).surfaces, target)) throw new ScriptError("surface.unknown", `killcanvas: no canvas ${String(target)}`);
  return { value: null, effects: effects(args) };
});

const DRAW_CANVAS = command("drawcanvas", [], params(["canvas", "x", "y", "width", "height", "destination"], 3), docs("Draw one canvas onto another surface.", "Copies the canvas with nearest-neighbour sampling at x,y; optional dimensions resize it and the optional destination defaults to the screen."), (view, args) => {
  const current = state(view);
  const source = handle(args[0]?.value);
  const screenTarget = canvasArg(args, args.length >= 6 ? 5 : 3) === SCREEN;
  const destination = writingTarget(current, canvasArg(args, args.length >= 6 ? 5 : 3));
  if (source === SCREEN) view.refreshScreen?.();
  const width = args.length >= 5 ? numberArg(args, 3) : undefined;
  const height = args.length >= 5 ? numberArg(args, 4) : undefined;
  const marginCommand = prepareAuthorMarginBlit(current, screenTarget, source, numberArg(args, 1), numberArg(args, 2), width, height);
  const ok = blitSurface(current.surfaces, source, destination, numberArg(args, 1), numberArg(args, 2), width, height);
  if (!ok) throw new ScriptError("surface.unknown", "drawcanvas: source or destination canvas is not live");
  if (marginCommand?.kind === "blit") recordAuthorMarginCommand(current, screenTarget, marginCommand, marginCommand.dst);
  return { value: null, effects: effects(args) };
});
const DRAW_CANVAS_TRANSPARENT = command("drawcanvastransparent", [], params(["canvas", "x", "y", "r", "g", "b", "width", "height", "destination"], 6), docs("Draw a canvas with one colour transparent.", "Copies the selected canvas to the screen or optional destination, skipping the exact RGB key and optionally resizing it."), (view, args) => {
  const current = state(view);
  const source = handle(args[0]?.value);
  const screenTarget = canvasArg(args, args.length >= 9 ? 8 : 6) === SCREEN;
  const destination = writingTarget(current, canvasArg(args, args.length >= 9 ? 8 : 6));
  if (source === SCREEN) view.refreshScreen?.();
  const key = { r: numberArg(args, 3), g: numberArg(args, 4), b: numberArg(args, 5) };
  const width = args.length >= 8 ? numberArg(args, 6) : undefined;
  const height = args.length >= 8 ? numberArg(args, 7) : undefined;
  const marginCommand = prepareAuthorMarginBlit(current, screenTarget, source, numberArg(args, 1), numberArg(args, 2), width, height, key);
  const ok = blitSurface(current.surfaces, source, destination, numberArg(args, 1), numberArg(args, 2), width, height, key);
  if (!ok) throw new ScriptError("surface.unknown", "drawcanvastransparent: source or destination canvas is not live");
  if (marginCommand?.kind === "blit") recordAuthorMarginCommand(current, screenTarget, marginCommand, marginCommand.dst);
  return { value: null, effects: effects(args) };
});
const CANVAS_DRAW_PART = command("canvasdrawpart", [], params(["canvas", "x", "y", "xsrc", "ysrc", "width", "height", "destination"], 7), docs("Draw part of a canvas.", "Copies a source rectangle from the canvas to x,y on the screen or optional destination using nearest-neighbour pixels."), (view, args) => {
  const current = state(view);
  const source = handle(args[0]?.value);
  const screenTarget = canvasArg(args, 7) === SCREEN;
  const destination = writingTarget(current, canvasArg(args, 7));
  if (source === SCREEN) view.refreshScreen?.();
  const sourceRect = { x: numberArg(args, 3), y: numberArg(args, 4), w: numberArg(args, 5), h: numberArg(args, 6) };
  const marginCommand = prepareAuthorMarginBlit(current, screenTarget, source, numberArg(args, 1), numberArg(args, 2), undefined, undefined, undefined, sourceRect);
  const ok = blitSurface(current.surfaces, source, destination, numberArg(args, 1), numberArg(args, 2), undefined, undefined, undefined, 255, false, sourceRect);
  if (!ok) throw new ScriptError("surface.unknown", "canvasdrawpart: source or destination canvas is not live");
  if (marginCommand?.kind === "blit") recordAuthorMarginCommand(current, screenTarget, marginCommand, marginCommand.dst);
  return { value: null, effects: effects(args) };
});
const CANVAS_GET_SCREEN = command("canvasgetscreen", [], params(["destination"]), docs("Capture the current screen into a canvas.", "Copies the composed screen surface 0 into the destination canvas and increments its revision."), (view, args) => {
  view.refreshScreen?.();
  const revision = canvasGetScreen(state(view).surfaces, handle(args[0]?.value));
  if (revision === null) throw new ScriptError("surface.unknown", "canvasgetscreen: destination canvas is not live");
  return { value: revision, effects: effects(args) };
});

const SAVE_SCREEN = command("savescreen", [], params(["slot", "x1", "y1", "x2", "y2"], 0), docs("Save the screen into a numbered slot.", "Copies the whole screen by default, or the inclusive rectangle x1,y1 through x2,y2, into the numbered persistent slot."), (view, args) => {
  view.refreshScreen?.();
  const slot = Math.max(0, Math.trunc(numberArg(args, 0)));
  const sourceSize = surfaceSize(state(view).surfaces, SCREEN);
  const region = args.length >= 5 && sourceSize !== null
    ? { x: Math.trunc(numberArg(args, 1)), y: Math.trunc(numberArg(args, 2)), w: Math.trunc(numberArg(args, 3)) - Math.trunc(numberArg(args, 1)) + 1, h: Math.trunc(numberArg(args, 4)) - Math.trunc(numberArg(args, 2)) + 1 }
    : undefined;
  const saved = saveScreen(state(view).surfaces, slot, SCREEN, region);
  return { value: saved ?? 0, effects: effects(args) };
});
const RESTORE_SCREEN = command("restorescreen", [], params(["slot", "x1", "y1", "x2", "y2", "xdest", "ydest"], 0), docs("Restore a numbered screen slot.", "Copies the saved slot into the screen; optional source and destination rectangles select and place a region."), (view, args) => {
  const region = args.length >= 7
    ? { x: Math.trunc(numberArg(args, 1)), y: Math.trunc(numberArg(args, 2)), w: Math.trunc(numberArg(args, 3)) - Math.trunc(numberArg(args, 1)) + 1, h: Math.trunc(numberArg(args, 4)) - Math.trunc(numberArg(args, 2)) + 1, dx: Math.trunc(numberArg(args, 5)), dy: Math.trunc(numberArg(args, 6)) }
    : undefined;
  return { value: restoreScreen(state(view).surfaces, Math.max(0, Math.trunc(numberArg(args, 0))), writingTarget(state(view), SCREEN), undefined, region) ?? 0, effects: effects(args) };
});
const RESTORE_ARRAY = command("restorescreenarray", ["restorearrayscreen"], params(["slot", "x1", "y1", "x2", "y2", "xdest", "ydest"], 0), docs("Restore a numbered screen-array slot.", "Alias of restoreScreen: copies the selected saved slot or region into the screen immediately."), (view, args) => ({ value: restoreScreen(state(view).surfaces, Math.max(0, Math.trunc(numberArg(args, 0))), writingTarget(state(view), SCREEN)) ?? 0, effects: effects(args) }));

const RENDER_NOW = command("rendernow", [], params(["draw"]), docs("Show or hide the render-now overlay canvas.", "When draw is true, creates the reserved canvas (cleared, screen-sized) if it does not exist or was killed and turns drawing on above board content; an existing canvas keeps its pixels. When draw is false it only turns drawing off: the canvas, its handle and its pixels persist."), (view, args) => {
  const current = state(view);
  const enabled = Boolean(args[0]?.value);
  const surfaces = current.surfaces;
  if (enabled && renderNowCanvas(surfaces) === null) {
    const size = surfaceSize(surfaces, SCREEN);
    surfaces.renderNow = createSurface(surfaces, size?.w ?? 0, size?.h ?? 0);
  }
  surfaces.renderNowOn = enabled;
  return { value: null, effects: effects(args, "state-write", "engine") };
});

const RENDER_NOW_ENABLED = command("rendernowenabled", [], [], docs("Read whether the render-now overlay canvas is drawn.", "Returns 1 while rendernow(true) is in effect and the reserved canvas is live, otherwise 0. It changes nothing and does not wait."), (view) => ({ value: renderNowEnabled(state(view).surfaces) ? 1 : 0, effects: [] }));

const GET_RES = command("getres", [], [
  { name: "x", optional: false, byRef: true, variadic: false },
  { name: "y", optional: false, byRef: true, variadic: false },
], docs("Read the logical screen resolution.", "Writes the screen surface width and height to the two by-reference outputs without waiting."), (view, args) => {
  const size = surfaceSize(state(view).surfaces, SCREEN) ?? { w: 0, h: 0 };
  return { value: size.w, out: [[0, size.w], [1, size.h]], effects: [] };
});
const VIEW_BRD = image("viewbrd", [], params(["file", "x", "y", "canvas"], 1), "by previewing a board through composeBoard");
const DRAW_ENEMY = image("drawenemy", [], params(["file", "x", "y"], 3), "as a battle enemy");

export const GRAPHICS_COMMANDS: readonly BuiltinSpec[] = [
  CLEAR, SET_PIXEL, DRAW_LINE, DRAW_RECT, FILL_RECT, DRAW_CIRCLE, FILL_CIRCLE,
  BITMAP, SET_IMAGE, SET_IMAGE_TRANSPARENT, SET_IMAGE_TRANSLUCENT, SET_IMAGE_ADDITIVE,
  GET_PIXEL, SAVE_SCREEN, RESTORE_SCREEN, RESTORE_ARRAY, RENDER_NOW, RENDER_NOW_ENABLED, VIEW_BRD, GET_RES, DRAW_ENEMY,
  CREATE_CANVAS, KILL_CANVAS, DRAW_CANVAS, DRAW_CANVAS_TRANSPARENT, CANVAS_DRAW_PART, CANVAS_GET_SCREEN,
];
export const GRAPHICS_PLUGIN: PluginDefinition = { id: "graphics", version: "1.0.0", doc: { summary: "Deterministic canvases, drawing, image and screen-save commands.", groups: [] }, commands: GRAPHICS_COMMANDS };

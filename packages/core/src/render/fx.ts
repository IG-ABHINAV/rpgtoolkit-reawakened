/** Deterministic screen effects (E-59; docs/spec/engine/rpgcode-functions.md#e-59). */
import type { DrawCommand, DrawList, Rect, Rgb } from "../ports/draw.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { EffectRecord } from "../script/effects.ts";
import { ScriptError } from "../script/errors.ts";
import type { GameState } from "../save/state.ts";
import { createFxSection, type FxSection, type FxColor } from "../save/sections/fx.ts";
import { shake } from "../world/camera.ts";
import { animationBlits, applyAnimationEffect, type FrameSourceSize } from "./animation.ts";

function ensureFx(state: GameState): FxSection {
  const current = state.fx as Partial<FxSection>;
  if (
    current.borderColor === undefined ||
    current.fade === undefined ||
    current.wipe === undefined ||
    current.zoomPercent === undefined ||
    current.zoom === undefined ||
    current.earthquake === undefined ||
    current.animations === undefined ||
    current.nextAnimationId === undefined
  ) {
    state.fx = { ...createFxSection(), ...state.fx };
  }
  return state.fx;
}
const TOTAL_TICKS = 30;
const GREY: Rgb = { r: 128, g: 128, b: 128 };

function numberArg(args: readonly unknown[], index: number, fallback = 0): number {
  const value = args[index];
  return typeof value === "number" ? value : fallback;
}

function color(value: FxColor): Rgb {
  return { r: value.r, g: value.g, b: value.b };
}

function effectProgress(elapsed: number, total: number): number {
  return Math.max(0, Math.min(total, elapsed));
}

function fadeCommands(fx: FxSection, width: number, height: number): DrawCommand[] {
  const fade = fx.fade;
  if (fade === null || fade === undefined) return [];
  const p = effectProgress(fade.elapsedTicks, TOTAL_TICKS) / TOTAL_TICKS;
  const rgb = color(fx.borderColor);
  switch (fade.type) {
    case 0: {
      const w = Math.round(width * p);
      const h = Math.round(height * p);
      return w <= 0 || h <= 0 ? [] : [{ kind: "rect", rect: { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h }, rgb, filled: true }];
    }
    case 1: {
      const stripe = Math.max(1, Math.round(width * p / 8));
      const commands: DrawCommand[] = [];
      for (let x = 0; x < width; x += stripe * 2) commands.push({ kind: "rect", rect: { x, y: 0, w: Math.min(stripe, width - x), h: height }, rgb, filled: true });
      return commands;
    }
    case 2:
      return p <= 0 ? [] : [{ kind: "fill", rgb: GREY }];
    case 3: {
      const w = Math.round(width * p);
      return w <= 0 ? [] : [{ kind: "rect", rect: { x: 0, y: 0, w, h: height }, rgb: GREY, filled: true }];
    }
    case 4: {
      const w = Math.round(width * p);
      const h = Math.round(height * p);
      return w <= 0 || h <= 0 ? [] : [{ kind: "ellipse", rect: { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h }, rgb: { r: 0, g: 0, b: 0 }, filled: false }];
    }
    case 5:
      return p <= 0 ? [] : [{ kind: "rect", rect: { x: 0, y: 0, w: width, h: height }, rgb, filled: true }];
  }
}

function imageCommand(asset: string, src: Rect, dst: Rect): DrawCommand {
  return {
    kind: "blit",
    source: { asset: asset as AssetKey, tile: null },
    src,
    dst,
    key: null,
    tint: { r: 0, g: 0, b: 0 },
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
}

function wipeCommands(fx: FxSection, width: number, height: number): DrawCommand[] {
  const wipe = fx.wipe;
  if (wipe === null || wipe === undefined || wipe.asset === null) return [];
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const progress = Math.max(0, Math.min(wipe.total, wipe.progress));
  const asset = wipe.asset;
  if (progress >= wipe.total) return [imageCommand(asset, { x: 0, y: 0, w, h }, { x: 0, y: 0, w, h })];
  const commands: DrawCommand[] = [];
  const reveal = (src: Rect): void => {
    if (src.w > 0 && src.h > 0) commands.push(imageCommand(asset, src, { ...src }));
  };
  switch (wipe.effect) {
    case 1:
      reveal({ x: 0, y: 0, w: Math.min(w, Math.floor(progress)), h });
      break;
    case 2: {
      const span = Math.min(w, Math.floor(progress));
      reveal({ x: w - span, y: 0, w: span, h });
      break;
    }
    case 3:
      reveal({ x: 0, y: 0, w, h: Math.min(h, Math.floor(progress)) });
      break;
    case 4: {
      const span = Math.min(h, Math.floor(progress));
      reveal({ x: 0, y: h - span, w, h: span });
      break;
    }
    case 5:
    case 6:
    case 7:
    case 8: {
      const maxDistance = w + h - 1;
      const limit = Math.floor(progress);
      for (let y = 0; y < h; y += 1) {
        let xStart = 0;
        let xEnd = w;
        if (wipe.effect === 5 || wipe.effect === 7) xStart = 0;
        else xStart = Math.max(0, w - 1 - limit - y);
        if (wipe.effect === 5 || wipe.effect === 6) xEnd = Math.min(w, limit - y + 1);
        else xEnd = Math.min(w, maxDistance - limit + y);
        if (xEnd > xStart) reveal({ x: xStart, y, w: xEnd - xStart, h: 1 });
      }
      break;
    }
    case 9:
      commands.push(imageCommand(asset, { x: 0, y: 0, w, h }, { x: Math.floor(progress) - w, y: 0, w, h }));
      break;
    case 10:
      commands.push(imageCommand(asset, { x: 0, y: 0, w, h }, { x: w - Math.floor(progress), y: 0, w, h }));
      break;
    case 11:
      commands.push(imageCommand(asset, { x: 0, y: 0, w, h }, { x: 0, y: Math.floor(progress) - h, w, h }));
      break;
    case 12:
      commands.push(imageCommand(asset, { x: 0, y: 0, w, h }, { x: 0, y: h - Math.floor(progress), w, h }));
      break;
  }
  return commands;
}

function scaleRect(rect: Rect, scale: number, cx: number, cy: number): Rect {
  return {
    x: Math.round(cx + (rect.x - cx) * scale),
    y: Math.round(cy + (rect.y - cy) * scale),
    w: Math.max(1, Math.round(rect.w * scale)),
    h: Math.max(1, Math.round(rect.h * scale)),
  };
}

function zoomCommand(command: DrawCommand, scale: number, cx: number, cy: number): DrawCommand {
  switch (command.kind) {
    case "blit":
      return { ...command, dst: scaleRect(command.dst, scale, cx, cy) };
    case "rect":
    case "ellipse":
      return { ...command, rect: scaleRect(command.rect, scale, cx, cy) };
    case "line":
      return { ...command, x1: Math.round(cx + (command.x1 - cx) * scale), y1: Math.round(cy + (command.y1 - cy) * scale), x2: Math.round(cx + (command.x2 - cx) * scale), y2: Math.round(cy + (command.y2 - cy) * scale) };
    case "text":
      return { ...command, x: Math.round(cx + (command.x - cx) * scale), y: Math.round(cy + (command.y - cy) * scale) };
    default:
      return command;
  }
}

/** Apply a recorded `fx` command to saveable state. */
export function applyFxEffect(state: GameState, effect: EffectRecord): void {
  if (effect.name === "animation" || effect.name === "sizedanimation" || effect.name === "pinnedanimation" || effect.name === "showpinnedanimation" || effect.name === "endanimation") {
    applyAnimationEffect(state, effect);
    return;
  }
  const args = effect.args ?? [];
  if (effect.name === "bordercolor") {
    const fx = ensureFx(state);
    fx.borderColor = { r: Math.max(0, Math.min(255, Math.trunc(numberArg(args, 0)))), g: Math.max(0, Math.min(255, Math.trunc(numberArg(args, 1)))), b: Math.max(0, Math.min(255, Math.trunc(numberArg(args, 2)))) };
    return;
  }
  if (effect.name === "fade") {
    const type = Math.trunc(numberArg(args, 0));
    if (type < 0 || type > 5) return;
    const fx = ensureFx(state);
    fx.fade = { kind: "fade", type: type as 0 | 1 | 2 | 3 | 4 | 5, elapsedTicks: 0, totalTicks: TOTAL_TICKS };
    return;
  }
  if (effect.name === "wipe") {
    const file = typeof args[0] === "string" ? args[0] : "";
    const effectType = Math.trunc(numberArg(args, 1));
    const speed = numberArg(args, 2, 1);
    if (effectType < 1 || effectType > 12 || !Number.isFinite(speed) || speed <= 0) return;
    const entries = "entries" in state.surfaces ? state.surfaces.entries : undefined;
    const frame = entries?.["0"]?.bitmap;
    const width = frame?.w ?? 640;
    const height = frame?.h ?? 480;
    const total = effectType <= 4 || effectType >= 9
      ? (effectType === 3 || effectType === 4 || effectType >= 11 ? height : width)
      : width + height - 1;
    const fx = ensureFx(state);
    fx.wipe = { kind: "wipe", file, asset: file as AssetKey, effect: effectType as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12, speed, elapsedTicks: 0, progress: 0, total };
    return;
  }
  if (effect.name === "zoom") {
    const target = numberArg(args, 0);
    if (!Number.isFinite(target) || !Number.isInteger(target) || target < 0 || target > 75) return;
    const fx = ensureFx(state);
    fx.zoom = { kind: "zoom", from: fx.zoomPercent, target, elapsedTicks: 0, totalTicks: TOTAL_TICKS };
    return;
  }
  if (effect.name === "earthquake") {
    const intensity = Math.max(1, Math.min(10, Math.trunc(numberArg(args, 0, 1))));
    const fx = ensureFx(state);
    fx.earthquake = { kind: "earthquake", intensity, pass: 1 };
    state.camera = { ...state.camera, shake: shake(1, 4) };
  }
}

/** Advance all active effects by exactly one fixed simulation tick. */
export function advanceFx(state: GameState): void {
  const current = state.fx as Partial<FxSection>;
  if (current.fade === undefined && current.wipe === undefined && current.zoom === undefined && current.earthquake === undefined && current.borderColor === undefined) return;
  const fx = ensureFx(state);
  const fade = fx.fade;
  if (fade !== null && fade.elapsedTicks < TOTAL_TICKS) fx.fade = { ...fade, elapsedTicks: fade.elapsedTicks + 1 };
  const wipe = fx.wipe;
  if (wipe !== null && wipe.progress < wipe.total) {
    const elapsedTicks = wipe.elapsedTicks + 1;
    fx.wipe = { ...wipe, elapsedTicks, progress: Math.min(wipe.total, wipe.speed * elapsedTicks) };
  }
  const zoom = fx.zoom;
  if (zoom !== null) {
    const elapsedTicks = Math.min(TOTAL_TICKS, zoom.elapsedTicks + 1);
    const zoomPercent = elapsedTicks >= TOTAL_TICKS ? zoom.target : zoom.from + Math.floor((zoom.target - zoom.from) * elapsedTicks / TOTAL_TICKS);
    fx.zoomPercent = zoomPercent;
    fx.zoom = elapsedTicks >= TOTAL_TICKS ? null : { ...zoom, elapsedTicks };
  }
  const quake = fx.earthquake;
  if (quake !== null && state.camera.shake === null) {
    if (quake.pass >= quake.intensity) fx.earthquake = null;
    else {
      const pass = quake.pass + 1;
      fx.earthquake = { ...quake, pass };
      state.camera = { ...state.camera, shake: shake(pass, 4) };
    }
  }
}

/** Append effect commands and apply the active centred presentation zoom. */
export function applyFxDrawList(list: DrawList, fx: FxSection, sourceSize: FrameSourceSize): DrawList {
  const defaults = createFxSection();
  const normalized: FxSection = {
    ...defaults,
    ...fx,
    borderColor: fx.borderColor ?? defaults.borderColor,
    fade: fx.fade ?? defaults.fade,
    wipe: fx.wipe ?? defaults.wipe,
    zoomPercent: fx.zoomPercent ?? defaults.zoomPercent,
    zoom: fx.zoom ?? defaults.zoom,
    earthquake: fx.earthquake ?? defaults.earthquake,
    animations: fx.animations ?? defaults.animations,
    nextAnimationId: fx.nextAnimationId ?? defaults.nextAnimationId,
  };
  const zoom = normalized.zoomPercent <= 0 ? 1 : 100 / Math.max(1, 100 - normalized.zoomPercent);
  const cx = list.width / 2;
  const cy = list.height / 2;
  const commands = list.commands.map((command) => zoom === 1 ? command : zoomCommand(command, zoom, cx, cy));
  commands.push(...animationBlits(normalized, false, sourceSize));
  commands.push(...wipeCommands(normalized, list.width, list.height));
  commands.push(...fadeCommands(normalized, list.width, list.height));
  return { ...list, commands };
}

/** Validate the public argument contract used by the render pack. */
export function validateFxArgument(name: string, args: readonly { readonly value: unknown }[]): void {
  const values = args.map((arg) => arg.value);
  if (name === "fade") {
    const type = values.length === 0 ? 0 : values[0];
    if (typeof type !== "number" || !Number.isFinite(type) || !Number.isInteger(type)) throw new ScriptError("builtin.bad-arg", "fade type must be an integer");
  } else if (name === "wipe") {
    const effect = values[1];
    const speed = values.length < 3 ? 1 : values[2];
    if (typeof values[0] !== "string" || typeof effect !== "number" || !Number.isInteger(effect) || effect < 1 || effect > 12 || typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) throw new ScriptError("builtin.bad-arg", "wipe requires an image, effect 1 to 12 and positive speed");
  } else if (name === "zoom") {
    const percent = values[0];
    if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 75) throw new ScriptError("builtin.bad-arg", "zoom shrink amount must be an integer from 0 to 75");
  }
}

export { TOTAL_TICKS as FX_TOTAL_TICKS };

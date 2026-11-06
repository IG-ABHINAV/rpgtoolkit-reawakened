/** Script animation playback and compositor records (E-54; docs/spec/engine/plugins-and-battle.md#e-54, docs/spec/formats/animation.md). */
import { decodeGif } from "../formats/image/index.ts";
import { readAnimation } from "../formats/animation/reader.ts";
import { classifyImageReference } from "../formats/animation/image-reference.ts";
import { BinaryReader } from "../formats/binary/reader.ts";
import { frameAt, secondsToTicks } from "../time/time.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { DrawCommand, Rect, Rgb } from "../ports/draw.ts";
import { createSurface, killSurface } from "../raster/surfaces.ts";
import type { AnimationFrameState, AnimationState, FxSection } from "../save/sections/fx.ts";
import type { GameState } from "../save/state.ts";

/** Resolve a frame's image reference to the asset and tile a draw command names (E-54). */
export type ImageResolver = (image: string) => { readonly asset: AssetKey; readonly tile: number | null } | null;

/** Resolve a frame's decoded source bounds, independent of its destination canvas. */
export type FrameSourceSize = (frame: AnimationFrameState) => { readonly w: number; readonly h: number } | null;

/** Decoded frame metadata for one `.anm` or GIF: what every consumer (script or sprite) draws from. */
export type DecodedAnimation = {
  readonly width: number;
  readonly height: number;
  readonly delayTicks: number;
  readonly frames: AnimationFrameState[];
  /** An animated GIF's per-frame RGBA, in frame order; absent for a binary `.anm`. */
  readonly gifPixels?: readonly Uint8Array[];
};

function frameColor(color: { readonly r: number; readonly g: number; readonly b: number }): Rgb {
  return { r: color.r, g: color.g, b: color.b };
}

/**
 * Decode an animation file into its frame metadata (docs/spec/formats/animation.md): a per-frame image
 * reference resolved to an asset and tile index, the transparent colour, the frame sound and the frame size,
 * with empty frame slots dropped (a gap shortens the sequence). Shared by script animations and by actor
 * walk/idle playback, so one file's frames are decoded the same way for every consumer (E-54).
 */
export function decodeAnimationFrames(
  bytes: Uint8Array,
  path: string,
  sourceAsset: AssetKey,
  resolver: ImageResolver,
): DecodedAnimation | null {
  if (path.toLowerCase().endsWith(".gif")) {
    const gif = decodeGif(bytes, path);
    if (!gif.ok || gif.value.frames.length === 0) return null;
    const delayTicks = secondsToTicks(gif.value.frames[0]?.delay ?? 0) ?? 1;
    return {
      width: gif.value.w,
      height: gif.value.h,
      delayTicks,
      gifPixels: gif.value.frames.map((frame) => frame.rgba),
      frames: gif.value.frames.map((_frame) => ({
        image: path,
        asset: sourceAsset,
        tile: null,
        srcWidth: gif.value.w,
        srcHeight: gif.value.h,
        transparent: frameColor(gif.value.transparent),
        sound: "",
      })),
    };
  }
  const parsed = readAnimation(new BinaryReader(bytes, path));
  if (!parsed.ok) return null;
  const frames: AnimationFrameState[] = [];
  for (const frame of parsed.value.frames) {
    const resolved = classifyImageReference(frame.image);
    if (resolved.kind === "empty") continue;
    // The resolver receives the frame's whole image reference (`char.tst1`, `x.gph`, a picture path), because a tile
    // reference is `tileset + index` and the tileset name alone classifies as a picture (README.md#tile-references).
    const target = resolver(frame.image);
    if (target === null) continue;
    frames.push({
      image: frame.image,
      asset: target.asset,
      tile: resolved.kind === "tile" ? resolved.index : target.tile,
      srcWidth: parsed.value.width,
      srcHeight: parsed.value.height,
      transparent: frameColor(frame.transparent),
      sound: frame.sound,
    });
  }
  if (frames.length === 0) return null;
  return {
    width: parsed.value.width,
    height: parsed.value.height,
    delayTicks: secondsToTicks(parsed.value.delay) ?? 1,
    frames,
  };
}

/** Decode a fetched `.anm` or GIF into saveable frame metadata. */
export function loadAnimation(state: GameState, animation: AnimationState, bytes: Uint8Array, resolver: ImageResolver): boolean {
  const sourceAsset = animation.asset ?? (animation.file as AssetKey);
  const loaded = decodeAnimationFrames(bytes, animation.file, sourceAsset, resolver);
  if (loaded === null) return false;
  animation.asset = sourceAsset;
  animation.width = animation.width > 0 ? animation.width : loaded.width;
  animation.height = animation.height > 0 ? animation.height : loaded.height;
  animation.delayTicks = loaded.delayTicks;
  animation.frames = loaded.frames;
  if (loaded.gifPixels !== undefined && state.surfaces.entries !== undefined && state.surfaces.nextId !== undefined) {
    animation.frames = loaded.frames.map((frame, index) => {
      const pixels = loaded.gifPixels?.[index];
      if (pixels === undefined) return frame;
      return { ...frame, surface: createSurface(state.surfaces, loaded.width, loaded.height, pixels) };
    });
  }
  animation.frame = 0;
  animation.originTick = state.time.tick;
  animation.soundFrame = -1;
  animation.loaded = true;
  return true;
}

/** Release the surfaces the engine decoded for an animation (an animated GIF's frames) once nothing draws it any more. */
export function releaseAnimationSurfaces(state: GameState, animation: AnimationState): void {
  if (state.surfaces.entries === undefined) return;
  for (const frame of animation.frames) if (frame.surface !== undefined) killSurface(state.surfaces, frame.surface);
}

/** Advance active animation frames and return newly-entered frame sounds. */
export function advanceAnimations(state: GameState): readonly { readonly file: string; readonly sound: string }[] {
  const fx = state.fx as Partial<FxSection>;
  const animations = fx.animations;
  if (animations === undefined) return [];
  const sounds: { file: string; sound: string }[] = [];
  const kept: AnimationState[] = [];
  for (const animation of animations) {
    if (animation.finished || !animation.loaded || animation.frames.length === 0) {
      if (!animation.finished) kept.push(animation);
      continue;
    }
    const frame = frameAt(animation.originTick, state.time.tick, animation.delayTicks, animation.frames.length, animation.loop);
    if (frame < 0) continue;
    animation.frame = frame;
    if (animation.soundFrame !== frame) {
      animation.soundFrame = frame;
      const sound = animation.frames[frame]?.sound ?? "";
      if (sound !== "") sounds.push({ file: animation.file, sound });
    }
    if (animation.pinned !== true && !animation.loop && state.time.tick - animation.originTick >= animation.delayTicks * animation.frames.length) {
      animation.finished = true;
      releaseAnimationSurfaces(state, animation);
    } else {
      kept.push(animation);
    }
  }
  state.fx = { ...state.fx, animations: kept };
  return sounds;
}

function rect(animation: AnimationState, frame: AnimationFrameState): Rect {
  return { x: animation.x, y: animation.y, w: animation.width > 0 ? animation.width : frame.srcWidth, h: animation.height > 0 ? animation.height : frame.srcHeight };
}

/** Active script animations in creation order: the ordinary ones sit above the composed board, the pinned ones above the render-now canvas. */
export function animationBlits(fx: FxSection, pinned: boolean, sourceSize: FrameSourceSize): DrawCommand[] {
  const commands: DrawCommand[] = [];
  for (const animation of fx.animations) {
    if ((animation.pinned === true) !== pinned || animation.hidden === true) continue;
    if (!animation.loaded || animation.finished || animation.frames.length === 0) continue;
    const frame = animation.frames[animation.frame];
    if (frame === undefined || (frame.surface === undefined && frame.asset === null)) continue;
    const size = frame.surface === undefined ? sourceSize(frame) : { w: frame.srcWidth, h: frame.srcHeight };
    if (size === null) continue;
    const source = frame.surface === undefined
      ? { asset: frame.asset!, tile: frame.tile }
      : { surface: frame.surface, rev: 0 };
    commands.push({
      kind: "blit",
      source,
      src: { x: 0, y: 0, w: size.w, h: size.h },
      dst: rect(animation, frame),
      key: frameColor(frame.transparent),
      tint: { r: 0, g: 0, b: 0 },
      alpha: 255,
      blend: "normal",
      iso2d: false,
    });
  }
  return commands;
}

/** Apply a recorded `fx` command to saveable animation state. */
export function applyAnimationEffect(state: GameState, effect: { readonly name: string; readonly args?: readonly unknown[]; readonly result?: unknown }): void {
  const fx = state.fx as Partial<FxSection>;
  const current = fx.animations ?? [];
  if (effect.name === "endanimation") {
    const id = typeof effect.args?.[0] === "number" ? Math.trunc(effect.args[0]) : -1;
    for (const animation of current) if (animation.id === id) releaseAnimationSurfaces(state, animation);
    state.fx = { ...createAnimationDefaults(fx), animations: current.filter((animation) => animation.id !== id) };
    return;
  }
  if (effect.name === "showpinnedanimation") {
    const id = typeof effect.args?.[0] === "number" ? Math.trunc(effect.args[0]) : -1;
    const show = effect.args?.[1] === true || effect.args?.[1] === 1;
    state.fx = {
      ...createAnimationDefaults(fx),
      animations: current.map((animation) => {
        if (animation.id !== id || animation.pinned !== true) return animation;
        const { hidden: _hidden, ...rest } = animation;
        return show ? rest : { ...rest, hidden: true as const };
      }),
    };
    return;
  }
  if (effect.name !== "animation" && effect.name !== "sizedanimation" && effect.name !== "pinnedanimation") return;
  const args = effect.args ?? [];
  const file = typeof args[0] === "string" ? args[0] : "";
  const x = typeof args[1] === "number" ? Math.trunc(args[1]) : 0;
  const y = typeof args[2] === "number" ? Math.trunc(args[2]) : 0;
  const sized = effect.name === "sizedanimation";
  const height = sized && typeof args[3] === "number" ? Math.max(1, Math.trunc(args[3])) : 0;
  const width = sized && typeof args[4] === "number" ? Math.max(1, Math.trunc(args[4])) : 0;
  const loopArg = args[sized ? 5 : 3];
  const loop = loopArg === true || loopArg === 1;
  const resultId = typeof effect.result === "number" ? Math.trunc(effect.result) : 0;
  const id = resultId > 0 ? resultId : (fx.nextAnimationId ?? 1);
  const nextAnimationId = Math.max(fx.nextAnimationId ?? 1, id + 1);
  const animation: AnimationState = {
    id, file, asset: null, x, y, width, height, loop, ...(effect.name === "pinnedanimation" ? { pinned: true as const } : {}), originTick: state.time.tick,
    delayTicks: 1, frame: 0, frames: [], loaded: false, finished: false, soundFrame: -1,
  };
  state.fx = { ...createAnimationDefaults(fx), animations: [...current, animation], nextAnimationId };
}

function createAnimationDefaults(fx: Partial<FxSection>): FxSection {
  return {
    borderColor: fx.borderColor ?? { r: 0, g: 0, b: 0 },
    fade: fx.fade ?? null,
    wipe: fx.wipe ?? null,
    zoomPercent: fx.zoomPercent ?? 0,
    zoom: fx.zoom ?? null,
    earthquake: fx.earthquake ?? null,
    animations: fx.animations ?? [],
    nextAnimationId: fx.nextAnimationId ?? 1,
  };
}

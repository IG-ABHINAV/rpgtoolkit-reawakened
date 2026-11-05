import type { DecodedTexture } from "../formats/image/model.ts";
import type { LegacyFont } from "../formats/font/model.ts";
import type { TrueTypeFont } from "../formats/font/truetype.ts";
import { textInk } from "./text.ts";
import { ellipsePixels, isoSourceOffset, linePixels, rectOutlinePixels } from "./shapes.ts";
import { tintChannel } from "./tint.ts";
import type {
  BlitCommand,
  DrawCommand,
  DrawList,
  EllipseCommand,
  Rgb,
  Rect,
  TextCommand,
} from "../ports/draw.ts";
import type { AssetKey, ScratchId, SurfaceId } from "../ports/keys.ts";

export type RasterAsset = DecodedTexture | LegacyFont | TrueTypeFont | Uint8Array;
export type RasterAssets = ReadonlyMap<AssetKey, RasterAsset>;

export type RasterSurfaces = ReadonlyMap<SurfaceId, DecodedTexture> & {
  get(surface: SurfaceId, revision?: number): DecodedTexture | undefined;
};
export type RasterResult = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly error: string | null;
};

type Target = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };
type TargetEntry = Target & { readonly scratch: ScratchId | null };

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, value));

function validRect(rect: Rect): boolean {
  return Number.isInteger(rect.x) && Number.isInteger(rect.y) &&
    Number.isInteger(rect.w) && Number.isInteger(rect.h) &&
    rect.w >= 0 && rect.h >= 0;
}
function isTexture(asset: RasterAsset | undefined): asset is DecodedTexture {
  return asset !== undefined && "rgba" in asset && "w" in asset && "h" in asset;
}

function isFont(asset: RasterAsset | undefined): asset is LegacyFont {
  return asset !== undefined && "values" in asset && asset.values.length >= 256 * 8;
}

function isTrueTypeFont(asset: RasterAsset | undefined): asset is TrueTypeFont {
  return asset !== undefined && typeof asset === "object" && "kind" in asset && asset.kind === "truetype";
}

function sourceTexture(
  command: BlitCommand,
  assets: RasterAssets,
  surfaces: RasterSurfaces,
): DecodedTexture | null {
  if ("asset" in command.source) {
    const asset = assets.get(command.source.asset);
    return isTexture(asset) ? asset : null;
  }
  return surfaces.get(command.source.surface, command.source.rev) ?? null;
}

function drawPixel(target: TargetEntry, x: number, y: number, rgb: Rgb): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const at = (y * target.width + x) * 4;
  target.rgba[at] = clampByte(rgb.r);
  target.rgba[at + 1] = clampByte(rgb.g);
  target.rgba[at + 2] = clampByte(rgb.b);
  target.rgba[at + 3] = 255;
}

function drawLine(target: TargetEntry, x1: number, y1: number, x2: number, y2: number, rgb: Rgb): void {
  for (const [x, y] of linePixels(x1, y1, x2, y2)) drawPixel(target, x, y, rgb);
}

function drawRect(target: TargetEntry, rect: Rect, rgb: Rgb, filled: boolean): void {
  if (rect.w <= 0 || rect.h <= 0) return;
  if (filled) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) drawPixel(target, x, y, rgb);
    }
    return;
  }
  for (const [x, y] of rectOutlinePixels(rect)) drawPixel(target, x, y, rgb);
}

/**
 * Plot a midpoint ellipse over the inclusive integer box. This is the
 * all-integer algorithm specified by E-17; collecting row extrema lets the
 * filled variant use exactly the same generated boundary.
 */
function drawEllipse(target: TargetEntry, command: EllipseCommand): void {
  for (const [x, y] of ellipsePixels(command.rect, command.filled)) drawPixel(target, x, y, command.rgb);
}

/** A tileset texture is a strip of tiles 32 pixels apart, or 64 for the diamonds of an `.iso` tileset. */
function sourceOffset(command: BlitCommand): number {
  if (!("asset" in command.source) || command.source.tile === null) return 0;
  return (command.source.tile - 1) * (command.source.asset.endsWith(".iso") ? 64 : 32);
}

type BlendTarget = "ad3" | "screen";

function blend(
  target: TargetEntry,
  at: number,
  source: [number, number, number, number],
  command: BlitCommand,
  blendTarget: BlendTarget,
): void {
  const [sr, sg, sb, sa] = source;
  const tint = command.tint;
  const tinted = tint.r !== 0 || tint.g !== 0 || tint.b !== 0;
  const r = tintChannel(sr, tint.r, tinted);
  const g = tintChannel(sg, tint.g, tinted);
  const b = tintChannel(sb, tint.b, tinted);
  const alpha = Math.max(0, Math.min(255, command.alpha));
  if (blendTarget === "screen") {
    const effective = Math.trunc(sa * alpha / 255);
    const dr = target.rgba[at] ?? 0;
    const dg = target.rgba[at + 1] ?? 0;
    const db = target.rgba[at + 2] ?? 0;
    if (command.blend === "additive") {
      target.rgba[at] = Math.min(255, dr + Math.trunc(r * alpha / 255));
      target.rgba[at + 1] = Math.min(255, dg + Math.trunc(g * alpha / 255));
      target.rgba[at + 2] = Math.min(255, db + Math.trunc(b * alpha / 255));
      target.rgba[at + 3] = 255;
    } else if (effective >= 255) {
      target.rgba[at] = r;
      target.rgba[at + 1] = g;
      target.rgba[at + 2] = b;
      target.rgba[at + 3] = sa;
    } else if (effective > 0) {
      target.rgba[at] = Math.trunc((r * effective + dr * (255 - effective)) / 255);
      target.rgba[at + 1] = Math.trunc((g * effective + dg * (255 - effective)) / 255);
      target.rgba[at + 2] = Math.trunc((b * effective + db * (255 - effective)) / 255);
      target.rgba[at + 3] = 255;
    }
    return;
  }
  if (command.blend === "normal") {
    target.rgba[at] = r;
    target.rgba[at + 1] = g;
    target.rgba[at + 2] = b;
    target.rgba[at + 3] = sa;
    return;
  }
  const dr = target.rgba[at] ?? 0;
  const dg = target.rgba[at + 1] ?? 0;
  const db = target.rgba[at + 2] ?? 0;
  if (command.blend === "translucent") {
    target.rgba[at] = Math.floor((dr * (255 - alpha) + r * alpha + 127) / 255);
    target.rgba[at + 1] = Math.floor((dg * (255 - alpha) + g * alpha + 127) / 255);
    target.rgba[at + 2] = Math.floor((db * (255 - alpha) + b * alpha + 127) / 255);
  } else {
    target.rgba[at] = Math.min(255, dr + Math.floor((r * alpha + 127) / 255));
    target.rgba[at + 1] = Math.min(255, dg + Math.floor((g * alpha + 127) / 255));
    target.rgba[at + 2] = Math.min(255, db + Math.floor((b * alpha + 127) / 255));
  }
  target.rgba[at + 3] = 255;
}

function drawBlit(
  target: TargetEntry,
  command: BlitCommand,
  assets: RasterAssets,
  surfaces: RasterSurfaces,
  blendTarget: BlendTarget,
): string | null {
  const texture = sourceTexture(command, assets, surfaces);
  if (!texture) return "missing decoded texture or surface";
  if (!validRect(command.src) || !validRect(command.dst) || command.dst.w <= 0 || command.dst.h <= 0) {
    return "invalid blit rectangle";
  }
  const tileOffset = sourceOffset(command);
  for (let y = 0; y < command.dst.h; y += 1) {
    for (let x = 0; x < command.dst.w; x += 1) {
      const iso = command.iso2d ? isoSourceOffset(x, y) : null;
      if (command.iso2d && !iso) continue;
      const sourceX = iso
        ? command.src.x + Math.floor(iso[0] * command.src.w / 32)
        : command.src.x + Math.floor(x * command.src.w / command.dst.w);
      const sourceY = iso
        ? command.src.y + Math.floor(iso[1] * command.src.h / 32)
        : command.src.y + Math.floor(y * command.src.h / command.dst.h);
      const tx = tileOffset + sourceX;
      if (tx < 0 || sourceY < 0 || tx >= texture.w || sourceY >= texture.h) {
        return "blit source rectangle is outside its decoded texture";
      }
      const si = (sourceY * texture.w + tx) * 4;
      const sr = texture.rgba[si] ?? 0;
      const sg = texture.rgba[si + 1] ?? 0;
      const sb = texture.rgba[si + 2] ?? 0;
      const sa = texture.rgba[si + 3] ?? 0;
      // The key is tested on the sampled pixels — a composed picture's pixels already include their cell shade — and
      // the world tint is applied after it (docs/spec/engine/runners.md#blit-pipeline).
      if ((sa === 0 && blendTarget === "ad3") || (command.key !== null && sr === command.key.r && sg === command.key.g && sb === command.key.b)) continue;
      const dx = command.dst.x + x;
      const dy = command.dst.y + y;
      if (dx < 0 || dy < 0 || dx >= target.width || dy >= target.height) continue;
      blend(target, (dy * target.width + dx) * 4, [sr, sg, sb, sa], command, blendTarget);
    }
  }
  return null;
}

function drawText(
  target: TargetEntry,
  command: TextCommand,
  assets: RasterAssets,
): string | null {
  const ink = textInk(command, assets.get(command.font.asset));
  if (ink === null) return "missing bitmap font asset";

  const { r, g, b } = command.rgb;
  for (const { x, y, coverage } of ink) {
    if (x < 0 || y < 0 || x >= target.width || y >= target.height) continue;
    const at = (y * target.width + x) * 4;
    if (coverage === 255) {
      target.rgba[at] = clampByte(r);
      target.rgba[at + 1] = clampByte(g);
      target.rgba[at + 2] = clampByte(b);
      target.rgba[at + 3] = 255;
      continue;
    }
    const dr = target.rgba[at] ?? 0;
    const dg = target.rgba[at + 1] ?? 0;
    const db = target.rgba[at + 2] ?? 0;
    const da = target.rgba[at + 3] ?? 0;
    target.rgba[at] = Math.floor((dr * (255 - coverage) + r * coverage + 127) / 255);
    target.rgba[at + 1] = Math.floor((dg * (255 - coverage) + g * coverage + 127) / 255);
    target.rgba[at + 2] = Math.floor((db * (255 - coverage) + b * coverage + 127) / 255);
    target.rgba[at + 3] = Math.min(255, da + Math.floor((coverage * (255 - da) + 127) / 255));
  }
  return null;
}

function result(root: TargetEntry, error: string | null): RasterResult {
  return { width: root.width, height: root.height, rgba: root.rgba, error };
}

/** Replay the AD-3 draw list into a fresh straight-RGBA target (AD-4). */
function rasterizeWithBlendTarget(
  list: DrawList,
  assets: RasterAssets,
  surfaces: RasterSurfaces,
  blendTarget: BlendTarget,
): RasterResult {
  if (!Number.isInteger(list.width) || !Number.isInteger(list.height) || list.width <= 0 || list.height <= 0) {
    return { width: list.width, height: list.height, rgba: new Uint8Array(), error: "invalid draw-list dimensions" };
  }
  const root: TargetEntry = {
    width: list.width,
    height: list.height,
    rgba: new Uint8Array(list.width * list.height * 4),
    scratch: null,
  };
  const targets: TargetEntry[] = [root];
  const scratchTargets = new Map<ScratchId, TargetEntry>();
  for (const command of list.commands) {
    let error: string | null = null;
    switch (command.kind) {
      case "fill":
        for (let y = 0; y < targets[targets.length - 1]!.height; y += 1) {
          for (let x = 0; x < targets[targets.length - 1]!.width; x += 1) drawPixel(targets[targets.length - 1]!, x, y, command.rgb);
        }
        break;
      case "blit":
        error = drawBlit(targets[targets.length - 1]!, command, assets, surfaces, blendTarget);
        break;
      case "line":
        drawLine(targets[targets.length - 1]!, command.x1, command.y1, command.x2, command.y2, command.rgb);
        break;
      case "rect":
        if (!validRect(command.rect)) error = "invalid rectangle";
        else drawRect(targets[targets.length - 1]!, command.rect, command.rgb, command.filled);
        break;
      case "ellipse":
        if (!validRect(command.rect)) error = "invalid ellipse rectangle";
        else drawEllipse(targets[targets.length - 1]!, command);
        break;
      case "pushTarget": {
        const prior = scratchTargets.get(command.scratch);
        const scratch = prior ?? {
          width: list.width,
          height: list.height,
          rgba: new Uint8Array(list.width * list.height * 4),
          scratch: command.scratch,
        };
        scratch.rgba.fill(0);
        scratchTargets.set(command.scratch, scratch);
        targets.push(scratch);
        break;
      }
      case "popTarget":
        if (targets.length === 1) error = "popTarget without pushTarget";
        else targets.pop();
        break;
      case "text":
        error = drawText(targets[targets.length - 1]!, command, assets);
        break;
      default: {
        const exhaustive: never = command;
        error = `unsupported draw command: ${String(exhaustive)}`;
      }
    }
    if (error) return result(root, error);
  }
  if (targets.length !== 1) return result(root, "unclosed pushTarget");
  return result(root, null);
}

/** Replay strict AD-3 commands (both planes use the same blend arithmetic). */
export function rasterize(list: DrawList, assets: RasterAssets, surfaces: RasterSurfaces = new Map()): RasterResult {
  return rasterizeWithBlendTarget(list, assets, surfaces, "ad3");
}

/**
 * Replay authored screen operations while lowering them to a captured pixel texture for an AD-3 blit.
 * This is not a draw-list replay path: callers must replace its output with a normal AD-3 source blit.
 */
export function rasterizeAuthorMargin(list: DrawList, assets: RasterAssets, surfaces: RasterSurfaces): RasterResult {
  return rasterizeWithBlendTarget(list, assets, surfaces, "screen");
}

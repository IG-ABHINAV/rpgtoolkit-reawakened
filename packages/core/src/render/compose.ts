import type { DecodedTexture } from "../formats/image/model.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import { frameAt } from "../time/index.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { DrawCommand, DrawList, Rect, Rgb, Tint } from "../ports/draw.ts";
import { addTint, ambientTint, cellTint } from "./shade.ts";
import { coordLayout, ISO_TILE_HEIGHT, ISO_TILE_WIDTH, isIsometric, pixelToTile, tileToPixel, type CoordLayout } from "../world/coords.ts";
import type {
  WorldBoard,
  WorldImage,
  WorldImageCell,
  WorldLayer,
  WorldPoint,
  WorldTile,
  WorldVector,
} from "../world/model.ts";

const TILE_SIZE = 32;
const NO_TINT: Tint = { r: 0, g: 0, b: 0 };
const TILE_KEY: Rgb = { r: 0, g: 1, b: 2 };

export type BoardBlit = {
  readonly asset: AssetKey;
  readonly src: Rect;
  readonly dst: Rect;
  readonly key?: Rgb | null;
  readonly tint?: Tint;
  readonly alpha?: number;
  readonly blend?: "normal" | "additive" | "translucent";
  readonly iso2d?: boolean;
};

export type SpriteFrame = {
  /** GIF frames use a content-derived private key for their decoded page texture. */
  readonly asset?: AssetKey;
  readonly file?: string;
  readonly tile?: number | null;
  readonly src?: Rect;
  /** Where a tile frame's cell sits inside the frame canvas; absent when a picture fills the canvas (E-54). */
  readonly dst?: Rect;
  readonly width?: number;
  readonly height?: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly transparent?: Rgb | null;
  readonly tint?: Tint;
};

export type SpriteDraw = {
  readonly id: string;
  readonly key: string;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly drawId: number;
  readonly frame?: SpriteFrame;
  readonly phase?: number;
  readonly translucency?: number;
  readonly blend?: "normal" | "additive" | "translucent";
  readonly prev?: readonly [number, number] | { readonly x: number; readonly y: number };
  readonly under?: readonly number[];
  readonly collisionBase?: readonly WorldPoint[];

  readonly asset?: AssetKey;
  readonly file?: string;
  readonly tile?: number | null;
  readonly src?: Rect;
  readonly width?: number;
  readonly height?: number;
  readonly transparent?: Rgb | null;
  readonly tint?: Tint;
  readonly alpha?: number;
};

export type BoardView = {
  readonly board: WorldBoard;
  readonly tick: number;
  readonly camera: { readonly x: number; readonly y: number };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly alpha: number;
  readonly include: { readonly shading: boolean; readonly images: boolean; readonly sprites: boolean };
  /** Decoded textures are supplied by the core asset cache, never read here. */
  readonly assets?: ReadonlyMap<AssetKey, DecodedTexture>;
  /** Runtime layer edits replace the board's saved layer list for this frame. */
  readonly layers?: readonly WorldLayer[];
  /** Sprites to render in strict layer and screen-space Y order. */
  readonly sprites?: readonly SpriteDraw[];
  /** Additional image commands supplied by a presentation owner. */
  readonly blits?: readonly BoardBlit[];
  /** Script ambient is summed with board ambient once per tile blit (E-17). */
  readonly globalAmbient?: Tint;
};

function visible(rect: Rect, viewport: { readonly width: number; readonly height: number }): boolean {
  return rect.w > 0 && rect.h > 0 && rect.x + rect.w > 0 && rect.y + rect.h > 0 && rect.x < viewport.width && rect.y < viewport.height;
}

function edgesIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): boolean {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (d === 0) return false;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function pointInPolygon(px: number, py: number, points: readonly WorldPoint[]): boolean {
  let inside = false;
  const count = points.length;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const p1 = points[i]!;
    const p2 = points[j]!;
    if ((p1.y > py) !== (p2.y > py)) {
      const xIntersect = p1.x + ((py - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y);
      if (px < xIntersect) inside = !inside;
    }
  }
  return inside;
}

function polygonIntersectsRect(points: readonly WorldPoint[], rect: Rect): boolean {
  if (points.length < 3 || rect.w <= 0 || rect.h <= 0) return false;
  const rx1 = rect.x;
  const ry1 = rect.y;
  const rx2 = rect.x + rect.w;
  const ry2 = rect.y + rect.h;

  for (const p of points) {
    if (p.x >= rx1 && p.x <= rx2 && p.y >= ry1 && p.y <= ry2) return true;
  }

  if (
    pointInPolygon(rx1, ry1, points) ||
    pointInPolygon(rx2, ry1, points) ||
    pointInPolygon(rx1, ry2, points) ||
    pointInPolygon(rx2, ry2, points)
  ) {
    return true;
  }

  const count = points.length;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const p1 = points[i]!;
    const p2 = points[j]!;
    if (
      edgesIntersect(p1.x, p1.y, p2.x, p2.y, rx1, ry1, rx2, ry1) ||
      edgesIntersect(p1.x, p1.y, p2.x, p2.y, rx1, ry2, rx2, ry2) ||
      edgesIntersect(p1.x, p1.y, p2.x, p2.y, rx1, ry1, rx1, ry2) ||
      edgesIntersect(p1.x, p1.y, p2.x, p2.y, rx2, ry1, rx2, ry2)
    ) {
      return true;
    }
  }
  return false;
}

function polygonScanlineSpans(points: readonly WorldPoint[], y: number): Array<[number, number]> {
  if (points.length < 3) return [];
  const yVal = y + 0.5;
  const intercepts: number[] = [];
  const count = points.length;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const p1 = points[i]!;
    const p2 = points[j]!;
    if ((p1.y > yVal) !== (p2.y > yVal)) {
      const x = p1.x + ((yVal - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y);
      intercepts.push(Math.round(x));
    }
  }
  if (intercepts.length < 2) return [];
  intercepts.sort((a, b) => a - b);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < intercepts.length - 1; i += 2) {
    const x1 = intercepts[i]!;
    const x2 = intercepts[i + 1]!;
    if (x2 > x1) spans.push([x1, x2]);
  }
  return spans;
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (intervals.length <= 1) return intervals;
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [[intervals[0]![0], intervals[0]![1]]];
  for (let i = 1; i < intervals.length; i += 1) {
    const last = merged[merged.length - 1]!;
    const curr = intervals[i]!;
    if (curr[0] <= last[1]) {
      last[1] = Math.max(last[1], curr[1]);
    } else {
      merged.push([curr[0], curr[1]]);
    }
  }
  return merged;
}

function spritePosition(
  sprite: SpriteDraw,
  alpha: number,
): { readonly x: number; readonly y: number } {
  if (sprite.prev === undefined) return { x: sprite.x, y: sprite.y };
  const prev = sprite.prev;
  let prevX = sprite.x;
  let prevY = sprite.y;
  if ("x" in prev) {
    prevX = prev.x;
    prevY = prev.y;
  } else {
    prevX = prev[0] ?? sprite.x;
    prevY = prev[1] ?? sprite.y;
  }
  return {
    x: prevX + (sprite.x - prevX) * alpha,
    y: prevY + (sprite.y - prevY) * alpha,
  };
}

function sortSprites(
  sprites: readonly SpriteDraw[],
  alpha: number,
  cameraY: number,
): SpriteDraw[] {
  return [...sprites].sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    const aY = spritePosition(a, alpha).y - cameraY;
    const bY = spritePosition(b, alpha).y - cameraY;
    if (aY !== bY) return aY - bY;
    if (a.drawId !== b.drawId) return a.drawId - b.drawId;
    return a.id.localeCompare(b.id);
  });
}

function emitUnderVectorRedraw(
  commands: DrawCommand[],
  sprite: SpriteDraw,
  board: WorldBoard,
  view: BoardView,
  layers: readonly WorldLayer[],
  boardLeft: number,
  boardTop: number,
  spriteW: number,
  spriteH: number,
  worldX: number,
  worldY: number,
): void {
  const vectors = board.vectors;
  if (vectors === undefined || vectors.length === 0) return;

  const frameRect: Rect = { x: boardLeft, y: boardTop, w: spriteW, h: spriteH };
  const collisionRect: Rect = {
    x: Math.round(worldX) - 15,
    y: Math.round(worldY) - 15,
    w: 31,
    h: 16,
  };

  const activeVectors: WorldVector[] = [];
  for (const v of vectors) {
    if (v.type !== 2 || v.points.length < 3) continue;
    const coversLower = (v.attributes & 2) !== 0;
    if (coversLower ? sprite.layer > v.layer : sprite.layer !== v.layer) continue;
    const frameTrigger = (v.attributes & 4) !== 0;
    const testRect = frameTrigger ? frameRect : collisionRect;
    if (polygonIntersectsRect(v.points, testRect)) {
      activeVectors.push(v);
    }
  }

  if (activeVectors.length === 0) return;

  let maxLayer = 0;
  for (const v of activeVectors) {
    if (v.layer > maxLayer) maxLayer = v.layer;
  }

  for (let row = 0; row < spriteH; row += 1) {
    const y = boardTop + row;
    const dstY = y - view.camera.y;
    if (dstY < 0 || dstY >= view.viewport.height) continue;

    const bgIntervals: Array<[number, number]> = [];
    for (const v of activeVectors) {
      if ((v.attributes & 1) !== 0) {
        const spans = polygonScanlineSpans(v.points, y);
        for (const [x1, x2] of spans) {
          const cx1 = Math.max(x1, boardLeft);
          const cx2 = Math.min(x2, boardLeft + spriteW);
          if (cx2 > cx1) bgIntervals.push([cx1, cx2]);
        }
      }
    }
    const mergedBg = mergeIntervals(bgIntervals);
    for (const [spanX1, spanX2] of mergedBg) {
      const spanW = spanX2 - spanX1;
      const dstX = spanX1 - view.camera.x;
      if (visible({ x: dstX, y: dstY, w: spanW, h: 1 }, view.viewport)) {
        commands.push({
          kind: "rect",
          rect: { x: dstX, y: dstY, w: spanW, h: 1 },
          rgb: board.background,
          filled: true,
        });
      }
    }

    // Isometric diamonds overlap, so a one-row source slice cannot say which tile owns a
    // pixel and an `iso2d` blit cannot be sliced at all: promoted tile redraw is 2D-only
    // (plan 4.18, owner-visible item). Background spans above still apply.
    const promotedLayers = isIsometric(coordLayout(board.coordType)) ? 0 : maxLayer;
    for (let layerNum = 1; layerNum <= promotedLayers; layerNum += 1) {
      const layerIdx = layerNum - 1;
      const layer = layers[layerIdx];
      if (layer === undefined) continue;

      const layerIntervals: Array<[number, number]> = [];
      for (const v of activeVectors) {
        const coversLower = (v.attributes & 2) !== 0;
        const promotes = coversLower ? layerNum <= v.layer : layerNum === v.layer;
        if (promotes) {
          const spans = polygonScanlineSpans(v.points, y);
          for (const [x1, x2] of spans) {
            const cx1 = Math.max(x1, boardLeft);
            const cx2 = Math.min(x2, boardLeft + spriteW);
            if (cx2 > cx1) layerIntervals.push([cx1, cx2]);
          }
        }
      }

      const merged = mergeIntervals(layerIntervals);
      for (const [spanX1, spanX2] of merged) {
        const tileXStart = Math.floor(spanX1 / TILE_SIZE);
        const tileXEnd = Math.floor((spanX2 - 1) / TILE_SIZE);
        const tileY = Math.floor(y / TILE_SIZE);
        if (tileY < 0 || tileY >= board.sizeY) continue;

        for (let tx = tileXStart; tx <= tileXEnd; tx += 1) {
          if (tx < 0 || tx >= board.sizeX) continue;
          const tile = layer.tiles[tileY * board.sizeX + tx];
          if (tile === null || tile === undefined) continue;
          const selected = selectedTile(tile, view.tick);
          const tileLeft = tx * TILE_SIZE;
          const subX1 = Math.max(spanX1, tileLeft);
          const subX2 = Math.min(spanX2, tileLeft + TILE_SIZE);
          const subW = subX2 - subX1;
          if (subW <= 0) continue;
          const srcX = subX1 - tileLeft;
          const srcY = y - tileY * TILE_SIZE;
          const dstX = subX1 - view.camera.x;
          if (!visible({ x: dstX, y: dstY, w: subW, h: 1 }, view.viewport)) continue;
          commands.push({
            kind: "blit",
            source: { asset: selected.asset, tile: selected.tile },
            src: { x: srcX, y: srcY, w: subW, h: 1 },
            dst: { x: dstX, y: dstY, w: subW, h: 1 },
            key: TILE_KEY,
            tint: tileTint(board, layerNum, tx, tileY, view.include.shading, view.globalAmbient, selected.tint),
            alpha: 255,
            blend: "normal",
            iso2d: false,
          });
        }
      }
    }
  }
}

function emitSprite(
  commands: DrawCommand[],
  sprite: SpriteDraw,
  board: WorldBoard,
  view: BoardView,
  layers: readonly WorldLayer[],
): void {
  const pos = spritePosition(sprite, view.alpha);
  const worldX = pos.x;
  const worldY = pos.y;

  let width = sprite.frame?.width ?? sprite.width;
  let height = sprite.frame?.height ?? sprite.height;

  const file = sprite.frame?.file ?? sprite.file;
  const explicitAsset = sprite.frame?.asset ?? sprite.asset;
  const frameTile = sprite.frame?.tile ?? sprite.tile;
  // A frame that names a tile (an animation frame such as `char.tst1`) is that tile, not the whole asset: an
  // `.anm` frame's picture is a cell of a tileset or tile bitmap, and the texture path would blit the entire
  // strip (docs/spec/formats/animation.md, E-54).
  const tileFrame = frameTile !== undefined && frameTile !== null && explicitAsset !== undefined;
  const texture = !tileFrame && (file !== undefined || explicitAsset !== undefined)
    ? textureFor(view.assets, file ?? "", explicitAsset)
    : null;

  if (width === undefined && texture !== null) width = texture.texture.w;
  if (height === undefined && texture !== null) height = texture.texture.h;

  const spriteW = width ?? 16;
  const spriteH = height ?? 16;

  const anchorX = sprite.frame?.anchorX ?? Math.floor(spriteW / 2);
  const anchorY = sprite.frame?.anchorY ?? spriteH;

  const boardLeft = Math.round(worldX - anchorX);
  const boardTop = Math.round(worldY - anchorY);

  const dstX = boardLeft - view.camera.x;
  const dstY = boardTop - view.camera.y;
  const dstRect: Rect = { x: dstX, y: dstY, w: spriteW, h: spriteH };

  if (visible(dstRect, view.viewport)) {
    if (texture !== null) {
      const key = sprite.frame?.transparent ?? sprite.transparent ?? { r: 255, g: 255, b: 255 };
      const tint = view.include.shading ? ambientTint(board, view.globalAmbient) : NO_TINT;
      const alpha = sprite.translucency ?? sprite.alpha ?? 255;
      const blend = sprite.blend ?? "normal";
      const src = sprite.frame?.src ?? sprite.src ?? { x: 0, y: 0, w: texture.texture.w, h: texture.texture.h };
      // A frame may place its picture at its own size inside a larger canvas (a single-tile `.gph` frame), exactly
      // as the tile branch places a cell; without `dst` the picture fills the canvas.
      const pictureDst = sprite.frame?.dst === undefined
        ? dstRect
        : { x: dstX + sprite.frame.dst.x, y: dstY + sprite.frame.dst.y, w: sprite.frame.dst.w, h: sprite.frame.dst.h };
      commands.push({
        kind: "blit",
        source: { asset: texture.key, tile: null },
        src,
        dst: pictureDst,
        key,
        tint,
        alpha,
        blend,
        iso2d: false,
      });
    } else {
      const tileIndex = sprite.frame?.tile ?? sprite.tile;
      const tileAsset = sprite.frame?.asset ?? sprite.asset;
      if (tileIndex !== null && tileIndex !== undefined && tileAsset !== undefined) {
        const key = sprite.frame?.transparent ?? sprite.transparent ?? TILE_KEY;
        const tint = view.include.shading ? ambientTint(board, view.globalAmbient) : NO_TINT;
        const alpha = sprite.translucency ?? sprite.alpha ?? 255;
        const blend = sprite.blend ?? "normal";
        const src = sprite.frame?.src ?? sprite.src ?? { x: 0, y: 0, w: spriteW, h: spriteH };
        // A tile frame draws its cell at the cell's own size, placed at the frame canvas origin; the canvas
        // (width/height) only sets the anchor, so a 64x32 frame naming a 32x32 cell paints one cell, not two.
        const cellDst = sprite.frame?.dst === undefined
          ? dstRect
          : { x: dstX + sprite.frame.dst.x, y: dstY + sprite.frame.dst.y, w: sprite.frame.dst.w, h: sprite.frame.dst.h };
        commands.push({
          kind: "blit",
          source: { asset: tileAsset, tile: tileIndex },
          src,
          dst: cellDst,
          key,
          tint,
          alpha,
          blend,
          iso2d: false,
        });
      } else {
        const colour = sprite.key === "player"
          ? { r: 64, g: 96, b: 224 }
          : { r: 192, g: 128, b: 32 };
        commands.push({
          kind: "rect",
          rect: dstRect,
          rgb: colour,
          filled: true,
        });
      }
    }
  }

  emitUnderVectorRedraw(commands, sprite, board, view, layers, boardLeft, boardTop, spriteW, spriteH, worldX, worldY);
}

function textureFor(
  assets: ReadonlyMap<AssetKey, DecodedTexture> | undefined,
  file: string,
  explicit: AssetKey | undefined,
): { readonly key: AssetKey; readonly texture: DecodedTexture } | null {
  if (assets === undefined) return null;
  const candidates = explicit === undefined
    ? [assetKey(file), assetKey(`bitmap/${file}`), assetKey(`images/${file}`)]
    : [explicit, assetKey(file), assetKey(`bitmap/${file}`), assetKey(`images/${file}`)];
  for (const key of candidates) {
    const texture = assets.get(key);
    if (texture !== undefined) return { key, texture };
  }
  return null;
}

function selectedTile(tile: WorldTile, tick: number): WorldTile {
  const animation = tile.animation;
  if (animation === undefined || animation.frames.length === 0) return tile;
  const index = frameAt(0, tick, animation.ticksPerFrame, animation.frames.length, true);
  return animation.frames[index] ?? tile;
}

function tileTint(
  board: WorldBoard,
  layer: number,
  x: number,
  y: number,
  includeShading: boolean,
  globalAmbient: Tint | undefined,
  extra: Tint | undefined,
): Tint {
  const shade = includeShading ? cellTint(board, layer, x, y, globalAmbient) : NO_TINT;
  return extra === undefined ? shade : addTint(shade, extra);
}

function tileCommand(
  board: WorldBoard,
  tile: WorldTile,
  tick: number,
  layer: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  includeShading: boolean,
  globalAmbient: Tint | undefined,
  extraTint?: Tint,
  key: Rgb = TILE_KEY,
): DrawCommand {
  const selected = selectedTile(tile, tick);
  const width = selected.width ?? TILE_SIZE;
  const height = selected.height ?? TILE_SIZE;
  return {
    kind: "blit",
    source: { asset: selected.asset, tile: selected.tile },
    src: { x: 0, y: 0, w: width, h: height },
    dst: { x: dx, y: dy, w: width, h: height },
    key,
    tint: tileTint(board, layer, x, y, includeShading, globalAmbient, addTint(selected.tint ?? NO_TINT, extraTint ?? NO_TINT)),
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
}

function parallaxOffset(
  camera: number,
  imageSize: number,
  boardSize: number,
  viewportSize: number,
): number {
  const denominator = boardSize - viewportSize;
  if (denominator === 0) return 0;
  return camera * (imageSize - viewportSize) / denominator;
}
function imageCommand(
  image: WorldImage,
  board: WorldBoard,
  texture: DecodedTexture,
  resolvedAsset: AssetKey,
  camera: { readonly x: number; readonly y: number },
  viewport: { readonly width: number; readonly height: number },
): DrawCommand | null {
  const imageWidth = image.width ?? texture.w;
  const imageHeight = image.height ?? texture.h;
  let width = imageWidth;
  let height = imageHeight;
  let left = image.left - camera.x;
  let top = image.top - camera.y;
  if (image.drawType === 2) {
    width = board.width;
    height = board.height;
    left = -camera.x;
    top = -camera.y;
  } else if (image.drawType === 1) {
    left = image.left - parallaxOffset(camera.x, imageWidth, board.width, viewport.width);
    top = image.top - parallaxOffset(camera.y, imageHeight, board.height, viewport.height);
  }
  const dst = { x: left, y: top, w: width, h: height };
  if (!visible(dst, viewport)) return null;
  return {
    kind: "blit",
    source: { asset: resolvedAsset, tile: null },
    src: { x: 0, y: 0, w: texture.w, h: texture.h },
    dst,
    key: image.transparent,
    tint: NO_TINT,
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
}

function emitImage(
  commands: DrawCommand[],
  image: WorldImage,
  board: WorldBoard,
  view: BoardView,
  layer: number,
): void {
  if (image.layer !== layer) return;
  if (image.cells !== undefined) {
    for (const cell of image.cells) {
      if (cell.tile === null) continue;
      const tile = selectedTile(cell.tile, view.tick);
      const dx = image.left + cell.x * TILE_SIZE - view.camera.x;
      const dy = image.top + cell.y * TILE_SIZE - view.camera.y;
      const width = tile.width ?? TILE_SIZE;
      const height = tile.height ?? TILE_SIZE;
      if (!visible({ x: dx, y: dy, w: width, h: height }, view.viewport)) continue;
      commands.push(tileCommand(board, tile, view.tick, layer, cell.x, cell.y, dx, dy, view.include.shading, view.globalAmbient, cell.tint));
    }
    return;
  }
  const texture = textureFor(view.assets, image.file, image.asset);
  if (texture === null) return;
  const command = imageCommand(image, board, texture.texture, texture.key, view.camera, view.viewport);
  if (command !== null) commands.push(command);
}

/**
 * One layer of an isometric board (docs/spec/formats/board.md#drawing-order-and-effects,
 * docs/spec/formats/tiles.md#isometric-tiles). Tiles are walked in painter order, which is
 * the projected key `(centre y, centre x)`: row by row for the stacked layout, and
 * diagonal by diagonal (`x + y` constant, `x` rising) for the rotated one, so no sort is
 * needed. An `.iso` tile is blitted 1:1 into its 64×32 diamond; an ordinary tile is
 * blitted with `iso2d` so the rasteriser squashes it into the same diamond.
 */
function emitIsometricLayer(
  commands: DrawCommand[],
  board: WorldBoard,
  layer: WorldLayer,
  layerNumber: number,
  layout: CoordLayout,
  view: BoardView,
): void {
  const gridWidth = board.gridWidth ?? (layout === "iso-rotated" ? board.sizeX + board.sizeY : board.sizeX);
  const gridHeight = board.gridHeight ?? (layout === "iso-rotated" ? gridWidth : board.sizeY);
  const emit = (x: number, y: number): void => {
    const tile = layer.tiles[y * gridWidth + x];
    if (tile === null || tile === undefined) return;
    const selected = selectedTile(tile, view.tick);
    const width = selected.width ?? TILE_SIZE;
    const height = selected.height ?? TILE_SIZE;
    const centre = tileToPixel(layout, board.sizeX, x + 1, y + 1);
    const dst: Rect = {
      x: centre.x - ISO_TILE_WIDTH / 2 - view.camera.x,
      y: centre.y - ISO_TILE_HEIGHT / 2 - view.camera.y,
      w: ISO_TILE_WIDTH,
      h: ISO_TILE_HEIGHT,
    };
    if (!visible(dst, view.viewport)) return;
    commands.push({
      kind: "blit",
      source: { asset: selected.asset, tile: selected.tile },
      src: { x: 0, y: 0, w: width, h: height },
      dst,
      key: TILE_KEY,
      tint: tileTint(board, layerNumber, x, y, view.include.shading, view.globalAmbient, selected.tint),
      alpha: 255,
      blend: "normal",
      iso2d: width !== ISO_TILE_WIDTH || height !== ISO_TILE_HEIGHT,
    });
  };
  if (layout === "iso-stacked") {
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) emit(x, y);
    }
    return;
  }
  for (let sum = 0; sum <= gridWidth + gridHeight - 2; sum += 1) {
    for (let x = Math.max(0, sum - gridHeight + 1); x <= Math.min(sum, gridWidth - 1); x += 1) emit(x, sum - x);
  }
}

function composeBoardView(view: BoardView): DrawList {
  const { board, viewport, camera } = view;
  const commands: DrawCommand[] = [{ kind: "fill", rgb: board.background }];
  if (view.include.images && board.backgroundImage !== undefined && board.backgroundImage !== "") {
    const texture = textureFor(view.assets, board.backgroundImage, undefined);
    if (texture !== null) {
      const image: WorldImage = {
        file: board.backgroundImage,
        left: 0,
        top: 0,
        layer: 0,
        drawType: board.backgroundDrawType ?? 0,
        transparent: TILE_KEY,
        reserved: 0,
        asset: texture.key,
      };
      const command = imageCommand(image, board, texture.texture, texture.key, camera, viewport);
      if (command !== null) commands.push(command);
    }
  }
  const sortedSprites = (view.include.sprites && view.sprites !== undefined && view.sprites.length > 0)
    ? sortSprites(view.sprites, view.alpha, camera.y)
    : [];
  const layers = view.layers ?? board.layers;
  const layout = coordLayout(board.coordType);
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (layer === undefined) continue;
    const layerNumber = layerIndex + 1;
    if (layout === "2d") {
      for (let y = 0; y < board.sizeY; y += 1) {
        for (let x = 0; x < board.sizeX; x += 1) {
          const tile = layer.tiles[y * board.sizeX + x];
          if (tile === null || tile === undefined) continue;
          const selected = selectedTile(tile, view.tick);
          const width = selected.width ?? TILE_SIZE;
          const height = selected.height ?? TILE_SIZE;
          const dx = x * TILE_SIZE - camera.x;
          const dy = y * TILE_SIZE - camera.y;
          if (!visible({ x: dx, y: dy, w: width, h: height }, viewport)) continue;
          commands.push(tileCommand(board, tile, view.tick, layerNumber, x, y, dx, dy, view.include.shading, view.globalAmbient));
        }
      }
    } else {
      emitIsometricLayer(commands, board, layer, layerNumber, layout, view);
    }
    if (view.include.images) {
      for (const image of board.images ?? []) emitImage(commands, image, board, view, layerNumber);
    }
    if (view.include.sprites && sortedSprites.length > 0) {
      const layerSprites = layerNumber === 1
        ? sortedSprites.filter((s) => s.layer <= 1)
        : sortedSprites.filter((s) => s.layer === layerNumber);
      for (const sprite of layerSprites) {
        emitSprite(commands, sprite, board, view, layers);
      }
    }
  }
  if (view.include.sprites && sortedSprites.length > 0) {
    const higherSprites = sortedSprites.filter((s) => s.layer > layers.length);
    for (const sprite of higherSprites) {
      emitSprite(commands, sprite, board, view, layers);
    }
  }
  for (const blit of view.blits ?? []) {
    const dst = { ...blit.dst, x: blit.dst.x - camera.x, y: blit.dst.y - camera.y };
    if (!visible(dst, viewport)) continue;
    commands.push({
      kind: "blit",
      source: { asset: blit.asset, tile: null },
      src: blit.src,
      dst,
      key: blit.key ?? null,
      tint: blit.tint ?? NO_TINT,
      alpha: blit.alpha ?? 255,
      blend: blit.blend ?? "normal",
      iso2d: blit.iso2d ?? false,
    });
  }
  return { tick: view.tick, width: viewport.width, height: viewport.height, commands, marginCommands: [] };
}

export type BoardComposeView = Omit<BoardView, "board" | "assets"> & {
  readonly assets?: ReadonlyMap<AssetKey, DecodedTexture>;
};

export function composeBoard(view: BoardView): DrawList;
export function composeBoard(
  board: WorldBoard,
  assets: ReadonlyMap<AssetKey, DecodedTexture>,
  view: BoardComposeView,
): DrawList;
export function composeBoard(
  first: BoardView | WorldBoard,
  second?: ReadonlyMap<AssetKey, DecodedTexture>,
  third?: BoardComposeView,
): DrawList {
  if (third !== undefined) {
    const base = { ...third, board: first as WorldBoard };
    return second === undefined ? composeBoardView(base) : composeBoardView({ ...base, assets: second });
  }
  return composeBoardView(first as BoardView);
}

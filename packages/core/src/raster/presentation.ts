import type { DecodedTexture } from "../formats/image/model.ts";
import type { HostDisplayGeometry } from "../ports/host.ts";
import type { DrawCommand, DrawListV2 } from "../ports/draw.ts";
import type { SurfaceId } from "../ports/keys.ts";
import { rasterize } from "./raster.ts";
import type { RasterAssets, RasterResult, RasterSurfaces } from "./raster.ts";

type Offset = { readonly x: number; readonly y: number };
type MarginBounds = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly emptySafeArea: boolean;
};

function marginBounds(list: DrawListV2, geometry: HostDisplayGeometry): MarginBounds {
  const { content, game, safeArea } = geometry;
  const safeLeft = safeArea.left;
  const safeRight = content.width - safeArea.right;
  const safeTop = safeArea.top;
  const safeBottom = content.height - safeArea.bottom;
  const emptySafeArea = safeRight <= safeLeft || safeBottom <= safeTop;
  const scaleX = game.width / list.width;
  const scaleY = game.height / list.height;
  const left = emptySafeArea ? 0 : Math.floor(Math.max(0, game.x - safeLeft) / scaleX);
  const right = emptySafeArea ? 0 : Math.floor(Math.max(0, safeRight - game.x - game.width) / scaleX);
  const top = emptySafeArea ? 0 : Math.floor(Math.max(0, game.y - safeTop) / scaleY);
  const bottom = emptySafeArea ? 0 : Math.floor(Math.max(0, safeBottom - game.y - game.height) / scaleY);
  return {
    left,
    right,
    top,
    bottom,
    width: list.width + left + right,
    height: list.height + top + bottom,
    emptySafeArea,
  };
}

function offsetCommand(command: DrawCommand, offset: Offset): DrawCommand {
  switch (command.kind) {
    case "blit":
      return { ...command, dst: { ...command.dst, x: command.dst.x + offset.x, y: command.dst.y + offset.y } };
    case "line":
      return {
        ...command,
        x1: command.x1 + offset.x,
        y1: command.y1 + offset.y,
        x2: command.x2 + offset.x,
        y2: command.y2 + offset.y,
      };
    case "rect":
    case "ellipse":
      return { ...command, rect: { ...command.rect, x: command.rect.x + offset.x, y: command.rect.y + offset.y } };
    case "text":
      return { ...command, x: command.x + offset.x, y: command.y + offset.y };
    case "fill":
    case "pushTarget":
    case "popTarget":
      return command;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

function eligibleCell(
  x: number,
  y: number,
  list: DrawListV2,
  geometry: HostDisplayGeometry,
  bounds: MarginBounds,
): boolean {
  if (bounds.emptySafeArea || (x >= 0 && x < list.width && y >= 0 && y < list.height)) return false;
  const { content, game, safeArea } = geometry;
  const scaleX = game.width / list.width;
  const scaleY = game.height / list.height;
  const cellLeft = game.x + x * scaleX;
  const cellRight = game.x + (x + 1) * scaleX;
  const cellTop = game.y + y * scaleY;
  const cellBottom = game.y + (y + 1) * scaleY;
  return x >= -bounds.left && x < list.width + bounds.right &&
    y >= -bounds.top && y < list.height + bounds.bottom &&
    cellLeft >= 0 && cellTop >= 0 && cellRight <= content.width && cellBottom <= content.height &&
    cellLeft >= safeArea.left && cellTop >= safeArea.top &&
    cellRight <= content.width - safeArea.right && cellBottom <= content.height - safeArea.bottom;
}
function failedPresentation(error: string, geometry: HostDisplayGeometry): RasterResult {
  const width = Math.ceil(geometry.content.width);
  const height = Math.ceil(geometry.content.height);
  return { width, height, rgba: new Uint8Array(width * height * 4), error };
}


/**
 * Replay both strict-v2 draw layers and present them into the host content rectangle.
 * The conservative whole-cell margin test and per-axis pixel-centre sampling are the
 * Plane 3 contract in docs/spec/engine/display-input-audio.md#reawakened-author-touch-hud.
 */
export function rasterizePresentation(
  list: DrawListV2,
  geometry: HostDisplayGeometry,
  assets: RasterAssets,
  surfaces: RasterSurfaces = new Map<SurfaceId, DecodedTexture>(),
): RasterResult {
  const plane1 = rasterize({
    tick: list.tick,
    width: list.width,
    height: list.height,
    commands: list.commands,
    marginCommands: [],
  }, assets, surfaces);
  if (plane1.error !== null) return failedPresentation(plane1.error, geometry);

  const bounds = marginBounds(list, geometry);
  const marginOffset = { x: bounds.left, y: bounds.top };
  const margin = rasterize({
    tick: list.tick,
    width: bounds.width,
    height: bounds.height,
    commands: list.marginCommands.map((command) => offsetCommand(command, marginOffset)),
    marginCommands: [],
  }, assets, surfaces);
  if (margin.error !== null) return failedPresentation(margin.error, geometry);

  const outWidth = Math.ceil(geometry.content.width);
  const outHeight = Math.ceil(geometry.content.height);
  const rgba = new Uint8Array(outWidth * outHeight * 4);
  const { content, game } = geometry;
  const scaleX = game.width / list.width;
  const scaleY = game.height / list.height;
  for (let y = 0; y < outHeight; y += 1) {
    const centerY = y + 0.5;
    if (centerY < 0 || centerY >= content.height) continue;
    for (let x = 0; x < outWidth; x += 1) {
      const centerX = x + 0.5;
      if (centerX < 0 || centerX >= content.width) continue;
      const logicalX = Math.floor((centerX - game.x) / scaleX);
      const logicalY = Math.floor((centerY - game.y) / scaleY);
      const insideGame = centerX >= game.x && centerX < game.x + game.width &&
        centerY >= game.y && centerY < game.y + game.height;
      let source: RasterResult | null = null;
      let sourceX = logicalX;
      let sourceY = logicalY;
      if (insideGame) {
        source = plane1;
      } else {
        if (centerX < geometry.safeArea.left || centerX >= content.width - geometry.safeArea.right ||
          centerY < geometry.safeArea.top || centerY >= content.height - geometry.safeArea.bottom ||
          !eligibleCell(logicalX, logicalY, list, geometry, bounds)) continue;
        source = margin;
        sourceX += bounds.left;
        sourceY += bounds.top;
      }
      if (sourceX < 0 || sourceY < 0 || sourceX >= source.width || sourceY >= source.height) continue;
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * outWidth + x) * 4;
      rgba[to] = source.rgba[from] ?? 0;
      rgba[to + 1] = source.rgba[from + 1] ?? 0;
      rgba[to + 2] = source.rgba[from + 2] ?? 0;
      rgba[to + 3] = source.rgba[from + 3] ?? 0;
    }
  }
  return { width: outWidth, height: outHeight, rgba, error: null };
}

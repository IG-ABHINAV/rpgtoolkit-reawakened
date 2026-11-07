import type { Tint } from "../ports/draw.ts";
import type { WorldBoard, WorldLight, WorldPoint, WorldRgb, WorldShadeLayer, WorldShadeRecord } from "../world/model.ts";

/** The maximum signed tint carried by one draw command (AD-3). */
export const MAX_TINT = 1020;
const LIGHT_CHANNEL_MIN = -255;
const LIGHT_CHANNEL_MAX = 255;
const FIXED = 1_000_000;

const zero = (): Tint => ({ r: 0, g: 0, b: 0 });

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function addRgb(a: WorldRgb | Tint, b: WorldRgb | Tint): Tint {
  return {
    r: clamp(a.r + b.r, -MAX_TINT, MAX_TINT),
    g: clamp(a.g + b.g, -MAX_TINT, MAX_TINT),
    b: clamp(a.b + b.b, -MAX_TINT, MAX_TINT),
  };
}

/** Add board and script ambient once, before a tile blit is emitted. */
export function ambientTint(board: Pick<WorldBoard, "ambient"> & { readonly activeAmbient?: WorldRgb }, globalAmbient: Tint = zero()): Tint {
  return addRgb(board.activeAmbient ?? board.ambient, globalAmbient);
}

function recordTint(records: readonly WorldShadeRecord[], cell: number): Tint {
  let cursor = 0;
  for (const record of records) {
    const count = record.runCount > 1 ? record.runCount : 1;
    if (cell < cursor + count) return { r: record.r, g: record.g, b: record.b };
    cursor += count;
  }
  return zero();
}

/**
 * Return the pre-summed tint for one 1-based board layer and stored-grid cell.
 * Shade records are data: no legacy/pre-vector conversion is repeated here.
 */
export function cellTint(
  board: Pick<WorldBoard, "ambient" | "gridWidth" | "sizeX" | "shadeLayers"> & { readonly activeAmbient?: WorldRgb },
  layer: number,
  x: number,
  y: number,
  globalAmbient: Tint = zero(),
): Tint {
  const ambient = board.activeAmbient ?? board.ambient;
  let red = ambient.r + globalAmbient.r;
  let green = ambient.g + globalAmbient.g;
  let blue = ambient.b + globalAmbient.b;
  const width = board.gridWidth ?? board.sizeX;
  if (x < 0 || y < 0 || x >= width) return { r: clamp(red, -MAX_TINT, MAX_TINT), g: clamp(green, -MAX_TINT, MAX_TINT), b: clamp(blue, -MAX_TINT, MAX_TINT) };
  const cell = y * width + x;
  for (const shade of board.shadeLayers ?? []) {
    if (shade.castLayer === 0 || shade.castLayer >= layer) {
      const contribution = recordTint(shade.records, cell);
      red += contribution.r;
      green += contribution.g;
      blue += contribution.b;
    }
  }
  return { r: clamp(red, -MAX_TINT, MAX_TINT), g: clamp(green, -MAX_TINT, MAX_TINT), b: clamp(blue, -MAX_TINT, MAX_TINT) };
}

function interpolate(start: number, end: number, weight: number): number {
  return start + Math.trunc(((end - start) * weight) / FIXED);
}

function colourAt(colours: readonly WorldRgb[], weight: number): Tint {
  const edge = colours[0] ?? { r: 0, g: 0, b: 0 };
  const centre = colours[1] ?? edge;
  return {
    r: clamp(interpolate(edge.r, centre.r, weight), LIGHT_CHANNEL_MIN, LIGHT_CHANNEL_MAX),
    g: clamp(interpolate(edge.g, centre.g, weight), LIGHT_CHANNEL_MIN, LIGHT_CHANNEL_MAX),
    b: clamp(interpolate(edge.b, centre.b, weight), LIGHT_CHANNEL_MIN, LIGHT_CHANNEL_MAX),
  };
}

function dotProjection(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return 0;
  const numerator = (point.x - start.x) * dx + (point.y - start.y) * dy;
  return clamp(Math.trunc((numerator * FIXED) / lengthSquared), 0, FIXED);
}

function ellipseWeight(light: WorldLight, point: WorldPoint): number | null {
  const centre = light.nodes[0];
  const xRadiusPoint = light.nodes[1];
  const yRadiusPoint = light.nodes[2];
  if (centre === undefined || xRadiusPoint === undefined || yRadiusPoint === undefined) return null;
  const xRadius = Math.abs(xRadiusPoint.x - centre.x) || Math.abs(xRadiusPoint.y - centre.y);
  const yRadius = Math.abs(yRadiusPoint.y - centre.y) || Math.abs(yRadiusPoint.x - centre.x);
  const dx = Math.abs(point.x - centre.x);
  const dy = Math.abs(point.y - centre.y);
  if (xRadius === 0 && yRadius === 0) return dx === 0 && dy === 0 ? FIXED : null;
  if (xRadius === 0 && dx !== 0) return null;
  if (yRadius === 0 && dy !== 0) return null;
  // Round-7 boundary rule: normalized elliptical radius must be strictly below 1 (integer test, no float edge).
  if (xRadius !== 0 && yRadius !== 0 && dx * dx * yRadius * yRadius + dy * dy * xRadius * xRadius >= xRadius * xRadius * yRadius * yRadius) return null;
  if (xRadius === 0 && dy >= yRadius) return null;
  if (yRadius === 0 && dx >= xRadius) return null;
  const rx = xRadius === 0 ? 0 : dx * FIXED / xRadius;
  const ry = yRadius === 0 ? 0 : dy * FIXED / yRadius;
  const radiusSquared = rx * rx + ry * ry;
  const distance = Math.trunc(Math.sqrt(radiusSquared));
  return FIXED - distance;
}

function pointOnSegment(point: WorldPoint, a: WorldPoint, b: WorldPoint): boolean {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  if (cross !== 0) return false;
  return point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
}

function insidePolygon(point: WorldPoint, polygon: readonly WorldPoint[]): boolean {
  if (polygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (pointOnSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y)) {
      const left = (point.x - a.x) * (b.y - a.y);
      const right = (b.x - a.x) * (point.y - a.y);
      if ((b.y > a.y && left < right) || (b.y < a.y && left > right)) inside = !inside;
    }
  }
  return inside;
}

function lightTint(light: WorldLight, point: WorldPoint): Tint | null {
  if (light.type === 0) {
    const weight = ellipseWeight(light, point);
    return weight === null ? null : colourAt(light.colours, weight);
  }
  const start = light.nodes[0];
  const end = light.nodes[1];
  if (start === undefined || end === undefined) return null;
  if (light.type === 2 && !insidePolygon(point, light.nodes.slice(2))) return null;
  return colourAt(light.colours, dotProjection(point, start, end));
}

function compress(cells: readonly Tint[]): WorldShadeRecord[] {
  const records: WorldShadeRecord[] = [];
  for (const cell of cells) {
    const previous = records[records.length - 1];
    if (previous !== undefined && previous.r === cell.r && previous.g === cell.g && previous.b === cell.b) {
      records[records.length - 1] = { ...previous, runCount: previous.runCount + 1 };
    } else {
      records.push({ runCount: 1, r: cell.r, g: cell.g, b: cell.b });
    }
  }
  return records;
}


/**
 * Rasterise lights at stored-grid cell centres. Type 0 is an elliptical
 * spotlight, type 1 a clamped two-node gradient and type 2 that gradient
 * clipped to the remaining light nodes.
 */
export function rasterizeLights(
  lights: readonly WorldLight[],
  width: number,
  height: number,
  cellWidth = 32,
  cellHeight = 32,
): WorldShadeLayer {
  const cells: Tint[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = { x: x * cellWidth + Math.trunc(cellWidth / 2), y: y * cellHeight + Math.trunc(cellHeight / 2) };
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const light of lights) {
        const contribution = lightTint(light, point);
        if (contribution !== null) {
          red += contribution.r;
          green += contribution.g;
          blue += contribution.b;
        }
      }
      cells.push({ r: clamp(red, -MAX_TINT, MAX_TINT), g: clamp(green, -MAX_TINT, MAX_TINT), b: clamp(blue, -MAX_TINT, MAX_TINT) });
    }
  }
  return { castLayer: 0, records: compress(cells) };
}

/** Bake source lights into shading data; runtime state retains no light objects. */
export function bakeLights(board: WorldBoard): WorldBoard {
  const lights = board.lights ?? [];
  if (lights.length === 0) return { ...board, lights: [] };
  const width = board.gridWidth ?? board.sizeX;
  const height = board.gridHeight ?? board.sizeY;
  const baked = rasterizeLights(lights, width, height);
  const hasLight = baked.records.some((record) => record.r !== 0 || record.g !== 0 || record.b !== 0);
  return {
    ...board,
    shadeLayers: hasLight ? [...(board.shadeLayers ?? []), baked] : [...(board.shadeLayers ?? [])],
    lights: [],
  };
}

/** Add two already-computed tints without letting a draw command exceed AD-3. */
export function addTint(a: Tint, b: Tint): Tint {
  return addRgb(a, b);
}

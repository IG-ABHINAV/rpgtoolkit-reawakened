/** Runtime application of board effects (E-14; docs/spec/engine/rpgcode-functions.md#e-14). */
import type { EffectRecord } from "../script/effects.ts";
import type { GameState } from "../save/state.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { WorldBoard, WorldPoint, WorldProgram, WorldTile, WorldTileEdit, WorldVector } from "./model.ts";
import { invalidatePathfindingCache } from "../sprites/pathfinding.ts";
import { resolvePixelMovement } from "./movement-settings.ts";

function numberArg(effect: EffectRecord, index: number, fallback = 0): number {
  const value = effect.args[index];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function stringArg(effect: EffectRecord, index: number, fallback = ""): string {
  const value = effect.args[index];
  return typeof value === "string" ? value : fallback;
}
function boolArg(effect: EffectRecord, index: number): number {
  return numberArg(effect, index) === 0 ? 0 : 1;
}
function clonePoint(point: WorldPoint): WorldPoint {
  return { x: point.x, y: point.y };
}
function cloneVector(vector: WorldVector): WorldVector {
  return { ...vector, points: vector.points.map(clonePoint) };
}
function cloneProgram(program: WorldProgram): WorldProgram {
  return { ...program, points: program.points.map(clonePoint) };
}
function tile(asset: string): WorldTile {
  return { asset: asset as AssetKey, tile: 0, nativeWidth: 32, nativeHeight: 32, width: 32, height: 32 };
}
function boardOrNull(state: GameState): WorldBoard | null {
  return state.world.board ?? null;
}
function replaceLayerTile(board: WorldBoard, index: number, layerIndex: number, next: WorldTile | null, scope: "program" | "board", owner?: number): WorldBoard {
  let previous: WorldTile | null = null;
  const layers = board.layers.map((layer, indexOfLayer) => {
    if (indexOfLayer !== layerIndex) return layer;
    const tiles = [...layer.tiles];
    previous = tiles[index] ?? null;
    tiles[index] = next;
    return { ...layer, tiles };
  });
  const edit: WorldTileEdit = { index: layerIndex * board.sizeX * board.sizeY + index, tile: next, previous, scope, ...(owner === undefined ? {} : { owner }) };
  const runtime = board.runtime ?? { tileEdits: [], tileTypes: [] };
  return { ...board, layers, runtime: { ...runtime, tileEdits: [...runtime.tileEdits, edit] } };
}
function tileIndex(board: WorldBoard, x: number, y: number, layer: number): { index: number; layerIndex: number } | null {
  const layerIndex = layer - 1;
  const tileX = x - 1;
  const tileY = y - 1;
  if (tileX < 0 || tileY < 0 || tileX >= board.sizeX || tileY >= board.sizeY || layerIndex < 0 || layerIndex >= board.layers.length) return null;
  return { index: tileY * board.sizeX + tileX, layerIndex };
}
function pointsFromCount(points: readonly WorldPoint[], count: number): WorldPoint[] {
  if (count <= 0) return [];
  const out = points.slice(0, count).map(clonePoint);
  while (out.length < count) out.push({ x: 0, y: 0 });
  return out;
}
function setVector(board: WorldBoard, effect: EffectRecord): WorldBoard {
  const index = numberArg(effect, 0);
  if (index < 0 || index > (board.vectors?.length ?? 0)) return board;
  const vectors = (board.vectors ?? []).map(cloneVector);
  const current = vectors[index] ?? { points: [], attributes: 0, closed: 0, layer: 1, type: 0, handle: `vector${index}` };
  vectors[index] = {
    ...current,
    type: numberArg(effect, 1),
    points: pointsFromCount(current.points, numberArg(effect, 2)),
    layer: numberArg(effect, 3, 1),
    closed: boolArg(effect, 4),
    attributes: numberArg(effect, 5),
  };
  return { ...board, vectors };
}
function setVectorPoint(board: WorldBoard, effect: EffectRecord): WorldBoard {
  const vectors = (board.vectors ?? []).map(cloneVector);
  const vector = vectors[numberArg(effect, 0)];
  const pointIndex = numberArg(effect, 1);
  if (vector === undefined || pointIndex < 0) return board;
  const points = [...vector.points];
  while (points.length <= pointIndex) points.push({ x: 0, y: 0 });
  points[pointIndex] = { x: numberArg(effect, 2), y: numberArg(effect, 3) };
  vectors[numberArg(effect, 0)] = { ...vector, points };
  return { ...board, vectors };
}
function setProgram(board: WorldBoard, effect: EffectRecord): WorldBoard {
  const index = numberArg(effect, 0);
  if (index < 0 || index > (board.programs?.length ?? 0)) return board;
  const programs = (board.programs ?? []).map(cloneProgram);
  const current = programs[index] ?? {
    program: "", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
    activate: 0, activationType: 0, repeatDistance: 0, layer: 1, points: [], closed: 0, handle: `program${index}`,
  };
  programs[index] = {
    ...current,
    program: stringArg(effect, 1),
    points: pointsFromCount(current.points, numberArg(effect, 2)),
    layer: numberArg(effect, 3, 1),
    closed: boolArg(effect, 4),
    activationType: numberArg(effect, 5),
    repeatDistance: numberArg(effect, 6),
  };
  return { ...board, programs };
}
function setProgramPoint(board: WorldBoard, effect: EffectRecord): WorldBoard {
  const programs = (board.programs ?? []).map(cloneProgram);
  const program = programs[numberArg(effect, 0)];
  const pointIndex = numberArg(effect, 1);
  if (program === undefined || pointIndex < 0) return board;
  const points = [...program.points];
  while (points.length <= pointIndex) points.push({ x: 0, y: 0 });
  points[pointIndex] = { x: numberArg(effect, 2), y: numberArg(effect, 3) };
  programs[numberArg(effect, 0)] = { ...program, points };
  return { ...board, programs };
}

/** Apply one world effect immediately, preserving post order for same-turn reads. */
export function applyWorldEffect(state: GameState, effect: EffectRecord): void {
  if (effect.name === "pixelmovement") {
    const movement = resolvePixelMovement(state.world.movement, effect.args);
    if (movement !== null) state.world = { ...state.world, movement };
    return;
  }
  const board = boardOrNull(state);
  if (board === null) return;
  let next = board;
  if (effect.name === "put" || effect.name === "layerput") {
    const x = numberArg(effect, 0);
    const y = numberArg(effect, 1);
    const layer = effect.name === "put" && effect.args.length === 3 ? 1 : numberArg(effect, 2, 1);
    const tileArg = effect.name === "put" && effect.args.length === 3 ? 2 : 3;
    const location = tileIndex(board, x, y, layer);
    if (location !== null) next = replaceLayerTile(board, location.index, location.layerIndex, tile(stringArg(effect, tileArg)), effect.name === "put" ? "program" : "board", effect.name === "put" ? effect.thread : undefined);
  } else if (effect.name === "setambientlevel") {
    const { activeAmbient: _active, ...rest } = board;
    next = { ...rest, ambient: { r: numberArg(effect, 0), g: numberArg(effect, 1), b: numberArg(effect, 2) } };
  } else if (effect.name === "forceredraw") {
    const { activeAmbient: _active, ...rest } = board;
    next = rest;
  } else if (effect.name === "boardsetvector") {
    next = setVector(board, effect);
  } else if (effect.name === "boardsetvectorpoint") {
    next = setVectorPoint(board, effect);
  } else if (effect.name === "boardsetprogram") {
    next = setProgram(board, effect);
  } else if (effect.name === "boardsetprogrampoint") {
    next = setProgramPoint(board, effect);
  } else if (effect.name === "prg") {
    const programs = (board.programs ?? []).map(cloneProgram);
    const program = programs[numberArg(effect, 0)];
    if (program !== undefined) {
      const points = program.points.length === 0 ? [{ x: 0, y: 0 }] : program.points.map(clonePoint);
      points[0] = { x: numberArg(effect, 1), y: numberArg(effect, 2) };
      programs[numberArg(effect, 0)] = { ...program, points, layer: numberArg(effect, 3, program.layer) };
      next = { ...board, programs };
    }
  } else if (effect.name === "tiletype") {
    const x = numberArg(effect, 0);
    const y = numberArg(effect, 1);
    const layer = numberArg(effect, 3, 1) - 1;
    if (x >= 1 && y >= 1 && x <= board.sizeX && y <= board.sizeY && layer >= 0 && layer < board.layers.length) {
      const tileTypes = [...(board.runtime?.tileTypes ?? [])];
      const flat = layer * board.sizeX * board.sizeY + (y - 1) * board.sizeX + (x - 1);
      tileTypes[flat] = stringArg(effect, 2, "NORMAL");
      next = { ...board, runtime: { ...(board.runtime ?? { tileEdits: [], tileTypes: [] }), tileTypes } };
    }
  }
  if (next !== board) {
    if (effect.name === "boardsetvector" || effect.name === "boardsetvectorpoint") invalidatePathfindingCache(String(board.key));
    state.world = { ...state.world, board: next };
  }
}

/** Expire `put` edits whose program thread has finished or been removed. */
export function expireProgramTileEdits(state: GameState): void {
  const board = boardOrNull(state);
  if (board === null || board.runtime === undefined || board.runtime.tileEdits.length === 0) return;
  const edits = board.runtime.tileEdits;
  let hasProgramEdits = false;
  for (const edit of edits) {
    if (edit.scope === "program") {
      hasProgramEdits = true;
      break;
    }
  }
  if (!hasProgramEdits) return;
  const activeOwners = new Set<number>();
  for (const thread of state.vm.threads) {
    if (thread.status !== "finished") activeOwners.add(thread.id);
  }
  let hasExpired = false;
  for (const edit of edits) {
    if (edit.scope === "program" && (edit.owner === undefined || !activeOwners.has(edit.owner))) {
      hasExpired = true;
      break;
    }
  }
  if (!hasExpired) return;

  const baseline = new Map<number, WorldTile | null>();
  const visible = new Map<number, WorldTile | null>();
  const retained: WorldTileEdit[] = [];
  for (const edit of edits) {
    if (!baseline.has(edit.index)) baseline.set(edit.index, edit.previous);
    if (edit.scope === "program" && (edit.owner === undefined || !activeOwners.has(edit.owner))) continue;

    const previous = visible.has(edit.index) ? visible.get(edit.index)! : baseline.get(edit.index)!;
    retained.push(previous === edit.previous ? edit : { ...edit, previous });
    visible.set(edit.index, edit.tile);
  }

  const layers = board.layers.map((layer) => ({ ...layer, tiles: [...layer.tiles] }));
  for (const [flatIndex, original] of baseline) {
    const layerIndex = Math.floor(flatIndex / (board.sizeX * board.sizeY));
    const index = flatIndex % (board.sizeX * board.sizeY);
    const layer = layers[layerIndex];
    if (layer !== undefined) layer.tiles[index] = visible.has(flatIndex) ? visible.get(flatIndex)! : original;
  }
  state.world = { ...state.world, board: { ...board, layers, runtime: { ...board.runtime, tileEdits: retained } } };
}

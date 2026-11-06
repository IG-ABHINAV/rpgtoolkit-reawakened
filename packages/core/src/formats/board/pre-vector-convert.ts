/**
 * Converting a pre-vector board to the vector board model ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)
 * conversion rules, over the layout and coordinates described by [coordinates](../../../../../../docs/spec/formats/board.md#coordinates)).
 *
 * Pure and deterministic (G2, G3): it is a function of the `PreVectorBoard`
 * the reader returned, with no clock, randomness or host access, so the same
 * bytes always convert to the identical `Board`.
 *
 * The pre-vector layout's "Conversion rules" pin the geometry per tile type; the shapes here
 * are the ones [coordinates](../../../../../../docs/spec/formats/board.md#coordinates) (tile → pixel) and the board's 32×32 tile size give: an axis-aligned
 * 32×32 cell in 2D, a 64×32 diamond for an iso-stacked board. The pre-vector
 * layout leaves iso-rotated boards unspecified, so they are refused with a located error,
 * and it generates no vector base for the sprites (the bases come from each
 * sprite's own actor file, docs/spec/formats/character.md#layout.
 */

import { err, ok, type Result } from "../result.ts";
import {
  BOARD_VECTOR_MINOR,
  COORD_ISO_ROTATED,
  type Board,
  type BoardPoint,
  type BoardProgram,
  type BoardRgb,
  type BoardShadeLayer,
  type BoardShadeRecord,
  type BoardSprite,
  type BoardTileRun,
  type BoardVector,
} from "./model.ts";
import { PRE_VECTOR_SECTION, type PreVectorBoard } from "./pre-vector-reader.ts";

/** The vector type for a solid / passage blocking edge ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
export const TT_SOLID = 1;

/** The vector type for an under tile ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
export const TT_UNDER = 2;

/** The vector type for a stair ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
export const TT_STAIRS = 8;

/** The under attribute that includes the board background image ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
export const TA_BRD_BACKGROUND = 1;

/** The program activation flag that stops the player's movement ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
export const PRG_STOPS_MOVEMENT = 4;

/** The legacy tile type for a solid tile ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
const TILE_SOLID = 1;

/** The legacy tile type for an under tile ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
const TILE_UNDER = 2;

/** The legacy tile type for a north–south passage ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
const TILE_PASSAGE_NS = 3;

/** The legacy tile type for an east–west passage ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
const TILE_PASSAGE_EW = 4;

/** The first legacy stair tile type; 11…18 mean layers 1…8 ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
const TILE_STAIRS_FIRST = 11;

/** The last legacy stair tile type ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
const TILE_STAIRS_LAST = 18;

/**
 * The `coordType` bit for pixel-absolute object coordinates ([coordinates](../../../../../../docs/spec/formats/board.md#coordinates)):
 * a flag combinable with 0 (2D), 1 (iso stacked) or 2 (iso rotated), so it is
 * masked off before the coordinate-style check and passed through unchanged.
 */
const COORD_PX_ABSOLUTE = 4;

/**
 * The most cells one stored tile run marker may cover ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)): a
 * marker holds the negated count in an `i16`, so a longer uniform stretch is
 * split into several markers that still re-read cell for cell.
 */
const MAX_TILE_RUN = 32768;

/**
 * The most cells one shade record may cover ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)): the writer
 * stores `runCount` as an `i16`, so a longer uniform shade is split at 32767.
 */
const MAX_SHADE_RUN = 32767;

/** A located error for a value the converter cannot map (AD-18). */
function fail(message: string): Result<never> {
  return err({ offset: 0, section: PRE_VECTOR_SECTION, message });
}

/**
 * The tile-top-left → pixel mapping ([coordinates](../../../../../../docs/spec/formats/board.md#coordinates)), with the base point already added
 * (2D +16,+31; the iso systems +0,+0, where the result is the tile centre).
 * The pre-vector layout sends positions through this and the vector layout stores the result in pixels.
 */
function tilePixel(x: number, y: number, sizeX: number, coordType: number): BoardPoint {
  if ((coordType & COORD_ISO_ROTATED) !== 0) {
    return { x: (x - y + sizeX) * 32, y: (x + y - sizeX) * 16 - 16 };
  }
  if ((coordType & 1) !== 0) {
    return { x: 64 * x - (y % 2 !== 0 ? 32 : 64), y: 16 * y - 16 };
  }
  return { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 };
}

/**
 * The closed pixel polygon of the merged block of tiles `x…xEnd` × `y…yEnd`
 * on a 2D board, in the winding order (top-left, top-right, bottom-right,
 * bottom-left). The pre-vector layout's program rectangle `((x−1)·32, (y−1)·32)`–`(x·32, y·32)`
 * is the single-cell case (`xEnd === x`, `yEnd === y`), and [coordinates](../../../../../../docs/spec/formats/board.md#coordinates) fixes the 32×32 extent.
 * The original emits the opposite winding. Current collision code can choose
 * a different edge at a corner for the two orders (#1284); parity is unknown.
 */
function tileCellRect(x: number, y: number, xEnd: number, yEnd: number): BoardPoint[] {
  const left = (x - 1) * 32;
  const top = (y - 1) * 32;
  const right = xEnd * 32;
  const bottom = yEnd * 32;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/**
 * The closed 64×32 diamond centred on a tile of an iso-stacked board, in the
 * order (top, right, bottom, left). The pre-vector layout asks for this shape for a
 * program region; the board's 32×32 tile extent ([coordinates](../../../../../../docs/spec/formats/board.md#coordinates)) plus the stacked mapping,
 * whose base point is the tile centre, give the same cell for a tile vector.
 */
function tileDiamond(x: number, y: number, sizeX: number): BoardPoint[] {
  const centre = tilePixel(x, y, sizeX, 1);
  return [
    { x: centre.x, y: centre.y - 16 },
    { x: centre.x + 32, y: centre.y },
    { x: centre.x, y: centre.y + 16 },
    { x: centre.x - 32, y: centre.y },
  ];
}

/**
 * The two open blocking-edge polylines of a passage tile ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)): a north–south
 * passage blocks its **west and east** edges, an east–west passage blocks its
 * **north and south** edges, as the "Tile type vectorization" bullet rules;
 * the polylines are open (`closed = 0`) and passages are never merged.
 */
function passageEdges(type: number, x: number, y: number, layer: number, board: PreVectorBoard): BoardVector[] {
  const iso = (board.coordType & 1) !== 0;
  let west: BoardPoint[];
  let east: BoardPoint[];
  if (iso) {
    const [top, right, bottom, left] = tileDiamond(x, y, board.sizeX) as [
      BoardPoint,
      BoardPoint,
      BoardPoint,
      BoardPoint,
    ];
    if (type === TILE_PASSAGE_NS) {
      west = [top, left, bottom];
      east = [top, right, bottom];
    } else {
      west = [left, top, right];
      east = [left, bottom, right];
    }
  } else if (type === TILE_PASSAGE_NS) {
    west = [
      { x: (x - 1) * 32, y: (y - 1) * 32 },
      { x: (x - 1) * 32, y: y * 32 },
    ];
    east = [
      { x: x * 32, y: (y - 1) * 32 },
      { x: x * 32, y: y * 32 },
    ];
  } else {
    west = [
      { x: (x - 1) * 32, y: (y - 1) * 32 },
      { x: x * 32, y: (y - 1) * 32 },
    ];
    east = [
      { x: (x - 1) * 32, y: y * 32 },
      { x: x * 32, y: y * 32 },
    ];
  }
  return [
    { points: west, attributes: 0, closed: 0, layer, type: TT_SOLID, handle: "" },
    { points: east, attributes: 0, closed: 0, layer, type: TT_SOLID, handle: "" },
  ];
}

/**
 * Merge the per-tile types of the pre-vector layout into vectors (its "Tile type
 * vectorization" rule): solid tiles become closed polygons, under tiles closed
 * polygons with the background attribute, passages open polylines along their
 * blocking edges, and stairs closed polygons carrying the target layer.
 *
 * Per the pre-vector layout's "Merge" rule a 2D board merges **greedy
 * rectangles**: scan column by column (x ascending, then y), take the first
 * unconsumed non-zero cell, grow down and then right over unconsumed matching
 * cells, and consume the block. The scan order fixes the seams.
 * An iso-stacked board emits one diamond per tile: the original merges in the
 * rotated grid instead, which is unverified and recorded as Unknown in the
 * docs. Unlisted tile types (5…10 and values above 18) emit nothing rather
 * than an invented shape.
 */
function buildTileVectors(board: PreVectorBoard): BoardVector[] {
  const vectors: BoardVector[] = [];
  const cellsPerLayer = board.sizeX * board.sizeY;
  const iso = (board.coordType & 1) !== 0;
  const typeAt = (base: number, x: number, y: number): number =>
    board.tileMatrix[base + (y - 1) * board.sizeX + (x - 1)]?.tileType ?? 0;
  const pushBlock = (type: number, x: number, y: number, xEnd: number, yEnd: number, layer: number): void => {
    const isUnder = type === TILE_UNDER;
    const isStairs = type >= TILE_STAIRS_FIRST;
    vectors.push({
      points: tileCellRect(x, y, xEnd, yEnd),
      attributes: isUnder ? TA_BRD_BACKGROUND : isStairs ? type - 10 : 0,
      closed: -1,
      layer,
      type: isUnder ? TT_UNDER : isStairs ? TT_STAIRS : TT_SOLID,
      handle: "",
    });
  };
  for (let layer = 1; layer <= board.sizeL; layer += 1) {
    const base = (layer - 1) * cellsPerLayer;
    if (iso) {
      for (let y = 1; y <= board.sizeY; y += 1) {
        for (let x = 1; x <= board.sizeX; x += 1) {
          const type = typeAt(base, x, y);
          if (type === TILE_PASSAGE_NS || type === TILE_PASSAGE_EW) {
            for (const vector of passageEdges(type, x, y, layer, board)) {
              vectors.push(vector);
            }
            continue;
          }
          if (type !== TILE_SOLID && type !== TILE_UNDER && (type < TILE_STAIRS_FIRST || type > TILE_STAIRS_LAST)) {
            continue;
          }
          const isUnder = type === TILE_UNDER;
          const isStairs = type >= TILE_STAIRS_FIRST;
          vectors.push({
            points: tileDiamond(x, y, board.sizeX),
            attributes: isUnder ? TA_BRD_BACKGROUND : isStairs ? type - 10 : 0,
            closed: -1,
            layer,
            type: isUnder ? TT_UNDER : isStairs ? TT_STAIRS : TT_SOLID,
            handle: "",
          });
        }
      }
      continue;
    }
    const consumed = new Uint8Array(cellsPerLayer);
    for (let x = 1; x <= board.sizeX; x += 1) {
      for (let y = 1; y <= board.sizeY; y += 1) {
        const type = typeAt(base, x, y);
        if (type === 0 || consumed[(y - 1) * board.sizeX + (x - 1)] === 1) continue;
        if (type === TILE_PASSAGE_NS || type === TILE_PASSAGE_EW) {
          for (const vector of passageEdges(type, x, y, layer, board)) {
            vectors.push(vector);
          }
          consumed[(y - 1) * board.sizeX + (x - 1)] = 1;
          continue;
        }
        if (type !== TILE_SOLID && type !== TILE_UNDER && (type < TILE_STAIRS_FIRST || type > TILE_STAIRS_LAST)) {
          continue;
        }
        let yEnd = y;
        while (yEnd < board.sizeY && consumed[yEnd * board.sizeX + (x - 1)] === 0 && typeAt(base, x, yEnd + 1) === type) {
          yEnd += 1;
        }
        let xEnd = x;
        while (xEnd < board.sizeX) {
          let columnMatches = true;
          for (let yy = y; yy <= yEnd; yy += 1) {
            if (consumed[(yy - 1) * board.sizeX + xEnd] !== 0 || typeAt(base, xEnd + 1, yy) !== type) {
              columnMatches = false;
              break;
            }
          }
          if (!columnMatches) break;
          xEnd += 1;
        }
        for (let cx = x; cx <= xEnd; cx += 1) {
          for (let cy = y; cy <= yEnd; cy += 1) {
            consumed[(cy - 1) * board.sizeX + (cx - 1)] = 1;
          }
        }
        pushBlock(type, x, y, xEnd, yEnd, layer);
      }
    }
  }
  return vectors;
}

/**
 * The stored run-length encoding of an index matrix ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)), built from the
 * expanded cells: maximal runs of one index, a bare index when a run is one
 * cell. Kept so the converted board's writer is byte-stable (AD-18).
 */
function encodeTileRuns(indices: readonly number[]): BoardTileRun[] {
  const runs: BoardTileRun[] = [];
  let i = 0;
  while (i < indices.length) {
    const value = indices[i] ?? 0;
    let end = i + 1;
    while (end < indices.length && indices[end] === value) {
      end += 1;
    }
    let remaining = end - i;
    while (remaining > 0) {
      const count = remaining > MAX_TILE_RUN ? MAX_TILE_RUN : remaining;
      runs.push({ lutIndex: value, count, marker: count > 1 });
      remaining -= count;
    }
    i = end;
  }
  return runs;
}

/**
 * Flatten the per-tile shades of every layer into shade layer 0: for each cell
 * the stored value is the tint of the **highest layer whose tile has a non-zero
 * tint** — not the sum of the layers' tints, and never clamped (the clamp stays
 * render-time, `docs/spec/formats/tiles.md#shading`). Layers are walked
 * ascending, so a higher layer's tint overwrites a lower layer's for the cells
 * it tints, and a lower layer's tint survives for the cells no higher layer
 * tints. A tint of exactly `(0,0,0)` is "unshaded" and does not win. The cast
 * layer is the highest layer that carried any non-zero tint anywhere on the
 * board, and a board whose cells are all unshaded gets no shade layer.
 *
 * Citation: `docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector`.
 * This withdraws the entry 2.15 rule, which summed every layer's tint
 * unclamped (so a cell shaded `+255` on two layers became `+510`); the sums
 * were a guess made for lack of facts.
 */
function buildShadeLayers(board: PreVectorBoard): BoardShadeLayer[] {
  const cellsPerLayer = board.sizeX * board.sizeY;
  const shades: BoardRgb[] = [];
  for (let cell = 0; cell < cellsPerLayer; cell += 1) {
    shades.push({ r: 0, g: 0, b: 0 });
  }
  let castLayer = 0;
  for (let layer = 1; layer <= board.sizeL; layer += 1) {
    const base = (layer - 1) * cellsPerLayer;
    let layerHasShade = false;
    for (let cell = 0; cell < cellsPerLayer; cell += 1) {
      const tile = board.tileMatrix[base + cell];
      if (tile === undefined || (tile.r === 0 && tile.g === 0 && tile.b === 0)) {
        continue;
      }
      layerHasShade = true;
      shades[cell] = { r: tile.r, g: tile.g, b: tile.b };
    }
    if (layerHasShade) {
      castLayer = layer;
    }
  }
  if (castLayer === 0) {
    return [];
  }
  const records: BoardShadeRecord[] = [];
  let cell = 0;
  while (cell < cellsPerLayer) {
    const current = shades[cell] ?? { r: 0, g: 0, b: 0 };
    let end = cell + 1;
    while (end < cellsPerLayer) {
      const next = shades[end];
      if (next === undefined || next.r !== current.r || next.g !== current.g || next.b !== current.b) {
        break;
      }
      end += 1;
    }
    let remaining = end - cell;
    while (remaining > 0) {
      const runCount = remaining > MAX_SHADE_RUN ? MAX_SHADE_RUN : remaining;
      records.push({ runCount, r: current.r, g: current.g, b: current.b });
      remaining -= runCount;
    }
    cell = end;
  }
  return [{ castLayer, records }];
}

/** Strip a legacy VB type-declaration suffix (`!` or `$`) from a variable name ([pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). */
function stripLegacySuffix(name: string): string {
  const last = name.slice(-1);
  return last === "!" || last === "$" ? name.slice(0, -1) : name;
}

/** The additive ambience for an ambient preset of the pre-vector layout (0 none, 1 mist, 2 dark, 3 water). */
function ambientFromPreset(preset: number, warnings: string[]): BoardRgb {
  if (preset === 1) {
    return { r: 75, g: 75, b: 75 };
  }
  if (preset === 2) {
    return { r: -75, g: -75, b: -75 };
  }
  if (preset === 3) {
    return { r: 0, g: 0, b: 75 };
  }
  if (preset !== 0) {
    warnings.push(`unknown ambient preset ${preset}; converted as none (see [pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector))`);
  }
  return { r: 0, g: 0, b: 0 };
}

/**
 * Convert a pre-vector board to the vector board model ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)), applying the
 * conversion rules of the [pre-vector layout](../../../../../../docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector): per-tile-type vectorization, program trigger regions,
 * shading flattened into layer 0, and tile → pixel positions for the start
 * point and the sprites. The result's minor is 4 and its `coordType` is the
 * source's.
 *
 * Two rules the entry 2.23 conflict rulings settled reach this function (both
 * cited at their site): empty program and item slots are **dropped** (R-05,
 * because the 3.1 editor's conversion compacts both lists — the reader still
 * keeps every stored slot), and the start's fallback is **per axis** (R-07:
 * `startX ≤ 0 → 64`, `startY ≤ 0 → 64`, `startL ≤ 0 → 1`). A shading rule
 * (R-02) withdraws entry 2.15's unclamped sum — see `buildShadeLayers`. The
 * "Default vector bases" rule makes this conversion generate no base — a
 * sprite's collision and activation bases come from its own `.itm`/`.tem`.
 */
export function convertPreVectorBoard(board: PreVectorBoard): Result<Board> {
  const coordStyle = board.coordType & ~COORD_PX_ABSOLUTE;
  if (coordStyle !== 0 && coordStyle !== 1 && coordStyle !== COORD_ISO_ROTATED) {
    return fail(
      `coordType ${board.coordType} is not one of docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector's 0 (2D), 1 (iso stacked) or 2 (iso rotated), optionally combined with docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector's 4 (pixel absolute)`,
    );
  }
  if ((board.coordType & COORD_ISO_ROTATED) !== 0) {
    return fail(
      "iso-rotated pre-vector boards cannot be converted: docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector records no mapping from the sizeX×sizeY pre-vector tile matrix onto docs/spec/formats/board.md#vector-layout-minor-4-and-later's (sizeX+sizeY)² rotated grid and gives no rotated program region",
    );
  }
  if (board.sizeX < 0 || board.sizeY < 0 || board.sizeL < 0) {
    return fail(`negative board dimensions ${board.sizeX}×${board.sizeY}×${board.sizeL}`);
  }
  const cellsPerLayer = board.sizeX * board.sizeY;
  const totalCells = cellsPerLayer * board.sizeL;
  if (board.tileMatrix.length !== totalCells) {
    return fail(
      `tile matrix covers ${board.tileMatrix.length} cells but the ${board.sizeX}×${board.sizeY}×${board.sizeL} grid has ${totalCells}`,
    );
  }

  const indices: number[] = [];
  for (const tile of board.tileMatrix) {
    if (!Number.isInteger(tile.lutIndex) || tile.lutIndex < 0 || tile.lutIndex > 32767) {
      return fail(`tile matrix LUT index ${tile.lutIndex} does not fit a non-negative i16`);
    }
    indices.push(tile.lutIndex);
  }

  const iso = (board.coordType & 1) !== 0;
  // Empty program and item slots — Reawakened rule (R-05)
  // (docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector):
  // the converter compacts both lists, dropping empty slots so no index gap or
  // invented geometry survives — an empty program slot would otherwise carry no
  // region (`points: []`, `closed: 0`) and an empty item slot position (0, 0).
  // This matches the 3.1 editor's conversion; the *reader* still keeps every
  // stored slot so a board round-trips byte for byte (R-06).
  const programs: BoardProgram[] = board.programs
    .filter((program) => program.file !== "")
    .map((program) => ({
      program: program.file,
      graphic: program.graphic,
      initialVar: stripLegacySuffix(program.initialVar),
      initialValue: program.initialValue,
      finalVar: stripLegacySuffix(program.finalVar),
      finalValue: program.finalValue,
      activate: program.activate,
      activationType: program.activationType | PRG_STOPS_MOVEMENT,
      repeatDistance: 0,
      layer: program.layer,
      points: iso
        ? tileDiamond(program.x, program.y, board.sizeX)
        : tileCellRect(program.x, program.y, program.x, program.y),
      closed: -1,
      handle: "",
    }));

  const sprites: BoardSprite[] = board.sprites
    .filter((sprite) => sprite.file !== "")
    .map((sprite) => {
      const initialVar = stripLegacySuffix(sprite.initialVar);
      const pixel = tilePixel(sprite.x, sprite.y, board.sizeX, board.coordType);
      return {
        itemFile: sprite.file,
        activationPrg: sprite.activationPrg,
        multitaskPrg: sprite.multitaskPrg,
        initialVar,
        initialValue: sprite.initialValue,
        finalVar: stripLegacySuffix(sprite.finalVar),
        finalValue: sprite.finalValue,
        loadingVar: initialVar,
        loadingValue: sprite.initialValue,
        activate: sprite.activate,
        activationType: sprite.activationType,
        x: pixel.x,
        y: pixel.y,
        layer: sprite.layer,
        reserved: -1,
      };
    });

  // The start falls back **per axis** — Reawakened rule (R-07)
  // (docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector):
  // `startX ≤ 0 → x 64`, `startY ≤ 0 → y 64`, `startL ≤ 0 → layer 1`, each
  // independent of the others, so one bad axis does not discard the other's docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector
  // mapping. The start is the only field with a fallback; a sprite or program at
  // a non-positive tile converts with no special case.
  const startPixel = tilePixel(board.startX, board.startY, board.sizeX, board.coordType);
  const start = {
    x: board.startX <= 0 ? 64 : startPixel.x,
    y: board.startY <= 0 ? 64 : startPixel.y,
    layer: board.startLayer > 0 ? board.startLayer : 1,
  };

  const warnings: string[] = [];
  const layerTitles: string[] = [];
  for (let index = 0; index <= board.sizeL; index += 1) {
    layerTitles.push(board.layerTitles[index] ?? "");
  }

  return ok(
    {
      magic: board.magic,
      major: board.major,
      minor: BOARD_VECTOR_MINOR,
      sizeX: board.sizeX,
      sizeY: board.sizeY,
      sizeL: board.sizeL,
      coordType: board.coordType,
      lut: [...board.lut],
      tileMatrix: indices,
      tileRuns: encodeTileRuns(indices),
      shadeLayers: buildShadeLayers(board),
      lights: [],
      vectors: buildTileVectors(board),
      programs,
      sprites,
      images: [],
      threads: [...board.threads],
      constants: board.constants.map((value) => String(value)),
      layerTitles,
      links: { ...board.links },
      properties: {
        backgroundImage: board.backgroundImage,
        backgroundDrawType: 1,
        backgroundColour: board.backgroundColour,
        backgroundMusic: board.backgroundMusic,
        enterPrg: board.enterPrg,
        battleBackground: board.battleBackground,
        battleSkill: board.battleSkill,
        allowBattles: board.allowBattles,
        disableSaving: board.disableSaving,
        ambient: ambientFromPreset(board.ambientPreset, warnings),
        start,
      },
      residue: board.residue.slice(),
    },
    warnings,
  );
}

/**
 * Board coordinate conversions (docs/spec/formats/board.md#coordinates and
 * #board-pixel-dimensions). Tile coordinates are 1-based; pixel positions are
 * board pixels from the top-left of the board. Pure integer arithmetic: no
 * floating-point projection, so every JavaScript engine agrees (G3).
 */

/** The three tile layouts a board's `coordType` selects (the "use pixel coordinates" flag 4 is ignored). */
export type CoordLayout = "2d" | "iso-stacked" | "iso-rotated";

/** A 64×32 isometric diamond is this wide. */
export const ISO_TILE_WIDTH = 64;
/** A 64×32 isometric diamond is this tall. */
export const ISO_TILE_HEIGHT = 32;

/** A position in tile or pixel space. */
export type CoordPoint = { readonly x: number; readonly y: number };

/**
 * Layout of a board. Bit value 2 is the rotated layout (this matches
 * `boardGrid`, which gives rotated boards their square stored grid), bit value 1 the
 * stacked one, and neither is the ordinary grid.
 */
export function coordLayout(coordType: number): CoordLayout {
  if ((coordType & 2) !== 0) return "iso-rotated";
  if ((coordType & 1) !== 0) return "iso-stacked";
  return "2d";
}

/** True for both isometric layouts. */
export function isIsometric(layout: CoordLayout): boolean {
  return layout !== "2d";
}

/**
 * The editor's "Use pixel coordinates" flag (bit 4 of `coordType`): positions
 * that follow a board's own coordinate mode are board pixels on such a board and
 * one-based tile coordinates otherwise
 * (docs/spec/formats/board.md#coordinates). `send` targets are the script
 * position ruled to follow it (docs/spec/engine/movement-and-collision.md#reawakened-send-board, #1246).
 */
export function usesPixelCoordinates(coordType: number): boolean {
  return (coordType & 4) !== 0;
}

/** Board pixel width and height for a layout (board.md#board-pixel-dimensions). */
export function boardPixelSize(layout: CoordLayout, sizeX: number, sizeY: number): { readonly width: number; readonly height: number } {
  switch (layout) {
    case "2d":
      return { width: 32 * sizeX, height: 32 * sizeY };
    case "iso-stacked":
      return { width: 64 * sizeX - 32, height: 16 * sizeY - 16 };
    case "iso-rotated":
      return { width: 64 * sizeX - 32, height: 32 * sizeY };
  }
}

/**
 * Tile (1-based) to stored pixel position (board.md#coordinates). Ordinary
 * boards use the bottom-centre of the tile; both isometric layouts use the
 * diamond's centre, which is the sprite reference point (E-11).
 */
export function tileToPixel(layout: CoordLayout, sizeX: number, x: number, y: number): CoordPoint {
  switch (layout) {
    case "2d":
      return { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 };
    case "iso-stacked":
      return { x: 64 * x - (y % 2 !== 0 ? 32 : 64), y: 16 * y - 16 };
    case "iso-rotated":
      return { x: (x - y + sizeX) * 32, y: (x + y - sizeX) * 16 - 16 };
  }
}

/**
 * Pixel-to-tile (1-based). Ordinary boards subtract the base point and floor.
 * The rotated layout uses the spec's closed form. The stacked layout snaps to the
 * nearest 32×16 diamond centre, where nearness is the diamond's own metric
 * `|dx| + 2·|dy|` and an exact tie keeps the upper (lower-`y`) row.
 */
export function pixelToTile(layout: CoordLayout, sizeX: number, px: number, py: number): CoordPoint {
  switch (layout) {
    case "2d":
      return { x: Math.floor((px - 16) / 32) + 1, y: Math.floor((py - 31) / 32) + 1 };
    case "iso-rotated": {
      const y = Math.floor((py + 16) / 32) - Math.floor(px / 64) + sizeX;
      return { x: Math.floor(px / 32) + y - sizeX, y };
    }
    case "iso-stacked": {
      const row = Math.floor(py / 16);
      let best: CoordPoint | null = null;
      let bestDistance = 0;
      for (let candidate = row; candidate <= row + 1; candidate += 1) {
        const y = candidate + 1;
        const offset = y % 2 !== 0 ? 32 : 0;
        const x = Math.floor((px - offset + 32) / 64) + 1;
        const distance = Math.abs(px - (64 * (x - 1) + offset)) + 2 * Math.abs(py - 16 * candidate);
        if (best === null || distance < bestDistance) {
          best = { x, y };
          bestDistance = distance;
        }
      }
      return best ?? { x: 1, y: 1 };
    }
  }
}

/**
 * The one-way editor upgrade from stacked to rotated tile coordinates
 * (board.md#coordinates). Both layouts then place the tile at the same pixel,
 * with the same `sizeX`.
 */
export function stackedToRotated(x: number, y: number, sizeX: number): CoordPoint {
  return { x: x + Math.floor((y - 1) / 2), y: Math.floor(y / 2) + 1 - x + sizeX };
}

/**
 * The pixel where a `placeplayer(x, y, layer, unit, …)` effect puts the player
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-board-entry): a pixel
 * position is its own conversion, and a tile position is converted through the
 * destination board's own coordinate layout — `coordType` and `sizeX`, sent
 * along with tile placements, select that layout. Without a recorded
 * `coordType` a tile position still converts with the ordinary 2D table, exactly
 * as older saves and older effect records keep playing.
 */
export function placeplayerPixel(
  x: number,
  y: number,
  unit: string | number | null | undefined,
  coordType: string | number | null | undefined,
  sizeX: string | number | null | undefined,
): CoordPoint {
  if (unit !== "tile") return { x, y };
  if (typeof coordType !== "number" || typeof x !== "number" || typeof y !== "number") {
    return { x: (Number(x) - 1) * 32 + 16, y: (Number(y) - 1) * 32 + 31 };
  }
  return tileToPixel(coordLayout(coordType), Number(sizeX ?? 0), x, y);
}

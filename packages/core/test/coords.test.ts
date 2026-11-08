import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { boardPixelSize, coordLayout, pixelToTile, placeplayerPixel, stackedToRotated, tileToPixel } from "../src/index.ts";

/** A fixed multiplicative congruential stream: the same 100 cells on every run. */
function cells(count: number, maxSize: number, maxIndex: number): Array<{ sizeX: number; x: number; y: number }> {
  let state = 20261017;
  const next = (modulus: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (state >>> 8) % modulus;
  };
  return Array.from({ length: count }, () => ({ sizeX: next(maxSize) + 1, x: next(maxIndex) + 1, y: next(maxIndex) + 1 }));
}

test("coordinate layouts follow coordType and ignore the pixel-coordinate flag 4", () => {
  equal(coordLayout(0), "2d");
  equal(coordLayout(4), "2d");
  equal(coordLayout(1), "iso-stacked");
  equal(coordLayout(5), "iso-stacked");
  equal(coordLayout(2), "iso-rotated");
  equal(coordLayout(6), "iso-rotated");
});

test("tileToPixel reproduces the board.md#coordinates table on 100 generated cells", () => {
  for (const { sizeX, x, y } of cells(100, 9, 40)) {
    deepEqual(tileToPixel("2d", sizeX, x, y), { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 });
    deepEqual(tileToPixel("iso-stacked", sizeX, x, y), { x: 64 * x - (y % 2 === 1 ? 32 : 64), y: 16 * y - 16 });
    deepEqual(tileToPixel("iso-rotated", sizeX, x, y), { x: (x - y + sizeX) * 32, y: (x + y - sizeX) * 16 - 16 });
  }
});

test("pixelToTile reproduces the spec's inverse formulas and round-trips on 100 generated cells", () => {
  for (const { sizeX, x, y } of cells(100, 9, 40)) {
    const rotated = tileToPixel("iso-rotated", sizeX, x, y);
    const ty = Math.floor((rotated.y + 16) / 32) - Math.floor(rotated.x / 64) + sizeX;
    const tx = Math.floor(rotated.x / 32) + ty - sizeX;
    deepEqual({ x: tx, y: ty }, { x, y });
    deepEqual(pixelToTile("iso-rotated", sizeX, rotated.x, rotated.y), { x, y });
    const stacked = tileToPixel("iso-stacked", sizeX, x, y);
    deepEqual(pixelToTile("iso-stacked", sizeX, stacked.x, stacked.y), { x, y });
    const flat = tileToPixel("2d", sizeX, x, y);
    deepEqual(pixelToTile("2d", sizeX, flat.x, flat.y), { x, y });
  }
});

test("the stacked inverse snaps every pixel of a diamond to that diamond's tile, and an exact tie keeps the upper row", () => {
  for (let y = 1; y <= 6; y += 1) {
    for (let x = 1; x <= 4; x += 1) {
      const centre = tileToPixel("iso-stacked", 4, x, y);
      for (let dy = -7; dy <= 7; dy += 1) {
        for (let dx = -31; dx <= 31; dx += 1) {
          if (Math.abs(dx) + 2 * Math.abs(dy) >= 32) continue;
          deepEqual(pixelToTile("iso-stacked", 4, centre.x + dx, centre.y + dy), { x, y });
        }
      }
    }
  }
  // Halfway between the centres of (1,1) at (0,0) and (1,2) at (32,16): equal distance, upper row wins.
  deepEqual(pixelToTile("iso-stacked", 4, 16, 8), { x: 1, y: 1 });
});

test("stacked-to-rotated conversion round-trips a whole tile grid and keeps every tile on its pixel", () => {
  for (const [sizeX, sizeY] of [[1, 1], [3, 5], [4, 4], [7, 2]] as const) {
    const rotatedSide = sizeX + sizeY;
    const stacked = new Map<string, number>();
    const rotated = new Array<number | null>(rotatedSide * rotatedSide).fill(null);
    let value = 1;
    for (let ys = 1; ys <= sizeY; ys += 1) {
      for (let xs = 1; xs <= sizeX; xs += 1) {
        stacked.set(`${xs},${ys}`, value);
        const target = stackedToRotated(xs, ys, sizeX);
        equal(target.x >= 1 && target.x <= rotatedSide && target.y >= 1 && target.y <= rotatedSide, true, `(${xs},${ys}) lands in the rotated grid`);
        const at = (target.y - 1) * rotatedSide + (target.x - 1);
        equal(rotated[at], null, "no two stacked tiles share a rotated cell");
        rotated[at] = value;
        deepEqual(tileToPixel("iso-rotated", sizeX, target.x, target.y), tileToPixel("iso-stacked", sizeX, xs, ys));
        deepEqual(pixelToTile("iso-rotated", sizeX, tileToPixel("iso-stacked", sizeX, xs, ys).x, tileToPixel("iso-stacked", sizeX, xs, ys).y), target);
        value += 1;
      }
    }
    for (const [key, expected] of stacked) {
      const [xs = 0, ys = 0] = key.split(",").map(Number);
      const target = stackedToRotated(xs, ys, sizeX);
      equal(rotated[(target.y - 1) * rotatedSide + (target.x - 1)], expected);
    }
    equal(rotated.filter((cell) => cell !== null).length, sizeX * sizeY);
  }
});

test("board pixel size follows board.md#board-pixel-dimensions", () => {
  deepEqual(boardPixelSize("2d", 4, 3), { width: 128, height: 96 });
  deepEqual(boardPixelSize("iso-stacked", 3, 5), { width: 160, height: 64 });
  deepEqual(boardPixelSize("iso-rotated", 3, 2), { width: 160, height: 64 });
});

test("placeplayerPixel converts each layout's tiles, keeps pixel positions verbatim and keeps older records on the 2D table", () => {
  for (const { sizeX, x, y } of cells(30, 9, 40)) {
    deepEqual(placeplayerPixel(x, y, "tile", 0, sizeX), tileToPixel("2d", sizeX, x, y), "2d tile");
    deepEqual(placeplayerPixel(x, y, "tile", 1, sizeX), tileToPixel("iso-stacked", sizeX, x, y), "stacked tile");
    deepEqual(placeplayerPixel(x, y, "tile", 2, sizeX), tileToPixel("iso-rotated", sizeX, x, y), "rotated tile");
    // The flag 4 ("use pixel coordinates") writes no coordType, so a legacy effect record keeps the
    // ordinary 2D conversion exactly as it played before the extra arguments existed (E-11).
    deepEqual(placeplayerPixel(x, y, "tile", undefined, undefined), { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 }, "legacy record");
  }
  deepEqual(placeplayerPixel(64, 64, "pixel", 1, 8), { x: 64, y: 64 }, "a pixel placement is verbatim on any board");
  deepEqual(placeplayerPixel(64, 64, undefined, 1, 8), { x: 64, y: 64 }, "no unit names pixels in older effects");
});

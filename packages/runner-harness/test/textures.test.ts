// The live texture seam a sprite frame depends on (#1262, #1269): the browser and desktop player replay a draw list
// through `liveTextureProvider`, which decodes each named asset with `decodeAssetTexture` and falls back to the core's
// `picturePixels` for a picture the host cannot compose. These cases pin the kinds an actor's animation frame
// publishes: a tileset cell, a single tile `.gph`, and a tile bitmap, whose pixels the core composes.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import { SINGLE_TILE_MAGIC, writeSingleTile, writeTileset, type AssetKey } from "@tk-reawakened/core";
import { decodeAssetTexture } from "../src/textures.ts";

const encoder = new TextEncoder();

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A solid single tile; 32x32 is detail 1 and 16x16 detail 2, as the file format defines. */
function singleTileBytes(size = 32, colour: readonly [number, number, number] = [20, 40, 220]): Uint8Array {
  const value = colour[0] + 256 * colour[1] + 65536 * colour[2];
  return encoder.encode(writeSingleTile({
    magic: SINGLE_TILE_MAGIC,
    major: 2,
    minor: 0,
    detail: size === 32 ? 1 : 2,
    compression: 0,
    width: size,
    height: size,
    pixels: Array(size * size).fill(value),
  }));
}

/** A detail-1 tileset whose first two tiles are solid red and green, the strip an actor cell samples. */
function tilesetBytes(): Uint8Array {
  const pixels = (r: number, g: number, b: number): Uint8Array => {
    const out = new Uint8Array(32 * 32 * 3);
    for (let index = 0; index < 32 * 32; index += 1) {
      out[index * 3] = r;
      out[index * 3 + 1] = g;
      out[index * 3 + 2] = b;
    }
    return out;
  };
  return unwrap(writeTileset({
    version: 20,
    detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
    tiles: [{ pixels: pixels(220, 30, 30) }, { pixels: pixels(30, 200, 60) }],
    residue: new Uint8Array(),
  }));
}

function pixelAt(image: { readonly w: number; readonly rgba: Uint8Array }, x: number, y: number): readonly number[] {
  const index = (y * image.w + x) * 4;
  return [image.rgba[index] ?? -1, image.rgba[index + 1] ?? -1, image.rgba[index + 2] ?? -1, image.rgba[index + 3] ?? -1];
}

test("the live texture decoder expands the tileset an actor cell names (#1262)", () => {
  const decoded = decodeAssetTexture("tiles/hero.tst" as AssetKey, tilesetBytes());
  if (decoded === null) throw new Error("the tileset did not decode");
  equal(decoded.w, 64, "two 32-pixel tiles form the strip");
  equal(decoded.h, 32);
  deepEqual(pixelAt(decoded, 0, 0), [220, 30, 30, 255], "the first cell is the first tile");
  deepEqual(pixelAt(decoded, 32, 0), [30, 200, 60, 255], "the second 32-pixel step is the adjacent tile");
});

test("the live texture decoder expands a single tile .gph an actor frame names (#1261)", () => {
  const decoded = decodeAssetTexture("tiles/hero.gph" as AssetKey, singleTileBytes());
  if (decoded === null) throw new Error("the single tile did not decode");
  equal(decoded.w, 32);
  equal(decoded.h, 32);
  deepEqual(pixelAt(decoded, 16, 16), [20, 40, 220, 255]);
});

test("the live texture decoder keeps a 16x16 single tile at its own size, so a bitmap cell fits it (#1265)", () => {
  // A tile-bitmap cell draws a 16x16 `.gph` at 16x16; the texture it samples must be 16x16, not padded to 32x32.
  const decoded = decodeAssetTexture("tiles/small.gph" as AssetKey, singleTileBytes(16, [200, 20, 200]));
  if (decoded === null) throw new Error("the 16x16 single tile did not decode");
  equal(decoded.w, 16);
  equal(decoded.h, 16);
  deepEqual(pixelAt(decoded, 8, 8), [200, 20, 200, 255]);
});

test("the live texture decoder refuses .tbm, so the core supplies the composed picture (#1269)", () => {
  // A tile bitmap is composed from other tiles, which is core's rule: the host asks `engine.picturePixels` instead of
  // decoding the bytes (runner-web/src/index.ts `liveTextureProvider`).
  equal(decodeAssetTexture("bitmap/hero_frame.tbm" as AssetKey, new Uint8Array()), null);
});

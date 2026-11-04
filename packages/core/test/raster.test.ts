import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, rasterize } from "../src/index.ts";
import type { ScratchId } from "../src/ports/keys.ts";

test("normal RGBA blits preserve source order and color-key alpha deterministically", () => {
  const key = assetKey("tiles/tiny.tst");
  const drawList = { tick: 0, width: 2, height: 1, commands: [
    { kind: "fill" as const, rgb: { r: 0, g: 0, b: 0 } },
    { kind: "blit" as const, source: { asset: key, tile: 1 }, src: { x: 0, y: 0, w: 2, h: 1 }, dst: { x: 0, y: 0, w: 2, h: 1 }, key: { r: 0, g: 1, b: 2 }, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal" as const, iso2d: false },
  ] };
  const texture = { w: 2, h: 1, rgba: new Uint8Array([0, 1, 2, 255, 7, 8, 9, 255]) };
  const first = rasterize(drawList, new Map([[key, texture]]));
  const second = rasterize(drawList, new Map([[key, texture]]));
  equal(first.error, null);
  deepEqual(first.rgba, second.rgba);
  deepEqual(first.rgba, new Uint8Array([0, 0, 0, 255, 7, 8, 9, 255]));
});

test("AD-3 tint, blend and scaling vectors are deterministic", () => {
  const key = assetKey("test/vector");
  const source = { w: 2, h: 1, rgba: new Uint8Array([255, 0, 100, 255, 7, 8, 9, 255]) };
  const tinted = rasterize({
    tick: 0, width: 1, height: 1, commands: [
      { kind: "blit", source: { asset: key, tile: null }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 },
        key: null, tint: { r: -1020, g: 1020, b: 1020 }, alpha: 255, blend: "normal", iso2d: false },
    ],
  }, new Map([[key, source]]));
  deepEqual(tinted.rgba, new Uint8Array([0, 255, 255, 255]));

  const translucent = rasterize({
    tick: 0, width: 1, height: 1, commands: [
      { kind: "fill", rgb: { r: 10, g: 20, b: 30 } },
      { kind: "blit", source: { asset: key, tile: null }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 },
        key: null, tint: { r: -155, g: 150, b: 100 }, alpha: 127, blend: "translucent", iso2d: false },
    ],
  }, new Map([[key, source]]));
  deepEqual(translucent.rgba, new Uint8Array([50, 90, 115, 255]));

  const scaled = rasterize({
    tick: 0, width: 4, height: 2, commands: [
      { kind: "blit", source: { asset: key, tile: null }, src: { x: 0, y: 0, w: 2, h: 1 }, dst: { x: 0, y: 0, w: 4, h: 2 },
        key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: false },
    ],
  }, new Map([[key, source]]));
  deepEqual(scaled.rgba, new Uint8Array([
    255, 0, 100, 255, 255, 0, 100, 255, 7, 8, 9, 255, 7, 8, 9, 255,
    255, 0, 100, 255, 255, 0, 100, 255, 7, 8, 9, 255, 7, 8, 9, 255,
  ]));
});

test("integer primitives use inclusive lines and half-open rectangles", () => {
  const result = rasterize({
    tick: 0, width: 5, height: 5, commands: [
      { kind: "fill", rgb: { r: 1, g: 2, b: 3 } },
      { kind: "line", x1: 0, y1: 0, x2: 4, y2: 4, rgb: { r: 9, g: 8, b: 7 } },
      { kind: "rect", rect: { x: 1, y: 1, w: 3, h: 2 }, rgb: { r: 6, g: 5, b: 4 }, filled: false },
      { kind: "ellipse", rect: { x: 1, y: 1, w: 3, h: 3 }, rgb: { r: 12, g: 11, b: 10 }, filled: true },
    ],
  }, new Map());
  equal(result.error, null);
  equal(result.rgba.length, 100);
  deepEqual(Array.from(result.rgba.slice(0, 4)), [9, 8, 7, 255]);
});

test("scratch targets are cleared on push and balanced on pop", () => {
  const result = rasterize({
    tick: 0, width: 2, height: 1, commands: [
      { kind: "pushTarget", scratch: 1 as ScratchId },
      { kind: "fill", rgb: { r: 4, g: 5, b: 6 } },
      { kind: "popTarget" },
    ],
  }, new Map());
  equal(result.error, null);
  deepEqual(result.rgba, new Uint8Array(8));
  const unbalanced = rasterize({
    tick: 0, width: 1, height: 1, commands: [{ kind: "popTarget" }],
  }, new Map());
  equal(unbalanced.error, "popTarget without pushTarget");
});

test("iso2d blits leave pixels outside the exact diamond transparent", () => {
  const key = assetKey("test/iso");
  const texture = { w: 32, h: 32, rgba: new Uint8Array(32 * 32 * 4).fill(255) };
  const result = rasterize({
    tick: 0, width: 64, height: 32, commands: [
      { kind: "blit", source: { asset: key, tile: null }, src: { x: 0, y: 0, w: 32, h: 32 }, dst: { x: 0, y: 0, w: 64, h: 32 },
        key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: true },
    ],
  }, new Map([[key, texture]]));
  equal(result.error, null);
  equal(result.rgba[0], 0);
  equal(result.rgba[(0 * 64 + 31) * 4], 255);
  equal(result.rgba[(31 * 64 + 32) * 4], 255);
});

test("a tile index selects the 64-pixel diamond of an .iso tileset and the 32-pixel tile of a .tst tileset", () => {
  const strip = (tileWidth: number): { w: number; h: number; rgba: Uint8Array } => {
    const rgba = new Uint8Array(tileWidth * 2 * 32 * 4);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < tileWidth * 2; x += 1) rgba.set([x < tileWidth ? 10 : 200, 0, 0, 255], (y * tileWidth * 2 + x) * 4);
    }
    return { w: tileWidth * 2, h: 32, rgba };
  };
  for (const [name, tileWidth] of [["tiles/a.iso", 64], ["tiles/a.tst", 32]] as const) {
    const key = assetKey(name);
    const result = rasterize({
      tick: 0, width: tileWidth, height: 32, commands: [
        { kind: "blit", source: { asset: key, tile: 2 }, src: { x: 0, y: 0, w: tileWidth, h: 32 }, dst: { x: 0, y: 0, w: tileWidth, h: 32 },
          key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: false },
      ],
    }, new Map([[key, strip(tileWidth)]]));
    equal(result.error, null, name);
    equal(result.rgba[0], 200, name);
  }
});

test("iso2d uses the documented half-up source coordinates at diamond edges", () => {
  const key = assetKey("test/iso-edge");
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const at = (y * 32 + x) * 4;
      rgba[at] = x;
      rgba[at + 1] = y;
      rgba[at + 3] = 255;
    }
  }
  const result = rasterize({
    tick: 0, width: 64, height: 32, commands: [
      { kind: "blit", source: { asset: key, tile: null }, src: { x: 0, y: 0, w: 32, h: 32 }, dst: { x: 0, y: 0, w: 64, h: 32 },
        key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: true },
    ],
  }, new Map([[key, { w: 32, h: 32, rgba }]]));
  equal(result.error, null);
  deepEqual(Array.from(result.rgba.slice((0 * 64 + 31) * 4, (0 * 64 + 31) * 4 + 4)), [0, 1, 0, 255]);
  deepEqual(Array.from(result.rgba.slice((0 * 64 + 32) * 4, (0 * 64 + 32) * 4 + 4)), [0, 0, 0, 255]);
  deepEqual(Array.from(result.rgba.slice((31 * 64 + 32) * 4, (31 * 64 + 32) * 4 + 4)), [31, 31, 0, 255]);
});

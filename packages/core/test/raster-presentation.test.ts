import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { rasterizePresentation } from "../src/index.ts";
import type { DrawListV2, HostDisplayGeometry } from "../src/index.ts";
import type { SurfaceId } from "../src/ports/keys.ts";
import type { DecodedTexture } from "../src/formats/image/model.ts";

const geometry: HostDisplayGeometry = {
  content: { width: 7, height: 1 },
  game: { x: 2, y: 0, width: 3, height: 1 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

const list: DrawListV2 = {
  tick: 0,
  width: 2,
  height: 1,
  commands: [
    { kind: "rect", rect: { x: 0, y: 0, w: 1, h: 1 }, rgb: { r: 255, g: 0, b: 0 }, filled: true },
    { kind: "rect", rect: { x: 1, y: 0, w: 1, h: 1 }, rgb: { r: 0, g: 0, b: 255 }, filled: true },
  ],
  marginCommands: [
    { kind: "rect", rect: { x: -1, y: 0, w: 1, h: 1 }, rgb: { r: 0, g: 255, b: 0 }, filled: true },
    { kind: "rect", rect: { x: 2, y: 0, w: 1, h: 1 }, rgb: { r: 255, g: 255, b: 255 }, filled: true },
  ],
};

test("presentation raster samples Plane 1 and safe Plane 3 at per-axis pixel centres", () => {
  const result = rasterizePresentation(list, geometry, new Map());
  equal(result.error, null);
  equal(result.width, 7);
  equal(result.height, 1);
  deepEqual([...result.rgba], [
    0, 255, 0, 255,
    0, 255, 0, 255,
    255, 0, 0, 255,
    0, 0, 255, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
    0, 0, 0, 0,
  ]);
});

test("margin pixels are rejected when their whole logical cell crosses a safe-area edge", () => {
  const result = rasterizePresentation(list, {
    ...geometry,
    safeArea: { ...geometry.safeArea, left: 1.2 },
  }, new Map());
  equal(result.error, null);
  deepEqual([...result.rgba.slice(4, 8)], [0, 0, 0, 0]);
});

test("an empty safe area disables Plane 3 without affecting Plane 1", () => {
  const result = rasterizePresentation(list, {
    ...geometry,
    safeArea: { top: 0, right: 0, bottom: 0, left: 8 },
  }, new Map());
  equal(result.error, null);
  deepEqual([...result.rgba.slice(8, 20)], [
    255, 0, 0, 255,
    0, 0, 255, 255,
    0, 0, 255, 255,
  ]);
  deepEqual([...result.rgba.slice(20, 24)], [0, 0, 0, 0]);
});
test("surface blits resolve the exact referenced revision", () => {
  const surface = 42 as SurfaceId;
  const red: DecodedTexture = { w: 1, h: 1, rgba: new Uint8Array([255, 0, 0, 255]) };
  const blue: DecodedTexture = { w: 1, h: 1, rgba: new Uint8Array([0, 0, 255, 255]) };
  class VersionedSurfaces extends Map<SurfaceId, DecodedTexture> {
    override get(id: SurfaceId, revision?: number): DecodedTexture | undefined {
      if (id !== surface) return super.get(id);
      return revision === 4 ? red : revision === 5 ? blue : undefined;
    }
  }
  const result = rasterizePresentation({
    tick: 0,
    width: 2,
    height: 1,
    commands: [
      { kind: "blit", source: { surface, rev: 4 }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: false },
      { kind: "blit", source: { surface, rev: 5 }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 1, y: 0, w: 1, h: 1 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: false },
    ],
    marginCommands: [],
  }, { content: { width: 2, height: 1 }, game: { x: 0, y: 0, width: 2, height: 1 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, new Map(), new VersionedSurfaces());
  equal(result.error, null);
  deepEqual([...result.rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
});

test("surface revision errors fail closed at content dimensions", () => {
  const result = rasterizePresentation({
    tick: 0,
    width: 2,
    height: 1,
    commands: [{
      kind: "blit",
      source: { surface: 42 as SurfaceId, rev: 99 },
      src: { x: 0, y: 0, w: 1, h: 1 },
      dst: { x: 0, y: 0, w: 1, h: 1 },
      key: null,
      tint: { r: 0, g: 0, b: 0 },
      alpha: 255,
      blend: "normal",
      iso2d: false,
    }],
    marginCommands: [],
  }, { content: { width: 3.2, height: 2 }, game: { x: 1, y: 0, width: 2, height: 1 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, new Map());
  equal(result.error, "missing decoded texture or surface");
  equal(result.width, 4);
  equal(result.height, 2);
  deepEqual(result.rgba, new Uint8Array(32));
});
test("margin replay errors fail closed in content coordinates", () => {
  const result = rasterizePresentation({
    tick: 0,
    width: 2,
    height: 1,
    commands: [{ kind: "fill", rgb: { r: 1, g: 2, b: 3 } }],
    marginCommands: [{
      kind: "blit",
      source: { surface: 42 as SurfaceId, rev: 99 },
      src: { x: 0, y: 0, w: 1, h: 1 },
      dst: { x: -1, y: 0, w: 1, h: 1 },
      key: null,
      tint: { r: 0, g: 0, b: 0 },
      alpha: 255,
      blend: "normal",
      iso2d: false,
    }],
  }, geometry, new Map());
  equal(result.error, "missing decoded texture or surface");
  equal(result.width, 7);
  equal(result.height, 1);
  deepEqual(result.rgba, new Uint8Array(28));
});

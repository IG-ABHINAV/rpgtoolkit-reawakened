import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { rasterizePresentation } from "../src/index.ts";
import type { DrawListV2, HostDisplayGeometry } from "../src/index.ts";

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

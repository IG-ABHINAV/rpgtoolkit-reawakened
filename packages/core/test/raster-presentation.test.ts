import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, blitTexture, createSurface, createSurfacesSection, rasterizePresentation, readSurfacePixels } from "../src/index.ts";
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
test("Plane 3 blits retain standard AD-3 blend semantics", () => {
  const background = { r: 17, g: 101, b: 203 };
  const cases = [
    { blend: "normal" as const, alpha: 255, rgba: [255, 0, 0, 128], expected: [136, 50, 101, 255], marginExpected: [255, 0, 0, 128] },
    { blend: "translucent" as const, alpha: 128, rgba: [255, 0, 0, 128], expected: [76, 75, 152, 255], marginExpected: [136, 50, 101, 255] },
    { blend: "additive" as const, alpha: 127, rgba: [2, 0, 0, 255], expected: [17, 101, 203, 255], marginExpected: [18, 101, 203, 255] },
    { blend: "additive" as const, alpha: 127, rgba: [255, 0, 0, 0], expected: [144, 101, 203, 255], marginExpected: [17, 101, 203, 255] },
  ];
  const geometry: HostDisplayGeometry = {
    content: { width: 3, height: 1 },
    game: { x: 1, y: 0, width: 1, height: 1 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  for (const { blend, alpha, rgba, expected, marginExpected } of cases) {
    const texture: DecodedTexture = { w: 1, h: 1, rgba: new Uint8Array(rgba) };
    const asset = assetKey("bitmaps/partial.png");
    const surfaceState = createSurfacesSection();
    const screen = createSurface(surfaceState, 1, 1, new Uint8Array([background.r, background.g, background.b, 255]));
    equal(blitTexture(surfaceState, texture, screen, 0, 0, 1, 1, undefined, alpha, blend === "additive"), true);
    const revision = surfaceState.entries[String(screen)]!.rev;
    const reference = readSurfacePixels(surfaceState, screen, revision);
    if (reference === null) throw new Error("expected composited screen pixels");
    deepEqual([...reference.rgba], expected, `${blend} screen pixels use legacy source-alpha, truncation and additive rules`);

    const blit = {
      kind: "blit" as const,
      source: { asset, tile: null },
      src: { x: 0, y: 0, w: 1, h: 1 },
      dst: { x: -1, y: 0, w: 1, h: 1 },
      key: null,
      tint: { r: 0, g: 0, b: 0 },
      alpha,
      blend,
      iso2d: false,
    };
    const result = rasterizePresentation({
      tick: 0,
      width: 1,
      height: 1,
      commands: [{
        ...blit,
        source: { surface: screen, rev: revision },
        dst: { x: 0, y: 0, w: 1, h: 1 },
        alpha: 255,
        blend: "normal",
      }],
      marginCommands: [
        { kind: "rect", rect: { x: -1, y: 0, w: 1, h: 1 }, rgb: background, filled: true },
        blit,
      ],
    }, geometry, new Map([[asset, texture]]), new Map([[screen, reference]]));
    equal(result.error, null);
    deepEqual([...result.rgba.slice(0, 4)], marginExpected, `${blend} Plane 3 pixel follows AD-3 blend semantics`);
    deepEqual([...result.rgba.slice(4, 8)], expected, "Plane 1 remains a normal AD-3 blit of the screen's composed pixels");
  }
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

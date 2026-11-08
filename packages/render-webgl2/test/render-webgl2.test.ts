import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createWebgl2Renderer } from "../src/index.ts";
import type { DrawListV2, HostDisplayGeometry, ScratchId, SurfaceId } from "@tk-reawakened/core";

type DrawEvent = { readonly kind: "arrays" | "instanced"; readonly instanced: number };

function fakeContext(): {
  readonly gl: WebGL2RenderingContext;
  readonly uploads: () => readonly unknown[][];
  readonly allocated: () => readonly (readonly [number, number])[];
  readonly deletedTextureCount: () => number;
  readonly drawEvents: () => readonly DrawEvent[];
  readonly blendAlphas: () => readonly number[];
} {
  let next = 1;
  let instanced = 0;
  const uploads: unknown[][] = [];
  const allocated: (readonly [number, number])[] = [];
  const deletedTextures: unknown[] = [];
  const drawEvents: DrawEvent[] = [];
  const blendAlphas: number[] = [];
  const canvas = { width: 0, height: 0 };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}), createFramebuffer: () => ({}),
    getAttribLocation: () => 0, getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_program, name) => ({ name }), createTexture: () => ({}),
    deleteTexture: (texture) => { deletedTextures.push(texture); },
    uniform1i: (location, value) => { if ((location as { name?: string }).name === "uInstanced") instanced = value as number; },
    blendColor: (_r, _g, _b, alpha) => { blendAlphas.push(alpha as number); },
    drawArrays: () => { drawEvents.push({ kind: "arrays", instanced }); },
    drawArraysInstanced: () => { drawEvents.push({ kind: "instanced", instanced }); },
    texImage2D: (...args) => {
      uploads.push(args);
      if (args[8] === null) allocated.push([args[3] as number, args[4] as number]);
    },
  };
  const constantNames: Record<string, true> = {
    VERTEX_SHADER: true, FRAGMENT_SHADER: true, COMPILE_STATUS: true, LINK_STATUS: true, TEXTURE_2D: true,
    TEXTURE_MIN_FILTER: true, TEXTURE_MAG_FILTER: true, NEAREST: true, TEXTURE_WRAP_S: true, TEXTURE_WRAP_T: true,
    CLAMP_TO_EDGE: true, FRAMEBUFFER: true, COLOR_ATTACHMENT0: true, BLEND: true, COLOR_BUFFER_BIT: true, UNPACK_ALIGNMENT: true,
    RGBA8: true, RGBA: true, UNSIGNED_BYTE: true, TEXTURE0: true, TEXTURE1: true, TRIANGLES: true, ARRAY_BUFFER: true,
    STATIC_DRAW: true, DYNAMIC_DRAW: true, FLOAT: true, ONE: true, ZERO: true, SRC_ALPHA: true, ONE_MINUS_SRC_ALPHA: true,
    CONSTANT_ALPHA: true, ONE_MINUS_CONSTANT_ALPHA: true, FUNC_ADD: true,
  };
  const values = new Map<string, number>();
  const gl = new Proxy({} as WebGL2RenderingContext, {
    get: (_target, key: string) => {
      if (key === "canvas") return canvas;
      if (key in methods) return methods[key];
      if (constantNames[key] === true) {
        if (!values.has(key)) values.set(key, next++);
        return values.get(key);
      }
      return () => undefined;
    },
  });
  return {
    gl,
    uploads: () => uploads,
    allocated: () => allocated,
    deletedTextureCount: () => deletedTextures.length,
    drawEvents: () => drawEvents,
    blendAlphas: () => blendAlphas,
  };
}

const geometry: HostDisplayGeometry = {
  content: { width: 3, height: 2 },
  game: { x: 1, y: 0, width: 2, height: 2 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};
const list: DrawListV2 = {
  tick: 0,
  width: 2,
  height: 2,
  commands: [{ kind: "fill", rgb: { r: 20, g: 30, b: 40 } }],
  marginCommands: [{ kind: "rect", rect: { x: -1, y: 0, w: 1, h: 2 }, rgb: { r: 50, g: 60, b: 70 }, filled: true }],
};
const fullGeometry: HostDisplayGeometry = {
  content: { width: 2, height: 1 },
  game: { x: 0, y: 0, width: 2, height: 1 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

test("WebGL2 replays game and margin commands into separate reusable GPU planes without full-frame uploads", () => {
  const { gl, uploads, allocated } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const stats = renderer.render(list, geometry, { textures: () => null });
  equal(stats.drawn, 2);
  equal(stats.deferred, 0);
  equal(renderer.canvas.width, 3);
  equal(renderer.canvas.height, 2);
  deepEqual(allocated(), [[2, 2], [3, 2]]);
  equal(uploads().length, 2);
  equal(uploads().every((args) => args[8] === null), true);
  renderer.render(list, geometry, { textures: () => null });
  equal(allocated().length, 2);
  equal(uploads().length, 2);
  renderer.dispose();
});

test("WebGL2 keeps distinct same-frame surface revisions and evicts obsolete GPU surfaces", () => {
  const { gl, uploads, deletedTextureCount } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const surface = 8 as SurfaceId;
  const seen: number[] = [];
  const blit = (rev: number, x: number) => ({
    kind: "blit" as const, source: { surface, rev }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x, y: 0, w: 1, h: 1 },
    key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal" as const, iso2d: false,
  });
  const listFor = (commands: DrawListV2["commands"]): DrawListV2 => ({ tick: 0, width: 2, height: 1, commands, marginCommands: [] });
  const options = {
    textures: () => null,
    surfaces: (_id: SurfaceId, rev: number) => {
      seen.push(rev);
      return rev === 3 ? { w: 1, h: 1, rgba: new Uint8Array([255, 0, 0, 255]) } : { w: 1, h: 1, rgba: new Uint8Array([0, 0, 255, 255]) };
    },
  };
  const both = renderer.render(listFor([blit(3, 0), blit(4, 1)]), fullGeometry, options);
  deepEqual(seen, [3, 4]);
  equal(both.drawn, 2);
  deepEqual(uploads().map((args) => args[8]).filter((pixels) => pixels !== null), [
    new Uint8Array([255, 0, 0, 255]), new Uint8Array([0, 0, 255, 255]),
  ]);
  equal(deletedTextureCount(), 0);
  renderer.render(listFor([blit(4, 0)]), fullGeometry, options);
  equal(deletedTextureCount(), 1);
  renderer.render(listFor([blit(3, 0)]), fullGeometry, options);
  equal(deletedTextureCount(), 2);
  equal(seen.join(","), "3,4,4,3");
  renderer.dispose();
});

test("WebGL2 flush forces same-revision surfaces to upload again after restore", () => {
  const { gl, uploads } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const surface = 9 as SurfaceId;
  const one: DrawListV2 = {
    tick: 0, width: 1, height: 1, marginCommands: [],
    commands: [{ kind: "blit", source: { surface, rev: 1 }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: false }],
  };
  let color = 10;
  const options = { textures: () => null, surfaces: () => ({ w: 1, h: 1, rgba: new Uint8Array([color, 0, 0, 255]) }) };
  renderer.render(one, { ...fullGeometry, content: { width: 1, height: 1 }, game: { x: 0, y: 0, width: 1, height: 1 } }, options);
  color = 20;
  renderer.render(one, { ...fullGeometry, content: { width: 1, height: 1 }, game: { x: 0, y: 0, width: 1, height: 1 } }, options);
  equal(uploads().filter((args) => args[8] !== null).length, 1);
  renderer.flush();
  renderer.flush();
  renderer.render(one, { ...fullGeometry, content: { width: 1, height: 1 }, game: { x: 0, y: 0, width: 1, height: 1 } }, options);
  deepEqual(uploads().map((args) => args[8]).filter((pixels) => pixels !== null), [
    new Uint8Array([10, 0, 0, 255]), new Uint8Array([20, 0, 0, 255]),
  ]);
  renderer.dispose();
});

test("WebGL2 restores non-instanced mode before iso replay after a pixel batch", () => {
  const { gl, drawEvents } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const surface = 10 as SurfaceId;
  const list: DrawListV2 = {
    tick: 0, width: 32, height: 32, marginCommands: [],
    commands: [
      { kind: "rect", rect: { x: 0, y: 0, w: 2, h: 2 }, rgb: { r: 1, g: 2, b: 3 }, filled: false },
      { kind: "blit", source: { surface, rev: 1 }, src: { x: 0, y: 0, w: 32, h: 32 }, dst: { x: 0, y: 0, w: 32, h: 32 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: true },
    ],
  };
  const stats = renderer.render(list, { content: { width: 32, height: 32 }, game: { x: 0, y: 0, width: 32, height: 32 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, {
    textures: () => null,
    surfaces: () => ({ w: 32, h: 32, rgba: new Uint8Array(32 * 32 * 4).fill(255) }),
  });
  equal(stats.drawn, 2);
  const events = drawEvents();
  let lastInstanced = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.kind === "instanced") lastInstanced = index;
  }
  equal(lastInstanced >= 0, true);
  equal(events[lastInstanced + 1]?.kind === "arrays" && events[lastInstanced + 1]?.instanced === 0, true);
  renderer.dispose();
});
test("WebGL2 reports unclosed target stacks and defers missing draws individually", () => {
  const { gl } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const missing = "missing.png" as never;
  const blit = { kind: "blit" as const, source: { asset: missing, tile: null }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal" as const, iso2d: false };
  const partial: DrawListV2 = { tick: 0, width: 2, height: 1, commands: [{ kind: "fill", rgb: { r: 1, g: 2, b: 3 } }, blit, blit, { kind: "pushTarget", scratch: 1 as ScratchId }], marginCommands: [] };
  const unresolved = renderer.render(partial, fullGeometry, { textures: () => null });
  equal(unresolved.drawn, 2);
  equal(unresolved.deferred, 3);
  deepEqual(unresolved.deferredByKind, { blit: 2, pushTarget: 1 });
  deepEqual(unresolved.diagnostics, [
    `webgl2.missing-texture: ${missing}`,
    "webgl2.unclosed-push: pushTarget without matching popTarget",
  ]);
  renderer.dispose();
});

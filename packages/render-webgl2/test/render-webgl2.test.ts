import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createWebgl2Renderer } from "../src/index.ts";
import type { DrawListV2, HostDisplayGeometry, SurfaceId } from "@tk-reawakened/core";

function fakeContext(): { readonly gl: WebGL2RenderingContext; readonly uploaded: () => Uint8Array | null } {
  let next = 1;
  let pixels: Uint8Array | null = null;
  const canvas = { width: 0, height: 0 };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    createProgram: () => ({}),
    createShader: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: () => ({}),
    createTexture: () => ({}),
    texImage2D: (...args) => { pixels = args.at(-1) as Uint8Array | null; },
  };
  const constantNames: Record<string, true> = {
    VERTEX_SHADER: true, FRAGMENT_SHADER: true, COMPILE_STATUS: true, LINK_STATUS: true, TEXTURE_2D: true,
    TEXTURE_MIN_FILTER: true, TEXTURE_MAG_FILTER: true, NEAREST: true, TEXTURE_WRAP_S: true, TEXTURE_WRAP_T: true,
    CLAMP_TO_EDGE: true, FRAMEBUFFER: true, BLEND: true, COLOR_BUFFER_BIT: true, UNPACK_ALIGNMENT: true,
    UNPACK_FLIP_Y_WEBGL: true, RGBA8: true, RGBA: true, UNSIGNED_BYTE: true, TEXTURE0: true, TRIANGLES: true,
  };
  const constantValues = new Map<string, number>();
  const gl = new Proxy({} as WebGL2RenderingContext, {
    get: (_target, key: string) => {
      if (key === "canvas") return canvas;
      if (key in methods) return methods[key];
      if (constantNames[key] === true) {
        if (!constantValues.has(key)) constantValues.set(key, next++);
        return constantValues.get(key);
      }
      return () => undefined;
    },
  });
  return { gl, uploaded: () => pixels };
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

test("WebGL2 renderer uploads the exact reference presentation bytes for both planes", () => {
  const { gl, uploaded } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const stats = renderer.render(list, geometry, { textures: () => null });
  equal(stats.deferred, 0);
  equal(renderer.canvas.width, 3);
  equal(renderer.canvas.height, 2);
  deepEqual(uploaded(), new Uint8Array([
    50, 60, 70, 255, 20, 30, 40, 255, 20, 30, 40, 255,
    50, 60, 70, 255, 20, 30, 40, 255, 20, 30, 40, 255,
  ]));
  renderer.dispose();
});
test("WebGL2 requests distinct revisions for repeated surface identities", () => {
  const { gl, uploaded } = fakeContext();
  const renderer = createWebgl2Renderer(gl);
  const surface = 8 as SurfaceId;
  const seen: number[] = [];
  const blit = (rev: number, x: number) => ({
    kind: "blit" as const,
    source: { surface, rev },
    src: { x: 0, y: 0, w: 1, h: 1 },
    dst: { x, y: 0, w: 1, h: 1 },
    key: null,
    tint: { r: 0, g: 0, b: 0 },
    alpha: 255,
    blend: "normal" as const,
    iso2d: false,
  });
  const surfaceList: DrawListV2 = {
    tick: 0,
    width: 2,
    height: 1,
    commands: [blit(3, 0), blit(4, 1)],
    marginCommands: [],
  };
  const surfaceGeometry: HostDisplayGeometry = {
    content: { width: 2, height: 1 },
    game: { x: 0, y: 0, width: 2, height: 1 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  renderer.render(surfaceList, surfaceGeometry, {
    textures: () => null,
    surfaces: (_id, rev) => {
      seen.push(rev);
      return rev === 3
        ? { w: 1, h: 1, rgba: new Uint8Array([255, 0, 0, 255]) }
        : { w: 1, h: 1, rgba: new Uint8Array([0, 0, 255, 255]) };
    },
  });
  deepEqual(seen, [3, 4]);
  deepEqual(uploaded(), new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
  renderer.dispose();
});

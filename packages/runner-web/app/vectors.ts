/**
 * The conformance page: replays the committed raster kit through `render-webgl2` and reports the pixels it produced.
 *
 * Three files make up the kit, and each vector is one logical-pixel scene plus the RGBA the reference rasteriser
 * produced: `vectors.json` (geometry and the pixel pipeline), `text-vectors.json` (a legacy bitmap font) and
 * `truetype-vectors.json` (a TrueType face's rendered text). The page draws each into a canvas of the vector's own size
 * and reads the pixels back, so a lane can apply D-7's bound: exact on key, tint, alpha-0 skipping and row order, at
 * most one unit per channel on blend arithmetic — and it reports the worst channel per vector rather than a boolean.
 *
 * A text vector carries glyph rows rather than a font file, and a TrueType vector carries only the face's name, so the
 * page rebuilds the exact command the reference recorded and first checks that `rasterize` reproduces the committed
 * bytes: a lane that fails there is testing the wrong command, not the renderer.
 */

import {
  rasterizePresentation,
  readTrueTypeFont,
  type AssetKey,
  type DrawList,
  type LegacyFont,
  type RasterAsset,
} from "@tk-reawakened/core";
import { createWebgl2Renderer, type TexturePixels } from "@tk-reawakened/render-webgl2";

type BitmapVector = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly texture?: { readonly asset: string; readonly w: number; readonly h: number; readonly rgba: string };
  readonly commands: readonly unknown[];
  readonly rgba: string;
};

type TextVector = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly font: { readonly asset: string; readonly glyphs: { readonly [code: string]: string } };
  readonly commands: readonly unknown[];
  readonly rgba: string;
};

type TrueTypeVector = {
  readonly id: string;
  readonly font: string;
  readonly size: number;
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
};

type VectorReport = {
  readonly id: string;
  readonly actual: string;
  readonly expected: string;
  /** The largest per-channel difference, and the pixel and channel it happened at. */
  readonly worst: number;
  readonly at: string;
  /** True when the committed kit's own reference reproduction failed, so the comparison is not about the renderer. */
  readonly kitError: string | null;
};

declare global {
  interface Window {
    __vectors?: readonly VectorReport[];
  }
}

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function hexFromBytes(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

/** The largest per-channel difference, with the pixel's coordinates and the channel that carried it. */
function worstChannel(actual: Uint8Array, expected: Uint8Array, width: number): { worst: number; at: string } {
  let worst = 0;
  let at = "none";
  const channels = ["r", "g", "b", "a"];
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0));
    if (difference <= worst) continue;
    const pixel = Math.floor(index / 4);
    worst = difference;
    at = `(${pixel % width},${Math.floor(pixel / width)}).${channels[index % 4]}`;
  }
  return { worst, at };
}

/** Draw one vector through WebGL2 and return its top-first RGBA, plus the reference's own pixels for the same command. */
function replay(
  width: number,
  height: number,
  commands: readonly unknown[],
  textures: ReadonlyMap<AssetKey, TexturePixels>,
  fonts: ReadonlyMap<AssetKey, RasterAsset>,
): { readonly actual: Uint8Array; readonly reference: Uint8Array } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // `alpha: true` keeps a real alpha channel: `alpha: false` forces readPixels alpha to 255 and hides transparency.
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
  if (gl === null) throw new Error("vectors: no WebGL2 context");
  const renderer = createWebgl2Renderer(gl);
  const list: DrawList = { tick: 0, width, height, commands: commands as DrawList["commands"], marginCommands: [] };
  const geometry = {
    content: { width, height },
    game: { x: 0, y: 0, width, height },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const render = renderer.render(list, geometry, {
    textures: (asset) => textures.get(asset) ?? null,
    fonts: (asset) => fonts.get(asset),
  });
  if (render.deferred !== 0) {
    throw new Error(`vectors: ${render.deferred} command(s) deferred: ${render.diagnostics.join(", ")}`);
  }
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  renderer.dispose();
  // `readPixels` returns rows bottom-up and a vector's expected RGBA is top-first, so compare in one order.
  const stride = width * 4;
  const actual = new Uint8Array(pixels.length);
  for (let row = 0; row < height; row += 1) {
    actual.set(pixels.subarray(row * stride, (row + 1) * stride), (height - 1 - row) * stride);
  }
  const assets = new Map<AssetKey, RasterAsset>([...textures, ...fonts] as [AssetKey, RasterAsset][]);
  const reference = rasterizePresentation(list, geometry, assets);
  if (reference.error !== null) throw new Error(`vectors: the reference refused the command: ${reference.error}`);
  return { actual, reference: reference.rgba };
}

function report(id: string, actual: Uint8Array, expected: Uint8Array, width: number, kitError: string | null = null): VectorReport {
  const { worst, at } = worstChannel(actual, expected, width);
  return { id, actual: hexFromBytes(actual), expected: hexFromBytes(expected), worst, at, kitError };
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`vectors: ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Rebuild the legacy font a text vector names from its glyph rows, with every other cell blank. */
function legacyFont(glyphs: { readonly [code: string]: string }): LegacyFont {
  const values = new Uint8Array(2048);
  for (const [code, rows] of Object.entries(glyphs)) {
    values.set(bytesFromHex(rows).subarray(0, 8), Number(code) * 8);
  }
  return { magic: "RPGTLKIT FONT", version: 2, subversion: 0, values };
}

void (async () => {
  const results: VectorReport[] = [];

  const bitmaps = await json<{ vectors: readonly BitmapVector[] }>("/tools/fixtures/conformance/raster/vectors.json");
  for (const vector of bitmaps.vectors) {
    const textures = new Map<AssetKey, TexturePixels>();
    if (vector.texture !== undefined) {
      textures.set(vector.texture.asset as AssetKey, {
        w: vector.texture.w,
        h: vector.texture.h,
        rgba: bytesFromHex(vector.texture.rgba),
      });
    }
    const { actual, reference } = replay(vector.width, vector.height, vector.commands, textures, new Map());
    const kitError = hexFromBytes(reference) === vector.rgba ? null : "the reference did not reproduce the committed pixels";
    results.push(report(vector.id, actual, reference, vector.width, kitError));
  }

  const texts = await json<{ vectors: readonly TextVector[] }>("/tools/fixtures/conformance/raster/text-vectors.json");
  for (const vector of texts.vectors) {
    const fonts = new Map<AssetKey, RasterAsset>([[vector.font.asset as AssetKey, legacyFont(vector.font.glyphs)]]);
    const { actual, reference } = replay(vector.width, vector.height, vector.commands, new Map(), fonts);
    const kitError = hexFromBytes(reference) === vector.rgba ? null : "the reference did not reproduce the committed pixels";
    results.push(report(vector.id, actual, reference, vector.width, kitError));
  }

  const truetype = await json<{ rendered: readonly TrueTypeVector[] }>("/tools/fixtures/conformance/raster/truetype-vectors.json");
  for (const vector of truetype.rendered) {
    const response = await fetch(`/media/fonts/${vector.font}`);
    if (!response.ok) throw new Error(`vectors: ${vector.font} answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parsed = readTrueTypeFont(bytes, vector.font);
    if (!parsed.ok) throw new Error(`vectors: ${vector.font} does not parse`);
    const asset = `media/fonts/${vector.font}` as AssetKey;
    const command = {
      kind: "text",
      x: 0,
      y: 0,
      text: vector.text,
      font: { asset, size: vector.size, bold: false, italic: false },
      rgb: { r: 255, g: 255, b: 255 },
      advances: [],
    };
    const fonts = new Map<AssetKey, RasterAsset>([[asset, parsed.value]]);
    const { actual, reference } = replay(vector.width, vector.height, [command], new Map(), fonts);
    const kitError = hexFromBytes(reference) === vector.rgba ? null : "the reference did not reproduce the committed pixels";
    results.push(report(vector.id, actual, reference, vector.width, kitError));
  }

  window.__vectors = results;
  window.document.title = `vectors: ${results.length} replayed`;
})();

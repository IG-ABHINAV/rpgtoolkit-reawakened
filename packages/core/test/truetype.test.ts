import { deepEqual, equal } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gateTrueType,
  readTrueTypeFont,
  trueTypeFontMetrics,
  resolveFont,
  layoutText,
  emitText,
  rasterize,
  getGlyphRaster,
  type AssetKey,
  type TrueTypeFont,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function loadFont(relPath: string): TrueTypeFont {
  const bytes = new Uint8Array(readFileSync(join(repoRoot, relPath)));
  const res = readTrueTypeFont(bytes, relPath);
  if (!res.ok) throw new Error(`${relPath}: ${res.error.message}`);
  return res.value;
}

function fakeFont(outlineX: number): TrueTypeFont {
  const glyph = { id: 1, advance: 8 };
  return {
    kind: "truetype",
    family: "Cache collision",
    subfamily: "Regular",
    unitsPerEm: 16,
    ascent: 16,
    descent: 0,
    lineGap: 0,
    charToGlyph: () => glyph,
    glyphById: () => glyph,
    getKerning: () => 0,
    getCommands: () => [
      { type: "M", x: outlineX, y: 0 },
      { type: "L", x: outlineX + 8, y: 0 },
      { type: "L", x: outlineX + 8, y: 8 },
      { type: "L", x: outlineX, y: 8 },
      { type: "Z" },
    ],
  };
}

test("glyph raster cache is isolated by font identity", () => {
  const glyph = { id: 1, advance: 8 };
  const first = getGlyphRaster(fakeFont(0), glyph, 16);
  const second = getGlyphRaster(fakeFont(16), glyph, 16);
  equal(first.offsetX, 0);
  equal(second.offsetX, 16);
});


// -------------------------------------------------------------
// 1. Input Gate Rejection Tests
// -------------------------------------------------------------

test("input gate: rejects empty and short buffers", () => {
  const empty = gateTrueType(new Uint8Array(0));
  equal(empty.ok, false);
  if (!empty.ok) {
    equal(empty.error.message.includes("header must be at least 12 bytes"), true);
  }

  const short = gateTrueType(new Uint8Array([0, 1, 0, 0, 0, 1]));
  equal(short.ok, false);
});

test("input gate: rejects unsupported signatures (CFF, WOFF, zero bytes)", () => {
  // 64 zero bytes
  const zeroSig = gateTrueType(new Uint8Array(64));
  equal(zeroSig.ok, false);
  if (!zeroSig.ok) {
    equal(zeroSig.error.message.includes("Unsupported OpenType signature"), true);
  }

  // 'OTTO' (CFF)
  const otto = new Uint8Array(64);
  otto.set([0x4f, 0x54, 0x54, 0x4f]);
  equal(gateTrueType(otto).ok, false);

  // 'wOFF'
  const woff = new Uint8Array(64);
  woff.set([0x77, 0x4f, 0x46, 0x46]);
  equal(gateTrueType(woff).ok, false);
});

test("input gate: rejects CFF outline tables and variable font tables", () => {
  // Synthesise an sfnt header with a 'CFF ' table entry
  const buf = new Uint8Array(12 + 16);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x00010000); // TrueType version
  view.setUint16(4, 1); // 1 table
  // Table tag 'CFF '
  buf[12] = 0x43; buf[13] = 0x46; buf[14] = 0x46; buf[15] = 0x20;
  view.setUint32(20, 0); // offset
  view.setUint32(24, 0); // length
  const cffRes = gateTrueType(buf);
  equal(cffRes.ok, false);
  if (!cffRes.ok) {
    equal(cffRes.error.message.includes("CFF outlines are unsupported"), true);
  }

  // Synthesise an sfnt header with an 'fvar' table entry
  const fvarBuf = new Uint8Array(12 + 16);
  const fvarView = new DataView(fvarBuf.buffer);
  fvarView.setUint32(0, 0x00010000);
  fvarView.setUint16(4, 1);
  fvarBuf[12] = 0x66; fvarBuf[13] = 0x76; fvarBuf[14] = 0x61; fvarBuf[15] = 0x72;
  const fvarRes = gateTrueType(fvarBuf);
  equal(fvarRes.ok, false);
  if (!fvarRes.ok) {
    equal(fvarRes.error.message.includes("Variable OpenType fonts are unsupported"), true);
  }
});

test("input gate: rejects missing required TrueType tables", () => {
  // Has 'head' only, missing 'glyf', 'loca', etc.
  const buf = new Uint8Array(12 + 16);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  buf[12] = 0x68; buf[13] = 0x65; buf[14] = 0x61; buf[15] = 0x64;
  const res = gateTrueType(buf);
  equal(res.ok, false);
  if (!res.ok) {
    equal(res.error.message.includes("Missing required TrueType table"), true);
  }
});

test("input gate: accepts all three bundled Liberation fonts", () => {
  for (const rel of [
    "media/fonts/LiberationSans-Regular.ttf",
    "media/fonts/LiberationSerif-Regular.ttf",
    "media/fonts/LiberationMono-Regular.ttf",
  ]) {
    const bytes = new Uint8Array(readFileSync(join(repoRoot, rel)));
    const res = gateTrueType(bytes, rel);
    equal(res.ok, true, `${rel} should pass the input gate`);
  }
});

// -------------------------------------------------------------
// 2. Wrapper Vetting and Static/Dynamic Audits
// -------------------------------------------------------------

test("static audit: truetype.ts is the only core importer of opentype.js and uses vetted calls only", () => {
  const coreSrc = join(repoRoot, "packages", "core", "src");
  const files = readdirSync(coreSrc, { recursive: true })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(coreSrc, f));

  const importers = files.filter((f) => {
    const code = readFileSync(f, "utf8");
    return code.includes('from "opentype.js"') || code.includes("from 'opentype.js'");
  });
  equal(importers.length, 1);
  equal(importers[0]?.endsWith("truetype.ts"), true);

  // Inspect truetype.ts content for unvetted opentype calls
  const wrapperCode = readFileSync(importers[0]!, "utf8");
  const forbiddenApis = [
    "toPathData",
    "toSVG",
    "draw(",
    "drawPoints",
    "download(",
    "getPaths(",
    "forEachToken",
  ];
  for (const api of forbiddenApis) {
    equal(wrapperCode.includes(api), false, `Wrapper must not call unvetted api: ${api}`);
  }
});

test("dynamic sandbox: font reading and rasterisation touches no forbidden globals or unapproved Math", () => {
  const unallowedMath: string[] = [];
  const mathAllowlist = new Set(["abs", "ceil", "floor", "round", "trunc", "sign", "min", "max", "fround", "imul", "clz32", "sqrt"]);
  const globalTraps: string[] = [];

  const originalMath = Math;
  const mathProxy = new Proxy(originalMath, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !mathAllowlist.has(prop)) {
        unallowedMath.push(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  globalThis.Math = mathProxy;

  const trappedGlobals = [
    "window", "document", "navigator", "fetch", "localStorage",
    "requestAnimationFrame", "XMLHttpRequest", "ImageData", "OffscreenCanvas",
  ];

  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const g of trappedGlobals) {
    descriptors.set(g, Object.getOwnPropertyDescriptor(globalThis, g));
    Object.defineProperty(globalThis, g, {
      configurable: true,
      get() {
        globalTraps.push(g);
        throw new Error(`Trapped forbidden global: ${g}`);
      },
    });
  }

  try {
    const font = loadFont("media/fonts/LiberationMono-Regular.ttf");
    equal(font.family, "Liberation Mono");
    const glyphA = font.charToGlyph("A");
    const glyphV = font.charToGlyph("V");
    const kerning = font.getKerning(glyphA, glyphV);
    equal(typeof kerning, "number");

    const metrics = trueTypeFontMetrics(font, 16);
    equal(metrics.lineHeight > 0, true);

    const ref = { asset: "media/fonts/LiberationMono-Regular.ttf" as AssetKey, size: 16, bold: false, italic: false };
    const cmds = emitText("AV 123", 0, 0, { r: 255, g: 255, b: 255 }, ref, { font });
    const result = rasterize({ tick: 0, width: 64, height: 24, commands: cmds, marginCommands: [] }, new Map([[ref.asset, font]]));
    equal(result.error, null);
  } finally {
    globalThis.Math = originalMath;
    for (const g of trappedGlobals) {
      const desc = descriptors.get(g);
      if (desc !== undefined) Object.defineProperty(globalThis, g, desc);
      else delete (globalThis as Record<string, unknown>)[g];
    }
  }

  deepEqual(globalTraps, []);
  deepEqual(unallowedMath, []);
});

// -------------------------------------------------------------
// 3. Non-Latin Glyph Lookup (Spike §10 requirement)
// -------------------------------------------------------------

test("non-Latin glyph lookup: resolves Cyrillic and Greek characters via cmap", () => {
  const sans = loadFont("media/fonts/LiberationSans-Regular.ttf");
  const cyrillicD = sans.charToGlyph("Д");
  equal(cyrillicD.id > 0, true);
  equal(cyrillicD.advance > 0, true);

  const greekOmega = sans.charToGlyph("Ω");
  equal(greekOmega.id > 0, true);
  equal(greekOmega.advance > 0, true);

  const accentedE = sans.charToGlyph("é");
  equal(accentedE.id > 0, true);
});

// -------------------------------------------------------------
// 4. Metrics, Advances, and Family Substitution
// -------------------------------------------------------------

test("metrics: hhea metrics scale and round correctly per AD-15", () => {
  const mono = loadFont("media/fonts/LiberationMono-Regular.ttf");
  // LiberationMono: unitsPerEm = 2048, ascender = 1705, descender = -615, lineGap = 0
  const m16 = trueTypeFontMetrics(mono, 16);
  // ascentPx = floor(1705 * 16 / 2048 + 0.5) = floor(13.32 + 0.5) = 13
  equal(m16.ascent, 13);
  // descentPx = floor(-(-615) * 16 / 2048 + 0.5) = floor(4.80 + 0.5) = 5
  equal(m16.descent, 5);
  equal(m16.lineGap, 0);
  equal(m16.lineHeight, 18);
});

test("family substitution: Arial, Times New Roman, and Courier New map to bundled Liberation families", () => {
  const emptyFonts = new Map<AssetKey, unknown>();
  const fallback = "media/fonts/tkr-8x8.fnt" as AssetKey;

  const arial = resolveFont("Arial", emptyFonts, fallback);
  equal(arial.asset, "media/fonts/LiberationSans-Regular.ttf");

  const sans = resolveFont("sans-serif", emptyFonts, fallback);
  equal(sans.asset, "media/fonts/LiberationSans-Regular.ttf");

  const times = resolveFont("Times New Roman", emptyFonts, fallback);
  equal(times.asset, "media/fonts/LiberationSerif-Regular.ttf");

  const serif = resolveFont("serif", emptyFonts, fallback);
  equal(serif.asset, "media/fonts/LiberationSerif-Regular.ttf");

  const courier = resolveFont("Courier New", emptyFonts, fallback);
  equal(courier.asset, "media/fonts/LiberationMono-Regular.ttf");

  const mono = resolveFont("monospace", emptyFonts, fallback);
  equal(mono.asset, "media/fonts/LiberationMono-Regular.ttf");
});

// -------------------------------------------------------------
// 5. Layout and Nonzero-Winding Rasterisation Tests
// -------------------------------------------------------------

test("layoutText: wraps TrueType text and preserves explicit newlines", () => {
  const mono = loadFont("media/fonts/LiberationMono-Regular.ttf");
  const ref = { asset: "media/fonts/LiberationMono-Regular.ttf" as AssetKey, size: 16, bold: false, italic: false };

  // Advance of each mono char at size 16 is 10px
  const layout = layoutText("AB CD EF", ref, { font: mono, maxWidth: 55 });
  // "AB CD" is 50px (5 chars * 10), fits in 55. "EF" wraps to line 2.
  equal(layout.lines.length, 2);
  equal(layout.lines[0]?.text, "AB CD");
  equal(layout.lines[1]?.text, "EF");
});

test("rasterisation: nonzero winding hollows out interior holes (e.g. letter O)", () => {
  const mono = loadFont("media/fonts/LiberationMono-Regular.ttf");
  const ref = { asset: "media/fonts/LiberationMono-Regular.ttf" as AssetKey, size: 24, bold: false, italic: false };
  const commands = emitText("O", 0, 0, { r: 255, g: 255, b: 255 }, ref, { font: mono });

  const result = rasterize({ tick: 0, width: 20, height: 28, commands, marginCommands: [] }, new Map([[ref.asset, mono]]));
  equal(result.error, null);

  // In the center of the 'O', pixel should be transparent (0 alpha)
  // Glyph center is roughly around x=7, y=14
  const centerAlpha = result.rgba[(12 * 20 + 7) * 4 + 3];
  equal(centerAlpha, 0, "Center of letter O must be hollow due to nonzero winding cancellation");

  // Top edge of outer ring should be filled (around x=7, y=5)
  const edgeAlpha = result.rgba[(5 * 20 + 7) * 4 + 3];
  equal((edgeAlpha ?? 0) > 0, true, "Outer ring of letter O must be filled");
});

test("rasterisation: anti-aliasing blends correctly onto colored background", () => {
  const mono = loadFont("media/fonts/LiberationMono-Regular.ttf");
  const ref = { asset: "media/fonts/LiberationMono-Regular.ttf" as AssetKey, size: 16, bold: false, italic: false };
  const commands = [
    { kind: "fill" as const, rgb: { r: 100, g: 0, b: 0 } },
    ...emitText("A", 2, 2, { r: 0, g: 200, b: 0 }, ref, { font: mono }),
  ];

  const result = rasterize({ tick: 0, width: 16, height: 24, commands, marginCommands: [] }, new Map([[ref.asset, mono]]));
  equal(result.error, null);

  // Every pixel must remain valid straight RGBA with alpha 255 because of the background fill
  for (let i = 0; i < 16 * 24; i += 1) {
    equal(result.rgba[i * 4 + 3], 255);
  }
});

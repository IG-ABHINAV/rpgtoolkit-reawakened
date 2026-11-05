import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetKey, emitCellText, emitText, layoutText, rasterize, readLegacyFont, resolveFont } from "../src/index.ts";
import type { LegacyFont } from "../src/formats/font/model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const key = assetKey("media/fonts/tkr-8x8.fnt");
const fallback = assetKey("media/fonts/fallback.fnt");
function projectFont(): LegacyFont {
  const parsed = readLegacyFont(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function testFont(): LegacyFont {
  const values = new Uint8Array(256 * 8);
  // Authored fixture glyph A: a vertical stroke and a top bar.
  values[65 * 8] = 0xf8;
  for (let row = 1; row < 8; row += 1) values[65 * 8 + row] = 0x80;
  values[66 * 8] = 0x00;
  return { magic: "RPGTLKIT FONT", version: 2, subversion: 0, values };
}

test("bitmap text layout is stable across sizes and wraps at words", () => {
  const fonts = new Map([[key, projectFont()]]);
  const ref8 = resolveFont("Tkr-8x8", fonts, fallback, 8);
  const ref16 = { ...ref8, size: 16 };
  const ref24 = { ...ref8, size: 24, bold: true };
  deepEqual(layoutText("AB CD", ref8, { maxWidth: 24 }).lines.map((line) => [line.text, line.width, line.y]), [["AB", 16, 0], ["CD", 16, 16]]);
  equal(layoutText("AB", ref16).width, 32);
  equal(layoutText("AB", ref24).width, 50);
  equal(layoutText("A\nB", ref8).height, 32);
  equal(resolveFont("TKR-8X8", fonts, fallback).asset, key);
});

test("text emission uses FontRef metrics and 1-based square cells one font size wide", () => {
  const ref = { asset: key, size: 8, bold: false, italic: false } as const;
  // Cell (1, 1) is the top-left cell; a fractional coordinate keeps its fraction and
  // only the scaled pixel origin is truncated toward zero.
  deepEqual(emitCellText("A", 1, 1, { r: 7, g: 8, b: 9 }, ref), [{
    kind: "text", x: 0, y: 0, text: "A", font: ref, rgb: { r: 7, g: 8, b: 9 },
    advances: [{ glyph: 65, advance: 8 }],
  }]);
  const fractional = emitCellText("A", 2.9, -0.5, { r: 7, g: 8, b: 9 }, ref);
  equal(fractional[0]?.kind === "text" ? fractional[0].x : null, 15, "trunc((2.9 − 1) × 8) = 15");
  equal(fractional[0]?.kind === "text" ? fractional[0].y : null, -12, "trunc((−0.5 − 1) × 8) = −12");
  // The cell follows the current font size, not a fixed 8x16 size.
  const ref16 = { ...ref, size: 16 } as const;
  const large = emitCellText("A", 2, 3, { r: 1, g: 2, b: 3 }, ref16);
  equal(large[0]?.kind === "text" ? large[0].x : null, 16);
  equal(large[0]?.kind === "text" ? large[0].y : null, 32);
  // A newline advances one cell row, a font size in pixels.
  const rows = emitCellText("A\nB", 1, 1, { r: 1, g: 2, b: 3 }, ref).map((command) => (command.kind === "text" ? command.y : null));
  deepEqual(rows, [0, 8]);
  deepEqual(emitText("A", 0, 0, { r: 1, g: 2, b: 3 }, ref, { underline: true }).map((command) => command.kind), ["text", "line"]);
});

test("a cell origin is scaled first and floored as a pixel, not truncated as a cell", () => {
  const ref18 = { asset: key, size: 18, bold: false, italic: false } as const;
  // The two 3.1 sample games author the title menu at y = 10.5 with fontSize(18):
  // truncating the cell first would give 162; scaling first gives 171.
  const menu = emitCellText("New Game", 17, 10.5, { r: 1, g: 2, b: 3 }, ref18);
  equal(menu[0]?.kind === "text" ? menu[0].x : null, 288);
  equal(menu[0]?.kind === "text" ? menu[0].y : null, 171);
  // A scaled value that is still fractional is truncated toward zero afterwards.
  const ref7 = { ...ref18, size: 7 } as const;
  const scaled = emitCellText("A", 1.5, 0.5, { r: 1, g: 2, b: 3 }, ref7);
  equal(scaled[0]?.kind === "text" ? scaled[0].x : null, 3, "trunc((1.5 − 1) × 7) = 3");
  equal(scaled[0]?.kind === "text" ? scaled[0].y : null, -3, "trunc((0.5 − 1) × 7) = −3 toward zero");
});

test("bitmap text replay is a deterministic pixel vector", () => {
  const ref = { asset: key, size: 8, bold: false, italic: false } as const;
  const result = rasterize({
    tick: 0,
    width: 12,
    height: 16,
    marginCommands: [],
    commands: emitText("A", 1, 2, { r: 10, g: 20, b: 30 }, ref),
  }, new Map([[key, testFont()]]));
  equal(result.error, null);
  const pixel = (x: number, y: number): number[] => Array.from(result.rgba.slice((y * 12 + x) * 4, (y * 12 + x + 1) * 4));
  deepEqual(pixel(1, 2), [10, 20, 30, 255]);
  deepEqual(pixel(2, 2), [10, 20, 30, 255]);
  deepEqual(pixel(1, 3), [10, 20, 30, 255]);
  deepEqual(pixel(0, 2), [0, 0, 0, 0]);
  deepEqual(pixel(1, 9), [10, 20, 30, 255]);
});

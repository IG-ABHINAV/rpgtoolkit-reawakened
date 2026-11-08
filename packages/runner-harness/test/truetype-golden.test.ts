import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitText, layoutText, rasterize, readTrueTypeFont, type AssetKey } from "@tk-reawakened/core";
import { comparePngPixels, encodeRgbaPng } from "../src/png.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PANGRAM = "The quick brown fox jumps over the lazy dog! 0123456789";

export function truetypePangramPng(): Uint8Array {
  const fontPath = join(repoRoot, "media", "fonts", "LiberationMono-Regular.ttf");
  const fontResult = readTrueTypeFont(new Uint8Array(readFileSync(fontPath)));
  if (!fontResult.ok) throw new Error(fontResult.error.message);
  const font = fontResult.value;

  const fontAsset = "media/fonts/LiberationMono-Regular.ttf" as AssetKey;
  const ref = {
    asset: fontAsset,
    size: 16,
    bold: false,
    italic: false,
  };

  const layout = layoutText(PANGRAM, ref, { font });
  const width = layout.width + 8;
  const height = layout.height + 8;
  const commands = emitText(PANGRAM, 4, 4, { r: 255, g: 255, b: 255 }, ref, { font });
  const assets = new Map([[fontAsset, font]]);

  const result = rasterize({ tick: 0, width, height, commands, marginCommands: [] }, assets);
  if (result.error !== null) throw new Error(`Rasterize failed: ${result.error}`);
  return encodeRgbaPng({ w: width, h: height, rgba: result.rgba });
}

test("bundled TrueType font pangram golden is stable through layout, raster and PNG path", () => {
  const actual = truetypePangramPng();
  const expected = readFileSync(join(repoRoot, "golden", "regression", "liberation-mono-pangram.png"));
  const comparison = comparePngPixels(actual, new Uint8Array(expected));
  equal(comparison.error, null);
  equal(comparison.equal, true, comparison.firstDifference ? JSON.stringify(comparison.firstDifference) : "");
  deepEqual(truetypePangramPng(), actual);
});

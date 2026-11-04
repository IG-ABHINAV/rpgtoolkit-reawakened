/**
 * Deterministic bitmap-font layout and draw-list emission (AD-15,
 * docs/spec/engine/display-input-audio.md#reawakened-fontref-and-metrics).
 *
 * The service only consumes decoded font data supplied by a runner. It never
 * reads Font\\ or a system font, so the same input produces the same layout on
 * every host.
 */

import type { LegacyFont } from "../formats/font/model.ts";
import { FONT_GLYPH_HEIGHT, FONT_GLYPH_WIDTH } from "../formats/font/model.ts";
import { readTrueTypeFont, trueTypeFontMetrics, type TrueTypeFont } from "../formats/font/truetype.ts";
import type { AssetKey, Rgb, DrawCommand, FontRef, GlyphAdvance } from "../ports/index.ts";

export type FontMap = ReadonlyMap<AssetKey, LegacyFont | TrueTypeFont | Uint8Array>;

export interface TextLayoutOptions {
  readonly maxWidth?: number;
  readonly lineHeight?: number;
  readonly font?: TrueTypeFont | LegacyFont;
  readonly fonts?: FontMap;
}

export interface TextLine {
  readonly text: string;
  readonly width: number;
  readonly y: number;
  readonly glyphs: readonly GlyphAdvance[];
}

export interface TextLayout {
  readonly lines: readonly TextLine[];
  readonly width: number;
  readonly height: number;
  readonly lineHeight: number;
}

export interface EmitTextOptions extends TextLayoutOptions {
  readonly underline?: boolean;
}

const DEFAULT_FONT_SIZE = 8;
const DEFAULT_LINE_HEIGHT = 16;

function roundedSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_FONT_SIZE;
  return Math.max(1, Math.floor(size + 0.5));
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

function glyphCode(character: string): number {
  const point = character.codePointAt(0) ?? 0xfffd;
  return point <= 0xff ? point : 0xff;
}

function advanceFor(ref: FontRef): number {
  const size = roundedSize(ref.size);
  return size + (ref.bold ? 1 : 0);
}

function makeGlyphs(text: string, ref: FontRef): GlyphAdvance[] {
  const advance = advanceFor(ref);
  return codePoints(text).map((character) => ({ glyph: glyphCode(character), advance }));
}

function makeTrueTypeGlyphs(text: string, ref: FontRef, font: TrueTypeFont): GlyphAdvance[] {
  const size = roundedSize(ref.size);
  const chars = codePoints(text);
  const glyphs: GlyphAdvance[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    const nextCh = chars[i + 1];
    const g = font.charToGlyph(ch);
    const advancePx = Math.floor(g.advance * size / font.unitsPerEm + 0.5) + (ref.bold ? 1 : 0);
    const kerning = nextCh !== undefined ? font.getKerning(g, font.charToGlyph(nextCh)) : 0;
    const kerningPx = Math.floor(kerning * size / font.unitsPerEm + 0.5);
    glyphs.push({ glyph: g.id, advance: Math.max(0, advancePx + kerningPx) });
  }
  return glyphs;
}

function widthOf(glyphs: readonly GlyphAdvance[]): number {
  return glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
}

/**
 * Resolve a `font(name)` argument against the assets the project actually ships
 * (docs/spec/engine/rpgcode-functions.md#reawakened-rule-owner-fontref-facing-font-semantics):
 * an exact path, then a case-insensitive family match, then the documented
 * Liberation substitution, and `null` when nothing resolves so the caller can
 * fall back.
 */
export function resolveFontAsset(name: string, keys: Iterable<AssetKey>): AssetKey | null {
  const folded = name.trim().toLowerCase();
  if (folded === "") return null;
  const familyOf = (key: AssetKey): string => {
    const path = String(key).toLowerCase();
    return path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "").replace(/[-_\s]/g, "");
  };
  const wanted = folded.replace(/[-_\s]/g, "");
  const all = [...keys];
  const exact = all.find((key) => String(key).toLowerCase() === folded || String(key).toLowerCase().endsWith(`/${folded}`));
  if (exact !== undefined) return exact;
  const byFamily = all.find((key) => familyOf(key) === wanted);
  if (byFamily !== undefined) return byFamily;
  const substitute = folded === "arial" || folded === "sans-serif" || folded === "liberation sans"
    ? "liberationsans"
    : folded === "times new roman" || folded === "serif" || folded === "liberation serif"
      ? "liberationserif"
      : folded === "courier new" || folded === "monospace" || folded === "liberation mono"
        ? "liberationmono"
        : "";
  if (substitute === "") return null;
  return all.find((key) => familyOf(key).startsWith(substitute)) ?? null;
}

/** Resolve a named project font, applying the documented family aliases. */
export function resolveFont(
  name: string,
  fonts: ReadonlyMap<AssetKey, unknown>,
  fallback: AssetKey,
  size = DEFAULT_FONT_SIZE,
  bold = false,
  italic = false,
): FontRef {
  const folded = name.trim().toLowerCase();
  let chosen: AssetKey | undefined;
  for (const asset of fonts.keys()) {
    const path = String(asset).toLowerCase();
    const family = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    if (family === folded || path === folded || path.endsWith(`/${folded}`) || path.endsWith(`/${folded}.fnt`) || path.endsWith(`/${folded}.ttf`)) {
      chosen = asset;
      break;
    }
  }
  if (chosen === undefined) {
    const isSans = folded === "arial" || folded === "sans-serif" || folded === "liberation sans" || folded === "liberationsans";
    const isSerif = folded === "times new roman" || folded === "serif" || folded === "liberation serif" || folded === "liberationserif";
    const isMono = folded === "courier new" || folded === "monospace" || folded === "liberation mono" || folded === "liberationmono";

    const family = isSans ? "liberationsans"
      : isSerif ? "liberationserif"
      : isMono ? "liberationmono"
      : "";

    if (family !== "") {
      for (const asset of fonts.keys()) {
        const path = String(asset).toLowerCase().replace(/[-_]/g, "");
        if (path.includes(family)) {
          chosen = asset;
          break;
        }
      }
      if (chosen === undefined) {
        if (isSans) chosen = "media/fonts/LiberationSans-Regular.ttf" as AssetKey;
        else if (isSerif) chosen = "media/fonts/LiberationSerif-Regular.ttf" as AssetKey;
        else if (isMono) chosen = "media/fonts/LiberationMono-Regular.ttf" as AssetKey;
      }
    }
  }
  return { asset: chosen ?? fallback, size: roundedSize(size), bold, italic };
}

/** Return deterministic metrics for a bitmap font. */
export function bitmapFontMetrics(ref: FontRef): { readonly advance: number; readonly ascent: number; readonly descent: number; readonly lineGap: number; readonly lineHeight: number } {
  const size = roundedSize(ref.size);
  return {
    advance: advanceFor(ref),
    ascent: size,
    descent: 0,
    lineGap: 0,
    lineHeight: Math.max(DEFAULT_LINE_HEIGHT, size),
  };
}

/** Lay out text, preserving explicit newlines and wrapping only at words. */
export function layoutText(text: string, ref: FontRef, options: TextLayoutOptions = {}): TextLayout {
  let font: TrueTypeFont | null = null;
  if (options.font && "kind" in options.font && options.font.kind === "truetype") {
    font = options.font;
  } else if (options.fonts) {
    const candidate = options.fonts.get(ref.asset);
    if (candidate && typeof candidate === "object" && "kind" in candidate && candidate.kind === "truetype") {
      font = candidate;
    } else if (candidate instanceof Uint8Array) {
      const parsed = readTrueTypeFont(candidate);
      if (parsed.ok) font = parsed.value;
    }
  }

  const metrics = font !== null ? trueTypeFontMetrics(font, ref.size) : bitmapFontMetrics(ref);
  const lineHeight = options.lineHeight === undefined ? metrics.lineHeight : Math.max(1, Math.floor(options.lineHeight));
  const maxWidth = options.maxWidth === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.maxWidth));
  const getGlyphsFor = (str: string): GlyphAdvance[] =>
    font !== null ? makeTrueTypeGlyphs(str, ref, font) : makeGlyphs(str, ref);

  const lines: TextLine[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let current = "";
    let glyphs: GlyphAdvance[] = [];
    const flush = (): void => {
      lines.push({ text: current, width: widthOf(glyphs), y: lines.length * lineHeight, glyphs });
      current = "";
      glyphs = [];
    };
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      const candidateGlyphs = getGlyphsFor(candidate);
      if (current !== "" && widthOf(candidateGlyphs) > maxWidth) flush();
      if (current === "" && word !== "" && widthOf(getGlyphsFor(word)) > maxWidth) {
        for (const character of codePoints(word)) {
          const one = getGlyphsFor(character);
          if (current !== "" && widthOf(glyphs) + one[0]!.advance > maxWidth) flush();
          current += character;
          glyphs.push(one[0]!);
        }
      } else {
        current = current === "" ? word : `${current} ${word}`;
        glyphs = getGlyphsFor(current);
      }
    }
    flush();
  }
  if (lines.length === 0) lines.push({ text: "", width: 0, y: 0, glyphs: [] });
  const width = lines.reduce((max, line) => Math.max(max, line.width), 0);
  return { lines, width, height: lines.length * lineHeight, lineHeight };
}

/** Return the laid-out width in logical pixels. */
export function getTextWidth(text: string, ref: FontRef, options: TextLayoutOptions = {}): number {
  return layoutText(text, ref, options).width;
}

/** Return the laid-out height in logical pixels. */
export function getTextHeight(text: string, ref: FontRef, options: TextLayoutOptions = {}): number {
  return layoutText(text, ref, options).height;
}

/** Emit text and optional underline commands using the same layout metrics. */
export function emitText(
  text: string,
  x: number,
  y: number,
  rgb: Rgb,
  ref: FontRef,
  options: EmitTextOptions = {},
): DrawCommand[] {
  const layout = layoutText(text, ref, options);
  const commands: DrawCommand[] = [];
  for (const line of layout.lines) {
    commands.push({ kind: "text", x, y: y + line.y, text: line.text, font: ref, rgb, advances: [...line.glyphs] });
    if (options.underline === true && line.width > 0) {
      commands.push({ kind: "line", x1: x, y1: y + line.y + layout.lineHeight - 1, x2: x + line.width - 1, y2: y + line.y + layout.lineHeight - 1, rgb });
    }
  }
  return commands;
}

/**
 * Emit `text(x, y, ...)` cell coordinates (docs/spec/engine/rpgcode-functions.md#reawakened-text-cell-size).
 *
 * A cell is square and one font size on a side, and the first cell is (1, 1).
 * A cell coordinate keeps its fraction; it maps to `(c - 1) * size` pixels and
 * only that pixel origin is truncated toward zero. A newline advances one cell
 * row (`size` pixels) unless the caller supplies its own line height.
 */
export function emitCellText(
  text: string,
  cellX: number,
  cellY: number,
  rgb: Rgb,
  ref: FontRef,
  options: EmitTextOptions = {},
): DrawCommand[] {
  const side = roundedSize(ref.size);
  const x = Math.trunc((cellX - 1) * side);
  const y = Math.trunc((cellY - 1) * side);
  return emitText(text, x, y, rgb, ref, { ...options, lineHeight: options.lineHeight ?? side });
}

export { FONT_GLYPH_HEIGHT, FONT_GLYPH_WIDTH };

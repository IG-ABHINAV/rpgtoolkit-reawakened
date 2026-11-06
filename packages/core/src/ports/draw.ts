/**
 * The draw list: a flat, ordered, plain-data replay of one frame (AD-3, AD-11).
 *
 * A `DrawList` is rebuilt every frame with no deltas and is a pure function of
 * current state, so it hashes: `canon`/`hashDrawList` cover the commands and
 * the surface `rev` numbers they reference, never pixel bytes. Renderers only
 * replay it top to bottom and hold no game state (G4).
 *
 * Coordinates are integers in logical-resolution pixels. Rectangles are
 * `x, y, w, h`, half-open. Lines are 1 px with inclusive endpoints. Ellipses
 * are given by their bounding box.
 *
 * These are `type` aliases, not `interface`s: an interface does not get an
 * implicit index signature, so it could not satisfy `PlainData`.
 * `DrawList.commands` and `GlyphAdvance` arrays are mutable arrays because
 * `DrawList` must be assignable to `PlainData` (whose arrays are mutable),
 * while `TickReport` arrays are readonly.
 */

import type { AssetKey, ScratchId, SurfaceId } from "./keys.ts";

/** An opaque colour: 8-bit channels, 0–255 (AD-3). */
export type Rgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/**
 * A signed per-channel colour offset. `blit` carries the full pre-summed
 * shade, board and global ambient offset, so a channel reaches ±1020
 * (docs/spec/formats/board.md#vector-layout-minor-4-and-later; AD-3).
 */
export type Tint = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/** An integer rectangle `x, y, w, h`, half-open (AD-3). */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** A `blit` blend mode (AD-3). */
export type Blend = "normal" | "additive" | "translucent";

/**
 * A texture: a canonical asset key plus a 1-based tile index, or `null` when
 * there is no tile (AD-3).
 */
export type TexRef = {
  readonly asset: AssetKey;
  readonly tile: number | null;
};

/**
 * A persistent surface at a revision. `rev` increments on every mutation, so
 * a runner can key its texture cache on it and refill with
 * `engine.surfacePixels(id, rev)` (AD-27).
 */
export type SurfaceRef = {
  readonly surface: SurfaceId;
  readonly rev: number;
};

/** What a `blit` reads from: a texture or a persistent surface (AD-3, AD-27). */
export type BlitSource = TexRef | SurfaceRef;

/** A font a `text` command draws with (AD-15). */
export type FontRef = {
  readonly asset: AssetKey;
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
};

/** One laid-out glyph: the glyph id and its advance in logical pixels (AD-15). */
export type GlyphAdvance = {
  readonly glyph: number;
  readonly advance: number;
};

/**
 * Copy `src` of `source` to `dst`, nearest-neighbour sampled. `key` is the
 * colour key skipped on the sampled pixels before they are tinted (`null` for
 * none) — for a composed picture those pixels already include their authored
 * cell shade; `alpha` is 0–255; `tint` is the pre-summed world shading and
 * ambient offset; `iso2d` is the 2D-on-iso projection flag (AD-3,
 * docs/spec/engine/runners.md#blit-pipeline).
 */
export type BlitCommand = {
  readonly kind: "blit";
  readonly source: BlitSource;
  readonly src: Rect;
  readonly dst: Rect;
  readonly key: Rgb | null;
  readonly tint: Tint;
  readonly alpha: number;
  readonly blend: Blend;
  readonly iso2d: boolean;
};

/** Fill the current target with `rgb` (AD-3). */
export type FillCommand = {
  readonly kind: "fill";
  readonly rgb: Rgb;
};

/** A 1 px line from `x1, y1` to `x2, y2`, inclusive (AD-3). */
export type LineCommand = {
  readonly kind: "line";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly rgb: Rgb;
};

/** A rectangle, filled or outlined (AD-3). */
export type RectCommand = {
  readonly kind: "rect";
  readonly rect: Rect;
  readonly rgb: Rgb;
  readonly filled: boolean;
};

/** An ellipse given by its bounding box, filled or outlined (AD-3). */
export type EllipseCommand = {
  readonly kind: "ellipse";
  readonly rect: Rect;
  readonly rgb: Rgb;
  readonly filled: boolean;
};

/**
 * Text at `x, y` in `rgb`, laid out by the core: the command carries the font
 * and the per-glyph advances so runners draw from the same glyph data
 * (AD-3, AD-15).
 */
export type TextCommand = {
  readonly kind: "text";
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly font: FontRef;
  readonly rgb: Rgb;
  readonly advances: GlyphAdvance[];
};

/** Redirect subsequent commands to a frame-scoped scratch target (AD-27). */
export type PushTargetCommand = {
  readonly kind: "pushTarget";
  readonly scratch: ScratchId;
};

/** Restore the previous target (AD-27). */
export type PopTargetCommand = {
  readonly kind: "popTarget";
};

/** The one published draw command union (AD-3). */
export type DrawCommand =
  | BlitCommand
  | FillCommand
  | LineCommand
  | RectCommand
  | EllipseCommand
  | TextCommand
  | PushTargetCommand
  | PopTargetCommand;

/** Strict protocol-v1 frame, retained for its immutable schema and vectors. */
export type DrawListV1 = {
  readonly tick: number;
  readonly width: number;
  readonly height: number;
  readonly commands: DrawCommand[];
};

/** Strict protocol-v2 frame with a separate author-owned Plane 3 command layer. */
export type DrawListV2 = {
  readonly tick: number;
  readonly width: number;
  readonly height: number;
  readonly commands: DrawCommand[];
  readonly marginCommands: DrawCommand[];
};

/** Current runner/core draw-list contract: strict v2. */
export type DrawList = DrawListV2;

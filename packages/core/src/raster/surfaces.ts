/**
 * Core-owned persistent RGBA surfaces (AD-27).
 *
 * Surface pixels live in save state as a tagged base64 snapshot rather than a
 * `Uint8Array`, so snapshots remain canonical JSON. Decoded bytes are held
 * outside the state and discarded whenever their snapshot no longer matches.
 */

import type { DecodedTexture } from "../formats/image/model.ts";
import type { SurfacePixels } from "../ports/engine.ts";
import type { Rgb } from "../ports/draw.ts";
import type { SurfaceId } from "../ports/keys.ts";
import type { SurfacesSection, SurfaceState, RgbaSnapshot } from "../save/sections/surfaces.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i += 1) BASE64_VALUES[BASE64.charCodeAt(i)] = i;

type DecodedRecord = { rev: number; bitmap: RgbaSnapshot; b64: string; w: number; h: number; rgba: Uint8Array; canonical: boolean };
/**
 * Which pixels a batched surface may have written since its snapshot was last
 * materialised: `null` none, `"full"` anywhere (unknown), or one inclusive span of
 * pixel indices. `"full"` always wins a merge, so an unbounded edit can never be
 * narrowed by a later bounded one.
 */
type Dirty = PixelBounds | "full" | null;
/**
 * A surface edited inside a batch. `rgba` is the live working buffer; `baseline` holds the
 * pixels that `bitmap` (the entry's snapshot) encodes, so a flush re-encodes only the dirty span.
 */
type BatchEntry = { entry: SurfaceState; bitmap: RgbaSnapshot; b64: string; rev: number; w: number; h: number; rgba: Uint8Array; baseline: Uint8Array; canonical: boolean; dirty: Dirty };
type SurfaceBatch = { depth: number; entries: Map<SurfaceState, BatchEntry> };
const decodedRecords = new WeakMap<SurfaceState, DecodedRecord>();
const pendingEntries = new WeakMap<SurfaceState, BatchEntry>();
const batches = new WeakMap<SurfacesSection, SurfaceBatch>();
const BASE64_PAIRS = Array.from({ length: 4096 }, (_, i) => BASE64[i >> 6]! + BASE64[i & 63]!);

/** A decoded-pixel cache owned by a runner/core facade, never by save state. */
export type SurfacePixelCache = Map<string, Uint8Array>;


function idOf(value: number): SurfaceId {
  return value as SurfaceId;
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function byteCount(width: number, height: number): number {
  return width * height * 4;
}


/** Encode bytes without relying on host `btoa`/`Buffer` APIs (G2). */
export function encodeSurfaceBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let output = "";
  let i = 0;
  const limit = bytes.length - (bytes.length % 3);
  for (; i < limit; i += 3) {
    const bits = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    output += BASE64_PAIRS[bits >>> 12]! + BASE64_PAIRS[bits & 4095]!;
    if (output.length >= 8192) {
      chunks.push(output);
      output = "";
    }
  }
  if (i < bytes.length) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    output += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    output += b === undefined ? "==" : BASE64[(b & 15) << 2]! + "=";
  }
  chunks.push(output);
  return chunks.join("");
}

function encodedSurfaceByteLength(value: string): number {
  if (value.length % 4 !== 0) throw new TypeError("invalid surface base64 length");
  let padding = 0;
  if (value.endsWith("=")) padding += 1;
  if (value.endsWith("==")) padding += 1;
  return (value.length / 4) * 3 - padding;
}

function validateSurfaceBase64(value: string, output: Uint8Array | null): void {
  let at = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = value.charCodeAt(i);
    const b = value.charCodeAt(i + 1);
    const c = value.charCodeAt(i + 2);
    const d = value.charCodeAt(i + 3);
    const ai = BASE64_VALUES[a] ?? -1;
    const bi = BASE64_VALUES[b] ?? -1;
    const ci = c === 61 ? 0 : BASE64_VALUES[c] ?? -1;
    const di = d === 61 ? 0 : BASE64_VALUES[d] ?? -1;
    if (ai < 0 || bi < 0 || ci < 0 || di < 0 || (c === 61 && d !== 61) || (i + 4 < value.length && (c === 61 || d === 61))) {
      throw new TypeError("invalid surface base64 payload");
    }
    if (output === null) continue;
    const first = (ai << 2) | (bi >> 4);
    if (at < output.length) output[at++] = first;
    if (c !== 61) {
      const second = ((bi & 15) << 4) | (ci >> 2);
      if (at < output.length) output[at++] = second;
    }
    if (d !== 61) {
      const third = ((ci & 3) << 6) | di;
      if (at < output.length) output[at++] = third;
    }
  }
}

/** Decode a canonical base64 surface payload, rejecting malformed input. */
export function decodeSurfaceBytes(value: string): Uint8Array {
  const output = new Uint8Array(encodedSurfaceByteLength(value));
  validateSurfaceBase64(value, output);
  return output;
}

/** Validate a base64 surface payload without allocating the decoded pixel buffer. */
export function surfaceByteLength(value: string): number {
  const byteLength = encodedSurfaceByteLength(value);
  validateSurfaceBase64(value, null);
  return byteLength;
}

function snapshot(width: number, height: number, rgba: Uint8Array): RgbaSnapshot {
  return { t: "rgba", w: width, h: height, b64: encodeSurfaceBytes(rgba) };
}

/**
 * A span of pixel indices `[first, last]` in row-major order; `first > last` is the empty span.
 * Bounds are an optimisation hint for re-encoding: a span must never be narrower than what the
 * paired draw routine can write, and an unknown extent is reported as the whole surface.
 */
export type PixelBounds = { first: number; last: number };

function emptyBounds(): PixelBounds {
  return { first: 0, last: -1 };
}

function fullBounds(width: number, height: number): PixelBounds {
  return { first: 0, last: width * height - 1 };
}

/**
 * Clip the inclusive integer rectangle `[left, right] × [top, bottom]` to a `width × height`
 * surface. Infinite edges clip exactly as the draw routines clip them; an edge that is NaN
 * means the extent is unknown, so the whole surface is returned (fail open).
 */
function clipSpan(width: number, height: number, left: number, right: number, top: number, bottom: number): PixelBounds {
  if (!(width > 0 && height > 0)) return emptyBounds();
  if (Number.isNaN(left) || Number.isNaN(right) || Number.isNaN(top) || Number.isNaN(bottom)) return fullBounds(width, height);
  const minX = Math.max(0, left);
  const maxX = Math.min(width - 1, right);
  const minY = Math.max(0, top);
  const maxY = Math.min(height - 1, bottom);
  if (minX > maxX || minY > maxY) return emptyBounds();
  return { first: minY * width + minX, last: maxY * width + maxX };
}

/** The pixel `setpixel` can write: none for a NaN or out-of-range coordinate. */
export function pixelBounds(width: number, height: number, x: number, y: number): PixelBounds {
  const px = Math.trunc(x);
  const py = Math.trunc(y);
  if (!(width > 0 && height > 0 && px >= 0 && py >= 0 && px < width && py < height)) return emptyBounds();
  const index = py * width + px;
  return { first: index, last: index };
}

/** The pixels `drawSurfaceRect` can write: inclusive corners in any order, truncated, infinities clipped. NaN draws nothing. */
export function rectBounds(width: number, height: number, x1: number, y1: number, x2: number, y2: number): PixelBounds {
  const left = Math.min(Math.trunc(x1), Math.trunc(x2));
  const right = Math.max(Math.trunc(x1), Math.trunc(x2));
  const top = Math.min(Math.trunc(y1), Math.trunc(y2));
  const bottom = Math.max(Math.trunc(y1), Math.trunc(y2));
  if (Number.isNaN(left) || Number.isNaN(top)) return emptyBounds();
  return clipSpan(width, height, left, right, top, bottom);
}

/** The pixels `drawSurfaceLine` can write: a Bresenham line stays inside its truncated endpoints' bounding box. */
export function lineBounds(width: number, height: number, x1: number, y1: number, x2: number, y2: number): PixelBounds {
  const sx = Math.trunc(x1);
  const sy = Math.trunc(y1);
  const ex = Math.trunc(x2);
  const ey = Math.trunc(y2);
  return clipSpan(width, height, Math.min(sx, ex), Math.max(sx, ex), Math.min(sy, ey), Math.max(sy, ey));
}

/** The pixels `drawSurfaceCircle` can write: the clipped square around the truncated centre. NaN draws nothing. */
export function circleBounds(width: number, height: number, cx: number, cy: number, radius: number): PixelBounds {
  const centerX = Math.trunc(cx);
  const centerY = Math.trunc(cy);
  const r = Math.max(0, Math.trunc(radius));
  if (Number.isNaN(centerX) || Number.isNaN(centerY) || Number.isNaN(r)) return emptyBounds();
  return clipSpan(width, height, centerX - r, centerX + r, centerY - r, centerY + r);
}

/** Surface-targeted bounds query for a single pixel. */
export function surfacePixelBounds(state: SurfacesSection, id: SurfaceId, x: number, y: number): PixelBounds | undefined {
  const current = entry(state, id);
  return current === null ? undefined : pixelBounds(current.bitmap.w, current.bitmap.h, x, y);
}

/** Surface-targeted bounds query for a rectangle. */
export function surfaceRectBounds(state: SurfacesSection, id: SurfaceId, x1: number, y1: number, x2: number, y2: number): PixelBounds | undefined {
  const current = entry(state, id);
  return current === null ? undefined : rectBounds(current.bitmap.w, current.bitmap.h, x1, y1, x2, y2);
}

/** Surface-targeted bounds query for a line. */
export function surfaceLineBounds(state: SurfacesSection, id: SurfaceId, x1: number, y1: number, x2: number, y2: number): PixelBounds | undefined {
  const current = entry(state, id);
  return current === null ? undefined : lineBounds(current.bitmap.w, current.bitmap.h, x1, y1, x2, y2);
}

/** Surface-targeted bounds query for a circle. */
export function surfaceCircleBounds(state: SurfacesSection, id: SurfaceId, cx: number, cy: number, radius: number): PixelBounds | undefined {
  const current = entry(state, id);
  return current === null ? undefined : circleBounds(current.bitmap.w, current.bitmap.h, cx, cy, radius);
}

/**
 * The pixels a blit of `width × height` at `(x, y)` can write. Arguments outside the safe-integer
 * range report `undefined` (unbounded), never a narrower guess.
 */
export function blitBounds(bitmap: RgbaSnapshot, x: number, y: number, width: number, height: number): PixelBounds | undefined {
  if (![x, y, width, height, x + width, y + height].every(Number.isSafeInteger) || width < 0 || height < 0) return undefined;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(bitmap.w, x + width);
  const bottom = Math.min(bitmap.h, y + height);
  if (left >= right || top >= bottom) return emptyBounds();
  return { first: top * bitmap.w + left, last: (bottom - 1) * bitmap.w + right - 1 };
}

/** The tri-state an edit's `bounds` argument means: `undefined` is unbounded, an empty span writes nothing. */
function dirtyOf(bounds: PixelBounds | undefined, pixels: number): Dirty {
  if (bounds === undefined) return "full";
  const { first, last } = bounds;
  if (first > last) return null;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= pixels) return "full";
  return { first, last };
}

/** Combine two dirty states; unbounded wins, so a bounded edit never narrows an earlier unbounded one. */
function mergeDirty(a: Dirty, b: Dirty): Dirty {
  if (a === "full" || b === "full") return "full";
  if (a === null) return b;
  if (b === null) return a;
  return { first: Math.min(a.first, b.first), last: Math.max(a.last, b.last) };
}

/** Re-encode only the three-byte-aligned span of `after` that differs from `before` inside `bounds`. */
function editedSnapshot(bitmap: RgbaSnapshot, before: Uint8Array, after: Uint8Array, bounds?: PixelBounds): RgbaSnapshot {
  const oldWords = new Uint32Array(before.buffer, before.byteOffset, before.byteLength / 4);
  const newWords = new Uint32Array(after.buffer, after.byteOffset, after.byteLength / 4);
  let first = bounds === undefined ? 0 : Math.max(0, bounds.first);
  const limit = bounds === undefined ? oldWords.length - 1 : Math.min(oldWords.length - 1, bounds.last);
  while (first <= limit && oldWords[first] === newWords[first]) first += 1;
  if (first > limit) return { ...bitmap };
  let last = limit;
  while (last > first && oldWords[last] === newWords[last]) last -= 1;
  const start = Math.floor(first * 4 / 3) * 3;
  const end = Math.min(after.length, Math.ceil((last + 1) * 4 / 3) * 3);
  const b64 = bitmap.b64.slice(0, start / 3 * 4)
    + encodeSurfaceBytes(after.subarray(start, end))
    + bitmap.b64.slice(Math.ceil(end / 3) * 4);
  return { t: "rgba", w: bitmap.w, h: bitmap.h, b64 };
}


/** A batch buffer is authoritative only while its entry still holds the exact snapshot and revision it was taken from. */
function pendingValid(pending: BatchEntry): boolean {
  const current = pending.entry;
  return pending.rev === current.rev && pending.bitmap === current.bitmap && pending.b64 === current.bitmap.b64
    && pending.w === current.bitmap.w && pending.h === current.bitmap.h;
}

/**
 * Drop `pending` from the entry index, but only while the index still points at it: the index is one
 * slot per entry and two batches can hold buffers for the same shared entry (two sections whose entries
 * reference one surface), so a closing older batch must not unindex the newer buffer.
 */
function dropPending(pending: BatchEntry): void {
  if (pendingEntries.get(pending.entry) === pending) pendingEntries.delete(pending.entry);
}

function decode(entry: SurfaceState, cache?: SurfacePixelCache): Uint8Array {
  // A caller's id:rev cache cannot distinguish different restored states.
  // The entry association also checks the snapshot itself, not just its rev.
  void cache;
  const pending = pendingEntries.get(entry);
  if (pending !== undefined && pendingValid(pending)) return pending.rgba;
  const record = decodedRecords.get(entry);
  const bitmap = entry.bitmap;
  if (record !== undefined && record.rev === entry.rev && record.bitmap === bitmap && record.b64 === bitmap.b64 && record.w === bitmap.w && record.h === bitmap.h) return record.rgba;
  const rgba = decodeSurfaceBytes(bitmap.b64);
  if (rgba.length !== byteCount(bitmap.w, bitmap.h)) throw new TypeError("surface pixel length does not match dimensions");
  decodedRecords.set(entry, { rev: entry.rev, bitmap, b64: bitmap.b64, w: bitmap.w, h: bitmap.h, rgba, canonical: false });
  return rgba;
}

/**
 * Write a batch buffer's dirty span back into its entry's canonical snapshot and leave the buffer
 * clean but still authoritative. Nothing happens when the entry was replaced, killed or changed by
 * someone else since the buffer was taken: that buffer is stale and its pixels are dropped.
 */
function materialize(state: SurfacesSection, pending: BatchEntry): void {
  const current = pending.entry;
  if (state.entries[String(current.id)] !== current || !pendingValid(pending)) return;
  if (pending.dirty !== null) {
    current.bitmap = pending.canonical
      ? editedSnapshot(pending.bitmap, pending.baseline, pending.rgba, pending.dirty === "full" ? undefined : pending.dirty)
      : snapshot(pending.w, pending.h, pending.rgba);
    pending.baseline = new Uint8Array(pending.rgba);
    pending.canonical = true;
    pending.dirty = null;
    pending.bitmap = current.bitmap;
    pending.b64 = current.bitmap.b64;
  }
  const record = decodedRecords.get(current);
  if (record !== undefined && record.rev === current.rev && record.bitmap === current.bitmap && record.rgba === pending.baseline) return;
  decodedRecords.set(current, { rev: current.rev, bitmap: current.bitmap, b64: current.bitmap.b64, w: pending.w, h: pending.h, rgba: pending.baseline, canonical: pending.canonical });
}

/** Internal synchronous batch: script drawing is held in working buffers until a flush or the batch end. */
export function beginSurfaceBatch(state: SurfacesSection): void {
  const batch = batches.get(state);
  if (batch !== undefined) batch.depth += 1;
  else batches.set(state, { depth: 1, entries: new Map() });
}

/**
 * Make every dirty snapshot canonical right now while the batch stays open and its working buffers
 * stay valid and clean. Call before any code outside the engine's built-ins can read the state tree.
 * A no-op when no batch is open or nothing is dirty.
 */
export function flushSurfaceBatch(state: SurfacesSection): void {
  const batch = batches.get(state);
  if (batch === undefined) return;
  for (const pending of batch.entries.values()) if (pending.dirty !== null) materialize(state, pending);
}

/** Materialize every dirty bitmap and close the batch, including after a thrown command. */
export function endSurfaceBatch(state: SurfacesSection): void {
  const batch = batches.get(state);
  if (batch === undefined) throw new Error("surface batch is not active");
  batch.depth -= 1;
  if (batch.depth !== 0) return;
  batches.delete(state);
  for (const pending of batch.entries.values()) {
    dropPending(pending);
    materialize(state, pending);
  }
}

function entry(state: SurfacesSection, id: SurfaceId): SurfaceState | null {
  return state.entries[String(id)] ?? null;
}

function checkedRgba(width: number, height: number, rgba: Uint8Array): void {
  if (!validDimension(width) || !validDimension(height)) throw new RangeError("surface dimensions must be non-negative integers");
  if (rgba.length !== byteCount(width, height)) throw new RangeError("surface pixel length does not match dimensions");
}

/** Create an empty surfaces section; `width`/`height` install composed frame 0. */
export function createSurfacesSection(width?: number, height?: number): SurfacesSection {
  const state: SurfacesSection = { nextId: 1, entries: {}, slots: {}, colours: {} };
  if (width !== undefined || height !== undefined) {
    if (width === undefined || height === undefined) throw new RangeError("surface frame dimensions must be supplied together");
    const pixels = new Uint8Array(byteCount(width, height));
    checkedRgba(width, height, pixels);
    const current: SurfaceState = { id: 0 as SurfaceId, rev: 0, bitmap: snapshot(width, height, pixels) };
    state.entries["0"] = current;
    decodedRecords.set(current, { rev: 0, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
  }
  return state;
}

/**
 * The script-screen layer: the persistent surface a script draws on when it draws to the screen. It has a fixed,
 * reserved id (`-1`) that never comes from the monotonic counter, so creating it moves neither `nextId` nor any
 * script-visible canvas handle, and scripts cannot name it (handles are never negative). It is created on first
 * use at the presented frame's size.
 */
export const SCRIPT_SCREEN = -1 as SurfaceId;

/** Create the script-screen layer if it does not exist yet, and return its id. */
export function ensureScriptScreen(state: SurfacesSection): SurfaceId {
  if (Object.hasOwn(state.entries, String(SCRIPT_SCREEN))) return SCRIPT_SCREEN;
  const frame = entry(state, 0 as SurfaceId);
  const width = frame?.bitmap.w ?? 640;
  const height = frame?.bitmap.h ?? 480;
  const pixels = new Uint8Array(byteCount(width, height));
  const current: SurfaceState = { id: SCRIPT_SCREEN, rev: 0, bitmap: snapshot(width, height, pixels) };
  state.entries[String(SCRIPT_SCREEN)] = current;
  decodedRecords.set(current, { rev: 0, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
  return SCRIPT_SCREEN;
}

/** The script-screen layer's id, or `null` when nothing has drawn to the screen yet. */
export function scriptScreen(state: SurfacesSection): SurfaceId | null {
  return Object.hasOwn(state.entries, String(SCRIPT_SCREEN)) ? SCRIPT_SCREEN : null;
}

/** Allocate a monotonically increasing surface id. Ids are never reused. */
export function createSurface(state: SurfacesSection, width: number, height: number, rgba?: Uint8Array): SurfaceId {
  const pixels = rgba === undefined ? new Uint8Array(byteCount(width, height)) : new Uint8Array(rgba);
  checkedRgba(width, height, pixels);
  const id = idOf(state.nextId);
  state.nextId += 1;
  const current: SurfaceState = { id, rev: 0, bitmap: snapshot(width, height, pixels) };
  state.entries[String(id)] = current;
  decodedRecords.set(current, { rev: 0, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
  return id;
}

/** Replace a surface's pixels and increment its revision exactly once. */
export function replaceSurface(state: SurfacesSection, id: SurfaceId, width: number, height: number, rgba: Uint8Array): number | null {
  const current = entry(state, id);
  if (current === null) return null;
  const pixels = new Uint8Array(rgba);
  checkedRgba(width, height, pixels);
  for (const colour of Object.keys(state.colours)) {
    if (state.colours[colour] === id) delete state.colours[colour];
  }
  current.rev += 1;
  current.bitmap = snapshot(width, height, pixels);
  pendingEntries.delete(current);
  batches.get(state)?.entries.delete(current);
  decodedRecords.set(current, { rev: current.rev, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
  return current.rev;
}

/** The live reserved render-now canvas, or null when none was created or the script killed it (E-57). Handle 0 is the screen, never a canvas. */
export function renderNowCanvas(state: SurfacesSection): SurfaceId | null {
  const handle = state.renderNow;
  if (typeof handle !== "number" || handle <= 0 || !Object.hasOwn(state.entries, String(handle))) return null;
  return handle;
}

/** Whether the reserved canvas is switched on and live. An absent flag (an older save) means on whenever a handle is named. */
export function renderNowEnabled(state: SurfacesSection): boolean {
  return renderNowCanvas(state) !== null && (state.renderNowOn ?? true);
}

/** Delete a surface. The allocation counter remains untouched. Surface 0 is permanent. */
export function killSurface(state: SurfacesSection, id: SurfaceId): boolean {
  if (id === (0 as SurfaceId) || id === SCRIPT_SCREEN || !Object.hasOwn(state.entries, String(id))) return false;
  delete state.entries[String(id)];
  for (const slot of Object.keys(state.slots)) if (state.slots[slot] === id) delete state.slots[slot];
  for (const colour of Object.keys(state.colours)) if (state.colours[colour] === id) delete state.colours[colour];
  return true;
}

/** Read pixels only when the caller's revision is current; always return an owned copy. */
export function readSurfacePixels(state: SurfacesSection, id: SurfaceId, rev: number, cache?: SurfacePixelCache): SurfacePixels | null {
  const current = entry(state, id);
  if (current === null || current.rev !== rev) return null;
  const rgba = decode(current, cache);
  return { w: current.bitmap.w, h: current.bitmap.h, rgba: new Uint8Array(rgba) };
}

export function surfaceTextures(state: SurfacesSection, cache: SurfacePixelCache = new Map()): ReadonlyMap<SurfaceId, DecodedTexture> {
  const textures = new Map<SurfaceId, DecodedTexture>();
  for (const raw of Object.keys(state.entries)) {
    const current = state.entries[raw]!;
    textures.set(current.id, { w: current.bitmap.w, h: current.bitmap.h, rgba: new Uint8Array(decode(current, cache)) });
  }
  return textures;
}

/** Return a stable 1×1 opaque colour surface, reusing one id for each RGB triple. */
export function colourSurface(state: SurfacesSection, rgb: Rgb): SurfaceId {
  const r = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
  const g = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
  const b = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
  const colour = `${r},${g},${b}`;
  const existing = state.colours[colour];
  if (existing !== undefined && entry(state, existing) !== null) return existing;
  const id = createSurface(state, 1, 1, new Uint8Array([r, g, b, 255]));
  state.colours[colour] = id;
  return id;
}

function copyRegion(state: SurfacesSection, source: SurfaceId, rect: { x: number; y: number; w: number; h: number }, cache?: SurfacePixelCache): { w: number; h: number; rgba: Uint8Array } | null {
  const sourceEntry = entry(state, source);
  if (sourceEntry === null || !validDimension(rect.w) || !validDimension(rect.h) || !Number.isInteger(rect.x) || !Number.isInteger(rect.y)) return null;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > sourceEntry.bitmap.w || rect.y + rect.h > sourceEntry.bitmap.h) return null;
  const input = decode(sourceEntry, cache);
  const output = new Uint8Array(byteCount(rect.w, rect.h));
  for (let y = 0; y < rect.h; y += 1) {
    const from = ((rect.y + y) * sourceEntry.bitmap.w + rect.x) * 4;
    output.set(input.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  return { w: rect.w, h: rect.h, rgba: output };
}

/** Save a region of a surface into a numbered slot, preserving the slot id. */
export function saveScreen(state: SurfacesSection, slot: number, source: SurfaceId = 0 as SurfaceId, rect?: { x: number; y: number; w: number; h: number }, cache?: SurfacePixelCache): SurfaceId | null {
  const sourceEntry = entry(state, source);
  if (sourceEntry === null || !Number.isInteger(slot) || slot < 0) return null;
  const region = copyRegion(state, source, rect ?? { x: 0, y: 0, w: sourceEntry.bitmap.w, h: sourceEntry.bitmap.h }, cache);
  if (region === null) return null;
  const slotKey = String(slot);
  const prior = state.slots[slotKey];
  if (prior !== undefined && entry(state, prior) !== null) {
    replaceSurface(state, prior, region.w, region.h, region.rgba);
    return prior;
  }
  const id = createSurface(state, region.w, region.h, region.rgba);
  state.slots[slotKey] = id;
  return id;
}

/** Read a pixel's RGB colour, or `null` outside its bounds (E-56). */
export function getPixel(state: SurfacesSection, id: SurfaceId, x: number, y: number, cache?: SurfacePixelCache): Rgb | null {
  const current = entry(state, id);
  if (current === null || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= current.bitmap.w || y >= current.bitmap.h) return null;
  const rgba = decode(current, cache);
  const at = (y * current.bitmap.w + x) * 4;
  return { r: rgba[at]!, g: rgba[at + 1]!, b: rgba[at + 2]! };
}

/** The snapshot shape used by save files, exposed for format and test callers. */
export type { RgbaSnapshot, SurfaceState };

/** `canvasGetScreen` copies the composed screen into an existing canvas (E-56). */
export function canvasGetScreen(state: SurfacesSection, destination: SurfaceId, source: SurfaceId = 0 as SurfaceId, cache?: SurfacePixelCache): number | null {
  const sourceEntry = entry(state, source);
  if (sourceEntry === null) return null;
  const region = copyRegion(state, source, { x: 0, y: 0, w: sourceEntry.bitmap.w, h: sourceEntry.bitmap.h }, cache);
  if (region === null) return null;
  return replaceSurface(state, destination, region.w, region.h, region.rgba);
}

/** Restore one numbered saved-screen slot into an existing destination surface. */
export function restoreScreen(
  state: SurfacesSection,
  slot: number,
  destination: SurfaceId = 0 as SurfaceId,
  cache?: SurfacePixelCache,
  region?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly dx: number; readonly dy: number },
): number | null {
  if (!Number.isInteger(slot) || slot < 0) return null;
  const source = state.slots[String(slot)];
  const sourceEntry = source === undefined ? null : entry(state, source);
  if (sourceEntry === null || source === undefined) return null;
  if (region !== undefined) {
    if (region.w < 0 || region.h < 0) return null;
    const ok = blitSurface(state, source, destination, region.dx, region.dy, region.w, region.h, undefined, 255, false, region);
    return ok ? (entry(state, destination)?.rev ?? null) : null;
  }
  const copied = copyRegion(state, source, { x: 0, y: 0, w: sourceEntry.bitmap.w, h: sourceEntry.bitmap.h }, cache);
  if (copied === null) return null;
  return replaceSurface(state, destination, copied.w, copied.h, copied.rgba);
}
/** The callback used by script drawing commands to mutate one persistent surface. */
export type SurfaceEditor = (rgba: Uint8Array, width: number, height: number) => void;

/** The batch buffer for `current`, or `undefined` when there is none or its entry changed behind it (then it is dropped). */
function livePending(batch: SurfaceBatch, current: SurfaceState): BatchEntry | undefined {
  const existing = batch.entries.get(current);
  if (existing === undefined) return undefined;
  if (pendingValid(existing)) return existing;
  batch.entries.delete(current);
  dropPending(existing);
  return undefined;
}

/** Register `rgba` as the live buffer for `current`; `baseline` must hold the pixels `current.bitmap` encodes. */
function takePending(batch: SurfaceBatch, current: SurfaceState, rgba: Uint8Array, baseline: Uint8Array, canonical: boolean, dirty: Dirty): BatchEntry {
  const created: BatchEntry = { entry: current, bitmap: current.bitmap, b64: current.bitmap.b64, rev: current.rev, w: current.bitmap.w, h: current.bitmap.h, rgba, baseline, canonical, dirty };
  pendingEntries.set(current, created);
  batch.entries.set(current, created);
  return created;
}

function releaseColourSurface(state: SurfacesSection, id: SurfaceId): void {
  for (const colour of Object.keys(state.colours)) {
    if (state.colours[colour] === id) delete state.colours[colour];
  }
}

/**
 * Mutate a surface in place, bumping its revision exactly once. The editor always receives a
 * detached buffer, so a retained reference can never alias the surface's own pixels; what it
 * changed is detected afterwards, so no bounds are needed.
 */
export function editSurface(state: SurfacesSection, id: SurfaceId, editor: SurfaceEditor): boolean {
  const current = entry(state, id);
  if (current === null) return false;
  const batch = batches.get(state);
  if (batch === undefined) return editSurfaceWithBounds(state, id, editor);
  let pending = livePending(batch, current);
  if (pending === undefined) {
    const baseline = decode(current);
    pending = takePending(batch, current, new Uint8Array(baseline), baseline, decodedRecords.get(current)?.canonical === true, null);
  }
  const before = new Uint8Array(pending.rgba);
  const userBuffer = new Uint8Array(before);
  editor(userBuffer, pending.w, pending.h);
  current.rev += 1;
  pending.rev = current.rev;
  const beforeWords = new Uint32Array(before.buffer, before.byteOffset, before.byteLength / 4);
  const userWords = new Uint32Array(userBuffer.buffer, userBuffer.byteOffset, userBuffer.byteLength / 4);
  const liveWords = new Uint32Array(pending.rgba.buffer, pending.rgba.byteOffset, pending.rgba.byteLength / 4);
  let first = -1;
  let last = -1;
  for (let i = 0; i < userWords.length; i += 1) {
    if (userWords[i] === beforeWords[i]) continue;
    liveWords[i] = userWords[i]!;
    if (first === -1) first = i;
    last = i;
  }
  pending.dirty = mergeDirty(pending.dirty, first === -1 ? null : { first, last });
  releaseColourSurface(state, id);
  return true;
}

/**
 * Trusted internal mutation: `bounds` must cover every pixel the editor can write (`undefined` means
 * anywhere, an empty span means none). Inside a batch the editor works directly on the live buffer
 * and, if it throws, the bounded region is restored, the revision is not bumped and earlier batched
 * edits survive. Outside a batch the editor works on a copy and nothing changes when it throws.
 */
export function editSurfaceWithBounds(state: SurfacesSection, id: SurfaceId, editor: SurfaceEditor, bounds?: PixelBounds): boolean {
  const current = entry(state, id);
  if (current === null) return false;
  const batch = batches.get(state);
  if (batch === undefined) {
    const before = decode(current);
    const canonical = decodedRecords.get(current)?.canonical === true;
    const rgba = new Uint8Array(before);
    editor(rgba, current.bitmap.w, current.bitmap.h);
    current.rev += 1;
    const dirty = dirtyOf(bounds, rgba.length / 4);
    current.bitmap = canonical
      ? editedSnapshot(current.bitmap, before, rgba, dirty === "full" ? undefined : dirty ?? emptyBounds())
      : snapshot(current.bitmap.w, current.bitmap.h, rgba);
    before.set(rgba);
    decodedRecords.set(current, { rev: current.rev, bitmap: current.bitmap, b64: current.bitmap.b64, w: current.bitmap.w, h: current.bitmap.h, rgba: before, canonical: true });
    releaseColourSurface(state, id);
    return true;
  }
  const pending = livePending(batch, current);
  if (pending === undefined) {
    const baseline = decode(current);
    const canonical = decodedRecords.get(current)?.canonical === true;
    const rgba = new Uint8Array(baseline);
    editor(rgba, current.bitmap.w, current.bitmap.h);
    current.rev += 1;
    takePending(batch, current, rgba, baseline, canonical, dirtyOf(bounds, rgba.length / 4));
  } else {
    const dirty = dirtyOf(bounds, pending.rgba.length / 4);
    const start = dirty === null ? 0 : dirty === "full" ? 0 : dirty.first * 4;
    const backup = dirty === null ? undefined : dirty === "full" ? pending.rgba.slice() : pending.rgba.slice(start, (dirty.last + 1) * 4);
    try {
      editor(pending.rgba, pending.w, pending.h);
    } catch (error) {
      if (backup !== undefined) pending.rgba.set(backup, start);
      throw error;
    }
    current.rev += 1;
    pending.rev = current.rev;
    pending.dirty = mergeDirty(pending.dirty, dirty);
  }
  releaseColourSurface(state, id);
  return true;
}

/** Return a surface's dimensions, or null when the handle is not live. */
export function surfaceSize(state: SurfacesSection, id: SurfaceId): { readonly w: number; readonly h: number } | null {
  const current = entry(state, id);
  return current === null ? null : { w: current.bitmap.w, h: current.bitmap.h };
}

function plot(rgba: Uint8Array, width: number, height: number, x: number, y: number, rgb: Rgb): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const at = (y * width + x) * 4;
  rgba[at] = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
  rgba[at + 1] = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
  rgba[at + 2] = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
  rgba[at + 3] = 255;
}

/** Integer Bresenham line, used by drawLine and the circle boundary. */
export function drawSurfaceLine(
  rgba: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgb: Rgb,
): void {
  let x = Math.trunc(x1);
  let y = Math.trunc(y1);
  const endX = Math.trunc(x2);
  const endY = Math.trunc(y2);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    plot(rgba, width, height, x, y, rgb);
    if (x === endX && y === endY) return;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

export function drawSurfaceRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgb: Rgb,
  filled: boolean,
): void {
  const left = Math.min(Math.trunc(x1), Math.trunc(x2));
  const right = Math.max(Math.trunc(x1), Math.trunc(x2));
  const top = Math.min(Math.trunc(y1), Math.trunc(y2));
  const bottom = Math.max(Math.trunc(y1), Math.trunc(y2));
  if (filled) {
    const x0 = Math.max(0, left);
    const x1 = Math.min(width - 1, right);
    const y0 = Math.max(0, top);
    const y1 = Math.min(height - 1, bottom);
    if (!(x0 <= x1 && y0 <= y1)) return;
    const row = new Uint8Array((x1 - x0 + 1) * 4);
    const red = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
    const green = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
    const blue = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
    for (let at = 0; at < row.length; at += 4) {
      row[at] = red;
      row[at + 1] = green;
      row[at + 2] = blue;
      row[at + 3] = 255;
    }
    for (let y = y0; y <= y1; y += 1) rgba.set(row, (y * width + x0) * 4);
    return;
  }
  drawSurfaceLine(rgba, width, height, left, top, right, top, rgb);
  drawSurfaceLine(rgba, width, height, right, top, right, bottom, rgb);
  drawSurfaceLine(rgba, width, height, right, bottom, left, bottom, rgb);
  drawSurfaceLine(rgba, width, height, left, bottom, left, top, rgb);
}

export function drawSurfaceCircle(
  rgba: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  rgb: Rgb,
  filled: boolean,
): void {
  const centerX = Math.trunc(cx);
  const centerY = Math.trunc(cy);
  const r = Math.max(0, Math.trunc(radius));
  for (let y = -r; y <= r; y += 1) {
    const span = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    if (filled) {
      for (let x = -span; x <= span; x += 1) plot(rgba, width, height, centerX + x, centerY + y, rgb);
    } else {
      plot(rgba, width, height, centerX - span, centerY + y, rgb);
      plot(rgba, width, height, centerX + span, centerY + y, rgb);
    }
  }
}
/** Copy clipped scanlines only when every copied source pixel is opaque. */
function copyOpaqueRows(
  source: Uint8Array, sourceWidth: number, cropX: number, cropY: number,
  target: Uint8Array, targetWidth: number, targetHeight: number,
  dx: number, dy: number, width: number, height: number,
): boolean {
  if (![cropX, cropY, dx, dy, width, height].every(Number.isSafeInteger) || width < 0 || height < 0) return false;
  const left = Math.max(0, -dx);
  const top = Math.max(0, -dy);
  const right = Math.min(width, targetWidth - dx);
  const bottom = Math.min(height, targetHeight - dy);
  for (let row = top; row < bottom; row += 1) {
    const start = ((cropY + row) * sourceWidth + cropX + left) * 4;
    const end = start + Math.max(0, right - left) * 4;
    for (let alpha = start + 3; alpha < end; alpha += 4) if (source[alpha] !== 255) return false;
  }
  for (let row = top; row < bottom && left < right; row += 1) {
    const start = ((cropY + row) * sourceWidth + cropX + left) * 4;
    target.set(source.subarray(start, start + (right - left) * 4), ((dy + row) * targetWidth + dx + left) * 4);
  }
  return true;
}


/**
 * A source buffer that is the destination's live batch buffer (a blit of a surface onto itself) would
 * be overwritten while it is read, smearing overlapping copies. Hand the blit a stable copy instead.
 */
function detachFromPending(destination: SurfaceState, pixels: Uint8Array): Uint8Array {
  return pendingEntries.get(destination)?.rgba === pixels ? new Uint8Array(pixels) : pixels;
}

/** Copy a source surface into a destination with optional key and alpha. */
export function blitSurface(
  state: SurfacesSection,
  source: SurfaceId,
  destination: SurfaceId,
  x: number,
  y: number,
  width?: number,
  height?: number,
  key?: Rgb,
  alpha = 255,
  additive = false,
  sourceRect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  const sourceEntry = entry(state, source);
  const destinationEntry = entry(state, destination);
  if (sourceEntry === null || destinationEntry === null) return false;
  const sourcePixels = detachFromPending(destinationEntry, decode(sourceEntry));
  const sourceWidth = sourceEntry.bitmap.w;
  const sourceHeight = sourceEntry.bitmap.h;
  const cropX = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.x));
  const cropY = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.y));
  const cropWidth = sourceRect === undefined ? sourceWidth : Math.min(sourceWidth - cropX, Math.max(0, Math.trunc(sourceRect.w)));
  const cropHeight = sourceRect === undefined ? sourceHeight : Math.min(sourceHeight - cropY, Math.max(0, Math.trunc(sourceRect.h)));
  const outWidth = width === undefined ? cropWidth : Math.max(0, Math.trunc(width));
  const outHeight = height === undefined ? cropHeight : Math.max(0, Math.trunc(height));
  if (outWidth === 0 || outHeight === 0 || cropWidth === 0 || cropHeight === 0) return true;
  const dx = Math.trunc(x);
  const dy = Math.trunc(y);
  return editSurfaceWithBounds(state, destination, (target, targetWidth, targetHeight) => {
    if (outWidth === cropWidth && outHeight === cropHeight && key === undefined && !additive && alpha === 255
      && copyOpaqueRows(sourcePixels, sourceWidth, cropX, cropY, target, targetWidth, targetHeight, dx, dy, cropWidth, cropHeight)) return;
    for (let row = 0; row < outHeight; row += 1) {
      const sourceY = cropY + Math.min(cropHeight - 1, Math.floor(row * cropHeight / outHeight));
      for (let column = 0; column < outWidth; column += 1) {
        const sourceX = cropX + Math.min(cropWidth - 1, Math.floor(column * cropWidth / outWidth));
        const from = (sourceY * sourceWidth + sourceX) * 4;
        const sr = sourcePixels[from]!;
        const sg = sourcePixels[from + 1]!;
        const sb = sourcePixels[from + 2]!;
        const sa = sourcePixels[from + 3]!;
        if (key !== undefined && sr === Math.trunc(key.r) && sg === Math.trunc(key.g) && sb === Math.trunc(key.b)) continue;
        const tx = dx + column;
        const ty = dy + row;
        if (tx < 0 || ty < 0 || tx >= targetWidth || ty >= targetHeight) continue;
        const at = (ty * targetWidth + tx) * 4;
        if (additive) {
          target[at] = Math.min(255, target[at]! + Math.trunc(sr * alpha / 255));
          target[at + 1] = Math.min(255, target[at + 1]! + Math.trunc(sg * alpha / 255));
          target[at + 2] = Math.min(255, target[at + 2]! + Math.trunc(sb * alpha / 255));
          target[at + 3] = 255;
          continue;
        }
        const effective = Math.trunc(sa * alpha / 255);
        if (effective >= 255) {
          target[at] = sr;
          target[at + 1] = sg;
          target[at + 2] = sb;
          target[at + 3] = sa;
        } else if (effective > 0) {
          target[at] = Math.trunc((sr * effective + target[at]! * (255 - effective)) / 255);
          target[at + 1] = Math.trunc((sg * effective + target[at + 1]! * (255 - effective)) / 255);
          target[at + 2] = Math.trunc((sb * effective + target[at + 2]! * (255 - effective)) / 255);
          target[at + 3] = 255;
        }
      }
    }
  }, blitBounds(destinationEntry.bitmap, dx, dy, outWidth, outHeight));
}
/** Copy decoded image pixels into a persistent surface without allocating a source handle. */
export function blitTexture(
  state: SurfacesSection,
  texture: DecodedTexture,
  destination: SurfaceId,
  x: number,
  y: number,
  width?: number,
  height?: number,
  key?: Rgb,
  alpha = 255,
  additive = false,
  sourceRect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  const destinationEntry = entry(state, destination);
  if (destinationEntry === null) return false;
  const cropX = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.x));
  const cropY = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.y));
  const cropWidth = sourceRect === undefined ? texture.w : Math.min(texture.w - cropX, Math.max(0, Math.trunc(sourceRect.w)));
  const cropHeight = sourceRect === undefined ? texture.h : Math.min(texture.h - cropY, Math.max(0, Math.trunc(sourceRect.h)));
  const outWidth = width === undefined ? cropWidth : Math.max(0, Math.trunc(width));
  const outHeight = height === undefined ? cropHeight : Math.max(0, Math.trunc(height));
  if (outWidth === 0 || outHeight === 0 || cropWidth === 0 || cropHeight === 0) return true;
  const dx = Math.trunc(x);
  const dy = Math.trunc(y);
  const pixels = detachFromPending(destinationEntry, texture.rgba);
  return editSurfaceWithBounds(state, destination, (target, targetWidth, targetHeight) => {
    if (outWidth === cropWidth && outHeight === cropHeight && key === undefined && !additive && alpha === 255
      && copyOpaqueRows(pixels, texture.w, cropX, cropY, target, targetWidth, targetHeight, dx, dy, cropWidth, cropHeight)) return;
    for (let row = 0; row < outHeight; row += 1) {
      const sourceY = cropY + Math.min(cropHeight - 1, Math.floor(row * cropHeight / outHeight));
      for (let column = 0; column < outWidth; column += 1) {
        const sourceX = cropX + Math.min(cropWidth - 1, Math.floor(column * cropWidth / outWidth));
        const from = (sourceY * texture.w + sourceX) * 4;
        const sr = pixels[from] ?? 0;
        const sg = pixels[from + 1] ?? 0;
        const sb = pixels[from + 2] ?? 0;
        const sa = pixels[from + 3] ?? 0;
        if (key !== undefined && sr === Math.trunc(key.r) && sg === Math.trunc(key.g) && sb === Math.trunc(key.b)) continue;
        const tx = dx + column;
        const ty = dy + row;
        if (tx < 0 || ty < 0 || tx >= targetWidth || ty >= targetHeight) continue;
        const at = (ty * targetWidth + tx) * 4;
        if (additive) {
          target[at] = Math.min(255, (target[at] ?? 0) + Math.trunc(sr * alpha / 255));
          target[at + 1] = Math.min(255, (target[at + 1] ?? 0) + Math.trunc(sg * alpha / 255));
          target[at + 2] = Math.min(255, (target[at + 2] ?? 0) + Math.trunc(sb * alpha / 255));
          target[at + 3] = 255;
          continue;
        }
        const effective = Math.trunc(sa * alpha / 255);
        if (effective >= 255) {
          target[at] = sr;
          target[at + 1] = sg;
          target[at + 2] = sb;
          target[at + 3] = sa;
        } else if (effective > 0) {
          target[at] = Math.trunc((sr * effective + (target[at] ?? 0) * (255 - effective)) / 255);
          target[at + 1] = Math.trunc((sg * effective + (target[at + 1] ?? 0) * (255 - effective)) / 255);
          target[at + 2] = Math.trunc((sb * effective + (target[at + 2] ?? 0) * (255 - effective)) / 255);
          target[at + 3] = 255;
        }
      }
    }
  }, blitBounds(destinationEntry.bitmap, dx, dy, outWidth, outHeight));
}

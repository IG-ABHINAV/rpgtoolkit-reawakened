import {
  canon,
  canonSplitRoot,
  hashState,
  tagNonFinite,
} from "../canon/canon.ts";
import {
  createFnv1a64State,
  fnv1a64Finish,
  fnv1a64Update,
  fnv1a64UpdateAscii,
  type Fnv1a64State,
} from "../canon/fnv1a.ts";
import { applyFnvAsciiTransition, createFnvAsciiTransition, staleFnvTransitionKeys, type FnvAsciiTransition } from "../canon/fnv1a-transition.ts";
import type { PlainData } from "../ports/plain-data.ts";
import { withoutSettings } from "../audio/model.ts";
import type { GameState } from "./state.ts";

type SurfaceHashCache = {
  before: string;
  surface: string;
  afterSurface: Fnv1a64State;
  working: Fnv1a64State;
  plan: TransitionPlan | null | false;
  transitions: Map<string, FnvAsciiTransition>;
  vmTransitions: Map<string, FnvAsciiTransition>;
};

const surfaceHashCaches = new WeakMap<GameState, SurfaceHashCache>();

const TRANSITION_BLOCK_SIZE = 4096;
const MAX_TRANSITION_TABLES = 2048;
// Bound retained canonical program text to at most 8 Mi characters per state.
const MIN_VM_TRANSITION_SIZE = 8192;
const MAX_VM_TRANSITION_SIZE = 262144;
const MAX_VM_TRANSITIONS = 32;
type TransitionPlan = { readonly blocks: readonly string[]; evictable: string[] | null };

/** Split ASCII canonical text into reusable fixed-size segments. */
function transitionPlan(text: string, ascii: boolean | undefined): TransitionPlan | false {
  if (text.length < TRANSITION_BLOCK_SIZE * 2 || ascii === false || (ascii === undefined && /[^\x00-\x7f]/.test(text))) return false;
  const blocks: string[] = [];
  for (let at = 0; at < text.length; at += TRANSITION_BLOCK_SIZE) blocks.push(text.slice(at, at + TRANSITION_BLOCK_SIZE));
  return { blocks, evictable: null };
}

/** Copy a short cache key rather than storing the original field slice. */
function transitionKey(block: string): string {
  return (" " + block).slice(1);
}


function updateSurfaceHash(cache: SurfaceHashCache, text: string, ascii: boolean | undefined): void {
  if (cache.plan === false) {
    if (ascii === true) fnv1a64UpdateAscii(text, cache.afterSurface);
    else fnv1a64Update(text, cache.afterSurface);
    return;
  }
  if (cache.plan === null) {
    if (ascii === false || (ascii === undefined && /[^\x00-\x7f]/.test(text))) fnv1a64Update(text, cache.afterSurface);
    else fnv1a64UpdateAscii(text, cache.afterSurface);
    return;
  }
  for (const block of cache.plan.blocks) {
    let transition = cache.transitions.get(block);
    if (transition === undefined) {
      if (cache.transitions.size >= MAX_TRANSITION_TABLES) {
        cache.plan.evictable ??= staleFnvTransitionKeys(cache.transitions, cache.plan.blocks);
        const stale = cache.plan.evictable.pop();
        if (stale !== undefined) cache.transitions.delete(stale);
      }
      if (cache.transitions.size < MAX_TRANSITION_TABLES) {
        transition = createFnvAsciiTransition(block.length);
        cache.transitions.set(transitionKey(block), transition);
      }
    }
    if (transition === undefined) fnv1a64UpdateAscii(block, cache.afterSurface);
    else applyFnvAsciiTransition(transition, block, cache.afterSurface);
  }
}

type CanonicalSurfaceCache = {
  metadata: string;
  bitmaps: readonly string[];
  field: string;
  ascii: boolean;
};
const canonicalSurfaces = new WeakMap<object, CanonicalSurfaceCache>();
type CanonicalBitmap = { b64: string; quoted: string; ascii: boolean };
const canonicalBitmaps = new WeakMap<object, CanonicalBitmap>();

function quotedBitmap(bitmap: object, b64: string): CanonicalBitmap {
  const cached = canonicalBitmaps.get(bitmap);
  if (cached !== undefined && cached.b64 === b64) return cached;
  const safeAscii = !/[^\x20-\x21\x23-\x5b\x5d-\x7e]/.test(b64);
  const quoted = safeAscii ? '"' + b64 + '"' : canon(b64);
  const result = { b64, quoted, ascii: safeAscii || !/[^\x00-\x7f]/.test(quoted) };
  canonicalBitmaps.set(bitmap, result);
  return result;
}

/** Reject exotic or accessor properties; the normal canonicalizer handles them. */
function dataFields(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return null;
    fields[key] = descriptor.value;
  }
  return fields;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberEntries(value: unknown): readonly (readonly [string, number])[] | null {
  const fields = dataFields(value);
  if (fields === null) return null;
  const result: Array<readonly [string, number]> = [];
  for (const key of Object.keys(fields).sort()) {
    const item = fields[key];
    if (!finite(item)) return null;
    result.push([key, item]);
  }
  return result;
}

/**
 * Reuse the canonical surface field only for its ordinary all-plain shape.
 * Metadata and each immutable b64 string are checked on every call, including
 * direct writes that do not increment rev. Other shapes use full canon.
 */
function cachedSurfaceField(value: unknown): string | undefined {
  const fields = dataFields(value);
  if (fields === null || value === null || typeof value !== "object") return undefined;
  const keys = Object.keys(fields).sort().join(",");
  if (![
    "colours,entries,nextId,slots",
    "colours,entries,nextId,renderNow,slots",
    "colours,entries,nextId,renderNowOn,slots",
    "colours,entries,nextId,renderNow,renderNowOn,slots",
  ].includes(keys)) return undefined;
  if (!finite(fields["nextId"])
    || (Object.hasOwn(fields, "renderNow") && !finite(fields["renderNow"]))
    || (Object.hasOwn(fields, "renderNowOn") && typeof fields["renderNowOn"] !== "boolean")) return undefined;
  const entries = dataFields(fields["entries"]);
  const slots = numberEntries(fields["slots"]);
  const colours = numberEntries(fields["colours"]);
  if (entries === null || slots === null || colours === null) return undefined;
  const metadataEntries: unknown[] = [];
  const bitmaps: string[] = [];
  const fragments: Array<{ key: string; entry: Record<string, unknown>; bitmap: Record<string, unknown>; bitmapObject: object }> = [];
  for (const key of Object.keys(entries).sort()) {
    const entry = dataFields(entries[key]);
    if (entry === null || Object.keys(entry).sort().join(",") !== "bitmap,id,rev" || !finite(entry["id"]) || !finite(entry["rev"])) return undefined;
    const bitmap = dataFields(entry["bitmap"]);
    if (bitmap === null || Object.keys(bitmap).sort().join(",") !== "b64,h,t,w"
      || typeof bitmap["b64"] !== "string" || typeof bitmap["t"] !== "string"
      || !finite(bitmap["w"]) || !finite(bitmap["h"])) return undefined;
    const bitmapObject = entry["bitmap"];
    if (bitmapObject === null || typeof bitmapObject !== "object") return undefined;
    fragments.push({ key, entry, bitmap, bitmapObject });
    bitmaps.push(bitmap["b64"]);
    metadataEntries.push([key, entry["id"], entry["rev"], bitmap["w"], bitmap["h"], bitmap["t"]]);
  }
  const metadata = JSON.stringify([
    fields["nextId"],
    Object.hasOwn(fields, "renderNow"),
    fields["renderNow"] ?? null,
    Object.hasOwn(fields, "renderNowOn"),
    fields["renderNowOn"] ?? null,
    metadataEntries,
    slots,
    colours,
  ]);
  const cached = canonicalSurfaces.get(value);
  if (cached !== undefined && cached.metadata === metadata && cached.bitmaps.length === bitmaps.length
    && bitmaps.every((bitmap, index) => bitmap === cached.bitmaps[index])) return cached.field;
  let ascii = !/[^\x00-\x7f]/.test(metadata);
  const entryFields = fragments.map(({ key, entry, bitmap, bitmapObject }) => {
    const encoded = quotedBitmap(bitmapObject, bitmap["b64"] as string);
    ascii = ascii && encoded.ascii;
    return canon(key)
      + ':{"bitmap":{"b64":' + encoded.quoted
      + ',"h":' + canon(bitmap["h"] as number) + ',"t":' + canon(bitmap["t"] as string)
      + ',"w":' + canon(bitmap["w"] as number) + '},"id":' + canon(entry["id"] as number)
      + ',"rev":' + canon(entry["rev"] as number) + '}';
  });
  const renderNow = Object.hasOwn(fields, "renderNow") ? ',"renderNow":' + canon(fields["renderNow"] as number) : "";
  const renderNowOn = Object.hasOwn(fields, "renderNowOn") ? ',"renderNowOn":' + canon(fields["renderNowOn"] as boolean) : "";
  const field = '"surfaces":{"colours":' + canon(fields["colours"] as PlainData)
    + ',"entries":{' + entryFields.join(",") + '},"nextId":' + canon(fields["nextId"] as number)
    + renderNow + renderNowOn + ',"slots":' + canon(fields["slots"] as PlainData) + '}';
  canonicalSurfaces.set(value, { metadata, bitmaps, field, ascii });
  return field;
}

/**
 * The state hash of a whole game state (AD-11): `hashState` of the tree
 * without `audio.settings`, VM step counters or `engine.nextRequestId`.
 * Snapshots retain these fields; pending engine requests, including their ids,
 * remain hashed (docs/spec/formats/save-game.md#state-hash-request-projection).
 *
 * Canonical surface fragments are reused after checking their metadata and
 * immutable b64 values, including writes that do not increment rev. An exact
 * prefix cache skips FNV work when both the prefix and surfaces are unchanged.
 * Other shapes fall back to the ordinary canonicalizer.
 */
export function hashGameState(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  const projected = { ...state, vm, engine, audio: withoutSettings(state.audio) };
  const tagged = tagNonFinite(projected) as PlainData;
  let ascii: boolean | undefined;
  const parts = canonSplitRoot(tagged, "surfaces", (value) => {
    const field = cachedSurfaceField(value);
    if (field !== undefined && value !== null && typeof value === "object") ascii = canonicalSurfaces.get(value)?.ascii;
    return field;
  });
  if (!parts.hasSelected) return hashState(tagged);

  let cache = surfaceHashCaches.get(state);
  if (cache === undefined) {
    cache = {
      before: "",
      surface: "",
      afterSurface: createFnv1a64State(),
      working: createFnv1a64State(),
      plan: null,
      transitions: new Map(),
      vmTransitions: new Map(),
    };
    surfaceHashCaches.set(state, cache);
  }

  const surfaceChanged = cache.surface !== parts.selected;
  const prefixChanged = cache.before !== parts.before;
  if (surfaceChanged) cache.plan = transitionPlan(parts.selected, ascii);
  else if (prefixChanged && cache.plan === null) cache.plan = transitionPlan(parts.selected, ascii);
  if (prefixChanged || surfaceChanged) {
    cache.before = parts.before;
    cache.surface = parts.selected;
    cache.afterSurface = createFnv1a64State();
    fnv1a64Update("{", cache.afterSurface);
    if (parts.before !== "") {
      fnv1a64Update(parts.before, cache.afterSurface);
      fnv1a64Update(",", cache.afterSurface);
    }
    updateSurfaceHash(cache, parts.selected, ascii);
  }

  cache.working.high = cache.afterSurface.high;
  cache.working.low = cache.afterSurface.low;
  let prunedVmTransitions = false;
  for (const segment of parts.after) {
    if (typeof segment === "string") {
      if (/[^\x00-\x7f]/.test(segment)) fnv1a64Update(segment, cache.working);
      else fnv1a64UpdateAscii(segment, cache.working);
    } else if (!segment.ascii) {
      fnv1a64Update(segment.text, cache.working);
    } else if (segment.text.length < MIN_VM_TRANSITION_SIZE || segment.text.length > MAX_VM_TRANSITION_SIZE) {
      fnv1a64UpdateAscii(segment.text, cache.working);
    } else {
      let transition = cache.vmTransitions.get(segment.text);
      if (transition === undefined && cache.vmTransitions.size >= MAX_VM_TRANSITIONS && !prunedVmTransitions) {
        const active = new Set(parts.after.flatMap((part) =>
          typeof part !== "string" && part.ascii ? [part.text] : []));
        for (const text of cache.vmTransitions.keys()) {
          if (!active.has(text)) cache.vmTransitions.delete(text);
        }
        prunedVmTransitions = true;
      }
      if (transition === undefined && cache.vmTransitions.size < MAX_VM_TRANSITIONS) {
        transition = createFnvAsciiTransition(segment.text.length);
        cache.vmTransitions.set(segment.text, transition);
      }
      if (transition === undefined) fnv1a64UpdateAscii(segment.text, cache.working);
      else applyFnvAsciiTransition(transition, segment.text, cache.working);
    }
  }
  fnv1a64Update("}", cache.working);
  return fnv1a64Finish(cache.working);
}

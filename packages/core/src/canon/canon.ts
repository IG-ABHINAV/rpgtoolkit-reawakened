/**
 * RFC 8785 (JCS) canonical JSON and the core's two hashes (AD-11).
 *
 * `canon` serialises plain data with no whitespace: keys sorted by UTF-16 code
 * unit, numbers per ECMAScript `Number::toString`, minimal escaping. It rejects
 * anything outside `PlainData` (G1, AD-7) with `TypeError`. `hashState` and
 * `hashDrawList` are FNV-1a 64-bit over the canonical form's UTF-8 bytes, so
 * equal data hashes equal and a differing surface `rev` hashes differently.
 */

import type { DrawListV2 } from "../ports/draw.ts";
import type { PlainData } from "../ports/plain-data.ts";
import { fnv1a64 } from "./fnv1a.ts";

/** Maximum container nesting accepted by canonical state serialization. */
export const CANON_MAX_DEPTH = 256;

/** The canonical form of `value` (RFC 8785). */
export function canon(value: PlainData): string {
  return serialize(value, new Set<object>(), 0);
}
/**
 * The canonical root-object fields split around `splitKey`. Each segment is
 * serialized with the same depth and shared cycle set as one `canon` call.
 */
export type CanonReusableSegment = { readonly text: string; readonly ascii: boolean };
export type CanonRootSplit = {
  readonly before: string;
  readonly selected: string;
  readonly after: readonly (string | CanonReusableSegment)[];
  readonly hasSelected: boolean;
};

export function canonSplitRoot(value: PlainData, splitKey: string, cachedSelected?: (value: unknown) => string | undefined): CanonRootSplit {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("canon: only plain objects are plain data");
  }

  const record = value as object;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError("canon: only plain objects are plain data");
  }
  const seen = new Set<object>();
  seen.add(record);

  const before: string[] = [];
  const selected: string[] = [];
  const after: (string | CanonReusableSegment)[] = [];
  let hasSelected = false;
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) {
      throw new TypeError("canon: missing property descriptor");
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("canon: accessor properties are not plain data");
    }
    if (key > splitKey) {
      after.push(",");
      const vm = key === "vm" ? splitVm(descriptor.value, seen) : undefined;
      if (vm !== undefined) {
        after.push(serializeString(key) + ":");
        for (const segment of vm) after.push(segment);
      } else {
        after.push(serializeString(key) + ":" + serialize(descriptor.value, seen, 1));
      }
    } else {
      const field = (key === splitKey ? cachedSelected?.(descriptor.value) : undefined)
        ?? serializeString(key) + ":" + serialize(descriptor.value, seen, 1);
      if (key === splitKey) {
        selected.push(field);
        hasSelected = true;
      } else {
        before.push(field);
      }
    }
  }
  return {
    before: before.join(","),
    selected: selected.join(","),
    after,
    hasSelected,
  };
}

type CachedFlatObject = {
  readonly keys: readonly string[];
  readonly values: readonly unknown[];
  readonly segment: CanonReusableSegment;
};
const flatObjects = new WeakMap<object, CachedFlatObject>();

/** Only flat plain objects qualify: nested or unusual shapes use the normal serializer. */
function flatObject(value: unknown): CanonReusableSegment | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return undefined;
  const keys = Object.keys(value).sort();
  const values: unknown[] = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
    const item: unknown = descriptor.value;
    if (item !== null && typeof item !== "string" && typeof item !== "boolean"
      && !(typeof item === "number" && Number.isFinite(item))) return undefined;
    values.push(item);
  }
  const cached = flatObjects.get(value);
  if (cached !== undefined && cached.keys.length === keys.length
    && keys.every((key, index) => key === cached.keys[index] && values[index] === cached.values[index])) return cached.segment;
  let text: string;
  try {
    text = serialize(value, new Set<object>(), 0);
  } catch {
    // Preserve the normal serializer's error order for invalid state.
    return undefined;
  }
  const segment = { text, ascii: !/[^\x00-\x7f]/.test(text) };
  flatObjects.set(value, { keys, values, segment });
  return segment;
}

/** Split a VM's aliased flat program refs without materialising their repeated canonical text. */
function splitVm(value: unknown, ancestors: Set<object>): (string | CanonReusableSegment)[] | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ancestors.has(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return undefined;
  const ownersDescriptor = Object.getOwnPropertyDescriptor(value, "defOwners");
  if (ownersDescriptor === undefined || !ownersDescriptor.enumerable || ownersDescriptor.get !== undefined || ownersDescriptor.set !== undefined) return undefined;
  const owners: unknown = ownersDescriptor.value;
  if (owners === null || typeof owners !== "object" || Array.isArray(owners) || owners === value || ancestors.has(owners)) return undefined;
  const ownerProto = Object.getPrototypeOf(owners);
  if (ownerProto !== null && ownerProto !== Object.prototype) return undefined;
  const ownerKeys = Object.keys(owners).sort();
  const ownerSegments: CanonReusableSegment[] = [];
  const local = new Map<object, CanonReusableSegment>();
  for (const key of ownerKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(owners, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
    const ref: unknown = descriptor.value;
    if (ref === null || typeof ref !== "object" || ref === value || ref === owners || ancestors.has(ref)) return undefined;
    let segment = local.get(ref);
    if (segment === undefined) {
      segment = flatObject(ref);
      if (segment === undefined) return undefined;
      local.set(ref, segment);
    }
    ownerSegments.push(segment);
  }
  const keys = Object.keys(value).sort();
  const result: (string | CanonReusableSegment)[] = ["{"];
  ancestors.add(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
      ancestors.delete(value);
      return undefined;
    }
    result.push((i === 0 ? "" : ",") + serializeString(key) + ":");
    if (key === "defOwners") {
      result.push("{");
      for (let j = 0; j < ownerKeys.length; j += 1) {
        result.push((j === 0 ? "" : ",") + serializeString(ownerKeys[j]!) + ":", ownerSegments[j]!);
      }
      result.push("}");
    } else {
      result.push(serialize(descriptor.value, ancestors, 2));
    }
  }
  ancestors.delete(value);
  result.push("}");
  return result;
}


/** Tags non-finite numbers ({ t: 'nan' | 'inf' | '-inf' }) for PlainData state (AD-7, AD-11). */
export function tagNonFinite(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      if (Number.isNaN(value)) return { t: "nan" };
      return value > 0 ? { t: "inf" } : { t: "-inf" };
    }
    return value;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = tagNonFinite(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? mapped : value;
  }
  const record = value as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    const next = tagNonFinite(v);
    if (next !== v) changed = true;
    out[k] = next;
  }
  return changed ? out : value;
}

/** Revives tagged non-finite numbers ({ t: 'nan' | 'inf' | '-inf' }) to numbers. */
export function reviveNonFinite(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = reviveNonFinite(value[i]);
    }
    return value;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "t") {
    if (record.t === "nan") return NaN;
    if (record.t === "inf") return Infinity;
    if (record.t === "-inf") return -Infinity;
  }
  for (const key of keys) {
    record[key] = reviveNonFinite(record[key]);
  }
  return record;
}

/** FNV-1a 64-bit of a state's canonical form (AD-11). */
export function hashState(state: PlainData): string {
  return fnv1a64(canon(tagNonFinite(state) as PlainData));
}

/**
 * FNV-1a 64-bit of a DrawListV2 canonical form (AD-11). Covers both command planes and the surface `rev` numbers they reference, never pixel bytes.
 */
export function hashDrawList(drawList: DrawListV2): string {
  return fnv1a64(canon(drawList));
}

function serialize(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > CANON_MAX_DEPTH) {
    throw new TypeError(`canon: maximum nesting depth ${CANON_MAX_DEPTH} exceeded`);
  }
  switch (typeof value) {
    case "object":
      if (value === null) return "null";
      if (Array.isArray(value)) return serializeArray(value, seen, depth + 1);
      return serializeObject(value, seen, depth + 1);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "string":
      return serializeString(value);
    default:
      throw new TypeError(`canon: ${typeof value} is not plain data`);
  }
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("canon: NaN and Infinity are not plain data");
  }
  // Number::toString(-0) is "0" (ES spec; RFC 8785 3.2.2.3), so -0 needs no
  // special case; the tests pin it.
  return JSON.stringify(value);
}

function serializeString(value: string): string {
  // Large base64 snapshots contain no JSON escapes. A native character-class
  // search avoids constructing a rope one character at a time.
  if (value.length >= 128 && !/[^\x20-\x21\x23-\x5b\x5d-\x7e]/.test(value)) return '"' + value + '"';
  // JSON's string escaping is the RFC 8785 form. Keep the validating path for
  // any surrogate, since JSON.stringify accepts unpaired UTF-16 code units.
  if (value.length >= 128 && !/[\ud800-\udfff]/.test(value)) return JSON.stringify(value);
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += "\\\\";
    } else if (code === 0x08) {
      out += "\\b";
    } else if (code === 0x09) {
      out += "\\t";
    } else if (code === 0x0a) {
      out += "\\n";
    } else if (code === 0x0c) {
      out += "\\f";
    } else if (code === 0x0d) {
      out += "\\r";
    } else if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new TypeError("canon: unpaired surrogate in a string");
      }
      out += value.charAt(i) + value.charAt(i + 1);
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("canon: unpaired surrogate in a string");
    } else {
      out += value.charAt(i);
    }
  }
  return out + '"';
}

function serializeArray(items: readonly unknown[], seen: Set<object>, depth: number): string {
  const prototype = Object.getPrototypeOf(items);
  if (prototype !== Array.prototype) {
    throw new TypeError("canon: only plain arrays are plain data");
  }
  if (seen.has(items)) {
    throw new TypeError("canon: circular reference");
  }
  // Check density without allocating an array of all indices. Enumerable
  // non-index properties are rejected; the indexed pass catches holes.
  for (const key in items) {
    if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= items.length) {
      throw new TypeError("canon: sparse arrays and array properties are not plain data");
    }
  }
  seen.add(items);
  let out = "[";
  for (let i = 0; i < items.length; i++) {
    if (!Object.hasOwn(items, i)) {
      throw new TypeError("canon: sparse arrays and array properties are not plain data");
    }
    if (i > 0) out += ",";
    out += serialize(items[i], seen, depth);
  }
  seen.delete(items);
  return out + "]";
}

function serializeObject(record: object, seen: Set<object>, depth: number): string {

  const prototype = Object.getPrototypeOf(record);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError("canon: only plain objects are plain data");
  }
  if (seen.has(record)) {
    throw new TypeError("canon: circular reference");
  }
  seen.add(record);
  // Keys sort by UTF-16 code unit, independent of locale (RFC 8785 §3.2.3).
  const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let out = "{";
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) {
      throw new TypeError("canon: missing property descriptor");
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("canon: accessor properties are not plain data");
    }
    if (i > 0) out += ",";
    out += serializeString(key) + ":" + serialize(descriptor.value, seen, depth);
  }
  seen.delete(record);
  return out + "}";
}

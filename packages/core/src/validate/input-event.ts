/**
 * The runtime check for an untrusted `InputEvent` (AD-14, AD-5).
 *
 * A decoded input event arrives from an untyped source — a Worker message, a
 * log file, a runner — where the compiler cannot enforce the port contract.
 * `validateInputEvent` checks one such value against the contract and names
 * the field that is wrong, so the rule lives here once rather than in every
 * consumer (G2, G3). It never throws: malformed data, including `null`, a
 * number, an array or a cyclic object, produces `ok: false`.
 *
 * Every field of every event is required and an absent value is `null`, so a
 * missing key and a key set to `undefined` are both failures. On success the
 * result carries a fresh typed `InputEvent` that deep-equals the input.
 *
 * `extension.result.result` is checked by canonicalising it in log form, so it
 * must be canonicalisable `PortData` (a `null`, a JSON scalar, a plain object,
 * an array or a `Uint8Array`, at every depth); its deep contents are passed
 * through unchanged, never converted.
 */

import { canon, encodeLog } from "../canon/index.ts";
import type { PortData } from "../ports/bytes.ts";
import type { HostDisplayGeometry, HostFeatures } from "../ports/host.ts";
import type { InputEvent } from "../ports/input.ts";
import { normalizeDisplayGeometry, normalizeHostFeatures } from "../save/sections/host.ts";

/** The result of validating one candidate input event. */
export type InputEventValidation =
  | { readonly ok: true; readonly value: InputEvent }
  | { readonly ok: false; readonly path: string; readonly message: string };

type UnknownRecord = { readonly [key: string]: unknown };

const KINDS = [
  "key",
  "pointer",
  "pointer.cancel",
  "gamepad",
  "focus",
  "action",
  "host.features",
  "host.display",
  "host.gamepads",
  "asset",
  "blob.loaded",
  "blob.saved",
  "blob.listed",
  "extension.result",
  "audio.ended",
  "video.ended",
] as const;

type EventKind = (typeof KINDS)[number];

/** The exact key set of each event kind, in check order. */
const KEY_SETS: { readonly [kind in EventKind]: readonly string[] } = {
  key: ["kind", "name", "code", "char", "down", "repeat"],
  pointer: ["kind", "x", "y", "buttons"],
  "pointer.cancel": ["kind"],
  action: ["kind", "action", "down", "source", "modalId"],
  gamepad: ["kind", "device", "connected", "axes", "buttons"],
  focus: ["kind", "state"],
  "host.features": ["kind", "features"],
  "host.display": ["kind", "geometry"],
  "host.gamepads": ["kind", "devices"],
  asset: ["kind", "reqId", "bytes"],
  "blob.loaded": ["kind", "reqId", "bytes"],
  "blob.saved": ["kind", "reqId", "ok"],
  "blob.listed": ["kind", "reqId", "names"],
  "extension.result": ["kind", "reqId", "result"],
  "audio.ended": ["kind", "cueId"],
  "video.ended": ["kind", "reqId"],
};

function isKnownKind(kind: string): kind is EventKind {
  return (KINDS as readonly string[]).includes(kind);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** `null` or exactly one code point; a lone surrogate and a multi-character string fail. */
function isChar(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (value.length === 1) {
    const code = value.charCodeAt(0);
    return code < 0xd800 || code > 0xdfff;
  }
  if (value.length === 2) {
    const high = value.charCodeAt(0);
    const low = value.charCodeAt(1);
    return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
  }
  return false;
}

function isBytes(value: unknown): value is Uint8Array | null {
  return value === null || value instanceof Uint8Array;
}

function isNameList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== "string") return false;
  }
  return true;
}

function isFocusState(value: unknown): value is "lost" | "gained" {
  return value === "lost" || value === "gained";
}

function invalid(path: string, message: string): InputEventValidation {
  return { ok: false, path, message };
}

/** Copy the (already key-checked) record into a fresh typed event. */
function accept(record: UnknownRecord): InputEventValidation {
  const value: { [key: string]: unknown } = {};
  for (const key of Object.keys(record)) value[key] = record[key];
  return { ok: true, value: value as InputEvent };
}

function validateKey(record: UnknownRecord): InputEventValidation {
  const name = record["name"];
  if (!isNonEmptyString(name)) return invalid("name", "expected a non-empty string");
  const code = record["code"];
  if (!isNonEmptyString(code)) return invalid("code", "expected a non-empty string");
  const char = record["char"];
  if (!isChar(char)) return invalid("char", "expected null or a single code point");
  if (typeof record["down"] !== "boolean") return invalid("down", "expected a boolean");
  if (record["repeat"] !== undefined && typeof record["repeat"] !== "boolean") return invalid("repeat", "expected a boolean");
  return accept(record);
}

function validatePointer(record: UnknownRecord): InputEventValidation {
  if (!isInteger(record["x"])) return invalid("x", "expected an integer");
  if (!isInteger(record["y"])) return invalid("y", "expected an integer");
  if (!isNonNegativeInteger(record["buttons"]))
    return invalid("buttons", "expected a non-negative integer");
  return accept(record);
}

function isPlainAxes(axes: object): boolean {
  const prototype = Object.getPrototypeOf(axes);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(axes);
  if (keys.length !== 2 || !keys.includes("x") || !keys.includes("y")) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(axes, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

function validateGamepad(record: UnknownRecord): InputEventValidation {
  const device = record["device"];
  if (!isInteger(device) || device < 0 || device > 3) return invalid("device", "expected an integer from 0 through 3");
  const connected = record["connected"];
  if (typeof connected !== "boolean") return invalid("connected", "expected a boolean");
  const axesDescriptor = Object.getOwnPropertyDescriptor(record, "axes");
  if (axesDescriptor === undefined || !axesDescriptor.enumerable || !("value" in axesDescriptor))
    return invalid("axes", "expected an enumerable data property");
  const axes: unknown = axesDescriptor.value;
  if (typeof axes !== "object" || axes === null || Array.isArray(axes)) return invalid("axes", "expected an object");
  const axisRecord = axes as UnknownRecord;
  if (!isPlainAxes(axisRecord))
    return invalid("axes", "expected exactly x and y axes");
  const x = axisRecord["x"];
  const y = axisRecord["y"];
  if (!isInteger(x) || x < -1000 || x > 1000) return invalid("axes.x", "expected an integer from -1000 through 1000");
  if (!isInteger(y) || y < -1000 || y > 1000) return invalid("axes.y", "expected an integer from -1000 through 1000");
  const buttons = record["buttons"];
  if (!isNonNegativeInteger(buttons) || buttons > 0x1ffff) return invalid("buttons", "expected a 17-bit non-negative physical button mask");
  return { ok: true, value: { kind: "gamepad", device, connected, axes: { x, y }, buttons } };
}

function validateAction(record: UnknownRecord): InputEventValidation {
  if (!isNonEmptyString(record["action"])) return invalid("action", "expected a non-empty action name");
  if (typeof record["down"] !== "boolean") return invalid("down", "expected a boolean");
  if (!isNonEmptyString(record["source"])) return invalid("source", "expected a non-empty source name");
  const modalId = record["modalId"];
  if (modalId !== null && (typeof modalId !== "number" || !Number.isSafeInteger(modalId) || modalId < 1)) return invalid("modalId", "expected a positive safe integer or null");
  if (modalId !== null && record["action"] !== "confirm" && record["action"] !== "cancel") return invalid("action", "modal-scoped actions must be confirm or cancel");
  return accept(record);
}
function validateFocus(record: UnknownRecord): InputEventValidation {
  if (!isFocusState(record["state"])) return invalid("state", "expected 'lost' or 'gained'");
  return accept(record);
}

function validateHostFeatures(record: UnknownRecord): InputEventValidation {
  const features = record["features"];
  if (typeof features !== "object" || features === null || Array.isArray(features)) return invalid("features", "expected an object");
  try {
    const normalized = normalizeHostFeatures(features as HostFeatures);
    const keys = ["touch", "pointer", "keyboard", "gamepad", "haptics", "orientation"];
    if (Object.keys(features).length !== keys.length || keys.some((key) => !Object.hasOwn(features, key))) {
      return invalid("features", "expected a complete normalized host feature record");
    }
    if (Object.keys(normalized).some((key) => !Object.hasOwn(features, key))) {
      return invalid("features", "expected a complete normalized host feature record");
    }
    return accept(record);
  } catch (error) {
    return invalid("features", error instanceof Error ? error.message : "invalid host features");
  }
}

function validateHostGamepads(record: UnknownRecord): InputEventValidation {
  const devices = record["devices"];
  if (!Array.isArray(devices)) return invalid("devices", "expected an array");
  const normalized: { device: number; axes: { x: number; y: number }; buttons: number }[] = [];
  let previous = -1;
  for (let index = 0; index < devices.length; index += 1) {
    const device = devices[index];
    if (typeof device !== "object" || device === null || Array.isArray(device)) return invalid(`devices[${index}]`, "expected an object");
    const sample = device as UnknownRecord;
    const expected = ["device", "axes", "buttons"];
    for (const key of Object.keys(sample)) if (!expected.includes(key)) return invalid(`devices[${index}].${key}`, "unexpected key");
    for (const key of expected) if (!Object.hasOwn(sample, key)) return invalid(`devices[${index}].${key}`, "missing required key");
    const number = sample["device"];
    if (!isInteger(number) || number < 0 || number > 3) return invalid(`devices[${index}].device`, "expected an integer from 0 through 3");
    if (number <= previous) return invalid(`devices[${index}].device`, "devices must be unique and sorted by index");
    previous = number;
    const axesDescriptor = Object.getOwnPropertyDescriptor(sample, "axes");
    if (axesDescriptor === undefined || !axesDescriptor.enumerable || !("value" in axesDescriptor))
      return invalid(`devices[${index}].axes`, "expected an enumerable data property");
    const axes: unknown = axesDescriptor.value;
    if (typeof axes !== "object" || axes === null || Array.isArray(axes)) return invalid(`devices[${index}].axes`, "expected an object");
    const axisRecord = axes as UnknownRecord;
    if (!isPlainAxes(axisRecord))
      return invalid(`devices[${index}].axes`, "expected exactly x and y axes");
    const x = axisRecord["x"];
    const y = axisRecord["y"];
    if (!isInteger(x) || x < -1000 || x > 1000) return invalid(`devices[${index}].axes.x`, "expected an integer from -1000 through 1000");
    if (!isInteger(y) || y < -1000 || y > 1000) return invalid(`devices[${index}].axes.y`, "expected an integer from -1000 through 1000");
    const buttons = sample["buttons"];
    if (!isNonNegativeInteger(buttons) || buttons > 0x1ffff) return invalid(`devices[${index}].buttons`, "expected a 17-bit non-negative physical button mask");
    normalized.push({ device: number, axes: { x, y }, buttons });
  }
  return { ok: true, value: { kind: "host.gamepads", devices: normalized } };
}
function validateHostDisplay(record: UnknownRecord): InputEventValidation {
  const geometry = record["geometry"];
  if (typeof geometry !== "object" || geometry === null || Array.isArray(geometry)) return invalid("geometry", "expected an object");
  try {
    normalizeDisplayGeometry(geometry as HostDisplayGeometry);
    return accept(record);
  } catch (error) {
    return invalid("geometry", error instanceof Error ? error.message : "invalid display geometry");
  }
}

function validateBytesReply(record: UnknownRecord): InputEventValidation {
  if (!isNonNegativeInteger(record["reqId"]))
    return invalid("reqId", "expected a non-negative integer");
  if (!isBytes(record["bytes"])) return invalid("bytes", "expected null or Uint8Array");
  return accept(record);
}

function validateBlobSaved(record: UnknownRecord): InputEventValidation {
  if (!isNonNegativeInteger(record["reqId"]))
    return invalid("reqId", "expected a non-negative integer");
  if (typeof record["ok"] !== "boolean") return invalid("ok", "expected a boolean");
  return accept(record);
}

function validateBlobListed(record: UnknownRecord): InputEventValidation {
  if (!isNonNegativeInteger(record["reqId"]))
    return invalid("reqId", "expected a non-negative integer");
  if (!isNameList(record["names"])) return invalid("names", "expected an array of strings");
  return accept(record);
}

function validateExtensionResult(record: UnknownRecord): InputEventValidation {
  if (!isNonNegativeInteger(record["reqId"]))
    return invalid("reqId", "expected a non-negative integer");
  // `result` must survive a Worker seam and `canon`; canonicalising it in log
  // form rejects `undefined`, functions, `Map`/`Set`, class instances, `NaN`
  // and cycles at every depth. The value itself passes through unchanged.
  const result = record["result"];
  try {
    canon(encodeLog(result as PortData));
  } catch {
    return invalid("result", "expected canonicalisable port data");
  }
  return accept(record);
}

function validateAudioEnded(record: UnknownRecord): InputEventValidation {
  if (!isNonNegativeInteger(record["cueId"]))
    return invalid("cueId", "expected a non-negative integer");
  return accept(record);
}

function validateVideoEnded(record: UnknownRecord): InputEventValidation {
  if (!isNonNegativeInteger(record["reqId"])) return invalid("reqId", "expected a non-negative integer");
  return accept(record);
}

/**
 * Check one candidate against the `InputEvent` contract. Never throws — a
 * hostile value whose member reads (a throwing getter) or deep contents throw
 * is reported as `ok: false` like any other bad input.
 *
 * The result names the offending path: `""` for a value that is not an
 * object, `"kind"` for an unknown kind, the extra key for an unexpected one,
 * and the field name for a missing key or a wrong type.
 */
export function validateInputEvent(raw: unknown): InputEventValidation {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return invalid("", "expected an object");
    }
    const record = raw as UnknownRecord;
    const kind = record["kind"];
    if (typeof kind !== "string" || !isKnownKind(kind)) {
      return invalid("kind", "unknown input event kind");
    }

    const keys = KEY_SETS[kind];
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) return invalid(key, "unexpected key");
    }
    for (const key of keys) {
      if (kind === "key" && key === "repeat") continue;
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        return invalid(key, "missing required key");
      }
    }

    switch (kind) {
      case "key":
        return validateKey(record);
      case "pointer":
        return validatePointer(record);
      case "pointer.cancel":
        return accept(record);
      case "gamepad":
        return validateGamepad(record);
      case "action":
        return validateAction(record);
      case "focus":
        return validateFocus(record);
      case "host.features":
        return validateHostFeatures(record);
      case "host.display":
        return validateHostDisplay(record);
      case "host.gamepads":
        return validateHostGamepads(record);
      case "asset":
      case "blob.loaded":
        return validateBytesReply(record);
      case "blob.saved":
        return validateBlobSaved(record);
      case "blob.listed":
        return validateBlobListed(record);
      case "extension.result":
        return validateExtensionResult(record);
      case "audio.ended":
        return validateAudioEnded(record);
      case "video.ended":
        return validateVideoEnded(record);
      default: {
        const exhaustive: never = kind;
        return invalid("kind", "unknown input event kind: " + String(exhaustive));
      }
    }
  } catch {
    return invalid("", "not an input event");
  }
}

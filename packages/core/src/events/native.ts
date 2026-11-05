/**
 * The TypeScript side of the one bus (EMIT-7, EMIT-21; docs/spec/engine/rpgcode-modules-and-objects.md#emit-21).
 *
 * A TypeScript plugin has no handle on the queue, the listener table or a callable (G1, AD-8):
 *
 * - It *listens* by listing native listeners on its package definition. When the package
 *   starts, `registerNativeListeners` adds each to the one listener table as an ordinary
 *   listener whose callable names the package's command, so the same dispatcher runs it, in
 *   the same registration order, on its own thread, in the `events` phase.
 * - It *emits* by reporting the plain-data effect `emitEffect(...)` from a command; the VM
 *   appends the event to the one queue when the command returns (`applyEmitEffect`).
 * - It *reads* an event the dispatcher hands its listener command through `readEvent`, a
 *   plain-data copy; nothing it reads can be written back.
 *
 * Neither direction runs a listener inside the other's call.
 */

import type { PlainData } from "../ports/plain-data.ts";
import type { Value } from "../ports/value.ts";
import type { GameState } from "../save/state.ts";
import type { CommandEffect, PluginDefinition } from "../script/plugin.ts";
import { findObject, readMember } from "../script/objects.ts";
import { foldAscii } from "../script/values.ts";
import { addListener, emitterKeyOf, isEmitterPattern } from "./emitter.ts";
import type { EventsSection, NativeListener } from "./model.ts";

/** A listener that could not be registered, and why (EMIT-21). */
export type NativeListenerProblem = {
  readonly plugin: string;
  readonly listener: NativeListener;
  /** `unknown-command`: the package defines no such command. `bad-emitter`: a malformed pattern. */
  readonly reason: "unknown-command" | "bad-emitter";
};

/**
 * Add the native listeners of `plugins` to the one listener table (EMIT-21), in package
 * order and then in listed order, each as a listener of its key and type whose callable is
 * `{ def: <command>, captures: [], receiver: null }`. A table that already holds a listener
 * with that key, type and `def` is not given a second one, so a restored save is not
 * doubled. Returns the listeners that name no command of their package, which are skipped.
 */
export function registerNativeListeners(
  events: EventsSection,
  plugins: readonly { readonly definition: Pick<PluginDefinition, "id" | "commands" | "listeners"> }[],
): NativeListenerProblem[] {
  const problems: NativeListenerProblem[] = [];
  for (const { definition } of plugins) {
    for (const listener of definition.listeners ?? []) {
      if (listener.emitter.includes("*") && !isEmitterPattern(listener.emitter)) {
        problems.push({ plugin: definition.id, listener, reason: "bad-emitter" });
        continue;
      }
      const def = foldAscii(listener.command);
      if (!definition.commands.some((spec) => foldAscii(spec.name) === def)) {
        problems.push({ plugin: definition.id, listener, reason: "unknown-command" });
        continue;
      }
      const present = events.listeners.some(
        (item) => item.emitter === listener.emitter && item.type === listener.type && item.callable.def === def && item.callable.receiver === null,
      );
      if (!present) addListener(events, listener.emitter, listener.type, { type: "callable", def, captures: [], receiver: null }, false);
    }
  }
  return problems;
}

/**
 * The effect a command returns to send an event (EMIT-21): a plain emit of `type` on the
 * emitter `emitter` (`game`, or a registered built-in key) with `detail`, a plain object of
 * numbers, strings, booleans and `null`. The VM applies it when the command returns.
 */
export function emitEffect(emitter: string, type: string, detail?: { readonly [field: string]: PlainData }): CommandEffect {
  return { kind: "emit", args: detail === undefined ? [emitter, type] : [emitter, type, { ...detail }] };
}

/** A plain-data copy of an event object, for a TypeScript listener (EMIT-6, EMIT-21). */
export type EventView = {
  readonly type: string;
  /** The listener-table key of the emitter the event was sent on. */
  readonly emitter: string;
  readonly detail: { readonly [field: string]: PlainData };
  readonly cancelable: boolean;
  readonly canceled: boolean;
};

/** Convert a script value to plain data for a TypeScript listener. */
function plainValue(state: GameState, value: Value | undefined, seen: Set<number> = new Set()): PlainData {
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || !("kind" in value) || value.kind !== "object" || seen.has(value.handle)) return null;
  const record = findObject(state.vm, value.handle);
  if (record === undefined) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(value.handle);
  const plain: { [key: string]: PlainData } = {};
  for (const name of record.keys) {
    Object.defineProperty(plain, name, {
      value: plainValue(state, record.members[name], nextSeen),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return plain;
}
const VIEWPORT_DETAIL_NAMES: Readonly<Record<string, string>> = {
  marginleft: "marginLeft", marginright: "marginRight", margintop: "marginTop", marginbottom: "marginBottom",
  safearealeft: "safeAreaLeft", safearearight: "safeAreaRight", safeareatop: "safeAreaTop", safeareabottom: "safeAreaBottom",
};

function publicDetailName(type: string, name: string): string {
  if ((type === "beforeEnter" || type === "entered" || type === "left") && name === "actorid") return "actorId";
  if ((type === "beforeEnter" || type === "entered" || type === "left") && name === "boardkey") return "boardKey";
  if (type === "statusChanged" && name === "previousrounds") return "previousRounds";
  if (type === "viewportResized" && Object.hasOwn(VIEWPORT_DETAIL_NAMES, name)) return VIEWPORT_DETAIL_NAMES[name]!;
  if ((type === "started" || type === "stopped" || type === "ended" || type === "looped" || type === "paused" || type === "resumed" || type === "faded") && name === "cueid") return "cueId";
  return name;
}
/**
 * Read the event object `value` (the argument the dispatcher gives a listener command)
 * from `state`, or `undefined` when it is not an event object. The result is a copy.
 */
export function readEvent(state: GameState, value: Value | undefined): EventView | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") return undefined;
  const event = findObject(state.vm, value.handle);
  if (event === undefined || !Object.hasOwn(event.members, "cancelable") || !Object.hasOwn(event.members, "canceled")) return undefined;
  const type = readMember(event, "type");
  const target = readMember(event, "target");
  const detail = readMember(event, "detail");
  if (typeof type !== "string" || typeof target !== "object" || target === null || !("handle" in target)) return undefined;
  const fields: { [field: string]: PlainData } = {};
  const record = typeof detail === "object" && detail !== null && "handle" in detail ? findObject(state.vm, detail.handle) : undefined;
  const nativeDetail = state.events.nativeDetails?.[String(event.handle)];
  for (const name of record?.keys ?? []) {
    const value = nativeDetail !== undefined && Object.hasOwn(nativeDetail, name) ? nativeDetail[name]! : plainValue(state, record?.members[name]);
    Object.defineProperty(fields, publicDetailName(type, name), { value, writable: true, enumerable: true, configurable: true });
  }
  return {
    type,
    emitter: emitterKeyOf(state.events, target.handle),
    detail: fields,
    cancelable: readMember(event, "cancelable") === 1,
    canceled: readMember(event, "canceled") === 1,
  };
}

/**
 * The layer table: the command layers `registerPlugin` registers (MOD-4, PKG-5;
 * docs/spec/engine/rpgcode-modules-and-objects.md#registerplugin-layers-entry-198;
 * ADR 0004 decision 8; entry 19.8).
 *
 * **Session data, never state.** The owner rules that the layers a package
 * registers are rebuilt at every start-up and are not saved (MOD-4 point 3), so
 * the table lives in the script services beside the command registry, not in
 * `GameState`: nothing here is in a save or a state hash, and no schema or
 * compiler version moves (G1). It holds `Map`s because it is not state; every
 * walk is in insertion order, which the language fixes (G3).
 *
 * **One mechanism.** A layer is reached through the environment table's first
 * entry (FUN-8): where the VM looks for the callable the running scope holds
 * under a name, it offers the top layer of the name after it. `resolveCall`
 * receives the same single `held` callable it always did and gains no entry.
 * The wrapper a layer is, is a callable value whose `def` is `plugin.layer:<id>`,
 * a name no script can write (an identifier has no `:`), so it saves, copies and
 * is passed as `next` like any callable; running it is `performCallable`'s job.
 *
 * **Same ids on every start.** Layer ids `L<n>` and registration ids `R<n>` come
 * from one counter of the table. The same installed packages registering in the
 * same order on a fresh state make the same ids, which is what lets a saved
 * thread's `next` (a layer's id) find the rebuilt layer after a restore.
 */

import type { CallableValue } from "../ports/value.ts";
import type { ProgramRef } from "./program.ts";

/** The `def` prefix of a layer wrapper; the rest is the layer id. */
export const LAYER_PREFIX = "plugin.layer:";
/** The `def` prefix of a registration's `remove` callable; the rest is the registration id. */
export const REGISTRATION_PREFIX = "plugin.remove:";
/** One registered command interceptor and the binding it wraps. */
export type PluginLayer = {
  readonly id: string;
  readonly registration: string;
  readonly command: string;
  readonly interceptor: CallableValue;
  readonly below: CallableValue;
  removed: boolean;
};


/** One whole-screen provider in the unified per-screen registry. */
export type MenuProviderLayer =
  | {
      readonly id: string;
      readonly registration: string;
      readonly screen: string;
      readonly kind: "rpgcode";
      readonly provider: CallableValue;
      readonly order: number;
      removed: boolean;
    }
  | {
      readonly id: string;
      readonly registration: string;
      readonly screen: string;
      readonly kind: "native";
      readonly provider: import("./plugin.ts").MenuProvider;
      readonly order: number;
      removed: boolean;
    };

export type NativeMenuProviderRequest = {
  readonly id: string;
  readonly screen: string;
  readonly provider: import("./plugin.ts").MenuProvider;
};

export function addNativeMenuProvider(table: PluginLayers, request: NativeMenuProviderRequest): void {
  const id = request.id;
  const existing = table.menuLayers.get(id);
  if (existing !== undefined) {
    if (existing.kind !== "native" || existing.screen !== request.screen) {
      throw new Error(`menu provider identity "${id}" is already registered with a different kind or screen`);
    }
    // Services are rebuilt after package startup on restore. Keep the provider's
    // original slot so rebuilding cannot move it above a later RPGCode override.
    return;
  }
  const layer: MenuProviderLayer = {
    id, registration: id, screen: request.screen, kind: "native",
    provider: request.provider, order: ++table.menuOrder, removed: false,
  };
  table.menuLayers.set(id, layer);
  const stack = table.menuStacks.get(request.screen) ?? [];
  stack.push(id);
  table.menuStacks.set(request.screen, stack);
}

/** One `registerPlugin` call: its command and menu layers, in registration order. */
export type PluginRegistration = {
  readonly id: string;
  readonly name: string;
  readonly layers: readonly string[];
  readonly menuLayers: readonly string[];
};

/**
 * One enabled package's script-function export index entry (PKG-4; entry 19.21): the
 * package's startup program as it stood when its start-up finished. Session data, rebuilt by
 * package start-up at every boot and restore, never state.
 */
export type PackageExport = {
  /** The owning package name (`ProgramRef.owner`). */
  readonly name: string;
  /** The package's folded namespace, or `null` when the host named none. */
  readonly namespace: string | null;
  /** The startup program with the includes its own start-up performed. */
  ref: ProgramRef;
  /** False while the package's start-up still runs; only a sealed entry answers a lookup. */
  sealed: boolean;
};

/** The layers of one running game (see the file header). */
export type PluginLayers = {
  seq: number;
  menuOrder: number;
  readonly layers: Map<string, PluginLayer>;
  /** Per command, the live layer ids, bottom first. */
  readonly stacks: Map<string, string[]>;
  readonly registrations: Map<string, PluginRegistration>;
  readonly menuLayers: Map<string, MenuProviderLayer>;
  /** Per screen, the live menu provider layer ids, registration order. */
  readonly menuStacks: Map<string, string[]>;
  /** The packages' script-function exports, in manifest (start-up) order. */
  readonly exports: PackageExport[];
};

/** An empty layer table. */
export function createPluginLayers(): PluginLayers {
  return { seq: 0, menuOrder: 0, layers: new Map(), stacks: new Map(), registrations: new Map(), menuLayers: new Map(), menuStacks: new Map(), exports: [] };
}


/** Discard package layers after an aborted startup pass. */
export function clearPluginLayers(table: PluginLayers): void {
  table.seq = 0;
  table.menuOrder = 0;
  table.layers.clear();
  table.menuLayers.clear();
  table.menuStacks.clear();
  table.stacks.clear();
  table.registrations.clear();
  table.exports.length = 0;
}
/** Capture a restorable copy of a session layer table before a startup pass. */
export function snapshotPluginLayers(table: PluginLayers): PluginLayers {
  return {
    seq: table.seq,
    menuOrder: table.menuOrder,
    layers: new Map([...table.layers].map(([id, layer]) => [id, { ...layer, interceptor: copyCallable(layer.interceptor), below: copyCallable(layer.below) }])),
    stacks: new Map([...table.stacks].map(([command, ids]) => [command, [...ids]])),
    registrations: new Map([...table.registrations].map(([id, registration]) => [id, { ...registration, layers: [...registration.layers], menuLayers: [...registration.menuLayers] }])),
    menuLayers: new Map([...table.menuLayers].map(([id, layer]) => [
      id,
      layer.kind === "rpgcode" ? { ...layer, provider: copyCallable(layer.provider) } : { ...layer },
    ])),
    menuStacks: new Map([...table.menuStacks].map(([screen, ids]) => [screen, [...ids]])),
    exports: table.exports.map((entry) => ({ ...entry })),
  };
}

/** Restore a session layer table to a pre-startup snapshot without replacing its object. */
export function restorePluginLayers(table: PluginLayers, snapshot: PluginLayers): void {
  table.menuOrder = snapshot.menuOrder;
  table.seq = snapshot.seq;
  table.layers.clear();
  for (const [id, layer] of snapshot.layers) table.layers.set(id, { ...layer, interceptor: copyCallable(layer.interceptor), below: copyCallable(layer.below) });
  table.stacks.clear();
  for (const [command, ids] of snapshot.stacks) table.stacks.set(command, [...ids]);
  table.registrations.clear();
  for (const [id, registration] of snapshot.registrations) table.registrations.set(id, { ...registration, layers: [...registration.layers], menuLayers: [...registration.menuLayers] });
  table.menuLayers.clear();
  for (const [id, layer] of snapshot.menuLayers) {
    table.menuLayers.set(id, layer.kind === "rpgcode" ? { ...layer, provider: copyCallable(layer.provider) } : { ...layer });
  }
  table.menuStacks.clear();
  for (const [screen, ids] of snapshot.menuStacks) table.menuStacks.set(screen, [...ids]);
  table.exports.length = 0;
  for (const entry of snapshot.exports) table.exports.push({ ...entry });
}
/** The layer id a `def` names, or `null` when `def` is not a layer wrapper. */
export function layerIdOf(def: string): string | null {
  return def.startsWith(LAYER_PREFIX) ? def.slice(LAYER_PREFIX.length) : null;
}

/** The registration id a `def` names, or `null` when `def` is not a `remove` callable. */
export function registrationIdOf(def: string): string | null {
  return def.startsWith(REGISTRATION_PREFIX) ? def.slice(REGISTRATION_PREFIX.length) : null;
}

/** Whether `def` is one of the table's own definitions (a wrapper or a `remove`). */
export function isLayerDef(def: string): boolean {
  return def.startsWith(LAYER_PREFIX) || def.startsWith(REGISTRATION_PREFIX);
}

/** The wrapper callable of layer `id`. */
export function layerHandle(id: string): CallableValue {
  return { type: "callable", def: `${LAYER_PREFIX}${id}`, captures: [], receiver: null };
}

/** The `remove` callable of registration `id`. */
export function removeHandle(id: string): CallableValue {
  return { type: "callable", def: `${REGISTRATION_PREFIX}${id}`, captures: [], receiver: null };
}

/** The wrapper of the top live layer of `command`, or `undefined` when it has none. */
export function topLayerHandle(table: PluginLayers, command: string): CallableValue | undefined {
  if (table.stacks.size === 0) return undefined;
  const stack = table.stacks.get(command);
  const top = stack?.[stack.length - 1];
  return top === undefined ? undefined : layerHandle(top);
}

/** One command a registration wraps: its interceptor and the engine's own binding (needed only while no layer is registered for it). */
export type LayerRequest = {
  readonly command: string;
  readonly interceptor: CallableValue;
  readonly engine: CallableValue | undefined;
};
export type MenuProviderRequest = { readonly screen: string; readonly provider: CallableValue };

/** Top live provider in registration order for one screen. */
export function topMenuProvider(table: PluginLayers, screen: string): MenuProviderLayer | undefined {
  const stack = table.menuStacks.get(screen);
  let top: MenuProviderLayer | undefined;
  for (const id of stack ?? []) {
    const layer = table.menuLayers.get(id);
    if (layer !== undefined && !layer.removed && (top === undefined || layer.order > top.order)) top = layer;
  }
  return top;
}

/**
 * Register `requests` in order as one registration. Each layer's `below` is the
 * top layer already registered for its command, else the engine's binding the
 * request carries, so a later registration of a command is its outer layer.
 */
export function addRegistration(
  table: PluginLayers,
  name: string,
  requests: readonly LayerRequest[],
  menuRequests: readonly MenuProviderRequest[] = [],
): PluginRegistration {
  table.seq += 1;
  const id = `R${table.seq}`;
  const made: string[] = [];
  for (const request of requests) {
    table.seq += 1;
    const layerId = `L${table.seq}`;
    const below = topLayerHandle(table, request.command) ?? request.engine;
    if (below === undefined) {
      throw new Error(`plugin layer for "${request.command}" has no layer or engine binding below it`);
    }
    table.layers.set(layerId, {
      id: layerId,
      registration: id,
      command: request.command,
      interceptor: copyCallable(request.interceptor),
      below,
      removed: false,
    });
    const stack = table.stacks.get(request.command) ?? [];
    stack.push(layerId);
    table.stacks.set(request.command, stack);
    made.push(layerId);
  }
  const madeMenus: string[] = [];
  for (const request of menuRequests) {
    table.seq += 1;
    const layerId = `M${table.seq}`;
    table.menuLayers.set(layerId, {
      id: layerId, registration: id, screen: request.screen,
      provider: copyCallable(request.provider), kind: "rpgcode",
      order: ++table.menuOrder, removed: false,
    });
    const stack = table.menuStacks.get(request.screen) ?? [];
    stack.push(layerId);
    table.menuStacks.set(request.screen, stack);
    madeMenus.push(layerId);
  }
  const registration: PluginRegistration = { id, name, layers: made, menuLayers: madeMenus };
  table.registrations.set(id, registration);
  return registration;
}

/**
 * Remove every layer of registration `id` from its command (for this session):
 * the layer is marked removed, so a handle that names it still reaches the layer
 * below, and leaves its command's stack. Returns `1` when a layer was removed,
 * `0` when all were already removed, and `null` when the table has no such
 * registration.
 */
export function removeRegistration(table: PluginLayers, id: string): 0 | 1 | null {
  const registration = table.registrations.get(id);
  if (registration === undefined) return null;
  let removed: 0 | 1 = 0;
  for (const layerId of registration.layers) {
    const layer = table.layers.get(layerId);
    if (layer === undefined || layer.removed) continue;
    layer.removed = true;
    removed = 1;
    const stack = table.stacks.get(layer.command);
    if (stack === undefined) continue;
    const at = stack.indexOf(layerId);
    if (at >= 0) stack.splice(at, 1);
    if (stack.length === 0) table.stacks.delete(layer.command);
  }
  for (const layerId of registration.menuLayers) {
    const layer = table.menuLayers.get(layerId);
    if (layer === undefined || layer.removed) continue;
    layer.removed = true;
    removed = 1;
    const stack = table.menuStacks.get(layer.screen);
    if (stack === undefined) continue;
    const at = stack.indexOf(layerId);
    if (at >= 0) stack.splice(at, 1);
    if (stack.length === 0) table.menuStacks.delete(layer.screen);
  }
  return removed;
}

/**
 * The script values the table keeps alive: the interceptor of every live layer and
 * every `below`. The end-of-tick pass takes them as roots, so a closure's cells and a
 * bound receiver stay while a layer can still call them (R-34, entry 18.6).
 */
export function layerRoots(table: PluginLayers): readonly CallableValue[] {
  const roots: CallableValue[] = [];
  for (const layer of table.layers.values()) {
    if (!layer.removed) roots.push(layer.interceptor);
    roots.push(layer.below);
  }
  for (const layer of table.menuLayers.values()) if (!layer.removed && layer.kind === "rpgcode") roots.push(layer.provider);
  return roots;
}

function copyCallable(value: CallableValue): CallableValue {
  return {
    type: "callable",
    def: value.def,
    captures: [...value.captures],
    receiver: value.receiver,
    ...(value.owner === undefined ? {} : { owner: value.owner }),
  };
}

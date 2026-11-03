/**
 * The program-aware half of a restored save's callable check (FUN-8; entry 18.6,
 * docs/spec/engine/rpgcode-language.md#keywords-and-structure).
 *
 * `restoreGameState` checks a snapshot's shape with no program to hand. A
 * callable names its definition by `def` only, and compiled programs are not
 * saved, so whether the game still has that definition, and how many names it
 * captures, can be answered only once the host has rebuilt its services. This
 * function answers it: it compiles the program of every frame, object record and
 * owner in `vm.defOwners`, then checks each callable against what it found. An
 * object record has no instruction position to resume, so a changed file-backed
 * class program is rebuilt from current source with its saved include list. Every
 * failure is a typed `ScriptError` whose message names the place in the save;
 * nothing is repaired, and a state with no named program compiles nothing.
 */

import type { CallableValue } from "../ports/value.ts";
import type { ProgramCache } from "./cache.ts";
import { eachRootValue, isCallableRecord } from "./cells.ts";
import { RESTORE_CALLABLE_CAPTURES, RESTORE_CALLABLE_RECEIVER, RESTORE_CALLABLE_UNKNOWN_DEF, ScriptError } from "./errors.ts";
import { isLayerDef } from "./layers.ts";
import { parseHostMethodDef } from "./host.ts";
import { programKey, restartProgramRef, type Program, type ProgramLoader, type ProgramRef } from "./program.ts";
import type { CommandLookup } from "./registry.ts";
import type { VmState } from "./state.ts";
import { ITEM_ACTION_ASSET_COMMAND, type ItemActionRecord } from "./item-action.ts";
import type { EventsSection } from "../events/model.ts";
import type { HostObjectType } from "./host.ts";

/** What the check needs of the host's services. */
export type RestoreCheckServices = {
  readonly programs: ProgramCache;
  readonly commands: CommandLookup;
  readonly hostTypes?: ReadonlyMap<string, HostObjectType>;
  readonly menuProviders?: ReadonlyMap<string, unknown>;
  readonly menuProviderIdentityExists?: (id: string) => boolean;
};

/** A short name for a program in a message: its path, or `<inline>`. */
function describeProgram(ref: ProgramRef): string {
  return ref.kind === "file" ? ref.path : "<inline>";
}

/**
 * Compile every program a restored state names, and prove every thread restart
 * will compile. `verifyRestoredHandles` only compiles when the state holds a
 * callable, so a game load calls this as well; otherwise a frame naming a program
 * file or include the game no longer has would load and then throw from the next
 * tick, after the live game was already replaced.
 *
 * A changed source (`restore.source-changed`) is tolerated because that one thread
 * restarts from source, but the restart is exactly what will run next, so it is
 * built the way `restartThreadFromSource` builds it (`restartProgramRef`) and
 * compiled here: a syntax error in the new file, a missing literal include, or a
 * saved run-time include that was removed refuses the load now. Any other failure
 * (`program.missing`, a bad include) also refuses it. A thread from an older
 * instruction version was already restarted by `restoreGameState`, so its frame
 * names current source; an object record or definition owner carries no position
 * and is compiled from its saved source whatever its `ir` says.
 */
export function compileRestoredPrograms(
  vm: VmState,
  services: Pick<RestoreCheckServices, "programs"> & { readonly loader?: ProgramLoader },
): void {
  for (const thread of vm.threads) {
    let restarts = false;
    for (const frame of thread.frames) {
      try {
        services.programs.get(frame.program);
      } catch (error) {
        if (!(error instanceof ScriptError) || error.code !== "restore.source-changed") throw error;
        restarts = true;
      }
    }
    const root = thread.frames[0]?.program;
    if (restarts && root !== undefined) services.programs.get(restartProgramRef(root, services.loader, vm.redirects));
  }
  for (const object of vm.objects) {
    const ref = object.program;
    if (ref === null) continue;
    try {
      services.programs.get(ref);
    } catch (error) {
      if (!(error instanceof ScriptError) || error.code !== "restore.source-changed") throw error;
      services.programs.get(restartProgramRef(ref, services.loader, vm.redirects));
    }
  }
  for (const owner of Object.values(vm.defOwners ?? {})) {
    try {
      services.programs.get(owner);
    } catch (error) {
      if (!(error instanceof ScriptError) || error.code !== "restore.source-changed") throw error;
    }
  }
}

/**
 * Check every callable in `vm` against the programs and commands the host has
 * (entry 18.6). The definition must be defined by a compiled program or be a
 * command, its capture count must equal the handle's (a command captures none),
 * and each `vm.defOwners` entry's program must define the `def` it is recorded
 * for. A program whose source changed since the save is skipped: its thread
 * restarts from source on its next turn, so a definition only that program had is
 * reported unknown, with the program named.
 * The listeners of the `events` section, when given, are callables like any other (EMIT-15).
 */
export function verifyRestoredHandles(vm: VmState, services: RestoreCheckServices, events?: EventsSection): void {
  const callables: Array<{ readonly path: string; readonly value: CallableValue }> = [];
  const collect = (path: string, value: unknown): void => {
    if (isCallableRecord(value)) callables.push({ path, value });
  };
  eachRootValue(vm, collect, () => undefined);
  for (const id of Object.keys(vm.cells ?? {})) collect(`vm.cells.${id}`, vm.cells?.[id]);
  for (const [index, listener] of (events?.listeners ?? []).entries()) collect(`events.listeners[${index}].callable`, listener.callable);
  for (const thread of vm.threads) {
    const continuations: unknown[] = [];
    const wait = thread.wait;
    if (wait?.kind === "menu.screen" && wait.payload[0] !== null && typeof wait.payload[0] === "object" && !Array.isArray(wait.payload[0])) {
      continuations.push(wait.payload[0]);
    }
    for (const frame of thread.frames) {
      if (frame.menuContinuation !== undefined) continuations.push(frame.menuContinuation);
      for (const entry of frame.itemActions ?? []) {
        const record = entry as unknown as ItemActionRecord;
        if (record.provider !== null) continuations.push(record.provider);
        // Definitions live in the engine's session cache, which a save does not carry: forget what this run
        // already asked for, so a restore with a cold cache requests the missing definitions again.
        record.requested = [];
      }
    }
    const asking = thread.wait;
    if (asking?.kind === "request" && asking.then?.command === ITEM_ACTION_ASSET_COMMAND) {
      // An unanswered request cannot be restored: resume the action as if its reply had arrived, so it re-requests.
      thread.wait = null;
      thread.status = "ready";
      thread.pending = { command: ITEM_ACTION_ASSET_COMMAND, args: [1, ""], file: asking.file, line: asking.line };
    }
    for (const candidate of continuations) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new ScriptError("restore.menu-provider", `the snapshot's thread ${thread.id} menu continuation is malformed`);
      }
      const continuation = candidate as Record<string, unknown>;
      const providerIds: string[] = [];
      if (Object.hasOwn(continuation, "providerId")) {
        if (typeof continuation.providerId !== "string") {
          throw new ScriptError("restore.menu-provider", `the snapshot's thread ${thread.id} menu provider identity is malformed`);
        }
        providerIds.push(continuation.providerId);
      }
      if (Object.hasOwn(continuation, "parents")) {
        if (!Array.isArray(continuation.parents)) {
          throw new ScriptError("restore.menu-provider", `the snapshot's thread ${thread.id} menu parent continuations are malformed`);
        }
        for (const [index, parent] of continuation.parents.entries()) {
          if (parent === null || typeof parent !== "object" || Array.isArray(parent) || typeof parent.providerId !== "string") {
            throw new ScriptError("restore.menu-provider", `the snapshot's thread ${thread.id} menu parent ${index} identity is malformed`);
          }
          providerIds.push(parent.providerId);
        }
      }
      for (const providerId of providerIds) {
        if (services.menuProviderIdentityExists?.(providerId) !== true && services.menuProviders?.has(providerId) !== true) {
          throw new ScriptError("restore.menu-provider", `the snapshot's thread ${thread.id} menu provider "${providerId}" is not registered`);
        }
      }
    }
  }
  for (const { path, value } of callables) {
    if (value.receiver === null) continue;
    const handle = Number(value.receiver);
    if (!Number.isSafeInteger(handle) || !vm.objects.some((record) => record.handle === handle)) {
      throw new ScriptError(
        RESTORE_CALLABLE_RECEIVER,
        `the snapshot's ${path}.receiver names no live object handle`,
      );
    }
  }
  const owners = vm.defOwners ?? {};
  const ownerDefs = Object.keys(owners);
  if (callables.length === 0 && ownerDefs.length === 0) return;

  // Compile every program the state names, in a fixed order: the frames of each
  // thread in turn, then the owners by definition.
  const refs = new Map<string, ProgramRef>();
  for (const thread of vm.threads) {
    for (const frame of thread.frames) refs.set(programKey(frame.program), frame.program);
  }
  for (const def of ownerDefs) refs.set(programKey(owners[def]!), owners[def]!);
  const compiled: Program[] = [];
  const skipped = new Set<string>();
  const changed: string[] = [];
  for (const [key, ref] of refs) {
    try {
      compiled.push(services.programs.get(ref));
    } catch (error) {
      if (!(error instanceof ScriptError) || error.code !== "restore.source-changed") throw error;
      skipped.add(key);
      changed.push(describeProgram(ref));
    }
  }
  const hint = changed.length === 0 ? "" : ` (changed since the save and not compiled: ${changed.join(", ")})`;

  for (const def of ownerDefs) {
    const ref = owners[def]!;
    if (skipped.has(programKey(ref))) continue;
    if (!Object.hasOwn(services.programs.get(ref).functions, def)) {
      throw new ScriptError(
        RESTORE_CALLABLE_UNKNOWN_DEF,
        `the snapshot's vm.defOwners.${def} names the program "${describeProgram(ref)}", which does not define "${def}"`,
      );
    }
  }

  for (const { path, value } of callables) {
    const hydrated = parseHostMethodDef(value.def);
    if (hydrated !== null) {
      if (value.captures.length !== 0) {
        throw new ScriptError(
          RESTORE_CALLABLE_CAPTURES,
          `the snapshot's ${path} names ${value.captures.length} cell(s), but "${value.def}" is a hydrated host method and captures nothing`,
        );
      }
      continue;
    }
    // A layer wrapper or a `remove` handle names the layer table of the running game, which package
    // start-up rebuilds and a save never holds (entry 19.8): the table answers when the handle is called.
    if (isLayerDef(value.def)) {
      if (value.captures.length !== 0) {
        throw new ScriptError(
          RESTORE_CALLABLE_CAPTURES,
          `the snapshot's ${path} names ${value.captures.length} cell(s), but "${value.def}" is a plugin layer handle and captures nothing`,
        );
      }
      continue;
    }
    // Every compiled program that defines the name, not only the first: two inline
    // programs can share a lambda's `def`, and a handle is valid when its own
    // program's definition agrees with it.
    const candidates = compiled.filter((program) => Object.hasOwn(program.functions, value.def));
    const found = services.programs.find(value.def);
    if (found !== undefined && !candidates.includes(found)) candidates.push(found);
    if (candidates.length > 0) {
      const infos = candidates.flatMap((program) => program.functions[value.def]!.filter((info) => info.entry >= 0));
      if (infos.length === 0) {
        throw new ScriptError(
          RESTORE_CALLABLE_UNKNOWN_DEF,
          `the snapshot's ${path} names "${value.def}", which no compiled program defines with a body${hint}`,
        );
      }
      if (!infos.some((info) => (info.captures?.length ?? 0) === value.captures.length)) {
        throw new ScriptError(
          RESTORE_CALLABLE_CAPTURES,
          `the snapshot's ${path} names ${value.captures.length} cell(s), but the definition "${value.def}" captures ${infos[0]!.captures?.length ?? 0} name(s); the handle was made by an older build`,
        );
      }
      continue;
    }
    if (services.commands.get(value.def) !== undefined) {
      if (value.captures.length !== 0) {
        throw new ScriptError(
          RESTORE_CALLABLE_CAPTURES,
          `the snapshot's ${path} names ${value.captures.length} cell(s), but "${value.def}" is a command and captures nothing`,
        );
      }
      continue;
    }
    throw new ScriptError(
      RESTORE_CALLABLE_UNKNOWN_DEF,
      `the snapshot's ${path} names "${value.def}", which is defined by no compiled program and is no command${hint}`,
    );
  }
}

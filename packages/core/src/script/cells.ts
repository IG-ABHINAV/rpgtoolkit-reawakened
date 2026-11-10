/**
 * Closure cells and the places a script value lives (FUN-8; ADR 0004 decision 8;
 * entry 18.6, docs/spec/engine/rpgcode-language.md#keywords-and-structure).
 *
 * `vm.cells` holds the private storage of the closures, by id, and a callable
 * value names its cells in `captures`. Four things need to know where a value
 * or a cell reference can sit in the `vm` section, so they share one walker,
 * `eachRootValue`: the cell collector below, the load-time shape check
 * (`core/save/handles.ts`) and the program-aware check (`restore-check.ts`).
 *
 * Everything here is a plain function over plain data (G1) with no clock, no
 * randomness and no iteration order the language leaves open (G3).
 */

import type { CallableValue, Value } from "../ports/value.ts";
import type { ProgramRef } from "./program.ts";
import type { VmState } from "./state.ts";

/** The text of a cell reference's scope, `cell:<id>` (see `cellRef`). */
const CELL_REF_PREFIX = "cell:";

/** Legacy prefix for lambdas lowered before inline package startups were owner-qualified (#1673, #1676). */
const INLINE_LAMBDA_PREFIX = "<inline>#";

function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

/** The id a cell number is written as: `cell` and a positive whole number with no leading zero. */
const CELL_ID = /^cell[1-9][0-9]*$/;

/** The cell number of `id` (`cell12` is 12), or `null` when `id` is not an id the VM issues. */
export function cellNumber(id: string): number | null {
  if (!CELL_ID.test(id)) return null;
  const number = Number(id.slice(4));
  return Number.isSafeInteger(number) ? number : null;
}

/** The cell id a `cell:<id>` reference names, or `null` when `ref` is not one. */
export function cellIdOfRef(ref: unknown): string | null {
  return typeof ref === "string" && ref.startsWith(CELL_REF_PREFIX) ? ref.slice(CELL_REF_PREFIX.length) : null;
}

/** Whether `value` is a plain JSON object (not `null`, not an array); its fields stay `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `value`, which may be a raw parsed snapshot value, is a callable record
 * with the two fields the cell walkers read, a `def` text and a `captures` list.
 * The load-time shape check has already refused anything less whole.
 */
export function isCallableRecord(value: unknown): value is CallableValue {
  return (
    isRecord(value) &&
    value.type === "callable" &&
    typeof value.def === "string" &&
    Array.isArray(value.captures)
  );
}

/**
 * Visit every place outside the cell table where a script `Value` or a
 * variable reference sits in a `vm` section, with the path that names the place
 * (`vm.threads[0].frames[1].locals.n.value`). These are the roots a cell is
 * reached from: the globals, the members of every object, and each frame's
 * locals, operands and return value, plus a wait's resume references and
 * stored reply. `vm.cells` is not visited: a cell's value is reached only
 * through the cell.
 *
 * It reads a state that may be a raw parsed snapshot, so it skips whatever is
 * not the expected container instead of throwing; the shape check reports it.
 */
export function eachRootValue(
  vm: Readonly<Record<string, unknown>>,
  onValue: (path: string, value: unknown) => void,
  onRef: (path: string, ref: unknown) => void,
): void {
  walkRoots(vm, onValue, onRef, true, true);
}

/**
 * The same walk without the members of the objects: the places a running script
 * reaches an object from (R-34, entry 19.5), where the members of an object count
 * only once the object itself is reached. It runs every tick, so it names no place:
 * every `path` it passes is `""`.
 */
export function eachLiveRoot(
  vm: Readonly<Record<string, unknown>>,
  onValue: (path: string, value: unknown) => void,
  onRef: (path: string, ref: unknown) => void,
): void {
  walkRoots(vm, onValue, onRef, false, false);
}

function walkRoots(
  vm: Readonly<Record<string, unknown>>,
  onValue: (path: string, value: unknown) => void,
  onRef: (path: string, ref: unknown) => void,
  objectMembers: boolean,
  paths: boolean,
): void {
  const table = (base: string, entries: unknown): void => {
    if (!isRecord(entries)) return;
    for (const name of Object.keys(entries)) onValue(paths ? `${base}.${name}` : "", entries[name]);
  };
  table("vm.globals", vm.globals);
  if (objectMembers && Array.isArray(vm.objects)) {
    vm.objects.forEach((record: unknown, index) => {
      if (isRecord(record)) table(`vm.objects[${index}].members`, record.members);
    });
  }
  if (!Array.isArray(vm.threads)) return;
  vm.threads.forEach((thread: unknown, threadIndex) => {
    if (!isRecord(thread)) return;
    const base = paths ? `vm.threads[${threadIndex}]` : "";
    const wait = thread.wait;
    if (isRecord(wait)) {
      if (Array.isArray(wait.resumeRefs)) {
        wait.resumeRefs.forEach((ref: unknown, index) => onRef(paths ? `${base}.wait.resumeRefs[${index}]` : "", ref));
      }
      if (isRecord(wait.reply) && Object.hasOwn(wait.reply, "value")) {
        onValue(paths ? `${base}.wait.reply.value` : "", wait.reply.value);
      }
      if (wait.kind === "audio.track" && Array.isArray(wait.payload)) {
        // Return value and pending-start voice are both saveable object roots.
        for (let index = 1; index < wait.payload.length; index += 1) {
          onValue(paths ? `${base}.wait.payload[${index}]` : "", wait.payload[index]);
        }
      }
    }
    if (!Array.isArray(thread.frames)) return;
    thread.frames.forEach((frame: unknown, frameIndex) => {
      if (!isRecord(frame)) return;
      const at = paths ? `${base}.frames[${frameIndex}]` : "";
      if (isRecord(frame.locals)) {
        for (const name of Object.keys(frame.locals)) {
          const slot = frame.locals[name];
          if (!isRecord(slot)) continue;
          onValue(paths ? `${at}.locals.${name}.value` : "", slot.value);
          onRef(paths ? `${at}.locals.${name}.ref` : "", slot.ref);
        }
      }
      if (Array.isArray(frame.operands)) {
        frame.operands.forEach((arg: unknown, index) => {
          if (!isRecord(arg)) return;
          onValue(paths ? `${at}.operands[${index}].value` : "", arg.value);
          onRef(paths ? `${at}.operands[${index}].ref` : "", arg.ref);
        });
      }
      if (Object.hasOwn(frame, "returnValue")) onValue(paths ? `${at}.returnValue` : "", frame.returnValue);
    });
  });
}

/**
 * Record `ref` as the program that owns the definition `def` (FUN-8; entry
 * 18.6), unless one is already recorded: the first owner stays. A callable
 * names its definition only by `def`, and a restore rebuilds only the programs
 * its frames name, so this is what lets it find the program of a callable whose
 * creating program has ended.
 */
export function recordOwner(vm: VmState, def: string, ref: ProgramRef): void {
  const owners = (vm.defOwners ??= {});
  if (Object.hasOwn(owners, def)) return;
  Object.defineProperty(owners, def, { value: ref, writable: true, enumerable: true, configurable: true });
}

/**
 * Rewrite pre-#1673 inline package startup lambda definitions (`<inline>#lambda_n`)
 * to their owner-qualified form (`<package:owner>#lambda_n`) across `vm` and `events` (#1676).
 */
export function migratePackageInlineLambdaDefs(vm: unknown, events?: unknown): void {
  if (!isRecord(vm)) return;
  const knownInlineRefs = new Map<string, Record<string, unknown>>();
  let hasUnownedInlineProgram = false;
  const inspectProgramRef = (ref: unknown): void => {
    if (!isRecord(ref) || ref.kind !== "inline" || typeof ref.text !== "string" || typeof ref.ir !== "string") return;
    if (typeof ref.owner === "string" && ref.owner !== "") {
      if (!knownInlineRefs.has(ref.owner)) knownInlineRefs.set(ref.owner, ref);
    } else if (ref.owner === undefined) {
      hasUnownedInlineProgram = true;
    }
  };
  if (Array.isArray(vm.threads)) {
    for (const thread of vm.threads) {
      if (!isRecord(thread) || !Array.isArray(thread.frames)) continue;
      for (const frame of thread.frames) {
        if (isRecord(frame)) inspectProgramRef(frame.program);
      }
    }
  }
  if (Array.isArray(vm.objects)) {
    for (const object of vm.objects) {
      if (isRecord(object)) inspectProgramRef(object.program);
    }
  }
  const migratedByDef = new Map<string, { readonly nextDef: string; readonly owner: string; readonly ref: Record<string, unknown> }>();
  if (isRecord(vm.defOwners)) {
    const currentOwners = vm.defOwners;
    for (const ref of Object.values(currentOwners)) inspectProgramRef(ref);
    const nextOwners: Record<string, unknown> = {};
    let changed = false;
    for (const [def, ref] of Object.entries(currentOwners)) {
      if (
        def.startsWith(INLINE_LAMBDA_PREFIX) &&
        isRecord(ref) &&
        ref.kind === "inline" &&
        typeof ref.text === "string" &&
        typeof ref.ir === "string" &&
        typeof ref.owner === "string" &&
        ref.owner !== ""
      ) {
        const nextDef = `<package:${ref.owner}>#${def.slice(INLINE_LAMBDA_PREFIX.length)}`;
        migratedByDef.set(def, { nextDef, owner: ref.owner, ref });
        if (!Object.hasOwn(nextOwners, nextDef)) setOwnProperty(nextOwners, nextDef, ref);
        changed = true;
      } else if (!Object.hasOwn(nextOwners, def)) {
        setOwnProperty(nextOwners, def, ref);
      }
    }
    if (changed) vm.defOwners = nextOwners;
  }

  const migrateCallable = (value: unknown): void => {
    if (!isCallableRecord(value) || !value.def.startsWith(INLINE_LAMBDA_PREFIX)) return;
    const raw = value as unknown as Record<string, unknown>;
    const explicitOwner = typeof raw.owner === "string" && raw.owner !== "" ? raw.owner : undefined;
    const fallback = explicitOwner === undefined && !hasUnownedInlineProgram ? migratedByDef.get(value.def) : undefined;
    const owner = explicitOwner ?? fallback?.owner;
    if (owner === undefined) return;
    const nextDef = `<package:${owner}>#${value.def.slice(INLINE_LAMBDA_PREFIX.length)}`;
    raw.def = nextDef;
    if (explicitOwner === undefined && Object.keys(raw).sort().join(",") === "captures,def,receiver,type") {
      raw.owner = owner;
    }
    if (isRecord(vm.defOwners) && !Object.hasOwn(vm.defOwners, nextDef)) {
      const ref = knownInlineRefs.get(owner) ?? fallback?.ref;
      if (ref !== undefined) setOwnProperty(vm.defOwners, nextDef, ref);
    }
  };

  eachRootValue(vm, (_path, value) => migrateCallable(value), () => undefined);
  if (isRecord(vm.cells)) {
    for (const id of Object.keys(vm.cells)) migrateCallable(vm.cells[id]);
  }
  if (isRecord(events) && Array.isArray(events.listeners)) {
    for (const listener of events.listeners) {
      if (isRecord(listener)) migrateCallable(listener.callable);
    }
  }
}

/**
 * Free every closure cell that no script can reach any more, and drop the
 * `vm.defOwners` entry of every definition no reachable callable names (FUN-8;
 * entry 18.6). Run once per tick, just before the object pass, so a cell that
 * only a dead cell's callable named goes with it and an object that only a freed
 * cell named is freed by the same tick's object pass (R-34).
 *
 * A cell is reachable when a root names it — a callable's `captures` entry or a
 * `cell:` reference in a frame slot, an operand or a wait's resume references —
 * or when another reachable cell's value is a callable that captures it.
 * Reachability, not a count, decides it, so a recursive local lambda, whose
 * cell holds a callable that captures that same cell, is freed with nothing
 * outside naming it. `vm.cellSeq` is not touched, so an id is never issued
 * twice. A state with no cell and no `vm.defOwners` is left alone. `roots` are
 * script values kept outside the `vm` section (the listener table of the `events`
 * section, EMIT-14), which count as roots too.
 */
export function collectCells(vm: VmState, roots: readonly unknown[] = []): void {
  const owners = vm.defOwners;
  const cells = vm.cells;
  if (cells === undefined && owners === undefined) return;
  const table: { [id: string]: Value } = cells ?? {};
  const live = new Set<string>();
  const liveDefs = new Set<string>();
  const pending: string[] = [];
  const reach = (id: string | null): void => {
    if (id === null || id === "" || live.has(id) || !Object.hasOwn(table, id)) return;
    live.add(id);
    pending.push(id);
  };
  const visit = (value: unknown): void => {
    if (!isCallableRecord(value)) return;
    liveDefs.add(value.def);
    for (const id of value.captures) reach(id);
  };
  eachRootValue(
    vm,
    (_path, value) => visit(value),
    (_path, ref) => reach(cellIdOfRef(ref)),
  );
  for (const root of roots) visit(root);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) visit(table[id]);
  for (const id of Object.keys(table)) {
    if (!live.has(id)) delete table[id];
  }
  if (owners !== undefined) {
    for (const def of Object.keys(owners)) {
      if (!liveDefs.has(def)) delete owners[def];
    }
  }
}

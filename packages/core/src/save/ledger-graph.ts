/**
 * The script half of the game ledger: the shared `ledger.*` failure type, the
 * plain-data encodings the projection uses, and the pure walker that turns a
 * `vm` section into the ledger's `script` projection.
 *
 * The walker is deliberately not the runtime collector. `collectCells` and
 * `collectGarbage` answer "can a running script still reach this?" and mutate
 * the live tables; their root set is every frame, wait, listener and plugin
 * layer. The ledger answers a different question — "is this saved value game
 * progress that must outlive the continuation?" — and its one root is
 * `vm.globals` (docs/spec/formats/save-game.md#game-ledger-and-savable-continuation,
 * resolved decision 1). From there it follows object handles, each reached
 * object's members in `keys` order, a callable's captured cells, a callable's
 * receiver object and the values of reached cells. `vm.cellSeq` is carried as
 * the issued-id high-water mark so a projected ledger can never alias a live
 * reference, and `events.emitters` entries whose object handle was reached are
 * carried because a host object's owner binding lives there.
 *
 * Nothing here mutates the state it reads, and every failure is a located
 * `GameLedgerError` naming the path in the candidate. An unreached record is
 * never validated: only the reached projection has to be whole.
 */

import type { Value } from "../ports/value.ts";
import { cellNumber, isRecord } from "../script/cells.ts";
import type { VmState } from "../script/state.ts";

/** A candidate that cannot be projected: the ledger is never built from it. */
export const LEDGER_SHAPE = "ledger.shape";
/** A live reference the ledger would have to keep names nothing in the candidate. */
export const LEDGER_REFERENCE = "ledger.reference";
/** Two records, counters or orderings would alias one identity. */
export const LEDGER_IDENTITY = "ledger.identity";
/** The board or a board-owned placement disagrees with its authored source. */
export const LEDGER_BOARD = "ledger.board";

/**
 * A located projection failure (docs/spec/formats/save-game.md#game-ledger-and-savable-continuation).
 * `code` is one of the `ledger.*` constants above and `path` names the place in
 * the candidate, so a host reports the same style of diagnostic as the restore
 * checks without joining their taxonomy.
 */
export class GameLedgerError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "GameLedgerError";
    this.code = code;
    this.path = path;
  }
}

/** Fail the candidate with a located `ledger.*` diagnostic. */
export function failLedger(code: string, path: string, message: string): never {
  throw new GameLedgerError(code, path, message);
}

/**
 * An explicit three-way encoding for a source field that can be absent, `null`
 * or present: a projection never leaves a key out and never emits `undefined`,
 * so a missing board, an explicit `null` board and an empty one stay distinct.
 */
export type LedgerPresence<T> =
  | { readonly state: "absent" }
  | { readonly state: "null" }
  | { readonly state: "present"; readonly value: T };

/** A script number that is not a JSON number, in the engine's one tagged form (AD-7, AD-11). */
export type LedgerTaggedNumber =
  | { readonly t: "nan" }
  | { readonly t: "inf" }
  | { readonly t: "-inf" };

/** A live object handle as the ledger stores it: identity only, no members inline. */
export type LedgerObjectValue = {
  readonly kind: "object";
  readonly handle: number;
  readonly className: string;
};

/** A first-class callable as the ledger stores it; `owner` is explicit, never absent. */
export type LedgerCallableValue = {
  readonly type: "callable";
  readonly def: string;
  readonly captures: string[];
  readonly receiver: string | null;
  readonly owner: string | null;
};

/** One projected script value. */
export type LedgerValue =
  | null
  | number
  | string
  | LedgerTaggedNumber
  | LedgerObjectValue
  | LedgerCallableValue;

/** A program reference with every optional source field encoded explicitly. */
export type LedgerProgramRef =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly sourceHash: string;
      readonly ir: string;
      readonly includes: string[];
      readonly redirects: Array<[string, string]>;
      readonly dialect: "tk3" | "tk2" | null;
      readonly owner: string | null;
    }
  | {
      readonly kind: "inline";
      readonly text: string;
      readonly ir: string;
      readonly includes: string[];
      readonly redirects: Array<[string, string]>;
      readonly dialect: "tk3" | "tk2" | null;
      readonly owner: string | null;
    };

/** One reached object record; `members` is in `keys` order and `keys` stays significant. */
export type LedgerObject = {
  readonly handle: number;
  readonly className: string;
  readonly program: LedgerProgramRef | null;
  readonly hostType: LedgerPresence<string>;
  readonly members: { readonly [name: string]: LedgerValue };
  readonly keys: string[];
};

/**
 * The reached closure cells and the high-water id. Present exactly when the
 * candidate holds a cell table, like `vm.cells`/`vm.cellSeq` themselves.
 */
export type LedgerCells = LedgerPresence<{
  readonly seq: number;
  readonly values: { readonly [id: string]: LedgerValue };
}>;

/** The game-owned object/cell/callable graph reachable from `vm.globals`. */
export type LedgerPersistentGraph = {
  readonly objects: LedgerObject[];
  readonly cells: LedgerCells;
  readonly defOwners: LedgerPresence<{ readonly [def: string]: LedgerProgramRef }>;
};

/** The ledger's `script` section. */
export type LedgerScript = {
  readonly globals: { readonly [name: string]: LedgerValue };
  readonly redirects: Array<[string, string]>;
  readonly persistentGraph: LedgerPersistentGraph;
  readonly emitters: { readonly [key: string]: number };
};

/** A record field keyed by script data: defined as data so `__proto__` stays an ordinary key. */
export function setField<T>(record: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
}

/** A finite source number, unchanged. */
export function ledgerNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return failLedger(LEDGER_SHAPE, path, "expected a finite number");
  }
  return value;
}

/** A safe integer no smaller than `min`. */
export function ledgerInteger(value: unknown, path: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    return failLedger(LEDGER_SHAPE, path, `expected a safe integer no less than ${min}`);
  }
  return value;
}

/** A string field. */
export function ledgerText(value: unknown, path: string): string {
  if (typeof value !== "string") return failLedger(LEDGER_SHAPE, path, "expected a string");
  return value;
}

/** A boolean field. */
export function ledgerFlag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return failLedger(LEDGER_SHAPE, path, "expected a boolean");
  return value;
}

/** A non-array object whose fields stay unchecked. */
export function ledgerRecord(value: unknown, path: string): { readonly [key: string]: unknown } {
  if (!isRecord(value)) return failLedger(LEDGER_SHAPE, path, "expected an object");
  return value as { readonly [key: string]: unknown };
}

/** An array whose entries stay unchecked. */
export function ledgerList(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return failLedger(LEDGER_SHAPE, path, "expected an array");
  return value;
}

/** A point `{x, y}`. */
export function ledgerPoint(value: unknown, path: string): { readonly x: number; readonly y: number } {
  const record = ledgerRecord(value, path);
  return { x: ledgerNumber(record.x, `${path}.x`), y: ledgerNumber(record.y, `${path}.y`) };
}

/** A non-finite script number in its tagged plain-data form; a finite one is unchanged. */
function tagLedgerNumber(value: number): number | LedgerTaggedNumber {
  if (Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return { t: "nan" };
  return value > 0 ? { t: "inf" } : { t: "-inf" };
}

/** Project one already-validated script value. */
function ledgerValue(value: Value): LedgerValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number") return tagLedgerNumber(value);
  if ("kind" in value) return { kind: "object", handle: value.handle, className: value.className };
  return {
    type: "callable",
    def: value.def,
    captures: [...value.captures],
    receiver: value.receiver,
    owner: value.owner ?? null,
  };
}

/** Project one program reference, encoding `includes`/`redirects`/`dialect`/`owner` explicitly. */
function ledgerProgramRef(value: unknown, path: string): LedgerProgramRef | null {
  if (value === null) return null;
  const record = ledgerRecord(value, path);
  const ir = ledgerText(record.ir, `${path}.ir`);
  const includes = record.includes === undefined
    ? []
    : ledgerList(record.includes, `${path}.includes`).map((entry, index) => ledgerText(entry, `${path}.includes[${index}]`));
  const redirects = ledgerRedirects(record.redirects, `${path}.redirects`);
  const dialect = record.dialect === undefined ? null : ledgerDialect(record.dialect, `${path}.dialect`);
  const owner = record.owner === undefined ? null : ledgerText(record.owner, `${path}.owner`);
  if (record.kind === "file") {
    return {
      kind: "file",
      path: ledgerText(record.path, `${path}.path`),
      sourceHash: ledgerText(record.sourceHash, `${path}.sourceHash`),
      ir,
      includes,
      redirects,
      dialect,
      owner,
    };
  }
  if (record.kind === "inline") {
    return {
      kind: "inline",
      text: ledgerText(record.text, `${path}.text`),
      ir,
      includes,
      redirects,
      dialect,
      owner,
    };
  }
  return failLedger(LEDGER_SHAPE, `${path}.kind`, "expected \"file\" or \"inline\"");
}

function ledgerDialect(value: unknown, path: string): "tk3" | "tk2" {
  if (value !== "tk3" && value !== "tk2") return failLedger(LEDGER_SHAPE, path, "expected \"tk3\" or \"tk2\"");
  return value;
}

/** The ordered `[folded old, folded new]` redirect pairs, or none when the source omits them. */
function ledgerRedirects(value: unknown, path: string): Array<[string, string]> {
  if (value === undefined) return [];
  return ledgerList(value, path).map((entry, index) => {
    const pair = `${path}[${index}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      return failLedger(LEDGER_SHAPE, pair, "expected a [from, to] pair");
    }
    return [ledgerText(entry[0], `${pair}[0]`), ledgerText(entry[1], `${pair}[1]`)] as [string, string];
  });
}

/** Project the ledger's `script` section from a migrated, validated `vm` section. */
export function projectScriptLedger(vm: VmState, emitters?: Readonly<Record<string, number>>): LedgerScript {
  const table = ledgerList(vm.objects, "vm.objects");
  const byHandle = new Map<number, number[]>();
  const indexHandle: Array<number | null> = [];
  table.forEach((entry, index) => {
    // An unreached record may be whatever a killed program left behind: it is
    // never projected, so only a valid handle can put it in the index.
    const raw = isRecord(entry) ? entry.handle : undefined;
    const handle = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1 ? raw : null;
    indexHandle.push(handle);
    if (handle === null) return;
    const indexes = byHandle.get(handle);
    if (indexes === undefined) byHandle.set(handle, [index]);
    else indexes.push(index);
  });

  const cellTable = vm.cells === undefined ? null : ledgerRecord(vm.cells, "vm.cells");
  const cellSeq = vm.cells === undefined ? null : ledgerInteger(vm.cellSeq, "vm.cellSeq", 0);
  if (cellTable === null && vm.cellSeq !== undefined) {
    failLedger(LEDGER_SHAPE, "vm.cellSeq", "is present without vm.cells");
  }

  type ValidatedObject = {
    readonly className: string;
    readonly program: LedgerProgramRef | null;
    readonly hostType: LedgerPresence<string>;
    readonly keys: string[];
    readonly members: { readonly [name: string]: unknown };
  };

  const reachedHandles = new Set<number>();
  const reachedCells = new Set<string>();
  const reachedDefs = new Set<string>();
  const validated = new Map<number, ValidatedObject>();
  const pendingValues: Array<{ readonly value: unknown; readonly path: string }> = [];
  const pendingObjects: number[] = [];
  const pendingCells: string[] = [];

  const visitCell = (id: string, path: string): void => {
    if (reachedCells.has(id)) return;
    if (cellNumber(id) === null) return failLedger(LEDGER_SHAPE, path, `"${id}" is not a cell id the VM issues`);
    if (cellTable === null || !Object.hasOwn(cellTable, id)) {
      return failLedger(LEDGER_REFERENCE, path, `names cell "${id}", which vm.cells does not hold`);
    }
    reachedCells.add(id);
    pendingCells.push(id);
  };

  const visitObjectHandle = (handle: number, className: string | null, path: string): void => {
    const indexes = byHandle.get(handle);
    if (indexes === undefined) {
      return failLedger(LEDGER_REFERENCE, path, `names object handle ${handle}, which vm.objects does not hold`);
    }
    if (indexes.length > 1) {
      return failLedger(LEDGER_IDENTITY, `vm.objects[${indexes[1]}]`, `duplicate object handle ${handle}`);
    }
    const index = indexes[0]!;
    const record = ledgerRecord(table[index], `vm.objects[${index}]`);
    const actual = ledgerText(record.className, `vm.objects[${index}].className`);
    if (className !== null && className !== actual) {
      return failLedger(LEDGER_REFERENCE, path, `names handle ${handle} as class "${className}", but the object is "${actual}"`);
    }
    if (reachedHandles.has(handle)) return;
    reachedHandles.add(handle);
    pendingObjects.push(index);
  };

  const visitCallable = (value: { readonly [key: string]: unknown }, path: string): void => {
    const def = ledgerText(value.def, `${path}.def`);
    if (def === "") failLedger(LEDGER_SHAPE, `${path}.def`, "expected a non-empty definition id");
    reachedDefs.add(def);
    ledgerList(value.captures, `${path}.captures`).forEach((capture, index) => {
      const capturePath = `${path}.captures[${index}]`;
      const id = ledgerText(capture, capturePath);
      // "" marks a name that was not a local, so it reads and writes the global.
      if (id !== "") visitCell(id, capturePath);
    });
    if (value.owner !== undefined) ledgerText(value.owner, `${path}.owner`);
    if (value.receiver === null) return;
    const receiver = ledgerText(value.receiver, `${path}.receiver`);
    const handle = Number(receiver);
    if (!Number.isSafeInteger(handle) || handle < 1) {
      return failLedger(LEDGER_SHAPE, `${path}.receiver`, "expected an object handle or null");
    }
    visitObjectHandle(handle, null, `${path}.receiver`);
  };

  const visitValue = (value: unknown, path: string): void => {
    if (value === null || typeof value === "number" || typeof value === "string") return;
    const record = ledgerRecord(value, path);
    if (record.kind === "object") {
      const handle = ledgerInteger(record.handle, `${path}.handle`, 1);
      const className = ledgerText(record.className, `${path}.className`);
      visitObjectHandle(handle, className, path);
      return;
    }
    if (record.type === "callable") {
      visitCallable(record, path);
      return;
    }
    failLedger(LEDGER_SHAPE, path, "expected a script value");
  };

  const visitObject = (index: number): void => {
    const base = `vm.objects[${index}]`;
    const record = ledgerRecord(table[index], base);
    const handle = ledgerInteger(record.handle, `${base}.handle`, 1);
    const className = ledgerText(record.className, `${base}.className`);
    const program = ledgerProgramRef(record.program, `${base}.program`);
    if (className === "" && program !== null) failLedger(LEDGER_SHAPE, `${base}.program`, "a dictionary has no program");
    if (className !== "" && program === null) {
      failLedger(LEDGER_SHAPE, `${base}.program`, "an object with a class names the program that declares it");
    }
    const hostType: LedgerPresence<string> = record.hostType === undefined
      ? { state: "absent" }
      : { state: "present", value: ledgerText(record.hostType, `${base}.hostType`) };
    const members = ledgerRecord(record.members, `${base}.members`);
    const keys: string[] = [];
    const seen = new Set<string>();
    ledgerList(record.keys, `${base}.keys`).forEach((key, position) => {
      const name = ledgerText(key, `${base}.keys[${position}]`);
      if (seen.has(name)) failLedger(LEDGER_IDENTITY, `${base}.keys[${position}]`, `names "${name}" twice`);
      if (!Object.hasOwn(members, name)) {
        failLedger(LEDGER_REFERENCE, `${base}.keys[${position}]`, `names "${name}", which has no member`);
      }
      seen.add(name);
      keys.push(name);
    });
    for (const name of Object.keys(members)) {
      if (!seen.has(name)) failLedger(LEDGER_IDENTITY, `${base}.members.${name}`, "is not named by the object's keys");
    }
    validated.set(handle, { className, program, hostType, keys, members });
    for (const name of keys) pendingValues.push({ value: members[name], path: `${base}.members.${name}` });
  };

  const globalsTable = ledgerRecord(vm.globals, "vm.globals");
  const globalNames = Object.keys(globalsTable);
  for (const name of globalNames) visitValue(globalsTable[name], `vm.globals.${name}`);

  let valueIndex = 0;
  let objectIndex = 0;
  let cellIndex = 0;
  for (;;) {
    let progressed = false;
    while (valueIndex < pendingValues.length) {
      const item = pendingValues[valueIndex]!;
      valueIndex += 1;
      visitValue(item.value, item.path);
      progressed = true;
    }
    while (objectIndex < pendingObjects.length) {
      visitObject(pendingObjects[objectIndex]!);
      objectIndex += 1;
      progressed = true;
    }
    while (cellIndex < pendingCells.length) {
      const id = pendingCells[cellIndex]!;
      cellIndex += 1;
      pendingValues.push({ value: cellTable![id], path: `vm.cells.${id}` });
      progressed = true;
    }
    if (!progressed) break;
  }

  const objects: LedgerObject[] = [];
  for (const [index, handle] of indexHandle.entries()) {
    if (handle === null || !reachedHandles.has(handle)) continue;
    const object = validated.get(handle);
    if (object === undefined) failLedger(LEDGER_REFERENCE, `vm.objects[${index}]`, "was reached but not projected");
    const members: { [name: string]: LedgerValue } = {};
    for (const name of object.keys) setField(members, name, ledgerValue(object.members[name] as Value));
    objects.push({
      handle,
      className: object.className,
      program: object.program,
      hostType: object.hostType,
      members,
      keys: object.keys,
    });
  }

  const globals: { [name: string]: LedgerValue } = {};
  for (const name of globalNames) setField(globals, name, ledgerValue(globalsTable[name] as Value));

  let cells: LedgerCells = { state: "absent" };
  if (cellTable !== null) {
    const seq = cellSeq ?? 0;
    const values: { [id: string]: LedgerValue } = {};
    for (const id of Object.keys(cellTable)) {
      if (!reachedCells.has(id)) continue;
      const number = cellNumber(id);
      if (number === null) failLedger(LEDGER_SHAPE, `vm.cells.${id}`, "is not a cell id the VM issues");
      if (number > seq) failLedger(LEDGER_IDENTITY, `vm.cells.${id}`, `is above vm.cellSeq ${seq}`);
      setField(values, id, ledgerValue(cellTable[id] as Value));
    }
    cells = { state: "present", value: { seq, values } };
  }

  let defOwners: LedgerPresence<{ [def: string]: LedgerProgramRef }> = { state: "absent" };
  if (vm.defOwners !== undefined) {
    const owners = ledgerRecord(vm.defOwners, "vm.defOwners");
    const kept: { [def: string]: LedgerProgramRef } = {};
    for (const def of Object.keys(owners)) {
      if (!reachedDefs.has(def)) continue;
      const ref = ledgerProgramRef(owners[def], `vm.defOwners.${def}`);
      if (ref === null) failLedger(LEDGER_SHAPE, `vm.defOwners.${def}`, "expected a program reference");
      setField(kept, def, ref);
    }
    defOwners = { state: "present", value: kept };
  }

  const emitterHandles: { [key: string]: number } = {};
  if (emitters !== undefined) {
    const entries = ledgerRecord(emitters, "events.emitters");
    for (const key of Object.keys(entries)) {
      const handle = ledgerInteger(entries[key], `events.emitters.${key}`, 1);
      if (reachedHandles.has(handle)) setField(emitterHandles, key, handle);
    }
  }

  return {
    globals,
    redirects: ledgerRedirects(vm.redirects, "vm.redirects"),
    persistentGraph: { objects, cells, defOwners },
    emitters: emitterHandles,
  };
}

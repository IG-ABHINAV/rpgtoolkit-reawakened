/**
 * The VM state tree (AD-7, AD-26; docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-2).
 *
 * `VmState` is AD-10's `vm` section: `threads`, `globals`, `objects`,
 * `redirects`, the effect log (`effects` and `effectSeq`, ticket 3.21), the
 * global-block status (`block`, R-32) and the request counter (`requestSeq`,
 * AD-5). `objects` is the one handle table of every object, dictionaries and legacy class instances alike (OOP-10, entries 19.3 and 19.5); `redirects` is the one run-wide redirect table
 * of entry 8 (R-42), ordered `[folded old, folded new]` pairs. `Thread` and `Frame` carry AD-7's minimum fields with the values
 * this entry fixes: `ThreadKind`/`ThreadOwner` are AD-26's, `source`/`target`
 * are THR-2's per-thread pair and `null` for a plain thread, and `errorHandler`
 * is `null` until entry 7. `Frame.operands` holds bound `Arg`s so a
 * by-reference reference survives to dispatch (docs/spec/engine/rpgcode-runtime.md#sem-3--comparison-and-conversion SEM-6).
 *
 * A thread's persistence is its kind: `persistent` survives a board change,
 * `board` dies with the board, `item` dies with its item (E-93), and a
 * finished thread stays registered until it is killed or its board or item
 * goes (THR-2; E-93).
 *
 * Everything here is `PlainData` (G1 rule 2): the `GameState` assertion in
 * `core/save` proves it at build time.
 *
 * docs/adr/0004; docs/spec/engine/rpgcode-errors-and-threads.md#threads (THR-2) (SEM-4/SEM-6).
 */

import type { AssertPlainData, PlainData } from "../ports/plain-data.ts";
import type { RefId, Value } from "../ports/value.ts";
import type { Wait } from "../ports/wait.ts";
import type { Arg } from "./builtins.ts";
import type { EffectRecord } from "./effects.ts";
import { ScriptError } from "./errors.ts";
import { withRedirects, type ProgramRef } from "./program.ts";

/** Why a thread exists (AD-26). */
export type ThreadKind = "blocking" | "board" | "persistent" | "item";

/** Who owns a thread's lifecycle (AD-26). */
export type ThreadOwner = "script" | "world";

/** A thread's scheduling state (AD-7). */
export type ThreadStatus = "ready" | "waiting" | "finished";

/**
 * One active object in the deterministic handle table (OOP-3/OOP-5/OOP-10,
 * docs/spec/engine/rpgcode-modules-and-objects.md#oop-10). Every object, a
 * dictionary literal's and a legacy class instance alike, has this one shape.
 *
 * `className` is the class tag: the folded name of the class, or `""` for a
 * dictionary, which has no class. `program` is the program that declares that
 * class, and is `null` exactly when `className` is `""`. The methods, the
 * ancestors and the access labels of the class are its declaration, found by
 * name in the running program's class table, never saved with the object
 * (OOP-12). `members` is a plain JSON object whose own order is not reliable (a
 * key such as `"2"` is always listed first), so `keys` is the one enumeration
 * order, saved and restored with the record: it names each member exactly once.
 */
export type ObjectRecord = {
  handle: number;
  className: string;
  program: ProgramRef | null;
  /**
   * The session-hydrated host declaration name (OOP-12). It is a name only;
   * the declaration and its methods are rebuilt by the host and never saved.
   */
  hostType?: string;
  members: { [name: string]: Value };
  keys: string[];
};

/** One local variable storage slot in a call frame (AD-7, AD-8). */
export type LocalSlot = {
  value: Value;
  ref: RefId;
};


/**
 * One frame's error-handler slot (AD-7; ERR-1). Plain data: the handler belongs
 * to the frame that set it, lasts until the frame returns, and stays after it
 * fires. `active` is true while the handler is handling an error (between the
 * failure and `resumeNext()`); `resume` is then the op index just after the
 * failing statement, consumed once by `resumeNext()`.
 */
export type ErrorHandler = {
  /** `label` jumps to `label`; `resumeNext` swallows the error and continues. */
  mode: "label" | "resumeNext";
  /** The handler label (function-local), or `null` in `resumeNext` mode. */
  label: string | null;
  active: boolean;
  resume: number | null;
};

/** One active call frame (AD-7). `errorHandler` is `null` when no handler is set. */
export type Frame = {
  program: ProgramRef;
  ip: number;
  locals: { [name: string]: LocalSlot };
  operands: Arg[];
  errorHandler: ErrorHandler | null;
  autoLocal: boolean;
  /** Receiver context for a class method; absent on legacy frames. */
  objectHandle?: number;
  objectClass?: string;
  /** Value supplied by a construction frame when it returns. */
  returnValue?: Value;
  /** Named program boundary; a non-null restore pair marks nested executeProgram. */
  programRoot?: { restore: { source: string | null; target: string | null } | null };
  /** The menu frame owned by this provider call; popped when this frame returns. */
  menuScreen?: string;
  /** Plain-data native parent continuation waiting for this RPGCode child. */
  menuContinuation?: PlainData;
  /** Composable native/script item-action phases owned by this invocation frame. */
  itemActions?: PlainData[];
  /** Object freed after a destructor frame returns. */
  releaseHandle?: number;
};

/**
 * Code another thread injected with `tellThread` (THR-2): inline source plus
 * the position of the call that queued it. It runs at the target's next turn.
 */
export type QueuedInline = { text: string; file: string; line: number };

/**
 * A request's continuation, ready to run at the thread's next turn (ADR 0004
 * decision 7): a named command, its arguments with the reply already
 * prepended, and the position of the call that made the request.
 */
export type PendingCall = { command: string; args: PlainData[]; file: string; line: number };

/** A sandboxed RPGCode file handle. Bytes are hex so VM state remains PlainData (AD-17). */
export type FileHandle = {
  id: string;
  mode: "input" | "output" | "append" | "binary";
  area: "saves" | "files";
  path: string;
  data: string;
  position: number;
  loaded: boolean;
};

/** One sprite move collected by `multiRun` before the one `movement` wait is entered (E-33). */
export type CollectedMove = { sprite: string; until: number };

/** One RPGCode thread (AD-7, AD-26). */
export type Thread = {
  id: number;
  kind: ThreadKind;
  owner: ThreadOwner;
  source: string | null;
  target: string | null;
  frames: Frame[];
  status: ThreadStatus;
  wait: Wait | null;
  /** Inline code queued by `tellThread`, oldest first (THR-2). */
  queue: QueuedInline[];
  /** The request continuation to run first at the next turn, or `null`. */
  pending: PendingCall | null;
  /** Frame indices of live injected (`tellThread`) frames, innermost last; their return value is dropped. */
  detached: number[];
  /** The moves collected since `multiRun` began, or `null` outside a `multiRun`. */
  collect: CollectedMove[] | null;
};

/**
 * The global-block status (R-32): the thread whose blocking command is
 * waiting, the wait kind and the tick it began. While it is not `null`, no
 * other script thread, movement or frame update advances.
 */
export type GlobalBlock = { thread: number; kind: string; since: number };

/** The `vm` section: AD-10's threads, globals, objects and redirects, plus the effect log. */
export type VmState = {
  threads: Thread[];
  globals: { [name: string]: Value };
  objects: ObjectRecord[];
  redirects: Array<[string, string]>;
  files: FileHandle[];
  effects: EffectRecord[];
  effectSeq: number;
  block: GlobalBlock | null;
  requestSeq: number;
  /**
   * The closure cells named by a callable's `captures` (FUN-8), by cell id.
   * One cell is the private storage of one captured name of one callable
   * value, so a closure keeps its own state between calls. Absent until the
   * first lambda value is created, matching `messagesOff`: a state with no
   * closure in it keeps the shape it had before cells existed. `cellSeq` is the
   * number of the last id issued (`cell1`, `cell2`, …), is present exactly when
   * `cells` is, and never goes back when a cell is freed (entry 18.6).
   */
  cells?: { [id: string]: Value };
  cellSeq?: number;
  /**
   * The program that owns each definition a live callable names (FUN-8; entry
   * 18.6): `def` to the reference of the program that defines it, written when
   * the callable is made. Compiled programs are not saved, so this is what lets
   * a restore compile the program a handle's `def` lives in even when no frame
   * is running it. A callable naming a command has no entry. Absent until the
   * first callable is made; an entry is dropped when no live callable names its `def`.
   */
  defOwners?: { [def: string]: ProgramRef };
  /**
   * Number of executed VM instructions by owning package (PKG-8). Absent until
   * the first instruction from an owned program runs; counters are excluded from
   * state hashes because they describe execution history, not game state.
   */
  stepCounters?: { [owner: string]: number };

  /** Present and true only while debug(false) has switched messages off. */
  messagesOff?: true;
};

/** Build-time proof that the `vm` section stays plain data (G1 rule 2, AD-7). */
export type VmStateIsPlainData = AssertPlainData<VmState>;

/** A fresh `vm` section: no threads, no globals, no objects, no redirects, no effects, no block. */
export function createVmState(): VmState {
  return {
    threads: [],
    globals: {},
    objects: [],
    redirects: [],
    files: [],
    effects: [],
    effectSeq: 0,
    block: null,
    requestSeq: 0,
  };
}
const EMPTY_STEP_COUNTERS: Readonly<Record<string, number>> = Object.freeze({});

/** Read the per-package instruction counters without allocating for an untouched VM (PKG-8). */
export function readStepCounters(vm: VmState): Readonly<Record<string, number>> {
  return vm.stepCounters ?? EMPTY_STEP_COUNTERS;
}

/** Attribute one executed VM instruction to its owning package (PKG-8). */
export function incrementStepCounter(vm: VmState, owner: string | undefined): void {
  if (owner === undefined || owner === "") return;
  const counters = (vm.stepCounters ??= {});
  if (Object.hasOwn(counters, owner)) {
    const count = counters[owner] ?? 0;
    counters[owner] = count + 1;
    return;
  }
  // A package name may be an Object.prototype key. Define it as data rather than
  // assigning through a legacy setter such as `__proto__`.
  Object.defineProperty(counters, owner, { value: 1, writable: true, enumerable: true, configurable: true });
}


/** Build a global-scope variable reference (AD-8's `Arg.ref`). */
export function globalRef(name: string): RefId {
  return `global:${name}` as RefId;
}

/** Build a live engine-virtual reference; it never falls back to VM globals. */
export function virtualRef(name: string): RefId {
  return `virtual:${name}` as RefId;
}

/** Build a local-scope variable reference (AD-8's `Arg.ref`). */
export function localRef(name: string): RefId {
  return `local:${name}` as RefId;
}

/**
 * Build a closure-cell reference: the binding a lambda frame gives a captured
 * name, so its reads and writes reach the callable value's own cell (FUN-8)
 * rather than the frame's local table or the global one.
 */
export function cellRef(id: string): RefId {
  return `cell:${id}` as RefId;
}

/** The id the next thread gets: `max(id) + 1` (a killed highest id is reused). */
export function nextThreadId(state: Pick<VmState, "threads">): number {
  let maxId = 0;
  for (const thread of state.threads) {
    if (thread.id > maxId) maxId = thread.id;
  }
  return maxId + 1;
}

/** Find a registered thread by id, or `undefined`. */
export function findThread(state: Pick<VmState, "threads">, id: number): Thread | undefined {
  for (const thread of state.threads) {
    if (thread.id === id) return thread;
  }
  return undefined;
}

/** What `startThread` needs to register a thread. */
export type ThreadInit = {
  readonly ref: ProgramRef;
  readonly kind: ThreadKind;
  readonly owner: ThreadOwner;
  readonly source?: string | null;
  readonly target?: string | null;
};

/**
 * Register a new thread running `init.ref` (AD-7, AD-26; E-93). The id is
 * `max(id) + 1`. A second live blocking thread is refused, because AD-26
 * allows at most one (`thread.blocking-exists`); a `blocking` thread is always
 * script-owned and an `item` thread always world-owned (`thread.bad-owner`).
 * An item thread's `source` and `target` are the item (E-46); every other
 * thread starts with `null` for both unless the caller gives them.
 */
export function startThread(state: VmState, init: ThreadInit): Thread {
  if (init.kind === "blocking") {
    for (const thread of state.threads) {
      if (thread.kind === "blocking" && thread.status !== "finished") {
        throw new ScriptError("thread.blocking-exists", "a blocking thread already exists (AD-26)");
      }
    }
  }
  if (
    (init.kind === "blocking" && init.owner !== "script") ||
    (init.kind === "item" && init.owner !== "world")
  ) {
    throw new ScriptError(
      "thread.bad-owner",
      `a ${init.kind} thread cannot be owned by "${init.owner}" (AD-26)`,
    );
  }
  const thread: Thread = {
    id: nextThreadId(state),
    kind: init.kind,
    owner: init.owner,
    source: init.source ?? null,
    target: init.target ?? null,
    frames: [
      {
        // The redirect table in force when a program starts is recorded in its ref (R-42).
        program: withRedirects(init.ref, state.redirects),
        ip: 0,
        locals: {},
        operands: [],
        errorHandler: null,
        autoLocal: false,
      },
    ],
    status: "ready",
    wait: null,
    queue: [],
    pending: null,
    detached: [],
    collect: null,
  };
  state.threads.push(thread);
  return thread;
}

/**
 * Start a program as a new `blocking` thread (AD-7, AD-26). The id is
 * `max(id) + 1`; a second live blocking thread is refused, because AD-26
 * allows at most one (`thread.blocking-exists`).
 */
export function startProgram(state: VmState, ref: ProgramRef): Thread {
  return startThread(state, { ref, kind: "blocking", owner: "script" });
}

/** Unregister the thread `id`. Returns `false` when no such thread is registered (E-93). */
export function killThread(state: VmState, id: number): boolean {
  const index = state.threads.findIndex((thread) => thread.id === id);
  if (index < 0) return false;
  const thread = state.threads[index]!;
  const wasBlocker = state.block?.thread === id;
  thread.status = "finished";
  thread.frames = [];
  thread.wait = null;
  thread.queue = [];
  thread.pending = null;
  thread.detached = [];
  thread.collect = null;
  state.threads.splice(index, 1);
  if (wasBlocker) state.block = null;
  return true;
}

/** Board exit: every `board` thread dies; `persistent`, `item` and `blocking` threads stay (E-93). */
export function endBoardThreads(state: VmState): void {
  for (const thread of [...state.threads]) {
    if (thread.kind === "board") killThread(state, thread.id);
  }
}

/** An item leaves the board: its `item` threads die with it; `source` names the item (E-46, E-93). */
export function endItemThreads(state: VmState, item: string): void {
  for (const thread of [...state.threads]) {
    if (thread.kind === "item" && thread.source === item) killThread(state, thread.id);
  }
}

/**
 * The thread whose blocking command is waiting (R-32): the lowest id holding
 * a `global` wait, or `null` when no blocking command waits.
 */
export function findBlockingThread(state: Pick<VmState, "threads">): Thread | null {
  let found: Thread | null = null;
  for (const thread of state.threads) {
    if (thread.status !== "waiting" || thread.wait === null || !thread.wait.global) continue;
    if (found === null || thread.id < found.id) found = thread;
  }
  return found;
}

/** True while any `blocking`-kind thread (an outermost program) has not finished, whether it is waiting, sleeping or ready. */
export function hasLiveBlockingThread(state: Pick<VmState, "threads">): boolean {
  return state.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished");
}

/**
 * Whether a script owns the key queue (docs/spec/engine/display-input-audio.md#reawakened-held-direction-movement):
 * a live outermost program, or any thread holding a `global` wait (a message window, prompt, menu, `wait()`,
 * `Get()`-style key wait, battle). Gameplay input, keys and pointer clicks alike, does not move the player while this holds.
 */
export function scriptOwnsInput(state: Pick<VmState, "threads">): boolean {
  return findBlockingThread(state) !== null || hasLiveBlockingThread(state);
}

/** Recompute `vm.block` from the threads; the VM calls this after every wait change. */
export function refreshBlock(state: VmState, tick: number): void {
  const thread = findBlockingThread(state);
  if (thread === null || thread.wait === null) {
    state.block = null;
  } else if (
    state.block === null ||
    state.block.thread !== thread.id ||
    state.block.kind !== thread.wait.kind
  ) {
    state.block = { thread: thread.id, kind: thread.wait.kind, since: tick };
  }
}

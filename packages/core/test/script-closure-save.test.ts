// Saving, loading and tidying up closures (FUN-8; ADR 0004 decision 8; entry
// 18.6): callable values, `vm.cells`, `vm.cellSeq`, `vm.defOwners` and a frame
// parked inside a closure's call survive a snapshot and a restore as plain data;
// a damaged or stale save is refused with a typed, located error; and the cells
// no script can reach any more are freed in the end-of-tick pass.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  advanceScriptTick,
  assetKey,
  canon,
  createAssetIndex,
  createGameState,
  fileProgramRef,
  PACKAGE_ROOT,
  restoreGameState,
  SCHEMA_VERSIONS,
  snapshot,
  startProgram,
  verifyRestoredHandles,
  type GameState,
  type ProgramLoader,
  type ScriptError,
  type ScriptServices,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

/** `assert.ok`, which the shared test declarations do not carry, as an assertion that narrows. */
function ok(condition: unknown, message?: string): asserts condition {
  equal(Boolean(condition), true, message);
}

function loaderOf(files: Record<string, string>): ProgramLoader {
  const bytes = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(files)) {
    bytes.set(assetKey(`Prg/${name}`), new TextEncoder().encode(content));
  }
  return {
    index: createAssetIndex(Object.keys(files).map((name) => `Prg/${name}`)),
    root: PACKAGE_ROOT,
    read: (key) => bytes.get(key),
  };
}

function makeState(program: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  return state;
}

function fileState(loader: ProgramLoader, main: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, fileProgramRef(loader, main));
  return state;
}

/** Advance until every thread has finished, or `limit` ticks have passed. */
function runToRest(state: GameState, services: ScriptServices, limit = 60): void {
  const finished = (): boolean => state.vm.threads.every((thread) => thread.status === "finished");
  for (let ticks = 0; !finished() && ticks < limit; ticks += 1) advanceOrFail(state, services);
  ok(finished(), "the program finished within the tick limit");
}

function runOnce(program: string): GameState {
  const state = makeState(program);
  advanceOrFail(state, createScriptServices(state));
  return state;
}

/** Restore `json` the way a host does: the shape check, then the program-aware check on rebuilt services. */
function restoreChecked(json: string, loader?: ProgramLoader): { state: GameState; services: ScriptServices } {
  const state = restoreGameState(json);
  const services = createScriptServices(state, [], undefined, undefined, loader);
  verifyRestoredHandles(state.vm, services);
  return { state, services };
}

function failure(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the restore to throw");
}

/** The parts of a parsed snapshot these tests edit. */
type RawSnapshot = {
  vm: {
    globals: Record<string, unknown>;
    cells?: Record<string, unknown>;
    cellSeq?: number;
    defOwners?: Record<string, unknown>;
    objects: Array<{ members: Record<string, unknown> }>;
    threads: Array<{
      wait: unknown;
      frames: Array<{
        locals: Record<string, { value: unknown; ref: string }>;
        operands: Array<{ value: unknown; ref: string | null }>;
      }>;
    }>;
  };
};

/** One callable record as it sits in a parsed snapshot, loose enough for a test to damage it. */
type RawCallable = { type: string; def: string; captures: unknown; receiver?: unknown; extra?: unknown };

function parsed(json: string): RawSnapshot {
  const raw: RawSnapshot = JSON.parse(json);
  return raw;
}

function edited(json: string, change: (raw: RawSnapshot) => void): string {
  const raw = parsed(json);
  change(raw);
  return JSON.stringify(raw);
}

/** The callable a global holds in a parsed snapshot (every test that calls this made it by running a program). */
function callableAt(raw: RawSnapshot, name: string): RawCallable {
  const callable: RawCallable = raw.vm.globals[name] as RawCallable;
  return callable;
}

const COUNTERS = `
function make(start) {
  local(n)
  n = start
  return () => { n = n + 1; return n }
}
a = make(10)
b = make(20)
r1 = a()
r2 = a()
r3 = b()
`;

const PARKED = `
function make() {
  local(n)
  n = 1
  return () => { n = n + 1; sleep(3); n = n + 10; return n }
}
f = make()
r = f()
after = 1
`;

// --- Round trip --------------------------------------------------------------------------

test("a state holding live closures round-trips: canon(restore(snapshot(s))) is snapshot(s)", () => {
  const state = runOnce(COUNTERS);
  const json = snapshot(state);
  const { state: restored } = restoreChecked(json);

  equal(canon(restored), json);
  deepEqual(restored.vm.cells, { cell1: 12, cell2: 21 });
  equal(restored.vm.cellSeq, 2);
  deepEqual(Object.keys(restored.vm.defOwners ?? {}), ["<inline>#lambda_1"]);
  equal(restored.vm.globals.r1, 11);
  equal(restored.vm.globals.r3, 21);
});

test("a closure parked mid-call by a sleep round-trips and finishes exactly as the original does", () => {
  const state = makeState(PARKED);
  const services = createScriptServices(state);
  advanceOrFail(state, services);

  const thread = state.vm.threads[0]!;
  equal(thread.status, "waiting");
  equal(thread.frames.length, 2, "the main frame and the closure's frame");
  equal(thread.frames[1]!.locals.n!.ref, "cell:cell1", "the closure's frame reads its captured name through the cell");
  deepEqual(state.vm.cells, { cell1: 2 });

  const json = snapshot(state);
  const { state: restored, services: restoredServices } = restoreChecked(json);
  equal(canon(restored), json);

  runToRest(state, services);
  runToRest(restored, restoredServices);
  equal(state.vm.globals.r, 12);
  equal(restored.vm.globals.r, 12);
  equal(state.vm.globals.after, 1);
  equal(canon(restored), canon(state));
});

test("a bindingOf wrapper chain, a command handle and a script-function handle round-trip and still run", () => {
  const program = `
function twice(x) { return x * 2 }
function wrap() {
  local(original)
  original = bindingOf("castint")
  castint = (x) => original(x) + 1
}
wrap()
cmd = bindingOf("castint")
fn = bindingOf("twice")
sleep(2)
r = castint(4.75)
t = fn(21)
`;
  const state = makeState(program);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.vm.threads[0]!.status, "waiting");

  const json = snapshot(state);
  const { state: restored, services: restoredServices } = restoreChecked(json);
  equal(canon(restored), json);
  deepEqual(Object.keys(restored.vm.defOwners ?? {}).sort(), ["<inline>#lambda_1", "twice"]);

  runToRest(state, services);
  runToRest(restored, restoredServices);
  equal(restored.vm.globals.r, 5);
  equal(restored.vm.globals.t, 42);
  equal(canon(restored), canon(state));
});

test("a callable stored in a global outlives the program that made it and still resolves after a restore", () => {
  const loader = loaderOf({
    "main.prg": 'f = (x) => x * 2\nrun("b.prg")\n',
    "b.prg": "sleep(3)\nr = f(3)\n",
  });
  const state = fileState(loader, "main.prg");
  const services = createScriptServices(state, [], undefined, undefined, loader);
  advanceOrFail(state, services);
  advanceOrFail(state, services);
  deepEqual(
    state.vm.threads.map((thread) => thread.frames.map((frame) => (frame.program.kind === "file" ? frame.program.path : "inline"))),
    [["b.prg"]],
    "no frame is running the program that made f",
  );
  deepEqual(state.vm.defOwners?.["prg/main.prg#lambda_1"], fileProgramRef(loader, "main.prg"));

  const json = snapshot(state);
  const { state: restored, services: restoredServices } = restoreChecked(json, loader);
  equal(canon(restored), json);
  runToRest(restored, restoredServices);
  equal(restored.vm.globals.r, 6);

  // Even a host that skips the program-aware check resolves the handle through its recorded owner.
  const unchecked = restoreGameState(json);
  runToRest(unchecked, createScriptServices(unchecked, [], undefined, undefined, loader));
  equal(unchecked.vm.globals.r, 6);
});

test("a save from before defOwners existed (no owner entry) still restores when a frame runs the program", () => {
  const state = makeState(PARKED);
  advanceOrFail(state, createScriptServices(state));
  const older = edited(snapshot(state), (raw) => {
    delete raw.vm.defOwners;
  });
  const { state: restored, services } = restoreChecked(older);
  runToRest(restored, services);
  equal(restored.vm.globals.r, 12);
});

test("a state with no callable and no cell is not checked and compiles nothing", () => {
  const state = makeState("x = 1\nsleep(5)\n");
  advanceOrFail(state, createScriptServices(state));
  const json = snapshot(state);
  const { state: restored, services } = restoreChecked(json);

  equal(services.programs.compiles, 0);
  equal(Object.hasOwn(restored.vm, "cells"), false);
  equal(Object.hasOwn(restored.vm, "cellSeq"), false);
  equal(Object.hasOwn(restored.vm, "defOwners"), false);
});

test("closures add optional fields only: the instruction version does not move for them and the vm schema carries the item-action shape", () => {
  const plain = createGameState({ seed: 0 });
  equal(SCHEMA_VERSIONS.vm, 7);
  equal(plain.schema.vm, 7);
  equal(plain.schema.ir, "1");
  deepEqual(Object.keys(plain.vm).sort(), [
    "block",
    "effectSeq",
    "effects",
    "files",
    "globals",
    "objects",
    "redirects",
    "requestSeq",
    "threads",
  ]);
});

// --- Refusing a damaged or stale save -----------------------------------------------------

test("a malformed callable record is refused as restore.callable-malformed, naming the place", () => {
  const json = snapshot(runOnce(COUNTERS));
  const cases: Array<[string, (raw: RawSnapshot) => void]> = [
    ["no receiver", (raw) => { delete callableAt(raw, "a").receiver; }],
    ["an empty def", (raw) => { callableAt(raw, "a").def = ""; }],
    ["captures that is not a list", (raw) => { callableAt(raw, "a").captures = "cell1"; }],
    ["a capture that is not text", (raw) => { callableAt(raw, "a").captures = [1]; }],
    ["a receiver that is not text or null", (raw) => { callableAt(raw, "a").receiver = 4; }],
    ["an extra key", (raw) => { callableAt(raw, "a").extra = 1; }],
  ];
  for (const [label, change] of cases) {
    const error = failure(() => restoreGameState(edited(json, change)));
    equal(error.code, "restore.callable-malformed", label);
    ok(error.message.includes("vm.globals.a"), `${label}: ${error.message}`);
  }
});

test("a value that is not a number, text, null, an object handle or a callable is refused as restore.shape", () => {
  const json = snapshot(runOnce(COUNTERS));
  const error = failure(() =>
    restoreGameState(edited(json, (raw) => { raw.vm.globals.q = [1, 2]; })),
  );
  equal(error.code, "restore.shape");
  ok(error.message.includes("vm.globals.q"), error.message);
  const unknown = failure(() =>
    restoreGameState(edited(json, (raw) => { raw.vm.globals.q = { type: "other" }; })),
  );
  equal(unknown.code, "restore.shape");
});

test("a handle that captures a cell that is not in vm.cells is refused as restore.cell-missing", () => {
  const json = snapshot(runOnce(COUNTERS));
  const error = failure(() =>
    restoreGameState(edited(json, (raw) => { callableAt(raw, "a").captures = ["cell9"]; })),
  );
  equal(error.code, "restore.cell-missing");
  ok(error.message.includes("vm.globals.a.captures[0]"), error.message);
  ok(error.message.includes("cell9"), error.message);
});

test("a cell whose own value captures a missing cell is refused as restore.cell-missing", () => {
  const state = runOnce("function mk() {\n local(inner)\n inner = 1\n local(outer)\n outer = () => inner\n return () => outer()\n}\nf = mk()\n");
  const raw = parsed(snapshot(state));
  const holder = Object.entries(raw.vm.cells ?? {}).find(([, value]) => typeof value === "object" && value !== null);
  ok(holder !== undefined, "one cell holds a callable");
  const [holderId, holderValue] = holder;
  const nested: RawCallable = holderValue as RawCallable;
  nested.captures = ["cell8"];
  const error = failure(() => restoreGameState(JSON.stringify(raw)));
  equal(error.code, "restore.cell-missing");
  ok(error.message.includes(`vm.cells.${holderId}.captures[0]`), error.message);
});

test("a frame slot, an operand and a wait that name a missing cell are refused as restore.cell-missing", () => {
  const state = makeState(PARKED);
  advanceOrFail(state, createScriptServices(state));
  const json = snapshot(state);

  const slot = failure(() =>
    restoreGameState(edited(json, (raw) => { raw.vm.threads[0]!.frames[1]!.locals.n!.ref = "cell:cell7"; })),
  );
  equal(slot.code, "restore.cell-missing");
  ok(slot.message.includes("vm.threads[0].frames[1].locals.n.ref"), slot.message);
  const operandIndex = parsed(json).vm.threads[0]!.frames[0]!.operands.length;
  const operand = failure(() =>
    restoreGameState(edited(json, (raw) => { raw.vm.threads[0]!.frames[0]!.operands.push({ value: 0, ref: "cell:cell7" }); })),
  );
  equal(operand.code, "restore.cell-missing");
  ok(operand.message.includes(`vm.threads[0].frames[0].operands[${operandIndex}].ref`), operand.message);

  const wait = failure(() =>
    restoreGameState(
      edited(json, (raw) => {
        raw.vm.threads[0]!.wait = { kind: "input.key", global: true, key: null, resumeRefs: ["cell:cell7"] };
      }),
    ),
  );
  equal(wait.code, "restore.cell-missing");
  ok(wait.message.includes("vm.threads[0].wait.resumeRefs[0]"), wait.message);
});

test("a cellSeq that would collide with an existing cell id, or that disagrees with vm.cells, is refused as restore.cell-seq", () => {
  const json = snapshot(runOnce(COUNTERS));

  const low = failure(() => restoreGameState(edited(json, (raw) => { raw.vm.cellSeq = 1; })));
  equal(low.code, "restore.cell-seq");
  ok(low.message.includes("vm.cells.cell2"), low.message);

  const none = failure(() => restoreGameState(edited(json, (raw) => { delete raw.vm.cellSeq; })));
  equal(none.code, "restore.cell-seq");

  const orphan = failure(() => restoreGameState(edited(json, (raw) => { delete raw.vm.cells; })));
  equal(orphan.code, "restore.cell-seq");

  const negative = failure(() => restoreGameState(edited(json, (raw) => { raw.vm.cellSeq = -1; })));
  equal(negative.code, "restore.cell-seq");

  for (const id of ["cell01", "cell0", "cellX", "Cell3", "3"]) {
    const bad = failure(() => restoreGameState(edited(json, (raw) => { raw.vm.cells![id] = 0; })));
    equal(bad.code, "restore.cell-seq", id);
    ok(bad.message.includes(id), bad.message);
  }

  // A counter above every id is fine, as it is after cells have been freed.
  restoreGameState(edited(json, (raw) => { raw.vm.cellSeq = 40; }));
});

test("a vm.defOwners entry that is not a program reference is refused as restore.shape", () => {
  const json = snapshot(runOnce(COUNTERS));
  const error = failure(() =>
    restoreGameState(edited(json, (raw) => { raw.vm.defOwners = { "<inline>#lambda_1": { kind: "file" } }; })),
  );
  equal(error.code, "restore.shape");
  ok(error.message.includes("vm.defOwners.<inline>#lambda_1"), error.message);
});

test("a handle whose def is in no compiled program is refused as restore.callable-unknown-def", () => {
  const json = snapshot(runOnce(COUNTERS));
  const state = restoreGameState(edited(json, (raw) => { callableAt(raw, "a").def = "<inline>#lambda_9"; }));
  const error = failure(() => verifyRestoredHandles(state.vm, createScriptServices(state)));

  equal(error.code, "restore.callable-unknown-def");
  ok(error.message.includes("vm.globals.a"), error.message);
  ok(error.message.includes("<inline>#lambda_9"), error.message);
});

test("a handle that names a command nothing provides is refused as restore.callable-unknown-def", () => {
  const json = snapshot(runOnce("x = bindingOf(\"castint\")\n"));
  restoreChecked(json);
  const error = failure(() =>
    restoreChecked(edited(json, (raw) => { callableAt(raw, "x").def = "nosuchcommand"; })),
  );
  equal(error.code, "restore.callable-unknown-def");
  ok(error.message.includes("vm.globals.x"), error.message);
});

test("a handle whose captures count disagrees with its definition is refused as restore.callable-captures", () => {
  const json = snapshot(runOnce(COUNTERS));
  const state = restoreGameState(edited(json, (raw) => { callableAt(raw, "a").captures = []; }));
  const error = failure(() => verifyRestoredHandles(state.vm, createScriptServices(state)));

  equal(error.code, "restore.callable-captures");
  ok(error.message.includes("vm.globals.a"), error.message);
  ok(error.message.includes("names 0 cell(s)"), error.message);

  const command = failure(() =>
    restoreChecked(
      edited(snapshot(runOnce("x = bindingOf(\"castint\")\n")), (raw) => {
        raw.vm.cells = { cell1: 0 };
        raw.vm.cellSeq = 1;
        callableAt(raw, "x").captures = ["cell1"];
      }),
    ),
  );
  equal(command.code, "restore.callable-captures");
  ok(command.message.includes("is a command"), command.message);
});

test("a lambda handle made before entry 18.5, with no \"\" entry for a non-local name, is refused explicitly", () => {
  const program = "function make() {\n  local(x)\n  x = 1\n  return (a) => g(a) + x\n}\nf = make()\n";
  const json = snapshot(runOnce(program));
  const current = callableAt(parsed(json), "f");
  deepEqual(current.captures, ["", "cell1"], "18.5 records the live global g as an empty entry");

  const error = failure(() =>
    restoreChecked(edited(json, (raw) => { callableAt(raw, "f").captures = ["cell1"]; })),
  );
  equal(error.code, "restore.callable-captures");
  ok(error.message.includes("older build"), error.message);
});

test("an owner that does not define the def it is recorded for is refused as restore.callable-unknown-def", () => {
  const json = snapshot(runOnce(COUNTERS));
  const error = failure(() =>
    restoreChecked(
      edited(json, (raw) => {
        raw.vm.defOwners = { "<inline>#lambda_1": { kind: "inline", text: "x = 1\n", ir: "1" } };
      }),
    ),
  );
  equal(error.code, "restore.callable-unknown-def");
  ok(error.message.includes("vm.defOwners.<inline>#lambda_1"), error.message);
});

test("an owner program whose source changed since the save is reported, not silently accepted", () => {
  const loader = loaderOf({ "main.prg": 'f = (x) => x * 2\nrun("b.prg")\n', "b.prg": "sleep(3)\nr = f(3)\n" });
  const state = fileState(loader, "main.prg");
  const services = createScriptServices(state, [], undefined, undefined, loader);
  advanceOrFail(state, services);
  advanceOrFail(state, services);
  const json = snapshot(state);

  const changed = loaderOf({ "main.prg": 'f = (x) => x * 3\nrun("b.prg")\n', "b.prg": "sleep(3)\nr = f(3)\n" });
  const error = failure(() => restoreChecked(json, changed));
  equal(error.code, "restore.callable-unknown-def");
  ok(error.message.includes("vm.globals.f"), error.message);
  ok(error.message.includes("changed since the save"), error.message);
  ok(error.message.includes("prg/main.prg"), error.message);
});

// --- Tidying up cells ---------------------------------------------------------------------

function cellIds(state: GameState): string[] {
  return Object.keys(state.vm.cells ?? {}).sort();
}

test("an unreachable cell is freed and a reachable one is kept, and cellSeq never goes back", () => {
  const state = makeState(`
function make(v) {
  local(n)
  n = v
  return () => n
}
f = make(1)
g = make(2)
sleep(1)
f = 0
sleep(1)
h = make(3)
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  deepEqual(cellIds(state), ["cell1", "cell2"], "both closures are reachable");

  advanceOrFail(state, services);
  deepEqual(cellIds(state), ["cell2"], "f's cell is gone once nothing names it");
  deepEqual(Object.keys(state.vm.defOwners ?? {}), ["<inline>#lambda_1"]);

  advanceOrFail(state, services);
  deepEqual(cellIds(state), ["cell2", "cell3"], "h's cell takes the next id, not the freed one");
  equal(state.vm.cellSeq, 3, "the counter is never lowered: a freed id is not issued again");
});

test("two identical runs free the same cells and end in the same canonical state", () => {
  const program = `
function make(i) { local(v)
  v = i
  return () => v
}
for (local(i) = 0; i < 40; ++i) {
  f = make(i)
  if (i == 7) { g = f }
}
keep = make(99)
sleep(1)
f = 0
sleep(1)
`;
  const first = makeState(program);
  const second = makeState(program);
  const a = createScriptServices(first);
  const b = createScriptServices(second);
  for (let tick = 0; tick < 8; tick += 1) {
    advanceOrFail(first, a);
    advanceOrFail(second, b);
    equal(canon(first), canon(second), `tick ${tick}`);
  }
  deepEqual(cellIds(first), cellIds(second));
  deepEqual(cellIds(first), ["cell41", "cell8"], "g's closure (the eighth made) and keep's survive; the other 39 are freed");
  equal(first.vm.cellSeq, 41);
  equal(canon(restoreGameState(snapshot(first))), canon(first));
});

test("a script that makes a lambda on every pass of a loop does not grow vm.cells without bound", () => {
  const state = makeState(`
function make(i) { return () => i }
for (local(i) = 0; i < 600; ++i) { f = make(i) }
end()
`);
  const services = createScriptServices(state);
  let most = 0;
  for (let tick = 0; tick < 20 && state.vm.threads.some((thread) => thread.status !== "finished"); tick += 1) {
    advanceOrFail(state, services);
    most = Math.max(most, Object.keys(state.vm.cells ?? {}).length);
  }
  equal(state.vm.cellSeq, 600, "600 lambdas were made");
  deepEqual(cellIds(state), ["cell600"], "only the one f still holds is left");
  ok(most <= 2, `at most two cells exist at a tick boundary, saw ${most}`);
});

test("a recursive local lambda, whose cell captures itself, is freed when its function returns", () => {
  const state = makeState(`
function make() {
  local(fact)
  fact = (n) => { if (n < 2) { return 1 } return n * fact(n - 1) }
  return fact(5)
}
r = make()
sleep(1)
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.vm.globals.r, 120);
  advanceOrFail(state, services);
  deepEqual(cellIds(state), [], "the self-referencing cell is unreachable and is freed");
});

test("a live frame keeps the cell of a captured local even after its closure is dropped", () => {
  const state = makeState(`
function work() {
  local(n)
  n = 1
  tmp = () => n
  tmp = 0
  sleep(1)
  n = n + 1
  return n
}
r = work()
sleep(1)
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  deepEqual(cellIds(state), ["cell1"], "the frame's slot is redirected to the cell and the frame is live");
  advanceOrFail(state, services);
  equal(state.vm.globals.r, 2);
  advanceOrFail(state, services);
  deepEqual(cellIds(state), [], "the frame has returned and nothing else names the cell");
});

test("a cell is reached through another live cell and through an object's member", () => {
  const state = makeState(`
class Holder {
  public:
  var fn
  method Holder(f) { fn = f }
}
function inner() {
  local(x)
  x = 5
  return () => x
}
function outer() {
  local(captured)
  captured = inner()
  return () => captured()
}
chain = outer()
h = Holder(inner())
sleep(1)
r = chain()
sleep(1)
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  advanceOrFail(state, services);
  equal(state.vm.globals.r, 5);
  equal(cellIds(state).length, 3, "inner's x, outer's captured, and the second inner's x are all reachable");
  for (const id of cellIds(state)) ok(Object.hasOwn(state.vm.cells!, id));
});

test("an object that only a dead cell named is freed in the same pass; a cell that only a freed object named goes the next tick", () => {
  const closure = makeState(`
class Box {
  public:
  var v
  method Box(x) { v = x }
}
function mk() {
  local(o)
  o = Box(1)
  return () => o
}
f = mk()
sleep(1)
f = 0
sleep(1)
`);
  const closureServices = createScriptServices(closure);
  advanceOrFail(closure, closureServices);
  equal(closure.vm.objects.length, 1);
  deepEqual(cellIds(closure), ["cell1"]);
  advanceOrFail(closure, closureServices);
  advanceOrFail(closure, closureServices);
  equal(closure.vm.objects.length, 0, "the object went with the dead cell");
  deepEqual(cellIds(closure), []);

  const held = makeState(`
class Holder {
  public:
  var fn
  method Holder(f) { fn = f }
}
function mk() {
  local(x)
  x = 1
  return () => x
}
h = Holder(mk())
sleep(1)
h = 0
sleep(2)
`);
  const heldServices = createScriptServices(held);
  advanceOrFail(held, heldServices);
  equal(held.vm.objects.length, 1);
  deepEqual(cellIds(held), ["cell1"]);
  advanceOrFail(held, heldServices);
  equal(held.vm.objects.length, 0, "the object is unreferenced and is freed this tick");
  deepEqual(cellIds(held), ["cell1"], "the cell was still reachable through the object when the cell pass ran");
  advanceOrFail(held, heldServices);
  deepEqual(cellIds(held), [], "the next tick frees it");
});

test("a state with no closure skips the pass and keeps its pre-closure shape", () => {
  const state = runOnce("x = 1\ny = 2\n");
  equal(state.vm.cells, undefined);
  equal(state.vm.cellSeq, undefined);
  equal(state.vm.defOwners, undefined);
});

test("freeing cells is replayable: a snapshot taken between two collections restores and collects the same", () => {
  const program = `
function make(v) { local(n)
  n = v
  return () => n
}
f = make(1)
sleep(1)
f = make(2)
sleep(1)
f = make(3)
sleep(1)
`;
  const state = makeState(program);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  advanceOrFail(state, services);
  const { state: restored, services: restoredServices } = restoreChecked(snapshot(state));
  equal(canon(restored), canon(state));
  runToRest(state, services);
  runToRest(restored, restoredServices);
  equal(canon(restored), canon(state));
  deepEqual(cellIds(restored), ["cell3"]);
  advanceScriptTick(restored, restoredServices);
});

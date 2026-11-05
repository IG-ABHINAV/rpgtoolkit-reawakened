// Pure built-in commands test suite (ticket 3.12; SEM-3, SEM-4, SEM-5, SEM-6, E-92).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  advanceScriptTick,
  createGameState,
  createSurface,
  createSurfacesSection,
  hashState,
  restoreGameState,
  snapshot,
  startProgram,
  type GameState,
  type ScriptError,
} from "../src/index.ts";
import { actorFromSource } from "../src/sprites/model.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

function run(program: string, seed = 0): GameState {
  const state = createGameState({ seed });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  advanceOrFail(state, createScriptServices(state));
  return state;
}

function errorOf(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    const err = error as ScriptError;
    equal(typeof err.code, "string");
    return { code: err.code, message: err.message };
  }
  throw new Error("expected call to throw");
}

// ---------------------------------------------------------------------------
// Math, random, and conditional built-ins
// ---------------------------------------------------------------------------

test("math built-ins use deterministic fmath operations and by-reference outputs", () => {
  const state = run(`
    s = sin(0)
    c = cos(0)
    t = tan(0)
    q = sqrt(9)
    l = log(1)
    i = iif(1, 7, 8)
    chosen = iif(0, 7, 8)
    gettickcount(milliseconds)
  `);
  equal(state.vm.globals.s, 0);
  equal(state.vm.globals.c, 1);
  equal(state.vm.globals.t, 0);
  equal(state.vm.globals.q, 3);
  equal(state.vm.globals.l, 0);
  equal(state.vm.globals.i, 7);
  equal(state.vm.globals.chosen, 8);
  equal(state.vm.globals.milliseconds, 0);
});

test("random uses the seeded stream and matches legacy 3.1 edge cases", () => {
  const first = run("a = random(10)\nb = random(10)\nc = random(10)\n", 1234);
  const second = run("a = random(10)\nb = random(10)\nc = random(10)\n", 1234);
  deepEqual(
    [first.vm.globals.a, first.vm.globals.b, first.vm.globals.c],
    [second.vm.globals.a, second.vm.globals.b, second.vm.globals.c],
  );
  for (const value of [first.vm.globals.a, first.vm.globals.b, first.vm.globals.c]) {
    if (typeof value !== "number") throw new Error("random returned a non-number");
    equal(value >= 1 && value <= 10, true);
  }
  // Truncates max to whole number first
  const floatCase = run("x = random(1.5)\n", 1234);
  equal(floatCase.vm.globals.x, 1);
  // max 0 returns 1
  const zeroCase = run("x = random(0)\n", 1234);
  equal(zeroCase.vm.globals.x, 1);
  // negative max gives 1..|max|
  const negCase = run("x = random(-5)\n", 1234);
  const negVal = negCase.vm.globals.x;
  equal(typeof negVal === "number" && negVal >= 1 && negVal <= 5, true);
  // NaN max gives 1..32768
  const nanCase = run("x = random(0/0)\n", 1234);
  const nanVal = nanCase.vm.globals.x;
  equal(typeof nanVal === "number" && nanVal >= 1 && nanVal <= 32768, true);
  // Optional trailing destination parameter
  const destCase = run("res = random(10, out)\n", 1234);
  equal(destCase.vm.globals.res, destCase.vm.globals.out);
});

test("isNaN classifies NaN from 0/0 and sqrt(-1) both in temporaries and byRef variables", () => {
  const state = run(`
    x = 0 / 0
    t1 = isNaN(x)
    t2 = isNaN(0 / 0)
    t3 = isNaN(sqrt(-1))
    t4 = isNaN(42)
    t5 = isNaN(0)
    t6 = isNaN(1 / 0)
    t7 = isNaN(-1 / 0)
    t8 = isNaN("NaN")
    t9 = isNaN("123")
    t10 = isNaN("hello")
    isNaN(x, destOut)
  `);
  equal(state.vm.globals.t1, 1);
  equal(state.vm.globals.t2, 1);
  equal(state.vm.globals.t3, 1);
  equal(state.vm.globals.t4, 0);
  equal(state.vm.globals.t5, 0);
  equal(state.vm.globals.t6, 0);
  equal(state.vm.globals.t7, 0);
  equal(state.vm.globals.t8, 0);
  equal(state.vm.globals.t9, 0);
  equal(state.vm.globals.t10, 0);
  equal(state.vm.globals.destout, 1);
});

test("isInfinity classifies positive and negative infinity both in temporaries and byRef variables", () => {
  const state = run(`
    posInf = 1 / 0
    negInf = -1 / 0
    t1 = isInfinity(posInf)
    t2 = isInfinity(negInf)
    t3 = isInfinity(1 / 0)
    t4 = isInfinity(-1 / 0)
    t5 = isInfinity(0 / 0)
    t6 = isInfinity(42)
    t7 = isInfinity(0)
    t8 = isInfinity("Infinity")
    t9 = isInfinity("-Infinity")
    t10 = isInfinity("123")
    isInfinity(posInf, destOut)
  `);
  equal(state.vm.globals.t1, 1);
  equal(state.vm.globals.t2, 1);
  equal(state.vm.globals.t3, 1);
  equal(state.vm.globals.t4, 1);
  equal(state.vm.globals.t5, 0);
  equal(state.vm.globals.t6, 0);
  equal(state.vm.globals.t7, 0);
  equal(state.vm.globals.t8, 0);
  equal(state.vm.globals.t9, 0);
  equal(state.vm.globals.t10, 0);
  equal(state.vm.globals.destout, 1);
});

test("isFinite classifies finite numbers and rejects non-numbers, NaN and infinities", () => {
  const state = run(`
    f1 = 42
    f2 = -5.5
    f3 = 0
    t1 = isFinite(f1)
    t2 = isFinite(f2)
    t3 = isFinite(f3)
    t4 = isFinite(100)
    t5 = isFinite(0 / 0)
    t6 = isFinite(1 / 0)
    t7 = isFinite(-1 / 0)
    t8 = isFinite("42")
    t9 = isFinite("hello")
    t10 = isFinite("")
    isFinite(f1, destOut)
  `);
  equal(state.vm.globals.t1, 1);
  equal(state.vm.globals.t2, 1);
  equal(state.vm.globals.t3, 1);
  equal(state.vm.globals.t4, 1);
  equal(state.vm.globals.t5, 0);
  equal(state.vm.globals.t6, 0);
  equal(state.vm.globals.t7, 0);
  equal(state.vm.globals.t8, 0);
  equal(state.vm.globals.t9, 0);
  equal(state.vm.globals.t10, 0);
  equal(state.vm.globals.destout, 1);
});

test("number classification invariant: exactly one of isNaN, isInfinity, isFinite returns 1 for any number", () => {
  const state = run(`
    numNan = 0 / 0
    numPosInf = 1 / 0
    numNegInf = -1 / 0
    numZero = 0
    numInt = 12345
    numFloat = -98.765
    nan_nan = isNaN(numNan)
    nan_inf = isInfinity(numNan)
    nan_fin = isFinite(numNan)
    pos_nan = isNaN(numPosInf)
    pos_inf = isInfinity(numPosInf)
    pos_fin = isFinite(numPosInf)
    neg_nan = isNaN(numNegInf)
    neg_inf = isInfinity(numNegInf)
    neg_fin = isFinite(numNegInf)
    zero_nan = isNaN(numZero)
    zero_inf = isInfinity(numZero)
    zero_fin = isFinite(numZero)
    int_nan = isNaN(numInt)
    int_inf = isInfinity(numInt)
    int_fin = isFinite(numInt)
    float_nan = isNaN(numFloat)
    float_inf = isInfinity(numFloat)
    float_fin = isFinite(numFloat)
  `);
  const g = state.vm.globals;
  for (const prefix of ["nan", "pos", "neg", "zero", "int", "float"]) {
    const isN = g[`${prefix}_nan`];
    const isI = g[`${prefix}_inf`];
    const isF = g[`${prefix}_fin`];
    equal((isN as number) + (isI as number) + (isF as number), 1, `sum for ${prefix}`);
    equal(isF === 1, isN === 0 && isI === 0, `iff for ${prefix}`);
  }
});

test("snapshot and restore round-trips programs holding NaN, +Infinity and -Infinity with identical hash", () => {
  const state = run(`
    nanVar = 0 / 0
    posInfVar = 1 / 0
    negInfVar = -1 / 0
    finiteVar = 42
  `);
  const initialHash = hashState(state);
  const snap = snapshot(state);
  const restored = restoreGameState(snap);
  const restoredHash = hashState(restored);

  equal(restoredHash, initialHash);
  equal(Number.isNaN(restored.vm.globals.nanvar), true);
  equal(restored.vm.globals.posinfvar, Infinity);
  equal(restored.vm.globals.neginfvar, -Infinity);
  equal(restored.vm.globals.finitevar, 42);

  // Resume and verify isNaN, isInfinity and isFinite on restored state
  const stateWithContinuation = createGameState({ seed: 0 });
  stateWithContinuation.vm = restored.vm;
  startProgram(stateWithContinuation.vm, {
    kind: "inline",
    text: "checkNan = isNaN(nanVar)\ncheckPosInf = isInfinity(posInfVar)\ncheckNegInf = isInfinity(negInfVar)\ncheckFinite = isFinite(finiteVar)\nend()\n",
    ir: "1",
  });
  const services = createScriptServices(stateWithContinuation);
  advanceScriptTick(stateWithContinuation, services);
  equal(stateWithContinuation.vm.globals.checknan, 1);
  equal(stateWithContinuation.vm.globals.checkposinf, 1);
  equal(stateWithContinuation.vm.globals.checkneginf, 1);
  equal(stateWithContinuation.vm.globals.checkfinite, 1);
});

test("random stream snapshots round-trip while a program is waiting", () => {
  const state = createGameState({ seed: 1234 });
  startProgram(state.vm, {
    kind: "inline",
    text: "first = random(100)\nsleep(1)\nsecond = random(100)\nend()\n",
    ir: "1",
  });
  const services = createScriptServices(state);
  advanceScriptTick(state, services);
  equal(state.vm.threads[0]?.status, "waiting");
  const restored = restoreGameState(snapshot(state));
  advanceScriptTick(state, services);
  advanceScriptTick(restored, createScriptServices(restored));
  equal(hashState(restored), hashState(state));
  equal(restored.vm.globals.second, state.vm.globals.second);
});

// ---------------------------------------------------------------------------
// String Built-Ins
// ---------------------------------------------------------------------------

test("len and length return string length and write to byRef output", () => {
  const state = run(`
    a = len("hello")
    b = length("world!")
    len("testing", out1)
    length("done", out2)
  `);
  equal(state.vm.globals.a, 5);
  equal(state.vm.globals.b, 6);
  equal(state.vm.globals.out1, 7);
  equal(state.vm.globals.out2, 4);

  const err = errorOf(() => run('len("hello", 123)'));
  equal(err.code, "builtin.out-not-by-ref");
});

test("left extracts leftmost characters and handles clamp bounds", () => {
  const state = run(`
    a = left("abcdef", 3)
    b = left("abc", 10)
    c = left("abc", -1)
    left("xyz123", 2, d)
  `);
  equal(state.vm.globals.a, "abc");
  equal(state.vm.globals.b, "abc");
  equal(state.vm.globals.c, "");
  equal(state.vm.globals.d, "xy");
});

test("right extracts rightmost characters and handles clamp bounds", () => {
  const state = run(`
    a = right("abcdef", 3)
    b = right("abc", 10)
    c = right("abc", -1)
    right("xyz123", 3, d)
  `);
  equal(state.vm.globals.a, "def");
  equal(state.vm.globals.b, "abc");
  equal(state.vm.globals.c, "");
  equal(state.vm.globals.d, "123");
});

test("mid extracts substrings using 1-based start indexing", () => {
  const state = run(`
    a = mid("abcdef", 2, 3)
    b = mid("hello", 1, 4)
    c = mid("short", 10, 2)
    mid("banana", 3, 2, d)
  `);
  equal(state.vm.globals.a, "bcd");
  equal(state.vm.globals.b, "hell");
  equal(state.vm.globals.c, "");
  equal(state.vm.globals.d, "na");
});

test("inStr finds 1-based needle position with optional 1-based offset", () => {
  const state = run(`
    a = instr("haystack", "stack")
    b = instr("haystack", "needle")
    c = instr("banana", "an", 3)
    instr("apple pie", "pie", 1, d)
  `);
  equal(state.vm.globals.a, 4);
  equal(state.vm.globals.b, 0);
  equal(state.vm.globals.c, 4);
  equal(state.vm.globals.d, 7);
});

test("replace substitutes all occurrences in string", () => {
  const state = run(`
    a = replace("banana", "a", "o")
    b = replace("hello world", "world", "there")
    replace("cat sat on mat", "at", "ar", c)
  `);
  equal(state.vm.globals.a, "bonono");
  equal(state.vm.globals.b, "hello there");
  equal(state.vm.globals.c, "car sar on mar");
});

test("regExpReplace substitutes using regular expressions and catches bad patterns", () => {
  const state = run(`
    a = regexpreplace("foo123bar", "[0-9]+", "X")
    regexpreplace("a1b2c3", "[a-z]", "_", b)
  `);
  equal(state.vm.globals.a, "fooXbar");
  equal(state.vm.globals.b, "_1_2_3");

  const err = errorOf(() => run('regexpreplace("test", "[invalid(", "x")'));
  equal(err.code, "builtin.bad-arg");
});

test("split splits string by delimiter and writes array elements returning count + 1", () => {
  const state = run(`
    count = split("apple,banana,orange", ",", fruits)
    count2 = split("one|two", "|", parts)
  `);
  equal(state.vm.globals.count, 4);
  equal(state.vm.globals["fruits[0]"], "apple");
  equal(state.vm.globals["fruits[1]"], "banana");
  equal(state.vm.globals["fruits[2]"], "orange");

  equal(state.vm.globals.count2, 3);
  equal(state.vm.globals["parts[0]"], "one");
  equal(state.vm.globals["parts[1]"], "two");

  const err = errorOf(() => run('split("a,b", ",", "notAVal")'));
  equal(err.code, "builtin.out-not-by-ref");
});

test("trim removes whitespace and writes to byRef output", () => {
  const state = run(`
    a = trim("   hello world   ")
    trim("  spaces  ", b)
  `);
  equal(state.vm.globals.a, "hello world");
  equal(state.vm.globals.b, "spaces");
});

test("lcase and ucase fold ASCII cases correctly", () => {
  const state = run(`
    a = lcase("Hello WORLD 123!")
    b = ucase("Hello world 123!")
    lcase("TEST", c)
    ucase("test", d)
  `);
  equal(state.vm.globals.a, "hello world 123!");
  equal(state.vm.globals.b, "HELLO WORLD 123!");
  equal(state.vm.globals.c, "test");
  equal(state.vm.globals.d, "TEST");
});

test("asc and chr perform ASCII character conversions", () => {
  const state = run(`
    a = asc("A")
    b = asc("")
    c = chr(65)
    asc("Z", d)
    chr(90, e)
  `);
  equal(state.vm.globals.a, 65);
  equal(state.vm.globals.b, 0);
  equal(state.vm.globals.c, "A");
  equal(state.vm.globals.d, 90);
  equal(state.vm.globals.e, "Z");
});

test("charAt retrieves 1-based character at position or empty string", () => {
  const state = run(`
    a = charat("hello", 1)
    b = charat("hello", 5)
    c = charat("hello", 6)
    c2 = charat("hello", 0)
    charat("abc", 2, d)
  `);
  equal(state.vm.globals.a, "h");
  equal(state.vm.globals.b, "o");
  equal(state.vm.globals.c, "");
  equal(state.vm.globals.c2, "");
  equal(state.vm.globals.d, "b");
});

test("spliceVariables substitutes global variables enclosed in angle brackets", () => {
  const state = run(`
    hero = "Alex"
    score = 100
    msg = splicevariables("Welcome <hero>! Score: <score> [missing: <unknown>]")
    splicevariables("Hello <hero>", msg2)
  `);
  equal(state.vm.globals.msg, "Welcome Alex! Score: 100 [missing: ]");
  equal(state.vm.globals.msg2, "Hello Alex");
});

// ---------------------------------------------------------------------------
// Conversion Built-Ins
// ---------------------------------------------------------------------------

test("castLit formats numbers with six significant digits per SEM-3", () => {
  const state = run(`
    a = castlit(1234567)
    b = castlit(2.50)
    c = castlit(-0.0000123456)
    castlit(42, d)
  `);
  equal(state.vm.globals.a, "1.23457e+06");
  equal(state.vm.globals.b, "2.5");
  equal(state.vm.globals.c, "-1.23456e-05");
  equal(state.vm.globals.d, "42");
});

test("castNum parses strings to numbers using longest valid prefix", () => {
  const state = run(`
    a = castnum("12abc")
    b = castnum("abc")
    c = castnum("  3.14xyz")
    castnum("999", d)
  `);
  equal(state.vm.globals.a, 12);
  equal(state.vm.globals.b, 0);
  equal(state.vm.globals.c, 3.14);
  equal(state.vm.globals.d, 999);
});

test("castInt truncates numbers to 32-bit integers toward zero", () => {
  const state = run(`
    a = castint(-2.7)
    b = castint("3.9abc")
    c = castint(4.2)
    castint(15.9, d)
  `);
  equal(state.vm.globals.a, -2);
  equal(state.vm.globals.b, 3);
  equal(state.vm.globals.c, 4);
  equal(state.vm.globals.d, 15);
});

// ---------------------------------------------------------------------------
// Scope & Variable Built-Ins
// ---------------------------------------------------------------------------

test("autoLocal true allocates new assignments in frame locals", () => {
  const state = run(`
    autolocal(true)
    x = 10
    autolocal(false)
    y = 20
  `);
  // x was allocated in top-level frame locals, discarded on thread completion
  equal(Object.hasOwn(state.vm.globals, "x"), false);
  // y was allocated in globals
  equal(state.vm.globals.y, 20);
});

test("autoLocal propagates across function calls", () => {
  const state = run(`
    autolocal(true)
    function testFn() {
      inside = 42
    }
    testFn()
  `);
  // inside was created in testFn's locals because autoLocal was propagated
  equal(Object.hasOwn(state.vm.globals, "inside"), false);
});

test("kill deletes scalar variables from scope", () => {
  const state = run(`
    x = 10
    kill(x)
    after = x
  `);
  // Reading x after kill yields unset 0 and re-creates it as 0
  equal(state.vm.globals.after, 0);
  equal(state.vm.globals.x, 0);
});

test("kill deletes single array elements without affecting siblings", () => {
  const state = run(`
    a[0] = "first"
    a[1] = "second"
    kill(a[1])
    read0 = a[0]
    read1 = a[1]
  `);
  equal(state.vm.globals.read0, "first");
  equal(state.vm.globals.read1, 0);
});

test("kill deletes whole array prefixed variables", () => {
  const state = run(`
    arr[0] = 100
    arr[1] = 200
    arr[2] = 300
    other = 99
    kill(arr)
    check0 = arr[0]
    checkother = other
  `);
  equal(state.vm.globals.check0, 0);
  equal(state.vm.globals.checkother, 99);
  equal(Object.hasOwn(state.vm.globals, "arr[1]"), false);
  equal(Object.hasOwn(state.vm.globals, "arr[2]"), false);
});

test("kill variadic deletes multiple variables in single call", () => {
  const state = run(`
    x = 1
    y = 2
    z = 3
    kill(x, y, z)
  `);
  equal(Object.hasOwn(state.vm.globals, "x"), false);
  equal(Object.hasOwn(state.vm.globals, "y"), false);
  equal(Object.hasOwn(state.vm.globals, "z"), false);
});

test("local and global allocate variables dynamically", () => {
  const state = run(`
    global(myglobal)
    local(mylocal)
  `);
  equal(Object.hasOwn(state.vm.globals, "myglobal"), true);
  equal(state.vm.globals.myglobal, 0);

  // Also test functional BuiltinSpec call directly
  const services = createScriptServices(createGameState({ seed: 0 }));
  const localSpec = services.commands.get("local")?.spec;
  const globalSpec = services.commands.get("global")?.spec;
  equal(localSpec !== undefined, true);
  equal(globalSpec !== undefined, true);
  const resLocal = localSpec!.call(
    services.view,
    [{ value: "dynLocal", ref: null }],
    () => ({ value: null }),
  );
  equal(resLocal.value, 0);
  equal(resLocal.effects?.[0]?.kind, "vm.control");
  equal(resLocal.effects?.[0]?.args?.[1], "dynLocal");
});

// ---------------------------------------------------------------------------
// E-92 Virtual Variables
// ---------------------------------------------------------------------------

test("E-92 virtual gametime is read-only", () => {
  const state = createGameState({ seed: 0 });
  state.time.tick = 180; // 3 seconds at 60 fps
  startProgram(state.vm, {
    kind: "inline",
    text: `
      t1 = gametime
      gametime = 999
      t2 = gametime
    `,
    ir: "1",
  });
  const services = createScriptServices(state);
  const error = errorOf(() => advanceOrFail(state, services));
  equal(error.code, "assign.read-only");
  equal(state.vm.globals.t1, 3);
  equal(state.vm.globals.t2, 3);
  equal(state.vm.globals.gametime, undefined);
  equal(services.virtuals.read("gametime"), 3);
});

test("E-92 virtual variables read engine state sections", () => {
  const state = createGameState({ seed: 0 });
  // Set mock engine state on sections
  // The `music` virtual reads the music track's file, which stop keeps (docs/spec/engine/audio-media.md#audio-lifecycle, Q19).
  const musicTrack = state.audio.tracks.find((track) => track.name === "music");
  if (musicTrack === undefined) throw new Error("the audio section has no music track");
  musicTrack.file = "media/town.mid" as never;
  type LegacyWorldSection = { board?: { background?: string; skill?: number; constants?: Record<number, number> } };
  // This test exercises the legacy virtual-variable shape, not the tracer board state.
  const legacyWorld = state.world as unknown as LegacyWorldSection;
  legacyWorld.board = {
    background: "forest.png",
    skill: 5,
    constants: { 0: 42, 1: 100 },
  };
  // A live surface, because `cnvRenderNow` names a canvas: handle 0 is the screen and a killed canvas is not a canvas.
  state.surfaces = createSurfacesSection(4, 4);
  const overlay = createSurface(state.surfaces, 1, 1);
  state.surfaces.renderNow = overlay;
  const hero = addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
  state.sprites.players = [actorFromSource({ id: "hero", actorId: hero.id, kind: "player", source: "hero.tem", x: 12, y: 34, layer: 2 }, null, 0, null)];
  state.party.members = [hero.id];
  state.party.selected = hero.id;

  startProgram(state.vm, {
    kind: "inline",
    text: `
      m = music
      bg = boardbackground
      sk = boardskill
      cnv = cnvrendernow
      px = playerx[0]
      py = playery[0]
      pl = playerlayer[0]
      ph = playerhandle[0]
      c0 = constant[0]
      c1 = constant[1]
    `,
    ir: "1",
  });
  advanceScriptTick(state, createScriptServices(state));

  equal(state.vm.globals.m, "media/town.mid");
  equal(state.vm.globals.bg, "forest.png");
  equal(state.vm.globals.sk, 5);
  equal(state.vm.globals.cnv, overlay);
  equal(state.vm.globals.px, 12);
  equal(state.vm.globals.py, 34);
  equal(state.vm.globals.pl, 2);
  equal(state.vm.globals.ph, "Hero");
  equal(state.vm.globals.c0, 42);
  equal(state.vm.globals.c1, 100);
});

// ---------------------------------------------------------------------------
// Snapshot & Restore Verification
// ---------------------------------------------------------------------------

test("pure built-ins execution preserves snapshot and state hash", () => {
  const state = run(`
    msg = "hello"
    count = split("x,y,z", ",", arr)
    val = castnum("123")
    sub = mid(msg, 2, 3)
  `);

  const initialHash = hashState(state);
  const snap = snapshot(state);
  const restored = restoreGameState(snap);
  const restoredHash = hashState(restored);

  equal(restoredHash, initialHash);
  deepEqual(restored.vm.globals, state.vm.globals);
});

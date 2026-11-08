// The save tree, canonical form and restore checks (AD-7, AD-10, AD-11, AD-23):
// the 22-section shape, a mid-yield round-trip and the two pinned restore errors.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canon,
  CANON_MAX_DEPTH,
  createAssetIndex,
  createGameState,
  advanceScriptTick,
  fileProgramRef,
  PACKAGE_ROOT,
  readStepCounters,
  restoreGameState,
  snapshot,
  startProgram,
  startThread,
  withOwner,
  type GameState,
  type ScriptError,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}

function midYieldState(): GameState {
  const state = createGameState({ seed: 3 });
  startProgram(state.vm, {
    kind: "inline",
    text: 'greeting = "hi"\ncount = 2\nsleep(count)\ncount = 3\nend()\n',
    ir: "1",
  });
  advanceScriptTick(state, createScriptServices(state));
  return state;
}

test("GameState is PlainData and has 22 top-level sections", () => {
  const state = createGameState({ seed: 0 });
  equal(Object.keys(state).length, 22);
  equal(typeof canon(state), "string");
  deepEqual(state.schema.ir, "1");
});

test("canon round-trips through restore for a mid-yield state", () => {
  const state = midYieldState();
  equal(state.vm.threads[0]!.status, "waiting");

  const json = snapshot(state);
  equal(canon(restoreGameState(json)), json);
});

test("restore refuses a newer instruction version and a missing section", () => {
  const json = snapshot(createGameState({ seed: 0 }));
  ok(!Object.hasOwn(JSON.parse(json).schema, "compiler"), "the save no longer carries schema.compiler");

  const newer = JSON.parse(json) as { schema: { ir: string } };
  newer.schema.ir = "999";
  const error = errorOf(() => restoreGameState(JSON.stringify(newer)));
  equal(error.code, "restore.ir-mismatch");
  ok(error.message.includes("schema.ir"), error.message);
  const malformedHost = JSON.parse(json) as { schema: { ir: string; features: unknown } };
  malformedHost.schema.ir = "999";
  malformedHost.schema.features = "invalid";
  equal(errorOf(() => restoreGameState(JSON.stringify(malformedHost))).code, "restore.ir-mismatch");

  const missingSection = JSON.parse(json) as Record<string, unknown>;
  delete missingSection.vm;
  equal(errorOf(() => restoreGameState(JSON.stringify(missingSection))).code, "restore.shape");

  equal(errorOf(() => restoreGameState("{ not json")).code, "restore.shape");
});

test("a compiler: 1 snapshot fixture loads its data and restarts its thread", () => {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "save",
    "compiler-1-snapshot.json",
  );
  const restored = restoreGameState(readFileSync(fixturePath, "utf8"));
  equal(restored.schema.ir, "1");
  equal(restored.schema.audio, 2);
  equal(restored.vm.threads.length, 1);
  const thread = restored.vm.threads[0]!;
  equal(thread.frames.length, 1);
  equal(thread.frames[0]!.ip, 0);
  deepEqual(thread.frames[0]!.locals, {});
  equal(thread.frames[0]!.program.ir, "1");
  equal(thread.status, "ready");
});

test("a thread saved by an older instruction version restarts from source, not at its saved position", () => {
  const state = createGameState({ seed: 7 });
  startProgram(state.vm, { kind: "inline", text: "value = 42\nend()\n", ir: "1" });
  const json = JSON.parse(snapshot(state)) as { vm: { threads: { frames: { program: { ir: string } }[] }[] } };
  json.vm.threads[0]!.frames[0]!.program.ir = "0";

  const restored = restoreGameState(JSON.stringify(json));
  equal(restored.schema.ir, "1");
  equal(restored.vm.threads[0]!.frames.length, 1);
  equal(restored.vm.threads[0]!.frames[0]!.ip, 0);
  deepEqual(restored.vm.threads[0]!.frames[0]!.locals, {});
  equal(restored.vm.threads[0]!.frames[0]!.program.ir, "1");
  equal(restored.vm.threads[0]!.status, "ready");
});

test("a position-free reference from an older instruction version never refuses the save", () => {
  const state = createGameState({ seed: 3 });
  state.vm.defOwners = { f: { kind: "inline", text: "function f() { return 1 }\n", ir: "0" } };
  const restored = restoreGameState(snapshot(state));
  equal(restored.schema.ir, "1");
  equal(restored.vm.defOwners?.f?.ir, "0");
});

test("an object program from an older instruction version is recompiled, not refused", () => {
  const bytes = Uint8Array.from([...`value = 42\nend()\n`].map((char) => char.charCodeAt(0)));
  const loader = { index: createAssetIndex(["Prg/main.prg"]), root: PACKAGE_ROOT, read: () => bytes };
  const state = createGameState({ seed: 9 });
  startThread(state.vm, { ref: withOwner(fileProgramRef(loader, "main.prg"), "alpha"), kind: "blocking", owner: "script" });
  const json = JSON.parse(snapshot(state)) as { vm: { threads: { frames: { program: { ir: string } }[] }[] } };
  json.vm.threads[0]!.frames[0]!.program.ir = "0";

  const restored = restoreGameState(JSON.stringify(json));
  ok(restored.vm.threads[0]!.frames[0]!.program.kind === "file");
  equal(restored.vm.threads[0]!.frames[0]!.program.ir, "1");
});

test("restore rejects malformed nested VM state", () => {
  const malformed = JSON.parse(snapshot(midYieldState())) as { vm: { threads: Array<Record<string, unknown>> } };
  malformed.vm.threads[0]!.frames = "not-an-array";
  equal(errorOf(() => restoreGameState(JSON.stringify(malformed))).code, "restore.shape");
});

test("a changed owner file source restarts with package attribution", () => {
  const source = { bytes: Uint8Array.from([...`value = 2\nend()\n`].map((char) => char.charCodeAt(0))) };
  const loader = {
    index: createAssetIndex(["Prg/main.prg"]),
    root: PACKAGE_ROOT,
    read: () => source.bytes,
  };
  const state = createGameState({ seed: 9 });
  const ref = withOwner(fileProgramRef(loader, "main.prg"), "alpha");
  const thread = startThread(state.vm, { ref, kind: "blocking", owner: "script" });
  const services = createScriptServices(state, [], undefined, undefined, loader);

  source.bytes = Uint8Array.from([...`value = 7\nend()\n`].map((char) => char.charCodeAt(0)));
  advanceScriptTick(state, services);

  equal(state.vm.globals.value, 7);
  equal(thread.status, "finished");
  const counters = readStepCounters(state.vm);
  equal(Object.keys(counters).join(","), "alpha");
  equal(counters.alpha! > 0, true);
});
test("a changed unowned file source remains unowned", () => {
  const source = { bytes: Uint8Array.from([...`value = 2\nend()\n`].map((char) => char.charCodeAt(0))) };
  const loader = {
    index: createAssetIndex(["Prg/main.prg"]),
    root: PACKAGE_ROOT,
    read: () => source.bytes,
  };
  const state = createGameState({ seed: 9 });
  const thread = startThread(state.vm, { ref: fileProgramRef(loader, "main.prg"), kind: "blocking", owner: "script" });
  const services = createScriptServices(state, [], undefined, undefined, loader);

  source.bytes = Uint8Array.from([...`value = 7\nend()\n`].map((char) => char.charCodeAt(0)));
  advanceScriptTick(state, services);

  equal(state.vm.globals.value, 7);
  equal(thread.status, "finished");
  equal(Object.keys(readStepCounters(state.vm)).length, 0);
});

test("snapshot rejects script-created nesting at the deterministic bound", () => {
  const state = createGameState({ seed: 11 });
  let value: unknown = 0;
  for (let depth = 0; depth <= CANON_MAX_DEPTH; depth++) value = { value };
  (state.vm.globals as Record<string, unknown>).deep = value;

  throws(
    () => snapshot(state),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === `canon: maximum nesting depth ${CANON_MAX_DEPTH} exceeded`,
  );
});

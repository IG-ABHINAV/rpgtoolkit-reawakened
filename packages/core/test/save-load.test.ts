// 8.10 (#593): the load path as one contract. An untrusted blob is validated and
// its data sections migrate forward before any payload is used; package services
// are rebuilt and actor behaviour names resolve before the restored state goes
// live; threads resume or restart by the owner's compatibility rule
// (docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling);
// and a refused load leaves the live game, its counters and its waiting threads
// exactly as they were.
//
// The suite drives the engine's own `Load` through the blob port wherever it can,
// so the acceptance is the composed path rather than a hand-written state.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  IR_VERSION,
  SCHEMA_VERSIONS,
  addActor,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  createGameState,
  fileProgramRef,
  hashGameState,
  restoreGameSave,
  restoreGameState,
  snapshot,
  snapshotGameSave,
  startThread,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type GameState,
  type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PATHS = ["main.gam", "boards/start.brd", "prg/start.prg"];

type Game = {
  readonly files: Map<AssetKey, Uint8Array>;
  readonly engine: ReturnType<typeof createEngine>;
  state(): GameState | null;
};

/**
 * A boot-mode game whose start-up program ends at once. Each program becomes a
 * board thread on the first running tick: an inline program, or a file program
 * when `files` names it (`fileThread`).
 */
function boot(
  programs: string | readonly string[],
  options: { readonly extra?: Readonly<Record<string, string>>; readonly fileThread?: string; readonly pixelMovement?: number } = {},
): Game {
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", pixelMovement: options.pixelMovement ?? 0 });
  if (!main.ok) throw new Error(main.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({ ...empty, properties: { ...empty.properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  const paths = [...PATHS];
  for (const [name, text] of Object.entries(options.extra ?? {})) {
    paths.push(`prg/${name}`);
    files.set(assetKey(`prg/${name}`), encoder.encode(text));
  }
  const loader = { index: createAssetIndex(paths), root: { kind: "package" as const }, read: (key: AssetKey) => files.get(key) ?? new Uint8Array() };
  const texts = typeof programs === "string" ? [programs] : programs;
  let latest: GameState | null = null;
  let started = false;
  const engine = createEngine({
    seed: 11,
    assetIndex: createAssetIndex(paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "load-validation-test",
    width: 64,
    height: 64,
    maxTicks: 400,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (started || state.engine.boot?.stage !== "running") return;
        started = true;
        texts.forEach((text, index) => {
          const ref = options.fileThread !== undefined && index === 0
            ? fileProgramRef(loader, options.fileThread)
            : { kind: "inline" as const, text, ir: IR_VERSION };
          startThread(state.vm, { ref, kind: "board", owner: "script" });
        });
      },
    }],
  });
  return { files, engine, state: () => latest };
}

type Run = {
  readonly saved: Uint8Array | null;
  readonly codes: string[];
  readonly diagnostics: readonly { code: string; file: string; line: number; message: string }[];
  readonly hashes: string[];
  readonly consumedKinds: string[][];
  readonly loadTicks: number[];
};

/**
 * Run a game for a bounded number of ticks, answering every request; `loadBytes`
 * answers a `Load`. Ticks whose blob reply is a `blob.loaded` are recorded with
 * the report's state hash, and every key record a tick consumed is counted.
 */
function run(
  game: Game,
  loadBytes: Uint8Array | null,
  options: { readonly ticks?: number; readonly keys?: readonly { readonly tick: number; readonly record: InputRecord }[] } = {},
): Run {
  const ticks = options.ticks ?? 60;
  const pending = [...(options.keys ?? [])];
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  const codes: string[] = [];
  const diagnostics: { code: string; file: string; line: number; message: string }[] = [];
  const hashes: string[] = [];
  const consumedKinds: string[][] = [];
  const loadTicks: number[] = [];
  for (let index = 0; index < ticks; index += 1) {
    for (const item of pending) if (item.tick === index) replies.push(item.record);
    const report = game.engine.advance(1, replies);
    replies = [];
    for (const diagnostic of report.diagnostics) {
      codes.push(diagnostic.code);
      diagnostics.push(diagnostic);
    }
    consumedKinds.push(report.consumed.map((record) => record.event.kind));
    let loaded = false;
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob") {
        const isSave = request.blob.path.endsWith(".sav");
        if (isSave) saved = new Uint8Array(request.bytes);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") {
        loaded = true;
        loadTicks.push(index + 1);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: loadBytes } });
      }
    }
    if (!loaded) hashes.push(report.stateHash);
  }
  return { saved, codes, diagnostics, hashes, consumedKinds, loadTicks };
}

// The saver counts before the save. A resumed thread runs on from `Save` and adds
// one; a thread restarted from source re-runs the increment over the restored
// value and adds two, so the final `counter` says which branch ran.
const SAVER = 'counter = counter + 1\nSave("slot")\ncounter = counter + 1\nend()\n';
const LOADER = 'Load("slot")\nafter = counter\nend()\n';

function capture(programs: string | readonly string[], options: Parameters<typeof boot>[1] = {}): Uint8Array {
  const result = run(boot(programs, options), null);
  ok(result.saved !== null, "the saver produced a save");
  return result.saved as Uint8Array;
}

function globals(state: GameState | null): Record<string, unknown> {
  ok(state !== null, "the engine reported its state");
  return state.vm.globals as Record<string, unknown>;
}

// --- 1. A validated load restores canonical state and identical future behaviour -----------------

test("a snapshot round-trips through the validator to the same canonical bytes and hash", () => {
  const game = boot(SAVER);
  run(game, null);
  const original = snapshot(game.state()!);
  const restored = restoreGameState(original);
  equal(snapshot(restored), original, "snapshot → restore → snapshot is byte-identical");
  equal(hashGameState(restored), hashGameState(game.state()!), "the restored state hashes as the saved one did");
});

test("a game save restores through `restoreGameSave` with no diagnostic and a stable hash", () => {
  const saved = capture(SAVER);
  const audio = createGameState({ seed: 3 }).audio;
  const restored = restoreGameSave(decoder.decode(saved), audio);
  equal(restored.diagnostics.length, 0, "a valid save reports no diagnostic");
  const reloaded = restoreGameState(snapshot(restored.state));
  deepEqual(reloaded.vm.globals, restored.state.vm.globals, "globals survive a second round trip");
  equal(hashGameState(reloaded), hashGameState(restored.state), "the state hash is stable across load and re-load");
});
test("a saved runtime movement setting survives save and load", () => {
  const saved = capture('pixelmovement(1, 1)\nSave("slot")\nrestoredWalking = pixelmovement()\nend()');
  const loader = boot(LOADER, { pixelMovement: 0 });
  const result = run(loader, saved);
  deepEqual(result.diagnostics, []);
  const restored = loader.state();
  ok(restored !== null);
  equal(restored.vm.globals.restoredwalking, 1, "the resumed RPGCode command reads the restored walking setting");
  deepEqual(restored.world.movement, { walking: 1, pushing: 1 });
});

test("each missing saved movement setting falls back independently to its associated main file", () => {
  const original = JSON.parse(decoder.decode(capture('Save("slot")\nrestoredWalking = pixelmovement()\nend()'))) as Record<string, unknown>;
  const world = original.world as Record<string, unknown>;
  const movement = world.movement as Record<string, unknown>;
  movement.walking = 0;
  movement.pushing = 1;

  const restoreWithMissing = (field: "walking" | "pushing"): GameState => {
    const oldSave = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
    const oldWorld = oldSave.world as Record<string, unknown>;
    const oldMovement = oldWorld.movement as Record<string, unknown>;
    delete oldMovement[field];
    const loader = boot(LOADER, { pixelMovement: 1 });
    deepEqual(run(loader, encoder.encode(JSON.stringify(oldSave))).diagnostics, []);
    const restored = loader.state();
    ok(restored !== null);
    return restored;
  };

  const missingWalking = restoreWithMissing("walking");
  deepEqual(missingWalking.world.movement, { walking: 1, pushing: 1 },
    "walking falls back to mode 1 while the saved pushing setting remains intact");
  equal(missingWalking.vm.globals.restoredwalking, 1, "RPGCode reads the fallback walking value");
  const missingPushing = restoreWithMissing("pushing");
  deepEqual(missingPushing.world.movement, { walking: 0, pushing: 0 },
    "pushing falls back to mode 1 while the saved walking setting remains intact");
  equal(missingPushing.vm.globals.restoredwalking, 0, "the saved false walking value remains visible to RPGCode");
  const schemaOne = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  const schemaOneSchema = schemaOne.schema as Record<string, unknown>;
  schemaOneSchema.world = 1;
  const schemaOneWorld = schemaOne.world as Record<string, unknown>;
  const schemaOneMovement = schemaOneWorld.movement as Record<string, unknown>;
  delete schemaOneMovement.walking;
  delete schemaOneMovement.pushing;
  const oldLoader = boot(LOADER, { pixelMovement: 1 });
  deepEqual(run(oldLoader, encoder.encode(JSON.stringify(schemaOne))).diagnostics, []);
  const oldRestored = oldLoader.state();
  ok(oldRestored !== null);
  deepEqual(oldRestored.world.movement, { walking: 1, pushing: 0 },
    "a schema-1 save with both fields absent uses mode 1 defaults");
  equal(oldRestored.vm.globals.restoredwalking, 1, "the migrated .gam fallback is visible through RPGCode");
});

test("a loaded thread continues exactly as the unsaved thread would have", () => {
  const saved = capture(SAVER);
  const loader = boot(LOADER);
  run(loader, saved);
  equal(globals(loader.state()).counter, 2, "the saved thread resumed after Save and ran the increment once");
});

// --- 2. Every waiting kind the VM stores round-trips unchanged ----------------------------------

type WaitThread = { status: string; wait: { kind: string } | null };

/**
 * A state with one thread parked on each plain-data wait kind. The cancelable-emit
 * wait (`event.dispatch`) is covered by `events-cancelable.test.ts`, which saves
 * mid-dispatch and finishes the dispatch after a restore.
 */
function waitingState(): GameState {
  const state = createGameState({ seed: 21 });
  const waits: unknown[] = [
    { kind: "sleep", global: true, until: 120, resumesCall: false },
    { kind: "sleep", global: false, until: null, resumesCall: true },
    { kind: "input.key", global: false, key: null },
    { kind: "input.key", global: false, key: "KeyA", parkSeq: 4, resumeRefs: ["v"], cursorMap: 2, cursorSelection: 1 },
    { kind: "movement", global: false, moves: [{ sprite: "player", until: 80 }, { sprite: "npc", until: 88 }] },
    { kind: "sprite.stance", global: false, actor: "player", stance: "walk" },
    { kind: "request", global: false, reqId: 3, deadline: null, reply: { ok: true, value: "answered" }, then: null, file: "prg/start.prg", line: 4 },
    { kind: "blob", global: false, reqId: 7, deadline: null, reply: { ok: true, value: "bytes" }, then: { command: "readfile", args: [] }, file: "prg/start.prg", line: 9 },
    { kind: "audio.track", global: false, id: "playmusic", payload: ["theme.mid"], resumeRefs: [] },
    { kind: "menu.screen", global: false, id: "showmenu", payload: [{ screen: "main" }], resumeRefs: ["choice"] },
    { kind: "render.msgbox", global: false, id: "message", payload: ["hello"], resumeRefs: [] },
    { kind: "input.mouse", global: false, id: "waitformouse", payload: [], resumeRefs: [] },
    { kind: "video", global: false, id: "playvideo", payload: ["intro.avi"], resumeRefs: [] },
  ];
  for (const [index, wait] of waits.entries()) {
    const thread = startThread(state.vm, { ref: { kind: "inline", text: "end()\n", ir: IR_VERSION }, kind: "board", owner: "script" });
    thread.status = "waiting";
    thread.wait = wait as never;
  }
  return state;
}

test("each waiting kind restores unchanged and the state keeps its hash", () => {
  const state = waitingState();
  const json = snapshot(state);
  const restored = restoreGameState(json);
  equal(snapshot(restored), json, "the canonical form of the waiting state is stable");
  equal(hashGameState(restored), hashGameState(state), "hashes match with threads parked on every kind");
  const waits = (value: GameState): unknown[] => value.vm.threads.map((thread) => ({ status: thread.status, wait: thread.wait }));
  deepEqual(waits(restored), waits(state), "every wait payload is preserved exactly");
  for (const thread of restored.vm.threads) {
    equal((thread as unknown as WaitThread).status, "waiting", "a waiting thread is still waiting after the restore");
    ok((thread as unknown as WaitThread).wait !== null, "a waiting thread keeps its wait");
  }
});

test("a load consumes only its own reply, never a queued input record", () => {
  const saved = capture(SAVER);
  const loader = boot(LOADER);
  const key: InputRecord = { tick: 0, event: { kind: "key", name: "Enter", code: "Enter", char: "\n", down: true } };
  const result = run(loader, saved, { ticks: 10, keys: [{ tick: 0, record: key }] });
  ok(result.loadTicks.length === 1, `the load committed once: ${JSON.stringify(result.loadTicks)}`);
  const loadTick = result.loadTicks[0]!;
  deepEqual(result.consumedKinds[loadTick], ["blob.loaded"], `the load tick consumed only its reply: ${JSON.stringify(result.consumedKinds)}`);
  equal(globals(loader.state()).counter, 2, "the load still took effect alongside the input");
});

test("two fresh engines loading one save produce the same ticks and the same final state", () => {
  const saved = capture(SAVER);
  const first = boot(LOADER);
  const firstRun = run(first, saved, { ticks: 12 });
  const second = boot(LOADER);
  const secondRun = run(second, saved, { ticks: 12 });
  deepEqual(secondRun.hashes, firstRun.hashes, "the post-load tick hashes are identical");
  deepEqual(globals(second.state()), globals(first.state()), "the final globals are identical");
  equal(hashGameState(second.state()!), hashGameState(first.state()!), "the final state hashes are identical");
});

// --- 3. Malformed blobs are refused with a located diagnostic and no partial state ---------------

const SECTIONS = Object.keys(SCHEMA_VERSIONS);

function tampered(bytes: Uint8Array, edit: (root: Record<string, unknown>) => void): Uint8Array {
  const root = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  edit(root);
  return encoder.encode(JSON.stringify(root));
}

type Refusal = { code: string; message: string };

function refusalOf(json: string): Refusal {
  try {
    restoreGameState(json);
  } catch (error) {
    return error as Refusal;
  }
  throw new Error("expected the snapshot to be refused");
}

test("every missing section is refused as a shape error naming the section", () => {
  const json = snapshot(waitingState());
  for (const section of SECTIONS) {
    const root = JSON.parse(json) as Record<string, unknown>;
    delete root[section];
    const refusal = refusalOf(JSON.stringify(root));
    equal(refusal.code, "restore.shape", `a missing ${section} is a shape refusal`);
    ok(refusal.message.includes(section), `the message names ${section}: ${refusal.message}`);
  }
});

test("every section of an impossible type is refused", () => {
  const json = snapshot(waitingState());
  for (const section of SECTIONS) {
    const root = JSON.parse(json) as Record<string, unknown>;
    root[section] = 42;
    const refusal = refusalOf(JSON.stringify(root));
    ok(["restore.shape", "restore.ir-mismatch"].includes(refusal.code), `a scalar ${section} is refused: ${refusal.code} ${refusal.message}`);
  }
});

test("a malformed thread is refused before it can be stepped", () => {
  const json = snapshot(waitingState());
  const edits: ((root: Record<string, unknown>) => void)[] = [
    (root) => { (root.vm as Record<string, unknown>).threads = "not an array"; },
    (root) => { ((root.vm as Record<string, unknown>).threads as unknown[])[0] = { id: 1 }; },
    (root) => { ((root.vm as Record<string, unknown>).threads as Record<string, unknown>[])[0]!.status = "running"; },
    (root) => { ((root.vm as Record<string, unknown>).threads as Record<string, unknown>[])[0]!.wait = 5; },
  ];
  for (const edit of edits) {
    const root = JSON.parse(json) as Record<string, unknown>;
    edit(root);
    const refusal = refusalOf(JSON.stringify(root));
    equal(refusal.code, "restore.shape", `the malformed thread is a shape refusal: ${refusal.message}`);
  }
});

test("a refused load leaves the live game exactly as a missing-save load does", () => {
  const MARKED = 'marker = 9\nLoad("slot")\nafter = marker\nend()\n';
  const malformed = tampered(capture(SAVER), (root) => { delete root.vm; });
  const refused = boot(MARKED);
  const refusedRun = run(refused, malformed, { ticks: 8 });
  const missing = boot(MARKED);
  const missingRun = run(missing, null, { ticks: 8 });

  equal(globals(refused.state()).after, 9, "the caller kept running after the refusal");
  equal(globals(missing.state()).after, globals(refused.state()).after, "a refused load leaves the same globals as a load that found nothing");
  equal(refusedRun.codes.filter((code) => code === "restore.shape").length, 1, "exactly one shape diagnostic is reported");
  deepEqual(
    refusedRun.hashes.slice(0, 3),
    missingRun.hashes.slice(0, 3),
    "the refused load's tick hashes match the untouched game's",
  );
});

// --- 4. Thread identity: one mismatched thread restarts, the matching one resumes ----------------

test("an older instruction version restarts the affected thread and nothing else", () => {
  const state = createGameState({ seed: 31 });
  const outdated = startThread(state.vm, { ref: { kind: "inline", text: "end()\n", ir: "0" }, kind: "board", owner: "script" });
  outdated.frames[0]!.ip = 4;
  outdated.status = "waiting";
  outdated.wait = { kind: "input.key", global: false, key: null } as never;
  const current = startThread(state.vm, { ref: { kind: "inline", text: "end()\n", ir: IR_VERSION }, kind: "board", owner: "script" });
  current.frames[0]!.ip = 9;
  current.status = "waiting";
  current.wait = { kind: "sleep", global: true, until: 120, resumesCall: false } as never;

  const restored = restoreGameState(snapshot(state));
  const [restarted, kept] = restored.vm.threads;
  ok(restarted !== undefined && kept !== undefined, "both threads restored");
  equal(restarted.frames[0]!.ip, 0, "the older thread restarts at its first instruction");
  equal(restarted.status, "ready", "the restarted thread is ready to run");
  equal(restarted.wait, null, "a restart drops the saved wait");
  equal(kept.frames[0]!.ip, 9, "the current thread keeps its saved position");
  equal(kept.status, "waiting", "the current thread keeps its wait");
  equal(kept.wait?.kind, "sleep", "the current thread's wait is untouched");
});

test("a save whose thread was restarted from source continues in the live engine", () => {
  const saved = capture(SAVER);
  const root = JSON.parse(decoder.decode(saved)) as { vm: { threads: { frames: { program: { ir: string } }[] }[] } };
  const thread = root.vm.threads.find((entry) => entry.frames.length > 0);
  ok(thread !== undefined, "the save holds its thread");
  thread.frames[0]!.program = { ...thread.frames[0]!.program, ir: "0" };
  const loader = boot(LOADER);
  run(loader, encoder.encode(JSON.stringify(root)));
  equal(globals(loader.state()).counter, 3, "the restarted thread ran its increment twice over the restored value");
});

test("a pre-split save (compiler, no ir) migrates its data and takes the ruled thread branch", () => {
  const saved = capture(SAVER);
  const presplit = (compiler: string): Uint8Array => {
    const root = JSON.parse(decoder.decode(saved)) as Record<string, unknown>;
    const schema = root.schema as Record<string, unknown>;
    schema.schema = 1;
    schema.vm = 5;
    delete schema.ir;
    schema.compiler = compiler;
    const rename = (ref: unknown): void => {
      if (typeof ref !== "object" || ref === null) return;
      const value = ref as Record<string, unknown>;
      if (typeof value.ir === "string") {
        delete value.ir;
        value.compiler = compiler;
      }
    };
    for (const thread of (root.vm as { threads: { frames: { program: unknown }[] }[] }).threads) {
      for (const frame of thread.frames) rename(frame.program);
    }
    const vm = root.vm as { objects?: { program: unknown }[]; defOwners?: Record<string, unknown> };
    for (const object of vm.objects ?? []) rename(object.program);
    for (const ref of Object.values(vm.defOwners ?? {})) rename(ref);
    return encoder.encode(JSON.stringify(root));
  };

  const current = boot(LOADER);
  const currentRun = run(current, presplit("2"));
  equal(currentRun.codes.filter((code) => code.startsWith("restore.")).length, 0, `a compiler-2 save migrates and loads: ${JSON.stringify(currentRun.codes)}`);
  equal(globals(current.state()).counter, 2, "its data migrated and the thread resumed at the migrated position");

  const older = boot(LOADER);
  const olderRun = run(older, presplit("1"));
  equal(olderRun.codes.filter((code) => code.startsWith("restore.")).length, 0, `a compiler-1 save migrates and loads: ${JSON.stringify(olderRun.codes)}`);
  equal(globals(older.state()).counter, 3, "its data migrated and the thread restarted from source");
});

test("a changed file source restarts that thread while the inline thread resumes", () => {
  const original = 'v = v + 1\nSave("slot")\nv = v + 1\nend()\n';
  const saved = capture('', { extra: { "saver.prg": original }, fileThread: "saver.prg" });
  const changed = 'v = v + 10\nend()\n';
  const loader = boot(LOADER, { extra: { "saver.prg": changed } });
  run(loader, saved);
  const values = globals(loader.state());
  equal(values.after, undefined, "the load replaced the loader's own continuation");
  equal(values.v, 11, "the changed source restarted from its first instruction over the restored value");
});

// --- 5. Actor hydration runs on the restored state, once, with a located diagnostic --------------

test("the engine's load resolves a restored actor's behaviour and reports a missing one once", () => {
  const state = createGameState({ seed: 5 });
  addActor(state.actors, { kind: "npc", source: "Chrs/ghost.chr", behaviour: "ghost_behaviour", stats: { hp: 4, maxHp: 4 } });
  const blob = encoder.encode(snapshotGameSave(state));

  const loader = boot('Load("slot")\nend()\n');
  const result = run(loader, blob, { ticks: 12 });
  const missing = result.diagnostics.filter((diagnostic) => diagnostic.code === "behaviour.missing");
  equal(missing.length, 1, "the unregistered behaviour is reported exactly once, at load time");
  ok(missing[0]!.message.includes("ghost_behaviour"), "the diagnostic names the behaviour");
  equal(restoreGameState(snapshot(loader.state()!)).actors.actors[0]?.behaviour, "ghost_behaviour", "the actor kept its behaviour name and the load committed");
});

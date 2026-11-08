// Owner ruling 2026-10-30 (docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling):
// data sections migrate forward; a thread resumes only when its instruction
// version is current, an older one restarts that thread from source, and a newer
// one refuses the whole save with the live game unchanged. This drives the real
// engine's `Load` against a captured save whose instruction version has been
// altered, and against the untouched save as a control.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  assetKey,
  canon,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  createGameState,
  fileProgramRef,
  IR_VERSION,
  SCHEMA_VERSIONS,
  startProgram,
  restoreRecoveryCandidate,
  snapshotRecoveryCandidate,
  snapshotGameSave,
  startThread,
  restoreGameState,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type GameState,
  type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();
const PATHS = ["main.gam", "boards/start.brd", "prg/start.prg"];

type Game = { readonly files: Map<AssetKey, Uint8Array>; readonly engine: ReturnType<typeof createEngine>; state(): GameState | null };

/**
 * A boot-mode game whose start-up program just ends and whose script `program` runs
 * as an inline thread once the game is running. An inline program has no source
 * hash, so it is never subject to the per-thread source-changed restart.
 */
function boot(
  program: string,
  startPrg = "end()\n",
  options: { readonly extra?: Readonly<Record<string, string>>; readonly fileThread?: string } = {},
): Game {
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" });
  if (!main.ok) throw new Error(main.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({ ...empty, properties: { ...empty.properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode(startPrg)],
  ]);
  const paths = [...PATHS];
  for (const [name, text] of Object.entries(options.extra ?? {})) {
    paths.push(`prg/${name}`);
    files.set(assetKey(`prg/${name}`), encoder.encode(text));
  }
  const programLoader = { index: createAssetIndex(paths), root: { kind: "package" as const }, read: (key: AssetKey) => files.get(key) ?? new Uint8Array() };
  let latest: GameState | null = null;
  let started = false;
  const engine = createEngine({
    seed: 5,
    assetIndex: createAssetIndex(paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "instruction-version-test",
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
        const ref = options.fileThread === undefined
          ? { kind: "inline" as const, text: program, ir: IR_VERSION }
          : fileProgramRef(programLoader, options.fileThread);
        startThread(state.vm, { ref, kind: "board", owner: "script" });
      },
    }],
  });
  return { files, engine, state: () => latest };
}

/** Run a game to completion, answering assets and optionally handing `loadBytes` to a Load. */
function run(game: Game, loadBytes: Uint8Array | null): { saved: Uint8Array | null; codes: string[] } {
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  const codes: string[] = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const report = game.engine.advance(1, replies);
    replies = [];
    codes.push(...report.diagnostics.map((diagnostic) => diagnostic.code));
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob") {
        saved = new Uint8Array(request.bytes);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") {
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: loadBytes } });
      }
    }
  }
  return { saved, codes };
}

type Json = {
  schema: { ir: string; schema?: number; engine?: number } | null;
  audio: unknown;
  vm: {
    threads: { frames: { program: { ir: string } }[] }[];
    objects: Array<{ program: { ir: string; kind: string; path?: string } | null }>;
  };
};
function tamper(bytes: Uint8Array, edit: (json: Json) => void): Uint8Array {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as Json;
  edit(json);
  return encoder.encode(JSON.stringify(json));
}

// The saver increments marker before the save and records it afterwards. A
// resumed thread continues after `Save` and writes 1; a thread restarted from
// source re-runs the increment over the restored value and writes 2.
const SAVER = 'marker = marker + 1\nSave("slot")\nafter = marker\nend()\n';
// Marker 9 is set before Load; a refused load leaves 9 and the caller runs on.
const LOADER = 'marker = 9\nLoad("slot")\nafter = marker\nend()\n';

const OBJECT_SAVER = `
class Saved {
  public:
  var value
}
savedObject = Saved()
Save("slot")
end()
`;

function capturedSave(): Uint8Array {
  const { saved } = run(boot(SAVER), null);
  ok(saved !== null, "the saver produced a save");
  return saved;
}

function capturedObjectSave(): Uint8Array {
  const { saved } = run(
    boot("", "end()\n", { extra: { "saved.prg": OBJECT_SAVER }, fileThread: "saved.prg" }),
    null,
  );
  ok(saved !== null, "the object saver produced a save");
  return saved;
}

test("control: a compatible save restores and resumes the saved thread", () => {
  const loader = boot(LOADER);
  const { codes } = run(loader, capturedSave());
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  equal(globals.after, 1, `the restored thread resumed after Save: ${JSON.stringify(codes)} ${JSON.stringify(globals)}`);
  equal(globals.marker, 1, "the saved globals were applied");
  equal(codes.includes("restore.ir-mismatch"), false);
});

test("a save whose schema.ir is older but whose thread positions are current resumes", () => {
  const loader = boot(LOADER);
  const { codes } = run(loader, tamper(capturedSave(), (json) => {
    if (json.schema === null) throw new Error("the saved game has no schema object");
    json.schema.ir = "0";
  }));
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  equal(codes.includes("restore.ir-mismatch"), false, JSON.stringify(codes));
  equal(globals.after, 1, "the position-bearing frame is the claim, and it is current");
});

test("a thread saved by an older instruction version restarts from source", () => {
  const loader = boot(LOADER);
  const { codes } = run(loader, tamper(capturedSave(), (json) => {
    const thread = json.vm.threads.find((entry) => entry.frames.length > 0);
    ok(thread !== undefined, "the save holds a running thread");
    thread.frames[0]!.program.ir = "0";
  }));
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  equal(codes.includes("restore.ir-mismatch"), false, JSON.stringify(codes));
  equal(globals.after, 2, "the thread re-ran its first instruction over the restored value");
});

for (const [label, edit] of [
  ["the snapshot's schema.ir", (json: Json) => {
    if (json.schema === null) throw new Error("the saved game has no schema object");
    json.schema.ir = String(Number(IR_VERSION) + 1);
  }],
  ["a thread frame's program ir", (json: Json) => {
    const thread = json.vm.threads.find((entry) => entry.frames.length > 0);
    ok(thread !== undefined, "the save holds a running thread");
    thread.frames[0]!.program.ir = String(Number(IR_VERSION) + 1);
  }],
] as const) {
  test(`a save with a newer ${label} is refused whole and the live game is unchanged`, () => {
    const loader = boot(LOADER);
    const { codes } = run(loader, tamper(capturedSave(), edit));
    const state = loader.state()!;
    const globals = state.vm.globals as Record<string, unknown>;

    ok(codes.includes("restore.ir-mismatch"), `diagnostics: ${JSON.stringify(codes)}`);
    equal(globals.marker, 9, "no part of the save was applied");
    equal(globals.after, 9, "the calling thread kept running after Load failed");
    equal(state.vm.threads.some((thread) => thread.status === "waiting"), false, "the failed Load left no thread parked");
  });
}

test("a changed file source is not an instruction mismatch: the save loads and only that thread restarts", () => {
  // The saved thread is the start-up program, a file-backed program with a source
  // hash. The loading game ships a different start.prg, so on restore that one
  // thread restarts from the current source (restore.source-changed) while the
  // save itself is accepted: the loader's own continuation is still replaced.
  const { saved } = run(boot("end()\n", 'marker = 1\nSave("slot")\nmarker = 5\nend()\n'), null);
  ok(saved !== null, "the saver produced a save");
  const loader = boot(LOADER, "marker = 7\nend()\n");
  const { codes } = run(loader, saved);
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  equal(codes.includes("restore.ir-mismatch"), false, JSON.stringify(codes));
  equal(globals.after, undefined, "the load was accepted and replaced the loader's continuation");
  equal(globals.marker, 7, "the saved thread restarted from the current start.prg source");
});

test("a save whose thread names a program file the game no longer has is refused whole, with no later throw", () => {
  // The saved thread is a file-backed program with no callables in the save, so
  // the callable check alone would compile nothing. The load must still fail up
  // front: committing it would throw program.missing from the next tick.
  const { saved } = run(boot("", "end()\n", { extra: { "other.prg": SAVER }, fileThread: "other.prg" }), null);
  ok(saved !== null, "the saver produced a save");
  const loader = boot(LOADER);
  const { codes } = run(loader, saved);
  const state = loader.state()!;
  const globals = state.vm.globals as Record<string, unknown>;

  ok(codes.includes("program.missing"), `diagnostics: ${JSON.stringify(codes)}`);
  equal(globals.marker, 9, "no part of the save was applied");
  equal(globals.after, 9, "the calling thread kept running after Load failed");
  equal(state.vm.threads.some((thread) => thread.frames.some((frame) => frame.program.kind === "file" && frame.program.path === "other.prg")), false, "the saved thread was not installed");
});

test("a newer instruction version is reported as such even when the audio projection is also malformed", () => {
  for (const [label, edit] of [
    ["schema.ir", (json: Json) => {
      if (json.schema === null) throw new Error("the saved game has no schema object");
      json.schema.ir = String(Number(IR_VERSION) + 1);
    }],
    ["a frame's program ir", (json: Json) => {
      const thread = json.vm.threads.find((entry) => entry.frames.length > 0);
      ok(thread !== undefined, "the save holds a running thread");
      thread.frames[0]!.program.ir = String(Number(IR_VERSION) + 1);
    }],
  ] as const) {
    const loader = boot(LOADER);
    const bytes = tamper(capturedSave(), (json) => {
      edit(json);
      json.audio = { tick: 0, cueId: 1, tracks: 5 };
    });
    const { codes } = run(loader, bytes);
    ok(codes.includes("restore.ir-mismatch"), `${label}: ${JSON.stringify(codes)}`);
    equal(codes.includes("restore.shape"), false, `${label}: ${JSON.stringify(codes)}`);
    equal((loader.state()!.vm.globals as Record<string, unknown>).after, 9, label);
  }
});

test("a save from a newer schema version is refused before malformed audio", () => {
  const loader = boot(LOADER);
  const bytes = tamper(capturedSave(), (json) => {
    if (json.schema === null) throw new Error("the saved game has no schema object");
    json.schema.schema = 3;
    json.audio = { tick: 0, cueId: 1, tracks: 5 };
  });
  const { codes } = run(loader, bytes);
  ok(codes.includes("restore.shape"), `diagnostics: ${JSON.stringify(codes)}`);
  equal(codes.includes("audio"), false, `diagnostics: ${JSON.stringify(codes)}`);
  equal((loader.state()!.vm.globals as Record<string, unknown>).after, 9);
});

test("a save from a newer engine section is refused whole, like every other section", () => {
  const loader = boot(LOADER);
  const bytes = tamper(capturedSave(), (json) => {
    if (json.schema === null) throw new Error("the saved game has no schema object");
    json.schema.engine = SCHEMA_VERSIONS.engine + 1;
  });
  const { codes } = run(loader, bytes);
  ok(codes.includes("restore.shape"), `diagnostics: ${JSON.stringify(codes)}`);
  equal((loader.state()!.vm.globals as Record<string, unknown>).after, 9, "nothing from the newer save was applied");
});

test("a position-free object program from an older instruction version loads", () => {
  const bytes = tamper(capturedObjectSave(), (json) => {
    const object = json.vm.objects.find((entry) => entry.program !== null);
    ok(object !== undefined && object.program !== null, "the save has a class object program");
    object.program.ir = "0";
  });
  const loader = boot(LOADER, "end()\n", { extra: { "saved.prg": OBJECT_SAVER } });
  const { codes } = run(loader, bytes);
  ok(!codes.includes("restore.ir-mismatch"), `diagnostics: ${JSON.stringify(codes)}`);
  const state = loader.state()!;
  equal(state.vm.objects.some((object) => object.program !== null), true, "the class object was restored");
  equal(state.vm.objects.find((object) => object.program !== null)?.program?.ir, "0", "its provenance is kept");
});

function recoveryCandidateState(): GameState {
  const state = createGameState({ seed: 1 });
  startProgram(state.vm, { kind: "inline", text: "value = 1\nend()\n", ir: IR_VERSION });
  return state;
}

test("recovery candidate retains the exact canonical save projection and manifest", () => {
  const state = recoveryCandidateState();
  state.vm.globals["nan"] = NaN;
  state.vm.globals["positive"] = Infinity;
  state.vm.globals["negative"] = -Infinity;
  state.vm.globals["text"] = "escaped\n\u00e9🚀";
  const manifest = {
    version: 1 as const,
    board: { key: "boards/start.brd", hash: "0123456789abcdef" },
    boardDependencies: [{ key: "tiles/a.tst", hash: "fedcba9876543210" }],
    entryProgram: null,
    programs: [],
    listenerAnchors: [],
  };
  const expected = canon({ ...JSON.parse(snapshotGameSave(state)), recoveryAssets: manifest });
  equal(snapshotRecoveryCandidate(state, manifest), expected);
});

test("a recovery candidate refuses any instruction-version difference, even an older one", () => {
  const state = recoveryCandidateState();
  const manifest = {
    version: 1 as const,
    board: { key: "boards/start.brd", hash: "0123456789abcdef" },
    boardDependencies: [],
    entryProgram: null,
    programs: [],
    listenerAnchors: [],
  };
  const candidate = snapshotRecoveryCandidate(state, manifest);
  const current = JSON.parse(candidate) as Json;
  const refusals: Array<(json: Json) => void> = [
    (json) => {
      const thread = json.vm.threads.find((entry) => entry.frames.length > 0);
      ok(thread !== undefined, "the candidate holds a thread");
      thread.frames[0]!.program.ir = "0";
    },
    (json) => {
      if (json.schema === null) throw new Error("the candidate has no schema");
      json.schema.ir = "0";
    },
  ];
  for (const edit of refusals) {
    const saved: Json = JSON.parse(JSON.stringify(current)) as Json;
    edit(saved);
    const refused = (() => { try { restoreRecoveryCandidate(JSON.stringify(saved), state.audio); return null; } catch (error) { return error as { code?: string }; } })();
    ok(refused !== null, "the candidate was refused");
    equal(refused.code, "restore.ir-mismatch");
  }
  const restored = restoreRecoveryCandidate(candidate, state.audio);
  equal(restored.state.schema.ir, IR_VERSION);
});

test("a saved object program missing from the current package refuses the load before commit", () => {
  const bytes = tamper(capturedObjectSave(), (json) => {
    const object = json.vm.objects.find((entry) => entry.program !== null);
    ok(object !== undefined && object.program !== null, "the save has a class object program");
    object.program.path = "missing.prg";
  });
  const loader = boot(LOADER, "end()\n", { extra: { "saved.prg": OBJECT_SAVER } });
  const { codes } = run(loader, bytes);
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  ok(codes.includes("program.missing"), `diagnostics: ${JSON.stringify(codes)}`);
  equal(globals.marker, 9);
  equal(globals.after, 9);
});

for (const [label, source, saverExtra, loaderExtra] of [
  ["a syntax error", "marker = (\n", {}, {}],
  // `include()` at run time adds helper.prg to the saved program's include list; the
  // restart copies that list, and a removed file is an error, not skipped (MOD-3).
  ["a saved run-time include that was removed", "marker = 7\nend()\n", { "helper.prg": "y = 1\n" }, {}],
] as const) {
  test(`a changed source with ${label} refuses the load instead of throwing from the next tick`, () => {
    // The saved thread's file changed, so it would restart from source. That restart
    // is exactly what runs next, so it must be proven to compile before the load commits.
    const includesFirst = Object.keys(saverExtra).length > 0 ? 'include("helper.prg")\n' : "";
    const { saved } = run(boot("", "end()\n", { extra: { "other.prg": includesFirst + SAVER, ...saverExtra }, fileThread: "other.prg" }), null);
    ok(saved !== null, "the saver produced a save");
    if (includesFirst !== "") {
      ok(new TextDecoder().decode(saved).includes("helper.prg"), "the save records the run-time include");
    }
    const loader = boot(LOADER, "end()\n", { extra: { "other.prg": source, ...loaderExtra } });
    const { codes } = run(loader, saved);
    const state = loader.state()!;
    const globals = state.vm.globals as Record<string, unknown>;

    ok(codes.length > 0 && !codes.includes("restore.source-changed"), `diagnostics: ${JSON.stringify(codes)}`);
    equal(globals.marker, 9, "no part of the save was applied");
    equal(globals.after, 9, "the calling thread kept running after Load failed");
    equal(state.vm.threads.some((thread) => thread.frames.some((frame) => frame.program.kind === "file" && frame.program.path === "other.prg")), false, "the saved thread was not installed");
  });
}

test("a load that fails after the counter was adopted leaves the game and its request counter exactly as a refused-for-absence load does", () => {
  // Both loads fail and change nothing, so the two games must end in the same engine
  // state. A load rewound to the save's request counter would diverge, and would
  // re-issue request ids this session already used.
  const { saved } = run(boot("", "end()\n", { extra: { "other.prg": SAVER }, fileThread: "other.prg" }), null);
  ok(saved !== null, "the saver produced a save");
  const missing = boot(LOADER);
  const absent = boot(LOADER);
  const missingRun = run(missing, saved);
  run(absent, null);

  ok(missingRun.codes.includes("program.missing"), `diagnostics: ${JSON.stringify(missingRun.codes)}`);
  const left = missing.state()!;
  const right = absent.state()!;
  ok(left.engine.nextRequestId !== undefined && left.engine.nextRequestId > 1);
  equal(left.engine.nextRequestId, right.engine.nextRequestId, "the request counter was not rewound");
  deepEqual(left.engine, right.engine);
  deepEqual(left.vm.globals, right.vm.globals);
  deepEqual(left.time, right.time);
});

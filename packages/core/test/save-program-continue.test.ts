import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  IR_VERSION,
  addActor,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  fileProgramRef,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type AssetKey,
  type GameState,
  type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Game = {
  readonly files: Map<AssetKey, Uint8Array>;
  readonly engine: ReturnType<typeof createEngine>;
  state(): GameState | null;
};

function createGame(options: {
  readonly startupPrg?: string;
  readonly enterPrg?: string;
  readonly backgroundMusic?: string;
  readonly files?: Record<string, string>;
}): Game {
  const chr = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
  });
  if (!chr.ok) throw new Error(chr.error.message);

  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.chr",
  });
  if (!main.ok) throw new Error(main.error.message);

  const empty = createEmptyBoard();
  const board = writeBoard({
    ...empty,
    programs: [
      {
        program: "underPlayerRan = 1\nend()",
        graphic: "",
        initialVar: "",
        initialValue: "",
        finalVar: "",
        finalValue: "",
        activate: 0,
        activationType: 0,
        repeatDistance: 0,
        layer: 1,
        points: [
          { x: 20, y: 20 },
          { x: 50, y: 20 },
          { x: 50, y: 50 },
          { x: 20, y: 50 },
        ],
        closed: 1,
        handle: "under-player",
      },
    ],
    properties: {
      ...empty.properties,
      start: { x: 32, y: 32, layer: 1 },
      enterPrg: options.enterPrg ?? "",
      backgroundMusic: options.backgroundMusic ?? "",
    },
  });
  if (!board.ok) throw new Error(board.error.message);

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("chrs/hero.chr"), chr.value],
    [assetKey("prg/start.prg"), encoder.encode(`${options.startupPrg ?? "end()"}\n`)],
  ]);

  const paths = ["main.gam", "boards/start.brd", "chrs/hero.chr", "prg/start.prg"];
  if (options.enterPrg) {
    paths.push(`prg/${options.enterPrg}`);
    files.set(assetKey(`prg/${options.enterPrg}`), encoder.encode(options.files?.[options.enterPrg] ?? "end()\n"));
  }
  if (options.backgroundMusic) {
    paths.push(`media/${options.backgroundMusic}`);
    files.set(assetKey(`media/${options.backgroundMusic}`), new Uint8Array([0, 1, 2, 3]));
  }
  for (const [name, content] of Object.entries(options.files ?? {})) {
    if (!paths.includes(`prg/${name}`)) {
      paths.push(`prg/${name}`);
      files.set(assetKey(`prg/${name}`), encoder.encode(content));
    }
  }

  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 11,
    assetIndex: createAssetIndex(paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "load-continuation-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [
      {
        phase: "events",
        run: (state) => {
          latest = state;
        },
      },
    ],
  });

  return { files, engine, state: () => latest };
}

function runLoop(
  game: Game,
  ticks: number,
  onBlob?: (reqId: number, kind: string, blob: { area?: string; path?: string }) => Uint8Array | null,
): { saved: Uint8Array | null; diagnostics: readonly unknown[] } {
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  const allDiagnostics: unknown[] = [];

  for (let i = 0; i < ticks; i++) {
    const report = game.engine.advance(1, replies);
    replies = [];
    allDiagnostics.push(...report.diagnostics);

    for (const req of report.requests) {
      if (req.kind === "asset") {
        replies.push({
          tick: report.tickAfter,
          event: { kind: "asset", reqId: req.reqId, bytes: game.files.get(req.key) ?? null },
        });
      } else if (req.kind === "saveBlob") {
        saved = new Uint8Array(req.bytes);
        replies.push({
          tick: report.tickAfter,
          event: { kind: "blob.saved", reqId: req.reqId, ok: true },
        });
      } else if (req.kind === "loadBlob") {
        const bytes = onBlob ? onBlob(req.reqId, req.kind, req.blob) : null;
        replies.push({
          tick: report.tickAfter,
          event: { kind: "blob.loaded", reqId: req.reqId, bytes },
        });
      }
    }
  }

  return { saved, diagnostics: allDiagnostics };
}

test("start-program Load runs nested enter program, preserves message window, erases title text, and continues calling program (#1177)", () => {
  // 1. Game A reaches first board, enter program runs: genter = genter + 1; save("slot1"); end()
  const gameA = createGame({
    enterPrg: "enter.prg",
    backgroundMusic: "theme.mid",
    files: {
      "enter.prg": 'genter = genter + 1\nsave("slot1")\nend()\n',
    },
  });

  let savedBytes: Uint8Array | null = null;
  runLoop(gameA, 20, (reqId, kind) => null);
  const stateA = gameA.state()!;
  equal(stateA.vm.globals.genter, 1, "Game A enter program ran and incremented genter to 1");

  // Re-run to capture save blob
  const saverGame = createGame({
    enterPrg: "enter.prg",
    backgroundMusic: "theme.mid",
    files: {
      "enter.prg": 'genter = genter + 1\nsave("slot1")\nend()\n',
    },
  });
  const saverResult = runLoop(saverGame, 20);
  ok(saverResult.saved !== null, "Game A saved slot1");
  savedBytes = saverResult.saved;

  // 2. Game B boots with start program calling load("slot1")
  const startPrgText = [
    'text(2, 2, "TITLE TEXT")',
    'mwin("TITLE MSG")',
    'loadResult = load("slot1")',
    'text(2, 6, "AFTER LOAD TEXT")',
    'mwin("AFTER LOAD MSG")',
    'end()',
  ].join("\n");

  const gameB = createGame({
    startupPrg: startPrgText,
    enterPrg: "enter.prg",
    backgroundMusic: "theme.mid",
    files: {
      "enter.prg": 'genter = genter + 1\nend()\n',
    },
  });

  let loadAnswered = false;
  runLoop(gameB, 20, (reqId, kind) => {
    loadAnswered = true;
    return savedBytes;
  });
  ok(loadAnswered, "Load request was issued and answered");
  const stateB = gameB.state()!;

  // Assert:
  // 1. Enter program of loaded board ran nested, incrementing genter from 1 to 2
  equal(stateB.vm.globals.genter, 2, "loaded board's enter program ran nested and incremented genter from 1 to 2");

  // 2. Calling start program continued after load, so loadresult is 1
  equal(stateB.vm.globals.loadresult, 1, "calling program received success (1) from load()");

  // 3. Statements after load ran: message window shows "AFTER LOAD MSG"
  ok(stateB.ui.message.text.includes("AFTER LOAD MSG"), "message window has text from statements after load");

  // 4. "TITLE TEXT" was erased by boardRedraw, while "AFTER LOAD TEXT" was drawn after load
  const draws = stateB.ui.draws.map((d) => d.text);
  ok(!draws.includes("TITLE TEXT"), "TITLE TEXT was erased by boardRedraw");
  ok(draws.includes("AFTER LOAD TEXT"), "AFTER LOAD TEXT is present from post-load statement");

  // 5. Board is boards/start.brd and engine is in running stage (first board skipped)
  equal(stateB.world.board?.key, "boards/start.brd", "engine is on loaded board");
  equal(stateB.engine.boot?.stage, "running", "engine boot stage is running (initBoard skipped)");

  // 6. Player arrival trigger disarming was applied
  ok(stateB.triggers.deactivateAt !== null, "triggers.deactivateAt was set at player arrival position");
  equal(stateB.triggers.deactivateAt.x, 32);
  equal(stateB.triggers.deactivateAt.y, 32);
  equal(stateB.triggers.deactivateAt.layer, 1);
  equal(stateB.vm.globals.underplayerran, undefined, "trigger under player did not fire");

  // 7. Board music was requested/started for loaded board
  equal(stateB.world.board?.backgroundMusic, "theme.mid");
  const musicTrack = stateB.audio.tracks.find((t) => t.name === "music");
  ok(musicTrack !== undefined, "music track exists");
});

test("failed Load from start program delivers 0 and leaves calling program running with live state intact (#1177)", () => {
  const startPrgText = [
    'text(2, 2, "TITLE TEXT")',
    'res = load("missing_slot")',
    'afterFail = 42',
    'end()',
  ].join("\n");

  const game = createGame({
    startupPrg: startPrgText,
  });

  let loadAnswered = false;
  runLoop(game, 20, () => {
    loadAnswered = true;
    return null; // File not found
  });

  ok(loadAnswered, "Load request was issued and answered with null");
  const state = game.state()!;

  equal(state.vm.globals.res, 0, "load() returned 0 on failure");
  equal(state.vm.globals.afterfail, 42, "statements after load continued executing");
  const draws = state.ui.draws.map((d) => d.text);
  ok(draws.includes("TITLE TEXT"), "title drawing was not erased on failed load");
});

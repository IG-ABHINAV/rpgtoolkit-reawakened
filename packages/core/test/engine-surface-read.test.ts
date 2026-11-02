import { deepEqual, equal, ok } from "node:assert/strict";
import { TextDecoder, TextEncoder } from "node:util";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  editSurface,
  enqueueDirectionMove,
  hashGameState,
  hydrateSprites,
  encodeSurfaceBytes,
  IR_VERSION,
  PACKAGE_ROOT,
  runMovementPhase,
  snapshot,
  startProgram,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type Diagnostic,
  type Engine,
  type GameState,
  type InputRecord,
  type SurfaceId,
  type TickReport,
} from "../src/index.ts";
import { SCRIPT_SCREEN } from "../src/raster/surfaces.ts";

const BOARD_COLOUR = { r: 19, g: 37, b: 53 } as const;
const boardBytes = (() => {
  const empty = createEmptyBoard();
  const result = writeBoard({
    ...empty,
    properties: { ...empty.properties, backgroundColour: BOARD_COLOUR },
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
})();

/** A 10x10 tile board, so the hero's queued eastward steps are not blocked at the edge of an empty board. */
const movementBoardBytes = (() => {
  const empty = createEmptyBoard();
  const result = writeBoard({
    ...empty,
    sizeX: 10,
    sizeY: 10,
    sizeL: 1,
    layerTitles: ["", ""],
    tileMatrix: new Array<number>(100).fill(0),
    tileRuns: Array.from({ length: 100 }, () => ({ lutIndex: 0, count: 1, marker: false })),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
})();

type Scene = {
  readonly engine: Engine;
  state(): GameState | null;
};

function scene(movement?: { enabled: boolean }): Scene {
  let current: GameState | null = null;
  const engine = createEngine({
    seed: 31,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 8,
    height: 8,
    maxTicks: 100,
    phaseRegistrations: [
      { phase: "events", run: (state) => { current = state; } },
      ...(movement === undefined ? [] : [{
        phase: "movement" as const,
        run: (state: GameState) => {
          if (movement?.enabled) runMovementPhase(state.sprites, state.world.board ?? null, state.time.tick);
        },
      }]),
    ],
  });
  return { engine, state: () => current };
}

function boardRequest(report: TickReport) {
  const request = report.requests.find((item) => item.kind === "asset");
  if (request?.kind !== "asset") throw new Error("expected the board asset request");
  return request;
}

function pollScreen(engine: Engine, state: GameState | null): void {
  const revision = state?.surfaces.entries["0"]?.rev ?? 0;
  const beforeHash = state === null ? null : hashGameState(state);
  const beforeSave = state === null ? null : snapshot(state);
  const beforeRevision = state?.surfaces.entries["0"]?.rev ?? null;
  const first = engine.surfacePixels(0 as SurfaceId, revision);
  if (state !== null) ok(first !== null, "the current screen revision is readable");
  if (first !== null) {
    const expected = new Uint8Array(first.rgba);
    first.rgba.fill(0xa5);
    const repeated = engine.surfacePixels(0 as SurfaceId, revision);
    ok(repeated !== null, "the current revision remains readable after a host read");
    deepEqual(repeated.rgba, expected, "the first returned pixel buffer is not engine-owned");
    ok(repeated.rgba.buffer !== first.rgba.buffer, "each read returns a separately owned buffer");

    // Discard the consumer's copy as a cache-flush would, then fetch the same revision again.
    const afterFlush = engine.surfacePixels(0 as SurfaceId, revision);
    ok(afterFlush !== null);
    deepEqual(afterFlush.rgba, expected);
    equal(afterFlush.rgba.byteOffset, 0);
  }
  if (state !== null) {
    equal(engine.surfacePixels(0 as SurfaceId, revision - 1), null, "a stale revision is a read-only miss");
    equal(engine.surfacePixels(0 as SurfaceId, revision + 1), null, "an unavailable revision is a read-only miss");
  }
  equal(engine.surfacePixels(9999 as SurfaceId, 0), null, "an unknown surface is a read-only miss");
  if (state !== null) {
    equal(state.surfaces.entries["0"]?.rev, beforeRevision);
    equal(hashGameState(state), beforeHash);
    deepEqual(snapshot(state), beforeSave);
  }
}

test("surface polling cadence, stale misses, cache-flush reads and returned ownership do not change state", () => {
  // Baseline, repeated, cache-flush, and stale-only polling runs.
  const scenes = [scene(), scene(), scene(), scene()];

  const repeated = scenes[1]!.engine.surfacePixels(0 as SurfaceId, 0);
  ok(repeated !== null);
  const repeatedPixels = new Uint8Array(repeated.rgba);
  repeated.rgba.fill(0xff);
  const repeatedAgain = scenes[1]!.engine.surfacePixels(0 as SurfaceId, 0);
  ok(repeatedAgain !== null);
  deepEqual(repeatedAgain.rgba, repeatedPixels);
  ok(repeatedAgain.rgba.buffer !== repeated.rgba.buffer);

  const beforeFlush = scenes[2]!.engine.surfacePixels(0 as SurfaceId, 0);
  ok(beforeFlush !== null);
  const flushedPixels = new Uint8Array(beforeFlush.rgba);
  beforeFlush.rgba.fill(0x55);
  const afterFlush = scenes[2]!.engine.surfacePixels(0 as SurfaceId, 0);
  ok(afterFlush !== null);
  deepEqual(afterFlush.rgba, flushedPixels);
  equal(afterFlush.rgba.byteOffset, 0);

  equal(scenes[3]!.engine.surfacePixels(0 as SurfaceId, -1), null);
  equal(scenes[3]!.engine.surfacePixels(9999 as SurfaceId, 0), null);

  const firstReports = scenes.map(({ engine }) => engine.advance(0, []));
  for (const report of firstReports.slice(1)) equal(report.stateHash, firstReports[0]?.stateHash);
  const reports = scenes.map((item, index) => item.engine.advance(1, [{
    tick: firstReports[index]!.tickAfter,
    event: { kind: "asset", reqId: boardRequest(firstReports[index]!).reqId, bytes: new Uint8Array(boardBytes) },
  }]));
  for (const report of reports.slice(1)) equal(report.stateHash, reports[0]?.stateHash);
  const before = scenes.map((item) => {
    const state = item.state();
    ok(state !== null, "the engine ran the events phase");
    return { hash: hashGameState(state), save: snapshot(state), revision: state.surfaces.entries["0"]!.rev };
  });

  pollScreen(scenes[1]!.engine, scenes[1]!.state());
  pollScreen(scenes[2]!.engine, scenes[2]!.state());
  pollScreen(scenes[3]!.engine, scenes[3]!.state());
  for (let index = 0; index < scenes.length; index += 1) {
    const state = scenes[index]!.state()!;
    equal(hashGameState(state), before[index]!.hash);
    deepEqual(snapshot(state), before[index]!.save);
    equal(state.surfaces.entries["0"]?.rev, before[index]!.revision);
  }

  const settled = scenes.map(({ engine }) => engine.advance(0, []));
  for (const report of settled.slice(1)) {
    equal(report.stateHash, settled[0]?.stateHash);
    deepEqual(report.diagnostics, settled[0]?.diagnostics);
  }
});

test("player movement changes the state hash while screen view cadence does not", () => {
  const unpolled = scene({ enabled: true });
  const polled = scene({ enabled: true });
  const stationary = scene({ enabled: false });
  const starts = [unpolled, polled, stationary].map((item) => item.engine.advance(0, []));
  const loaded = [unpolled, polled, stationary].map((item, index) => item.engine.advance(1, [{
    tick: starts[index]!.tickAfter,
    event: { kind: "asset", reqId: boardRequest(starts[index]!).reqId, bytes: new Uint8Array(movementBoardBytes) },
  }]));
  for (const report of loaded.slice(1)) equal(report.stateHash, loaded[0]?.stateHash);

  const states = [unpolled, polled, stationary].map((item) => {
    const state = item.state();
    ok(state !== null);
    const board = state.world.board;
    ok(board !== null && board !== undefined);
    state.sprites = hydrateSprites({
      board,
      players: [{ id: "hero", kind: "player", source: "hero.tem", x: 64, y: 64, layer: 1, controlled: true }],
    });
    enqueueDirectionMove(state.sprites, "hero", "E", 0);
    return state;
  });
  const baselineHash = hashGameState(states[0]!);
  equal(hashGameState(states[1]!), baselineHash);
  equal(hashGameState(states[2]!), baselineHash);
  const initialX = states.map((state) => state.sprites.players[0]!.x);

  let movingUnpolled: TickReport | null = null;
  let movingPolled: TickReport | null = null;
  let still: TickReport | null = null;
  for (let tick = 0; tick < 30; tick += 1) {
    movingUnpolled = unpolled.engine.advance(1, []);
    still = stationary.engine.advance(1, []);
    pollScreen(polled.engine, polled.state());
    movingPolled = polled.engine.advance(1, []);
    pollScreen(polled.engine, polled.state());
    equal(movingUnpolled.stateHash, movingPolled.stateHash);
    deepEqual(movingUnpolled.diagnostics, movingPolled.diagnostics);
  }

  ok(movingUnpolled !== null && movingPolled !== null && still !== null);
  ok(states[0]!.sprites.players[0]!.x !== initialX[0], "the queued player moved");
  equal(states[0]!.sprites.players[0]!.x, states[1]!.sprites.players[0]!.x);
  equal(states[2]!.sprites.players[0]!.x, initialX[2], "the stationary control did not move");
  ok(movingUnpolled.stateHash !== still.stateHash, "movement changes the hash at the same tick");
});

test("a host read of a stale screen returns the stored revision and leaves state alone; the next advance rebuilds it", () => {
  const item = scene();
  const start = item.engine.advance(0, []);
  item.engine.advance(1, [{ tick: start.tickAfter, event: { kind: "asset", reqId: boardRequest(start).reqId, bytes: new Uint8Array(boardBytes) } }]);
  const state = item.state();
  ok(state !== null && state.world.board !== null && state.world.board !== undefined);
  const storedRevision = state.surfaces.entries["0"]!.rev;
  const stored = item.engine.surfacePixels(0 as SurfaceId, storedRevision);
  ok(stored !== null);
  deepEqual([...stored.rgba.slice(0, 3)], [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b]);

  // An out-of-band edit makes the composed frame differ from the stored screen without an advance.
  Object.assign(state.world.board, { background: { r: 200, g: 100, b: 50 } });
  const hashBefore = hashGameState(state);
  const saveBefore = snapshot(state);
  const polled = item.engine.surfacePixels(0 as SurfaceId, storedRevision);
  ok(polled !== null, "the stored revision is still readable");
  deepEqual([...polled.rgba.slice(0, 3)], [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b], "the host read does not rebuild the screen");
  equal(item.engine.surfacePixels(0 as SurfaceId, storedRevision + 1), null);
  equal(state.surfaces.entries["0"]!.rev, storedRevision, "the host read does not bump the revision");
  equal(hashGameState(state), hashBefore);
  equal(snapshot(state), saveBefore);

  // The core's own step rebuilds the screen deterministically.
  item.engine.advance(0, []);
  const rebuilt = item.engine.surfacePixels(0 as SurfaceId, state.surfaces.entries["0"]!.rev);
  ok(rebuilt !== null);
  deepEqual([...rebuilt.rgba.slice(0, 3)], [200, 100, 50]);
  equal(item.engine.surfacePixels(0 as SurfaceId, storedRevision), null, "the old revision is now stale");
});

type BootGame = {
  readonly engine: Engine;
  readonly files: ReadonlyMap<AssetKey, Uint8Array>;
  state(): GameState | null;
};

function bootGame(program: string): BootGame {
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
  });
  if (!main.ok) throw new Error(main.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), new Uint8Array(boardBytes)],
    [assetKey("prg/start.prg"), new TextEncoder().encode("end()\n")],
  ]);
  let current: GameState | null = null;
  let launched = false;
  const engine = createEngine({
    seed: 41,
    assetIndex: createAssetIndex(["main.gam", "Boards/start.brd", "Prg/start.prg"]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "surface-read-restore-test",
    width: 8,
    height: 8,
    maxTicks: 400,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        current = state;
        if (!launched && state.world.board != null) {
          launched = true;
          startProgram(state.vm, { kind: "inline", text: program, ir: IR_VERSION });
        }
      },
    }],
  });
  return { engine, files, state: () => current };
}

type RunResult = {
  readonly engine: Engine;
  readonly saved: Uint8Array | null;
  readonly hashes: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly loadRequests: number;
  readonly state: GameState | null;
};

function runBoot(game: BootGame, loadBytes: Uint8Array | null, polling: boolean): RunResult {
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  let loadRequests = 0;
  const hashes: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (let tick = 0; tick < 80; tick += 1) {
    if (polling) pollScreen(game.engine, game.state());
    const report = game.engine.advance(1, replies);
    replies = [];
    hashes.push(report.stateHash);
    diagnostics.push(...report.diagnostics);
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob") {
        if (request.blob.path.endsWith(".sav")) saved = new Uint8Array(request.bytes);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") {
        loadRequests += 1;
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: loadBytes } });
      }
    }
    if (polling) pollScreen(game.engine, game.state());
  }
  return { engine: game.engine, saved, hashes, diagnostics, loadRequests, state: game.state() };
}

const SCREEN_CAPTURE_PROGRAM = [
  "createcanvas(8, 8, canvas)",
  "savescreen(1)",
  'Save("slot")',
  "getpixel(0, 0, screenR, screenG, screenB)",
  "getpixel(0, 0, slotR, slotG, slotB, slot)",
  "canvasgetscreen(canvas)",
  "getpixel(0, 0, canvasR, canvasG, canvasB, canvas)",
  "end()",
].join("\n");

test("restore rebuilds the screen before script pixel reads and preserves saved screen captures", () => {
  const plain = runBoot(bootGame(SCREEN_CAPTURE_PROGRAM), null, false);
  const polled = runBoot(bootGame(SCREEN_CAPTURE_PROGRAM), null, true);
  ok(plain.saved !== null, "the script saved its game");
  ok(polled.saved !== null, "the polling run saved its game");
  deepEqual(polled.saved, plain.saved, "host reads do not alter save bytes");
  deepEqual(polled.hashes, plain.hashes, "host view cadence does not alter tick hashes");
  deepEqual(polled.diagnostics, plain.diagnostics);

  const restored = runBoot(bootGame('Load("slot")\nend()\n'), plain.saved, true);
  equal(restored.loadRequests, 1, "the loader issued one host request");
  const state = restored.state;
  ok(state !== null);
  const globals = state.vm.globals as Record<string, unknown>;
  deepEqual([globals.screenr, globals.screeng, globals.screenb], [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b]);
  deepEqual([globals.slotr, globals.slotg, globals.slotb], [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b]);
  deepEqual([globals.canvasr, globals.canvasg, globals.canvasb], [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b]);

  const boardColour = [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b, 255];
  for (const id of [0, globals.canvas as number, globals.slot as number]) {
    const surface = state.surfaces.entries[String(id)];
    ok(surface !== undefined, `restored surface ${id} exists`);
    const capture = restored.engine.surfacePixels(id as SurfaceId, surface.rev);
    ok(capture !== null, `restored surface ${id} is readable at its current revision`);
    deepEqual([...capture.rgba.slice(0, 4)], boardColour, `restored surface ${id} carries the composed frame`);
  }
  equal(state.surfaces.entries[String(SCRIPT_SCREEN)], undefined, "a game that never draws to the screen never creates a script-screen layer");
});

/**
 * The overlay draw changes the composed frame inside this tick, so only a core refresh before each screen read can show it;
 * the second half of the script loads its own save again and again, so the screen must be rebuilt from the restored state.
 */
function withBlankScreen(bytes: Uint8Array): Uint8Array {
  const root = JSON.parse(new TextDecoder().decode(bytes)) as { surfaces: { entries: Record<string, { bitmap: { w: number; h: number; b64: string } }> } };
  const bitmap = root.surfaces.entries["0"]!.bitmap;
  bitmap.b64 = encodeSurfaceBytes(new Uint8Array(bitmap.w * bitmap.h * 4));
  return new TextEncoder().encode(JSON.stringify(root));
}

const OVERLAY_THEN_READ_PROGRAM = [
  "rendernow(1)",
  "o = cnvrendernow",
  "colorrgb(255, 0, 0)",
  "fillrect(0, 0, 3, 3, o)",
  'Save("slot")',
  "createcanvas(8, 8, cv)",
  "slot = savescreen(1)",
  "canvasgetscreen(cv)",
  "getpixel(1, 1, screenr, screeng, screenb)",
  "getpixel(1, 1, canvasr, canvasg, canvasb, cv)",
  "getpixel(1, 1, slotr, slotg, slotb, slot)",
  'Load("slot")',
  "end()",
].join("\n");

test("script screen reads rebuild the frame first, including after each restore, whatever the host polls", () => {
  const read = (state: GameState, name: string): number[] => {
    const globals = state.vm.globals as Record<string, unknown>;
    return [globals[`${name}r`], globals[`${name}g`], globals[`${name}b`]] as number[];
  };
  const run = (polling: boolean): { readonly state: GameState; readonly hashes: readonly string[]; readonly loads: number; readonly first: number[] | null } => {
    const game = bootGame(OVERLAY_THEN_READ_PROGRAM);
    let replies: InputRecord[] = [];
    let saved: Uint8Array | null = null;
    let loads = 0;
    const hashes: string[] = [];
    let first: number[] | null = null;
    for (let tick = 0; tick < 60; tick += 1) {
      if (polling) pollScreen(game.engine, game.state());
      const report = game.engine.advance(1, replies);
      replies = [];
      hashes.push(report.stateHash);
      const current = game.state();
      // The first screen read the script makes, before any restore has happened.
      if (first === null && loads === 0 && current !== null && (current.vm.globals as Record<string, unknown>).screenr !== undefined) first = read(current, "screen");
      for (const request of report.requests) {
        if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
        else if (request.kind === "saveBlob") {
          if (request.blob.path.endsWith(".sav")) saved = new Uint8Array(request.bytes);
          replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
        } else if (request.kind === "loadBlob") {
          loads += 1;
          // The presented screen is a derived cache outside the hash, so a save may carry a stale one: blank it and the restore must still rebuild it.
          replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: saved === null ? null : withBlankScreen(saved) } });
        }
      }
    }
    const state = game.state();
    ok(state !== null);
    return { state, hashes, loads, first };
  };

  const plain = run(false);
  ok(plain.loads >= 2, "the script restored its save more than once");
  deepEqual(plain.first, [255, 0, 0], "the first screen read, before any restore, shows the overlay drawn earlier in the same tick");
  deepEqual(read(plain.state, "screen"), [255, 0, 0], "the screen read after a restore shows the overlay drawn before the save");
  deepEqual(read(plain.state, "canvas"), [255, 0, 0], "canvasgetscreen copies the rebuilt screen");
  deepEqual(read(plain.state, "slot"), [255, 0, 0], "savescreen stored the rebuilt screen");

  const polled = run(true);
  deepEqual(polled.hashes, plain.hashes, "host polling changes no tick hash");
  deepEqual(read(polled.state, "screen"), [255, 0, 0]);
});

test("a script reads the frame it just changed in the same tick through getpixel, canvasgetscreen and savescreen", () => {
  const game = bootGame([
    "rendernow(1)",
    "o = cnvrendernow",
    "colorrgb(255, 0, 0)",
    "fillrect(0, 0, 3, 3, o)",
    "createcanvas(8, 8, cv)",
    "slot = savescreen(1)",
    "canvasgetscreen(cv)",
    "getpixel(1, 1, screenr, screeng, screenb)",
    "getpixel(1, 1, canvasr, canvasg, canvasb, cv)",
    "getpixel(1, 1, slotr, slotg, slotb, slot)",
    "getpixel(6, 6, farr, farg, farb)",
    "end()",
  ].join("\n"));
  const result = runBoot(game, null, false);
  const globals = result.state?.vm.globals as Record<string, unknown>;
  deepEqual([globals.screenr, globals.screeng, globals.screenb], [255, 0, 0]);
  deepEqual([globals.canvasr, globals.canvasg, globals.canvasb], [255, 0, 0]);
  deepEqual([globals.slotr, globals.slotg, globals.slotb], [255, 0, 0]);
  deepEqual([globals.farr, globals.farg, globals.farb], [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b], "pixels outside the overlay keep the board colour");
});

test("a cnvX draw moves the state hash while a draw to the screen or the presented frame does not", () => {
  // The program draws once on the screen and once on a canvas; its effect log (hashed) is the same for every edit below.
  const result = runBoot(bootGame("createcanvas(8, 8, cv)\ncolorrgb(255, 0, 0)\nfillrect(0, 0, 3, 3)\nfillrect(0, 0, 3, 3, cv)\nend()\n"), null, false);
  const state = result.state;
  ok(state !== null);
  const layer = SCRIPT_SCREEN;
  ok(state.surfaces.entries[String(layer)] !== undefined, "drawing to the screen created the script-screen layer");
  const canvas = (state.vm.globals as Record<string, unknown>).cv;
  ok(typeof canvas === "number", "the canvas handle is a script global");
  const flip = (id: SurfaceId) => ok(editSurface(state.surfaces, id, (rgba) => { rgba[0] = rgba[0]! ^ 0xff; }), `surface ${id} is live`);

  const before = hashGameState(state);
  flip(layer);
  equal(hashGameState(state), before, "drawing to the screen layer is hash-neutral");
  flip(0 as SurfaceId);
  equal(hashGameState(state), before, "the presented frame is hash-neutral");
  flip(canvas as SurfaceId);
  ok(hashGameState(state) !== before, "drawing to a cnvX canvas moves the hash");
});

test("script drawing on the screen persists across the core's own frame rebuilds", () => {
  const read = (state: GameState | null, name: string): number[] => {
    const globals = state?.vm.globals as Record<string, unknown>;
    return [globals[`${name}r`], globals[`${name}g`], globals[`${name}b`]] as number[];
  };
  // sleep spans many `advance` calls; each one rebuilds the presented frame, which must keep what the script drew.
  const program = "colorrgb(255, 0, 0)\nfillrect(0, 0, 3, 3)\nsleep(1)\ngetpixel(1, 1, nr, ng, nb)\ngetpixel(6, 6, fr, fg, fb)\nend()\n";
  const result = runBoot(bootGame(program), null, false);
  deepEqual(read(result.state, "n"), [255, 0, 0], "the drawn pixel survived the rebuilds");
  deepEqual(read(result.state, "f"), [BOARD_COLOUR.r, BOARD_COLOUR.g, BOARD_COLOUR.b], "an undrawn pixel shows the board");
});

test("the first draw to the screen takes no canvas handle and does not move the id counter", () => {
  const withScreenDraw = runBoot(bootGame("colorrgb(255, 0, 0)\nfillrect(0, 0, 3, 3)\ncreatecanvas(8, 8, cv)\nend()\n"), null, false).state;
  const without = runBoot(bootGame("colorrgb(255, 0, 0)\ncreatecanvas(8, 8, cv)\nend()\n"), null, false).state;
  ok(withScreenDraw !== null && without !== null);
  equal((withScreenDraw.vm.globals as Record<string, unknown>).cv, (without.vm.globals as Record<string, unknown>).cv, "the first canvas keeps its handle");
  equal(withScreenDraw.surfaces.nextId, without.surfaces.nextId, "the hashed id counter is unchanged");
  ok(withScreenDraw.surfaces.entries[String(SCRIPT_SCREEN)] !== undefined, "the layer exists in the run that drew");
});

/** Every way a host can look at the presented frame during a tick. */
type Cadence = "none" | "presented" | "repeated" | "flush" | "stale";

function readFor(cadence: Cadence, engine: Engine, state: GameState | null): void {
  if (state === null) return;
  const revision = state.surfaces.entries["0"]?.rev ?? 0;
  const screen = 0 as SurfaceId;
  switch (cadence) {
    case "none":
      return;
    case "presented":
      engine.surfacePixels(screen, revision);
      return;
    case "repeated":
      engine.surfacePixels(screen, revision);
      engine.surfacePixels(screen, revision);
      engine.surfacePixels(screen, revision);
      return;
    case "flush": {
      // A cache flush drops the runner's copy and refills it, then discards the refill.
      const copy = engine.surfacePixels(screen, revision);
      copy?.rgba.fill(0);
      const refill = engine.surfacePixels(screen, revision);
      ok(refill !== null, "a transient re-read returns the stored revision");
      return;
    }
    case "stale":
      equal(engine.surfacePixels(screen, revision - 1), null, "a stale revision reads as a miss");
      equal(engine.surfacePixels(screen, revision + 1), null, "an unavailable revision reads as a miss");
      equal(engine.surfacePixels(9999 as SurfaceId, 0), null, "an unknown id reads as a miss");
      return;
  }
}

type TickRecord = {
  readonly hash: string;
  readonly save: string;
  readonly revision: number;
  readonly diagnostics: readonly Diagnostic[];
};

/** Runs one identical game with a fixed batch of `advance` calls, varying only how often the host looks at the frame. */
function runWithCadence(cadence: Cadence): TickRecord[] {
  const item = scene({ enabled: true });
  const start = item.engine.advance(0, []);
  item.engine.advance(1, [{
    tick: start.tickAfter,
    event: { kind: "asset", reqId: boardRequest(start).reqId, bytes: new Uint8Array(movementBoardBytes) },
  }]);
  const first = item.state();
  ok(first !== null);
  const board = first.world.board;
  ok(board !== null && board !== undefined);
  first.sprites = hydrateSprites({
    board,
    players: [{ id: "hero", kind: "player", source: "hero.tem", x: 64, y: 64, layer: 1, controlled: true }],
  });
  enqueueDirectionMove(first.sprites, "hero", "E", 0);

  const records: TickRecord[] = [];
  for (let tick = 0; tick < 24; tick += 1) {
    readFor(cadence, item.engine, item.state());
    const report = item.engine.advance(1, []);
    readFor(cadence, item.engine, item.state());
    const state = item.state();
    ok(state !== null);
    records.push({
      hash: report.stateHash,
      save: snapshot(state),
      revision: state.surfaces.entries["0"]!.rev,
      diagnostics: report.diagnostics,
    });
  }
  return records;
}

test("no reads, a presented frame, repeated reads, cache flushes and stale revisions all agree on hash, save, revision and diagnostics", () => {
  const baseline = runWithCadence("none");
  ok(baseline.length === 24, "the control run advanced every tick");
  for (const cadence of ["presented", "repeated", "flush", "stale"] as const) {
    const compared = runWithCadence(cadence);
    equal(compared.length, baseline.length);
    for (let tick = 0; tick < baseline.length; tick += 1) {
      equal(compared[tick]!.hash, baseline[tick]!.hash, `${cadence} cadence leaves tick ${tick}'s state hash alone`);
      equal(compared[tick]!.save, baseline[tick]!.save, `${cadence} cadence leaves tick ${tick}'s save bytes alone`);
      equal(compared[tick]!.revision, baseline[tick]!.revision, `${cadence} cadence leaves tick ${tick}'s screen revision alone`);
      deepEqual(compared[tick]!.diagnostics, baseline[tick]!.diagnostics, `${cadence} cadence leaves tick ${tick}'s diagnostics alone`);
    }
  }
});

test("a save taken before any presentation equals one taken after every tick was presented", () => {
  const unpresented = runWithCadence("none");
  const presented = runWithCadence("presented");
  /**
   * The control run never read the frame; the presented run read it before and after every `advance`. Both runs issue
   * the same `advance` calls, so an identical save at the last tick proves presentation left no trace in saved state.
   */
  equal(presented.at(-1)!.save, unpresented.at(-1)!.save, "the save without any presentation equals the presented save");
  deepEqual(presented.at(-1)!.diagnostics, unpresented.at(-1)!.diagnostics);
});

// Tests for ADR 0018 Presentation Model Landing 1:
// - Program starting frame seeded from surface 0 (ADR 0018 R2, R5, #1067)
// - Engine holds final program screen across the boot interval before the first board arrives (#1171)
// - Message window pixels persist after program finishes until next board draw (#1186)

import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  createSurfacesSection,
  copyPresentedFrameToScriptScreen,
  ensureScriptScreen,
  PACKAGE_ROOT,
  readSurfacePixels,
  SCRIPT_SCREEN,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type DrawCommand,
  type InputRecord,
  type SurfaceId,
  type SurfacePixels,
} from "../src/index.ts";

const encoder = new TextEncoder();

function getSurfacePixels(engine: { surfacePixels(id: SurfaceId, rev: number): SurfacePixels | null }, id: SurfaceId): SurfacePixels {
  for (let rev = 511; rev >= 0; rev -= 1) {
    const pixels = engine.surfacePixels(id, rev);
    if (pixels !== null) return pixels;
  }
  throw new Error(`surface ${id} not found`);
}

test("engine holds the startup program frame during the boot interval before the first board arrives (#1171)", () => {
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
  });
  if (!main.ok) throw new Error(main.error.message);

  const empty = createEmptyBoard();
  const boardResult = writeBoard({
    ...empty,
    sizeX: 4,
    sizeY: 4,
    properties: { ...empty.properties, backgroundColour: { r: 10, g: 20, b: 30 } },
  });
  if (!boardResult.ok) throw new Error(boardResult.error.message);

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), new Uint8Array(boardResult.value)],
    // Startup program draws a colored block and ends in the same tick:
    [assetKey("prg/start.prg"), encoder.encode("colorrgb(200, 100, 50)\nfillrect(0, 0, 4, 4)\nend()\n")],
  ]);

  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(["main.gam", "Boards/start.brd", "Prg/start.prg"]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "boot-interval-test",
    width: 4,
    height: 4,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });

  let replies: InputRecord[] = [];
  let boardReqId: number | null = null;
  let lastReport: ReturnType<typeof engine.advance> | null = null;
  // Step until start.brd is requested (startupPrg ends):
  for (let step = 0; step < 10 && boardReqId === null; step += 1) {
    lastReport = engine.advance(1, replies);
    replies = [];
    for (const req of lastReport.requests) {
      if (req.kind === "asset") {
        if (req.key === assetKey("boards/start.brd")) {
          boardReqId = req.reqId;
        } else {
          replies.push({ tick: lastReport.tickAfter, event: { kind: "asset", reqId: req.reqId, bytes: files.get(req.key) ?? null } });
        }
      }
    }
  }

  ok(boardReqId !== null && lastReport !== null, "start.brd was requested while startupPrg finished");

  // In this boot interval (board pending, no live blocking program), the engine must NOT emit an empty draw list (0 commands).
  // It must present surface 0 (the held startup screen).
  const drawList = engine.drawList(0);
  equal(drawList.commands.length, 1, "composed frame is not empty during the boot interval");
  const blit = drawList.commands[0] as DrawCommand;
  ok(blit !== undefined && blit.kind === "blit" && "surface" in blit.source && blit.source.surface === (0 as SurfaceId));

  // The presented frame (surface 0) retains the startup program's pixels:
  const surface = getSurfacePixels(engine, 0 as SurfaceId);
  deepEqual([...surface.rgba.slice(0, 4)], [200, 100, 50, 255], "title pixels are preserved in surface 0");

  // Advance another tick while still withholding the board:
  lastReport = engine.advance(1, []);
  const drawList2 = engine.drawList(0);
  equal(drawList2.commands.length, 1, "draw list continues to present surface 0 while board is loading");

  // Now supply the board bytes:
  replies.push({
    tick: lastReport.tickAfter,
    event: { kind: "asset", reqId: boardReqId, bytes: files.get(assetKey("boards/start.brd"))! },
  });
  engine.advance(1, replies);

  // Once the board arrives and renders, the engine transitions from the held frame to the board draw:
  const boardDraw = engine.drawList(0);
  ok(boardDraw.commands.length > 0);
  const boardSurface = getSurfacePixels(engine, 0 as SurfaceId);
  deepEqual([...boardSurface.rgba.slice(0, 3)], [10, 20, 30], "board background color is rendered once board arrives");
});

test("message window pixels persist in presented frame after program finishes (#1186)", () => {
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
  });
  if (!main.ok) throw new Error(main.error.message);

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    // Program opens message window, waits for a key, then finishes:
    [assetKey("prg/start.prg"), encoder.encode('mwin("Hello world");\nwait();\nend()\n')],
  ]);

  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(["main.gam", "Prg/start.prg"]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "mwin-persist-test",
    width: 640,
    height: 480,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });

  let replies: InputRecord[] = [];
  let lastReport: ReturnType<typeof engine.advance> | null = null;
  // Advance until wait():
  for (let step = 0; step < 10; step += 1) {
    lastReport = engine.advance(1, replies);
    replies = [];
    for (const req of lastReport.requests) {
      if (req.kind === "asset") {
        replies.push({ tick: lastReport.tickAfter, event: { kind: "asset", reqId: req.reqId, bytes: files.get(req.key) ?? null } });
      }
    }
    if (engine.drawList(0).commands.some((c) => c.kind === "text" && c.text.includes("Hello world"))) break;
  }

  ok(lastReport !== null && engine.drawList(0).commands.some((c) => c.kind === "text" && c.text.includes("Hello world")), "mwin text is drawn");

  // Send Enter key to dismiss wait() and finish program:
  const confirmInput: InputRecord[] = [
    { tick: lastReport.tickAfter, event: { kind: "key", name: "Enter", code: "Enter", char: null, down: true } },
    { tick: lastReport.tickAfter + 1, event: { kind: "key", name: "Enter", code: "Enter", char: null, down: false } },
  ];
  engine.advance(2, confirmInput);

  // Program has finished, but its final frame (including message window) is committed to surface 0:
  const pixels = getSurfacePixels(engine, 0 as SurfaceId);
  ok(pixels !== null);
  // The draw list presents surface 0:
  const drawList = engine.drawList(0);
  ok(drawList.commands.some((c) => c.kind === "blit" && "surface" in c.source && c.source.surface === (0 as SurfaceId)));
});

test("copyPresentedFrameToScriptScreen seeds SCRIPT_SCREEN from surface 0 over opaque black (#1067)", () => {
  const surfaces = createSurfacesSection(2, 2);

  // Initial surface 0 is transparent black; copyPresentedFrameToScriptScreen seeds SCRIPT_SCREEN with opaque black:
  const id = copyPresentedFrameToScriptScreen(surfaces);
  equal(id, SCRIPT_SCREEN);
  const layer = readSurfacePixels(surfaces, SCRIPT_SCREEN, 0);
  ok(layer !== null);
  equal(layer.rgba.length, 16);
  // Alpha must be 255 everywhere per ADR 0018 R2:
  for (let at = 3; at < layer.rgba.length; at += 4) {
    equal(layer.rgba[at], 255, "seed is opaque black");
  }

  // ensureScriptScreen returns existing SCRIPT_SCREEN:
  equal(ensureScriptScreen(surfaces), SCRIPT_SCREEN);
});

test("multi-tick advance avoids redundant per-tick surface 0 rasterisation and base64 writes (ADR 0018 T13, #1668)", () => {
  const empty = createEmptyBoard();
  const boardResult = writeBoard({
    ...empty,
    sizeX: 4,
    sizeY: 4,
    properties: { ...empty.properties, backgroundColour: { r: 40, g: 50, b: 60 } },
  });
  if (!boardResult.ok) throw new Error(boardResult.error.message);

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("boards/start.brd"), new Uint8Array(boardResult.value)],
  ]);

  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(["Boards/start.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "start.brd",
    width: 64,
    height: 64,
    maxTicks: 200,
    include: { shading: true, images: true, sprites: true },
    phaseRegistrations: [
      {
        phase: "animation",
        run(state) {
          // Mutate board background colour each tick so the draw list hash changes on every tick of a batch:
          if (state.world.board !== null && state.world.board !== undefined) {
            state.world = {
              ...state.world,
              board: {
                ...state.world.board,
                background: { r: (state.time.tick + 1) % 250, g: 50, b: 60 },
              },
            };
          }
        },
      },
    ],
  });

  // Load the board:
  const first = engine.advance(1, []);
  const replies: InputRecord[] = first.requests
    .filter((req): req is Extract<typeof req, { kind: "asset" }> => req.kind === "asset")
    .map((req) => ({ tick: first.tickAfter, event: { kind: "asset", reqId: req.reqId, bytes: files.get(req.key) ?? null } }));
  engine.advance(1, replies);

  const findRev = (): number => {
    for (let rev = 511; rev >= 0; rev -= 1) {
      if (engine.surfacePixels(0 as SurfaceId, rev) !== null) return rev;
    }
    return -1;
  };

  const revBefore = findRev();
  ok(revBefore >= 1, "initial board frame committed to surface 0");

  // Run 50 ticks in a single batch where the camera moves every tick:
  const batch = engine.advance(50, []);
  equal(batch.ticksRun, 50);

  const revAfter = findRev();
  equal(
    revAfter,
    revBefore + 1,
    "surface 0 is rasterised and written once at the end of a 50-tick batch, not 50 times",
  );
});


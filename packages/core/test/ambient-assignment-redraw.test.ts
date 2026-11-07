// Tests for issue #1185 (ADR 0018 T20, 3.1 P4):
// Direct assignment to ambientRed, ambientGreen, ambientBlue changes the composed
// frame only after a board redraw (such as forceRedraw()) or a board load,
// while setAmbientLevel applies immediately.

import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  writeCharacter,
  writeMainFile,
  writeTileset,
  type AssetKey,
  type DrawCommand,
  type InputRecord,
  type Result,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const encoder = new TextEncoder();

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("ambientRed/Green/Blue assignment changes the composed frame only after forceRedraw or board load (#1185)", () => {
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "",
    initBoard: "start.brd",
    initChar: "hero.tem",
  });
  if (!main.ok) throw new Error(main.error.message);

  const empty = createEmptyBoard();
  const boardStartResult = writeBoard({
    ...empty,
    sizeX: 4,
    sizeY: 4,
    sizeL: 1,
    tileMatrix: Array.from({ length: 16 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 16, marker: true }],
    layerTitles: ["", ""],
    lut: ["tile.tst1"],
    properties: {
      ...empty.properties,
      backgroundColour: { r: 10, g: 20, b: 30 },
      ambient: { r: 0, g: 0, b: 0 },
      start: { x: 0, y: 0, layer: 1 },
      enterPrg: "enter.prg",
    },
  });
  if (!boardStartResult.ok) throw new Error(boardStartResult.error.message);

  const boardOtherResult = writeBoard({
    ...empty,
    sizeX: 4,
    sizeY: 4,
    sizeL: 1,
    tileMatrix: Array.from({ length: 16 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 16, marker: true }],
    layerTitles: ["", ""],
    lut: ["tile.tst1"],
    properties: {
      ...empty.properties,
      backgroundColour: { r: 10, g: 20, b: 30 },
      ambient: { r: 50, g: 60, b: 70 },
      start: { x: 0, y: 0, layer: 1 },
    },
  });
  if (!boardOtherResult.ok) throw new Error(boardOtherResult.error.message);

  const charResult = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!charResult.ok) throw new Error(charResult.error.message);

  const tilePixels = new Uint8Array(32 * 32 * 3).fill(255);
  const tilesetBytes = unwrap(
    writeTileset({
      version: 20,
      detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
      tiles: [{ pixels: tilePixels }],
      residue: new Uint8Array(),
    }),
  );

  // Script sequence:
  // Step 1: wait() -> sample initial ambient (0, 0, 0)
  // Step 2: ambientred = 200 -> wait() -> verify ambientRed is 200 in script, but tile tint is still (0, 0, 0)
  // Step 3: forceredraw() -> wait() -> verify tile tint is now (200, 0, 0)
  // Step 4: setambientlevel(30, 40, 50) -> wait() -> verify tile tint is immediately (30, 40, 50)
  // Step 5: ambientblue = 180; send("other.brd", 1, 1, 1) -> board load sets ambient to other.brd's (50, 60, 70)
  const enterPrgSource =
    "step = 1\n" +
    "wait()\n" +
    "step = 2\n" +
    "ambientred = 200\n" +
    "wait()\n" +
    "step = 3\n" +
    "forceredraw()\n" +
    "wait()\n" +
    "step = 4\n" +
    "setambientlevel(30, 40, 50)\n" +
    "wait()\n" +
    "step = 5\n" +
    "ambientblue = 180\n" +
    'send("other.brd", 1, 1, 1)\n' +
    "end()\n";

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), new Uint8Array(boardStartResult.value)],
    [assetKey("boards/other.brd"), new Uint8Array(boardOtherResult.value)],
    [assetKey("chrs/hero.tem"), new Uint8Array(charResult.value)],
    [assetKey("tiles/tile.tst"), tilesetBytes],
    [assetKey("prg/enter.prg"), encoder.encode(enterPrgSource)],
  ]);

  const assetPaths = [
    "main.gam",
    "Boards/start.brd",
    "Boards/other.brd",
    "Chrs/hero.tem",
    "Tiles/tile.tst",
    "Prg/enter.prg",
  ];

  let latestState: any = null;
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(assetPaths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "ambient-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [
      { phase: "audio", run: (s) => { latestState = s; } },
    ],
  });

  function step(replies: InputRecord[] = []): ReturnType<typeof engine.advance> {
    const report = engine.advance(1, replies);
    const newReplies: InputRecord[] = [];
    for (const req of report.requests) {
      if ("key" in req && typeof (req as any).key === "string") {
        newReplies.push({
          tick: report.tickAfter,
          event: { kind: "asset", reqId: req.reqId, bytes: files.get((req as any).key) ?? null },
        });
      }
    }
    if (newReplies.length > 0) return step(newReplies);
    return report;
  }

  const getTileTint = () => {
    const list = engine.drawList(0, { shading: true, images: true, sprites: true });
    if (!list) return null;
    for (const cmd of list.commands) {
      if (cmd.kind === "blit" && typeof cmd.source === "object" && "tile" in cmd.source && cmd.source.tile !== null) {
        return cmd.tint;
      }
    }
    return null;
  };

  const pressEnter = () => {
    const currentTick = latestState?.time?.tick ?? 0;
    step([{ tick: currentTick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } }]);
    step([{ tick: currentTick + 1, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } }]);
  };

  // Tick until enter.prg is running at step 1:
  for (let i = 0; i < 10; i++) step();

  // Step 1: Initial board ambient is (0, 0, 0)
  let tint = getTileTint();
  ok(tint !== null, "tile blit must be emitted");
  equal(tint.r, 0, "initial red tint must be 0");
  equal(tint.g, 0, "initial green tint must be 0");
  equal(tint.b, 0, "initial blue tint must be 0");

  // Resume enter.prg to step 2 (assigns ambientred = 200, then wait()):
  pressEnter();
  step();
  step();

  // Step 2: ambientred was written, but NO forceRedraw or board load has occurred yet!
  // Tint must STILL be (0, 0, 0)!
  tint = getTileTint();
  ok(tint !== null, "tile blit must be emitted at step 2");
  equal(tint.r, 0, "ambientred assignment must NOT change composed tint before forceRedraw (#1185)");
  equal(tint.g, 0, "green tint remains 0");
  equal(tint.b, 0, "blue tint remains 0");

  // Resume enter.prg to step 3 (calls forceredraw(), then wait()):
  pressEnter();
  step();
  step();

  // Step 3: forceRedraw() has redrawn the board!
  // Tint must now be (200, 0, 0)!
  tint = getTileTint();
  ok(tint !== null, "tile blit must be emitted at step 3");
  equal(tint.r, 200, "forceRedraw must apply pending ambientred change (#1185)");
  equal(tint.g, 0, "green tint remains 0");
  equal(tint.b, 0, "blue tint remains 0");

  // Resume enter.prg to step 4 (calls setambientlevel(30, 40, 50), then wait()):
  pressEnter();
  step();
  step();

  // Step 4: setambientlevel applies immediately (internally calls forceRedraw):
  tint = getTileTint();
  ok(tint !== null, "tile blit must be emitted at step 4");
  equal(tint.r, 30, "setambientlevel red tint applies at once");
  equal(tint.g, 40, "setambientlevel green tint applies at once");
  equal(tint.b, 50, "setambientlevel blue tint applies at once");

  // Resume enter.prg to step 5 (assigns ambientblue = 180, then send("other.brd", 1, 1, 1)):
  pressEnter();
  step();
  step();
  step();

  // Step 5: other.brd has loaded (ambient { r: 50, g: 60, b: 70 })
  tint = getTileTint();
  ok(tint !== null, "tile blit must be emitted on other.brd");
  equal(tint.r, 50, "board load applies other.brd ambient red");
  equal(tint.g, 60, "board load applies other.brd ambient green");
  equal(tint.b, 70, "board load applies other.brd ambient blue");
});

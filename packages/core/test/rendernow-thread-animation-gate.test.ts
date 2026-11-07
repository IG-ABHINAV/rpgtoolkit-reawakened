// Tests for issue #1183 (ADR 0018 T16):
// RenderNow overlay and thread animations compose during free roam, but are gated
// out during a running outermost program that does not touch the overlay.

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
  renderNowCanvas,
  writeAnimation,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type AssetKey,
  type DrawCommand,
  type InputRecord,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const encoder = new TextEncoder();

test("rendernow overlay and thread animations started earlier do not compose during a running program (#1183, ADR 0018 T16)", () => {
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
  });
  if (!main.ok) throw new Error(main.error.message);

  const animBytes = writeAnimation({
    magic: "RPGTLKIT ANIM",
    major: 2,
    minor: 3,
    width: 2,
    height: 2,
    frames: [
      { image: "red.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
    ],
    delay: 0.1,
    residue: new Uint8Array(),
  });
  if (!animBytes.ok) throw new Error(animBytes.error.message);

  const empty = createEmptyBoard();
  const boardResult = writeBoard({
    ...empty,
    sizeX: 4,
    sizeY: 4,
    sizeL: 1,
    tileMatrix: Array.from({ length: 16 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 16, marker: true }],
    layerTitles: ["", ""],
    properties: {
      ...empty.properties,
      backgroundColour: { r: 10, g: 20, b: 30 },
      start: { x: 0, y: 0, layer: 1 },
      enterPrg: "enter.prg",
    },
  });
  if (!boardResult.ok) throw new Error(boardResult.error.message);

  const charResult = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!charResult.ok) throw new Error(charResult.error.message);

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), new Uint8Array(boardResult.value)],
    [assetKey("chrs/hero.tem"), new Uint8Array(charResult.value)],
    // Startup program enables rendernow, paints on it, starts a looping animation, and ends:
    [
      assetKey("prg/start.prg"),
      encoder.encode(
        "rendernow(1)\n" +
        "c = cnvrendernow\n" +
        "colorrgb(100, 200, 50)\n" +
        "fillrect(0, 0, 4, 4, c)\n" +
        'id = animation("spin.anm", 2, 2, 1)\n' +
        "end()\n",
      ),
    ],
    // Board enter program only waits for user key press; does NOT touch overlay or animation:
    [assetKey("prg/enter.prg"), encoder.encode("wait()\nend()\n")],
    [assetKey("misc/spin.anm"), animBytes.value],
    [assetKey("bitmap/red.png"), encodePng(2, 2, new Uint8Array(2 * 2 * 4).fill(255))],
  ]);

  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex([
      "main.gam",
      "Boards/start.brd",
      "Chrs/hero.tem",
      "Prg/start.prg",
      "Prg/enter.prg",
      "Misc/spin.anm",
      "Bitmap/red.png",
    ]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "overlay-gate-test",
    width: 4,
    height: 4,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [
      { phase: "audio", run: (s) => { latestSurfaces = s.surfaces; } },
    ],
  });
  let latestSurfaces: Parameters<typeof renderNowCanvas>[0] | null = null;

  function step(replies: InputRecord[] = []): ReturnType<typeof engine.advance> {
    const report = engine.advance(1, replies);
    const newReplies: InputRecord[] = [];
    for (const req of report.requests) {
      if (req.kind === "asset") {
        newReplies.push({
          tick: report.tickAfter,
          event: { kind: "asset", reqId: req.reqId, bytes: files.get(req.key) ?? null },
        });
      }
    }
    if (newReplies.length > 0) return step(newReplies);
    return report;
  }

  // Advance ticks until the board loads and enter.prg runs:
  let report = step();
  while (report.tickAfter < 20 && report.requests.length > 0) {
    report = step();
  }

  // Now enter.prg is parked on wait():
  // Verify that an outermost blocking program is active:
  ok(latestSurfaces !== null, "engine state captured");
  const overlayCanvasId = renderNowCanvas(latestSurfaces);
  ok(overlayCanvasId !== null, "cnvRenderNow exists");

  // In this active enter.prg frame, neither the overlay nor the earlier animation must compose:
  const duringProgramDrawList = engine.drawList(0);
  const hasOverlayDuring = duringProgramDrawList.commands.some(
    (cmd: DrawCommand) => cmd.kind === "blit" && "surface" in cmd.source && cmd.source.surface === overlayCanvasId,
  );
  equal(hasOverlayDuring, false, "overlay must NOT be composed while enter.prg runs");

  const hasAnimationDuring = duringProgramDrawList.commands.some(
    (cmd: DrawCommand) => cmd.kind === "blit" && "asset" in cmd.source && cmd.source.asset === "bitmap/red.png",
  );
  equal(hasAnimationDuring, false, "earlier animation must NOT be composed while enter.prg runs");

  // Now resume wait() by pressing ENTER:
  step([
    { tick: report.tickAfter, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } },
  ]);
  // Release ENTER and step:
  step([
    { tick: report.tickAfter + 1, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } },
  ]);

  // Now enter.prg has ended, game is in free roam:
  const freeRoamDrawList = engine.drawList(0);
  const hasOverlayFreeRoam = freeRoamDrawList.commands.some(
    (cmd: DrawCommand) => cmd.kind === "blit" && "surface" in cmd.source && cmd.source.surface === overlayCanvasId,
  );
  equal(hasOverlayFreeRoam, true, "overlay must be composed in free roam");

  const hasAnimationFreeRoam = freeRoamDrawList.commands.some(
    (cmd: DrawCommand) => cmd.kind === "blit" && "asset" in cmd.source && cmd.source.asset === "bitmap/red.png",
  );
  equal(hasAnimationFreeRoam, true, "looping animation must be composed in free roam");
});

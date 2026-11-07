// Tests for issue #1184 (ADR 0018 T19):
// rendernow(1) / rendernow(0) and drawing into cnvRenderNow take effect at the next
// board redraw (forceRedraw, setAmbientLevel, board load), not on the next composed frame.

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
  writeBoard,
  writeCharacter,
  writeMainFile,
  type AssetKey,
  type DrawCommand,
  type InputRecord,
  type SurfaceId,
} from "../src/index.ts";

const encoder = new TextEncoder();

test("rendernow toggle and cnvRenderNow drawing show at board redraw, not next frame (#1184, ADR 0018 T19)", () => {
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

  const scriptCode = [
    "wait()", // step 1: initial parked state, overlay off
    "rendernow(1)",
    "c = cnvrendernow",
    "colorrgb(255, 0, 255)",
    "fillrect(0, 0, 4, 4, c)",
    "wait()", // step 2: turned on + drawn, but NO board redraw yet
    "forceredraw()",
    "wait()", // step 3: forceRedraw baked the overlay (magenta)
    "rendernow(0)",
    "wait()", // step 4: turned off, but NO board redraw yet -> previous snapshot stays
    "forceredraw()",
    "wait()", // step 5: forceRedraw cleared the overlay
    "rendernow(1)",
    "c = cnvrendernow",
    "colorrgb(255, 0, 0)",
    "fillrect(0, 0, 4, 4, c)",
    "forceredraw()",
    "wait()", // step 6: turned on + drawn red + forceRedraw -> red overlay
    "colorrgb(0, 255, 0)",
    "fillrect(0, 0, 4, 4, c)",
    "wait()", // step 7: drawn green, but NO forceRedraw yet -> still red
    "forceredraw()",
    "wait()", // step 8: forceRedraw -> now green
    "end()",  // step 9: program ends -> free roam
  ].join("\n");

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), new Uint8Array(boardResult.value)],
    [assetKey("chrs/hero.tem"), new Uint8Array(charResult.value)],
    [assetKey("prg/enter.prg"), encoder.encode(scriptCode)],
  ]);

  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex([
      "main.gam",
      "Boards/start.brd",
      "Chrs/hero.tem",
      "Prg/enter.prg",
    ]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "rendernow-redraw-test",
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

  function advanceWait(): void {
    report = step([{ tick: report.tickAfter, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } }]);
    report = step([{ tick: report.tickAfter, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } }]);
  }

  function findOverlayCommand(): DrawCommand | null {
    const dl = engine.drawList(0);
    for (const cmd of dl.commands) {
      if (cmd.kind === "blit" && "surface" in cmd.source && latestSurfaces !== null) {
        const cnv = renderNowCanvas(latestSurfaces);
        if (cnv !== null && cmd.source.surface === cnv) return cmd;
      }
    }
    return null;
  }

  // Load board and enter.prg:
  let report = step();
  while (report.tickAfter < 20 && report.requests.length > 0) {
    report = step();
  }

  // Step 1: parked on wait(); overlay off
  equal(findOverlayCommand(), null, "Step 1: overlay must be null initially");

  // Step 2: rendernow(1) + fillrect (magenta) + wait()
  advanceWait();
  equal(findOverlayCommand(), null, "Step 2: overlay must remain null before board redraw");

  // Step 3: forceredraw() + wait()
  advanceWait();
  const cmd3 = findOverlayCommand();
  ok(cmd3 !== null, "Step 3: overlay must be present after forceRedraw");
  if (cmd3.kind === "blit" && "surface" in cmd3.source) {
    const pixels = engine.surfacePixels(cmd3.source.surface, cmd3.source.rev);
    ok(pixels !== null, "Step 3: surface pixels must exist");
    // Magenta is (255, 0, 255)
    equal(pixels.rgba[0], 255, "Step 3: red channel is 255");
    equal(pixels.rgba[1], 0, "Step 3: green channel is 0");
    equal(pixels.rgba[2], 255, "Step 3: blue channel is 255");
  }

  // Step 4: rendernow(0) + wait()
  advanceWait();
  const cmd4 = findOverlayCommand();
  ok(cmd4 !== null, "Step 4: overlay remains visible until board redraw even after rendernow(0)");

  // Step 5: forceredraw() + wait()
  advanceWait();
  equal(findOverlayCommand(), null, "Step 5: overlay must disappear after forceRedraw reflects rendernow(0)");

  // Step 6: rendernow(1) + fillrect (red) + forceredraw() + wait()
  advanceWait();
  const cmd6 = findOverlayCommand();
  ok(cmd6 !== null, "Step 6: overlay must be present after forceRedraw");
  if (cmd6.kind === "blit" && "surface" in cmd6.source) {
    const pixels = engine.surfacePixels(cmd6.source.surface, cmd6.source.rev);
    ok(pixels !== null, "Step 6: surface pixels must exist");
    // Red is (255, 0, 0)
    equal(pixels.rgba[0], 255, "Step 6: red channel is 255");
    equal(pixels.rgba[1], 0, "Step 6: green channel is 0");
    equal(pixels.rgba[2], 0, "Step 6: blue channel is 0");
  }

  // Step 7: fillrect (green) + wait()
  advanceWait();
  const cmd7 = findOverlayCommand();
  ok(cmd7 !== null, "Step 7: overlay must still be present");
  if (cmd7.kind === "blit" && "surface" in cmd7.source) {
    const pixels = engine.surfacePixels(cmd7.source.surface, cmd7.source.rev);
    ok(pixels !== null, "Step 7: surface pixels must exist");
    // Drawing into canvas is NOT visible before forceRedraw: still red (255, 0, 0)
    equal(pixels.rgba[0], 255, "Step 7: still red channel 255 before forceRedraw");
    equal(pixels.rgba[1], 0, "Step 7: still green channel 0 before forceRedraw");
  }

  // Step 8: forceredraw() + wait()
  advanceWait();
  const cmd8 = findOverlayCommand();
  ok(cmd8 !== null, "Step 8: overlay must be present after forceRedraw");
  if (cmd8.kind === "blit" && "surface" in cmd8.source) {
    const pixels = engine.surfacePixels(cmd8.source.surface, cmd8.source.rev);
    ok(pixels !== null, "Step 8: surface pixels must exist");
    // Drawing into canvas IS visible now: green (0, 255, 0)
    equal(pixels.rgba[0], 0, "Step 8: red channel is 0 after forceRedraw");
    equal(pixels.rgba[1], 255, "Step 8: green channel is 255 after forceRedraw");
  }

  // Step 9: end() -> free roam
  advanceWait();
  const cmd9 = findOverlayCommand();
  ok(cmd9 !== null, "Step 9: overlay composed in free roam");
  if (cmd9.kind === "blit" && "surface" in cmd9.source) {
    const pixels = engine.surfacePixels(cmd9.source.surface, cmd9.source.rev);
    ok(pixels !== null, "Step 9: free roam overlay pixels exist");
    equal(pixels.rgba[1], 255, "Step 9: free roam overlay has green pixels");
  }
});

// Tests for issue #1182 (3.1 P2, ADR 0018 T15):
// Board redraw commands redraw the whole board (board, sprites, thread animations, overlay if on)
// into the program surface from scratch, erasing whatever the program had drawn, then present
// it with the message window on top:
// send, forceRedraw, setAmbientLevel, layerPut, blocking playerStep, custom stance.

import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { movementPhaseRegistration } from "../src/sprites/movement.ts";
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
  type AssetKey,
  type InputRecord,
  type SurfaceId,
} from "../src/index.ts";

const encoder = new TextEncoder();

test("P2 board redraw commands erase program drawing and preserve message window (#1182, ADR 0018 T15)", () => {
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
    properties: {
      ...empty.properties,
      backgroundColour: { r: 10, g: 20, b: 30 },
      ambient: { r: 0, g: 0, b: 0 },
      start: { x: 0, y: 0, layer: 1 },
      enterPrg: "enter.prg",
    },
  });
  if (!boardStartResult.ok) throw new Error(boardStartResult.error.message);

  const boardDestResult = writeBoard({
    ...empty,
    sizeX: 4,
    sizeY: 4,
    sizeL: 1,
    tileMatrix: Array.from({ length: 16 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 16, marker: true }],
    layerTitles: ["", ""],
    properties: {
      ...empty.properties,
      backgroundColour: { r: 50, g: 60, b: 70 },
      ambient: { r: 0, g: 0, b: 0 },
      start: { x: 0, y: 0, layer: 1 },
    },
  });
  if (!boardDestResult.ok) throw new Error(boardDestResult.error.message);

  const charResult = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!charResult.ok) throw new Error(charResult.error.message);

  const scriptCode = [
    // Step 1: Program draws red rect, text, opens message window, then parks
    "colorrgb(255, 0, 0)",
    "fillrect(0, 0, 4, 4)",
    "text(0, 0, \"DRAWING\")",
    "mwin(\"WINDOW\")",
    "wait()",
    // Step 2: forceredraw() -> erases program drawing, message window intact
    "forceredraw()",
    "wait()",
    // Step 3: Draw green rect and text again, then park
    "colorrgb(0, 255, 0)",
    "fillrect(0, 0, 4, 4)",
    "text(0, 0, \"DRAWING2\")",
    "wait()",
    // Step 4: setambientlevel() -> erases program drawing, message window intact
    "setambientlevel(100, 100, 100)",
    "wait()",
    // Step 5: Draw blue rect and text again, then park
    "colorrgb(0, 0, 255)",
    "fillrect(0, 0, 4, 4)",
    "text(0, 0, \"DRAWING3\")",
    "wait()",
    // Step 6: layerput() -> erases program drawing, message window intact
    "layerput(1, 1, 1, \"tile.tst1\")",
    "wait()",
    // Step 7: Draw yellow rect and text again, then park
    "colorrgb(255, 255, 0)",
    "fillrect(0, 0, 4, 4)",
    "text(0, 0, \"DRAWING4\")",
    "wait()",
    // Step 8: playerstance() -> erases program drawing, message window intact
    "playerstance(0, \"E\")",
    "wait()",
    // Step 9: Draw cyan rect and text again, then park
    "colorrgb(0, 255, 255)",
    "fillrect(0, 0, 4, 4)",
    "text(0, 0, \"DRAWING5\")",
    "wait()",
    // Step 10: playerstep() (blocking) -> erases program drawing, message window intact
    "playerspeed(0, 0.001)",
    "playerstep(0, 32, 0)",
    "wait()",
    // Step 11: Draw magenta rect and text again, then park
    "colorrgb(255, 0, 255)",
    "fillrect(0, 0, 4, 4)",
    "text(0, 0, \"DRAWING6\")",
    "wait()",
    // Step 12: send() -> erases program drawing, destination board active, message window intact
    "send(\"dest.brd\", 1, 1)",
    "wait()",
    "end()",
  ].join("\n");

  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), new Uint8Array(boardStartResult.value)],
    [assetKey("boards/dest.brd"), new Uint8Array(boardDestResult.value)],
    [assetKey("chrs/hero.tem"), charResult.value],
    [assetKey("prg/enter.prg"), encoder.encode(scriptCode)],
  ]);

  let latestSurfaces: Parameters<typeof createEngine>[0] extends { phaseRegistrations?: readonly { readonly run: (s: infer S) => void }[] } ? S extends { surfaces: infer Surf } ? Surf : never : never = null as any;

  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex([
      "main.gam",
      "Boards/start.brd",
      "Boards/dest.brd",
      "Chrs/hero.tem",
      "Prg/enter.prg",
    ]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "program-surface-redraw-test",
    width: 4,
    height: 4,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [
      movementPhaseRegistration(),
      { phase: "audio", run: (s) => { latestSurfaces = s.surfaces; } },
    ],
  });

  function getSurface0Pixels(): Uint8Array {
    const entry0 = latestSurfaces?.entries["0"];
    ok(entry0 !== undefined, "surface 0 entry must exist");
    const pixels = engine.surfacePixels(0 as SurfaceId, entry0.rev);
    ok(pixels !== null, "surfacePixels for surface 0 must not be null");
    return pixels.rgba;
  }

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

  function hasTextInDrawList(str: string): boolean {
    const dl = engine.drawList(0);
    return dl.commands.some((c) => c.kind === "text" && c.text === str);
  }

  function hasMessageWindow(): boolean {
    const dl = engine.drawList(0);
    return dl.commands.some((c) => c.kind === "text" && c.text === "WINDOW");
  }

  // Step 1: Advance until enter.prg runs and parks at the first wait()
  let report = step();
  for (let i = 0; i < 50; i += 1) {
    if (hasTextInDrawList("DRAWING")) break;
    report = step();
  }

  // Verify initial state at step 1: program drawing and text are present, window is present
  ok(hasTextInDrawList("DRAWING"), "Program text 'DRAWING' must be in draw list before redraw");
  ok(hasMessageWindow(), "Message window must be in draw list");
  let pixels = getSurface0Pixels();
  // Red rect was drawn: top-left pixel has red component 255
  equal(pixels[0], 255, "Surface 0 pixel [0] must be red from fillrect");

  // Step 2: forceredraw()
  advanceWait();
  ok(!hasTextInDrawList("DRAWING"), "forceRedraw must erase program text 'DRAWING'");
  ok(hasMessageWindow(), "forceRedraw must keep message window intact");
  pixels = getSurface0Pixels();
  ok(pixels[0] !== 255, "forceRedraw must erase red fillrect from surface 0");

  // Step 3: Draw green rect and DRAWING2, then park
  advanceWait();
  ok(hasTextInDrawList("DRAWING2"), "Program text 'DRAWING2' must be present before setambientlevel");
  pixels = getSurface0Pixels();
  equal(pixels[1], 255, "Surface 0 pixel [1] must be green from second fillrect");

  // Step 4: setambientlevel()
  advanceWait();
  ok(!hasTextInDrawList("DRAWING2"), "setAmbientLevel must erase program text 'DRAWING2'");
  ok(hasMessageWindow(), "setAmbientLevel must keep message window intact");
  pixels = getSurface0Pixels();
  ok(pixels[1] !== 255, "setAmbientLevel must erase green fillrect from surface 0");

  // Step 5: Draw blue rect and DRAWING3, then park
  advanceWait();
  ok(hasTextInDrawList("DRAWING3"), "Program text 'DRAWING3' must be present before layerput");
  pixels = getSurface0Pixels();
  equal(pixels[2], 255, "Surface 0 pixel [2] must be blue from third fillrect");

  // Step 6: layerput()
  advanceWait();
  ok(!hasTextInDrawList("DRAWING3"), "layerPut must erase program text 'DRAWING3'");
  ok(hasMessageWindow(), "layerPut must keep message window intact");
  pixels = getSurface0Pixels();
  ok(pixels[2] !== 255, "layerPut must erase blue fillrect from surface 0");

  // Step 7: Draw yellow rect and DRAWING4, then park
  advanceWait();
  ok(hasTextInDrawList("DRAWING4"), "Program text 'DRAWING4' must be present before playerstance");
  pixels = getSurface0Pixels();
  equal(pixels[0], 255, "Surface 0 pixel [0] must be yellow (R=255) from fourth fillrect");
  equal(pixels[1], 255, "Surface 0 pixel [1] must be yellow (G=255) from fourth fillrect");

  // Step 8: playerstance()
  advanceWait();
  ok(!hasTextInDrawList("DRAWING4"), "playerStance must erase program text 'DRAWING4'");
  ok(hasMessageWindow(), "playerStance must keep message window intact");

  // Step 9: Draw cyan rect and DRAWING5, then park
  advanceWait();
  ok(hasTextInDrawList("DRAWING5"), "Program text 'DRAWING5' must be present before playerstep");
  pixels = getSurface0Pixels();
  equal(pixels[1], 255, "Surface 0 pixel [1] must be cyan (G=255) from fifth fillrect");
  equal(pixels[2], 255, "Surface 0 pixel [2] must be cyan (B=255) from fifth fillrect");

  // Step 10: playerstep() (blocking)
  advanceWait();
  ok(!hasTextInDrawList("DRAWING5"), "blocking playerStep must erase program text 'DRAWING5'");
  ok(hasMessageWindow(), "blocking playerStep must keep message window intact");

  // Step until movement completes and reaches wait()
  for (let i = 0; i < 30; i += 1) {
    report = step();
  }

  // Step 11: Draw magenta rect and DRAWING6, then park
  advanceWait();
  ok(hasTextInDrawList("DRAWING6"), "Program text 'DRAWING6' must be present before send");
  pixels = getSurface0Pixels();
  equal(pixels[0], 255, "Surface 0 pixel [0] must be magenta (R=255) from sixth fillrect");
  equal(pixels[2], 255, "Surface 0 pixel [2] must be magenta (B=255) from sixth fillrect");

  // Step 12: send()
  advanceWait();
  ok(!hasTextInDrawList("DRAWING6"), "send must erase program text 'DRAWING6'");
  ok(hasMessageWindow(), "send must keep message window intact");
  pixels = getSurface0Pixels();
  ok(pixels[0] !== 255, "send must erase magenta fillrect from surface 0");
  equal(pixels[0], 25, "Surface 0 pixel [0] should show destination board background red=50 dimmed to 25 by translucent message window");
});

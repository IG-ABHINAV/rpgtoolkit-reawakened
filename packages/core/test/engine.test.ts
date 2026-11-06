import { deepEqual, equal } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { addActor, applyEmitterOp, assetKey, IR_VERSION, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEmptyMainFile, createEngine, decodeSurfaceBytes, ENGINE_DEFAULT_MANIFEST, ENGINE_PHASES, ENGINE_PLUGIN_TABLE, encodeSurfaceBytes, hashGameState, PACKAGE_ROOT, rasterizePresentation, readSurfacePixels, TILE_BITMAP_MAGIC, writeBoard, writeCharacter, writeMainFile, writeTileBitmap, writeTileset, type Board, type CommandView, type DrawCommand, type EffectRecord, type Engine, type EnginePhaseRegistration, type GameState, type PackageCatalogueEntry, type PluginDefinition, type RasterSurfaces, type ResolvedPlugin, type SurfaceId } from "../src/index.ts";
import { applyUiEffect } from "../src/script/packs/ui.ts";
import { resetUiForProgramStart } from "../src/save/sections/ui.ts";
import { resolveManifestPlugins } from "../src/engine/boot.ts";
import { ensureScriptScreen, SCRIPT_SCREEN } from "../src/raster/surfaces.ts";

function boardBytes(board: Board): Uint8Array {
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

/** A decodable character for a fixture whose main file names one: E-02 reads and parses it during boot. */
function heroBytes(): Uint8Array {
  const encoded = writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] });
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

test("createEngine exposes its initial board request at advance(0) and missing bytes unblock loading", () => {
  const engine = createEngine({ seed: 7, assetIndex: createAssetIndex(["Boards/start.brd"]), assetRoot: PACKAGE_ROOT, initialBoard: "start.brd", width: 512, height: 384, maxTicks: 8 });
  const first = engine.advance(0, []);
  equal(first.requests.length, 1);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  equal(request.reqId, 1);
  deepEqual(request.key, "boards/start.brd");
  equal(first.loading, true);
  const missing = engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: null } }]);
  equal(missing.ticksRun, 0);
  equal(missing.loading, false);
  equal(missing.diagnostics[0]?.code, "asset.missing");
});

test("engine queues non-asset inputs while loading and respects consuming ticks", () => {
  const engine = createEngine({ seed: 7, assetIndex: createAssetIndex(["Boards/start.brd"]), assetRoot: PACKAGE_ROOT, initialBoard: "start.brd", width: 512, height: 384, maxTicks: 8 });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  const futureReply = engine.advance(0, [{ tick: 1, event: { kind: "asset", reqId: request.reqId, bytes: null } }]);
  equal(futureReply.consumed.length, 0);
  const queued = engine.advance(0, [{ tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: "a", down: true } }]);
  equal(queued.consumed.length, 0);
  const failed = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: null } }]);
  equal(failed.consumed.length, 1);
  const afterFailure = engine.advance(0, []);
  equal(afterFailure.consumed.length, 1);
  equal(afterFailure.consumed[0]?.event.kind, "key");
});

function loadedEngine(
  registrations: Parameters<typeof createEngine>[0]["phaseRegistrations"] = [],
  input?: Parameters<typeof createEngine>[0]["input"],
  displayGeometry?: Parameters<typeof createEngine>[0]["displayGeometry"],
  program?: string,
) {
  const board = createEmptyBoard();
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 60,
    phaseRegistrations: registrations,
    ...(input === undefined ? {} : { input }),
    ...(displayGeometry === undefined ? {} : { displayGeometry }),
    ...(program === undefined ? {} : { program }),
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected test board asset request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encoded.value } }]);
  if (loaded.loading) throw new Error("expected authored board to load");
  return engine;
}

test("pointer cancellation before a focus-loss tick cannot activate a button slot", () => {
  const capture = captureState();
  const button = { id: "primary", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: true };
  const engine = loadedEngine([capture.registration], { buttons: [button] });

  const interrupted = engine.advance(0, [
    { tick: 0, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } },
    { tick: 0, event: { kind: "pointer.cancel" } },
    { tick: 0, event: { kind: "focus", state: "lost" } },
  ]);
  equal(interrupted.ticksRun, 0);

  engine.advance(0, [
    { tick: 0, event: { kind: "focus", state: "gained" } },
    { tick: 0, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } },
  ]);
  engine.advance(1, []);
  const cancelled = capture.state();
  if (cancelled === undefined) throw new Error("expected captured game state");
  equal(cancelled.input.pointer.buttons & 1, 0);
  equal(cancelled.input.pressedButtonSlot, null);
  equal(cancelled.input.pendingActions.includes("confirm"), false);
  equal(cancelled.input.keys.some((key) => key.action === "slot:primary"), false);

  const realDown = engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
  equal(realDown.ticksRun, 1);
  engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
  const activated = capture.state();
  if (activated === undefined) throw new Error("expected captured game state");
  equal(activated.input.keys.filter((key) => key.action === "slot:primary").length, 1);
  equal(activated.input.pendingActions.filter((action) => action === "confirm").length, 1);
});

test("ordinary pointer down and up activates an enabled button slot once", () => {
  const capture = captureState();
  const button = { id: "primary", x: 0, y: 0, w: 10, h: 10, action: "confirm", enabled: true };
  const engine = loadedEngine([capture.registration], { buttons: [button] });
  engine.advance(1, [{ tick: 0, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
  engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  equal(state.input.keys.filter((key) => key.action === "slot:primary").length, 1);
  equal(state.input.pendingActions.filter((action) => action === "confirm").length, 1);
});
test("same-tick gamepad confirm transitions activate the published author surface", () => {
  const capture = captureState();
  const surface: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      applyUiEffect(state, "uiBegin", [7, "touch", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Confirm", "confirm", null, 1, null, null, null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
    },
  };
  const engine = loadedEngine([capture.registration, surface]);
  engine.advance(1, []);
  const result = engine.advance(1, [
    { tick: 1, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 } },
    { tick: 1, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 } },
  ]);
  equal(result.ticksRun, 1);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  equal(state.ui.surfaceActivated?.itemId, "confirm", "the down edge is routed before the same-tick up edge");
  equal(state.input.actions.confirm, false, "the short gamepad tap is released by the end of the input batch");
});
test("an active engine modal owns confirm before an underlying author surface", () => {
  const capture = captureState();
  const surface: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      applyUiEffect(state, "uiBegin", [7, "touch", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Confirm", "confirm", null, 1, null, null, null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
      state.ui.modal = {
        modalId: state.ui.nextModalId++,
        kind: "msgbox",
        text: "Modal",
        title: "",
        style: 0,
        textColor: { r: 255, g: 255, b: 255 },
        background: { r: 0, g: 0, b: 0 },
        graphic: "",
        selected: 0,
        result: null,
      };
    },
  };
  const engine = loadedEngine([capture.registration, surface]);
  engine.advance(1, []);
  engine.advance(1, [
    { tick: 1, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 } },
  ]);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  equal(state.ui.surfaceActivated, null);
});
test("author surface margin hit-testing uses safe whole cells", () => {
  const capture = captureState();
  const surface: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      applyUiEffect(state, "uiBegin", [7, "touch", "surface", -4, 0, 4, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Go", "go", null, 1, null, "confirm", null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
    },
  };
  const geometry = {
    content: { width: 64, height: 32 },
    game: { x: 16, y: 0, width: 32, height: 32 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const engine = loadedEngine([capture.registration, surface], undefined, geometry);
  engine.advance(1, []);
  engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: -2, y: 5, buttons: 1 } }]);
  engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: -2, y: 5, buttons: 0 } }]);
  const activated = capture.state();
  if (activated === undefined) throw new Error("expected captured game state");
  equal(activated.ui.surfaceActivated?.index, 0);
  equal(activated.input.pendingActions.filter((action) => action === "confirm").length, 1);

  const clippedCapture = captureState();
  const clipped = loadedEngine([clippedCapture.registration, surface], undefined, {
    ...geometry,
    safeArea: { ...geometry.safeArea, left: 14 },
  });
  clipped.advance(1, []);
  clipped.advance(1, [{ tick: 1, event: { kind: "pointer", x: -2, y: 5, buttons: 1 } }]);
  clipped.advance(1, [{ tick: 2, event: { kind: "pointer", x: -3, y: 5, buttons: 0 } }]);
  const refused = clippedCapture.state();
  if (refused === undefined) throw new Error("expected captured game state");
  equal(refused.ui.surfaceActivated, null);
  equal(refused.input.pendingActions.filter((action) => action === "confirm").length, 0);
});
test("screen vector primitives crossing Plane 1 enter margin commands and render at their physical margin pixels", () => {
  const capture = captureState();
  const geometry = {
    content: { width: 34, height: 32 },
    game: { x: 1, y: 0, width: 32, height: 32 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const engine = loadedEngine([capture.registration], undefined, geometry, [
    "drawline(-2, 1, 2, 1)",
    "drawrect(-1, 4, 3, 7)",
    "setpixel(32, 0)",
    "fillrect(31, 8, 33, 10)",
    "drawcircle(1, 14, 2)",
    "fillcircle(1, 20, 2)",
    "threadSleep(getThreadId(), 60)",
  ].join("\n"));
  engine.advance(1, []);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  deepEqual(state.ui.authorMarginCommands.map((command) => command.kind), ["line", "rect", "line", "rect", "line", "rect"]);
  const stateHashBeforeDraw = hashGameState(state);
  const drawList = engine.drawList();
  equal(drawList.marginCommands.length, 1, "the authored vector run lowers to one bounded AD-3 pixel blit");
  if (drawList.marginCommands[0]?.kind !== "blit") throw new Error("expected lowered margin snapshot");
  deepEqual(engine.drawList(), drawList, "repeating a draw-list build produces the same synthetic source identity and pixels");
  equal(hashGameState(state), stateHashBeforeDraw, "render-only lowering does not mutate hashed simulation state");
  const surfaces = new Map() as RasterSurfaces;
  surfaces.get = (surface: SurfaceId, revision: number = 0) => engine.surfacePixels(surface, revision) ?? undefined;
  const rendered = rasterizePresentation(drawList, geometry, new Map(), surfaces);
  equal(rendered.error, null);
  const alphaAt = (x: number, y: number): number => rendered.rgba[(y * rendered.width + x) * 4 + 3]!;
  equal(alphaAt(0, 1), 255); // drawline, logical x=-1
  equal(alphaAt(0, 5), 255); // drawrect, logical x=-1
  equal(alphaAt(33, 0), 255); // setpixel, logical x=32
  equal(alphaAt(33, 9), 255); // fillrect, logical x=32
  equal(alphaAt(0, 14), 255); // drawcircle, logical x=-1
  equal(alphaAt(0, 13), 0, "radius-2 outline does not extend diagonally into the margin");
  equal(alphaAt(1, 13), 255, "the screen circle's same row is unchanged");
  equal(alphaAt(0, 19), 0, "radius-2 fill does not create a margin seam");
  equal(alphaAt(0, 20), 255); // fillcircle, logical x=-1
  const source = drawList.marginCommands[0];
  if (source?.kind !== "blit" || !("surface" in source.source)) throw new Error("expected generated surface reference");
  const resizedGeometry = { ...geometry, content: { width: 35, height: 32 } };
  engine.advance(1, [{ tick: 1, event: { kind: "host.display", geometry: resizedGeometry } }]);
  const resizedList = engine.drawList();
  const resizedSource = resizedList.marginCommands[0];
  if (resizedSource?.kind !== "blit" || !("surface" in resizedSource.source)) throw new Error("expected resized generated surface reference");
  equal(resizedSource.source.surface, source.source.surface);
  equal(resizedSource.source.rev === source.source.rev, false, "different generated pixels receive a different revision");
  equal(engine.surfacePixels(source.source.surface, source.source.rev), null, "an asynchronous lookup of the stale list fails closed, never resolves to newer pixels");
  if (engine.surfacePixels(resizedSource.source.surface, resizedSource.source.rev) === null) throw new Error("expected current generated pixels");
});

test("screen-target canvas blits retain source pixels for Plane 3 rendering and respect safe-area clipping", () => {
  const geometry = {
    content: { width: 36, height: 32 },
    game: { x: 2, y: 0, width: 32, height: 32 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const engine = loadedEngine([], undefined, geometry, [
    "createcanvas(2, 1, c)",
    "setpixel(0, 0, c)",
    "setpixel(1, 0, c)",
    "drawcanvas(c, -1, 0)",
    "drawcanvastransparent(c, -1, 2, 255, 255, 255)",
    "canvasdrawpart(c, -1, 4, 1, 0, 1, 1)",
    "clear(c)",
    "killcanvas(c)",
    "threadSleep(getThreadId(), 60)",
  ].join("\n"));
  engine.advance(1, []);
  const drawList = engine.drawList();
  equal(drawList.marginCommands.length, 1);
  const lowered = drawList.marginCommands[0];
  if (lowered?.kind !== "blit" || !("surface" in lowered.source)) throw new Error("expected a lowered surface snapshot blit");
  const surfaces = new Map() as RasterSurfaces;
  surfaces.get = (surface: SurfaceId, revision: number = 0) => engine.surfacePixels(surface, revision) ?? undefined;
  const raster = rasterizePresentation(drawList, geometry, new Map(), surfaces);
  equal(raster.error, null);
  const alphaAt = (x: number, y: number): number => raster.rgba[(y * raster.width + x) * 4 + 3]!;
  equal(alphaAt(1, 0), 255, "the blit crossing the left edge is visible in the margin");
  equal(alphaAt(2, 0), 255, "the in-game part is rendered by the legacy screen layer");
  equal(alphaAt(1, 4), 255, "a source-cropped canvas blit is visible in the margin");

  const interior = loadedEngine([], undefined, geometry, [
    "createcanvas(2, 1, c)",
    "setpixel(0, 0, c)",
    "drawcanvas(c, 0, 0)",
    "threadSleep(getThreadId(), 60)",
  ].join("\n"));
  interior.advance(1, []);
  equal(interior.drawList().marginCommands.length, 0);

  const clippedGeometry = { ...geometry, safeArea: { ...geometry.safeArea, left: 2 } };
  const clipped = loadedEngine([], undefined, clippedGeometry, [
    "createcanvas(2, 1, c)",
    "setpixel(0, 0, c)",
    "drawcanvas(c, -1, 0)",
    "threadSleep(getThreadId(), 60)",
  ].join("\n"));
  clipped.advance(1, []);
  const clippedSurfaces = new Map() as RasterSurfaces;
  clippedSurfaces.get = (surface: SurfaceId, revision: number = 0) => clipped.surfacePixels(surface, revision) ?? undefined;
  const clippedRaster = rasterizePresentation(clipped.drawList(), clippedGeometry, new Map(), clippedSurfaces);
  equal(clippedRaster.error, null);
  equal(clippedRaster.rgba[(0 * clippedGeometry.content.width + 1) * 4 + 3], 0, "safe-area clipping suppresses the margin blit");
});
test("refresh requests images referenced only by retained margin blits", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const image = assetKey("bitmaps/retained.bmp");
  const tileBitmap = assetKey("bitmaps/retained.tbm");
  const command: DrawCommand = {
    kind: "blit",
    source: { asset: image, tile: null },
    src: { x: 0, y: 0, w: 1, h: 1 },
    dst: { x: -1, y: 0, w: 1, h: 1 },
    key: null,
    tint: { r: 0, g: 0, b: 0 },
    alpha: 255,
    blend: "normal",
    iso2d: false,
  };
  const registration: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      if (state.time.tick === 0) state.ui.authorMarginCommands.push(command, {
        ...command,
        source: { asset: tileBitmap, tile: 1 },
        dst: { x: -2, y: 0, w: 1, h: 1 },
      });
    },
  };
  const engine = loadedEngine([registration], undefined, undefined, "threadSleep(getThreadId(), 60)");
  const refreshed = engine.advance(1, []);
  if (!refreshed.requests.some((request) => request.kind === "asset" && request.key === image)) throw new Error("retained margin image dependency was not requested");
  if (!refreshed.requests.some((request) => request.kind === "asset" && request.key === tileBitmap)) throw new Error("retained margin tile-bitmap dependency was not requested");
});

test("author surfaces remain live through the next input frame then expire with unfinished builders", () => {
  const capture = captureState();
  const surfaceRegistration: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      if (state.time.tick !== 0) return;
      applyUiEffect(state, "uiBegin", [7, "combat", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Dash", "dash", null, 1, null, null, null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
      applyUiEffect(state, "uiBegin", [7, "unfinished", "menu", 0, 0, 16, 16, 1]);
    },
  };
  const engine = loadedEngine([capture.registration, surfaceRegistration]);
  engine.advance(1, []);
  const published = capture.state();
  if (published === undefined) throw new Error("expected captured game state");
  equal(published.ui.actionSurfaces.length, 1);
  equal(published.ui.surfaceBuilders.length, 0);

  engine.advance(1, [
    { tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } },
    { tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } },
  ]);
  const activated = capture.state();
  if (activated === undefined) throw new Error("expected captured game state");
  equal(activated.ui.surfaceActivated?.index, 0);
  equal(activated.ui.actionSurfaces.length, 0);
  equal(activated.ui.surfaceBuilders.length, 0);

  engine.advance(1, [
    { tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } },
    { tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } },
  ]);
  equal(activated.ui.surfaceActivated, null);
});


test("unknown author actions remain inert with one diagnostic", () => {
  const capture = captureState();
  const program = [
    'uiBegin("combat", "surface", 0, 0, 16, 16)',
    'uiItem("Fire", { id: "fire", action: "game.missing" })',
    'uiItem("Ice", { id: "ice", action: "game.missing" })',
    "uiEnd()",
    "end()",
    "",
  ].join("\n");
  const engine = loadedEngine([capture.registration], undefined, undefined, program);
  const published = engine.advance(1, []);
  equal(published.diagnostics.filter((diagnostic) => diagnostic.code === "input.unknown-action").length, 1);
  engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
  engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  equal(state.input.pendingActions.includes("game.missing"), false);
  equal(state.input.keys.some((key) => key.action === "game.missing"), false);
});

test("invalid author item actions drop the surface with one A11Y refusal", () => {
  const program = [
    'uiBegin("broken", "surface", 0, 0, 16, 16)',
    'uiItem("Broken", { id: "broken", action: "not-an-action" })',
    "uiEnd()",
    "end()",
    "",
  ].join("\n");
  const engine = loadedEngine([], undefined, undefined, program);
  const report = engine.advance(1, []);
  equal(report.diagnostics.filter((diagnostic) => diagnostic.code === "a11y.surface").length, 1);
  equal(engine.accessibilityTree().length, 0);
});

test("Engine touch-control query requires the explicit declaration command", () => {
  const registration: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      if (state.time.tick === 0) {
        applyUiEffect(state, "uiBegin", [7, "title", "menu", 0, 0, 16, 16, 1]);
        applyUiEffect(state, "uiItem", [7, "Play", "play", null, 1, null, null, null, 1]);
        applyUiEffect(state, "uiEnd", [7]);
      } else {
        applyUiEffect(state, "declareCustomTouchControls", []);
      }
    },
  };
  const engine = loadedEngine([registration]);
  equal(engine.customTouchControlsDeclared(), false);
  engine.advance(1, []);
  equal(engine.customTouchControlsDeclared(), false);
  engine.advance(1, []);
  equal(engine.customTouchControlsDeclared(), true);
});

test("pointer preemption query is read-only and follows modal and author UI priority", () => {
  const surfaceRegistration: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      applyUiEffect(state, "uiBegin", [7, "combat", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Author target", "author-target", null, 1, null, null, null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
    },
  };
  const engine = loadedEngine([surfaceRegistration]);
  engine.advance(1, []);
  const before = JSON.stringify({ draw: engine.drawList(), tree: engine.accessibilityTree() });
  equal(engine.runnerControlPointerPreemption(5, 5), "author");
  equal(engine.runnerControlPointerPreemption(17, 17), null);
  equal(JSON.stringify({ draw: engine.drawList(), tree: engine.accessibilityTree() }), before, "preflight does not mutate or hash simulation state");

  const modal = programEngine('msgbox("Modal")\nend()', []);
  modal.advance(1, []);
  equal(modal.runnerControlPointerPreemption(300, 200), 1, "an active modal preempts a fallback target regardless of the point");
});
test("fallback modal actions are claimed only by their captured modal after earlier same-tick key input", () => {
  const engine = programEngine('first = msgbox("Modal A")\nsecond = msgbox("Modal B")\nend()', []);
  engine.advance(1, []);
  equal(engine.runnerControlPointerPreemption(300, 200), 1);
  engine.advance(1, [
    { tick: 1, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } },
    { tick: 1, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: 1 } },
    { tick: 1, event: { kind: "action", action: "confirm", down: false, source: "runner.fallback", modalId: 1 } },
  ]);
  equal(engine.runnerControlPointerPreemption(300, 200), 2);
  engine.advance(1, []);
  equal(engine.runnerControlPointerPreemption(300, 200), 2, "stale A confirmation cannot dismiss B");
});


test("default Enter and Escape claims prevent Get from reading the same key", () => {
  for (const key of ["Enter", "Escape"] as const) {
    const capture = captureState();
    const condition = key === "Enter" ? "if (uiActivated() >= 0) { answer = Get() }" : "if (uiCancelled() == 1) { answer = Get() }";
    const engine = programEngine([
      'uiBegin("title", "menu", 0, 0, 16, 16)',
      'uiItem("Play")',
      'uiEnd()',
      'sleep(1)',
      condition,
      'end()',
    ].join("\n"), [capture.registration]);
    engine.advance(1, []);
    engine.advance(1, [{ tick: 1, event: { kind: "key", name: key, code: key, char: null, down: true } }]);
    const state = capture.state();
    if (state === undefined) throw new Error("expected captured game state");
    const action = key === "Enter" ? "confirm" : "cancel";
    const sequence = state.engine.claims?.[0];
    if (sequence === undefined) throw new Error(`expected ${action} claim sequence`);
    equal(state.engine.claims?.includes(sequence), true, `${key} author claim must consume its key sequence`);
    equal(state.vm.globals.answer, "", `Get must not read the ${key} sequence claimed by the author surface`);
  }
});
test("semantic confirm claims the author surface key once across independent sources", () => {
  const capture = captureState();
  let input: { sequence: number | null; keys: number[]; held: boolean } | undefined;
  const engine = programEngine([
    'uiBegin("title", "menu", 0, 0, 16, 16)', 'uiItem("Play")', "uiEnd()", "sleep(1)",
    "activated = uiActivated()", "after = Get()", "end()",
  ].join("\n"), [capture.registration, { phase: "input", run: (state) => {
    input = { sequence: state.ui.surfaceActivated?.inputSeq ?? null,
      keys: state.input.keys.filter((key) => key.name === "confirm").map((key) => key.seq),
      held: state.input.actions.confirm === true };
  } }]);
  engine.advance(1, []);
  engine.advance(1, [
    { tick: 1, event: { kind: "action", action: "confirm", source: "touch:a", down: true, modalId: null } },
    { tick: 1, event: { kind: "action", action: "confirm", source: "touch:b", down: true, modalId: null } },
    { tick: 1, event: { kind: "action", action: "confirm", source: "touch:a", down: false, modalId: null } },
  ]);
  const state = capture.state();
  if (state === undefined || input === undefined) throw new Error("expected captured input");
  deepEqual(input.keys, [1], "only the aggregate press emits a compatibility key");
  equal(state.vm.globals.activated, 0, "the script observes author activation");
  equal(state.vm.globals.after, "", "Get cannot consume the author-claimed semantic key");
  equal(input.sequence, 1, "the author activation carries that key's sequence");
  equal(input.held, true, "the second source still owns confirm");
  equal(state.engine.claims?.includes(1), true);
  engine.advance(1, [{ tick: 2, event: { kind: "action", action: "confirm", source: "touch:b", down: false, modalId: null } }]);
  equal(state.input.actions.confirm, false, "the last source releases the action");
});

test("gamepad confirm claims its author surface key while another source holds the action", () => {
  const capture = captureState();
  let input: { sequence: number | null; keys: number[]; held: boolean } | undefined;
  const engine = programEngine([
    'uiBegin("title", "menu", 0, 0, 16, 16)', 'uiItem("Play")', "uiEnd()", "sleep(1)",
    "activated = uiActivated()", "after = Get()", "end()",
  ].join("\n"), [capture.registration, { phase: "input", run: (state) => {
    input = { sequence: state.ui.surfaceActivated?.inputSeq ?? null,
      keys: state.input.keys.filter((key) => key.name === "confirm").map((key) => key.seq),
      held: state.input.actions.confirm === true };
  } }]);
  engine.advance(1, []);
  engine.advance(1, [{ tick: 1, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 } }]);
  const state = capture.state();
  if (state === undefined || input === undefined) throw new Error("expected captured input");
  deepEqual(input.keys, [1], "the physical press emits one compatibility key");
  equal(state.vm.globals.after, "", "Get cannot consume the author-claimed gamepad key");
  equal(state.vm.globals.activated, 0, "the script observes author activation");
  equal(input.sequence, 1, "the author activation carries the gamepad key's sequence");
  equal(state.engine.claims?.includes(1), true);
  engine.advance(1, [{ tick: 2, event: { kind: "action", action: "confirm", source: "touch", down: true, modalId: null } }]);
  equal(state.input.actions.confirm, true);
  engine.advance(1, [{ tick: 3, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 } }]);
  equal(state.input.actions.confirm, true, "the semantic source keeps confirm held after pad release");
  equal(state.input.keys.filter((key) => key.name === "confirm").length, 0, "the second source did not emit a new press");
  engine.advance(1, [{ tick: 4, event: { kind: "action", action: "confirm", source: "touch", down: false, modalId: null } }]);
  equal(state.input.actions.confirm, false, "the final source releases confirm");
});

test("an author tap flushed before blur survives until the resumed script reads uiActivated", () => {
  const capture = captureState();
  const engine = programEngine([
    'uiBegin("title", "menu", 0, 0, 16, 16)',
    'uiItem("Play")',
    'uiEnd()',
    'sleep(1)',
    'activated = uiActivated()',
    'end()',
  ].join("\n"), [capture.registration]);
  engine.advance(1, []);
  const blurred = engine.advance(1, [
    { tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } },
    { tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } },
    { tick: 1, event: { kind: "focus", state: "lost" } },
  ]);
  equal(blurred.ticksRun, 0);
  const paused = capture.state();
  if (paused === undefined) throw new Error("expected captured game state");
  equal(paused.ui.surfaceActivated?.index, 0);
  equal(paused.ui.surfaceResultsPending, true, "the paused activation has a persisted lifecycle marker");
  equal(paused.input.pointer.buttons & 1, 0, "blur still releases the pointer hold");

  engine.advance(0, [{ tick: 1, event: { kind: "focus", state: "gained" } }]);
  engine.advance(1, []);
  const resumed = capture.state();
  if (resumed === undefined) throw new Error("expected resumed game state");
  equal(resumed.vm.globals.activated, 0, "the resumed script reads the pre-blur activation");
  equal(resumed.ui.surfaceActivated, null, "uiActivated consumes the one-shot result");
});
test("a pre-blur author cancellation survives until the resumed script reads uiCancelled", () => {
  const capture = captureState();
  const engine = programEngine([
    'uiBegin("title", "menu", 0, 0, 16, 16)',
    'uiItem("Play")',
    'uiEnd()',
    'sleep(1)',
    'if (uiCancelled() == 1) { cancelled = 1 } else { cancelled = 0 }',
    'end()',
  ].join("\n"), [capture.registration]);
  engine.advance(1, []);
  const blurred = engine.advance(1, [
    { tick: 1, event: { kind: "key", name: "ESCAPE", code: "Escape", char: null, down: true } },
    { tick: 1, event: { kind: "focus", state: "lost" } },
  ]);
  equal(blurred.ticksRun, 0);
  const paused = capture.state();
  if (paused === undefined) throw new Error("expected captured game state");
  equal(paused.ui.surfaceCancelled, true);

  engine.advance(0, [{ tick: 1, event: { kind: "focus", state: "gained" } }]);
  engine.advance(1, []);
  const resumed = capture.state();
  if (resumed === undefined) throw new Error("expected resumed game state");
  equal(resumed.vm.globals.cancelled, 1, "the resumed script reads the pre-blur cancellation");
  equal(resumed.ui.surfaceCancelled, false, "uiCancelled consumes the one-shot result");
});
test("debugger stepping and uninterrupted resume consume a pre-blur activation at the same thread boundary", () => {
  const source = [
    'uiBegin("title", "menu", 0, 0, 16, 16)',
    'uiItem("Play")',
    'uiEnd()',
    'sleep(1)',
    'activated = uiActivated()',
    'end()',
  ].join("\n");
  const baselineCapture = captureState();
  const baseline = programEngine(source, [baselineCapture.registration]);
  const debugCapture = captureState();
  const debugged = programEngine(source, [debugCapture.registration]);
  for (const engine of [baseline, debugged]) {
    engine.advance(1, []);
    engine.advance(1, [
      { tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } },
      { tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } },
      { tick: 1, event: { kind: "focus", state: "lost" } },
    ]);
    engine.advance(0, [{ tick: 1, event: { kind: "focus", state: "gained" } }]);
  }
  const uninterrupted = baseline.advance(1, []);
  debugged.setBreakpoints([{ file: "<inline>", line: 5 }]);
  const stopped = debugged.advance(1, []);
  equal(stopped.ticksRun, 0);
  equal(stopped.paused?.line, 5);
  const stoppedState = debugCapture.state();
  if (stoppedState === undefined) throw new Error("expected captured debugger state");
  equal(stoppedState.ui.surfaceResultsPending, true, "a breakpoint does not expire the pending result");
  const stepped = debugged.advance(0, [], undefined, "step");
  equal(stepped.paused?.thread, 1);
  const afterStep = debugCapture.state();
  if (afterStep === undefined) throw new Error("expected captured stepped state");
  equal(afterStep.ui.surfaceResultsPending, true, "a partial step does not cross the thread-pass boundary");
  equal(afterStep.vm.globals.activated, 0, "the stepped continuation consumes the activation");
  const resumed = debugged.advance(0, [], undefined, "continue");
  equal(resumed.paused, null);
  const completed = debugCapture.state();
  if (completed === undefined) throw new Error("expected completed debugger state");
  equal(completed.ui.surfaceResultsPending, false, "the marker clears only when the open thread pass completes");
  equal(resumed.stateHash, uninterrupted.stateHash, "debugger and uninterrupted execution produce the same final state");
});



test("author surface release dispatches its registered action once without click leakage", () => {
  const capture = captureState();
  const surfaceRegistration: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      applyUiEffect(state, "uiBegin", [7, "combat", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Dash", "dash", null, 1, null, "game.dash", null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
    },
  };
  const engine = loadedEngine([capture.registration, surfaceRegistration]);
  equal(engine.registerGameAction({
    name: "game.dash",
    label: "Dash",
    icon: null,
    group: null,
    controls: [],
    locked: false,
    hidden: false,
  }), true);
  engine.advance(1, []);
  engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
  engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  equal(state.ui.surfaceActivated?.index, 0);
  equal(state.ui.surfaceActivated?.inputSeq, state.input.keys.find((key) => key.action === "game.dash")?.seq);
  equal(state.input.pendingActions.filter((action) => action === "game.dash").length, 1);
  equal(state.input.keys.filter((key) => key.action === "game.dash").length, 1);
  equal(state.input.pendingClicks.length, 0);
  equal(state.input.pendingPointerUps.length, 0);
});
test("author pointer cancellation stays sticky and reset or modal release cannot strand movement suppression", () => {
  for (const interruption of ["drag", "reset", "modal"] as const) {
    const capture = captureState();
    const surfaceRegistration: EnginePhaseRegistration = {
      phase: "animation",
      run: (state) => {
        if (state.time.tick === 0 || interruption === "drag") {
          applyUiEffect(state, "uiBegin", [7, "combat", "surface", 0, 0, 16, 16, 1]);
          applyUiEffect(state, "uiItem", [7, "Dash", "dash", null, 1, null, "game.dash", null, 1]);
          applyUiEffect(state, "uiEnd", [7]);
        } else if (state.time.tick === 1 && interruption === "reset") {
          resetUiForProgramStart(state.ui, () => {});
        } else if (state.time.tick === 1 && interruption === "modal") {
          state.ui.modal = { modalId: state.ui.nextModalId++, kind: "msgbox", text: "Notice", title: "", style: 0, textColor: { r: 255, g: 255, b: 255 }, background: { r: 0, g: 0, b: 0 }, graphic: "", selected: 0, result: null };
        } else if (state.time.tick === 2 && interruption === "modal") {
          state.ui.modal = null;
        }
      },
    };
    const engine = loadedEngine(
      [capture.registration, surfaceRegistration],
      { buttons: [{ id: "confirm", x: 20, y: 20, w: 8, h: 8, action: "confirm", enabled: true }] },
    );
    engine.advance(1, []);
    engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
    if (interruption === "drag") {
      engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: 25, y: 25, buttons: 1 } }]);
      const left = capture.state();
      if (left === undefined) throw new Error("expected captured drag-out state");
      equal(left.ui.surfacePointerClaim?.cancelled, true);
      engine.advance(1, [{ tick: 3, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
      const returned = capture.state();
      if (returned === undefined) throw new Error("expected captured drag-return state");
      equal(returned.ui.surfacePointerClaim?.cancelled, true);
      engine.advance(1, [{ tick: 4, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
    } else {
      engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
    }
    const releaseTick = interruption === "drag" ? 4 : 2;
    const released = capture.state();
    if (released === undefined) throw new Error("expected captured game state");
    equal(released.input.pointerMovementSuppressed, false, `${interruption} release restores movement`);
    equal(released.ui.surfacePointerClaim, null, `${interruption} release clears the held claim`);
    equal(released.ui.surfaceActivated, null, `${interruption} cannot activate the interrupted surface`);
    engine.advance(1, [{ tick: releaseTick + 1, event: { kind: "pointer", x: 21, y: 21, buttons: 1 } }]);
    engine.advance(1, [{ tick: releaseTick + 2, event: { kind: "pointer", x: 21, y: 21, buttons: 0 } }]);
    const clicked = capture.state();
    if (clicked === undefined) throw new Error("expected captured gameplay click");
    equal(clicked.input.keys.some((entry) => entry.action === "slot:confirm"), true, `${interruption} does not block the next gameplay click`);
  }
});


test("overlapping author surfaces hit the topmost published item", () => {
  const capture = captureState();
  const surfaces: EnginePhaseRegistration = {
    phase: "animation",
    run: (state) => {
      applyUiEffect(state, "uiBegin", [7, "lower", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [7, "Lower", "lower-item", null, 1, null, "game.lower", null, 1]);
      applyUiEffect(state, "uiEnd", [7]);
      applyUiEffect(state, "uiBegin", [8, "upper", "surface", 0, 0, 16, 16, 1]);
      applyUiEffect(state, "uiItem", [8, "Upper", "upper-item", null, 1, null, "game.upper", null, 1]);
      applyUiEffect(state, "uiEnd", [8]);
    },
  };
  const engine = loadedEngine([capture.registration, surfaces]);
  for (const name of ["game.lower", "game.upper"]) {
    equal(engine.registerGameAction({
      name,
      label: name,
      icon: null,
      group: null,
      controls: [],
      locked: false,
      hidden: false,
    }), true);
  }
  engine.advance(1, []);
  engine.advance(1, [{ tick: 1, event: { kind: "pointer", x: 5, y: 5, buttons: 1 } }]);
  engine.advance(1, [{ tick: 2, event: { kind: "pointer", x: 5, y: 5, buttons: 0 } }]);
  const state = capture.state();
  if (state === undefined) throw new Error("expected captured game state");
  equal(state.ui.surfaceActivated?.owner, 8);
  deepEqual(state.input.pendingActions.filter((action) => action.startsWith("game.")), ["game.upper"]);
});

test("createEngine routes actor alias writes through package behaviour hooks", () => {
  const plugin: ResolvedPlugin = {
    namespace: "engine-actors",
    definition: {
      id: "engine-actors",
      version: "1.0.0",
      commands: [],
      behaviourStartup(register) {
        register("engine-actors.hero", { statsChanged: () => ({ dp: 33 }) });
      },
    },
  };
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  let seen: GameState["actors"]["actors"][number] | undefined;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "HP! = 5\n",
    plugins: [plugin],
    phaseRegistrations: [
      {
        phase: "input",
        run: (state) => {
          if (state.time.tick !== 0) return;
          const actor = addActor(state.actors, {
            kind: "party",
            source: "hero.tem",
            behaviour: "engine-actors.hero",
            stats: { hp: 10, maxHp: 10, dp: 1 },
          });
          state.party.members = [actor.id];
          state.party.selected = actor.id;
        },
      },
      {
        phase: "movement",
        run: (state) => { seen = state.actors.actors[0]; },
      },
    ],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected authored board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encoded.value } }]);
  engine.advance(3, []);
  equal(seen?.stats.hp, 5);
  equal(seen?.stats.dp, 33);
});

test("createEngine preserves manifest package behaviours and actor operations across reset", () => {
  let registrations = 0;
  let startupProgramRuns = 0;
  let retainedGuardFailures = 0;
  let retainedView: { readonly packageStartup?: boolean; readonly rng: { readonly nextUint32: () => number } } | undefined;
  const plugin: PluginDefinition = {
    id: "test-reset-package",
    version: "1.0.0",
    commands: [{
      name: "seedactor",
      aliases: [],
      params: [],
      call: (view) => {
        if (view.state !== undefined) {
          const actor = addActor(view.state.actors, {
            kind: "party",
            source: "hero.tem",
            behaviour: "test-reset-package.hero",
            stats: { hp: 10, maxHp: 10, dp: 1 },
          });
          view.state.party.members = [actor.id];
          view.state.party.selected = actor.id;
        }
        return { value: null };
      },
    }, {
      name: "countstartup",
      aliases: [],
      params: [],
      call: (view) => {
        if (retainedView === undefined) retainedView = view;
        else if (view.packageStartup) {
          try { retainedView.rng.nextUint32(); } catch { retainedGuardFailures += 1; }
        }
        startupProgramRuns += 1;
        return { value: null };
      },
    }],
    behaviourStartup(register) {
      registrations += 1;
      register("test-reset-package.hero", { statsChanged: () => ({ dp: 42 }) });
    },
  };
  const resolvedPlugin: ResolvedPlugin = {
    definition: plugin,
    startup: { kind: "inline", text: "countstartup()\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  };
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    projectPath: "",
    plugins: [],
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePluginsExtension: true,
    packagePlugins: ["test-reset-package"],
  });
  if (!main.ok) throw new Error(main.error.message);
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map([
    ["main.gam", main.value],
    ["prg/start.prg", new TextEncoder().encode("seedactor()\nHP! = 5\nend()\n")],
    ["boards/start.brd", board.value],
    ["chrs/hero.tem", heroBytes()],
  ]);
  const table = ENGINE_PLUGIN_TABLE as Record<string, PluginDefinition>;
  const previous = table["test-reset-package"];
  table["test-reset-package"] = plugin;
  try {
    let resetRequested = false;
    let latestActor: GameState["actors"]["actors"][number] | undefined;
    const engine = createEngine({
      seed: 7,
      assetIndex: createAssetIndex([...files.keys()]),
      assetRoot: PACKAGE_ROOT,
      mainFile: "main.gam",
      gameIdentity: "engine-test",
      plugins: [resolvedPlugin],
      startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
      width: 32,
      height: 32,
      maxTicks: 8,
      phaseRegistrations: [
        {
          phase: "events",
          run: (state, postEffect) => {
            if (state.time.tick === 2 && !resetRequested) {
              resetRequested = true;
              postEffect?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
            }
          },
        },
        { phase: "movement", run: (state) => { latestActor = state.actors.actors.find((actor) => actor.behaviour === "test-reset-package.hero"); } },
      ],
    });
    let report = engine.advance(0, []);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const replies = report.requests.flatMap((request) => {
        if (request.kind !== "asset") return [];
        return [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }];
      });
      report = engine.advance(report.loading ? 0 : 1, replies);
    }
    equal(resetRequested, true);
    equal(registrations, 2);
    equal(startupProgramRuns, 2);
    equal(retainedGuardFailures, 1);
    equal(latestActor?.stats.hp, 5);
    equal(latestActor?.stats.dp, 42);
  } finally {
    if (previous === undefined) delete table["test-reset-package"];
    else table["test-reset-package"] = previous;
  }
});

test("createEngine runs inline-program package startup exactly once", () => {
  let registrations = 0;
  const plugin: PluginDefinition = {
    id: "test-inline-package",
    version: "1.0.0",
    commands: [],
    behaviourStartup(register) {
      registrations += 1;
      register("test-inline-package.hero", { statsChanged: () => ({ dp: 1 }) });
    },
  };
  createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "end()\n",
    plugins: [{ definition: plugin }],
  });
  equal(registrations, 1);
});
test("createEngine installs one native listener for inline package boot", () => {
  let listenerCalls = 0;
  const plugin: PluginDefinition = {
    id: "test-inline-listener-package",
    version: "1.0.0",
    commands: [{ name: "onping", aliases: [], params: [{ name: "event", optional: false, byRef: false, variadic: false }], call: () => { listenerCalls += 1; return { value: null }; } }],
    listeners: [{ emitter: "game", type: "ping", command: "onping" }],
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: 'game.emit("ping")\nend()\n',
    plugins: [{ definition: plugin }],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected authored board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: boardBytes(createEmptyBoard()) } }]);
  engine.advance(2, []);
  equal(listenerCalls, 1);
});
test("createEngine does not start inline main program after package startup failure", () => {
  let mainRuns = 0;
  const plugin: ResolvedPlugin = {
    definition: {
      id: "test-inline-failure-package",
      version: "1.0.0",
      commands: [{
        name: "markmain",
        aliases: [],
        params: [],
        call: () => {
          mainRuns += 1;
          return { value: null };
        },
      }],
    },
    startup: { kind: "inline", text: "sleep(1)\n", ir: IR_VERSION, dialect: "tk3" },
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "markmain()\nend()\n",
    plugins: [plugin],
  });
  engine.advance(0, []);
  equal(mainRuns, 0);
});


test("engine runs the fixed phase order, registers audio after animation, and pauses on focus loss", () => {
  deepEqual(ENGINE_PHASES, ["input", "waits", "threads", "events", "movement", "edges", "triggers", "animation", "audio", "time"]);
  const phases: string[] = [];
  const engine = loadedEngine([
    { phase: "movement", run: (state) => phases.push(`movement:${state.time.tick}`) },
    { phase: "events", run: (state) => phases.push(`events:${state.time.tick}`) },
    { phase: "audio", run: (state) => phases.push(`audio:${state.time.tick}`) },
  ]);
  const paused = engine.advance(2, [{ tick: 0, event: { kind: "focus", state: "lost" } }]);
  equal(paused.ticksRun, 0);
  const resumed = engine.advance(60, [{ tick: 0, event: { kind: "focus", state: "gained" } }], 2);
  equal(resumed.ticksRun, 2);
  equal(resumed.tickAfter, 2);
  deepEqual(phases, ["events:0", "movement:0", "audio:0", "events:1", "movement:1", "audio:1"]);
});

test("engine displays no-enemies handoffs, runs custom starts as a program, and rejects absent stock_battle", () => {
  let triggerCount = 0;
  const observed: { state: GameState | null } = { state: null };
  const uiEffects: EffectRecord[] = [];
  const board = createEmptyBoard();
  const encodedBoard = writeBoard(board);
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    phaseRegistrations: [{
      phase: "triggers",
      run: (state, post) => {
        observed.state = state;
        if (post === undefined || triggerCount >= 3) return;
        if (state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished")) return;
        const noEnemies = triggerCount === 0;
        const randomEncounter = triggerCount === 1;
        triggerCount += 1;
        const common = {
          trigger: "random",
          board: { key: "boards/test.brd", skill: 1, background: "night.bkg" },
          actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 0, y: 0, layer: 1 },
        };
        const payload = noEnemies
          ? { ...common, message: "No enemies of skill level 1 found." }
          : randomEncounter
            ? {
                ...common,
                fighters: [
                  { party: "player", id: "player:0", index: 0, source: "hero.tem", skill: null },
                  { party: "enemy", id: "enemy:0", index: 0, source: "slime.ene", skill: 1 },
                ],
              }
            : { ...common, program: "custom.prg" };
        const name = noEnemies ? "battle.noEnemies" : randomEncounter ? "battle.randomEncounter" : "battle.customFight";
        post("battle", {
          thread: 0,
          name,
          kind: "state-write",
          args: [payload],
          out: {},
          result: null,
          patch: null,
          wait: null,
          request: null,
        });
      },
    }],
    effectAppliers: [{ section: "ui", applier: (effect) => uiEffects.push(effect) }],
  });
  const initial = engine.advance(0, []);
  const request = initial.requests[0];
  if (request?.kind !== "asset") throw new Error("expected initial board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encodedBoard.value } }]);
  equal(loaded.loading, false);

  engine.advance(1, []);
  equal(uiEffects[0]?.name, "mwin");
  equal(uiEffects[0]?.args[0], "No enemies of skill level 1 found.");
  for (let i = 0; i < 5 && !observed.state?.vm.threads.some((thread) => thread.wait?.kind === "input.key"); i += 1) engine.advance(1, []);
  equal(observed.state?.vm.threads.some((thread) => thread.wait?.kind === "input.key"), true, "engine message is waiting for dismissal");
  engine.advance(1, []); // Let the wait capture the input sequence before the key is pressed.
  const tick = observed.state?.time.tick;
  if (tick === undefined) throw new Error("engine did not advance");
  const reports = [engine.advance(1, [{ tick, event: { kind: "key", name: "Z", code: "KeyZ", char: "z", down: true } }])];
  for (let i = 0; i < 4; i += 1) reports.push(engine.advance(1, []));
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  equal(diagnostics.some((diagnostic) => diagnostic.code === "battle.package-missing"), true);
  equal(diagnostics.some((diagnostic) => diagnostic.code === "program.missing"), true, "a custom request whose program is not in the asset index reports program.missing");
  equal(observed.state?.battle, null);
});

function programEngine(program: string, registrations: NonNullable<Parameters<typeof createEngine>[0]["phaseRegistrations"]>) {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program,
    phaseRegistrations: registrations,
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  return engine;
}

test("the events phase delivers an emit made earlier in the tick; an emit made by a later phase waits for the next tick (EMIT-3, EMIT-14)", () => {
  const seen: string[] = [];
  const engine = programEngine(
    'log = ""\nh = {}\nh.on("x", (e) => { log = log + "x" })\nh.on("late", (e) => { log = log + "L" })\nh.emit("x")\n',
    [
      {
        phase: "movement",
        run: (state) => {
          if (state.time.tick === 0) {
            const emitter = state.vm.globals.h;
            if (typeof emitter !== "object" || emitter === null || !("kind" in emitter) || emitter.kind !== "object") {
              throw new Error("expected h to be an emitter object");
            }
            applyEmitterOp(state.vm, state.events, "emit", emitter, ["late"], null);
          }
        },
      },
      { phase: "audio", run: (state) => seen.push(`${state.time.tick}:${String(state.vm.globals.log)}`) },
    ],
  );
  const report = engine.advance(3, []);
  equal(report.diagnostics.length, 0);
  deepEqual(seen, ["0:x", "1:xL", "2:xL"]);
});

test("the events section is part of the state hash and a mid-dispatch run replays to the same hash", () => {
  const program = 'h = {}\nh.on("x", (e) => { for (i = 0; i < 400; i = i + 1) { n = i } })\nh.emit("x")\nh.emit("x")\n';
  const straight = programEngine(program, []);
  const split = programEngine(program, []);
  const final = straight.advance(6, []);
  for (let tick = 0; tick < 6; tick += 1) split.advance(1, []);
  equal(split.advance(0, []).stateHash, final.stateHash);
});

test("batching the same stamped input log produces the same state hash", () => {
  const one = loadedEngine();
  const batched = loadedEngine();
  const inputs = [
    { tick: 0, event: { kind: "key" as const, name: "A", code: "KeyA", char: "a", down: true } },
    { tick: 12, event: { kind: "pointer" as const, x: 4, y: 5, buttons: 1 } },
    { tick: 30, event: { kind: "key" as const, name: "A", code: "KeyA", char: "a", down: false } },
  ];
  for (let tick = 0; tick < 60; tick += 1) one.advance(1, inputs.filter((input) => input.tick === tick));
  const final = batched.advance(60, inputs);
  equal(final.ticksRun, 60);
  equal(final.stateHash, one.advance(0, []).stateHash);
});

test("an authored RPGCode program executes through the engine VM", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "x = 1\nsleep(1)\nend()\n",
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  const started = engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  equal(started.ticksRun, 1);
  equal(started.diagnostics.length, 0);
  const resumed = engine.advance(1, []);
  equal(resumed.ticksRun, 1);
  equal(resumed.diagnostics.length, 0);
});

/** The hook that makes the engine materialise every surface edit eagerly (batching is off with an effect applier). */
const EAGER = { effectAppliers: [{ section: "surfaces" as const, applier: () => {} }] };

/** The engine options these tests vary; the rest is fixed by each helper. */
type EngineExtras = {
  readonly plugins?: readonly ResolvedPlugin[];
  readonly packageCatalogue?: readonly PackageCatalogueEntry[];
  readonly phaseRegistrations?: readonly EnginePhaseRegistration[];
  readonly effectAppliers?: typeof EAGER.effectAppliers;
};

/**
 * Counts how many times the engine assigns a new snapshot to the screen surface's `bitmap` during the
 * threads phase of each tick. Eager drawing assigns one per edit; a batch assigns one per materialisation.
 * The accessor is plain data again in the events phase, and inside `plain` for code that hashes the state.
 */
function screenSnapshotWrites() {
  let writes = 0;
  let tracked: GameState["surfaces"]["entries"][string] | undefined;
  let held: GameState["surfaces"]["entries"][string]["bitmap"] | undefined;
  const states: GameState[] = [];
  const track = (): void => {
    if (tracked === undefined || held === undefined) return;
    Object.defineProperty(tracked, "bitmap", { configurable: true, enumerable: true, get: () => held, set: (next) => { writes += 1; held = next; } });
  };
  const untrack = (): void => {
    if (tracked === undefined || held === undefined) return;
    Object.defineProperty(tracked, "bitmap", { value: held, writable: true, enumerable: true, configurable: true });
  };
  const registrations: EnginePhaseRegistration[] = [
    {
      phase: "input",
      run: (state) => {
        // A script that draws to the screen draws on the script-screen layer; that is the surface whose batching
        // these tests count (surface 0 is the derived frame).
        tracked = state.surfaces.entries[String(ensureScriptScreen(state.surfaces))]!;
        held = tracked.bitmap;
        track();
      },
    },
    {
      phase: "events",
      run: (state) => {
        untrack();
        states.push(state);
      },
    },
  ];
  const plain = <T>(read: () => T): T => {
    untrack();
    try {
      return read();
    } finally {
      track();
    }
  };
  return { registrations, writes: () => writes, states, plain };
}

/** Sixty primitives on the screen and a canvas, plus reads, self-blits and an infinite edge. */
function heavyDrawingProgram(): { program: string; screenEdits: number } {
  const lines = ["createcanvas(16, 16, c)"];
  let screenEdits = 0;
  for (let i = 0; i < 60; i += 1) {
    switch (i % 6) {
      case 0: lines.push(`fillrect(${i % 16}, ${i % 16}, 15, 15)`); screenEdits += 1; break;
      case 1: lines.push(`drawline(0, ${i % 16}, 15, ${15 - (i % 16)})`); screenEdits += 1; break;
      case 2: lines.push(`fillcircle(8, 8, ${i % 7})`); screenEdits += 1; break;
      case 3: lines.push(`setpixel(${i % 16}, 3)`); screenEdits += 1; break;
      case 4: lines.push("drawrect(1, 1, 14, 14, c)"); break;
      default: lines.push(`fillrect(${i % 5}, 2, 1/0, ${3 + (i % 4)}, c)`); break;
    }
    if (i === 30) lines.push("getpixel(3, 3, gr, gg, gb)", "getpixel(2, 3, gr, gg, gb, c)");
  }
  lines.push("drawcanvas(c, 1, 1, c)", "drawcanvas(c, -2, 0, c)", "canvasdrawpart(c, 0, 0, 2, 2, 9, 9, c)", "drawcanvas(c, 0, 0)", "end()");
  screenEdits += 1;
  return { program: `${lines.join("\n")}\n`, screenEdits };
}

function bootAndAdvance(extra: EngineExtras, program: string, ticks = 1) {
  const engine = createEngine({
    seed: 7, assetIndex: createAssetIndex(["Boards/test.brd"]), assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd", width: 16, height: 16, maxTicks: ticks, program, ...extra,
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board request");
  const report = engine.advance(ticks, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: boardBytes(createEmptyBoard()) } }]);
  equal(report.diagnostics.length, 0, JSON.stringify(report.diagnostics));
  equal(report.ticksRun, ticks);
  return { engine, report };
}

/** After the threads phase every snapshot must be exactly the canonical encoding of the pixels a reader sees. */
function assertStateSnapshotsCanonical(state: GameState): void {
  for (const entry of Object.values(state.surfaces.entries)) {
    const pixels = readSurfacePixels(state.surfaces, entry.id, entry.rev);
    if (pixels === null) throw new Error(`expected pixels for surface ${entry.id}`);
    equal(entry.bitmap.b64, encodeSurfaceBytes(pixels.rgba), `surface ${entry.id}: b64 is stale`);
    deepEqual(decodeSurfaceBytes(entry.bitmap.b64), pixels.rgba);
  }
}

test("a heavy tick of script drawing materialises one snapshot, matches the eager engine and leaves canonical state", () => {
  const { program, screenEdits } = heavyDrawingProgram();
  const batched = screenSnapshotWrites();
  const eager = screenSnapshotWrites();
  const withBatching = bootAndAdvance({ phaseRegistrations: batched.registrations }, program);
  const withoutBatching = bootAndAdvance({ ...EAGER, phaseRegistrations: eager.registrations }, program);

  // The behavioural proof that batching engaged: 61 screen edits cost one snapshot write, not 61.
  equal(eager.writes(), screenEdits);
  equal(batched.writes(), 1);

  equal(withBatching.report.stateHash, withoutBatching.report.stateHash);
  const [state] = batched.states;
  const [eagerState] = eager.states;
  if (state === undefined || eagerState === undefined) throw new Error("expected the events phase to capture state");
  assertStateSnapshotsCanonical(state);
  assertStateSnapshotsCanonical(eagerState);
  // The presented screen entry is a derived cache: its revision follows how often the frame was rebuilt, so it is
  // compared separately. Every other surface must match byte for byte.
  equal(JSON.stringify(state.surfaces.entries["0"]?.bitmap), JSON.stringify(eagerState.surfaces.entries["0"]?.bitmap));
  const others = (surfaces: GameState["surfaces"]) => JSON.stringify({ ...surfaces, entries: Object.fromEntries(Object.entries(surfaces.entries).filter(([id]) => id !== "0")) });
  equal(others(state.surfaces), others(eagerState.surfaces));
  equal(state.surfaces.entries["1"]?.rev, eagerState.surfaces.entries["1"]?.rev);
  deepEqual(withBatching.engine.surfacePixels(1 as SurfaceId, state.surfaces.entries["1"]!.rev)?.rgba, withoutBatching.engine.surfacePixels(1 as SurfaceId, eagerState.surfaces.entries["1"]!.rev)?.rgba);
});

/** One observation a package made of the state tree from inside a running thread. */
type Observation = {
  readonly label: string;
  readonly hash: string;
  readonly surfaces: readonly { readonly id: number; readonly rev: number; readonly b64: string; readonly pixels: string }[];
};

function observingPackage(log: Observation[], plain: <T>(read: () => T) => T): ResolvedPlugin {
  const observe = (view: CommandView, label: string): void => {
    const state = view.state;
    if (state === undefined) throw new Error("expected command state");
    log.push({
      label,
      hash: plain(() => hashGameState(state)),
      surfaces: Object.values(state.surfaces.entries).map((entry) => ({
        id: entry.id, rev: entry.rev, b64: entry.bitmap.b64,
        pixels: encodeSurfaceBytes(readSurfacePixels(state.surfaces, entry.id, entry.rev)!.rgba),
      })),
    });
  };
  const coordinates = [
    { name: "x", optional: false, byRef: false, variadic: false },
    { name: "y", optional: false, byRef: false, variadic: false },
    { name: "canvas", optional: true, byRef: false, variadic: false },
  ];
  return {
    definition: {
      id: "observing-package",
      version: "1.0.0",
      commands: [
        { name: "peek", aliases: [], params: [], call: (view) => { observe(view, "peek"); return { value: null }; } },
        // A wrapper over the built-in: it reads the state right after the layer below has drawn.
        { name: "setpixel", aliases: [], params: coordinates, call: (view, args, next) => { const result = next(view, args, next); observe(view, "after setpixel"); return result; } },
        { name: "onping", aliases: [], params: [{ name: "event", optional: false, byRef: false, variadic: false }], call: (view) => { observe(view, "listener"); return { value: null }; } },
      ],
      listeners: [{ emitter: "game", type: "ping", command: "onping" }],
    },
  };
}

test("package code that reads the state mid-thread sees exactly what the eager engine shows", () => {
  const lines = ["createcanvas(8, 4, c)", "setpixel(1, 0, c)"];
  let screenEdits = 0;
  for (let i = 0; i < 20; i += 1) { lines.push(`fillrect(${i % 8}, ${i % 4}, 15, 15)`); screenEdits += 1; }
  lines.push("peek()", "setpixel(2, 0, c)", 'game.emit("ping")', "fillrect(1, 1, 5, 2)", "peek()", "end()");
  screenEdits += 1;
  const program = `${lines.join("\n")}\n`;
  const defaults = resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins;

  const batchedLog: Observation[] = [];
  const eagerLog: Observation[] = [];
  const batched = screenSnapshotWrites();
  const eager = screenSnapshotWrites();
  const catalogueEntry: PackageCatalogueEntry = { name: "unused-package", version: "1.0.0", requests: [], definition: { id: "unused-package", version: "1.0.0", commands: [] } };
  bootAndAdvance({ plugins: [...defaults, observingPackage(batchedLog, batched.plain)], packageCatalogue: [catalogueEntry], phaseRegistrations: batched.registrations }, program, 2);
  bootAndAdvance({ ...EAGER, plugins: [...defaults, observingPackage(eagerLog, eager.plain)], phaseRegistrations: eager.registrations }, program, 2);

  // The listener runs in the events phase, after the threads phase has closed its batch.
  deepEqual(batchedLog.map((observation) => observation.label), ["after setpixel", "peek", "after setpixel", "peek", "listener"]);
  deepEqual(batchedLog, eagerLog);
  for (const observation of batchedLog) {
    for (const surface of observation.surfaces) equal(surface.b64, surface.pixels, `${observation.label}: surface ${surface.id} snapshot was stale`);
  }
  // Package code is the only thing that forces a write, once per observation of a dirty screen:
  // two peeks here, instead of one write per edit.
  equal(eager.writes(), screenEdits);
  equal(batched.writes(), 2);
  const [state] = batched.states;
  if (state === undefined) throw new Error("expected the events phase to capture state");
  assertStateSnapshotsCanonical(state);
});

test("batching stays on for a main-file game with a package catalogue and phase registrations", () => {
  const { program, screenEdits } = heavyDrawingProgram();
  const main = writeMainFile({
    ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "", plugins: [],
    startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem",
  });
  if (!main.ok) throw new Error(main.error.message);
  const files = new Map<string, Uint8Array>([
    ["main.gam", main.value],
    ["prg/start.prg", new TextEncoder().encode(program)],
    ["boards/start.brd", boardBytes(createEmptyBoard())],
    ["chrs/hero.tem", heroBytes()],
  ]);
  const catalogueEntry: PackageCatalogueEntry = { name: "unused-package", version: "1.0.0", requests: [], definition: { id: "unused-package", version: "1.0.0", commands: [] } };
  function boot(extra: EngineExtras) {
    const engine = createEngine({
      seed: 7, assetIndex: createAssetIndex([...files.keys()]), assetRoot: PACKAGE_ROOT, mainFile: "main.gam", gameIdentity: "engine-test",
      startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
      width: 16, height: 16, maxTicks: 8, ...extra,
    });
    let report = engine.advance(0, []);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const replies = report.requests.flatMap((request) => request.kind !== "asset" ? [] : [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]);
      report = engine.advance(report.loading ? 0 : 1, replies);
    }
    return report;
  }
  const batched = screenSnapshotWrites();
  const eager = screenSnapshotWrites();
  const withBatching = boot({ packageCatalogue: [catalogueEntry], phaseRegistrations: batched.registrations });
  const withoutBatching = boot({ ...EAGER, packageCatalogue: [catalogueEntry], phaseRegistrations: eager.registrations });
  equal(eager.writes(), screenEdits);
  equal(batched.writes(), 1);
  equal(withBatching.stateHash, withoutBatching.stateHash);
  for (const state of batched.states) assertStateSnapshotsCanonical(state);
});

function breakpointEngine(program: string, seed = 7) {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program,
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  return engine;
}

test("breakpoints stop inside a tick and continue to the uninterrupted hash", () => {
  const uninterrupted = breakpointEngine("x = 1\nx = 2\nend()\n");
  const debugged = breakpointEngine("x = 1\nx = 2\nend()\n");
  const baseline = uninterrupted.advance(1, []);
  debugged.setBreakpoints([{ file: "<inline>", line: 2 }]);
  const stopped = debugged.advance(2, []);
  equal(stopped.ticksRun, 0);
  equal(stopped.tickAfter, 0);
  equal(stopped.paused?.line, 2);
  const resumed = debugged.advance(1, []);
  equal(resumed.ticksRun, 1);
  equal(resumed.paused, null);
  equal(resumed.stateHash, baseline.stateHash);
});

test("breakpoints that never hit preserve every tick hash", () => {
  const plain = breakpointEngine("x = 1\nend()\n", 11);
  const debugged = breakpointEngine("x = 1\nend()\n", 11);
  debugged.setBreakpoints([{ file: "<inline>", line: 99 }]);
  for (let tick = 0; tick < 3; tick += 1) equal(debugged.advance(1, []).stateHash, plain.advance(1, []).stateHash);
});

test("step resume executes one VM instruction and pauses again", () => {
  const engine = breakpointEngine("x = 1\nx = 2\nend()\n", 13);
  engine.setBreakpoints([{ file: "<inline>", line: 2 }]);
  const stopped = engine.advance(1, []);
  equal(stopped.paused?.line, 2);
  const stepped = engine.advance(0, [], undefined, "step");
  equal(stepped.ticksRun, 0);
  equal(stepped.tickAfter, 0);
  equal(stepped.paused?.thread, 1);
});

function authoredBmp(): Uint8Array {
  const bytes = new Uint8Array(62);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  const put32 = (at: number, value: number): void => {
    bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; bytes[at + 2] = (value >>> 16) & 255; bytes[at + 3] = (value >>> 24) & 255;
  };
  const put16 = (at: number, value: number): void => { bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; };
  put32(2, 62); put32(10, 54); put32(14, 40); put32(18, 2); put32(22, 1); put16(26, 1); put16(28, 24); put32(34, 8);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}

function authoredBoard(backgroundImage = ""): Uint8Array {
  const empty = createEmptyBoard();
  const board = { ...empty, properties: { ...empty.properties, backgroundImage } };
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

/** The live state, captured in a phase the engine runs every tick. */
function captureState(): { readonly registration: EnginePhaseRegistration; state(): GameState | undefined } {
  let latest: GameState | undefined;
  return { registration: { phase: "events", run: (state) => { latest = state; } }, state: () => latest };
}

/** The program's own canvas: surface 0 is the presented frame and the section also holds a script-screen layer. */
function programCanvas(state: GameState | undefined) {
  if (state === undefined) throw new Error("expected engine state");
  const canvas = Object.values(state.surfaces.entries).find((entry) => entry.id !== (0 as never) && entry.id !== SCRIPT_SCREEN);
  if (canvas === undefined) throw new Error("expected the program's canvas");
  return canvas;
}

function pixelsAfter(command: string, boardBytes = authoredBoard()): Uint8Array {
  const capture = captureState();
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/pixel.bmp"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 4,
    height: 2,
    maxTicks: 20,
    program: `createcanvas(4, 2, c)\n${command}\nend()\n`,
    phaseRegistrations: [capture.registration],
  });
  let result = engine.advance(0, []);
  for (let step = 0; step < 8; step += 1) {
    const events = result.requests
      .filter((request) => request.kind === "asset")
      .map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: request.key === "boards/test.brd" ? boardBytes : authoredBmp() } }));
    result = engine.advance(1, events);
    if (result.requests.length === 0 && !result.loading) break;
  }
  const canvas = programCanvas(capture.state());
  const surface = engine.surfacePixels(canvas.id, canvas.rev);
  if (surface === null) throw new Error("expected rendered canvas pixels");
  return surface.rgba;
}

test("image graphics command families apply exact decoded pixels", () => {
  deepEqual(pixelsAfter('bitmap("pixel.bmp", c)').slice(0, 8), new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]));
  deepEqual(pixelsAfter('setimage("pixel.bmp", 1, 0, 2, 1, c)').slice(4, 12), new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
  deepEqual(pixelsAfter('setimagetransparent("pixel.bmp", 0, 0, 2, 1, 255, 0, 0, c)').slice(0, 8), new Uint8Array([0, 0, 0, 0, 0, 255, 0, 255]));
  deepEqual(pixelsAfter('setimagetranslucent("pixel.bmp", 0, 0, 2, 1, c)').slice(0, 8), new Uint8Array([128, 0, 0, 255, 0, 128, 0, 255]));
  deepEqual(pixelsAfter('setimageadditive("pixel.bmp", 0, 0, 2, 1, 50, c)').slice(0, 8), new Uint8Array([127, 0, 0, 255, 0, 127, 0, 255]));
});

test("screen-target image blits render crossing/exterior pixels and obey safe-area clipping", () => {
  const texture = { w: 2, h: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) };
  const geometry = {
    content: { width: 4, height: 2 },
    game: { x: 1, y: 0, width: 2, height: 2 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const render = (x: number, safeLeft = 0, effect = "setimage", extraArgs = "", prefix = "") => {
    const board = authoredBoard();
    const engine = createEngine({
      seed: 19,
      assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/pixel.bmp"]),
      assetRoot: PACKAGE_ROOT,
      initialBoard: "test.brd",
      width: 2,
      height: 2,
      maxTicks: 20,
      displayGeometry: { ...geometry, safeArea: { ...geometry.safeArea, left: safeLeft } },
      program: `${prefix}${effect}("pixel.bmp", ${x}, 0, 2, 1${extraArgs})\nthreadSleep(getThreadId(), 60)\n`,
    });
    let result = engine.advance(0, []);
    let imageProvided = false;
    for (let step = 0; step < 8; step += 1) {
      const events = result.requests
        .filter((request) => request.kind === "asset")
        .map((request) => {
          if (request.key === "bitmap/pixel.bmp") imageProvided = true;
          return {
            tick: result.tickAfter,
            event: {
              kind: "asset" as const,
              reqId: request.reqId,
              bytes: request.key === "boards/test.brd" ? board : authoredBmp(),
            },
          };
        });
      result = engine.advance(1, events);
      if (imageProvided && result.requests.length === 0 && !result.loading) break;
    }
    const surfaces = new Map() as RasterSurfaces;
    surfaces.get = (surface: SurfaceId, revision: number = 0) => engine.surfacePixels(surface, revision) ?? undefined;
    const assets = new Map([[assetKey("bitmap/pixel.bmp"), texture]]);
    const raster = rasterizePresentation(engine.drawList(), { ...geometry, safeArea: { ...geometry.safeArea, left: safeLeft } }, assets, surfaces);
    equal(raster.error, null);
    return { engine, raster };
  };

  const crossing = render(-1);
  equal(crossing.engine.drawList().marginCommands.length, 1);
  deepEqual([...crossing.raster.rgba.slice(0, 4)], [255, 0, 0, 255], "the exterior half of the image is rendered");
  deepEqual([...crossing.raster.rgba.slice(4, 8)], [0, 255, 0, 255], "the interior half is rendered once");

  const exterior = render(-2);
  equal(exterior.engine.drawList().marginCommands.length, 1);
  deepEqual([...exterior.raster.rgba.slice(0, 4)], [0, 255, 0, 255]);
  equal(exterior.raster.rgba[(0 * 4 + 1) * 4], 0, "fully exterior image does not add red pixels to Plane 1");
  equal(exterior.raster.rgba[(0 * 4 + 1) * 4 + 1], 0, "fully exterior image does not add green pixels to Plane 1");

  const interior = render(0);
  equal(interior.engine.drawList().marginCommands.length, 0);

  const clipped = render(-1, 1);
  equal(clipped.raster.rgba[3], 0, "safe-area clipping suppresses the crossing image's margin pixel");
  deepEqual([...clipped.raster.rgba.slice(4, 8)], [0, 255, 0, 255]);
  const translucent = render(-1, 0, "setimagetranslucent", "", "fillrect(-1, 0, 0, 1)\n");
  const loweredTranslucent = translucent.engine.drawList().marginCommands[0];
  if (loweredTranslucent?.kind !== "blit" || !("surface" in loweredTranslucent.source)) throw new Error("expected lowered translucent margin snapshot");
  equal(loweredTranslucent.blend, "normal", "the exported Plane 3 command is ordinary AD-3");
  deepEqual([...translucent.raster.rgba.slice(0, 4)], [255, 127, 127, 255]);
  deepEqual([...translucent.raster.rgba.slice(4, 8)], [127, 255, 127, 255], "the in-game pixel retains its independent screen composition");
  const additive = render(-1, 0, "setimageadditive", ", 50");
  deepEqual([...additive.raster.rgba.slice(0, 4)], [127, 0, 0, 255]);
  deepEqual([...additive.raster.rgba.slice(4, 8)], [0, 127, 0, 255], "additive author output is captured before the standard AD-3 blit");
});

test("board preview image pixels are applied after the image reply", () => {
  const rgba = pixelsAfter('viewbrd("test.brd", 0, 0, c)', authoredBoard("pixel.bmp"));
  deepEqual(rgba.slice(0, 8), new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
});

test("missing image reply is located and leaves the screen unchanged", () => {
  const engine = createEngine({ seed: 19, assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/pixel.bmp"]), assetRoot: PACKAGE_ROOT, initialBoard: "test.brd", width: 4, height: 2, maxTicks: 20, program: 'createcanvas(4, 2, c)\nsetimage("pixel.bmp", 0, 0, 2, 1, c)\nend()\n' });
  let result = engine.advance(0, []);
  for (let step = 0; step < 6; step += 1) {
    const events = result.requests.filter((request) => request.kind === "asset").map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: request.key === "boards/test.brd" ? authoredBoard() : null } }));
    result = engine.advance(1, events);
    if (result.diagnostics.some((diagnostic) => diagnostic.code === "asset.missing")) break;
  }
  const surface = engine.surfacePixels(1 as never, 1) ?? engine.surfacePixels(1 as never, 2) ?? engine.surfacePixels(1 as never, 0);
  if (surface === null) throw new Error("expected unchanged screen pixels");
  deepEqual(surface.rgba, new Uint8Array(4 * 2 * 4));
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "asset.missing" && diagnostic.file === "bitmap/pixel.bmp"), true);
});

test("engine classifies .tbm board-image dependencies as tile requests", () => {
  const empty = createEmptyBoard();
  const board: Board = {
    ...empty,
    images: [{
      file: "tiles.tbm",
      left: 0,
      top: 0,
      layer: 0,
      drawType: 0,
      transparent: { r: 255, g: 0, b: 255 },
      reserved: 0,
    }],
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/tiles.tbm"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 1,
  });
  const initial = engine.advance(0, []);
  const boardRequest = initial.requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: boardBytes(board) } }]);
  const imageRequest = loaded.requests[0];
  if (imageRequest?.kind !== "asset") throw new Error("expected tile bitmap request");
  equal(imageRequest.key, "bitmap/tiles.tbm");
});

/** A one-tile 32×32 tileset plus a 2 × 2 tile bitmap over it, for the image path's tile-bitmap decode. */
function tileBitmapFiles(cellTile: string): Map<string, Uint8Array> {
  const pixels = new Uint8Array(32 * 32 * 3);
  for (let at = 0; at < pixels.length; at += 3) {
    pixels[at] = 100;
    pixels[at + 1] = 100;
    pixels[at + 2] = 100;
  }
  const tileset = writeTileset({ version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false }, tiles: [{ pixels }], residue: new Uint8Array() });
  if (!tileset.ok) throw new Error(tileset.error.message);
  const cells = [];
  for (let x = 0; x <= 2; x += 1) for (let y = 0; y <= 2; y += 1) cells.push({ tile: x < 2 && y < 2 ? cellTile : "", r: 10, g: 20, b: 30 });
  const bitmap = writeTileBitmap({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 2, height: 2, cells, residue: new Uint8Array() });
  if (!bitmap.ok) throw new Error(bitmap.error.message);
  return new Map([[assetKey("Tiles/tiles.tst"), tileset.value], [assetKey("Bitmap/tiles.tbm"), bitmap.value], [assetKey("Boards/test.brd"), authoredBoard()]]);
}

/** Run `bitmap("tiles.tbm", c)` into a 64 × 64 canvas, answering every request from `files`, and report the run. */
function tileBitmapRun(cellTile: string): { readonly engine: Engine; readonly state: GameState | undefined; readonly diagnostics: { readonly code: string; readonly file: string; readonly message: string }[] } {
  const files = tileBitmapFiles(cellTile);
  const capture = captureState();
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/tiles.tbm", "Tiles/tiles.tst"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 20,
    program: 'createcanvas(64, 64, c)\nbitmap("tiles.tbm", c)\nend()\n',
    phaseRegistrations: [capture.registration],
  });
  const diagnostics: { code: string; file: string; message: string }[] = [];
  let result = engine.advance(0, []);
  diagnostics.push(...result.diagnostics);
  for (let step = 0; step < 12 && (result.requests.length > 0 || result.loading); step += 1) {
    const events = result.requests
      .filter((request) => request.kind === "asset")
      .map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }));
    result = engine.advance(1, events);
    diagnostics.push(...result.diagnostics);
  }
  return { engine, state: capture.state(), diagnostics };
}

test("bitmap draws a tile bitmap's cells, tinted, through the image path", () => {
  const { engine, state, diagnostics } = tileBitmapRun("tiles.tst1");
  deepEqual(diagnostics, [], "the tile bitmap decodes without a diagnostic");
  const canvas = programCanvas(state);
  const surface = engine.surfacePixels(canvas.id, canvas.rev);
  if (surface === null) throw new Error("expected the composed tile bitmap");
  equal(surface.w, 64);
  equal(surface.h, 64);
  deepEqual([...surface.rgba.slice(0, 4)], [110, 120, 130, 255], "cell (0, 0): the tile colour plus its cell tint");
  deepEqual([...surface.rgba.slice(surface.rgba.length - 4)], [110, 120, 130, 255], "cell (1, 1) is drawn too");
  deepEqual([...surface.rgba.slice(32 * 4, 32 * 4 + 4)], [110, 120, 130, 255], "the second column starts at x = 32");
});

test("bitmap reports a tile bitmap cell whose tile index is out of range", () => {
  const { diagnostics } = tileBitmapRun("tiles.tst9");
  const diagnostic = diagnostics.find((entry) => entry.code === "asset.invalid" && entry.file === "bitmap/tiles.tbm");
  if (diagnostic === undefined) throw new Error(`expected an invalid-asset diagnostic, got ${JSON.stringify(diagnostics)}`);
  equal(diagnostic.message.includes("out of range"), true);
  equal(diagnostic.message.includes("tiles.tst9"), true);
});

test("engine classifies .tan tile-animation dependencies as tile requests", () => {
  const board: Board = { ...createEmptyBoard(), lut: ["anim.tan"] };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd", "Tiles/anim.tan"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 1,
  });
  const initial = engine.advance(0, []);
  const boardRequest = initial.requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: boardBytes(board) } }]);
  const animationRequest = loaded.requests[0];
  if (animationRequest?.kind !== "asset") throw new Error("expected tile animation request");
  equal(animationRequest.key, "tiles/anim.tan");
});

test("the end-of-tick object pass runs in the engine as it does in the script host (R-34)", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
    program: "class Box {\n  public:\n  var v\n  method Box(x) { v = x }\n}\na = Box(1)\nsleep(1)\na = 0\nsleep(1)\nend()\n",
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  const initialObjects = latest!.vm.objects.length;
  equal(initialObjects > 1, true, "built-in actor and event objects remain rooted alongside the script object");
  engine.advance(1, []);
  equal(latest!.vm.objects.length, initialObjects - 1, "the tick that dropped the last script reference frees only that object");
});

test("the engine frees a closure cell no script can reach, then the objects it alone kept (R-34, FUN-8)", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
    program: [
      "class Box {",
      "  public:",
      "  var v",
      "  method Box(x) { v = x }",
      "}",
      "function mk() {",
      "  local(o)",
      "  o = Box(1)",
      "  return () => o",
      "}",
      "f = mk()",
      "sleep(1)",
      "f = 0",
      "sleep(1)",
      "end()",
      "",
    ].join("\n"),
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  deepEqual(Object.keys(latest!.vm.cells ?? {}), ["cell1"], "the closure's cell is reachable through f");
  const initialObjects = latest!.vm.objects.length;
  equal(initialObjects > 1, true, "built-in actor and event objects remain rooted alongside the closure-owned object");
  engine.advance(1, []);
  deepEqual(Object.keys(latest!.vm.cells ?? {}), [], "the tick that dropped f frees its cell");
  equal(latest!.vm.objects.length, initialObjects - 1, "and the object only that cell named is freed in the same pass");
});

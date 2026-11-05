import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { applyUiEffect, assetKey, createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine, createGameState, hydrateBoard, initCameraForBoard, PACKAGE_ROOT, rasterizePresentation, snapshotGameSave, writeBoard, writeMainFile, type InputRecord, type NormalizedHostFeatures } from "@tk-reawakened/core";
import { createObservedHostGeometry, createSafeAreaProbe, measureHostDisplay, observeHostState, readHostFeatures, reconcileObservedGeometryAfterAdvance, reconcileObservedHostFeaturesAfterAdvance, stampPendingInputs, type HostStateObserver, type PendingInput } from "../src/host-state.ts";
import { pointerEventToLogical } from "../src/pointer.ts";

const viewSize = { width: 640, height: 480 };

function installGlobals(values: Readonly<Record<string, unknown>>): () => void {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, descriptor);
    }
  };
}

function makeBrowserEnvironment(
  getGamepads: () => readonly (Gamepad | null)[],
  keyboard?: { getLayoutMap(): Promise<unknown> },
  insets = { top: 0, right: 0, bottom: 0, left: 0 },
) {
  const windowTarget = new EventTarget() as EventTarget & { matchMedia: (query: string) => MediaQueryList };
  windowTarget.matchMedia = (query) => ({
    matches: query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }) as MediaQueryList;
  class TestResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    disconnect() {}
  }
  let removed = false;
  const probe = { style: { cssText: "" }, setAttribute() {}, remove() { removed = true; } };
  return {
    windowTarget,
    probe,
    wasRemoved: () => removed,
    globals: {
      window: windowTarget,
      navigator: { maxTouchPoints: 1, getGamepads, ...(keyboard === undefined ? {} : { keyboard }) },
      screen: { orientation: { type: "portrait-primary" } },
      ResizeObserver: TestResizeObserver,
      document: { createElement: () => probe, documentElement: { append() {} } },
      getComputedStyle: () => ({
        paddingTop: `${insets.top}px`,
        paddingRight: `${insets.right}px`,
        paddingBottom: `${insets.bottom}px`,
        paddingLeft: `${insets.left}px`,
      }),
    },
  };
}

function makeHost(width: number, height: number): { readonly canvas: HTMLCanvasElement; readonly viewport: HTMLElement } {
  const style = { width: "", height: "" };
  const canvas = {
    style,
    getBoundingClientRect() {
      return { left: (width - Number.parseFloat(style.width)) / 2, top: (height - Number.parseFloat(style.height)) / 2, width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
    },
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    viewport: { getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) } as unknown as HTMLElement,
  };
}

test("deferred host records are stamped at the consuming advance boundary", () => {
  const event: InputRecord["event"] = { kind: "host.features", features: { touch: true, pointer: "coarse", keyboard: false, gamepad: false, haptics: false, orientation: "portrait" } };
  const pending: PendingInput[] = [{ tick: null, event, pointerGeometry: null }, { tick: 4, event, pointerGeometry: null }];
  deepEqual(stampPendingInputs(pending, 19), [{ tick: 19, event }, { tick: 4, event }]);
});

test("pointer geometry keeps the newest queued host display through an advance boundary", () => {
  const initial = {
    content: { width: 640, height: 480 },
    game: { x: 0, y: 0, width: 640, height: 480 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const resized = {
    content: { width: 800, height: 600 },
    game: { x: 80, y: 60, width: 640, height: 480 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const observed = createObservedHostGeometry(initial);
  const pending: InputRecord["event"][] = [];
  const event: InputRecord["event"] = { kind: "host.display", geometry: resized };
  observed.observe(event);
  pending.push(event);
  const host = { getBoundingClientRect: () => ({ left: 0, top: 0 } as DOMRect) } as HTMLElement;
  const pointer = { clientX: 200, clientY: 100 } as PointerEvent;
  deepEqual(pointerEventToLogical(pointer, host, viewSize, observed.current()), { x: 120, y: 40 });
  pending.length = 0; // The event has been handed to advance; the engine may not have consumed it yet.
  deepEqual(observed.current(), resized);
  deepEqual(pointerEventToLogical(pointer, host, viewSize, observed.current()), { x: 120, y: 40 });
});
test("post-restore geometry is inserted before stalled-load margin pointers without spending a tick", () => {
  const initial = {
    content: { width: 4, height: 2 },
    game: { x: 1, y: 0, width: 2, height: 2 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const resized = {
    content: { width: 6, height: 2 },
    game: { x: 2, y: 0, width: 2, height: 2 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
  });
  if (!main.ok) throw new Error(main.error.message);
  const files = new Map([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), new TextEncoder().encode('Load("slot")\nend()\n')],
  ]);
  const assetIndex = createAssetIndex(["main.gam", "Boards/start.brd", "Prg/start.prg"]);
  const hydratedBoard = hydrateBoard(assetKey("boards/start.brd"), board.value, assetIndex, PACKAGE_ROOT, files);
  if (hydratedBoard.value === null) throw new Error("expected saved board to hydrate");
  const savedState = createGameState({ seed: 7, width: 2, height: 2, displayGeometry: initial });
  Object.assign(savedState.world, { board: hydratedBoard.value.board });
  Object.assign(savedState, { camera: initCameraForBoard(savedState.camera, hydratedBoard.value.board, null) });
  applyUiEffect(savedState, "uiBegin", [7, "touch", "surface", -2, 0, 1, 2, 1]);
  savedState.camera.target = { kind: "point", point: { x: 0, y: 0 } };
  applyUiEffect(savedState, "uiItem", [7, "Go", "margin-go", null, 1, null, "confirm", null, 1]);
  applyUiEffect(savedState, "uiEnd", [7]);
  savedState.input.focused = false;
  Object.assign(savedState.time, { tick: 50 });
  const legacySave = JSON.parse(snapshotGameSave(savedState)) as { features?: unknown; schema: Record<string, unknown> };
  delete legacySave.features;
  delete legacySave.schema.features;
  const saved = new TextEncoder().encode(JSON.stringify(legacySave));
  const liveFeatures: NormalizedHostFeatures = {
    touch: true, pointer: "coarse", keyboard: false, gamepad: true, haptics: false, orientation: "portrait",
  };
  let activatedItem: string | null = null;
  const engine = createEngine({
    seed: 7,
    assetIndex,
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "host-state-geometry-restore-test",
    width: 2,
    height: 2,
    maxTicks: 100,
    features: liveFeatures,
    phaseRegistrations: [{
      phase: "animation",
      run(state) {
        activatedItem = state.ui.surfaceActivated?.itemId ?? null;
      },
    }],
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });
  let loadReport = engine.advance(0, []);
  let loadRequest = loadReport.requests.find((request) => request.kind === "loadBlob");
  for (let step = 0; step < 8 && loadRequest?.kind !== "loadBlob"; step += 1) {
    const events = loadReport.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: loadReport.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
    loadReport = engine.advance(1, events);
    loadRequest = loadReport.requests.find((request) => request.kind === "loadBlob");
  }
  if (loadRequest?.kind !== "loadBlob") throw new Error("expected RPGCode load request");

  // A pointer arrives while Load is waiting for bytes. The engine still reports the resized geometry at this point,
  // so the input is correctly normalized as a Plane 3 point but has no new geometry record in the pending queue.
  const observed = createObservedHostGeometry(resized);
  const observedFeatures: HostStateObserver = {
    poll() {},
    currentFeatures: () => ({ ...liveFeatures }),
    snapshotForRestore: () => [],
    dispose() {},
  };
  const host = { getBoundingClientRect: () => ({ left: 0, top: 0 } as DOMRect) } as HTMLElement;
  const logical = pointerEventToLogical({ clientX: 0, clientY: 0 } as PointerEvent, host, { width: 2, height: 2 }, observed.current());
  deepEqual(logical, { x: -2, y: 0 });
  const pending: PendingInput[] = [
    { tick: loadReport.tickAfter, event: { kind: "key", name: "A", code: "KeyA", char: "a", down: true }, pointerGeometry: null },
    { tick: loadReport.tickAfter, event: { kind: "pointer", ...logical, buttons: 1 }, pointerGeometry: resized },
    { tick: loadReport.tickAfter, event: { kind: "pointer", ...logical, buttons: 0 }, pointerGeometry: resized },
  ];
  const restored = engine.advance(0, [{
    tick: loadReport.tickAfter,
    event: { kind: "blob.loaded", reqId: loadRequest.reqId, bytes: saved },
  }]);
  let readyReport = restored;
  for (let step = 0; step < 8; step += 1) {
    const assetReplies = readyReport.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: readyReport.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
    if (assetReplies.length === 0) break;
    readyReport = engine.advance(0, assetReplies);
  }
  deepEqual(engine.hostDisplayGeometry(), initial, "Load restores the older saved display geometry");
  deepEqual(engine.hostFeatures(), { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null }, "a version-1 save missing host features migrates to the documented defaults");
  equal(loadReport.tickAfter === readyReport.tickAfter, false, "the restored save tick differs from the wait/input timestamp");
  const featureNeedsTick = reconcileObservedHostFeaturesAfterAdvance(engine.hostFeatures(), observedFeatures, pending);
  equal(featureNeedsTick, true, "current host capabilities are queued after restoring the older feature record");
  deepEqual(engine.hostFeatures(), { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null }, "reconciliation does not silently mutate the engine");
  const queued = reconcileObservedGeometryAfterAdvance(engine.hostDisplayGeometry(), observed, pending, readyReport.tickAfter);
  equal(queued, true, "restored geometry remains queued until a budgeted tick");
  deepEqual(pending.map(({ tick }) => tick), [null, null, null, null, null], "unconsumed numeric producer timestamps rebase only while still pending");
  deepEqual(pending.map(({ event }) => event.kind), ["key", "host.display", "pointer", "pointer", "host.features"], "restore reconciliations preserve same-tick input order");

  const resumedInputs = stampPendingInputs(pending, readyReport.tickAfter);
  deepEqual(resumedInputs.map(({ tick }) => tick), pending.map(() => readyReport.tickAfter));
  const resumed = engine.advance(0, resumedInputs);
  equal(resumed.ticksRun, 0, "host state reconciliation never spends an unbudgeted simulation tick");
  equal(resumed.tickAfter, readyReport.tickAfter, "the tick counter stays unchanged");
  deepEqual(resumed.consumed.map(({ event }) => event.kind), ["host.display", "host.features"], "the unfocused restored engine consumes both logged host reconciliations");
  deepEqual(engine.hostFeatures(), liveFeatures, "the logged host.features event restores the live capability record");
  deepEqual(engine.hostDisplayGeometry(), resized);
  const geometryForFirstDraw = engine.hostDisplayGeometry();
  const firstFrame = rasterizePresentation(engine.drawList(), geometryForFirstDraw, new Map());
  equal(firstFrame.error, null);
  equal(firstFrame.width, 6, "the first post-restore frame uses live host content geometry");
  equal(firstFrame.height, 2);

  const focused = engine.advance(0, [{ tick: readyReport.tickAfter, event: { kind: "focus", state: "gained" } }]);
  equal(focused.ticksRun, 0, "focus restoration remains pre-tick");
  deepEqual(focused.consumed.map(({ event }) => event.kind), ["focus"], "host focus resumes the restored state");
  const pointerTick = engine.advance(1, []);
  equal(pointerTick.ticksRun, 1, JSON.stringify(pointerTick));
  equal(activatedItem, "margin-go", "the queued Plane 3 press/release is hit-tested using the restored live geometry");

});

test("zero-sized host surfaces defer geometry instead of fitting or publishing invalid dimensions", () => {
  const zeroSize = makeHost(0, 0);
  equal(measureHostDisplay(zeroSize, viewSize, { top: 0, right: 0, bottom: 0, left: 0 }), null);
  const host = makeHost(800, 600);
  const geometry = measureHostDisplay(host, viewSize, { top: 0, right: 0, bottom: 0, left: 0 });
  deepEqual(geometry?.content, { width: 800, height: 600 });
  deepEqual(geometry?.game, { x: 80, y: 60, width: 640, height: 480 });
});

test("safe-area probe reads all env insets and removes its hidden probe element", () => {
  const insets = { top: 12, right: 4, bottom: 8, left: 6 };
  const browser = makeBrowserEnvironment(() => [], undefined, insets);
  const restore = installGlobals(browser.globals);
  try {
    const safeArea = createSafeAreaProbe();
    deepEqual(safeArea.read(), insets);
    equal(browser.probe.style.cssText.includes("env(safe-area-inset-top)"), true);
    equal(browser.probe.style.cssText.includes("env(safe-area-inset-left)"), true);
    safeArea.dispose();
    equal(browser.wasRemoved(), true);
  } finally {
    restore();
  }
});

test("keyboard capability is based on observation, not the browser layout API", () => {
  const browser = makeBrowserEnvironment(() => [], { getLayoutMap: async () => ({}) });
  const restore = installGlobals(browser.globals);
  try {
    equal(readHostFeatures().touch, true);
    equal(readHostFeatures().keyboard, false);
    equal(readHostFeatures(true).keyboard, true);
  } finally {
    restore();
  }
});

test("live gamepad polling records normalized physical state changes and disconnects once", () => {
  const axes = [0, 0];
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  const gamepad = { index: 0, connected: true, mapping: "standard", axes, buttons } as unknown as Gamepad;
  let connected = true;
  const browser = makeBrowserEnvironment(() => connected ? [gamepad] : []);
  const restore = installGlobals(browser.globals);
  const host = makeHost(640, 480);
  const inputs: InputRecord[] = [];
  let observer: HostStateObserver | null = null;
  try {
    observer = observeHostState(host, viewSize, (event) => inputs.push({ tick: 0, event }));
    const records = (): Extract<InputRecord["event"], { kind: "gamepad" }>[] =>
      inputs.flatMap(({ event }) => event.kind === "gamepad" ? [event] : []);
    deepEqual(records(), [{ kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 }]);
    axes[0] = 0.8;
    buttons[0]!.pressed = true;
    observer.poll();
    observer.poll();
    deepEqual(records(), [
      { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 },
      { kind: "gamepad", device: 0, connected: true, axes: { x: 800, y: 0 }, buttons: 1 },
    ]);
    axes[0] = -0.2499;
    observer.poll();
    axes[0] = 0.25;
    observer.poll();
    axes[0] = 2;
    observer.poll();
    deepEqual(records().slice(-3).map(({ axes: value }) => value.x), [-249, 250, 1000], "axis samples truncate toward zero and clamp to the W3C integer range");
    axes[0] = 0;
    buttons[0]!.pressed = false;
    observer.poll();
    connected = false;
    const disconnected = new Event("gamepaddisconnected");
    Object.defineProperty(disconnected, "gamepad", { value: gamepad });
    browser.windowTarget.dispatchEvent(disconnected);
    deepEqual(records(), [
      { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 },
      { kind: "gamepad", device: 0, connected: true, axes: { x: 800, y: 0 }, buttons: 1 },
      { kind: "gamepad", device: 0, connected: true, axes: { x: -249, y: 0 }, buttons: 1 },
      { kind: "gamepad", device: 0, connected: true, axes: { x: 250, y: 0 }, buttons: 1 },
      { kind: "gamepad", device: 0, connected: true, axes: { x: 1000, y: 0 }, buttons: 1 },
      { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 },
      { kind: "gamepad", device: 0, connected: false, axes: { x: 0, y: 0 }, buttons: 0 },
    ]);
  } finally {
    observer?.dispose();
    restore();
  }
});

test("gamepad polling accepts only the standard mapping and emits devices in ascending order", () => {
  const pad = (index: number, mapping: string, pressed = false) => ({
    index, connected: true, mapping, axes: [0, 0],
    buttons: Array.from({ length: 17 }, (_, button) => ({ pressed: pressed && button === 16 })),
  }) as unknown as Gamepad;
  const browser = makeBrowserEnvironment(() => [pad(2, "standard"), pad(1, "xinput"), pad(0, "standard", true)]);
  const restore = installGlobals(browser.globals);
  const host = makeHost(640, 480);
  const inputs: InputRecord[] = [];
  let observer: HostStateObserver | null = null;
  try {
    observer = observeHostState(host, viewSize, (event) => inputs.push({ tick: 0, event }));
    deepEqual(inputs.flatMap(({ event }) => event.kind === "gamepad"
      ? [{ device: event.device, buttons: event.buttons }]
      : []), [
      { device: 0, buttons: 1 << 16 },
      { device: 2, buttons: 0 },
    ]);
    deepEqual(observer.snapshotForRestore(), [
      { kind: "host.features", features: { touch: true, pointer: "coarse", keyboard: false, gamepad: true, haptics: false, orientation: "portrait" } },
      { kind: "host.display", geometry: { content: { width: 640, height: 480 }, game: { x: 0, y: 0, width: 640, height: 480 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } } },
      { kind: "host.gamepads", devices: [
        { device: 0, axes: { x: 0, y: 0 }, buttons: 1 << 16 },
        { device: 2, axes: { x: 0, y: 0 }, buttons: 0 },
      ] },
    ]);
  } finally {
    observer?.dispose();
    restore();
  }
});

test("live host capabilities are reconciled after save restore as logged feature inputs", () => {
  const current: NormalizedHostFeatures = {
    touch: true, pointer: "coarse", keyboard: false, gamepad: true, haptics: false, orientation: "portrait",
  };
  const observer: HostStateObserver = {
    poll() {},
    currentFeatures: () => ({ ...current }),
    snapshotForRestore: () => [],
    dispose() {},
  };
  const restored: NormalizedHostFeatures = {
    touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null,
  };
  const pending: PendingInput[] = [
    { tick: 4, event: { kind: "host.features", features: { ...current, touch: false } }, pointerGeometry: null },
  ];
  equal(reconcileObservedHostFeaturesAfterAdvance(restored, observer, pending), true);
  deepEqual(pending.map(({ tick, event }) => [tick, event.kind, event.kind === "host.features" ? event.features : null]), [
    [4, "host.features", { ...current, touch: false }],
    [null, "host.features", current],
  ]);
  equal(reconcileObservedHostFeaturesAfterAdvance(restored, observer, pending), true);
  equal(pending.filter(({ event }) => event.kind === "host.features").length, 2, "do not duplicate an already queued current host record");
  equal(reconcileObservedHostFeaturesAfterAdvance(current, observer, []), false, "equal live and engine features require no record");
});


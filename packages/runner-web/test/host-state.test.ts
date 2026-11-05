import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { InputRecord } from "@tk-reawakened/core";
import { createObservedHostGeometry, createSafeAreaProbe, measureHostDisplay, observeHostState, readHostFeatures, reapplyObservedGeometryBeforePointer, stampPendingInputs, type PendingInput } from "../src/host-state.ts";
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
  const pending: PendingInput[] = [{ tick: null, event }, { tick: 4, event }];
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
test("frame reconciliation reapplies live geometry after stale restore without pointer input", () => {
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
  observed.observe({ kind: "host.display", geometry: resized });
  const pending: PendingInput[] = [];
  reapplyObservedGeometryBeforePointer(initial, observed, pending);
  deepEqual(pending, [{ tick: null, event: { kind: "host.display", geometry: resized } }]);
  reapplyObservedGeometryBeforePointer(initial, observed, pending);
  equal(pending.length, 1, "do not enqueue duplicate geometry before the next frame");
  const stamped = stampPendingInputs(pending, 7);
  deepEqual(stamped, [{ tick: 7, event: { kind: "host.display", geometry: resized } }]);
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

test("boot-connected gamepads are emitted once and their later disconnect is preserved", () => {
  const gamepad = { index: 0, connected: true } as Gamepad;
  let connected = true;
  const browser = makeBrowserEnvironment(() => connected ? [gamepad] : []);
  const restore = installGlobals(browser.globals);
  const host = makeHost(640, 480);
  const inputs: InputRecord[] = [];
  let stop = (): void => {};
  try {
    stop = observeHostState(host, viewSize, (event) => inputs.push({ tick: 0, event }));
    const startup = inputs.filter((input) => input.event.kind === "gamepad");
    deepEqual(startup.map((input) => input.event.kind === "gamepad" && [input.event.device, input.event.connected]), [[0, true]]);
    const duplicate = new Event("gamepadconnected");
    Object.defineProperty(duplicate, "gamepad", { value: gamepad });
    browser.windowTarget.dispatchEvent(duplicate);
    equal(inputs.filter((input) => input.event.kind === "gamepad").length, 1);
    connected = false;
    const disconnected = new Event("gamepaddisconnected");
    Object.defineProperty(disconnected, "gamepad", { value: gamepad });
    browser.windowTarget.dispatchEvent(disconnected);
    deepEqual(inputs.filter((input) => input.event.kind === "gamepad").map((input) => input.event.kind === "gamepad" && input.event.connected), [true, false]);
  } finally {
    stop();
    restore();
  }
});


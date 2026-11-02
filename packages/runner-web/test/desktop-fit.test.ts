import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { observeViewport } from "../src/live-session.ts";
import { pointerEventToLogical } from "../src/pointer.ts";

test("desktop fitting scales and maps input across viewport resizes", () => {
  const previous = globalThis.ResizeObserver;
  let resize = (): void => { throw new Error("observer was not installed"); };
  let disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = () => callback([], this as unknown as ResizeObserver); }
    observe(): void { /* viewport is observed */ }
    unobserve(): void { /* unused */ }
    disconnect(): void { disconnected = true; }
  } as typeof ResizeObserver;
  try {
    const content = { width: 960, height: 700 };
    const viewport = { getBoundingClientRect: () => content } as unknown as HTMLElement;
    const style = { width: "", height: "" };
    const canvas = {
      width: 0, height: 0, style,
      getBoundingClientRect() {
        const width = Number.parseFloat(style.width);
        const height = Number.parseFloat(style.height);
        return { width, height, left: (content.width - width) / 2, top: (content.height - height) / 2 };
      },
    } as unknown as HTMLCanvasElement;
    const view = { width: 1200, height: 900 };
    const stop = observeViewport(canvas, viewport, view);
    const check = (width: number, height: number): void => {
      const rect = canvas.getBoundingClientRect();
      equal(rect.width, width);
      equal(rect.height, height);
      ok(rect.left >= 0 && rect.top >= 0 && rect.left + width <= content.width && rect.top + height <= content.height);
      const event = { clientX: rect.left + width * 0.25, clientY: rect.top + height * 0.5 } as PointerEvent;
      deepEqual(pointerEventToLogical(event, canvas, view), { x: 300, y: 450 });
    };
    check(2800 / 3, 700); // oversized: fractional fallback, whole frame visible
    content.width = 3700; content.height = 2800; resize();
    check(3600, 2700); // largest fitting integer, not 2× or fractional 3.08×
    content.width = 3000; content.height = 2250; resize();
    check(2400, 1800); // 2.5× must round down, not to 3×
    content.width = 3588; content.height = 2691; resize();
    check(2400, 1800); // 2.99× must also round down
    content.width = 2400; content.height = 1800; resize();
    check(2400, 1800); // exact boundary
    content.width = 1200; content.height = 900; resize();
    check(1200, 900); // exact 1× boundary
    stop();
    equal(disconnected, true);
  } finally {
    globalThis.ResizeObserver = previous;
  }
});

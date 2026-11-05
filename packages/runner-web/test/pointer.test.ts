import { equal } from "node:assert/strict";
import { test } from "node:test";
import type { HostDisplayGeometry } from "@tk-reawakened/core";
import { pointerEventToLogical } from "../src/pointer.ts";

function makeHost(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  return { getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) } as unknown as HTMLElement;
}

function makeEvent(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY } as unknown as PointerEvent;
}

const viewSize = { width: 640, height: 480 };
const identity: HostDisplayGeometry = {
  content: { width: 640, height: 480 },
  game: { x: 0, y: 0, width: 640, height: 480 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

test("1:1 layout maps client coordinates directly", () => {
  const host = makeHost({ left: 0, top: 0, width: 640, height: 480 });
  const result = pointerEventToLogical(makeEvent(100, 200), host, viewSize, identity);
  equal(result.x, 100);
  equal(result.y, 200);
});

test("letterboxed layout subtracts the content origin and game offset", () => {
  const host = makeHost({ left: 10, top: 20, width: 1000, height: 800 });
  const geometry: HostDisplayGeometry = {
    content: { width: 1000, height: 800 },
    game: { x: 20, y: 40, width: 960, height: 720 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const result = pointerEventToLogical(makeEvent(10 + 20 + 150, 20 + 40 + 300), host, viewSize, geometry);
  equal(result.x, 100);
  equal(result.y, 200);
});

test("non-uniform scales map independently per axis", () => {
  const host = makeHost({ left: 10, top: 20, width: 900, height: 700 });
  const geometry: HostDisplayGeometry = {
    content: { width: 900, height: 700 },
    game: { x: 50, y: 30, width: 320, height: 480 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const result = pointerEventToLogical(makeEvent(10 + 50 + 100, 20 + 30 + 200), host, viewSize, geometry);
  equal(result.x, 200);
  equal(result.y, 200);
});

test("Plane 3 coordinates remain negative or beyond the viewport instead of clamping", () => {
  const host = makeHost({ left: 100, top: 50, width: 900, height: 800 });
  const geometry: HostDisplayGeometry = {
    content: { width: 900, height: 800 },
    game: { x: 130, y: 40, width: 640, height: 480 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const left = pointerEventToLogical(makeEvent(100, 100), host, viewSize, geometry);
  const below = pointerEventToLogical(makeEvent(900, 700), host, viewSize, geometry);
  equal(left.x, -130);
  equal(left.y, 10);
  equal(below.x, 670);
  equal(below.y, 610);
});

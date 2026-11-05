import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { fallbackTouchLayout, type TouchControlGeometry } from "../src/touch-controls.ts";

const geometry = (overrides: Partial<TouchControlGeometry> = {}): TouchControlGeometry => ({
  content: { width: 1600, height: 900 },
  game: { x: 320, y: 0, width: 960, height: 720 },
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  ...overrides,
});

test("fallback controls dock in both safe side margins when each has room", () => {
  const layout = fallbackTouchLayout(geometry());
  equal(layout.docked, true);
  ok(layout.left >= 0);
  ok(layout.left + 160 <= 320);
  ok(layout.right >= 1280);
  ok(layout.right + 104 <= 1600);
});

test("fallback controls use gameplay overlay when either side margin is too narrow", () => {
  const measured = geometry({ game: { x: 40, y: 0, width: 1520, height: 855 } });
  const layout = fallbackTouchLayout(measured);
  equal(layout.docked, false);
  deepEqual({ left: layout.left, right: layout.right }, { left: 48, right: 1448 });
  equal(measured.game.width, 1520, "control placement does not resize the gameplay viewport");
});

test("safe-area insets are excluded from usable docking margins", () => {
  const layout = fallbackTouchLayout(geometry({
    game: { x: 190, y: 0, width: 1220, height: 720 },
    safeArea: { top: 0, right: 80, bottom: 24, left: 80 },
  }));
  equal(layout.docked, false, "the 110 px left margin is insufficient after its inset");
});

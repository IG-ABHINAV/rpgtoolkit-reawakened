import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { fallbackTouchLayout, shouldSuppressGameplayKey, type TouchControlGeometry } from "../src/touch-controls.ts";

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
  equal(layout.bottom, 8);
});

test("fallback controls use gameplay overlay when either side margin is too narrow", () => {
  const measured = geometry({ game: { x: 40, y: 0, width: 1520, height: 855 } });
  const layout = fallbackTouchLayout(measured);
  equal(layout.docked, false);
  deepEqual({ left: layout.left, right: layout.right, bottom: layout.bottom }, { left: 48, right: 1448, bottom: 53 });
  equal(measured.game.width, 1520, "control placement does not resize the gameplay viewport");
});

test("safe-area insets are excluded from usable docking margins", () => {
  const layout = fallbackTouchLayout(geometry({
    game: { x: 190, y: 0, width: 1220, height: 720 },
    safeArea: { top: 0, right: 80, bottom: 24, left: 80 },
  }));
  equal(layout.docked, false, "the 110 px left margin is insufficient after its inset");
});

test("overlaid controls stay inside horizontal safe areas", () => {
  const layout = fallbackTouchLayout(geometry({
    game: { x: 40, y: 0, width: 1520, height: 855 },
    safeArea: { top: 0, right: 80, bottom: 0, left: 80 },
  }));
  equal(layout.docked, false);
  deepEqual({ left: layout.left, right: layout.right }, { left: 88, right: 1408 });
});

test("portrait overlay anchors controls inside the safe game rectangle", () => {
  const measured = geometry({
    content: { width: 430, height: 932 },
    game: { x: 0, y: 305, width: 430, height: 322 },
    safeArea: { top: 24, right: 0, bottom: 34, left: 0 },
  });
  const layout = fallbackTouchLayout(measured);
  equal(layout.docked, false);
  const padBottom = measured.content.height - layout.bottom;
  const padTop = padBottom - 104;
  ok(padTop >= measured.game.y, "the D-pad begins inside the game rectangle");
  ok(padBottom <= measured.game.y + measured.game.height, "the D-pad ends inside the game rectangle");
});

test("fallback key ownership isolates only Enter and Space activation sequences", () => {
  const owned = new Set<string>();
  for (const code of ["ArrowRight", "Escape", "KeyW"]) {
    equal(shouldSuppressGameplayKey(code, false, true, true, owned), false, `${code} press reaches gameplay from a fallback target`);
    equal(shouldSuppressGameplayKey(code, true, true, true, owned), false, `${code} repeat reaches gameplay from a fallback target`);
    equal(shouldSuppressGameplayKey(code, false, false, true, owned), false, `${code} release reaches gameplay from a fallback target`);
  }

  equal(shouldSuppressGameplayKey("Space", false, true, true, owned), true, "a fresh fallback activation press is isolated");
  equal(shouldSuppressGameplayKey("Space", true, true, false, owned), true, "repeat stays with the original fallback owner after focus moves");
  equal(owned.has("Space"), true);
  equal(shouldSuppressGameplayKey("Space", false, false, false, owned), true, "release stays isolated after moving away");
  equal(owned.has("Space"), false);
  equal(shouldSuppressGameplayKey("Space", false, false, false, owned), false, "an unrelated release is not consumed");
});

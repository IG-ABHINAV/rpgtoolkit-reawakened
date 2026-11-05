import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __live?: { readonly tick: number; readonly player: { readonly x: number; readonly y: number } | null };
  }
}

test("touch-capable live player exposes accessible fallback controls without shrinking the game", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
    await page.getByRole("group", { name: "Touch controls" }).waitFor({ state: "visible", timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Move up" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move left" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move down" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move right" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });

    const before = await page.evaluate(() => ({
      player: window.__live?.player ?? null,
      logicalWidth: document.querySelector<HTMLCanvasElement>("#screen")?.width ?? -1,
      logicalHeight: document.querySelector<HTMLCanvasElement>("#screen")?.height ?? -1,
    }));
    if (before.player === null) throw new Error("live player position is not available");
    expect(before.logicalWidth).toBe(640);
    expect(before.logicalHeight).toBe(480);

    await page.getByRole("button", { name: "Move right" }).tap();
    await page.waitForFunction((start) => {
      const player = window.__live?.player;
      return player !== null && player !== undefined && player.x > start.x;
    }, before.player, { timeout: 10_000 });
  } finally {
    await context.close();
  }
});

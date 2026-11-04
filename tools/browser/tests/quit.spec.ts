import { expect, test, type Page } from "@playwright/test";
import { createQuitFixture, installMobileFilesystemStub, serveQuitFixture, trackInputListeners } from "./quit-fixture.ts";

type TestWindow = Window & {
  __live?: { readonly tick: number; readonly error?: string };
  __session?: object;
  __quitBeforeSession?: object;
  __inputListenerCounts?: () => Record<string, number>;
};

async function sendOneKeyDown(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })));
}

test("browser quit starts a fresh session without retaining the old input listeners", async ({ page }) => {
  const fixture = createQuitFixture("quit-restart-browser.tpk");
  await serveQuitFixture(page, fixture);
  await trackInputListeners(page);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => {
    const player = window as TestWindow;
    return player.__live !== undefined && player.__live.tick >= 30;
  }, undefined, { timeout: 60_000 });

  const before = await page.evaluate(() => {
    const player = window as TestWindow;
    player.__quitBeforeSession = player.__session;
    return { tick: player.__live?.tick ?? 0, listeners: player.__inputListenerCounts?.() };
  });
  await sendOneKeyDown(page);
  await page.waitForFunction(() => {
    const player = window as TestWindow;
    return player.__session !== undefined && player.__session !== player.__quitBeforeSession && player.__live !== undefined && player.__live.tick > 0;
  }, undefined, { timeout: 60_000 });
  const after = await page.evaluate(() => {
    const player = window as TestWindow;
    return { tick: player.__live?.tick ?? 0, error: player.__live?.error, listeners: player.__inputListenerCounts?.() };
  });

  expect(after.error).toBeUndefined();
  expect(after.tick).toBeLessThan(before.tick);
  expect(after.listeners).toEqual(before.listeners);
});

test("mobile quit starts a fresh session without retaining the old input listeners", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = createQuitFixture("demo.tpk");
  await serveQuitFixture(page, fixture, "/public");
  await installMobileFilesystemStub(page);
  await trackInputListeners(page);
  await page.goto("/packages/runner-mobile/app/player.html");
  await page.waitForFunction(() => {
    const player = window as TestWindow;
    return player.__live !== undefined && player.__live.tick >= 30;
  }, undefined, { timeout: 90_000 });

  const before = await page.evaluate(() => {
    const player = window as TestWindow;
    return { tick: player.__live?.tick ?? 0, listeners: player.__inputListenerCounts?.() };
  });
  await sendOneKeyDown(page);
  await page.waitForFunction((previousTick) => {
    const player = window as TestWindow;
    return player.__live !== undefined && player.__live.tick > 0 && player.__live.tick < previousTick;
  }, before.tick, { timeout: 90_000 });
  const after = await page.evaluate(() => {
    const player = window as TestWindow;
    return { tick: player.__live?.tick ?? 0, error: player.__live?.error, listeners: player.__inputListenerCounts?.() };
  });

  expect(after.error).toBeUndefined();
  expect(after.tick).toBeLessThan(before.tick);
  expect(after.listeners).toEqual(before.listeners);
});

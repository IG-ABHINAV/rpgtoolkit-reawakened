import { expect, test, type Page } from "@playwright/test";
import { createQuitFixture, installMobileFilesystemStub, serveQuitFixture, trackInputListeners } from "./quit-fixture.ts";

type TestWindow = Window & {
  __live?: { readonly tick: number; readonly error?: string };
  __session?: object;
  __quitBeforeSession?: object;
  __restartEpoch?: number;
  __readyRestartEpoch?: number;
  __oldKeydownListeners?: readonly EventListenerOrEventListenerObject[];
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
  expect(after.listeners).toEqual(before.listeners);
});

test("mobile quit starts a fresh session without retaining the old input listeners", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = createQuitFixture("demo.tpk");
  await serveQuitFixture(page, fixture, "/public");
  await installMobileFilesystemStub(page);
  // Latch the mobile host's reset report and a later new-session frame; comparing sampled ticks can miss the boundary.
  await page.addInitScript(() => {
    let current: { readonly tick: number; readonly stateHash: string; readonly drawHash: string; readonly error?: string } | undefined;
    let epoch = 0;
    Object.defineProperty(window, "__live", {
      configurable: true,
      get: () => current,
      set: (report: typeof current) => {
        current = report;
        if (report === undefined) return;
        const player = window as TestWindow;
        if (report.tick === 0 && report.stateHash === "" && report.drawHash === "" && report.error === undefined) {
          player.__restartEpoch = ++epoch;
        } else if (report.tick > 0 && epoch > 0) {
          player.__readyRestartEpoch = epoch;
        }
      },
    });
  });
  await trackInputListeners(page);
  await page.goto("/packages/runner-mobile/app/player.html");
  await page.waitForFunction(() => {
    const player = window as TestWindow;
    return player.__live !== undefined && player.__live.tick >= 30;
  }, undefined, { timeout: 90_000 });

  const before = await page.evaluate(() => {
    const player = window as TestWindow;
    player.__oldKeydownListeners = player.__inputKeydownListeners?.();
    return { tick: player.__live?.tick ?? 0, epoch: player.__restartEpoch ?? 0, listeners: player.__inputListenerCounts?.() };
  });
  await sendOneKeyDown(page);
  await page.waitForFunction(({ epoch, tick }) => {
    const player = window as TestWindow;
    return (player.__readyRestartEpoch ?? 0) > epoch && (player.__live?.tick ?? 0) > tick;
  }, before, { timeout: 90_000 });
  const after = await page.evaluate(() => {
    const player = window as TestWindow;
    const current = player.__inputKeydownListeners?.() ?? [];
    const previous = player.__oldKeydownListeners ?? [];
    return { tick: player.__live?.tick ?? 0, error: player.__live?.error, listeners: player.__inputListenerCounts?.(),
      previousCount: previous.length, currentCount: current.length, retained: current.some((listener) => previous.includes(listener)) };
  });

  expect(after.error).toBeUndefined();
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(after.previousCount).toBeGreaterThan(0);
  expect(after.currentCount).toBeGreaterThan(0);
  expect(after.retained).toBe(false);
  expect(after.listeners).toEqual(before.listeners);
});

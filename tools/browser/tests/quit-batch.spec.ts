import { expect, test, type Page } from "@playwright/test";
import { createQuitBatchFixture, type QuitBatchFixture } from "./quit-batch-fixture.ts";

type QuitWindow = Window & {
  __session?: { close(): void; engine: object; loadState(): { readonly blocking: unknown } };
  __live?: { readonly tick: number; readonly error?: string };
  __quitBatchPrevious?: QuitWindow["__session"];
  __quitBatchReports?: readonly string[][];
  __quitBatchPendingBatch?: boolean;
};

async function servePackage(page: Page, fixture: QuitBatchFixture): Promise<() => void> {
  let releaseRange: (() => void) | null = null;
  const heldRange = new Promise<void>((resolve) => { releaseRange = resolve; });
  await page.route(`**/fixtures/packages/${fixture.name}`, async (route) => {
    const bytes = fixture.packageBytes;
    const range = route.request().headers().range;
    if (range === undefined) {
      await route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(bytes.length), "accept-ranges": "bytes" }, body: Buffer.from(bytes) });
      return;
    }
    const block = await page.evaluate(() => (window as QuitWindow).__quitBatchPendingBatch === true);
    if (block) {
      await heldRange;
      await route.abort();
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) {
      await route.fulfill({ status: 416 });
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const slice = bytes.subarray(start, end + 1);
    await route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(slice.length) }, body: Buffer.from(slice) });
  });
  await page.route(`**/fixtures/packages/${fixture.name}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));
  return () => releaseRange?.();
}

test("quit supersedes a pending asset request in its engine report", async ({ page }) => {
  const fixture = createQuitBatchFixture("quit-batch.tpk");
  const releaseRange = await servePackage(page, fixture);
  try {
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}&mode=streaming`);
    await page.waitForFunction(() => window.__session !== undefined && window.__live !== undefined, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => (window.__live?.tick ?? 0) >= 30, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => (window as QuitWindow).__session?.loadState().blocking === null, undefined, { timeout: 60_000 });
    await page.evaluate(() => {
      const player = window as QuitWindow;
      player.__quitBatchPrevious = player.__session;
      player.__quitBatchReports = [];
      const engine = player.__session!.engine as { advance: (ticks: number, inputs: readonly unknown[]) => { requests: readonly { kind: string }[] } };
      const original = engine.advance.bind(engine);
      engine.advance = (ticks, inputs) => {
        const report = original(ticks, inputs);
        const kinds = report.requests.map((request) => request.kind);
        player.__quitBatchReports!.push(kinds);
        player.__quitBatchPendingBatch = kinds.includes("asset") && kinds.includes("quit");
        return report;
      };
    });

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })));
    await page.waitForFunction(() => {
      const player = window as QuitWindow;
      return player.__session !== undefined && player.__session !== player.__quitBatchPrevious && player.__live !== undefined;
    }, undefined, { timeout: 15_000 });

    const result = await page.evaluate(() => {
      const player = window as QuitWindow;
      const batches = player.__quitBatchReports ?? [];
      player.__session?.close();
      return {
        error: player.__live?.error,
        tick: player.__live?.tick ?? 0,
        report: batches.find((batch) => batch.includes("quit")),
      };
    });
    expect(result.report).toEqual(expect.arrayContaining(["asset", "quit"]));
    expect(result.error).toBeUndefined();
    expect(result.tick).toBeGreaterThan(0);
  } finally {
    releaseRange();
  }
});

import { expect, test, type Page } from "@playwright/test";
import { createQuitBatchFixture } from "./quit-batch-fixture.ts";

type QuitBatchFixture = ReturnType<typeof createQuitBatchFixture>;
type TestWindow = Window & {
  __session?: {
    close(): void;
    engine: { advance(ticks: number, inputs: readonly unknown[]): { readonly requests: readonly { readonly kind: string }[] } };
    loadState(): { readonly blocking: unknown };
  };
  __live?: { readonly tick: number; readonly error?: string };
  __previousSession?: TestWindow["__session"];
  __injectedKinds?: readonly string[];
  __writes?: readonly string[];
};

async function servePackage(page: Page, fixture: QuitBatchFixture): Promise<void> {
  await page.route(`**/fixtures/packages/${fixture.name}`, async (route) => {
    const range = route.request().headers().range;
    if (range === undefined) {
      await route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(fixture.packageBytes.length), "accept-ranges": "bytes" }, body: Buffer.from(fixture.packageBytes) });
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) { await route.fulfill({ status: 416 }); return; }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), fixture.packageBytes.length - 1);
    const slice = fixture.packageBytes.subarray(start, end + 1);
    await route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${fixture.packageBytes.length}`, "content-length": String(slice.length), "accept-ranges": "bytes" }, body: Buffer.from(slice) });
  });
  await page.route(`**/fixtures/packages/${fixture.name}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));
}

test("same-report quit persists preceding writes and skips following writes at the live-session seam", async ({ page }) => {
  const fixture = createQuitBatchFixture("quit-write-batch.tpk");
  await servePackage(page, fixture);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
      if (this.transaction.db.name === "tkr-saves") {
        const testWindow = window as TestWindow;
        testWindow.__writes = [...(testWindow.__writes ?? []), key === undefined ? "inline-key" : String(key)];
      }
      return original.call(this, value, key);
    };
  });
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}&mode=streaming`);
  await page.waitForFunction(() => window.__session !== undefined && window.__live !== undefined, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as TestWindow).__session?.loadState().blocking === null, undefined, { timeout: 60_000 });

  await page.evaluate(() => {
    const testWindow = window as TestWindow;
    const session = testWindow.__session!;
    testWindow.__previousSession = session;
    const engine = session.engine;
    const advance = engine.advance.bind(engine);
    let injected = false;
    engine.advance = (ticks, inputs) => {
      const report = advance(ticks, inputs);
      if (injected) return report;
      injected = true;
      const requests = [
        { kind: "saveBlob", reqId: 91_001, blob: { area: "saves", path: "saved/quit-before.sav" }, bytes: Uint8Array.of(0x51, 0x54, 0x52) },
        { kind: "quit", reqId: 91_002 },
        { kind: "saveBlob", reqId: 91_003, blob: { area: "saves", path: "saved/quit-after.sav" }, bytes: Uint8Array.of(0x41, 0x46, 0x54) },
      ];
      testWindow.__injectedKinds = requests.map((request) => request.kind);
      return { ...report, requests };
    };
  });

  await page.waitForFunction(() => {
    const testWindow = window as TestWindow;
    return testWindow.__session !== testWindow.__previousSession;
  }, undefined, { timeout: 15_000 });
  const result = await page.evaluate(() => {
    const testWindow = window as TestWindow;
    testWindow.__session?.close();
    return { requests: testWindow.__injectedKinds, writes: testWindow.__writes ?? [], error: testWindow.__live?.error };
  });
  expect(result.requests).toEqual(["saveBlob", "quit", "saveBlob"]);
  expect(result.writes).toHaveLength(1);
  expect(result.writes[0]).toContain("saved%2Fquit-before.sav");
  expect(result.writes.join(",")).not.toContain("quit-after");
  expect(result.error).toBeUndefined();
  });


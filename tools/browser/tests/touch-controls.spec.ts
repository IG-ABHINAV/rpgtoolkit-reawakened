import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BinaryReader, deriveGameId, derivePackageIdentity, loadPackage, readDistributionManifest, readMainFile, writeDistributionPackage, writeMainFile } from "@tk-reawakened/core";
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __live?: { readonly tick: number; readonly player: { readonly x: number; readonly y: number } | null };
  }
}

type TouchFixture = { readonly name: string; readonly packageBytes: Uint8Array; readonly descriptor: Record<string, unknown> };

function packageWithStartup(name: string, startup: string): TouchFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const main = manifest.value.main;
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json").map((file) => ({ path: file.path, bytes: file.bytes }));
  const mainFile = files.find((file) => file.path === main);
  if (mainFile === undefined) throw new Error(`the demo package has no ${main}`);
  const parsed = readMainFile(new BinaryReader(mainFile.bytes, main));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const startupPath = "touch-declaration.prg";
  const rewrittenMain = writeMainFile({ ...parsed.value, startupPrg: startupPath });
  if (!rewrittenMain.ok) throw new Error(rewrittenMain.error.message);
  const tree = files.map((file) => file.path === main ? { path: file.path, bytes: rewrittenMain.value } : file);
  tree.push({ path: `Prg/${startupPath}`, bytes: new TextEncoder().encode(startup) });
  const packageResult = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main, index: tree.map((file) => file.path) } });
  if (!packageResult.ok) throw new Error(packageResult.error.message);
  return {
    name,
    packageBytes: packageResult.value,
    descriptor: {
      schema: 1,
      file: name,
      sha256: createHash("sha256").update(packageResult.value).digest("hex"),
      size: packageResult.value.length,
      gameId: deriveGameId(rewrittenMain.value, derivePackageIdentity(tree)),
      title: "Touch declaration test",
      version: "1",
    },
  };
}

async function servePackage(page: Page, fixture: TouchFixture): Promise<void> {
  await page.route(`**/fixtures/packages/${fixture.name}`, (route) => {
    const bytes = fixture.packageBytes;
    const range = route.request().headers()["range"];
    const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) {
      return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(bytes.length), "accept-ranges": "bytes" }, body: Buffer.from(bytes) });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const slice = bytes.subarray(start, end + 1);
    return route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(slice.length) }, body: Buffer.from(slice) });
  });
  await page.route(`**/fixtures/packages/${fixture.name}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));
}



test("touch-capable live player exposes accessible fallback controls without shrinking the game", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
    await page.getByRole("group", { name: "Touch controls" }).waitFor({ state: "visible", timeout: 45_000 });
    for (const name of ["Move up", "Move left", "Move down", "Move right", "Confirm", "Cancel"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    const moveRight = page.getByRole("button", { name: "Move right" });
    await moveRight.focus();
    const affordances = await moveRight.evaluate((button) => {
      const style = getComputedStyle(button);
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
    });
    expect(affordances.width).toBeGreaterThanOrEqual(44);
    expect(affordances.height).toBeGreaterThanOrEqual(44);
    expect(affordances.outlineWidth).toBe("3px");
    expect(affordances.outlineStyle).toBe("solid");
        const overlayBounds = await page.locator(".fallback-touch-pad").evaluate((pad) => {
          const canvas = document.querySelector("#screen");
          if (canvas === null) throw new Error("player canvas is missing");
          const padBounds = pad.getBoundingClientRect();
          const gameBounds = canvas.getBoundingClientRect();
          return { padTop: padBounds.top, padBottom: padBounds.bottom, gameTop: gameBounds.top, gameBottom: gameBounds.bottom };
        });
        expect(overlayBounds.padTop).toBeGreaterThanOrEqual(overlayBounds.gameTop);
        expect(overlayBounds.padBottom).toBeLessThanOrEqual(overlayBounds.gameBottom);
    await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });

    const before = await page.evaluate(() => ({
      player: window.__live?.player ?? null,
      logicalWidth: document.querySelector<HTMLCanvasElement>("#screen")?.width ?? -1,
      logicalHeight: document.querySelector<HTMLCanvasElement>("#screen")?.height ?? -1,
    }));
    if (before.player === null) throw new Error("live player position is not available");
    expect(before.logicalWidth).toBe(640);
    expect(before.logicalHeight).toBe(480);
    await moveRight.tap();
    await page.waitForFunction((start) => { const player = window.__live?.player; return player !== null && player !== undefined && player.x > start.x; }, before.player, { timeout: 10_000 });
        await moveRight.focus();
        const keyboardStart = await page.evaluate(() => window.__live?.player ?? null);
        if (keyboardStart === null) throw new Error("live player position is not available");
        await page.keyboard.down("Space");
        await page.waitForFunction((start) => {
          const player = window.__live?.player;
          return player !== null && player !== undefined && player.x > start.x;
        }, keyboardStart, { timeout: 10_000 });
        await page.keyboard.up("Space");
    
        const box = await moveRight.boundingBox();
        if (box === null) throw new Error("move-right fallback button has no bounds");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.keyboard.down("Space");
        await page.mouse.up();
        await expect(moveRight).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.up("Space");
        await expect(moveRight).toHaveAttribute("aria-pressed", "false");
  } finally {
    await context.close();
  }
});

test("an explicit custom touch-control declaration suppresses only the fallback controls", async ({ browser }) => {
  const fixture = packageWithStartup("custom-touch-controls.tpk", "declareCustomTouchControls()\n");
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await servePackage(page, fixture);
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
    await page.waitForFunction(() => {
      const session = (window as Window & { __session?: { engine: { customTouchControlsDeclared(): boolean } } }).__session;
      return session?.engine.customTouchControlsDeclared() === true;
    }, undefined, { timeout: 45_000 });
    await expect(page.locator(".fallback-touch-controls")).toHaveCount(1);
    await expect(page.locator(".fallback-touch-controls")).toBeHidden();
  } finally {
    await context.close();
  }
});

test("querying hasFeature touch does not suppress fallback controls", async ({ browser }) => {
  const fixture = packageWithStartup("touch-feature-query.tpk", 'if (hasFeature("touch")) {\n}\n');
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await servePackage(page, fixture);
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
    await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
    const session = page.locator(".fallback-touch-controls");
    await expect(session).toBeVisible();
  } finally {
    await context.close();
  }
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BinaryReader, deriveGameId, derivePackageIdentity, loadPackage, readDistributionManifest, readMainFile, writeDistributionPackage, writeMainFile } from "@tk-reawakened/core";
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __live?: { readonly tick: number; readonly board?: string | null; readonly player: { readonly x: number; readonly y: number } | null };
    __session?: { readonly viewSize: () => { readonly width: number; readonly height: number } };
  }
}

type TouchFixture = { readonly name: string; readonly packageBytes: Uint8Array; readonly descriptor: Record<string, unknown> };

function packageWithStartup(name: string, startup: string): TouchFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const main = manifest.value.main;
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json" && !/\.(?:mid|midi|wav|mp3|ogg|flac|sf2)$/i.test(file.path)).map((file) => ({ path: file.path, bytes: file.bytes }));
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
async function closeLiveSession(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.evaluate(async () => {
    const close = (window as Window & { __session?: { close?: () => Promise<void> } }).__session?.close;
    if (close !== undefined) await close();
  });
}




test("touch-capable live player exposes accessible fallback controls without shrinking the game", async ({ browser }) => {
  const fixture = packageWithStartup("touch-controls-title.tpk", 'msgbox("Start game")\nend()');
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await servePackage(page, fixture);
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
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
    await page.locator("#screen").focus();
    const overlayBounds = await page.locator(".fallback-touch-pad").evaluate((pad) => {
      const live = (window as Window & { __session?: { displayGeometry: () => { game: { x: number; y: number; width: number; height: number } } } }).__session;
      if (live === undefined) throw new Error("live display geometry is not available");
      const padBounds = pad.getBoundingClientRect();
      const game = live.displayGeometry().game;
      return { padTop: padBounds.top, padBottom: padBounds.bottom, gameTop: game.y, gameBottom: game.y + game.height };
    });
    expect(overlayBounds.padTop).toBeGreaterThanOrEqual(overlayBounds.gameTop);
    expect(overlayBounds.padBottom).toBeLessThanOrEqual(overlayBounds.gameBottom);
    await page.setViewportSize({ width: 932, height: 430 });
    await page.waitForTimeout(100);
    const landscapeBounds = await page.locator(".fallback-touch-pad").evaluate((pad) => {
      const live = (window as Window & { __session?: { displayGeometry: () => { game: { x: number; y: number; width: number; height: number } } } }).__session;
      if (live === undefined) throw new Error("live display geometry is not available");
      const game = live.displayGeometry().game;
      const padBounds = pad.getBoundingClientRect();
      const actionBounds = document.querySelector(".fallback-touch-actions")?.getBoundingClientRect();
      if (actionBounds === undefined) throw new Error("fallback action buttons are missing");
      return { docked: document.querySelector(".fallback-touch-controls")?.classList.contains("fallback-touch-docked") ?? false, padRight: padBounds.right, actionLeft: actionBounds.left, gameLeft: game.x, gameRight: game.x + game.width };
    });
    expect(landscapeBounds.docked).toBe(true);
    expect(landscapeBounds.padRight).toBeLessThanOrEqual(landscapeBounds.gameLeft);
    expect(landscapeBounds.actionLeft).toBeGreaterThanOrEqual(landscapeBounds.gameRight);
    await page.waitForTimeout(100);
    await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
    await page.evaluate(() => {
      const probeWindow = window as Window & { __touchTrace?: unknown[]; __session?: { engine: { advance: (...args: unknown[]) => unknown } } };
      const engine = probeWindow.__session?.engine;
      if (engine === undefined) throw new Error("live engine is unavailable");
      const original = engine.advance;
      probeWindow.__touchTrace = [];
      engine.advance = (...args) => {
        const report = Reflect.apply(original, engine, args) as { consumed?: unknown; tickAfter?: unknown };
        probeWindow.__touchTrace?.push({ inputs: args[1], consumed: report.consumed, tickAfter: report.tickAfter });
        return report;
      };
      document.querySelector(".fallback-touch-controls")?.addEventListener("pointerdown", (event) => probeWindow.__touchTrace?.push({ pointer: "down", type: event.pointerType }), true);
      document.querySelector(".fallback-touch-controls")?.addEventListener("pointerup", (event) => probeWindow.__touchTrace?.push({ pointer: "up", type: event.pointerType }), true);
    });
    const boardBeforeFallbackConfirm = await page.evaluate(() => window.__live?.board ?? null);
    for (let presses = 0; presses < 10; presses += 1) {
      const onBoard = await page.evaluate(() => window.__live !== undefined && window.__live.board !== null);
      if (onBoard) break;
      await page.getByRole("button", { name: "Confirm" }).tap();
      await page.waitForTimeout(500);
    }
    const boardAfterFallbackConfirm = await page.evaluate(() => window.__live?.board ?? null);
    expect(boardBeforeFallbackConfirm).toBeNull();
    expect(boardAfterFallbackConfirm).not.toBeNull();
    for (let presses = 0; presses < 10; presses += 1) {
      const onBoard = await page.evaluate(() => window.__live !== undefined && window.__live.board !== null);
      if (onBoard) break;
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
    }
    await page.waitForFunction(() => window.__live !== undefined && window.__live.board !== null, undefined, { timeout: 45_000 });

    const before = await page.evaluate(() => ({
      player: window.__live?.player ?? null,
      board: window.__live?.board ?? null,
      logicalWidth: document.querySelector<HTMLCanvasElement>("#screen")?.width ?? -1,
      logicalHeight: document.querySelector<HTMLCanvasElement>("#screen")?.height ?? -1,
      sessionViewSize: window.__session?.viewSize() ?? null,
    }));
    if (before.player === null) throw new Error("live player position is not available");
    expect(before.sessionViewSize).toEqual({ width: 640, height: 480 });
    expect(before.logicalWidth).toBeGreaterThan(0);
    expect(before.logicalHeight).toBeGreaterThan(0);
    await moveRight.tap();
    await page.waitForFunction((start) => { const player = window.__live?.player; return player !== null && player !== undefined && player.x > start.x; }, before.player, { timeout: 10_000 });
    const touchTrace = await page.evaluate(() => {
      type InputRecord = { readonly event: { readonly kind: string; readonly action?: string; readonly down?: boolean; readonly source?: string } };
      type TraceEntry = { readonly pointer?: string; readonly type?: string; readonly inputs?: readonly InputRecord[]; readonly consumed?: readonly InputRecord[] };
      return (window as Window & { __touchTrace?: readonly TraceEntry[] }).__touchTrace ?? [];
    });
    expect(touchTrace.some((entry) => entry.pointer === "down" && entry.type === "touch")).toBe(true);
    expect(touchTrace.some((entry) => entry.inputs?.some((input) => input.event.kind === "action" && input.event.action === "confirm" && input.event.down && input.event.source === "runner.fallback"))).toBe(true);
    expect(touchTrace.some((entry) => entry.consumed?.some((input) => input.event.kind === "action" && input.event.action === "confirm" && input.event.down && input.event.source === "runner.fallback"))).toBe(true);
    expect(touchTrace.some((entry) => entry.inputs?.some((input) => input.event.kind === "action" && input.event.action === "right" && input.event.down && input.event.source === "runner.fallback"))).toBe(true);
    expect(touchTrace.some((entry) => entry.consumed?.some((input) => input.event.kind === "action" && input.event.action === "right" && input.event.down && input.event.source === "runner.fallback"))).toBe(true);
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
        
    await page.getByRole("button", { name: "Move left" }).dispatchEvent("click");
    await expect(moveRight).toHaveAttribute("aria-pressed", "false");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[]; consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      return trace.some((entry) => entry.inputs?.some((input) => input.event.kind === "action" && input.event.action === "left" && input.event.down && input.event.source === "runner.fallback"))
        && trace.some((entry) => entry.consumed?.some((input) => input.event.kind === "action" && input.event.action === "left" && input.event.down && input.event.source === "runner.fallback"));
    }, undefined, { timeout: 10_000 });
    await page.locator("#screen").focus();
    await page.keyboard.down("ArrowRight");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; code?: string; down?: boolean } }[] }[] }).__touchTrace ?? [];
      return trace.some((entry) => entry.inputs?.some((input) => input.event.kind === "key" && input.event.code === "ArrowRight" && input.event.down === true));
    }, undefined, { timeout: 10_000 });
    await moveRight.focus();
    await page.keyboard.up("ArrowRight");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; code?: string; down?: boolean } }[] }[] }).__touchTrace ?? [];
      return trace.some((entry) => entry.inputs?.some((input) => input.event.kind === "key" && input.event.code === "ArrowRight" && input.event.down === false));
    }, undefined, { timeout: 10_000 });

    const spaceTick = await page.evaluate(() => window.__live?.tick ?? 0);
    await moveRight.focus();
    await page.keyboard.down("Space");
    await page.locator("#screen").focus();
    await page.evaluate(() => {
      document.querySelector("#screen")?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true }));
    });
    await page.keyboard.up("Space");
    await page.waitForFunction((tick) => window.__live !== undefined && window.__live.tick > tick, spaceTick, { timeout: 10_000 });
    const leakedSpaceEvents = await page.evaluate(() => {
      const trace = (window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; code?: string } }[] }[] }).__touchTrace ?? [];
      return trace.flatMap((entry) => entry.inputs ?? []).filter((input) => input.event.kind === "key" && input.event.code === "Space").length;
    });
    expect(leakedSpaceEvents).toBe(0);

    const preDoubleTapTick = await page.evaluate(() => window.__live?.tick ?? 0);
    await page.waitForFunction((tick) => window.__live !== undefined && window.__live.tick >= tick + 30, preDoubleTapTick, { timeout: 10_000 });
    await page.evaluate(() => {
      const windowWithTrace = window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[]; consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] };
      windowWithTrace.__touchTrace = [];
      const button = document.querySelector<HTMLButtonElement>('[aria-label="Move right"]');
      if (button === null) throw new Error("fallback Move right button is missing");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    await expect(moveRight).toHaveAttribute("aria-pressed", "false");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[]; consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      const inputEdges = trace.flatMap((entry) => entry.inputs ?? [])
        .filter((input) => input.event.kind === "action" && input.event.action === "right" && input.event.source === "runner.fallback")
        .map((input) => input.event.down);
      const consumedEdges = trace.flatMap((entry) => entry.consumed ?? [])
        .filter((input) => input.event.kind === "action" && input.event.action === "right" && input.event.source === "runner.fallback")
        .map((input) => input.event.down);
      return inputEdges.length >= 3 && consumedEdges.length >= 3;
    }, undefined, { timeout: 10_000 });
    const doubleTapEdges = await page.evaluate(() => {
      const trace = (window as Window & { __touchTrace?: readonly { inputs?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[]; consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      const edges = (entries: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[]): (boolean | undefined)[] => entries
        .filter((entry) => entry.event.kind === "action" && entry.event.action === "right" && entry.event.source === "runner.fallback")
        .map((entry) => entry.event.down);
      return {
        input: edges(trace.flatMap((entry) => entry.inputs ?? [])),
        consumed: edges(trace.flatMap((entry) => entry.consumed ?? [])),
      };
    });
    expect(doubleTapEdges.input.slice(0, 3)).toEqual([true, false, true]);
    expect(doubleTapEdges.consumed.slice(0, 3)).toEqual([true, false, true]);
    await expect(moveRight).toHaveAttribute("aria-pressed", "false");

    const settledTick = await page.evaluate(() => window.__live?.tick ?? 0);
    await page.waitForFunction((tick) => window.__live !== undefined && window.__live.tick >= tick + 30, settledTick, { timeout: 10_000 });
    const beforeCancelledHold = await page.evaluate(() => ({ player: window.__live?.player ?? null, tick: window.__live?.tick ?? 0 }));
    if (beforeCancelledHold.player === null) throw new Error("live player position is not available");
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[aria-label="Move up"]');
      if (button === null) throw new Error("fallback Move up button is missing");
      Object.defineProperty(button, "setPointerCapture", { value: () => undefined, configurable: true });
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 902, pointerType: "touch", button: 0 }));
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction((tick) => window.__live !== undefined && window.__live.tick >= tick + 30, beforeCancelledHold.tick, { timeout: 10_000 });
    const afterCancelledHold = await page.evaluate(() => window.__live?.player ?? null);
    expect(afterCancelledHold).toEqual(beforeCancelledHold.player);

    const moveUp = page.getByRole("button", { name: "Move up" });
    const beforeActiveUp = await page.evaluate(() => window.__live?.player ?? null);
    if (beforeActiveUp === null) throw new Error("live player position is not available");
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[aria-label="Move up"]');
      if (button === null) throw new Error("fallback Move up button is missing");
      Object.defineProperty(button, "setPointerCapture", { value: () => undefined, configurable: true });
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 903, pointerType: "touch", button: 0 }));
    });
    await page.waitForFunction((start) => {
      const player = window.__live?.player;
      return player !== null && player !== undefined && (player.x !== start.x || player.y !== start.y);
    }, beforeActiveUp, { timeout: 10_000 });
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Move up"]')
        ?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 903, pointerType: "touch", button: 0 }));
    });
    await expect(moveUp).toHaveAttribute("aria-pressed", "false");
    const settleActiveTick = await page.evaluate(() => window.__live?.tick ?? 0);
    await page.waitForFunction((tick) => window.__live !== undefined && window.__live.tick >= tick + 30, settleActiveTick, { timeout: 10_000 });
    const beforePointerCancel = await page.evaluate(() => ({ player: window.__live?.player ?? null, tick: window.__live?.tick ?? 0 }));
    if (beforePointerCancel.player === null) throw new Error("live player position is not available");
    await page.evaluate(() => {
      const windowWithTrace = window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] };
      windowWithTrace.__touchTrace = [];
      const button = document.querySelector<HTMLButtonElement>('[aria-label="Move up"]');
      if (button === null) throw new Error("fallback Move up button is missing");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 904, pointerType: "touch", button: 0 }));
      button.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 904, pointerType: "touch", button: 0 }));
    });
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      return trace.some((entry) => {
        const edges = (entry.consumed ?? [])
          .filter((input) => input.event.kind === "action" && input.event.action === "up" && input.event.source === "runner.fallback")
          .map((input) => input.event.down);
        return edges.includes(true) && edges.includes(false);
      });
    }, undefined, { timeout: 10_000 });
    const cancelBatchEdges = await page.evaluate(() => {
      const trace = (window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      const entry = trace.find((candidate) => {
        const edges = (candidate.consumed ?? [])
          .filter((input) => input.event.kind === "action" && input.event.action === "up" && input.event.source === "runner.fallback")
          .map((input) => input.event.down);
        return edges.includes(true) && edges.includes(false);
      });
      return (entry?.consumed ?? [])
        .filter((input) => input.event.kind === "action" && input.event.action === "up" && input.event.source === "runner.fallback")
        .map((input) => input.event.down);
    });
    expect(cancelBatchEdges).toEqual([true, false]);
    const afterPointerCancel = await page.evaluate(() => window.__live?.player ?? null);
    expect(afterPointerCancel).toEqual(beforePointerCancel.player);

    await page.evaluate(() => {
      const windowWithTrace = window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] };
      windowWithTrace.__touchTrace = [];
    });
    await moveUp.focus();
    await page.keyboard.down("Space");
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[aria-label="Move up"]');
      if (button === null) throw new Error("fallback Move up button is missing");
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 905, pointerType: "touch", button: 0 }));
      button.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 905, pointerType: "touch", button: 0 }));
    });
    await expect(moveUp).toHaveAttribute("aria-pressed", "true");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      return trace.some((entry) => entry.consumed?.some((input) => input.event.kind === "action" && input.event.action === "up" && input.event.down === true && input.event.source === "runner.fallback"));
    }, undefined, { timeout: 10_000 });
    const heldAfterPointerCancel = await page.evaluate(() => {
      const trace = (window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      return trace.flatMap((entry) => entry.consumed ?? [])
        .filter((input) => input.event.kind === "action" && input.event.action === "up" && input.event.source === "runner.fallback")
        .map((input) => input.event.down);
    });
    expect(heldAfterPointerCancel).toEqual([true]);
    await page.keyboard.up("Space");
    await expect(moveUp).toHaveAttribute("aria-pressed", "false");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchTrace?: readonly { consumed?: readonly { event: { kind: string; action?: string; down?: boolean; source?: string } }[] }[] }).__touchTrace ?? [];
      return trace.flatMap((entry) => entry.consumed ?? [])
        .some((input) => input.event.kind === "action" && input.event.action === "up" && input.event.down === false && input.event.source === "runner.fallback");
    }, undefined, { timeout: 10_000 });
  } finally {
    await closeLiveSession(page);
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
    await closeLiveSession(page);
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
    await closeLiveSession(page);
    await context.close();
  }
});

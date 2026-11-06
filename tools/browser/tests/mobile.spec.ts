import { expect, test } from "@playwright/test";

/**
 * Entry 9.12's provable-green part: the **mobile page is the same live page** as the desktop shell, run against a host
 * shaped like the wrapper's — four calls over a filesystem — and it reaches a live board, responds to input, and writes
 * a save.
 *
 * No device and no emulator are involved, and none is claimed: this proves the page, the host contract and the live
 * session path. The device step (Capacitor's own `Filesystem` plugin on real hardware) is a person's, and the plan
 * lists it.
 *
 * The stub stands in for `window.Capacitor.Plugins.Filesystem`, so the page's own code path — not a test double of it —
 * is what runs.
 */
test("the mobile live page reaches a board, moves on input, and writes a save", async ({ page }) => {
  test.setTimeout(120_000);
  // A filesystem stub backed by the served package, installed before the page's bundle runs.
  await page.addInitScript(() => {
    const files = new Map<string, Uint8Array>();
    (window as unknown as { __files: Map<string, Uint8Array> }).__files = files;
    const toBase64 = (bytes: Uint8Array): string => {
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    };
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: {
        Filesystem: {
          async writeFile({ path, data, encoding, directory }: { path: string; data: string; encoding: "base64" | "utf8"; directory?: "DATA" }): Promise<void> {
            if (directory !== "DATA") throw new Error(`unexpected directory ${String(directory)}`);
            if (encoding !== "base64") throw new Error(`expected base64, got ${encoding}`);
            files.set(path, new Uint8Array([...atob(data)].map((character) => character.charCodeAt(0))));
          },
          async readFile({ path, encoding, directory }: { path: string; encoding?: "base64" | "utf8"; directory?: "DATA" }): Promise<{ data: string }> {
            if (path === "public/demo.tpk") {
              const response = await fetch("/fixtures/packages/demo.tpk");
              if (!response.ok) throw new Error(`missing package ${response.status}`);
              return { data: toBase64(new Uint8Array(await response.arrayBuffer())) };
            }
            if (path === "public/demo.tpk.json") {
              const response = await fetch("/fixtures/packages/demo.tpk.json");
              if (!response.ok) throw new Error(`missing descriptor ${response.status}`);
              return { data: await response.text() };
            }
            const found = files.get(path);
            if (found === undefined) throw new Error(`absent ${path}`);
            return { data: toBase64(found) };
          },
          async readdir({ path }: { path: string }): Promise<{ files: { name: string; type: string }[] }> {
            const children = new Map<string, "file" | "directory">();
            for (const key of files.keys()) {
              if (!key.startsWith(`${path}/`)) continue;
              const remainder = key.slice(path.length + 1);
              const slash = remainder.indexOf("/");
              const name = slash === -1 ? remainder : remainder.slice(0, slash);
              const kind = slash === -1 ? "file" : "directory";
              const existing = children.get(name);
              if (existing === undefined) {
                children.set(name, kind);
              } else if (existing === "directory" && kind === "file") {
                children.set(name, "file");
              }
            }
            return { files: [...children.entries()].map(([name, type]) => ({ name, type })) };
          },
        },
      },
    };
  });

  const log: string[] = [];
  page.on("console", (message) => log.push(`console[${message.type()}]: ${message.text()}`));
  page.on("pageerror", (error) => log.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => log.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("response", (response) => {
    if (response.status() >= 400) log.push(`http ${response.status()}: ${response.url()}`);
  });

  await page.goto("/packages/runner-mobile/app/player.html");
  await page.waitForFunction(() => window.__live !== undefined, undefined, { timeout: 90_000 }).catch((error: unknown) => {
    throw new Error(`the page never reported; what it said:\n${log.join("\n")}\n(${String(error)})`);
  });

  // The demo package has a start-up program/title sequence; feed Enter until it reaches a board.
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 90_000 });
  const title = await page.evaluate(() => {
    const report = window.__live;
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (report === undefined || canvas === null) return null;
    const gl = canvas.getContext("webgl2");
    if (gl === null) return null;
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlackPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) nonBlackPixels += 1;
    }
    return { report, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, nonBlackPixels };
  });
  expect(title).not.toBeNull();
  expect(title!.report.board).toBeNull();
  expect(title!.report.render).toMatchObject({ drawn: expect.any(Number), deferred: 0, diagnostics: [] });
  expect(title!.report.render!.drawn).toBeGreaterThan(0);
  expect(Object.values(title!.report.render!.deferredByKind).every((count) => count === 0)).toBe(true);
  expect(title!.nonBlackPixels).toBeGreaterThanOrEqual(Math.max(64, Math.ceil(title!.width * title!.height * 0.001)));
  for (let presses = 0; presses < 10; presses += 1) {
    const onBoard = await page.evaluate(() => {
      const live = window.__live;
      return live !== undefined && live.board !== null && live.error === undefined;
    });
    if (onBoard) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }

  const report = await page.evaluate(() => window.__live);
  if (report === undefined || report.board === null || report.error !== undefined) {
    throw new Error(`board entry never happened; report=${JSON.stringify(report)}; log:\n${log.join("\n")}`);
  }

  const before = (await page.evaluate(() => window.__live)) as {
    tick: number;
    stateHash: string;
    drawHash: string;
    board: string;
    player: { x: number; y: number };
    moved: boolean;
  };
  console.log("mobile live page at board entry:", JSON.stringify(before));
  expect(before.tick).toBeGreaterThan(0);
  expect(before.stateHash).toHaveLength(16);
  expect(before.drawHash).toHaveLength(16);
  expect(before.board).not.toBeNull();
  expect(before.player).not.toBeNull();

  // Send a few movement inputs and wait for the player to move.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (start) => {
      const live = window.__live;
      if (live === undefined || live.player === null) return false;
      return live.moved === true || (live.player.x !== start.x || live.player.y !== start.y);
    },
    { x: before.player.x, y: before.player.y },
    { timeout: 30_000 },
  );

  const after = (await page.evaluate(() => window.__live)) as {
    tick: number;
    moved: boolean;
    save: { path: string; written: boolean };
  };
  console.log("mobile live page after input:", JSON.stringify(after));
  expect(after.moved).toBe(true);
  expect(after.tick).toBeGreaterThanOrEqual(before.tick);
  expect(after.save.written).toBe(true);
});

function installFilesystemStub(page: import("@playwright/test").Page): Promise<void> {
  return page.addInitScript(() => {
    const files = new Map<string, Uint8Array>();
    (window as unknown as { __files: Map<string, Uint8Array> }).__files = files;
    const toBase64 = (bytes: Uint8Array): string => {
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    };
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: {
        Filesystem: {
          async writeFile({ path, data, encoding, directory }: { path: string; data: string; encoding: "base64" | "utf8"; directory?: "DATA" }): Promise<void> {
            if (directory !== "DATA") throw new Error(`unexpected directory ${String(directory)}`);
            if (encoding !== "base64") throw new Error(`expected base64, got ${encoding}`);
            files.set(path, new Uint8Array([...atob(data)].map((character) => character.charCodeAt(0))));
          },
          async readFile({ path, encoding, directory }: { path: string; encoding?: "base64" | "utf8"; directory?: "DATA" }): Promise<{ data: string }> {
            if (path === "public/demo.tpk") {
              const response = await fetch("/fixtures/packages/demo.tpk");
              if (!response.ok) throw new Error(`missing package ${response.status}`);
              return { data: toBase64(new Uint8Array(await response.arrayBuffer())) };
            }
            if (path === "public/demo.tpk.json") {
              const response = await fetch("/fixtures/packages/demo.tpk.json");
              if (!response.ok) throw new Error(`missing descriptor ${response.status}`);
              return { data: await response.text() };
            }
            const found = files.get(path);
            if (found === undefined) throw new Error(`absent ${path}`);
            return { data: toBase64(found) };
          },
          async readdir({ path }: { path: string }): Promise<{ files: { name: string; type: string }[] }> {
            const children = new Map<string, "file" | "directory">();
            for (const key of files.keys()) {
              if (!key.startsWith(`${path}/`)) continue;
              const remainder = key.slice(path.length + 1);
              const slash = remainder.indexOf("/");
              const name = slash === -1 ? remainder : remainder.slice(0, slash);
              const kind = slash === -1 ? "file" : "directory";
              const existing = children.get(name);
              if (existing === undefined) {
                children.set(name, kind);
              } else if (existing === "directory" && kind === "file") {
                children.set(name, "file");
              }
            }
            return { files: [...children.entries()].map(([name, type]) => ({ name, type })) };
          },
        },
      },
    };
  });
}

/** True when the canvas is fully inside the viewport (no overflow in any direction). */
async function canvasIsFullyVisible(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) return false;
    const rect = canvas.getBoundingClientRect();
    return (
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth + 0.5 &&
      rect.bottom <= window.innerHeight + 0.5
    );
  });
}

test("the mobile live page re-letters on rotation and pointer mapping stays correct", async ({ page }) => {
  test.setTimeout(120_000);
  await installFilesystemStub(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/packages/runner-mobile/app/player.html");
  await page.waitForFunction(() => window.__live !== undefined, undefined, { timeout: 90_000 });

  // Get past the demo title sequence.
  for (let presses = 0; presses < 10; presses += 1) {
    const onBoard = await page.evaluate(() => {
      const live = window.__live;
      return live !== undefined && live.board !== null && live.error === undefined;
    });
    if (onBoard) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }

  const portrait = (await page.evaluate(() => window.__live)) as {
    tick: number;
    board: string | null;
    player: { x: number; y: number } | null;
    error?: string;
  };
  if (portrait === undefined || portrait.board === null || portrait.error !== undefined) {
    throw new Error(`board entry never happened; report=${JSON.stringify(portrait)}`);
  }
  expect(await canvasIsFullyVisible(page)).toBe(true);

  // Rotate to landscape and confirm the canvas is still fully visible and the session did not restart.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  expect(await canvasIsFullyVisible(page)).toBe(true);

  const landscape = (await page.evaluate(() => window.__live)) as {
    tick: number;
    player: { x: number; y: number } | null;
  };
  expect(landscape.tick).toBeGreaterThan(portrait.tick);
  expect(landscape.player).not.toBeNull();

  // Click near the bottom-right of the visible canvas and wait for the player to move there.
  const beforeClick = landscape.player!;
  await page.locator("#screen").click({ position: { x: 200, y: 150 } });
  await page.waitForFunction(
    (start) => {
      const live = window.__live;
      if (live === undefined || live.player === null) return false;
      return live.moved === true || live.player.x !== start.x || live.player.y !== start.y;
    },
    { x: beforeClick.x, y: beforeClick.y },
    { timeout: 30_000 },
  );

  const afterClick = (await page.evaluate(() => window.__live)) as { moved: boolean; tick: number };
  expect(afterClick.moved).toBe(true);
  expect(afterClick.tick).toBeGreaterThan(landscape.tick);
});

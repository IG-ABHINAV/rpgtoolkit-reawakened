import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  BinaryReader,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readDistributionManifest,
  readMainFile,
  writeDistributionPackage,
  writeMainFile,
} from "@tk-reawakened/core";

declare global {
  interface Window { liveAnalyser?: AnalyserNode }
}

type LiveReport = { tick: number; stateHash: string; drawHash: string; player: { x: number; y: number } | null; error?: string };
type LiveFixture = { readonly name: string; readonly packageBytes: Uint8Array; readonly descriptor: Record<string, unknown> };

/**
 * The generated demo package with its main file rewritten to carry no start-up program, so nothing can add a player
 * during step 7 and only the initial-character step can
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence steps 6 and 8).
 */
function packageWithoutStartupProgram(name: string): LiveFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const main = manifest.value.main;
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json").map((file) => ({ path: file.path, bytes: file.bytes }));
  const gameMain = files.find((file) => file.path === main);
  if (gameMain === undefined) throw new Error(`the demo package has no ${main}`);
  const parsed = readMainFile(new BinaryReader(gameMain.bytes, main));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const cleared = writeMainFile({ ...parsed.value, startupPrg: "" });
  if (!cleared.ok) throw new Error(cleared.error.message);
  const tree = files.map((file) => (file.path === main ? { path: file.path, bytes: cleared.value } : file));
  const written = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main, index: tree.map((file) => file.path) } });
  if (!written.ok) throw new Error(written.error.message);
  return {
    name,
    packageBytes: written.value,
    descriptor: {
      schema: 1,
      file: name,
      sha256: createHash("sha256").update(written.value).digest("hex"),
      size: written.value.length,
      gameId: deriveGameId(cleared.value, derivePackageIdentity(tree)),
      title: "Empty start-up",
      version: "1",
    },
  };
}

/** Serve one generated package and its install descriptor where the player page asks for them. */
async function servePackage(page: Page, fixture: LiveFixture): Promise<void> {
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

test("live demo attaches a board canvas and movement changes the player and presented frame", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  for (const tick of [30, 60, 90]) {
    await page.waitForFunction((point) => (window.__live?.tick ?? 0) >= point, tick, { timeout: 45_000 });
    await page.keyboard.press("Enter");
  }
  await page.waitForFunction(
    () => ((window.__live?.tick ?? 0) >= 120 && window.__live?.board !== null) || window.__live?.error !== undefined,
    undefined,
    { timeout: 45_000 },
  );
  const first = await page.evaluate(() => window.__live as LiveReport);
  expect(first.error).toBeUndefined();
  if (first.player === null) throw new Error("live demo did not expose the selected player position");
  const readCanvas = () => page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null || !document.contains(canvas)) return null;
    const gl = canvas.getContext("webgl2");
    if (gl === null) return null;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlack = 0;
    let frameHash = 2166136261;
    for (let i = 0; i < pixels.length; i += 1) {
      frameHash = Math.imul(frameHash ^ pixels[i]!, 16777619);
      if (i % 4 === 0 && (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0)) nonBlack += 1;
    }
    return { width: canvas.width, height: canvas.height, nonBlack, frameHash };
  });
  const canvasInfo = await readCanvas();
  expect(canvasInfo).not.toBeNull();
  expect(canvasInfo?.width).toBe(640);
  expect(canvasInfo?.height).toBe(480);
  expect(canvasInfo?.nonBlack ?? 0).toBeGreaterThan(1000);
  await page.locator("#screen").focus();

  // Holding a direction key must walk continuously, not stop after one tile. Hold long enough
  // for at least two 32-pixel tiles (the exact one-tile tap behaviour is covered by the core
  // unit test; here we prove the real browser runner keeps queueing steps while held).
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction((initial) => {
      const player = window.__live?.player;
      return player !== null && player !== undefined && player.x >= initial.x + 64;
    }, first.player, { timeout: 10_000 });
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  const moved = await page.evaluate(() => window.__live as LiveReport);
  expect(moved.error).toBeUndefined();
  expect(moved.player).not.toBeNull();
  expect(moved.player!.x).toBeGreaterThanOrEqual(first.player.x + 64);
  expect(moved.player!.y).toBe(first.player.y);

  const movedFrame = await readCanvas();
  expect(movedFrame?.frameHash).not.toBe(canvasInfo?.frameHash);
});

test("an interactive package with an initial character and no start-up program reaches its board", async ({ page }) => {
  const fixture = packageWithoutStartupProgram("empty-startup.tpk");
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => window.__live !== undefined, undefined, { timeout: 45_000 });
  await page.waitForFunction(() => (window.__live?.tick ?? 0) > 0 || window.__live?.error !== undefined, undefined, { timeout: 45_000 });
  const live = await page.evaluate(() => window.__live as LiveReport);
  expect(live.error).toBeUndefined();
  // A refused presence check stops the engine during boot, which runs no ticks and reports no player, so ticks
  // advancing with a selected player is this package reaching its initial board with only E-02's initial character.
  expect(live.tick).toBeGreaterThan(0);
  expect(live.player).not.toBeNull();
});

test("focus loss pauses live ticks and focus gain resumes them", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(500);
  const pausedTick = await page.evaluate(() => window.__live?.tick ?? -1);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__live?.tick ?? -2)).toBe(pausedTick);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction((tick) => (window.__live?.tick ?? -1) > tick, pausedTick, { timeout: 5_000 });
});

test("the live player sends title music to the Web Audio graph", async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, output, input) {
      if ((this instanceof AudioWorkletNode || this instanceof ScriptProcessorNode) && window.liveAnalyser === undefined) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        original.call(this, analyser);
        window.liveAnalyser = analyser;
      }
      return original.call(this, destination, output, input);
    };
  });
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const analyser = window.liveAnalyser;
    if (analyser === undefined) return false;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return samples.some((sample) => Math.abs(sample) > 0.001);
  }, undefined, { timeout: 45_000 });
});

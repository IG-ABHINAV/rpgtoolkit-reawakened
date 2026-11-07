import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  BinaryReader,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readDistributionManifest,
  readMainFile,
  writeBoard,
  writeCharacter,
  writeDistributionPackage,
  writeMainFile,
} from "@tk-reawakened/core";

declare global {
  interface Window {
    liveAnalyser?: AnalyserNode;
    __session?: {
      tick(): number;
      viewSize(): { readonly width: number; readonly height: number };
      displayGeometry(): {
        readonly content: { readonly width: number; readonly height: number };
        readonly game: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      };
      advance(ticks: number, inputs?: readonly {
        tick: number;
        event: { kind: "key"; name: string; code: string; char: null; down: boolean };
      }[]): Promise<void>;
    };
  }
}

type LiveReport = {
  tick: number; stateHash: string; drawHash: string; player: { x: number; y: number } | null; board: string | null; error?: string;
  /** The engine's located diagnostics so far, so a probe can assert a report by code. */
  diagnostics?: readonly { code: string; file: string; line: number; message: string }[];
};
type LiveFixture = { readonly name: string; readonly packageBytes: Uint8Array; readonly descriptor: Record<string, unknown> };

/**
 * The generated demo package with its main file rewritten to carry no start-up program, so nothing can add a player
 * during step 7 and only the initial-character step can
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence steps 6 and 8).
 */
function packageWithoutStartupProgram(name: string, pixelMovement?: number, startupProgram?: string): LiveFixture {
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
  const startupPath = startupProgram === undefined ? "" : "host-resize.prg";
  const cleared = writeMainFile({ ...parsed.value, startupPrg: startupPath, pixelMovement: pixelMovement ?? parsed.value.pixelMovement });
  if (!cleared.ok) throw new Error(cleared.error.message);
  const tree = files.map((file) => (file.path === main ? { path: file.path, bytes: cleared.value } : file));
  if (startupProgram !== undefined) tree.push({ path: `Prg/${startupPath}`, bytes: new TextEncoder().encode(startupProgram) });
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
      title: startupProgram === undefined ? "Empty start-up" : "Host resize test",
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

function triggerPhaseFixture(
  name: string,
  boards: { readonly path: string; readonly regions: readonly { readonly program: string; readonly activationType: number }[] }[],
  programs: Record<string, string> = {},
): LiveFixture {
  const emptyBoard = createEmptyBoard();
  const boardBytes = (regions: readonly { readonly program: string; readonly activationType: number }[]): Uint8Array => {
    const cells = 8 * 8;
    const written = writeBoard({
      ...emptyBoard,
      sizeX: 8,
      sizeY: 8,
      sizeL: 1,
      tileMatrix: Array.from({ length: cells }, () => 0),
      tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
      threads: [],
      layerTitles: ["", ""],
      programs: regions.map(({ program, activationType }, index) => {
        // One closed 128x64 region around the start tile (2, 2) at (64, 64): the player's 30x15
        // collision base stays inside it until roughly 40 px of walking takes it out.
        const points = [{ x: 16, y: 31 }, { x: 80, y: 31 }, { x: 80, y: 95 }, { x: 16, y: 95 }];
        return {
          program,
          graphic: "",
          initialVar: "",
          initialValue: "",
          finalVar: "",
          finalValue: "",
          activate: 0,
          activationType,
          repeatDistance: 0,
          layer: 1,
          points,
          closed: 1,
          handle: `region-${name}-${index}`,
        };
      }),
      properties: {
        ...emptyBoard.properties,
        enterPrg: "",
        start: { x: 64, y: 64, layer: 1 },
      },
    });
    if (!written.ok) throw new Error(written.error.message);
    return written.value;
  };
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "wait-for-start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
  };
  const writtenMain = writeMainFile(main);
  if (!writtenMain.ok) throw new Error(writtenMain.error.message);
  const writtenCharacter = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
  });
  if (!writtenCharacter.ok) throw new Error(writtenCharacter.error.message);
  const tree = [
    { path: "Main/test.gam", bytes: writtenMain.value },
    ...boards.map((board) => ({ path: `Boards/${board.path}`, bytes: boardBytes(board.regions) })),
    { path: "Prg/wait-for-start.prg", bytes: new TextEncoder().encode("wait()\nend()\n") },
    { path: "Prg/send-third.prg", bytes: new TextEncoder().encode('send("third.brd", 2, 2, 1)\nend()\n') },
    ...Object.entries(programs).map(([file, text]) => ({ path: `Prg/${file}`, bytes: new TextEncoder().encode(text) })),
    { path: "Chrs/hero.tem", bytes: writtenCharacter.value },
  ];
  const writtenPackage = writeDistributionPackage({
    files: tree,
    manifest: { schema: 1, main: "Main/test.gam", index: tree.map((file) => file.path) },
  });
  if (!writtenPackage.ok) throw new Error(writtenPackage.error.message);
  return {
    name,
    packageBytes: writtenPackage.value,
    descriptor: {
      schema: 1,
      file: name,
      sha256: createHash("sha256").update(writtenPackage.value).digest("hex"),
      size: writtenPackage.value.length,
      gameId: deriveGameId(writtenMain.value, derivePackageIdentity(tree)),
      title: "Trigger phase probe",
      version: "1",
    },
  };
}

test("the demo cursor-map hand is visible and follows the selected menu row", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => (window.__live?.tick ?? 0) > 30, undefined, { timeout: 45_000 });
  const handPixels = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    const session = window.__session;
    const gl = canvas?.getContext("webgl2");
    if (canvas === null || session === undefined || gl === null || gl === undefined) {
      throw new Error("live player canvas, WebGL context, or session is unavailable");
    }
    const view = session.viewSize();
    const { game } = session.displayGeometry();
    const scaleX = game.width / view.width;
    const scaleY = game.height / view.height;
    const pixelEdge = (gameOffset: number, logicalOffset: number, scale: number): number =>
      Math.ceil(gameOffset + logicalOffset * scale - 0.5);
    const count = (logicalY: number): number => {
      const left = pixelEdge(game.x, 255, scaleX);
      const right = pixelEdge(game.x, 287, scaleX);
      const top = pixelEdge(game.y, logicalY, scaleY);
      const bottom = pixelEdge(game.y, logicalY + 20, scaleY);
      const width = right - left;
      const height = bottom - top;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(left, canvas.height - bottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! > 150 && pixels[i + 1]! > 150 && pixels[i + 2]! > 150) bright += 1;
      }
      return bright;
    };
    return { first: count(170), second: count(210) };
  });
  await expect.poll(async () => (await handPixels()).first).toBeGreaterThan(10);
  expect((await handPixels()).second).toBe(0);
  await page.locator("#screen").focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await handPixels()).second).toBeGreaterThan(10);
  expect((await handPixels()).first).toBe(0);
});

for (const mode of [0, 1, 2] as const) {
  test(`live player uses main-file movement mode ${mode}`, async ({ page }) => {
    const fixture = packageWithoutStartupProgram(`movement-mode-${mode}.tpk`, mode);
    await servePackage(page, fixture);
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
    await page.waitForFunction(() => window.__live?.player != null && (window.__live?.tick ?? 0) > 30, undefined, { timeout: 45_000 });
    const initial = await page.evaluate(() => window.__live as LiveReport);
    if (initial.player === null) throw new Error("live player did not appear");
    await page.evaluate(async () => {
      // Pin key-down and key-up to adjacent simulation ticks in the actual live session. The
      // browser frame loop may run between host calls, but session.advance serializes those
      // calls; there is no wall-clock hold interval to affect how many movement steps are queued.
      const session = window.__session;
      if (session === undefined) throw new Error("live session was not exposed");
      await session.advance(0);
      let tick = session.tick();
      await session.advance(1, [{
        tick,
        event: { kind: "key", name: "ARROWRIGHT", code: "ArrowRight", char: null, down: true },
      }]);
      tick = session.tick();
      await session.advance(1, [{
        tick,
        event: { kind: "key", name: "ARROWRIGHT", code: "ArrowRight", char: null, down: false },
      }]);
      await session.advance(120);
    });
    const expectedDistance = mode === 0 ? 32 : 4;
    await page.waitForFunction(({ x, distance }) => window.__live?.player?.x === x + distance, {
      x: initial.player.x,
      distance: expectedDistance,
    }, { timeout: 10_000 });
    const final = await page.evaluate(() => window.__live as LiveReport);
    expect(final.player?.y).toBe(initial.player.y);
    expect(final.player?.x).toBe(initial.player.x + expectedDistance);
  });
}

test("the packaged demo opens the stock menu with Enter", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => (window.__live?.tick ?? 0) > 30, undefined, { timeout: 45_000 });
  for (const tick of [30, 60]) {
    await page.waitForFunction((point) => (window.__live?.tick ?? 0) >= point, tick, { timeout: 45_000 });
    await page.keyboard.press("Enter");
  }
  await page.waitForFunction(() => window.__live?.board !== null && window.__live?.player !== null, undefined, { timeout: 45_000 });
  // The main screen's initial Items selection fills its first row with the stock blue focus bar.
  // Sample the middle of that exact row, not just any blue pixel elsewhere in the game.
  const itemsFocused = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    const gl = canvas?.getContext("webgl2");
    if (canvas === null || canvas === undefined || gl === null || gl === undefined) return false;
    const scale = Math.floor(Math.min(canvas.width / 640, canvas.height / 480));
    if (scale < 1) return false;
    const y = Math.floor((canvas.height - 480 * scale) / 2 + (480 - 155 + 12) * scale);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2), canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0] === 40 && pixel[1] === 64 && pixel[2] === 140;
  });
  expect(await itemsFocused()).toBe(false);
  await page.keyboard.press("Enter");
  await expect.poll(itemsFocused, { timeout: 45_000 }).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(itemsFocused, { timeout: 45_000 }).toBe(false);
  const report = await page.evaluate(() => window.__live as LiveReport);
  expect(report.diagnostics ?? []).toEqual([]);
});

test("live demo attaches a board canvas and movement changes the player and presented frame", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  for (const tick of [30, 60]) {
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
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    const session = window.__session;
    if (canvas === null || !document.contains(canvas) || session === undefined) return null;
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
    return {
      width: canvas.width,
      height: canvas.height,
      logical: session.viewSize(),
      content: session.displayGeometry().content,
      nonBlack,
      frameHash,
    };
  });
  const canvasInfo = await readCanvas();
  expect(canvasInfo).not.toBeNull();
  expect(canvasInfo?.logical).toEqual({ width: 640, height: 480 });
  expect(canvasInfo?.width).toBe(Math.ceil(canvasInfo?.content.width ?? 0));
  expect(canvasInfo?.height).toBe(Math.ceil(canvasInfo?.content.height ?? 0));
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

test("live session flushes GPU surface cache after loading a same-id/revision save", async ({ page }) => {
  const script = [
    "rendernow(1)",
    "screen = cnvrendernow",
    "colorrgb(255, 0, 0)",
    "fillrect(0, 0, 640, 480, screen)",
    'Save("slot")',
    "wait()",
    'Load("slot")',
    "end()",
  ].join("\n");
  const fixture = packageWithoutStartupProgram("surface-restore-cache.tpk", undefined, script);
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => (window.__session?.tick() ?? 0) > 10 || window.__live?.error !== undefined, undefined, { timeout: 45_000 });
  const saveState = await page.evaluate(async () => {
    const session = window.__session!;
    const host = window.__blobHost!;
    return { tick: session.tick(), live: window.__live, paths: await host.list("saves", session.gameId) };
  });
  const savePath = saveState.paths.find((path) => path.toLowerCase().includes("slot"));
  if (savePath === undefined) throw new Error(`startup did not save the collision fixture: ${JSON.stringify(saveState)}`);
  const saved = await page.evaluate(async (path) => {
    const session = window.__session!;
    const host = window.__blobHost!;
    const bytes = await host.read("saves", session.gameId, path);
    if (bytes === null) throw new Error("saved surface snapshot is absent");
    const engine = session.engine;
    const command = engine.drawList().commands.find((entry) =>
      entry.kind === "blit" && typeof entry.source === "object" && entry.source !== null && "surface" in entry.source);
    if (command === undefined || command.kind !== "blit" || !("surface" in command.source)) {
      throw new Error("startup did not publish a surface-backed draw command");
    }
    const source = command.source;
    const state = JSON.parse(new TextDecoder().decode(bytes)) as {
      surfaces?: { entries?: Record<string, { rev: number; bitmap: { w: number; h: number; b64: string } }> };
    };
    const surface = state.surfaces?.entries?.[String(source.surface)];
    if (surface === undefined || surface.rev !== source.rev) {
      throw new Error(`save and live draw disagree on surface revision ${String(source.surface)}@${source.rev}`);
    }
    const binary = atob(surface.bitmap.b64);
    const rgba = new Uint8Array(binary.length);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = 0;
      rgba[index + 1] = 255;
      rgba[index + 2] = 0;
      rgba[index + 3] = 255;
    }
    let encoded = "";
    for (const byte of rgba) encoded += String.fromCharCode(byte);
    surface.bitmap.b64 = btoa(encoded);
    const changed = new TextEncoder().encode(JSON.stringify(state));
    const read = host.read.bind(host);
    let matchingReads = 0;
    host.read = async (area, gameId, requestedPath) => {
      const result = await read(area, gameId, requestedPath);
      if (area === "saves" && gameId === session.gameId && requestedPath === path && result !== null) {
        matchingReads += 1;
        return changed;
      }
      return result;
    };
    Object.assign(window, { __surfaceRestoreReadCount: () => matchingReads });
    return { surfaceId: String(source.surface), revision: source.rev, epoch: engine.surfaceCacheEpoch(), savedBytes: bytes.length };
  }, savePath);
  expect(saved.savedBytes).toBeGreaterThan(0);
  const initialRed = await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    const gl = canvas?.getContext("webgl2");
    if (canvas === null || canvas === undefined || gl === null || gl === undefined) return false;
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! > pixels[index + 1]! * 2 && pixels[index]! > 80) red += 1;
    }
    return red > 1_000 ? red : false;
  }, undefined, { timeout: 45_000 }).then((handle) => handle.jsonValue());
  expect(initialRed).toBeGreaterThan(1_000);

  await page.locator("#screen").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((before) => {
    const session = window.__session;
    return session !== undefined && session.engine.surfaceCacheEpoch() > before.epoch;
  }, saved, { timeout: 45_000 });
  const restored = await page.waitForFunction((before) => {
    const session = window.__session;
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    const gl = canvas?.getContext("webgl2");
    if (session === undefined || canvas === null || gl === null || gl === undefined) return false;
    const list = session.engine.drawList();
    const sameSurface = list.commands.some((command) =>
      command.kind === "blit" && typeof command.source === "object" && command.source !== null &&
      "surface" in command.source && String(command.source.surface) === before.surfaceId && command.source.rev === before.revision);
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let green = 0;
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 1]! > pixels[index]! * 2 && pixels[index + 1]! > 80) green += 1;
      if (pixels[index]! > pixels[index + 1]! * 2 && pixels[index]! > 80) red += 1;
    }
    return sameSurface && green > 1_000 && green > red ? { sameSurface, green, red, epoch: session.engine.surfaceCacheEpoch() } : false;
  }, saved, { timeout: 45_000 }).then((handle) => handle.jsonValue());
  expect(restored.sameSurface).toBe(true);
  expect(restored.green).toBeGreaterThan(1_000);
  expect(restored.green).toBeGreaterThan(restored.red);
  expect(restored.epoch).toBeGreaterThan(saved.epoch);
  const readCount = await page.evaluate(() =>
    (window as Window & { __surfaceRestoreReadCount?: () => number }).__surfaceRestoreReadCount?.() ?? 0);
  expect(readCount).toBeGreaterThan(0);
});

test("web runner consumes resize and device transitions and dispatches normalized script events", async ({ page }) => {
  await page.addInitScript(() => {
    let connected = false;
    const pad = {
      id: "host transition proof", index: 0, connected: true, mapping: "standard",
      axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0,
    };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => connected ? [pad] : [] });
    (window as Window & { __setHostTestGamepad?: (value: boolean) => void }).__setHostTestGamepad = (value) => { connected = value; };
  });
  const script = `
viewportResizeCount = 0
connectedCount = 0
disconnectedCount = 0
on(game, "viewportResized", (event) => {
  leftMargin = marginWidth("left")
  topInset = safeAreaInset("top")
  rightInset = safeAreaInset("right")
  bottomInset = safeAreaInset("bottom")
  leftInset = safeAreaInset("left")
  if (leftMargin == event.detail.marginLeft && leftMargin == 180 && topInset == event.detail.safeAreaTop && rightInset == event.detail.safeAreaRight && bottomInset == event.detail.safeAreaBottom && leftInset == event.detail.safeAreaLeft) {
    viewportResizeCount = viewportResizeCount + 1
    send("start.brd", 128, 128, 1)
  }
})
on(game, "device.connected", (event) => {
  if (event.detail.type == "gamepad") {
    connectedCount = connectedCount + 1
    send("start.brd", 192, 160, 1)
  }
})
on(game, "device.disconnected", (event) => {
  if (event.detail.type == "gamepad") {
    disconnectedCount = disconnectedCount + 1
    send("start.brd", 224, 160, 1)
  }
})
`;
  const fixture = packageWithoutStartupProgram("host-metrics.tpk", undefined, script);
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => window.__session !== undefined && window.__live !== undefined, undefined, { timeout: 45_000 });
  const initial = await page.evaluate(() => {
    type Consumed = { tick: number; event: { kind: string; connected?: boolean; geometry?: { content: { width: number; height: number }; game: { x: number; y: number; width: number; height: number }; safeArea: object } } };
    type Session = {
      hostState: { geometry: { content: { width: number; height: number }; game: { x: number; y: number; width: number; height: number }; safeArea: object } } | null;
      engine: object;
      tick: () => number;
      advance: (ticks: number, inputs?: readonly unknown[]) => Promise<unknown>;
    };
    type Probe = Window & {
      __session?: Session;
      __hostConsumed?: Consumed[];
      __heldTick?: number;
      __releaseHeldAdvance?: () => void;
    };
    const probe = window as Probe;
    const session = probe.__session;
    if (session === undefined || session.hostState === null) throw new Error("host geometry was not initialized");
    const engine = session.engine as { advance: (ticks: number, inputs: readonly unknown[]) => { consumed: readonly Consumed[] } };
    const advanceEngine = engine.advance.bind(engine);
    engine.advance = (ticks, inputs) => {
      const report = advanceEngine(ticks, inputs);
      probe.__hostConsumed = [...(probe.__hostConsumed ?? []), ...report.consumed];
      return report;
    };
    const advanceSession = session.advance.bind(session);
    let holdNextAdvance = true;
    session.advance = (ticks, inputs) => {
      if (!holdNextAdvance) return advanceSession(ticks, inputs);
      holdNextAdvance = false;
      probe.__heldTick = session.tick();
      return new Promise((resolve, reject) => {
        probe.__releaseHeldAdvance = () => {
          void advanceSession(ticks + 8, inputs).then(resolve, reject);
        };
      });
    };
    return session.hostState.geometry;
  });
  await page.waitForFunction(() => (window as Window & { __releaseHeldAdvance?: () => void }).__releaseHeldAdvance !== undefined, undefined, { timeout: 15_000 });
  const heldTick = await page.evaluate(() => (window as Window & { __heldTick?: number }).__heldTick ?? -1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    (window as Window & { __setHostTestGamepad?: (value: boolean) => void }).__setHostTestGamepad?.(true);
    const event = new Event("gamepadconnected");
    Object.defineProperty(event, "gamepad", { value: { index: 0 } });
    window.dispatchEvent(event);
  });
  await page.evaluate(() => (window as Window & { __releaseHeldAdvance?: () => void }).__releaseHeldAdvance?.());

  await page.waitForFunction(() => {
    const records = (window as Window & { __hostConsumed?: readonly { tick: number; event: { kind: string; connected?: boolean } }[] }).__hostConsumed;
    return records?.some((record) => record.event.kind === "gamepad" && record.event.connected === true) === true;
  }, undefined, { timeout: 15_000 });

  await page.waitForFunction(() => {
    const records = (window as Window & { __hostConsumed?: readonly { event: { kind: string; geometry?: { content: { width: number } } } }[] }).__hostConsumed;
    return records?.some((record) => record.event.kind === "host.display" && record.event.geometry?.content.width === 390) === true;
  }, undefined, { timeout: 15_000 });
  const deferredHostTicks = await page.evaluate(() => {
    const records = (window as Window & { __hostConsumed?: readonly { tick: number; event: { kind: string; connected?: boolean; geometry?: { content: { width: number } } } }[] }).__hostConsumed ?? [];
    return records.filter((record) => (record.event.kind === "gamepad" && record.event.connected === true) || (record.event.kind === "host.display" && record.event.geometry?.content.width === 390)).map((record) => record.tick);
  });
  expect(heldTick).toBeGreaterThanOrEqual(0);
  expect(deferredHostTicks.length).toBeGreaterThanOrEqual(2);
  expect(deferredHostTicks.every((tick) => tick > heldTick)).toBe(true);
  await page.waitForFunction(() => (window.__live?.player?.x ?? 0) === 192, undefined, { timeout: 15_000 });
  const narrow = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>("#stage")!;
    const canvas = document.querySelector<HTMLCanvasElement>("#screen")!;
    return {
      stageWidth: stage.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(narrow.stageWidth).toBeLessThanOrEqual(390);
  expect(narrow.canvasWidth).toBeLessThanOrEqual(narrow.stageWidth);
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.viewportWidth);
  const longReport = await page.evaluate(() => {
    const report = document.querySelector<HTMLElement>("#report")!;
    const previous = report.textContent;
    report.textContent = "x".repeat(90);
    const measured = { stage: document.querySelector<HTMLElement>("#stage")!.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth };
    report.textContent = previous;
    return measured;
  });
  expect(longReport.stage).toBeLessThanOrEqual(390);
  expect(longReport.scroll).toBeLessThanOrEqual(390);

  await page.evaluate(() => { document.querySelector<HTMLElement>("#stage")!.style.display = "none"; });
  await page.waitForTimeout(100);
  const hidden = await page.evaluate(() => ({
    hostDisplayCount: (window as Window & { __hostConsumed?: readonly { event: { kind: string; geometry?: { content: { width: number; height: number } } } }[] }).__hostConsumed?.filter((record) => record.event.kind === "host.display" && record.event.geometry?.content.width === 0).length ?? 0,
    error: window.__live?.error,
  }));
  expect(hidden.hostDisplayCount).toBe(0);
  expect(hidden.error).toBeUndefined();
  await page.evaluate(() => { document.querySelector<HTMLElement>("#stage")!.style.display = ""; });

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForFunction(() => {
    const records = (window as Window & { __hostConsumed?: readonly { event: { kind: string; geometry?: { content: { width: number } } } }[] }).__hostConsumed;
    return records?.some((record) => record.event.kind === "host.display" && record.event.geometry?.content.width === 1000) === true;
  }, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => (window.__live?.player?.x ?? 0) === 128, undefined, { timeout: 15_000 });
  const resized = await page.evaluate(() => {
    type Probe = Window & {
      __hostConsumed?: readonly { tick: number; event: { kind: string; geometry?: { content: { width: number; height: number }; game: { x: number; y: number; width: number; height: number }; safeArea: object } } }[];
      viewportResizeCount?: number;
    };
    const probe = window as Probe;
    const event = probe.__hostConsumed?.filter((record) => record.event.kind === "host.display" && record.event.geometry?.content.width === 1000).at(-1);
    return { event, marginWidth: Math.floor((event?.event.geometry?.game.x ?? 0) / ((event?.event.geometry?.game.width ?? 640) / 640)), player: window.__live?.player };
  });
  expect(resized.event).toBeDefined();
  expect(resized.event?.tick).toBeGreaterThan(0);
  expect(resized.event?.event.geometry?.content.width).toBe(1000);
  expect(resized.marginWidth).toBe(180);
  expect(resized.player).toEqual({ x: 128, y: 128 });
  expect(resized.event?.event.geometry?.content.width).not.toBe(initial.content.width);

  await page.evaluate(() => {
    (window as Window & { __setHostTestGamepad?: (value: boolean) => void }).__setHostTestGamepad?.(false);
    const event = new Event("gamepaddisconnected");
    Object.defineProperty(event, "gamepad", { value: { index: 0 } });
    window.dispatchEvent(event);
  });
  await page.waitForFunction(() => (window.__live?.player?.x ?? 0) === 224, undefined, { timeout: 15_000 });
  const transitions = await page.evaluate(() => (window as Window & {
    __hostConsumed?: readonly { tick: number; event: { kind: string; connected?: boolean } }[];
  }).__hostConsumed?.filter((record) => record.event.kind === "gamepad") ?? []);
  expect(transitions.some((record) => record.event.connected === true && record.tick > 0)).toBe(true);
  expect(transitions.some((record) => record.event.connected === false && record.tick > 0)).toBe(true);
  await page.keyboard.press("Shift");
  await page.waitForFunction(() => {
    const records = (window as Window & { __hostConsumed?: readonly { event: { kind: string; features?: { keyboard: boolean } } }[] }).__hostConsumed ?? [];
    return records.some((record) => record.event.kind === "host.features" && record.event.features?.keyboard === true);
  }, undefined, { timeout: 15_000 });
});

test("live standard gamepad input drives the title action and gameplay movement", async ({ page }) => {
  await page.addInitScript(() => {
    const axes = [0, 0];
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const gamepad = { id: "standard input proof", index: 0, connected: true, mapping: "standard", axes, buttons, timestamp: 0 };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [gamepad] });
    (window as Window & { __setGamepad?: (axisX: number, buttonA: boolean) => void }).__setGamepad = (axisX, buttonA) => {
      axes[0] = axisX;
      buttons[0]!.pressed = buttonA;
      buttons[0]!.value = buttonA ? 1 : 0;
      gamepad.timestamp += 1;
    };
  });
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  await page.evaluate(() => {
    type Consumed = { tick: number; event: { kind: string; connected?: boolean; axes?: { x: number; y: number }; buttons?: number } };
    type Probe = Window & {
      __session?: { engine: { advance: (ticks: number, inputs: readonly unknown[]) => { consumed: readonly Consumed[] } } };
      __gamepadConsumed?: Consumed[];
    };
    const probe = window as Probe;
    const engine = probe.__session?.engine;
    if (engine === undefined) throw new Error("live engine was not initialized");
    const advance = engine.advance.bind(engine);
    engine.advance = (ticks, inputs) => {
      const report = advance(ticks, inputs);
      probe.__gamepadConsumed = [...(probe.__gamepadConsumed ?? []), ...report.consumed.filter(({ event }) => event.kind === "gamepad")];
      return report;
    };
  });

  for (let index = 0; index < 3; index += 1) {
    const tickBefore = await page.evaluate(() => window.__live?.tick ?? 0);
    await page.evaluate(() => (window as Window & { __setGamepad?: (axisX: number, buttonA: boolean) => void }).__setGamepad?.(0, true));
    await page.waitForFunction((tick) =>
      (window as Window & { __gamepadConsumed?: readonly { tick: number; event: { buttons?: number } }[] }).__gamepadConsumed?.some((input) => input.tick >= tick && input.event.buttons === 1) === true,
    tickBefore, { timeout: 15_000 });
    await page.evaluate(() => (window as Window & { __setGamepad?: (axisX: number, buttonA: boolean) => void }).__setGamepad?.(0, false));
    await page.waitForFunction((tick) => (window.__live?.tick ?? 0) > tick + 1, tickBefore, { timeout: 15_000 });
  }
  await page.waitForFunction(() => window.__live?.board !== null && window.__live?.board !== undefined, undefined, { timeout: 45_000 });
  const initial = await page.evaluate(() => window.__live as LiveReport);
  expect(initial.player).not.toBeNull();
  if (initial.player === null) throw new Error("live player did not reach gameplay");

  const beforeMovement = await page.evaluate(() => {
    const target = window as Window & {
      __gamepadConsumed?: readonly unknown[];
      __setGamepad?: (axisX: number, buttonA: boolean) => void;
    };
    const boundary = { tick: window.__session?.tick() ?? 0, consumed: target.__gamepadConsumed?.length ?? 0 };
    target.__setGamepad?.(1, false);
    return boundary;
  });
  await page.waitForFunction(({ x, y }) => {
    const player = window.__live?.player;
    return player !== null && player !== undefined && player.x >= x + 32 && player.y === y;
  }, initial.player, { timeout: 15_000 });
  await page.evaluate(() => (window as Window & { __setGamepad?: (axisX: number, buttonA: boolean) => void }).__setGamepad?.(0, false));
  await page.waitForFunction(({ tick, consumed }) =>
    // The next advance consumes AT the current tick. The log offset proves this is a new sample, not an older hold.
    (window as Window & { __gamepadConsumed?: readonly { tick: number; event: { axes?: { x: number } } }[] }).__gamepadConsumed?.slice(consumed).some((input) => input.tick >= tick && input.event.axes?.x === 1000) === true,
  beforeMovement, { timeout: 15_000 });
  const result = await page.evaluate(() => ({
    live: window.__live as LiveReport,
    inputs: (window as Window & { __gamepadConsumed?: readonly { tick: number; event: { connected?: boolean; axes?: { x: number }; buttons?: number } }[] }).__gamepadConsumed ?? [],
  }));
  expect(result.live.error).toBeUndefined();
  expect(result.live.player?.x).toBeGreaterThanOrEqual(initial.player.x + 32);
  expect(result.inputs.some(({ event }) => event.buttons === 1)).toBe(true);
  expect(result.inputs.some(({ event }) => event.axes?.x === 1000)).toBe(true);
  expect(result.inputs.every(({ tick }) => tick >= 0)).toBe(true);
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


test("web live player cancels a departed primary pointer and suppresses it on re-entry", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  await page.evaluate(() => {
    const hostWindow = window as Window & {
      __session?: {
        advance: (ticks: number, inputs?: readonly { readonly tick: number; readonly event: { readonly kind: string; readonly buttons?: number } }[]) => Promise<void>;
        capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[];
      };
    };
    const session = hostWindow.__session;
    if (session === undefined) throw new Error("live session is not exposed");
    const advance = session.advance.bind(session);
    session.capturedPointerInputs = [];
    session.advance = (ticks, inputs) => {
      session.capturedPointerInputs?.push(...(inputs ?? []).flatMap(({ event }) =>
        event.kind === "pointer" || event.kind === "pointer.cancel" ? [event] : [],
      ));
      return advance(ticks, inputs);
    };
  });
  const box = await page.locator("#screen").boundingBox();
  if (box === null) throw new Error("live canvas has no layout box");
  const x = box.x + Math.min(30, box.width / 2);
  const y = box.y + Math.min(30, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "left" });
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width + 20, y);
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  const mouseRouted = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  const mouseCancel = mouseRouted.findIndex((event) => event.kind === "pointer.cancel");
  expect(mouseCancel).toBeGreaterThanOrEqual(0);
  const afterMouseCancel = mouseRouted.slice(mouseCancel + 1).filter((event) => event.kind === "pointer");
  expect(afterMouseCancel.some((event) => ((event.buttons ?? 0) & 1) === 0)).toBe(true);
  expect(afterMouseCancel.some((event) => ((event.buttons ?? 0) & 2) !== 0)).toBe(true);
  await page.mouse.up({ button: "left" });
  await page.mouse.up({ button: "right" });
  const beforeChord = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs?.length ?? 0);
  await page.mouse.down({ button: "right" });
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(100);
  const afterChord = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  expect(afterChord.slice(beforeChord).some((event) => event.kind === "pointer" && ((event.buttons ?? 0) & 3) === 3)).toBe(true);
  await page.mouse.up({ button: "left" });
  await page.mouse.up({ button: "right" });
  const beforeFreshClick = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs?.length ?? 0);
  await page.mouse.click(x, y);
  await page.waitForTimeout(100);
  const afterFreshClick = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  const freshClickEvents = afterFreshClick.slice(beforeFreshClick).filter((event) => event.kind === "pointer");
  const freshClickDown = freshClickEvents.findIndex((event) => ((event.buttons ?? 0) & 1) !== 0);
  expect(freshClickDown).toBeGreaterThanOrEqual(0);
  expect(freshClickEvents.slice(freshClickDown + 1).some((event) => ((event.buttons ?? 0) & 1) === 0)).toBe(true);
  const beforeSynthetic = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs?.length ?? 0);

  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) throw new Error("live canvas is absent");
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const send = (type: string, pointerId: number, x: number, buttons: number, button = 0, pointerType = "touch"): void => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        pointerId,
        pointerType,
        button,
        buttons,
        clientX: x,
        clientY,
      }));
    };
    send("pointerdown", 41, clientX, 1);
    send("pointermove", 41, clientX, 3);
    // Captured touch moves outside, releasing the secondary button without an out-of-bounds click.
    send("pointermove", 41, rect.right + 10, 1);
    send("pointermove", 41, clientX, 1);
    send("pointerup", 41, clientX, 0);

    // A chord move from the mouse has primary set without a primary pointerdown.
    send("pointerdown", 51, clientX, 2, 2, "mouse");
    send("pointermove", 51, clientX, 3, 0, "mouse");
    send("pointerdown", 52, clientX, 1, 0);
    send("pointerup", 52, clientX, 0, 0);
    send("pointermove", 51, clientX, 1);
    // Release outside without an intervening move; the held primary must still be canceled.
    send("pointerup", 51, rect.right + 10, 0, 0);
    send("pointerdown", 61, clientX, 1, 0);
    send("pointerdown", 62, clientX, 1, 0);
    send("pointercancel", 62, clientX, 0, 0);
    send("pointermove", 61, clientX, 1);
    send("pointerup", 61, clientX, 0, 0);
    // A pen barrel button followed by the tip may report the primary transition as pointermove too.
    send("pointerdown", 81, clientX, 2, 2, "pen");
    send("pointermove", 81, clientX, 3, 0, "pen");
    send("pointerup", 81, clientX, 0, 0, "pen");
  });
  await page.waitForTimeout(100);
  const routed = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  const syntheticRouted = routed.slice(beforeSynthetic);
  expect(syntheticRouted.filter((event) => event.kind === "pointer.cancel")).toHaveLength(2);
  const touchMoveCancel = syntheticRouted.findIndex((event) => event.kind === "pointer.cancel");
  expect(touchMoveCancel).toBeGreaterThanOrEqual(0);
  expect(syntheticRouted[touchMoveCancel + 1]?.kind).toBe("pointer");
  expect(syntheticRouted[touchMoveCancel + 1]?.buttons).toBe(0);
  expect(syntheticRouted.some((event) => event.kind === "pointer" && ((event.buttons ?? 0) & 3) === 3)).toBe(true);
  expect(syntheticRouted.some((event) => event.kind === "pointer" && (event.buttons ?? 0) === 1)).toBe(true);
  expect(syntheticRouted.filter((event) => event.kind === "pointer").slice(-3).map((event) => event.buttons)).toEqual([2, 3, 0]);
  const beforeForeign = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs?.length ?? 0);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) throw new Error("live canvas is absent");
    const rect = canvas.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const send = (pointerId: number, x: number, buttons: number): void => {
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId,
        pointerType: "touch",
        buttons,
        clientX: x,
        clientY: y,
      }));
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 71,
      pointerType: "touch",
      button: 0,
      buttons: 3,
      clientX: rect.left + rect.width / 2,
      clientY: y,
    }));
    send(72, rect.right + 10, 0);
  });
  await page.waitForTimeout(100);
  const afterForeign = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  const foreignEvents = afterForeign.slice(beforeForeign);
  expect(foreignEvents).toHaveLength(2);
  expect(foreignEvents[0]?.kind).toBe("pointer");
  expect(foreignEvents[0]?.buttons).toBe(3);
  expect(foreignEvents[1]?.kind).toBe("pointer");
  expect(foreignEvents[1]?.buttons).toBe(1);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) throw new Error("live canvas is absent");
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 72, pointerType: "touch", clientX: rect.right + 10, clientY: y }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 71, pointerType: "touch", button: 0, buttons: 0, clientX: x, clientY: y }));
  });
});

test("foreign pointer motion cannot move the owner’s active primary gesture", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  await page.evaluate(() => {
    const hostWindow = window as Window & {
      __session?: {
        advance: (ticks: number, inputs?: readonly { readonly tick: number; readonly event: { readonly kind: string; readonly buttons?: number } }[]) => Promise<void>;
        capturedPointerInputs?: { readonly kind: string; readonly x?: number; readonly y?: number; readonly buttons?: number }[];
      };
    };
    const session = hostWindow.__session;
    if (session === undefined) throw new Error("live session is not exposed");
    const advance = session.advance.bind(session);
    session.capturedPointerInputs = [];
    session.advance = (ticks, inputs) => {
      session.capturedPointerInputs?.push(...(inputs ?? []).flatMap(({ event }) =>
        event.kind === "pointer" || event.kind === "pointer.cancel" ? [event] : [],
      ));
      return advance(ticks, inputs);
    };
  });
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) throw new Error("live canvas is absent");
    const rect = canvas.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, pointerId: 81, pointerType: "touch", button: 0, buttons: 1,
      clientX: rect.left + rect.width * 0.25, clientY: y,
    }));
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, pointerId: 82, pointerType: "touch", button: -1, buttons: 1,
      clientX: rect.left + rect.width * 0.75, clientY: y,
    }));
  });
  await page.waitForTimeout(100);
  const routed = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly x?: number; readonly y?: number; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  expect(routed).toHaveLength(1);
  expect(routed[0]?.kind).toBe("pointer");
  expect(routed[0]?.buttons).toBe(1);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) throw new Error("live canvas is absent");
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, pointerId: 81, pointerType: "touch", button: 0, buttons: 0,
      clientX: rect.left + rect.width * 0.25, clientY: rect.top + rect.height / 2,
    }));
  });
});

test("blur keeps a held primary suppressed until physical release", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, undefined, { timeout: 45_000 });
  await page.evaluate(() => {
    const hostWindow = window as Window & {
      __session?: {
        advance: (ticks: number, inputs?: readonly { readonly tick: number; readonly event: { readonly kind: string; readonly buttons?: number } }[]) => Promise<void>;
        capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[];
      };
    };
    const session = hostWindow.__session;
    if (session === undefined) throw new Error("live session is not exposed");
    const advance = session.advance.bind(session);
    session.capturedPointerInputs = [];
    session.advance = (ticks, inputs) => {
      session.capturedPointerInputs?.push(...(inputs ?? []).flatMap(({ event }) =>
        event.kind === "pointer" || event.kind === "pointer.cancel" ? [event] : [],
      ));
      return advance(ticks, inputs);
    };
  });
  await page.evaluate(() => {
    (window as Window & {
      __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
    }).__session!.capturedPointerInputs = [];
  });
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#screen");
    if (canvas === null) throw new Error("live canvas is absent");
    const rect = canvas.getBoundingClientRect();
    const init = {
      bubbles: true, pointerId: 90, pointerType: "mouse", button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
  });
  await page.waitForTimeout(100);
  const beforePhysicalHold = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  expect(beforePhysicalHold.map(({ kind, buttons }) => kind === "pointer" ? { kind, buttons } : { kind })).toEqual([
    { kind: "pointer", buttons: 1 },
    { kind: "pointer.cancel" },
    { kind: "pointer", buttons: 0 },
  ]);
  const box = await page.locator("#screen").boundingBox();
  if (box === null) throw new Error("live canvas has no layout box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(100);
  const beforeBlur = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs?.length ?? 0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.mouse.move(x + 1, y);
  await page.waitForTimeout(100);
  const afterBlurMove = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  expect(afterBlurMove.slice(beforeBlur).some((event) => event.kind === "pointer" && ((event.buttons ?? 0) & 1) !== 0)).toBe(false);
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(100);
  const beforeFreshClick = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs?.length ?? 0);
  await page.mouse.click(x, y);
  await page.waitForTimeout(100);
  const afterFreshClick = await page.evaluate(() => (window as Window & {
    __session?: { capturedPointerInputs?: { readonly kind: string; readonly buttons?: number }[] };
  }).__session?.capturedPointerInputs ?? []);
  expect(afterFreshClick.slice(beforeFreshClick).some((event) => event.kind === "pointer" && ((event.buttons ?? 0) & 1) !== 0)).toBe(true);
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

const HELD_KEY_BOARDS = [
  // An inline region program (board format field 26 allows inline RPGCode): the held boot key must run it.
  { path: "start.brd", regions: [{ program: 'send("second.brd", 2, 2, 1)\nend()', activationType: 1 }] },
  { path: "second.brd", regions: [{ program: "send-third.prg", activationType: 1 }] },
  { path: "third.brd", regions: [] },
];

/** Hold `key` until the player's reported x passes `target` (right: x >= target, left: x <= target). */
async function walkTo(page: Page, key: "ArrowRight" | "ArrowLeft", target: number): Promise<LiveReport> {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(({ key: which, target: bound }) => {
      const live = window.__live;
      if (live === undefined) return false;
      if (live.error !== undefined) return true;
      if (live.player === null) return false;
      return which === "ArrowRight" ? live.player.x >= bound : live.player.x <= bound;
    }, { key, target }, { timeout: 20_000 });
  } finally {
    await page.keyboard.up(key);
  }
  return await page.evaluate(() => window.__live as LiveReport);
}

const expectNoError = (report: LiveReport): void => {
  if (report.error !== undefined) throw new Error(report.error);
};

test("live session runs a held boot-key region program and deactivates send arrivals", async ({ page }) => {
  const fixture = triggerPhaseFixture("trigger-phase.tpk", HELD_KEY_BOARDS);
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => {
    const live = window.__live;
    return live !== undefined && (live.error !== undefined || (live.tick >= 5 && live.board === null));
  }, undefined, { timeout: 15_000 });
  const waiting = await page.evaluate(() => window.__live as LiveReport);
  expect(waiting.error).toBeUndefined();
  expect(waiting.board).toBeNull();
  // The startup `wait()` consumes Start's key; keeping Enter down through board entry exercises #1176's first-free-roam poll,
  // here against an inline region program: indexed-file-only resolution would report program.missing before this line.
  await page.keyboard.down("Enter");
  let firstArrival: LiveReport;
  try {
    await page.waitForFunction(
      () => window.__live?.board === "boards/second.brd" || window.__live?.error !== undefined,
      undefined,
      { timeout: 10_000 },
    );
    firstArrival = await page.evaluate(() => window.__live as LiveReport);
  } finally {
    await page.keyboard.up("Enter");
  }
  expect(firstArrival.error).toBeUndefined();
  expect(firstArrival.board).toBe("boards/second.brd");
  // Let the send arrival finish before sampling the tick the negative assertion starts from.
  await page.waitForFunction(
    (tick) => window.__live?.error !== undefined || (window.__live?.tick ?? 0) >= tick + 5,
    firstArrival.tick,
    { timeout: 10_000 },
  );
  const settledArrival = await page.evaluate(() => window.__live as LiveReport);
  expectNoError(settledArrival);
  expect(settledArrival.board).toBe("boards/second.brd");
  // Negative assertion, re-anchored to a tick sampled after the press itself: the key was delivered to a live
  // engine state at or before this sample, so waiting five ticks the sample does not cover return the press's
  // own outcome. The send arrival's deactivation must suppress the region the player arrived on, so a fresh
  // Enter fires nothing here.
  await page.keyboard.press("Enter");
  const sampledAfterPress = await page.evaluate(() => window.__live as LiveReport);
  await page.waitForFunction(
    (tick) => {
      const live = window.__live;
      return live !== undefined && (live.error !== undefined || live.tick >= tick + 5);
    },
    sampledAfterPress.tick,
    { timeout: 10_000 },
  );
  const afterPress = await page.evaluate(() => window.__live as LiveReport);
  expectNoError(afterPress);
  expect(afterPress.board).toBe("boards/second.brd");
  // The player's 30px collision base leaves the 16..80 region only past x = 96: walk out and back in
  // (E-40 re-arms the region on leaving), then press the activation key again. The same destination
  // program must now run and deliver the player to the third board — the positive control for the negative.
  const walkedOut = await walkTo(page, "ArrowRight", 96);
  expectNoError(walkedOut);
  expect(walkedOut.board).toBe("boards/second.brd");
  await walkTo(page, "ArrowLeft", 60);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => window.__live?.board === "boards/third.brd" || window.__live?.error !== undefined,
    undefined,
    { timeout: 10_000 },
  );
  const resumed = await page.evaluate(() => window.__live as LiveReport);
  expect(resumed.error).toBeUndefined();
  expect(resumed.board).toBe("boards/third.brd");
});

const MISSING_PRG_BOARDS = [
  { path: "start.brd", regions: [{ program: 'send("second.brd", 2, 2, 1)\nend()', activationType: 1 }] },
  // The activation region names a program the package does not carry: one located program.missing
  // diagnostic, no thread, and the shipped player keeps ticking.
  { path: "second.brd", regions: [{ program: "does-not-exist.prg", activationType: 1 }] },
  { path: "third.brd", regions: [] },
];

test("a missing region program is a diagnostic and the live player keeps ticking", async ({ page }) => {
  const fixture = triggerPhaseFixture("missing-prg.tpk", MISSING_PRG_BOARDS);
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => {
    const live = window.__live;
    return live !== undefined && (live.error !== undefined || (live.tick >= 5 && live.board === null));
  }, undefined, { timeout: 15_000 });
  await page.keyboard.down("Enter");
  let firstArrival: LiveReport;
  try {
    await page.waitForFunction(
      () => window.__live?.board === "boards/second.brd" || window.__live?.error !== undefined,
      undefined,
      { timeout: 10_000 },
    );
    firstArrival = await page.evaluate(() => window.__live as LiveReport);
  } finally {
    await page.keyboard.up("Enter");
  }
  expect(firstArrival.error).toBeUndefined();
  expect(firstArrival.board).toBe("boards/second.brd");
  // The arrival suppresses the region; walk out and back so it re-arms, then press the activation key:
  // the missing program is reported, the tick goes on and the board stays playable.
  await walkTo(page, "ArrowRight", 96);
  await walkTo(page, "ArrowLeft", 60);
  await page.keyboard.press("Enter");
  const afterPress = await page.evaluate(() => window.__live as LiveReport);
  await page.waitForFunction(
    (tick) => {
      const live = window.__live;
      return live !== undefined && (live.error !== undefined || live.tick >= tick + 15);
    },
    afterPress.tick,
    { timeout: 10_000 },
  );
  const report = await page.evaluate(() => window.__live as LiveReport);
  expect(report.error).toBeUndefined();
  expect(report.board).toBe("boards/second.brd");
  expect(report.tick).toBeGreaterThan(afterPress.tick + 10);
  // The missing program is the reported diagnostic itself, not a vacuously quiet session.
  expect(report.diagnostics?.some((diagnostic) => diagnostic.code === "program.missing" && diagnostic.message.includes("does-not-exist.prg"))).toBe(true);
  // The player still controls the game: walking is possible after the diagnostic.
  const walkedAfter = await walkTo(page, "ArrowRight", 96);
  expectNoError(walkedAfter);
  expect(walkedAfter.board).toBe("boards/second.brd");
});


const STEP_REGION_BOARDS = [
  { path: "start.brd", regions: [{ program: "send-second.prg", activationType: 1 }] },
  // The step-on region covers the arrival tile itself: without arrival deactivation or without the
  // re-arm-on-leaving rule the player could never walk off and onto it again, which is exactly what
  // #1175 asks the live player to regress.
  { path: "second.brd", regions: [{ program: "send-third.prg", activationType: 0 }] },
  { path: "third.brd", regions: [] },
];

test("a live step-on region stays silent through a send arrival and fires after the player leaves and re-enters", async ({ page }) => {
  const fixture = triggerPhaseFixture("step-region.tpk", STEP_REGION_BOARDS, { "send-second.prg": 'send("second.brd", 2, 2, 1)\nend()\n' });
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
  await page.waitForFunction(() => {
    const live = window.__live;
    return live !== undefined && (live.error !== undefined || (live.tick >= 5 && live.board === null));
  }, undefined, { timeout: 15_000 });
  await page.keyboard.down("Enter");
  let firstArrival: LiveReport;
  try {
    await page.waitForFunction(
      () => window.__live?.board === "boards/second.brd" || window.__live?.error !== undefined,
      undefined,
      { timeout: 10_000 },
    );
    firstArrival = await page.evaluate(() => window.__live as LiveReport);
  } finally {
    await page.keyboard.up("Enter");
  }
  expect(firstArrival.error).toBeUndefined();
  expect(firstArrival.board).toBe("boards/second.brd");
  // The step-on region sits under the arrival tile: idling on it must not run it (E-19 deactivation);
  // a broken resolver would turn the region's file program into a live error here instead.
  await page.waitForFunction(
    (tick) => window.__live?.error !== undefined || (window.__live?.tick ?? 0) >= tick + 5,
    firstArrival.tick,
    { timeout: 10_000 },
  );
  const settledArrival = await page.evaluate(() => window.__live as LiveReport);
  expectNoError(settledArrival);
  expect(settledArrival.board).toBe("boards/second.brd");
  // Walk out of the region (E-40 re-arms on leaving) and back in: the step-on region now fires on a step
  // and the destination program delivers the player to the third board.
  const walkedOut = await walkTo(page, "ArrowRight", 96);
  expectNoError(walkedOut);
  expect(walkedOut.board).toBe("boards/second.brd");
  await walkTo(page, "ArrowLeft", 60);
  await page.waitForFunction(
    () => window.__live?.board === "boards/third.brd" || window.__live?.error !== undefined,
    undefined,
    { timeout: 10_000 },
  );
  const entered = await page.evaluate(() => window.__live as LiveReport);
  expect(entered.error).toBeUndefined();
  expect(entered.board).toBe("boards/third.brd");
});
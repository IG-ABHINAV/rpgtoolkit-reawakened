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
  interface Window { liveAnalyser?: AnalyserNode }
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
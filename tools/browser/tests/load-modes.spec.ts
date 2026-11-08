import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The player page's load modes, streaming stalls and spinner (issue #934, plan AC3, AC4, AC5): driven through the real
// `packages/runner-web/app/index.html` over the real `createLiveSession`, OPFS stores, byte-range server and WebGL2
// canvas. Offline relaunch under service-worker control is AC1 + AC6 in `offline-player.spec.ts`.

const PACKAGE = "fixtures/packages/demo.tpk";

type BaselineFrame = { readonly label: string; readonly tick: number; readonly stateHash: string; readonly drawHash: string; readonly commands: number };

function demoBoardBaseline(): BaselineFrame {
  const baseline = JSON.parse(readFileSync(resolve("golden/regression/closing.json"), "utf8")) as {
    games: Record<string, { frames: readonly BaselineFrame[] }>;
  };
  const frame = baseline.games.demo?.frames.find((candidate) => candidate.label === "board" && candidate.tick === 120);
  if (frame === undefined) throw new Error("demo board frame at tick 120 not found in golden/regression/closing.json");
  return frame;
}

/** Where each entry's local header sits in `demo.tpk`, read from its central directory so no offset is hardcoded. */
function entryOffsets(bytes: Uint8Array): ReadonlyMap<string, { readonly start: number; readonly end: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const spans = new Map<string, { readonly start: number; readonly end: number }>();
  for (let index = 0; index < count; index += 1) {
    const compressed = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    const localExtra = view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    spans.set(name, { start: local, end: local + 30 + localExtra + compressed });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return spans;
}

const packageBytes = new Uint8Array(readFileSync(resolve(PACKAGE)));
const spans = entryOffsets(packageBytes);

function overlaps(rangeHeader: string | undefined, target: { readonly start: number; readonly end: number }): boolean {
  const match = rangeHeader === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
  if (match === null) return false;
  return Number(match[1]) < target.end && Number(match[2]) >= target.start;
}

async function clearOrigin(page: Page): Promise<void> {
  await page.goto("/packages/runner-web/app/storage.html");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for (const directory of ["tkr-packages", "tkr-staging"]) await root.removeEntry(directory, { recursive: true }).catch(() => undefined);
    for (const name of await caches.keys()) await caches.delete(name);
  });
}

test.beforeEach(async ({ page }) => {
  await clearOrigin(page);
});

test("AC3: forced streaming with a delayed unhinted board asset records only unhinted stalls, reaches the committed tick-120 baseline, and delivers the first board's music once its bytes arrive", async ({ page }) => {
  const boardSpan = spans.get("Boards/start.brd");
  const musicSpan = spans.get("Media/VIP - Village3.mid");
  if (boardSpan === undefined || musicSpan === undefined) throw new Error("demo.tpk lacks Boards/start.brd or Media/VIP - Village3.mid");

  // Delay both the unhinted board and the board's hinted music on their on-demand range reads (never during validation,
  // which reads from OPFS staging and only probes the last archive byte). The board request freezes simulation and must
  // be recorded as an unhinted stall. The interactive run also checks that the cue actually reads the same bytes as
  // the hint, without issuing another range request.
  let boardDelayed = 0;
  let parityMusicDelayed = 0;
  let interactiveMusicDelayed = 0;
  let inParity = true;
  await page.route(`**/${PACKAGE}`, async (route) => {
    const range = route.request().headers()["range"];
    if (overlaps(range, boardSpan)) {
      boardDelayed += 1;
      await new Promise((done) => setTimeout(done, 60));
    } else if (overlaps(range, musicSpan)) {
      if (inParity) parityMusicDelayed += 1;
      else interactiveMusicDelayed += 1;
      await new Promise((done) => setTimeout(done, 60));
    }
    await route.continue();
  });

  // First run parity over forced streaming to prove the committed tick-120 hashes under real range reads and stalls.
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.goto(`/packages/runner-web/app/index.html?game=demo&package=${PACKAGE}&parity=1&mode=streaming`);
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = await page.evaluate(() => window.__report as {
    tick: number;
    stateHash: string;
    drawHash: string;
    commands: number;
    error?: string;
    load: { mode: string };
    assets: { stalls: { key: string; hinted: boolean; durationMs: number }[]; hints: { received: number; completed: number; failed: number }; failures: unknown[]; shared: string[] };
  });
  const baseline = demoBoardBaseline();
  expect(report.error).toBeUndefined();
  expect(apiRequests).toEqual([]);
  expect(report.load.mode).toBe("streaming");
  expect(report.tick).toBe(baseline.tick);
  expect(report.stateHash).toBe(baseline.stateHash);
  expect(report.drawHash).toBe(baseline.drawHash);
  expect(report.commands).toBe(baseline.commands);
  expect(boardDelayed).toBeGreaterThan(0);
  expect(report.assets.failures).toEqual([]);
  expect(report.assets.stalls.length).toBeGreaterThan(0);
  expect(report.assets.stalls.some((stall) => stall.key === "boards/start.brd")).toBe(true);
  // Every stall is an asset the planner does not hint; no hinted asset ever stalled the simulation.
  expect(report.assets.stalls.every((stall) => !stall.hinted)).toBe(true);
  expect(report.assets.hints.received).toBeGreaterThan(0);
  // In parity mode audio is never unlocked, so no cue is emitted; the delayed music range is fetched exactly once for
  // the prefetch hint, proving real range reads under forced streaming.
  expect(parityMusicDelayed).toBe(1);

  // Now run the interactive player (which carries the audio effect applier) under forced streaming with the music range
  // delayed, unlock audio with Enter through the title screen, and verify the first board's music is scheduled on the
  // sink once its delayed bytes arrive.
  inParity = false;
  await page.goto(`/packages/runner-web/app/index.html?package=${PACKAGE}&mode=streaming`);
  await page.waitForFunction(() => (window.__live?.tick ?? 0) >= 30, undefined, { timeout: 45_000 });
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Enter");
    if ((await page.evaluate(() => window.__live?.board ?? null)) !== null) break;
    const before = await page.evaluate(() => window.__live?.tick ?? 0);
    await page.waitForFunction((point) => (window.__live?.tick ?? 0) >= point + 20 || window.__live?.board !== null, before, { timeout: 15_000 });
  }
  await page.waitForFunction(() => window.__live?.board === "boards/start.brd", undefined, { timeout: 30_000 });
  await page.waitForFunction(
    () => window.__session?.audioState().open.some((voice) => voice.track === "music" && voice.asset === "media/vip - village3.mid") === true,
    undefined,
    { timeout: 15_000 },
  );
  const audio = await page.evaluate(async () => {
    await window.__session?.cuesSettled();
    return { audio: window.__session?.audioState(), stalls: window.__session?.loadState().stalls };
  });
  expect(interactiveMusicDelayed, "the hinted music has exactly one network range read").toBe(1);
  expect(audio.audio?.scheduled.some((play) => play.track === "music")).toBe(true);
  // `shared` is evidence that a hint's own read supplied the cue's bytes. In this run the engine's blocking request for
  // the music begins before the hint starts it, so the cue cannot be marked as shared. The invariant below is stronger
  // than a positive match: it fails under the bug in #1065, where any hinted key was recorded as shared even though a
  // blocking request supplied the bytes.
  const loadState = await page.evaluate(() => window.__session?.loadState() ?? { shared: [], stalls: [] });
  const unhintedStalls = new Set(loadState.stalls.filter((stall) => !stall.hinted).map((stall) => stall.key.toLowerCase()));
  const shared = loadState.shared.map((key) => key.toLowerCase());
  const claimedAsShared = shared.find((key) => unhintedStalls.has(key));
  expect(claimedAsShared, "no key with an unhinted stall can be reported as shared").toBeUndefined();
});

test("AC4: a quota exception on the durable package put exposes quota-limited and streaming, reports an unpersisted answer, and still reaches the committed tick-120 baseline by real ranges", async ({ page }) => {
  // Make the durable package write (`tkr-packages/<sha>.tpk`) fail with a real DOMException QuotaExceededError while
  // leaving OPFS staging alone, and have `navigator.storage.persist()` deny persistence independently.
  await page.addInitScript(() => {
    navigator.storage.persist = async () => false;
    navigator.storage.persisted = async () => false;
    const getDirectory = navigator.storage.getDirectory.bind(navigator.storage);
    navigator.storage.getDirectory = async () => {
      const root = await getDirectory();
      const getSub = root.getDirectoryHandle.bind(root);
      root.getDirectoryHandle = async (name: string, options?: FileSystemGetDirectoryOptions) => {
        const sub = await getSub(name, options);
        if (name === "tkr-packages") {
          const getFile = sub.getFileHandle.bind(sub);
          sub.getFileHandle = async (file: string, fileOptions?: FileSystemGetFileOptions) => {
            if (fileOptions?.create === true && file.endsWith(".tpk")) {
              throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
            }
            return getFile(file, fileOptions);
          };
        }
        return sub;
      };
      return root;
    };
  });

  const ranged: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/demo.tpk") && response.request().headers()["range"] !== undefined) ranged.push(response.status());
  });
  await page.goto(`/packages/runner-web/app/index.html?game=demo&package=${PACKAGE}&parity=1`);
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = await page.evaluate(() => window.__report as {
    tick: number;
    stateHash: string;
    drawHash: string;
    commands: number;
    error?: string;
    load: { mode: string; storage: { quota: string; persisted: string; kept: boolean; error: string | null } };
  });
  const baseline = demoBoardBaseline();
  expect(report.error).toBeUndefined();
  expect(report.load.mode).toBe("streaming");
  expect(report.load.storage.quota).toBe("limited");
  expect(report.load.storage.persisted).toBe("denied");
  expect(report.load.storage.kept).toBe(false);
  expect(report.tick).toBe(baseline.tick);
  expect(report.stateHash).toBe(baseline.stateHash);
  expect(report.drawHash).toBe(baseline.drawHash);
  expect(report.commands).toBe(baseline.commands);
  expect(ranged.length).toBeGreaterThan(0);
  expect(ranged.every((status) => status === 206)).toBe(true);
});

test("AC5: during a blocking stall with an injected clock, 250 ms shows no spinner and 350 ms shows it over unchanged frame pixels while title audio keeps playing; resolving hides it and simulation resumes", async ({ page }) => {
  const boardSpan = spans.get("Boards/start.brd");
  if (boardSpan === undefined) throw new Error("demo.tpk lacks Boards/start.brd");

  // Hold the board's range read until the test releases it, so the engine stalls right after the title screen has drawn
  // and started its music.
  let heldRoute: Route | null = null;
  let releaseBoard: (() => void) | null = null;
  const boardRequested = new Promise<void>((resolveRequest) => {
    releaseBoard = () => {
      const route = heldRoute;
      heldRoute = null;
      if (route !== null) void route.continue();
    };
    void page.route(`**/${PACKAGE}`, async (route) => {
      if (heldRoute === null && overlaps(route.request().headers()["range"], boardSpan)) {
        heldRoute = route;
        resolveRequest();
        return;
      }
      await route.continue();
    });
  });

  await page.addInitScript(() => {
    let now = 5_000;
    (window as unknown as { __clock: { set(ms: number): void; add(ms: number): void } }).__clock = {
      set: (ms) => { now = ms; },
      add: (ms) => { now += ms; },
    };
    window.__playerClock = () => now;
    const original = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination: any, output?: any, input?: any) {
      if ((this instanceof AudioWorkletNode || this instanceof ScriptProcessorNode) && (window as unknown as { __analyser?: AnalyserNode }).__analyser === undefined) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        original.call(this, analyser);
        (window as unknown as { __analyser?: AnalyserNode }).__analyser = analyser;
      }
      return original.call(this, destination, output, input);
    };
  });

  await page.goto(`/packages/runner-web/app/index.html?package=${PACKAGE}&mode=streaming`);
  await page.waitForFunction(() => (window.__live?.tick ?? 0) >= 30, undefined, { timeout: 45_000 });
  // Step through the title menu and its intro wait so the engine asks for `Boards/start.brd` — which we hold.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await boardRequested;
  await page.waitForFunction(() => window.__session?.loadState().blocking !== null, undefined, { timeout: 10_000 });

  const snapshot = (): Promise<{ hidden: boolean; tick: number; pixels: string; sounding: boolean }> =>
    page.evaluate(() => {
      const spinner = document.querySelector<HTMLElement>("#spinner")!;
      const gl = document.querySelector<HTMLCanvasElement>("#screen")!.getContext("webgl2")!;
      const sample = new Uint8Array(64 * 64 * 4);
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, sample);
      let hash = 2166136261;
      for (const byte of sample) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      const analyser = (window as unknown as { __analyser?: AnalyserNode }).__analyser;
      let sounding = false;
      if (analyser !== undefined) {
        const wave = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(wave);
        sounding = wave.some((value) => Math.abs(value) > 0.0005);
      }
      return { hidden: spinner.hidden, tick: window.__session!.tick(), pixels: hash.toString(16), sounding };
    });

  // Wait briefly for the title music (already unlocked by Enter) to fill the audio buffer, while the fake clock is still at 0 ms elapsed.
  await page.waitForFunction(() => {
    const analyser = (window as unknown as { __analyser?: AnalyserNode }).__analyser;
    if (analyser === undefined) return false;
    const wave = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(wave);
    return wave.some((value) => Math.abs(value) > 0.0005);
  }, undefined, { timeout: 10_000 });

  await page.evaluate(() => (window as unknown as { __clock: { add(ms: number): void } }).__clock.add(250));
  await page.waitForFunction(() => window.__live?.stalls?.blocking !== null);
  const at250 = await snapshot();
  expect(at250.hidden).toBe(true); // 250 ms <= 300 ms: no spinner

  await page.evaluate(() => (window as unknown as { __clock: { add(ms: number): void } }).__clock.add(100));
  await page.waitForFunction(() => document.querySelector<HTMLElement>("#spinner")?.hidden === false, undefined, { timeout: 5_000 });
  const at350 = await snapshot();
  expect(at350.hidden).toBe(false); // 350 ms > 300 ms: spinner visible
  expect(at350.tick).toBe(at250.tick); // simulation frozen
  expect(at350.pixels).toBe(at250.pixels); // last presented frame pixels unchanged
  expect(at350.sounding).toBe(true); // already-playing title music continues through the stall

  releaseBoard!();
  await page.waitForFunction(() => document.querySelector<HTMLElement>("#spinner")?.hidden === true && window.__live?.board === "boards/start.brd", undefined, { timeout: 30_000 });
  const resumed = await snapshot();
  expect(resumed.hidden).toBe(true);
  expect(resumed.tick).toBeGreaterThan(at350.tick);
});

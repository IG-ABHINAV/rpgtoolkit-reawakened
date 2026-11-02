import { type InputRecord } from "@tk-reawakened/core";
import { parseClosingPlan, type ClosingFiles } from "@tk-reawakened/runner-harness";
import { createBlobHost, createIndexedDbBlobBackend, type BlobHost } from "../src/blob-host.ts";
import { createDecodeAhead, DECODE_WORKER_URL } from "../src/decode-ahead.ts";
import type { DecodeAhead } from "../src/decode-types.ts";
import { fetchBundled, fetchBundledFiles, fetchGame, fontProvider, distributionPackage, runScriptedFrame } from "../src/index.ts";
import { createLoadController, type LoadModeRequest, type LoadState } from "../src/load-mode.ts";
import { createOpfsPackageStore, createOpfsStaging } from "../src/opfs-store.ts";
import { pointerEventToLogical } from "../src/pointer.ts";
import { createLiveSession, fitCanvas, type LiveSession } from "../src/live-session.ts";
import { registerPlayerWorker, type RegistrationResult } from "../src/register-worker.ts";
import { createStallOverlay, type StallOverlay } from "../src/stall-overlay.ts";

type LiveReport = {
  tick: number;
  stateHash: string;
  drawHash: string;
  board: string | null;
  player: { x: number; y: number } | null;
  error?: string;
  /** How the package was loaded and what its storage did, once the load has finished. */
  load?: { mode: string | null; storage: LoadState["storage"] };
  /** Every completed asset stall and the asset the engine waits on now, for the lane and for a person reading it. */
  stalls?: { count: number; hinted: number; unhinted: number; blocking: string | null; spinner: boolean };
};

declare global {
  interface Window {
    __report?: unknown;
    __live?: LiveReport;
    /** The package load's state, kept current while it runs and after. */
    __load?: LoadState;
    /** A lane's clock for stall timing and the spinner; the page uses `performance.now` when it is absent. */
    __playerClock?: () => number;
    /** The blob host the session saves through, for a lane that inspects save storage. */
    __blobHost?: BlobHost;
    /** The decode-ahead worker, or the reason the browser refused one. */
    __decodeAhead?: DecodeAhead | { readonly unavailable: string };
    /** The live session, for a lane that inspects its asset tiers and audio sink. */
    __session?: LiveSession;
    /** The offline service worker's registration, or why none was registered (`app:` desktop, `capacitor:`, absent). */
    __worker?: Promise<RegistrationResult>;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const output = document.querySelector<HTMLPreElement>("#report");
if (canvas === null || output === null) throw new Error("player: the page is missing its canvas or report");
const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
if (gl === null) {
  output.textContent = "player: this browser has no WebGL2 context";
  window.__report = { error: "no-webgl2" };
} else {
  void boot(gl, canvas, output);
}

const MIB = 1_048_576;

function describeLoad(name: string, state: LoadState): string {
  const { received, total } = state.progress;
  const progress = total === null ? "" : ` — ${(received / MIB).toFixed(1)} of ${(total / MIB).toFixed(1)} MiB`;
  const mode = state.mode === null ? "" : ` (${state.mode})`;
  const storage = state.phase === "ready"
    ? `\nstorage: ${state.storage.kept ? "kept for offline" : "not kept"}, quota ${state.storage.quota}, persistent ${state.storage.persisted}${state.storage.error === null ? "" : `\n  ${state.storage.error}`}`
    : "";
  return `${state.phase === "failed" ? "load failed" : state.phase === "ready" ? "loaded" : "loading"} ${name}${progress}${mode}${storage}`;
}

async function boot(context: WebGL2RenderingContext, screen: HTMLCanvasElement, report: HTMLPreElement): Promise<void> {
  try {
    const params = new URLSearchParams(location.search);
    const pack = params.get("package");
    const parity = params.has("parity");
    const tracer = params.has("tracer");
    if (!parity && !tracer) {
      await bootInteractive(context, screen, report, params);
      return;
    }
    if (parity && pack !== null) {
      await bootParityPackage(context, report, params, pack);
      return;
    }
    const planText = await (await fetch("/golden/closing/plan.json")).text();
    const game = params.get("game") ?? "demo";
    let files: ClosingFiles;
    if (pack === null) files = await fetchGame("", `fixtures/legacy/${game}`);
    else files = distributionPackage(pack.split("/").at(-1) ?? "game.tpk", new Uint8Array(await (await fetch(`/${pack}`)).arrayBuffer())).files;
    const bundled = await fetchBundled("", parseClosingPlan(planText).bundled);
    if (tracer) {
      const result = runScriptedFrame({ planText, game, files, bundled, gl: context, fonts: fontProvider(bundled) });
      window.__report = { game, package: pack, ...result };
      report.textContent = [
        `${game} tick ${result.tick}`,
        `state ${result.stateHash}`,
        `draw  ${result.drawHash}`,
        `commands ${result.commands}: drawn ${result.render.drawn}, deferred ${result.render.deferred}`,
        ...Object.entries(result.render.deferredByKind).map(([kind, count]) => `  ${kind}: ${count}`),
        ...result.render.diagnostics.map((line) => `diagnostic: ${line}`),
      ].join("\n");
      return;
    }
    const session = await createLiveSession({ planText, gameName: game, files, bundled, gl: context });
    await runParity(session, report, game, pack);
  } catch (error) {
    window.__report = { error: String(error) };
    report.textContent = `player: ${String(error)}`;
  }
}

/** The OPFS root the package stores sit on, or `null` where the browser has none (the load then streams and says why). */
async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return typeof navigator.storage?.getDirectory === "function" ? await navigator.storage.getDirectory() : null;
  } catch {
    return null;
  }
}

/** The durable blob host, or `null` where IndexedDB is unavailable: saves then report failure to the engine, never succeed silently. */
async function durableBlobs(report: HTMLPreElement): Promise<BlobHost | null> {
  try {
    return createBlobHost({ backend: await createIndexedDbBlobBackend(indexedDB, "tkr-saves"), storage: navigator.storage });
  } catch (error) {
    report.textContent = `${report.textContent ?? ""}\nsaves unavailable: ${String(error)}`;
    return null;
  }
}

/** Everything the player needs from a package before it can start: the validated source, the load state and the bundled files. */
async function loadPackage(params: URLSearchParams, report: HTMLPreElement, pack: string) {
  window.__worker ??= registerPlayerWorker();
  const packageName = pack.split("/").at(-1) ?? "game.tpk";
  const descriptorResponse = await fetch(`/${pack}.json`);
  if (!descriptorResponse.ok) throw new Error(`package descriptor unavailable: ${descriptorResponse.status}`);
  const descriptor: unknown = await descriptorResponse.json();
  const root = await opfsRoot();
  const requested = params.get("mode");
  const threshold = params.get("threshold");
  const controller = createLoadController({
    url: `/${pack}`,
    descriptor,
    ...(root === null ? {} : { staging: createOpfsStaging(root), durable: createOpfsPackageStore(root) }),
    storage: navigator.storage,
    mode: requested === "whole" || requested === "streaming" ? (requested satisfies LoadModeRequest) : "auto",
    ...(threshold === null ? {} : { thresholdBytes: Number(threshold) }),
  });
  controller.subscribe((state) => {
    window.__load = state;
    report.textContent = describeLoad(packageName, state);
  });
  const listing = fetch("/apps/bundled.json").then(async (response) => {
    if (!response.ok) throw new Error(`apps/bundled.json answered ${response.status}`);
    return (await response.json()) as { readonly files: readonly string[] };
  });
  const [source, listed] = await Promise.all([controller.load(), listing]);
  const bundled = await fetchBundledFiles("", listed.files);
  return { controller, source, bundled };
}

/**
 * Spawn the decode worker from bytes fetched through the page's own `fetch`. A dedicated `new Worker(url)` is outside
 * the page's service-worker scope in Chromium and fails when the network is gone; fetching the bundle through the
 * controlled page hits the service worker's precache and runs identically online and offline.
 */
async function prepareDecode(): Promise<(outputRateHz: number) => DecodeAhead | null> {
  let blobUrl: string | null = null;
  try {
    const response = await fetch(DECODE_WORKER_URL);
    if (response.ok) blobUrl = URL.createObjectURL(await response.blob());
  } catch {
    blobUrl = null;
  }
  return (outputRateHz: number): DecodeAhead | null => {
    try {
      const decode = createDecodeAhead({ outputRateHz, ...(blobUrl === null ? {} : { workerUrl: blobUrl }) });
      window.__decodeAhead = decode;
      if (blobUrl !== null) window.addEventListener("pagehide", () => URL.revokeObjectURL(blobUrl!), { once: true });
      return decode;
    } catch (error) {
      if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
      window.__decodeAhead = { unavailable: String(error) };
      return null;
    }
  };
}

/** The closing-plan recipe over the tiered package source: the lane's proof that the production source reaches the baseline. */
async function bootParityPackage(context: WebGL2RenderingContext, report: HTMLPreElement, params: URLSearchParams, pack: string): Promise<void> {
  const game = params.get("game") ?? "demo";
  const planText = await (await fetch("/golden/closing/plan.json")).text();
  const { controller, source, bundled } = await loadPackage(params, report, pack);
  const clock = window.__playerClock ?? ((): number => performance.now());
  const decode = await prepareDecode();
  const session = await createLiveSession({ planText, gameName: game, source, bundled, gl: context, clock, decode });
  window.__session = session;
  await runParity(session, report, game, pack, () => ({ load: controller.state(), assets: session.loadState(), audio: session.audioState() }));
}

async function bootInteractive(
  context: WebGL2RenderingContext,
  screen: HTMLCanvasElement,
  report: HTMLPreElement,
  params: URLSearchParams,
): Promise<void> {
  const pack = params.get("package");
  if (pack === null) throw new Error("interactive play requires a distribution package in ?package=");
  const { controller, source, bundled } = await loadPackage(params, report, pack);
  const blobs = await durableBlobs(report);
  if (blobs !== null) window.__blobHost = blobs;
  const clock = window.__playerClock ?? ((): number => performance.now());
  const spinner = document.querySelector<HTMLElement>("#spinner");
  let overlay: StallOverlay | null = null;
  const decode = await prepareDecode();
  const session = await createLiveSession({
    interactive: true,
    source,
    bundled,
    gl: context,
    clock,
    ...(blobs === null ? {} : { blobs }),
    decode,
    onLoadChange: () => overlay?.update(),
  });
  window.__session = session;
  if (spinner !== null) overlay = createStallOverlay({ element: spinner, state: session.loadState, clock });
  const view = session.viewSize();
  const fit = (): void => {
    fitCanvas(screen, view.width, view.height, {
      width: window.innerWidth,
      height: Math.max(80, window.innerHeight - report.offsetHeight - 24),
    });
  };
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("pagehide", () => window.removeEventListener("resize", fit), { once: true });
  startLiveLoop(session, screen, report, overlay, controller.state);
}

async function runParity(session: LiveSession, report: HTMLPreElement, game: string, pack: string | null, extra: () => object = () => ({})): Promise<void> {
  await session.advance(0);
  let inputs: InputRecord[] = [];
  for (const tick of [30, 60, 90, 120]) {
    await session.advance(tick - session.tick(), inputs);
    inputs = [];
    if (tick < 120) {
      inputs.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } });
      inputs.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } });
    }
  }
  await session.cuesSettled();
  const frame = session.draw(0);
  const stateHash = session.stateHash();
  const alphaFrame = session.draw(1);
  const result = {
    game,
    package: pack,
    tick: session.tick(),
    stateHash,
    drawHash: frame.drawHash,
    alphaDrawHash: alphaFrame.drawHash,
    alphaStateHash: session.stateHash(),
    commands: frame.commands,
    render: frame.render,
  };
  window.__report = { ...result, ...extra() };
  report.textContent = [`${game} tick ${result.tick}`, `state ${result.stateHash}`, `draw  ${result.drawHash}`, `commands ${result.commands}: drawn ${frame.render.drawn}, deferred ${frame.render.deferred}`].join("\n");
}

function startLiveLoop(
  session: LiveSession,
  canvas: HTMLCanvasElement,
  report: HTMLPreElement,
  overlay: StallOverlay | null,
  loadState: () => LoadState,
): void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let disposed = false;
  let advancing = false;
  let pending: InputRecord[] = [];
  const viewSize = session.viewSize();
  const pointer = (event: PointerEvent): void => {
    const { x, y } = pointerEventToLogical(event, canvas, viewSize);
    pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons: event.buttons } });
  };
  const key = (event: KeyboardEvent, down: boolean): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down, ...(event.repeat ? { repeat: true } : {}) } });
  };
  const onKeyDown = (event: KeyboardEvent): void => key(event, true);
  const onKeyUp = (event: KeyboardEvent): void => key(event, false);
  const focus = (state: "lost" | "gained"): void => {
    pending.push({ tick: session.tick(), event: { kind: "focus", state } });
  };
  const onBlur = (): void => focus("lost");
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", pointer);
  canvas.addEventListener("pointermove", pointer);
  canvas.addEventListener("pointerup", pointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  // The spinner is driven by its own timer as well as by each frame, so it appears even if the browser throttles
  // animation frames, and never from the pending `advance`, which cannot resolve while the engine waits on an asset.
  const spinnerTimer = overlay === null ? null : window.setInterval(() => overlay.update(), 100);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (spinnerTimer !== null) window.clearInterval(spinnerTimer);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("pointerdown", pointer);
    canvas.removeEventListener("pointermove", pointer);
    canvas.removeEventListener("pointerup", pointer);
    session.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  const summary = (spinner: boolean): NonNullable<LiveReport["stalls"]> => {
    const state = session.loadState();
    const hinted = state.stalls.filter((stall) => stall.hinted).length;
    return { count: state.stalls.length, hinted, unhinted: state.stalls.length - hinted, blocking: state.blocking?.key ?? null, spinner };
  };
  const frame = (now: number): void => {
    if (disposed) return;
    const elapsed = Math.max(0, now - previous);
    previous = now;
    const spinner = overlay?.update() ?? false;
    // While the engine waits on an asset the simulation is frozen, so wall time is not banked: a long wait must not come
    // back as a burst of catch-up ticks. The last presented frame stays on the canvas and the loop keeps running.
    if (!advancing) {
      accumulator += elapsed;
      const wholeTicks = Math.floor(accumulator / stepMs);
      accumulator -= wholeTicks * stepMs;
      const inputs = pending;
      pending = [];
      advancing = true;
      session.advance(wholeTicks, inputs).then(() => {
        advancing = false;
        if (disposed) return;
        const drawn = session.draw(accumulator / stepMs);
        const player = session.playerPosition();
        const state = loadState();
        const live: LiveReport = {
          tick: session.tick(),
          stateHash: session.stateHash(),
          drawHash: drawn.drawHash,
          board: session.boardKey(),
          player,
          load: { mode: state.mode, storage: state.storage },
          stalls: summary(overlay?.update() ?? false),
        };
        window.__live = live;
        window.__report = live;
        report.textContent = [
          `live ${location.search.includes("package=") ? "package" : "game"} — tick ${live.tick}`,
          `state ${live.stateHash}`,
          `draw  ${live.drawHash} (${drawn.commands} commands; ${drawn.render.drawn} drawn, ${drawn.render.deferred} deferred)`,
          player === null ? "player position unavailable" : `player ${player.x}, ${player.y}`,
          `package ${state.mode ?? "?"}; storage ${state.storage.kept ? "kept" : "not kept"}; stalls ${live.stalls?.count ?? 0}`,
          "Move: arrows or WASD; click the board to walk.",
        ].join("\n");
      }).catch((error: unknown) => {
        advancing = false;
        window.__live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error), stalls: summary(false) };
        report.textContent = `player: ${String(error)}`;
        dispose();
      });
    } else if (window.__live !== undefined) {
      window.__live = { ...window.__live, stalls: summary(spinner) };
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

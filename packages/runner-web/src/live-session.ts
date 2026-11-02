import {
  assetKey,
  BinaryReader,
  createAssetIndex,
  createEmptyMainFile,
  createEngine,
  createSpriteRuntime,
  deriveGameId,
  derivePackageIdentity,
  DEFAULT_FONT_ASSET,
  hashDrawList,
  PACKAGE_ROOT,
  readMainFile,
  writeMainFile,
  type AssetKey,
  type DrawList,
  type Engine,
  type GameState,
  type InputRecord,
  type RunnerRequest,
  type SurfaceId,
} from "@tk-reawakened/core";
import { inputPhaseRegistration, inputResetRegistration, movementPhaseRegistration } from "@tk-reawakened/core";
import { parseClosingPlan, type ClosingFiles } from "@tk-reawakened/runner-harness";
import { createWebgl2Renderer, type RenderStats } from "@tk-reawakened/render-webgl2";
import { BUNDLED_BANK, CuePlayer, describePatchGap } from "@tk-reawakened/synth";
import { connectSinkToGraph, PcmSink, type ScheduledPlay } from "./audio-sink.ts";
import { fontProvider, liveTextureProvider } from "./index.ts";
import type { DecodeAhead } from "./decode-types.ts";
import type { PackageSource } from "./package-source.ts";
import { createSessionAssets, packageOrigin, type AssetLoadState } from "./session-assets.ts";

export type LiveBlobHost = {
  read(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  write(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  list?(area: "saves" | "files", gameId: string): Promise<readonly string[]>;
};
export type LiveSession = {
  readonly engine: Engine;
  readonly gameId: string;
  readonly close: () => void;
  readonly tick: () => number;
  readonly stateHash: () => string;
  readonly viewSize: () => { readonly width: number; readonly height: number };
  readonly draw: (alpha: number) => { readonly drawHash: string; readonly commands: number; readonly render: RenderStats };
  readonly playerPosition: () => { readonly x: number; readonly y: number } | null;
  /** The board the session is on, or `null` before board entry — the signal a host needs to tell "booting" from "playing". */
  readonly boardKey: () => string | null;
  /** What the asset tiers are doing: the asset the engine waits on now, every completed stall, hint progress and failures. */
  readonly loadState: () => AssetLoadState;
  /** What the audio sink has scheduled and holds open, and a barrier for the cue chain — for a lane to assert on. */
  readonly audioState: () => {
    readonly scheduled: readonly ScheduledPlay[];
    readonly open: readonly { readonly id: number; readonly track: string; readonly asset: AssetKey }[];
  };
  readonly cuesSettled: () => Promise<void>;
  readonly advance: (ticks: number, inputs?: readonly InputRecord[]) => Promise<void>;
};
type LiveSessionBase = {
  readonly bundled: ClosingFiles;
  readonly gl: WebGL2RenderingContext;
  readonly blobs?: LiveBlobHost;
  /** Milliseconds, for stall timing. Defaults to `performance.now`; a test injects its own. */
  readonly clock?: () => number;
  /**
   * Makes the decode-ahead worker once the session knows the audio output rate. Its results only ever replace work the
   * host would do itself. A factory that throws fails the session: a page that can live without a worker catches that
   * itself and says so, rather than the session pretending a worker exists.
   */
  readonly decode?: (outputRateHz: number) => DecodeAhead | null;
  /** Called whenever `loadState()` changes, so a page can show a spinner without polling the session. */
  readonly onLoadChange?: () => void;
};
export type LiveSessionOptions = LiveSessionBase & (
  /** An interactive session over a validated package source: assets arrive on demand through the tiered source. */
  | { readonly interactive: true; readonly source: PackageSource }
  /** An interactive session over a fully populated file map (the desktop and mobile players). */
  | { readonly interactive: true; readonly files: ClosingFiles; readonly mainFile: string; readonly gameIdentity: string }
  | { readonly interactive?: false; readonly files: ClosingFiles; readonly planText: string; readonly gameName: string }
  /**
   * The closing-plan recipe over a package source: the plan supplies the seed, size and tick cap, the package supplies
   * the game (its own main file, not a synthesised one). This is how the lane proves the tiered source reaches the
   * committed baseline.
   */
  | { readonly interactive?: false; readonly source: PackageSource; readonly planText: string; readonly gameName: string }
);

/** The window resolution a main file asks for: 640×480, 800×600, 1024×768, or its custom `resX`×`resY`. */
function mainResolution(bytes: Uint8Array, path: AssetKey): { readonly width: number; readonly height: number } {
  const parsed = readMainFile(new BinaryReader(bytes, path));
  if (!parsed.ok) return { width: 640, height: 480 };
  const main = parsed.value;
  if (main.resolution === 0) return { width: 640, height: 480 };
  if (main.resolution === 1) return { width: 800, height: 600 };
  if (main.resolution === 2) return { width: 1024, height: 768 };
  return main.resX > 0 && main.resY > 0 ? { width: main.resX, height: main.resY } : { width: 640, height: 480 };
}

/**
 * Present the logical frame centred in the space it has, never overflowing (AD-33's pixel-perfect letterbox).
 * Use the largest integer scale that fits when possible; otherwise fall back to the exact fractional fit so a
 * 640x480 (or larger) frame stays fully visible on a portrait phone whose CSS viewport is narrower than the frame.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  available: { readonly width: number; readonly height: number },
): number {
  const ratio = Math.min(available.width / width, available.height / height);
  const scale = ratio >= 1 ? Math.floor(ratio) : ratio;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  return scale;
}

/** Persistent engine and host request pump shared by browser and desktop players. */
export function createLiveSession(options: LiveSessionOptions): LiveSession {
  const interactive = options.interactive === true;
  const plan = interactive ? null : parseClosingPlan(options.planText);
  const game = plan?.games.find((entry) => entry.name === (!interactive ? options.gameName : ""));
  if (!interactive && game === undefined) throw new Error(`runner-web: the plan does not list ${options.gameName}`);
  const eagerFiles = "source" in options ? null : options.files;
  const source = "source" in options ? options.source : null;
  // The session's synchronous byte cache. An eager package arrives in it whole; a source fills it as assets are needed.
  const files = new Map<AssetKey, Uint8Array>();
  if (eagerFiles !== null) for (const [path, bytes] of eagerFiles) files.set(assetKey(path), bytes);
  const synthesised = !interactive && game !== undefined && !("file" in game.main);
  let mainFile: string;
  if (synthesised) {
    mainFile = "main.gam";
    const data = { ...createEmptyMainFile(), major: 2, minor: 9, ...game.main.synthesised };
    const encoded = writeMainFile(data);
    if (!encoded.ok) throw new Error(`runner-web: ${encoded.error.message}`);
    files.set(assetKey(mainFile), encoded.value);
  } else if (source !== null) mainFile = source.main;
  else if ("mainFile" in options) mainFile = options.mainFile;
  else {
    if (game === undefined || !("file" in game.main)) throw new Error(`runner-web: the plan does not list ${"gameName" in options ? options.gameName : "this game"}`);
    mainFile = game.main.file;
  }
  const index = source !== null
    ? createAssetIndex([...source.entries.map((entry) => entry.path), ...(synthesised ? [mainFile] : [])])
    : createAssetIndex([...(eagerFiles?.keys() ?? []), ...(synthesised ? [mainFile] : [])]);
  const bundled = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of options.bundled) bundled.set(assetKey(path), bytes);
  const gameIdentity = source !== null
    ? source.gameIdentity
    : "gameIdentity" in options
      ? options.gameIdentity
      : derivePackageIdentity([...files].map(([path, bytes]) => ({ path, bytes })));
  const mainBytes = source !== null ? source.peek(source.main) ?? undefined : files.get(assetKey(mainFile));
  if (mainBytes === undefined) throw new Error(`runner-web: main file ${mainFile} is absent`);
  if (source !== null && !synthesised) files.set(assetKey(mainFile), mainBytes);
  const gameId = deriveGameId(mainBytes, gameIdentity);
  if (source !== null && gameId !== source.gameId) throw new Error(`runner-web: the package source's GameId ${source.gameId} is not the session's ${gameId}`);
  const clock = options.clock ?? ((): number => performance.now());
  const audioContext = new AudioContext();
  const decode = options.decode?.(audioContext.sampleRate) ?? null;
  const assets = createSessionAssets({
    cache: files,
    origin: source === null ? null : packageOrigin(source),
    clock,
    decode: decode ?? null,
    ...(options.onLoadChange === undefined ? {} : { onChange: options.onLoadChange }),
  });
  const spriteRuntime = interactive ? createSpriteRuntime() : undefined;
  let hasPlayer = false;
  let cameraPosition: { x: number; y: number } | null = null;
  let latest: GameState | null = null;
  const phaseRegistrations = interactive
    ? [
      inputPhaseRegistration({ pixelStep: 8 }),
      movementPhaseRegistration(),
      { phase: "audio" as const, rank: 0, run: (state: GameState) => { latest = state; } },
    ]
    : [{ phase: "audio" as const, run: (state: GameState) => { latest = state; } }];
  // The window and its resolution are the runner's job (`docs/spec/engine/main-loop-and-startup.md` steps 4-5): a
  // packaged game plays at the resolution its main file asks for, never at a fixed 640×480 of the runner's choosing.
  const viewport = interactive
    ? mainResolution(mainBytes, assetKey(mainFile))
    : { width: plan?.width ?? 640, height: plan?.height ?? 480 };
  const engine = createEngine({
    seed: plan?.seed ?? 0,
    assetIndex: index,
    assetRoot: PACKAGE_ROOT,
    mainFile,
    gameIdentity,
    startup: {
      presence: { hasPlayer: () => spriteRuntime === undefined ? hasPlayer : spriteRuntime.hasPlayer() },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: viewport.width,
    height: viewport.height,
    maxTicks: plan?.maxTicks ?? Number.MAX_SAFE_INTEGER,
    include: { shading: true, images: true, sprites: true },
    bundled,
    cameraTarget: {
      getPlayerPosition: () => {
        if (interactive && latest !== null) {
          const actor = latest.sprites.players.find((player) => player.id === latest?.sprites.selectedPlayer) ?? latest.sprites.players.find((player) => player.controlled);
          if (actor !== undefined) return { x: actor.x, y: actor.y };
        }
        return cameraPosition;
      },
      getEntityPosition: () => null,
    },
    ...(interactive ? {
      input: { bindings: { keys: { Enter: "ENTER", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right" } } },
      resetRegistrations: [inputResetRegistration()],
    } : {}),
    ...(spriteRuntime === undefined ? {} : { spriteRuntime }),
    phaseRegistrations,
    effectAppliers: interactive ? [] : [
      {
        section: "sprites",
        applier(effect) {
          if (effect.name === "createplayer") hasPlayer = true;
          if (effect.name === "placeplayer") {
            const [x, y, , unit] = effect.args as [number, number, number, string];
            cameraPosition = unit === "tile" ? { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 } : { x, y };
          }
        },
      },
      { section: "triggers", applier: () => undefined },
      { section: "audio", applier: () => undefined },
    ],
  });
  const renderer = createWebgl2Renderer(options.gl, { mode: "letterbox", scale: 1 });

  const textures = liveTextureProvider((key) => assets.peek(key), decode === null ? undefined : (key) => decode.image(key));
  const fonts = fontProvider(options.bundled);
  let currentTick = 0;
  let currentStateHash = "";
  let closed = false;
  let cueChain: Promise<void> = Promise.resolve();
  let processing: Promise<void> = Promise.resolve();

  const audioEvents: InputRecord[] = [];
  let player: CuePlayer;
  const sink = new PcmSink({
    outputRateHz: audioContext.sampleRate,
    readAsset: (key) => assets.peek(key) ?? bundled.get(key) ?? null,
    readBank: (bank) => assets.peek(assetKey(bank.id)) ?? bundled.get(assetKey(bank.id)) ?? null,
    ...(decode === null ? {} : { readPrepared: (key: AssetKey) => decode.audio(key) }),
    onEvent(event) {
      if (event.kind === "ready") queueMicrotask(() => player.ready(event.voice, event.lengthTicks));
      else if (event.kind === "ended") player.ended(event.voice);
      else if (event.kind === "error") {
        if (event.voice !== null) queueMicrotask(() => player.failed(event.voice!));
        else console.warn(`audio: ${event.code}: ${event.detail}`); // a bank failure belongs to no voice
      } else if (event.kind === "bank.substitution") console.warn(describePatchGap(event)); // playback continues; not game state
    },
  });
  player = new CuePlayer({
    send: (message) => sink.handle(message),
    readAsset: (key) => assets.peek(key) ?? bundled.get(key) ?? null,
    bankLayers: { player: null, runner: null, bundled: bundled.has(assetKey(BUNDLED_BANK.id)) ? BUNDLED_BANK : null },
    onEnded: (cueId) => audioEvents.push({ tick: currentTick, event: { kind: "audio.ended", cueId } }),
  });
  const graph = connectSinkToGraph(audioContext, sink);
  if (audioContext.state !== "running") player.lock();
  audioContext.addEventListener("statechange", () => {
    if (audioContext.state === "running") player.unlock(currentTick);
  });
  const unlockAudio = (): void => {
    void audioContext.resume().then(() => { if (audioContext.state === "running") player.unlock(currentTick); });
  };
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);


  const hostReply = async (request: RunnerRequest, tick: number): Promise<InputRecord | null> => {
    switch (request.kind) {
      case "asset": return { tick, event: { kind: "asset", reqId: request.reqId, bytes: await assets.request(request.key) } };
      case "playVideo": return { tick, event: { kind: "video.ended", reqId: request.reqId } };
      case "loadBlob": {
        const prefix = `${gameId}/`;
        const relative = request.blob.path.startsWith(prefix) ? request.blob.path.slice(prefix.length) : request.blob.path;
        let bytes: Uint8Array | null = null;
        try { bytes = await options.blobs?.read(request.blob.area, gameId, relative) ?? null; } catch { bytes = null; }
        return { tick, event: { kind: "blob.loaded", reqId: request.reqId, bytes } };
      }
      case "saveBlob": {
        const prefix = `${gameId}/`;
        const relative = request.blob.path.startsWith(prefix) ? request.blob.path.slice(prefix.length) : request.blob.path;
        let ok = false;
        try { ok = await options.blobs?.write(request.blob.area, gameId, relative, request.bytes) ?? false; } catch { ok = false; }
        return { tick, event: { kind: "blob.saved", reqId: request.reqId, ok } };
      }
      case "listBlobs": {
        let names: readonly string[] = [];
        try { names = await options.blobs?.list?.(request.area, gameId) ?? []; } catch { names = []; }
        return { tick, event: { kind: "blob.listed", reqId: request.reqId, names } };
      }
      case "extension.call": return { tick, event: { kind: "extension.result", reqId: request.reqId, result: null } };
      case "prefetch": assets.hint(request.hints); return null;
      case "quit": case "openUrl": return null;
    }
  };

  const pump = async (initialTicks: number, initialInputs: readonly InputRecord[]): Promise<void> => {
    let ticks = initialTicks;
    let inputs = [...initialInputs];
    for (let guard = 0; guard < 10_000 && !closed; guard += 1) {
      for (const input of inputs) {
        if (input.event.kind === "focus") {
          if (input.event.state === "lost") player.focusLost();
          else player.focusGained();
        }
      }
      inputs.push(...audioEvents.splice(0));
      const report = engine.advance(ticks, inputs);
      ticks = Math.max(0, ticks - report.ticksRun);
      inputs = [];
      currentTick = report.tickAfter;
      currentStateHash = report.stateHash;
      // Cues are handed to the player on their own chain, in report order, once the assets they name are cached (the
      // player and the sink read assets synchronously). The simulation never waits on this chain, and a stall in the
      // chain cannot reorder cues, because each report's cues run only after the previous report's.
      const cues = report.audioCues;
      const reachedTick = report.tickAfter;
      cueChain = cueChain.then(async () => {
        if (closed) return;
        await assets.ensure(cues.flatMap((cue) => (cue.asset === null ? [] : [cue.asset])));
        if (closed) return;
        player.reach(reachedTick);
        player.advance(cues);
      });
      // Asset requests go out together (the engine is blocked on all of them); everything else is answered in order.
      const started = report.requests.map((request) => (request.kind === "asset" ? hostReply(request, report.tickAfter) : undefined));
      for (const answer of started) answer?.catch(() => undefined);
      const replies: InputRecord[] = [];
      for (const [position, request] of report.requests.entries()) {
        const reply = await (started[position] ?? hostReply(request, report.tickAfter));
        if (reply !== null) replies.push(reply);
      }
      if (report.loading || replies.length > 0) { inputs = replies; continue; }
      if (ticks > 0 && report.ticksRun > 0) continue;
      return;
    }
    if (!closed) throw new Error("runner-web: live engine request loop did not settle");
  };
  const queue = (ticks: number, inputs: readonly InputRecord[] = []): Promise<void> => {
    processing = processing.then(() => pump(ticks, inputs));
    return processing;
  };
  void queue(0);
  return {
    loadState: () => assets.state(),
    audioState: () => ({ scheduled: [...sink.scheduled], open: sink.open }),
    cuesSettled: () => cueChain,
    engine,
    gameId,
    close() {
      closed = true;
      assets.close();
      decode?.close();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      graph.disconnect();
      void audioContext.close();
      renderer.dispose();
    },
    tick: () => currentTick,
    stateHash: () => currentStateHash,
    viewSize: () => ({ width: viewport.width, height: viewport.height }),
    boardKey: () => latest?.world.board?.key ?? null,
    playerPosition: () => {
      const actor = latest?.sprites.players.find((player) => player.id === latest?.sprites.selectedPlayer)
        ?? latest?.sprites.players.find((player) => player.controlled)
        ?? latest?.sprites.players[0];
      return actor === undefined ? null : { x: actor.x, y: actor.y };
    },
    async advance(ticks, inputs = []) { await queue(ticks, inputs); },
    draw(alpha) {
      const list: DrawList = engine.drawList(alpha, { shading: true, images: true, sprites: true });
      const render = renderer.render(list, {
        textures,
        surfaces: (id: SurfaceId, rev: number) => {
          const pixels = engine.surfacePixels(id, rev);
          return pixels === null ? null : { w: pixels.w, h: pixels.h, rgba: pixels.rgba };
        },
        fonts: (asset: AssetKey) => fonts.get(asset),
        ...(fonts.get(DEFAULT_FONT_ASSET) === undefined ? {} : { fallbackFont: fonts.get(DEFAULT_FONT_ASSET) }),
      });
      return { drawHash: hashDrawList(list), commands: list.commands.length, render };
    },
  };
}

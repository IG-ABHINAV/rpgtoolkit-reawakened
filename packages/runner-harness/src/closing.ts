/**
 * The closing suite of the board-rendering epic (ticket 4.28): every fetched sample game is booted through the real
 * engine (`createEngine` in boot mode, asset replies answered from the game's own files, the engine's own plugin
 * packs), driven by scripted input for a fixed number of ticks, and its frames are rasterised and hashed.
 *
 * The suite is pure: the caller supplies each game's files and receives hashes, diagnostics and pixels. Reading the
 * fetched games, comparing with committed PNGs and writing them is the headless runner's job.
 *
 * Two stand-ins fill the seams whose owners are later epics: a one-player `sprites` owner, a presence port and a
 * camera target (epic movement-triggers), and a saved-game port that never has a saved game (epic menu-party-save).
 * Neither draws a sprite, so frames show the board, its images, shading, text and the other draw-list commands.
 */

import {
  assetKey,
  createAssetIndex,
  createEmptyMainFile,
  createEngine,
  derivePackageIdentity,
  fnv1a64,
  hashDrawList,
  PACKAGE_ROOT,
  writeMainFile,
} from "@tk-reawakened/core";
import type {
  AssetIndex,
  AssetKey,
  AudioCue,
  DecodedTexture,
  DrawList,
  DrawListInclude,
  EffectRecord,
  Engine,
  EnginePhaseRegistration,
  GameState,
  InputRecord,
  RunnerRequest,
  SurfaceId,
} from "@tk-reawakened/core";
import { createNullAudio } from "./audio.ts";
import { compareRgbaWithPng } from "./png.ts";
import { createExecutionCensus, type ExecutionCensus } from "./execution-census.ts";

/** What the suite must find for a game: it boots clean, or it is a known failure that names the epic that fixes it. */
export type ClosingExpectation =
  | { readonly outcome: "boots" }
  | { readonly outcome: "boots-with-diagnostics" | "stopped"; readonly epic: string; readonly reason: string };

export type ClosingOutcome = ClosingExpectation["outcome"];

/** The main file of a game: a file inside it, or one authored here for games whose fetched tree ships none. */
export type ClosingMain =
  | { readonly file: string }
  | { readonly synthesised: { readonly startupPrg: string; readonly initBoard: string; readonly initChar: string } };

export type ClosingGamePlan = {
  readonly name: string;
  readonly dialect: "tk3" | "tk2";
  readonly main: ClosingMain;
  readonly expect: ClosingExpectation;
};

export type ClosingKeyPress = { readonly tick: number; readonly name: string; readonly code: string };

export type ClosingPlan = {
  readonly schema: 1;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly maxTicks: number;
  /** Folders under the repository root that the host ships with the engine (`media/fonts`, `media/cursors`); their files are handed to the engine as bundled assets. */
  readonly bundled: readonly string[];
  /** How many ticks each `advance` call runs; the first entry is the reference, the others must agree with it. */
  readonly batches: readonly number[];
  readonly keys: readonly ClosingKeyPress[];
  readonly frames: readonly { readonly label: string; readonly tick: number }[];
  readonly games: readonly ClosingGamePlan[];
};

export type ClosingFrameRecord = {
  readonly label: string;
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly pixelHash: string;
  readonly commands: number;
  readonly width: number;
  readonly height: number;
  /** The committed PNG, or absent when this frame's pixels equal those of the earlier frame named by `sameAs`. */
  readonly png?: string;
  readonly sameAs?: string;
};

export type ClosingDiagnostic = { readonly code: string; readonly file: string; readonly line: number; readonly message: string };

export type ClosingGameRecord = {
  readonly dialect: "tk3" | "tk2";
  readonly outcome: ClosingOutcome;
  /** The tick the game reached (the last plan tick, or where the engine stopped advancing). */
  readonly ticks: number;
  readonly bootStage: string | null;
  readonly board: string | null;
  readonly diagnostics: readonly ClosingDiagnostic[];
  readonly checkpoints: readonly { readonly tick: number; readonly stateHash: string }[];
  readonly frames: readonly ClosingFrameRecord[];
};

export type ClosingBaseline = {
  readonly schema: 1;
  readonly comment: string;
  readonly games: Readonly<Record<string, ClosingGameRecord>>;
};

/** One game's result: its record plus the pixels of every frame that owns a PNG (in record order). */
export type ClosingGameRun = {
  readonly census?: ExecutionCensus;
  readonly name: string;
  readonly record: ClosingGameRecord;
  readonly images: ReadonlyMap<string, DecodedTexture>;
  readonly batchProblems: readonly string[];
  readonly audioCues: readonly AudioCue[];
};

const INCLUDE: DrawListInclude = { shading: true, images: true, sprites: true };
const PNG_DIRECTORY = "golden/regression/closing";
export const CLOSING_BASELINE_PATH = "golden/regression/closing.json";
export const CLOSING_PLAN_PATH = "golden/closing/plan.json";

export type ClosingFiles = ReadonlyMap<string, Uint8Array>;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Parse and validate a plan; a malformed plan is a harness error, not a game failure. */
export function parseClosingPlan(text: string): ClosingPlan {
  const plan = JSON.parse(text) as ClosingPlan;
  const bad = (message: string): never => { throw new Error(`closing plan: ${message}`); };
  if (plan.schema !== 1) bad("schema must be 1");
  for (const field of ["seed", "width", "height", "maxTicks"] as const) if (!Number.isInteger(plan[field]) || plan[field] < 0) bad(`${field} must be a non-negative integer`);
  if (plan.batches.length === 0 || plan.batches.some((batch) => !Number.isInteger(batch) || batch < 1 || batch > plan.maxTicks)) bad("batches must be integers from 1 to maxTicks");
  if (!Array.isArray(plan.bundled) || plan.bundled.some((folder) => !/^media\/[a-z]+$/.test(folder))) bad("bundled lists folders such as media/fonts");
  if (plan.frames.length === 0 || new Set(plan.frames.map((frame) => frame.label)).size !== plan.frames.length) bad("frames need unique labels");
  for (const frame of plan.frames) if (!Number.isInteger(frame.tick) || frame.tick < 1 || !/^[a-z0-9-]+$/.test(frame.label)) bad(`frame ${frame.label}: label must be lowercase words and tick positive`);
  for (const key of plan.keys) if (!Number.isInteger(key.tick) || key.tick < 0) bad("key ticks must be non-negative integers");
  const names = new Set<string>();
  for (const game of plan.games) {
    if (names.has(game.name) || !/^[A-Za-z0-9_-]+$/.test(game.name)) bad(`game name ${game.name} is repeated or not a plain word`);
    names.add(game.name);
    if (game.expect.outcome !== "boots" && (game.expect.epic === "" || game.expect.reason === "")) bad(`${game.name}: an expected failure names its epic and reason`);
  }
  return plan;
}

export type ClosingRunOptions = {
  readonly trace?: boolean;
  readonly captureAudio?: boolean;
  readonly syntheticBattle?: boolean;
};

function createBootDoubles(options: ClosingRunOptions = {}) {
  let hasPlayer = false;
  let position: { x: number; y: number } | null = null;
  let latest: GameState | null = null;
  let battlePosted = false;
  const sprites = (effect: EffectRecord): void => {
    if (effect.name === "createplayer") hasPlayer = true;
    if (effect.name === "placeplayer") {
      const [x, y, , unit] = effect.args as [number, number, number, string];
      position = unit === "tile" ? { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 } : { x, y };
    }
  };
  const phaseRegistrations: EnginePhaseRegistration[] = [
    { phase: "audio", run: (state: GameState) => { latest = state; } },
  ];
  if (options.syntheticBattle === true) {
    phaseRegistrations.push({
      phase: "triggers",
      run: (_state, post) => {
        if (battlePosted || post === undefined) return;
        battlePosted = true;
        post("audio", {
          thread: 0,
          name: "music.play",
          kind: "state-write",
          args: ["media/synthetic-battle.mid", true, true, "battle"],
          out: {},
          result: null,
          patch: { section: "audio", path: [], op: "merge", value: null },
          wait: null,
          request: null,
        });
      },
    });
  }
  const effectAppliers: { readonly section: "sprites" | "triggers" | "audio"; readonly applier: (effect: EffectRecord) => void }[] = [
    { section: "sprites", applier: sprites },
    { section: "triggers", applier: () => undefined },
  ];
  if (options.captureAudio !== true) effectAppliers.push({ section: "audio", applier: () => undefined });
  return {
    options: {
      effectAppliers,
      cameraTarget: { getPlayerPosition: () => position, getEntityPosition: () => null },
      phaseRegistrations,
    },
    startup: {
      presence: { hasPlayer: () => hasPlayer },
      savedGame: { load: () => ({ kind: "missing" as const }), restored: () => false },
    },
    observed: (): GameState | null => latest,
  };
}

type Capture = {
  readonly frame: ClosingFrameRecord;
  readonly image: DecodedTexture;
  readonly drawList: DrawList;
  /** The persistent surfaces this frame's blits name, read at capture time: a later tick may replace one (AD-27). */
  readonly surfaces: ReadonlyMap<string, DecodedTexture | null>;
};
type Trace = {
  readonly census?: ExecutionCensus;
  readonly ticks: number;
  readonly stalled: boolean;
  readonly bootStage: string | null;
  readonly board: string | null;
  readonly diagnostics: readonly ClosingDiagnostic[];
  readonly checkpoints: readonly { readonly tick: number; readonly stateHash: string }[];
  readonly captures: readonly Capture[];
  readonly audioCues: readonly AudioCue[];
};


/** Read the screen surface. Its revision depends on how the ticks were batched, so scan for the current one. */
function readScreen(engine: Engine): DecodedTexture {
  for (let rev = 0; rev < 4096; rev += 1) {
    const surface = engine.surfacePixels(0 as SurfaceId, rev);
    if (surface !== null) return { w: surface.w, h: surface.h, rgba: surface.rgba };
  }
  throw new Error("the screen surface has no readable revision");
}

function capture(engine: Engine, label: string, tick: number, stateHash: string): Capture {
  const list = engine.drawList(0, INCLUDE);
  const image = readScreen(engine);
  const surfaces = new Map<string, DecodedTexture | null>();
  for (const command of list.commands) {
    if (command.kind !== "blit" || "asset" in command.source) continue;
    const key = `${command.source.surface}:${command.source.rev}`;
    if (!surfaces.has(key)) surfaces.set(key, engine.surfacePixels(command.source.surface, command.source.rev));
  }
  return {
    image,
    drawList: list,
    surfaces,
    frame: { label, tick, stateHash, drawHash: hashDrawList(list), pixelHash: fnv1a64(image.rgba), commands: list.commands.length, width: image.w, height: image.h },
  };
}

/** Boot one game and play the plan with `batch` ticks per `advance` call. */
function runOnce(plan: ClosingPlan, files: ClosingFiles, bundled: ClosingFiles, index: AssetIndex, mainKey: string, gameIdentity: string, batch: number, options: ClosingRunOptions = {}): Trace {
  const bundledFiles = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of bundled) bundledFiles.set(assetKey(path), bytes);
  const doubles = createBootDoubles(options);
  const census = options.trace === true ? createExecutionCensus() : undefined;
  const engine = createEngine({
    seed: plan.seed,
    assetIndex: index,
    assetRoot: PACKAGE_ROOT,
    mainFile: mainKey,
    gameIdentity,
    startup: doubles.startup,
    width: plan.width,
    height: plan.height,
    maxTicks: plan.maxTicks,
    include: INCLUDE,
    bundled: bundledFiles,
    ...doubles.options,
    ...(census === undefined ? {} : {
      scriptObservers: census.observers,
      phaseRegistrations: [...doubles.options.phaseRegistrations, { phase: "input" as const, run: census.beforeTick }],
    }),
  });
  const nullAudio = options.captureAudio === true ? createNullAudio() : null;
  const diagnostics: ClosingDiagnostic[] = [];
  const queued: InputRecord[] = [];
  let tick = 0;
  let stateHash = "";
  let stalled = false;

  const reply = (request: RunnerRequest, at: number): InputRecord[] => {
    if (request.kind === "asset") census?.asset(request.key, at, files.has(request.key));
    return request.kind === "asset"
      ? [{ tick: at, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : request.kind === "playVideo"
        ? [{ tick: at, event: { kind: "video.ended", reqId: request.reqId } }]
        : [];
  };

  /** Run `count` ticks, answering asset requests the way a host does; false when the engine stops advancing. */
  function advance(count: number): boolean {
    let remaining = count;
    let replies: InputRecord[] = queued.splice(0);
    for (let guard = 0; guard < 100_000; guard += 1) {
      const report = engine.advance(remaining, replies);
      replies = [];
      remaining -= report.ticksRun;
      tick = report.tickAfter;
      stateHash = report.stateHash;
      census?.checkpoint(tick, stateHash);
      for (const cue of report.audioCues) nullAudio?.handle(cue);
      for (const diagnostic of report.diagnostics) diagnostics.push({ code: diagnostic.code, file: diagnostic.file, line: diagnostic.line, message: diagnostic.message });
      const videoReplies = report.requests.flatMap((request) => reply(request, report.tickAfter));
      if (report.loading || videoReplies.length > 0) {
        replies = report.loading
          ? report.requests.flatMap((request) => reply(request, report.tickAfter))
          : videoReplies;
        continue;
      }
      if (remaining <= 0) return true;
      if (report.ticksRun === 0) return false;
    }
    throw new Error("the host loop did not settle");
  }

  const points = [...new Set([...plan.frames.map((frame) => frame.tick), ...plan.keys.map((key) => key.tick)])].sort((a, b) => a - b);
  const last = Math.max(...plan.frames.map((frame) => frame.tick));
  const checkpoints: { tick: number; stateHash: string }[] = [];
  const captures: Capture[] = [];
  // Boot first: time stays at 0 until the main file, fonts, programs and board have been answered.
  advance(0);
  for (const point of points) {
    while (tick < point && !stalled) {
      if (!advance(Math.min(batch, point - tick))) stalled = true;
    }
    if (stalled) break;
    checkpoints.push({ tick, stateHash });
    for (const frame of plan.frames) if (frame.tick === tick) captures.push(capture(engine, frame.label, tick, stateHash));
    for (const key of plan.keys) {
      if (key.tick !== tick) continue;
      for (const down of [true, false]) queued.push({ tick, event: { kind: "key", name: key.name, code: key.code, char: null, down } });
    }
  }
  // Report whatever the last frame read queued (a frame that could not be replayed is a diagnostic, not a blank image).
  advance(0);
  if (!stalled && tick < last) stalled = true;
  // The state is only visible once a tick has run; an engine that never advanced stopped during boot.
  const state = doubles.observed();
  return {
    ...(census === undefined ? {} : { census: census.result() }),
    ticks: tick,
    stalled,
    bootStage: state?.engine.boot?.stage ?? (stalled ? "stopped" : null),
    board: state?.world.board?.key ?? null,
    diagnostics,
    checkpoints,
    captures,
    audioCues: nullAudio?.cues ?? [],
  };
}

type GameFiles = { readonly all: ReadonlyMap<AssetKey, Uint8Array>; readonly index: AssetIndex; readonly mainKey: string };

function gameFiles(plan: ClosingGamePlan, files: ClosingFiles): GameFiles {
  const all = new Map<AssetKey, Uint8Array>();
  const paths: string[] = [];
  for (const [path, bytes] of files) {
    paths.push(path);
    all.set(assetKey(path), bytes);
  }
  if ("file" in plan.main) {
    if (!all.has(assetKey(plan.main.file))) throw new Error(`${plan.name}: main file ${plan.main.file} is not among the game's files`);
    return { all, index: createAssetIndex(paths), mainKey: plan.main.file };
  }
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, ...plan.main.synthesised };
  paths.push("main.gam");
  all.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  return { all, index: createAssetIndex(paths), mainKey: "main.gam" };
}

function classify(trace: Trace): ClosingOutcome {
  if (trace.stalled) return "stopped";
  return trace.bootStage === "running" && trace.diagnostics.length === 0 ? "boots" : "boots-with-diagnostics";
}

function pngPath(game: string, label: string): string {
  return `${PNG_DIRECTORY}/${game}-${label}.png`;
}

/** Compare two traces of the same game run with different batching; every difference is a determinism failure. */
function traceDifferences(batch: number, reference: Trace, other: Trace): string[] {
  const problems: string[] = [];
  const tag = `batch ${batch}`;
  if (other.ticks !== reference.ticks) problems.push(`${tag}: reached tick ${other.ticks}, reference reached ${reference.ticks}`);
  if (JSON.stringify(other.diagnostics) !== JSON.stringify(reference.diagnostics)) problems.push(`${tag}: diagnostics differ from the reference run`);
  if (JSON.stringify(other.audioCues) !== JSON.stringify(reference.audioCues)) problems.push(`${tag}: audio cues differ from the reference run`);
  for (const [index, checkpoint] of reference.checkpoints.entries()) {
    const found = other.checkpoints[index];
    if (found === undefined || found.tick !== checkpoint.tick || found.stateHash !== checkpoint.stateHash) problems.push(`${tag}: state hash at tick ${checkpoint.tick} is ${found?.stateHash ?? "missing"}, reference ${checkpoint.stateHash}`);
  }
  for (const [index, frame] of reference.captures.entries()) {
    const found = other.captures[index]?.frame;
    if (found === undefined || found.drawHash !== frame.frame.drawHash || found.pixelHash !== frame.frame.pixelHash) problems.push(`${tag}: frame ${frame.frame.label} draw/pixel hash is ${found?.drawHash ?? "missing"}/${found?.pixelHash ?? "missing"}, reference ${frame.frame.drawHash}/${frame.frame.pixelHash}`);
  }
  return problems;
}

/** One captured frame with the draw list that produced it, for a host that draws the frames itself. */
export type ClosingFrameWithDrawList = ClosingFrameRecord & {
  readonly drawList: DrawList;
  /** `"<surface>:<rev>"` to the pixels that surface held when the frame was captured (AD-27). */
  readonly surfaces: ReadonlyMap<string, DecodedTexture | null>;
  /** The engine's own screen pixels, the reference a replayer's frame is compared with (AD-4). */
  readonly pixels: Uint8Array;
};

/** What a host needs to draw a closing frame outside the headless runner (the browser lane, 9.3). */
export type ClosingFrameRun = {
  readonly ticks: number;
  readonly stalled: boolean;
  readonly board: string | null;
  readonly diagnostics: readonly ClosingDiagnostic[];
  readonly frames: readonly ClosingFrameWithDrawList[];
};

/**
 * Boot one game exactly as the closing suite does — same plan, same asset replies, the plan's first batch, which is the
 * batch the committed baseline records — and return its captured frames with their draw lists and the surfaces they
 * name. A host that must present the frames itself reuses this so its hashes are the baseline's by construction, not by
 * a copy of the boot sequence. The cross-batch determinism check stays `runClosingGame`'s.
 */
export function runClosingFrames(
  plan: ClosingPlan,
  game: ClosingGamePlan,
  files: ClosingFiles,
  bundled: ClosingFiles,
  options: ClosingRunOptions = {},
): ClosingFrameRun {
  const { all, index, mainKey } = gameFiles(game, files);
  const gameIdentity = derivePackageIdentity([...all].map(([path, bytes]) => ({ path, bytes })));
  const trace = runOnce(plan, all, bundled, index, mainKey, gameIdentity, plan.batches[0] ?? 1, options);
  return {
    ticks: trace.ticks,
    stalled: trace.stalled,
    board: trace.board,
    diagnostics: trace.diagnostics,
    frames: trace.captures.map((capture) => ({ ...capture.frame, drawList: capture.drawList, surfaces: capture.surfaces, pixels: capture.image.rgba })),
  };
}

/** Run one game for every batch size of the plan and return the reference record with any batching disagreement. */
export function runClosingGame(plan: ClosingPlan, game: ClosingGamePlan, files: ClosingFiles, bundled: ClosingFiles, options: ClosingRunOptions = {}): ClosingGameRun {
  const { all, index, mainKey } = gameFiles(game, files);
  // AD-17: the host owns the game identity; here it is the package's content digest.
  const gameIdentity = derivePackageIdentity([...all].map(([path, bytes]) => ({ path, bytes })));
  const plainOptions = { ...options, trace: false };
  const traces = plan.batches.map((batch) => runOnce(plan, all, bundled, index, mainKey, gameIdentity, batch, plainOptions));
  const reference = traces[0];
  if (reference === undefined) throw new Error("the plan has no batch sizes");
  const batchProblems = plan.batches.flatMap((batch, position) => (position === 0 || traces[position] === undefined ? [] : traceDifferences(batch, reference, traces[position] as Trace)));
  const traced = options.trace === true ? runOnce(plan, all, bundled, index, mainKey, gameIdentity, 1, options) : undefined;
  if (traced !== undefined) batchProblems.push(...traceDifferences(1, reference, traced).map((problem) => `trace changed execution: ${problem}`));
  const images = new Map<string, DecodedTexture>();
  const frames: ClosingFrameRecord[] = [];
  const seen = new Map<string, string>();
  for (const { frame, image } of reference.captures) {
    const earlier = seen.get(frame.pixelHash);
    if (earlier !== undefined) {
      frames.push({ ...frame, sameAs: earlier });
      continue;
    }
    seen.set(frame.pixelHash, frame.label);
    const path = pngPath(game.name, frame.label);
    images.set(path, image);
    frames.push({ ...frame, png: path });
  }
  return {
    name: game.name,
    ...(traced?.census === undefined ? {} : { census: traced.census }),
    batchProblems,
    audioCues: reference.audioCues,
    images,
    record: {
      dialect: game.dialect,
      outcome: classify(reference),
      ticks: reference.ticks,
      bootStage: reference.bootStage,
      board: reference.board,
      diagnostics: reference.diagnostics.filter((diagnostic, position, list) => list.findIndex((other) => JSON.stringify(other) === JSON.stringify(diagnostic)) === position),
      checkpoints: reference.checkpoints,
      frames,
    },
  };
}

/** Run every game of the plan; `load` supplies one game's files at a time so only one game is held in memory. */
export function runClosingSuite(plan: ClosingPlan, load: (name: string) => ClosingFiles, bundled: ClosingFiles, options: ClosingRunOptions = {}): readonly ClosingGameRun[] {
  return plan.games.map((game) => runClosingGame(plan, game, load(game.name), bundled, options));
}

const BASELINE_COMMENT = "Regression baselines of the closing suite (ticket 4.28): each sample game booted through the real engine, driven by golden/closing/plan.json. Every PNG is class regression-baseline in golden/ledger.json: it locks what Reawakened draws today and is no independent reference. Regenerating is a deliberate act like a golden (G5): run `pnpm closing:record` and review the diff.";

/** The baseline file text for a run. */
export function formatClosingBaseline(runs: readonly ClosingGameRun[]): string {
  const games: Record<string, ClosingGameRecord> = {};
  for (const run of runs) games[run.name] = run.record;
  const baseline: ClosingBaseline = { schema: 1, comment: BASELINE_COMMENT, games };
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

/** The ledger rows for a run: one regression-baseline row per committed PNG, in game and frame order. */
export function closingLedgerRows(runs: readonly ClosingGameRun[]): readonly { readonly path: string; readonly scene: string; readonly suite: "closing"; readonly class: "regression-baseline"; readonly gating: true; readonly producer: "4.28" }[] {
  return runs.flatMap((run) => run.record.frames.flatMap((frame) => (frame.png === undefined ? [] : [{ path: frame.png, scene: `closing:${run.name}:${frame.label}`, suite: "closing" as const, class: "regression-baseline" as const, gating: true as const, producer: "4.28" as const }])));
}

export type ClosingCheck = { readonly ok: boolean; readonly lines: readonly string[] };

function describe(run: ClosingGameRun, expect: ClosingExpectation): string {
  const record = run.record;
  const frames = record.frames.map((frame) => `${frame.label}=${frame.pixelHash}${frame.sameAs === undefined ? "" : `(=${frame.sameAs})`}`).join(" ");
  const where = record.board === null ? `stage ${record.bootStage ?? "none"}` : `board ${record.board}`;
  const diagnostics = record.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.file}:${diagnostic.line}`).join(", ");
  const verdict = expect.outcome === "boots" ? "boots" : `expected failure (${expect.epic}): ${record.outcome}`;
  return `${run.name}: ${verdict}; ${where}; ${record.ticks} ticks; state ${record.checkpoints.at(-1)?.stateHash ?? "none"}; frames ${frames === "" ? "none" : frames}${diagnostics === "" ? "" : `; diagnostics ${diagnostics}`}`;
}

/**
 * Compare a run with the committed baseline, PNGs and ledger. `readPng` returns a committed PNG's bytes (or undefined
 * when absent). The check fails on any drift, on a game whose outcome is not the one the plan expects (including a
 * known failure that now succeeds, so the marker is removed deliberately), and on any batching disagreement.
 */
export function checkClosingSuite(plan: ClosingPlan, runs: readonly ClosingGameRun[], baselineText: string | undefined, readPng: (path: string) => Uint8Array | undefined, ledgerText: string | undefined): ClosingCheck {
  const lines: string[] = [];
  const problems: string[] = [];
  let baseline: ClosingBaseline | undefined;
  if (baselineText === undefined) problems.push(`${CLOSING_BASELINE_PATH} is absent; run pnpm closing:record and review the result`);
  else baseline = JSON.parse(baselineText) as ClosingBaseline;
  for (const game of plan.games) {
    const run = runs.find((candidate) => candidate.name === game.name);
    if (run === undefined) { problems.push(`${game.name}: not run`); continue; }
    lines.push(describe(run, game.expect));
    for (const problem of run.batchProblems) problems.push(`${game.name}: ${problem}`);
    if (run.record.outcome !== game.expect.outcome) problems.push(`${game.name}: outcome is ${run.record.outcome} but the plan expects ${game.expect.outcome}${run.record.diagnostics[0] === undefined ? "" : ` (first diagnostic ${run.record.diagnostics[0].code} at ${run.record.diagnostics[0].file}:${run.record.diagnostics[0].line}: ${run.record.diagnostics[0].message})`}`);
    if (game.expect.outcome === "stopped" && run.record.diagnostics.length === 0) problems.push(`${game.name}: stopped without reporting a diagnostic`);
    const recorded = baseline?.games[game.name];
    if (baseline !== undefined && recorded === undefined) problems.push(`${game.name}: no committed baseline`);
    if (recorded !== undefined && JSON.stringify(recorded) !== JSON.stringify(run.record)) problems.push(`${game.name}: record drifted from the committed baseline${driftDetail(recorded, run.record)}`);
    for (const [path, image] of run.images) {
      const committed = readPng(path);
      if (committed === undefined) { problems.push(`${game.name}: ${path} is absent`); continue; }
      const comparison = compareRgbaWithPng(image, committed);
      if (comparison.error !== null) problems.push(`${game.name}: ${path}: ${comparison.error}`);
      else if (!comparison.equal) problems.push(`${game.name}: ${path}: first differing pixel ${JSON.stringify(comparison.firstDifference)}; maximum channel error ${comparison.maxChannelError}`);
    }
  }
  if (baseline !== undefined) for (const name of Object.keys(baseline.games)) if (!plan.games.some((game) => game.name === name)) problems.push(`${name}: committed baseline for a game the plan no longer lists`);
  problems.push(...ledgerProblems(runs, ledgerText));
  return { ok: problems.length === 0, lines: problems.length === 0 ? lines : [...lines, ...problems.map((problem) => `closing: ${problem}`)] };
}

/** Name the first field of a game's record that moved, so a failure points at what drifted. */
function driftDetail(recorded: ClosingGameRecord, actual: ClosingGameRecord): string {
  for (const key of ["outcome", "ticks", "bootStage", "board", "diagnostics"] as const) if (JSON.stringify(recorded[key]) !== JSON.stringify(actual[key])) return ` (${key}: ${JSON.stringify(recorded[key])} became ${JSON.stringify(actual[key])})`;
  for (const [position, checkpoint] of recorded.checkpoints.entries()) {
    const found = actual.checkpoints[position];
    if (found === undefined || found.stateHash !== checkpoint.stateHash) return ` (state hash at tick ${checkpoint.tick}: ${checkpoint.stateHash} became ${found?.stateHash ?? "missing"})`;
  }
  for (const [position, frame] of recorded.frames.entries()) {
    const found = actual.frames[position];
    if (found === undefined) return ` (frame ${frame.label} is no longer reached)`;
    for (const key of ["drawHash", "pixelHash", "stateHash"] as const) if (found[key] !== frame[key]) return ` (frame ${frame.label} ${key}: ${frame[key]} became ${found[key]})`;
  }
  return "";
}

type LedgerRow = { readonly path?: string; readonly scene?: string; readonly suite?: string; readonly class?: string; readonly gating?: boolean; readonly producer?: string };

/** The ledger must list exactly this run's PNGs as gating regression baselines. */
function ledgerProblems(runs: readonly ClosingGameRun[], ledgerText: string | undefined): string[] {
  if (ledgerText === undefined) return ["golden/ledger.json is absent"];
  const ledger: { readonly goldens: readonly LedgerRow[] } = JSON.parse(ledgerText);
  const rows = ledger.goldens.filter((row) => row.suite === "closing");
  const expected = closingLedgerRows(runs);
  const problems: string[] = [];
  for (const row of expected) {
    const found = rows.find((candidate) => candidate.path === row.path);
    if (found === undefined) problems.push(`ledger has no row for ${row.path}`);
    else if (JSON.stringify(found) !== JSON.stringify(row)) problems.push(`ledger row for ${row.path} is not a gating regression-baseline row produced by 4.28`);
  }
  for (const row of rows) if (!expected.some((candidate) => candidate.path === row.path)) problems.push(`ledger lists ${row.path}, which the closing suite no longer produces`);
  return problems;
}

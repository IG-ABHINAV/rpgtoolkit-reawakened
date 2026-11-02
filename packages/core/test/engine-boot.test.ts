// Boot and `send` on the engine loop (ticket 4.20; docs/spec/engine/main-loop-and-startup.md#e-02,
// docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence, #reawakened-board-entry and
// docs/spec/engine/movement-and-collision.md#reawakened-send-board).
//
// The games are authored here from the format layouts (G7). The test doubles stand in for
// movement-triggers (first player, presence, camera target) and menu-party-save (saved games)
// until those epics register the real owners.
import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import {
  actorFromSource,
  addActor,
  assetKey,
  createAssetIndex,
  createSpriteRuntime,
  createEmptyBoard,
  createEmptyCharacter,
  enqueueDirectionMove,
  IR_VERSION,
  BATTLE_BACKGROUND_MAGIC,
  createEmptyMainFile,
  ENGINE_DEFAULT_MANIFEST,
  hashDrawList,
  hashGameLedger,
  hashGameState,
  nextUint32,
  createEngine,
  PACKAGE_ROOT,
  runMovementPhase,
  writeBattleBackground,
  writeBoard,
  writeMainFile,
  promoteRecovery,
  writeCharacter,
  selectRecovery,
  projectGameLedger,
  registerActorObject,
  restoreRecoveryCandidate,
  snapshotGameSave,
  startProgram,
  startThread,
} from "../src/index.ts";
import { engineEffect, pluginManifestFor, resolveManifestPlugins } from "../src/engine/boot.ts";
import { hashWithRequestCounter } from "./hash-projections.ts";
import type { AssetIndex, AssetRoot, Engine, EffectRecord, EngineInit, GameState, InputRecord, PackageCatalogueEntry, PlainData, ResolvedPlugin, SpriteDraw, SpriteRuntime, TickReport } from "../src/index.ts";
import type { MainFileAudioSettings } from "../src/formats/main-file/model.ts";
import type { AudioCue } from "../src/ports/audio.ts";
import { BUILTIN_TRACKS } from "../src/audio/model.ts";
import { createAudioRuntime } from "../src/audio/runtime.ts";
import { queueNativeEvent } from "../src/events/emitter.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const encoder = new TextEncoder();

type Files = Map<string, Uint8Array>;
type BoardSpec = { readonly music?: string; readonly enter?: string; readonly threads?: readonly string[]; readonly tiles?: readonly [number, number]; readonly start?: readonly [number, number]; readonly battleBackground?: string };
type GameSpec = {
  readonly startup?: string;
  readonly initChar?: string;
  readonly initBoard?: string;
  readonly boards: Readonly<Record<string, BoardSpec>>;
  readonly programs: Readonly<Record<string, string>>;
  readonly fonts?: Readonly<Record<string, Uint8Array>>;
  readonly plugins?: readonly string[];
  /** The TKR package names of the main file's package-list extension, in order. */
  readonly packages?: readonly string[];
  readonly audioSettings?: MainFileAudioSettings | null;
  readonly soundFonts?: readonly string[];
  /** Battle background files by filename; they are added under `Bkrounds/`. */
  readonly battleBackgrounds?: Readonly<Record<string, { readonly music: string; readonly menuMoveSound: string; readonly menuChooseSound: string; readonly readySound: string; readonly cantDoSound: string }>>;
  /** Menu cursor sounds by filename. */
  readonly cursorSounds?: { readonly move?: string; readonly select?: string; readonly cancel?: string };
  /** Lay the game out as a game folder (`Main/` plus `Game/<project>/`) instead of a package. */
  readonly project?: string;
};

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function boardBytes(spec: BoardSpec): Uint8Array {
  const [sizeX, sizeY] = spec.tiles ?? [40, 30];
  const cells = sizeX * sizeY;
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX,
    sizeY,
    sizeL: 1,
    tileMatrix: Array.from({ length: cells }, () => 0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
    threads: [...(spec.threads ?? [])],
    layerTitles: ["", ""],
    properties: {
      ...empty.properties,
      backgroundMusic: spec.music ?? "",
      enterPrg: spec.enter ?? "",
      start: { x: spec.start?.[0] ?? 64, y: spec.start?.[1] ?? 64, layer: 1 },
      battleBackground: spec.battleBackground ?? "",
    },
  }));
}

type AuthoredGame = { readonly files: Files; readonly index: AssetIndex; readonly main: string; readonly root: AssetRoot };

/** Author a package-rooted game: its files by canonical key and the index over their paths. */
function authorGame(spec: GameSpec): AuthoredGame {
  const prefix = spec.project === undefined ? "" : `Game/${spec.project}/`;
  const mainPath = spec.project === undefined ? "main.gam" : "Main/test.gam";
  const paths: string[] = [mainPath];
  const files: Files = new Map();
  const add = (path: string, bytes: Uint8Array): void => {
    paths.push(`${prefix}${path}`);
    files.set(assetKey(`${prefix}${path}`), bytes);
  };
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    projectPath: spec.project ?? "",
    startupPrg: spec.startup ?? "",
    initBoard: spec.initBoard ?? "start.brd",
    initChar: spec.initChar ?? "",
    plugins: (spec.plugins ?? []).map((pluginFile) => ({ enabled: 0, pluginFile })),
    audioSettings: spec.audioSettings ?? null,
    cursorMoveSound: spec.cursorSounds?.move ?? "",
    cursorSelectSound: spec.cursorSounds?.select ?? "",
    cursorCancelSound: spec.cursorSounds?.cancel ?? "",
    ...(spec.packages === undefined ? {} : { packagePlugins: spec.packages }),
  };
  files.set(assetKey(mainPath), unwrap(writeMainFile(main)));
  for (const [name, board] of Object.entries(spec.boards)) add(`Boards/${name}`, boardBytes(board));
  for (const [name, sounds] of Object.entries(spec.battleBackgrounds ?? {})) {
    add(`Bkrounds/${name}`, unwrap(writeBattleBackground({
      magic: BATTLE_BACKGROUND_MAGIC,
      major: 2,
      minor: 2,
      image: "",
      ...sounds,
      residue: new Uint8Array(),
    })));
    add(`Media/${sounds.music}`, new Uint8Array([0]));
    add(`Media/${sounds.menuMoveSound}`, new Uint8Array([0]));
    add(`Media/${sounds.menuChooseSound}`, new Uint8Array([0]));
    add(`Media/${sounds.readySound}`, new Uint8Array([0]));
    add(`Media/${sounds.cantDoSound}`, new Uint8Array([0]));
  }
  for (const [name, text] of Object.entries(spec.programs)) add(`Prg/${name}`, encoder.encode(text));
  for (const [name, bytes] of Object.entries(spec.fonts ?? {})) add(`Font/${name}`, bytes);
  if (spec.initChar !== undefined && spec.initChar !== "") add(`Chrs/${spec.initChar}`, unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill("") })));
  for (const name of [spec.cursorSounds?.move, spec.cursorSounds?.select, spec.cursorSounds?.cancel]) {
    if (name !== undefined && name !== "") add(`Media/${name}`, new Uint8Array([0]));
  }
  for (const media of ["theme.mid", "other.mid"]) add(`Media/${media}`, new Uint8Array([0]));
  for (const name of spec.soundFonts ?? []) add(`Media/${name}`, new Uint8Array([0]));
  const root: AssetRoot = spec.project === undefined ? PACKAGE_ROOT : { kind: "game", projectPath: "" };
  return { files, index: createAssetIndex(paths), main: mainPath, root };
}

type Doubles = {
  readonly players: PlainData[];
  readonly sprites: EffectRecord[];
  readonly triggers: EffectRecord[];
  readonly audio: EffectRecord[];
  readonly options: Pick<EngineInit, "effectAppliers" | "cameraTarget" | "phaseRegistrations">;
  readonly startup: { readonly presence: { hasPlayer(): boolean }; readonly savedGame: { load(): { readonly kind: "missing" }; restored(): boolean } };
  readonly stageHistory: string[];
  state(): GameState;
};

/** Movement-triggers and menu-party-save stand-ins: a one-player sprites owner, a presence port and a saved-game port. */
function makeDoubles(
  restored = false,
  extraPhases: NonNullable<EngineInit["phaseRegistrations"]> = [],
): Doubles {
  const stageHistory: string[] = [];
  const players: PlainData[] = [];
  const sprites: EffectRecord[] = [];
  const triggers: EffectRecord[] = [];
  const audio: EffectRecord[] = [];
  let position: { x: number; y: number } | null = null;
  let latest: GameState | null = null;
  return {
    players,
    sprites,
    triggers,
    audio,
    options: {
      effectAppliers: [
        {
          section: "sprites",
          applier: (effect) => {
            sprites.push(effect);
            if (effect.name === "createplayer") players.push(effect.args[0] ?? null);
            if (effect.name === "placeplayer") {
              const [x, y, , unit] = effect.args as [number, number, number, string];
              position = unit === "tile" ? { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 } : { x, y };
            }
          },
        },
        { section: "triggers", applier: (effect) => triggers.push(effect) },
        { section: "audio", applier: (effect) => audio.push(effect) },
      ],
      cameraTarget: { getPlayerPosition: () => (players.length === 0 ? null : position), getEntityPosition: () => null },
      phaseRegistrations: [
        { phase: "audio", run: (state) => { latest = state; stageHistory.push(state.engine.boot?.stage ?? "scene"); } },
        ...extraPhases,
      ],
    },
    startup: { presence: { hasPlayer: () => players.length > 0 }, savedGame: { load: () => ({ kind: "missing" }), restored: () => restored } },
    stageHistory,
    state: () => {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
  };
}

type RunResult = { readonly report: TickReport; readonly cues: AudioCue[]; readonly requests: string[]; readonly diagnostics: { readonly code: string; readonly file: string; readonly line: number; readonly message: string }[]; readonly ticksRun: number };

/** Play the host: answer every asset request from `files` and keep advancing until `ticks` ran or the engine stops. */
function run(engine: Engine, files: Files, ticks: number, inputs: readonly InputRecord[] = []): RunResult {
  const requests: string[] = [];
  const cues: AudioCue[] = [];
  const diagnostics: RunResult["diagnostics"][number][] = [];
  let remaining = ticks;
  let ran = 0;
  let replies: InputRecord[] = [...inputs];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    ran += report.ticksRun;
    remaining -= report.ticksRun;
    diagnostics.push(...report.diagnostics);
    cues.push(...report.audioCues);
    for (const request of report.requests) if (request.kind === "asset") requests.push(request.key);
    if (report.loading) {
      replies = report.requests.flatMap((request) => (request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }] : []));
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) return { report, cues, requests, diagnostics, ticksRun: ran };
  }
  throw new Error("the host loop did not settle");
}

function bootEngine(game: AuthoredGame, doubles: Doubles, packageCatalogue?: readonly PackageCatalogueEntry[], plugins?: readonly ResolvedPlugin[], recoveryCandidate?: Uint8Array, spriteRuntime?: SpriteRuntime): Engine {
  return createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: game.root,
    mainFile: game.main,
    gameIdentity: "engine-boot-test",
    startup: doubles.startup,
    width: 320,
    height: 240,
    maxTicks: 600,
    ...(packageCatalogue === undefined ? {} : { packageCatalogue }),
    ...(plugins === undefined ? {} : { plugins: [...resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins, ...plugins] }),
    ...(recoveryCandidate === undefined ? {} : { recoveryCandidate }),
    ...(spriteRuntime === undefined ? {} : { spriteRuntime }),
    ...doubles.options,
  });
}

const liberation = new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "LiberationSans-Regular.ttf")));

const SCRIPTED: GameSpec = {
  startup: "start.prg",
  initChar: "hero.tem",
  fonts: { "Good.ttf": liberation, "Broken.ttf": new Uint8Array([1, 2, 3, 4]) },
  boards: {
    "start.brd": { music: "theme.mid", enter: "enter.prg", threads: ["bg.prg"], tiles: [40, 30] },
  },
  programs: {
    "start.prg": "started = 1\nsleep(1)\nstartdone = 1\nend()\n",
    "enter.prg": "entered = 1\nend()\n",
    "bg.prg": "threadsleep(getthreadid(), 0)\n",
  },
};

test("a scripted game boots from start.prg to its first board with the ruled effects and state", () => {
  const game = authorGame(SCRIPTED);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 30);
  deepEqual(result.requests.slice(0, 1), ["main.gam"]);
  deepEqual(result.requests.filter((key) => key.startsWith("font/")), ["font/good.ttf", "font/broken.ttf"]);
  equal(result.requests.indexOf("prg/start.prg") > 0, true);
  equal(result.requests.includes("boards/start.brd"), true);
  deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["font.rejected"]);
  const state = doubles.state();
  equal(state.engine.boot?.stage, "running");
  deepEqual(state.engine.boot?.fonts, ["font/good.ttf"]);
  equal(state.world.board?.key, "boards/start.brd");
  deepEqual(doubles.players, ["chrs/hero.tem"]);
  equal(state.vm.globals.started, 1);
  equal(state.vm.globals.startdone, 1);
  equal(state.vm.globals.entered, 1);
  deepEqual(doubles.sprites.map((effect) => [effect.name, ...effect.args]), [["createplayer", "chrs/hero.tem"], ["placeplayer", 64, 64, 1, "pixel"]]);
  deepEqual(doubles.triggers.map((effect) => [effect.name, ...effect.args]), [["deactivateat", 64, 64, 1, "pixel"]]);
  deepEqual(doubles.audio.map((effect) => [effect.name, effect.kind, ...effect.args]), [["music.play", "draw-audio-cue", "media/theme.mid", true, null, "board"]]);
  deepEqual({ x: state.camera.x, y: state.camera.y }, { x: 0, y: 0 });
  equal(state.vm.threads.some((thread) => thread.kind === "board" && thread.status !== "finished"), true);
});

test("E-02 requests initChar and creates its real party actor and sprite before startup and board entry", () => {
  const game = authorGame({
    startup: "start.prg",
    initChar: "hero.tem",
    boards: { "start.brd": {} },
    programs: { "start.prg": "end()\n" },
  });
  const observed: { current: GameState | null } = { current: null };
  let presenceAtStartup: boolean | null = null;
  const spriteRuntime = createSpriteRuntime();
  const engine = createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: game.root,
    mainFile: game.main,
    gameIdentity: "engine-boot-initial-player",
    startup: {
      presence: { hasPlayer: () => {
        presenceAtStartup = spriteRuntime.hasPlayer();
        return presenceAtStartup;
      } },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: 320,
    height: 240,
    maxTicks: 600,
    spriteRuntime,
    phaseRegistrations: [{ phase: "input", run: (state) => { observed.current = JSON.parse(JSON.stringify(state)) as GameState; } }],
  });

  const result = run(engine, game.files, 1);
  ok(result.requests.includes("chrs/hero.tem"));
  equal(presenceAtStartup, true);
  const seen = observed.current;
  ok(seen !== null);
  equal(seen.world.board ?? null, null);
  equal(seen.actors.actors.length, 1);
  equal(seen.actors.actors[0]?.name, "Hero");
  deepEqual(seen.party.members, [seen.actors.actors[0]?.id]);
  equal(seen.sprites.players.length, 1);
  equal(seen.sprites.players[0]?.source, "chrs/hero.tem");
  equal(seen.sprites.players[0]?.actorId, seen.party.selected);
  equal(spriteRuntime.section.players.length, 1);
  equal(spriteRuntime.section.players[0]?.actorId, seen.party.selected);
});

test("E-52: drawList draws the authoritative sprite section and keeps static scene sprites", () => {
  const game = authorGame({
    startup: "start.prg",
    initChar: "hero.tem",
    boards: { "start.brd": {} },
    programs: { "start.prg": "end()\n" },
  });
  const staticSprite: SpriteDraw = { id: "scene", key: "item", layer: 1, x: 24, y: 24, drawId: 0 };
  let walking = true;
  const engine = createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: game.root,
    mainFile: game.main,
    gameIdentity: "engine-boot-compositor",
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: 320,
    height: 240,
    maxTicks: 600,
    include: { shading: false, images: false, sprites: true },
    sprites: [staticSprite],
    phaseRegistrations: [{
      phase: "movement",
      run: (state) => {
        const player = state.sprites.players[0];
        if (walking && player !== undefined && player.queue.moves.length === 0) enqueueDirectionMove(state.sprites, player.id, "E");
        runMovementPhase(state.sprites, state.world.board ?? null, state.time.tick, {});
      },
    }],
  });
  /** The fallback-coloured square the compositor draws for one sprite that has no artwork loaded. */
  const squares = (): { readonly x: number; readonly rgb: { readonly r: number; readonly g: number; readonly b: number } }[] =>
    engine.drawList(0, { shading: false, images: false, sprites: true }).commands.flatMap((command) => command.kind === "rect" && command.filled
      ? [{ x: command.rect.x, rgb: command.rgb }]
      : []);

  run(engine, game.files, 10);
  const first = squares();
  ok(first.some((square) => square.rgb.r === 64 && square.rgb.g === 96 && square.rgb.b === 224), "the state section's player is drawn");
  ok(first.some((square) => square.rgb.r === 192 && square.rgb.g === 128 && square.rgb.b === 32), "the static scene sprite stays additional");
  const playerX = first.find((square) => square.rgb.b === 224)?.x;

  run(engine, game.files, 40);
  walking = false;
  run(engine, game.files, 40);
  const moved = squares().find((square) => square.rgb.b === 224)?.x;
  ok(playerX !== undefined && moved !== undefined && moved > playerX, "moving the player in state moves the drawn sprite");
});

test("an invalid initChar does not fabricate player presence", () => {
  const game = authorGame({ initChar: "broken.tem", boards: { "start.brd": {} }, programs: {} });
  game.files.set(assetKey("chrs/broken.tem"), new Uint8Array([0]));
  const spriteRuntime = createSpriteRuntime();
  const engine = createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: game.root,
    mainFile: game.main,
    gameIdentity: "engine-boot-invalid-initial-player",
    startup: {
      presence: { hasPlayer: () => spriteRuntime.hasPlayer() },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: 320,
    height: 240,
    maxTicks: 600,
    spriteRuntime,
  });

  const result = run(engine, game.files, 1);
  equal(spriteRuntime.hasPlayer(), false);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "startup.no-player"), true);
  equal(result.requests.includes("boards/start.brd"), false);
});

test("battleEnded dispatches before boardReturned and restores active board music before audio", () => {
  const game = authorGame({
    startup: "start.prg",
    initChar: "hero.tem",
    boards: { "start.brd": { music: "theme.mid" } },
    programs: {
      "start.prg": [
        'eventOrder = ""',
        'game.on("battleEnded", (event) => {',
        '  eventOrder = eventOrder + "B"',
        '  battleOutcome = event.detail.outcome',
        '})',
        'game.on("boardReturned", (event) => {',
        '  eventOrder = eventOrder + "R"',
        '  returnedBoard = event.detail["boardKey"]',
        '})',
        "listenerReady = 1",
        "end()",
      ].join("\n"),
    },
  });
  let queuedBattleEnd = false;
  let doubles!: Doubles;
  doubles = makeDoubles(false, [{
    phase: "events",
    run(state, postEffect) {
      if (queuedBattleEnd || state.vm.globals.listenerready !== 1) return;
      if (!doubles.audio.some((effect) => effect.name === "music.play" && effect.args[3] === "board")) return;
      queuedBattleEnd = true;
      postEffect?.("audio", engineEffect("audio", "music.play", [
        assetKey("media/other.mid"), true, false, "battle",
      ], "draw-audio-cue"));
      queueNativeEvent(state.vm, state.events, "game", "battleEnded", { outcome: 0 });
    },
  }]);
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 8);
  const state = doubles.state();
  equal(queuedBattleEnd, true);
  deepEqual(result.diagnostics, []);
  equal(state.vm.globals.eventorder, "BR");
  equal(state.vm.globals.battleoutcome, 0);
  equal(state.vm.globals.returnedboard, "boards/start.brd");
  deepEqual(doubles.audio.filter((effect) => effect.name === "music.play").map((effect) => effect.args), [
    [assetKey("media/theme.mid"), true, null, "board"],
    [assetKey("media/other.mid"), true, false, "battle"],
    [assetKey("media/theme.mid"), true, null, "board"],
  ]);
});

test("engine-backed dialogue displays through the message window and resumes on input", () => {
  const game = authorGame(SCRIPTED);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  run(engine, game.files, 30);
  const state = doubles.state();
  const board = state.world.board;
  if (board == null) throw new Error("boot did not load its first board");
  const actor = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    stats: { hp: 12, maxHp: 12, smp: 4, maxSmp: 4, dp: 2, fp: 3, level: 1 },
    behaviour: "stock-rpg.hero",
  });
  const source = actorFromSource({
    id: "dialogue-player",
    kind: "player",
    source: "hero.tem",
    x: 64,
    y: 64,
    layer: 1,
    controlled: true,
  }, board, 0, null);
  state.sprites.players = [{ ...source, actorId: actor.id }];
  const thread = startProgram(state.vm, {
    kind: "inline",
    text: 'dialogue("Hello, <name>")',
    ir: IR_VERSION,
  });
  thread.source = source.id;
  state.vm.globals.name = "Ada";

  engine.advance(1, []);
  equal(state.ui.message.text, "Hello, Ada");
  equal(thread.status, "waiting");
  engine.advance(1, []);


  engine.advance(1, [{
    tick: state.time.tick,
    event: { kind: "key", name: "Enter", code: "Enter", char: null, down: true },
  }]);
  equal(thread.status, "finished");
});


test("boot is deterministic and independent of how ticks are batched", () => {
  const game = authorGame(SCRIPTED);
  const whole = bootEngine(game, makeDoubles());
  const wholeResult = run(whole, game.files, 30);
  const stepped = bootEngine(game, makeDoubles());
  let steppedHash = "";
  let ticks = 0;
  for (let step = 0; step < 30; step += 1) {
    const result = run(stepped, game.files, 1);
    ticks += result.ticksRun;
    steppedHash = result.report.stateHash;
  }
  equal(ticks, 30);
  equal(steppedHash, wholeResult.report.stateHash);
  const again = run(bootEngine(game, makeDoubles()), game.files, 30);
  equal(again.report.stateHash, wholeResult.report.stateHash);
});

test("a board whose thread list is the one empty string the editor writes starts no board thread and reports nothing", () => {
  // The sample games' start boards carry exactly this list (docs/spec/formats/board.md: an empty list is one empty string, empty entries ignored).
  const game = authorGame({ ...SCRIPTED, boards: { "start.brd": { music: "theme.mid", enter: "", threads: [""], tiles: [40, 30] } } });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 30);
  deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.code === "program.missing"), []);
  equal(doubles.state().vm.threads.some((thread) => thread.kind === "board"), false);
  equal(doubles.state().engine.boot?.stage, "running");
});

test("a game with no player stops with the ruled diagnostic and runs no board", () => {
  const game = authorGame({ ...SCRIPTED, initChar: "" });
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 30);
  const stopped = result.diagnostics.find((diagnostic) => diagnostic.code === "startup.no-player");
  equal(stopped?.message, "an initial character must be defined");
  equal(result.requests.includes("boards/start.brd"), false);
  const next = engine.advance(5, []);
  equal(next.ticksRun, 0);
  equal(doubles.state().engine.boot?.stage, "stopped");
});

test("a restored saved game skips initBoard and its board entry", () => {
  const game = authorGame(SCRIPTED);
  const doubles = makeDoubles(true);
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 20);
  equal(result.requests.includes("boards/start.brd"), false);
  equal(doubles.state().engine.boot?.stage, "running");
  equal(doubles.audio.length, 0);
});

test("a legacy stock plugin row installs its package and an unmapped DLL is one located diagnostic", () => {
  const game = authorGame({ ...SCRIPTED, plugins: ["no-such-plugin.dll", "Plugin\\tk3fight.dll"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "stock_battle",
    version: "1.0.0",
    requests: [],
    definition: { id: "stock_battle", version: "1.0.0", commands: [] },
    startup: { kind: "inline", text: "packageStarted = 1\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 30);
  deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "plugin.legacy-unmapped").map((diagnostic) => [diagnostic.file, diagnostic.line]),
    [[game.main, 0]],
  );
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "plugin.unresolved"), false);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "manifest.package-name"), false);
  equal(doubles.state().vm.globals.packagestarted, 1);
  equal(doubles.state().engine.boot?.stage, "running");
});

test("the main file's package names feed the manifest in stored order, and a name with no definition is a located diagnostic", () => {
  const game = authorGame({ ...SCRIPTED, plugins: ["no-such-plugin.dll"], packages: ["weather", "quests"] });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 10);
  const unresolved = result.diagnostics.filter((diagnostic) => diagnostic.code === "plugin.unresolved");
  deepEqual(unresolved.map((diagnostic) => diagnostic.message.includes("weather") ? "weather" : diagnostic.message.includes("quests") ? "quests" : "other"), ["weather", "quests"]);
  equal(unresolved.every((diagnostic) => diagnostic.file === game.main), true);
  deepEqual(unresolved.map((diagnostic) => diagnostic.line), [0, 1]);
  // "the game still boots" is part of the criterion: a zero-tick run is also what a failed boot reports.
  equal(doubles.state().engine.boot?.stage, "running", "boot continued past the unresolved packages");
});
test("a host catalogue resolves the listed package and runs its owned startup before main startup", () => {
  const game = authorGame({
    ...SCRIPTED,
    startup: "start.prg",
    packages: ["WEATHER"],
    programs: { ...SCRIPTED.programs, "start.prg": 'result = packagecmd()\ngame.emit("ping")\nobserved = packageStarted\nend()\n' },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "Weather",
    version: "1.2",
    namespace: "climate",
    requests: ["asset"],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [
        { name: "packagecmd", aliases: [], params: [], call: () => ({ value: 42 }) },
        { name: "packagelistener", aliases: [], params: [{ name: "event", optional: false, byRef: false, variadic: false }], call: (view) => { const state = view.state; if (state === undefined) return { value: 0 }; state.vm.globals.packageEvents = Number(state.vm.globals.packageEvents ?? 0) + 1; return { value: 0 }; } },
      ],
      listeners: [{ emitter: "game", type: "ping", command: "packagelistener" }],
    },
    startup: { kind: "inline", text: "packageStarted = 1\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "plugin.unresolved"), false);
  equal(doubles.state().vm.globals.result, 42);
  equal(doubles.state().vm.globals.observed, 1);
  equal(doubles.state().vm.globals.packageEvents, 1);
});

test("selected package audio tracks append in package order and duplicate names keep the larger voice count", () => {
  const game = authorGame({
    ...SCRIPTED,
    packages: ["weather", "climate"],
    audioSettings: {
      tracks: [
        { name: "music", voiceCount: 1 },
        { name: "sfx", voiceCount: 1 },
        { name: "ambience", voiceCount: 4 },
        { name: "voice", voiceCount: 2 },
        { name: "ui", voiceCount: 4 },
        { name: "rain", voiceCount: 2 },
      ],
      voiceCap: 32,
      defaultSoundFont: null,
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [
    {
      name: "weather",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "weather",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "cloud" }, { name: "Rain", voiceCount: 3 }, { name: "mist" }],
      },
    },
    {
      name: "climate",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "climate",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "CLOUD", voiceCount: 2 }, { name: "rain", voiceCount: 2 }],
      },
    },
  ];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  const tracks = doubles.state().audio.tracks;
  deepEqual(tracks.map(({ name, voiceCount }) => [name, voiceCount]), [
    ["music", 1],
    ["sfx", 1],
    ["ambience", 4],
    ["voice", 2],
    ["ui", 4],
    ["rain", 3],
    ["cloud", 2],
    ["mist", 1],
  ]);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "media.package-track"), false);
});

test("package audio declarations reject only invalid entries and retain later valid tracks", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.0.0",
    requests: [],
    definition: {
      id: "weather",
      version: "1.0.0",
      commands: [],
      audioTracks: [{ name: "bad name" }, { name: "silent", voiceCount: 0 }, { name: "hail" }],
    },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  deepEqual(
    doubles.state().audio.tracks.slice(5).map(({ name, voiceCount }) => [name, voiceCount]),
    [["hail", 1]],
  );
  const rejected = result.diagnostics.filter((diagnostic) => diagnostic.code === "media.package-track");
  equal(rejected.length, 2);
  equal(rejected.every((diagnostic) => diagnostic.file === game.main && diagnostic.line === 0), true);
  equal(rejected[0]?.message.includes('audioTracks[0]'), true);
  equal(rejected[1]?.message.includes('audioTracks[1]'), true);
});

test("package audio cap failures preserve prior tracks and continue with later declarations", () => {
  const game = authorGame({
    ...SCRIPTED,
    packages: ["weather", "climate"],
    audioSettings: {
      tracks: [
        { name: "music", voiceCount: 1 },
        { name: "sfx", voiceCount: 1 },
        { name: "ambience", voiceCount: 4 },
        { name: "voice", voiceCount: 2 },
        { name: "ui", voiceCount: 4 },
        { name: "rain", voiceCount: 1 },
      ],
      voiceCap: 16,
      defaultSoundFont: null,
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [
    {
      name: "weather",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "weather",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "storm", voiceCount: 4 }, { name: "breeze", voiceCount: 2 }],
      },
    },
    {
      name: "climate",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "climate",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "rain", voiceCount: 4 }, { name: "wind" }],
      },
    },
  ];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  deepEqual(doubles.state().audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), [
    ["music", 1],
    ["sfx", 1],
    ["ambience", 4],
    ["voice", 2],
    ["ui", 4],
    ["rain", 1],
    ["breeze", 2],
    ["wind", 1],
  ]);
  const rejected = result.diagnostics.filter((diagnostic) => diagnostic.code === "media.package-track");
  equal(rejected.length, 2);
  equal(rejected.every((diagnostic) => diagnostic.file === game.main), true);
  equal(rejected[0]?.message.includes('package "weather" audioTracks[0]'), true);
  equal(rejected[1]?.message.includes('package "climate" audioTracks[0]'), true);
});

test("package audio declarations respect the 16-track limit without removing game tracks", () => {
  const game = authorGame({
    ...SCRIPTED,
    packages: ["weather"],
    audioSettings: {
      tracks: [
        { name: "music", voiceCount: 1 },
        { name: "sfx", voiceCount: 1 },
        { name: "ambience", voiceCount: 4 },
        { name: "voice", voiceCount: 2 },
        { name: "ui", voiceCount: 4 },
        ...Array.from({ length: 11 }, (_, index) => ({ name: `game${index}`, voiceCount: 1 })),
      ],
      voiceCap: 32,
      defaultSoundFont: null,
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.0.0",
    requests: [],
    definition: { id: "weather", version: "1.0.0", commands: [], audioTracks: [{ name: "overflow" }] },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  equal(doubles.state().audio.tracks.length, 16);
  equal(doubles.state().audio.tracks.some(({ name }) => name === "overflow"), false);
  equal(result.diagnostics.filter((diagnostic) => diagnostic.code === "media.package-track").length, 1);
  equal(result.diagnostics.find((diagnostic) => diagnostic.code === "media.package-track")?.message.includes("track-limit"), true);
});

test("manifest package lookup folds ASCII package identity and keeps the catalogue's namespace", () => {
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "Weather",
    version: "1.2",
    namespace: "climate",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "end()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const main = { ...createEmptyMainFile(), packagePlugins: ["WEATHER"] };
  const { manifest, diagnostics } = pluginManifestFor(main, "main.gam", catalogue);
  deepEqual(diagnostics, []);
  const entry = manifest.find((candidate) => candidate.id === "weather");
  equal(entry?.version, "1.2", "the catalogue's version reaches the manifest entry");
  equal(entry?.namespace, "climate", "the catalogue's namespace reaches the manifest entry");

  const resolved = resolveManifestPlugins(manifest, "main.gam", catalogue);
  equal(resolved.diagnostics.length, 0);
  const weather = resolved.plugins.find((plugin) => plugin.package?.name === "weather");
  equal(weather?.package?.version, "1.2");
  equal(weather?.package?.namespace, "climate", "a declared namespace reaches the resolved package metadata");
  equal(weather?.startup?.owner, "weather");
});

test("a project folder's RPGCode package layers an engine command and is rebuilt by reset", () => {
  const game = authorGame({
    ...SCRIPTED,
    project: "Sample",
    packages: ["weather"],
    programs: {
      ...SCRIPTED.programs,
      "start.prg": "answered = getgp()\nwrapped = weatherWraps\nend()\n",
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    namespace: "climate",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: {
      kind: "inline",
      ir: IR_VERSION,
      dialect: "tk3",
      text: 'registerPlugin({ name: "weather", commands: { getgp: (next) => { weatherWraps = weatherWraps + 1; return next() } } })\nend()\n',
    },
  }];
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, catalogue);
  const booted = run(engine, game.files, 20);
  equal(booted.diagnostics.some((diagnostic) => diagnostic.code === "plugin.unresolved"), false);
  equal(doubles.state().vm.globals.wrapped, 1, "the package layer wrapped the engine command");
  equal(doubles.state().vm.globals.answered, 0, "the wrapped engine command still answered");

  // `reset()` reruns package startup before main startup, so the same layer must be back in the fresh state.
  startThread(doubles.state().vm, { ref: { kind: "inline", text: "reset()\nend()", ir: IR_VERSION }, kind: "persistent", owner: "script" });
  const afterReset = run(engine, game.files, 20);
  equal(afterReset.diagnostics.some((diagnostic) => diagnostic.code === "unknown.command"), false);
  equal(doubles.state().vm.globals.wrapped, 1, "reset rebuilt the package layer");
});

test("a package startup that waits is rejected by the lifecycle clock guard", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "sleep(1)\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-unfinished"), true);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "startup.no-player"), false);
});
test("a package startup that consumes randomness is rejected by the lifecycle guard", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "random(3)\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});
test("a package startup cannot read gametime through the virtual variable", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "observed = gametime\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden" && diagnostic.message.includes('package "weather"') && diagnostic.message.includes("simulation clock")), true);
});


test("a direct package command cannot consume RNG during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "directrng", aliases: [], params: [], call: (view) => { try { Object.assign(view, { packageStartup: false, rng: { nextUint32: () => 1 } }); } catch { /* frozen command view */ } try { Object.defineProperty(view, "rng", { value: { nextUint32: () => 1 } }); } catch { /* frozen command view */ } try { Object.defineProperty(view.rng, "nextUint32", { value: () => 1 }); } catch { /* frozen RNG port */ } view.rng.nextUint32(); return { value: null }; } }],
    },
    startup: { kind: "inline", text: "directrng()\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});

test("a direct package command cannot consume the simulation clock during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "directclock", aliases: [], params: [], call: (view) => { view.clock.tick(); return { value: null }; } }],
    },
    startup: { kind: "inline", text: "directclock()\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});

test("a direct package command cannot reach RNG through state during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "staterng", aliases: [], params: [], call: (view) => { Object.getOwnPropertyDescriptor(view.state!, "rng")?.value; return { value: null }; } }],
    },
    startup: { kind: "inline", text: "staterng()\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});

test("a direct package command cannot reach the simulation clock through state during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "stateclock", aliases: [], params: [], call: (view) => { Object.getOwnPropertyDescriptor(view.state!, "time")?.value; return { value: null }; } }],
    },
    startup: { kind: "inline", text: "stateclock()\nend()\n", ir: IR_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});



test("a game-folder root takes its project path from the main file", () => {
  const game = authorGame({ ...SCRIPTED, project: "Sample" });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 10);
  deepEqual(result.requests.slice(0, 1), ["main/test.gam"]);
  equal(result.requests.includes("game/sample/boards/start.brd"), true);
  equal(doubles.state().world.board?.key, "game/sample/boards/start.brd");
  equal(doubles.state().vm.globals.entered, 1);
});

const SEND_GAME: GameSpec = {
  startup: "start.prg",
  initChar: "hero.tem",
  boards: {
    "start.brd": { music: "theme.mid", enter: "enter.prg", threads: ["bg.prg"] },
    "other.brd": { music: "theme.mid", enter: "enter2.prg", threads: ["bg2.prg"], tiles: [50, 40] },
    "quiet.brd": { music: "other.mid", tiles: [50, 40] },
  },
  programs: {
    "start.prg": "end()\n",
    "enter.prg": 'thread("threadsleep(getthreadid(), 0)", 1)\nsend("other.brd", 30, 20, 1)\naftersend = 1\nend()\n',
    "enter2.prg": "entered2 = 1\nend()\n",
    "bg.prg": "threadsleep(getthreadid(), 0)\n",
    "bg2.prg": "threadsleep(getthreadid(), 0)\n",
    "again.prg": 'send("quiet.brd", 2, 3)\nend()\n',
    "missing.prg": 'send("nowhere.brd", 1, 1)\nmissingresumed = 1\nend()\n',
  },
};

function livePrograms(state: GameState): string {
  return state.vm.threads.filter((thread) => thread.status !== "finished").map((thread) => `${thread.kind}:${thread.owner}`).sort().join(",");
}

test("send leaves the ruled state: old board threads dead, a persistent thread alive, the camera re-aligned", () => {
  const game = authorGame(SEND_GAME);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 12);
  const state = doubles.state();
  equal(state.world.board?.key, "boards/other.brd");
  deepEqual(result.diagnostics, []);
  equal(state.vm.globals.aftersend, 1);
  equal(state.vm.globals.entered2, 1);
  // The start board's bg.prg thread died; the persistent thread and the new board's thread live.
  equal(livePrograms(state), "board:world,persistent:script");
  equal(state.engine.transition, undefined);
  // Tile (30, 20) is pixel (944, 639) on a 2D board (E-11): the camera centres on it without smoothing.
  deepEqual({ x: state.camera.x, y: state.camera.y, prevX: state.camera.prevX, prevY: state.camera.prevY }, { x: 784, y: 519, prevX: 784, prevY: 519 });
  deepEqual(doubles.sprites.map((effect) => [effect.name, ...effect.args]).slice(-1), [["placeplayer", 30, 20, 1, "tile"]]);
  deepEqual(doubles.triggers.map((effect) => [effect.name, ...effect.args]).slice(-1), [["deactivateat", 30, 20, 1, "tile"]]);
  // Both boards name theme.mid and every arrival posts its music; the audio applier, not the engine, decides to carry on (E-16).
  deepEqual(doubles.audio.map((effect) => [effect.name, ...effect.args]), [
    ["music.play", "media/theme.mid", true, null, "board"],
    ["music.play", "media/theme.mid", true, null, "board"],
  ]);
});

test("send resumes the caller on the next tick and a different board music posts one replacement", () => {
  const game = authorGame({ ...SEND_GAME, programs: { ...SEND_GAME.programs, "enter.prg": 'send("quiet.brd", 2, 3)\naftersend = 1\nend()\n' } });
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  // Tick 0 runs the start-up program and boot enters the board; tick 1 runs the enter program up to `send`, and the swap happens before tick 2.
  const first = run(engine, game.files, 2);
  equal(first.ticksRun, 2);
  equal(doubles.state().world.board?.key, "boards/quiet.brd");
  equal(doubles.state().vm.globals.aftersend, undefined);
  run(engine, game.files, 1);
  equal(doubles.state().vm.globals.aftersend, 1);
  deepEqual(doubles.audio.map((effect) => effect.args[0]), ["media/theme.mid", "media/other.mid"]);
  // Tile (2, 3) is pixel (48, 95): the camera clamps to the board corner.
  deepEqual({ x: doubles.state().camera.x, y: doubles.state().camera.y }, { x: 0, y: 0 });
});

test("send to a board that is not in the game reports a diagnostic, changes nothing and resumes the caller", () => {
  const game = authorGame({ ...SEND_GAME, programs: { ...SEND_GAME.programs, "enter.prg": 'send("nowhere.brd", 1, 1)\nmissingresumed = 1\nend()\n' } });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 6);
  const missing = result.diagnostics.find((diagnostic) => diagnostic.file === "nowhere.brd");
  equal(missing?.code, "asset.missing");
  equal(doubles.state().world.board?.key, "boards/start.brd");
  equal(doubles.state().vm.globals.missingresumed, 1);
});

test("send validates its arguments with a catchable script error", () => {
  const game = authorGame({ ...SEND_GAME, programs: { ...SEND_GAME.programs, "enter.prg": 'send("", 1, 1)\nend()\n' } });
  const result = run(bootEngine(game, makeDoubles()), game.files, 4);
  equal(result.diagnostics.some((diagnostic) => diagnostic.message.includes("send")), true, JSON.stringify(result.diagnostics));
});

// The sample games: their start.prg boots through the real engine with the doubles above.
const legacyRoot = join(repoRoot, "fixtures", "legacy");
const haveLegacy = existsSync(legacyRoot);

/** Every file under `root`, as `/`-separated paths relative to it (directories are skipped by their read failing). */
function listFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { recursive: true }).map((path) => path.split("\\").join("/")).sort()) {
    try {
      readFileSync(join(root, entry));
      found.push(entry);
    } catch {
      // A directory: its files are listed on their own.
    }
  }
  return found;
}

function sampleGame(name: string): { readonly files: Files; readonly index: AssetIndex; readonly startup: string; readonly initBoard: string; readonly initChar: string } | null {
  const root = join(legacyRoot, name);
  if (!existsSync(root)) return null;
  const relativePaths = listFiles(root);
  const lower = (path: string): string => path.toLowerCase();
  const startup = relativePaths.find((path) => lower(path) === "prg/start.prg");
  const board = relativePaths.find((path) => lower(path) === "boards/start.brd") ?? relativePaths.find((path) => lower(path).startsWith("boards/") && lower(path).endsWith(".brd"));
  const character = relativePaths.find((path) => lower(path) === "chrs/start.tem") ?? relativePaths.find((path) => lower(path).startsWith("chrs/") && lower(path).endsWith(".tem"));
  if (startup === undefined || board === undefined || character === undefined) return null;
  const initBoard = board.slice("Boards/".length);
  const initChar = character.slice("Chrs/".length);
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard, initChar };
  const files: Files = new Map();
  const paths = ["main.gam", ...relativePaths];
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  for (const path of relativePaths) files.set(assetKey(path), new Uint8Array(readFileSync(join(root, path))));
  return { files, index: createAssetIndex(paths), startup: "start.prg", initBoard, initChar };
}

for (const name of ["demo", "Basic"]) {
  test(`the ${name} sample game's start.prg boots through the real engine`, { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
    const sample = sampleGame(name);
    if (sample === null) throw new Error(`fixtures/legacy/${name} has no start program, board and character`);
    const doubles = makeDoubles();
    const engine = createEngine({
      seed: 3,
      assetIndex: sample.index,
      assetRoot: PACKAGE_ROOT,
      mainFile: "main.gam",
      gameIdentity: "engine-boot-sample",
      startup: doubles.startup,
      width: 640,
      height: 480,
      maxTicks: 600,
      ...doubles.options,
    });
    const result = run(engine, sample.files, 20);
    // The title screen parks the start-up program on its cursor-map key wait: boot is correct and in progress.
    const state = doubles.state();
    equal(state.engine.boot?.stage, "startup");
    deepEqual(doubles.players, [`chrs/${sample.initChar.toLowerCase()}`]);
    const blocking = state.vm.threads.filter((thread) => thread.kind === "blocking" && thread.status !== "finished");
    equal(blocking.length, 1);
    equal(blocking[0]?.wait?.kind, "input.key");
    deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("asset.") || diagnostic.code.startsWith("startup.") || diagnostic.code.startsWith("program.")), []);
    // Releasing the wait with a key moves the program on without a script error.
    const key = { tick: result.report.tickAfter, event: { kind: "key" as const, name: "ENTER", code: "Enter", char: null, down: true } };
    const after = run(engine, sample.files, 5, [key]);
    deepEqual(after.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("asset.") || diagnostic.code.startsWith("startup.")), []);
  });
}

test("a Toolkit 2 sample's start.prg reports a located syntax diagnostic instead of throwing", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  // Its `#command` programs belong to the TK2 dialect, which boot does not select (epic tk2-support).
  const sample = sampleGame("Caoquest");
  if (sample === null) throw new Error("fixtures/legacy/Caoquest has no start program, board and character");
  const doubles = makeDoubles();
  const engine = createEngine({ seed: 3, assetIndex: sample.index, assetRoot: PACKAGE_ROOT, mainFile: "main.gam", gameIdentity: "engine-boot-tk2", startup: doubles.startup, width: 640, height: 480, maxTicks: 600, ...doubles.options });
  const result = run(engine, sample.files, 5);
  const syntax = result.diagnostics.find((diagnostic) => diagnostic.code === "syntax.error");
  equal(syntax?.file, "prg/start.prg");
});

const AUTHORED_AUDIO: MainFileAudioSettings = {
  tracks: [
    { name: "Music", voiceCount: 2 },
    { name: "sfx", voiceCount: 2 },
    { name: "ambience", voiceCount: 2 },
    { name: "voice", voiceCount: 2 },
    { name: "ui", voiceCount: 2 },
    { name: "weather", voiceCount: 3 },
  ],
  voiceCap: 16,
  defaultSoundFont: "Media/town.sf2",
};

type AudioPhaseRun = NonNullable<EngineInit["phaseRegistrations"]>[number]["run"];
type ResetRun = NonNullable<EngineInit["resetRegistrations"]>[number]["reset"];
function audioBoot(game: AuthoredGame, onAudioPhase?: AudioPhaseRun, onReset?: ResetRun, replacementIndex: AssetIndex = game.index): { engine: Engine; state(): GameState } {
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 11, assetIndex: replacementIndex, assetRoot: game.root, mainFile: game.main, gameIdentity: "engine-boot-audio", maxTicks: 10,
    width: 320, height: 240,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    defaultSoundFont: assetKey("media/ignored.sf2"),
    phaseRegistrations: [{ phase: "audio", run: (state, postEffect) => { latest = state; onAudioPhase?.(state, postEffect); } }],
    ...(onReset === undefined ? {} : { resetRegistrations: [{ section: "audio", reset: onReset }] }),
  });
  return { engine, state: () => {
    if (latest === null) throw new Error("boot did not tick");
    return latest;
  } };
}

test("boot applies authored tracks and SoundFont before emitting exactly one initial bank cue", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: AUTHORED_AUDIO, soundFonts: ["town.sf2"] });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics, []);
  deepEqual(host.state().audio.tracks.map((track) => [track.name, track.voiceCount]), AUTHORED_AUDIO.tracks.map((track) => [track.name.toLowerCase(), track.voiceCount]));
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [assetKey("media/town.sf2")]);
});

test("reset preserves authored audio settings, active playback and runtime-added tracks", () => {
  const game = authorGame({ boards: { "start.brd": { music: "theme.mid" } }, programs: {}, audioSettings: AUTHORED_AUDIO });
  game.files.set(assetKey("media/theme.mid"), readFileSync(join(testDir, "fixtures", "audio", "files", "midi0-480-default-tempo.mid")));
  let resetRequested = false;
  let resets = 0;
  let playbackCueId = 0;
  const host = audioBoot(game, (state, postEffect) => {
    if (resetRequested) return;
    const voice = state.audio.tracks[0]?.voices[0];
    if (voice === undefined) return;
    playbackCueId = voice.cueId;
    const runtime = createAudioRuntime(state, { lookup: () => ({ kind: "known", lengthTicks: 120 }) });
    equal(runtime.configurePackageTrack("runtime", 2), null);
    state.audio.settings.masterVolume = 40;
    state.audio.soundFont = assetKey("media/other.sf2");
    resetRequested = true;
    postEffect?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
  }, () => { resets += 1; });
  run(host.engine, game.files, 5);
  equal(resets, 1);
  const audio = host.state().audio;
  deepEqual(audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), [
    ["music", 2], ["sfx", 2], ["ambience", 2], ["voice", 2], ["ui", 2], ["weather", 3], ["runtime", 2],
  ]);
  equal(audio.tracks[0]?.state, "playing");
  equal(audio.tracks[0]?.voices[0]?.cueId, playbackCueId);
  equal(audio.tracks[0]?.voices[0]?.file, assetKey("media/theme.mid"));
  equal(audio.settings.masterVolume, 40);
  equal(audio.soundFont, assetKey("media/other.sf2"));
});

test("replacing the main file without audio settings restores built-in tracks", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: AUTHORED_AUDIO });
  const files = new Map(game.files);
  files.set(assetKey("replacement.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "", initBoard: "start.brd" })));
  const switchedIndex = createAssetIndex([...files.keys()]);
  let replacementRequested = false;
  let resets = 0;
  const host = audioBoot(game, (state, postEffect) => {
    if (replacementRequested) return;
    if (!state.audio.tracks.some(({ name }) => name === "weather")) return;
    const runtime = createAudioRuntime(state, { lookup: () => ({ kind: "known", lengthTicks: 120 }) });
    equal(runtime.configurePackageTrack("runtime", 2), null);
    replacementRequested = true;
    postEffect?.("engine", { thread: 0, name: "mainFile", kind: "state-write", args: [null, "replacement.gam"], out: {}, result: null, patch: null, wait: null, request: null });
  }, () => { resets += 1; }, switchedIndex);
  run(host.engine, files, 5);
  equal(replacementRequested, true);
  equal(resets, 1);
  deepEqual(host.state().audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), BUILTIN_TRACKS);
});


test("boot without an audio block uses Epic 6 defaults and ignores the startup-only bank", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {} });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics, []);
  deepEqual(host.state().audio.tracks.map((track) => [track.name, track.voiceCount]), [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]]);
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [null]);
});

test("boot recovers over-cap tracks once at the first offending track and retains the independent bank", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: { ...AUTHORED_AUDIO, voiceCap: 9 }, soundFonts: ["town.sf2"] });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics.map(({ code, file, line }) => ({ code, file, line })), [{ code: "media.voice-cap", file: "main.gam", line: 4 }]);
  deepEqual(host.state().audio.tracks.map((track) => [track.name, track.voiceCount]), [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]]);
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [assetKey("media/town.sf2")]);
});

test("boot diagnoses a missing authored bank once and emits null without refusing the game", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: AUTHORED_AUDIO });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics.map(({ code, file }) => ({ code, file })), [{ code: "media.soundfont-missing", file: "media/town.sf2" }]);
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [null]);
});

function recoveryFixture(
  plugins: readonly ResolvedPlugin[] = [],
  spec: GameSpec = {
    startup: "start.prg",
    initChar: "hero.tem",
    boards: { "start.brd": {} },
    programs: { "start.prg": "end()\n" },
  },
): { readonly engine: Engine; readonly state: GameState; readonly game: AuthoredGame; readonly doubles: Doubles } {
  const game = authorGame(spec);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, plugins);
  const result = run(engine, game.files, 30);
  deepEqual(result.diagnostics, []);
  const state = doubles.state();
  const board = state.world.board;
  if (board == null) throw new Error("recovery fixture did not load its initial board");
  const actor = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    stats: { hp: 12, maxHp: 12, smp: 4, maxSmp: 4, dp: 2, fp: 3, level: 1 },
    behaviour: "stock-rpg.hero",
  });
  const source = actorFromSource({
    id: "Characters/hero.chr",
    kind: "player",
    source: "hero.tem",
    x: 64,
    y: 64,
    layer: 1,
    controlled: true,
  }, board, 0, null);
  state.party.members = [actor.id];
  state.party.selected = actor.id;
  state.sprites.players = [{ ...source, actorId: actor.id }];
  state.sprites.selectedPlayer = source.id;
  equal(state.engine.boot?.stage, "running");
  equal(state.world.board?.key, "boards/start.brd");
  ok(state.sprites.players.some((player) => player.id === state.sprites.selectedPlayer));
  return { engine, state, game, doubles };
}

function startRecoveryProgram(state: GameState, text: string): void {
  startProgram(state.vm, { kind: "inline", text: `${text}\n`, ir: IR_VERSION });
}

const PAUSED_RECOVERY_GAME: GameSpec = {
  startup: "start.prg",
  initChar: "hero.tem",
  boards: { "start.brd": { enter: "enter.prg", threads: ["board.prg"] } },
  programs: {
    "start.prg": 'startupvalue = 1\nentryCount = 0\nboardCount = 0\nitemCount = 0\ngame.on("startupNotice", (event) => { startupListener = 1 })\nend()\n',
    "enter.prg": "entrySeen = recoveryflag\nentryCount = entryCount + 1\nend()\n",
    "board.prg": "boardCount = boardCount + 1\nend()\n",
    "item.prg": "itemCount = itemCount + 1\nend()\n",
  },
};

function recoveryCandidateWithDurableState(spec: GameSpec = PAUSED_RECOVERY_GAME, plugins: readonly ResolvedPlugin[] = [], beforeCapture?: (state: GameState) => void): { readonly game: AuthoredGame; readonly state: GameState; readonly candidate: Uint8Array; readonly savedTick: number } {
  const { engine, state, game } = recoveryFixture(plugins, spec);
  const board = state.world.board;
  if (board == null) throw new Error("recovery test fixture has no board");
  const itemPlacement = {
    slot: 0,
    itemFile: "token.itm",
    activationPrg: "",
    multitaskPrg: "item.prg",
    initialVar: "",
    initialValue: "",
    finalVar: "",
    finalValue: "",
    loadingVar: "",
    loadingValue: "",
    activate: 0,
    activationType: 0,
    x: 20,
    y: 30,
    layer: 1,
    reserved: 0,
  };
  if (board.rawItems === undefined || board.items === undefined) throw new Error("recovery test fixture has no item collections");
  board.rawItems.push(itemPlacement);
  board.items.push(itemPlacement);
  state.vm.globals.recoveryflag = 73;
  state.vm.globals.startupvalue = 42;
  state.vm.globals.entrycount = 0;
  state.vm.globals.boardcount = 0;
  state.vm.globals.itemcount = 0;
  state.triggers.fired.progress = true;
  state.triggers.repeat.progress = 3;
  state.triggers.suppressed = ["suppressed-trigger"];
  state.triggers.deactivated = ["deactivated-trigger"];
  state.triggers.deactivateAt = { x: 7, y: 8, layer: 1 };
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 123, y: 231 }));
  const item = actorFromSource({
    id: "items/token.itm",
    kind: "item",
    source: "token.itm",
    x: 20,
    y: 30,
    layer: 1,
    sourceSlot: 0,
    handle: 7,
  }, board, 0, 7);
  state.sprites.items = [{ ...item, multitaskProgram: "item.prg", visible: true }];
  state.sprites.nextItemHandle = 8;
  beforeCapture?.(state);
  startRecoveryProgram(state, 'game.on("candidateOnly", (event) => { candidateListener = 1 })\ncheckpoint()\nend()');
  engine.advance(1, []);
  const saved = engine.recoveryCandidate();
  if (saved == null) throw new Error("recovery candidate was not captured");
  return { game, state, candidate: new Uint8Array(saved.bytes), savedTick: state.time.tick };
}

const recoveryBattlePlugin: ResolvedPlugin = {
  namespace: "recovery-test",
  definition: {
    id: "recovery-test",
    version: "1.0.0",
    commands: [{
      name: "startrecoverybattle",
      aliases: [],
      params: [],
      call: (view) => {
        const state = view.state;
        const actors = view.actors;
        const battle = view.battle;
        if (state === undefined || actors === undefined || battle === undefined) return { value: 0 };
        const player = actors.create({
          kind: "party",
          source: "hero.tem",
          stats: { hp: 10, maxHp: 10, smp: 4, maxSmp: 4, dp: 1, fp: 1, level: 1 },
        });
        const enemy = actors.create({
          kind: "enemy",
          source: "slime.ene",
          stats: { hp: 10, maxHp: 10, smp: 0, maxSmp: 0, dp: 1, fp: 1, level: 1 },
        });
        state.party.members = [player.id];
        state.party.selected = player.id;
        const selectedIndex = state.sprites.players.findIndex((sprite) => sprite.id === state.sprites.selectedPlayer);
        const selected = state.sprites.players[selectedIndex];
        if (selectedIndex < 0 || selected === undefined) return { value: 0 };
        state.sprites.players[selectedIndex] = { ...selected, actorId: player.id };
        const started = battle.start({
          boardKey: state.world.board?.key ?? "boards/start.brd",
          background: "",
          canRun: true,
          enemies: [enemy.id],
          players: [player.id],
        });
        return { value: started.ok ? 1 : 0 };
      },
    }],
  },
};

function stepRecoveryBattleStart(engine: Engine, state: GameState): void {
  let report = engine.advance(1, [], undefined, "step");
  ok(state.engine.openTick !== undefined);
  for (let step = 0; step < 20 && state.battle === null; step += 1) {
    report = engine.advance(1, [], undefined, "step");
    ok(state.engine.openTick !== undefined);
  }
  equal(report.diagnostics.length, 0);
  ok(state.battle !== null);
}

test("checkpoint requests one recovery candidate at the host's settled signal and consumes it once", () => {
  const { engine, state } = recoveryFixture();
  equal(engine.recoveryCandidate(), null);
  startRecoveryProgram(state, "checkpoint()\nend()");
  const report = engine.advance(1, []);
  equal(report.ticksRun, 1);
  equal(report.loading, false);
  const candidate = engine.recoveryCandidate();
  ok(candidate !== null);
  equal(candidate.tick, report.tickAfter);
  const restored = restoreRecoveryCandidate(new TextDecoder().decode(candidate.bytes), state.audio);
  equal(hashGameLedger(projectGameLedger(restored.state)), hashGameLedger(projectGameLedger(state)));
  equal(engine.recoveryCandidate(), null);
});

test("unsafe menu and transition states consume a checkpoint request without returning a candidate", () => {
  const { engine, state } = recoveryFixture();
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  state.menu.screens.push({ screen: "main", actorId: null, selection: 0 });
  equal(engine.recoveryCandidate(), null);
  equal(engine.recoveryCandidate(), null);

  state.menu.screens.length = 0;
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  state.engine.openTick = { readyThreads: [], readyIndex: 0, currentThread: 0, stepsUsed: 0 };
  equal(engine.recoveryCandidate(), null);
  delete state.engine.openTick;
  state.engine.transition = { board: "boards/start.brd", x: 1, y: 1, layer: 1 };
  equal(engine.recoveryCandidate(), null);
});

test("an outstanding ordinary save transaction blocks recovery capture", () => {
  const { engine, state } = recoveryFixture();
  startRecoveryProgram(state, 'checkpoint()\nSave("slot")');
  const report = engine.advance(1, []);
  ok(report.requests.some((request) => request.kind === "saveBlob"));
  equal(report.loading, true);
  equal(engine.recoveryCandidate(), null);
});

test("the pre-battle candidate survives battle start during an open tick and is returned once", () => {
  const { engine, state } = recoveryFixture([recoveryBattlePlugin]);
  startRecoveryProgram(state, "checkpoint()\nstartrecoverybattle()\nend()");
  stepRecoveryBattleStart(engine, state);

  const candidate = engine.recoveryCandidate();
  ok(candidate !== null);
  const restored = restoreRecoveryCandidate(new TextDecoder().decode(candidate.bytes), state.audio);
  equal(restored.state.battle, null);
  equal(restored.state.time.tick, candidate.tick);
  equal(engine.recoveryCandidate(), null);

  engine.advance(1, []);
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  equal(engine.recoveryCandidate(), null);
});

test("a later explicit checkpoint supersedes the queued pre-battle candidate", () => {
  const { engine, state } = recoveryFixture([recoveryBattlePlugin]);
  startRecoveryProgram(state, "startrecoverybattle()\nend()");
  stepRecoveryBattleStart(engine, state);
  const preBattleTick = state.time.tick;

  // Re-establish an eligible board state without consuming the queued candidate.
  state.battle = null;
  engine.advance(1, []);
  ok(state.time.tick > preBattleTick);
  state.vm.globals.recoveryMarker = "newer";
  startRecoveryProgram(state, "checkpoint()\nend()");
  const report = engine.advance(1, []);
  equal(report.diagnostics.length, 0);

  const candidate = engine.recoveryCandidate();
  ok(candidate !== null);
  equal(candidate.tick, report.tickAfter);
  ok(candidate.tick > preBattleTick);
  const restored = restoreRecoveryCandidate(new TextDecoder().decode(candidate.bytes), state.audio);
  equal(restored.state.vm.globals.recoveryMarker, "newer");
  equal(engine.recoveryCandidate(), null);
});

test("serialization failure returns null and consumes the explicit checkpoint request", () => {
  const { engine, state } = recoveryFixture();
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  const globals = state.vm.globals as unknown as Record<string, unknown>;
  globals.unserializable = Symbol("unsupported recovery value");
  equal(engine.recoveryCandidate(), null);
  delete globals.unserializable;
  equal(engine.recoveryCandidate(), null);
});
test("recovery boots startup first, stages durable state paused, and resumes entry exactly once", () => {
  const { game, candidate, savedTick } = recoveryCandidateWithDurableState();
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, undefined, candidate);
  equal(engine.recoveryStatus(), "loading");
  equal(engine.resumeRecovery(), false);

  const result = run(engine, game.files, 30);
  deepEqual(result.diagnostics, []);
  equal(engine.recoveryStatus(), "paused");
  const state = doubles.state();
  equal(state.engine.boot?.stage, "recovery-paused");
  equal(state.time.tick, savedTick, "ledger time is restored before the recovered board is exposed");
  ok(doubles.stageHistory.includes("startup"), "the normal startup phase must run before recovery");
  ok(state.events.listeners.some((listener) => listener.type === "startupNotice"), "startup listeners survive recovery");
  equal(state.events.listeners.some((listener) => listener.type === "candidateOnly"), false, "candidate event listeners are not restored");
  equal(state.vm.globals.startupvalue, 42, "ledger values replace startup values after startup");
  equal(state.vm.globals.recoveryflag, 73);
  equal(state.world.board?.key, "boards/start.brd");
  deepEqual(
    state.sprites.players.map(({ x, y }) => ({ x, y })),
    [{ x: 123, y: 231 }],
    "the saved player placement must not be replaced by the board start position",
  );
  equal(state.triggers.fired.progress, true);
  equal(state.triggers.repeat.progress, 3);
  deepEqual(state.triggers.suppressed, ["suppressed-trigger"]);
  deepEqual(state.triggers.deactivated, ["deactivated-trigger"]);
  deepEqual(state.triggers.deactivateAt, { x: 7, y: 8, layer: 1 });
  equal(state.sprites.items[0]?.multitaskThread, null, "item multitask waits for explicit Resume");
  equal(state.vm.globals.entrycount, 0);
  equal(state.vm.globals.boardcount, 0);
  equal(state.vm.globals.itemcount, 0);
  equal(state.vm.threads.some((thread) => thread.kind === "board" && thread.status !== "finished"), false);
  equal(state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), false);

  const pausedTick = state.time.tick;
  equal(engine.advance(4, []).ticksRun, 0);
  equal(pausedTick, savedTick);
  equal(state.time.tick, pausedTick);
  equal(engine.advance(0, [{ tick: pausedTick, event: { kind: "focus", state: "gained" } }]).ticksRun, 0);
  equal(engine.recoveryStatus(), "paused", "focus gain must not resume recovery");

  equal(engine.resumeRecovery(), true);
  equal(engine.recoveryStatus(), "resumed");
  equal(state.engine.boot?.stage, "running");
  equal(engine.resumeRecovery(), false, "Resume is one-shot");
  equal(state.time.tick, savedTick);
  ok(state.sprites.items[0]?.multitaskThread != null);
  equal(state.vm.threads.filter((thread) => thread.kind === "board" && thread.status !== "finished").length, 1);
  equal(state.vm.threads.filter((thread) => thread.kind === "blocking" && thread.status !== "finished").length, 1);
  const boardThread = state.vm.threads.find((thread) => thread.kind === "board" && thread.status !== "finished");
  const entryThread = state.vm.threads.find((thread) => thread.kind === "blocking" && thread.status !== "finished");
  ok(boardThread !== undefined);
  ok(entryThread !== undefined);
  ok(boardThread.id < entryThread.id, "ordinary board threads start before the entry program");
  equal(state.vm.globals.entrycount, 0, "Resume starts but does not execute entry instructions");
  equal(engine.advance(0, []).ticksRun, 0, "zero-tick advancement must not execute entry instructions");
  equal(state.vm.globals.entrycount, 0);
  equal(engine.advance(1, []).ticksRun, 1);
  equal(state.vm.globals.entryseen, 73);
  equal(state.vm.globals.entrycount, 1);
  equal(state.vm.globals.boardcount, 1);
  equal(state.vm.globals.itemcount, 1);
  equal(state.time.tick, savedTick + 1);
});

test("declining recovery by supplying no candidate follows ordinary boot", () => {
  const game = authorGame(PAUSED_RECOVERY_GAME);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 30);
  deepEqual(result.diagnostics, []);
  equal(engine.recoveryStatus(), "none");
  equal(engine.resumeRecovery(), false);
  equal(doubles.state().engine.boot?.stage, "running");
  equal(doubles.state().vm.globals.entrycount, 1);
  equal(doubles.state().vm.globals.boardcount, 1);
});

test("missing or changed required board and entry assets fail without partial state", () => {
  const { game, candidate } = recoveryCandidateWithDurableState();
  const scenarios: { readonly name: string; readonly edit: (files: Files) => void; readonly omitFromIndex?: string; readonly failsDuringAssetSetup?: boolean }[] = [
    {
      name: "changed board",
      edit: (files) => files.set(assetKey("boards/start.brd"), boardBytes({ enter: "enter.prg", threads: ["board.prg"], start: [96, 96] })),
    },
    {
      name: "missing board",
      edit: (files) => { files.delete(assetKey("boards/start.brd")); },
    },
    {
      name: "changed entry program",
      edit: (files) => files.set(assetKey("prg/enter.prg"), encoder.encode("entrySeen = -1\nend()\n")),
    },
    {
      name: "missing indexed entry program",
      edit: (files) => { files.delete(assetKey("prg/enter.prg")); },
      failsDuringAssetSetup: true,
    },
    {
      name: "entry program absent from index",
      edit: (files) => { files.delete(assetKey("prg/enter.prg")); },
      omitFromIndex: "prg/enter.prg",
    },
  ];

  for (const scenario of scenarios) {
    const files = new Map(game.files);
    scenario.edit(files);
    const doubles = makeDoubles();
    const index = scenario.omitFromIndex === undefined
      ? game.index
      : createAssetIndex(game.index.paths.filter((path) => assetKey(path) !== scenario.omitFromIndex));
    const engine = bootEngine({ ...game, index }, doubles, undefined, undefined, candidate);
    run(engine, files, 30);
    equal(engine.recoveryStatus(), "failed", scenario.name);
    if (scenario.failsDuringAssetSetup === true) continue;
    equal(doubles.state().engine.boot?.stage, "stopped", scenario.name);
    equal(doubles.state().world.board, undefined, `${scenario.name}: recovered board must not be partially visible`);
    equal(doubles.state().vm.globals.recoveryflag, undefined, `${scenario.name}: ledger globals must not be partially restored`);
    equal(doubles.state().vm.globals.startupvalue, 1, `${scenario.name}: normal startup state remains visible`);
  }
});

test("pre-manifest checkpoints are refused without changing normal save bytes", () => {
  const { engine, state } = recoveryFixture();
  const ordinary = snapshotGameSave(state);
  throws(() => restoreRecoveryCandidate(ordinary, state.audio), /no asset fingerprint manifest/);
  equal(snapshotGameSave(state), ordinary);
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  const beforeCapture = snapshotGameSave(state);
  const hashBeforeCapture = hashGameState(state);
  const candidate = engine.recoveryCandidate();
  ok(candidate !== null);
  equal(snapshotGameSave(state), beforeCapture);
  equal(hashGameState(state), hashBeforeCapture);
  const candidateRoot = JSON.parse(new TextDecoder().decode(candidate.bytes)) as Record<string, unknown>;
  delete candidateRoot.recoveryAssets;
  deepEqual(candidateRoot, JSON.parse(beforeCapture));
  const recovered = restoreRecoveryCandidate(new TextDecoder().decode(candidate.bytes), state.audio);
  equal(recovered.recoveryAssets.version, 1);
  ok(recovered.recoveryAssets.board.key === "boards/start.brd");
});

test("a pre-battle candidate ignores transient program-scope tile assets", () => {
  const { engine, state, game } = recoveryFixture([recoveryBattlePlugin]);
  startRecoveryProgram(state, "startrecoverybattle()\nend()");
  const thread = state.vm.threads.find((entry) => entry.kind === "blocking" && entry.status !== "finished");
  ok(thread !== undefined);
  const board = state.world.board;
  ok(board?.runtime !== undefined);
  board.runtime.tileEdits.push({
    index: 0, tile: { asset: assetKey("tiles/transient.tst"), tile: 0 }, previous: null, scope: "program", owner: thread.id,
  });
  stepRecoveryBattleStart(engine, state);
  const candidate = engine.recoveryCandidate();
  ok(candidate !== null);
  const parsed = restoreRecoveryCandidate(new TextDecoder().decode(candidate.bytes), state.audio);
  equal(parsed.recoveryAssets.boardDependencies.some(({ key }) => key === "tiles/transient.tst"), false);
  const doubles = makeDoubles();
  const recovered = bootEngine(game, doubles, undefined, [recoveryBattlePlugin], candidate.bytes);
  deepEqual(run(recovered, game.files, 30).diagnostics, []);
  equal(recovered.recoveryStatus(), "paused");
});

test("startup Send runs its temporary board threads, then stops them before the saved board is staged", () => {
  let temporaryExecutions = 0;
  const plugin: ResolvedPlugin = {
    namespace: "startup-board-test",
    definition: {
      id: "startup-board-test",
      version: "1.0.0",
      commands: [{ name: "markstartupboard", aliases: [], params: [], call: () => { temporaryExecutions += 1; return { value: null }; } }],
    },
  };
  const spec: GameSpec = {
    ...PAUSED_RECOVERY_GAME,
    boards: { "start.brd": { enter: "enter.prg", threads: ["board.prg"] }, "other.brd": { threads: ["temporary.prg"] } },
    programs: {
      ...PAUSED_RECOVERY_GAME.programs,
      "start.prg": 'send("other.brd", 20, 20, 1)\nthreadsleep(getthreadid(), 0.05)\nstartupdone = 1\nend()\n',
      "temporary.prg": "markstartupboard()\nthreadsleep(getthreadid(), 1)\nend()\n",
    },
  };
  const { game, candidate } = recoveryCandidateWithDurableState(spec, [plugin]);
  temporaryExecutions = 0;
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, [plugin], candidate);
  const result = run(engine, game.files, 80);
  deepEqual(result.diagnostics, []);
  equal(engine.recoveryStatus(), "paused");
  equal(doubles.state().vm.globals.startupdone, 1);
  equal(temporaryExecutions, 1, "normal startup may execute a temporary board's threads");
  equal(doubles.state().vm.threads.some((thread) => thread.kind === "board" && thread.status !== "finished"), false, "temporary board threads stop before the saved board is staged");
  equal(doubles.state().vm.globals.entrycount, 0, "the saved board's entry program does not run while paused");
  equal(doubles.state().world.board?.key, "boards/start.brd");
});

const recoveryActorPlugin: ResolvedPlugin = {
  namespace: "recovery-actor-test",
  definition: {
    id: "recovery-actor-test",
    version: "1.0.0",
    commands: [{
      name: "setuprecoveryactor", aliases: [], params: [],
      call: (view) => {
        const state = view.state;
        if (state === undefined) return { value: 0 };
        const actor = addActor(state.actors, { kind: "party", source: "hero.tem", stats: { hp: 12, maxHp: 12, smp: 4, maxSmp: 4, dp: 2, fp: 3, level: 1 } });
        const object = registerActorObject(state.vm, state.events, state.actors, actor.id);
        if (object === null) throw new Error("actor object not registered");
        return { value: { kind: "object", handle: object.handle, className: object.className } };
      },
    }],
  },
};

const recoveryEmitterSpec: GameSpec = {
  ...PAUSED_RECOVERY_GAME,
  programs: {
    ...PAUSED_RECOVERY_GAME.programs,
    "start.prg": 'notifier = {}\nnoticed = 0\nnotifier.on("ping", (e) => { noticed = noticed + 1 })\nend()\n',
    "enter.prg": 'notifier.emit("ping")\nend()\n',
  },
};

test("recovery reattaches a startup listener on a durable ordinary object to its startup object", () => {
  const { game, candidate, state: captured } = recoveryCandidateWithDurableState(recoveryEmitterSpec, [], (state) => {
    state.vm.globals.noticed = 0;
  });
  const anchor = JSON.parse(new TextDecoder().decode(candidate)).recoveryAssets.listenerAnchors as { readonly handle: number; readonly ordinal: number }[];
  equal(anchor.length, 1, "the durable object with a startup listener is anchored");
  equal(anchor[0]?.handle, stateHandleOf(captured, "notifier"));
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, undefined, candidate);
  deepEqual(run(engine, game.files, 30).diagnostics, []);
  equal(engine.recoveryStatus(), "paused");
  const resumed = doubles.state();
  const handle = stateHandleOf(resumed, "notifier");
  ok(handle !== null);
  ok(resumed.events.listeners.some((listener) => listener.emitter === `object:${handle}`), "the startup listener names the restored object's handle");
  equal(engine.resumeRecovery(), true);
  deepEqual(run(engine, game.files, 5).diagnostics, []);
  equal(resumed.vm.globals.noticed, 1, "the startup listener still runs for the restored object");
});

test("a look-alike record rebuilt at a startup listener's handle refuses capture instead of misattaching", () => {
  const { engine, state } = recoveryFixture([], recoveryEmitterSpec);
  const handle = stateHandleOf(state, "notifier");
  ok(handle !== null);
  ok(state.events.listeners.some((listener) => listener.emitter === `object:${handle}`), "startup installed the listener");
  // A host that rebuilds the object table (restoring a save, re-entering a world) can leave a
  // structurally identical record at the same handle. Only the startup lifetime may decide, so the
  // association is refused rather than pointed at the look-alike.
  state.vm.objects = state.vm.objects.map((record) =>
    record.handle === handle ? { ...record, members: { ...record.members } } : record);
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  equal(state.engine.boot?.stage, "running");
  ok(engine.recoveryCandidate() === null, "capture refuses a listener whose startup object identity is gone");
});

test("a startup listener freed with its object is not anchored to a later object", () => {
  const spec: GameSpec = {
    ...PAUSED_RECOVERY_GAME,
    programs: {
      ...PAUSED_RECOVERY_GAME.programs,
      "start.prg": 'spare = {}\nspare.on("ping", (e) => { ignored = 1 })\nstartupvalue = 1\nentryCount = 0\nboardCount = 0\nitemCount = 0\nend()\n',
      "board.prg": "spare = null\nthreadsleep(getthreadid(), 0.05)\nfresh = {}\nend()\n",
    },
  };
  const { engine, state } = recoveryFixture([], spec);
  ok(stateHandleOf(state, "fresh") !== null, "the later object exists");
  ok(!state.events.listeners.some((listener) => listener.emitter.startsWith("object:")), "the freed object took its listener with it");
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  equal(state.engine.boot?.stage, "running");
  const candidate = engine.recoveryCandidate();
  ok(candidate !== null, "capture still succeeds: there is no startup listener left to misattach");
  const anchors = JSON.parse(new TextDecoder().decode(candidate.bytes)).recoveryAssets.listenerAnchors as unknown[];
  deepEqual(anchors, [], "a later object is never anchored by handle or global name");
});

test("a listener installed after startup never anchors its durable object", () => {
  const spec: GameSpec = {
    ...PAUSED_RECOVERY_GAME,
    programs: {
      ...PAUSED_RECOVERY_GAME.programs,
      "start.prg": 'notifier = {}\nnoticed = 0\nentryCount = 0\nboardCount = 0\nitemCount = 0\nend()\n',
      "board.prg": 'notifier.on("ping", (e) => { noticed = noticed + 1 })\nboardCount = boardCount + 1\nend()\n',
    },
  };
  const { engine, state, game } = recoveryFixture([], spec);
  const handle = stateHandleOf(state, "notifier");
  ok(handle !== null);
  ok(state.events.listeners.some((listener) => listener.emitter === `object:${handle}`), "the board program installed a listener after startup");
  startRecoveryProgram(state, "checkpoint()\nend()");
  engine.advance(1, []);
  equal(state.engine.boot?.stage, "running");
  const candidate = engine.recoveryCandidate();
  ok(candidate !== null, "capture succeeds: a post-startup listener is not startup state");
  const anchors = JSON.parse(new TextDecoder().decode(candidate.bytes)).recoveryAssets.listenerAnchors as unknown[];
  deepEqual(anchors, [], "only listeners present when startup finished can anchor an object");
  // Refusing here would strand a perfectly recoverable game: a fresh startup has no such listener to reattach.
  const relaunch = bootEngine(game, makeDoubles(), undefined, undefined, candidate.bytes);
  deepEqual(run(relaunch, game.files, 30).diagnostics, []);
  equal(relaunch.recoveryStatus(), "paused", "the durable object still recovers without its post-startup listener");
});

function stateHandleOf(state: GameState, name: string): number | null {
  const value = state.vm.globals[name];
  return typeof value === "object" && value !== null && "handle" in value && typeof value.handle === "number" ? value.handle : null;
}

test("recovery keeps live RNG, clock, actor services and startup emitter listeners coherent", () => {
  const spec: GameSpec = {
    ...PAUSED_RECOVERY_GAME,
    programs: {
      ...PAUSED_RECOVERY_GAME.programs,
      "start.prg": 'hero = setuprecoveryactor()\nref = game\ngamehits = 0\nactorhits = 0\nfallhits = 0\nref.on("ping", (e) => { gamehits = gamehits + 1 })\nhero.on("ping", (e) => { actorhits = actorhits + 1 })\nhero.on("fallen", (e) => { fallhits = fallhits + 1 })\nend()\n',
      "enter.prg": 'draw = random(1000)\nhero.hp = 0\nhero.hp = 7\nref.emit("ping")\nhero.emit("ping")\nthreadsleep(getthreadid(), 0.05)\nwoke = 1\nend()\n',
    },
  };
  const { game, candidate, state: source } = recoveryCandidateWithDurableState(spec, [recoveryActorPlugin], (state) => {
    state.vm.globals.gamehits = 0;
    state.vm.globals.actorhits = 0;
    state.vm.globals.fallhits = 0;
    state.vm.globals.woke = 0;
  });
  const expectedRng = { ...source.rng };
  const expectedDraw = 1 + nextUint32(expectedRng) % 1000;
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, [recoveryActorPlugin], candidate);
  deepEqual(run(engine, game.files, 30).diagnostics, []);
  equal(engine.recoveryStatus(), "paused");
  const state = doubles.state();
  equal(engine.resumeRecovery(), true);
  const result = run(engine, game.files, 12);
  deepEqual(result.diagnostics, []);
  equal(state.vm.globals.draw, expectedDraw);
  deepEqual(state.rng, expectedRng);
  equal(state.actors.actors[0]?.stats.hp, 7);
  equal(state.vm.globals.gamehits, 1);
  equal(state.vm.globals.actorhits, 1);
  equal(state.vm.globals.fallhits, 1);
  equal(state.vm.globals.woke, 1);
});

test("throwing external sprite install rolls back its board and sprites", () => {
  const { game, candidate } = recoveryCandidateWithDurableState();
  const runtime = createSpriteRuntime();
  const originalSection = { ...runtime.section };
  const throwing: SpriteRuntime = {
    ...runtime,
    prepareRecovery(board, sprites) {
      const transaction = runtime.prepareRecovery(board, sprites);
      return {
        commit() { transaction.commit(); throw new Error("sprite install failed"); },
        rollback() { transaction.rollback(); },
      };
    },
  };
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, undefined, candidate, throwing);
  const result = run(engine, game.files, 30);
  equal(engine.recoveryStatus(), "failed");
  ok(result.diagnostics.some(({ message }) => message.includes("sprite install failed")));
  deepEqual(runtime.section, originalSection);
  equal(runtime.applyEffect({ name: "createplayer", args: ["test"], origin: 0, order: 0, phase: "sprites", delivery: "immediate" } as never), false);
  equal(doubles.state().world.board, undefined);
  equal(doubles.state().vm.globals.recoveryflag, undefined);
});

test("successful recovery installs the saved sprites into the external runtime", () => {
  const { game, candidate } = recoveryCandidateWithDurableState();
  const runtime = createSpriteRuntime();
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, undefined, candidate, runtime);
  deepEqual(run(engine, game.files, 30).diagnostics, []);
  equal(engine.recoveryStatus(), "paused");
  deepEqual(runtime.getPlayerPosition(), { x: 123, y: 231 });
  equal(runtime.section.items[0]?.multitaskThread, null);
  equal(engine.resumeRecovery(), true);
  ok(runtime.section.items[0]?.multitaskThread != null);
  equal(run(engine, game.files, 3).diagnostics.length, 0);
});

test("smoke: promote, select, pause and explicitly resume a recovery candidate", () => {
  const { game, candidate, state: captured } = recoveryCandidateWithDurableState();
  const files = new Map<string, Uint8Array>();
  const store = {
    read: (path: string) => files.get(path)?.slice() ?? null,
    write: (path: string, bytes: Uint8Array) => { files.set(path, bytes.slice()); },
    writeAtomic: (path: string, bytes: Uint8Array) => { files.set(path, bytes.slice()); },
    list: (prefix: string) => [...files.keys()].filter((path) => path.startsWith(prefix)),
  };
  const validate = (bytes: Uint8Array) => {
    const restored = restoreRecoveryCandidate(new TextDecoder().decode(bytes), captured.audio);
    return { tick: restored.state.time.tick, ledgerHash: hashGameLedger(projectGameLedger(restored.state)) };
  };
  const promoted = promoteRecovery(store, { gameId: "smoke", bytes: candidate }, validate);
  const selected = selectRecovery(store, { gameId: "smoke" }, validate);
  ok(selected !== null);
  equal(selected.ledgerHash, promoted.ledgerHash);
  throws(() => promoteRecovery(store, { gameId: "smoke", bytes: encoder.encode(snapshotGameSave(captured)) }, validate));
  equal(selectRecovery(store, { gameId: "smoke" }, validate)?.generation, selected.generation);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles, undefined, undefined, selected.bytes);
  deepEqual(run(engine, game.files, 30).diagnostics, []);
  equal(engine.recoveryStatus(), "paused");
  equal(doubles.state().vm.globals.entrycount, 0);
  equal(engine.resumeRecovery(), true);
  deepEqual(run(engine, game.files, 3).diagnostics, []);
  equal(doubles.state().vm.globals.entrycount, 1);
});

test("a reserved plugin id is an unknown plugin with a located diagnostic, never an inherited member", () => {
  // `constructor`, `__proto__` and `toString` are inherited members of a plain object, so a
  // plain `table[id]` lookup selects one instead of reporting `plugin.unresolved` (#537).
  for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const result = resolveManifestPlugins([{ id }], "game/main.gam");
    equal(result.plugins.length, 0, `${id}: no plugin was resolved`);
    equal(result.diagnostics.length, 1, `${id}: one diagnostic`);
    equal(result.diagnostics[0]?.code, "plugin.unresolved", `${id}: unresolved`);
    equal(result.diagnostics[0]?.message.includes(id), true, `${id}: the message names the id`);
  }
  // An ordinary id is unaffected.
  const core = resolveManifestPlugins([{ id: "core" }]);
  equal(core.plugins.length, 1);
  equal(core.diagnostics.length, 0);
});

test("boot emits battle and menu prefetch hints, and consuming them does not change state or draw hashes", () => {
  const game = authorGame({
    initChar: "hero.tem",
    boards: {
      "start.brd": { music: "theme.mid", battleBackground: "fight.bkg" },
    },
    programs: { "startup.prg": "end()\n" },
    startup: "startup.prg",
    battleBackgrounds: {
      "fight.bkg": {
        music: "battle.mid",
        menuMoveSound: "move.wav",
        menuChooseSound: "choose.wav",
        readySound: "ready.wav",
        cantDoSound: "nope.wav",
      },
    },
    cursorSounds: { move: "cursor.wav", select: "pick.wav", cancel: "back.wav" },
  });

  function bootAndCollect(observe: boolean) {
    const doubles = makeDoubles();
    const engine = bootEngine(game, doubles);
    const hints: string[] = [];
    let report = engine.advance(6, []);
    const note = () => {
      if (!observe) return;
      for (const request of report.requests) {
        if (request.kind !== "prefetch") continue;
        for (const hint of request.hints) hints.push(`${hint.tier}:${hint.key}`);
      }
    };
    note();
    for (let guard = 0; guard < 40 && report.loading; guard += 1) {
      const replies = report.requests.flatMap((request) =>
        request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: game.files.get(request.key) ?? null } }] : [],
      );
      report = engine.advance(6, replies);
      note();
    }
    const drawHash = hashDrawList(engine.drawList(0, { shading: true, images: true, sprites: true }));
    return { stateHash: report.stateHash, drawHash, hints };
  }

  const observed = bootAndCollect(true);
  const discarded = bootAndCollect(false);

  ok(observed.hints.includes("now:media/theme.mid"), `board music hint emitted: ${observed.hints.join(",")}`);
  ok(observed.hints.includes("next:battle.mid"), `battle music hint emitted: ${observed.hints.join(",")}`);
  ok(observed.hints.includes("next:choose.wav"), `battle menu choose hint emitted: ${observed.hints.join(",")}`);
  ok(observed.hints.includes("always:media/cursor.wav"), `main menu move hint emitted: ${observed.hints.join(",")}`);
  equal(observed.stateHash, discarded.stateHash, "a prefetch hint never changes the state hash");
  equal(observed.drawHash, discarded.drawHash, "a prefetch hint never changes the draw hash");
});
test("boot keeps simultaneous asset requests waiting across delayed replies and hashes their completion independent of order", () => {
  const game = authorGame({
    initChar: "hero.tem",
    startup: "start.prg",
    boards: { "start.brd": {} },
    programs: {
      "start.prg": "end()\n",
      "alpha.prg": "end()\n",
      "beta.prg": "end()\n",
    },
  });

  function resolveInOrder(reverse: boolean) {
    const engine = bootEngine(game, makeDoubles());
    const beforeMain = engine.advance(0, []);
    equal(beforeMain.requests.length, 1);
    const mainRequest = beforeMain.requests[0];
    if (mainRequest?.kind !== "asset") throw new Error("expected the main-file asset request");
    equal(mainRequest.key, "main.gam");

    let report = engine.advance(0, [{
      tick: beforeMain.tickAfter,
      event: { kind: "asset", reqId: mainRequest.reqId, bytes: game.files.get(mainRequest.key) ?? null },
    }]);
    const pending = report.requests.filter((request) => request.kind === "asset");
    equal(pending.length, 4, "startup, two other programs and initChar are requested together");
    equal(report.loading, true);
    ok(report.stateHash !== beforeMain.stateHash, "the pending boot requests change the state hash");

    const order = reverse ? [...pending].reverse() : [...pending];
    const first = order[0];
    if (first?.kind !== "asset") throw new Error("expected an asset request");
    report = engine.advance(0, [{
      tick: report.tickAfter,
      event: { kind: "asset", reqId: first.reqId, bytes: game.files.get(first.key) ?? null },
    }]);
    equal(report.loading, true, "the other requests remain outstanding after one delayed reply");
    const waitingHash = report.stateHash;

    // Hold the rest of the replies back for an engine tick; the boot remains in its real loading flow.
    report = engine.advance(1, []);
    equal(report.loading, true);
    equal(report.ticksRun, 0);
    equal(report.stateHash, waitingHash);

    for (const request of order.slice(1)) {
      if (request.kind !== "asset") throw new Error("expected an asset request");
      report = engine.advance(0, [{
        tick: report.tickAfter,
        event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null },
      }]);
    }
    equal(report.loading, false, "boot finishes loading once the same requests have all been answered");
    ok(report.stateHash !== waitingHash, "the completed boot differs from its still-waiting state");
    return report.stateHash;
  }

  equal(resolveInOrder(false), resolveInOrder(true), "reply order does not change the completed boot hash");
});

test("an extra settled boot request moves the saved request counter and the old projection, never the state hash", () => {
  function boot(extraProgram: boolean) {
    const game = authorGame({
      initChar: "hero.tem",
      startup: "start.prg",
      boards: { "start.brd": {} },
      programs: extraProgram ? { "start.prg": "end()\n", "extra.prg": "end()\n" } : { "start.prg": "end()\n" },
    });
    const doubles = makeDoubles();
    const result = run(bootEngine(game, doubles), game.files, 3);
    return { requests: result.requests, state: doubles.state(), stateHash: result.report.stateHash };
  }

  const plain = boot(false);
  const extra = boot(true);
  ok(!plain.requests.includes("prg/extra.prg"));
  ok(extra.requests.includes("prg/extra.prg"), "the extra program is a real, additional boot request");
  deepEqual(plain.state.engine.pending, [], "every request has settled");
  deepEqual(extra.state.engine.pending, [], "every request has settled");
  equal((extra.state.engine.nextRequestId ?? 0), (plain.state.engine.nextRequestId ?? 0) + 1, "the saved counter moved by exactly the extra request");
  ok(hashWithRequestCounter(extra.state) !== hashWithRequestCounter(plain.state), "the projection before the ruling moved with it");
  equal(extra.stateHash, plain.stateHash, "the reported state hash does not move");
  equal(hashGameState(extra.state), hashGameState(plain.state), "the state hash does not move");
});



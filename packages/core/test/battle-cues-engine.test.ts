// Entry 7.19 (#691), the whole-engine half: a real game boots with the authored `stock/stock_battle` package,
// starts a fight with `FightEnemy`, wins it, and the engine's own events return the board's music. Every cue is
// read from the engine's report, so this is the stream a runner receives (docs/spec/engine/audio-media.md#audio-headless).
// The cue inventory is docs/spec/engine/battle.md#bat-10-cue-inventory.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import { test } from "node:test";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  IR_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  deriveGameId,
  enqueueDirectionMove,
  hashGameState,
  hydrateSprites,
  movementPhaseRegistration,
  nextUint32,
  PACKAGE_ROOT,
  registerActorObject,
  writeBattleBackground,
  writeBoard,
  writeCharacter,
  writeEnemy,
  writeMainFile,
  type AudioCue,
  type BattleBackground,
  type Engine,
  type Enemy,
  type GameState,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const encoder = new TextEncoder();

type Files = Map<string, Uint8Array>;
type AuthoredGameFiles = { readonly files: Files; readonly paths: string[] };

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A one-track Standard MIDI File that lasts five seconds (300 ticks). */
function midi(): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x87, 0x40, 0xff, 0x2f, 0x00,
  ]);
}

/** An 8-bit mono 8 kHz WAV of 4000 frames: half a second (30 ticks). */
function wav(): Uint8Array {
  const frames = 4000;
  const le32 = (value: number): number[] => [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255];
  const le16 = (value: number): number[] => [value & 255, (value >> 8) & 255];
  return new Uint8Array([
    ...encoder.encode("RIFF"), ...le32(36 + frames), ...encoder.encode("WAVE"),
    ...encoder.encode("fmt "), ...le32(16), ...le16(1), ...le16(1), ...le32(8000), ...le32(8000), ...le16(1), ...le16(8),
    ...encoder.encode("data"), ...le32(frames), ...new Array<number>(frames).fill(128),
  ]);
}

function authoredEnemy(): Uint8Array {
  const enemy: Enemy = {
    magic: "RPGTLKIT ENEMY",
    major: 2,
    minor: 1,
    name: "Slime",
    hp: 6,
    smp: 0,
    fp: 2,
    dp: 1,
    canRun: 1,
    criticalOn: 0,
    criticalBy: 0,
    specialMoves: [],
    weaknesses: [],
    strengths: [],
    aiLevel: 0,
    customAi: 0,
    aiProgram: "",
    experienceReward: 0,
    goldReward: 0,
    defeatProgram: "",
    runAwayProgram: "",
    stances: ["", "", "", "", "", ""],
    customStances: [],
    residue: new Uint8Array(),
  };
  return unwrap(writeEnemy(enemy));
}

function authoredBackground(): Uint8Array {
  const background: BattleBackground = {
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music: "battle.mid",
    menuMoveSound: "",
    menuChooseSound: "",
    readySound: "ready.wav",
    cantDoSound: "",
    residue: new Uint8Array(),
  };
  return unwrap(writeBattleBackground(background));
}

function authoredBoard(music = "board.mid", enterPrg = "enter.prg"): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, backgroundMusic: music, enterPrg, start: { x: 64, y: 64, layer: 1 } },
  }));
}

/** The stock package exactly as the game's package list names it: the real manifest and the real program. */
function stockBattleCatalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as { name: string; version: string; namespace: string; requests: PackageCatalogueEntry["requests"]; program: string };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(folder, manifest.program), "utf8"), ir: IR_VERSION, dialect: "tk3" },
  }];
}

/** The board's enter program starts the fight; the hero wins on a later turn, so the sequence runs unattended. */
const ENTER_PROGRAM = [
  "stockBattle.turn = (party, index) => {",
  "  turns = turns + 1",
  "  if (party == 1 && turns > 2) {",
  "    physical({ source: battle.fighter(1, index), target: battle.fighter(0, 0), amount: 99 })",
  "  }",
  "  return 0",
  "}",
  "turns = 0",
  "sleep(2)",
  'game.on("battleEnded", (event) => { endedOutcome = event.detail.outcome; endedAfterTurns = turns })',
  'game.on("boardReturned", (event) => { returnedBoard = event.detail["boardKey"] })',
  'FightEnemy("slime", "night.bkg")',
  "fightReturned = 1",
  "end()",
].join("\n");

function authoredGame(enterProgram = ENTER_PROGRAM, startupProgram = "end()\n"): AuthoredGameFiles {
  const files: Files = new Map();
  const paths: string[] = ["main.gam", "Boards/start.brd", "Boards/other.brd", "Chrs/hero.tem", "Prg/start.prg", "Prg/enter.prg", "Prg/other.prg", "Media/board.mid", "Media/other.mid", "Media/battle.mid", "Media/ready.wav"];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePlugins: ["stock_battle"],
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), authoredBoard());
  files.set(assetKey("boards/other.brd"), authoredBoard("other.mid", "other.prg"));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(startupProgram));
  // Restore battle music after B's normal entry cue, so the later return must start B's track again.
  files.set(assetKey("prg/other.prg"), encoder.encode('mediaPlay("battle.mid", { track: "music", loop: 1 })\nend()'));
  files.set(assetKey("prg/enter.prg"), encoder.encode(enterProgram));
  files.set(assetKey("media/board.mid"), midi());
  files.set(assetKey("media/other.mid"), midi());
  files.set(assetKey("media/battle.mid"), midi());
  files.set(assetKey("media/ready.wav"), wav());
  files.set(assetKey("enemy/slime.ene"), authoredEnemy());
  files.set(assetKey("bkrounds/night.bkg"), authoredBackground());
  return { files, paths };
}

type Played = {
  readonly cues: readonly AudioCue[];
  readonly hashes: readonly string[];
  readonly state: GameState;
  /** The tick at which each cue was reported, with the report's hash, for ordering checks. */
  readonly cueTicks: readonly number[];
  /** Every script `media.voice` object the audio phase saw, with the tick it appeared and the tick it was bound. */
  readonly voices: readonly ObservedVoice[];
};

/**
 * One `media.voice` object as the audio phase of a tick saw it (MEDIA-1): `firstTick` is the tick it first
 * appeared in, and `boundTick` the first tick it carried a track, a slot and a cue id together.
 */
type ObservedVoice = {
  readonly handle: number;
  readonly firstTick: number;
  readonly track: string | null;
  readonly slot: number | null;
  readonly cueId: number | null;
  readonly boundTick: number | null;
};

/** The members of a `media.voice` record, read the way MEDIA-1 defines them. */
function voiceObservation(record: { readonly handle: number; readonly members: { readonly [name: string]: unknown } }, tick: number, firstTick: number): ObservedVoice {
  const track = typeof record.members["track"] === "string" ? record.members["track"] : null;
  const slot = typeof record.members["slot"] === "number" && Number.isInteger(record.members["slot"]) ? record.members["slot"] : null;
  const cueId = typeof record.members["cueId"] === "number" && Number.isInteger(record.members["cueId"]) ? record.members["cueId"] : null;
  const bound = track !== null && slot !== null && cueId !== null;
  return { handle: record.handle, firstTick, track, slot, cueId, boundTick: bound ? tick : null };
}

/**
 * Host the game for `ticks` engine ticks, `CHUNK` ticks per `advance` call, answering every asset request.
 * `device` models a real runner: it answers each finished one-shot with the advisory `audio.ended` input. A null
 * runner records the same cues and never replies (docs/spec/engine/audio-media.md#audio-headless).
 */
function play(ticks: number, device: boolean, switchBoard = false, cancelBoard = false): Played {
  const listener = 'canceledEntry = 0\nmedia.on("beforePlay", (event) => { if (event.detail.source == "board" && canceledEntry == 0) { canceledEntry = 1; event.cancel() } })\n';
  const { files, paths } = authoredGame(cancelBoard ? listener + ENTER_PROGRAM : ENTER_PROGRAM);
  let latest = null as GameState | null;
  let seeded = false;
  let switched = false;
  let observedOutcome = false;
  // The audio phase runs after the applier binds a start and before the end-of-tick pass, so a voice object
  // that only a held effect keeps alive is visible here and nowhere later.
  const observedVoices = new Map<number, ObservedVoice>();
  const observeVoices = (state: GameState): void => {
    const tick = state.time.tick;
    for (let index = 0; index < state.vm.objects.length; index += 1) {
      const record = state.vm.objects[index];
      if (record === undefined || record.hostType !== "media.voice") continue;
      const previous = observedVoices.get(record.handle);
      if (previous === undefined) {
        observedVoices.set(record.handle, voiceObservation(record, tick, tick));
        continue;
      }
      if (previous.boundTick !== null) continue;
      const current = voiceObservation(record, tick, previous.firstTick);
      if (current.boundTick !== null) observedVoices.set(record.handle, current);
    }
  };
  const engine: Engine = createEngine({
    seed: 23,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-cues-test",
    width: 320,
    height: 240,
    maxTicks: ticks + 600,
    packageCatalogue: stockBattleCatalogue(),
    // The authored main.gam has initChar; avoid an effect applier so surfaces remain batchable.
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (switchBoard && !switched && state.battle !== null && state.battle.outcome === null && state.world.board) {
          equal(state.battle.boardKey, "boards/start.brd");
          equal(state.world.board.key, "boards/start.brd");
          // Schedule the engine's normal send transition, including hydration of the authored board B.
          state.engine.transition = { board: "other.brd", x: 2, y: 2, layer: 1 };
          equal(state.battle.boardKey, "boards/start.brd");
          switched = true;
        }
        if (switchBoard && state.battle !== null && state.battle.outcome !== null) {
          equal(state.battle.boardKey, "boards/start.brd", "the battle retains board A through its outcome");
          equal(state.world.board?.key, "boards/other.brd");
          observedOutcome = true;
        }
        if (seeded || state.engine.boot?.stage !== "running") return;
        seeded = true;
        const hero = addActor(state.actors, {
          kind: "party",
          source: "hero.tem",
          name: "Hero",
          stats: { hp: 20, maxHp: 20, smp: 4, maxSmp: 4, dp: 2, fp: 4, level: 1 },
        });
        registerActorObject(state.vm, state.events, state.actors, hero.id);
        state.party.members = [hero.id];
        state.party.selected = hero.id;
      },
    }, {
      phase: "audio",
      run: (state) => { observeVoices(state); },
    }],
  });
  const cues: AudioCue[] = [];
  const cueTicks: number[] = [];
  const hashes: string[] = [];
  const finishing = new Map<number, number[]>();
  let replies: InputRecord[] = [];
  let elapsed = 0;
  for (let guard = 0; guard < ticks * 40 && elapsed < ticks; guard += 1) {
    const due: number[] = [];
    if (device && latest !== null) {
      for (const [tick, ids] of finishing) {
        if (tick > latest.time.tick) continue;
        due.push(...ids);
        finishing.delete(tick);
      }
    }
    const inputs: InputRecord[] = [...replies, ...due.map((cueId): InputRecord => ({ tick: latest?.time.tick ?? 0, event: { kind: "audio.ended", cueId } }))];
    replies = [];
    const report = engine.advance(CHUNK, inputs);
    elapsed += report.ticksRun;
    for (const cue of report.audioCues) {
      cues.push(cue);
      cueTicks.push(report.tickAfter);
      if (device && cue.kind === "media.play" && cue.loop === false && cue.asset !== null) {
        const finished = cue.asset === "media/ready.wav" ? cue.tick + 30 : null;
        if (finished !== null) finishing.set(finished, [...(finishing.get(finished) ?? []), cue.cueId]);
      }
    }
    if (report.ticksRun > 0) hashes.push(report.stateHash);
    if (report.loading) {
      replies = report.requests.flatMap((request) => (request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []));
    }
    // Stop after return music; the transition case also produces an entry cue.
    if (musicStarts(cues).length >= (switchBoard ? 5 : 3)) break;
  }
  if (latest === null) throw new Error("the engine never ran a tick");
  if (switchBoard) ok(observedOutcome, "board B is active while the won battle still names board A");
  return { cues, hashes, state: latest, cueTicks, voices: [...observedVoices.values()] };
}

/** Ticks per `advance` call; one state hash is taken per call. */
const CHUNK = 5;

const musicStarts = (cues: readonly AudioCue[]): string[] =>
  cues.filter((cue) => cue.kind === "media.play" && cue.track === "music").map((cue) => String(cue.asset));
type HostedEngine = { readonly engine: Engine; latest(): GameState | null };

function hostedEngine(game: AuthoredGameFiles): HostedEngine {
  let latest: GameState | null = null;
  let hasPlayer = false;
  let seeded = false;
  const engine = createEngine({
    seed: 23,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-cues-test",
    width: 320,
    height: 240,
    maxTicks: 1000,
    packageCatalogue: stockBattleCatalogue(),
    startup: { presence: { hasPlayer: () => hasPlayer }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    effectAppliers: [{ section: "sprites", applier: (effect) => { if (effect.name === "createplayer") hasPlayer = true; } }],
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (seeded || state.engine.boot?.stage !== "running") return;
        seeded = true;
        if (state.party.members.length > 0) return;
        const hero = addActor(state.actors, {
          kind: "party",
          source: "hero.tem",
          name: "Hero",
          stats: { hp: 20, maxHp: 20, smp: 4, maxSmp: 4, dp: 2, fp: 4, level: 1 },
        });
        registerActorObject(state.vm, state.events, state.actors, hero.id);
        state.party.members = [hero.id];
        state.party.selected = hero.id;
      },
    }],
  });
  return { engine, latest: () => latest };
}

const SAVE_ENTER_PROGRAM = [
  "stockBattle.turn = (party, index) => {",
  "  turns = turns + 1",
  "  if (saveBattle == 1) {",
  "    saveBattle = 0",
  '    Save("slot")',
  "  }",
  "  if (party == 1 && turns > 2) {",
  "    physical({ source: battle.fighter(1, index), target: battle.fighter(0, 0), amount: 99 })",
  "  }",
  "  return 0",
  "}",
  "turns = 0",
  "sleep(2)",
  'game.on("battleEnded", (event) => { endedOutcome = event.detail.outcome; endedAfterTurns = turns })',
  'game.on("boardReturned", (event) => { returnedBoard = event.detail["boardKey"] })',
  "saveBattle = 1",
  'FightEnemy("slime", "night.bkg")',
  "fightReturned = 1",
  "end()",
].join("\n");

test("a won fight returns the active board's music after the battle music, through the engine's own events", () => {
  const played = play(400, false);
  const globals = played.state.vm.globals;
  equal(globals.fightreturned, 1, "FightEnemy returned: the fight ran to its outcome");
  equal(globals.endedoutcome, 2, "battleEnded was announced with the won outcome");
  equal(globals.returnedboard, "boards/start.brd", "boardReturned named the active board");
  deepEqual(musicStarts(played.cues), ["media/board.mid", "media/battle.mid", "media/board.mid"], "board, battle, then the active board's own music again");
  const starts = played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "music");
  ok(starts.every((cue) => cue.loop === true));
  ok(starts[1]!.tick < starts[2]!.tick, "the board request follows the battle music");
  equal(played.state.audio.tracks.find((track) => track.name === "music")?.file, "media/board.mid");
  const ready = played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "ui" && cue.asset === "media/ready.wav");
  equal(ready.length, Number(globals.turns), "one readySound voice per full bar through the real engine");
  ok(ready.length >= 3);
  ok(!JSON.stringify(played.state.battle).match(/audio|music|media|\.mid|\.wav/i), "no audio in BattleState");
});

test("battle return chooses the active board music instead of the battle's saved board", () => {
  const played = play(400, false, true);
  equal(played.state.vm.globals.fightreturned, 1);
  equal(played.state.vm.globals.endedoutcome, 2);
  equal(played.state.vm.globals.returnedboard, "boards/other.brd");
  equal(played.state.battle?.boardKey, "boards/start.brd", "battle retains board A after return");
  deepEqual(musicStarts(played.cues), ["media/board.mid", "media/battle.mid", "media/other.mid", "media/battle.mid", "media/other.mid"]);
  equal(played.state.audio.tracks.find((track) => track.name === "music")?.file, "media/other.mid");
});

test("a canceled board music start does not invalidate a pending script voice", () => {
  const played = play(400, false, true, true);
  equal(played.state.vm.globals.canceledentry, 1);
  equal(played.state.vm.globals.fightreturned, 1);
  equal(musicStarts(played.cues).filter((asset) => asset === "media/other.mid").length, 0, "the board music request is canceled");
  ok(played.cues.some((cue) => cue.kind === "media.play" && cue.track === "ui" && cue.asset === "media/ready.wav"));
  // The readySound play must reach its voice object (MEDIA-1), not merely a cue: a record that is a
  // `media.voice` with the `ui` track and integer slot and cue id, still alive in a tick later than the one
  // that created it — which only a held effect keeps alive (issue #825).
  const ui = played.voices.filter((voice) => voice.track === "ui" && voice.slot !== null && voice.cueId !== null);
  ok(ui.length > 0, "the readySound play bound a media.voice on the ui track");
  ok(ui.some((voice) => voice.boundTick !== null && voice.boundTick > voice.firstTick), "the bound voice outlived the tick that created it");
});

test("the null runner and a runner that answers audio.ended see equal cue streams and state hashes", () => {
  const nullRunner = play(400, false);
  const realRunner = play(400, true);
  ok(realRunner.cues.length > 4);
  deepEqual(realRunner.cues, nullRunner.cues, "equal cue streams");
  deepEqual(realRunner.hashes, nullRunner.hashes, "equal state hash after every tick");
  deepEqual(realRunner.cueTicks, nullRunner.cueTicks);
});

test("a full-engine save during battle resumes its parked thread and returns to board music after a real load", () => {
  const savingGame = authoredGame(SAVE_ENTER_PROGRAM);
  const saving = hostedEngine(savingGame);
  let replies: InputRecord[] = [];
  let savedBytes: Uint8Array | null = null;
  let savedPath = "";
  let savedArea = "";
  for (let guard = 0; guard < 10000 && savedBytes === null; guard += 1) {
    const report = saving.engine.advance(CHUNK, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "saveBlob") {
        savedBytes = new Uint8Array(request.bytes);
        savedPath = request.blob.path;
        savedArea = request.blob.area;
      }
    }
    if (savedBytes !== null) break;
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: savingGame.files.get(request.key) ?? null } }]
        : []);
    }
  }
  ok(savedBytes !== null, "the real engine issued a saveBlob request during the fight");
  equal(savedArea, "saves");
  const expectedGameId = deriveGameId(savingGame.files.get(assetKey("main.gam")) ?? new Uint8Array(), "battle-cues-test");
  equal(savedPath, `${expectedGameId}/saved/slot.sav`, "the save area is keyed by the AD-17 GameId");
  const bytes = savedBytes as Uint8Array;
  const saved = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly battle: { readonly outcome: number | null } | null;
    readonly audio: { readonly tracks: readonly { readonly name: string; readonly file: string }[] };
    readonly vm: { readonly threads: readonly { readonly wait: { readonly kind: string; readonly reply: { readonly ok: boolean } | null } | null }[] };
  };
  ok(saved.battle !== null && saved.battle.outcome === null, "the canonical save includes the active battle");
  equal(saved.audio.tracks.find((track) => track.name === "music")?.file, "media/battle.mid", "the playback projection captures battle music");
  ok(saved.vm.threads.some((thread) => thread.wait?.kind === "blob" && thread.wait.reply?.ok === true), "the saved thread resumes after Save returns");

  const loadingGame = authoredGame(SAVE_ENTER_PROGRAM, 'Load("slot")\nend()\n');
  const loading = hostedEngine(loadingGame);
  const cues: AudioCue[] = [];
  let loadedPath = "";
  let loadedArea = "";
  for (let guard = 0; guard < 10000; guard += 1) {
    const report = loading.engine.advance(CHUNK, replies);
    replies = [];
    cues.push(...report.audioCues);
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => {
        if (request.kind === "asset") return [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: loadingGame.files.get(request.key) ?? null } }];
        if (request.kind === "loadBlob") {
          loadedPath = request.blob.path;
          loadedArea = request.blob.area;
          return [{ tick: report.tickAfter, event: { kind: "blob.loaded" as const, reqId: request.reqId, bytes: new Uint8Array(bytes) } }];
        }
        if (request.kind === "saveBlob") return [{ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } }];
        return [];
      });
    }
    const state = loading.latest();
    if (state?.vm.globals.fightreturned === 1 && musicStarts(cues).at(-1) === "media/board.mid") break;
  }
  const resumed = loading.latest();
  ok(resumed !== null);
  equal(loadedArea, "saves");
  equal(loadedPath, savedPath);
  equal(resumed.vm.globals.fightreturned, 1, "FightEnemy returned after the loaded battle continued");
  equal(resumed.vm.globals.endedoutcome, 2, "the resumed battle reached its win outcome");
  const restartedBattleMusic = cues.find((cue) => cue.kind === "media.play" && cue.track === "music");
  equal(restartedBattleMusic?.positionTicks, 0, "music restarts at the beginning after load");
  equal(resumed.vm.globals.returnedboard, "boards/start.brd");
  deepEqual(musicStarts(cues), ["media/battle.mid", "media/board.mid"], "load restarts battle music and battle completion restores board music");
  equal(resumed.audio.tracks.find((track) => track.name === "music")?.file, "media/board.mid");
});

// The full engine, movement, and stock battle run twice for replay, so this integration test exceeds one second.
test("seeded tile movement reaches a stock random encounter outcome and replays", () => {
  const run = () => {
    const program = [
      'game.on("battleEnded", (event) => { endedOutcome = event.detail.outcome })',
      "end()",
    ].join("\n");
    const game = authoredGame(program);
    game.files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
    const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem",
      packagePlugins: ["stock_battle"], enemies: [{ enemyFile: "slime.ene", skillLevel: 1 }], fightType: 0, chances: 1 };
    game.files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
    const board = createEmptyBoard();
    game.files.set(assetKey("boards/start.brd"), unwrap(writeBoard({ ...board, sizeX: 40, sizeY: 30, sizeL: 1,
      tileMatrix: Array.from({ length: 1200 }, () => 0), tileRuns: [{ lutIndex: 0, count: 1200, marker: true }], layerTitles: ["", ""],
      properties: { ...board.properties, enterPrg: "enter.prg", allowBattles: 1, battleSkill: 1, battleBackground: "night.bkg", start: { x: 48, y: 63, layer: 1 } } })));
    game.paths.push("Enemy/slime.ene", "Bkrounds/night.bkg");
    let state: GameState | null = null;
    let seeded = false;
    let moved = false;
    let battleFighters: number[] | null = null;
    let battleStartX: number | null = null;
    let battleContext: { background: string; canRun: boolean; enemies: (string | undefined)[] } | null = null;
    const engine = createEngine({
      seed: 23, assetIndex: createAssetIndex(game.paths), assetRoot: PACKAGE_ROOT, mainFile: "main.gam",
      gameIdentity: "random-encounter-test", width: 320, height: 240, maxTicks: 600,
      packageCatalogue: stockBattleCatalogue(),
      bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")))]]),
      startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
      phaseRegistrations: [
        { phase: "events", run: (current) => {
          state = current;
          if (current.battle !== null && battleFighters === null) {
            battleFighters = current.battle.parties.map((party) => party.length);
            battleStartX = current.sprites.players[0]?.x ?? null;
            battleContext = { background: current.battle.background, canRun: current.battle.canRun, enemies: current.battle.parties[0].map((fighter) => current.actors.actors.find((actor) => actor.id === fighter.actorId)?.source) };
          }
          if (!seeded && current.engine.boot?.stage === "running" && current.world.board != null) {
            seeded = true;
            const hero = addActor(current.actors, { kind: "party", source: "hero.tem", name: "Hero", stats: { hp: 200, maxHp: 200, smp: 4, maxSmp: 4, dp: 20, fp: 100, level: 1 } });
            registerActorObject(current.vm, current.events, current.actors, hero.id);
            current.party.members = [hero.id];
            current.party.selected = hero.id;
            current.sprites = hydrateSprites({ board: current.world.board, players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }] });
          }
          if (seeded && !moved && current.time.tick >= 20) {
            moved = true;
            enqueueDirectionMove(current.sprites, "hero", "E", 0);
          }
        } },
        movementPhaseRegistration(),
      ],
    });
    let replies: InputRecord[] = [];
    const diagnostics: string[] = [];
    let nextPress = 0;
    for (let guard = 0; guard < 10000; guard += 1) {
      const current = state as GameState | null;
      const tick = current?.time.tick ?? 0;
      if (current?.battle !== null && current?.battle !== undefined && tick >= nextPress) {
        nextPress = tick + 12;
        replies.push({ tick, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } });
        replies.push({ tick: tick + 1, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: false } });
      }
      const report = engine.advance(12, replies);
      diagnostics.push(...report.diagnostics.map((item) => item.code));
      replies = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } }] : []);
      if (state !== null && (state as GameState).vm.globals.endedoutcome === 2) break;
    }
    ok(state !== null);
    const result = state as GameState;
    ok(battleFighters !== null && battleFighters[0]! > 0 && battleFighters[1] === 1, "the real handoff started a battle with enemies and the player");
    equal(result.vm.globals.endedoutcome, 2, "stock battle reported victory");
    ok(battleStartX !== null && battleStartX >= 64, "the battle began after crossing the tile boundary");
    ok(battleContext !== null);
    const context = battleContext as { background: string; canRun: boolean; enemies: (string | undefined)[] };
    equal(context.background, "night.bkg");
    equal(context.canRun, true);
    ok(context.enemies.length > 0 && context.enemies.every((enemy) => enemy?.toLowerCase().endsWith("slime.ene")), "encounter selects the authored enemy");
    deepEqual(diagnostics, [], "engine emitted no diagnostics");
    const rng = { ...result.rng };
    return { tick: result.time.tick, hash: hashGameState(result), rng: result.rng, nextDraws: [nextUint32(rng), nextUint32(rng), nextUint32(rng)] };
  };
  deepEqual(run(), run(), "same input and seed replay at the same simulation tick");
});

function authoredBmp(): Uint8Array {
  const bytes = new Uint8Array(62);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  const put32 = (at: number, value: number): void => {
    bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; bytes[at + 2] = (value >>> 16) & 255; bytes[at + 3] = (value >>> 24) & 255;
  };
  const put16 = (at: number, value: number): void => { bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; };
  put32(2, 62); put32(10, 54); put32(14, 40); put32(18, 2); put32(22, 1); put16(26, 1); put16(28, 24); put32(34, 8);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}

test("same-tick setimage before Save waits for the asset reply so the saved state includes the applied image", () => {
  const prg = [
    "createcanvas(4, 2, c)",
    'setimage("pixel.bmp", 0, 0, 2, 1, c)',
    'Save("slot")',
    "end()",
  ].join("\n");
  const game = authoredGame(prg);
  game.paths.push("Bitmap/pixel.bmp");
  game.files.set(assetKey("bitmap/pixel.bmp"), authoredBmp());
  const host = hostedEngine(game);
  let replies: InputRecord[] = [];
  let assetReq: { reqId: number } | undefined;
  let saveReq2: { kind: "saveBlob"; bytes: Uint8Array } | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const report = host.engine.advance(1, replies);
    replies = [];
    const pixelReq = report.requests.find((r) => r.kind === "asset" && r.key === "bitmap/pixel.bmp");
    if (pixelReq) {
      assetReq = { reqId: pixelReq.reqId };
      const prematureSave = report.requests.find((r) => r.kind === "saveBlob");
      equal(prematureSave, undefined, "saveBlob is NOT emitted while asset is pending");
    }
    const saveReq = report.requests.find((r) => r.kind === "saveBlob");
    if (saveReq && saveReq.kind === "saveBlob") {
      saveReq2 = saveReq;
      break;
    }
    if (report.loading) {
      replies = report.requests.flatMap((r): InputRecord[] => r.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: r.reqId, bytes: game.files.get(r.key) ?? null } }]
        : []);
    }
  }
  ok(assetReq, "pixel.bmp was requested");
  ok(saveReq2, "saveBlob IS emitted once asset reply settles");
  const savedBytes = saveReq2.bytes;

  // Inspect the captured save bytes: surfaces section must have the image applied!
  const loadingGame = authoredGame(prg, 'Load("slot")\nend()\n');
  loadingGame.paths.push("Bitmap/pixel.bmp");
  loadingGame.files.set(assetKey("bitmap/pixel.bmp"), authoredBmp());
  const loaded = hostedEngine(loadingGame);
  replies = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const report = loaded.engine.advance(1, replies);
    replies = [];
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => {
        if (request.kind === "asset") return [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: loadingGame.files.get(request.key) ?? null } }];
        if (request.kind === "loadBlob") return [{ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: new Uint8Array(savedBytes) } }];
        return [];
      });
    }
    const state = loaded.latest();
    if (state && state.vm.globals.c !== undefined) break;
  }
  const finalState = loaded.latest();
  ok(finalState, "loaded state exists");
  const canvasHandle = finalState.vm.globals.c;
  ok(typeof canvasHandle === "number", "the program's canvas handle round-trips");
  const surfaceEntry = finalState.surfaces.entries[String(canvasHandle)];
  ok(surfaceEntry, "the program's canvas exists in the restored state");
  const surface = loaded.engine.surfacePixels(surfaceEntry.id, surfaceEntry.rev);
  ok(surface !== null, "surface pixels exist");
  equal(surface.rgba[0], 255, "red channel is 255 from pixel.bmp");
});

test("a save requested inside a cancelable dispatch is restored by a real load", () => {
  // Done-when 6 of Epic 19 asks for a save taken at any tick, including mid-dispatch, to restore and finish with
  // the same state hash. The listener below calls Save() while the emit has parked the caller thread, so the save
  // is taken with `events.dispatch` set (#852).
  const program = [
    "hits = 0",
    'game.on("probe", (event) => { hits = hits + 1; Save("slot") })',
    'game.emitcancelable("probe", {})',
    "afterSave = 1",
    "end()",
  ].join("\n");
  const savingGame = authoredGame(program);
  const saving = hostedEngine(savingGame);
  let replies: InputRecord[] = [];
  let savedBytes: Uint8Array | null = null;
  let savedTick = -1;
  for (let guard = 0; guard < 400 && savedBytes === null; guard += 1) {
    const report = saving.engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "saveBlob") {
        savedBytes = new Uint8Array(request.bytes);
        savedTick = report.tickAfter;
      }
    }
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: savingGame.files.get(request.key) ?? null } }]
        : []);
    }
  }
  ok(savedBytes !== null, "Save() inside the listener reached the host");
  const saved = JSON.parse(new TextDecoder().decode(savedBytes as Uint8Array)) as { readonly events: { readonly dispatch: unknown } };
  ok(saved.events.dispatch !== null, "the save was taken with a dispatch open");
  equal(saving.latest()?.vm.globals.hits, 1, "the listener ran once");

  // A brand-new engine whose start-up program calls load("slot") restores the blob. What this pins: the load really
  // happened (`loadBlob` requested and answered), the restored run resumes at or past the saved tick rather than from
  // zero, the parked listener did not run again, and the caller continues past the emit. Exact cross-engine hash
  // equality for snapshots is pinned by `battle-fresh-load.test.ts`; the save here is the game envelope, taken with
  // the dispatch cursor open, which that test does not cover.
  const loadedGame = authoredGame(program, 'load("slot")\nend()\n');
  const loading = hostedEngine(loadedGame);
  let loadReplies: InputRecord[] = [];
  let sawLoad = false;
  let savedAgain = false;
  for (let guard = 0; guard < 400; guard += 1) {
    const report = loading.engine.advance(1, loadReplies);
    loadReplies = [];
    for (const request of report.requests) {
      if (request.kind === "loadBlob") {
        sawLoad = true;
        loadReplies.push({ tick: report.tickAfter, event: { kind: "blob.loaded" as const, reqId: request.reqId, bytes: new Uint8Array(savedBytes as Uint8Array) } });
      }
      if (request.kind === "saveBlob") {
        // A restored run resumes the Save the snapshot already answered; a refused load falls back to a fresh run,
        // which issues a second save request. This is the discriminator a from-scratch pass cannot satisfy.
        savedAgain = true;
        loadReplies.push({ tick: report.tickAfter, event: { kind: "blob.saved" as const, reqId: request.reqId, ok: true } });
      }
      if (request.kind === "asset") loadReplies.push({ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: loadedGame.files.get(request.key) ?? null } });
    }
    if (loading.latest()?.vm.globals.aftersave === 1) break;
  }
  const resumed = loading.latest();
  ok(sawLoad, "the second engine requested the saved blob");
  equal(savedAgain, false, "the restored run resumed the answered Save instead of running the program again");
  ok(resumed !== null);
  equal(resumed.vm.globals.aftersave, 1, "the loaded run reached the statement after the emit");
  equal(resumed.vm.globals.hits, 1, "the restored run continued the listener's own thread rather than re-running it");
  ok(resumed.time.tick >= savedTick, "the restored run resumed from the saved tick, not from zero");
  equal(savedTick > 0, true, "the save was taken after the first tick");
});

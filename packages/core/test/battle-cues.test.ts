// Entry 7.19 (#691): battle audio cues through the media object, on the real path.
// Every test runs the real `FightEnemy` start, the authored `stock/stock_battle` package, the real media
// object, audio applier and effect bus; nothing about audio is mocked. The cue inventory is
// docs/spec/engine/battle.md#bat-10-cue-inventory: battle music (`.bkg` music, source `battle`), board music
// on return, `readySound` and `cantDoSound` as `ui` voices. The menu cues (`selectSound`, `chooseSound`, the
// cursor sounds) are entry 7.11's and are asserted absent here.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { UI_PLUGIN } from "../src/script/packs/ui.ts";
import { EffectBus } from "../src/engine/effects.ts";
import { engineEffect } from "../src/engine/boot.ts";
import { runEngineCancelableEventOutcome } from "../src/events/dispatch.ts";
import { audioSaveProjection, type AudioSaveProjection } from "../src/audio/index.ts";
import { applyInputEvent } from "../src/input/index.ts";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  BATTLE_PLUGIN,
  BinaryWriter,
  STATUS_EFFECT_MAGIC,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  collectStateGarbage,
  CORE_PLUGIN,
  createAssetIndex,
  createAudioRuntime,
  createBattleOwner,
  createGameState,
  createMediaScriptService,
  createPluginLayers,
  createScriptServices,
  drainDiagnostics,
  fileProgramRef,
  hashGameState,
  MEDIA_PLUGIN,
  RENDER_PLUGIN,
  mediaEventsActive,
  mediaVoiceRef,
  PACKAGE_ROOT,
  queueAudioEvent,
  registerActorObject,
  replyToRequest,
  restoreGameState,
  runEventsPhase,
  runPackageStartup,
  runThreadsPhase,
  runTimePhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  verifyRestoredHandles,
  WORLD_PLUGIN,
  writeBattleBackground,
  writeEnemy,
  type AudioCue,
  type AudioLookup,
  type AudioRuntime,
  type BattleBackground,
  type Enemy,
  type GameState,
  type PluginLayers,
  type ProgramLoader,
  type ResolvedPlugin,
  type ScriptServices,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const stockProgram = new TextEncoder().encode(readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8"));
const programKey = assetKey("Prg/stock-battle.prg");
const loader: ProgramLoader = {
  index: createAssetIndex([programKey]),
  root: PACKAGE_ROOT,
  read: (key) => (key === programKey ? stockProgram : undefined),
};
const startupRef = { ...fileProgramRef(loader, "stock-battle.prg"), owner: "stock_battle" };
const stockBattle: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [] },
};
const plugins = [
  { definition: CORE_PLUGIN },
  { definition: CATALOGUE_STUBS_PLUGIN },
  { definition: CATALOGUE_RESPONDERS_PLUGIN },
  { definition: WORLD_PLUGIN },
  { definition: BATTLE_PLUGIN },
  { definition: UI_PLUGIN },
  { definition: RENDER_PLUGIN },
  { definition: MEDIA_PLUGIN },
  stockBattle,
] as const;

/** The length in ticks of every media file the scenarios may name. A name outside this table is not an asset. */
const LENGTHS: Readonly<Record<string, number>> = {
  "board.mid": 6000,
  "battle.mid": 6000,
  "alt.mid": 6000,
  "ready.wav": 30,
  "cant.wav": 30,
  "select.wav": 30,
  "choose.wav": 30,
};

type Scenario = {
  readonly seed?: number;
  /** The `.bkg` fields; empty is the contract's "no cue". */
  readonly music?: string;
  readonly ready?: string;
  readonly cant?: string;
  readonly select?: string;
  readonly choose?: string;
  /** The enemy file's `canRun`; 0 blocks running for the whole fight. */
  readonly canRun?: number;
  /** Extra script run before the fight starts, for listeners and stock overrides. */
  readonly script?: string;
  /** Board music posted before the fight, as the engine's board producer would. */
  readonly boardMusic?: string | null;
};

/** The stock turn is replaced by a counter so the fight needs no input and the test sees every turn. */
const COUNTING_TURN = [
  "turns = 0",
  "stockBattle.turn = (party, index) => {",
  "  turns = turns + 1",
  "  return 0",
  "}",
].join("\n");

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly audio: AudioRuntime;
  readonly bus: EffectBus;
  readonly diagnostics: { readonly code: string; readonly message: string }[];
  readonly cues: AudioCue[];
  readonly scenario: Scenario;
  readonly layers: PluginLayers;
  tick(): void;
  run(ticks: number): void;
};

function authoredEnemy(canRun: number): Uint8Array {
  const enemy: Enemy = {
    magic: "RPGTLKIT ENEMY",
    major: 2,
    minor: 1,
    name: "Slime",
    hp: 6,
    smp: 0,
    fp: 2,
    dp: 1,
    canRun,
    criticalOn: 0,
    criticalBy: 0,
    specialMoves: [],
    weaknesses: [],
    strengths: [],
    aiLevel: 0,
    customAi: 0,
    aiProgram: "",
    experienceReward: 1,
    goldReward: 1,
    defeatProgram: "",
    runAwayProgram: "",
    stances: ["", "", "", "", "", ""],
    customStances: [],
    residue: new Uint8Array(),
  };
  const written = writeEnemy(enemy);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function authoredBackground(scenario: Scenario): Uint8Array {
  const background: BattleBackground = {
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music: scenario.music ?? "",
    menuMoveSound: scenario.select ?? "",
    menuChooseSound: scenario.choose ?? "",
    readySound: scenario.ready ?? "",
    cantDoSound: scenario.cant ?? "",
    residue: new Uint8Array(),
  };
  const written = writeBattleBackground(background);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

/** A minimal character file: the win outcome reads the hero's source asset for its level-up data. */
function statusBytes(disable = 1): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("disable");
  writer.i16(1);
  writer.i16(0);
  writer.i16(0);
  writer.i16(disable);
  for (let i = 0; i < 5; i += 1) writer.i16(0);
  writer.str("");
  return writer.toBytes();
}

function authoredCharacter(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT CHAR");
  writer.i16(2);
  writer.i16(8);
  writer.str("Hero");
  for (const name of ["exp!", "dp!", "fp!", "hp!", "maxhp!", "name$", "smp!", "maxsm!", "level!"]) writer.str(name);
  for (const value of [10, 100, 100, 10, 40, 40, 40, 1]) writer.i32(value);
  writer.str("");
  for (let index = 0; index < 201; index += 1) {
    writer.str("");
    writer.i32(0);
    writer.i32(0);
    writer.str("");
    writer.str("");
  }
  writer.str("");
  writer.i8(0);
  for (let index = 0; index < 11; index += 1) writer.str("");
  for (let index = 0; index < 7; index += 1) writer.i8(1);
  writer.i32(90);
  writer.i16(5);
  writer.i32(0);
  for (let index = 0; index < 4; index += 1) writer.i16(5);
  writer.str("");
  writer.i8(0);
  writer.i8(1);
  for (let index = 0; index < 8; index += 1) writer.str("");
  for (let index = 0; index < 6; index += 1) writer.str("");
  for (let index = 0; index < 8; index += 1) writer.str("");
  writer.f64(3);
  writer.f64(0.05);
  writer.i32(-1);
  writer.i16(-1);
  return writer.toBytes();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function party(state: GameState): void {
  const hero = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    name: "Hero",
    stats: { hp: 20, maxHp: 20, smp: 4, maxSmp: 4, dp: 2, fp: 4, level: 1 },
  });
  registerActorObject(state.vm, state.events, state.actors, hero.id);
  state.party.members = [hero.id];
  state.party.selected = hero.id;
  state.world = {
    ...state.world,
    board: {
      key: assetKey("boards/field.brd"),
      coordType: 0,
      sizeX: 1,
      sizeY: 1,
      sizeL: 1,
      width: 1,
      height: 1,
      background: { r: 0, g: 0, b: 0 },
      ambient: { r: 0, g: 0, b: 0 },
      layers: [],
    },
  };
}

/** Wire one state to a real media object, audio applier, effect bus and stock package. */
function wire(state: GameState, scenario: Scenario, layers: PluginLayers, fresh: boolean): Rig {
  const diagnostics: { code: string; message: string }[] = [];
  const cues: AudioCue[] = [];
  const bus = new EffectBus(state);
  const media = createMediaScriptService(
    state,
    (name, args) => bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue")),
    (file) => (Object.hasOwn(LENGTHS, file) ? assetKey(`media/${file}`) : null),
    (code, op) => {
      diagnostics.push({ code, message: `${op}: ${code}` });
    },
  );
  let services!: ScriptServices;
  const audio = createAudioRuntime(state, {
    lookup: (asset): AudioLookup => {
      const length = LENGTHS[asset.slice("media/".length)];
      return length === undefined ? { kind: "unsupported" } : { kind: "known", lengthTicks: length };
    },
    engineBeforePlay: (detail) => runEngineCancelableEventOutcome(state, services, "media", "beforePlay", detail, STEP_BUDGET),
    bindVoice: (handle, result) => media.bind(handle, result),
    transition: (event) => queueAudioEvent(state, event),
    transitionsActive: () => mediaEventsActive(state),
    notify: (note) => {
      if (note.kind === "diag") diagnostics.push({ code: note.code, message: `${note.op}: ${note.code}` });
    },
  });
  if (fresh) audio.register(bus);
  else bus.register("audio", audio.apply);
  services = createScriptServices(
    state,
    plugins,
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
    undefined,
    false,
    media,
    undefined,
    undefined,
    null,
    { enemies: [{ enemyFile: "slime.ene", skillLevel: 1 }], stockBattleAvailable: true },
  );
  const rig: Rig = {
    state,
    services,
    audio,
    bus,
    diagnostics,
    cues,
    scenario,
    layers,
    tick() {
      serveAssets(rig);
      runWaitsPhase(state.vm, {
        tick: state.time.tick,
        events: state.events,
        audio: state.audio,
        ...(state.engine.pendingEffects?.audio === undefined ? {} : { pendingAudio: state.engine.pendingEffects.audio }),
        mediaStart: (handle: number) => {
          const record = state.vm.objects.find((item) => item.handle === handle);
          return record === undefined ? null : mediaVoiceRef(record);
        },
      });
      runThreadsPhase(state.vm, services, STEP_BUDGET);
      runEventsPhase(state, services, STEP_BUDGET);
      audio.retry();
      audio.phase();
      collectStateGarbage(state, []);
      runTimePhase(state.time);
      for (const diagnostic of drainDiagnostics(services)) diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
      cues.push(...audio.drain());
    },
    run(ticks) {
      for (let index = 0; index < ticks; index += 1) rig.tick();
    },
  };
  return rig;
}

/** Answer the battle start's and the stock package's asset requests from the scenario's authored files. */
function serveAssets(rig: Rig): void {
  for (const thread of rig.state.vm.threads) {
    const wait = thread.wait;
    if (wait?.kind !== "request" || wait.reply !== null) continue;
    const request = rig.state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request;
    if (request === undefined || request === null) continue;
    let bytes: Uint8Array;
    if (request.area === "enemies") bytes = authoredEnemy(rig.scenario.canRun ?? 1);
    else if (request.area === "backgrounds") bytes = authoredBackground(rig.scenario);
    else if (request.area === "characters") bytes = authoredCharacter();
    else if (request.area === "statusEffects") bytes = statusBytes(1);
    else throw new Error(`the scenario serves no ${String(request.area)} asset (${String(request.path)})`);
    replyToRequest(rig.state.vm, wait.reqId, { ok: true, value: hex(bytes) });
  }
}

function cueRig(scenario: Scenario = {}): Rig {
  const state = createGameState({ seed: scenario.seed ?? 17 });
  party(state);
  const layers = createPluginLayers();
  const rig = wire(state, scenario, layers, true);
  runPackageStartup(state, rig.services, [startupRef], [stockBattle]);
  if (scenario.boardMusic !== undefined) {
    const asset = scenario.boardMusic === null ? null : assetKey(`media/${scenario.boardMusic}`);
    rig.bus.postEffect("audio", engineEffect("audio", "music.play", [asset, true, null, "board"], "draw-audio-cue"));
  }
  startProgram(state.vm, {
    kind: "inline",
    ir: "1",
    text: [COUNTING_TURN, scenario.script ?? "", 'FightEnemy("slime", "night.bkg")', "fightReturned = 1"].join("\n"),
  });
  return rig;
}

function restoreRig(saved: string, scenario: Scenario, projection: AudioSaveProjection): Rig {
  const layers = createPluginLayers();
  const scratch = createGameState({ seed: scenario.seed ?? 17 });
  const scratchRig = wire(scratch, scenario, layers, true);
  runPackageStartup(scratch, scratchRig.services, [startupRef], [stockBattle]);
  const state = restoreGameState(saved);
  const rig = wire(state, scenario, layers, false);
  verifyRestoredHandles(state.vm, rig.services);
  rig.audio.load(projection);
  rig.cues.push(...rig.audio.drain());
  return rig;
}

const global = (state: GameState, name: string): unknown => state.vm.globals[name.toLowerCase()] ?? 0;
const voice = (state: GameState, track: string, slot: number) =>
  state.audio.tracks.find((item) => item.name === track)?.voices.find((item) => item.index === slot);
const plays = (cues: readonly AudioCue[], track: string, file?: string): AudioCue[] =>
  cues.filter((cue) => cue.kind === "media.play" && cue.track === track && (file === undefined || cue.asset === `media/${file}`));

/** Run until the stock battle thread is parked in its pass sleep, so a charge may be written. */
function untilBattleRuns(rig: Rig, limit = 40): void {
  for (let elapsed = 0; elapsed < limit; elapsed += 1) {
    rig.tick();
    if (rig.state.battle !== null && rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep")) return;
  }
  throw new Error(`the battle never reached its pass loop: diagnostics=${JSON.stringify(rig.diagnostics)}`);
}

function setCharge(state: GameState, party: 0 | 1, index: number, charge: number): void {
  const owner = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
    readBattleCounter: () => state.engine.nextBattleId,
    commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
  });
  const result = owner.apply({ type: "setCharge", party, index, charge });
  if (!result.ok) throw new Error(result.error.message);
}

const BEFORE_PLAY_PROBE = [
  "battleSource = 0",
  'media.on("beforePlay", (event) => {',
  '  if (event.detail.source == "battle") { battleSource = battleSource + 1 }',
  "})",
].join("\n");

test("BAT-10 cue inventory: a non-empty .bkg music starts on the music track as a looping battle voice that replaces board music", () => {
  const rig = cueRig({ music: "battle.mid", boardMusic: "board.mid", script: BEFORE_PLAY_PROBE });
  untilBattleRuns(rig);
  ok(rig.state.battle !== null, "the battle started");
  equal(global(rig.state, "battleSource"), 1, "source battle reached beforePlay once");
  const music = voice(rig.state, "music", 0);
  equal(music?.file, "media/battle.mid");
  equal(music?.loop, true);
  const starts = plays(rig.cues, "music");
  deepEqual(starts.map((cue) => [cue.asset, cue.loop]), [["media/board.mid", true], ["media/battle.mid", true]]);
  equal(rig.state.vm.objects.filter((record) => record.className === "media.voice").length, 0, "the engine producer creates no script voice object");
  deepEqual(rig.diagnostics, []);
});

test("BAT-10 cue inventory: a .bkg without music posts no effect and the board music keeps playing", () => {
  const rig = cueRig({ music: "", boardMusic: "board.mid", script: BEFORE_PLAY_PROBE });
  untilBattleRuns(rig);
  ok(rig.state.battle !== null);
  equal(global(rig.state, "battleSource"), 0, "no battle request reached beforePlay");
  equal(voice(rig.state, "music", 0)?.file, "media/board.mid");
  deepEqual(plays(rig.cues, "music").map((cue) => cue.asset), ["media/board.mid"], "no second music cue");
  equal(rig.cues.some((cue) => cue.kind === "media.stop"), false, "the board music is not stopped");
});

test("a .bkg music file that is not an asset is silent and does not stop the board music", () => {
  const rig = cueRig({ music: "missing.mid", boardMusic: "board.mid", script: BEFORE_PLAY_PROBE });
  untilBattleRuns(rig);
  ok(rig.state.battle !== null);
  equal(global(rig.state, "battleSource"), 0);
  equal(voice(rig.state, "music", 0)?.file, "media/board.mid");
});

test("readySound plays as one ui voice each time a fighter's bar is found full, for enemies and players", () => {
  const rig = cueRig({ ready: "ready.wav", music: "battle.mid" });
  rig.run(200);
  const turns = Number(global(rig.state, "turns"));
  ok(turns >= 4, `the seeded fight reached several turns (got ${turns})`);
  const ready = plays(rig.cues, "ui", "ready.wav");
  equal(ready.length, turns, "one ready cue per full bar, never repeated within a fill");
  ok(ready.every((cue) => cue.loop === false), "a ready cue is a one-shot");
  equal(plays(rig.cues, "ui").length, ready.length, "no other ui cue: menu cues belong to 7.11");
  deepEqual(rig.diagnostics, []);
});

test("a disabling status clamps a held full charge below threshold and resets ready, so readySound plays again when charge refills", () => {
  const rig = cueRig({ ready: "ready.wav", music: "battle.mid", script: [
    "stockBattle.turn = (party, index) => {",
    "  turns = turns + 1",
    "  if (party == 1) {",
    "    stockBattle.preserveCharge = 1",
    "  }",
    "  return 0",
    "}",
  ].join("\n") });
  untilBattleRuns(rig);
  rig.cues.length = 0;
  const heroId = rig.state.party.members[0]!;
  setCharge(rig.state, 1, 0, 75);
  rig.run(2);
  equal(plays(rig.cues, "ui", "ready.wav").length, 1, "readySound played once on initial fill");
  rig.run(2);
  equal(plays(rig.cues, "ui", "ready.wav").length, 1, "charge held full; readySound not replayed");

  rig.services.actors.applyStatus(heroId, "freeze.ste", 1);
  rig.run(2);
  equal(rig.state.battle?.parties[1]?.[0]?.charge, 74, "disable clamped charge to threshold - 1");

  rig.services.actors.removeStatus(heroId, "freeze.ste");
  setCharge(rig.state, 1, 0, 75);
  rig.run(2);
  equal(plays(rig.cues, "ui", "ready.wav").length, 2, "readySound played again once the bar refilled after unfreezing");
});

test("two bars filling in the same pass start two ui voices that mix over the continuing battle music", () => {
  const rig = cueRig({ ready: "ready.wav", music: "battle.mid" });
  untilBattleRuns(rig);
  const music = voice(rig.state, "music", 0);
  const musicCueId = music?.cueId;
  const before = rig.cues.length;
  const turnsBefore = Number(global(rig.state, "turns"));
  setCharge(rig.state, 0, 0, 123);
  setCharge(rig.state, 1, 0, 75);
  const tick = rig.state.time.tick;
  rig.run(2);
  const fresh = rig.cues.slice(before);
  const ready = plays(fresh, "ui", "ready.wav");
  equal(ready.length, 2, "both bars start a voice");
  equal(ready[0]?.tick, ready[1]?.tick, "in the same tick");
  ok((ready[0]?.tick ?? -1) >= tick);
  deepEqual(ready.map((cue) => cue.voice), [0, 1], "on different ui voices");
  equal(Number(global(rig.state, "turns")) - turnsBefore, 2);
  equal(voice(rig.state, "ui", 0)?.state, "playing");
  equal(voice(rig.state, "ui", 1)?.state, "playing");
  equal(voice(rig.state, "music", 0)?.state, "playing", "the music voice is still playing");
  equal(voice(rig.state, "music", 0)?.cueId, musicCueId, "and was never restarted");
  equal(fresh.some((cue) => cue.track === "music"), false, "no music cue was produced");
});

test("empty cue fields are silent and the battle carries on", () => {
  const rig = cueRig({ ready: "", cant: "", select: "", choose: "", music: "battle.mid", canRun: 0, script: [
    "stockBattle.turn = (party, index) => {",
    "  turns = turns + 1",
    "  if (party == 1 && ranOnce == 0) { ranOnce = 1; stockBattle.run() }",
    "  return 0",
    "}",
    "ranOnce = 0",
  ].join("\n") });
  rig.run(200);
  ok(Number(global(rig.state, "turns")) >= 4, "turns still happen");
  equal(global(rig.state, "ranonce"), 1, "the blocked Run was attempted");
  equal(plays(rig.cues, "ui").length, 0, "no ui voice at all");
  equal(rig.state.battle?.outcome ?? null, null);
  deepEqual(rig.diagnostics, []);
});

test("a cue field naming a file that is not an asset starts no sound and never stops the fight", () => {
  const rig = cueRig({ ready: "ghost.wav", music: "battle.mid" });
  rig.run(200);
  ok(Number(global(rig.state, "turns")) >= 4);
  equal(voice(rig.state, "music", 0)?.state, "playing");
  ok(rig.diagnostics.every((diagnostic) => diagnostic.code === "media.asset-format"), JSON.stringify(rig.diagnostics));
});

test("a blocked Run plays cantDoSound once as a ui voice and keeps the turn", () => {
  const rig = cueRig({ cant: "cant.wav", music: "battle.mid", canRun: 0, script: [
    "stockBattle.turn = (party, index) => {",
    "  turns = turns + 1",
    "  if (party == 1 && ranOnce == 0) { ranOnce = 1; runResult = stockBattle.run() }",
    "  return 0",
    "}",
    "ranOnce = 0",
    "runResult = -1",
  ].join("\n") });
  rig.run(200);
  equal(global(rig.state, "ranonce"), 1);
  equal(global(rig.state, "runresult"), 0, "a blocked Run is refused");
  const cant = plays(rig.cues, "ui", "cant.wav");
  equal(cant.length, 1);
  equal(cant[0]?.loop, false);
  equal(plays(rig.cues, "music").length, 1, "the battle music was started once and never touched");
  equal(rig.state.battle?.outcome ?? null, null, "the battle goes on");
});

test("selectSound and chooseSound are menu cues: the stock battle loop plays neither", () => {
  const rig = cueRig({ select: "select.wav", choose: "choose.wav", music: "battle.mid" });
  rig.run(200);
  ok(Number(global(rig.state, "turns")) >= 4);
  equal(plays(rig.cues, "ui").length, 0);
});

test("source battle reaches beforePlay and a listener can cancel the music request without a fallback", () => {
  const rig = cueRig({
    music: "battle.mid",
    ready: "ready.wav",
    boardMusic: "board.mid",
    script: [
      "battleSource = 0",
      'media.on("beforePlay", (event) => {',
      '  if (event.detail.source == "battle") { battleSource = battleSource + 1; event.cancel() }',
      "})",
    ].join("\n"),
  });
  rig.run(200);
  equal(global(rig.state, "battlesource"), 1);
  ok(rig.state.battle !== null, "the battle started");
  equal(voice(rig.state, "music", 0)?.file, "media/board.mid", "the canceled request left the board music alone");
  equal(plays(rig.cues, "music", "battle.mid").length, 0, "no battle cue and no fallback cue");
  ok(Number(global(rig.state, "turns")) >= 4, "the fight ran");
  equal(plays(rig.cues, "ui", "ready.wav").length, Number(global(rig.state, "turns")), "combat cues still play");
});

test("source battle reaches beforePlay and a listener can replace the music request", () => {
  const rig = cueRig({
    music: "battle.mid",
    boardMusic: "board.mid",
    script: [
      "battleSource = 0",
      'media.on("beforePlay", (event) => {',
      '  if (event.detail.source == "battle") { battleSource = battleSource + 1; event.detail.file = "MEDIA/ALT.MID"; event.detail.loop = 0 }',
      "})",
    ].join("\n"),
  });
  untilBattleRuns(rig);
  equal(global(rig.state, "battlesource"), 1);
  equal(voice(rig.state, "music", 0)?.file, "media/alt.mid");
  equal(voice(rig.state, "music", 0)?.loop, false);
  equal(plays(rig.cues, "music", "battle.mid").length, 0, "the original request never played");
});

test("a failing beforePlay listener rejects only the music start: no fallback, battle and combat cues go on", () => {
  const rig = cueRig({
    music: "battle.mid",
    ready: "ready.wav",
    boardMusic: "board.mid",
    script: [
      "battleSource = 0",
      'media.on("beforePlay", (event) => {',
      '  if (event.detail.source == "battle") { battleSource = battleSource + 1; sleep(1) }',
      "})",
    ].join("\n"),
  });
  rig.run(200);
  equal(global(rig.state, "battlesource"), 1);
  ok(rig.state.battle !== null, "the failure did not reject or undo the battle start");
  equal(rig.state.battle?.outcome ?? null, null);
  equal(voice(rig.state, "music", 0)?.file, "media/board.mid", "the original track is not a fallback");
  equal(plays(rig.cues, "music", "battle.mid").length, 0);
  ok(rig.diagnostics.some((diagnostic) => diagnostic.code === "event.wait-forbidden"), JSON.stringify(rig.diagnostics));
  ok(Number(global(rig.state, "turns")) >= 4, "the stock loop kept running");
  equal(plays(rig.cues, "ui", "ready.wav").length, Number(global(rig.state, "turns")));
});

/**
 * One scenario's observable record for runner comparison: every cue, every tick hash and the final hash.
 * `device` models a real runner by answering each finished voice with the advisory `audio.ended` reply;
 * the null runner never replies (docs/spec/engine/audio-media.md#audio-headless).
 */
function record(device: boolean, scenario: Scenario, ticks: number): { readonly cues: readonly AudioCue[]; readonly hashes: readonly string[]; readonly turns: unknown; readonly battle: string } {
  const rig = cueRig(scenario);
  const hashes: string[] = [];
  const finishing = new Map<number, number[]>();
  let seen = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    if (device) {
      for (const cueId of finishing.get(rig.state.time.tick) ?? []) applyInputEvent(rig.state.input, { kind: "audio.ended", cueId });
    }
    rig.tick();
    for (const cue of rig.cues.slice(seen)) {
      if (device && cue.kind === "media.play" && cue.loop === false) {
        const length = LENGTHS[(cue.asset ?? "").slice("media/".length)];
        if (length !== undefined) finishing.set(cue.tick + length, [...(finishing.get(cue.tick + length) ?? []), cue.cueId]);
      }
    }
    seen = rig.cues.length;
    hashes.push(hashGameState(rig.state));
  }
  return { cues: rig.cues, hashes, turns: global(rig.state, "turns"), battle: JSON.stringify(rig.state.battle) };
}

test("null and real runners get equal cue streams and state hashes for the same seeded battle", () => {
  const scenario: Scenario = { seed: 29, music: "battle.mid", ready: "ready.wav", cant: "cant.wav", boardMusic: "board.mid", canRun: 0, script: [
    "stockBattle.turn = (party, index) => {",
    "  turns = turns + 1",
    "  if (party == 1 && ranOnce == 0) { ranOnce = 1; stockBattle.run() }",
    "  return 0",
    "}",
    "ranOnce = 0",
  ].join("\n") };
  const nullRunner = record(false, scenario, 260);
  const realRunner = record(true, scenario, 260);
  ok(Number(nullRunner.turns) >= 4, "the scenario produced combat cues");
  ok(plays(nullRunner.cues, "ui", "ready.wav").length >= 4);
  equal(plays(nullRunner.cues, "ui", "cant.wav").length, 1);
  deepEqual(realRunner.cues, nullRunner.cues, "equal cue streams");
  deepEqual(realRunner.hashes, nullRunner.hashes, "equal state hash on every tick");
  equal(realRunner.battle, nullRunner.battle);
  const again = record(false, scenario, 260);
  deepEqual(again.cues, nullRunner.cues, "the same seed repeats the same stream");
});

test("an active-battle save and load restarts the battle music once from the audio section and keeps audio out of BattleState", () => {
  const scenario: Scenario = { seed: 41, music: "battle.mid", ready: "ready.wav", boardMusic: "board.mid", script: 'game.on("battleEnded", (event) => { endedOutcome = event.detail.outcome })' };
  const live = cueRig(scenario);
  live.run(90);
  ok(live.state.battle !== null);
  const turnsAtSave = Number(global(live.state, "turns"));
  ok(turnsAtSave >= 1, "the fight was mid-way when it was saved");
  const music = voice(live.state, "music", 0);
  equal(music?.file, "media/battle.mid");

  const saved = snapshot(live.state);
  const projection = audioSaveProjection(live.state.audio, live.state.time.tick);
  const battleJson = JSON.stringify(live.state.battle);
  ok(!/audio|music|media|\.mid|\.wav/i.test(battleJson), `BattleState carries no audio: ${battleJson}`);
  deepEqual(projection.tracks.find((track) => track.name === "music")?.voices.map((entry) => entry.file), ["media/battle.mid"], "the music is in the audio section");

  const loaded = restoreRig(saved, scenario, projection);
  deepEqual(loaded.state.battle, live.state.battle, "BattleState restores from its own plain data");
  const restarts = plays(loaded.cues, "music", "battle.mid");
  equal(restarts.length, 1, "the battle music restarts exactly once at load");
  equal(restarts[0]?.tick, loaded.state.time.tick, "at the load tick");
  equal(restarts[0]?.positionTicks, 0, "from position zero");
  equal(restarts[0]?.loop, true);
  loaded.run(120);
  equal(plays(loaded.cues, "music").length, 1, "and is not restarted again as the fight resumes");
  ok(Number(global(loaded.state, "turns")) > turnsAtSave, "the restored battle thread kept fighting");
  equal(voice(loaded.state, "music", 0)?.file, "media/battle.mid");
  ok(hashGameState(loaded.state) !== hashGameState(live.state), "the restored battle has moved on from the save");

  const enemy = loaded.state.battle?.parties[0]?.[0]?.actorId;
  const hero = loaded.state.battle?.parties[1]?.[0]?.actorId;
  if (enemy === undefined || hero === undefined) throw new Error("the restored battle lost its fighters");
  loaded.services.actors.damage(enemy, 99, hero);
  loaded.run(8);
  equal(global(loaded.state, "endedoutcome"), 2, "the restored battle thread reaches its outcome and announces battleEnded");
  equal(plays(loaded.cues, "music").length, 1, "the outcome posts no music itself: the engine's board producer answers boardReturned");
});

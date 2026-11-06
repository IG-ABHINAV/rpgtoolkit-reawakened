// The audio runtime inside the real engine (ticket 6.6; docs/spec/engine/audio-media.md#board-effect-mapping and
// #audio-core-pins): board music and animation-frame sounds are posted as effect records, the applier asks the host
// for each audio file's bytes (a blocking AD-5 request) only to learn its length through the built-in decoders, and
// the cues reach `TickReport.audioCues`. The games are authored here from the format layouts (G7); the MIDI and WAV
// bytes are the authored files of ticket 6.4.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetKey, createActorService, createAssetIndex, createEmptyBoard, createEngine, createFxSection, PACKAGE_ROOT, writeBoard } from "../src/index.ts";
import type { AssetIndex, AssetKey, AudioCue, Diagnostic, Engine, EngineInit, FxSection, GameState, InputRecord, TickReport } from "../src/index.ts";
import { createDefaultVirtuals } from "../src/script/virtuals.ts";

const here = dirname(fileURLToPath(import.meta.url));
const authored = (name: string): Uint8Array => readFileSync(join(here, "fixtures", "audio", "files", name));

const TOWN_TICKS = 120; // midi0-480-default-tempo.mid
const CAVE_TICKS = 60; // midi0-96-tempo-change.mid
const STEP_TICKS = 30; // pcm8-mono-8000.wav

function boardBytes(music: string): Uint8Array {
  const empty = createEmptyBoard();
  const written = writeBoard({ ...empty, properties: { ...empty.properties, backgroundMusic: music } });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

type Game = { readonly files: Map<string, Uint8Array>; readonly index: AssetIndex };

/** A package of boards `a` to `e` (music: none, town, TOWN, cave, nowhere) and the files they name. */
function authorGame(extra: Readonly<Record<string, Uint8Array>> = {}, omit: readonly string[] = []): Game {
  const paths = new Map<string, Uint8Array>([
    ["Boards/a.brd", boardBytes("")],
    ["Boards/b.brd", boardBytes("town.mid")],
    ["Boards/c.brd", boardBytes("TOWN.MID")],
    ["Boards/d.brd", boardBytes("cave.mid")],
    ["Boards/e.brd", boardBytes("nowhere.mid")],
    ["Boards/f.brd", boardBytes("junk.mid")],
    ["Media/town.mid", authored("midi0-480-default-tempo.mid")],
    ["Media/cave.mid", authored("midi0-96-tempo-change.mid")],
    ["Media/step.wav", authored("pcm8-mono-8000.wav")],
    ["Media/junk.mid", new Uint8Array([0])],
    ...Object.entries(extra),
  ]);
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of paths) if (!omit.includes(path)) files.set(assetKey(path), bytes);
  return { files, index: createAssetIndex([...paths.keys()]) };
}

type Hosted = { readonly engine: Engine; readonly state: () => GameState };

function startEngine(game: Game, program: string, hook: (state: GameState) => void = () => undefined): Hosted {
  let latest: GameState | null = null;
  const init: EngineInit = {
    seed: 5,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    initialBoard: "a.brd",
    width: 32,
    height: 32,
    maxTicks: 600,
    program,
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; hook(state); } }],
  };
  return {
    engine: createEngine(init),
    state: () => {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
  };
}

type Run = { readonly report: TickReport; readonly cues: AudioCue[]; readonly diagnostics: Diagnostic[]; readonly requests: string[]; readonly stalls: string[][] };

/** Play the host: answer each asset request from `files` (nothing for a file that is absent) and advance `ticks`. */
function run(engine: Engine, files: Map<string, Uint8Array>, ticks: number, inputs: readonly InputRecord[] = []): Run {
  const cues: AudioCue[] = [];
  const diagnostics: Diagnostic[] = [];
  const requests: string[] = [];
  const stalls: string[][] = [];
  let remaining = ticks;
  let replies: InputRecord[] = [...inputs];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    remaining -= report.ticksRun;
    cues.push(...report.audioCues);
    diagnostics.push(...report.diagnostics);
    const asked = report.requests.flatMap((request) => (request.kind === "asset" ? [request.key] : []));
    requests.push(...asked);
    if (report.loading) {
      stalls.push(asked);
      replies = report.requests.flatMap((request) => (request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }] : []));
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) return { report, cues, diagnostics, requests, stalls };
  }
  throw new Error("the host loop did not settle");
}

const sends = (...boards: string[]): string => boards.map((board) => `sleep(3)\nsend("${board}.brd", 1, 1, 1)\n`).join("") + "end()\n";

const summary = (cues: readonly AudioCue[]): (string | number | boolean | null)[][] => cues.map((cue) => [cue.cueId, cue.kind, cue.track, cue.voice, cue.asset, cue.loop, cue.positionTicks]);

test("board music reaches the audio track: the start bank, a play, a carry-on, a replacement and a silence", () => {
  const game = authorGame();
  const host = startEngine(game, sends("b", "c", "d", "e"));
  const result = run(host.engine, game.files, 40);
  deepEqual(result.diagnostics, [], "a missing board music file is silence, never an error (Q6)");
  deepEqual(summary(result.cues), [
    [1, "soundfont.set", null, null, null, null, null],
    [2, "media.play", "music", 0, "media/town.mid", true, 0],
    // Board c names the same file in another letter case while it plays: the applier carries on, no cue.
    [3, "media.stop", "music", 0, null, null, null],
    [4, "media.play", "music", 0, "media/cave.mid", true, 0],
    // Board e names a file that is not in the game: silence, the music file is cleared.
    [5, "media.stop", "music", 0, null, null, null],
  ]);
  const music = host.state().audio.tracks[0]!;
  deepEqual([music.state, music.file, music.voices.length, music.flags], ["stopped", null, 0, 1]);
  equal(createDefaultVirtuals(host.state(), createActorService(host.state().actors)).read("music"), "");
  ok(!result.requests.includes("media/nowhere.mid"), "a name the index does not hold is never requested");
  equal(host.state().engine.pendingEffects?.audio?.length ?? 0, 0, "the engine does not queue what the applier applies");
});

test("the music virtual and the track hold the file and its decoded length while it plays", () => {
  const game = authorGame();
  const host = startEngine(game, sends("b", "d"));
  const result = run(host.engine, game.files, 14);
  const music = host.state().audio.tracks[0]!;
  deepEqual([music.state, music.file, music.lengthTicks, music.flags], ["playing", "media/cave.mid", CAVE_TICKS, 1]);
  const voice = music.voices[0]!;
  deepEqual([voice.loop, voice.lengthTicks, voice.endTick, voice.cueId], [true, CAVE_TICKS, null, 4]);
  equal(createDefaultVirtuals(host.state(), createActorService(host.state().actors)).read("music"), "media/cave.mid");
  deepEqual(result.requests.filter((key) => key.startsWith("media/")), ["media/town.mid", "media/cave.mid"], "each file is asked for once and then known");
});

test("a play waits for the audio file's bytes: the world stalls on the blocking request and the cue follows the reply", () => {
  const game = authorGame();
  const host = startEngine(game, sends("b"));
  const result = run(host.engine, game.files, 12);
  deepEqual(result.stalls.map((keys) => keys.filter((key) => key.startsWith("media/"))).filter((keys) => keys.length > 0), [["media/town.mid"]]);
  const play = result.cues.find((cue) => cue.kind === "media.play");
  equal(play?.asset, "media/town.mid");
  const music = host.state().audio.tracks[0]!;
  equal(music.voices[0]?.lengthTicks, TOWN_TICKS);
  equal(music.voices[0]?.startTick, play?.tick, "the voice starts at the tick the cue names");
});

test("a file no decoder accepts plays with an unknown length and one asset-format diagnostic; a reply with no bytes does too", () => {
  const game = authorGame();
  const junk = startEngine(game, sends("f"));
  const first = run(junk.engine, game.files, 10);
  deepEqual(first.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.file]), [["media.asset-format", "media/junk.mid"]]);
  deepEqual(summary(first.cues), [[1, "soundfont.set", null, null, null, null, null], [2, "media.play", "music", 0, "media/junk.mid", true, 0]]);
  equal(junk.state().audio.tracks[0]?.lengthTicks, null);

  const missing = authorGame({}, ["Media/town.mid"]);
  const gone = startEngine(missing, sends("b"));
  const second = run(gone.engine, missing.files, 10);
  deepEqual(second.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.file]), [["asset.missing", "media/town.mid"], ["media.asset-format", "media/town.mid"]]);
  equal(second.report.loading, false, "an audio file that cannot be fetched is not a boot failure");
  equal(gone.state().audio.tracks[0]?.file, "media/town.mid");
  ok(second.report.ticksRun > 0 || gone.state().time.tick > 0, "the game goes on ticking");
});

test("sample-game replay is invariant under 1-, 5- and 20-tick advance batching", () => {
  const game = authorGame({ "Boards/a.brd": boardBytes("town.mid") });
  const program = 'sleep(3)\nwav("step.wav")\nsleep(60)\nend()\n';
  const runBatches = (batch: number): { readonly cues: AudioCue[]; readonly report: TickReport } => {
    const host = startEngine(game, program);
    const cues: AudioCue[] = run(host.engine, game.files, 0).cues;
    let remaining = 60;
    const endTick = host.engine.advance(0, []).tickAfter + remaining;
    let last: TickReport | null = null;
    while (remaining > 0) {
      const result = run(host.engine, game.files, Math.min(batch, remaining));
      cues.push(...result.cues);
      remaining = endTick - result.report.tickAfter;
      last = result.report;
    }
    if (last === null) throw new Error(`batch ${batch} did not run`);
    return { cues, report: host.engine.advance(0, []) };
  };
  const one = runBatches(1);
  const five = runBatches(5);
  const twenty = runBatches(20);
  deepEqual(five.cues, one.cues, "five-tick batches preserve the cue stream");
  deepEqual(twenty.cues, one.cues, "twenty-tick batches preserve the cue stream");
  equal(five.report.stateHash, one.report.stateHash, "five-tick batches preserve the final state hash");
  equal(twenty.report.stateHash, one.report.stateHash, "twenty-tick batches preserve the final state hash");
});

test("an animation frame's sound is an sfx cue after the length is learned, and it ends on its end tick", () => {
  const game = authorGame();
  const host = startEngine(game, "sleep(100)\nend()\n", (state) => {
    const fx: Partial<FxSection> = state.fx;
    if (state.time.tick !== 2 || fx.animations !== undefined) return;
    state.fx = createFxSection();
    state.fx.nextAnimationId = 2;
    state.fx.animations.push({
      id: 1,
      file: "spark.anm",
      asset: assetKey("Animations/spark.anm"),
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      loop: false,
      originTick: 3,
      delayTicks: 100,
      frame: 0,
      frames: [{ image: "a.bmp", asset: null, tile: null, srcWidth: 8, srcHeight: 6, transparent: { r: 0, g: 0, b: 0 }, sound: "step.wav" }],
      loaded: true,
      finished: false,
      preparation: null,
      soundFrame: -1,
    });
  });
  const result = run(host.engine, game.files, 50);
  const plays = result.cues.filter((cue) => cue.kind === "media.play");
  deepEqual(plays.map((cue) => [cue.track, cue.asset, cue.loop, cue.flags, cue.positionTicks, cue.volume]), [["sfx", "media/step.wav", false, 0, 0, 100]]);
  const stop = result.cues.find((cue) => cue.kind === "media.stop");
  equal(stop?.track, "sfx");
  equal((stop?.tick ?? 0) - (plays[0]?.tick ?? 0), STEP_TICKS, "the one-shot ends STEP_TICKS ticks after it started");
  equal(host.state().audio.tracks[1]?.file, "media/step.wav", "stop keeps the file");
  equal(host.state().audio.tracks[1]?.state, "stopped");
});

test("reset() leaves the audio section, its script settings and the playing music untouched", () => {
  const game = authorGame();
  const host = startEngine(game, 'sleep(3)\nsend("b.brd", 1, 1, 1)\nsleep(10)\nreset()\nend()\n', (state) => {
    if (state.time.tick === 5) {
      state.audio.settings.masterVolume = 40;
      state.audio.soundFont = "media/boss.sf2" as AssetKey;
      state.battle = { id: 1, boardKey: "boards/a.brd", background: "fight.bkg", canRun: true, outcome: null, parties: [[], []] };
    }
  });
  const before = run(host.engine, game.files, 8);
  const voiceBefore = JSON.stringify(host.state().audio.tracks[0]?.voices);
  const cueIdBefore = host.state().audio.cueId;
  const after = run(host.engine, game.files, 30);
  equal(host.state().vm.threads.length, 0, "the reset dropped the program: the lifecycle did run");
  equal(host.state().battle, null, "reset clears the active battle section");
  equal(host.state().audio.settings.masterVolume, 40);
  equal(host.state().audio.soundFont, "media/boss.sf2");
  equal(host.state().audio.tracks[0]?.state, "playing");
  equal(host.state().audio.tracks[0]?.file, "media/town.mid");
  equal(JSON.stringify(host.state().audio.tracks[0]?.voices.map((voice) => voice.cueId)), JSON.stringify(JSON.parse(voiceBefore).map((voice: { cueId: number }) => voice.cueId)));
  equal(host.state().audio.cueId, cueIdBefore, "no cue was re-emitted");
  deepEqual(after.cues, [], "a reset emits no audio cue");
  ok(before.cues.some((cue) => cue.kind === "media.play"));
});

test("the state hash in the tick report ignores the script volume settings", () => {
  const game = authorGame();
  const quiet = startEngine(game, sends("b"));
  const loud = startEngine(game, sends("b"), (state) => { state.audio.settings.masterVolume = 10; });
  const first = run(quiet.engine, game.files, 20);
  const second = run(loud.engine, game.files, 20);
  equal(first.report.stateHash, second.report.stateHash);
  equal(loud.state().audio.settings.masterVolume, 10);
});

test("an author default SoundFont that the index does not hold is reported once and treated as none", () => {
  const game = authorGame({ "Media/town.sf2": new Uint8Array([1]) });
  const bad = createEngine({ seed: 1, assetIndex: game.index, assetRoot: PACKAGE_ROOT, initialBoard: "a.brd", width: 32, height: 32, maxTicks: 10, defaultSoundFont: assetKey("Media/nope.sf2"), program: "end()\n" });
  const first = run(bad, game.files, 3);
  deepEqual(first.diagnostics.filter((diagnostic) => diagnostic.code === "media.soundfont-missing").map((diagnostic) => diagnostic.file), ["media/nope.sf2"]);
  deepEqual(first.cues.map((cue) => [cue.kind, cue.asset]), [["soundfont.set", null]]);
  const good = createEngine({ seed: 1, assetIndex: game.index, assetRoot: PACKAGE_ROOT, initialBoard: "a.brd", width: 32, height: 32, maxTicks: 10, defaultSoundFont: assetKey("Media/town.sf2"), program: "end()\n" });
  const second = run(good, game.files, 3);
  deepEqual(second.diagnostics.filter((diagnostic) => diagnostic.code === "media.soundfont-missing"), []);
  deepEqual(second.cues.map((cue) => [cue.kind, cue.asset]), [["soundfont.set", "media/town.sf2"]]);
});

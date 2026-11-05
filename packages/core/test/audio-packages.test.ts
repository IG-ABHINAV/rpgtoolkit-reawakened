// Pure-RPGCode media packages pinned through the real engine (epic 21, entry 21.7;
// MEDIA-1, MEDIA-2, MEDIA-3, docs/spec/engine/audio-media.md).
//
// The three packages under `fixtures/media/` are written in RPGCode only and load by
// name from the main file's package list, which is the case Epic 21 exists for:
//
//   * `ducking.prg`   - fades `music` to 40 while any voice on `ui` plays;
//   * `stems.prg`     - starts the next ambient layer when the current one ends;
//   * `region-music.prg` - rewrites board-started music to the region theme.
//
// Each scenario runs deterministically from a seed, restores to the same state at
// every tick, and pins its audio consequences. Re-record only state hashes with
// MEDIA_PACKAGES_GOLDEN_RECORD=1 node --test packages/core/test/audio-packages.test.ts.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  hashGameState,
  fnv1a64,
  IR_VERSION,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  startThread,
  writeBoard,
  writeMainFile,
  type AssetRoot,
  type AudioCue,
  type Engine,
  type GameState,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const encoder = new TextEncoder();
/** One authored 30-tick one-shot: 8000 Hz mono PCM, 8-bit. */
const step = new Uint8Array(readFileSync(join(here, "fixtures", "audio", "files", "pcm8-mono-8000.wav")));
/** A minimal format-0 MIDI file: one tempo event and an end-of-track. */
const theme = new Uint8Array(readFileSync(join(here, "fixtures", "audio", "files", "midi0-480-default-tempo.mid")));

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** The loader's own source hash for an authored program (`fnv1a64` over its bytes). */
function sourceHashOf(text: string): string {
  return fnv1a64(encoder.encode(text));
}

/** The RPGCode source of one authored media package. */
function packageSource(name: string): string {
  return readFileSync(join(here, "fixtures", "media", `${name}.prg`), "utf8");
}

/** A `PackageCatalogueEntry` whose start-up program is the authored RPGCode itself: no TypeScript anywhere. */
const PACKAGE_FILES: Readonly<Record<string, string>> = {
  ducking: "ducking",
  stems: "stems",
  region_music: "region-music",
};

function mediaPackage(name: string): PackageCatalogueEntry {
  return {
    name,
    version: "1.0",
    namespace: name,
    requests: ["asset"],
    definition: { id: name, version: "1.0", commands: [] },
    startup: {
      kind: "file",
      path: assetKey(`Prg/${PACKAGE_FILES[name] ?? name}.prg`),
      sourceHash: sourceHashOf(packageSource(PACKAGE_FILES[name] ?? name)),
      ir: IR_VERSION,
      dialect: "tk3",
    },
  };
}

type Fixture = { readonly files: Map<string, Uint8Array>; readonly paths: string[]; readonly root: AssetRoot };

/** A package-rooted game whose board names `theme.mid`, with the three media packages listed in the main file. */
function authoredGame(packages: readonly string[]): Fixture {
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    packagePlugins: packages,
  };
  const files = new Map<string, Uint8Array>();
  const paths: string[] = ["main.gam"];
  const add = (path: string, bytes: Uint8Array): void => {
    paths.push(path);
    files.set(assetKey(path), bytes);
  };
  add("main.gam", unwrap(writeMainFile(main)));
  const empty = createEmptyBoard();
  add("Boards/start.brd", unwrap(writeBoard({
    ...empty,
    properties: { ...empty.properties, backgroundMusic: "theme.mid", start: { x: 64, y: 64, layer: 1 } },
  })));
  add("Prg/start.prg", encoder.encode("end()\n"));
  for (const name of ["ducking", "stems", "region_music"]) add(`Prg/${PACKAGE_FILES[name]}.prg`, encoder.encode(packageSource(PACKAGE_FILES[name] ?? name)));
  add("Media/theme.mid", new Uint8Array(theme));
  add("Media/region.mid", new Uint8Array(theme));
  for (const name of ["stem1", "stem2", "stem3", "door"]) add(`Media/${name}.wav`, new Uint8Array(step));
  return { files, paths, root: PACKAGE_ROOT };
}

type Run = {
  readonly cues: readonly AudioCue[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  /** The state hash at the end of every tick. */
  readonly hashes: readonly string[];
  /** The saved state hash after a restore at every tick. */
  readonly restored: readonly string[];
  readonly state: GameState;
};

type Scenario = {
  readonly packages: readonly string[];
  readonly ticks: number;
  /** Program started on the board's first running tick; it may play sounds or start listeners itself. */
  readonly script?: string;
};

const RUNNING = (state: GameState): boolean => state.engine.boot?.stage === "running";

/** Host the game for `ticks` ticks, answering assets, and record cues, hashes and a restore at every tick. */
function play(scenario: Scenario): Run {
  const fixture = authoredGame(scenario.packages);
  let latest: GameState | null = null;
  const cues: AudioCue[] = [];
  const hashes: string[] = [];
  const restored: string[] = [];
  const diagnostics: { code: string; message: string }[] = [];
  const engine: Engine = createEngine({
    seed: 31,
    assetIndex: createAssetIndex(fixture.paths),
    assetRoot: fixture.root,
    mainFile: "main.gam",
    gameIdentity: "media-packages-test",
    width: 320,
    height: 240,
    maxTicks: scenario.ticks + 200,
    packageCatalogue: scenario.packages.map((name) => mediaPackage(name)),
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (scenario.script !== undefined && RUNNING(state) && state.vm.globals["scripted"] === undefined) {
          state.vm.globals["scripted"] = 1;
          startThread(state.vm, { ref: { kind: "inline", text: scenario.script, ir: IR_VERSION, dialect: "tk3" }, kind: "board", owner: "script" });
        }
      },
    }],
  });
  let replies: InputRecord[] = [];
  for (let tick = 0; tick < scenario.ticks; tick += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: fixture.files.get(request.key) ?? null } });
      }
    }
    for (const cue of report.audioCues) cues.push(cue);
    for (const diagnostic of report.diagnostics) diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
    const state = latest as GameState | null;
    if (state === null) continue;
    // The live hash of the tick (the engine reports the same value) against the hash of
    // restoring that same state: a lossy restore moves only the second one.
    hashes.push(report.stateHash);
    restored.push(hashGameState(restoreGameState(snapshot(state))));
  }
  const state = latest as GameState | null;
  if (state === null) throw new Error(`the game never reached a running tick: ${JSON.stringify(diagnostics.slice(0, 6))}`);
  return { cues, diagnostics, hashes, restored, state };
}

type Golden = { readonly id: string; readonly finalHash: string; readonly ticks: readonly string[] };

/** The pinned audio-package golden; a malformed row is a hard error, never a silent miss. */
function readGolden(): Golden {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, "golden", "audio", "media-packages.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("golden/audio/media-packages.json: root must be an object");
  const row: Record<string, unknown> = parsed as Record<string, unknown>;
  if (typeof row["id"] !== "string" || typeof row["finalHash"] !== "string" || !Array.isArray(row["ticks"]) || !row["ticks"].every((tick: unknown) => typeof tick === "string")) {
    throw new Error("golden/audio/media-packages.json: needs string id and finalHash and a string ticks array");
  }
  return { id: row["id"], finalHash: row["finalHash"], ticks: row["ticks"] as readonly string[] };
}

/** The music track's script volume after its fades (the audio owner's per-track setting). */
function musicVolume(state: GameState): number {
  return state.audio.settings.trackVolumes.find((entry) => entry.name === "music")?.volume ?? 100;
}

test("the three authored packages load by name and reap the audio consequence each one names", () => {
  const run = play({
    packages: ["ducking", "stems", "region_music"],
    ticks: 130,
    script: 'mediaPlay("media/door.wav", { track: "ui", loop: false })\nmediaPlay("media/stem1.wav", { track: "ambience", loop: false })\nend()\n',
  });
  const plays = run.cues.filter((cue) => cue.kind === "media.play");
  // Region music rewrote the board's start before it played: the cue carries the
  // region file and the board's own file never starts.
  deepEqual(plays[0] === undefined ? [] : [plays[0].track, plays[0].asset], ["music", assetKey("media/region.mid")], "the board start plays the region theme");
  ok(plays.every((cue) => cue.asset !== assetKey("media/theme.mid")), "the board file never plays once the package rewrites it");

  // Ducking faded the music while the ui voice was alive and released it after.
  const musicFades = run.cues.filter((cue) => cue.kind === "media.fade" && cue.track === "music").map((cue) => cue.targetVolume);
  deepEqual(musicFades, [40, 100], "the ui voice ducks the music to 40 and releases it to 100");
  equal(musicVolume(run.state), 100, "the music is back at full volume after the ui voice ended");

  // Stems chained the ambience layers on `ended`.
  const ambience = plays.filter((cue) => cue.track === "ambience").map((cue) => cue.asset);
  deepEqual(ambience, [assetKey("media/stem1.wav"), assetKey("media/stem2.wav"), assetKey("media/stem3.wav")], "each layer ended into the next");
});

test("the pinned golden records the package scenario's per-tick hashes", () => {
  const run = play({ packages: ["ducking", "stems", "region_music"], ticks: 130, script: 'mediaPlay("media/door.wav", { track: "ui", loop: false })\nmediaPlay("media/stem1.wav", { track: "ambience", loop: false })\nend()\n' });
  const actual = { id: "ducking-stems-region", finalHash: run.hashes[run.hashes.length - 1]!, ticks: run.hashes };
  if (process.env["MEDIA_PACKAGES_GOLDEN_RECORD"] === "1") {
    writeFileSync(join(repoRoot, "golden", "audio", "media-packages.json"), `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const golden = readGolden();
  deepEqual({ id: golden.id, finalHash: golden.finalHash, ticks: golden.ticks }, actual, "the pinned per-tick hashes match the committed golden");
});

test("the package scenario replays to the same hashes, and a save at every tick restores to them", () => {
  const script = 'mediaPlay("media/door.wav", { track: "ui", loop: false })\nmediaPlay("media/stem1.wav", { track: "ambience", loop: false })\nend()\n';
  const first = play({ packages: ["ducking", "stems", "region_music"], ticks: 130, script });
  const second = play({ packages: ["ducking", "stems", "region_music"], ticks: 130, script });
  deepEqual(first.hashes, second.hashes, "the same seed and script produce the same per-tick hashes");
  deepEqual(first.hashes, first.restored, "a save at every tick restores to that tick's hash");
});

test("a board without the packages keeps the board's own music and unchanged 3.1 playback", () => {
  const run = play({ packages: [], ticks: 10 });
  const plays = run.cues.filter((cue) => cue.kind === "media.play");
  deepEqual(plays.map((cue) => [cue.track, cue.asset]), [["music", assetKey("media/theme.mid")]], "without the package the board file plays as authored");
});

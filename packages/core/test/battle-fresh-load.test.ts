// A mid-battle save loaded into a brand-new engine (review of #702, finding 1): the saved pinned stance animations are
// restored already loaded, so the brand-new engine holds none of their picture files. It must ask the host for them,
// keep each animation's saved frame and origin tick, and never draw a frame whose picture it does not have.
// The save is the real thing: the engine's own `Save` request issued by a script during the fight.
//
// The same walk is the save/resume lifecycle evidence of docs/spec/engine/battle.md#bat-13: the run that continues
// without saving and the run loaded through the game's own `Load` path must reach the same ticks with the same state
// hash. The save holds no active audio, because active music deliberately restarts at position zero on load
// (docs/spec/engine/audio-media.md#audio-save-load) and the two runs would then diverge by contract.
// The last test is the reset half of that lifecycle: `reset()` during a live battle clears the battle and the script
// that was fighting it.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  IR_VERSION,
  createAssetIndex,
  createEngine,
  createSurfacesSection,
  fnv1a64,
  frameAt,
  hashGameState,
  PACKAGE_ROOT,
  startThread,
  type Engine,
  type GameState,
  type InputRecord,
  type PackageCatalogueEntry,
  type TickReport,
} from "../src/index.ts";
import { bootUiRig, gameFiles, SCREEN_HEIGHT, SCREEN_WIDTH, type UiRig } from "./battle-ui-rig.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const encoder = new TextEncoder();
const RIG = { stanceDelayTicks: 3 } as const;

/** The fight program: the first turn saves the game, then the stock battle screen takes the turn as usual. */
const FIGHT = [
  "saveTurn = stockBattle.turn",
  "saved = 0",
  "stockBattle.turn = (party, index) => {",
  "  if (saved == 0) {",
  "    saved = 1",
  '    Save("slot")',
  "  }",
  "  return saveTurn(party, index)",
  "}",
  'fightenemy("slime", "bat", "slime", "meadow")',
  "afterfight = 1",
  "end()",
].join("\n");

type SavedAnimation = {
  readonly id: number;
  readonly pinned?: true;
  readonly loaded: boolean;
  readonly finished: boolean;
  readonly loop: boolean;
  readonly originTick: number;
  readonly delayTicks: number;
  readonly frame: number;
  readonly frames: readonly { readonly asset: string | null; readonly surface?: number }[];
};
type SavedTrack = { readonly name: string; readonly state: string; readonly voices: readonly unknown[] };
type SavedGame = {
  readonly time: { readonly tick: number };
  readonly battle: { readonly outcome: number | null } | null;
  readonly fx: { readonly animations: readonly SavedAnimation[] };
  readonly audio: { readonly tracks: readonly SavedTrack[] };
};

type Saved = { readonly bytes: Uint8Array; readonly tick: number; readonly game: SavedGame };

/** The engine's state hash at one tick: the same value `advance` reports and a snapshot reproduces. */
type HashPoint = { readonly tick: number; readonly hash: string };

type SavedRun = { readonly rig: UiRig; readonly saved: Saved };

/** Play a battle rig until the script's `Save` reaches the host, answering it so the fight carries on. */
function saveMidBattle(): SavedRun {
  const rig = bootUiRig(RIG);
  rig.files.set(assetKey("prg/fight.prg"), encoder.encode(FIGHT));
  const engine = rig.engine as { advance: Engine["advance"] };
  const advance = engine.advance.bind(engine);
  let answers: InputRecord[] = [];
  let saved: Saved | null = null;
  engine.advance = (ticks, inputs, ...rest) => {
    const report = advance(ticks, [...answers, ...inputs], ...rest);
    answers = [];
    for (const request of report.requests) {
      if (request.kind !== "saveBlob") continue;
      const bytes = new Uint8Array(request.bytes);
      saved = { bytes, tick: report.tickAfter, game: JSON.parse(new TextDecoder().decode(bytes)) as SavedGame };
      answers.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
    }
    return report;
  };
  rig.until(() => saved !== null, 3000);
  ok(saved !== null, "the fight's script saved the game");
  return { rig, saved: saved as Saved };
}

type FreshHost = {
  readonly engine: Engine;
  readonly diagnostics: { readonly code: string; readonly message: string }[];
  readonly requested: string[];
  readonly hashes: HashPoint[];
  state(): GameState;
  /** One tick (or none while the host still owes the engine an asset), answering what the engine asks for. */
  step(): void;
  frame(): string;
};

function catalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(folder, manifest.program), "utf8"), ir: "1", dialect: "tk3" },
  }];
}

/** A brand-new engine on the same game whose start-up program loads the save: nothing of the saved run is cached. */
function freshLoad(saved: Uint8Array): FreshHost {
  const game = gameFiles(RIG);
  game.files.set(assetKey("prg/start.prg"), encoder.encode('load("slot")\nend()\n'));
  game.files.set(assetKey("prg/fight.prg"), encoder.encode(FIGHT));
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 291,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-ui-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    maxTicks: 100000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")))]]),
    packageCatalogue: catalogue(),
    phaseRegistrations: [{ phase: "triggers", run: (state) => { latest = state; } }],
  });
  const diagnostics: { code: string; message: string }[] = [];
  const requested: string[] = [];
  const hashes: HashPoint[] = [];
  let replies: InputRecord[] = [];
  const host: FreshHost = {
    engine,
    diagnostics,
    requested,
    hashes,
    state() {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
    step() {
      const report = engine.advance(1, replies);
      replies = [];
      diagnostics.push(...report.diagnostics);
      if (report.ticksRun > 0) hashes.push({ tick: report.tickAfter, hash: report.stateHash });
      for (const request of report.requests) {
        if (request.kind === "asset") {
          requested.push(request.key);
          replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
        } else if (request.kind === "loadBlob") {
          replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: new Uint8Array(saved) } });
        } else if (request.kind === "saveBlob") {
          replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
        }
      }
    },
    frame() {
      engine.surfacePixels(0 as never, -1);
      const surface = engine.surfacePixels(0 as never, host.state().surfaces.entries["0"]!.rev);
      if (surface === null) throw new Error("the frame is not readable");
      return fnv1a64(surface.rgba);
    },
  };
  return host;
}

/** Step the host until the save has been applied and the engine ticks again at `tick`. */
function runUntilTick(host: FreshHost, tick: number): void {
  for (let guard = 0; guard < 400; guard += 1) {
    if (host.hashes.length > 0 && host.state().time.tick >= tick) return;
    host.step();
  }
  throw new Error(`the engine did not reach tick ${tick}: ${JSON.stringify(host.diagnostics)}`);
}

function pinned(animations: readonly SavedAnimation[]): readonly SavedAnimation[] {
  return animations.filter((animation) => animation.pinned === true);
}

/** The threads still running, or parked, inside the game's fight program: a live battle's continuation. */
function fightThreads(state: GameState): readonly number[] {
  const fighting = state.vm.threads.filter((thread) => thread.frames.some((frame) => frame.program.kind === "file" && frame.program.path.toLowerCase().endsWith("fight.prg")));
  return fighting.map((thread) => thread.id);
}

/**
 * Everything a battle owns, as one state hash, for comparing a run with a loaded copy of itself
 * (docs/spec/engine/battle.md#bat-13). Three host-side things a load moves are pinned out, and nothing else is: the
 * host request-id counter and its outstanding requests, because a restored engine holds none of the pictures its state
 * names and re-requests them (that is what this whole file tests), spending ids the uninterrupted run never spent; the
 * audio cue counter, which a load keeps at the greater of the live and saved values
 * (docs/spec/engine/audio-media.md#audio-save-load); and the script canvases, because a canvas the restored engine
 * redraws from a re-fetched picture keeps different stale pixels off-screen — the composed frame is compared instead,
 * pixel for pixel, at the same ticks. Fighters, charge, actors, party, inventory, triggers, world, sprites, VM threads
 * and globals, ui, fx, events, RNG and time are all in the compared hash.
 */
function battleStateHash(state: GameState): string {
  return hashGameState({
    ...state,
    surfaces: createSurfacesSection(SCREEN_WIDTH, SCREEN_HEIGHT),
    engine: { ...state.engine, nextRequestId: 0, pending: [] },
    audio: { ...state.audio, cueId: 0 },
  });
}

test("the save holds loaded, pinned stance animations and no picture surfaces", () => {
  const { saved } = saveMidBattle();
  ok(saved.game.battle !== null && saved.game.battle.outcome === null, "the save is mid-battle");
  const stances = pinned(saved.game.fx.animations);
  ok(stances.length >= 3, "the fighters' stances are pinned animations");
  for (const animation of stances) {
    ok(animation.loaded && !animation.finished);
    ok(animation.frames.length === 2, "two authored frames per stance");
    ok(animation.frames.every((frame) => frame.asset !== null && frame.surface === undefined), "frames are pictures, not saved surfaces");
  }
});

test("a mid-battle save loaded into a brand-new engine asks for the animation pictures, draws the saved frames and keeps the saved run's state", () => {
  const { rig, saved } = saveMidBattle();
  const stances = pinned(saved.game.fx.animations);
  // The mandated music restart (audio-media.md#audio-save-load) makes a save taken with a voice playing a
  // deliberately different playthrough, so the hash comparison below is made with silent playback: the save, the
  // uninterrupted run and the loaded run then project the same ticks. #691 owns the restart rule itself.
  deepEqual(
    saved.game.audio.tracks.filter((track) => track.state !== "stopped" || track.voices.length > 0).map((track) => track.name),
    [],
    "no audio track is playing at the save",
  );
  const host = freshLoad(saved.bytes);
  runUntilTick(host, saved.tick + 1);

  // Every picture of every restored animation was asked for, with the saved timeline untouched.
  const wanted = new Set(stances.flatMap((animation) => animation.frames.map((frame) => frame.asset as string)));
  for (const asset of wanted) ok(host.requested.includes(asset), `the picture ${asset} was requested`);
  const restored = pinned(host.state().fx.animations as unknown as readonly SavedAnimation[]);
  deepEqual(restored.map((animation) => animation.id), stances.map((animation) => animation.id));
  for (const [index, animation] of restored.entries()) {
    const was = stances[index]!;
    equal(animation.originTick, was.originTick, "the origin tick is the saved one");
    ok(animation.loaded, "the animation is still loaded");
    equal(animation.frame, frameAt(was.originTick, host.state().time.tick - 1, was.delayTicks, was.frames.length, was.loop), "the frame follows the saved origin (the animation phase runs before the tick advances)");
  }

  // The loaded battle draws exactly what the saved run draws, tick for tick, and everything the battle owns is the
  // same state.
  // Comparison starts one tick after the save: the saving thread's wait is live in the uninterrupted run and already
  // resumed in the file, so only the ticks after the save are expected to agree.
  const seen = new Set<string>();
  for (let step = 0; step < 12; step += 1) {
    const tick = host.state().time.tick;
    while (rig.state().time.tick < tick) rig.tick(1);
    equal(rig.state().time.tick, tick, "the saved run is on the same tick");
    const frame = host.frame();
    equal(frame, fnv1a64(rig.frame().rgba), `the frame at tick ${tick} matches the saved run`);
    seen.add(frame);
    const point = host.hashes.at(-1);
    ok(point !== undefined && point.tick === tick, `the loaded run hashed tick ${tick}`);
    equal(battleStateHash(host.state()), battleStateHash(rig.state()), `the battle state at tick ${tick} matches the uninterrupted run`);
    host.step();
  }
  ok(seen.size >= 2, "the stance pictures change between ticks, so the comparison sees the frame clock");
  deepEqual(host.diagnostics.filter((entry) => entry.code === "render.failed"), []);
  deepEqual(host.diagnostics.map((entry) => entry.code), []);
});


test("a frame drawn while the animation pictures are still on their way is not a render failure", () => {
  const { saved } = saveMidBattle();
  const host = freshLoad(saved.bytes);
  for (let guard = 0; guard < 400 && !host.requested.includes("bitmap/slime_rest.png"); guard += 1) host.step();
  ok(host.requested.includes("bitmap/slime_rest.png"), "the engine asked for a stance picture");
  host.frame();
  deepEqual(host.diagnostics.filter((entry) => entry.code === "render.failed"), [], "the host drew before it answered");
  runUntilTick(host, saved.tick + 1);
  host.frame();
  deepEqual(host.diagnostics, []);
});

test("two brand-new engines loading the same mid-battle save run the same state hashes", () => {
  const { saved } = saveMidBattle();
  const first = freshLoad(saved.bytes);
  const second = freshLoad(saved.bytes);
  runUntilTick(first, saved.tick + 30);
  runUntilTick(second, saved.tick + 30);
  first.frame();
  deepEqual(first.hashes, second.hashes);
  ok(first.hashes.length >= 30);
  deepEqual(first.diagnostics, []);
});

test("the battle rig counts simulated ticks, not asset-loading advances", () => {
  const rig = bootUiRig(RIG);
  const engine = rig.engine as { advance: Engine["advance"] };
  const advance = engine.advance.bind(engine);
  const reports: TickReport[] = [];
  engine.advance = (ticks, inputs, ...rest) => {
    const report = advance(ticks, inputs, ...rest);
    reports.push(report);
    return report;
  };
  rig.tick(1);
  ok(reports.some((report) => report.ticksRun === 0 && report.requests.some((request) => request.kind === "asset")), "the real engine stalled for an asset");
  equal(reports.reduce((sum, report) => sum + report.ticksRun, 0), 1, "one tick actually ran after the host answered");
});

test("the battle rig completes a partially run engine batch", () => {
  const rig = bootUiRig(RIG);
  const engine = rig.engine as { advance: Engine["advance"] };
  const advance = engine.advance.bind(engine);
  const reports: { requested: number; ran: number }[] = [];
  engine.advance = (ticks, inputs, ...rest) => {
    const report = advance(ticks, inputs, ...rest);
    reports.push({ requested: ticks, ran: report.ticksRun });
    return report;
  };
  let partial = false;
  for (let attempt = 0; attempt < 20 && !partial; attempt += 1) {
    const start = reports.length;
    rig.tick(8);
    const batch = reports.slice(start);
    equal(batch.reduce((sum, report) => sum + report.ran, 0), 8, "each call runs all eight requested ticks");
    partial = batch.some((report) => report.ran > 0 && report.ran < report.requested);
  }
  ok(partial, "the real engine reported a positive partial batch");
});

test("the battle rig fails on an endless asset request cycle", () => {
  const rig = bootUiRig(RIG);
  const engine = rig.engine as { advance: Engine["advance"] };
  const stalled = engine.advance(1, []);
  equal(stalled.ticksRun, 0);
  ok(stalled.requests.some((request) => request.kind === "asset"));
  let attempts = 0;
  engine.advance = () => { attempts += 1; return stalled; };
  throws(() => rig.tick(1), /battle UI rig could not advance after repeated asset replies/);
  ok(attempts <= 1025, "the request cycle is bounded");
});

// docs/spec/engine/battle.md#bat-13: `reset()` closes an active battle. The stock battle loop, its screen, the pinned
// stance animations and the game's own fight program are all live when a script calls it, so this proves the battle
// section and that continuation are both gone, not just the section (docs/spec/engine/main-loop-and-startup.md#reawakened-reset-sections).
test("resetting during a live battle clears the battle and the fight program that was running it", () => {
  const rig = bootUiRig(RIG);
  // Wait until the screen really is drawing the fight: a live battle, not just a started one.
  rig.until((state) => state.battle !== null && (("animations" in state.fx ? state.fx.animations : []).some((animation) => animation.pinned === true)), 400);
  const live = rig.state();
  ok(live.battle !== null && live.battle.outcome === null, "the fight is live");
  equal(rig.charges().length, 2, "both parties are in the fight");
  equal(fightThreads(live).length, 1, "the game's fight program is parked inside the battle");

  // A script calls `reset()` the way a game program does; the call posts the engine's lifecycle reset.
  startThread(live.vm, { ref: { kind: "inline", text: "reset()\nend()", ir: IR_VERSION }, kind: "persistent", owner: "script" });

  for (let step = 0; step < 5; step += 1) {
    rig.tick(1);
    const state = rig.state();
    equal(state.battle, null, "the battle is gone");
    deepEqual(fightThreads(state), [], "nothing of the fight program continues");
    const animations = "animations" in state.fx ? state.fx.animations : [];
    equal(animations.filter((animation) => animation.pinned === true).length, 0, "no pinned stance animation survives");
    deepEqual(rig.diagnostics, []);
  }
});

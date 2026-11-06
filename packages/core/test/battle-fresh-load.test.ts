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
import { deepEqual, equal, ok } from "node:assert/strict";
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
  writeAnimation,
  type Engine,
  type GameState,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";
import { bootUiRig, gameFiles, SCREEN_HEIGHT, SCREEN_WIDTH, type UiRig } from "./battle-ui-rig.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const encoder = new TextEncoder();
const RIG = { stanceDelayTicks: 3 } as const;
const TBM_RIG = { stanceDelayTicks: 3, background: "tbm" } as const;
const mixedAnimation = writeAnimation({
  magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 64, height: 64,
  frames: [
    { image: "meadow.tbm", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
    { image: "slime_rest_b.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
  ],
  delay: 3 / 60, residue: new Uint8Array(),
});
if (!mixedAnimation.ok) throw new Error(mixedAnimation.error.message);

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
  readonly preparation: { readonly stage: string; readonly picturesReady: boolean | null } | null;
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
function saveMidBattle(program = FIGHT, tbm = false): SavedRun {
  const rig = bootUiRig(tbm ? TBM_RIG : RIG);
  rig.files.set(assetKey("prg/fight.prg"), encoder.encode(program));
  if (tbm) rig.files.set(assetKey("misc/slime_rest.anm"), mixedAnimation.value);
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
function freshLoad(saved: Uint8Array, program = FIGHT, beforeLoad = "", tbm = false, missingFrame = false): FreshHost {
  const game = gameFiles(tbm ? TBM_RIG : RIG);
  game.files.set(assetKey("prg/start.prg"), encoder.encode(`${beforeLoad}load("slot")\nend()\n`));
  game.files.set(assetKey("prg/fight.prg"), encoder.encode(program));
  if (tbm) game.files.set(assetKey("misc/slime_rest.anm"), mixedAnimation.value);
  if (missingFrame) game.files.delete(assetKey("bitmap/slime_rest.png"));
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

// These cross-engine save/load tests exceed one second because both engines boot real game and package assets.
const WARM_PICTURES = 'createcanvas(64,64,c)\nsetimage("slime_rest.png",0,0,64,64,c)\nsetimage("slime_rest_b.png",0,0,64,64,c)\n';
const WARM_TBM = 'createcanvas(64,64,c)\nsetimage("meadow.tbm",0,0,64,64,c)\nsetimage("slime_rest_b.png",0,0,64,64,c)\n';
for (const [name, prefix, pause, expectedPreparation, beforeLoad, tbm] of [
  ["source only", "", "", { stage: "source-ready", picturesReady: false }, "", false],
  ["pictures fetched", "", "threadSleep(getThreadId(), 1/60)\n", { stage: "pictures-requested", picturesReady: null }, "", false],
  ["source only with warm pictures", WARM_PICTURES, "", { stage: "source-ready", picturesReady: true }, "", false],
  ["cold source with warm restore", "", "", { stage: "source-ready", picturesReady: false }, WARM_PICTURES, false],
  ["cold tile bitmap", "", "", { stage: "source-ready", picturesReady: false }, "", true],
  ["warm tile bitmap", WARM_TBM, "", { stage: "source-ready", picturesReady: true }, "", true],
  ["tile bitmap pictures fetched", "", "threadSleep(getThreadId(), 1/60)\n", { stage: "pictures-requested", picturesReady: null }, "", true],
] as const) {
  test(`an unloaded animation saved with ${name} resumes its phase (#1340)`, () => {
    const program = `${prefix}id = pinnedanimation("slime_rest.anm", 4, 4, 1)\n${pause}Save("slot")\nthreadSleep(getThreadId(), 120)\nend()\n`;
    const { saved, rig } = saveMidBattle(program, tbm);
    equal(saved.game.fx.animations[0]?.loaded, false, "the saved animation has not loaded");
    equal(saved.game.fx.animations[0]?.frames.length, 2);
    deepEqual(saved.game.fx.animations[0]?.preparation, expectedPreparation);
    deepEqual(rig.state().fx.animations[0]?.frames, saved.game.fx.animations[0]?.frames);
    deepEqual(rig.state().fx.animations[0]?.preparation, saved.game.fx.animations[0]?.preparation);
    const host = freshLoad(saved.bytes, program, beforeLoad, tbm);
    rig.until((state) => state.time.tick >= 15);
    runUntilTick(host, rig.state().time.tick);
    equal(host.state().fx.animations.length, 1);
    equal(host.state().fx.animations[0]?.loaded, true);
    equal(host.state().fx.animations[0]?.frames.length, 2);
    const shown = new Set<string>();
    for (let i = 0; i < 7; i += 1) {
      equal(host.state().time.tick, rig.state().time.tick);
      deepEqual(host.state().fx.animations, rig.state().fx.animations);
      const frame = host.frame();
      shown.add(frame);
      equal(frame, fnv1a64(rig.frame().rgba), "the presented frame matches");
      rig.tick();
      runUntilTick(host, rig.state().time.tick);
    }
    ok(shown.size >= 2, "the observed frames visibly change");
    deepEqual(host.diagnostics, []);
  });
}

// Two real engine boots exercise continuation sharing, not just one animation's clock.
for (const [label, beforeLoad] of [["cold", ""], ["warm", WARM_PICTURES]] as const) {
  test(`a resumed script's second animation sees the saved cache boundary with a ${label} restore (#1340)`, () => {
    const program = 'id = pinnedanimation("slime_rest.anm",4,4,1)\nSave("slot")\nid2 = pinnedanimation("slime_rest.anm",8,8,1)\nthreadSleep(getThreadId(),120)\nend()\n';
    const { saved, rig } = saveMidBattle(program);
    deepEqual(saved.game.fx.animations[0]?.preparation, { stage: "source-ready", picturesReady: false });
    const host = freshLoad(saved.bytes, program, beforeLoad);
    rig.until((state) => state.time.tick >= 15);
    runUntilTick(host, rig.state().time.tick);
    equal(rig.state().fx.animations.length, 2);
    deepEqual(host.state().fx.animations, rig.state().fx.animations);
  });
}

test("a resumed script can cancel an unloaded animation before its pictures are requested (#1340)", () => {
  const program = 'id = pinnedanimation("slime_rest.anm",4,4,1)\nSave("slot")\nendanimation(id)\ncanceled = 1\nthreadSleep(getThreadId(),120)\nend()\n';
  const { saved, rig } = saveMidBattle(program);
  deepEqual(saved.game.fx.animations[0]?.preparation, { stage: "source-ready", picturesReady: false });
  const host = freshLoad(saved.bytes, program, "", false, true);
  rig.until((state) => state.vm.globals.canceled === 1);
  runUntilTick(host, rig.state().time.tick);
  equal(host.state().vm.globals.canceled, 1);
  deepEqual(host.diagnostics, []);
  equal(host.requested.includes("bitmap/slime_rest.png"), false);
});

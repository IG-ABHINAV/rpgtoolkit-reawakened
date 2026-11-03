// Epic 8 full-engine restore acceptance (#595): actual Save bytes pass through
// the engine's blob boundary, then Load restores/replays them. The small number
// of engine ticks is required to exercise boot, request/reply, and VM phases;
// save projection itself is intentionally an integrated (slower) contract.
// The continuation comparison below is the ruled one (docs/spec/formats/save-game.md
// #state-hash-request-projection, #state-hash-surface-projection and
// #continuation-equivalence), not a hand-picked subset of the state tree.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  addActor, assetKey, createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine, createGameState,
  createSurface, hashGameState, hashState, IR_VERSION, registerActorObjects, restoreGameSave, restoreGameState,
  snapshot, startThread, tagNonFinite, writeBoard, writeMainFile,
  type AssetKey, type AudioCue, type Engine, type GameState, type InputRecord, type PlainData,
} from "../src/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PATHS = ["main.gam", "boards/start.brd", "prg/start.prg"];
const SEED = 5;
type Game = {
  readonly files: Map<AssetKey, Uint8Array>;
  readonly engine: Engine;
  state(): GameState | null;
};

/**
 * Non-default application store, present in the save, so a section silently dropped from the
 * continuation comparison cannot pass: two party actors with non-default hp/smp/level, a
 * two-member party, an inventory with items, gold and an equipped tuple, script globals, and one
 * script-owned canvas (`cnv1`) with drawn pixels.
 */
function seedStore(state: GameState): void {
  const hero = addActor(state.actors, {
    kind: "party", source: "bitmap/hero.pcx", name: "Hero",
    stats: { hp: 41, maxHp: 60, smp: 17, maxSmp: 30, level: 7, dp: 5, fp: 9, experience: 123 },
  });
  const mage = addActor(state.actors, {
    kind: "party", source: "bitmap/mage.pcx", name: "Mage",
    stats: { hp: 23, maxHp: 40, smp: 33, maxSmp: 44, level: 6 },
  });
  state.party.members.push(hero.id, mage.id);
  state.party.selected = hero.id;
  state.party.steps = 12;
  state.inventory.items.push(
    { id: 1, source: "item/potion.itm", handle: "potion-a", quantity: 4 },
    { id: 2, source: "item/sword.itm", handle: "sword-a", quantity: 1 },
  );
  state.inventory.nextId = 3;
  state.inventory.equipment.push({ actorId: hero.id, slot: "weapon", itemId: 2 });
  state.inventory.gold = 250;
  state.vm.globals["seedFlag"] = "seeded";
  state.vm.globals["spawnX"] = 48;
  state.vm.globals["spawnY"] = 21;
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37) % 255;
  createSurface(state.surfaces, 4, 4, pixels);
  // Register the actor emitters the seam registers when a game's own boot hydrates actors. Without
  // this the reference has no `actor:<id>` emitter entry and only the restored side's rebuilt
  // services add one, which would make the fixture, not Load, the cause of an `events` difference.
  registerActorObjects(state.vm, state.events, state.actors);
}

function boot(program: string): Game {
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" });
  if (!main.ok) throw new Error(main.error.message);
  const board = writeBoard({ ...createEmptyBoard(), properties: { ...createEmptyBoard().properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  const paths = [...PATHS];
  let latest: GameState | null = null;
  let started = false;
  const engine = createEngine({
    seed: SEED, assetIndex: createAssetIndex(paths), assetRoot: { kind: "package" },
    mainFile: "main.gam", gameIdentity: "epic-8-restore-acceptance", width: 64, height: 64, maxTicks: 400,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "events", run: (state) => {
      latest = state;
      if (started || state.engine.boot?.stage !== "running") return;
      started = true;
      seedStore(state);
      startThread(state.vm, { ref: { kind: "inline", text: program, ir: IR_VERSION }, kind: "board", owner: "script" });
    } }],
  });
  return { files, engine, state: () => latest };
}

type Run = {
  saved: Uint8Array | null;
  readonly hashes: string[];
  readonly codes: string[];
  /** Every cue the engine emitted, in emission order across batches (AD-16). */
  readonly cues: AudioCue[];
  /** The live cue counter when the Load request went out, before its reply: the load's prior live counter. */
  readonly liveCueIdAtLoad: number | null;
};
function run(game: Game, loadBytes: Uint8Array | null, ticks = 40): Run {
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  let liveCueIdAtLoad: number | null = null;
  const hashes: string[] = [];
  const codes: string[] = [];
  const cues: AudioCue[] = [];
  for (let i = 0; i < ticks; i++) {
    const report = game.engine.advance(1, replies);
    replies = [];
    cues.push(...report.audioCues);
    codes.push(...report.diagnostics.map(({ code }) => code));
    hashes.push(report.stateHash);
    for (const request of report.requests) {
      if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      else if (request.kind === "saveBlob") {
        saved = new Uint8Array(request.bytes);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") {
        liveCueIdAtLoad = game.state()?.audio.cueId ?? null;
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: loadBytes } });
      }
    }
  }
  return { saved, hashes, codes, cues, liveCueIdAtLoad };
}

const SAVER = 'counter = counter + 1\nSave("slot")\ncounter = counter + 1\nthreadsleep(1)\ncounter = counter + 1\nend()\n';
const LOADER = 'counter = 9\nLoad("slot")\nafter = counter\nend()\n';
function capture(): Uint8Array {
  const result = run(boot(SAVER), null);
  ok(result.saved !== null, "real Engine Save emitted bytes");
  return result.saved;
}
function mutate(bytes: Uint8Array, change: (root: Record<string, unknown>) => void): Uint8Array {
  const root = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  change(root);
  return encoder.encode(JSON.stringify(root));
}
function globals(game: Game): Record<string, unknown> {
  const state = game.state();
  ok(state !== null);
  return state.vm.globals as Record<string, unknown>;
}

/** A projection section, read from canonical data this test itself derived. */
function recordOf(value: unknown): Record<string, unknown> {
  ok(value !== null && typeof value === "object" && !Array.isArray(value), "expected a projection section object");
  return value as Record<string, unknown>;
}
function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  ok(typeof value === "number", `expected a numeric ${field}`);
  return value;
}

/**
 * The complete replay-hash projection, mirroring `hashGameState` in `core/save/hash.ts`: the whole
 * state tree minus the VM step counters, the engine's request-id counter, the script volume
 * settings, and the two screen-surface entries (the presented frame `0` and the script-screen layer
 * `-1`). Every other section stays, including pending requests and their ids, script variables and
 * globals, and script-owned canvases (`docs/spec/formats/save-game.md#state-hash-request-projection`,
 * `#state-hash-surface-projection`). The test proves the equivalence to `hashGameState` below.
 */
function replayHashProjection(state: GameState): Record<string, unknown> {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  const { settings: _settings, ...audio } = state.audio;
  const { "0": _presentedFrame, "-1": _scriptScreenLayer, ...entries } = state.surfaces.entries;
  return { ...state, vm, engine, audio, surfaces: { ...state.surfaces, entries } };
}

test("full-engine Save bytes load mid-script and produce canonical deterministic replay hashes", () => {
  const bytes = capture();
  ok(bytes.length > 1000);
  const text = decoder.decode(bytes);
  ok(text.startsWith("{") && text.includes('"counter":1'));
  const restored = restoreGameSave(text, createGameState({ seed: SEED }).audio);
  const captured = restored.state;
  const canonical = snapshot(captured);
  const roundTrip = restoreGameState(canonical);
  equal(snapshot(roundTrip), canonical, "the saved state has a stable canonical representation");
  equal(hashGameState(roundTrip), hashGameState(captured), "canonical hash survives restoration of the real save bytes");

  // The save carries the non-default store the comparison below projects.
  equal(captured.party.members.length, 2, "the save carries a two-member party");
  equal(captured.party.steps, 12, "the save carries the party step counter");
  deepEqual(
    captured.actors.actors.map(({ stats }) => [stats.hp, stats.smp, stats.level]),
    [[41, 17, 7], [23, 33, 6]],
    "the save carries two actors with non-default hp/smp/level",
  );
  equal(captured.inventory.gold, 250, "the save carries inventory gold");
  equal(captured.inventory.items.length, 2, "the save carries inventory items");
  deepEqual(captured.inventory.equipment, [{ actorId: captured.party.members[0], slot: "weapon", itemId: 2 }], "the save carries an equipped tuple");
  equal(captured.vm.globals["seedFlag"], "seeded", "the save carries a script global");
  ok(Object.hasOwn(captured.surfaces.entries, "1"), "the save carries the script-owned canvas the hash keeps");
  ok(Object.hasOwn(captured.surfaces.entries, "0"), "the save also carries the presented frame the hash excludes");
  ok(captured.vm.threads.some(({ status }) => status === "waiting"), "the save holds the running Save thread parked on its request");

  const reference = boot(SAVER);
  const referenceRun = run(reference, null);
  equal(globals(reference).counter, 3, "the uninterrupted reference completed the Save continuation");
  const first = boot(LOADER);
  const firstRun = run(first, bytes);
  equal(globals(first).counter, 3, "the saved thread resumed after Save and completed its continuation");
  const loadedState = first.state();
  const referenceState = reference.state();
  ok(loadedState !== null && referenceState !== null, "both engine runs expose their final state");

  // Equivalent settled checkpoints: same tick, no thread in flight, no host request pending.
  equal(loadedState.time.tick, referenceState.time.tick, "the compared checkpoints are at the same tick");
  deepEqual(
    loadedState.vm.threads.map(({ status }) => status),
    referenceState.vm.threads.map(({ status }) => status),
    "both checkpoints have the same thread-table state",
  );
  ok(loadedState.vm.threads.every(({ status }) => status === "finished"), "every thread has finished at the compared checkpoint");
  deepEqual(loadedState.engine.pending, [], "no host request is pending on the loaded side");
  deepEqual(referenceState.engine.pending, [], "no host request is pending on the uninterrupted side");
  for (const track of [...loadedState.audio.tracks, ...referenceState.audio.tracks]) {
    equal(track.voices.length, 0, `no active voice on track ${track.name} at either checkpoint`);
  }

  // The whole replay-hash projection, not a hand-listed subset: the helper hashing to
  // `hashGameState` proves it is the hash's own projection for each side.
  const loadedProjection = replayHashProjection(loadedState);
  const referenceProjection = replayHashProjection(referenceState);
  equal(
    hashState(tagNonFinite(loadedProjection) as PlainData),
    hashGameState(loadedState),
    "the compared projection of the loaded state is exactly what the state hash covers",
  );
  equal(
    hashState(tagNonFinite(referenceProjection) as PlainData),
    hashGameState(referenceState),
    "the compared projection of the uninterrupted state is exactly what the state hash covers",
  );
  deepEqual(Object.keys(loadedProjection).sort(), Object.keys(referenceProjection).sort(), "both checkpoints project the same canonical sections");
  for (const section of Object.keys(referenceProjection)) {
    if (section === "audio") continue; // the one ruled difference, proven below
    deepEqual(loadedProjection[section], referenceProjection[section], `post-Load ${section} matches uninterrupted execution`);
  }

  // Continuation-equivalence ruling (docs/spec/formats/save-game.md#continuation-equivalence): the
  // saved counter matches the uninterrupted counter, the loaded counter is exactly one greater, and
  // the only difference anywhere in the audio section is that next cue ID.
  const referenceNextCueId = numberField(recordOf(referenceProjection["audio"]), "cueId");
  const loadedNextCueId = numberField(recordOf(loadedProjection["audio"]), "cueId");
  const { cueId: _referenceCueId, ...referencePlayback } = recordOf(referenceProjection["audio"]);
  const { cueId: _loadedCueId, ...loadedPlayback } = recordOf(loadedProjection["audio"]);
  deepEqual(loadedPlayback, referencePlayback, "post-Load audio playback matches uninterrupted execution in every field but the next cue ID");
  equal(referenceNextCueId, restored.audio.cueId, "the saved cue counter matches the uninterrupted counter");
  equal(loadedNextCueId, restored.audio.cueId + 1, "the loaded cue counter is exactly one greater than the saved counter");

  // Prove the difference is the single load-time `soundfont.set` cue inside the window from the save
  // checkpoint to the compared checkpoint, and that no other cue kind occurs there.
  const checkpointWindow = (cues: readonly AudioCue[]): AudioCue[] =>
    cues.filter(({ tick }) => tick >= restored.audio.tick && tick <= referenceState.time.tick);
  deepEqual(checkpointWindow(referenceRun.cues), [], "uninterrupted execution emits no audio cue after the save");
  const loadedWindow = checkpointWindow(firstRun.cues);
  equal(loadedWindow.length, 1, "the loaded side emits exactly one audio cue between the checkpoints");
  const loadCue = loadedWindow[0];
  ok(loadCue !== undefined);
  equal(loadCue.kind, "soundfont.set", "the load-time cue is the SoundFont re-emission");
  equal(loadCue.track, null, "the SoundFont cue names no track");
  equal(loadCue.voice, null, "the SoundFont cue names no voice");
  equal(loadCue.asset, null, "no SoundFont is configured, so the re-emitted cue carries none");
  equal(loadCue.cueId, restored.audio.cueId, "the load-time cue consumes exactly the saved next cue ID");
  ok(firstRun.liveCueIdAtLoad !== null, "the loaded run reached the Load request");
  ok(firstRun.liveCueIdAtLoad <= restored.audio.cueId, "the load's prior live cue counter does not exceed the saved counter");

  const second = boot(LOADER);
  const secondRun = run(second, bytes);
  equal(globals(second).counter, 3);
  deepEqual(firstRun.hashes, secondRun.hashes, "same real save bytes replay to the same per-tick state hashes");
  equal(firstRun.codes.includes("restore.ir-mismatch"), false);
  equal(secondRun.codes.includes("restore.ir-mismatch"), false);
});

test("full-engine Load refuses newer IR and restarts an older-IR saved thread", () => {
  const saved = capture();
  const newer = mutate(saved, (root) => {
    const schema = root.schema as Record<string, unknown>;
    schema.ir = String(Number(IR_VERSION) + 1);
  });
  const refused = boot(LOADER);
  const refusal = run(refused, newer);
  ok(refusal.codes.includes("restore.ir-mismatch"));
  equal(globals(refused).counter, 9, "refusal preserves the live value instead of adopting saved counter=1");
  equal(globals(refused).after, 9, "the calling thread continues after refused Load without replacing live state");

  const older = mutate(saved, (root) => {
    const vm = root.vm as { threads: { frames: { program: { ir: string } }[] }[] };
    const thread = vm.threads.find((candidate) => candidate.frames.length > 0);
    ok(thread !== undefined, "save includes the running Save thread");
    thread.frames[0]!.program.ir = "0";
  });
  const restarted = boot(LOADER);
  const replay = run(restarted, older);
  equal(globals(restarted).counter, 4, "older-IR thread restarted from source over restored counter");
  equal(replay.codes.includes("restore.ir-mismatch"), false, "older thread is restarted, not refused");
});

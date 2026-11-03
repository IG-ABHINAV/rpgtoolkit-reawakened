// The Save operation and canonical game serialization (ticket 8.9; E-123,
// docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load).
//
// `Save(name)` is a blocking file command: it asks the host to write
// `Saved/<name>.sav`, and the runtime answers with the canonical game JSON
// (`snapshotGameSave`) rather than the legacy binary. Three things this file
// pins, each through the real engine path rather than the pure functions:
//
//   * a mid-script save carries every section and restores to the same state;
//   * a board whose properties disable saving refuses the command with no save
//     request and no state mutation;
//   * the canonical form is deterministic, so equal state saves to equal bytes.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  addActor,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  hashGameState,
  IR_VERSION,
  restoreGameSave,
  snapshotGameSave,
  startThread,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type Engine,
  type GameState,
  type InputRecord,
  type TickReport,
} from "../src/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Files = Map<AssetKey, Uint8Array>;

type GameOptions = {
  /** The board's `disableSaving` property: non-zero forbids `Save` (E-123). */
  readonly disableSaving?: number;
};

type BootedGame = {
  readonly files: Files;
  readonly engine: Engine;
  readonly state: () => GameState;
};

/** A boot-mode game with an authored board and a start-up program that just ends. */
function authoredGame(options: GameOptions = {}): { files: Files; paths: string[] } {
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" };
  const written = writeMainFile(main);
  if (!written.ok) throw new Error(written.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({
    ...empty,
    properties: {
      ...empty.properties,
      start: { x: 32, y: 32, layer: 1 },
      disableSaving: options.disableSaving ?? 0,
    },
  });
  if (!board.ok) throw new Error(board.error.message);
  const paths = ["main.gam", "boards/start.brd", "prg/start.prg"];
  const files: Files = new Map([
    [assetKey("main.gam"), written.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  return { files, paths };
}

/** Boot a game and hand back the engine plus a live-state accessor. */
function bootedGame(spec: { files: Files; paths: string[] }, stateRef: { current: GameState | null }): BootedGame {
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(spec.paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "save-operation-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        stateRef.current = state;
      },
    }],
  });
  return {
    files: spec.files,
    engine,
    state: () => {
      if (stateRef.current === null) throw new Error("the engine has not run a tick yet");
      return stateRef.current;
    },
  };
}

/** Advance with asset replies until the game has booted and the live state is reachable. */
function boot(game: BootedGame): GameState {
  let replies: InputRecord[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const report = game.engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      }
    }
    if (report.loading) continue;
    try {
      return game.state();
    } catch {
      continue;
    }
  }
  throw new Error("the game never booted");
}

/** Run ticks, answering assets, until `stop` returns something or the guard runs out. */
function runUntil<T>(game: BootedGame, stop: (report: TickReport) => T | undefined): T {
  let replies: InputRecord[] = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const report = game.engine.advance(1, replies);
    replies = [];
    const found = stop(report);
    if (found !== undefined) return found;
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      }
    }
  }
  throw new Error("the game never reached the expected state");
}

/** Give the live state something in every section that a save must carry. */
function populate(state: GameState): { actorId: number } {
  const actor = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    stats: { hp: 9, maxHp: 12, smp: 4, maxSmp: 4, dp: 2, fp: 3, level: 2, experience: 40, criticalOn: 5, criticalBy: 3 },
    behaviour: "stock-rpg.hero",
  });
  actor.statuses = { "poison.ste": 2 };
  state.party.members = [actor.id];
  state.party.selected = actor.id;
  state.party.steps = 3;
  state.inventory.items = [
    { id: 1, source: "item/potion.itm", handle: "Potion", quantity: 2 },
    { id: 2, source: "item/sword.itm", handle: "Sword", quantity: 1 },
  ];
  state.inventory.nextId = 3;
  state.inventory.equipment = [{ actorId: actor.id, slot: "right hand", itemId: 2 }];
  state.inventory.gold = 250;
  state.menu.screens = [{ screen: "items", actorId: actor.id, selection: 1 }];
  state.battle = {
    id: 4,
    boardKey: "boards/start.brd",
    background: "",
    canRun: false,
    outcome: null,
    parties: [[], [{ party: 1, actorId: actor.id, charge: 60 }]],
  };
  return { actorId: actor.id };
}

/** A JSON-safe deep copy; every compared section is plain data (G1). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type SaveRequest = { readonly path: string; readonly bytes: Uint8Array | null };

/** The `saveBlob` requests a tick reported, whether they carry a game save or a file write. */
function saveRequests(report: TickReport): SaveRequest[] {
  const out: SaveRequest[] = [];
  for (const request of report.requests) {
    if (request.kind !== "saveBlob") continue;
    out.push({ path: request.blob.path, bytes: request.bytes === null ? null : new Uint8Array(request.bytes) });
  }
  return out;
}

test("a mid-script Save carries every section and restores to the same state", () => {
  const spec = authoredGame();
  const stateRef: { current: GameState | null } = { current: null };
  const game = bootedGame(spec, stateRef);
  const state = boot(game);
  const { actorId } = populate(state);
  // A thread parked on the save is part of the saved VM state, so the snapshot
  // must hold that thread and its wait as well as the data sections.
  startThread(state.vm, {
    ref: { kind: "inline", text: 'Save("slot")\nend()\n', ir: IR_VERSION },
    kind: "board",
    owner: "script",
  });

  const saved = runUntil(game, (report) => {
    const request = saveRequests(report).find((candidate) => candidate.path.endsWith("slot.sav"));
    return request?.bytes ?? undefined;
  });
  const text = decoder.decode(saved);
  const parsed: unknown = JSON.parse(text);
  ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed), "the save is a JSON object");
  const sections = Object.keys(parsed).sort();

  // Every section AD-10 declares is in the canonical form, not just the one the
  // fixture touched.
  for (const section of ["actors", "audio", "battle", "camera", "events", "fx", "input", "inventory", "menu", "party", "rng", "sprites", "time", "triggers", "ui", "vm", "world"]) {
    ok(sections.includes(section), `the canonical save carries the ${section} section; it has ${sections.join(", ")}`);
  }

  const restored = restoreGameSave(text, state.audio).state;
  equal(restored.actors.actors.length, 1, "the actor record is saved");
  const actor = restored.actors.actors[0];
  if (actor === undefined) throw new Error("the restored save has no actor");
  equal(actor.id, actorId);
  equal(actor.stats.hp, 9, "current hp is saved, not the maximum");
  deepEqual(actor.statuses, { "poison.ste": 2 }, "status counters are saved");
  equal(actor.behaviour, "stock-rpg.hero", "the behaviour name, never the callable, is saved");
  deepEqual(restored.party, { version: 3, members: [actorId], selected: actorId, steps: 3, stepRemainder: 0 });
  deepEqual(restored.inventory.items, [
    { id: 1, source: "item/potion.itm", handle: "Potion", quantity: 2 },
    { id: 2, source: "item/sword.itm", handle: "Sword", quantity: 1 },
  ]);
  deepEqual(restored.inventory.equipment, [{ actorId, slot: "right hand", itemId: 2 }]);
  equal(restored.inventory.gold, 250);
  deepEqual(restored.menu.screens, [{ screen: "items", actorId, selection: 1 }]);
  equal(restored.world.board?.key, "boards/start.brd", "the live board is part of the save");
  deepEqual(restored.battle?.parties[1]?.map((fighter) => fighter.charge), [60], "the battle section keeps its fighter charge");
  ok(restored.vm.threads.length >= 1, "the running thread is saved with its wait");
  ok(restored.time.tick > 0, "the clock is saved");

  // Restoring the canonical form is lossless: the same bytes come back, and the
  // hash the runtime uses for state identity is unchanged.
  equal(snapshotGameSave(restored), text, "restoring and re-canonicalising reproduces the saved bytes");
  equal(hashGameState(restored), hashGameState(restoreGameSave(text, state.audio).state), "two restores of the same bytes agree on the state hash");
});

test("a board that disables saving refuses Save with no request and no state change", () => {
  const spec = authoredGame({ disableSaving: 1 });
  const stateRef: { current: GameState | null } = { current: null };
  const game = bootedGame(spec, stateRef);
  const state = boot(game);
  populate(state);
  // Only the clock and RNG advance on their own; no command on this board may
  // change the game data, so those sections are compared exactly.
  const before = {
    actors: clone(state.actors),
    party: clone(state.party),
    inventory: clone(state.inventory),
    menu: clone(state.menu),
    battle: clone(state.battle),
  };
  const thread = startThread(state.vm, {
    ref: { kind: "inline", text: 'Save("slot")\nend()\n', ir: IR_VERSION },
    kind: "board",
    owner: "script",
  });

  let finishTick = -1;
  const requests: SaveRequest[] = [];
  runUntil(game, (report) => {
    for (const request of saveRequests(report)) requests.push(request);
    if (thread.status === "finished") {
      finishTick = report.tickAfter;
      return true;
    }
    return undefined;
  });

  equal(requests.length, 0, `a board that forbids saving issues no save request: ${JSON.stringify(requests)}`);
  ok(finishTick > 0, "the script finished normally rather than parking");
  deepEqual(state.actors, before.actors, "the refused command leaves the actor section unchanged");
  deepEqual(state.party, before.party, "the refused command leaves the party section unchanged");
  deepEqual(state.inventory, before.inventory, "the refused command leaves the inventory unchanged");
  deepEqual(state.menu, before.menu, "the refused command leaves the menu unchanged");
  deepEqual(state.battle, before.battle, "the refused command leaves the battle section unchanged");
});

test("equal state saves to byte-identical canonical bytes", () => {
  const spec = authoredGame();
  const stateRef: { current: GameState | null } = { current: null };
  const game = bootedGame(spec, stateRef);
  const state = boot(game);
  populate(state);

  const first = snapshotGameSave(restoreGameSave(snapshotGameSave(state), state.audio).state);
  const second = snapshotGameSave(restoreGameSave(first, state.audio).state);
  equal(first, second, "canonicalising a restored save is a fixed point");
  equal(hashGameState(restoreGameSave(first, state.audio).state), hashGameState(restoreGameSave(second, state.audio).state));

  startThread(state.vm, {
    ref: { kind: "inline", text: 'Save("first")\nend()\n', ir: IR_VERSION },
    kind: "board",
    owner: "script",
  });
  const throughEngine = runUntil(game, (report) => {
    const request = saveRequests(report).find((candidate) => candidate.path.endsWith("first.sav"));
    return request?.bytes ?? undefined;
  });
  const engineText = decoder.decode(throughEngine);
  equal(engineText, snapshotGameSave(restoreGameSave(engineText, state.audio).state),
    "the bytes the engine writes are the canonical form of the state they restore to");
});

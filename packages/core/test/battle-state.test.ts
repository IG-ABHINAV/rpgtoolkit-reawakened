import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  addActor,
  assetKey,
  createAssetIndex,
  createBattleOwner,
  createEmptyBoard,
  createEngine,
  createGameState,
  hashGameState,
  isBattleFighterUsable,
  PACKAGE_ROOT,
  restoreGameState,
  SCHEMA_VERSIONS,
  snapshot,
  writeBoard,
  type AssetKey,
  type BattleState,
  type Diagnostic,
  type Engine,
  type GameState,
  validateBattleSection,
} from "../src/index.ts";
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "save", "battle-v1.json");
function makeBattle(state: ReturnType<typeof createGameState>): BattleState {
  const enemy = addActor(state.actors, { kind: "enemy", source: "enemy", name: "enemy" });
  const player = addActor(state.actors, { kind: "party", source: "player", name: "player", statuses: { "poison.ste": 2 }, stats: { hp: 10, maxHp: 10, smp: 3, maxSmp: 3 } });
  return {
    id: 9, boardKey: "boards/castle.brd", background: "night.bkg", canRun: false, outcome: 2,
    parties: [[{ party: 0, actorId: enemy.id, charge: 123.5 }], [{ party: 1, actorId: player.id, charge: 74 }]],
  };
}
test("battle state snapshots preserve fighters, charge and outcome in the canonical hash", () => {
  const state = createGameState({ seed: 27 });
  state.battle = makeBattle(state);
  const saved = JSON.parse(snapshot(state)) as typeof state;
  const restored = restoreGameState(JSON.stringify(saved));
  deepEqual(restored.battle, state.battle);
  equal(hashGameState(restored), hashGameState(state));
  ok(!JSON.stringify(saved.battle).match(/"(hp|smp|status|stats)"/));
  deepEqual(saved.actors.actors.find(({ id }) => id === state.battle?.parties[1][0]?.actorId)?.statuses, { "poison.ste": 2 });
});

test("restored mid-fight battle continues to the uninterrupted canonical hash", () => {
  const uninterrupted = createGameState({ seed: 27 });
  uninterrupted.battle = makeBattle(uninterrupted);
  const resumed = restoreGameState(snapshot(uninterrupted));
  for (const current of [uninterrupted, resumed]) {
    current.time.tick += 1;
    current.battle!.parties[0][0]!.charge += 1;
  }
  equal(hashGameState(resumed), hashGameState(uninterrupted));
});

test("battle section schema v1 empty placeholder restores to null", () => {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { battle: unknown; schema: { battle: number } };
  equal(raw.schema.battle, 1);
  deepEqual(raw.battle, {});
  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.battle, null);
  equal(restored.schema.battle, SCHEMA_VERSIONS.battle);
});

test("dangling and duplicate fighter ids are retained with one located diagnostic each", () => {
  const state = createGameState({ seed: 1 });
  const battle = makeBattle(state);
  battle.parties[0].push({ party: 0, actorId: 900 as never, charge: 2 });
  battle.parties[1].push({ ...battle.parties[1][0]!, charge: 3 });
  state.battle = battle;
  const diagnostics: Diagnostic[] = [];
  const restored = restoreGameState(snapshot(state), diagnostics);
  equal(diagnostics.length, 2);
  ok(diagnostics.every((item) => item.code === "restore.battle-fighter"));
  ok(diagnostics.some((item) => item.message.includes("battle.parties[0][1].actorId")));
  ok(diagnostics.some((item) => item.message.includes("battle.parties[1][1].actorId")));
  equal(restored.battle?.parties[0].length, 2);
  equal(restored.battle?.parties[1].length, 2);
  ok(restored.battle !== null);
  ok(isBattleFighterUsable(restored.battle, 0, 0, restored.actors));
  equal(isBattleFighterUsable(restored.battle, 0, 1, restored.actors), false);
  equal(isBattleFighterUsable(restored.battle, 1, 1, restored.actors), false);
});
test("restoring a valid battle emits no restore.battle-fighter diagnostics", () => {
  const state = createGameState({ seed: 2 });
  state.battle = makeBattle(state);
  const diagnostics: Diagnostic[] = [];
  restoreGameState(snapshot(state), diagnostics);
  equal(diagnostics.filter(({ code }) => code === "restore.battle-fighter").length, 0);
});

test("a wrong-team fighter loads with a diagnostic and stays unusable in its original position", () => {
  const state = createGameState({ seed: 2 });
  const battle = makeBattle(state);
  const player = battle.parties[1][0]!;
  battle.parties[0][0] = { party: 0, actorId: player.actorId, charge: 37 };
  state.battle = battle;
  const saved = snapshot(state);
  const diagnostics: Diagnostic[] = [];
  const restored = restoreGameState(saved, diagnostics);
  deepEqual(restored.battle, battle, "the original positions and charge are preserved");
  equal(diagnostics.length, 1);
  equal(diagnostics[0]?.code, "restore.battle-fighter");
  ok(diagnostics[0]?.message.includes("battle.parties[0][0].actorId"));
  ok(restored.battle !== null);
  equal(isBattleFighterUsable(restored.battle, 0, 0, restored.actors), false);
  equal(isBattleFighterUsable(restored.battle, 1, 0, restored.actors), true);
  equal(hashGameState(restored), hashGameState(restoreGameState(saved)));
});

test("wrong-team fighters in both parties remain in place and each gets a located diagnostic", () => {
  const state = createGameState({ seed: 3 });
  const battle = makeBattle(state);
  const enemy = battle.parties[0][0]!;
  const player = battle.parties[1][0]!;
  battle.parties = [[{ ...player, party: 0 }], [{ ...enemy, party: 1 }]];
  state.battle = battle;
  const diagnostics: Diagnostic[] = [];
  const restored = restoreGameState(snapshot(state), diagnostics);
  deepEqual(restored.battle, battle);
  deepEqual(diagnostics.map(({ code }) => code), ["restore.battle-fighter", "restore.battle-fighter"]);
  ok(diagnostics[0]?.message.includes("battle.parties[0][0].actorId"));
  ok(diagnostics[1]?.message.includes("battle.parties[1][0].actorId"));
  ok(restored.battle !== null);
  equal(isBattleFighterUsable(restored.battle, 0, 0, restored.actors), false);
  equal(isBattleFighterUsable(restored.battle, 1, 0, restored.actors), false);
});

test("battle validation locates malformed outcomes and non-finite charge without mutating input", () => {
  const state = createGameState({ seed: 1 });
  const battle = makeBattle(state);
  const malformed = { ...battle, outcome: 5, parties: [battle.parties[0].map((fighter) => ({ ...fighter })), [{ ...battle.parties[1][0]!, charge: Number.NaN }]] };
  const before = {
    ...malformed,
    parties: malformed.parties.map((party) => party.map((fighter) => ({ ...fighter }))),
  };
  const issues = validateBattleSection(malformed, state.actors);
  deepEqual(malformed, before, "validation does not normalize or otherwise mutate its input");
  ok(issues.some((issue) => issue.path === "battle.outcome"));
  ok(issues.some((issue) => issue.path === "battle.parties[1][0].charge"));
});

test("malformed battle shapes reject restore with the standard shape error", () => {
  const state = createGameState({ seed: 1 });
  state.battle = makeBattle(state);
  for (const battle of [
    { ...state.battle, outcome: 5 },
    { ...state.battle, parties: [state.battle.parties[0], [{ ...state.battle.parties[1][0]!, charge: Number.NaN }]] },
    { ...state.battle, parties: [state.battle.parties[0]] },
  ]) {
    const malformed = { ...JSON.parse(snapshot(state)), battle };
    throws(() => restoreGameState(JSON.stringify(malformed)), (error: unknown) => (error as { code?: string }).code === "restore.shape");
  }
});

test("a fresh game state has no active battle", () => {
  equal(createGameState({ seed: 1 }).battle, null);
});

test("an out-of-battle serialized snapshot contains battle: null", () => {
  const saved = JSON.parse(snapshot(createGameState({ seed: 1 }))) as { battle: unknown };
  equal(saved.battle, null);
});

function ownerFor(state: GameState) {
  return createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
    readBattleCounter: () => state.engine.nextBattleId,
    commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
  });
}

function partyState(): { readonly state: GameState; readonly enemy: number; readonly player: number } {
  const state = createGameState({ seed: 5 });
  const enemy = addActor(state.actors, { kind: "enemy", source: "enemy", name: "enemy" });
  const player = addActor(state.actors, { kind: "party", source: "player", name: "player", stats: { hp: 10, maxHp: 10 } });
  state.party.members = [player.id];
  state.party.selected = player.id;
  return { state, enemy: enemy.id, player: player.id };
}

test("a save restored with no active battle keeps the run's battle numbering", () => {
  const { state, enemy, player } = partyState();
  const owner = ownerFor(state);
  const first = owner.start({ boardKey: "boards/castle.brd", background: "night.bkg", canRun: true, enemies: [enemy], players: [player] });
  ok(first.ok);
  equal(first.value.id, 1);
  ok(owner.apply({ type: "finish", code: 4 }).ok);
  ok(owner.endLoss().ok);
  equal(state.battle, null, "loss cleanup leaves no active battle");

  const restored = restoreGameState(snapshot(state));
  equal(restored.engine.nextBattleId, 2, "the counter is ordinary save data");
  const second = ownerFor(restored).start({ boardKey: "boards/castle.brd", background: "night.bkg", canRun: true, enemies: [enemy], players: [player] });
  ok(second.ok);
  equal(second.value.id, 2, "a restored game continues its numbering");
});

test("a battle counter that is not a positive whole number is refused at restore", () => {
  const saved = JSON.parse(snapshot(createGameState({ seed: 1 }))) as { engine: unknown };
  for (const nextBattleId of [0, -1, 1.5, "2", null, true]) {
    throws(
      () => restoreGameState(JSON.stringify({ ...saved, engine: { cacheKeys: [], nextBattleId } })),
      (error: unknown) => (error as { code?: string }).code === "restore.shape",
      `${JSON.stringify(nextBattleId)} must be refused`,
    );
  }
  equal(restoreGameState(JSON.stringify({ ...saved, engine: { cacheKeys: [], nextBattleId: 3 } })).engine.nextBattleId, 3);
});

/** Boot the real engine on one authored board; `run` sees every audio-phase tick and its state. */
function bootEngine(program: string, run: (state: GameState) => void): { readonly engine: Engine; readonly files: Map<AssetKey, Uint8Array> } {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<AssetKey, Uint8Array>([[assetKey("Boards/a.brd"), board.value]]);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/a.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "a.brd",
    width: 32,
    height: 32,
    maxTicks: 20,
    program,
    phaseRegistrations: [{ phase: "audio", run }],
  });
  return { engine, files };
}

/** Answer every asset request from `files` and tick once at a time until `done` holds. */
function drive(engine: Engine, files: Map<AssetKey, Uint8Array>, done: () => boolean): void {
  let replies: Parameters<Engine["advance"]>[1] = [];
  for (let guard = 0; guard < 60 && !done(); guard += 1) {
    const report = engine.advance(1, replies);
    replies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
  }
}

/** Add one enemy and one party member, then start a battle through the real owner. */
function startBattle(state: GameState): number {
  const enemy = addActor(state.actors, { kind: "enemy", source: "enemy", name: "enemy" });
  const player = addActor(state.actors, { kind: "party", source: "player", name: "player" });
  state.party.members = [player.id];
  state.party.selected = player.id;
  const result = ownerFor(state).start({ boardKey: "boards/a.brd", background: "", canRun: true, enemies: [enemy.id], players: [player.id] });
  ok(result.ok);
  return result.value.id;
}

test("an explicit engine reset restarts battle numbering at 1", () => {
  const started: number[] = [];
  const { engine, files } = bootEngine("sleep(2)\nreset()\nend()\n", (state) => {
  if (started.length === 0) {
    started.push(startBattle(state));
    return;
  }
  // After `reset()` the engine section is rebuilt, so the run's counter is gone.
  if (started.length === 1 && state.engine.nextBattleId === undefined && state.actors.actors.length === 0) {
    started.push(startBattle(state));
  }
});
  drive(engine, files, () => started.length === 2);
  deepEqual(started, [1, 1], "a new run numbers its first battle 1");
});

test("the engine keeps the run's battle counter in its own section across ticks", () => {
  const seen: (number | undefined)[] = [];
  let ticks = 0;
  const { engine, files } = bootEngine("sleep(12)\nend()\n", (state) => {
    ticks += 1;
    if (ticks === 1) {
      equal(startBattle(state), 1);
      return;
    }
    if (ticks <= 4) seen.push(state.engine.nextBattleId);
  });
  drive(engine, files, () => ticks >= 4);
  deepEqual(seen, [2, 2, 2], "the engine's section sync keeps the counter a save must carry");
});

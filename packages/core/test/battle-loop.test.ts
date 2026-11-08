// Behavioural BAT-4 tests run the authored stock package through the real RPGCode VM.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  addActor,
  assetKey,
  BATTLE_PLUGIN,
  BinaryWriter,
  CORE_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CATALOGUE_RESPONDERS_PLUGIN,
  createBattleOwner,
  createGameState,
  createPluginLayers,
  createAssetIndex,
  createScriptServices as coreCreateScriptServices,
  defaultWaitPoll,
  fileProgramRef,
  PACKAGE_ROOT,
  hashGameState,
  nextUint32,
  readStepCounters,
  registerActorObject,
  restoreGameState,
  runPackageStartup,
  runEventsPhase,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  startThread,
  STATUS_EFFECT_MAGIC,
  STEP_BUDGET,
  verifyRestoredHandles,
  RENDER_PLUGIN,
  WORLD_PLUGIN,
  type ActorRecord,
  type GameState,
  type PluginLayers,
  type ProgramLoader,
  type ResolvedPlugin,
  type ScriptServices,
  type Wait,
  type WaitPoll,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const startup = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");
const fixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-loop.prg"), "utf8");
const decisionFixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-decision.prg"), "utf8");
const decisionReadFixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-decision-read.prg"), "utf8");
const programSources: Record<string, string> = {
  "stock-battle.prg": startup,
  "battle-loop.prg": fixture,
  "battle-decision.prg": decisionFixture,
  "battle-decision-read.prg": decisionReadFixture,
  "battle-status-record.prg": readFileSync(join(testDirectory, "fixtures", "authored", "battle-status-record.prg"), "utf8"),
  "battle-status-wait.prg": readFileSync(join(testDirectory, "fixtures", "authored", "battle-status-wait.prg"), "utf8"),
  "battle-status-error.prg": readFileSync(join(testDirectory, "fixtures", "authored", "battle-status-error.prg"), "utf8"),
};
const programBytes = Object.fromEntries(Object.entries(programSources).map(([name, source]) =>
  [assetKey(`Prg/${name}`), new TextEncoder().encode(source)]));
const loader: ProgramLoader = {
  index: createAssetIndex(Object.keys(programBytes)),
  root: PACKAGE_ROOT,
  read: (key) => programBytes[key],
};
const startupRef = { ...fileProgramRef(loader, "stock-battle.prg"), owner: "stock_battle" };
const stockBattle: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [] },
};

type BattleRig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly enemies: readonly ActorRecord[];
  readonly players: readonly ActorRecord[];
  readonly seed: number;
};

function actor(state: GameState, kind: "party" | "enemy", name: string, hp = 20, statuses: Record<string, number> = {}): ActorRecord {
  const value = addActor(state.actors, {
    kind,
    source: `${name.toLowerCase()}.tem`,
    name,
    statuses,
    stats: { experience: 0, hp, maxHp: 20, smp: 10, maxSmp: 10, fp: 0, dp: 0, level: 1, criticalOn: -1, criticalBy: -1 },
  });
  const object = registerActorObject(state.vm, state.events, state.actors, value.id);
  if (object === null || object.className === null) throw new Error(`could not hydrate ${name}`);
  return value;
}

function makeState(options: {
  seed?: number;
  enemies?: number;
  players?: number;
  fallenPlayers?: readonly number[];
  enemyStatuses?: Record<string, number>;
  playerStatuses?: Record<string, number>;
} = {}): BattleRig {
  const seed = options.seed ?? 17;
  const state = createGameState({ seed });
  const enemies = Array.from({ length: options.enemies ?? 1 }, (_, index) =>
    actor(state, "enemy", `Enemy${index}`, 20, options.enemyStatuses));
  const players = Array.from({ length: options.players ?? 1 }, (_, index) =>
    actor(state, "party", `Player${index}`, options.fallenPlayers?.includes(index) ? 0 : 20, options.playerStatuses));
  state.party.members = players.map(({ id }) => id);
  state.party.selected = players[0]?.id ?? null;
  // No start operation exists yet; seed the saved section as in battle-api.test.ts.
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "test.bkg",
    canRun: true,
    outcome: null,
    parties: [
      enemies.map(({ id }) => ({ party: 0 as const, actorId: id, charge: 0 })),
      players.map(({ id }) => ({ party: 1 as const, actorId: id, charge: 0 })),
    ],
  };
  const layers = createPluginLayers();
  const services = servicesFor(state, layers);
  runPackageStartup(state, services, [startupRef], [stockBattle]);
  startProgram(state.vm, { ...fileProgramRef(loader, "battle-loop.prg"), owner: "battle-loop-test" });
  // The loop reads its fight background once, at start (BAT-10 cue inventory), and parks on that request. Park it
  // here, outside the clock, so each test's first tick is still the tick that seeds the charges and sleeps.
  tick(state, services);
  state.time.tick = 0;
  return { state, services, enemies, players, seed };
}

function servicesFor(state: GameState, layers: PluginLayers): ScriptServices {
  return coreCreateScriptServices(
    state,
    [
      { definition: CORE_PLUGIN },
      { definition: CATALOGUE_STUBS_PLUGIN },
      { definition: CATALOGUE_RESPONDERS_PLUGIN },
      { definition: WORLD_PLUGIN },
      { definition: BATTLE_PLUGIN },
      { definition: RENDER_PLUGIN },
      stockBattle,
    ],
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
  );
}

function restoreRig(json: string, seed: number): { readonly state: GameState; readonly services: ScriptServices } {
  const layers = createPluginLayers();
  const scratch = createGameState({ seed });
  const scratchServices = servicesFor(scratch, layers);
  runPackageStartup(scratch, scratchServices, [startupRef], [stockBattle]);
  const state = restoreGameState(json);
  const services = servicesFor(state, layers);
  verifyRestoredHandles(state.vm, services);
  return { state, services };
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

/** A fight background with no music and no cue files: the loop reads it once at start (BAT-10 cue inventory). */
const EMPTY_BACKGROUND_HEX = (() => {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT BKG");
  writer.i16(2);
  writer.i16(3);
  for (let field = 0; field < 6; field += 1) writer.str("");
  return Array.from(writer.toBytes(), (byte) => byte.toString(16).padStart(2, "0")).join("");
})();

function tick(state: GameState, services: ScriptServices, budget = STEP_BUDGET, poll?: WaitPoll): number {
  const before = Object.values(readStepCounters(state.vm)).reduce((total, count) => total + count, 0);
  runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events },
    (view, wait) => {
      if (wait.kind !== "request") return defaultWaitPoll(view, wait);
      if (state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request?.area === "backgrounds") {
        return { ok: true, value: EMPTY_BACKGROUND_HEX };
      }
      return poll !== undefined ? poll(view, wait) : defaultWaitPoll(view, wait);
    },
    undefined, services);
  runThreadsPhase(state.vm, services, budget);
  state.time.tick += 1;
  const after = Object.values(readStepCounters(state.vm)).reduce((total, count) => total + count, 0);
  return after - before;
}

function startUntilFirstSleep(rig: BattleRig, poll?: WaitPoll): void {
  for (let elapsed = 0; elapsed < 128; elapsed += 1) {
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    if (rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep")) return;
  }
  throw new Error("stock battle loop did not reach its initial tick sleep");
}
function settleStartupPass(rig: BattleRig, poll?: WaitPoll): void {
  startUntilFirstSleep(rig, poll);
  for (let elapsed = 0; elapsed < 128; elapsed += 1) {
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    if (rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep")) return;
  }
  throw new Error("stock battle loop did not settle its watcher setup");
}

type StatusFixture = {
  rounds: number;
  speed: number;
  slow: number;
  disable: number;
  hp: number;
  hpAmount: number;
  smp: number;
  smpAmount: number;
  runProgram: number;
  program: string;
};
type StatusPollValues = readonly [number, number, number] | Partial<StatusFixture>;

function statusBytes(
  speedOrFields: number | Partial<StatusFixture>,
  slow = 0,
  disable = 0,
  rounds = 1,
): Uint8Array {
  const fields: StatusFixture = typeof speedOrFields === "number"
    ? { rounds, speed: speedOrFields, slow, disable, hp: 0, hpAmount: 0, smp: 0, smpAmount: 0, runProgram: 0, program: "" }
    : { rounds: 1, speed: 0, slow: 0, disable: 0, hp: 0, hpAmount: 0, smp: 0, smpAmount: 0, runProgram: 0, program: "", ...speedOrFields };
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("authored loop status");
  writer.i16(fields.rounds);
  writer.i16(fields.speed);
  writer.i16(fields.slow);
  writer.i16(fields.disable);
  writer.i16(fields.hp);
  writer.i16(fields.hpAmount);
  writer.i16(fields.smp);
  writer.i16(fields.smpAmount);
  writer.i16(fields.runProgram);
  writer.str(fields.program);
  return writer.toBytes();
}

function statusPoll(state: GameState, flags: Readonly<Record<string, StatusPollValues>>): WaitPoll {
  const encodings = new Map(Object.entries(flags).map(([name, values]) => {
    const bytes = Array.isArray(values)
      ? statusBytes(values[0]!, values[1]!, values[2]!)
      : statusBytes(values as Partial<StatusFixture>);
    return [name.toLowerCase(), Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")];
  }));
  return (_view, wait: Wait) => {
    if (wait.kind !== "request") return null;
    const path = state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request?.path;
    const name = typeof path === "string" ? path.toLowerCase().split("/").at(-1) ?? "" : "";
    const bytes = encodings.get(name);
    return bytes === undefined ? { ok: false, value: null } : { ok: true, value: bytes };
  };
}


function charges(state: GameState): number[][] {
  if (state.battle === null) throw new Error("battle unexpectedly ended");
  return state.battle.parties.map((party) => party.map(({ charge }) => charge));
}

function globals(state: GameState): Record<string, unknown> {
  return state.vm.globals;
}

function ownerSteps(state: GameState, owner: string): number {
  return readStepCounters(state.vm)[owner] ?? 0;
}

function expectedSeedCharges(seed: number, enemyCount: number, playerCount: number): number[][] {
  const rng = createGameState({ seed }).rng;
  const enemy: number[] = [];
  const player: number[] = [];
  for (let index = 0; index < enemyCount; index += 1) enemy.push(nextUint32(rng) % 123);
  for (let index = 0; index < playerCount; index += 1) player.push(nextUint32(rng) % 75);
  return [enemy, player];
}

test("speed, slow, multiple status files, and zero-round counters produce the unbounded exact rate", () => {
  const flags = {
    "speed-a.ste": [1, 0, 0] as const,
    "speed-b.ste": [1, 0, 0] as const,
    "slow.ste": [0, 1, 0] as const,
    "slow-a.ste": [0, 1, 0] as const,
    "slow-b.ste": [0, 1, 0] as const,
  };
  const rig = makeState({
    enemyStatuses: { "speed-a.ste": 0, "speed-b.ste": 2, "slow.ste": 1 },
    playerStatuses: { "slow-a.ste": 0, "slow-b.ste": 1 },
  });
  const poll = statusPoll(rig.state, flags);
  startUntilFirstSleep(rig, poll);
  const statusesBefore = rig.state.actors.actors.map(({ id, statuses }) => [id, { ...statuses }] as const);
  setCharge(rig.state, 0, 0, 10);
  setCharge(rig.state, 1, 0, 10);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[15], [9]], "3 + 2 + 2 - 2 = 5; 3 - 2 - 2 = -1");
  deepEqual(rig.state.actors.actors.map(({ id, statuses }) => [id, { ...statuses }] as const), statusesBefore, "the loop reads status flags without ticking or expiring statuses");
  equal(rig.services.diagnostics.length, 0);
});
test("reapplying a case-insensitive status restarts one counter; HP and SMP effects run before each turn and expire", () => {
  const rig = makeState({ enemyStatuses: { "burn.ste": 1 } });
  rig.services.actors.updateStats(rig.enemies[0]!.id, { hp: 11, smp: 5 }, { cause: "script", source: null });
  const poll = statusPoll(rig.state, {
    "burn.ste": { rounds: 2, hp: 1, hpAmount: 4, smp: 1, smpAmount: 3 },
  });
  startUntilFirstSleep(rig, poll);
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "BURN.STE", 2);
  deepEqual(rig.state.actors.actors[0]?.statuses, { "burn.ste": 2 }, "case-insensitive reapplication replaces the counter");

  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(rig.state.actors.actors[0]?.stats.hp, 7);
  equal(rig.state.actors.actors[0]?.stats.smp, 2);
  deepEqual(rig.state.actors.actors[0]?.statuses, { "burn.ste": 1 });
  equal(globals(rig.state).turncount, 1);

  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(rig.state.actors.actors[0]?.stats.hp, 3);
  equal(rig.state.actors.actors[0]?.stats.smp, 0);
  deepEqual(rig.state.actors.actors[0]?.statuses, {}, "the second effect runs before its counter expires");
  equal(globals(rig.state).turncount, 2);
});

test("status programs run in upper-case filename order with status context", () => {
  const rig = makeState({ enemyStatuses: { "a.ste": 0, "B.ste": 0 } });
  const poll = statusPoll(rig.state, {
    "a.ste": { runProgram: 1, program: "battle-status-record.prg" },
    "B.ste": { runProgram: 1, program: "battle-status-record.prg" },
  });
  startUntilFirstSleep(rig, poll);
  globals(rig.state).statusprogramorder = "";
  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(globals(rig.state).statusprogramcount, 2);
  equal(globals(rig.state).statusprogramorder, "a.ste;B.ste;");
  equal(globals(rig.state).statusprogramcontext, "B.ste");
  equal(globals(rig.state).statusprogramsource, String(rig.enemies[0]!.id));
  equal(globals(rig.state).statusprogramtarget, String(rig.enemies[0]!.id));
});

test("status programs observe HP and SMP effects before the counter ages", () => {
  const rig = makeState({ enemyStatuses: { "order.ste": 2 } });
  rig.services.actors.updateStats(rig.enemies[0]!.id, { hp: 11, smp: 5 }, { cause: "script", source: null });
  const poll = statusPoll(rig.state, {
    "order.ste": {
      rounds: 2,
      hp: 1,
      hpAmount: 4,
      smp: 1,
      smpAmount: 3,
      runProgram: 1,
      program: "battle-status-record.prg",
    },
  });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);

  equal(globals(rig.state).statusprogramhp, 7);
  equal(globals(rig.state).statusprogramsmp, 2);
  equal(globals(rig.state).statusprogramsignature, '{"order.ste":2}');
  equal(rig.state.actors.actors[0]?.stats.hp, 7);
  equal(rig.state.actors.actors[0]?.stats.smp, 2);
  deepEqual(rig.state.actors.actors[0]?.statuses, { "order.ste": 1 });
  equal(globals(rig.state).turncount, 1);
});

test("signed status amounts heal and damage while clamping HP and SMP at both bounds", () => {
  const cases = [
    { status: "heal.ste", hp: 19, smp: 9, amount: -5, expectedHp: 20, expectedSmp: 10 },
    { status: "damage.ste", hp: 2, smp: 3, amount: 20, expectedHp: 0, expectedSmp: 0 },
  ] as const;
  for (const item of cases) {
    const rig = makeState({ enemyStatuses: { [item.status]: 1 } });
    rig.services.actors.updateStats(rig.enemies[0]!.id, { hp: item.hp, smp: item.smp }, { cause: "script", source: null });
    const poll = statusPoll(rig.state, {
      [item.status]: { rounds: 2, hp: 1, hpAmount: item.amount, smp: 1, smpAmount: item.amount },
    });
    startUntilFirstSleep(rig, poll);
    setCharge(rig.state, 0, 0, 123);
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    equal(rig.state.actors.actors[0]?.stats.hp, item.expectedHp, `${item.status} HP`);
    equal(rig.state.actors.actors[0]?.stats.smp, item.expectedSmp, `${item.status} SMP`);
  }
});

test("a per-round program error is reported while the status turn and battle continue", () => {
  const rig = makeState({ enemyStatuses: { "broken.ste": 0, "good.ste": 0 } });
  const poll = statusPoll(rig.state, {
    "broken.ste": { runProgram: 1, program: "battle-status-error.prg" },
    "good.ste": { hp: 1, hpAmount: 2 },
  });
  startUntilFirstSleep(rig, poll);
  const hpBefore = rig.state.actors.actors[0]!.stats.hp;
  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(rig.state.actors.actors[0]?.stats.hp, hpBefore - 2, "later ordered statuses still apply after the program error");
  equal(globals(rig.state).statuserrorcontext, "broken.ste");
  equal(globals(rig.state).statuserrorreached, 1);
  equal(globals(rig.state).turncount, 1);
  ok(rig.services.diagnostics.some(({ code, file }) =>
    code === "unknown.command" && file.includes("battle-status-error.prg")));
});

test("a status program parked mid-effect resumes identically after save and restore", () => {
  const rig = makeState({ seed: 29, enemyStatuses: { "pause.ste": 2 } });
  const poll = statusPoll(rig.state, {
    "pause.ste": { runProgram: 1, program: "battle-status-wait.prg" },
  });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(globals(rig.state).statuswaitstarted, 1);
  equal(globals(rig.state).statuswaitresumed, 0);

  const restored = restoreRig(snapshot(rig.state), rig.seed);
  const restoredPoll = statusPoll(restored.state, {
    "pause.ste": { runProgram: 1, program: "battle-status-wait.prg" },
  });
  for (let elapsed = 0; elapsed < 5; elapsed += 1) {
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    tick(restored.state, restored.services, STEP_BUDGET, restoredPoll);
    equal(hashGameState(restored.state), hashGameState(rig.state), `saved mid-effect tick ${elapsed}`);
  }
  equal(globals(rig.state).statuswaitresumed, 1);
  equal(globals(rig.state).statuswaitcontext, "pause.ste");
  equal(globals(rig.state).statuswaitsource, String(rig.enemies[0]!.id));
  equal(globals(rig.state).statuswaittarget, String(rig.enemies[0]!.id));
  equal(globals(rig.state).turncount, 1);
});

test("lethal status HP fires one fallen event with cause status without cancelling the turn", () => {
  const rig = makeState({ enemyStatuses: { "lethal.ste": 1 } });
  rig.services.actors.updateStats(rig.enemies[0]!.id, { hp: 5 }, { cause: "script", source: null });
  const poll = statusPoll(rig.state, { "lethal.ste": { hp: 1, hpAmount: 5 } });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 0, 0, 0);
  startThread(rig.state.vm, {
    ref: {
      kind: "inline",
      ir: "1",
      text: `global(statusFallenCount)
global(statusFallenCause)
on(battle.fighter(0, 0), "fallen", (event) => {
  statusFallenCount = statusFallenCount + 1
  statusFallenCause = event.detail.cause
})
`,
    },
    kind: "persistent",
    owner: "script",
  });
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  setCharge(rig.state, 0, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(rig.state.actors.actors[0]?.stats.hp, 0);
  equal(globals(rig.state).turncount, 1);
  runEventsPhase(rig.state, rig.services, STEP_BUDGET);
  equal(globals(rig.state).statusfallencount, 1);
  equal(globals(rig.state).statusfallencause, "status");
});


test("a nonpositive charge rate stays below threshold instead of being clamped to zero", () => {
  const rig = makeState({ enemies: 0, playerStatuses: { "slow-a.ste": 0, "slow-b.ste": 0 } });
  const poll = statusPoll(rig.state, { "slow-a.ste": [0, 1, 0], "slow-b.ste": [0, 1, 0] });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 1, 0, 74);
  for (let pass = 0; pass < 100; pass += 1) tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(charges(rig.state)[1]?.[0], -26, "3 - 2 - 2 is -1 per pass, with no floor at zero");
  equal(globals(rig.state).turncount, 0);
});

test("disable reference-counts active status files, clamps ready charge, and resumes after the last owner removal", () => {
  const rig = makeState({ playerStatuses: { "freeze-a.ste": 0, "freeze-b.ste": 2 } });
  const poll = statusPoll(rig.state, { "freeze-a.ste": [0, 0, 1], "freeze-b.ste": [0, 0, 1] });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 0, 0, 0);
  setCharge(rig.state, 1, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(rig.state.actors.actors[1]?.statuses, { "freeze-a.ste": 0, "freeze-b.ste": 2 },
    "neither disable counter ages while the fighter is disabled");
  deepEqual(charges(rig.state), [[3], [74]]);
  rig.services.actors.removeStatus(rig.players[0]!.id, "freeze-a.ste");
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(rig.state.actors.actors[1]?.statuses, { "freeze-b.ste": 2 },
    "the remaining disable stays frozen until explicitly removed");
  deepEqual(charges(rig.state), [[6], [74]], "one remaining disable still freezes the fighter");
  rig.services.actors.removeStatus(rig.players[0]!.id, "freeze-b.ste");
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[9], [77]], "after final removal the former charge grows immediately");
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[12], [0]], "the threshold crossing acts on the following pass");
  equal(globals(rig.state).turnorder, "1:0,");
});

test("cached rates refresh before charging after status apply, same-count replacement, and disable removal", () => {
  const rig = makeState();
  const poll = statusPoll(rig.state, { "speed.ste": [1, 0, 0], "slow.ste": [0, 1, 0], "freeze.ste": [0, 0, 1] });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 0, 0, 0);
  setCharge(rig.state, 1, 0, 0);
  tick(rig.state, rig.services);
  equal(charges(rig.state)[0]![0], 3);
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "speed.ste", 0);
  startUntilFirstSleep(rig, poll);
  equal(charges(rig.state)[0]![0], 8, "new speed is used by the next charge step");
  rig.services.actors.removeStatus(rig.enemies[0]!.id, "speed.ste");
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "slow.ste", 0);
  startUntilFirstSleep(rig, poll);
  equal(charges(rig.state)[0]![0], 9, "a same-count status replacement invalidates the cached rate");
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "freeze.ste", 0);
  setCharge(rig.state, 0, 0, 123);
  startUntilFirstSleep(rig, poll);
  equal(charges(rig.state)[0]![0], 122, "new disable freezes and clamps before charging");
  rig.services.actors.removeStatus(rig.enemies[0]!.id, "freeze.ste");
  tick(rig.state, rig.services);
  equal(charges(rig.state)[0]![0], 123, "removing the final disable unfreezes on the next step");
  tick(rig.state, rig.services);
  equal(charges(rig.state)[0]![0], 0);
  equal(globals(rig.state).turnorder, "0:0,");
});

test("status cache restores identically both before and after a mid-battle status change is refreshed", () => {
  const flags = { "speed.ste": [1, 0, 0], "inert.ste": [0, 0, 0], "a-slow.ste": [0, 1, 0] } as const;
  for (const refreshed of [false, true]) {
    const rig = makeState({ enemyStatuses: { "speed.ste": 0, "inert.ste": 0 } });
    const poll = statusPoll(rig.state, flags);
    startUntilFirstSleep(rig, poll);
    setCharge(rig.state, 0, 0, 0);
    setCharge(rig.state, 1, 0, 0);
    tick(rig.state, rig.services);
    equal(charges(rig.state)[0]![0], 5);
    rig.services.actors.removeStatus(rig.enemies[0]!.id, "speed.ste");
    rig.services.actors.applyStatus(rig.enemies[0]!.id, "a-slow.ste", 0);
    if (refreshed) startUntilFirstSleep(rig, poll);
    const restored = restoreRig(snapshot(rig.state), rig.seed);
    const restoredPoll = statusPoll(restored.state, flags);
    equal(hashGameState(restored.state), hashGameState(rig.state));
    for (let elapsed = 0; elapsed < 8; elapsed += 1) {
      tick(rig.state, rig.services, STEP_BUDGET, poll);
      tick(restored.state, restored.services, STEP_BUDGET, restoredPoll);
      equal(hashGameState(restored.state), hashGameState(rig.state),
        `saved ${refreshed ? "after" : "before"} cache refresh, tick ${elapsed}`);
    }
    equal(charges(rig.state)[0]![0], refreshed ? 14 : 12, "restored charge uses slow, not stale speed");
  }
});

test("failed status loads contribute nothing and are requested only once per fighter and battle", () => {
  const rig = makeState({
    enemies: 2,
    players: 1,
    enemyStatuses: { "missing.ste": 0 },
    playerStatuses: { "missing.ste": 0 },
  });
  const requests: string[] = [];
  const missing: WaitPoll = (_view, wait) => {
    if (wait.kind !== "request") return null;
    requests.push(wait.file);
    return { ok: false, value: null };
  };
  startUntilFirstSleep(rig, missing);
  deepEqual(charges(rig.state), expectedSeedCharges(rig.seed, 2, 1));
  equal(requests.length, 3, "one missing asset diagnostic/request per fighter");
  equal(rig.services.diagnostics.filter(({ code }) => code === "asset.missing").length, 3);
  for (let index = 0; index < 2; index += 1) setCharge(rig.state, 0, index, 20);
  setCharge(rig.state, 1, 0, 20);
  tick(rig.state, rig.services, STEP_BUDGET, missing);
  deepEqual(charges(rig.state), [[23, 23], [23]], "a missing status contributes no speed, slow, or disable flag");
  tick(rig.state, rig.services, STEP_BUDGET, missing);
  equal(requests.length, 3, "subsequent passes use the per-fighter failed-load cache");
  equal(rig.services.diagnostics.filter(({ code }) => code === "asset.missing").length, 3);
  rig.services.actors.removeStatus(rig.enemies[0]!.id, "missing.ste");
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "missing.ste", 0);
  tick(rig.state, rig.services, STEP_BUDGET, missing);
  equal(requests.length, 3, "removing and reapplying a failed file does not request it again");
});
test("stock startup seeds each fighter once in enemy/player order, including fallen players, then sleeps before advancing", () => {
  const rig = makeState({ seed: 291, enemies: 2, players: 3, fallenPlayers: [1] });
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), expectedSeedCharges(rig.seed, 2, 3));
  ok(rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"),
    "initial charge is observable after the initial sleep is scheduled");
  equal(rig.state.time.tick, 1);
  const expectedRng = createGameState({ seed: rig.seed }).rng;
  for (let index = 0; index < 5; index += 1) nextUint32(expectedRng);
  deepEqual(rig.state.rng, expectedRng, "the loop consumes exactly one draw per fighter");
  tick(rig.state, rig.services);
  const expected = expectedSeedCharges(rig.seed, 2, 3);
  for (let index = 0; index < 2; index += 1) expected[0]![index] = expected[0]![index]! + 3;
  expected[1]![0] = expected[1]![0]! + 3;
  expected[1]![2] = expected[1]![2]! + 3;
  deepEqual(charges(rig.state), expected);
  equal(globals(rig.state).turncount, 0);
});

test("initial charge reaches both inclusive bounds without exceeding them over 1024 seeds", () => {
  const observed = [
    { min: Infinity, max: -Infinity },
    { min: Infinity, max: -Infinity },
  ];
  for (let seed = 0; seed < 1024; seed += 1) {
    const rig = makeState({ seed, enemies: 1, players: 1 });
    startUntilFirstSleep(rig);
    const initial = charges(rig.state);
    for (const party of [0, 1] as const) {
      const charge = initial[party]![0]!;
      const threshold = party === 0 ? 123 : 75;
      ok(Number.isInteger(charge) && charge >= 0 && charge < threshold,
        `seed ${seed}, party ${party}: initial charge ${charge} is within 0..${threshold - 1}`);
      observed[party]!.min = Math.min(observed[party]!.min, charge);
      observed[party]!.max = Math.max(observed[party]!.max, charge);
    }
    equal(rig.services.diagnostics.length, 0);
  }
  deepEqual(observed, [{ min: 0, max: 122 }, { min: 0, max: 74 }]);
});

test("a seeded 60-pass timeline and each pass's restored continuation match the charge oracle", () => {
  const rig = makeState({ seed: 312, enemies: 2, players: 2 });
  startUntilFirstSleep(rig);
  const expected = expectedSeedCharges(rig.seed, 2, 2);
  let order = "";
  for (let pass = 0; pass < 60; pass += 1) {
    const restored = restoreRig(snapshot(rig.state), rig.seed);
    for (const party of [0, 1] as const) {
      for (let index = 0; index < 2; index += 1) {
        const charge = expected[party]![index]!;
        if (charge >= (party === 0 ? 123 : 75)) {
          expected[party]![index] = 0;
          order += `${party}:${index},`;
        } else {
          expected[party]![index] = charge + 3;
        }
      }
    }
    tick(rig.state, rig.services);
    tick(restored.state, restored.services);
    deepEqual(charges(rig.state), expected, `charge after pass ${pass}`);
    equal(globals(rig.state).turnorder, order, `turn order after pass ${pass}`);
    equal(hashGameState(restored.state), hashGameState(rig.state), `restore at pass ${pass}`);
  }
  deepEqual(rig.services.diagnostics, []);
});

test("one-tick passes advance charge deterministically; crossing threshold acts on the next pass and releases to zero", () => {
  const rig = makeState({ enemies: 1, players: 1 });
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 120);
  setCharge(rig.state, 1, 0, 72);
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[123], [75]]);
  equal(globals(rig.state).turncount, 0);
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[0], [0]]);
  equal(globals(rig.state).turncount, 2);
  equal(globals(rig.state).turnorder, "0:0,1:0,");
  for (let pass = 0; pass < 18; pass += 1) tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[54], [54]], "18 idle passes each add exactly the base rate of 3");
  equal(globals(rig.state).turncount, 2);

});

test("thresholds are 123 for enemies and 75 for players; all already-ready fighters act in party order", () => {
  const rig = makeState({ enemies: 3, players: 3 });
  tick(rig.state, rig.services);
  for (let index = 0; index < 3; index += 1) setCharge(rig.state, 0, index, 123);
  for (let index = 0; index < 3; index += 1) setCharge(rig.state, 1, index, 75);
  const expected = "0:0,0:1,0:2,1:0,1:1,1:2,";
  for (let attempt = 0; attempt < 3 && globals(rig.state).turnorder !== expected; attempt += 1) {
    tick(rig.state, rig.services);
  }
  equal(globals(rig.state).turnorder, expected);
  deepEqual(charges(rig.state), [[0, 0, 0], [0, 0, 0]]);
});

test("a parked pass does not run until an engine tick wakes the thread", () => {
  const rig = makeState();
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 123);
  const beforeTick = snapshot(rig.state);
  for (let attempt = 0; attempt < 3; attempt += 1) runThreadsPhase(rig.state.vm, rig.services, STEP_BUDGET);
  equal(hashGameState(rig.state), hashGameState(restoreGameState(beforeTick)));
  equal(globals(rig.state).turncount, 0);
  tick(rig.state, rig.services);
  equal(globals(rig.state).turncount, 1);
  equal(charges(rig.state)[0]?.[0], 0);
});

test("the hook's multi-tick sleep freezes every fighter, including the actor whose turn is running", () => {
  const rig = makeState({ enemies: 1, players: 1 });
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 123);
  setCharge(rig.state, 1, 0, 74);
  globals(rig.state).turnsleepticks = 4;
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[123], [74]]);
  for (let index = 0; index < 3; index += 1) {
    tick(rig.state, rig.services);
    deepEqual(charges(rig.state), [[123], [74]]);
  }
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[0], [77]]);
  equal(globals(rig.state).turncount, 1);
});

test("fallen fighters keep charge without advancing or acting; reviving resumes from the retained charge", () => {
  const rig = makeState({ enemies: 1, players: 2, fallenPlayers: [0] });
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 122);
  setCharge(rig.state, 1, 0, 80);
  setCharge(rig.state, 1, 1, 0);
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[125], [80, 3]]);
  equal(globals(rig.state).turncount, 0);
  rig.services.actors.updateStats(rig.players[0]!.id, { hp: 20 }, { cause: "script" });
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[0], [0, 6]]);
  equal(globals(rig.state).turnorder, "0:0,1:0,");
});

test("outcomes 0 and 2 stop the stock loop only between passes, while unset outcome remains live", () => {
  const live = makeState();
  tick(live.state, live.services);
  setCharge(live.state, 0, 0, 1);
  setCharge(live.state, 1, 0, 0);
  tick(live.state, live.services);
  deepEqual(charges(live.state), [[4], [3]]);
  equal(live.state.battle?.outcome, null);

  for (const outcome of [0, 2]) {
    const decided = makeState();
    tick(decided.state, decided.services);
    globals(decided.state).finishonturn = 1;
    globals(decided.state).finishcode = outcome;
    setCharge(decided.state, 0, 0, 123);
    setCharge(decided.state, 1, 0, 75);
    tick(decided.state, decided.services);
    equal(decided.state.battle?.outcome, outcome);
    equal(globals(decided.state).turncount, 2, "later ready fighters in the deciding pass still act");
    tick(decided.state, decided.services);
    equal(globals(decided.state).turncount, 2, `outcome ${outcome} prevents another pass`);
  }

});

test("battleDecided distinguishes unset from outcomes 0 and 2, including after save restore", () => {
  for (const outcome of [null, 0, 2] as const) {
    const rig = makeState();
    startUntilFirstSleep(rig);
    globals(rig.state).finishcode = outcome ?? -1;
    startThread(rig.state.vm, { ref: fileProgramRef(loader, "battle-decision.prg"), kind: "persistent", owner: "world" });
    tick(rig.state, rig.services);
    equal(globals(rig.state).beforedecision, 0, "an unset null outcome is not decided");
    equal(rig.state.battle?.outcome, outcome);
    equal(globals(rig.state).afterdecision, outcome === null ? 0 : 1, `outcome ${outcome} helper result`);

    const { state: restored, services: restoredServices } = restoreRig(snapshot(rig.state), rig.seed);
    equal(restored.battle?.outcome, outcome, `restored outcome ${outcome} is preserved`);
    if (outcome === null) {
      startThread(restored.vm, { ref: fileProgramRef(loader, "battle-decision-read.prg"), kind: "persistent", owner: "world" });
      tick(restored, restoredServices);
      equal(globals(restored).restoreddecision, 0, "unset outcome remains undecided after restore");
    }
  }
});

test("a sleeping battle hook and loop state round-trip exactly at every pass and mid-turn", () => {
  const uninterrupted = makeState({ seed: 603, enemies: 2, players: 2 });
  tick(uninterrupted.state, uninterrupted.services);
  setCharge(uninterrupted.state, 0, 0, 123);
  globals(uninterrupted.state).turnsleepticks = 3;
  const firstPassSteps = tick(uninterrupted.state, uninterrupted.services);
  ok(firstPassSteps < STEP_BUDGET);
  const duringTurn = snapshot(uninterrupted.state);
  const { state: restored, services: restoredServices } = restoreRig(duringTurn, 603);
  equal(hashGameState(restored), hashGameState(uninterrupted.state));
  for (let index = 0; index < 5; index += 1) {
    const stepRestore = restoreRig(snapshot(uninterrupted.state), 603);
    tick(uninterrupted.state, uninterrupted.services);
    tick(restored, restoredServices);
    tick(stepRestore.state, stepRestore.services);
    equal(hashGameState(restored), hashGameState(uninterrupted.state), `continuous restored branch after tick ${index}`);
    equal(hashGameState(stepRestore.state), hashGameState(uninterrupted.state), `one-step restore replay after tick ${index}`);
  }
});

test("idle nine-fighter passes do not exceed the 701-step BAT-4 baseline, with or without cached statuses", () => {
  for (const [enemies, players, withStatus, expectedSteps] of [
    [5, 4, false, 701],
    [5, 4, true, 701],
    [4, 4, false, 626],
    [4, 4, true, 626],
    [3, 3, false, 476],
  ] as const) {
    const statuses = withStatus ? { "inert.ste": 0 } : {};
    const rig = makeState({ seed: 71, enemies, players, enemyStatuses: statuses, playerStatuses: statuses });
    const poll = statusPoll(rig.state, { "inert.ste": [0, 0, 0] });
    settleStartupPass(rig, poll); // excludes seeded status reads and one-time watcher registration
    for (const party of [0, 1] as const) {
      for (let index = 0; index < rig.state.battle!.parties[party].length; index += 1) setCharge(rig.state, party, index, 0);
    }
    for (let pass = 1; pass <= 2; pass += 1) {
      const beforeTick = rig.state.time.tick;
      const beforeSteps = ownerSteps(rig.state, "stock_battle");
      tick(rig.state, rig.services, STEP_BUDGET, poll);
      equal(rig.state.time.tick - beforeTick, 1);
      deepEqual(charges(rig.state), [Array<number>(enemies).fill(pass * 3), Array<number>(players).fill(pass * 3)],
        `${enemies}+${players}, statuses=${withStatus}: every fighter advances exactly once in this tick`);
      ok(rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"), "the complete pass reaches its tick sleep");
      ok(ownerSteps(rig.state, "stock_battle") - beforeSteps <= expectedSteps,
        `idle pass stayed within the ${expectedSteps}-step BAT-4 baseline`);
      ok(expectedSteps <= STEP_BUDGET - 250, `idle pass retains at least 250 of ${STEP_BUDGET} steps`);
      equal(globals(rig.state).turncount, 0);
    }
  }
});
test("ready passes stay within their established 712/747-step baseline", () => {
  for (const [count, expectedSteps] of [[0, 715], [1, 750], [4, 750]] as const) {
    const names = ["a.ste", "b.ste", "c.ste", "d.ste"].slice(0, count);
    const statuses = Object.fromEntries(names.map((name) => [name, 0]));
    const definitions = Object.fromEntries(names.map((name) => [name, { rounds: 0 }]));
    const rig = makeState({
      seed: 71, enemies: 5, players: 4,
      enemyStatuses: statuses, playerStatuses: statuses,
    });
    const poll = statusPoll(rig.state, definitions);
    settleStartupPass(rig, poll);
    for (const party of [0, 1] as const) {
      for (let index = 0; index < rig.state.battle!.parties[party].length; index += 1) {
        setCharge(rig.state, party, index, 0);
      }
    }
    setCharge(rig.state, 0, 0, 123);
    globals(rig.state).turnnoop = 1;
    const beforeSteps = ownerSteps(rig.state, "stock_battle");
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    const measured = ownerSteps(rig.state, "stock_battle") - beforeSteps;
    ok(measured <= expectedSteps,
      `${count} inert statuses on each of nine fighters stayed within the ${expectedSteps}-step baseline, used ${measured}`);
    ok(measured <= STEP_BUDGET, `the ready pass with ${count} cached statuses used ${measured} of ${STEP_BUDGET} stock_battle steps`);
    ok(rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"), "the complete pass reaches its tick sleep");
    equal(globals(rig.state).turncount, 0);
  }
});

test("an inert status still expires on its charged turn", () => {
  const rig = makeState({ enemyStatuses: { "inert.ste": 2 } });
  const poll = statusPoll(rig.state, { "inert.ste": { rounds: 1 } });
  startUntilFirstSleep(rig, poll);
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "inert.ste", 1);
  setCharge(rig.state, 0, 0, 123);
  globals(rig.state).turnnoop = 1;
  for (let attempt = 0; attempt < 3 && Object.keys(rig.state.actors.actors[0]!.statuses).length > 0; attempt += 1) {
    tick(rig.state, rig.services, STEP_BUDGET, poll);
  }
  deepEqual(rig.state.actors.actors[0]?.statuses, {}, "the no-effect status still ages to expiry");
  equal(globals(rig.state).turncount, 0);
});

test("a budget-preempted status pass restores and resumes as plain deterministic state", () => {
  const names = ["a.ste", "b.ste", "c.ste", "d.ste"];
  const statuses = Object.fromEntries(names.map((name) => [name, 0]));
  const definitions = Object.fromEntries(names.map((name) => [name, { rounds: 0 }]));
  const rig = makeState({
    seed: 733, enemies: 5, players: 4,
    enemyStatuses: statuses, playerStatuses: statuses,
  });
  const poll = statusPoll(rig.state, definitions);
  startUntilFirstSleep(rig, poll);
  for (const party of [0, 1] as const) {
    for (let index = 0; index < rig.state.battle!.parties[party].length; index += 1) {
      setCharge(rig.state, party, index, 0);
    }
  }
  setCharge(rig.state, 0, 0, 123);
  globals(rig.state).turnnoop = 1;
  tick(rig.state, rig.services, 50, poll);
  ok(!rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"), "50 steps preempt before the pass completes");
  const restored = restoreRig(snapshot(rig.state), rig.seed);
  const restoredPoll = statusPoll(restored.state, definitions);
  equal(hashGameState(restored.state), hashGameState(rig.state));
  for (let elapsed = 0; elapsed < 128; elapsed += 1) {
    tick(rig.state, rig.services, 50, poll);
    tick(restored.state, restored.services, 50, restoredPoll);
    equal(hashGameState(restored.state), hashGameState(rig.state), `preempted pass restore at tick ${elapsed}`);
    if (rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep")) return;
  }
  throw new Error("preempted status pass did not reach its tick sleep");
});

test("per-round effects replay deterministically from the same seed", () => {
  function play(seed: number): GameState {
    const rig = makeState({ seed, enemyStatuses: { "A.ste": 2, "b.ste": 2 } });
    const poll = statusPoll(rig.state, {
      "A.ste": { rounds: 2, hp: 1, hpAmount: 2, smp: 1, smpAmount: 1 },
      "b.ste": { rounds: 2, hp: 1, hpAmount: 3, smp: 1, smpAmount: 2 },
    });
    startUntilFirstSleep(rig, poll);
    setCharge(rig.state, 0, 0, 123);
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    return rig.state;
  }
  const first = play(719);
  const replay = play(719);
  const otherSeed = play(720);
  equal(hashGameState(first), hashGameState(replay));
  equal(hashGameState(first) === hashGameState(otherSeed), false);
});


test("fake-host multi-tick catch-up matches the same sequence of engine ticks and hashes", () => {
  const stepped = makeState({ seed: 441, enemies: 2, players: 2 });
  const caughtUp = makeState({ seed: 441, enemies: 2, players: 2 });
  const hashes: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    tick(stepped.state, stepped.services);
    hashes.push(hashGameState(stepped.state));
  }
  // Bursts model a lagged host catching up; every missed tick remains an ordinary engine tick.
  let tickIndex = 0;
  for (const missedTicks of [4, 1, 5]) {
    for (let count = 0; count < missedTicks; count += 1) {
      tick(caughtUp.state, caughtUp.services);
      equal(hashGameState(caughtUp.state), hashes[tickIndex], `caught-up state after engine tick ${tickIndex + 1}`);
      tickIndex += 1;
    }
  }
  equal(tickIndex, 10);
});

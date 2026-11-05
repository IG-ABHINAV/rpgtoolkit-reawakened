import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { UI_PLUGIN } from "../src/script/packs/ui.ts";
import {
  addActor,
  advanceScriptTick,
  assetKey,
  BATTLE_PLUGIN,
  BinaryWriter,
  CORE_PLUGIN,
  createAssetIndex,
  createBattleOwner,
  createGameState,
  createScriptServices,
  defaultWaitPoll,
  PACKAGE_ROOT,
  startProgram,
  WORLD_PLUGIN,
  type GameState,
  type ProgramLoader,
  type WaitPoll,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const authoredDirectory = join(testDirectory, "fixtures", "authored");
const fixture = (name: string): string => readFileSync(join(authoredDirectory, name), "utf8");
const programSources = {
  "battle-outcome-run-program.prg": fixture("battle-outcome-run-program.prg"),
  "battle-outcome-win-program.prg": fixture("battle-outcome-win-program.prg"),
  "battle-outcome-game-over.prg": fixture("battle-outcome-game-over.prg"),
  "battle-outcome-game-over-restart.prg": fixture("battle-outcome-game-over-restart.prg"),
};
const programBytes = Object.fromEntries(Object.entries(programSources).map(([name, source]) =>
  [assetKey(`Prg/${name}`), new TextEncoder().encode(source)]));
const loader: ProgramLoader = {
  index: createAssetIndex(Object.keys(programBytes)),
  root: PACKAGE_ROOT,
  read: (key) => programBytes[key],
};
const plugins = [{ definition: CORE_PLUGIN }, { definition: BATTLE_PLUGIN }, { definition: UI_PLUGIN }, { definition: WORLD_PLUGIN }] as const;

function putBoundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(values.length === 0 ? -1 : values.length - 1);
  for (const value of values) writer.str(value);
}
function characterBytes(levelUpProgram = ""): Uint8Array {
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
  writer.str(levelUpProgram);
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


function enemyBytes(options: { experience?: number; gold?: number; winProgram?: string; runProgram?: string } = {}): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT ENEMY");
  writer.i16(2);
  writer.i16(1);
  writer.str("Slime");
  for (const value of [8, 3, 3, 2]) writer.i32(value);
  writer.i8(1);
  writer.i16(-1);
  writer.i16(-1);
  putBoundedStrings(writer, []);
  putBoundedStrings(writer, []);
  putBoundedStrings(writer, []);
  writer.i8(0);
  writer.i8(0);
  writer.str("");
  writer.i32(options.experience ?? 0);
  writer.i32(options.gold ?? 0);
  writer.str(options.winProgram ?? "");
  writer.str(options.runProgram ?? "");
  putBoundedStrings(writer, ["", "", "", "", "", ""]);
  writer.i32(-1);
  return writer.toBytes();
}

function makeState(): GameState {
  const state = createGameState({ seed: 11 });
  const enemy = addActor(state.actors, {
    kind: "enemy", source: "slime.ene", name: "Slime",
    statuses: { "late.ste": 0 },
    stats: { hp: 8, maxHp: 8, smp: 3, maxSmp: 3, dp: 2, fp: 3 },
  });
  const hero = addActor(state.actors, {
    kind: "party", source: "hero.tem", name: "Hero",
    statuses: { "late.ste": 0 },
    stats: { experience: 0, hp: 10, maxHp: 20, smp: 4, maxSmp: 8, dp: 3, fp: 2, level: 1 },
    progression: {
      levelType: 10,
      nextRequirement: 10,
      remainingExperience: 10,
      maxLevel: 10,
      experienceIncrease: 100,
      levelHp: 0,
      levelDp: 0,
      levelFp: 0,
      levelSm: 0,
      levelUpType: 1,
    },
  });
  addActor(state.actors, {
    kind: "party", source: "bystander.tem", name: "Bystander",
    statuses: { "late.ste": 0 },
    stats: { hp: 10, maxHp: 10, smp: 0, maxSmp: 0, dp: 0, fp: 0 },
  });
  state.party.members = [hero.id];
  state.party.selected = hero.id;
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "night.bkg",
    canRun: true,
    outcome: null,
    parties: [
      [{ party: 0, actorId: enemy.id, charge: 123 }],
      [{ party: 1, actorId: hero.id, charge: 75 }],
    ],
  };
  return state;
}


/** `makeState` with no battle section: the fight has to start through the owner. */
function idleState(): GameState {
  const state = makeState();
  state.battle = null;
  return state;
}

function runOutcome(state: GameState, source: string, options: { readonly gameOverProgram?: string | null; readonly enemy?: Uint8Array } = {}) {
  const services = createScriptServices(
    state, plugins, undefined, undefined, loader, "default", undefined, undefined,
    undefined, undefined, false, undefined, undefined, undefined, options.gameOverProgram ?? null,
  );
  const thread = startProgram(state.vm, { kind: "inline", text: source, ir: "1" });
  thread.source = "Hero";
  thread.target = "Slime";
  const enemy = Array.from(options.enemy ?? enemyBytes(), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const character = Array.from(characterBytes(), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const poll: WaitPoll = (view, wait) => {
    if (wait.kind !== "request") return defaultWaitPoll(view, wait);
    const bytes = wait.then?.command === "__battle_enemy_data_asset" || wait.then?.command === "__battle_start_enemy_asset" ? enemy : character;
    return { ok: true, value: bytes };
  };
  let finished = false;
  for (let tick = 0; tick < 80; tick += 1) {
    if (advanceScriptTick(state, services, undefined, poll) === "finished") {
      finished = true;
      break;
    }
  }
  return { finished, services };
}

test("the core win adapter awards XP, posts one gold effect and runs the enemy win program", () => {
  const state = makeState();
  const result = runOutcome(state, fixture("battle-outcome-win.prg"), {
    enemy: enemyBytes({ experience: 23, gold: 4, winProgram: "battle-outcome-win-program.prg" }),
  });

  equal(result.finished, true);
  deepEqual(result.services.diagnostics.map(({ code }) => code), []);
  equal(state.battle?.outcome, 2);
  equal(state.actors.actors.find((actor) => actor.name === "Hero")?.stats.experience, 23);
  equal(state.actors.actors.find((actor) => actor.name === "Hero")?.stats.level, 2);
  equal(state.vm.globals.winprogramcount, 1);
  const gold = state.vm.effects.filter((effect) => effect.kind === "state-write" && effect.patch?.section === "inventory");
  equal(gold.length, 1);
  deepEqual(gold[0]?.args, [{ type: "addGold", amount: 4 }]);
  const messages = state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]);
  ok(messages.indexOf("Gained 23 experience.") < messages.indexOf("Hero gained a level"));
  ok(messages.indexOf("Hero gained a level") < messages.indexOf("Gained 4 GP."));
});

test("the core run adapter grants no rewards and runs the enemy run-away program", () => {
  const state = makeState();
  const result = runOutcome(state, fixture("battle-outcome-run.prg"), {
    enemy: enemyBytes({ experience: 23, gold: 4, runProgram: "battle-outcome-run-program.prg" }),
  });

  equal(result.finished, true);
  deepEqual(result.services.diagnostics.map(({ code }) => code), []);
  equal(state.battle?.outcome, 0);
  equal(state.actors.actors.find((actor) => actor.name === "Hero")?.stats.experience, 0);
  equal(state.vm.globals.runprogramcount, 1);
  equal(state.vm.effects.some((effect) => effect.kind === "state-write" && effect.patch?.section === "inventory"), false);
});

test("the core loss adapter clears battle before the game-over program and skips reset", () => {
  const state = makeState();
  const result = runOutcome(state, fixture("battle-outcome-lose.prg"), { gameOverProgram: "battle-outcome-game-over.prg" });

  equal(result.finished, true);
  deepEqual(result.services.diagnostics.map(({ code }) => code), []);
  equal(state.battle, null);
  equal(state.vm.globals.gameoverprogramcount, 1);
  equal(state.vm.effects.some((effect) => effect.kind === "state-write" && effect.patch?.section === "engine" && effect.args[0] === "reset"), false);
});

test("the core loss adapter uses the message and reset fallback without a game-over program", () => {
  const state = makeState();
  const result = runOutcome(state, fixture("battle-outcome-lose.prg"));

  equal(result.finished, true);
  deepEqual(result.services.diagnostics.map(({ code }) => code), []);
  equal(state.battle, null);
  ok(state.vm.effects.some((effect) => effect.name === "mwin" && effect.args[0] === "Game over."));
  equal(state.vm.effects.some((effect) => effect.kind === "state-write" && effect.patch?.section === "engine" && effect.args[0] === "reset"), true);
});

test("a game-over program that starts another battle after a loss takes an unused identifier", () => {
  const state = idleState();
  state.world = {
    ...state.world,
    board: {
      key: assetKey("boards/test.brd"), coordType: 0, sizeX: 1, sizeY: 1, sizeL: 1, width: 1, height: 1,
      background: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 }, layers: [],
    },
  };
  const enemy = state.actors.actors.find((actor) => actor.kind === "enemy");
  const hero = state.actors.actors.find((actor) => actor.kind === "party");
  if (enemy === undefined || hero === undefined) throw new Error("actors missing");
  // Start the first battle through the owner so the run's counter is set, exactly as
  // `fightenemy` does; a hand-made section in `makeState` would skip it.
  const owner = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
    readBattleCounter: () => state.engine.nextBattleId,
    commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
  });
  const first = owner.start({ boardKey: "boards/test.brd", background: "night.bkg", canRun: true, enemies: [enemy.id], players: [hero.id] });
  ok(first.ok);
  const firstId = first.value.id;
  equal(state.engine.nextBattleId, firstId + 1);

  const result = runOutcome(state, fixture("battle-outcome-lose.prg"), { gameOverProgram: "battle-outcome-game-over-restart.prg" });

  equal(result.finished, true);
  deepEqual(result.services.diagnostics.map(({ code }) => code), []);
  equal(state.vm.globals.gameoverrestartcount, 1);
  const remaining = state.battle;
  if (remaining === null) throw new Error("the game-over program's battle is the remaining section");
  equal(remaining.outcome, null);
  ok(remaining.id !== firstId, `battle identifier ${remaining.id} reuses the earlier ${firstId} in one run`);
  equal(state.engine.nextBattleId, remaining.id + 1);
});

function statusesNamed(state: GameState, name: string): Record<string, number> {
  const actor = state.actors.actors.find((candidate) => candidate.name === name);
  if (actor === undefined) throw new Error(`actor ${name} is missing from the actor section`);
  return { ...actor.statuses };
}

test("the core outcome adapter ends every participant's statuses for codes 0 through 4, including handled 1 and 3", () => {
  const cases = [
    { name: "automatic run", program: fixture("battle-outcome-run.prg"), code: 0 },
    { name: "handled run", program: "battle.finish(1)", code: 1 },
    { name: "automatic win", program: fixture("battle-outcome-win.prg"), code: 2 },
    { name: "handled win", program: "battle.finish(3)", code: 3 },
    { name: "loss", program: fixture("battle-outcome-lose.prg"), code: 4 },
  ] as const;
  for (const entry of cases) {
    const state = makeState();
    const result = runOutcome(state, entry.program, { gameOverProgram: "battle-outcome-game-over.prg" });
    equal(result.finished, true, entry.name);
    deepEqual(result.services.diagnostics.map(({ code }) => code), [], entry.name);
    deepEqual(statusesNamed(state, "Hero"), {}, `${entry.name} clears the player participant's statuses`);
    deepEqual(statusesNamed(state, "Slime"), {}, `${entry.name} clears the enemy participant's statuses`);
    deepEqual(statusesNamed(state, "Bystander"), { "late.ste": 0 }, `${entry.name} keeps a nonparticipant's statuses`);
  }
});

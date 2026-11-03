import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  addActor,
  advanceScriptTick,
  applyUiEffect,
  assetKey,
  BATTLE_PLUGIN,
  BinaryWriter,
  composeUi,
  CORE_PLUGIN,
  createAssetIndex,
  createGameState,
  createScriptServices,
  defaultWaitPoll,
  GRAPHICS_PLUGIN,
  hashDrawList,
  hashState,
  MOVEMENT_PLUGIN,
  PACKAGE_ROOT,
  restoreGameState,
  runEventsPhase,
  snapshot,
  startProgram,
  STATUS_EFFECT_MAGIC,
  UI_PLUGIN,
  type DrawList,
  type GameState,
  type ProgramLoader,
  type ScriptServices,
  type WaitPoll,
} from "../src/index.ts";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authored");
const customFight = readFileSync(join(fixtureDirectory, "battle-custom-api.prg"), "utf8");
const plugins = [
  { definition: CORE_PLUGIN },
  { definition: BATTLE_PLUGIN },
  { definition: UI_PLUGIN },
  { definition: GRAPHICS_PLUGIN },
  { definition: MOVEMENT_PLUGIN },
] as const;

function statusEffectBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("Custom fight status");
  writer.i16(2);
  for (const value of [0, 0, 0, 0, 0, 0, 0, 0]) writer.i16(value);
  writer.str("");
  return writer.toBytes();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function putBoundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(values.length === 0 ? -1 : values.length - 1);
  for (const value of values) writer.str(value);
}

function characterBytes(): Uint8Array {
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

function enemyBytes(): Uint8Array {
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
  writer.i32(23);
  writer.i32(4);
  writer.str("battle-outcome-win-program.prg");
  writer.str("battle-outcome-run-program.prg");
  putBoundedStrings(writer, ["", "", "", "", "", ""]);
  writer.i32(-1);
  return writer.toBytes();
}

const outcomeProgramBytes = Object.fromEntries(
  ["battle-outcome-run-program.prg", "battle-outcome-win-program.prg", "battle-outcome-game-over.prg"]
    .map((name) => [assetKey(`Prg/${name}`), new TextEncoder().encode(readFileSync(join(fixtureDirectory, name), "utf8"))]),
);
const outcomeLoader: ProgramLoader = {
  index: createAssetIndex(Object.keys(outcomeProgramBytes)),
  root: PACKAGE_ROOT,
  read: (key) => outcomeProgramBytes[key],
};

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly threadId: number;
  readonly poll: WaitPoll;
  releaseInput(): void;
};


function makeRig(seed: number, outcomeCode = 1, gameOverProgram: string | null = null): Rig {
  const state = createGameState({ seed });
  const enemy = addActor(state.actors, {
    kind: "enemy", source: "slime-a.ene", name: "Slime A",
    stats: { hp: 8, maxHp: 8, smp: 3, maxSmp: 3, dp: 2, fp: 3 },
  });
  const enemy2 = addActor(state.actors, {
    kind: "enemy", source: "slime-b.ene", name: "Slime B",
    stats: { hp: 8, maxHp: 8, smp: 3, maxSmp: 3, dp: 2, fp: 3 },
  });
  const hero = addActor(state.actors, {
    kind: "party", source: "hero-a.tem", name: "Hero",
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
  const hero2 = addActor(state.actors, {
    kind: "party", source: "hero-b.tem", name: "Hero B",
    stats: { experience: 0, hp: 12, maxHp: 20, smp: 2, maxSmp: 5, dp: 1, fp: 4, level: 1 },
  });
  state.party.members = [hero.id, hero2.id];
  state.party.selected = hero.id;
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "night.bkg",
    canRun: true,
    outcome: null,
    parties: [
      [
        { party: 0, actorId: enemy.id, charge: 123 },
        { party: 0, actorId: enemy2.id, charge: 60 },
      ],
      [
        { party: 1, actorId: hero.id, charge: 75 },
        { party: 1, actorId: hero2.id, charge: 12 },
      ],
    ],
  };
  state.vm.globals.outcomecode = outcomeCode;
  const services = createScriptServices(
    state, plugins, undefined, undefined, outcomeLoader, "default", undefined, undefined,
    undefined, undefined, false, undefined, undefined, undefined, gameOverProgram,
  );
  const thread = startProgram(state.vm, { kind: "inline", text: customFight, ir: "1" });
  let inputReady = false;
  const encodedStatus = hex(statusEffectBytes());
  const encodedEnemy = hex(enemyBytes());
  const encodedCharacter = hex(characterBytes());
  const poll: WaitPoll = (view, wait) => {
    if (wait.kind === "request") {
      const value = wait.then?.command === "__battle_status_asset"
        ? encodedStatus
        : wait.then?.command === "__battle_enemy_data_asset"
          ? encodedEnemy
          : encodedCharacter;
      return { ok: true, value };
    }
    if (wait.kind === "input.key") return inputReady ? { ok: true, value: "Enter" } : null;
    return defaultWaitPoll(view, wait);
  };

  return {
    state,
    services,
    threadId: thread.id,
    poll,
    releaseInput: () => { inputReady = true; },
  };
}

function threadOf(rig: Rig) {
  const thread = rig.state.vm.threads.find((candidate) => candidate.id === rig.threadId);
  if (thread === undefined) throw new Error("custom fight thread disappeared");
  return thread;
}

function runToInput(rig: Rig): void {
  for (let tick = 0; tick < 80; tick += 1) {
    advanceScriptTick(rig.state, rig.services, undefined, rig.poll);
    if (threadOf(rig).wait?.kind === "input.key") return;
    if (threadOf(rig).status === "finished") break;
  }
  throw new Error("custom fight did not reach its input wait");
}

function resumeToFinish(rig: Rig): void {
  rig.releaseInput();
  for (let tick = 0; tick < 80; tick += 1) {
    advanceScriptTick(rig.state, rig.services, undefined, rig.poll);
    runEventsPhase(rig.state, rig.services);
    if (threadOf(rig).status === "finished" && rig.state.events.queue.length === 0 && rig.state.events.dispatch === null) return;
  }
  throw new Error("custom fight did not finish");
}
function runCustomOutcome(outcomeCode: number, gameOverProgram: string | null = null): Rig {
  const rig = makeRig(11, outcomeCode, gameOverProgram);
  runToInput(rig);
  resumeToFinish(rig);
  return rig;
}
function applyUiEffects(state: GameState): void {
  for (const effect of state.vm.effects) {
    if (effect.patch?.section === "ui") applyUiEffect(state, effect.name, effect.args);
  }
}
function drawListFor(state: GameState): DrawList {
  return {
    tick: state.time.tick,
    width: 640,
    height: 480,
    commands: composeUi(state.ui, 640, 480, state.input, false),
  };
}



test("custom fight program drives the public battle and actor APIs without stock package internals", () => {

  const rig = makeRig(11);
  runToInput(rig);
  equal(threadOf(rig).wait?.kind, "input.key");

  resumeToFinish(rig);
  applyUiEffects(rig.state);
  deepEqual(rig.services.diagnostics.map(({ code }) => code), []);
  equal(rig.state.vm.globals.coverage, "party-size;battle-read;charge;stats;status;damage-defeated;draw;input;finish;");
  equal(rig.state.vm.globals.enemycount, 2);
  equal(rig.state.vm.globals.herocount, 2);
  equal(rig.state.vm.globals.initialoutcome, 0);
  equal(rig.state.vm.globals.runallowed, 1);
  equal(rig.state.vm.globals.battlebackground, "night.bkg");
  equal(rig.state.vm.globals.initialenemycharge, 123);
  equal(rig.state.vm.globals.addedenemycharge, 131);
  equal(rig.state.vm.globals.releasedenemycharge, 0);
  equal(rig.state.vm.globals.enemypercent, 18);
  equal(rig.state.vm.globals.heropercent, 100);
  equal(rig.state.vm.globals.herohp, 9);
  equal(rig.state.vm.globals.heromaxhp, 21);
  equal(rig.state.vm.globals.herosmp, 5);
  equal(rig.state.vm.globals.heromaxsmp, 9);
  equal(rig.state.vm.globals.herofp, 6);
  equal(rig.state.vm.globals.herodp, 7);
  equal(rig.state.vm.globals.statusname, "custom-fight.ste");
  equal(rig.state.vm.globals.statuschanges, 2);
  equal(rig.state.vm.globals.enemydamage, 8);
  equal(rig.state.vm.globals.enemy2damage, 8);
  equal(rig.state.vm.globals.enemydefeated, 1);
  equal(rig.state.vm.globals.enemy2defeated, 1);
  equal(typeof rig.state.vm.globals.seededroll, "number");
  equal(rig.state.vm.globals.pressed, "Enter");
  equal(rig.state.battle?.outcome, 1);
  deepEqual(rig.state.actors.actors.find((actor) => actor.name === "Hero")?.statuses, {});
  equal(rig.state.actors.actors.find((actor) => actor.name === "Slime A")?.stats.hp, 0);
  ok(rig.state.ui.draws.some((draw) => draw.text.startsWith("Custom fight ")));
});
test("custom fight seed and mid-battle save restore preserve state and drawing", () => {
  const first = makeRig(11);
  const repeated = makeRig(11);
  const differentSeed = makeRig(12);
  for (const rig of [first, repeated, differentSeed]) {
    runToInput(rig);
    applyUiEffects(rig.state);
    equal(rig.state.battle?.outcome, null);
    equal(threadOf(rig).wait?.kind, "input.key");
  }

  const stateHash = hashState(first.state);
  const drawHash = hashDrawList(drawListFor(first.state));
  equal(stateHash, hashState(repeated.state));
  equal(drawHash, hashDrawList(drawListFor(repeated.state)));
  equal(stateHash === hashState(differentSeed.state), false);
  equal(drawHash === hashDrawList(drawListFor(differentSeed.state)), false);
  equal(stateHash, "c6fc4fe298af5b85"); // re-pinned by #1231 (party schema 3 adds the saved step remainder); was e36da5195180fde2 (#585), draw hash unchanged
  equal(drawHash, "3fa17af6365a9ba5");

  const restoredState = restoreGameState(snapshot(first.state));
  const restoredRig: Rig = {
    state: restoredState,
    services: createScriptServices(restoredState, plugins),
    threadId: first.threadId,
    poll: first.poll,
    releaseInput: first.releaseInput,
  };
  resumeToFinish(first);
  resumeToFinish(restoredRig);
  deepEqual(first.services.diagnostics.map(({ code }) => code), []);
  deepEqual(restoredRig.services.diagnostics.map(({ code }) => code), []);
  equal(hashState(first.state), hashState(restoredState));
  equal(first.state.battle?.outcome, 1);
  equal(restoredState.battle?.outcome, 1);
});
test("custom fight finish routes outcomes 0, 2 and 4 through the adapter and leaves 1 and 3 alone", () => {
  const runAway = runCustomOutcome(0);
  deepEqual(runAway.services.diagnostics.map(({ code }) => code), []);
  equal(runAway.state.battle?.outcome, 0);
  equal(runAway.state.vm.globals.runprogramcount, 1);
  equal(runAway.state.vm.globals.winprogramcount, undefined);
  equal(runAway.state.vm.effects.some((effect) => effect.patch?.section === "inventory"), false);

  const win = runCustomOutcome(2);
  deepEqual(win.services.diagnostics.map(({ code }) => code), []);
  equal(win.state.battle?.outcome, 2);
  deepEqual(
    win.state.actors.actors.filter((actor) => actor.kind === "party").map((actor) => actor.stats.experience),
    [46, 46],
  );
  equal(win.state.vm.globals.winprogramcount, 1);
  deepEqual(
    win.state.vm.effects.filter((effect) => effect.patch?.section === "inventory").map((effect) => effect.args[0]),
    [{ type: "addGold", amount: 8 }],
  );

  const loss = runCustomOutcome(4, "battle-outcome-game-over.prg");
  deepEqual(loss.services.diagnostics.map(({ code }) => code), []);
  equal(loss.state.battle, null);
  equal(loss.state.vm.globals.gameoverprogramcount, 1);
  equal(loss.state.vm.effects.some((effect) => effect.patch?.section === "engine" && effect.args[0] === "reset"), false);

  for (const outcomeCode of [1, 3]) {
    const handled = runCustomOutcome(outcomeCode);
    deepEqual(handled.services.diagnostics.map(({ code }) => code), []);
    equal(handled.state.battle?.outcome, outcomeCode);
    equal(handled.state.vm.globals.runprogramcount, undefined);
    equal(handled.state.vm.globals.winprogramcount, undefined);
    equal(handled.state.vm.globals.gameoverprogramcount, undefined);
    equal(handled.state.vm.effects.some((effect) => effect.patch?.section === "inventory"), false);
    equal(handled.state.vm.effects.some((effect) => effect.patch?.section === "engine" && effect.args[0] === "reset"), false);
  }
});

test("a custom program cannot resolve stock battle internals without the package", () => {
  const state = createGameState({ seed: 7 });
  const services = createScriptServices(state, plugins);
  const thread = startProgram(state.vm, { kind: "inline", text: "stockBattle.turn(0, 0)", ir: "1" });

  advanceScriptTick(state, services);
  equal(thread.status, "finished");
  equal(services.diagnostics[0]?.code, "include.missing");
});

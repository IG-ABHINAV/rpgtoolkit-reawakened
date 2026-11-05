import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assetKey,
  createEmptyBoard,
  createGameState,
  EffectBus,
  enqueueDirectionMove,
  hydrateSprites,
  nextUint32,
  randomEncounterPhaseRegistration,
  restoreGameState,
  runRandomEncounterPhase,
  runTriggersPhase,
  runMovementPhase,
  snapshot,
  type GameState,
  type MainFileEnemy,
  type RandomEncounterConfig,
  type WorldBoard,
} from "../src/index.ts";
import { IR_VERSION } from "../src/script/program.ts";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
type FixtureBoard = {
  readonly w: number;
  readonly h: number;
  readonly pixelMovement: number;
  readonly gameSpeed: number;
  readonly battle?: { readonly allowed: boolean; readonly type: number; readonly chances: number; readonly skill: number; readonly background: string };
  readonly programs?: readonly { readonly id: string; readonly type: string; readonly layer: number; readonly points: readonly [number, number][]; readonly program: string }[];
};
type FixturePlayer = { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"; readonly controlled?: boolean };
type FixtureCase = {
  readonly name: string;
  readonly setup: {
    readonly board: string;
    readonly boards: Record<string, FixtureBoard>;
    readonly players: readonly FixturePlayer[];
    readonly fightEnabled?: boolean;
    readonly encounterTable?: readonly { readonly enemy: string; readonly skill: number }[];
    readonly customFight?: string | null;
  };
  readonly script: readonly { readonly t: number; readonly op: string; readonly actor?: string; readonly dirs?: string }[];
  readonly ticks: number;
};
type Fixture = { readonly cases: readonly FixtureCase[] };

function makeBoard(name: string, source: FixtureBoard): WorldBoard {
  const empty = createEmptyBoard();
  const programs = (source.programs ?? []).map((program) => ({
    handle: program.id, program: program.program, graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
    activate: 1, activationType: 1, repeatDistance: 0, layer: program.layer, closed: 1, points: program.points.map(([x, y]) => ({ x, y })),
  }));
  return {
    ...(empty as unknown as WorldBoard), key: assetKey(`boards/${name}.brd`), coordType: 0, sizeX: Math.ceil(source.w / 32), sizeY: Math.ceil(source.h / 32),
    sizeL: 2, width: source.w, height: source.h, layers: [], vectors: [], programs, items: [],
    allowBattles: source.battle?.allowed ? 1 : 0, battleSkill: source.battle?.skill ?? 0, battleBackground: source.battle?.background ?? "",
  };
}

function setup(caseData: FixtureCase, seed: number): { state: GameState; board: WorldBoard; config: RandomEncounterConfig } {
  const source = caseData.setup.boards[caseData.setup.board]!;
  const board = makeBoard(caseData.setup.board, source);
  const sprites = hydrateSprites({ board, players: caseData.setup.players.map((player) => ({ ...player, kind: "player" as const, source: `${player.id}.tem` })) });
  sprites.players = sprites.players.map((actor, index) => ({ ...actor, speed: caseData.setup.players[index]!.speed }));
  const state = createGameState({ seed });
  state.world = { ...state.world, board };
  state.sprites = sprites;
  const enemies: MainFileEnemy[] = (caseData.setup.encounterTable ?? []).map((enemy) => ({ enemyFile: enemy.enemy, skillLevel: enemy.skill }));
  return {
    state,
    board,
    config: {
      fightingDisabled: caseData.setup.fightEnabled === false ? 1 : 0,
      enemies,
      fightType: source.battle?.type ?? 0,
      chances: source.battle?.chances ?? 0,
      useCustomFightPrg: caseData.setup.customFight === null || caseData.setup.customFight === undefined ? 0 : 1,
      customFightPrg: caseData.setup.customFight ?? "",
    },
  };
}

test("random encounter fixtures drive movement, triggers, and random-encounter evaluation", () => {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, "random-encounter.json"), "utf8")) as Fixture;
  for (const caseData of fixture.cases) {
    const { state, board, config } = setup(caseData, 0x511);
    const posted: string[] = [];
    const bus = new EffectBus(state);
    const post = (_section: "battle", effect: Parameters<typeof bus.postEffect>[1]) => {
      posted.push(effect.name);
      bus.postEffect("battle", effect);
    };
    const byTick = new Map<number, typeof caseData.script>();
    for (const command of caseData.script) byTick.set(command.t, [...(byTick.get(command.t) ?? []), command]);
    for (let tick = 0; tick < caseData.ticks; tick += 1) {
      state.time.tick = tick;
      for (const command of byTick.get(tick) ?? []) {
        if (command.actor !== undefined && command.dirs !== undefined) {
          for (const dir of command.dirs.split(",")) enqueueDirectionMove(state.sprites, command.actor, dir as "E", caseData.setup.boards[caseData.setup.board]!.pixelMovement);
        }
      }
      runMovementPhase(state.sprites, board, tick, { gameSpeed: sourceGameSpeed(caseData) });
      runTriggersPhase(state, { programRef: () => ({ kind: "inline", text: "", ir: IR_VERSION }) });
      runRandomEncounterPhase(state, config, post);
    }
    if (config.fightingDisabled === 0 && board.allowBattles === 1) equal(typeof state.sprites.randomEncounter?.tiles, "number", caseData.name);
    else equal(state.sprites.randomEncounter, undefined, caseData.name);
  }
});

test("demo NPC battle fixture runs movement, triggers, and random boundary without stealing scripted battle", () => {
  const demo = JSON.parse(readFileSync(join(fixtureRoot, "demo-npc-battle-trigger.json"), "utf8")) as {
    readonly cases: readonly [{
      readonly setup: { readonly board: string; readonly boards: Record<string, { readonly w: number; readonly h: number; readonly pixelMovement: number }>; readonly players: readonly FixturePlayer[] };
      readonly ticks: number;
    }];
  };
  const fixtureCase = demo.cases[0]!;
  const source = fixtureCase.setup.boards[fixtureCase.setup.board]!;
  const board = makeBoard(fixtureCase.setup.board, { ...source, gameSpeed: 0 });
  const state = createGameState({ seed: 0x511 });
  state.world = { ...state.world, board };
  state.sprites = hydrateSprites({ board, players: fixtureCase.setup.players.map((player) => ({ ...player, kind: "player" as const, source: `${player.id}.tem` })) });
  const posted: string[] = [];
  for (let tick = 0; tick < fixtureCase.ticks; tick += 1) {
    state.time.tick = tick;
    runMovementPhase(state.sprites, board, tick, { gameSpeed: 0 });
    runTriggersPhase(state, { programRef: () => ({ kind: "inline", text: "", ir: IR_VERSION }) });
    runRandomEncounterPhase(state, null, (_section, effect) => posted.push(effect.name));
  }
  equal(state.sprites.randomEncounter, undefined);
  deepEqual(posted, []);
});

function sourceGameSpeed(caseData: Fixture["cases"][number]): number {
  return caseData.setup.boards[caseData.setup.board]?.gameSpeed ?? 0;
}

test("random handoff draw order and snapshot restore are deterministic", () => {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, "random-encounter.json"), "utf8")) as Fixture;
  const caseData = fixture.cases[0]!;
  const left = setup(caseData, 1234);
  const right = setup(caseData, 1234);
  const leftEffects: unknown[] = [];
  const rightEffects: unknown[] = [];
  const leftBus = new EffectBus(left.state);
  const rightBus = new EffectBus(right.state);
  runRandomEncounterPhase(left.state, left.config);
  runRandomEncounterPhase(right.state, right.config);
  left.state.sprites.players[0] = { ...left.state.sprites.players[0]!, x: 80 };
  right.state.sprites.players[0] = { ...right.state.sprites.players[0]!, x: 80 };
  runRandomEncounterPhase(left.state, left.config, (_section, effect) => leftEffects.push(leftBus.postEffect("battle", effect)));
  runRandomEncounterPhase(right.state, right.config, (_section, effect) => rightEffects.push(rightBus.postEffect("battle", effect)));
  deepEqual(leftEffects, rightEffects);
  equal(leftBus.pendingCount("battle"), rightBus.pendingCount("battle"));
  left.state.world = { ...left.state.world, board: {
    key: left.board.key, coordType: 0, sizeX: left.board.sizeX, sizeY: left.board.sizeY, sizeL: 2,
    width: left.board.width, height: left.board.height, layers: [], vectors: [], programs: [], items: [], allowBattles: 1,
  } as unknown as WorldBoard };
  const saved = snapshot(left.state);
  const restored = restoreGameState(saved);
  deepEqual(restored.sprites.randomEncounter, left.state.sprites.randomEncounter);
  equal(snapshot(restored), saved);
});

test("scene registration posts a battle effect through the phase callback", () => {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, "random-encounter.json"), "utf8")) as Fixture;
  const { state, config } = setup(fixture.cases[1]!, 7);
  const posted: string[] = [];
  const registration = randomEncounterPhaseRegistration({ config });
  equal(registration.phase, "triggers");
  state.time.tick = 0;
  registration.run(state);
  state.sprites.players[0] = { ...state.sprites.players[0]!, x: 80 };
  registration.run(state, (_section, effect) => posted.push(effect.name));
  equal(posted.length, 0);
  state.sprites.players[0] = { ...state.sprites.players[0]!, x: 112 };
  registration.run(state, (_section, effect) => posted.push(effect.name));
  equal(posted.includes("battle.randomEncounter"), true);
});

test("a custom encounter's request carries no fighters and the evaluator takes no draw for it beyond the chance roll", () => {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, "random-encounter.json"), "utf8")) as Fixture;
  const caseData = fixture.cases.find((entry) => entry.name === "custom-fight-program");
  if (caseData === undefined) throw new Error("the custom-fight-program case is missing from the fixture");
  for (const [label, fightType, rolls] of [["type 1 (every N tiles) rolls nothing", 1, 0], ["type 0 rolls the chance once", 0, 1]] as const) {
    const { state, config } = setup(caseData, 0x511);
    equal(config.enemies.length > 0, true, "the main file's pool is not empty, and still nothing is drawn from it");
    const custom = { ...config, fightType, chances: 1 };
    const reference = createGameState({ seed: 0x511 }).rng;
    for (let roll = 0; roll < rolls; roll += 1) nextUint32(reference);
    const posted: { readonly name: string; readonly args: readonly unknown[] }[] = [];
    runRandomEncounterPhase(state, custom);
    state.sprites.players[0] = { ...state.sprites.players[0]!, x: 80 };
    runRandomEncounterPhase(state, custom, (_section, effect) => posted.push({ name: effect.name, args: effect.args }));
    deepEqual(posted.map(({ name }) => name), ["battle.customFight"], label);
    const request = posted[0]!.args[0] as Record<string, unknown>;
    deepEqual(Object.keys(request).sort(), ["actor", "board", "program", "trigger"], `${label}: no fighters key`);
    equal(request.program, "fight.prg", label);
    deepEqual(state.rng, reference, label);
  }
});

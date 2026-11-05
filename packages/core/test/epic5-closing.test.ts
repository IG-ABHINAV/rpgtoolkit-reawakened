import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CATALOGUE_PLUGIN,
  CATALOGUE_RESPONDERS_PLUGIN,
  ENGINE_PHASES,
  STEP_BUDGET,
  assetKey,
  clearPathfindingCache,
  composeBoard,
  createEmptyBoard,
  createGameState,
  createInputSection,
  hashDrawList,
  hashState,
  hydrateSprites,
  inputPhaseRegistration,
  inputResetRegistration,
  movementPhaseRegistration,
  enqueuePathMove,
  restoreGameState,
  runMovementPhase,
  snapshot,
  spriteDraws,
  spriteResetRegistration,
  triggerPhaseRegistration,
  triggerResetRegistration,
  type DrawList,
  type GameState,
  type WorldBoard,
} from "../src/index.ts";
import type { Facing } from "../src/sprites/model.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");

type DemoCase = {
  readonly name: string;
  readonly setup: {
    readonly board: string;
    readonly boards: Record<string, {
      readonly w: number;
      readonly h: number;
      readonly layers: number;
      readonly items: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: Facing }[];
    }>;
    readonly players: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: Facing; readonly controlled?: boolean }[];
  };
  readonly ticks: number;
  readonly expect: readonly { readonly t: number; readonly ev?: readonly { readonly e: string; readonly actor?: string }[] }[];
};

type DemoFixture = { readonly cases: readonly DemoCase[] };

type Replay = {
  readonly stateHashes: string[];
  readonly drawHashes: string[];
  readonly movementCompletions: number;
  readonly state: GameState;
};

function demoFixture(name: string): DemoCase {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as DemoFixture;
  return fixture.cases[0]!;
}

function demoBoard(scene: DemoCase): WorldBoard {
  const source = scene.setup.boards[scene.setup.board]!;
  const empty = createEmptyBoard();
  return {
    ...empty,
    key: assetKey(`boards/${scene.setup.board}.brd`),
    width: source.w,
    height: source.h,
    sizeX: Math.ceil(source.w / 32),
    sizeY: Math.ceil(source.h / 32),
    sizeL: source.layers,
    layers: [],
    vectors: [],
    programs: [],
    items: source.items.map((item, slot) => ({
      slot,
      itemFile: item.id,
      activationPrg: "",
      multitaskPrg: "",
      initialVar: "",
      initialValue: "",
      finalVar: "",
      finalValue: "",
      loadingVar: "",
      loadingValue: "",
      activate: 0,
      activationType: 0,
      x: item.x,
      y: item.y,
      layer: item.layer,
      reserved: 0,
    })),
  } as unknown as WorldBoard;
}

function drawHash(state: GameState, board: WorldBoard): string {
  const list = composeBoard({
    board,
    tick: state.time.tick,
    camera: { x: 0, y: 0 },
    viewport: { width: board.width, height: board.height },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: spriteDraws(state.sprites),
  });
  function removeUndefined(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(removeUndefined);
    if (typeof value !== "object" || value === null) return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) if (child !== undefined) result[key] = removeUndefined(child);
    return result;
  }
  return hashDrawList(removeUndefined(list) as DrawList);
}

function runDemo(name: string, goal: { readonly x: number; readonly y: number }, batch: number, flushEvery: number, restoreAt: readonly number[] | null): Replay {
  const scene = demoFixture(name);
  const board = demoBoard(scene);
  let state = createGameState({ seed: 0x511 });
  state.world = { ...state.world, board: null };
  state.sprites = hydrateSprites({
    board,
    players: scene.setup.players.map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      layer: player.layer,
      speed: player.speed,
      facing: player.facing,
      kind: "player" as const,
      source: `${player.id}.tem`,
      ...(player.controlled === undefined ? {} : { controlled: player.controlled }),
    })),
  });
  const item = state.sprites.items[0];
  if (item === undefined) throw new Error(`${name} has no NPC item`);
  const path = enqueuePathMove(state.sprites, board, item.id, goal, 2, true);
  if (path === null || path.points.length === 0) throw new Error(`${name} did not produce an NPC path`);

  const stateHashes: string[] = [];
  const drawHashes: string[] = [];
  let movementCompletions = 0;
  for (let start = 0; start < scene.ticks; start += batch) {
    const end = Math.min(scene.ticks, start + batch);
    for (let tick = start; tick < end; tick += 1) {
      if (flushEvery !== 0 && tick % flushEvery === 0) clearPathfindingCache();
      const activeBoard = board;
      state.time.tick = tick;
      const checkpoint = restoreAt?.includes(tick) === true ? snapshot(state) : null;
      const events = runMovementPhase(state.sprites, activeBoard, tick);
      movementCompletions += events.filter((event) => event.type === "movement-complete").length;
      const stateHash = hashState({ ...state, world: { ...state.world, board: null } });
      const drawHashValue = drawHash(state, activeBoard);
      stateHashes.push(stateHash);
      drawHashes.push(drawHashValue);
      if (checkpoint !== null) {
        state = restoreGameState(checkpoint);
        const replayEvents = runMovementPhase(state.sprites, activeBoard, tick);
        movementCompletions += replayEvents.filter((event) => event.type === "movement-complete").length;
        equal(hashState({ ...state, world: { ...state.world, board: null } }), stateHash);
        equal(drawHash(state, activeBoard), drawHashValue);
      }
    }
  }
  return { stateHashes, drawHashes, movementCompletions, state };
}

test("Epic 5 demo NPC replays keep state and draw hashes across batching, restore and cache flush", () => {
  const pathCase = demoFixture("demo-npc-pathfinding");
  const firstPath = pathCase.expect.find((row) => row.ev?.some((event) => event.e === "path"));
  if (firstPath === undefined) throw new Error("demo path fixture has no path event");
  const pathEvent = firstPath.ev!.find((event) => event.e === "path") as { readonly goal?: readonly [number, number] };
  if (pathEvent.goal === undefined) throw new Error("demo path fixture has no goal");
  const goal = { x: pathEvent.goal[0]!, y: pathEvent.goal[1]! };

  const oneTick = runDemo("demo-npc-pathfinding", goal, 1, 0, null);
  const batched = runDemo("demo-npc-pathfinding", goal, 7, 0, null);
  const restored = runDemo("demo-npc-pathfinding", goal, 7, 3, [24, 48]);
  deepEqual(batched.stateHashes, oneTick.stateHashes);
  deepEqual(batched.drawHashes, oneTick.drawHashes);
  deepEqual(restored.stateHashes, oneTick.stateHashes);
  deepEqual(restored.drawHashes, oneTick.drawHashes);
  if (oneTick.movementCompletions <= 0) throw new Error("path demo produced no movement completion");

  const battleOne = runDemo("demo-npc-battle-trigger", { x: 272, y: 223 }, 1, 0, null);
  const battle = runDemo("demo-npc-battle-trigger", { x: 272, y: 223 }, 5, 2, [36, 72]);
  deepEqual(battle.stateHashes, battleOne.stateHashes);
  deepEqual(battle.drawHashes, battleOne.drawHashes);
});

test("Epic 5 reset and phase seams are section-owned and ordered", () => {
  const state = createGameState({ seed: 17 });
  state.input = createInputSection({ buttons: [{ id: "confirm", x: 0, y: 0, w: 8, h: 8, action: "confirm", enabled: true }] });
  state.input.keys.push({ seq: 1, name: "A", code: "KeyA", char: "a", action: null, resolvedActions: [] });
  state.sprites.players.push({} as never);
  state.triggers.fired["stale"] = true;
  const order: string[] = [];
  const resetters = [
    spriteResetRegistration(10),
    triggerResetRegistration(20),
    inputResetRegistration({}, 30),
  ];
  for (const registration of [...resetters].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))) {
    order.push(registration.section);
    registration.reset(state);
  }
  deepEqual(order, ["sprites", "triggers", "input"]);
  equal(state.sprites.players.length, 0);
  equal(Object.keys(state.triggers.fired).length, 0);
  equal(state.input.keys.length, 0);
  deepEqual(state.rng, createGameState({ seed: 17 }).rng);
  equal(state.time.tick, 0);

  const phases = [inputPhaseRegistration(), movementPhaseRegistration(), triggerPhaseRegistration()].map((registration) => registration.phase);
  deepEqual(phases, ["input", "movement", "triggers"]);
  deepEqual(ENGINE_PHASES, ["input", "waits", "threads", "events", "movement", "edges", "triggers", "animation", "audio", "time"]);
  equal(STEP_BUDGET, 1000);
});

test("Epic 5 catalogue names have one resolved owner and no duplicate keys", () => {
  const names = CATALOGUE_PLUGIN.commands.map((command) => command.name);
  equal(new Set(names).size, names.length);
  for (const command of CATALOGUE_PLUGIN.commands) equal(typeof command.call, "function", command.name);
  const movement = ["push", "pushitem", "playerstep", "itemstep", "playerpath", "itempath", "activeplayer", "playerdirection", "itemdirection", "playerspeed", "itemspeed", "playerstance", "itemstance", "wait", "get", "mouseclick"];
  for (const name of movement) {
    const owners = [CATALOGUE_PLUGIN, CATALOGUE_RESPONDERS_PLUGIN].filter((plugin) => plugin.commands.some((command) => command.name === name));
    equal(owners.length, 1, name);
    const owner = owners[0]!;
    const command = owner.commands.find((candidate) => candidate.name === name)!;
    equal(typeof command.call, "function", name);
  }
});

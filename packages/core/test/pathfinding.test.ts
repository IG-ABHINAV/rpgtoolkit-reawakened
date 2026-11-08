import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  clearPathfindingCache,
  createEmptyBoard,
  enqueuePathMove,
  enqueuePointPathMove,
  findPath,
  hydrateSprites,
  runMovementPhase,
  type MovementEvent,
  type PathMode,
  type SpriteActor,
  type SpritesSection,
  type Facing,
  type WorldBoard,
  type PathResult,
} from "../src/index.ts";

type VectorFixture = { readonly id: string; readonly type: string; readonly layer: number; readonly closed: boolean; readonly points: readonly [number, number][]; readonly attributes?: number; readonly toLayer?: number };
type BoardFixture = { readonly w: number; readonly h: number; readonly layers: number; readonly pixelMovement: number; readonly gameSpeed: number; readonly pfMode: number; readonly vectors: readonly VectorFixture[]; readonly items?: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: string }[] };
type Case = {
  readonly name: string;
  readonly setup: { readonly board: string; readonly boards: Record<string, BoardFixture>; readonly players: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: string; readonly controlled?: boolean }[] };
  readonly script: readonly { readonly t: number; readonly op: string; readonly actor?: string; readonly flags?: number; readonly points?: readonly [number, number][]; readonly x?: number; readonly y?: number; readonly vector?: VectorFixture }[];
  readonly ticks: number;
  readonly expect: readonly { readonly t: number; readonly a: readonly [string, number, number, number, string, string][] }[];
};

function fixtureBoard(source: BoardFixture): WorldBoard {
  const empty = createEmptyBoard();
  return {
    ...empty,
    width: source.w,
    height: source.h,
    sizeX: Math.floor(source.w / 32),
    sizeY: Math.floor(source.h / 32),
    sizeL: source.layers,
    coordType: 0,
    vectors: source.vectors.map((vector) => ({
      handle: vector.id,
      attributes: vector.attributes ?? vector.toLayer ?? 0,
      closed: vector.closed ? 1 : 0,
      layer: vector.layer,
      type: vector.type === "solid" ? 1 : vector.type === "under" ? 2 : vector.type === "stairs" ? 8 : 16,
      points: vector.points.map(([x, y]) => ({ x, y })),
    })),
    items: (source.items ?? []).map((item, slot) => ({
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

function fixtureSprites(board: WorldBoard, source: BoardFixture, players: Case["setup"]["players"]): SpritesSection {
  const sprites = hydrateSprites({
    board,
    players: players.map((player) => ({ ...player, facing: player.facing as Facing, kind: "player" as const, source: `${player.id}.tem` })),
  });
  sprites.players = sprites.players.map((actor, index) => ({ ...actor, speed: players[index]?.speed ?? actor.speed }));
  sprites.items = sprites.items.map((actor, index) => ({ ...actor, speed: source.items?.[index]?.speed ?? actor.speed }));
  return sprites;
}

function replacePosition(section: SpritesSection, id: string, x: number, y: number): void {
  const update = (actor: SpriteActor): SpriteActor => actor.id === id ? { ...actor, x, y, prev: { x: actor.x, y: actor.y } } : actor;
  section.players = section.players.map(update);
  section.items = section.items.map(update);
}

function actorFacts(section: SpritesSection): [string, number, number, number, string, string][] {
  return [...section.players, ...section.items].map((actor) => [actor.id, actor.x, actor.y, actor.layer, actor.state, actor.facing]);
}

function pathEvent(actor: string, mode: number, result: PathResult, goal: { x: number; y: number }): MovementEvent {
  return { type: "path", tick: 0, actor, mode, goal, route: result.points, expansions: result.expansions, capped: result.capped, reached: result.reached, goalAdjusted: result.goalAdjusted, cache: result.cache };
}

test("pathfinding drives every authored axial, diagonal and vector case", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
  const document = JSON.parse(readFileSync(join(root, "pathfinding-axial-diagonal-vector.json"), "utf8")) as { readonly cases: readonly Case[] };
  for (const scene of document.cases) {
    clearPathfindingCache();
    const source = scene.setup.boards[scene.setup.board]!;
    const board = fixtureBoard(source);
    const sprites = fixtureSprites(board, source, scene.setup.players);
    const byTick = new Map<number, readonly Case["script"][number][]>();
    for (const command of scene.script) byTick.set(command.t, [...(byTick.get(command.t) ?? []), command]);
    for (let tick = 0; tick < scene.ticks; tick += 1) {
      const records: MovementEvent[] = [];
      for (const command of byTick.get(tick) ?? []) {
        if (command.op === "path" && command.actor !== undefined && command.points !== undefined) {
          const mode = source.pfMode as PathMode;
          if ((command.flags ?? 0) >= 4) {
            const goal = command.points[command.points.length - 1]!;
            const result = enqueuePathMove(sprites, board, command.actor, { x: goal[0], y: goal[1] }, mode, true);
            if (result !== null) records.push(pathEvent(command.actor, mode, result, { x: goal[0], y: goal[1] }));
          }
        }
      }
      records.push(...runMovementPhase(sprites, board, tick, { gameSpeed: source.gameSpeed, pixelMovement: source.pixelMovement }));
      const expected = scene.expect.find((entry) => entry.t === tick);
      if (expected !== undefined) deepEqual(actorFacts(sprites), expected.a, `${scene.name} tick ${tick}`);
      if (tick === 0) {
        const path = records.find((record) => record.type === "path");
        equal(path?.type, "path", `${scene.name} emits path result`);
      }
    }
  }
});

test("point paths and sprite diversion use the real movement phase", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
  const docs = [
    JSON.parse(readFileSync(join(root, "movement-tile-pixel.json"), "utf8")) as { readonly cases: readonly Case[] },
    JSON.parse(readFileSync(join(root, "collision-sprite-blocking.json"), "utf8")) as { readonly cases: readonly Case[] },
  ];
  const names = new Set(["point-path-straight-line", "diversion-around-blocker", "no-route-waits-then-continues", "no-route-wait-expires-and-stops"]);
  for (const document of docs) for (const scene of document.cases) {
    if (!names.has(scene.name)) continue;
    clearPathfindingCache();
    const source = scene.setup.boards[scene.setup.board]!;
    let board = fixtureBoard(source);
    const sprites = fixtureSprites(board, source, scene.setup.players);
    const byTick = new Map<number, readonly Case["script"][number][]>();
    for (const command of scene.script) byTick.set(command.t, [...(byTick.get(command.t) ?? []), command]);
    for (let tick = 0; tick < scene.ticks; tick += 1) {
      for (const command of byTick.get(tick) ?? []) {
        if (command.op === "path" && command.actor !== undefined && command.points !== undefined) {
          enqueuePointPathMove(sprites, command.actor, command.points.map(([x, y]) => ({ x, y })), true, source.pfMode as PathMode);
        } else if (command.op === "teleport" && command.actor !== undefined && command.x !== undefined && command.y !== undefined) {
          replacePosition(sprites, command.actor, command.x, command.y);
        } else if (command.op === "editVector" && command.vector !== undefined) {
          board = { ...board, vectors: [...(board.vectors ?? []), { handle: command.vector.id, attributes: 0, closed: 1, layer: command.vector.layer, type: 1, points: command.vector.points.map(([x, y]) => ({ x, y })) }] };
          clearPathfindingCache();
        }
      }
      runMovementPhase(sprites, board, tick, { gameSpeed: source.gameSpeed, pixelMovement: source.pixelMovement });
      const expected = scene.expect.find((entry) => entry.t === tick);
      if (expected !== undefined) deepEqual(actorFacts(sprites), expected.a, `${scene.name} tick ${tick}`);
    }
  }
});

test("path cache invalidates on vector edits and snapshots replay invariant state", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
  const document = JSON.parse(readFileSync(join(root, "pathfinding-axial-diagonal-vector.json"), "utf8")) as { readonly cases: readonly Case[] };
  const scene = document.cases[0]!;
  const source = scene.setup.boards[scene.setup.board]!;
  const board = fixtureBoard(source);
  const sprites = fixtureSprites(board, source, scene.setup.players);
  const actor = sprites.players[0]!;
  const goal = { x: 240, y: 63 };
  clearPathfindingCache();
  const miss = findPath({ board, sprites, actor, goal, mode: 1 });
  const hit = findPath({ board, sprites, actor, goal, mode: 1 });
  equal(miss.cache, "miss");
  equal(hit.cache, "hit");
  const edited = { ...board, vectors: [...(board.vectors ?? []), { handle: "cache-edit", attributes: 0, closed: 1, layer: 0, type: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] } as WorldBoard;
  const afterEdit = findPath({ board: edited, sprites, actor, goal, mode: 1 });
  equal(afterEdit.cache, "miss");

  const replayStart = fixtureSprites(board, source, scene.setup.players);
  const replayPath = enqueuePathMove(replayStart, board, replayStart.players[0]!.id, goal, 1, true);
  equal(replayPath?.reached, true);
  for (let tick = 0; tick < 24; tick += 1) runMovementPhase(replayStart, board, tick, { gameSpeed: source.gameSpeed, pixelMovement: source.pixelMovement });
  const snapshot = JSON.parse(JSON.stringify(replayStart)) as SpritesSection;
  const uninterrupted = JSON.parse(JSON.stringify(replayStart)) as SpritesSection;
  for (let tick = 24; tick < 64; tick += 1) runMovementPhase(uninterrupted, board, tick, { gameSpeed: source.gameSpeed, pixelMovement: source.pixelMovement });
  const restored = JSON.parse(JSON.stringify(snapshot)) as SpritesSection;
  for (let tick = 24; tick < 64; tick += 1) runMovementPhase(restored, board, tick, { gameSpeed: source.gameSpeed, pixelMovement: source.pixelMovement });
  deepEqual(JSON.stringify(restored), JSON.stringify(uninterrupted), "snapshot restore preserves deterministic state");
});

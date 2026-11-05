import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createEmptyBoard,
  hashDrawList,
  hashState,
  hydrateSprites,
  restoreGameState,
  runAnimationPhase,
  runMovementPhase,
  snapshot,
  startStance,
  spriteDraws,
  enqueueDirectionMove,
  createGameState,
  type Facing,
  type SpriteAnimationSpec,
  type SpriteVisual,
  type SpritesSection,
  type WorldBoard,
} from "../src/index.ts";

type AnimationSetup = {
  readonly players: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: Facing; readonly controlled?: boolean; readonly anims: { readonly walk: Record<string, { readonly frames: number; readonly delayMs: number }>; readonly idle: Record<string, { readonly frames: number; readonly delayMs: number }>; readonly stances: Record<string, { readonly frames: number; readonly delayMs: number; readonly hold?: boolean }> }; readonly idleMs: number }[];
};
type AnimationCase = { readonly name: string; readonly setup: AnimationSetup; readonly script: readonly { readonly t: number; readonly op: string; readonly actor?: string; readonly dir?: Facing; readonly name?: string }[]; readonly ticks: number; readonly expect: readonly { readonly t: number; readonly a: readonly [string, number, number, number, string, string, string, number][]; readonly ev?: readonly { readonly e: string; readonly actor?: string; readonly held?: boolean; readonly stance?: string }[] }[] };
type AnimationFixture = { readonly cases: readonly AnimationCase[] };

const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
const directions: readonly Facing[] = ["S", "N", "E", "W", "NW", "NE", "SW", "SE"];
const asFile = (kind: string, direction: string): string => `fixture/${kind}.${direction}`;

function sceneBoard(): WorldBoard {
  const empty = createEmptyBoard();
  return { ...empty, width: 320, height: 320, sizeX: 10, sizeY: 10, sizeL: 2, coordType: 0, layers: [] } as unknown as WorldBoard;
}

function setupActor(sprites: SpritesSection, player: AnimationSetup["players"][number]): Record<string, SpriteAnimationSpec> {
  const definitions: Record<string, SpriteAnimationSpec> = {};
  const walk = directions.map((direction) => {
    const value = player.anims.walk[direction];
    if (value === undefined) return "";
    const file = asFile("walk", direction);
    definitions[file] = { file, frames: value.frames, delayTicks: Math.max(1, Math.floor(value.delayMs * 60 / 1000 + 0.5)) };
    return file;
  });
  const idle = directions.map((direction) => {
    const value = player.anims.idle[direction];
    if (value === undefined) return "";
    const file = asFile("idle", direction);
    definitions[file] = { file, frames: value.frames, delayTicks: Math.max(1, Math.floor(value.delayMs * 60 / 1000 + 0.5)) };
    return file;
  });
  const custom = Object.entries(player.anims.stances).map(([name, value]) => {
    const file = asFile("stance", name);
    definitions[file] = { file, frames: value.frames, delayTicks: Math.max(1, Math.floor(value.delayMs * 60 / 1000 + 0.5)), ...(value.hold === undefined ? {} : { hold: value.hold }) };
    return { animation: file, handle: name };
  });
  const visual: SpriteVisual = { movement: walk, idle, battle: [], custom, animation: null, file: null, stance: null, frame: 0, frameTicks: 0, idleTicks: 0, stanceHeld: false, stanceComplete: false };
  sprites.players = sprites.players.map((actor) => actor.id === player.id ? { ...actor, speed: player.speed, idleTime: player.idleMs / 1000, visual } : actor);
  return definitions;
}

function runFixtureCase(scene: AnimationCase): void {
  const board = sceneBoard();
  const sprites = hydrateSprites({ board, players: scene.setup.players.map((player) => ({ id: player.id, kind: "player" as const, source: `${player.id}.tem`, x: player.x, y: player.y, layer: player.layer, facing: player.facing, ...(player.controlled === undefined ? {} : { controlled: player.controlled }) })) });
  const definitions: Record<string, SpriteAnimationSpec> = {};
  for (const player of scene.setup.players) Object.assign(definitions, setupActor(sprites, player));
  const scriptByTick = new Map<number, readonly AnimationCase["script"][number][]>();
  for (const op of scene.script) scriptByTick.set(op.t, [...(scriptByTick.get(op.t) ?? []), op]);
  const events: { readonly type: string; readonly tick: number; readonly actor?: string; readonly held?: boolean; readonly stance?: string }[] = [];
  const options = { resolve: (file: string) => definitions[file] ?? null, onEvent: (record: { readonly type: string; readonly tick: number; readonly actor?: string; readonly held?: boolean; readonly stance?: string }) => events.push(record) };
  for (let tick = 0; tick < scene.ticks; tick += 1) {
    for (const op of scriptByTick.get(tick) ?? []) {
      if (op.op === "press" && op.dir !== undefined) enqueueDirectionMove(sprites, op.actor ?? "hero", op.dir, 0);
      if (op.op === "stance" && op.actor !== undefined && op.name !== undefined) startStance(sprites, op.actor, op.name, tick, options);
    }
    runMovementPhase(sprites, board, tick);
    runAnimationPhase(sprites, tick, options);
    const expected = scene.expect.find((row) => row.t === tick);
    if (expected === undefined) continue;
    const actual = [...sprites.players, ...sprites.items].map((actor) => [actor.id, actor.x, actor.y, actor.layer, actor.state, actor.facing, actor.visual.animation ?? "", actor.visual.frame] as const);
    deepEqual(actual, expected.a, `${scene.name}/tick-${tick}`);
    if (expected.ev !== undefined) {
      const actualEvents = events.filter((record) => record.tick === tick).map((record) => ({ e: record.type, ...(record.actor === undefined ? {} : { actor: record.actor }), ...(record.held === undefined ? {} : { held: record.held }), ...(record.stance === undefined ? {} : { stance: record.stance }) }));
      const expectedAnimationEvents = expected.ev.filter((record) => record.e.startsWith("stance"));
      deepEqual(actualEvents.filter((record) => record.e.startsWith("stance")), expectedAnimationEvents, `${scene.name}/events-${tick}`);
    }
  }
}

test("core drives every authored animation fallback and stance fixture tick", () => {
  const fixture = JSON.parse(readFileSync(join(root, "animation-fallback-stance.json"), "utf8")) as AnimationFixture;
  for (const scene of fixture.cases) runFixtureCase(scene);
});

test("actor presentation draws retain prior positions without mutating state", () => {
  const board = sceneBoard();
  const sprites = hydrateSprites({ board, players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }] });
  const before = hashState(sprites);
  enqueueDirectionMove(sprites, "hero", "E");
  runMovementPhase(sprites, board, 0);
  const withPrevious = hashState(sprites);
  const draws = spriteDraws(sprites);
  equal(hashState(sprites), withPrevious);
  equal(hashState(sprites) === before, false);
  const previous = draws[0]?.prev;
  if (previous === undefined) throw new Error("movement did not provide a prior position");
  const previousPoint = Array.isArray(previous) ? { x: previous[0]!, y: previous[1]! } : previous as { readonly x: number; readonly y: number };
  const atPrevious = { tick: 0, width: 320, height: 320, commands: [{ kind: "rect" as const, rect: { x: previousPoint.x, y: previousPoint.y, w: 16, h: 16 }, rgb: { r: 64, g: 96, b: 224 }, filled: true }], marginCommands: [] };
  const atCurrent = { tick: 0, width: 320, height: 320, commands: [{ kind: "rect" as const, rect: { x: draws[0]?.x ?? 0, y: draws[0]?.y ?? 0, w: 16, h: 16 }, rgb: { r: 64, g: 96, b: 224 }, filled: true }], marginCommands: [] };
  equal(hashDrawList(atPrevious) === hashDrawList(atCurrent), false);
});

test("actor animation is deterministic across snapshot restore and fixed-tick batching", () => {
  const board = sceneBoard();
  const left = createGameState({ seed: 7 });
  left.sprites = hydrateSprites({ board, players: [{ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true }] });
  left.sprites.players = left.sprites.players.map((value) => ({ ...value, visual: { ...value.visual, movement: ["", "", "walk.E", "", "", "", "", ""] } }));
  const resolve = (file: string): SpriteAnimationSpec => ({ file, frames: 3, delayTicks: 6 });
  enqueueDirectionMove(left.sprites, "hero", "E");
  const right = restoreGameState(snapshot(left));
  for (let tick = 0; tick < 24; tick += 1) {
    runMovementPhase(left.sprites, board, tick);
    runAnimationPhase(left.sprites, tick, { resolve });
  }
  for (const tick of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
    runMovementPhase(right.sprites, board, tick);
    runAnimationPhase(right.sprites, tick, { resolve });
  }
  equal(snapshot(right), snapshot(left));
  equal(hashState(right), hashState(left));
});
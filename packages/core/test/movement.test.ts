import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  composeBoard,
  createEmptyBoard,
  createGameState,
  enqueueDirectionMove,
  hydrateSprites,
  restoreGameState,
  runMovementPhase,
  snapshot,
  hashState,
  spriteDraws,
  ticksPerAdvance,
  type MovementEvent,
  type WorldBoard,
} from "../src/index.ts";
import { enqueuePathMove, setWaypoint } from "../src/sprites/runtime.ts";

function board(vectors: WorldBoard["vectors"] = [], items: WorldBoard["items"] = []): WorldBoard {
  const empty = createEmptyBoard();
  const { residue: _residue, ...plain } = empty;
  return ({
    ...plain,
    width: 320,
    height: 320,
    coordType: 0,
    vectors,
    items,
  } as unknown) as WorldBoard;
}

function playerState(currentBoard: WorldBoard, x = 48) {
  return hydrateSprites({
    board: currentBoard,
    players: [{ id: "hero", kind: "player", source: "hero.tem", x, y: 63, layer: 1, controlled: true }],
  });
}

function npcItem(x = 112): NonNullable<WorldBoard["items"]>[number] {
  return {
    slot: 0,
    itemFile: "npc.itm",
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
    x,
    y: 63,
    layer: 1,
    reserved: 0,
  };
}

test("R-50 moves a tile in eight 4-pixel advances and completes at tick 21", () => {
  const currentBoard = board();
  const sprites = playerState(currentBoard);
  equal(ticksPerAdvance(0.05, 0), 3);
  enqueueDirectionMove(sprites, "hero", "E", 0);
  const events = [];
  for (let tick = 0; tick < 24; tick += 1) events.push(...runMovementPhase(sprites, currentBoard, tick));
  equal(sprites.players[0]?.x, 80);
  equal(sprites.players[0]?.state, "waiting");
  equal(events.some((record) => record.type === "movement-complete" && record.tick === 21), true);
});

test("diagonal pixel directions finish both axes in one advance in both modes", () => {
  const cases = [["NE", 52, 59], ["SE", 52, 67], ["SW", 44, 67], ["NW", 44, 59]] as const;
  for (const mode of [1, 2]) {
    for (const [facing, x, y] of cases) {
      const currentBoard = board();
      const sprites = playerState(currentBoard);
      enqueueDirectionMove(sprites, "hero", facing, mode);
      const events = runMovementPhase(sprites, currentBoard, 0, { pixelMovement: mode });
      equal(sprites.players[0]?.x, x, `${mode} ${facing} x`);
      equal(sprites.players[0]?.y, y, `${mode} ${facing} y`);
      equal(sprites.players[0]?.movement.active, null);
      equal(events.filter((record) => record.type === "step-complete").length, 1);
      equal(events.filter((record) => record.type === "movement-complete").length, 1);
    }
  }
});

test("diagonal pixel movement samples collision at its full four-pixel destination", () => {
  const wall = { handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 66, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 90 }, { x: 66, y: 90 }] };
  for (const mode of [1, 2]) {
    const currentBoard = board([wall]);
    const sprites = playerState(currentBoard);
    enqueueDirectionMove(sprites, "hero", "SE", mode);
    const events = runMovementPhase(sprites, currentBoard, 0, { pixelMovement: mode });
    equal(events.some((record) => record.type === "blocked"), false);
    equal(events.filter((record) => record.type === "step-complete").length, 1);
    equal(sprites.players[0]?.movement.active, null);
    equal(sprites.players[0]?.x, 48, "glancing wall slides south without moving east");
    equal(sprites.players[0]?.y, 67);

    const distantWall = { ...wall, points: wall.points.map((point) => ({ x: point.x + 100, y: point.y })) };
    const distantBoard = board([distantWall]);
    const clear = playerState(distantBoard);
    enqueueDirectionMove(clear, "hero", "SE", mode);
    const clearEvents = runMovementPhase(clear, distantBoard, 0, { pixelMovement: mode });
    equal(clearEvents.some((record) => record.type === "blocked"), false);
    equal(clearEvents.filter((record) => record.type === "step-complete").length, 1);
    equal(clear.players[0]?.x, 52, "a distant wall does not block east movement");
    equal(clear.players[0]?.y, 67);
  }
});

test("corner collision is independent of polygon winding and starting vertex", () => {
  const points = [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 140 }, { x: 100, y: 140 }];
  const variants = [points, [...points].reverse(), [...points.slice(1), points[0]!]];
  for (const mode of [1, 2]) {
    const outcomes = variants.map((vertices) => {
      const currentBoard = board([{ handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: vertices }]);
      const sprites = playerState(currentBoard, 82);
      sprites.players[0] = { ...sprites.players[0]!, y: 101 };
      enqueueDirectionMove(sprites, "hero", "E", mode);
      const events = runMovementPhase(sprites, currentBoard, 0, { pixelMovement: mode });
      return { x: sprites.players[0]?.x, y: sprites.players[0]?.y, events };
    });
    deepEqual(outcomes[1], outcomes[0]);
    deepEqual(outcomes[2], outcomes[0]);
    equal(outcomes[0]?.x, 82);
    equal(outcomes[0]?.y, 101);
    equal(outcomes[0]?.events.filter((record) => record.type === "blocked").length, 1);
  }
});

test("solid vectors block a tile step without moving the actor", () => {
  const currentBoard = board([{ handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 96, y: 32 }, { x: 128, y: 32 }, { x: 128, y: 224 }, { x: 96, y: 224 }] }]);
  const sprites = playerState(currentBoard);
  enqueueDirectionMove(sprites, "hero", "E", 0);
  enqueueDirectionMove(sprites, "hero", "E", 0);
  const events = [];
  for (let tick = 0; tick < 30; tick += 1) events.push(...runMovementPhase(sprites, currentBoard, tick));
  equal(events.some((record) => record.type === "blocked" && record.vector === "wall"), true);
});

test("direct sprite collision freezes the stationary loser for 120 ticks", () => {
  const currentBoard = board([], [npcItem()]);
  const sprites = playerState(currentBoard);
  enqueueDirectionMove(sprites, "hero", "E", 0);
  enqueueDirectionMove(sprites, "hero", "E", 0);
  const events = [];
  for (let tick = 0; tick <= 30; tick += 1) events.push(...runMovementPhase(sprites, currentBoard, tick));
  equal(sprites.items[0]?.state, "frozen");
  equal(sprites.items[0]?.frozenUntil, 144);
  equal(sprites.players[0]?.x, 80);
  equal(events.some((record) => record.type === "sprite-collision" && record.winner === "hero" && record.loser === "npc.itm"), true);
});

test("a newly solid wall, item or actor ends the active step and allows retreat", () => {
  for (const obstacle of ["wall", "item", "actor"]) {
    let currentBoard = board([], obstacle === "item" ? [npcItem()] : []);
    const sprites = playerState(currentBoard);
    if (obstacle === "actor") sprites.players.push({ ...sprites.players[0]!, id: "other", index: 1, controlled: false, x: 112 });
    enqueueDirectionMove(sprites, "hero", "E", 0);
    runMovementPhase(sprites, currentBoard, 0);
    equal(sprites.players[0]?.x, 52);
    if (obstacle === "wall") currentBoard = board([{ handle: "closing-wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 70, y: 32 }, { x: 74, y: 32 }, { x: 74, y: 90 }, { x: 70, y: 90 }] }]);
    else if (obstacle === "item") sprites.items[0] = { ...sprites.items[0]!, x: 84 };
    else sprites.players[1] = { ...sprites.players[1]!, x: 84 };
    const events: MovementEvent[] = [];
    for (let tick = 1; tick <= 3; tick += 1) events.push(...runMovementPhase(sprites, currentBoard, tick));
    equal(sprites.players[0]?.x, 52, obstacle);
    equal(sprites.players[0]?.movement.active, null, obstacle);
    equal(events.some((event) => event.type === "step-complete"), false, obstacle);
    equal(events.filter((event) => event.type === "movement-complete" && event.actor === "hero" && event.blocked === true).length, 1, obstacle);
    enqueueDirectionMove(sprites, "hero", "W", 1, true);
    for (let tick = 4; tick <= 6; tick += 1) runMovementPhase(sprites, currentBoard, tick, { pixelMovement: 1 });
    equal(sprites.players[0]?.x, 48, `${obstacle}: retreat`);
    if (obstacle === "item") {
      setWaypoint(sprites, "npc.itm", [{ x: 120, y: 63 }], 0, true);
      runMovementPhase(sprites, currentBoard, 123);
      runMovementPhase(sprites, currentBoard, 124);
      equal(sprites.items[0]?.x, 88, "the NPC patrol resumes after thaw");
    }
  }
});

test("cadence, frozen and idle ticks do not replay a previous displacement", () => {
  for (const state of ["moving", "frozen", "waiting"] as const) {
    const currentBoard = board();
    const sprites = playerState(currentBoard);
    const renderedX = (alpha: number) => composeBoard({
      board: { ...currentBoard, layers: [{ tiles: [] }], background: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 } }, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 320, height: 320 },
      alpha, include: { shading: false, images: false, sprites: true }, sprites: spriteDraws(sprites),
    }).commands.filter((command) => command.kind === "rect").find((command) => command.rect.w === 16 && command.rect.h === 16)?.rect.x;
    enqueueDirectionMove(sprites, "hero", "E", 0);
    runMovementPhase(sprites, currentBoard, 0);
    equal(renderedX(0), 40, "the movement tick starts at the previous position");
    equal(renderedX(0.5), 42, "actual movement still interpolates");
    sprites.players[0] = { ...sprites.players[0]!, state, frozenUntil: state === "frozen" ? 120 : null, movement: { ...sprites.players[0]!.movement, active: state === "waiting" ? null : sprites.players[0]!.movement.active } };
    runMovementPhase(sprites, currentBoard, 1);
    deepEqual([renderedX(0), renderedX(0.5), renderedX(1)], [44, 44, 44], state);
  }
});

test("active movement survives snapshot restore with equal later behavior", () => {
  const currentBoard = board();
  const left = createGameState({ seed: 7 });
  left.world = { ...left.world, board: currentBoard };
  left.sprites = playerState(currentBoard);
  enqueueDirectionMove(left.sprites, "hero", "E", 0);
  runMovementPhase(left.sprites, currentBoard, 0);
  const right = restoreGameState(snapshot(left));
  for (let tick = 1; tick < 24; tick += 1) {
    runMovementPhase(left.sprites, currentBoard, tick);
    runMovementPhase(right.sprites, currentBoard, tick);
  }
  deepEqual(right.sprites, left.sprites);
  equal(snapshot(right), snapshot(left));
});


type MovementFixtureCase = {
  readonly name: string;
  readonly setup: {
    readonly board: string;
    readonly boards: Record<string, { readonly w: number; readonly h: number; readonly gameSpeed: number; readonly pixelMovement: number; readonly vectors: readonly { readonly id: string; readonly type: string; readonly layer: number; readonly closed: boolean; readonly points: readonly [number, number][]; readonly attributes?: number; readonly toLayer?: number }[]; readonly items?: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: string }[] }>;
    readonly players: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: string; readonly controlled?: boolean }[];
  };
  readonly script: readonly { readonly t: number; readonly op: string; readonly actor?: string; readonly dirs?: string; readonly dir?: string; readonly clear?: boolean }[];
  readonly ticks: number;
  readonly expect: readonly { readonly t: number; readonly a: readonly [string, number, number, number, string, string][]; readonly ev?: readonly { readonly e: string; readonly actor?: string; readonly winner?: string; readonly loser?: string; readonly by?: string }[] }[];
};


test("owned authored movement scenes reproduce every in-scope case through core", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
  const deferred: Record<string, true> = {
    "point-path-straight-line": true, // 5.5 path-following
    "diversion-around-blocker": true, // 5.5 path-following
    "no-route-waits-then-continues": true, // 5.5 path-following
    "no-route-wait-expires-and-stops": true, // 5.5 path-following
  };
  for (const name of ["movement-tile-pixel", "collision-solid-stairs-under", "collision-sprite-blocking"]) {
    const document = JSON.parse(readFileSync(join(root, `${name}.json`), "utf8")) as { readonly cases: readonly MovementFixtureCase[] };
    for (const scene of document.cases) {
      if (deferred[scene.name] === true) continue;
      const source = scene.setup.boards[scene.setup.board]!;
      const vectors = source.vectors.map((vector) => ({
        handle: vector.id,
        attributes: vector.attributes ?? vector.toLayer ?? 0,
        closed: vector.closed ? 1 : 0,
        layer: vector.layer,
        type: vector.type === "solid" ? 1 : vector.type === "under" ? 2 : vector.type === "stairs" ? 8 : 16,
        points: vector.points.map(([x, y]) => ({ x, y })),
      }));
      const items = (source.items ?? []).map((item) => ({
        slot: 0, itemFile: item.id, activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "",
        finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0,
        x: item.x, y: item.y, layer: item.layer, reserved: 0,
      }));
      const currentBoard = board(vectors, items);
      const sprites = hydrateSprites({
        board: currentBoard,
        players: scene.setup.players.map((player) => ({ ...player, facing: player.facing as "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW", kind: "player" as const, source: `${player.id}.tem` })),
      });
      sprites.players = sprites.players.map((actor, index) => ({ ...actor, speed: scene.setup.players[index]?.speed ?? actor.speed }));
      sprites.items = sprites.items.map((actor, index) => ({ ...actor, speed: source.items?.[index]?.speed ?? actor.speed }));
      const byTick = new Map<number, typeof scene.script>();
      for (const command of scene.script) byTick.set(command.t, [...(byTick.get(command.t) ?? []), command]);
      for (let tick = 0; tick < scene.ticks; tick += 1) {
        const inputEvents: MovementEvent[] = [];
        for (const command of byTick.get(tick) ?? []) {
          if (command.actor !== undefined && command.dirs !== undefined) {
            for (const direction of command.dirs.split(",")) enqueueDirectionMove(sprites, command.actor, direction as "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW", source.pixelMovement, command.clear === true);
          } else if (command.actor === undefined && command.dir !== undefined) {
            enqueueDirectionMove(sprites, "hero", command.dir as "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW", source.pixelMovement);
            inputEvents.push({ type: "key-press", tick, direction: command.dir as "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" });
          }
        }
        const records = [...inputEvents, ...runMovementPhase(sprites, currentBoard, tick, { gameSpeed: source.gameSpeed, pixelMovement: source.pixelMovement })];
        const expected = scene.expect[tick];
        if (expected === undefined) continue;
        deepEqual([...sprites.players, ...sprites.items].map((actor) => [actor.id, actor.x, actor.y, actor.layer, actor.state, actor.facing]), expected.a, `${name}/${scene.name} tick ${tick}`);
        if (expected.ev !== undefined) deepEqual(records.map((record) => ({ e: record.type, ...(record.type === "sprite-collision" ? {} : record.actor === undefined ? {} : { actor: record.actor }), ...(record.winner === undefined ? {} : { winner: record.winner }), ...(record.loser === undefined ? {} : { loser: record.loser }), ...(record.type === "sprite-collision" || record.type === "under-enter" || record.type === "under-leave" ? record.type === "under-enter" || record.type === "under-leave" ? { vector: record.vector } : {} : record.vector === undefined && record.blocker === undefined ? {} : { by: record.vector ?? record.blocker }), ...(record.type === "movement-complete" && record.blocked === true ? { blocked: true } : {}), ...(record.from === undefined ? {} : { from: record.from }), ...(record.to === undefined ? {} : { to: record.to }), ...(record.direction === undefined ? {} : { dir: record.direction }) })), expected.ev, `${name}/${scene.name} events ${tick}`);
      }
    }
  }
});

test("movement-waits fixture drives every owned case through the real core movement phase", () => {
  type Case = {
    readonly name: string;
    readonly setup: {
      readonly board: string;
      readonly boards: Record<string, {
        readonly vectors: readonly { readonly id: string; readonly type: string; readonly layer: number; readonly closed: boolean; readonly points: readonly [number, number][]; readonly attributes?: number; readonly toLayer?: number }[];
        readonly items?: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: string }[];
      }>;
      readonly players: readonly { readonly id: string; readonly x: number; readonly y: number; readonly layer: number; readonly speed: number; readonly facing: string; readonly controlled?: boolean }[];
    };
    readonly ticks: number;
    readonly expect: readonly { readonly a: readonly [string, number, number, number, string, string][] }[];
  };
  const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "movement");
  const data = JSON.parse(readFileSync(join(root, "movement-waits.json"), "utf8")) as { readonly cases: readonly Case[] };
  equal(data.cases.length, 6);
  for (const scene of data.cases) {
    const source = scene.setup.boards[scene.setup.board]!;
    const vectors = source.vectors.map((vector) => ({ handle: vector.id, attributes: vector.attributes ?? vector.toLayer ?? 0, closed: vector.closed ? 1 : 0, layer: vector.layer, type: vector.type === "solid" ? 1 : vector.type === "under" ? 2 : vector.type === "stairs" ? 8 : 16, points: vector.points.map(([x, y]) => ({ x, y })) }));
    const items = (source.items ?? []).map((item) => ({ slot: 0, itemFile: item.id, activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: item.x, y: item.y, layer: item.layer, reserved: 0 }));
    const currentBoard = board(vectors, items);
    const sprites = hydrateSprites({ board: currentBoard, players: scene.setup.players.map((player) => ({ ...player, facing: player.facing as "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW", kind: "player" as const, source: `${player.id}.tem` })) });
    const item = (id: string) => sprites.items.find((actor) => actor.id === id)!;
    sprites.players = sprites.players.map((actor, index) => ({ ...actor, speed: scene.setup.players[index]?.speed ?? actor.speed }));
    sprites.items = sprites.items.map((actor, index) => ({ ...actor, speed: source.items?.[index]?.speed ?? actor.speed }));
    if (scene.name === "pause-thread-flag-waits-for-completion" || scene.name === "without-the-flag-the-thread-continues") {
      enqueuePathMove(sprites, currentBoard, "a", { x: 144, y: 95 }, 1);
    } else if (scene.name === "blocking-thread-implies-the-wait") {
      enqueueDirectionMove(sprites, "hero", "E", 0); enqueueDirectionMove(sprites, "hero", "E", 0);
    } else if (scene.name === "multirun-one-wait-over-both-sprites") {
      enqueuePathMove(sprites, currentBoard, "a", { x: 112, y: 95 }, 1);
      enqueuePathMove(sprites, currentBoard, "b", { x: 176, y: 127 }, 1);
    } else {
      const points = source.vectors.find((vector) => vector.id === "patrol")!.points.map(([x, y]) => ({ x, y }));
      setWaypoint(sprites, "a", points, scene.name === "waypoint-path-copy-two-cycles" ? 2 : 1, scene.name === "waypoint-link-sees-live-edit");
    }
    for (let tick = 0; tick < scene.ticks; tick += 1) {
      if (scene.name === "waypoint-link-sees-live-edit" && tick === 12) {
        const actor = item("a"); const waypoint = actor.queue.waypoint;
        if (waypoint !== null) waypoint.points[1] = { x: 176, y: 159 };
      }
      runMovementPhase(sprites, currentBoard, tick);
      const expected = scene.expect[tick];
      if (expected !== undefined) deepEqual([...sprites.players, ...sprites.items].map((actor) => [actor.id, actor.x, actor.y, actor.layer, actor.state, actor.facing]), expected.a, `${scene.name} tick ${tick}`);
    }
  }
});

test("movement state hash is stable under different advance batching", () => {
  const leftBoard = board();
  const rightBoard = board();
  const left = playerState(leftBoard);
  const right = playerState(rightBoard);
  enqueueDirectionMove(left, "hero", "E", 0);
  enqueueDirectionMove(right, "hero", "E", 0);
  for (let tick = 0; tick < 24; tick += 1) runMovementPhase(left, leftBoard, tick);
  for (const batch of [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9, 10, 11], [12, 13, 14], [15, 16, 17, 18, 19, 20, 21, 22, 23]]) {
    for (const tick of batch) runMovementPhase(right, rightBoard, tick);
  }
  equal(hashState(left), hashState(right));
});

test("equal-speed moving collisions use controlled-player then drawId total order", () => {
  const currentBoard = board();
  const sprites = hydrateSprites({
    board: currentBoard,
    players: [
      { id: "first", kind: "player", source: "first.tem", x: 48, y: 63, layer: 1, controlled: true },
      { id: "second", kind: "player", source: "second.tem", x: 112, y: 63, layer: 1, controlled: false },
    ],
  });
  enqueueDirectionMove(sprites, "first", "E", 0);
  enqueueDirectionMove(sprites, "second", "W", 0);
  const events = [];
  for (let tick = 0; tick < 40; tick += 1) events.push(...runMovementPhase(sprites, currentBoard, tick));
  equal(events.some((record) => record.type === "sprite-collision" && record.winner === "first" && record.loser === "second"), true);
});

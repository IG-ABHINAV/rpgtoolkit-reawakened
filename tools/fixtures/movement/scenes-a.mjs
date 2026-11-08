// Scenes: movement-tile-pixel, collision-solid-stairs-under, collision-sprite-blocking,
// edges-board-link-program, board-entry-thread-lifecycle (ticket 5.2). Authored from
// docs/spec/engine/movement-and-collision.md; no legacy file is copied or decoded.

import { FLAGS } from "./sim.mjs";
import { isGlancing } from "./geometry.mjs";
import { board, hero, makeCase, npc, rectPts, solid, tile } from "./common.mjs";

const press = (t, dir) => ({ t, op: "press", dir });

export function movementTilePixel() {
  const open = (o = {}) => ({ board: "field", boards: { field: board(o) }, players: [hero()] });
  return {
    spec: ["movement-and-collision.md#e-22", "movement-and-collision.md#e-23", "movement-and-collision.md#r-50"],
    cases: [
      makeCase("tile-default-speed", "0.05 s, game speed 0: 3 ticks per 4 px advance, one 32 px tile = 24 ticks; completion on the last advance (R-50 item 3).", open(), [{ t: 0, op: "push", actor: "hero", dirs: "E,E,S" }], 76),
      makeCase("tile-game-speed-slower", "Game speed -1 on 0.01 s: interval 110 ms, 7 ticks per advance; the 8th advance, and completion, is on tick 49.", { ...open({ gameSpeed: -1 }), players: [hero({ speed: 0.01 })] }, [{ t: 0, op: "push", actor: "hero", dirs: "E" }], 60),
      makeCase("tile-game-speed-clamps-to-one-tick", "Game speed +4 on 0.05 s: 50 - 400 ms is below one tick, so exactly 1 tick per advance; a tile takes 8 ticks.", open({ gameSpeed: 4 }), [{ t: 0, op: "push", actor: "hero", dirs: "E,S" }], 20),
      makeCase("tile-speed-zero", "A speed of 0 gives one tick per advance (R-50 item 2).", { ...open(), players: [hero({ speed: 0 })] }, [{ t: 0, op: "push", actor: "hero", dirs: "N" }], 10),
      makeCase("pixel-step-four", "E-23: either pixel mode steps 4 px, which is exactly one advance, so every step ends on an advance and no advance is ever shortened.", open({ pixelMovement: 1 }), [press(0, "E"), press(0, "E"), press(0, "S")], 20),
      makeCase("pixel-modes-1-and-2-step-alike", "E-23: modes 1 and 2 differ in how scripts push, not in how the player walks — both step 4 px.", open({ pixelMovement: 2 }), [press(0, "E"), press(0, "E"), press(0, "E")], 12),
      makeCase("queue-clear-and-append", "A second push appends; a push with tkMV_CLEAR_QUEUE drops the queue and the step under way (E-22).", open(), [{ t: 0, op: "push", actor: "hero", dirs: "E,E" }, { t: 6, op: "push", actor: "hero", dirs: "S" }, { t: 30, op: "push", actor: "hero", dirs: "N", clear: true }], 70),
      makeCase("point-path-straight-line", "ItemPath/PlayerPath points walk straight lines, ignoring vectors, at 4 px (Euclidean) per advance (E-22).", { ...open({ vectors: [solid("ignored-wall", 80, 40, 96, 90)] }), players: [hero({ speed: 0.02 })] }, [{ t: 0, op: "path", actor: "hero", flags: 0, points: [[112, 63], [112, 95]] }], 40),
    ],
  };
}

export function collisionSolidStairsUnder() {
  const rows = [
    { m: [1, 1], e: [0, 1], iso: false },
    { m: [100, 101], e: [1, 0], iso: false },
    { m: [1, 0], e: [0, 1], iso: false },
    { m: [100000, 196261], e: [1, 0], iso: true },
    { m: [100000, 196262], e: [1, 0], iso: true },
    { m: [1, 1], e: [1, 0], iso: true },
  ].map((r) => ({ ...r, glancing: isGlancing(r.m, r.e, r.iso) }));
  const wall = solid("wall", 128, 32, 160, 224);
  const base = (o = {}) => ({ board: "field", boards: { field: board({ vectors: [wall], ...o }) }, players: [hero({ x: 80, y: 63 })] });
  const stairsBoard = board({
    layers: 2,
    vectors: [
      { id: "stairs-up", type: "stairs", layer: 0, closed: true, points: rectPts(96, 40, 128, 70), toLayer: 1 },
      solid("layer0-only-wall", 160, 32, 192, 96, 0),
      { id: "ceiling-under", type: "under", layer: 1, closed: true, points: rectPts(192, 40, 256, 70) },
      { id: "guide", type: "waypoint", layer: 1, closed: false, points: [[0, 63], [320, 63]] },
    ],
  });
  return {
    spec: ["movement-and-collision.md#e-26", "movement-and-collision.md#e-30", "movement-and-collision.md#r-54"],
    cases: [
      makeCase("tile-solid-blocks", "A tile step into a solid is blocked on its first advance and the step ends (E-26).", base(), [{ t: 0, op: "push", actor: "hero", dirs: "E,E,E" }], 60),
      makeCase("pixel-glancing-slide", "R-54: a 45 degree approach (inclusive) slides once along the wall (the free candidate, here S); the new approach angle is then past the threshold, so the next advance blocks.", { ...base({ pixelMovement: 1 }), players: [hero({ x: 112, y: 63, speed: 0.02 })] }, [press(0, "SE")], 60),
      makeCase("pixel-head-on-blocks", "R-54 item 4: a head-on approach is below the threshold and blocks.", { ...base({ pixelMovement: 1 }), players: [hero({ x: 112, y: 63, speed: 0.02 })] }, [press(0, "E"), press(0, "E"), press(0, "E")], 40),
      makeCase("tile-movement-never-slides", "R-54: tile movement never slides, even at 45 degrees.", { ...base({ pixelMovement: 0 }), players: [hero({ x: 100, y: 63, speed: 0.02 })] }, [press(0, "SE")], 30),
      makeCase("open-polyline-blocks-crossing", "E-26: an open polyline blocks crossing; the player stops flush with it.", { board: "field", boards: { field: board({ vectors: [{ id: "fence", type: "solid", layer: 0, closed: false, points: [[200, 0], [200, 320]] }] }) }, players: [hero({ x: 176, y: 63, speed: 0.02 })] }, [{ t: 0, op: "push", actor: "hero", dirs: "E,E" }], 30),
      makeCase("stairs-change-layer-and-layers-are-scoped", "Stairs move the sprite to the vector's layer; a layer-0 solid does not block it afterwards; under and waypoint vectors never block.", { board: "field", boards: { field: stairsBoard }, players: [hero({ x: 80, y: 63, speed: 0.02 })] }, [{ t: 0, op: "push", actor: "hero", dirs: "E,E,E,E,E,E" }], 100),
    ],
    thresholds: { note: "R-54 integer thresholds: |cross| <= |dot| (45 degrees, inclusive); isometric |cross| x 100000 <= |dot| x 196261.", rows },
  };
}

export function collisionSpriteBlocking() {
  const corridor = (o = {}) => board({ w: 320, h: 320, pfMode: 1, vectors: [solid("roof", 0, 0, 320, 32), solid("floor", 0, 64, 320, 320)], ...o });
  const far = hero({ id: "hero", x: 304, y: 295, speed: 0.05 });
  return {
    spec: ["movement-and-collision.md#e-27", "movement-and-collision.md#r-51"],
    cases: [
      makeCase("stationary-loses", "R-51 item 2, amended 2026-11-07: the stationary loser freezes for 120 ticks and the initiating blocked step ends at its safe position.", { board: "field", boards: { field: board({ items: [npc("npc", 112, 63)] }) }, players: [hero()] }, [{ t: 0, op: "push", actor: "hero", dirs: "E,E,E" }], 36),
      makeCase("freeze-thaw-and-refreeze", "The loser thaws after exactly 120 ticks; ended blocked steps do not refreeze it, but a fresh explicit attempt at tick 145 does.", { board: "field", boards: { field: board({ items: [npc("npc", 112, 63)] }) }, players: [hero()] }, [{ t: 0, op: "push", actor: "hero", dirs: "E,E,E" }, { t: 145, op: "push", actor: "hero", dirs: "E", clear: true }], 150),
      makeCase("controlled-player-wins-between-movers", "Both moving: the user-controlled player wins.", { board: "field", boards: { field: board({ items: [npc("npc", 176, 63, { speed: 0.05 })] }) }, players: [hero()] }, [{ t: 0, op: "push", actor: "hero", dirs: "E,E,E" }, { t: 0, op: "push", actor: "npc", dirs: "W,W,W" }], 40),
      makeCase("faster-sprite-wins", "Neither controlled, both moving: the smaller ticksPerAdvance wins.", { board: "field", boards: { field: board({ items: [npc("slow", 48, 127, { speed: 0.05 }), npc("fast", 208, 127, { speed: 0.02 })] }) }, players: [far] }, [{ t: 0, op: "push", actor: "slow", dirs: "E,E,E,E,E" }, { t: 0, op: "push", actor: "fast", dirs: "W,W,W,W,W" }], 60),
      makeCase("equal-speed-larger-drawid-loses", "Total order (AD-25): equal speeds, the sprite with the larger drawId loses.", { board: "field", boards: { field: board({ items: [npc("first", 48, 127), npc("second", 208, 127)] }) }, players: [far] }, [{ t: 0, op: "push", actor: "first", dirs: "E,E,E,E,E" }, { t: 0, op: "push", actor: "second", dirs: "W,W,W,W,W" }], 90),
      makeCase("diversion-around-blocker", "R-51 item 3: a path-following item blocked by a sprite makes one local diversion (cap 1000, active mode) and the collision is not applied.", { board: "field", boards: { field: board({ pfMode: 2, items: [npc("walker", 48, 63, { speed: 0.02 }), npc("blocker", 144, 63)] }) }, players: [far] }, [{ t: 0, op: "path", actor: "walker", flags: 0, points: [[240, 63]] }], 90),
      makeCase("no-route-waits-then-continues", "R-51 item 4: with no route the actor waits, retesting each tick; when the blocker clears (tick 40) it continues, with no freeze.", { board: "field", boards: { field: corridor({ items: [npc("blocker", 144, 63), npc("walker", 48, 63, { speed: 0.02 })] }) }, players: [far] }, [{ t: 0, op: "path", actor: "walker", flags: 0, points: [[240, 63]] }, { t: 40, op: "teleport", actor: "blocker", x: 300, y: 63 }], 90),
      makeCase("no-route-wait-expires-and-stops", "R-51 item 4: after 120 ticks of waiting the actor stops, its queue clears and the direct result applies (the larger drawId, the walker, freezes).", { board: "field", boards: { field: corridor({ items: [npc("blocker", 144, 63, { speed: 0.02 }), npc("walker", 48, 63, { speed: 0.02 })] }) }, players: [far] }, [{ t: 0, op: "path", actor: "walker", flags: 0, points: [[240, 63]] }], 150),
    ],
  };
}

export function edgesBoardLinkProgram() {
  const west = board({
    w: 320,
    h: 320,
    music: "town.mid",
    links: { E: { board: "east" }, N: { program: "north-gate.prg" }, S: null, W: { board: "east" } },
  });
  const east = board({
    w: 320,
    h: 160,
    music: "field.mid",
    enterProgram: "east-enter.prg",
    vectors: [solid("rubble", 0, 100, 40, 130)],
    programs: [{ id: "welcome-mat", type: "step", layer: 0, points: rectPts(0, 64, 64, 128), program: "welcome.prg" }],
  });
  const both = { west, east };
  const start = (x, y) => ({ board: "west", boards: both, players: [hero({ x, y, speed: 0.02 })] });
  return {
    spec: ["movement-and-collision.md#e-28", "movement-and-collision.md#r-53", "movement-and-collision.md#e-19", "movement-and-collision.md#e-47", "movement-and-collision.md#e-48"],
    cases: [
      makeCase("no-link-edge-is-solid", "E-28: with no link the edge is solid; the step ends and the player stays.", start(144, 303), [{ t: 0, op: "push", actor: "hero", dirs: "S" }], 12),
      makeCase("board-link-arrives-opposite-edge", "R-53: leaving east at y = 95 arrives at the west edge of `east` at x = 15 keeping y = 95; the program under the arrival is deactivated (E-19), so walking on inside it does not fire, but leaving and re-entering does.", start(304, 95), [{ t: 0, op: "push", actor: "hero", dirs: "E" }, { t: 4, op: "push", actor: "hero", dirs: "E,E,E,E,W,W,W,W" }], 120),
      makeCase("arrival-clamps-along-edge", "R-53 item 2: the along-edge coordinate is clamped so the collision base lies inside the shorter board (y 300 becomes 160).", start(304, 303), [{ t: 0, op: "push", actor: "hero", dirs: "E" }], 14),
      makeCase("blocked-arrival-is-refused", "R-53 item 3: the arrival point overlaps a solid, so the move fails; board, position and the rest of the queue are unchanged and no thread starts or stops.", start(304, 127), [{ t: 0, op: "push", actor: "hero", dirs: "E,N" }], 30),
      makeCase("program-link-runs-program", "E-48: an edge whose link is a program runs it instead of loading a board; the player stays.", start(144, 31), [{ t: 0, op: "push", actor: "hero", dirs: "N" }], 12),
      makeCase("west-edge-arrives-east-edge", "R-53 mirrored: leaving west arrives at the east edge, innermost x = board width - 15.", start(16, 95), [{ t: 0, op: "push", actor: "hero", dirs: "W" }], 14),
    ],
  };
}

export function boardEntryThreadLifecycle() {
  const old = board({
    music: "town.mid",
    threads: [{ id: "town.clock", kind: "board" }, { id: "town.crowd", kind: "board" }, { id: "party.timer", kind: "persistent" }],
    items: [npc("guard", 112, 63, { thread: "guard.prg" }), npc("sign", 176, 63)],
  });
  const next = board({
    music: "town.mid",
    enterProgram: "inn-enter.prg",
    threads: [{ id: "inn.fire", kind: "board" }, { id: "party.timer", kind: "persistent" }, { id: "inn.bard", kind: "board" }],
    items: [npc("innkeeper", 112, 63, { thread: "keeper.prg" })],
  });
  const setup = { board: "town", boards: { town: old, inn: { ...next, music: "inn.mid" } }, players: [hero()] };
  const send = (t, caller, extra = {}) => ({ t, op: "send", board: "inn", x: 3, y: 3, layer: 0, caller, ...extra });
  return {
    spec: ["movement-and-collision.md#e-19", "movement-and-collision.md#reawakened-send-board", "movement-and-collision.md#e-47", "main-loop-and-startup.md#reawakened-board-entry"],
    cases: [
      makeCase("send-from-blocking-thread", "Send parks the caller and swaps between ticks: board threads and the old items' threads stop, the persistent thread survives, the new board's threads start in board order, then the enter program runs as a board thread because the sender was the one blocking thread.", setup, [send(2, { id: "story", kind: "blocking" })], 6),
      makeCase("send-from-board-thread", "A board thread of the old board that calls send dies with the board (it never resumes); with no blocking thread live the enter program runs as the blocking thread.", setup, [send(2, { id: "town.clock", kind: "board" })], 6),
      makeCase("second-send-replaces-first", "A second send posted in the same tick replaces the first (reawakened-send-board).", setup, [send(2, { id: "story", kind: "blocking" }, { board: "town" }), send(2, { id: "story", kind: "blocking" })], 6),
    ],
  };
}

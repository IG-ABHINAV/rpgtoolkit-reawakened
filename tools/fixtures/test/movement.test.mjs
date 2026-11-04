// Tests for the movement oracle (ticket 5.2): tools/fixtures/movement and its committed
// scenes under packages/core/test/fixtures/movement. The expected numbers asserted below are
// worked by hand from docs/spec/engine/movement-and-collision.md (R-50, R-51, R-54, E-34 ...),
// not read back from the simulation, so a regression in the oracle cannot confirm itself.
// This file imports nothing from packages/core.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../author/generate.mjs";
import { CORPUS, MOVEMENT_OUT, PROPOSED, SCENE_NAMES, checkMovementCorpus, checkMovementImports, movementFixtureFiles, workspaceImports } from "../movement/index.mjs";
import { isGlancing } from "../movement/geometry.mjs";
import { ticksPerAdvance } from "../movement/sim.mjs";
import { padMask } from "../movement/input.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const NAMED = [
  "movement-tile-pixel", "collision-solid-stairs-under", "collision-sprite-blocking", "edges-board-link-program",
  "board-entry-thread-lifecycle", "triggers-precedence", "actor-hydration-item-multitask", "pathfinding-axial-diagonal-vector",
  "input-replay-button-slots", "movement-waits", "animation-fallback-stance", "random-encounter",
  "demo-npc-pathfinding", "demo-npc-battle-trigger",
];

const load = (name) => JSON.parse(readFileSync(join(MOVEMENT_OUT, `${name}.json`), "utf8"));
const theCase = (scene, name) => {
  const found = load(scene).cases.find((c) => c.name === name);
  ok(found, `${scene}/${name} exists`);
  return found;
};
const rowAt = (c, t) => c.expect.find((r) => r.t === t);
const events = (c, type) => c.expect.flatMap((r) => (r.ev ?? []).filter((e) => e.e === type).map((e) => ({ t: r.t, ...e })));
const actorAt = (c, t, id) => rowAt(c, t).a.find((a) => a[0] === id);

test("every named scene resolves to a committed file, and the manifest lists them in order", () => {
  deepEqual(SCENE_NAMES, NAMED);
  const manifest = JSON.parse(readFileSync(join(MOVEMENT_OUT, "manifest.json"), "utf8"));
  deepEqual(manifest.scenes.map((s) => s.scene), NAMED);
  const onDisk = readdirSync(MOVEMENT_OUT).sort();
  deepEqual(onDisk, [...NAMED.map((n) => `${n}.json`), "manifest.json"].sort());
  for (const entry of manifest.scenes) {
    const doc = load(entry.scene);
    equal(doc.scene, entry.scene);
    ok(doc.cases.length > 0, `${entry.scene} has cases`);
    deepEqual(doc.cases.map((c) => c.name), entry.cases);
    for (const id of doc.proposed) ok(PROPOSED[id], `${entry.scene} cites ${id}`);
  }
});

test("every case carries one fact row per tick, in order, with positions, layers and no hashes", () => {
  for (const name of NAMED) {
    const doc = load(name);
    for (const c of doc.cases) {
      equal(c.expect.length, c.ticks, `${name}/${c.name} row count`);
      c.expect.forEach((row, index) => equal(row.t, index));
      if (c.setup.bindings === undefined) for (const row of c.expect) for (const actor of row.a) ok(Number.isFinite(actor[1]) && Number.isFinite(actor[2]) && Number.isInteger(actor[3]), `${name}/${c.name} actor row shape`);
    }
    ok(!/hash/i.test(JSON.stringify(doc.cases)), `${name} asserts no state or draw hash`);
  }
});

test("--check mode reproduces the committed fixtures byte for byte", () => {
  deepEqual(check(), []);
  const again = movementFixtureFiles();
  for (const [name, bytes] of movementFixtureFiles()) ok(again.find(([n]) => n === name)[1].equals(bytes), `${name} is deterministic`);
  for (const [name, bytes] of again) ok(readFileSync(join(MOVEMENT_OUT, name)).equals(bytes), `${name} matches disk`);
});

test("static import scan: the oracle and the generator import nothing from packages/core", () => {
  deepEqual(checkMovementImports(), []);
  deepEqual(workspaceImports('import a from "../../packages/core/src/x.ts"; import b from "@tk-reawakened/core"; import c from "./ok.mjs";'), ["../../packages/core/src/x.ts", "@tk-reawakened/core"]);
  const own = readdirSync(join(here, "..", "movement")).filter((f) => f.endsWith(".mjs"));
  ok(own.length >= 8);
});

test("the pinned demo corpus matches when it has been fetched", () => {
  deepEqual(checkMovementCorpus(repoRoot), []);
  deepEqual(load("demo-npc-pathfinding").corpus, CORPUS);
  deepEqual(load("demo-npc-battle-trigger").corpus, CORPUS);
});

test("R-50: integer ticks per advance, hand-worked", () => {
  equal(ticksPerAdvance(0.05, 0), 3); // 50 ms -> round(3.0)
  equal(ticksPerAdvance(0.05, 4), 1); // 50 - 400 < one tick
  equal(ticksPerAdvance(0, 0), 1);
  equal(ticksPerAdvance(0.01, -1), 7); // 110 ms -> floor((6600 + 500) / 1000)
  equal(ticksPerAdvance(0.05, -2), 15); // 250 ms
  equal(ticksPerAdvance(0.05, 9), 1); // game speed clamps to +4
});

test("movement-tile-pixel: a 32 px tile is 8 advances, 24 ticks, completing on the last advance", () => {
  const c = theCase("movement-tile-pixel", "tile-default-speed");
  deepEqual(actorAt(c, 0, "hero"), ["hero", 52, 63, 0, "moving", "E"]); // first advance on the tick the move starts
  deepEqual(actorAt(c, 3, "hero").slice(1, 3), [56, 63]);
  deepEqual(actorAt(c, 21, "hero").slice(1, 3), [80, 63]); // 8th advance of tile 1
  deepEqual(actorAt(c, 24, "hero").slice(1, 3), [84, 63]); // cadence continues into the next step
  const done = events(c, "movement-complete");
  deepEqual(done.map((e) => e.t), [69]); // 2 x 24 + 21
  deepEqual(actorAt(c, 69, "hero"), ["hero", 112, 95, 0, "waiting", "S"]);
  deepEqual(events(theCase("movement-tile-pixel", "tile-game-speed-clamps-to-one-tick"), "movement-complete").map((e) => e.t), [15]);
  deepEqual(events(theCase("movement-tile-pixel", "tile-game-speed-slower"), "movement-complete").map((e) => e.t), [49]);
});

test("collision-solid-stairs-under: blocked, sliding, layers and under facts", () => {
  const solid = theCase("collision-solid-stairs-under", "tile-solid-blocks");
  deepEqual(events(solid, "blocked").map((e) => e.t), [24, 27]); // the second E step blocks as well; the third never starts
  const slide = theCase("collision-solid-stairs-under", "pixel-glancing-slide");
  // R-54 item 3: the glancing SE step turns south, adopts the slid point and ends there, so x never moves.
  deepEqual(actorAt(slide, 0, "hero"), ["hero", 112, 67, 0, "waiting", "S"]);
  deepEqual(events(slide, "movement-complete").map((e) => e.t), [0]);
  const head = theCase("collision-solid-stairs-under", "pixel-head-on-blocks");
  equal(events(head, "blocked")[0].t, 0);
  equal(actorAt(head, 3, "hero")[2], 63); // head-on never changes y
  const stairs = theCase("collision-solid-stairs-under", "stairs-change-layer-and-layers-are-scoped");
  deepEqual(events(stairs, "layer-change").map((e) => [e.from, e.to, e.by]), [[0, 1, "stairs-up"]]);
  equal(events(stairs, "blocked").length, 0); // the layer-0 wall does not block a layer-1 sprite
  deepEqual(events(stairs, "under-enter").map((e) => e.vector), ["ceiling-under"]);
  deepEqual(events(stairs, "under-leave").map((e) => e.vector), ["ceiling-under"]);
  const table = load("collision-solid-stairs-under").thresholds.rows;
  deepEqual(table.map((r) => r.glancing), [true, false, false, true, false, true]);
  ok(isGlancing([1, 1], [1, 0], false)); // exactly 45 degrees is inclusive
  ok(!isGlancing([100, 101], [1, 0], false));
});

test("collision-sprite-blocking: R-51 loser order, 120-tick freeze, diversion, wait and stop", () => {
  const sc = "collision-sprite-blocking";
  const lose = theCase(sc, "stationary-loses");
  deepEqual(events(lose, "sprite-collision").map((e) => [e.t, e.winner, e.loser]), [[24, "hero", "npc"]]);
  const thaw = theCase(sc, "freeze-thaw-and-refreeze");
  equal(actorAt(thaw, 24, "npc")[4], "frozen");
  equal(actorAt(thaw, 143, "npc")[4], "frozen"); // 120 ticks: 24 .. 143
  equal(actorAt(thaw, 144, "npc")[4], "waiting");
  deepEqual(events(thaw, "thaw").map((e) => e.t), [144]);
  deepEqual(events(thaw, "sprite-collision").map((e) => e.t), [24, 145]); // still stationary, so it loses again
  deepEqual(events(theCase(sc, "controlled-player-wins-between-movers"), "sprite-collision").map((e) => e.winner), ["hero"]);
  deepEqual(events(theCase(sc, "faster-sprite-wins"), "sprite-collision").map((e) => [e.winner, e.loser]), [["fast", "slow"]]);
  deepEqual(events(theCase(sc, "equal-speed-larger-drawid-loses"), "sprite-collision").map((e) => [e.winner, e.loser]), [["first", "second"]]);
  const dive = theCase(sc, "diversion-around-blocker");
  equal(events(dive, "diversion").length, 1);
  equal(events(dive, "sprite-collision").length, 0); // the collision is not applied
  deepEqual(actorAt(dive, 89, "walker").slice(1, 3), [240, 63]); // it still reaches its own target
  const wait = theCase(sc, "no-route-waits-then-continues");
  equal(events(wait, "waiting-for-blocker").length, 1);
  equal(events(wait, "sprite-collision").length, 0);
  deepEqual(actorAt(wait, 89, "walker").slice(1, 3), [240, 63]);
  const stop = theCase(sc, "no-route-wait-expires-and-stops");
  deepEqual(events(stop, "waiting-for-blocker").map((e) => e.t), [16]);
  deepEqual(events(stop, "path-stopped").map((e) => e.t), [136]); // 120 retests
  deepEqual(events(stop, "sprite-collision").map((e) => [e.winner, e.loser]), [["blocker", "walker"]]);
});

test("edges-board-link-program: R-53 arrival, clamp, refusal and program links", () => {
  const sc = "edges-board-link-program";
  deepEqual(events(theCase(sc, "no-link-edge-is-solid"), "edge-blocked").map((e) => e.dir), ["S"]);
  const link = theCase(sc, "board-link-arrives-opposite-edge");
  deepEqual(actorAt(link, 0, "hero").slice(1, 3), [15, 95]);
  deepEqual(events(link, "enter-program").map((e) => e.program), ["east-enter.prg"]);
  equal(events(link, "trigger-deactivate").length, 1);
  deepEqual(link.expect.filter((r) => r.fired).map((r) => r.t), [59]); // re-entering after leaving, never on arrival
  deepEqual(actorAt(theCase(sc, "arrival-clamps-along-edge"), 0, "hero").slice(1, 3), [15, 160]);
  const refused = theCase(sc, "blocked-arrival-is-refused");
  deepEqual(events(refused, "arrival-rejected").map((e) => [e.x, e.y]), [[15, 127]]);
  equal(events(refused, "board-link").length, 0);
  deepEqual(actorAt(refused, 29, "hero").slice(1, 3), [304, 95]); // stayed on the source board; the queued N step still ran
  deepEqual(events(theCase(sc, "program-link-runs-program"), "program-link").map((e) => e.program), ["north-gate.prg"]);
  deepEqual(actorAt(theCase(sc, "west-edge-arrives-east-edge"), 0, "hero").slice(1, 3), [305, 95]);
});

test("board-entry-thread-lifecycle: board and item threads stop, persistent survives, new threads start in order", () => {
  const sc = "board-entry-thread-lifecycle";
  const blocking = theCase(sc, "send-from-blocking-thread");
  deepEqual(events(blocking, "threads-stopped")[0].ids, ["town.clock", "town.crowd", "item:guard"]);
  deepEqual(events(blocking, "threads-started")[0].ids, ["inn.fire", "inn.bard", "item:innkeeper"]);
  deepEqual(events(blocking, "enter-program").map((e) => e.as), ["board"]);
  equal(events(blocking, "caller-resume").length, 1);
  const board = theCase(sc, "send-from-board-thread");
  deepEqual(events(board, "enter-program").map((e) => e.as), ["blocking"]);
  equal(events(board, "caller-killed").length, 1);
  equal(events(board, "caller-resume").length, 0);
  deepEqual(events(blocking, "send-swap").map((e) => e.t), [3]); // posted on tick 2, swapped between ticks
  deepEqual(events(theCase(sc, "second-send-replaces-first"), "send-swap").map((e) => e.board), ["inn"]);
});

test("triggers-precedence: once-per-entry, repeat distance, precedence, conditions, gone, silent movement", () => {
  const sc = "triggers-precedence";
  const fired = (c) => c.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]);
  deepEqual(fired(theCase(sc, "step-on-once-per-entry-and-rearm")), [[15, "mat"], [55, "mat"]]);
  deepEqual(fired(theCase(sc, "repeat-distance")), [[15, "trail"], [31, "trail"], [47, "trail"]]);
  deepEqual(fired(theCase(sc, "key-press-versus-step-on")), [[15, "mat"], [60, "lever"], [70, "lever"]]);
  deepEqual(fired(theCase(sc, "layer-matching")), []);
  deepEqual(fired(theCase(sc, "layer-one-player-fires")), [[15, "upper"]]);
  deepEqual(fired(theCase(sc, "last-region-in-board-order-wins")), [[15, "second"]]);
  deepEqual(fired(theCase(sc, "items-before-regions-front-then-nearest")), [[7, "ahead"]]);
  deepEqual(fired(theCase(sc, "equal-front-and-distance-lowest-index")), [[7, "north-guard"]]);
  deepEqual(fired(theCase(sc, "condition-failure-falls-through")), [[15, "open-door"]]);
  const once = theCase(sc, "run-once-condition-before-set-after");
  deepEqual(fired(once), [[15, "intro"]]);
  deepEqual(once.expect.find((r) => r.vars).vars, { seen: 1 });
  equal(theCase(sc, "aborted-program-does-not-set").expect.some((r) => r.vars), false);
  const stop = theCase(sc, "stop-movement-clears-queue");
  deepEqual(actorAt(stop, 70, "hero").slice(1, 3), [112, 63]);
  deepEqual(fired(theCase(sc, "gone-suppresses-until-board-left")), [[15, "once-only"]]);
  const silent = theCase(sc, "movement-inside-a-trigger-is-silent");
  deepEqual(fired(silent), [[7, "shove"]]);
  deepEqual(actorAt(silent, 79, "hero").slice(1, 3), [176, 63]);
  deepEqual(fired(theCase(sc, "hidden-item-is-not-a-candidate")), [[39, "secret"]]);
});

test("actor-hydration-item-multitask: compacted order, hidden items and thread ownership", () => {
  const c = theCase("actor-hydration-item-multitask", "hydrate-order-and-item-threads");
  deepEqual(c.boot.filter((e) => e.e === "hydrate").map((e) => [e.id, e.drawId, e.index, e.slot, e.visible]), [
    ["hero", 0, 0, 0, true], ["ally", 1, 1, 1, true], ["clerk", 2, 0, 0, true], ["statue", 3, 1, 2, true], ["ghost", 4, 2, 3, false], ["cat", 5, 3, 5, true],
  ]);
  deepEqual(c.boot.find((e) => e.e === "threads-started").ids, ["hall.ambience", "item:clerk", "item:cat"]); // no thread for the hidden item
  deepEqual(events(c, "thread-stop").map((e) => [e.t, e.id]), [[2, "item:clerk"], [6, "item:ghost"]]);
  deepEqual(events(c, "thread-start").map((e) => [e.t, e.id]), [[4, "item:ghost"]]);
});

test("pathfinding-axial-diagonal-vector: routes, caps, nearest-free, tie order and cache", () => {
  const sc = "pathfinding-axial-diagonal-vector";
  const path = (name) => events(theCase(sc, name), "path")[0];
  const axial = path("axial-around-wall");
  equal(axial.route.length, 17);
  deepEqual(axial.route.at(-1), [208, 63]);
  ok(axial.route.every((p, i) => i === 0 || Math.abs(p[0] - axial.route[i - 1][0]) + Math.abs(p[1] - axial.route[i - 1][1]) === 32), "axial steps are 32 px, 4-way");
  ok(path("diagonal-around-wall").route.length < axial.route.length);
  deepEqual(path("vector-around-wall").route, [[81, 239], [143, 239], [208, 63]]); // corners of the wall grown by the base
  const blocked = path("blocked-goal-nearest-free");
  deepEqual(blocked.goalAdjusted, [176, 63]);
  equal(blocked.reached, true);
  deepEqual(path("tie-order-is-total").route, [[48, 95], [48, 127], [80, 127], [112, 127]]);
  const capped = path("unreachable-goal-approaches");
  equal(capped.capped, true);
  equal(capped.expansions, 1000);
  equal(capped.reached, false);
  const cache = events(theCase(sc, "cache-hit-edit-flush-and-new-route"), "path");
  deepEqual(cache.map((e) => e.cache), ["miss", "hit", "miss"]);
  ok(cache[2].route.length > cache[0].route.length);
});

test("input-replay-button-slots: bindings, dead zone, edges, merge, slots and click-to-move", () => {
  const sc = "input-replay-button-slots";
  equal(padMask({ axes: { x: 249, y: 0 }, buttons: 0 }), 0);
  equal(padMask({ axes: { x: 250, y: -1000 }, buttons: 16 }), 8 | 1 | 16);
  const kb = theCase(sc, "keyboard-diagonal-and-repeat");
  equal(rowAt(kb, 2).intent, "NE");
  deepEqual(kb.expect.flatMap((r) => (r.queue ?? []).map((q) => q.seq)), [1, 2, 3]);
  equal(rowAt(kb, 3).queue, undefined); // auto-repeat appends nothing
  equal(rowAt(theCase(sc, "diagonals-disabled-last-press-wins"), 2).intent, "E");
  const gp = theCase(sc, "gamepad-dead-zone-edges-and-merge");
  equal(rowAt(gp, 1).held.length, 0); // 249 is inside the dead zone
  deepEqual(rowAt(gp, 2).held, ["right"]); // 250 is active
  deepEqual(rowAt(gp, 3).queue.map((q) => q.key), ["up", "confirm"]); // ascending bit order
  equal(rowAt(gp, 4).queue, undefined); // a keyboard key on an action a pad already holds adds no entry
  deepEqual(rowAt(gp, 5).held, ["right"]);
  const dc = theCase(sc, "gamepad-disconnect-and-unknown-devices");
  deepEqual(rowAt(dc, 5).held, ["right"]); // device 1 still holds it
  deepEqual(rowAt(dc, 6).held, []);
  const ptr = theCase(sc, "pointer-click-to-move-and-button-slots");
  deepEqual(rowAt(ptr, 1).click, { logical: [100, 100], board: [260, 196], via: "pathfind" });
  equal(rowAt(ptr, 2).slot, "attack");
  equal(rowAt(ptr, 4).click.logical[0], 80); // one past the slot edge
  deepEqual(rowAt(ptr, 5).notes, ["slot-disabled:menu"]);
  deepEqual(rowAt(theCase(sc, "gamepad-only-named-actions"), 1).held, ["confirm"]); // the unbound menu bit is ignored
});

test("movement-waits: the wait is polled in the waits phase, one tick after completion", () => {
  const sc = "movement-waits";
  const pause = theCase(sc, "pause-thread-flag-waits-for-completion");
  deepEqual(events(pause, "movement-complete").map((e) => e.t), [23]);
  equal(rowAt(pause, 23).th.T, "wait:movement");
  equal(rowAt(pause, 24).th.T, "done");
  deepEqual(events(pause, "locate").map((e) => [e.t, e.x, e.y]), [[24, 144, 95]]);
  const free = theCase(sc, "without-the-flag-the-thread-continues");
  deepEqual(events(free, "continued").map((e) => e.t), [0]);
  deepEqual(events(free, "woke-mid-walk").map((e) => e.t), [10]);
  deepEqual(events(theCase(sc, "blocking-thread-implies-the-wait"), "walked").map((e) => e.t), [16]);
  const multi = theCase(sc, "multirun-one-wait-over-both-sprites");
  deepEqual(events(multi, "movement-complete").map((e) => [e.t, e.actor]), [[15, "a"], [31, "b"]]);
  deepEqual(events(multi, "both-done").map((e) => e.t), [32]);
  deepEqual(events(theCase(sc, "waypoint-path-copy-two-cycles"), "waypoint-complete").length, 1);
  const link = theCase(sc, "waypoint-link-sees-live-edit");
  ok(link.expect.some((r) => r.a.find((a) => a[0] === "a")[1] > 112), "the edited second point pulls the item past x = 112");
});

test("animation-fallback-stance: documented fall-backs, frame timing and stance completion", () => {
  const sc = "animation-fallback-stance";
  const diag = theCase(sc, "diagonal-walk-falls-back-to-horizontal");
  equal(actorAt(diag, 0, "hero")[6], "walk.E"); // NE facing, no NE walk: nearest horizontal
  deepEqual(actorAt(diag, 6, "hero").slice(6), ["walk.E", 1]); // 100 ms = 6 ticks per frame
  equal(actorAt(diag, 39, "hero")[4], "waiting"); // idleMs 500 = 30 ticks after movement ends on tick 11
  equal(actorAt(diag, 40, "hero")[4], "idling");
  equal(actorAt(diag, 40, "hero")[6], "walk.E"); // a missing idle uses the walk animation
  const idle = theCase(sc, "missing-idle-uses-walk-present-idle-loops");
  equal(actorAt(idle, 125, "hero")[6], "idle.S");
  const stance = theCase(sc, "stance-plays-once-and-completes");
  deepEqual(events(stance, "stance-complete").map((e) => [e.t, e.held]), [[20, false]]); // 3 frames x 6 ticks from tick 3
  const held = theCase(sc, "held-stance-until-movement-resumes");
  deepEqual(events(held, "stance-complete").map((e) => [e.t, e.held]), [[13, true]]);
  deepEqual(events(held, "stance-released").map((e) => e.t), [24]);
});

test("random-encounter: one roll per tile moved, after activation, with stable handoff data", () => {
  const sc = "random-encounter";
  const one = theCase(sc, "type-zero-one-roll-per-tile-after-activation");
  deepEqual(events(one, "tile-moved").map((e) => e.t), [7, 15, 23, 31, 39, 47]);
  equal(rowAt(one, 15).fired[0].id, "mat"); // activation fired on the same tick, before the roll
  const handoff = events(one, "fight-handoff");
  deepEqual(handoff.map((e) => [e.t, e.enemies, e.background, e.player]), [[23, ["rat.ene", "bat.ene"], "cave.bkg", "hero"]]);
  deepEqual(events(theCase(sc, "type-one-every-n-tiles"), "fight-handoff").map((e) => [e.t, e.enemies.length]), [[15, 1], [31, 4], [47, 1]]);
  equal(events(theCase(sc, "pixel-steps-within-a-tile-roll-once"), "rng-draw").length, 1);
  equal(events(theCase(sc, "board-forbids-battles"), "rng-draw").length, 0);
  equal(events(theCase(sc, "main-file-disables-fighting"), "tile-moved").length, 0);
  deepEqual(events(theCase(sc, "custom-fight-program"), "custom-fight-program").map((e) => e.program), ["fight.prg"]);
  deepEqual(events(theCase(sc, "no-enemy-of-the-skill-level"), "message").map((e) => e.text), ["No enemies of skill level 2 found."]);
});

test("demo scenes: the corpus pathfinding NPC intercepts, and a stationary player gets the battle handoff", () => {
  const battle = theCase("demo-npc-battle-trigger", "stationary-player-is-intercepted-and-fights");
  const fight = events(battle, "fightEnemy");
  deepEqual(fight.map((e) => [e.t, e.enemy, e.background]), [[80, "pirate.ene", "bkg.bkg"]]);
  equal(rowAt(battle, 36).th.man_wander, "wait:key");
  equal(rowAt(battle, 80).th.man_wander, "done");
  const path = events(battle, "path")[0];
  equal(path.mode, 2);
  deepEqual(path.goalAdjusted, [240, 223]); // the player's own node is blocked by its base
  const walk = theCase("demo-npc-pathfinding", "wander-when-the-player-is-far");
  deepEqual(events(walk, "rng-draw").slice(0, 2).map((e) => [e.n, e.value]), [[512, 300], [512, 200]]);
  deepEqual(events(walk, "path")[0].goal, [380, 167]); // 336 + (300 - 256), 223 + (200 - 256)
  const away = theCase("demo-npc-pathfinding", "intercept-but-the-player-keeps-moving");
  equal(events(away, "fightEnemy").length, 0);
});

// Scenes: input-replay-button-slots, movement-waits, animation-fallback-stance, random-encounter,
// demo-npc-pathfinding, demo-npc-battle-trigger (ticket 5.2). Authored from docs/spec; the two
// demo scenes also pin the fetched corpus programs they model (see index.mjs), which are read
// only at test time and never copied into the repository.

import { FLAGS } from "./sim.mjs";
import { runInput } from "./input.mjs";
import { board, hero, makeCase, npc, rectPts } from "./common.mjs";

const inputCase = (name, note, setup, events, ticks) => ({ name, note, setup, script: events, ticks, expect: runInput(setup, events, ticks) });
const key = (t, code, down = true, extra = {}) => ({ t, ev: { kind: "key", code, down, ...extra } });
const pad = (t, device, connected, x, y, buttons) => ({ t, ev: { kind: "gamepad", device, connected, axes: { x, y }, buttons } });
const pointer = (t, x, y) => ({ t, ev: { kind: "pointer", phase: "down", x, y } });

export function inputReplayButtonSlots() {
  const bindings = { keys: { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "confirm", Escape: "cancel" } };
  const slots = [
    { id: "attack", x: 16, y: 400, w: 64, h: 64, action: "confirm", enabled: true },
    { id: "back", x: 96, y: 400, w: 64, h: 64, action: "cancel", enabled: true },
    { id: "menu", x: 576, y: 16, w: 48, h: 48, action: "menu", enabled: false },
  ];
  const base = { bindings, slots, camera: [160, 96], allowDiagonals: true };
  return {
    spec: ["display-input-audio.md#e-110", "display-input-audio.md#e-112", "display-input-audio.md#reawakened-gamepad-contract", "movement-and-collision.md#e-24", "movement-and-collision.md#e-25"],
    cases: [
      inputCase("keyboard-diagonal-and-repeat", "E-24: two orthogonal keys give a diagonal only when diagonals are allowed; OS auto-repeat appends no queue entry; an unbound key is ignored; sequence numbers rise monotonically.", base, [key(1, "ArrowUp"), key(2, "ArrowRight"), key(3, "ArrowRight", true, { repeat: true }), key(4, "KeyQ"), key(5, "Enter"), key(6, "ArrowUp", false), key(7, "ArrowRight", false), key(8, "Enter", false)], 10),
      inputCase("diagonals-disabled-last-press-wins", "PROPOSED P-12: with diagonals off, two orthogonal keys move along the most recently pressed axis only.", { ...base, allowDiagonals: false }, [key(1, "ArrowUp"), key(2, "ArrowRight"), key(4, "ArrowUp", false), key(5, "ArrowRight", false)], 7),
      inputCase("gamepad-dead-zone-edges-and-merge", "Gamepad contract: axis magnitude 250 is active (below is 0), d-pad bits and axes merge, press edges append one entry each in ascending bit order, a held action adds none, and a held keyboard key plus a pad share one held state.", base, [pad(1, 0, true, 249, 0, 0), pad(2, 0, true, 250, 0, 0), pad(3, 0, true, 250, -1000, 16), key(4, "ArrowRight"), pad(5, 0, true, 0, 0, 0), key(6, "ArrowRight", false), pad(7, 0, true, 0, 0, 64)], 9),
      inputCase("gamepad-disconnect-and-unknown-devices", "A disconnect releases what that device held; events for a device that never connected, or for a device outside 0..3, are ignored; two devices merge.", base, [pad(1, 1, false, 0, 0, 1), pad(2, 4, true, 0, 0, 1), pad(3, 0, true, 0, 0, 8), pad(4, 1, true, 0, 0, 8), pad(5, 0, false, 0, 0, 0), pad(6, 1, false, 0, 0, 0)], 8),
      inputCase("pointer-click-to-move-and-button-slots", "E-25 and 5.6 slot shape: a click outside every slot is a click-to-move request in logical pixels and board pixels (camera offset added); a click in an enabled slot is a key-queue entry for its action; a click on a disabled slot is swallowed; PROPOSED P-13: slot hit-test is [x, x+w) x [y, y+h).", base, [pointer(1, 100, 100), pointer(2, 16, 400), pointer(3, 79, 463), pointer(4, 80, 463), pointer(5, 600, 30), { t: 6, ev: { kind: "slot-enabled", id: "menu", enabled: true } }, pointer(7, 600, 30)], 9),
      inputCase("gamepad-only-named-actions", "A gamepad adds nothing the bindings do not name: with no menu binding, the menu bit is ignored.", { ...base, bindings: { keys: { Enter: "confirm" } } }, [pad(1, 0, true, 0, 0, 64 | 16)], 3),
    ],
  };
}

const PAUSE = FLAGS.PAUSE_THREAD;
const thread = (id, kind, program, start = 0) => ({ id, kind, start, program });
const patrol = { id: "patrol", type: "waypoint", layer: 0, closed: false, points: [[48, 159], [112, 159], [112, 223], [48, 223]] };

export function movementWaits() {
  const field = (items, threads, extra = {}) => ({ board: "field", boards: { field: board({ vectors: [patrol], items, ...extra }) }, players: [hero({ x: 304, y: 295 })], threads });
  const a = () => npc("a", 48, 95, { speed: 0 });
  const b = () => npc("b", 48, 127, { speed: 0 });
  const where = (id, x, y) => ({ op: "locate", actor: id, x, y });
  return {
    spec: ["main-loop-and-startup.md#e-33", "movement-and-collision.md#e-22", "rpgcode-language.md#threads"],
    cases: [
      makeCase("pause-thread-flag-waits-for-completion", "tkMV_PAUSE_THREAD: the thread parks on a movement wait; the wait is polled in the `waits` phase, so it resumes on the tick after the movement finishes and then reads the by-reference location.", field([a()], [thread("T", "item", [{ op: "emit", name: "before" }, { op: "path", actor: "a", flags: PAUSE | FLAGS.PATHFIND, points: [[144, 95]] }, where("a", "ax", "ay"), { op: "emit", name: "after-wait" }, { op: "end" }])]), [], 30),
      makeCase("without-the-flag-the-thread-continues", "Without the flag the path runs concurrently: the thread emits at once, sleeps 10 ticks and wakes while the item is still walking.", field([a()], [thread("T", "item", [{ op: "path", actor: "a", flags: FLAGS.PATHFIND, points: [[144, 95]] }, { op: "emit", name: "continued" }, { op: "sleep", ticks: 10 }, { op: "emit", name: "woke-mid-walk" }, { op: "end" }])]), [], 30),
      makeCase("blocking-thread-implies-the-wait", "Movement started from a blocking program runs to completion before the program continues (E-33), with no flag.", { ...field([], [thread("main", "blocking", [{ op: "push", actor: "hero", dirs: "E,E" }, { op: "emit", name: "walked" }, { op: "end" }])]), players: [hero({ speed: 0 })] }, [], 40),
      makeCase("multirun-one-wait-over-both-sprites", "multiRun defers every start, then yields one movement wait over the collected sprites: the thread resumes after the slower sprite finishes.", field([a(), b()], [thread("T", "blocking", [{ op: "multiRun", moves: [{ op: "path", actor: "a", flags: FLAGS.PATHFIND, points: [[112, 95]] }, { op: "path", actor: "b", flags: FLAGS.PATHFIND, points: [[176, 127]] }] }, { op: "emit", name: "both-done" }, { op: "end" }])]), [], 50),
      makeCase("waypoint-path-copy-two-cycles", "tkMV_WAYPOINT_PATH copies the vector; cycles = 2 walks it twice then completes and releases the pause.", field([a()], [thread("T", "item", [{ op: "waypoint", actor: "a", flags: FLAGS.WAYPOINT_PATH | PAUSE, vector: "patrol", cycles: 2 }, { op: "emit", name: "patrol-done" }, { op: "end" }])]), [], 140),
      makeCase("waypoint-link-sees-live-edit", "tkMV_WAYPOINT_LINK reads the vector live: moving the second point at tick 12 changes the route from the next segment on.", field([a()], [thread("T", "item", [{ op: "waypoint", actor: "a", flags: FLAGS.WAYPOINT_LINK | PAUSE, vector: "patrol", cycles: 1 }, { op: "emit", name: "patrol-done" }, { op: "end" }])]), [{ t: 12, op: "editVector", action: "move", id: "patrol", points: [[48, 159], [176, 159], [112, 223], [48, 223]] }], 100),
    ],
  };
}

const ANIMS = {
  walk: { N: { frames: 4, delayMs: 100 }, E: { frames: 3, delayMs: 100 }, S: { frames: 4, delayMs: 100 }, W: { frames: 3, delayMs: 100 } },
  idle: { S: { frames: 2, delayMs: 200 } },
  stances: { wave: { frames: 3, delayMs: 100 }, kneel: { frames: 2, delayMs: 100, hold: true } },
};

export function animationFallbackStance() {
  const setup = () => ({ board: "field", boards: { field: board() }, players: [hero({ x: 112, y: 159, speed: 0.02, anims: ANIMS, idleMs: 500 })] });
  const press = (t, dir) => ({ t, op: "press", dir });
  return {
    spec: ["movement-and-collision.md#e-21", "character.md#defaults-and-fall-backs"],
    cases: [
      makeCase("diagonal-walk-falls-back-to-horizontal", "A missing diagonal walk falls back to the nearest horizontal direction (NE uses walk.E); a missing diagonal idle also ends on the walk animation, then holds frame 0 while standing.", setup(), [press(0, "NE")], 50),
      makeCase("missing-idle-uses-walk-present-idle-loops", "After idleMs (500 ms = 30 ticks) a missing idle animation uses the walk animation (facing W); with an idle animation (facing S) that one loops at its own delay.", setup(), [press(0, "W"), press(50, "S")], 130),
      makeCase("stance-plays-once-and-completes", "A custom stance plays once at its own delay (3 frames x 6 ticks) and reports a deterministic completion tick the stance-wait of entry 7 can consume.", setup(), [{ t: 3, op: "stance", actor: "hero", name: "wave" }], 30),
      makeCase("held-stance-until-movement-resumes", "A held stance stays on its last frame until movement resumes, then the release is reported.", setup(), [{ t: 2, op: "stance", actor: "hero", name: "kneel" }, press(24, "E")], 40),
    ],
  };
}

const BATTLE = (o = {}) => ({ allowed: true, type: 0, chances: 3, skill: 1, background: "cave.bkg", ...o });
const TABLE = [{ enemy: "rat.ene", skill: 1 }, { enemy: "bat.ene", skill: 1 }, { enemy: "troll.ene", skill: 3 }];

export function randomEncounter() {
  const arena = (battle, o = {}) => ({ board: "field", boards: { field: board({ battle, programs: o.programs ?? [] }) }, players: [hero({ speed: 0, ...(o.hero ?? {}) })], fightEnabled: o.fight ?? true, encounterTable: TABLE, customFight: o.custom ?? null, rng: o.rng ?? [] });
  const east = (dirs) => ({ t: 0, op: "push", actor: "hero", dirs });
  return {
    spec: ["movement-and-collision.md#e-40", "plugins-and-battle.md#random-encounters"],
    cases: [
      makeCase("type-zero-one-roll-per-tile-after-activation", "Type 0: one draw(chances) per tile moved, after trigger activation (the step region on the third tile fires first); a draw of 0 starts a fight: PROPOSED P-10 (count = 1 + draw(4), then one draw(pool) per enemy, pool = table entries of the board's skill level in table order).", arena(BATTLE(), { programs: [{ id: "mat", type: "step", layer: 0, points: rectPts(96, 32, 128, 96), program: "mat.prg" }], rng: [1, 2, 0, 1, 0, 1, 2, 1, 2] }), [east("E,E,E,E,E,E")], 60),
      makeCase("type-one-every-n-tiles", "Type 1: a fight every `chances` (2) tiles walked, with no probability draw.", arena(BATTLE({ type: 1, chances: 2 }), { rng: [0, 0, 3, 0, 1, 0, 1, 0, 0] }), [east("E,E,E,E,E,E")], 60),
      makeCase("pixel-steps-within-a-tile-roll-once", "Pixel movement: only a change of tile counts as a tile moved; eight 4 px steps cross one tile boundary.", { ...arena(BATTLE({ chances: 2 }), { rng: [1] }), boards: { field: board({ battle: BATTLE({ chances: 2 }), pixelMovement: 1 }) } }, [{ t: 0, op: "push", actor: "hero", dirs: "E,E,E,E,E,E,E,E" }], 40),
      makeCase("board-forbids-battles", "A board that does not allow battles never rolls.", arena(BATTLE({ allowed: false })), [east("E,E,E")], 40),
      makeCase("main-file-disables-fighting", "The main file's fighting switch off means no rolls.", arena(BATTLE(), { fight: false }), [east("E,E,E")], 40),
      makeCase("custom-fight-program", "With the custom-fight flag set, its program runs instead of the built-in handoff.", arena(BATTLE({ chances: 1 }), { custom: "fight.prg", rng: [0] }), [east("E")], 20),
      makeCase("no-enemy-of-the-skill-level", "No table entry of the board's skill level: the documented message, and no enemy draws.", arena(BATTLE({ chances: 1, skill: 2 }), { rng: [0] }), [east("E")], 20),
    ],
  };
}

/** The reachable-corpus program `demo/Prg/man_wander.prg`, as ops: abs() / range = 256 / intercept = 96 / itemPath(PAUSE_THREAD | PATHFIND) / threadSleep(0.5). */
const manProgram = [
  { op: "emit", name: "mwin" },
  { op: "waitKey" },
  { op: "emit", name: "mwincls" },
  { op: "emit", name: "fightEnemy", data: { enemy: "pirate.ene", background: "bkg.bkg" } },
];
const manWander = [
  {
    op: "loop",
    body: [
      { op: "locate", actor: "frap", x: "px", y: "py" },
      { op: "locate", actor: "man", x: "ix", y: "iy" },
      {
        op: "if",
        cond: ["near", "px", "py", "ix", "iy", 96],
        then: [
          { op: "path", actor: "man", flags: PAUSE | FLAGS.PATHFIND, goal: ["px", "py"] },
          { op: "locate", actor: "frap", x: "qx", y: "qy" },
          { op: "if", cond: ["same", "px", "py", "qx", "qy"], then: [{ op: "run", program: manProgram }, { op: "end" }] },
        ],
        else: [
          { op: "set", var: "ox", expr: ["sub", ["rand", 512], 256] },
          { op: "set", var: "oy", expr: ["sub", ["rand", 512], 256] },
          { op: "path", actor: "man", flags: PAUSE | FLAGS.PATHFIND, goal: [["add", "ix", "ox"], ["add", "iy", "oy"]] },
        ],
      },
      { op: "sleep", ticks: 30 },
    ],
  },
];

function demoSetup(player, rng = []) {
  const stand = board({ w: 480, h: 320, pfMode: 2, items: [npc("man", 336, 223, { speed: 0, thread: "man_wander.prg" })] });
  return { board: "start", boards: { start: stand }, players: [hero({ id: "frap", speed: 0, ...player })], rng, threads: [thread("man_wander", "item", manWander)] };
}

export function demoNpcPathfinding() {
  return {
    spec: ["movement-and-collision.md#e-33", "movement-and-collision.md#e-34"],
    cases: [
      makeCase("wander-when-the-player-is-far", "man_wander.prg with the player beyond 96 px: the item picks a random point within range 256 (two scripted draws per wander) and pathfinds there with the thread paused; the second goal is off the board, so the nearest free node is used; the thread then sleeps 0.5 s (30 ticks).", demoSetup({ x: 48, y: 63 }, [300, 200, 100, 400, 256, 256, 0, 511, 128, 128]), [], 220),
      makeCase("intercept-but-the-player-keeps-moving", "Inside 96 px the item pathfinds to the player's location (the blocked goal becomes the nearest free node); the player has moved on by the time it arrives, so no event runs and the loop repeats.", demoSetup({ x: 272, y: 223 }, [256, 256, 256, 256, 256, 256]), [{ t: 6, op: "push", actor: "frap", dirs: "N,N", clear: true }, { t: 60, op: "push", actor: "frap", dirs: "N,N" }], 150),
    ],
  };
}

export function demoNpcBattleTrigger() {
  return {
    spec: ["movement-and-collision.md#e-33", "plugins-and-battle.md#random-encounters"],
    cases: [
      makeCase("stationary-player-is-intercepted-and-fights", "The player stands still: the item arrives, the locations match, man.prg runs (message window, wait for a key, clear, fightEnemy(\"pirate.ene\", \"bkg.bkg\")) and the thread ends. The key press at tick 80 resumes the wait on the next tick.", demoSetup({ x: 272, y: 223 }), [{ t: 80, op: "keypress", key: "confirm" }], 100),
    ],
  };
}

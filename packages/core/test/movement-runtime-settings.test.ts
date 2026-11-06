import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  actorFromSource,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyItem,
  createEmptyMainFile,
  createEngine,
  createSpriteRuntime,
  inputPhaseRegistration,
  IR_VERSION,
  enqueueDirectionMove,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  startThread,
  utf8Encode,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type Engine,
  type GameState,
  type InputRecord,
  type SpriteRuntime,
  type TickReport,
} from "../src/index.ts";

type Files = Map<string, Uint8Array>;
type RunResult = {
  readonly diagnostics: { readonly code: string; readonly file: string; readonly line: number; readonly message: string }[];
  readonly report: TickReport;
};
type FixtureOptions = {
  readonly pixelMovement?: number;
  readonly enter?: string;
  readonly nextEnter?: string;
  readonly program?: string;
  readonly alternateMainMode?: number;
  readonly alternateMainWithoutCharacter?: boolean;
};
type Fixture = {
  readonly engine: Engine;
  readonly files: Files;
  readonly runtime: SpriteRuntime;
  readonly state: () => GameState;
  readonly pressA: () => RunResult;
};

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function boardBytes(enter: string): Uint8Array {
  const empty = createEmptyBoard();
  const cells = 40 * 30;
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    coordType: 0,
    tileMatrix: Array.from({ length: cells }, () => 0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
    threads: [],
    layerTitles: ["", ""],
    vectors: empty.vectors,
    properties: { ...empty.properties, enterPrg: enter, start: { x: 64, y: 64, layer: 1 } },
  }));
}

function authoredFiles(options: FixtureOptions): Files {
  const files: Files = new Map();
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    initBoard: "start.brd",
    initChar: "hero.tem",
    pixelMovement: options.pixelMovement ?? 0,
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("Boards/start.brd"), boardBytes("enter.prg"));
  if (options.nextEnter !== undefined) files.set(assetKey("Boards/next.brd"), boardBytes("next.prg"));
  const startup = options.program ?? `wait()\n${options.enter ?? "end()"}\n`;
  files.set(assetKey("Prg/enter.prg"), utf8Encode(startup));
  if (options.alternateMainMode !== undefined) {
    const alternateMain = { ...main, initBoard: "other.brd", initChar: options.alternateMainWithoutCharacter === true ? "" : main.initChar, pixelMovement: options.alternateMainMode };
    files.set(assetKey("other.gam"), unwrap(writeMainFile(alternateMain)));
    files.set(assetKey("Boards/other.brd"), boardBytes("other.prg"));
    files.set(assetKey("Prg/other.prg"), utf8Encode(options.nextEnter ?? "end()"));
  }
  if (options.nextEnter !== undefined) files.set(assetKey("Prg/next.prg"), utf8Encode(options.nextEnter));
  files.set(assetKey("Chrs/hero.tem"), unwrap(writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
  })));
  return files;
}

function run(engine: Engine, files: Files, ticks: number, inputs: readonly InputRecord[] = []) {
  const diagnostics: { readonly code: string; readonly file: string; readonly line: number; readonly message: string }[] = [];
  let remaining = ticks;
  let replies = [...inputs];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    diagnostics.push(...report.diagnostics);
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
      continue;
    }
    remaining -= report.ticksRun;
    if (remaining <= 0 || report.ticksRun === 0) return { diagnostics, report };
  }
  throw new Error("the host loop did not settle");
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const files = authoredFiles(options);
  const runtime = createSpriteRuntime();
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 11,
    assetIndex: createAssetIndex([...files.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "movement-runtime-settings-test",
    input: { bindings: { keys: { ArrowRight: "right", ArrowDown: "down", KeyA: "confirm" } }, allowDiagonals: true },
    startup: { presence: { hasPlayer: () => runtime.hasPlayer() }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 1200,
    spriteRuntime: runtime,
    phaseRegistrations: [
      inputPhaseRegistration({ pixelMovement: options.pixelMovement ?? 0 }),
      movementPhaseRegistration({ pixelMovement: options.pixelMovement ?? 0 }),
      { phase: "audio", run: (state) => { latest = state; } },
    ],
  });
  const state = (): GameState => {
    if (latest === null) throw new Error("the engine did not advance");
    return latest;
  };
  deepEqual(run(engine, files, 1).diagnostics, []);
  let parked = false;
  for (let guard = 0; guard < 300 && !parked; guard += 1) {
    deepEqual(run(engine, files, 1).diagnostics, []);
    parked = state().vm.threads.some((thread) => thread.wait?.kind === "input.key");
  }
  ok(parked, "the board-entry script is parked at wait()");
  const pressA = () => run(engine, files, 1, [{
    tick: state().time.tick,
    event: { kind: "key", name: "A", code: "KeyA", char: "a", down: true },
  }]);
  return { engine, files, runtime, state, pressA };
}

test("RPGCode pixelmovement setter results and coercion are visible to scripts (#1298)", () => {
  const fixture = makeFixture({ pixelMovement: 2, enter: [
    "before = pixelmovement()",
    'pixelmovement("off")', "afterOff = pixelmovement()",
    'pixelmovement("on", "off")', "afterOn = pixelmovement()",
    "setOnResult = pixelmovement(1)", "setOffResult = pixelmovement(0)", "noArgumentResult = pixelmovement()",
    "pixelmovement(0)", "afterNumericZero = pixelmovement()",
    "pixelmovement(-2)", "afterNegative = pixelmovement()",
    "unsupportedResult = pixelmovement(0, 1, 1)", "afterTooMany = pixelmovement()",
    'pixelmovement(" OFF ")', "afterWhitespace = pixelmovement()",
    "nullArgumentResult = pixelmovement(clearbuffer())", "afterNullArgument = pixelmovement()",
    'push("E")', "end()",
  ].join("\n") });
  const initialX = fixture.state().sprites.players[0]?.x;
  ok(initialX !== undefined);
  deepEqual(fixture.pressA().diagnostics, []);
  const state = fixture.state();
  equal(state.vm.globals.before, 1);
  equal(state.vm.globals.afteroff, 0);
  equal(state.vm.globals.afteron, 1);
  equal(state.vm.globals.setonresult, 1);
  equal(state.vm.globals.setoffresult, 0);
  equal(state.vm.globals.noargumentresult, 0);
  equal(state.vm.globals.unsupportedresult, 1);
  equal(state.vm.globals.aftertoomany, 1);
  equal(state.vm.globals.afterwhitespace, 1);
  equal(state.vm.globals.afternumericzero, 0);
  equal(state.vm.globals.nullargumentresult, 0);
  equal(state.vm.globals.afternullargument, 0);
  const player = state.sprites.players[0];
  ok(player !== undefined);
  equal(player.movement.active?.target.x ?? player.queue.moves[0]?.target.x, initialX + 32);
});

for (const [label, initialMode, walking, expectedDistance] of [
  ["tile to pixel", 0, 1, 4],
  ["pixel to tile", 1, 0, 32],
] as const) {
  test(`runtime pixelmovement toggle changes held-key steps (${label}, #1298)`, () => {
    const fixture = makeFixture({ pixelMovement: initialMode, enter: `pixelmovement(${walking})\nend()` });
    deepEqual(fixture.pressA().diagnostics, []);
    const beforeInput = fixture.state();
    const player = beforeInput.sprites.players[0];
    ok(player !== undefined);
    deepEqual(run(fixture.engine, fixture.files, 1, [{
      tick: beforeInput.time.tick,
      event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true },
    }]).diagnostics, []);
    const keyUpTick = fixture.state().time.tick;
    deepEqual(run(fixture.engine, fixture.files, 1, [{
      tick: keyUpTick,
      event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false },
    }]).diagnostics, []);
    deepEqual(run(fixture.engine, fixture.files, 40).diagnostics, []);
    const moved = fixture.state().sprites.players[0];
    ok(moved !== undefined);
    equal(moved.x, player.x + expectedDistance);
  });
}
test("movement phase registration applies runtime pixel walking to glancing diagonal movement (#1298)", () => {
  const fixture = makeFixture({ pixelMovement: 0 });
  const state = fixture.state();
  const board = state.world.board;
  const player = state.sprites.players[0];
  ok(board !== undefined && board !== null);
  ok(player !== undefined);
  const wall = {
    handle: "wall",
    attributes: 0,
    closed: 1,
    layer: 1,
    type: 1,
    points: [{ x: 66, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 90 }, { x: 66, y: 90 }],
  };
  state.world = { ...state.world, board: { ...board, vectors: [wall] }, movement: { walking: 1, pushing: 0 } };
  state.sprites.players[0] = { ...player, x: 48, y: 63 };
  enqueueDirectionMove(state.sprites, player.id, "SE", 1);

  movementPhaseRegistration().run(state);

  const moved = state.sprites.players[0];
  ok(moved !== undefined);
  equal(moved.x, 48, "the wall blocks the east component");
  equal(moved.y, 67, "pixel walking slides along the wall's south edge");
  equal(moved.movement.active, null);
});


for (const [targetKind, pushing, expectedDistance] of [
  ["player", 1, 8], ["player", 0, 32], ["item", 1, 8], ["item", 0, 32],
] as const) {
  test(`runtime pixelmovement setting controls ${targetKind} push increment (${expectedDistance}px, #1298)`, () => {
    const command = targetKind === "player" ? 'push("E", 0, 1)' : 'pushitem(0, "E", 1)';
    const fixture = makeFixture({ pixelMovement: 0, enter: `pixelmovement(1, ${pushing})\n${command}\nend()` });
    const state = fixture.state();
    let startX: number;
    if (targetKind === "player") {
      const player = state.sprites.players[0];
      ok(player !== undefined);
      startX = player.x;
    } else {
      const item = actorFromSource({ id: "item:0", kind: "item", source: "crate", x: 160, y: 160, layer: 1, handle: 0, item: createEmptyItem() }, state.world.board ?? null, 0, 0);
      state.sprites.items = [item];
      fixture.runtime.section.items = [item];
      startX = item.x;
    }
    deepEqual(fixture.pressA().diagnostics, []);
    const actor = targetKind === "player" ? fixture.state().sprites.players[0] : fixture.state().sprites.items[0];
    ok(actor !== undefined);
    const target = actor.movement.active?.target.x ?? actor.queue.moves[0]?.target.x;
    ok(target !== undefined);
    equal(target, startX + expectedDistance);
  });
}

test("runtime pixelmovement keeps pre-existing destinations and appends the next push using the new mode (#1298)", () => {
  const fixture = makeFixture({ pixelMovement: 2, enter: 'pixelmovement(1, 0)\npush("E")\nend()' });
  const player = fixture.state().sprites.players[0];
  ok(player !== undefined);
  const queuedTarget = player.x + 20;
  player.queue.moves = [{ source: "direction", target: { x: queuedTarget, y: player.y }, facing: "E" }];
  deepEqual(fixture.pressA().diagnostics, []);
  const after = fixture.state().sprites.players[0];
  ok(after !== undefined);
  ok(after.movement.active?.target.x === queuedTarget || after.queue.moves.some(({ target }) => target.x === queuedTarget));
  ok(after.movement.active?.target.x === queuedTarget + 32 || after.queue.moves.some(({ target }) => target.x === queuedTarget + 32));
});

test("runtime pixelmovement settings survive board changes and reset from the main file (#1298)", () => {
  const fixture = makeFixture({
    pixelMovement: 1,
    enter: 'pixelmovement(1, 1)\nsend("next.brd", 2, 2)\nend()',
    nextEnter: "afterBoard = pixelmovement()\nend()",
  });
  deepEqual(fixture.pressA().diagnostics, []);
  equal(fixture.state().vm.globals.afterboard, 1);
  deepEqual(fixture.state().world.movement, { walking: 1, pushing: 1 });
  startThread(fixture.state().vm, {
    ref: { kind: "inline", text: "pixelmovement(1, 1)\npixelmovement(0, 1)\nbeforeResetWalking = pixelmovement()\nreset()\nend()", ir: IR_VERSION },
    kind: "persistent",
    owner: "script",
  });
  deepEqual(run(fixture.engine, fixture.files, 40).diagnostics, []);
  deepEqual(fixture.state().world.movement, { walking: 1, pushing: 0 });
});

test("loading another main file initializes both runtime movement settings from its mode (#1298)", () => {
  const fixture = makeFixture({
    pixelMovement: 1,
    alternateMainMode: 2,
    enter: 'pixelmovement(0, 1)\nmainfile("other.gam")\nend()',
  });
  deepEqual(fixture.pressA().diagnostics, []);
  deepEqual(run(fixture.engine, fixture.files, 60).diagnostics, []);
  equal(fixture.state().world.board?.key, "boards/other.brd");
  deepEqual(fixture.state().world.movement, { walking: 1, pushing: 1 });
});

test("switching to a main file with no initChar drops the previous player (#1298)", () => {
  const fixture = makeFixture({
    pixelMovement: 1,
    alternateMainMode: 2,
    alternateMainWithoutCharacter: true,
    enter: 'mainfile("other.gam")\nend()',
  });
  ok(fixture.state().sprites.players[0] !== undefined, "the initial main file supplies a player");
  const switchStart = fixture.pressA();
  const switched = run(fixture.engine, fixture.files, 60);
  deepEqual([...switchStart.diagnostics, ...switched.diagnostics].map(({ code }) => code), ["startup.no-player"]);
  equal(fixture.state().engine.boot?.main, "other.gam");
  equal(fixture.state().engine.boot?.stage, "stopped");
  deepEqual(fixture.state().world.movement, { walking: 1, pushing: 1 });
  deepEqual(fixture.state().sprites.players, []);
});

test("blocking push resumes only at its runtime-selected target completion tick (#1298)", () => {
  const fixture = makeFixture({ pixelMovement: 0, enter: 'pixelmovement(1, 1)\npush("E", 0, 1)\ncontinued = 1\nend()' });
  const start = fixture.state().sprites.players[0];
  ok(start !== undefined);
  deepEqual(fixture.pressA().diagnostics, []);
  const issued = fixture.state();
  const player = issued.sprites.players[0];
  ok(player !== undefined);
  const targetX = player.movement.active?.target.x ?? player.queue.moves[0]?.target.x;
  ok(targetX !== undefined);
  equal(targetX, start.x + 8);
  equal(issued.vm.globals.continued, undefined);
  let completionTick: number | undefined;
  let resumedTick: number | undefined;
  for (let index = 0; index < 120; index += 1) {
    deepEqual(run(fixture.engine, fixture.files, 1).diagnostics, []);
    const current = fixture.state();
    const moved = current.sprites.players[0];
    ok(moved !== undefined);
    if (moved.x === targetX && moved.movement.active === null && moved.queue.moves.length === 0) {
      completionTick = current.time.tick;
      if (current.vm.globals.continued === 1) resumedTick = current.time.tick;
      break;
    }
    equal(current.vm.globals.continued, undefined);
    ok(current.vm.threads.some((thread) => thread.wait?.kind === "sprite.movement"));
  }
  ok(completionTick !== undefined);
  if (resumedTick === undefined) {
    deepEqual(run(fixture.engine, fixture.files, 1).diagnostics, []);
    resumedTick = fixture.state().time.tick;
    equal(fixture.state().vm.globals.continued, 1);
  }
  ok(resumedTick === completionTick || resumedTick === completionTick + 1);
});
test("createEngine scene registration initializes pixel walking without a main file and runtime commands override it (#1298)", () => {
  const files: Files = new Map([[assetKey("Boards/start.brd"), boardBytes("")]]);
  let latest: GameState | null = null;
  const state = (): GameState => {
    if (latest === null) throw new Error("the scene did not advance");
    return latest;
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex([...files.keys()]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "start.brd",
    width: 320,
    height: 240,
    maxTicks: 20,
    program: "sceneWalking = pixelmovement()\npixelmovement(0)\nsceneAfterToggle = pixelmovement()\nend()\n",
    phaseRegistrations: [
      inputPhaseRegistration({ pixelMovement: 1 }),
      movementPhaseRegistration({ pixelMovement: 1 }),
      { phase: "audio", run: (state) => { latest = state; } },
    ],
  });
  deepEqual(run(engine, files, 10).diagnostics, []);
  const finished = state();
  equal(finished.vm.globals.scenewalking, 1);
  equal(finished.vm.globals.sceneaftertoggle, 0);
  deepEqual(finished.world.movement, { walking: 0, pushing: 0 });
});

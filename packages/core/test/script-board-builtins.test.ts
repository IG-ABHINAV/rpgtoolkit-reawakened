import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, IR_VERSION, CORE_PLUGIN, createActorService, createGameState, createScriptServices, createDefaultVirtuals, runThreadsPhase, ScriptError, STEP_BUDGET, type Arg, type GameState, type WorldBoard } from "../src/index.ts";
import { applyWorldEffect, expireProgramTileEdits } from "../src/world/effects.ts";
import type { EffectRecord } from "../src/script/effects.ts";
import { startThread } from "../src/script/state.ts";
import { WORLD_PLUGIN } from "../src/script/packs/world.ts";

type BoardFixture = WorldBoard;

function board(): BoardFixture {
  return {
    key: assetKey("boards/test.brd"), coordType: 0, sizeX: 2, sizeY: 1, sizeL: 1,
    width: 64, height: 32, background: { r: 1, g: 2, b: 3 }, ambient: { r: 4, g: 5, b: 6 },
    battleBackground: "battle.bkg", battleSkill: 7,
    layers: [{ tiles: [{ asset: assetKey("tiles/a.tst"), tile: 0 }, null] }],
    vectors: [{ points: [{ x: 1, y: 2 }], attributes: 3, closed: 0, layer: 1, type: 2, handle: "v" }],
    programs: [{ program: "a.prg", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 1, activationType: 2, repeatDistance: 3, layer: 1, points: [{ x: 1, y: 2 }], closed: 0, handle: "p" }],
    layerTitles: ["", "Ground"], constants: ["zero", "one"],
    runtime: { tileEdits: [], tileTypes: ["NORMAL", "NORMAL"] },
  };
}

function stateWithBoard(): GameState {
  const state = createGameState({ seed: 12 });
  state.world = { ...state.world, board: board() };
  return state;
}

function programThread(state: GameState): number {
  return startThread(state.vm, { ref: { kind: "inline", text: "", ir: "1" }, kind: "persistent", owner: "script" }).id;
}

function applyTileEdit(state: GameState, thread: number, name: "put" | "layerput", args: (number | string)[]): void {
  const effect: EffectRecord = {
    seq: 1, tick: 0, thread, name, kind: "state-write", args, out: {}, result: null, patch: null, wait: null, request: null,
  };
  applyWorldEffect(state, effect);
}

function putTile(state: GameState, thread: number, x: number, y: number, asset: string): void {
  applyTileEdit(state, thread, "put", [x, y, asset]);
}

function finishThread(state: GameState, id: number): void {
  const thread = state.vm.threads.find((candidate) => candidate.id === id);
  if (thread === undefined) throw new Error(`missing thread ${id}`);
  thread.status = "finished";
}

test("board built-ins report board reads and synchronous world effects", () => {
  const state = stateWithBoard();
  const services = createScriptServices(state, [{ definition: WORLD_PLUGIN }]);
  const getName = services.commands.get("getboardname")?.spec;
  const put = services.commands.get("put")?.spec;
  equal(getName?.call(services.view, [], () => ({ value: null })).value, "boards/test.brd");
  const result = put?.call(services.view, [{ value: 1, ref: null }, { value: 1, ref: null }, { value: "tiles/new.tst", ref: null }], () => ({ value: null }));
  equal(result?.effects?.[0]?.section, "world");
  applyWorldEffect(state, { name: "put", args: [1, 1, "tiles/new.tst"], kind: "state-write" } as never);
  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/new.tst");
  const vector = services.commands.get("boardgetvector")?.spec?.call(services.view, [{ value: 0, ref: null }, { value: 0, ref: null }], () => ({ value: null }));
  deepEqual(vector?.out, [[1, 2], [2, 1], [3, 1], [4, 0], [5, 3]]);
});

test("lifecycle built-ins emit reset, main-file, trigger, game-over and one shared quit effect", () => {
  const state = createGameState({ seed: 12 });
  const services = createScriptServices(state, [{ definition: WORLD_PLUGIN }]);
  const call = (name: string, args: readonly Arg[] = []) => {
    const spec = services.commands.get(name)?.spec;
    if (spec === undefined) throw new Error(`missing command ${name}`);
    return spec.call(services.view, args, () => ({ value: null }));
  };
  equal(call("reset").effects?.[0]?.args?.[0], "reset");
  equal(call("mainFile", [{ value: "other.gam", ref: null }]).effects?.[0]?.args?.[0], "mainFile");
  equal(call("gone").effects?.[0]?.section, "triggers");
  equal(call("over").effects?.[0]?.args?.[0], "over");
  for (const alias of ["quitgame", "dos", "windows"]) equal(call(alias).effects?.[0]?.args?.[0], "quit");
});

test("obsolete world built-ins reject every documented call form", () => {
  const state = createGameState({ seed: 12 });
  const services = createScriptServices(state, [{ definition: WORLD_PLUGIN }]);
  const documentedCalls: readonly (readonly [string, readonly Arg[]])[] = [
    ["start", [{ value: "main.gam", ref: null }]],
    ["godos", [{ value: "echo", ref: null }]],
    ["win", []],
    ["animatedtiles", [{ value: 1, ref: null }]],
    ["parallax", [{ value: 1, ref: null }]],
    ["setconstants", [{ value: 1, ref: null }, { value: "name", ref: null }]],
    ["underarrow", []],
  ];
  for (const [name, documentedArgs] of documentedCalls) {
    const spec = services.commands.get(name)?.spec;
    if (spec === undefined) throw new Error(`missing command ${name}`);
    for (const args of [[], documentedArgs] as readonly (readonly Arg[])[]) {
      throws(
        () => spec.call(services.view, args, () => ({ value: null })),
        (error: unknown): error is ScriptError => error instanceof ScriptError && error.code === "builtin.obsolete",
      );
    }
  }
});

test("board virtual variables read hydrated board data", () => {
  const state = stateWithBoard();
  const virtuals = createDefaultVirtuals(state, createActorService(state.actors));
  equal(virtuals.read("boardBackground"), "battle.bkg");
  equal(virtuals.read("boardSkill"), 7);
  equal(virtuals.read("boardTitle[1]"), "Ground");
  equal(virtuals.read("constant[1]"), "one");
  equal(virtuals.read("ambientRed"), 4);
});

test("program Put expiry removes only finished owners on different cells", () => {
  const state = stateWithBoard();
  const live = programThread(state);
  const done = programThread(state);
  putTile(state, live, 1, 1, "tiles/live.tst");
  putTile(state, done, 2, 1, "tiles/done.tst");

  finishThread(state, done);
  expireProgramTileEdits(state);
  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/live.tst");
  equal(state.world.board?.layers[0]?.tiles[1], null);
  deepEqual(state.world.board?.runtime?.tileEdits.map((edit) => [edit.scope, edit.owner]), [["program", live]]);

  finishThread(state, live);
  expireProgramTileEdits(state);
  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/a.tst");
  deepEqual(state.world.board?.runtime?.tileEdits, []);
});

test("overlapping Put expiry preserves whichever owner is still live", () => {
  const olderExpiresFirst = stateWithBoard();
  const first = programThread(olderExpiresFirst);
  const second = programThread(olderExpiresFirst);
  putTile(olderExpiresFirst, first, 1, 1, "tiles/first.tst");
  putTile(olderExpiresFirst, second, 1, 1, "tiles/second.tst");

  finishThread(olderExpiresFirst, first);
  expireProgramTileEdits(olderExpiresFirst);
  equal(olderExpiresFirst.world.board?.layers[0]?.tiles[0]?.asset, "tiles/second.tst");
  equal(olderExpiresFirst.world.board?.runtime?.tileEdits[0]?.owner, second);
  equal(olderExpiresFirst.world.board?.runtime?.tileEdits[0]?.previous?.asset, "tiles/a.tst");

  finishThread(olderExpiresFirst, second);
  expireProgramTileEdits(olderExpiresFirst);
  equal(olderExpiresFirst.world.board?.layers[0]?.tiles[0]?.asset, "tiles/a.tst");
  deepEqual(olderExpiresFirst.world.board?.runtime?.tileEdits, []);

  const newerExpiresFirst = stateWithBoard();
  const surviving = programThread(newerExpiresFirst);
  const expiring = programThread(newerExpiresFirst);
  putTile(newerExpiresFirst, surviving, 1, 1, "tiles/surviving.tst");
  putTile(newerExpiresFirst, expiring, 1, 1, "tiles/expiring.tst");

  finishThread(newerExpiresFirst, expiring);
  expireProgramTileEdits(newerExpiresFirst);
  equal(newerExpiresFirst.world.board?.layers[0]?.tiles[0]?.asset, "tiles/surviving.tst");

  finishThread(newerExpiresFirst, surviving);
  expireProgramTileEdits(newerExpiresFirst);
  equal(newerExpiresFirst.world.board?.layers[0]?.tiles[0]?.asset, "tiles/a.tst");
});

test("board-scoped LayerPut survives overlapping program Put expiry", () => {
  const state = stateWithBoard();
  const earlier = programThread(state);
  const later = programThread(state);
  putTile(state, earlier, 1, 1, "tiles/program.tst");
  applyTileEdit(state, earlier, "layerput", [1, 1, 1, "tiles/board.tst"]);
  putTile(state, later, 1, 1, "tiles/later.tst");

  finishThread(state, later);
  expireProgramTileEdits(state);
  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/board.tst");

  finishThread(state, earlier);
  expireProgramTileEdits(state);
  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/board.tst");
  deepEqual(state.world.board?.runtime?.tileEdits.map((edit) => [edit.scope, edit.owner, edit.previous?.asset]), [["board", undefined, "tiles/a.tst"]]);
});

test("a killed highest-id Put owner expires before same-phase id reuse", () => {
  const state = stateWithBoard();
  const killer = startThread(state.vm, {
    ref: {
      kind: "inline",
      text: 'killthread(2)\nreplacement = thread("end()", 0)\nend()',
      ir: IR_VERSION,
    },
    kind: "persistent",
    owner: "script",
  }).id;
  const killed = programThread(state);
  equal(killer, 1);
  equal(killed, 2);
  applyTileEdit(state, killer, "layerput", [1, 1, 1, "tiles/board.tst"]);
  putTile(state, killer, 1, 1, "tiles/earlier.tst");
  putTile(state, killed, 1, 1, "tiles/killed.tst");
  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/killed.tst");

  const services = {
    ...createScriptServices(state, [{ definition: CORE_PLUGIN }, { definition: WORLD_PLUGIN }]),
    onThreadRemoved: () => expireProgramTileEdits(state),
  };
  runThreadsPhase(state.vm, services, STEP_BUDGET);
  equal(state.vm.globals.replacement, killed);
  equal(state.vm.threads.some((thread) => thread.id === killed && thread.kind === "board"), true);
  expireProgramTileEdits(state);

  equal(state.world.board?.layers[0]?.tiles[0]?.asset, "tiles/board.tst");
  deepEqual(state.world.board?.runtime?.tileEdits.map((edit) => [edit.scope, edit.owner, edit.previous?.asset]), [["board", undefined, "tiles/a.tst"]]);
});

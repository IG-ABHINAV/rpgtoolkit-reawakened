// First-board item hydration depends on #1253 / PR #1348. This integration test is expected to fail
// until that dependency is present; it proves #1173 does not suppress the first board's new item thread.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEmptyItem, createEmptyMainFile,
  createEngine, createSpriteRuntime, PACKAGE_ROOT, writeBoard, writeCharacter, writeItem, writeMainFile,
  type AssetKey, type GameState, type InputRecord,
} from "../src/index.ts";

function bytes(result: { readonly ok: true; readonly value: Uint8Array } | { readonly ok: false; readonly error: { readonly message: string } }): Uint8Array {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("startup cleanup preserves freshly authored board and item threads", () => {
  const encoder = new TextEncoder();
  const empty = createEmptyBoard();
  const board = {
    ...empty, sizeX: 10, sizeY: 10, sizeL: 1, tileMatrix: Array(100).fill(0),
    tileRuns: [{ lutIndex: 0, count: 100, marker: true }], layerTitles: ["", ""],
    threads: ["board.prg"],
    sprites: [{ itemFile: "token.itm", activationPrg: "", multitaskPrg: "item.prg", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 1, x: 48, y: 63, layer: 1, reserved: -1 }],
    properties: { ...empty.properties, start: { x: 48, y: 63, layer: 0 } },
  };
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), bytes(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, initBoard: "start.brd", initChar: "hero.tem", startupPrg: "start.prg" }))],
    [assetKey("Boards/start.brd"), bytes(writeBoard(board))],
    [assetKey("Item/token.itm"), bytes(writeItem({ ...createEmptyItem(), major: 2, minor: 4, name: "Token", movementAnimations: Array(8).fill(""), idleAnimations: Array(8).fill("") }))],
    [assetKey("Chrs/hero.tem"), bytes(writeCharacter({ ...createEmptyCharacter(), minor: 7, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill(""), idleAnimations: Array(8).fill(""), idleTime: 0, speed: 0.05 }))],
    [assetKey("Prg/start.prg"), encoder.encode('discarded = thread("temporaryran = 1", 0)\npersistent = thread("persistentran = 1; threadsleep(getthreadid(), 0)", 1)\nsleep(2)\nend()\n')],
    [assetKey("Prg/board.prg"), encoder.encode("boardran = 1\nthreadsleep(getthreadid(), 0)\n")],
    [assetKey("Prg/item.prg"), encoder.encode("itemran = 1\nthreadsleep(getthreadid(), 0)\n")],
  ]);
  const spriteRuntime = createSpriteRuntime();
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 11, assetIndex: createAssetIndex([...files.keys()]), assetRoot: PACKAGE_ROOT, mainFile: "main.gam",
    gameIdentity: "startup-item-lifetime-test", width: 320, height: 240, maxTicks: 600, spriteRuntime,
    startup: { presence: { hasPlayer: () => spriteRuntime.hasPlayer() }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
  });
  let replies: InputRecord[] = [];
  for (let n = 0; n < 100; n += 1) {
    const report = engine.advance(30, replies);
    deepEqual(report.diagnostics, []);
    replies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
    if (!report.loading) break;
  }
  const state = latest as GameState | null;
  ok(state, "the board reached a tick");
  equal(state.vm.globals.temporaryran, undefined, "startup's non-persistent thread never ran");
  equal(state.vm.threads.some((thread) => thread.id === state.vm.globals.discarded), false);
  equal(state.vm.globals.persistentran, 1);
  equal(state.vm.threads.some((thread) => thread.kind === "persistent" && thread.status !== "finished"), true);
  equal(state.vm.globals.boardran, 1, "the first board thread ran");
  equal(state.vm.globals.itemran, 1, "the first board's authored item multitask thread ran");
  equal(state.vm.threads.some((thread) => thread.kind === "item" && thread.status !== "finished"), true);
});

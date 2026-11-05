import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEmptyItem, createEmptyMainFile, createEngine, createSpriteRuntime, enqueueDirectionMove, PACKAGE_ROOT, runMovementPhase, snapshotGameSave, writeBoard, writeCharacter, writeItem, writeMainFile } from "../src/index.ts";
import type { AssetIndex, Engine, EngineInit, GameState, InputRecord, SpriteRuntime, TickReport } from "../src/index.ts";
import { TextEncoder } from "node:util";

const item = (file: string, multitaskPrg: string) => ({ itemFile: file, activationPrg: "", multitaskPrg, initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 32, y: 63, layer: 1, reserved: -1 });
type AuthoredGame = { files: Map<string, Uint8Array>; index: AssetIndex; main: string };
function game(startupProgram: string | null = null): AuthoredGame {
  const empty = createEmptyBoard();
  const makeBoard = (sprite: ReturnType<typeof item>, start: { x: number; y: number }) => writeBoard({ ...empty, sizeX: 10, sizeY: 10, sizeL: 1, tileMatrix: Array.from({ length: 100 }, () => 0), tileRuns: [{ lutIndex: 0, count: 100, marker: true }], layerTitles: ["", ""], sprites: [sprite], properties: { ...empty.properties, start: { ...start, layer: 1 } } });
  const encodedBoard = makeBoard(item("walker.itm", "item.prg"), { x: 200, y: 63 });
  const temporaryBoard = makeBoard(item("ghost.itm", "ghost.prg"), { x: 200, y: 63 });
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  if (!temporaryBoard.ok) throw new Error(temporaryBoard.error.message);
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, initBoard: "start.brd", initChar: "hero.tem", startupPrg: startupProgram === null ? "" : "start.prg" });
  if (!main.ok) throw new Error(main.error.message);
  const character = writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill("") });
  if (!character.ok) throw new Error(character.error.message);
  const itemBytes = writeItem({ ...createEmptyItem(), minor: 4, name: "Walker", movementAnimations: Array(8).fill("") });
  if (!itemBytes.ok) throw new Error(itemBytes.error.message);
  const files = new Map<string, Uint8Array>([
    [assetKey("main.gam"), main.value], [assetKey("boards/start.brd"), encodedBoard.value],
    [assetKey("boards/temp.brd"), temporaryBoard.value], [assetKey("chrs/hero.tem"), character.value],
    [assetKey("item/walker.itm"), itemBytes.value], [assetKey("item/ghost.itm"), itemBytes.value],
    [assetKey("prg/item.prg"), new TextEncoder().encode("threadsleep(getthreadid(), 1)\nthreadsleep(getthreadid(), 1)\n")],
    [assetKey("prg/ghost.prg"), new TextEncoder().encode("ghoststarted = 1\nthreadsleep(getthreadid(), 1)\nthreadsleep(getthreadid(), 1)\n")],
    [assetKey("prg/start.prg"), new TextEncoder().encode(startupProgram ?? "end()\n")],
  ]);
  return { files, index: createAssetIndex([...files.keys()]), main: "main.gam" };
}
function host(engine: Engine, files: Map<string, Uint8Array>, ticks: number, inputs: readonly InputRecord[] = [], loadedBytes: Uint8Array | null = null): TickReport {
  let remaining = ticks;
  let replies = [...inputs];
  for (let guard = 0; guard < 100; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    remaining -= report.ticksRun;
    if (report.loading) {
      replies = report.requests.flatMap<InputRecord>((request) => {
        if (request.kind === "asset") return [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }];
        if (request.kind === "loadBlob") return [{ tick: report.tickAfter, event: { kind: "blob.loaded" as const, reqId: request.reqId, bytes: loadedBytes } }];
        return [];
      });
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) return report;
  }
  throw new Error("engine host did not settle");
}
function makeEngine(authored: AuthoredGame, runtime: SpriteRuntime, phaseRegistrations: EngineInit["phaseRegistrations"]): Engine {
  return createEngine({ seed: 7, assetIndex: authored.index, assetRoot: PACKAGE_ROOT, mainFile: authored.main, gameIdentity: "board-item-runtime-link", width: 320, height: 240, maxTicks: 100, spriteRuntime: runtime, startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } }, ...(phaseRegistrations === undefined ? {} : { phaseRegistrations }) });
}

test("supplied sprite runtime mirrors item movement and stops item threads on hide/remove", () => {
  const authored = game();
  const states: GameState[] = [];
  const positions: number[] = [];
  const hiddenStates: { visible: boolean; thread: number | null; liveThreads: number }[] = [];
  const shownStates: { visible: boolean; thread: number | null; liveThreads: number }[] = [];
  const removedStates: { visible: boolean; thread: number | null; liveThreads: number }[] = [];
  let ticks = 0;
  const runtime = createSpriteRuntime();
  const engine = makeEngine(authored, runtime, [{ phase: "movement", run(current) {
    states.push(current);
    ticks += 1;
    const actor = current.sprites.items[0];
    if (actor === undefined) return;
    if (ticks === 2) {
      enqueueDirectionMove(current.sprites, actor.id, "E", 0);
      for (let tick = 0; tick < 24; tick += 1) runMovementPhase(current.sprites, current.world.board ?? null, tick);
      const x = current.sprites.items[0]?.x;
      if (x !== undefined) positions.push(x);
    }
    if (ticks === 8) runtime.hideItem(actor.id);
    if (ticks === 9) hiddenStates.push({ visible: actor.visible, thread: actor.multitaskThread, liveThreads: current.vm.threads.filter((thread) => thread.kind === "item" && thread.status !== "finished").length });
    if (ticks === 10) runtime.showItem(actor.id);
    if (ticks === 11) shownStates.push({ visible: actor.visible, thread: actor.multitaskThread, liveThreads: current.vm.threads.filter((thread) => thread.kind === "item" && thread.status !== "finished").length });
    if (ticks === 12) runtime.removeItem(actor.id);
    if (ticks === 13) removedStates.push({ visible: actor.visible, thread: actor.multitaskThread, liveThreads: current.vm.threads.filter((thread) => thread.kind === "item" && thread.status !== "finished").length });
  } }]);
  host(engine, authored.files, 16);
  const state = states.at(-1);
  if (state === undefined) throw new Error("engine did not run movement phase");
  const movedAt = positions[0];
  ok(movedAt !== undefined && movedAt > 32);
  equal(runtime.section.items[0]?.x, movedAt);
  deepEqual(hiddenStates[0], { visible: false, thread: null, liveThreads: 0 });
  const shownState = shownStates[0];
  ok(shownState !== undefined && shownState.visible && shownState.thread !== null && shownState.liveThreads === 1, "showItem starts a live replacement item thread");
  deepEqual(removedStates[0], { visible: false, thread: null, liveThreads: 0 });
  equal(state.vm.threads.some((thread) => thread.kind === "item" && thread.status !== "finished"), false);
});

test("initial board entry starts its item thread without retaining a temporary startup item thread", () => {
  const authored = game('send("temp.brd", 20, 20, 1)\nthreadsleep(getthreadid(), 0.05)\nend()\n');
  const runtime = createSpriteRuntime();
  const states: GameState[] = [];
  const engine = makeEngine(authored, runtime, [{ phase: "audio", run(current) { states.push(current); } }]);
  host(engine, authored.files, 12);
  const state = states.at(-1);
  if (state === undefined) throw new Error("engine did not run audio phase");
  equal(state.sprites.items.length, 1);
  equal(state.vm.globals.ghoststarted, 1, "the temporary startup board item's thread executed before cleanup");
  const activeItemThreads = state.vm.threads.filter((thread) => thread.kind === "item" && thread.status !== "finished");
  equal(activeItemThreads.length, 1, "only the initial board item's multitask thread remains active");
  deepEqual(activeItemThreads.map((thread) => thread.source), ["item:walker.itm"]);
  deepEqual(runtime.section.items.map(({ id, visible }) => [id, visible]), [["walker.itm", true]]);
});

test("loaded game rebinds supplied sprite runtime to restored item state and VM", () => {
  const authored = game();
  const initialRuntime = createSpriteRuntime();
  const initialStates: GameState[] = [];
  const initialEngine = makeEngine(authored, initialRuntime, [{ phase: "audio", run(current) {
    current.vm.globals.persistedmark = 42;
    initialStates.push(current);
  } }]);
  host(initialEngine, authored.files, 4);
  const savedState = initialStates.at(-1);
  if (savedState === undefined) throw new Error("source engine did not reach audio phase");
  const savedBytes = new TextEncoder().encode(snapshotGameSave(savedState));
  const loadingGame = game('load("slot")\nend()\n');
  const runtime = createSpriteRuntime();
  const restoredStates: GameState[] = [];
  let mutated = false;
  const engine = makeEngine(loadingGame, runtime, [{ phase: "movement", run(current) {
    if (!mutated && current.vm.globals.persistedmark === 42) {
      runtime.hideItem("walker.itm");
      mutated = true;
    }
    restoredStates.push(current);
  } }]);
  host(engine, loadingGame.files, 8, [], savedBytes);
  const restored = restoredStates.at(-1);
  if (restored === undefined) throw new Error("loaded engine did not reach movement phase");
  equal(mutated, true, "the restored save reached gameplay");
  equal(restored.vm.globals.persistedmark, 42);
  equal(restored.sprites.items[0]?.visible, false);
  equal(runtime.section.items[0]?.visible, false);
  equal(runtime.section.items[0]?.multitaskThread, null);
  equal(restored.vm.threads.some((thread) => thread.kind === "item" && thread.status !== "finished"), false);
});

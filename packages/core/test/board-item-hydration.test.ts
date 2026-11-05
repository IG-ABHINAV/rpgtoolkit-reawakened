// Authored-board item hydration, program precedence and item-owned multitask thread (E-45).
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  ANIMATION_MAGIC,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyItem,
  createEmptyMainFile,
  createEngine,
  createSpriteRuntime,
  fileProgramRef,
  inputPhaseRegistration,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  resolveProgram,
  triggerPhaseRegistration,
  writeAnimation,
  writeBoard,
  writeCharacter,
  writeItem,
  writeMainFile,
  type AssetKey,
  type Engine,
  type GameState,
  type InputRecord,
  type SurfaceId,
  type SurfacePixels,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const encoder = new TextEncoder();
const tokenPixels = new Uint8Array(32 * 32 * 4);
for (let i = 0; i < tokenPixels.length; i += 4) tokenPixels.set([20, 180, 40, 255], i);
const tokenAnimation = writeAnimation({
  magic: ANIMATION_MAGIC,
  major: 2,
  minor: 3,
  width: 32,
  height: 32,
  frames: [{ image: "token.png", transparent: { r: 255, g: 255, b: 255 }, sound: "" }],
  delay: 0,
  residue: new Uint8Array(),
});
if (!tokenAnimation.ok) throw new Error(tokenAnimation.error.message);
const item = {
  ...createEmptyItem(),
  major: 2,
  minor: 4,
  name: "Authored token",
  activationProgram: "item-activation.prg",
  multitaskProgram: "item-multitask.prg",
  movementAnimations: Array(8).fill("token.anm"),
  idleAnimations: Array(8).fill("token.anm"),
};
function placement(overrides = true) {
  return {
    itemFile: "token.itm",
    activationPrg: overrides ? "board-activation.prg" : "",
    multitaskPrg: overrides ? "board-multitask.prg" : "",
    initialVar: "",
    initialValue: "",
    finalVar: "",
    finalValue: "",
    loadingVar: "",
    loadingValue: "",
    activate: 0,
    activationType: 1,
    x: 48,
    y: 63,
    layer: 1,
    reserved: -1,
  };
}

function authoredBoard(overrides = true, separatePlayer = false) {
  return {
    ...createEmptyBoard(),
    sizeX: 10,
    sizeY: 10,
    sizeL: 1,
    tileMatrix: Array(100).fill(0),
    tileRuns: [{ lutIndex: 0, count: 100, marker: true }],
    sprites: [placement(overrides)],
    layerTitles: ["", ""],
    properties: { ...createEmptyBoard().properties, start: { x: separatePlayer ? 200 : 48, y: 63, layer: 0 } },
  };
}

function setup(overrides = true, multitask = "boardMultitask = boardMultitask + 1\nend()\n", separatePlayer = false): { engine: Engine; files: Map<AssetKey, Uint8Array>; state: () => GameState } {
  const board = authoredBoard(overrides, separatePlayer);
  const files = new Map<AssetKey, Uint8Array>();
  const mainKey = assetKey("main.gam");
  const boardKey = assetKey("Boards/start.brd");
  const itemKey = assetKey("Item/token.itm");
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, initBoard: "start.brd", initChar: "hero.tem" };
  const characterBytes = writeCharacter({
    ...createEmptyCharacter(),
    minor: 7,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
    idleAnimations: Array(8).fill(""),
    idleTime: 0,
    speed: 0.05,
  });
  const boardBytes = writeBoard(board);
  const itemBytes = writeItem(item);
  const mainBytes = writeMainFile(main);
  if (!boardBytes.ok) throw new Error(boardBytes.error.message);
  if (!itemBytes.ok) throw new Error(itemBytes.error.message);
  if (!mainBytes.ok) throw new Error(mainBytes.error.message);
  if (!characterBytes.ok) throw new Error(characterBytes.error.message);
  if (!tokenAnimation.ok) throw new Error(tokenAnimation.error.message);
  files.set(mainKey, mainBytes.value);
  files.set(boardKey, boardBytes.value);
  files.set(itemKey, itemBytes.value);
  files.set(assetKey("Chrs/hero.tem"), characterBytes.value);
  files.set(assetKey("Misc/token.anm"), tokenAnimation.value);
  files.set(assetKey("Bitmap/token.png"), encodePng(32, 32, tokenPixels));
  for (const [name, source] of Object.entries({
    "board-activation.prg": "boardActivation = 1\nend()\n",
    "item-activation.prg": "itemActivation = 1\nend()\n",
    "board-multitask.prg": multitask,
    "item-multitask.prg": "itemMultitask = itemMultitask + 1\nend()\n",
  })) files.set(assetKey(`Prg/${name}`), encoder.encode(source));
  const index = createAssetIndex([...files.keys()]);
  const loader = { index, root: PACKAGE_ROOT, read: (key: AssetKey) => files.get(key) };
  const spriteRuntime = createSpriteRuntime();
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 11,
    assetIndex: index,
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "board-item-hydration-test",
    startup: { presence: { hasPlayer: () => spriteRuntime.hasPlayer() }, savedGame: { load: () => ({ kind: "missing" as const }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 600,
    include: { shading: true, images: true, sprites: true },
    spriteRuntime,
    phaseRegistrations: [
      inputPhaseRegistration(),
      movementPhaseRegistration(),
      triggerPhaseRegistration({ programRef: (name) => resolveProgram(loader, name) === undefined ? null : fileProgramRef(loader, name) }),
      { phase: "audio", run: (state) => { latest = state; } },
    ],
  });
  return { engine, files, state: () => { if (latest === null) throw new Error("no tick"); return latest; } };
}

function advance(engine: Engine, files: Map<AssetKey, Uint8Array>, ticks: number, inputs: readonly InputRecord[] = []): void {
  let replies = [...inputs];
  for (let guard = 0; guard < 100; guard += 1) {
    const report = engine.advance(ticks, replies);
    replies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
    if (!report.loading) return;
  }
  throw new Error("asset loading did not settle");
}
function assertTokenPresented(engine: Engine): void {
  const commands = engine.drawList(0, { shading: true, images: true, sprites: true }).commands;
  const picture = commands.find((command) => command.kind === "blit"
    && "asset" in command.source && command.source.asset === assetKey("Bitmap/token.png"));
  ok(picture && picture.kind === "blit", "authored item animation presents its PNG frame");
  let screen: SurfacePixels | null = null;
  for (let revision = 0; revision < 64 && screen === null; revision += 1) screen = engine.surfacePixels(0 as SurfaceId, revision);
  ok(screen, "presented screen pixels are available");
  const pixelIndex = ((picture.dst.y + 4) * screen.w + picture.dst.x + 4) * 4;
  deepEqual(Array.from(screen.rgba.slice(pixelIndex, pixelIndex + 4)), [20, 180, 40, 255]);
}

function activate(engine: Engine, files: Map<AssetKey, Uint8Array>, state: GameState): void {
  advance(engine, files, 1, [{
    tick: state.time.tick,
    event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true },
  }]);
  advance(engine, files, 2);
}

test("board entry hydrates authored item appearance and board-level programs override item fallbacks", () => {
  const { engine, files, state: latest } = setup();
  advance(engine, files, 2);
  const state = latest();
  equal(state.sprites.items.length, 1);
  const sprite = state.sprites.items[0];
  ok(sprite);
  equal(sprite.source, "item/token.itm");
  equal(sprite.x, 48);
  equal(sprite.y, 63);
  equal(sprite.visible, true);
  deepEqual(sprite.visual.movement, item.movementAnimations);
  const placement = state.world.board?.items?.[0];
  ok(placement);
  equal(placement.activationPrg, "board-activation.prg");
  equal(placement.multitaskPrg, "board-multitask.prg");
  equal(sprite.multitaskProgram, "board-multitask.prg");
  ok(sprite.multitaskThread !== null, "board multitask program starts an item-owned thread on entry");
  equal(state.vm.globals.boardmultitask, 1);
  equal(state.vm.globals.itemmultitask, undefined);
  equal(state.vm.globals.boardactivation, undefined);
  equal(state.vm.globals.itemactivation, undefined);
  assertTokenPresented(engine);
  activate(engine, files, state);
  equal(latest().vm.globals.boardactivation, 1, "Enter runs the board activation override");
  equal(latest().vm.globals.itemactivation, undefined, "the item activation fallback is not run when overridden");
});
test("empty board program overrides fall back to the authored item multitask program", () => {
  const { engine, files, state: latest } = setup(false);
  advance(engine, files, 2);
  const state = latest();
  const sprite = state.sprites.items[0];
  ok(sprite);
  const boardPlacement = state.world.board?.items?.[0];
  ok(boardPlacement);
  equal(boardPlacement.activationPrg, "item-activation.prg");
  equal(sprite.multitaskProgram, "item-multitask.prg");
  ok(sprite.multitaskThread !== null);
  equal(state.vm.globals.itemmultitask, 1);
  equal(state.vm.globals.boardmultitask, undefined);
  assertTokenPresented(engine);
  activate(engine, files, state);
  equal(latest().vm.globals.itemactivation, 1, "Enter runs the item activation fallback");
  equal(latest().vm.globals.boardactivation, undefined);
});

test("an item-owned script reads and moves its own source sprite (#1253)", () => {
  const { engine, files, state: latest } = setup(true, 'itemlocation("source", startX, startY, startLayer)\nitempath("source", 0, 96, 63)\nthreadSleep(getThreadId(), 120)\nend()\n', true);
  advance(engine, files, 30);
  const state = latest();
  equal(state.vm.globals.startx, 48);
  equal(state.vm.globals.starty, 63);
  const sprite = state.sprites.items[0];
  ok(sprite);
  ok(sprite.x > 48, "the item actually moves along its own path");
});

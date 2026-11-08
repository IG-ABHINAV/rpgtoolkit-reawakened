import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEmptyMainFile, createEngine, inputPhaseRegistration, IR_VERSION, PACKAGE_ROOT, writeBoard, writeCharacter, writeMainFile, type GameState } from "@tk-reawakened/core";
import { INTERACTIVE_INPUT_BINDINGS, interactiveMenuBinding } from "../src/input-bindings.ts";

const here = dirname(fileURLToPath(import.meta.url));
const font = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "fonts", "tkr-8x8.fnt")));
const menuHand = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "cursors", "tkr-menu-hand.png")));
const encoder = new TextEncoder();
const SIZE = 64;

type KeyEvent = {
  readonly kind: "key";
  readonly name: string;
  readonly code: string;
  readonly char: string | null;
  readonly down: boolean;
};

type Game = {
  state(): GameState;
  booted(): boolean;
  step(events?: readonly KeyEvent[]): void;
};

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function boot(program: string, stockMenu = false): Game {
  const empty = createEmptyBoard();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg"];
  const files = new Map<string, Uint8Array>();
  files.set(assetKey("main.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem", ...(stockMenu ? { packagePlugins: ["stock_menu"] } : {}) })));
  files.set(assetKey("boards/start.brd"), unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 1200 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 }, enterPrg: "" },
  })));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", stats: { ...createEmptyCharacter().stats, hp: 10, maxHp: 20, level: 1 }, movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(program));

  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "runner-web-interactive-input-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: stockMenu ? 320 : SIZE,
    height: stockMenu ? 240 : SIZE,
    maxTicks: 1000,
    input: { bindings: interactiveMenuBinding(0).bindings },
    bundled: new Map([
      [assetKey("media/fonts/tkr-8x8.fnt"), font],
      [assetKey("media/cursors/tkr-menu-hand.png"), menuHand],
    ]),
    ...(stockMenu ? { packageCatalogue: [{
      name: "stock_menu", version: "1.0.0", namespace: "stock_menu", requests: [],
      definition: { id: "stock_menu", version: "1.0.0", commands: [] },
      startup: { kind: "inline" as const, text: readFileSync(join(here, "..", "..", "..", "stock", "stock_menu", "startup.prg"), "utf8"), ir: IR_VERSION, dialect: "tk3" as const },
    }] } : {}),
    phaseRegistrations: [...(stockMenu ? [inputPhaseRegistration({ menuKey: interactiveMenuBinding(0).menuKey })] : []), { phase: "audio", run: (state) => { latest = state; } }],
  });
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } }[] = [];
  const game: Game = {
    booted() {
      return latest?.engine.boot?.stage === "running";
    },
    state() {
      if (latest === null) throw new Error("no tick has run");
      return latest;
    },
    step(events = []) {
      const tick = latest?.time.tick ?? 0;
      const records = events.map((event) => ({ tick, event }));
      const report = engine.advance(1, [...replies, ...records] as never);
      replies = [];
      if (report.diagnostics.length > 0) throw new Error(`diagnostics: ${JSON.stringify(report.diagnostics)}`);
      for (const request of report.requests) {
        if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
      }
    },
  };
  for (let tick = 0; tick < 40; tick += 1) {
    game.step();
    if (game.booted()) break;
  }
  return game;
}

function spacePress(): readonly KeyEvent[] {
  const key = { kind: "key" as const, name: " ", code: "Space", char: " " };
  return [{ ...key, down: true }, { ...key, down: false }];
}

test("interactive Space stays the literal key for wait and get", () => {
  const game = boot("waitKey = wait()\ngetKey = get()\nend()");
  // The first press resolves wait(); the second remains available to get().
  game.step([...spacePress(), ...spacePress()]);
  for (let tick = 0; tick < 4; tick += 1) game.step();
  equal(game.state().vm.globals.waitkey, " ");
  equal(game.state().vm.globals.getkey, " ");
});

test("interactive Space selects a cursor-map point through the live binding", () => {
  const game = boot("map = createCursorMap()\ncursorMapAdd(20, 20, map)\nselected = cursorMapRun(map)\nend()");
  game.step(spacePress());
  for (let tick = 0; tick < 4; tick += 1) game.step();
  equal(game.state().vm.globals.selected, 0);
  ok(!game.state().vm.threads.some((thread) => thread.wait?.kind === "input.key"), "the interactive Space key resolves the cursor-map wait");
});

test("the shipped bindings open, navigate, confirm and cancel the stock menu", () => {
  const game = boot("end()", true);
  // A screen reads keys only once its thread has parked: a key that arrives while it is still drawing is older than its
  // park floor and is ignored, exactly as for `wait()`. So each step waits for the settled state and for the park.
  const parked = (state: GameState): boolean => state.vm.threads.some((thread) => thread.status === "waiting" && thread.wait?.kind === "input.key") || state.menu.screens.length === 0;
  const press = (name: string, code: string, settled: (state: GameState) => boolean): void => {
    game.step([{ kind: "key", name, code, char: null, down: true }]);
    game.step([{ kind: "key", name, code, char: null, down: false }]);
    for (let i = 0; i < 40 && !(settled(game.state()) && parked(game.state())); i += 1) game.step();
    ok(settled(game.state()), `${code} took effect`);
    ok(parked(game.state()), `the menu is waiting for input after ${code}`);
  };
  const stack = (): string[] => game.state().menu.screens.map((screen) => screen.screen);
  press("Enter", "Enter", (state) => state.menu.screens[0]?.screen === "main");
  press("ArrowDown", "ArrowDown", (state) => state.menu.screens[0]?.selection === 1);
  press("Space", "Space", (state) => state.menu.screens.length === 2);
  deepEqual(stack(), ["main", "equipment"]);
  press("Escape", "Escape", (state) => state.menu.screens.length === 1);
  press("Escape", "Escape", (state) => state.menu.screens.length === 0);
});

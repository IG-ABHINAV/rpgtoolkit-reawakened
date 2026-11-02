import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEmptyMainFile, createEngine, PACKAGE_ROOT, writeBoard, writeCharacter, writeMainFile, type GameState } from "@tk-reawakened/core";
import { INTERACTIVE_INPUT_BINDINGS } from "../src/input-bindings.ts";

const here = dirname(fileURLToPath(import.meta.url));
const font = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "fonts", "tkr-8x8.fnt")));
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
  step(events?: readonly KeyEvent[]): void;
};

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function boot(program: string): Game {
  const empty = createEmptyBoard();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg"];
  const files = new Map<string, Uint8Array>();
  files.set(assetKey("main.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" })));
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
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(program));

  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "runner-web-interactive-input-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SIZE,
    height: SIZE,
    maxTicks: 1000,
    input: { bindings: INTERACTIVE_INPUT_BINDINGS },
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
  });
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } }[] = [];
  const game: Game = {
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
  for (let tick = 0; tick < 40; tick += 1) game.step();
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

// Lifecycle of the RPGCode screen surface and message window (docs/spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle, GitHub #1045).
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  IR_VERSION,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  triggersPhaseRegistration,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type DrawCommand,
  type DrawList,
  type Engine,
  type GameState,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const font = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "fonts", "tkr-8x8.fnt")));
const encoder = new TextEncoder();
const SIZE = 64;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

type Game = {
  readonly engine: Engine;
  state(): GameState;
  advance(ticks: number, keys?: readonly string[]): void;
};

function boot(
  program: string,
  extra: Readonly<Record<string, Uint8Array>> = {},
  phaseRegistrations: NonNullable<Parameters<typeof createEngine>[0]["phaseRegistrations"]> = [],
): Game {
  const empty = createEmptyBoard();
  const files = new Map<string, Uint8Array>();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg", ...Object.keys(extra)];
  files.set(assetKey("main.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" })));
  files.set(assetKey("boards/start.brd"), unwrap(writeBoard({
    ...empty, sizeX: 40, sizeY: 30, sizeL: 1, tileMatrix: Array.from({ length: 1200 }, () => 0), tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""], properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 }, enterPrg: Object.hasOwn(extra, "prg/enter.prg") ? "enter.prg" : "" },
  })));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(program));
  for (const [path, bytes] of Object.entries(extra)) files.set(assetKey(path), bytes);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "surface-lifecycle-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SIZE,
    height: SIZE,
    maxTicks: 1000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }, ...phaseRegistrations],
  });
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } | { readonly kind: "key"; readonly name: string; readonly code: string; readonly char: null; readonly down: boolean } }[] = [];
  const game: Game = {
    engine,
    state() {
      if (latest === null) throw new Error("no tick has run");
      return latest;
    },
    advance(ticks, keys = []) {
      for (let remaining = ticks; remaining > 0;) {
        const tick = latest?.time.tick ?? 0;
        const inputs = keys.length === 0 ? [] : keys.flatMap((name, index) => [
          { tick: tick + index * 2, event: { kind: "key" as const, name, code: name, char: null, down: true } },
          { tick: tick + index * 2 + 1, event: { kind: "key" as const, name, code: name, char: null, down: false } },
        ]);
        keys = [];
        const report = engine.advance(1, [...replies, ...inputs] as never);
        remaining -= 1;
        replies = [];
        if (report.diagnostics.length > 0) throw new Error(`diagnostics: ${JSON.stringify(report.diagnostics)}`);
        for (const request of report.requests) {
          if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
        }
      }
    },
  };
  game.advance(40);
  return game;
}

function sync(game: Game): GameState {
  game.engine.drawList();
  return game.state();
}

function hasText(list: DrawList, text: string): boolean {
  return list.commands.some((cmd: DrawCommand) => cmd.kind === "text" && cmd.text === text);
}

test("outermost program end hides the message window and stops composing the script surface without clearing pixels", () => {
  const game = boot('mwin("hello")\ntext(1,1,"world")');
  const list = game.engine.drawList();
  const state = sync(game);
  ok(!hasText(list, "hello"), "message-window text is not composed after the outermost program ends");
  ok(!hasText(list, "world"), "screen text is not composed after the outermost program ends");
  equal(state.ui.message.text, "hello", "message-window text is kept in state");
  equal(state.ui.message.visible, false, "message window is hidden");
  equal(state.ui.draws.length, 1, "screen text draw is kept in state");
});

test("nested program end does not hide the message window while the outermost program runs", () => {
  const game = boot(
    'mwin("outer")\nexecuteprogram("nested.prg")\nwait()\nmwin("after")',
    { "prg/nested.prg": encoder.encode('mwin("nested")') },
  );
  const waitingList = game.engine.drawList();
  const waitingState = sync(game);
  ok(hasText(waitingList, "outer"), "outer message is composed while waiting");
  ok(hasText(waitingList, "nested"), "nested message is composed after the nested program ends");
  equal(waitingState.ui.message.visible, true, "message window stays visible when a nested program ends");
  equal(waitingState.ui.message.text, "outer\nnested", "message text accumulates across the nested call");

  game.advance(1, ["ENTER"]);
  const endedList = game.engine.drawList();
  const endedState = sync(game);
  ok(!hasText(endedList, "outer"), "message is hidden after the outermost program ends");
  equal(endedState.ui.message.visible, false, "message window is hidden after outermost end");
  equal(endedState.ui.message.text, "outer\nnested\nafter", "message text keeps the final line");
});

test("send and board load reset neither the message window nor the script surface", () => {
  const nextBoard = unwrap(writeBoard({
    ...createEmptyBoard(),
    sizeX: 10, sizeY: 10, sizeL: 1,
    tileMatrix: Array.from({ length: 100 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 100, marker: true }],
    layerTitles: ["", ""],
    properties: { ...createEmptyBoard().properties, start: { x: 64, y: 64, layer: 1 } },
  }));
  const game = boot('mwin("send test")\nsend("next.brd", 2, 2)\nwait()', { "boards/next.brd": nextBoard });
  game.advance(5);
  const list = game.engine.drawList();
  const state = sync(game);
  equal(state.world.board?.key, "boards/next.brd", "board changed");
  ok(hasText(list, "send test"), "message-window text stays composed across a send");
  equal(state.ui.message.visible, true, "message window stays visible across a send");
  equal(state.ui.message.text, "send test", "message text is unchanged by board load");
});

test("a thread starting and ending while the outermost program runs neither hides nor resets the message window", () => {
  // `thread` takes inline code, not a file name. The thread runs in the first tick's slack after the
  // main program's step budget is spent, and ends there while the main program still waits for a key.
  const game = boot('msg = "bg"\nmwin("main")\ndummy = thread("mwin(msg)", 0)\ni = 0\nwhile (i < 2500) { i = i + 1 }\nwait()\nmwin("after")');
  const list = game.engine.drawList();
  const state = sync(game);
  ok(state.vm.threads.every((thread) => thread.kind === "blocking" || thread.status === "finished"), "the thread has ended");
  equal(state.ui.message.text, "main\nbg", "thread start did not reset the text, and the thread's line was added");
  equal(state.ui.message.visible, true, "thread end did not hide the window");
  ok(hasText(list, "main") && hasText(list, "bg"), "both lines are composed while the outermost program waits");

  game.advance(1, ["ENTER"]);
  const ended = sync(game);
  equal(ended.ui.message.visible, false, "the outermost program's end hides it");
  equal(ended.ui.message.text, "main\nbg\nafter", "the stored text is kept");
});

test("the next outermost program start resets the stored message text and the script text layer", () => {
  // The start-up program ends with its window text and a screen text draw kept in state; the first board's
  // blocking enter program is the next outermost program.
  const game = boot('mwin("title")\ntext(1,1,"press a key")\nwait()', { "prg/enter.prg": encoder.encode('mwin("enter")\nwait()') });
  game.advance(10, ["ENTER"]);
  const state = sync(game);
  equal(state.world.board?.key, "boards/start.brd", "the first board is up");
  equal(state.ui.message.text, "enter", "the title text was reset when the enter program started");
  equal(state.ui.message.visible, true, "the enter program's window is visible while it runs");
  // Inference: the script text layer starts empty so nothing the previous program drew can reappear behind the next program.
  equal(state.ui.draws.length, 0, "the title screen's text draw did not survive into the next program");
  const list = game.engine.drawList();
  ok(hasText(list, "enter") && !hasText(list, "title") && !hasText(list, "press a key"), "only the enter program's own text is composed");
});

test("renderNow survives a board change and the end of the program that enabled it", () => {
  const nextBoard = unwrap(writeBoard({
    ...createEmptyBoard(),
    sizeX: 10, sizeY: 10, sizeL: 1,
    tileMatrix: Array.from({ length: 100 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 100, marker: true }],
    layerTitles: ["", ""],
    properties: { ...createEmptyBoard().properties, start: { x: 64, y: 64, layer: 1 } },
  }));
  const game = boot(
    'rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nsend("next.brd", 2, 2)\nwait()',
    { "boards/next.brd": nextBoard },
  );
  game.advance(5);
  const list = game.engine.drawList();
  const state = sync(game);
  const handle = state.surfaces.renderNow;
  equal(state.world.board?.key, "boards/next.brd", "board changed");
  ok(handle !== undefined && handle > 0, "render-now canvas exists");
  ok(
    list.commands.some((cmd: DrawCommand) => cmd.kind === "blit" && "surface" in cmd.source && cmd.source.surface === handle),
    "render-now canvas is still composed after the board change",
  );

  game.advance(1, ["ENTER"]);
  const ended = game.engine.drawList();
  equal(sync(game).vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), false, "the program has ended");
  ok(
    ended.commands.some((cmd: DrawCommand) => cmd.kind === "blit" && "surface" in cmd.source && cmd.source.surface === handle),
    "render-now canvas is still composed after the program ends",
  );
});

test("title program then first board shows no title text or message window over the board", () => {
  const game = boot('mwin("title")\ntext(1,1,"press a key")\nwait()');
  game.advance(10, ["ENTER"]);
  const list = game.engine.drawList();
  const state = sync(game);
  equal(state.world.board?.key, "boards/start.brd", "first board loaded after startup program ends");
  ok(!hasText(list, "title"), "title message-window text is not composed over the board");
  ok(!hasText(list, "press a key"), "title screen text is not composed over the board");
  equal(state.ui.message.visible, false, "message window is hidden after the title program ends");
});

test("enter program of a board reached by send is composed while waiting and hidden after it ends (#1132)", () => {
  const nextBoard = unwrap(writeBoard({
    ...createEmptyBoard(),
    sizeX: 10, sizeY: 10, sizeL: 1,
    tileMatrix: Array.from({ length: 100 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 100, marker: true }],
    layerTitles: ["", ""],
    properties: { ...createEmptyBoard().properties, enterPrg: "next-enter.prg", start: { x: 64, y: 64, layer: 1 } },
  }));
  const game = boot(
    'end()',
    {
      "prg/enter.prg": encoder.encode('send("next.brd", 2, 2)'),
      "boards/next.brd": nextBoard,
      "prg/next-enter.prg": encoder.encode('mwin("welcome")\nwait()'),
    },
  );
  // Advance past startup and the sending board's enter program.
  game.advance(25);
  const waitingState = sync(game);
  equal(waitingState.world.board?.key, "boards/next.brd", "destination board is active");
  equal(waitingState.ui.message.visible, true, "enter program window is visible while wait() is pending");
  equal(waitingState.ui.message.text, "welcome", "enter program message text is stored");
  const waitingList = game.engine.drawList();
  ok(hasText(waitingList, "welcome"), "enter program message is composed and drawn while waiting after send");

  // Dismiss the enter program's wait; it ends and hides the window.
  game.advance(1, ["ENTER"]);
  const endedState = sync(game);
  equal(endedState.ui.message.visible, false, "message window is hidden after the enter program ends");
  const endedList = game.engine.drawList();
  ok(!hasText(endedList, "welcome"), "message is no longer drawn after the enter program ends");
});

test("an enter program awaiting promotion survives a snapshot (#1132)", () => {
  const nextBoard = unwrap(writeBoard({
    ...createEmptyBoard(),
    sizeX: 10, sizeY: 10, sizeL: 1,
    tileMatrix: Array.from({ length: 100 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 100, marker: true }],
    layerTitles: ["", ""],
    properties: { ...createEmptyBoard().properties, enterPrg: "next-enter.prg", start: { x: 64, y: 64, layer: 1 } },
  }));
  const game = boot("end()", {
    "prg/enter.prg": encoder.encode('send("next.brd", 2, 2)\nwait()'),
    "boards/next.brd": nextBoard,
    "prg/next-enter.prg": encoder.encode('sleep(80)\nmwin("welcome")\nwait()'),
  });
  const state = sync(game);
  ok(state.engine.pendingEnterThread !== undefined, `destination enter program awaits promotion: ${JSON.stringify({ board: state.world.board?.key, threads: state.vm.threads })}`);
  const restored = restoreGameState(snapshot(state));
  state.engine = restored.engine;
  state.vm = restored.vm;
  game.advance(1, ["ENTER"]);
  game.advance(90);
  ok(hasText(game.engine.drawList(), "welcome"), "restored enter program is composed after its sender ends");
  game.advance(1, ["ENTER"]);
  ok(!hasText(game.engine.drawList(), "welcome"), "restored promoted program hides its window on ending");
});

test("engine presents no-enemies message in a blocking program (#1133)", () => {
  let fired = false;
  const game = boot('mwin("title")\nwait()', {}, [
    {
      phase: "triggers",
      run: (state, post) => {
        // Only after the start-up program has ended, so the engine message is posted outside any program.
        if (fired || post === undefined) return;
        if (state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished")) return;
        fired = true;
        post("battle", {
          thread: 0,
          name: "battle.noEnemies",
          kind: "state-write",
          args: [{
            trigger: "random",
            board: { key: "boards/start.brd", skill: 1, background: "night.bkg" },
            actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 0, y: 0, layer: 1 },
            message: "No enemies of skill level 1 found.",
          }],
          out: {},
          result: null,
          patch: null,
          wait: null,
          request: null,
        });
      },
    },
  ]);
  // Dismiss startup program.
  game.advance(10, ["ENTER"]);
  // One tick to execute triggers phase posting the battle.noEnemies event.
  game.advance(1);
  const state = sync(game);
  equal(state.ui.message.visible, true, "message window is visible for engine no-enemies message");
  equal(state.ui.message.text, "No enemies of skill level 1 found.", "stale title text was reset before displaying no-enemies message");
  const list = game.engine.drawList();
  ok(state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), "engine message owns an outermost program");
  ok(hasText(list, "No enemies of skill level 1 found."), "no-enemies message is composed and drawn");
  game.advance(1, ["ENTER"]);
  equal(sync(game).ui.message.visible, false, "dismissing the message ends its program and hides the window");
  ok(!hasText(game.engine.drawList(), "No enemies of skill level 1 found."), "dismissed message is no longer composed");
});

test("battle handoff program start resets the message window and does not prepend stale text (#1134)", () => {
  let customBattleFired = false;
  const game = boot(
    'mwin("stale title text")\nwait()',
    { "prg/fight.prg": encoder.encode('mwin("custom fight begins")\nwait()') },
    [
      {
        phase: "triggers",
        run: (state, post) => {
          // Only after the start-up program has ended, so the handoff starts the outermost blocking program.
          if (customBattleFired || post === undefined) return;
          if (state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished")) return;
          customBattleFired = true;
          post("battle", {
            thread: 0,
            name: "battle.customFight",
            kind: "state-write",
            args: [{
              trigger: "random",
              board: { key: "boards/start.brd", skill: 1, background: "night.bkg" },
              actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 0, y: 0, layer: 1 },
              program: "fight.prg",
            }],
            out: {},
            result: null,
            patch: null,
            wait: null,
            request: null,
          });
        },
      },
    ],
  );
  // Dismiss startup program.
  game.advance(10, ["ENTER"]);
  // Run custom fight handoff.
  game.advance(1);
  const state = sync(game);
  equal(state.ui.message.visible, true, "battle program message window is visible");
  equal(state.ui.message.text, "custom fight begins", "stale title text was reset when starting blocking battle request");
  const list = game.engine.drawList();
  ok(hasText(list, "custom fight begins") && !hasText(list, "stale title text"), "only custom fight text is composed");
});

test("trigger program start resets the stored message text and the script text layer (#1135)", () => {
  const triggerBoard = unwrap(writeBoard({
    ...createEmptyBoard(),
    sizeX: 40, sizeY: 30, sizeL: 1,
    tileMatrix: Array.from({ length: 1200 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""],
    programs: [{
      program: "trig.prg",
      graphic: "",
      initialVar: "", initialValue: "", finalVar: "", finalValue: "",
      activate: 0,
      activationType: 0,
      repeatDistance: 0,
      layer: 1,
      points: [{ x: 160, y: 160 }, { x: 256, y: 160 }, { x: 256, y: 256 }, { x: 160, y: 256 }],
      closed: 1,
      handle: "step_trig",
    }],
    properties: { ...createEmptyBoard().properties, start: { x: 64, y: 64, layer: 1 } },
  }));

  let stepTriggered = false;
  const game = boot(
    'mwin("stale title text")\ntext(1, 1, "stale draw text")\nwait()',
    { "boards/start.brd": triggerBoard },
    [
      {
        phase: "movement",
        run: (state) => {
          if (!stepTriggered && state.world.board?.key === "boards/start.brd") {
            stepTriggered = true;
            state.sprites.players = state.sprites.players.map((p) => ({
              ...p,
              x: 208,
              y: 208,
              movement: { ...p.movement, lastStepTick: state.time.tick, lastStepDistance: 32 },
            }));
          }
        },
      },
      triggersPhaseRegistration({ programRef: () => ({ kind: "inline", text: 'mwin("trigger activated")\nwait()', ir: IR_VERSION }) }),
    ],
  );
  // Dismiss startup program.
  game.advance(10, ["ENTER"]);
  // Step on trigger tile, then let the trigger program's first steps run.
  game.advance(2);
  const state = sync(game);
  equal(state.ui.message.visible, true, "trigger program window is visible");
  equal(state.ui.message.text, "trigger activated", "stale message text was reset when trigger program started");
  equal(state.ui.draws.length, 0, "previous text layer was emptied when trigger program started");
  const list = game.engine.drawList();
  ok(hasText(list, "trigger activated"), "trigger text is composed");
  ok(!hasText(list, "stale title text"), "stale message text is not composed");
  ok(!hasText(list, "stale draw text"), "stale screen text is not composed");
});

test("edge-link program start resets the stored message text and the script text layer (#1135)", () => {
  const edgeBoard = unwrap(writeBoard({
    ...createEmptyBoard(),
    sizeX: 40, sizeY: 30, sizeL: 1,
    tileMatrix: Array.from({ length: 1200 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""],
    links: { ...createEmptyBoard().links, north: "edge.prg" },
    properties: { ...createEmptyBoard().properties, start: { x: 64, y: 64, layer: 1 } },
  }));

  let exitTriggered = false;
  const game = boot(
    'mwin("stale title text")\ntext(1, 1, "stale draw text")\nwait()',
    {
      "boards/start.brd": edgeBoard,
      "prg/edge.prg": encoder.encode('mwin("edge link activated")\nwait()'),
    },
    [
      {
        phase: "movement",
        run: (state) => {
          if (!exitTriggered && state.world.board?.key === "boards/start.brd") {
            exitTriggered = true;
            state.sprites.players = state.sprites.players.map((actor) => ({
              ...actor,
              state: "moving",
              movement: { ...actor.movement, pendingExit: "N" },
            }));
          }
        },
      },
    ],
  );
  // Dismiss startup program.
  game.advance(10, ["ENTER"]);
  // Run edges phase with pending exit north to edge.prg.
  game.advance(1);
  const state = sync(game);
  equal(state.ui.message.visible, true, "edge program window is visible");
  equal(state.ui.message.text, "edge link activated", "stale message text was reset when edge program started");
  equal(state.ui.draws.length, 0, "previous text layer was emptied when edge program started");
  const list = game.engine.drawList();
  ok(hasText(list, "edge link activated"), "edge program text is composed");
  ok(!hasText(list, "stale title text"), "stale message text is not composed");
  ok(!hasText(list, "stale draw text"), "stale screen text is not composed");
});

test("a background board thread cannot redisplay a finished program's title (#1145)", () => {
  const game = boot("end()", {
    "prg/enter.prg": encoder.encode('text(1,1,"TITLE OVER ROOM")\ndummy = thread("wait()", 0)\nend()'),
  });
  game.advance(30);
  const state = sync(game);
  equal(state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), false);
  ok(state.vm.threads.some((thread) => thread.kind === "board" && thread.wait?.kind === "input.key"));
  ok(state.ui.draws.some((draw) => draw.text === "TITLE OVER ROOM"));
  ok(!hasText(game.engine.drawList(), "TITLE OVER ROOM"), "finished title must not be composed over room");
});

test("a visible message alone does not compose outside a program (#1145)", () => {
  const game = boot('mwin("seed")');
  const state = sync(game);
  equal(state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), false);
  state.ui.message = { ...state.ui.message, visible: true, text: "outside program" };
  ok(!hasText(game.engine.drawList(), "outside program"), "an open window alone does not activate composition");
});

test("the script-screen pixels stop composing at outermost program end (#1145)", () => {
  const game = boot('colorrgb(255,0,0)\nfillrect(0,0,10,10)\nwait()');
  const hasScriptLayer = (list: DrawList): boolean =>
    list.commands.some((cmd) => cmd.kind === "blit" && "surface" in cmd.source && Number(cmd.source.surface) === -1);
  ok(hasScriptLayer(game.engine.drawList()), "the running program composes its script-screen layer");
  game.advance(1, ["ENTER"]);
  ok(!hasScriptLayer(game.engine.drawList()), "the ended program no longer composes its retained pixels");
});

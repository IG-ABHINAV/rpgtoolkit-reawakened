// The pure-RPGCode middleware libraries (entry 18.7; `fixtures/plugins/`) under the
// real engine: the wrapped `mwin` reaches the engine's message window with the text
// every layer built, two engines run the same game to the same hash however the ticks
// are batched, and the layers' draw list is the one a game that wrote the final text
// by hand would have drawn.
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAssetIndex, createEmptyBoard, createEngine, PACKAGE_ROOT, writeBoard, type Engine } from "../src/index.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "plugins");

/** The four libraries' text, one after the other: the engine's scene mode runs one inline program. */
const LIBRARIES = ["weather-system.prg", "audio-stems.prg", "pace.prg", "hud-log.prg"]
  .map((name) => readFileSync(join(FIXTURES, name), "utf8"))
  .join("\n");

const INSTALL = `trace = ""\ninstallWeather()\ninstallStems()\ninstallPace()\ninstallHud()\n`;
const GAME = `weatherSet(1)\nmwin("hello")\nwait()\nend()`;
const WRAPPED = `${LIBRARIES}\n${INSTALL}${GAME}`;
/** What the engine's `mwin` receives once the four layers have run (hud > audio > weather > engine). */
const BY_HAND = `mwin("w:rain|a0:hello")\nwait()\nend()`;

function engineOf(program: string): Engine {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 60,
    program,
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  return engine;
}

/** The message window's text commands in the engine's draw list. */
function drawnText(engine: Engine): string[] {
  const texts: string[] = [];
  for (const command of engine.drawList().commands) {
    if (command.kind === "text") texts.push(command.text);
  }
  return texts;
}

test("the engine's message window shows the text every layer built, after the hud's wait", () => {
  const engine = engineOf(WRAPPED);
  const early = engine.advance(1, []);
  equal(early.diagnostics.length, 0);
  deepEqual(drawnText(engine), [], "the hud holds the line for its (paced) sleep before the engine shows it");

  const late = engine.advance(9, []);
  equal(late.diagnostics.length, 0);
  deepEqual(drawnText(engine), ["w:rain|a0:hello"]);
});

test("the wrapped game draws exactly what the same game with the final text written by hand draws", () => {
  const wrapped = engineOf(WRAPPED);
  const byHand = engineOf(BY_HAND);
  wrapped.advance(12, []);
  byHand.advance(12, []);

  deepEqual(wrapped.drawList().commands, byHand.drawList().commands);
});

test("two engines running the wrapped game reach the same hash at every tick, however the ticks are batched", () => {
  const stepped = engineOf(WRAPPED);
  const batched = engineOf(WRAPPED);
  const hashes: string[] = [];
  for (let tick = 0; tick < 12; tick += 1) {
    const report = stepped.advance(1, []);
    equal(report.diagnostics.length, 0);
    hashes.push(report.stateHash);
  }
  const all = batched.advance(12, []);

  equal(all.stateHash, hashes[11]);
  equal(new Set(hashes).size > 1, true, "the state moved across the run");
  deepEqual(stepped.drawList().commands, batched.drawList().commands);
});

test("the wrapped engine run is a different run from the bare game", () => {
  const wrapped = engineOf(WRAPPED);
  const bare = engineOf(`mwin("hello")\nwait()\nend()`);
  wrapped.advance(12, []);
  bare.advance(12, []);

  deepEqual(drawnText(bare), ["hello"]);
  equal(drawnText(wrapped)[0] !== drawnText(bare)[0], true);
});

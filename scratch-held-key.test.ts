import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  assetKey,
  createEmptyBoard,
  createGameState,
  createInputSection,
  hydrateSprites,
  inputPhaseRegistration,
  movementPhaseRegistration,
  type GameState,
  type WorldBoard,
} from "./packages/core/src/index.ts";

function makeBoard(): WorldBoard {
  const empty = createEmptyBoard();
  return {
    ...empty,
    key: assetKey("boards/test.brd"),
    width: 320,
    height: 240,
    sizeX: 10,
    sizeY: 8,
    sizeL: 1,
  } as unknown as WorldBoard;
}

function makeState(): GameState {
  const board = makeBoard();
  const state = createGameState({ seed: 1 });
  state.world = { board };
  state.sprites = hydrateSprites({
    board,
    players: [{ id: "hero", x: 48, y: 63, layer: 1, speed: 0.05, facing: "S", controlled: true }],
  });
  state.input = createInputSection({
    bindings: { keys: { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down" } },
    allowDiagonals: false,
  });
  return state;
}

const runInputPhase = inputPhaseRegistration({ pixelMovement: 0, pixelStep: 8 }).run;
const runMovement = movementPhaseRegistration().run;

function tick(state: GameState, t: number, events: Parameters<typeof applyInputEvent>[1][] = []): void {
  state.time.tick = t;
  for (const event of events) applyInputEvent(state.input, event);
  runInputPhase(state);
  runMovement(state);
}

test("REPRO: holding a direction key on main moves only one tile", () => {
  const state = makeState();
  const startX = state.sprites.players[0]!.x;

  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  for (let t = 1; t < 60; t += 1) tick(state, t);

  const endX = state.sprites.players[0]!.x;
  console.log(`moved ${endX - startX} px`);
  // With the bug, only one 32 px step happens. With the fix, at least 64 px.
  ok(endX - startX < 64, `BUG: expected one-step movement (< 64 px), moved ${endX - startX} px`);
});

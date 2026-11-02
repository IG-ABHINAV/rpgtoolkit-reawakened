import {
  applyInputEvent,
  assetKey,
  createEmptyBoard,
  createGameState,
  createInputSection,
  hydrateSprites,
  inputPhaseRegistration,
  movementPhaseRegistration,
} from "./packages/core/src/index.ts";

function makeBoard() {
  const empty = createEmptyBoard();
  return {
    ...empty,
    key: assetKey("boards/test.brd"),
    width: 320,
    height: 240,
    sizeX: 10,
    sizeY: 8,
    sizeL: 1,
  };
}

function makeState() {
  const board = makeBoard();
  const state = createGameState({ seed: 1 });
  state.world = { board };
  state.sprites = hydrateSprites({
    board,
    players: [{ id: "hero", x: 48, y: 63, layer: 1, speed: 0.05, facing: "S", controlled: true }],
  });
  state.input = createInputSection({
    bindings: { keys: { ArrowRight: "right" } },
    allowDiagonals: false,
  });
  return state;
}

const runInputPhase = inputPhaseRegistration({ pixelMovement: 0, pixelStep: 8 }).run;
const runMovement = movementPhaseRegistration().run;

function tick(state, t, events = []) {
  state.time.tick = t;
  for (const event of events) applyInputEvent(state.input, event);
  runInputPhase(state);
  runMovement(state);
}

const state = makeState();
const startX = state.sprites.players[0].x;
const positions = [];
tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
positions.push({ t: 0, x: state.sprites.players[0].x });
for (let t = 1; t < 80; t += 1) {
  tick(state, t);
  if (state.sprites.players[0].x !== positions[positions.length - 1].x) {
    positions.push({ t, x: state.sprites.players[0].x });
  }
}
console.log("startX:", startX);
console.log("position changes:", positions);
console.log("tiles:", (state.sprites.players[0].x - startX) / 32);

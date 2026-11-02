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
    bindings: { keys: { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" } },
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

function addBlockingThread(state) {
  state.vm.threads.push({
    id: 999,
    kind: "blocking",
    status: "waiting",
    wait: { kind: "sleep", global: true, until: 1000 },
    source: "probe",
    ref: { kind: "inline", text: "" },
    frames: [],
    locals: [],
    operandStack: [],
    returnTargets: [],
    errorHandlers: [],
    persisted: false,
  });
}

console.log("=== Regression 1: held key during blocking wait ===");
{
  const state = makeState();
  addBlockingThread(state);
  const startX = state.sprites.players[0].x;
  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  for (let t = 1; t < 60; t += 1) tick(state, t);
  const endX = state.sprites.players[0].x;
  console.log(`blocking wait: moved ${endX - startX} px (expected 0 if input blocked)`);
}

console.log("=== Regression 2: two arrows in sequence faster than one step ===");
{
  const state = makeState();
  const startX = state.sprites.players[0].x;
  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  tick(state, 1, [
    { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false },
    { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: true },
  ]);
  tick(state, 2, [{ kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: false }]);
  for (let t = 3; t < 60; t += 1) tick(state, t);
  const end = { x: state.sprites.players[0].x, y: state.sprites.players[0].y };
  console.log(`rapid sequence: delta x=${end.x - startX}, expected one step east then one step south`);
}

console.log("=== Regression 3: keyup during a step ===");
{
  const state = makeState();
  const startX = state.sprites.players[0].x;
  tick(state, 0, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true }]);
  tick(state, 5, [{ kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false }]);
  for (let t = 1; t < 60; t += 1) if (t !== 5) tick(state, t);
  const endX = state.sprites.players[0].x;
  console.log(`keyup during step: moved ${endX - startX} px (expected 32)`);
}

console.log("=== Regression 4: pointer click unaffected ===");
{
  const state = makeState();
  const start = { x: state.sprites.players[0].x, y: state.sprites.players[0].y };
  tick(state, 0, [{ kind: "pointer", x: 200, y: 150, buttons: 1 }]);
  for (let t = 1; t < 60; t += 1) tick(state, t);
  const end = { x: state.sprites.players[0].x, y: state.sprites.players[0].y };
  console.log(`pointer click: delta x=${end.x - start.x}, y=${end.y - start.y}`);
}

console.log("=== Regression 5: allowDiagonals off with two keys ===");
{
  const state = makeState();
  state.input.allowDiagonals = false;
  const start = { x: state.sprites.players[0].x, y: state.sprites.players[0].y };
  tick(state, 0, [
    { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true },
    { kind: "key", name: "DOWN", code: "ArrowDown", char: null, down: true },
  ]);
  for (let t = 1; t < 60; t += 1) tick(state, t);
  const end = { x: state.sprites.players[0].x, y: state.sprites.players[0].y };
  console.log(`diagonal off: delta x=${end.x - start.x}, y=${end.y - start.y} (expected one axis only)`);
}

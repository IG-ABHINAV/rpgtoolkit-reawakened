import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createCameraSection,
  clampCameraPosition,
  evaluateEasing,
  shake,
  shakeOffset,
  positionAt,
  realignCamera,
  initCameraForBoard,
  updateCamera,
  createGameState,
  createScriptServices,
  startProgram,
  runThreadsPhase,
  type CameraPoint,
  type CameraSection,
  type CameraTarget,
  type WorldBoard,
  assetKey,
  EffectBus,
  applyCameraEffect,
  WORLD_PLUGIN,
} from "../src/index.ts";

const dummyBoard = (width = 1000, height = 800): WorldBoard => ({
  key: assetKey("boards/test.brd"),
  coordType: 0,
  sizeX: Math.floor(width / 32),
  sizeY: Math.floor(height / 32),
  sizeL: 1,
  width,
  height,
  background: { r: 0, g: 0, b: 0 },
  ambient: { r: 0, g: 0, b: 0 },
  layers: [{ tiles: [] }],
  start: { x: 5, y: 5, layer: 1 },
});

test("camera section defaults match AD-33 and E-51", () => {
  const camera = createCameraSection(640, 480);
  equal(camera.x, 0);
  equal(camera.y, 0);
  equal(camera.prevX, 0);
  equal(camera.prevY, 0);
  equal(camera.viewportWidth, 640);
  equal(camera.viewportHeight, 480);
  equal(camera.deadzoneWidth, 0);
  equal(camera.deadzoneHeight, 0);
  equal(camera.smoothing, 0);
  equal(camera.smallBoard, "center-if-small");
  deepEqual(camera.target, { kind: "player" });
  equal(camera.pan, null);
  equal(camera.shake, null);
});

test("small boards center with clean borders under center-if-small and clamp under clamp-to-scene", () => {
  // 512x384 board in 640x480 viewport (S-01d layout)
  const centered = clampCameraPosition(0, 0, 640, 480, 512, 384, "center-if-small");
  equal(centered.x, -64);
  equal(centered.y, -48);

  const clamped = clampCameraPosition(0, 0, 640, 480, 512, 384, "clamp-to-scene");
  equal(clamped.x, 0);
  equal(clamped.y, 0);
});

test("large boards clamp cleanly at all edges", () => {
  // 1000x800 board in 640x480 viewport -> max x = 360, max y = 320
  const topLeft = clampCameraPosition(-50, -50, 640, 480, 1000, 800);
  equal(topLeft.x, 0);
  equal(topLeft.y, 0);

  const bottomRight = clampCameraPosition(500, 500, 640, 480, 1000, 800);
  equal(bottomRight.x, 360);
  equal(bottomRight.y, 320);

  const mid = clampCameraPosition(150, 200, 640, 480, 1000, 800);
  equal(mid.x, 150);
  equal(mid.y, 200);
});

test("camera tracking follows player position via CameraTarget port", () => {
  let playerPos: CameraPoint = { x: 400, y: 300 };
  const targetPort: CameraTarget = {
    getPlayerPosition: () => playerPos,
    getEntityPosition: () => null,
  };

  const board = dummyBoard(1000, 800);
  let camera = createCameraSection(640, 480);
  camera = updateCamera(camera, board, targetPort);

  // Target center (400, 300) in 640x480 viewport -> top-left = 400 - 320 = 80, 300 - 240 = 60
  equal(camera.x, 80);
  equal(camera.y, 60);

  // Move player
  playerPos = { x: 600, y: 500 };
  camera = updateCamera(camera, board, targetPort);
  // Target center (600, 500) -> top-left = 600 - 320 = 280, 500 - 240 = 260
  equal(camera.x, 280);
  equal(camera.y, 260);
});

test("camera tracking follows entity by ID", () => {
  const entities = new Map<number | string, CameraPoint>([
    [10, { x: 500, y: 400 }],
    ["npc_bob", { x: 350, y: 250 }],
  ]);
  const targetPort: CameraTarget = {
    getPlayerPosition: () => ({ x: 100, y: 100 }),
    getEntityPosition: (id) => entities.get(id) ?? null,
  };

  const board = dummyBoard(1000, 800);
  let camera: CameraSection = { ...createCameraSection(640, 480), target: { kind: "entity", entityId: 10 } };
  camera = updateCamera(camera, board, targetPort);
  equal(camera.x, 500 - 320);
  equal(camera.y, 400 - 240);

  camera = { ...camera, target: { kind: "entity", entityId: "npc_bob" } };
  camera = updateCamera(camera, board, targetPort);
  equal(camera.x, 350 - 320);
  equal(camera.y, 250 - 240);
});

test("camera deadzone bounding box suppresses small movements", () => {
  let playerPos: CameraPoint = { x: 400, y: 300 };
  const targetPort: CameraTarget = {
    getPlayerPosition: () => playerPos,
    getEntityPosition: () => null,
  };
  const board = dummyBoard(1000, 800);
  let camera = {
    ...createCameraSection(640, 480),
    x: 80,
    y: 60,
    deadzoneWidth: 20,
    deadzoneHeight: 20,
  };

  // Center is currently (80 + 320, 60 + 240) = (400, 300).
  // Target moves within deadzone box [380, 420] x [280, 320]:
  playerPos = { x: 410, y: 310 };
  camera = updateCamera(camera, board, targetPort);
  equal(camera.x, 80);
  equal(camera.y, 60);

  // Target moves outside deadzone box to 450 (> 420):
  playerPos = { x: 450, y: 300 };
  camera = updateCamera(camera, board, targetPort);
  // desired center becomes 450 - 20 = 430 -> top-left = 430 - 320 = 110
  equal(camera.x, 110);
  equal(camera.y, 60);
});

test("camera smoothing advances towards target deterministically", () => {
  const targetPort: CameraTarget = {
    getPlayerPosition: () => ({ x: 600, y: 400 }),
    getEntityPosition: () => null,
  };
  const board = dummyBoard(1000, 800);
  // Desired top-left is (280, 160)
  let camera = {
    ...createCameraSection(640, 480),
    x: 0,
    y: 0,
    smoothing: 4,
  };

  const xs: number[] = [];
  for (let tick = 0; tick < 35; tick++) {
    camera = updateCamera(camera, board, targetPort);
    xs.push(camera.x);
  }

  // Strictly non-decreasing progression towards 280
  for (let i = 1; i < xs.length; i++) {
    equal(xs[i]! >= xs[i - 1]!, true);
  }
  equal(camera.x, 280);
  equal(camera.y, 160);
});

test("scripted pan interpolates curves with plain JSON easing curves", () => {
  const board = dummyBoard(1000, 800);
  let camera: CameraSection = {
    ...createCameraSection(640, 480),
    x: 0,
    y: 0,
    pan: {
      startX: 0,
      startY: 0,
      targetX: 200,
      targetY: 100,
      elapsedTicks: 0,
      durationTicks: 10,
      easing: "smoothstep" as const,
    },
  };

  const trace: { x: number; y: number }[] = [];
  while (camera.pan !== null) {
    camera = updateCamera(camera, board, null);
    trace.push({ x: camera.x, y: camera.y });
  }

  equal(trace.length, 10);
  equal(camera.x, 200);
  equal(camera.y, 100);
  equal(camera.pan, null);

  // Replay gives identical trace
  let replay: CameraSection = {
    ...createCameraSection(640, 480),
    x: 0,
    y: 0,
    pan: {
      startX: 0,
      startY: 0,
      targetX: 200,
      targetY: 100,
      elapsedTicks: 0,
      durationTicks: 10,
      easing: "smoothstep" as const,
    },
  };
  for (let i = 0; i < 10; i++) {
    replay = updateCamera(replay, board, null);
    deepEqual({ x: replay.x, y: replay.y }, trace[i]);
  }
});

test("all five easing curves evaluate deterministically in [0, 1]", () => {
  for (const easing of ["linear", "smoothstep", "easeIn", "easeOut", "easeInOut"] as const) {
    equal(evaluateEasing(easing, 0), 0);
    equal(evaluateEasing(easing, 1), 1);
    const mid = evaluateEasing(easing, 0.5);
    equal(mid >= 0 && mid <= 1, true);
  }
});

test("shared shake primitive cycles corners and never uses RNG", () => {
  const s = shake(5, 8);
  equal(s.amplitude, 5);
  equal(s.remainingTicks, 8);

  const expectedCorners = [
    { x: -5, y: -5 },
    { x: 5, y: -5 },
    { x: -5, y: 5 },
    { x: 5, y: 5 },
    { x: -5, y: -5 },
    { x: 5, y: -5 },
    { x: -5, y: 5 },
    { x: 5, y: 5 },
  ];

  for (let tick = 0; tick < 8; tick++) {
    deepEqual(shakeOffset(s.amplitude, tick), expectedCorners[tick]);
  }
});

test("positionAt interpolates between prev and current coordinates with presentation alpha", () => {
  const camera = {
    ...createCameraSection(640, 480),
    prevX: 100,
    prevY: 200,
    x: 120,
    y: 240,
    shake: shake(4, 2),
  };

  // Alpha 0: at prev (with shake offset corner 0: -4, -4)
  const atZero = positionAt(camera, 0);
  equal(atZero.x, 100 - 4);
  equal(atZero.y, 200 - 4);

  // Alpha 0.5: midpoint (110, 220) + (-4, -4) = (106, 216)
  const atMid = positionAt(camera, 0.5);
  equal(atMid.x, 110 - 4);
  equal(atMid.y, 220 - 4);

  // Alpha 1: at current (120, 240) + (-4, -4) = (116, 236)
  const atOne = positionAt(camera, 1);
  equal(atOne.x, 120 - 4);
  equal(atOne.y, 240 - 4);
});

test("realignCamera aligns immediately without smoothing", () => {
  const board = dummyBoard(1000, 800);
  const camera = {
    ...createCameraSection(640, 480),
    x: 0,
    y: 0,
    smoothing: 10,
    pan: { startX: 0, startY: 0, targetX: 100, targetY: 100, elapsedTicks: 1, durationTicks: 10, easing: "linear" as const },
    shake: shake(5, 5),
  };

  const realigned = realignCamera(camera, board, { x: 500, y: 400 });
  equal(realigned.x, 500 - 320);
  equal(realigned.y, 400 - 240);
  equal(realigned.prevX, realigned.x);
  equal(realigned.prevY, realigned.y);
  equal(realigned.pan, null);
  equal(realigned.shake, null);
});

test("camera built-ins execute through RPGCode program", () => {
  const state = createGameState({ seed: 0 });
  state.world = { ...state.world, board: dummyBoard(1000, 800) };
  state.camera = createCameraSection(640, 480);
  state.camera.x = 45;
  state.camera.y = 85;

  const bus = new EffectBus(state, () => {});
  bus.register("camera", (effect) => applyCameraEffect(state, effect));

  const services = createScriptServices(
    state,
    [{ definition: WORLD_PLUGIN }],
    undefined,
    undefined,
    undefined,
    "test",
    (section, effect) => bus.dispatchRecorded(section, effect),
  );

  const script = `
    cx = 0;
    cy = 0;
    getcorner(cx, cy);
    cameraPanTo(250, 150, 0.5, "smoothstep");
    cameraFollow(7);
    cameraReset();
    cameraShake(0.2, 6);
  `;

  startProgram(state.vm, { kind: "inline", text: script, ir: "5", dialect: "tk3" });
  runThreadsPhase(state.vm, services, 100);

  equal(state.vm.globals["cx"], 45);
  equal(state.vm.globals["cy"], 85);
  deepEqual(state.camera.target, { kind: "player" });
  equal(state.camera.deadzoneWidth, 0);
  equal(state.camera.shake !== null, true);
  equal(state.camera.shake?.amplitude, 6);
  equal(state.camera.shake?.remainingTicks, 12);
});

test("cameraShake validates arguments and rejects non-finite values", () => {
  const state = createGameState({ seed: 0 });
  state.camera = createCameraSection(640, 480);

  throws(() => {
    applyCameraEffect(state, {
      args: ["shake", NaN, 5],
    } as never);
  }, /finite numbers/);

  // Negative duration is a no-op
  applyCameraEffect(state, {
    args: ["shake", -1, 5],
  } as never);
  equal(state.camera.shake, null);
});

test("with no tracked sprite the camera centres on the board start, which is in pixels (E-53)", () => {
  const board = { ...dummyBoard(2000, 2000), start: { x: 900, y: 700, layer: 1 } };
  const camera = initCameraForBoard(createCameraSection(640, 480), board);
  deepEqual({ x: camera.x, y: camera.y }, { x: 900 - 320, y: 700 - 240 });
});

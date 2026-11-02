/**
 * Dynamic Camera & Viewport model (AD-33, E-51; docs/spec/engine/movement-and-collision.md#e-51).
 *
 * Implements camera tracking, tick-based smoothing, deadzone bounding box,
 * centring for small boards (center-if-small), bounds clamping, scripted pans
 * with easing curves, and the deterministic shared shake primitive.
 */

import type { CameraPoint, CameraTarget } from "../ports/camera.ts";
import type { EffectRecord } from "../script/effects.ts";
import type { GameState } from "../save/state.ts";
import type {
  CameraEasing,
  CameraPanState,
  CameraSection,
  CameraShakeState,
  CameraTrackingTarget,
} from "../save/sections/camera.ts";
import type { WorldBoard } from "./model.ts";
import { ScriptError } from "../script/errors.ts";

/** Where the camera centres with no tracked sprite: the board's start position, which is stored in board pixels on every layout (E-53, board.md `startX`/`startY`). */
function boardStartPoint(board: WorldBoard | null): CameraPoint | null {
  if (board?.start === undefined) return null;
  return { x: board.start.x, y: board.start.y };
}

/** Supported easing function names for scripted pans (AD-33, E-51). */
export const CAMERA_EASINGS = [
  "linear",
  "smoothstep",
  "easeIn",
  "easeOut",
  "easeInOut",
] as const;

/** Create the default camera state (AD-33, E-51). */
export function createCameraSection(viewportWidth = 640, viewportHeight = 480): CameraSection {
  return {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    viewportWidth: Math.max(1, Math.round(viewportWidth)),
    viewportHeight: Math.max(1, Math.round(viewportHeight)),
    deadzoneWidth: 0,
    deadzoneHeight: 0,
    smoothing: 0,
    smallBoard: "center-if-small",
    target: { kind: "player" },
    pan: null,
    shake: null,
  };
}

/**
 * Clamp camera coordinates to scene bounds or center if the board is smaller than the viewport.
 * Per-axis calculation:
 * - If board dimension < viewport dimension:
 *     If smallBoard === "center-if-small": -Math.floor((viewport - board) / 2)
 *     Else: 0
 * - Else: clamp desired coordinate between 0 and board - viewport.
 */
export function clampCameraPosition(
  desiredX: number,
  desiredY: number,
  viewportWidth: number,
  viewportHeight: number,
  boardWidth: number,
  boardHeight: number,
  smallBoard: "center-if-small" | "clamp-to-scene" = "center-if-small",
): CameraPoint {
  let x = Math.round(desiredX);
  let y = Math.round(desiredY);

  if (boardWidth < viewportWidth) {
    x = smallBoard === "center-if-small" ? -Math.floor((viewportWidth - boardWidth) / 2) : 0;
  } else {
    x = Math.max(0, Math.min(boardWidth - viewportWidth, x));
  }

  if (boardHeight < viewportHeight) {
    y = smallBoard === "center-if-small" ? -Math.floor((viewportHeight - boardHeight) / 2) : 0;
  } else {
    y = Math.max(0, Math.min(boardHeight - viewportHeight, y));
  }

  return { x, y };
}

/** Evaluate a deterministic easing function over progress t in [0, 1]. */
export function evaluateEasing(easing: CameraEasing, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case "linear":
      return clamped;
    case "smoothstep":
      return clamped * clamped * (3 - 2 * clamped);
    case "easeIn":
      return clamped * clamped;
    case "easeOut":
      return clamped * (2 - clamped);
    case "easeInOut":
      return clamped < 0.5 ? 2 * clamped * clamped : 1 - 2 * (1 - clamped) * (1 - clamped);
    default:
      return clamped;
  }
}

/**
 * Shared deterministic shake primitive (E-51; docs/spec/engine/movement-and-collision.md#e-51).
 *
 * Cycles offsets `(-a,-a)`, `(a,-a)`, `(-a,a)`, `(a,a)` per tick without RNG.
 */
export function shakeOffset(amplitude: number, elapsedTick: number): CameraPoint {
  const a = Math.round(amplitude);
  if (a <= 0) return { x: 0, y: 0 };
  const phase = elapsedTick % 4;
  switch (phase) {
    case 0:
      return { x: -a, y: -a };
    case 1:
      return { x: a, y: -a };
    case 2:
      return { x: -a, y: a };
    case 3:
      return { x: a, y: a };
    default:
      return { x: 0, y: 0 };
  }
}

/** Construct a new shake state using the shared primitive (E-51). */
export function shake(amplitude: number, ticks: number): CameraShakeState {
  const amp = Math.max(0, Math.round(amplitude));
  const t = Math.max(0, Math.ceil(ticks));
  return { amplitude: amp, remainingTicks: t, elapsedTicks: 0 };
}

/**
 * Compute presentation camera position with sub-tick interpolation and shake offset (AD-33, E-51).
 * Alpha is presentation-only and never enters simulation state or state hashes.
 */
export function positionAt(camera: CameraSection, alpha: number): CameraPoint {
  const clampedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
  // A save may carry a bare camera section; an accepted save must still present, so a missing field reads as the
  // default the section is created with (docs/spec/engine/runners.md#surface-read-and-state-hash).
  const from = camera.prevX ?? camera.x ?? 0;
  const fromY = camera.prevY ?? camera.y ?? 0;
  const to = camera.x ?? 0;
  const toY = camera.y ?? 0;
  let x = Math.round(from + (to - from) * clampedAlpha);
  let y = Math.round(fromY + (toY - fromY) * clampedAlpha);
  if (camera.shake !== null && camera.shake !== undefined) {
    const offset = shakeOffset(camera.shake.amplitude, camera.shake.elapsedTicks);
    x += offset.x;
    y += offset.y;
  }
  return { x, y };
}

function smoothStep(current: number, target: number, smoothing: number): number {
  if (smoothing <= 0) return target;
  const delta = target - current;
  if (delta === 0) return target;
  const step = Math.trunc(delta / (smoothing + 1));
  if (step === 0) return current + Math.sign(delta);
  return current + step;
}

/** Re-align camera immediately without smoothing (e.g. on board entry or `send`). */
export function realignCamera(
  camera: CameraSection,
  board: WorldBoard | null,
  targetPosition: CameraPoint | null,
): CameraSection {
  const bw = board?.width ?? 0;
  const bh = board?.height ?? 0;
  const start = boardStartPoint(board);
  const tx = targetPosition?.x ?? start?.x ?? 0;
  const ty = targetPosition?.y ?? start?.y ?? 0;
  const desiredX = tx - Math.floor(camera.viewportWidth / 2);
  const desiredY = ty - Math.floor(camera.viewportHeight / 2);
  const clamped = clampCameraPosition(desiredX, desiredY, camera.viewportWidth, camera.viewportHeight, bw, bh, camera.smallBoard);
  return {
    ...camera,
    x: clamped.x,
    y: clamped.y,
    prevX: clamped.x,
    prevY: clamped.y,
    pan: null,
    shake: null,
  };
}

/** Initialize camera for a hydrated board, aligning to target or board start. */
export function initCameraForBoard(
  camera: CameraSection,
  board: WorldBoard | null,
  targetPort?: CameraTarget | null,
): CameraSection {
  const targetPos = targetPort?.getPlayerPosition() ?? boardStartPoint(board);
  return realignCamera(camera, board, targetPos);
}

function resolveTargetPosition(
  target: CameraTrackingTarget,
  targetPort: CameraTarget | null | undefined,
  currentCenter: CameraPoint,
  board: WorldBoard | null,
): { position: CameraPoint; nextTarget?: CameraTrackingTarget } {
  switch (target.kind) {
    case "player": {
      const pos = targetPort?.getPlayerPosition();
      if (pos) return { position: pos };
      const start = boardStartPoint(board);
      if (start !== null) return { position: start };
      return { position: currentCenter };
    }
    case "entity": {
      const pos = targetPort?.getEntityPosition(target.entityId);
      return { position: pos ?? currentCenter };
    }
    case "point": {
      return { position: target.point };
    }
    case "path": {
      const idx = target.index;
      if (idx >= target.waypoints.length) {
        const last = target.waypoints[target.waypoints.length - 1];
        return { position: last ?? currentCenter };
      }
      const currentWp = target.waypoints[idx]!;
      const dist = Math.abs(currentCenter.x - currentWp.x) + Math.abs(currentCenter.y - currentWp.y);
      if (dist <= 2 && idx < target.waypoints.length - 1) {
        return {
          position: target.waypoints[idx + 1]!,
          nextTarget: { kind: "path", waypoints: target.waypoints, index: idx + 1 },
        };
      }
      return { position: currentWp };
    }
  }
}

/** Advance camera simulation by one fixed tick (AD-33, E-51). */
export function updateCamera(
  camera: CameraSection,
  board: WorldBoard | null,
  targetPort?: CameraTarget | null,
): CameraSection {
  const prevX = camera.x;
  const prevY = camera.y;
  const bw = board?.width ?? 0;
  const bh = board?.height ?? 0;

  // 1. Advance shake state
  let nextShake: CameraShakeState | null = camera.shake;
  if (camera.shake !== null) {
    const elapsed = camera.shake.elapsedTicks + 1;
    const remaining = camera.shake.remainingTicks - 1;
    nextShake = remaining > 0 ? { amplitude: camera.shake.amplitude, remainingTicks: remaining, elapsedTicks: elapsed } : null;
  }

  // 2. Advance active pan if running
  if (camera.pan !== null) {
    const elapsed = camera.pan.elapsedTicks + 1;
    const duration = camera.pan.durationTicks;
    const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
    const k = evaluateEasing(camera.pan.easing, t);
    const curX = Math.round(camera.pan.startX + (camera.pan.targetX - camera.pan.startX) * k);
    const curY = Math.round(camera.pan.startY + (camera.pan.targetY - camera.pan.startY) * k);
    const clamped = clampCameraPosition(curX, curY, camera.viewportWidth, camera.viewportHeight, bw, bh, camera.smallBoard);
    const nextPan = elapsed < duration ? { ...camera.pan, elapsedTicks: elapsed } : null;
    return {
      ...camera,
      prevX,
      prevY,
      x: clamped.x,
      y: clamped.y,
      pan: nextPan,
      shake: nextShake,
    };
  }

  // 3. Target tracking
  const currentCenter = {
    x: camera.x + Math.floor(camera.viewportWidth / 2),
    y: camera.y + Math.floor(camera.viewportHeight / 2),
  };
  const resolved = resolveTargetPosition(camera.target, targetPort, currentCenter, board);
  const targetPos = resolved.position;
  const nextTarget = resolved.nextTarget ?? camera.target;

  // Apply deadzone bounding box
  const dw = camera.deadzoneWidth;
  const dh = camera.deadzoneHeight;
  let desiredCenterX = currentCenter.x;
  let desiredCenterY = currentCenter.y;

  if (targetPos.x < currentCenter.x - dw) {
    desiredCenterX = targetPos.x + dw;
  } else if (targetPos.x > currentCenter.x + dw) {
    desiredCenterX = targetPos.x - dw;
  }

  if (targetPos.y < currentCenter.y - dh) {
    desiredCenterY = targetPos.y + dh;
  } else if (targetPos.y > currentCenter.y + dh) {
    desiredCenterY = targetPos.y - dh;
  }

  const desiredX = desiredCenterX - Math.floor(camera.viewportWidth / 2);
  const desiredY = desiredCenterY - Math.floor(camera.viewportHeight / 2);

  const smoothedX = smoothStep(camera.x, desiredX, camera.smoothing);
  const smoothedY = smoothStep(camera.y, desiredY, camera.smoothing);

  const clamped = clampCameraPosition(smoothedX, smoothedY, camera.viewportWidth, camera.viewportHeight, bw, bh, camera.smallBoard);

  return {
    ...camera,
    prevX,
    prevY,
    x: clamped.x,
    y: clamped.y,
    target: nextTarget,
    shake: nextShake,
  };
}

/** Synchronous camera effect applier (AD-8, AD-10, AD-33). */
export function applyCameraEffect(state: GameState, effect: EffectRecord): void {
  const args = effect.args ?? [];
  const action = typeof args[0] === "string" ? args[0] : "";
  const camera = state.camera;

  switch (action) {
    case "panTo": {
      const targetX = typeof args[1] === "number" && Number.isFinite(args[1]) ? Math.round(args[1]) : camera.x;
      const targetY = typeof args[2] === "number" && Number.isFinite(args[2]) ? Math.round(args[2]) : camera.y;
      const durationSec = typeof args[3] === "number" && Number.isFinite(args[3]) ? Math.max(0, args[3]) : 0;
      const rawEasing = typeof args[4] === "string" ? args[4] : "linear";
      const easing: CameraEasing = (CAMERA_EASINGS as readonly string[]).includes(rawEasing)
        ? (rawEasing as CameraEasing)
        : "linear";
      const durationTicks = durationSec > 0 ? Math.max(1, Math.ceil(durationSec * 60)) : 0;
      if (durationTicks === 0) {
        const bw = state.world.board?.width ?? 0;
        const bh = state.world.board?.height ?? 0;
        const clamped = clampCameraPosition(targetX, targetY, camera.viewportWidth, camera.viewportHeight, bw, bh, camera.smallBoard);
        state.camera = {
          ...camera,
          x: clamped.x,
          y: clamped.y,
          prevX: clamped.x,
          prevY: clamped.y,
          target: { kind: "point", point: { x: targetX, y: targetY } },
          pan: null,
        };
      } else {
        const pan: CameraPanState = {
          startX: camera.x,
          startY: camera.y,
          targetX,
          targetY,
          elapsedTicks: 0,
          durationTicks,
          easing,
        };
        state.camera = {
          ...camera,
          target: { kind: "point", point: { x: targetX, y: targetY } },
          pan,
        };
      }
      break;
    }
    case "follow": {
      const entityId = typeof args[1] === "number" || typeof args[1] === "string" ? args[1] : 0;
      state.camera = {
        ...camera,
        target: { kind: "entity", entityId },
        pan: null,
      };
      break;
    }
    case "reset": {
      state.camera = {
        ...camera,
        target: { kind: "player" },
        deadzoneWidth: 0,
        deadzoneHeight: 0,
        smoothing: 0,
        pan: null,
      };
      break;
    }
    case "shake": {
      const durationSec = typeof args[1] === "number" ? args[1] : 0;
      const amplitude = typeof args[2] === "number" ? args[2] : 0;
      if (!Number.isFinite(durationSec) || !Number.isFinite(amplitude)) {
        throw new ScriptError("builtin.bad-arg", "cameraShake arguments must be finite numbers");
      }
      const dur = Math.max(0, durationSec);
      const amp = Math.max(0, amplitude);
      if (dur <= 0 || amp <= 0) {
        state.camera = { ...camera, shake: null };
      } else {
        const durationTicks = Math.max(1, Math.ceil(dur * 60));
        state.camera = { ...camera, shake: shake(amp, durationTicks) };
      }
      break;
    }
  }
}

/** Fixed-tick actor movement and collision (E-22..E-30, R-50, R-51, R-54). */
import type { GameState } from "../save/state.ts";
import type { WorldBoard, WorldPoint, WorldVector } from "../world/model.ts";
import { scriptOwnsInput } from "../script/state.ts";
import type { EnginePhaseRegistration } from "../engine/engine.ts";
import {
  FACING,
  type Facing,
  type QueueSource,
  type SpriteActiveMove,
  type SpriteActor,
  type SpriteMove,
  type SpriteMovement,
  type SpritePoint,
  type SpritesSection,
  type WaypointLink,
} from "./model.ts";
import { findPath } from "./pathfinding.ts";

const FP = 256;
const ADVANCE = 4 * FP;
const FREEZE_TICKS = 120;
const WAIT_TICKS = 120;
const SOLID = 1;
const UNDER = 2;
const STAIRS = 8;

export type MovementEvent = {
  readonly type: string;
  readonly tick: number;
  readonly actor?: string;
  readonly blocker?: string;
  readonly winner?: string;
  readonly loser?: string;
  readonly from?: number;
  readonly to?: number;
  readonly vector?: string;
  readonly blocked?: boolean;
  readonly distance?: number;
  readonly partyDistance256?: number;
  readonly direction?: Facing;
  readonly mode?: number;
  readonly goal?: SpritePoint;
  readonly route?: SpritePoint[];
  readonly via?: SpritePoint[];
  readonly expansions?: number;
  readonly capped?: boolean;
  readonly reached?: boolean;
  readonly goalAdjusted?: SpritePoint | null;
  readonly cache?: "hit" | "miss";

};
export type MovementOptions = {
  readonly gameSpeed?: number;
  readonly pixelMovement?: number;
  readonly onEvent?: (event: MovementEvent) => void;
  /** While true, pointer-queued moves still waiting in a queue do not start; a step already under way finishes. */
  readonly freezePointer?: boolean;
};

function fixed(value: number): number {
  return Math.floor(value * FP + 0.5);
}
function px(value: number): number {
  return value / FP;
}
function pointFixed(point: SpritePoint | WorldPoint): [number, number] {
  return [fixed(point.x), fixed(point.y)];
}
function positionFixed(actor: SpriteActor): [number, number] {
  return [fixed(actor.x), fixed(actor.y)];
}
function cloneMovement(movement: SpriteMovement): SpriteMovement {
  return {
    active: movement.active === null ? null : {
      ...movement.active,
      start: { ...movement.active.start },
      target: { ...movement.active.target },
    },
    waitTicks: movement.waitTicks,
    pendingExit: movement.pendingExit,
    under: [...movement.under],
    lastStepTick: movement.lastStepTick,
    lastStepDistance: movement.lastStepDistance,
  };
}
function event(
  tick: number,
  type: string,
  values: Omit<MovementEvent, "tick" | "type"> = {},
  sink?: (event: MovementEvent) => void,
): void {
  sink?.({ type, tick, ...values });
}
function allActors(section: SpritesSection): SpriteActor[] {
  return [...section.players, ...section.items];
}
function drawId(section: SpritesSection, actor: SpriteActor): number {
  return actor.kind === "player" ? actor.index : section.players.length + actor.index;
}
function replaceActor(section: SpritesSection, actor: SpriteActor): void {
  if (actor.kind === "player") section.players = section.players.map((value) => value.id === actor.id ? actor : value);
  else section.items = section.items.map((value) => value.id === actor.id ? actor : value);
}
function updateActor(section: SpritesSection, id: string, update: (actor: SpriteActor) => SpriteActor): SpriteActor | null {
  const actor = allActors(section).find((value) => value.id === id);
  if (actor === undefined) return null;
  const next = update(actor);
  replaceActor(section, next);
  return next;
}
function vectorPoints(vector: WorldVector): [number, number][] {
  return vector.points.map(pointFixed);
}
function translateBase(actor: SpriteActor, x: number, y: number): [number, number][] {
  return actor.collisionBase.points.map((point) => [x + fixed(point.x), y + fixed(point.y)]);
}
function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}
function pointInPolygon(x: number, y: number, polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; index += 1) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (current === undefined || prior === undefined) continue;
    const intersects = (current[1] > y) !== (prior[1] > y) && x < (prior[0] - current[0]) * (y - current[1]) / (prior[1] - current[1]) + current[0];
    if (intersects) inside = !inside;
    previous = index;
  }
  return inside;
}
function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const ab = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const ab2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const cd = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const cd2 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  return ((ab > 0 && ab2 < 0) || (ab < 0 && ab2 > 0) || ab === 0 && onSegment(a, b, c) || ab2 === 0 && onSegment(a, b, d))
    && ((cd > 0 && cd2 < 0) || (cd < 0 && cd2 > 0) || cd === 0 && onSegment(c, d, a) || cd2 === 0 && onSegment(c, d, b));
}
function onSegment(a: [number, number], b: [number, number], p: [number, number]): boolean {
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
function projection(points: readonly [number, number][], ax: number, ay: number): [number, number] {
  const first = points[0];
  if (first === undefined) return [0, 0];
  let min = first[0] * ax + first[1] * ay;
  let max = min;
  for (const point of points) {
    const value = point[0] * ax + point[1] * ay;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}
function polygonsOverlap(left: readonly [number, number][], right: readonly [number, number][]): boolean {
  if (left.length < 3 || right.length < 3) return false;
  const shapes = [left, right];
  for (const shape of shapes) {
    for (let index = 0; index < shape.length; index += 1) {
      const a = shape[index];
      const b = shape[(index + 1) % shape.length];
      if (a === undefined || b === undefined) continue;
      const ax = -(b[1] - a[1]);
      const ay = b[0] - a[0];
      const one = projection(left, ax, ay);
      const two = projection(right, ax, ay);
      if (one[1] <= two[0] || two[1] <= one[0]) return false;
    }
  }
  return true;
}
function shapeHitsVector(shape: readonly [number, number][], vector: WorldVector): boolean {
  const points = vectorPoints(vector);
  if (points.length < 2) return false;
  if (vector.closed !== 0) return polygonsOverlap(shape, points);
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a !== undefined && b !== undefined) {
      for (let edge = 0; edge < shape.length; edge += 1) {
        const c = shape[edge];
        const d = shape[(edge + 1) % shape.length];
        if (c !== undefined && d !== undefined && segmentsIntersect(a, b, c, d)) return true;
      }
      if (pointInPolygon(a[0], a[1], shape) || pointInPolygon(b[0], b[1], shape)) return true;
    }
  }
  return false;
}
function hitEdge(shape: readonly [number, number][], vector: WorldVector): [number, number] | null {
  const points = vectorPoints(vector);
  const segments = vector.closed !== 0 ? points.length : points.length - 1;
  for (let index = 0; index < segments; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    for (let edge = 0; edge < shape.length; edge += 1) {
      const c = shape[edge];
      const d = shape[(edge + 1) % shape.length];
      if (c !== undefined && d !== undefined && segmentsIntersect(a, b, c, d)) return [b[0] - a[0], b[1] - a[1]];
    }
  }
  const shapeX = shape.map((point) => point[0]);
  const shapeY = shape.map((point) => point[1]);
  const minX = Math.min(...shapeX);
  const maxX = Math.max(...shapeX);
  const minY = Math.min(...shapeY);
  const maxY = Math.max(...shapeY);
  for (let index = 0; index < segments; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    if (Math.max(a[0], b[0]) >= minX && Math.min(a[0], b[0]) <= maxX && Math.max(a[1], b[1]) >= minY && Math.min(a[1], b[1]) <= maxY) return [b[0] - a[0], b[1] - a[1]];
  }
  return null;
}
function isGlancing(mx: number, my: number, ex: number, ey: number, iso: boolean): boolean {
  const crossAbs = Math.abs(cross(mx, my, ex, ey));
  const dotAbs = Math.abs(mx * ex + my * ey);
  return iso ? crossAbs * 100000 <= dotAbs * 196261 : crossAbs <= dotAbs;
}
function facingIndex(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return -1;
  if (ay * 1000 <= ax * 414) return dx > 0 ? 2 : 6;
  if (ax * 1000 <= ay * 414) return dy > 0 ? 4 : 0;
  if (dx > 0) return dy > 0 ? 3 : 1;
  return dy > 0 ? 5 : 7;
}
function ticksPerAdvance(speed: number, gameSpeed: number): number {
  const speedMs = Math.floor(speed * 1000 + 0.5);
  const clamped = Math.max(-4, Math.min(4, Math.trunc(gameSpeed)));
  const intervalNumerator = Math.max(1000, (speedMs - 100 * clamped) * 60);
  return Math.max(1, Math.floor((intervalNumerator + 500) / 1000));
}
function directionVector(facing: Facing): [number, number] {
  const index = FACING.indexOf(facing);
  const vectors: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  return vectors[index] ?? [0, 0];
}
function advancePoint(actor: SpriteActor, active: SpriteActiveMove): { x: number; y: number; reached: boolean } {
  const [x, y] = positionFixed(actor);
  const target = pointFixed(active.target);
  const dx = target[0] - x;
  const dy = target[1] - y;
  const distance = Math.floor(Math.sqrt(dx * dx + dy * dy));
  if (distance <= ADVANCE) return { x: target[0], y: target[1], reached: true };
  return { x: x + Math.trunc(dx * ADVANCE / distance), y: y + Math.trunc(dy * ADVANCE / distance), reached: false };
}
function boardHit(actor: SpriteActor, board: WorldBoard, x: number, y: number): WorldVector | null {
  const shape = translateBase(actor, x, y);
  return (board.vectors ?? []).find((vector) => vector.layer === actor.layer && vector.type === SOLID && shapeHitsVector(shape, vector)) ?? null;
}

/** Test an actor collision base at a pixel position against destination-board solids. */
export function boardCollisionAt(actor: SpriteActor, board: WorldBoard, x: number, y: number): WorldVector | null {
  return boardHit(actor, board, fixed(x), fixed(y));
}

function spriteHit(section: SpritesSection, actor: SpriteActor, x: number, y: number): SpriteActor | null {
  const shape = translateBase(actor, x, y);
  return allActors(section)
    .filter((other) => other.id !== actor.id && other.visible && other.layer === actor.layer)
    .sort((left, right) => drawId(section, left) - drawId(section, right))
    .find((other) => polygonsOverlap(shape, translateBase(other, fixed(other.x), fixed(other.y)))) ?? null;
}
function offBoard(actor: SpriteActor, board: WorldBoard, x: number, y: number): Facing | null {
  const points = actor.collisionBase.points;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  if (px(x) + left < 0) return "W";
  if (px(x) + right > board.width) return "E";
  if (px(y) + top < 0) return "N";
  if (px(y) + bottom > board.height) return "S";
  return null;
}
function free(section: SpritesSection, actor: SpriteActor, board: WorldBoard, x: number, y: number): boolean {
  return boardHit(actor, board, x, y) === null && spriteHit(section, actor, x, y) === null && offBoard(actor, board, x, y) === null;
}
function finishActor(actor: SpriteActor, active: SpriteActiveMove, blocked: boolean, tpa: number, tick: number, sink?: (event: MovementEvent) => void): SpriteActor {
  const waypoint = actor.queue.waypoint;
  const waypointDone = waypoint !== null && waypoint.cycles !== 0 && waypoint.cursor >= waypoint.points.length && waypoint.cycle + 1 >= waypoint.cycles;
  const nextWaypoint = waypointDone ? null : waypoint;
  const queue = actor.queue.moves.length > 0 || nextWaypoint !== null;
  const dx = actor.x - active.start.x;
  const dy = actor.y - active.start.y;
  const distance = blocked ? 0 : Math.sqrt(dx * dx + dy * dy);
  // Distance travelled in 1/256 board pixels (docs/spec/engine/movement-and-collision.md#reawakened-party-steps):
  // integer deltas, Euclidean length, rounded half-up. Both pixel positions are whole 1/256 units, so
  // `fixed` is exact and the sum below is an exact integer.
  const dx256 = fixed(dx);
  const dy256 = fixed(dy);
  const partyDistance256 = blocked ? 0 : Math.floor(Math.sqrt(dx256 * dx256 + dy256 * dy256) + 0.5);
  const movement = { ...cloneMovement(actor.movement), active: null, waitTicks: 0, lastStepTick: tick, lastStepDistance: distance };
  if (!blocked) event(tick, "step-complete", { actor: actor.id, distance, partyDistance256 }, sink);
  const state = queue ? "moving" : "waiting";
  if (!queue) event(tick, "movement-complete", { actor: actor.id, blocked }, sink);
  return { ...actor, state, movement, queue: { ...actor.queue, waypoint: nextWaypoint }, ...(queue ? {} : { frozenUntil: null }), prev: { x: actor.x, y: actor.y } };
}
function collisionLoser(section: SpritesSection, actor: SpriteActor, blocker: SpriteActor, gameSpeed: number): SpriteActor {
  const actorMoving = actor.state === "moving";
  const blockerMoving = blocker.state === "moving";
  if (actorMoving !== blockerMoving) return actorMoving ? blocker : actor;
  if (actor.controlled !== blocker.controlled) return actor.controlled ? blocker : actor;
  const actorTicks = ticksPerAdvance(actor.speed, gameSpeed);
  const blockerTicks = ticksPerAdvance(blocker.speed, gameSpeed);
  if (actorTicks !== blockerTicks) return actorTicks < blockerTicks ? blocker : actor;
  return drawId(section, actor) > drawId(section, blocker) ? actor : blocker;
}
function resolveCollision(section: SpritesSection, actor: SpriteActor, blocker: SpriteActor, tick: number, gameSpeed: number, sink?: (event: MovementEvent) => void): void {
  const loser = collisionLoser(section, actor, blocker, gameSpeed);
  const winner = loser.id === actor.id ? blocker : actor;
  if (loser.state === "frozen") return;
  replaceActor(section, { ...loser, state: "frozen", frozenUntil: tick + FREEZE_TICKS, movement: { ...cloneMovement(loser.movement), active: loser.movement.active, waitTicks: 0 } });
  event(tick, "sprite-collision", { actor: actor.id, winner: winner.id, loser: loser.id, blocker: blocker.id }, sink);
}
function applyPosition(actor: SpriteActor, x: number, y: number, facing: Facing | null, board: WorldBoard, tick: number, sink?: (event: MovementEvent) => void): SpriteActor {
  const nextX = px(x);
  const nextY = px(y);
  let nextLayer = actor.layer;
  const shape = translateBase(actor, x, y);
  for (const vector of board.vectors ?? []) {
    if (vector.layer === actor.layer && vector.type === STAIRS && shapeHitsVector(shape, vector)) {
      nextLayer = vector.attributes;
      if (nextLayer !== actor.layer) event(tick, "layer-change", { actor: actor.id, from: actor.layer, to: nextLayer, vector: vector.handle }, sink);
      break;
    }
  }
  const under = (board.vectors ?? []).filter((vector) => vector.layer === nextLayer && vector.type === UNDER && shapeHitsVector(shape, vector)).map((vector) => vector.handle);
  for (const id of under) if (!actor.movement.under.includes(id)) event(tick, "under-enter", { actor: actor.id, vector: id }, sink);
  for (const id of actor.movement.under) if (!under.includes(id)) event(tick, "under-leave", { actor: actor.id, vector: id }, sink);
  return { ...actor, x: nextX, y: nextY, layer: nextLayer, facing: facing ?? actor.facing, prev: { x: actor.x, y: actor.y }, movement: { ...cloneMovement(actor.movement), under } };
}
function waypointMove(actor: SpriteActor): { readonly move: SpriteMove; readonly waypoint: WaypointLink } | null {
  const waypoint = actor.queue.waypoint;
  if (waypoint === null || waypoint.points.length === 0) return null;
  let cycle = waypoint.cycle;
  let cursor = waypoint.cursor;
  if (cursor >= waypoint.points.length) {
    cycle += 1;
    cursor = 0;
  }
  if (waypoint.cycles !== 0 && cycle >= waypoint.cycles) return null;
  const point = waypoint.points[cursor];
  if (point === undefined) return null;
  const nextWaypoint = { ...waypoint, cycle, cursor: cursor + 1 };
  return {
    move: { source: waypoint.live ? "waypoint-link" : "waypoint-path", target: { ...point }, facing: null },
    waypoint: nextWaypoint,
  };
}
function advanceActor(section: SpritesSection, actor: SpriteActor, board: WorldBoard, tick: number, gameSpeed: number, pixelMovement: number, freezePointer: boolean, sink?: (event: MovementEvent) => void): void {
  if (!actor.visible) return;
  if (actor.state === "frozen") {
    if (actor.frozenUntil !== null && tick >= actor.frozenUntil) {
      replaceActor(section, { ...actor, state: "waiting", frozenUntil: null, movement: { ...cloneMovement(actor.movement), active: null, waitTicks: 0 } });
      event(tick, "thaw", { actor: actor.id }, sink);
    }
    return;
  }
  let movement = cloneMovement(actor.movement);
  if (movement.active === null) {
    let next = actor.queue.moves[0];
    if (freezePointer && next?.pointer === true) {
      // A script owns the key queue: the click's route waits, untouched, and resumes with the block's end.
      if (actor.state === "moving") replaceActor(section, { ...actor, state: "waiting" });
      return;
    }
    let queue = actor.queue;
    if (next === undefined && actor.queue.waypoint !== null) {
      const waypoint = waypointMove(actor);
      if (waypoint !== null) {
        next = waypoint.move;
        queue = { ...actor.queue, waypoint: waypoint.waypoint };
      } else {
        queue = { ...actor.queue, waypoint: null };
      }
    }
    if (next === undefined) {
      if (actor.state === "moving") replaceActor(section, { ...actor, state: "waiting", queue, movement });
      else if (queue !== actor.queue) replaceActor(section, { ...actor, queue });
      return;
    }
    const move = next;
    const dx = move.target.x - actor.x;
    const dy = move.target.y - actor.y;
    const active: SpriteActiveMove = { source: move.source, start: { x: actor.x, y: actor.y }, target: { ...move.target }, facing: move.facing, cadence: actor.prev !== null ? Math.max(0, ticksPerAdvance(actor.speed, gameSpeed) - 1) : 0, ignoreBoard: move.source === "points", tried: false, ...(move.pathMode === undefined ? {} : { pathMode: move.pathMode }), ...(move.deferredComplete === true ? { deferredComplete: true } : {}), ...(move.pointer === true ? { pointer: true as const } : {}) };
    movement = { ...movement, active };
    const moves = actor.queue.moves.length > 0 ? actor.queue.moves.slice(1) : actor.queue.moves;
    const nextActor: SpriteActor = { ...actor, state: "moving", queue: { ...queue, moves }, movement };
    replaceActor(section, nextActor);
    actor = nextActor;
    if (dx === 0 && dy === 0) {
      replaceActor(section, finishActor(actor, active, false, ticksPerAdvance(actor.speed, gameSpeed), tick, sink));
      return;
    }
  }
  actor = allActors(section).find((value) => value.id === actor.id) ?? actor;
  movement = cloneMovement(actor.movement);
  const active = movement.active;
  if (active === null) return;
  const tpa = ticksPerAdvance(actor.speed, gameSpeed);
  if (active.cadence > 0) {
    replaceActor(section, { ...actor, movement: { ...movement, active: { ...active, cadence: active.cadence - 1 } } });
    return;
  }
  const next = advancePoint(actor, active);
  const direction = active.facing ?? FACING[facingIndex(next.x - fixed(actor.x), next.y - fixed(actor.y))] ?? actor.facing;
  if (actor.kind === "player") {
    const exit = offBoard(actor, board, next.x, next.y);
    if (exit !== null) {
      const exited = finishActor({ ...actor, facing: exit, movement: { ...movement, active: null, pendingExit: exit } }, active, true, tpa, tick, sink);
      replaceActor(section, exited);
      event(tick, "edge-exit", { actor: actor.id, direction: exit }, sink);
      return;
    }
  }
  const hit = active.ignoreBoard ? null : boardHit(actor, board, next.x, next.y);
  if (hit !== null) {
    const edge = hitEdge(translateBase(actor, next.x, next.y), hit);
    const movementVector: [number, number] = [next.x - fixed(actor.x), next.y - fixed(actor.y)];
    const iso = (board.coordType & 3) !== 0;
    if (pixelMovement >= 1 && edge !== null && isGlancing(movementVector[0], movementVector[1], edge[0], edge[1], iso)) {
      const facing = FACING.indexOf(direction);
      const candidates = [(facing + 7) % 8, (facing + 1) % 8].sort((left, right) => left - right);
      for (const candidate of candidates) {
        const vector = directionVector(FACING[candidate] ?? actor.facing);
        const amount = vector[0] === 0 || vector[1] === 0 ? ADVANCE : 724;
        const sx = fixed(actor.x) + vector[0] * amount;
        const sy = fixed(actor.y) + vector[1] * amount;
        if (free(section, actor, board, sx, sy)) {
          let moved = applyPosition(actor, sx, sy, FACING[candidate] ?? actor.facing, board, tick, sink);
          const vx = fixed(active.target.x) - fixed(active.start.x);
          const vy = fixed(active.target.y) - fixed(active.start.y);
          const passed = (fixed(active.target.x) - sx) * vx + (fixed(active.target.y) - sy) * vy <= 0;
          const remainingDx = fixed(active.target.x) - sx;
          const remainingDy = fixed(active.target.y) - sy;
          const done = passed || Math.sqrt(remainingDx * remainingDx + remainingDy * remainingDy) <= ADVANCE;
          if (done) {
            moved = finishActor(moved, active, false, tpa, tick, sink);
          } else {
            moved = { ...moved, movement: { ...cloneMovement(moved.movement), active: { ...active, cadence: tpa - 1 } }, state: "moving" };
          }
          replaceActor(section, moved);
          return;
        }
      }
    }
    const completes = actor.queue.moves.length === 0 && actor.queue.waypoint === null;
    replaceActor(section, finishActor({ ...actor, facing: direction }, active, true, tpa, tick));
    event(tick, "blocked", { actor: actor.id, vector: hit.handle, blocked: true }, sink);
    if (completes) event(tick, "movement-complete", { actor: actor.id, blocked: true }, sink);
    return;
  }
  const blocker = spriteHit(section, actor, next.x, next.y);
  if (blocker !== null) {
    const following = active.source === "points" || active.source === "path" || active.source === "waypoint-path" || active.source === "waypoint-link";
    if (following && movement.waitTicks === 0 && !active.tried) {
      const diversion = findPath(board, section, actor, active.target, active.pathMode ?? 1);
      if (diversion.reached && diversion.points.length > 0) {
        const moves: SpriteMove[] = diversion.points.map((point) => ({ source: "path", target: { ...point }, facing: null, pathMode: active.pathMode ?? 1, deferredComplete: true, ...(active.pointer === true ? { pointer: true as const } : {}) }));
        replaceActor(section, {
          ...actor,
          state: "moving",
          queue: { ...actor.queue, moves: [...moves, ...actor.queue.moves] },
          movement: { ...movement, active: null, waitTicks: 0 },
        });
        event(tick, "diversion", { actor: actor.id, blocker: blocker.id, via: diversion.points }, sink);
        return;
      }
      replaceActor(section, { ...actor, movement: { ...movement, active: { ...active, tried: true }, waitTicks: WAIT_TICKS } });
      event(tick, "waiting-for-blocker", { actor: actor.id, blocker: blocker.id }, sink);
      return;
    }
    if (following && movement.waitTicks > 0) {
      if (movement.waitTicks > 1) {
        replaceActor(section, { ...actor, movement: { ...movement, waitTicks: movement.waitTicks - 1 } });
        return;
      }
      replaceActor(section, { ...actor, queue: { ...actor.queue, moves: [] }, movement: { ...movement, active: null, waitTicks: 0 }, state: "frozen", frozenUntil: tick + FREEZE_TICKS });
      event(tick, "path-stopped", { actor: actor.id, blocker: blocker.id }, sink);
      return;
    }
    resolveCollision(section, actor, blocker, tick, gameSpeed, sink);
    return;
  }
  let moved = applyPosition(actor, next.x, next.y, direction, board, tick, sink);
  const vx = fixed(active.target.x) - fixed(active.start.x);
  const vy = fixed(active.target.y) - fixed(active.start.y);
  const passed = (fixed(active.target.x) - next.x) * vx + (fixed(active.target.y) - next.y) * vy <= 0;
  const done = next.reached || passed;
  if (done) {
    if (active.deferredComplete === true && moved.queue.moves.length === 0 && moved.queue.waypoint === null) {
      moved = { ...moved, state: "moving", movement: { ...cloneMovement(moved.movement), active: { ...active, cadence: 0, deferredComplete: false } } };
    } else {
      moved = finishActor(moved, active, false, tpa, tick, sink);
    }
  } else {
    moved = { ...moved, state: "moving", movement: { ...cloneMovement(moved.movement), active: { ...active, cadence: tpa - 1 } } };
  }
  replaceActor(section, moved);
}

/** Convert a direction command to one deterministic target and enqueue it. */
export function enqueueDirectionMove(section: SpritesSection, id: string, facing: Facing, pixelMovement = 0, pixelStep = 8, clear = false): boolean {
  const actor = allActors(section).find((value) => value.id === id);
  if (actor === undefined) return false;
  const vector = directionVector(facing);
  const distance = pixelMovement === 0 ? 32 : pixelMovement === 2 ? 1 : pixelStep;
  return updateActor(section, id, (value) => {
    const previous = value.queue.moves[value.queue.moves.length - 1];
    const origin = !clear && previous !== undefined ? previous.target : { x: value.x, y: value.y };
    return {
      ...value,
      state: value.visible ? "moving" : value.state,
      prev: clear ? null : value.prev,
      movement: clear ? { ...cloneMovement(value.movement), active: null, waitTicks: 0 } : value.movement,
      queue: {
        ...value.queue,
        moves: [...(clear ? [] : value.queue.moves), { source: "direction", target: { x: origin.x + vector[0] * distance, y: origin.y + vector[1] * distance }, facing }],
      },
    };
  }) !== null;
}

/** Advance all actors in stable draw order for one movement phase. */
export function runMovementPhase(section: SpritesSection, board: WorldBoard | null, tick: number, options: MovementOptions = {}): MovementEvent[] {
  if (board === null) return [];
  normaliseMovementState(section);
  const events: MovementEvent[] = [];
  const sink = (record: MovementEvent): void => { events.push(record); options.onEvent?.(record); };
  const pixelMovement = options.pixelMovement ?? 0;
  const gameSpeed = options.gameSpeed ?? 0;
  const actors = allActors(section).sort((left, right) => drawId(section, left) - drawId(section, right));
  for (const original of actors) {
    const actor = allActors(section).find((value) => value.id === original.id);
    if (actor !== undefined) advanceActor(section, actor, board, tick, gameSpeed, pixelMovement, options.freezePointer === true, sink);
  }
  return events;
}

/** AD-26 registration for the movement owner; the engine itself supplies the phase order. */
export function movementPhaseRegistration(options: MovementOptions & { readonly rank?: number } = {}): EnginePhaseRegistration {
  return {
    phase: "movement",
    rank: options.rank ?? 0,
    run(state: GameState): void {
      runMovementPhase(state.sprites, state.world.board ?? null, state.time.tick, {
        ...options,
        freezePointer: scriptOwnsInput(state.vm),
        onEvent: (ev) => {
          options.onEvent?.(ev);
          if (ev.type === "step-complete" && ev.actor === state.sprites.selectedPlayer &&
            ev.partyDistance256 !== undefined && ev.partyDistance256 > 0) {
            const total = state.party.stepRemainder + ev.partyDistance256;
            state.party.steps += Math.floor(total / (32 * FP));
            state.party.stepRemainder = total % (32 * FP);
          }
        },
      });
    },
  };
}

/** Alias retained as the concise public registration name used by runners. */
export const spriteMovementRegistration = movementPhaseRegistration;

/** R-50's deterministic cadence conversion, exposed for fixture and runner tests. */
export { ticksPerAdvance };

/** Build a direction move without mutating a section, useful for input owners. */
export function directionMove(actor: SpriteActor, facing: Facing, pixelMovement = 0, pixelStep = 8): SpriteMove {
  const vector = directionVector(facing);
  const distance = pixelMovement === 0 ? 32 : pixelMovement === 2 ? 1 : pixelStep;
  return { source: "direction", target: { x: actor.x + vector[0] * distance, y: actor.y + vector[1] * distance }, facing };
}

/** Return the distance cadence used by the active actor. */
export function movementCadence(actor: SpriteActor, gameSpeed = 0): number {
  return ticksPerAdvance(actor.speed, gameSpeed);
}

/** Type guard for consumers reading old snapshots before movement state existed. */
export function ensureMovementState(actor: SpriteActor): SpriteMovement {
  return {
    active: actor.movement?.active ?? null,
    waitTicks: actor.movement?.waitTicks ?? 0,
    pendingExit: actor.movement?.pendingExit ?? null,
    under: actor.movement?.under ?? [],
    lastStepTick: actor.movement?.lastStepTick ?? null,
    lastStepDistance: actor.movement?.lastStepDistance ?? 0,
  };
}

/** Keep the movement state JSON-safe when a caller restores a pre-5.4 actor. */
export function normaliseMovementState(section: SpritesSection): void {
  section.players = section.players.map((actor) => ({ ...actor, movement: ensureMovementState(actor) }));
  section.items = section.items.map((actor) => ({ ...actor, movement: ensureMovementState(actor) }));
}

/** Keep queue source names explicit at boundary call sites. */
export function isMovementSource(source: string): source is QueueSource {
  return source === "keyboard" || source === "direction" || source === "points" || source === "path" || source === "waypoint-path" || source === "waypoint-link";
}

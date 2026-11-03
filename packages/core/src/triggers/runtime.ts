/** Deterministic trigger dispatch (E-40..E-45, R-52, AD-25/AD-26). */
import type { EnginePhaseRegistration, EngineResetRegistration } from "../engine/engine.ts";
import type { EffectRecord } from "../script/effects.ts";
import { IR_VERSION, type ProgramRef } from "../script/program.ts";
import { findThread, hasLiveBlockingThread, startThread } from "../script/state.ts";
import { ScriptError } from "../script/errors.ts";
import { engineEffect } from "../engine/boot.ts";
import type { GameState } from "../save/state.ts";
import { resetUiForProgramStart } from "../save/sections/ui.ts";
import type { Facing, SpriteActor } from "../sprites/model.ts";
import type { WorldItem, WorldProgram, WorldPoint } from "../world/model.ts";
import { coordLayout, tileToPixel } from "../world/coords.ts";
import { createTriggersSection, resetTriggersSection, type TriggerActive, type TriggersSection } from "./model.ts";

const FP = 256;
const FACING_VECTOR: Record<Facing, readonly [number, number]> = {
  N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
};

type Candidate = {
  key: string;
  source: "item" | "region";
  index: number;
  program: string;
  initialVar: string;
  initialValue: string;
  finalVar: string;
  finalValue: string;
  activate: number;
  activationType: number;
  repeatDistance: number;
  layer: number;
  points: readonly WorldPoint[];
  closed: number;
  actor?: SpriteActor;
};

export type TriggerProgramResolver = (program: string) => ProgramRef | null;
export type TriggerEvent = {
  readonly type: "trigger-start" | "trigger-complete" | "trigger-skip" | "trigger-gone";
  readonly tick: number;
  readonly key: string;
  readonly source?: "item" | "region";
};
export type TriggerPhaseOptions = {
  readonly rank?: number;
  readonly programRef?: TriggerProgramResolver | null;
  readonly onEvent?: (event: TriggerEvent) => void;
  /** A located report for a trigger whose program cannot start; without it, a missing program is thrown. */
  readonly onDiagnostic?: (diagnostic: { readonly code: string; readonly file: string; readonly line: number; readonly message: string }) => void;
};

function fixed(value: number): number {
  return Math.floor(value * FP + 0.5);
}
function pointFixed(point: { readonly x: number; readonly y: number }): [number, number] {
  return [fixed(point.x), fixed(point.y)];
}
function translate(points: readonly WorldPoint[], x: number, y: number): [number, number][] {
  const fx = fixed(x);
  const fy = fixed(y);
  return points.map((point) => {
    const [px, py] = pointFixed(point);
    return [px + fx, py + fy];
  });
}
function polygon(points: readonly WorldPoint[]): [number, number][] {
  return points.map(pointFixed);
}
function cross(a: [number, number], b: [number, number], p: [number, number]): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}
function onSegment(a: [number, number], b: [number, number], p: [number, number]): boolean {
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const ab1 = cross(a, b, c);
  const ab2 = cross(a, b, d);
  const cd1 = cross(c, d, a);
  const cd2 = cross(c, d, b);
  if (ab1 === 0 && onSegment(a, b, c)) return true;
  if (ab2 === 0 && onSegment(a, b, d)) return true;
  if (cd1 === 0 && onSegment(c, d, a)) return true;
  if (cd2 === 0 && onSegment(c, d, b)) return true;
  return (ab1 < 0) !== (ab2 < 0) && (cd1 < 0) !== (cd2 < 0);
}
function inside(point: [number, number], shape: readonly [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const a = shape[i]!;
    const b = shape[j]!;
    if (cross(a, b, point) === 0 && onSegment(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function overlaps(left: readonly [number, number][], right: readonly [number, number][], closed = true): boolean {
  if (left.length < 2 || right.length < 2) return false;
  const leftEdges = left.length > 2 && closed;
  const rightEdges = right.length > 2 && closed;
  for (let i = 1; i < left.length; i += 1) {
    const a = left[i - 1]!;
    const b = left[i]!;
    for (let j = 1; j < right.length; j += 1) if (segmentsIntersect(a, b, right[j - 1]!, right[j]!)) return true;
    if (rightEdges && segmentsIntersect(a, b, right[right.length - 1]!, right[0]!)) return true;
  }
  if (leftEdges) {
    const a = left[left.length - 1]!;
    const b = left[0]!;
    for (let j = 1; j < right.length; j += 1) if (segmentsIntersect(a, b, right[j - 1]!, right[j]!)) return true;
    if (rightEdges && segmentsIntersect(a, b, right[right.length - 1]!, right[0]!)) return true;
  }
  return (leftEdges && inside(left[0]!, right)) || (rightEdges && inside(right[0]!, left));
}
function valueMatches(value: unknown, expected: string): boolean {
  return String(value ?? "") === expected;
}
function conditionMatches(state: GameState, candidate: Candidate): boolean {
  if (candidate.activate === 0 || candidate.initialVar === "") return true;
  return valueMatches(state.vm.globals[candidate.initialVar], candidate.initialValue);
}
function regionCandidate(program: WorldProgram, index: number): Candidate {
  return {
    key: `region:${index}`,
    source: "region",
    index,
    program: program.program,
    initialVar: program.initialVar,
    initialValue: program.initialValue,
    finalVar: program.finalVar,
    finalValue: program.finalValue,
    activate: program.activate,
    activationType: program.activationType,
    repeatDistance: program.repeatDistance,
    layer: program.layer,
    points: program.points,
    closed: program.closed,
  };
}
function itemCandidate(item: WorldItem, actor: SpriteActor, index: number): Candidate {
  return {
    key: `item:${index}`,
    source: "item",
    index,
    program: item.activationPrg,
    initialVar: item.initialVar,
    initialValue: item.initialValue,
    finalVar: item.finalVar,
    finalValue: item.finalValue,
    activate: item.activate,
    activationType: item.activationType,
    repeatDistance: 0,
    layer: item.layer,
    points: actor.activationBase.points as WorldPoint[],
    closed: 1,
    actor,
  };
}
function selectedPlayer(state: GameState): SpriteActor | null {
  const id = state.sprites.selectedPlayer;
  return state.sprites.players.find((actor) => actor.id === id) ?? state.sprites.players.find((actor) => actor.controlled) ?? state.sprites.players[0] ?? null;
}
function triggerTypeMatches(candidate: Candidate, kind: "step" | "key"): boolean {
  const type = candidate.activationType & 3;
  return kind === "key" ? type === 1 : type === 0 || type === 2;
}
function playerShape(player: SpriteActor): [number, number][] {
  return translate(player.collisionBase.points as WorldPoint[], player.x, player.y);
}
function itemShape(candidate: Candidate): [number, number][] {
  return translate(candidate.points, candidate.actor?.x ?? 0, candidate.actor?.y ?? 0);
}
function distanceSquared(a: SpriteActor, b: SpriteActor): number {
  const dx = fixed(a.x) - fixed(b.x);
  const dy = fixed(a.y) - fixed(b.y);
  return dx * dx + dy * dy;
}
function frontness(player: SpriteActor, item: SpriteActor): number {
  const vector = FACING_VECTOR[player.facing];
  const dx = fixed(item.x) - fixed(player.x);
  const dy = fixed(item.y) - fixed(player.y);
  return (vector?.[0] ?? 0) * dx + (vector?.[1] ?? 0) * dy;
}
function facingToward(from: SpriteActor, to: SpriteActor): Facing {
  const dx = fixed(to.x) - fixed(from.x);
  const dy = fixed(to.y) - fixed(from.y);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return from.facing;
  if (ax * 2 < ay) return dy < 0 ? "N" : "S";
  if (ay * 2 < ax) return dx < 0 ? "W" : "E";
  if (dx < 0 && dy < 0) return "NW";
  if (dx < 0) return "SW";
  if (dy < 0) return "NE";
  return "SE";
}
function stepDistance(player: SpriteActor): number {
  const movement = player.movement as typeof player.movement & { readonly lastStepDistance?: number };
  return movement.lastStepDistance ?? 0;
}
function stepTick(player: SpriteActor): number {
  const movement = player.movement as typeof player.movement & { readonly lastStepTick?: number };
  return movement.lastStepTick ?? -1;
}
function isActivationKey(name: string, action: string | undefined, unbound: boolean): boolean {
  // A pressed button slot queues the confirm name with the slot's own action (`input.ts`); the
  // name alone carries the activation decision there (E-41; docs/spec/engine/movement-and-collision.md).
  if (name === "confirm") return true;
  if (action !== undefined) return action === "confirm" || action === "ENTER" || action === " ";
  return unbound && (name === "ENTER" || name === "Enter" || name === " " || name === "Space");
}
function clearQueue(state: GameState, player: SpriteActor): void {
  state.sprites.players = state.sprites.players.map((actor) => actor.id === player.id ? { ...actor, queue: { moves: [], waypoint: null } } : actor);
}
function currentThreadFinished(state: GameState, active: TriggerActive): boolean {
  const thread = findThread(state.vm, active.thread);
  return thread === undefined || thread.status === "finished";
}
function programRef(name: string, resolver: TriggerProgramResolver | null | undefined): ProgramRef | null {
  if (name === "") return null;
  if (resolver !== undefined && resolver !== null) {
    const resolved = resolver(name);
    if (resolved !== null) return resolved;
  }
  if (name.toLowerCase().endsWith(".prg")) {
    throw new ScriptError("program.missing", `no program "${name}" is in the asset index`);
  }
  return { kind: "inline", text: name, ir: IR_VERSION, dialect: "tk3" };
}

/**
 * A program the trigger cannot start is one located `program.missing` (docs/spec/engine/rpgcode-functions.md:136,
 * "a blank or missing file"): with a sink the report goes out, the tick continues and the returned `null`
 * marks the trigger run so the report does not repeat every step; any other thrown value — a resolver
 * defect — keeps throwing (`startFileProgram`'s rule, docs/spec/engine/main-loop-and-startup.md). A call
 * with no sink keeps raising the ScriptError for the host.
 */
function resolveTriggerProgramRef(
  name: string,
  options: TriggerPhaseOptions,
  boardKey: string,
): ProgramRef | null {
  try {
    return programRef(name, options.programRef);
  } catch (error) {
    if (!(error instanceof ScriptError)) throw error;
    if (options.onDiagnostic === undefined) throw error;
    options.onDiagnostic({
      code: error.code,
      file: error.pos?.file ?? boardKey,
      line: error.pos?.line ?? 0,
      message: error.message,
    });
    return null;
  }
}
function emit(events: TriggerEvent[], options: TriggerPhaseOptions, value: TriggerEvent): void {
  events.push(value);
  options.onEvent?.(value);
}

/** Apply the `triggers` effects emitted by the script pack and board entry. */
export function applyTriggerEffect(state: GameState, effect: EffectRecord): void {
  if (effect.name === "gone") {
    const key = state.triggers.active?.key;
    if (key !== undefined && !state.triggers.suppressed.includes(key)) state.triggers.suppressed = [...state.triggers.suppressed, key];
    return;
  }
  if (effect.name === "deactivateat") {
    const [x, y, layer, unit] = effect.args;
    if (typeof x === "number" && typeof y === "number" && typeof layer === "number") {
      const board = state.world.board;
      // `send` reports one-based tiles; trigger regions use the board's pixel coordinates.
      const point = unit === "tile" && board !== null && board !== undefined
        ? tileToPixel(coordLayout(board.coordType), board.sizeX, x, y)
        : { x, y };
      state.triggers.deactivateAt = { ...point, layer };
    }
  }
}

/** Dispatch one trigger phase after movement and before battle. */
export function runTriggersPhase(state: GameState, options: TriggerPhaseOptions = {}): TriggerEvent[] {
  const events: TriggerEvent[] = [];
  const board = state.world.board ?? null;
  const player = selectedPlayer(state);
  if (board === null || player === null) return events;
  const section = state.triggers;
  if (section.version !== 2) resetTriggersSection(section);
  if (section.boardKey !== board.key) {
    section.boardKey = board.key;
    section.fired = {};
    section.repeat = {};
    section.suppressed = [];
    section.deactivated = [];
    section.deactivateAt = null;
    section.active = null;
    section.silentUntilIdle = false;
  }
  if (section.deactivateAt !== null) {
    const arrival = section.deactivateAt;
    const atDestination = player.layer === arrival.layer && fixed(player.x) === fixed(arrival.x) && fixed(player.y) === fixed(arrival.y);
    if (atDestination) {
      const shape = playerShape(player);
      for (const [index, program] of (board.programs ?? []).entries()) if (program.layer === player.layer && overlaps(shape, polygon(program.points), program.closed !== 0)) section.deactivated.push(`region:${index}`);
      for (const [index, item] of (board.items ?? []).entries()) {
        const actor = state.sprites.items.find((value) => value.index === index);
        if (actor?.visible && item.layer === player.layer && overlaps(shape, itemShape(itemCandidate(item, actor, index)))) section.deactivated.push(`item:${index}`);
      }
    }
    section.deactivateAt = null;
  }
  if (section.active !== null) {
    if (!currentThreadFinished(state, section.active)) return events;
    const active = section.active;
    if (active.setVar !== "") state.vm.globals[active.setVar] = active.setValue;
    emit(events, options, { type: "trigger-complete", tick: state.time.tick, key: active.key, source: active.source });
    section.active = null;
    if (active.silentMovement && (player.movement.active !== null || player.queue.moves.length > 0 || player.queue.waypoint !== null)) section.silentUntilIdle = true;
  }
  if (section.silentUntilIdle) {
    if (player.movement.active !== null || player.queue.moves.length > 0 || player.queue.waypoint !== null) return events;
    section.silentUntilIdle = false;
    return events;
  }
  // docs/spec/engine/main-loop-and-startup.md#reawakened-boot-held-activation
  // A boot poll is deferred until the enter program has released the blocking thread.
  const bootPoll = section.lastKeySeq === -1;
  if (bootPoll && hasLiveBlockingThread(state.vm)) return events;
  const heldActivation = state.input.actions.confirm === true || state.input.actions.ENTER === true
    || state.input.actions[" "] === true
    || (Object.keys(state.input.bindings.keys).length === 0
      && (state.input.held.ENTER === true || state.input.held.Enter === true
        || state.input.held.Space === true || state.input.held[" "] === true));
  const step = stepTick(player) === state.time.tick;
  const unbound = Object.keys(state.input.bindings.keys).length === 0;
  const key = (bootPoll && heldActivation) || state.input.keys.some((entry) => entry.seq > section.lastKeySeq
    && isActivationKey(entry.name, entry.action, unbound));
  if (bootPoll) section.lastKeySeq = 0;
  for (const entry of state.input.keys) if (entry.seq > section.lastKeySeq) section.lastKeySeq = entry.seq;
  if (!step && !key) return events;
  const kind = key ? "key" : "step";
  const shape = playerShape(player);
  const regions = (board.programs ?? []).map(regionCandidate);
  const items: Candidate[] = [];
  // The re-arm pool covers every authored item: an arrival-suppressed item on another layer or with
  // visibility off must leave `deactivated` too (E-40 re-arms on leaving the candidate's area), even
  // though only visible, same-layer items can ever become candidates.
  const rearmPool: Candidate[] = [...regions];
  for (const [index, item] of (board.items ?? []).entries()) {
    const actor = state.sprites.items.find((value) => value.index === index);
    if (actor === undefined) continue;
    const candidate = itemCandidate(item, actor, index);
    rearmPool.push(candidate);
    if (actor.visible && item.layer === player.layer) items.push(candidate);
  }
  const all = [...regions, ...items];
  for (const candidate of rearmPool) {
    const overlapsArea = candidate.layer === player.layer
      && (candidate.source === "item"
        ? candidate.actor !== undefined && candidate.actor.visible && overlaps(shape, itemShape(candidate))
        : overlaps(shape, polygon(candidate.points), candidate.closed !== 0));
    if (!overlapsArea) {
      delete section.fired[candidate.key];
      delete section.repeat[candidate.key];
      if (section.deactivated.includes(candidate.key)) {
        section.deactivated = section.deactivated.filter((key) => key !== candidate.key);
      }
    }
  }
  const qualifying = all.filter((candidate) => {
    if (!triggerTypeMatches(candidate, kind) || section.suppressed.includes(candidate.key) || section.deactivated.includes(candidate.key)) return false;
    // A trigger belongs to the layer it was authored on: only the player's own layer may fire it
    // (docs/spec/engine/movement-and-collision.md#triggers). Regions are collected from every layer,
    // so the comparison has to be here as well as in the item list above.
    const inArea = candidate.layer === player.layer
      && (candidate.source === "item" ? overlaps(shape, itemShape(candidate)) : overlaps(shape, polygon(candidate.points), candidate.closed !== 0));
    if (!inArea || !conditionMatches(state, candidate) || candidate.program === "") return false;
    if (kind === "key") return true;
    const fired = section.fired[candidate.key] === true;
    if (!fired) return true;
    if ((candidate.activationType & 3) !== 2) return false;
    const distance = candidate.repeatDistance;
    if (distance <= 0) return false;
    const next = (section.repeat[candidate.key] ?? 0) + stepDistance(player);
    section.repeat[candidate.key] = next;
    return next >= distance;
  });
  let winner: Candidate | undefined;
  if (kind === "key") {
    const itemCandidates = qualifying.filter((candidate) => candidate.source === "item");
    itemCandidates.sort((left, right) => {
      const leftActor = left.actor!;
      const rightActor = right.actor!;
      return frontness(player, rightActor) - frontness(player, leftActor) || distanceSquared(player, leftActor) - distanceSquared(player, rightActor) || leftActor.index - rightActor.index;
    });
    winner = itemCandidates[0] ?? qualifying.filter((candidate) => candidate.source === "region").at(-1);
  } else {
    const itemCandidates = qualifying.filter((candidate) => candidate.source === "item");
    itemCandidates.sort((left, right) => {
      const leftActor = left.actor!;
      const rightActor = right.actor!;
      return frontness(player, rightActor) - frontness(player, leftActor) || distanceSquared(player, leftActor) - distanceSquared(player, rightActor) || leftActor.index - rightActor.index;
    });
    winner = itemCandidates[0] ?? qualifying.filter((candidate) => candidate.source === "region").at(-1);
  }
  if (winner === undefined || hasLiveBlockingThread(state.vm)) return events;
  const ref = resolveTriggerProgramRef(winner.program, options, board.key);
  // The `null` fall-through is the reported missing-program branch (empty names never reach here).
  if (ref === null) {
    section.fired[winner.key] = true;
    return events;
  }
  if (winner.source === "item" && winner.actor !== undefined) {
    state.sprites.items = state.sprites.items.map((actor) => actor.id === winner!.actor!.id ? { ...actor, facing: facingToward(actor, player) } : actor);
    clearQueue(state, player);
  } else if ((winner.activationType & 4) !== 0) clearQueue(state, player);
  resetUiForProgramStart(state.ui);
  const thread = startThread(state.vm, { ref, kind: "blocking", owner: "script", source: winner.source === "item" ? winner.actor?.id ?? null : winner.key, target: player.id });
  const active: TriggerActive = {
    key: winner.key,
    thread: thread.id,
    setVar: winner.finalVar,
    setValue: winner.finalValue,
    source: winner.source,
    silentMovement: true,
  };
  section.active = active;
  section.fired[winner.key] = true;
  if ((winner.activationType & 3) === 2) section.repeat[winner.key] = 0;
  emit(events, options, { type: "trigger-start", tick: state.time.tick, key: winner.key, source: winner.source });
  return events;
}

export function triggerPhaseRegistration(options: TriggerPhaseOptions = {}): EnginePhaseRegistration {
  return {
    phase: "triggers",
    rank: options.rank ?? 0,
    run: (state, postEffect?) => {
      // Without a host-supplied sink, a missing trigger program posts the engine's own diagnostic
      // effect, which the engine turns into a located report (engine.ts's engine-section applier).
      const phaseOptions: TriggerPhaseOptions = postEffect === undefined
        ? options
        : {
          ...options,
          onDiagnostic: options.onDiagnostic ?? ((diagnostic) => { postEffect("engine", engineEffect("engine", "diagnostic", [diagnostic.code, diagnostic.file, diagnostic.line, diagnostic.message], "diagnostic")); }),
        };
      runTriggersPhase(state, phaseOptions);
    },
  };
}
export const triggersPhaseRegistration = triggerPhaseRegistration;
export function triggerResetRegistration(rank = 0): EngineResetRegistration {
  return { section: "triggers", rank, reset: (state) => resetTriggersSection(state.triggers) };
}
export { createTriggersSection };

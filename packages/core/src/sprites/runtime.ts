import type { ActorId } from "../actors/model.ts";
import type { ProgramRef } from "../script/program.ts";
import { endItemThreads, findThread, startThread, type VmState } from "../script/state.ts";
import type { CameraPoint, CameraTarget } from "../ports/camera.ts";
import type { PlayerPresencePort } from "../ports/startup.ts";
import type { SpriteDraw } from "../render/compose.ts";
import type { Character } from "../formats/actor/model.ts";
import type { WorldBoard } from "../world/model.ts";
import {
  actorFromSource,
  actorLinkForSource,
  boardItemSources,
  createSpritesSection,
  SPRITES_SCHEMA_VERSION,
  type SpriteActor,
  type SpriteActorSource,
  type SpriteHydrationInput,
  type SpriteMove,
  type SpritePoint,
  type SpriteQueue,
  type SpritesSection,
  type WaypointLink,
} from "./model.ts";
import { findPath, type PathMode, type PathResult } from "./pathfinding.ts";

export type SpriteThreadResolver = (program: string) => ProgramRef | null;
export type SpriteRuntimeOptions = {
  readonly section?: SpritesSection;
  readonly vm?: VmState;
  readonly programRef?: SpriteThreadResolver | null;
};

export type SpriteEffect = {
  readonly name: "createplayer" | "placeplayer" | "removeitem" | "showitem" | "hideitem";
  readonly args: readonly (string | number)[];
};

function clonePoint(point: SpritePoint): SpritePoint {
  return { x: point.x, y: point.y };
}

function itemKey(actor: SpriteActor): string {
  return actor.handle === null ? actor.id : `item:${actor.source}`;
}

function startsItemThread(actor: SpriteActor, vm: VmState | undefined, resolver: SpriteThreadResolver | null | undefined): number | null {
  if (!actor.visible || actor.multitaskProgram === null || vm === undefined || resolver === null || resolver === undefined) return null;
  const ref = resolver(actor.multitaskProgram);
  if (ref === null) return null;
  const thread = startThread(vm, { ref, kind: "item", owner: "world", source: itemKey(actor), target: itemKey(actor) });
  return thread.id;
}

function stopItemThread(actor: SpriteActor, vm: VmState | undefined): void {
  if (vm === undefined) return;
  endItemThreads(vm, itemKey(actor));
}

function withItemThread(actor: SpriteActor, thread: number | null): SpriteActor {
  return { ...actor, multitaskThread: thread };
}

function itemById(section: SpritesSection, id: string | number): number {
  const key = typeof id === "number" ? `item:${id}` : id;
  return section.items.findIndex((item) => item.id === key || item.source === key || item.handle === id);
}

function updateItem(section: SpritesSection, index: number, update: (item: SpriteActor) => SpriteActor): SpriteActor | null {
  const item = section.items[index];
  if (item === undefined) return null;
  const replacement = update(item);
  section.items = section.items.map((value, current) => current === index ? replacement : value);
  return replacement;
}

function actorSourceForPlayer(source: SpriteActorSource, index: number, board: WorldBoard | null, actors: SpriteHydrationInput["actors"]): SpriteActor {
  const link = actorLinkForSource(source, actors);
  return actorFromSource({ ...source, kind: "player", ...(link === undefined ? {} : { actorId: link }) }, board, index, null);
}

/** Hydrate players and compacted board items into the authoritative sprites section. */
export function hydrateSprites(input: SpriteHydrationInput, section = createSpritesSection()): SpritesSection {
  const board = input.board;
  const actors = input.actorFiles ?? new Map();
  const players = (input.players ?? []).map((source, index) => actorSourceForPlayer(source, index, board, input.actors));
  const itemSources = boardItemSources(board, actors, input.variables ?? {}, input.actors, input.actorIds);
  const items = itemSources.map((source, index) => {
    const actor = actorFromSource(source, board, index, index);
    const thread = startsItemThread(actor, input.vm, input.programRef);
    return withItemThread(actor, thread);
  });
  const selected = input.selectedPlayer === undefined
    ? (players.find((player) => player.controlled)?.id ?? players[0]?.id ?? null)
    : input.selectedPlayer;
  section.version = SPRITES_SCHEMA_VERSION;
  section.players = players;
  section.items = items;
  section.selectedPlayer = selected;
  section.nextItemHandle = items.length;
  return section;
}

/** Construct a player from its character definition, before or after a board is loaded. */
export function createInitialPlayer(
  section: SpritesSection,
  board: WorldBoard | null,
  source: SpriteActorSource,
): SpriteActor {
  const player = actorSourceForPlayer({ ...source, controlled: source.controlled ?? section.players.length === 0 }, section.players.length, board, undefined);
  section.players = [...section.players, player];
  if (section.selectedPlayer === null || player.controlled) section.selectedPlayer = player.id;
  return player;
}

/** Place the selected player without changing its queue or actor identity. */
export function placeSelectedPlayer(section: SpritesSection, x: number, y: number, layer: number, unit: "pixel" | "tile" = "pixel"): boolean {
  const index = section.players.findIndex((player) => player.id === section.selectedPlayer);
  if (index < 0) return false;
  const player = section.players[index]!;
  const point = unit === "pixel" ? { x, y } : { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 };
  section.players = section.players.map((actor, current) => current === index
    ? { ...actor, x: point.x, y: point.y, layer, prev: null, state: "waiting", queue: { moves: [], waypoint: null } }
    : actor);
  return true;
}

/** Change item visibility and own its multitask thread lifecycle. */
export function setItemVisible(section: SpritesSection, id: string | number, visible: boolean, vm?: VmState, resolver?: SpriteThreadResolver | null): boolean {
  const index = itemById(section, id);
  const item = section.items[index];
  if (item === undefined || item.visible === visible) return item !== undefined;
  if (!visible) stopItemThread(item, vm);
  const replacement = updateItem(section, index, (value) => ({ ...value, visible, state: visible ? "waiting" : "hidden", multitaskThread: null }));
  if (visible && replacement !== null) {
    const thread = startsItemThread(replacement, vm, resolver);
    updateItem(section, index, (value) => withItemThread(value, thread));
  }
  return true;
}

/** Remove an item from the board while retaining its compact handle for save/draw determinism. */
export function removeItem(section: SpritesSection, id: string | number, vm?: VmState): boolean {
  return setItemVisible(section, id, false, vm, null);
}

/** Select a player by stable id; no roster data is copied into the sprites section. */
export function selectPlayer(section: SpritesSection, id: string): boolean {
  if (!section.players.some((player) => player.id === id)) return false;
  section.selectedPlayer = id;
  section.players = section.players.map((player) => ({ ...player, controlled: player.id === id }));
  return true;
}

/** Select the sprite linked to a stable party actor id without changing sprite order. */
export function selectActor(section: SpritesSection, actorId: ActorId | null): boolean {
  if (actorId === null) {
    section.selectedPlayer = null;
    section.players = section.players.map((player) => ({ ...player, controlled: false }));
    return true;
  }
  const player = section.players.find((candidate) => candidate.actorId === actorId);
  return player === undefined ? false : selectPlayer(section, player.id);
}
/** Replace only the selected actor's sprite presentation while preserving its identity and runtime position. */
export function changePlayerGraphics(section: SpritesSection, board: WorldBoard, actorId: ActorId, file: string, character: Character): boolean {
  const player = section.players.find((candidate) => candidate.actorId === actorId);
  if (player === undefined) return false;
  const graphic = actorFromSource({
    id: player.id, actorId, kind: "player", source: file,
    x: player.x, y: player.y, layer: player.layer, character,
  }, board, player.index, null);
  section.players = section.players.map((candidate) => candidate.id === player.id
    ? { ...candidate, source: file, visual: graphic.visual }
    : candidate);
  return true;
}

/** Remove a destroyed actor's linked sprite; roster removal alone retains it for restoration. */
export function removeActorSprite(section: SpritesSection, actorId: ActorId): boolean {
  const player = section.players.find((candidate) => candidate.actorId === actorId);
  if (player === undefined) return false;
  section.players = section.players.filter((candidate) => candidate.actorId !== actorId);
  if (section.selectedPlayer === player.id) {
    const selected = section.players.find((candidate) => candidate.controlled) ?? section.players[0] ?? null;
    section.selectedPlayer = selected?.id ?? null;
  }
  section.players = section.players.map((candidate) => ({ ...candidate, controlled: candidate.id === section.selectedPlayer }));
  return true;
}

function actorFor(section: SpritesSection, id: string): SpriteActor | null {
  return section.players.find((actor) => actor.id === id) ?? section.items.find((actor) => actor.id === id) ?? null;
}

/** Append a move to an actor's FIFO queue. */
export function enqueueMove(section: SpritesSection, id: string, move: SpriteMove, clear = false): boolean {
  const update = (actor: SpriteActor): SpriteActor => ({
    ...actor,
    state: actor.visible ? "moving" : actor.state,
    queue: { ...actor.queue, moves: clear ? [move] : [...actor.queue.moves, move] },
  });
  const playerIndex = section.players.findIndex((actor) => actor.id === id);
  if (playerIndex >= 0) {
    section.players = section.players.map((actor, index) => index === playerIndex ? update(actor) : actor);
    return true;
  }
  const itemIndex = section.items.findIndex((actor) => actor.id === id);
  if (itemIndex >= 0) {
    section.items = section.items.map((actor, index) => index === itemIndex ? update(actor) : actor);
    return true;
  }
  return false;
}

/** Find and enqueue a deterministic path while retaining the actor's existing FIFO owner. */
export function enqueuePathMove(
  section: SpritesSection,
  board: WorldBoard,
  id: string,
  goal: SpritePoint,
  mode: PathMode = 1,
  clear = true,
  pointer = false,
): PathResult | null {
  const actor = actorFor(section, id);
  if (actor === null) return null;
  const result = findPath(board, section, actor, goal, mode);
  if (result.points.length === 0) return result;
  const moves = result.points.map((point): SpriteMove => ({ source: "path", target: clonePoint(point), facing: null, pathMode: mode, ...(pointer ? { pointer: true as const } : {}) }));
  const playerIndex = section.players.findIndex((value) => value.id === id);
  const itemIndex = section.items.findIndex((value) => value.id === id);
  const update = (value: SpriteActor): SpriteActor => ({
    ...value,
    state: value.visible ? "moving" : value.state,
    queue: { ...value.queue, moves: clear ? moves : [...value.queue.moves, ...moves] },
  });
  if (playerIndex >= 0) section.players = section.players.map((value, index) => index === playerIndex ? update(value) : value);
  else if (itemIndex >= 0) section.items = section.items.map((value, index) => index === itemIndex ? update(value) : value);
  return result;
}

/** Append a straight point path, preserving the existing `points` movement semantics. */
export function enqueuePointPathMove(section: SpritesSection, id: string, points: readonly SpritePoint[], clear = true, pathMode?: PathMode): boolean {
  let changed = false;
  points.forEach((point, index) => {
    changed = enqueueMove(section, id, { source: "points", target: clonePoint(point), facing: null, ...(pathMode === undefined ? {} : { pathMode }) }, clear && index === 0) || changed;
  });
  return changed;
}

/** Copy a waypoint vector into an actor's queue or link it for live edits. */
export function setWaypoint(section: SpritesSection, id: string, points: readonly SpritePoint[], cycles: number, link: boolean): boolean {
  const actor = actorFor(section, id);
  if (actor === null) return false;
  const waypoint: WaypointLink = { points: points.map(clonePoint), cycles: Math.max(0, Math.trunc(cycles)), cycle: 0, cursor: 0, live: link };
  const queue: SpriteQueue = { ...actor.queue, waypoint };
  const update = (value: SpriteActor): SpriteActor => ({ ...value, state: value.visible ? "moving" : value.state, queue });
  const playerIndex = section.players.findIndex((value) => value.id === id);
  if (playerIndex >= 0) section.players = section.players.map((value, index) => index === playerIndex ? update(value) : value);
  else section.items = section.items.map((value) => value.id === id ? update(value) : value);
  return true;
}

function drawFor(actor: SpriteActor, drawId: number): SpriteDraw {
  const draw: SpriteDraw = {
    id: actor.id,
    key: actor.kind,
    layer: actor.layer,
    x: actor.x,
    y: actor.y,
    drawId,
    phase: actor.visual.frame,
    ...(actor.visual.file === null || actor.visual.file === undefined ? {} : { frame: { file: actor.visual.file } }),
    collisionBase: actor.collisionBase.points,
  };
  return actor.prev === null ? draw : { ...draw, prev: actor.prev };
}

/** Build SpriteDraw data in stable player-before-item category order. */
export function spriteDraws(section: SpritesSection): SpriteDraw[] {
  const playerCount = section.players.length;
  const players = section.players.map((actor) => drawFor(actor, actor.index));
  const items = section.items.filter((item) => item.visible).map((actor) => drawFor(actor, playerCount + actor.index));
  return [...players, ...items];
}

export type SpriteRuntime = CameraTarget & PlayerPresencePort & {
  readonly section: SpritesSection;
  readonly vm: VmState | undefined;
  hydrate(input: SpriteHydrationInput): SpritesSection;
  /** Prepare without mutation; a throwing commit must be reversible by rollback. */
  prepareRecovery(board: WorldBoard, sprites: SpritesSection): { commit(): void; rollback(): void };
  createPlayer(board: WorldBoard | null, source: SpriteActorSource): SpriteActor;
  placePlayer(x: number, y: number, layer: number, unit?: "pixel" | "tile"): boolean;
  showItem(id: string | number): boolean;
  hideItem(id: string | number): boolean;
  removeItem(id: string | number): boolean;
  selectPlayer(id: string): boolean;
  selectActor(actorId: ActorId | null): boolean;
  changePlayerGraphics(actorId: ActorId, file: string, character: Character): boolean;
  removeActor(actorId: ActorId): boolean;
  draws(): SpriteDraw[];
  applyEffect(effect: SpriteEffect): boolean;
};

/** Create the section owner and its camera/start-up ports. */
export function createSpriteRuntime(options: SpriteRuntimeOptions = {}): SpriteRuntime {
  const section = options.section ?? createSpritesSection();
  const vm = options.vm;
  const resolver = options.programRef;
  let board: WorldBoard | null = null;
  const runtime: SpriteRuntime = {
    section,
    vm,
    hydrate(input) {
      board = input.board;
      return hydrateSprites(input, section);
    },
    prepareRecovery(nextBoard, sprites) {
      const previousBoard = board;
      const previous = { ...section };
      const copy = (source: SpritesSection): void => {
        section.version = source.version;
        section.players = source.players;
        section.items = source.items;
        section.selectedPlayer = source.selectedPlayer;
        section.nextItemHandle = source.nextItemHandle;
        if (source.randomEncounter === undefined) delete section.randomEncounter;
        else section.randomEncounter = source.randomEncounter;
      };
      return {
        commit() { copy(sprites); board = nextBoard; },
        rollback() { copy(previous); board = previousBoard; },
      };
    },
    createPlayer(currentBoard, source) {
      board = currentBoard;
      return createInitialPlayer(section, currentBoard, source);
    },
    placePlayer(x, y, layer, unit = "pixel") { return placeSelectedPlayer(section, x, y, layer, unit); },
    showItem(id) { return setItemVisible(section, id, true, vm, resolver); },
    hideItem(id) { return setItemVisible(section, id, false, vm, resolver); },
    removeItem(id) { return removeItem(section, id, vm); },
    selectPlayer(id) { return selectPlayer(section, id); },
    selectActor(actorId) { return selectActor(section, actorId); },
    changePlayerGraphics(actorId, file, character) { return board === null ? false : changePlayerGraphics(section, board, actorId, file, character); },
    removeActor(actorId) { return removeActorSprite(section, actorId); },
    draws() { return spriteDraws(section); },
    hasPlayer() { return section.players.length > 0; },
    getPlayerPosition(): CameraPoint | null {
      const player = section.players.find((actor) => actor.id === section.selectedPlayer);
      return player === undefined ? null : { x: player.x, y: player.y };
    },
    getEntityPosition(entityId) {
      const actor = actorFor(section, String(entityId));
      return actor === null ? null : { x: actor.x, y: actor.y };
    },
    applyEffect(effect) {
      if (effect.name === "createplayer") {
        if (board === null || effect.args[0] === undefined) return false;
        runtime.createPlayer(board, { id: String(effect.args[0]), kind: "player", source: String(effect.args[0]), x: board.start?.x ?? 64, y: board.start?.y ?? 64, layer: board.start?.layer ?? 1 });
        return true;
      }
      if (effect.name === "placeplayer") {
        const [x, y, layer, unit] = effect.args;
        return typeof x === "number" && typeof y === "number" && typeof layer === "number" && runtime.placePlayer(x, y, layer, unit === "tile" ? "tile" : "pixel");
      }
      if (effect.name === "showitem") return effect.args[0] !== undefined && runtime.showItem(effect.args[0]);
      if (effect.name === "hideitem") return effect.args[0] !== undefined && runtime.hideItem(effect.args[0]);
      if (effect.name === "removeitem") return effect.args[0] !== undefined && runtime.removeItem(effect.args[0]);
      return false;
    },
  };
  return runtime;
}

/** Reset the mutable sprites section at the engine reset seam. */
export function resetSpritesSection(section: SpritesSection): void {
  const empty = createSpritesSection();
  section.version = empty.version;
  section.players = empty.players;
  section.items = empty.items;
  section.selectedPlayer = empty.selectedPlayer;
  section.nextItemHandle = empty.nextItemHandle;
}

/** Registration shape accepted by the engine reset seam for the sprites owner. */
export function spriteResetRegistration(rank = 0): {
  readonly section: "sprites";
  readonly rank: number;
  readonly reset: (state: { sprites: SpritesSection }) => void;
} {
  return { section: "sprites", rank, reset: (state) => resetSpritesSection(state.sprites) };
}

/** Return all live item thread ids owned by visible item actors. */
export function itemThreadIds(section: SpritesSection, vm: VmState | undefined): number[] {
  if (vm === undefined) return [];
  return section.items.map((item) => item.multitaskThread).filter((id): id is number => id !== null && findThread(vm, id) !== undefined);
}

/** Ensure no stale owner thread ids survive a restore. */
export function reconcileItemThreads(section: SpritesSection, vm: VmState): void {
  section.items = section.items.map((item) => ({
    ...item,
    multitaskThread: item.multitaskThread !== null && findThread(vm, item.multitaskThread) !== undefined ? item.multitaskThread : null,
  }));
}


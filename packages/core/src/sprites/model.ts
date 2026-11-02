/**
 * Unified player and item runtime state (AD-10, AD-32; E-20/E-21).
 *
 * This module contains only JSON-safe data. Actor files are decoded before they
 * cross this seam; bytes and parser models never become part of `GameState`.
 */
import { actorId, type ActorId, type ActorRecord, type ActorsSection } from "../actors/model.ts";
import type { Character, Item } from "../formats/actor/index.ts";
import type { ProgramRef } from "../script/program.ts";
import type { VmState } from "../script/state.ts";
import type { WorldBoard, WorldItem } from "../world/model.ts";

export const SPRITES_SCHEMA_VERSION = 2;


export const FACING = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Facing = (typeof FACING)[number];
export type SpriteKind = "player" | "item";
export type SpriteState = "waiting" | "idling" | "moving" | "done" | "stance" | "frozen" | "hidden";
export type QueueSource = "keyboard" | "direction" | "points" | "path" | "waypoint-path" | "waypoint-link";

export type SpritePoint = { readonly x: number; readonly y: number };
export type SpriteBase = { points: SpritePoint[] };
export type SpriteVisual = {
  movement: string[];
  idle: string[];
  battle: string[];
  custom: { animation: string; handle: string }[];
  /** Stable logical selection (`walk.E`, `idle.S`, or `stance.wave`). */
  animation: string | null;
  /** The selected animation file passed through to SpriteDraw. */
  file: string | null;
  stance: string | null;
  frame: number;
  frameTicks: number;
  idleTicks: number;
  stanceHeld: boolean;
  stanceComplete: boolean;
};
export type SpriteMove = {
  readonly source: QueueSource;
  readonly target: SpritePoint;
  readonly facing: Facing | null;
  readonly pathMode?: 1 | 2 | 3;
  readonly deferredComplete?: boolean;
  /** Queued by a pointer click or held button; such moves pause while a script owns the key queue. */
  readonly pointer?: true;
};
export type WaypointLink = {
  points: SpritePoint[];
  cycles: number;
  cycle: number;
  cursor: number;
  live: boolean;
};
/** The actor's FIFO and its optional waypoint source. */
export type SpriteQueue = {
  moves: SpriteMove[];
  waypoint: WaypointLink | null;
};

/** The resumable portion of one movement step (AD-10; E-22/R-50). */
export type SpriteActiveMove = {
  readonly source: QueueSource;
  readonly start: SpritePoint;
  readonly target: SpritePoint;
  readonly facing: Facing | null;
  readonly cadence: number;
  readonly ignoreBoard: boolean;
  readonly tried: boolean;
  readonly pathMode?: 1 | 2 | 3;
  readonly deferredComplete?: boolean;
  readonly pointer?: true;
};

/** Fixed-tick movement state stored with the actor for snapshot/restore. */
export type SpriteMovement = {
  readonly active: SpriteActiveMove | null;
  readonly waitTicks: number;
  readonly pendingExit: Facing | null;
  readonly under: string[];
  /** Tick at which the most recent movement target completed. */
  readonly lastStepTick: number | null;
  /** Euclidean distance of the most recent completed target, in pixels. */
  readonly lastStepDistance: number;
};

/** Persisted progress for movement-owned random encounters. */
export type RandomEncounterProgress = {
  readonly boardKey: string;
  readonly tile: SpritePoint;
  readonly tiles: number;
};

/** One hydrated actor, shared by players and board items. */
export type SpriteActor = {
  readonly id: string;
  readonly kind: SpriteKind;
  /** Optional stable actor-section id; absent means asset-only sprite. */
  readonly actorId?: ActorId | null;
  /** Stable category-local index; players precede items in draw order. */
  readonly index: number;
  /** Compact runtime item handle; null for players. */
  readonly handle: number | null;
  /** Raw board slot for diagnostics and save migration; null for players. */
  readonly sourceSlot: number | null;
  readonly source: string;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly facing: Facing;
  readonly state: SpriteState;
  readonly visible: boolean;
  readonly controlled: boolean;
  readonly speed: number;
  readonly idleTime: number;
  readonly collisionBase: SpriteBase;
  readonly activationBase: SpriteBase;
  readonly visual: SpriteVisual;
  readonly queue: SpriteQueue;
  readonly movement: SpriteMovement;
  readonly prev: SpritePoint | null;
  readonly frozenUntil: number | null;
  readonly multitaskProgram: string | null;
  /** VM thread id owned by this item, or null when hidden/no program. */
  readonly multitaskThread: number | null;
};

/** The AD-10 `sprites` section, schema version 2 with movement-aware actors and optional encounter progress. */
export type SpritesSection = {
  version: number;
  players: SpriteActor[];
  items: SpriteActor[];
  selectedPlayer: string | null;
  nextItemHandle: number;
  randomEncounter?: RandomEncounterProgress | null;
};

export type SpriteActorSource = {
  readonly id: string;
  readonly kind: SpriteKind;
  readonly source: string;
  /** Explicit actor-section link; null suppresses source matching. */
  readonly actorId?: ActorId | null;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly facing?: Facing;
  readonly controlled?: boolean;
  readonly visible?: boolean;
  readonly sourceSlot?: number;
  readonly handle?: number;
  readonly character?: Character;
  readonly item?: Item;
  readonly boardItem?: WorldItem;
};

export type SpriteHydrationInput = {
  readonly board: WorldBoard;
  readonly players?: readonly SpriteActorSource[];
  readonly actors?: ActorsSection;
  /** Optional explicit board-sprite id → actor id mapping for shared assets. */
  readonly actorIds?: Readonly<Record<string, ActorId | number | null>>;
  readonly actorFiles?: ReadonlyMap<string, Character | Item>;
  readonly selectedPlayer?: string | null;
  readonly tick?: number;
  readonly variables?: Readonly<Record<string, string | number | boolean>>;
  readonly vm?: VmState;
  readonly programRef?: ((program: string) => ProgramRef | null) | null;
};

function points(base: readonly { readonly x: number; readonly y: number }[]): SpriteBase {
  return { points: base.map((point) => ({ x: point.x, y: point.y })) };
}

/** The documented non-isometric defaults for actor geometry. */
export function defaultBases(isometric = false): { readonly collision: SpriteBase; readonly activation: SpriteBase } {
  if (!isometric) {
    return {
      collision: points([{ x: -15, y: -15 }, { x: 15, y: -15 }, { x: 15, y: 0 }, { x: -15, y: 0 }]),
      activation: points([{ x: -24, y: -24 }, { x: 24, y: -24 }, { x: 24, y: 8 }, { x: -24, y: 8 }]),
    };
  }
  return {
    collision: points([{ x: 0, y: -15 }, { x: 15, y: 0 }, { x: 0, y: 15 }, { x: -15, y: 0 }]),
    activation: points([{ x: 0, y: -24 }, { x: 24, y: 0 }, { x: 0, y: 24 }, { x: -24, y: 0 }]),
  };
}

function actorVisual(character: Character | undefined, item: Item | undefined): SpriteVisual {
  const movement = character?.movementAnimations ?? item?.movementAnimations ?? [];
  const idle = character?.idleAnimations ?? item?.idleAnimations ?? [];
  const battle = character?.battleStances ?? [];
  const custom = character?.customStances ?? item?.customStances ?? [];
  return {
    movement: [...movement],
    idle: [...idle],
    battle: [...battle],
    custom: custom.map((stance) => ({ animation: stance.animation, handle: stance.handle })),
    animation: null,
    file: null,
    stance: null,
    frame: 0,
    frameTicks: 0,
    idleTicks: 0,
    stanceHeld: false,
    stanceComplete: false,
  };
}

function actorBase(actor: Character | Item | undefined, fallback: SpriteBase, index: number): SpriteBase {
  const base = actor?.vectorBases?.[index];
  return base === undefined ? fallback : points(base.points);
}

/** Turn a board placement into one canonical runtime sprite. */
export function actorFromSource(source: SpriteActorSource, board: WorldBoard | null, index: number, handle: number | null): SpriteActor {
  const actor = source.character ?? source.item;
  const fallback = defaultBases(board !== null && (board.coordType & 3) !== 0);
  const item = source.boardItem;
  const multitask = source.item?.multitaskProgram ?? (item?.multitaskPrg || null);
  const link = source.actorId === undefined
    ? {}
    : { actorId: source.actorId === null ? null : actorId(source.actorId) };
  return {
    id: source.id,
    kind: source.kind,
    ...link,
    index,
    handle: source.kind === "item" ? handle : null,
    sourceSlot: source.kind === "item" ? (source.sourceSlot ?? item?.slot ?? null) : null,
    source: source.source,
    x: source.x,
    y: source.y,
    layer: source.layer,
    facing: source.facing ?? "S",
    state: source.visible === false ? "hidden" : "waiting",
    visible: source.visible !== false,
    controlled: source.controlled === true,
    speed: actor?.speed ?? 0.05,
    idleTime: actor?.idleTime ?? 0,
    collisionBase: actorBase(actor, fallback.collision, 0),
    activationBase: actorBase(actor, fallback.activation, 1),
    visual: actorVisual(source.character, source.item),
    queue: { moves: [], waypoint: null },
    movement: { active: null, waitTicks: 0, pendingExit: null, under: [], lastStepTick: null, lastStepDistance: 0 },
    prev: null,
    frozenUntil: null,
    multitaskProgram: multitask === "" ? null : multitask,
    multitaskThread: null,
  };
}


/** An empty, current-version sprites section. */
export function createSpritesSection(): SpritesSection {
  return { version: SPRITES_SCHEMA_VERSION, players: [], items: [], selectedPlayer: null, nextItemHandle: 0 };
}

/** Resolve a board source to an actor id without copying actor state. */
export function actorLinkForSource(
  source: Pick<SpriteActorSource, "source" | "actorId">,
  actors?: ActorsSection,
): ActorId | null | undefined {
  if (source.actorId !== undefined) return source.actorId === null ? null : actorId(source.actorId);
  if (actors === undefined) return undefined;
  const normalized = source.source.toLowerCase();
  const matches = actors.actors.filter((record) => record.source.toLowerCase() === normalized);
  return matches.length === 1 ? matches[0]!.id : undefined;
}

/** Resolve the actor record linked by a sprite, for owner-service dispatch. */
export function linkedActor(
  actors: ActorsSection,
  sprite: Pick<SpriteActor, "actorId">,
): Readonly<ActorRecord> | null {
  if (sprite.actorId === undefined || sprite.actorId === null) return null;
  return actors.actors.find((record) => record.id === sprite.actorId) ?? null;
}

/** Convert board slots to source records, compacting empty slots by filtering first. */
export function boardItemSources(
  board: WorldBoard,
  actorFiles: ReadonlyMap<string, Character | Item> = new Map(),
  variables: Readonly<Record<string, string | number | boolean>> = {},
  actors?: ActorsSection,
  actorIds?: Readonly<Record<string, ActorId | number | null>>,
): SpriteActorSource[] {
  return (board.items ?? []).filter((item) => item.itemFile !== "").map((item) => {
    const actor = actorFiles.get(item.itemFile);
    const condition = item.loadingVar === "" || String(variables[item.loadingVar] ?? "") === item.loadingValue;
    const explicit = actorIds?.[item.itemFile];
    const link = explicit === undefined
      ? actorLinkForSource({ source: item.itemFile }, actors)
      : actorLinkForSource({ source: item.itemFile, actorId: explicit === null ? null : actorId(explicit) }, actors);
    return {
      id: item.itemFile,
      kind: "item",
      source: item.itemFile,
      ...(link === undefined ? {} : { actorId: link }),
      x: item.x,
      y: item.y,
      layer: item.layer,
      sourceSlot: item.slot,
      visible: condition,
      ...(actor !== undefined && "multitaskProgram" in actor ? { item: actor } : {}),
      boardItem: item,
    };
  });
}

export type SpriteStateParts = Pick<SpritesSection, "players" | "items" | "selectedPlayer" | "nextItemHandle" | "randomEncounter">;
export type SpriteStateRecord = SpriteStateParts & { readonly version: number };

export function isSpriteActor(value: unknown): value is SpriteActor {
  if (typeof value !== "object" || value === null) return false;
  const actor = value as Partial<SpriteActor>;
  if (typeof actor.id !== "string" || (actor.kind !== "player" && actor.kind !== "item") || typeof actor.x !== "number" || typeof actor.y !== "number") return false;
  return !("actorId" in actor) || actor.actorId === null || (typeof actor.actorId === "number" && Number.isSafeInteger(actor.actorId) && actor.actorId > 0);
}

export function asSpritesSection(value: unknown): SpritesSection | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<SpritesSection>;
  if (!Array.isArray(record.players) || !Array.isArray(record.items) || (record.selectedPlayer !== null && typeof record.selectedPlayer !== "string") || typeof record.nextItemHandle !== "number") return null;
  if (!record.players.every(isSpriteActor) || !record.items.every(isSpriteActor)) return null;
  const progress = record.randomEncounter;
  const randomEncounter = progress === null ? null : (
    typeof progress === "object" && progress !== null && !Array.isArray(progress) && typeof progress.boardKey === "string"
      && typeof progress.tile === "object" && progress.tile !== null && !Array.isArray(progress.tile)
      && typeof progress.tile.x === "number" && typeof progress.tile.y === "number" && typeof progress.tiles === "number"
      ? { boardKey: progress.boardKey, tile: { x: progress.tile.x, y: progress.tile.y }, tiles: progress.tiles }
      : null
  );
  const section: SpritesSection = {
    version: typeof record.version === "number" ? record.version : SPRITES_SCHEMA_VERSION,
    players: record.players as SpriteActor[],
    items: record.items as SpriteActor[],
    selectedPlayer: record.selectedPlayer ?? null,
    nextItemHandle: record.nextItemHandle,
  };
  if (progress !== undefined) section.randomEncounter = randomEncounter;
  return section;
}

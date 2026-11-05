/**
 * The game ledger: the validated, game-owned progress subset of savable state,
 * and its domain-separated hash
 * (docs/spec/formats/save-game.md#game-ledger-and-savable-continuation).
 *
 * A ledger is a derived view over one already migrated and validated
 * `GameState` candidate. It is never stored in `GameState`, never narrows an
 * ordinary save, and never replaces `hashGameState`: the normal snapshot keeps
 * the whole VM continuation (threads, waits, frames, locals, listeners), and
 * this projection keeps only what the game itself would have to remember for
 * progress to survive a recovery. A projection is plain data, pure, and
 * deterministically ordered; it records explicit absence (`LedgerPresence`) and
 * the engine's tagged form for `NaN`/`Infinity` rather than omitting a key or
 * emitting `undefined`.
 *
 * The boundary follows the accepted field mapping and its resolved engineering
 * decisions (2026-10-30):
 *
 * - `vm.globals` is the only persistent root. Reached objects, their members in
 *   `keys` order, closure cells, receivers and the reached definitions' owners
 *   are kept with live handles and cell ids, plus `vm.cellSeq` as the issued-id
 *   high-water mark, so no reference can be aliased. `events.emitters` entries
 *   whose object handle was reached are kept because a host object's owner
 *   binding lives there.
 * - Board-scope runtime tile edits are durable progress and enter the ledger;
 *   program-scope edits are continuation tied to a live owner thread and do not.
 *   The authored layers and images are rebuilt from the board asset, so only the
 *   mutable values and the durable edits are projected.
 * - Sprite identity, placement and game-modified settings enter the ledger;
 *   animation clocks, queues, movement, freeze time and thread links stay in the
 *   normal save.
 * - Saved actor equipment is projected as saved. Asset-aware equipment
 *   reconciliation is the candidate-acceptance gate of 8.23 (#797), not part of
 *   this projection or its hash: a changed asset must never reset saved values.
 *
 * The hash is FNV-1a 64-bit over the canonical tagged JSON of the versioned
 * envelope `{domain, version, ledger}`; it is an accidental-change detector for
 * the same domain, version and game identity, not authentication, a whole-save
 * checksum or the runtime replay hash.
 */

import { hashState } from "../canon/index.ts";
import type { ActorsSection } from "../actors/model.ts";
import type { InventorySection, PartySection } from "../menu/model.ts";
import type { AssertPlainData } from "../ports/plain-data.ts";
import { FACING, type Facing, type SpritesSection } from "../sprites/model.ts";
import type { TriggersSection } from "../triggers/model.ts";
import type { RngState } from "../rng/xoshiro.ts";
import type { GameState } from "./state.ts";
import type { WorldSection } from "./sections.ts";
import {
  failLedger,
  ledgerFlag,
  ledgerInteger,
  ledgerList,
  ledgerNumber,
  ledgerPoint,
  ledgerRecord,
  ledgerText,
  projectScriptLedger,
  setField,
  LEDGER_BOARD,
  LEDGER_IDENTITY,
  LEDGER_REFERENCE,
  LEDGER_SHAPE,
  type LedgerPresence,
  type LedgerScript,
} from "./ledger-graph.ts";

export {
  GameLedgerError,
  LEDGER_BOARD,
  LEDGER_IDENTITY,
  LEDGER_REFERENCE,
  LEDGER_SHAPE,
} from "./ledger-graph.ts";
export type {
  LedgerCallableValue,
  LedgerCells,
  LedgerObject,
  LedgerObjectValue,
  LedgerPersistentGraph,
  LedgerPresence,
  LedgerProgramRef,
  LedgerScript,
  LedgerTaggedNumber,
  LedgerValue,
} from "./ledger-graph.ts";

/** The ledger's hash domain: hashes are comparable only within it (and this version). */
export const GAME_LEDGER_DOMAIN = "tkr.game-ledger";

/** The ledger projection version; it is independent of every section schema version. */
export const GAME_LEDGER_VERSION = 4;

/** Party roster, selection, steps and the sub-tile movement remainder. */
export type LedgerParty = {
  readonly members: number[];
  readonly selected: number | null;
  readonly steps: number;
  readonly stepRemainder: number;
};

/** The compatibility stats an actor owns. */
export type LedgerActorStats = {
  readonly experience: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly dp: number;
  readonly fp: number;
  readonly smp: number;
  readonly maxSmp: number;
  readonly level: number;
  readonly criticalOn: number;
  readonly criticalBy: number;
};

/** The equipment bonuses the actor owner already derived. */
export type LedgerActorBonuses = {
  readonly hp: number;
  readonly dp: number;
  readonly fp: number;
  readonly smp: number;
};

/** Saved equipment references and bonuses, projected as saved. */
export type LedgerActorEquipment = {
  readonly equipped: string[];
  readonly bonuses: LedgerActorBonuses;
};

/** Progression policy data, projected without guessing which fields are authored. */
export type LedgerActorProgression = {
  readonly levelType: number;
  readonly experienceIncrease: number;
  readonly maxLevel: number;
  readonly levelHp: number;
  readonly levelDp: number;
  readonly levelFp: number;
  readonly levelSm: number;
  readonly levelUpType: number;
  readonly remainingExperience: number;
  readonly nextRequirement: number;
  readonly legacyLevelUp: boolean | null;
};

/** One actor of any kind, in the actors section's array order. */
export type LedgerActor = {
  readonly id: number;
  readonly kind: "party" | "enemy" | "npc";
  readonly source: string;
  readonly name: string;
  readonly stats: LedgerActorStats;
  readonly statuses: { readonly [status: string]: number };
  readonly equipment: LedgerActorEquipment;
  readonly progression: LedgerActorProgression;
  readonly behaviour: string | null;
  readonly customEvents: string[];
};

/** Every live actor plus the monotonic identity counter. */
export type LedgerActors = {
  readonly nextId: number;
  readonly actors: LedgerActor[];
};

/** One inventory stack; `{id, source, handle}` is its identity. */
export type LedgerInventoryItem = {
  readonly id: number;
  readonly source: string;
  readonly handle: string;
  readonly quantity: number;
};

/** One authoritative equipment assignment: actor and slot to inventory identity. */
export type LedgerInventoryEquipment = {
  readonly actorId: number;
  readonly slot: string;
  readonly itemId: number;
};

/** Inventory stacks, assignments, gold and the monotonic identity counter. */
export type LedgerInventory = {
  readonly nextId: number;
  readonly items: LedgerInventoryItem[];
  readonly equipment: LedgerInventoryEquipment[];
  readonly gold: number;
};

/** A point in board or sprite space. */
export type LedgerPoint = { readonly x: number; readonly y: number };

/** A colour triple, as saved. */
export type LedgerTint = { readonly r: number; readonly g: number; readonly b: number };

/** One tile value with every optional authored field encoded explicitly. */
export type LedgerTile = {
  readonly asset: string;
  readonly tile: number;
  readonly nativeWidth: number | null;
  readonly nativeHeight: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly tint: LedgerTint | null;
  readonly animation: { readonly ticksPerFrame: number; readonly frames: LedgerTile[] } | null;
};

/** One authored board item slot, including empty holes and authored coordinates. */
export type LedgerRawItem = {
  readonly slot: number;
  readonly itemFile: string;
  readonly activationPrg: string;
  readonly multitaskPrg: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly loadingVar: string;
  readonly loadingValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly reserved: number;
};

/** One board vector region, as saved. */
export type LedgerBoardVector = {
  readonly points: LedgerPoint[];
  readonly attributes: number;
  readonly closed: number;
  readonly layer: number;
  readonly type: number;
  readonly handle: string;
};

/** One board program region, as saved. */
export type LedgerBoardProgram = {
  readonly program: string;
  readonly graphic: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly repeatDistance: number;
  readonly layer: number;
  readonly points: LedgerPoint[];
  readonly closed: number;
  readonly handle: string;
};

/**
 * One durable board tile replacement: the flat tile index, the durable value and
 * the edit's scope. The record's `previous` is baseline bookkeeping, not board
 * progress: it can hold a tile a program-scope edit placed and
 * `expireProgramTileEdits` rewrites it when a program ends, so it is excluded and
 * the durable value plus the board asset are the authority.
 */
export type LedgerTileEdit = {
  readonly index: number;
  readonly tile: LedgerTile | null;
  readonly scope: "board" | "program";
  readonly owner: number | null;
};

/** Durable runtime board state: board-scope tile edits and the tile types. */
export type LedgerBoardRuntime = {
  readonly tileEdits: LedgerTileEdit[];
  readonly tileTypes: string[];
};

/** The current board's durable values; authored layers and images are rebuilt from its asset. */
export type LedgerBoard = {
  readonly key: string;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeL: number;
  readonly ambient: LedgerTint;
  readonly vectors: LedgerBoardVector[];
  readonly programs: LedgerBoardProgram[];
  readonly rawItems: LedgerRawItem[];
  readonly runtime: LedgerPresence<LedgerBoardRuntime>;
};

/** World state includes independent, nullable movement settings for main-file fallback. */
export type LedgerWorld = {
  readonly movement: { readonly walking: number | null; readonly pushing: number | null };
  readonly board: LedgerPresence<LedgerBoard>;
};

/** The animation configuration and current selection of a sprite, without frame clocks. */
export type LedgerSpriteVisual = {
  readonly movement: string[];
  readonly idle: string[];
  readonly battle: string[];
  readonly custom: Array<{ readonly animation: string; readonly handle: string }>;
  readonly animation: string | null;
  readonly file: string | null;
  readonly stance: string | null;
};

/** A collision or activation base vector. */
export type LedgerSpriteBase = {
  readonly points: LedgerPoint[];
};

/** One sprite's identity, placement and game-modified settings. */
export type LedgerSprite = {
  readonly id: string;
  readonly kind: "player" | "item";
  readonly actorId: LedgerPresence<number>;
  readonly index: number;
  readonly handle: number | null;
  readonly sourceSlot: number | null;
  readonly source: string;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly facing: Facing;
  readonly visible: boolean;
  readonly controlled: boolean;
  readonly speed: number;
  readonly idleTime: number;
  readonly collisionBase: LedgerSpriteBase;
  readonly activationBase: LedgerSpriteBase;
  readonly visual: LedgerSpriteVisual;
  readonly multitaskProgram: string | null;
};

/** Movement-owned random encounter progress. */
export type LedgerRandomEncounter = {
  readonly boardKey: string;
  readonly tile: LedgerPoint;
  readonly tiles: number;
};

/** Current-board sprites, their counters and optional encounter progress. */
export type LedgerSprites = {
  readonly players: LedgerSprite[];
  readonly items: LedgerSprite[];
  readonly selectedPlayer: string | null;
  readonly nextItemHandle: number;
  readonly randomEncounter: LedgerPresence<LedgerRandomEncounter>;
};

/** Active-board trigger progress; `active`, `lastKeySeq` and `silentUntilIdle` are continuation. */
export type LedgerTriggers = {
  readonly boardKey: string | null;
  readonly fired: { readonly [key: string]: boolean };
  readonly repeat: { readonly [key: string]: number };
  readonly suppressed: string[];
  readonly deactivated: string[];
  readonly deactivateAt: (LedgerPoint & { readonly layer: number }) | null;
};

/** The four RNG words, exactly as saved. */
export type LedgerRng = RngState;

/** The fixed tick counter. */
export type LedgerTime = { readonly tick: number };

/** The v1 game ledger: the game-owned progress a recovery has to preserve. */
export type GameLedgerV1 = {
  readonly party: LedgerParty;
  readonly actors: LedgerActors;
  readonly inventory: LedgerInventory;
  readonly script: LedgerScript;
  readonly world: LedgerWorld;
  readonly sprites: LedgerSprites;
  readonly triggers: LedgerTriggers;
  readonly rng: LedgerRng;
  readonly time: LedgerTime;
};

/** The hashed envelope: domain and version separate this hash from every other hash. */
export type GameLedgerEnvelope = {
  readonly domain: string;
  readonly version: number;
  readonly ledger: GameLedgerV1;
};

/** Build-time proof that a projection stays plain data (G1 rule 2, AD-7). */
export type GameLedgerV1IsPlainData = AssertPlainData<GameLedgerV1>;

/**
 * Project the game ledger from one migrated, validated `GameState` candidate
 * (docs/spec/formats/save-game.md#game-ledger-and-savable-continuation).
 *
 * The projection is pure: it reads the candidate, never mutates it, and every
 * failure is a located `GameLedgerError` naming the candidate path, so a host
 * refuses the candidate before any recovery commit.
 */
export function projectGameLedger(state: GameState): GameLedgerV1 {
  const actors = projectActors(state.actors);
  const actorKinds = new Map<number, LedgerActor["kind"]>();
  for (const actor of actors.actors) actorKinds.set(actor.id, actor.kind);
  const world = projectWorld(state.world);
  const board = world.board.state === "present" ? world.board.value : null;
  return {
    party: projectParty(state.party, actorKinds),
    actors,
    inventory: projectInventory(state.inventory, new Set(actorKinds.keys())),
    script: projectScriptLedger(state.vm, state.events.emitters),
    world,
    sprites: projectSprites(state.sprites, board),
    triggers: projectTriggers(state.triggers),
    rng: projectRng(state.rng),
    time: { tick: ledgerInteger(state.time.tick, "time.tick", 0) },
  };
}

/**
 * Hash a ledger: FNV-1a 64-bit over the canonical tagged JSON of
 * `{domain: GAME_LEDGER_DOMAIN, version: GAME_LEDGER_VERSION, ledger}`.
 *
 * Callers may compare two hashes only for the same domain, version and
 * compatible game identity; a mismatch means different projected progress, not
 * a failed authenticity check.
 */
export function hashGameLedger(ledger: GameLedgerV1): string {
  const envelope: GameLedgerEnvelope = {
    domain: GAME_LEDGER_DOMAIN,
    version: GAME_LEDGER_VERSION,
    ledger,
  };
  return hashState(envelope);
}

/**
 * Hash the pre-movement v3 ledger envelope for validating already-promoted
 * recovery checkpoints. New checkpoints must use `hashGameLedger`.
 */
export function hashGameLedgerV3(ledger: GameLedgerV1): string {
  const legacyLedger = { ...ledger, world: { board: ledger.world.board } };
  return hashState({ domain: GAME_LEDGER_DOMAIN, version: 3, ledger: legacyLedger } as never);
}

function projectActors(section: ActorsSection): LedgerActors {
  const record = ledgerRecord(section, "actors");
  const nextId = ledgerInteger(record.nextId, "actors.nextId", 1);
  const actors: LedgerActor[] = [];
  const seen = new Set<number>();
  let highest = 0;
  ledgerList(record.actors, "actors.actors").forEach((entry, index) => {
    const path = `actors.actors[${index}]`;
    const actor = ledgerRecord(entry, path);
    const id = ledgerInteger(actor.id, `${path}.id`, 1);
    if (seen.has(id)) failLedger(LEDGER_IDENTITY, `${path}.id`, `duplicate actor id ${id}`);
    seen.add(id);
    if (id > highest) highest = id;
    actors.push(projectActor(actor, path, id));
  });
  if (nextId <= highest) {
    failLedger(LEDGER_IDENTITY, "actors.nextId", `must be above every actor id (the highest is ${highest})`);
  }
  return { nextId, actors };
}

function projectActor(record: { readonly [key: string]: unknown }, path: string, id: number): LedgerActor {
  const kind = record.kind;
  if (kind !== "party" && kind !== "enemy" && kind !== "npc") {
    return failLedger(LEDGER_SHAPE, `${path}.kind`, "expected \"party\", \"enemy\" or \"npc\"");
  }
  const stats = ledgerRecord(record.stats, `${path}.stats`);
  const statusRecord = ledgerRecord(record.statuses, `${path}.statuses`);
  const statuses: { [status: string]: number } = {};
  for (const status of Object.keys(statusRecord)) {
    setField(statuses, status, ledgerNumber(statusRecord[status], `${path}.statuses.${status}`));
  }
  const equipment = ledgerRecord(record.equipment, `${path}.equipment`);
  const bonuses = ledgerRecord(equipment.bonuses, `${path}.equipment.bonuses`);
  const progression = ledgerRecord(record.progression, `${path}.progression`);
  const source = ledgerText(record.source, `${path}.source`);
  if (source === "") failLedger(LEDGER_SHAPE, `${path}.source`, "expected a non-empty asset reference");
  const behaviour = record.behaviour === null ? null : ledgerText(record.behaviour, `${path}.behaviour`);
  return {
    id,
    kind,
    source,
    name: ledgerText(record.name, `${path}.name`),
    stats: {
      experience: ledgerNumber(stats.experience, `${path}.stats.experience`),
      hp: ledgerNumber(stats.hp, `${path}.stats.hp`),
      maxHp: ledgerNumber(stats.maxHp, `${path}.stats.maxHp`),
      dp: ledgerNumber(stats.dp, `${path}.stats.dp`),
      fp: ledgerNumber(stats.fp, `${path}.stats.fp`),
      smp: ledgerNumber(stats.smp, `${path}.stats.smp`),
      maxSmp: ledgerNumber(stats.maxSmp, `${path}.stats.maxSmp`),
      level: ledgerNumber(stats.level, `${path}.stats.level`),
      criticalOn: ledgerNumber(stats.criticalOn, `${path}.stats.criticalOn`),
      criticalBy: ledgerNumber(stats.criticalBy, `${path}.stats.criticalBy`),
    },
    statuses,
    equipment: {
      equipped: ledgerList(equipment.equipped, `${path}.equipment.equipped`)
        .map((entry, index) => ledgerText(entry, `${path}.equipment.equipped[${index}]`)),
      bonuses: {
        hp: ledgerNumber(bonuses.hp, `${path}.equipment.bonuses.hp`),
        dp: ledgerNumber(bonuses.dp, `${path}.equipment.bonuses.dp`),
        fp: ledgerNumber(bonuses.fp, `${path}.equipment.bonuses.fp`),
        smp: ledgerNumber(bonuses.smp, `${path}.equipment.bonuses.smp`),
      },
    },
    progression: {
      levelType: ledgerNumber(progression.levelType, `${path}.progression.levelType`),
      experienceIncrease: ledgerNumber(progression.experienceIncrease, `${path}.progression.experienceIncrease`),
      maxLevel: ledgerNumber(progression.maxLevel, `${path}.progression.maxLevel`),
      levelHp: ledgerNumber(progression.levelHp, `${path}.progression.levelHp`),
      levelDp: ledgerNumber(progression.levelDp, `${path}.progression.levelDp`),
      levelFp: ledgerNumber(progression.levelFp, `${path}.progression.levelFp`),
      levelSm: ledgerNumber(progression.levelSm, `${path}.progression.levelSm`),
      levelUpType: ledgerNumber(progression.levelUpType, `${path}.progression.levelUpType`),
      remainingExperience: ledgerNumber(progression.remainingExperience, `${path}.progression.remainingExperience`),
      nextRequirement: ledgerNumber(progression.nextRequirement, `${path}.progression.nextRequirement`),
      legacyLevelUp: progression.legacyLevelUp === null
        ? null
        : ledgerFlag(progression.legacyLevelUp, `${path}.progression.legacyLevelUp`),
    },
    behaviour,
    customEvents: ledgerList(record.customEvents, `${path}.customEvents`)
      .map((entry, index) => ledgerText(entry, `${path}.customEvents[${index}]`)),
  };
}

function projectParty(section: PartySection, actorKinds: ReadonlyMap<number, LedgerActor["kind"]>): LedgerParty {
  const record = ledgerRecord(section, "party");
  const members: number[] = [];
  const seen = new Set<number>();
  ledgerList(record.members, "party.members").forEach((entry, index) => {
    const path = `party.members[${index}]`;
    const id = ledgerInteger(entry, path, 1);
    if (seen.has(id)) failLedger(LEDGER_IDENTITY, path, `duplicate party member ${id}`);
    if (actorKinds.get(id) !== "party") {
      failLedger(LEDGER_REFERENCE, path, `names actor ${id}, which is not a live party actor`);
    }
    seen.add(id);
    members.push(id);
  });
  const selected = record.selected === null ? null : ledgerInteger(record.selected, "party.selected", 1);
  if (selected === null ? members.length > 0 : !seen.has(selected)) {
    failLedger(LEDGER_REFERENCE, "party.selected", "must name a member, or be null for an empty party");
  }
  const steps = ledgerInteger(record.steps, "party.steps", 0);
  const stepRemainder = ledgerInteger(record.stepRemainder, "party.stepRemainder", 0);
  if (stepRemainder >= 32 * 256) failLedger(LEDGER_SHAPE, "party.stepRemainder", "must be below 8192");
  return { members, selected, steps, stepRemainder };
}

function projectInventory(section: InventorySection, actorIds: ReadonlySet<number>): LedgerInventory {
  const record = ledgerRecord(section, "inventory");
  const nextId = ledgerInteger(record.nextId, "inventory.nextId", 1);
  const items: LedgerInventoryItem[] = [];
  const ids = new Set<number>();
  ledgerList(record.items, "inventory.items").forEach((entry, index) => {
    const path = `inventory.items[${index}]`;
    const item = ledgerRecord(entry, path);
    const id = ledgerInteger(item.id, `${path}.id`, 1);
    if (ids.has(id)) failLedger(LEDGER_IDENTITY, `${path}.id`, `duplicate inventory item id ${id}`);
    if (id >= nextId) failLedger(LEDGER_IDENTITY, `${path}.id`, `must be below inventory.nextId ${nextId}`);
    ids.add(id);
    items.push({
      id,
      source: ledgerText(item.source, `${path}.source`),
      handle: ledgerText(item.handle, `${path}.handle`),
      quantity: ledgerInteger(item.quantity, `${path}.quantity`, 0),
    });
  });
  const equipment: LedgerInventoryEquipment[] = [];
  const slots = new Set<string>();
  ledgerList(record.equipment, "inventory.equipment").forEach((entry, index) => {
    const path = `inventory.equipment[${index}]`;
    const assignment = ledgerRecord(entry, path);
    const actorId = ledgerInteger(assignment.actorId, `${path}.actorId`, 1);
    if (!actorIds.has(actorId)) {
      failLedger(LEDGER_REFERENCE, `${path}.actorId`, `names actor ${actorId}, which the actors section does not hold`);
    }
    const slot = ledgerText(assignment.slot, `${path}.slot`);
    if (slot === "") failLedger(LEDGER_SHAPE, `${path}.slot`, "expected a non-empty slot name");
    const itemId = ledgerInteger(assignment.itemId, `${path}.itemId`, 1);
    if (!ids.has(itemId)) {
      failLedger(LEDGER_REFERENCE, `${path}.itemId`, `names item ${itemId}, which the inventory does not hold`);
    }
    const key = `${actorId}:${slot}`;
    if (slots.has(key)) {
      failLedger(LEDGER_IDENTITY, `${path}.slot`, `assigns slot "${slot}" of actor ${actorId} twice`);
    }
    slots.add(key);
    equipment.push({ actorId, slot, itemId });
  });
  return { nextId, items, equipment, gold: ledgerInteger(record.gold, "inventory.gold", 0) };
}

function projectWorld(section: WorldSection): LedgerWorld {
  const record = ledgerRecord(section, "world");
  const raw = record.movement === undefined ? {} : ledgerRecord(record.movement, "world.movement");
  const setting = (field: "walking" | "pushing"): number | null => {
    const value = raw[field];
    if (value === undefined || value === null) return null;
    const number = ledgerInteger(value, `world.movement.${field}`, 0);
    if (number > 1) failLedger(LEDGER_SHAPE, `world.movement.${field}`, "expected 0 or 1");
    return number;
  };
  const movement = { walking: setting("walking"), pushing: setting("pushing") };
  if (!Object.hasOwn(record, "board")) return { movement, board: { state: "absent" } };
  if (record.board === null) return { movement, board: { state: "null" } };
  return { movement, board: { state: "present", value: projectBoard(record.board) } };
}

function projectBoard(value: unknown): LedgerBoard {
  const path = "world.board";
  const board = ledgerRecord(value, path);
  const key = ledgerText(board.key, `${path}.key`);
  if (key === "") failLedger(LEDGER_BOARD, `${path}.key`, "expected the current board's asset key");
  const rawItems = ledgerList(
    board.rawItems ?? failLedger(LEDGER_BOARD, `${path}.rawItems`, "is required: the authored slot table is the item authority"),
    `${path}.rawItems`,
  ).map((entry, index) => projectRawItem(entry, `${path}.rawItems[${index}]`));
  if (board.items !== undefined) projectCompactItems(board.items, rawItems, `${path}.items`);
  return {
    key,
    sizeX: ledgerInteger(board.sizeX, `${path}.sizeX`, 1),
    sizeY: ledgerInteger(board.sizeY, `${path}.sizeY`, 1),
    sizeL: ledgerInteger(board.sizeL, `${path}.sizeL`, 1),
    ambient: projectTint(board.ambient, `${path}.ambient`),
    vectors: board.vectors === undefined
      ? []
      : ledgerList(board.vectors, `${path}.vectors`).map((entry, index) => projectBoardVector(entry, `${path}.vectors[${index}]`)),
    programs: board.programs === undefined
      ? []
      : ledgerList(board.programs, `${path}.programs`).map((entry, index) => projectBoardProgram(entry, `${path}.programs[${index}]`)),
    rawItems,
    runtime: board.runtime === undefined
      ? { state: "absent" }
      : { state: "present", value: projectBoardRuntime(board.runtime, `${path}.runtime`) },
  };
}

/**
 * The compact `items` view is derived from the authored slots, so it must agree
 * with `rawItems.filter(itemFile !== "")` exactly; a mismatch is a real
 * identity/source conflict, not two authorities to choose between.
 */
function projectCompactItems(value: unknown, rawItems: readonly LedgerRawItem[], path: string): void {
  const compact = ledgerList(value, path);
  const authored = rawItems.filter((item) => item.itemFile !== "");
  if (compact.length !== authored.length) {
    failLedger(LEDGER_BOARD, path, `holds ${compact.length} item(s), but the authored slots hold ${authored.length}`);
  }
  compact.forEach((entry, index) => {
    const item = projectRawItem(entry, `${path}[${index}]`);
    const source = authored[index]!;
    if (!sameRawItem(item, source)) {
      failLedger(LEDGER_BOARD, `${path}[${index}]`, `disagrees with authored slot ${source.slot}`);
    }
  });
}

function sameRawItem(a: LedgerRawItem, b: LedgerRawItem): boolean {
  return a.slot === b.slot
    && a.itemFile === b.itemFile
    && a.activationPrg === b.activationPrg
    && a.multitaskPrg === b.multitaskPrg
    && a.initialVar === b.initialVar
    && a.initialValue === b.initialValue
    && a.finalVar === b.finalVar
    && a.finalValue === b.finalValue
    && a.loadingVar === b.loadingVar
    && a.loadingValue === b.loadingValue
    && a.activate === b.activate
    && a.activationType === b.activationType
    && a.x === b.x
    && a.y === b.y
    && a.layer === b.layer
    && a.reserved === b.reserved;
}

function projectRawItem(value: unknown, path: string): LedgerRawItem {
  const item = ledgerRecord(value, path);
  return {
    slot: ledgerInteger(item.slot, `${path}.slot`, 0),
    itemFile: ledgerText(item.itemFile, `${path}.itemFile`),
    activationPrg: ledgerText(item.activationPrg, `${path}.activationPrg`),
    multitaskPrg: ledgerText(item.multitaskPrg, `${path}.multitaskPrg`),
    initialVar: ledgerText(item.initialVar, `${path}.initialVar`),
    initialValue: ledgerText(item.initialValue, `${path}.initialValue`),
    finalVar: ledgerText(item.finalVar, `${path}.finalVar`),
    finalValue: ledgerText(item.finalValue, `${path}.finalValue`),
    loadingVar: ledgerText(item.loadingVar, `${path}.loadingVar`),
    loadingValue: ledgerText(item.loadingValue, `${path}.loadingValue`),
    activate: ledgerInteger(item.activate, `${path}.activate`, 0),
    activationType: ledgerInteger(item.activationType, `${path}.activationType`, 0),
    x: ledgerNumber(item.x, `${path}.x`),
    y: ledgerNumber(item.y, `${path}.y`),
    layer: ledgerNumber(item.layer, `${path}.layer`),
    reserved: ledgerInteger(item.reserved, `${path}.reserved`, -32768),
  };
}

function projectBoardVector(value: unknown, path: string): LedgerBoardVector {
  const vector = ledgerRecord(value, path);
  return {
    points: ledgerList(vector.points, `${path}.points`).map((entry, index) => ledgerPoint(entry, `${path}.points[${index}]`)),
    attributes: ledgerInteger(vector.attributes, `${path}.attributes`, 0),
    closed: ledgerInteger(vector.closed, `${path}.closed`, 0),
    layer: ledgerInteger(vector.layer, `${path}.layer`, 0),
    type: ledgerInteger(vector.type, `${path}.type`, 0),
    handle: ledgerText(vector.handle, `${path}.handle`),
  };
}

function projectBoardProgram(value: unknown, path: string): LedgerBoardProgram {
  const program = ledgerRecord(value, path);
  return {
    program: ledgerText(program.program, `${path}.program`),
    graphic: ledgerText(program.graphic, `${path}.graphic`),
    initialVar: ledgerText(program.initialVar, `${path}.initialVar`),
    initialValue: ledgerText(program.initialValue, `${path}.initialValue`),
    finalVar: ledgerText(program.finalVar, `${path}.finalVar`),
    finalValue: ledgerText(program.finalValue, `${path}.finalValue`),
    activate: ledgerInteger(program.activate, `${path}.activate`, 0),
    activationType: ledgerInteger(program.activationType, `${path}.activationType`, 0),
    repeatDistance: ledgerNumber(program.repeatDistance, `${path}.repeatDistance`),
    layer: ledgerInteger(program.layer, `${path}.layer`, 0),
    points: ledgerList(program.points, `${path}.points`).map((entry, index) => ledgerPoint(entry, `${path}.points[${index}]`)),
    closed: ledgerInteger(program.closed, `${path}.closed`, 0),
    handle: ledgerText(program.handle, `${path}.handle`),
  };
}

function projectBoardRuntime(value: unknown, path: string): LedgerBoardRuntime {
  const runtime = ledgerRecord(value, path);
  const tileEdits: LedgerTileEdit[] = [];
  ledgerList(runtime.tileEdits, `${path}.tileEdits`).forEach((entry, index) => {
    const editPath = `${path}.tileEdits[${index}]`;
    const edit = ledgerRecord(entry, editPath);
    const scope = edit.scope;
    if (scope !== "board" && scope !== "program") {
      failLedger(LEDGER_SHAPE, `${editPath}.scope`, "expected \"board\" or \"program\"");
    }
    // A program-scope edit names a live owner thread and expires with it, so it
    // is continuation, not durable board progress. Its `previous` is excluded for
    // every edit for the same reason: expiry rewrites it.
    if (scope !== "board") return;
    tileEdits.push({
      index: ledgerInteger(edit.index, `${editPath}.index`, 0),
      tile: projectTile(edit.tile, `${editPath}.tile`),
      scope,
      owner: edit.owner === undefined ? null : ledgerInteger(edit.owner, `${editPath}.owner`, 1),
    });
  });
  return {
    tileEdits,
    tileTypes: ledgerList(runtime.tileTypes, `${path}.tileTypes`)
      .map((entry, index) => ledgerText(entry, `${path}.tileTypes[${index}]`)),
  };
}

function projectTint(value: unknown, path: string): LedgerTint {
  const tint = ledgerRecord(value, path);
  return {
    r: ledgerNumber(tint.r, `${path}.r`),
    g: ledgerNumber(tint.g, `${path}.g`),
    b: ledgerNumber(tint.b, `${path}.b`),
  };
}

function projectTile(value: unknown, path: string): LedgerTile | null {
  if (value === null) return null;
  const tile = ledgerRecord(value, path);
  const animation = tile.animation === undefined
    ? null
    : projectTileAnimation(tile.animation, `${path}.animation`);
  return {
    asset: ledgerText(tile.asset, `${path}.asset`),
    tile: ledgerInteger(tile.tile, `${path}.tile`, 0),
    nativeWidth: optionalNumber(tile, "nativeWidth", path),
    nativeHeight: optionalNumber(tile, "nativeHeight", path),
    width: optionalNumber(tile, "width", path),
    height: optionalNumber(tile, "height", path),
    tint: tile.tint === undefined ? null : projectTint(tile.tint, `${path}.tint`),
    animation,
  };
}

function projectTileAnimation(value: unknown, path: string): { ticksPerFrame: number; frames: LedgerTile[] } {
  const animation = ledgerRecord(value, path);
  return {
    ticksPerFrame: ledgerInteger(animation.ticksPerFrame, `${path}.ticksPerFrame`, 0),
    frames: ledgerList(animation.frames, `${path}.frames`).map((entry, index) => {
      const tile = projectTile(entry, `${path}.frames[${index}]`);
      if (tile === null) failLedger(LEDGER_SHAPE, `${path}.frames[${index}]`, "expected a tile, not null");
      return tile;
    }),
  };
}

function optionalNumber(record: { readonly [key: string]: unknown }, key: string, path: string): number | null {
  return record[key] === undefined ? null : ledgerNumber(record[key], `${path}.${key}`);
}

function projectSprites(section: SpritesSection, board: LedgerBoard | null): LedgerSprites {
  const record = ledgerRecord(section, "sprites");
  const rawItems = board === null ? null : board.rawItems;
  const players = ledgerList(record.players, "sprites.players")
    .map((entry, index) => projectSprite(entry, `sprites.players[${index}]`, "player", rawItems));
  const itemHandles = new Set<number>();
  const items = ledgerList(record.items, "sprites.items")
    .map((entry, index) => projectSprite(entry, `sprites.items[${index}]`, "item", rawItems, itemHandles));
  const selectedPlayer = record.selectedPlayer === null
    ? null
    : ledgerText(record.selectedPlayer, "sprites.selectedPlayer");
  if (selectedPlayer !== null) {
    const matches = players.filter((player) => player.id === selectedPlayer).length;
    if (matches !== 1) {
      failLedger(LEDGER_REFERENCE, "sprites.selectedPlayer", `names ${matches} player(s) instead of exactly one`);
    }
  }
  const nextItemHandle = ledgerInteger(record.nextItemHandle, "sprites.nextItemHandle", 0);
  for (const item of items) {
    if (item.handle !== null && item.handle >= nextItemHandle) {
      failLedger(LEDGER_IDENTITY, "sprites.nextItemHandle", `must be above item handle ${item.handle}`);
    }
  }
  const randomEncounter: LedgerPresence<LedgerRandomEncounter> = !Object.hasOwn(record, "randomEncounter")
    ? { state: "absent" }
    : record.randomEncounter === null
      ? { state: "null" }
      : {
          state: "present",
          value: projectEncounter(record.randomEncounter, "sprites.randomEncounter"),
        };
  return { players, items, selectedPlayer, nextItemHandle, randomEncounter };
}

function projectSprite(
  value: unknown,
  path: string,
  kind: "player" | "item",
  rawItems: readonly LedgerRawItem[] | null,
  handles?: Set<number>,
): LedgerSprite {
  const sprite = ledgerRecord(value, path);
  const id = ledgerText(sprite.id, `${path}.id`);
  if (id === "") failLedger(LEDGER_SHAPE, `${path}.id`, "expected a non-empty sprite id");
  if (sprite.kind !== kind) failLedger(LEDGER_IDENTITY, `${path}.kind`, `expected a "${kind}" sprite`);
  // The category-local index is stable identity, not the array position: a
  // destroyed actor's sprite is filtered out of `players` without reindexing the
  // survivors, so the saved index is projected as saved.
  const index = ledgerInteger(sprite.index, `${path}.index`, 0);
  const actorId: LedgerPresence<number> = !Object.hasOwn(sprite, "actorId")
    ? { state: "absent" }
    : sprite.actorId === null
      ? { state: "null" }
      : { state: "present", value: ledgerInteger(sprite.actorId, `${path}.actorId`, 1) };
  const source = ledgerText(sprite.source, `${path}.source`);
  if (source === "") failLedger(LEDGER_SHAPE, `${path}.source`, "expected a non-empty asset reference");
  const facing = ledgerText(sprite.facing, `${path}.facing`);
  if (!FACING.includes(facing as Facing)) failLedger(LEDGER_SHAPE, `${path}.facing`, `expected one of ${FACING.join(", ")}`);
  const handle = sprite.handle === null ? null : ledgerInteger(sprite.handle, `${path}.handle`, 0);
  const sourceSlot = sprite.sourceSlot === null ? null : ledgerInteger(sprite.sourceSlot, `${path}.sourceSlot`, 0);
  if (kind === "player") {
    if (handle !== null) failLedger(LEDGER_IDENTITY, `${path}.handle`, "a player has no compact item handle");
    if (sourceSlot !== null) failLedger(LEDGER_IDENTITY, `${path}.sourceSlot`, "a player has no authored board slot");
  } else {
    if (handle === null) failLedger(LEDGER_IDENTITY, `${path}.handle`, "an item sprite names its compact item handle");
    if (sourceSlot === null) failLedger(LEDGER_IDENTITY, `${path}.sourceSlot`, "an item sprite names its authored board slot");
    if (handles !== undefined) {
      if (handles.has(handle)) failLedger(LEDGER_IDENTITY, `${path}.handle`, `item handle ${handle} is used twice`);
      handles.add(handle);
    }
    if (rawItems === null) {
      failLedger(LEDGER_BOARD, `${path}.sourceSlot`, "names a board slot, but the candidate holds no board");
    }
    const slot = rawItems[sourceSlot];
    if (slot === undefined) {
      failLedger(LEDGER_BOARD, `${path}.sourceSlot`, `names authored slot ${sourceSlot}, which the board does not hold`);
    }
    if (slot.itemFile !== source) {
      failLedger(LEDGER_BOARD, `${path}.sourceSlot`, `names authored slot ${sourceSlot} ("${slot.itemFile}"), not "${source}"`);
    }
  }
  return {
    id,
    kind,
    actorId,
    index,
    handle,
    sourceSlot,
    source,
    x: ledgerNumber(sprite.x, `${path}.x`),
    y: ledgerNumber(sprite.y, `${path}.y`),
    layer: ledgerNumber(sprite.layer, `${path}.layer`),
    facing: facing as Facing,
    visible: ledgerFlag(sprite.visible, `${path}.visible`),
    controlled: ledgerFlag(sprite.controlled, `${path}.controlled`),
    speed: ledgerNumber(sprite.speed, `${path}.speed`),
    idleTime: ledgerNumber(sprite.idleTime, `${path}.idleTime`),
    collisionBase: projectSpriteBase(sprite.collisionBase, `${path}.collisionBase`),
    activationBase: projectSpriteBase(sprite.activationBase, `${path}.activationBase`),
    visual: projectSpriteVisual(sprite.visual, `${path}.visual`),
    multitaskProgram: sprite.multitaskProgram === null
      ? null
      : ledgerText(sprite.multitaskProgram, `${path}.multitaskProgram`),
  };
}

function projectSpriteBase(value: unknown, path: string): LedgerSpriteBase {
  const base = ledgerRecord(value, path);
  return {
    points: ledgerList(base.points, `${path}.points`).map((entry, index) => ledgerPoint(entry, `${path}.points[${index}]`)),
  };
}

function projectSpriteVisual(value: unknown, path: string): LedgerSpriteVisual {
  const visual = ledgerRecord(value, path);
  const custom = ledgerList(visual.custom, `${path}.custom`).map((entry, index) => {
    const stancePath = `${path}.custom[${index}]`;
    const stance = ledgerRecord(entry, stancePath);
    return {
      animation: ledgerText(stance.animation, `${stancePath}.animation`),
      handle: ledgerText(stance.handle, `${stancePath}.handle`),
    };
  });
  return {
    movement: ledgerList(visual.movement, `${path}.movement`)
      .map((entry, index) => ledgerText(entry, `${path}.movement[${index}]`)),
    idle: ledgerList(visual.idle, `${path}.idle`).map((entry, index) => ledgerText(entry, `${path}.idle[${index}]`)),
    battle: ledgerList(visual.battle, `${path}.battle`)
      .map((entry, index) => ledgerText(entry, `${path}.battle[${index}]`)),
    custom,
    animation: visual.animation === null ? null : ledgerText(visual.animation, `${path}.animation`),
    file: visual.file === null ? null : ledgerText(visual.file, `${path}.file`),
    stance: visual.stance === null ? null : ledgerText(visual.stance, `${path}.stance`),
  };
}

/**
 * Encounter progress names the battle-enabled board that recorded it, which can
 * be a board the candidate has already left: the engine resets the record only
 * when the selected player next enters an eligible board. The saved name is
 * therefore progress, not a relationship to check against the current board.
 */
function projectEncounter(value: unknown, path: string): LedgerRandomEncounter {
  const encounter = ledgerRecord(value, path);
  return {
    boardKey: ledgerText(encounter.boardKey, `${path}.boardKey`),
    tile: ledgerPoint(encounter.tile, `${path}.tile`),
    tiles: ledgerInteger(encounter.tiles, `${path}.tiles`, 0),
  };
}

/**
 * Trigger progress belongs to the board named by `triggers.boardKey`, which the
 * next trigger phase re-points at the current board along with a fresh progress
 * set. A candidate captured before that reset keeps the prior board's name, so
 * the saved name is projected as saved rather than checked against the board.
 */
function projectTriggers(section: TriggersSection): LedgerTriggers {
  const record = ledgerRecord(section, "triggers");
  const key = record.boardKey === null ? null : ledgerText(record.boardKey, "triggers.boardKey");
  const firedRecord = ledgerRecord(record.fired, "triggers.fired");
  const fired: { [key: string]: boolean } = {};
  for (const name of Object.keys(firedRecord)) setField(fired, name, ledgerFlag(firedRecord[name], `triggers.fired.${name}`));
  const repeatRecord = ledgerRecord(record.repeat, "triggers.repeat");
  const repeat: { [key: string]: number } = {};
  for (const name of Object.keys(repeatRecord)) setField(repeat, name, ledgerNumber(repeatRecord[name], `triggers.repeat.${name}`));
  const deactivation = record.deactivateAt === null ? null : ledgerRecord(record.deactivateAt, "triggers.deactivateAt");
  const deactivateAt = deactivation === null ? null : {
    ...ledgerPoint(deactivation, "triggers.deactivateAt"),
    layer: ledgerNumber(deactivation.layer, "triggers.deactivateAt.layer"),
  };
  return {
    boardKey: key,
    fired,
    repeat,
    suppressed: ledgerList(record.suppressed, "triggers.suppressed")
      .map((entry, index) => ledgerText(entry, `triggers.suppressed[${index}]`)),
    deactivated: ledgerList(record.deactivated, "triggers.deactivated")
      .map((entry, index) => ledgerText(entry, `triggers.deactivated[${index}]`)),
    deactivateAt,
  };
}

function projectRng(rng: RngState): LedgerRng {
  const record = ledgerRecord(rng, "rng");
  return {
    s0: ledgerNumber(record.s0, "rng.s0"),
    s1: ledgerNumber(record.s1, "rng.s1"),
    s2: ledgerNumber(record.s2, "rng.s2"),
    s3: ledgerNumber(record.s3, "rng.s3"),
  };
}

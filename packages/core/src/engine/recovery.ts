import { actorId } from "../actors/model.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import type { Value } from "../ports/value.ts";
import type { GameState } from "../save/state.ts";
import type {
  GameLedgerV1,
  LedgerBoard,
  LedgerProgramRef,
  LedgerSprite,
  LedgerTile,
  LedgerValue,
} from "../save/ledger.ts";
import { actorFromSource, createSpritesSection, type SpriteActor, type SpriteActorSource } from "../sprites/model.ts";
import { hydrateSprites } from "../sprites/runtime.ts";
import type { ObjectRecord } from "../script/state.ts";
import type { ProgramRef } from "../script/program.ts";
import type { WorldBoard, WorldItem, WorldTile } from "../world/model.ts";

function copyRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(source)) Object.defineProperty(result, key, { value: source[key], writable: true, enumerable: true, configurable: true });
  return result;
}

function setRecord<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function restoreProgramRef(ref: LedgerProgramRef): ProgramRef {
  const common = {
    ir: ref.ir,
    ...(ref.includes.length === 0 ? {} : { includes: [...ref.includes] }),
    ...(ref.redirects.length === 0 ? {} : { redirects: ref.redirects.map(([from, to]) => [from, to] as [string, string]) }),
    ...(ref.dialect === null ? {} : { dialect: ref.dialect }),
    ...(ref.owner === null ? {} : { owner: ref.owner }),
  };
  return ref.kind === "file"
    ? { kind: "file", path: ref.path, sourceHash: ref.sourceHash, ...common }
    : { kind: "inline", text: ref.text, ...common };
}

function restoreValue(value: LedgerValue, handles: ReadonlyMap<number, number>, cells: ReadonlyMap<string, string>): Value {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if ("t" in value) {
    if (value.t === "nan") return Number.NaN;
    if (value.t === "inf") return Number.POSITIVE_INFINITY;
    return Number.NEGATIVE_INFINITY;
  }
  if ("kind" in value && value.kind === "object") {
    const handle = handles.get(value.handle);
    if (handle === undefined) throw new Error(`recovery graph object ${value.handle} was not allocated`);
    return { kind: "object", handle, className: value.className };
  }
  if ("type" in value && value.type === "callable") {
    const captures = value.captures.map((id) => {
      if (id === "") return id;
      const restored = cells.get(id);
      if (restored === undefined) throw new Error(`recovery graph cell ${id} was not allocated`);
      return restored;
    });
    let receiver: string | null = null;
    if (value.receiver !== null) {
      const handle = handles.get(Number(value.receiver));
      if (handle === undefined) throw new Error(`recovery graph receiver ${value.receiver} was not allocated`);
      receiver = String(handle);
    }
    const def =
      value.owner !== null && value.owner !== "" && value.def.startsWith("<inline>#")
        ? `<package:${value.owner}>#${value.def.slice("<inline>#".length)}`
        : value.def;
    return {
      type: "callable",
      def,
      captures,
      receiver,
      ...(value.owner === null ? {} : { owner: value.owner }),
    };
  }
  throw new Error("recovery graph contains an invalid script value");
}

function restorePersistentGraph(state: GameState, ledger: GameLedgerV1, listenerHandles: ReadonlyMap<number, number>): void {
  const vm = state.vm;
  const graph = ledger.script.persistentGraph;
  const handles = new Map<number, number>();
  let nextHandle = vm.objects.reduce((maximum, object) => Math.max(maximum, object.handle), 0);
  const claimHandle = (savedHandle: number, target: number, reason: string): void => {
    const previous = handles.get(savedHandle);
    if (previous !== undefined && previous !== target) throw new Error(`${reason} has conflicting startup bindings`);
    for (const [other, handle] of handles) {
      if (other !== savedHandle && handle === target) throw new Error(`${reason} aliases distinct saved objects`);
    }
    handles.set(savedHandle, target);
  };
  for (const [key, savedHandle] of Object.entries(ledger.script.emitters)) {
    const existing = state.events.emitters?.[key];
    if (existing === undefined) continue;
    claimHandle(savedHandle, existing, `recovery emitter ${key}`);
  }
  for (const [savedHandle, target] of listenerHandles) {
    if (vm.objects.every((object) => object.handle !== target)) {
      throw new Error(`recovery listener target ${savedHandle} names no live startup object`);
    }
    claimHandle(savedHandle, target, `recovery listener target ${savedHandle}`);
  }
  for (const object of graph.objects) if (!handles.has(object.handle)) handles.set(object.handle, ++nextHandle);

  const cells = new Map<string, string>();
  const savedCells = graph.cells.state === "present" ? graph.cells.value : null;
  let cellSequence = Math.max(vm.cellSeq ?? 0, savedCells?.seq ?? 0);
  if (savedCells !== null) {
    const ids = Object.keys(savedCells.values).sort((left, right) => Number(left.slice(4)) - Number(right.slice(4)));
    for (const id of ids) cells.set(id, `cell${++cellSequence}`);
  }

  if (savedCells !== null) {
    const values = copyRecord(vm.cells ?? {});
    for (const [id, value] of Object.entries(savedCells.values)) {
      const restored = cells.get(id);
      if (restored === undefined) throw new Error(`recovery graph cell ${id} was not allocated`);
      setRecord(values, restored, restoreValue(value, handles, cells));
    }
    vm.cells = values;
    vm.cellSeq = cellSequence;
  }

  for (const object of graph.objects) {
    const members: Record<string, Value> = {};
    for (const key of object.keys) setRecord(members, key, restoreValue(object.members[key]!, handles, cells));
    const record: ObjectRecord = {
      handle: handles.get(object.handle)!,
      className: object.className,
      program: object.program === null ? null : restoreProgramRef(object.program),
      members,
      keys: [...object.keys],
      ...(object.hostType.state === "present" ? { hostType: object.hostType.value } : {}),
    };
    const existing = vm.objects.find((candidate) => candidate.handle === record.handle);
    if (existing === undefined) vm.objects.push(record);
    else {
      if (existing.className !== record.className || existing.hostType !== record.hostType) {
        throw new Error(`recovery object ${object.handle} conflicts with its startup emitter`);
      }
      Object.assign(existing, record);
    }
  }

  const globals = copyRecord(vm.globals);
  for (const [name, value] of Object.entries(ledger.script.globals)) setRecord(globals, name, restoreValue(value, handles, cells));
  vm.globals = globals;
  vm.redirects = ledger.script.redirects.map(([from, to]) => [from, to]);

  const savedDefOwners = graph.defOwners.state === "present" ? graph.defOwners.value : null;
  if (savedDefOwners !== null) {
    const defOwners = copyRecord(vm.defOwners ?? {});
    for (const [definition, ref] of Object.entries(savedDefOwners)) {
      const restoredRef = restoreProgramRef(ref);
      const nextDef =
        restoredRef.kind === "inline" && restoredRef.owner !== undefined && definition.startsWith("<inline>#")
          ? `<package:${restoredRef.owner}>#${definition.slice("<inline>#".length)}`
          : definition;
      setRecord(defOwners, nextDef, restoredRef);
    }
    vm.defOwners = defOwners;
  }

  const emitters = copyRecord(state.events.emitters ?? {});
  for (const [key, handle] of Object.entries(ledger.script.emitters)) {
    const restored = handles.get(handle);
    if (restored === undefined) throw new Error(`recovery emitter ${key} names an unallocated object`);
    if (!Object.hasOwn(emitters, key)) setRecord(emitters, key, restored);
  }
  state.events.emitters = emitters;
}

function restoreActors(state: GameState, ledger: GameLedgerV1): void {
  state.actors = {
    ...state.actors,
    nextId: ledger.actors.nextId,
    actors: ledger.actors.actors.map((actor) => ({
      id: actorId(actor.id),
      kind: actor.kind,
      source: actor.source,
      name: actor.name,
      stats: { ...actor.stats },
      statuses: copyRecord(actor.statuses),
      equipment: { equipped: [...actor.equipment.equipped], bonuses: { ...actor.equipment.bonuses } },
      progression: { ...actor.progression },
      behaviour: actor.behaviour,
      customEvents: [...actor.customEvents],
    })),
  };
}

function restoreTriggers(state: GameState, ledger: GameLedgerV1): void {
  const triggers = state.triggers;
  triggers.boardKey = ledger.triggers.boardKey;
  triggers.fired = copyRecord(ledger.triggers.fired);
  triggers.repeat = copyRecord(ledger.triggers.repeat);
  triggers.suppressed = [...ledger.triggers.suppressed];
  triggers.deactivated = [...ledger.triggers.deactivated];
  triggers.deactivateAt = ledger.triggers.deactivateAt === null ? null : { ...ledger.triggers.deactivateAt };
  triggers.active = null;
  triggers.lastKeySeq = 0;
  triggers.silentUntilIdle = false;
}

/** Restore durable ledger fields into a private startup-state copy before loading its saved board. */
export function applyRecoveryLedger(
  state: GameState,
  ledger: GameLedgerV1,
  movementDefaults: { readonly walking: number; readonly pushing: number },
  listenerHandles: ReadonlyMap<number, number> = new Map(),
): void {
  state.world = {
    ...state.world,
    movement: {
      walking: ledger.world.movement.walking ?? movementDefaults.walking,
      pushing: ledger.world.movement.pushing ?? movementDefaults.pushing,
    },
  };
  state.party = {
    ...state.party,
    members: [...ledger.party.members],
    selected: ledger.party.selected,
    steps: ledger.party.steps,
    stepRemainder: ledger.party.stepRemainder,
  };
  restoreActors(state, ledger);
  state.inventory = {
    ...state.inventory,
    nextId: ledger.inventory.nextId,
    items: ledger.inventory.items.map((item) => ({ ...item })),
    equipment: ledger.inventory.equipment.map((assignment) => ({ ...assignment })),
    gold: ledger.inventory.gold,
  };
  restorePersistentGraph(state, ledger, listenerHandles);
  restoreTriggers(state, ledger);
  state.rng = { ...ledger.rng };
  state.time.tick = ledger.time.tick;
}

function restoreWorldTile(tile: LedgerTile): WorldTile {
  return {
    asset: assetKey(tile.asset),
    tile: tile.tile,
    ...(tile.nativeWidth === null ? {} : { nativeWidth: tile.nativeWidth }),
    ...(tile.nativeHeight === null ? {} : { nativeHeight: tile.nativeHeight }),
    ...(tile.width === null ? {} : { width: tile.width }),
    ...(tile.height === null ? {} : { height: tile.height }),
    ...(tile.tint === null ? {} : { tint: { ...tile.tint } }),
    ...(tile.animation === null ? {} : {
      animation: {
        ticksPerFrame: tile.animation.ticksPerFrame,
        frames: tile.animation.frames.map(restoreWorldTile),
      },
    }),
  };
}

function restoreBoardItem(item: LedgerBoard["rawItems"][number]): WorldItem {
  return { ...item };
}

function restoreBoard(authored: WorldBoard, saved: LedgerBoard): WorldBoard {
  if (authored.key !== saved.key || authored.sizeX !== saved.sizeX || authored.sizeY !== saved.sizeY || authored.sizeL !== saved.sizeL) {
    throw new Error("the saved board identity or dimensions do not match the authored board");
  }
  const rawItems = saved.rawItems.map(restoreBoardItem);
  const layers = authored.layers.map((layer) => ({ ...layer, tiles: [...layer.tiles] }));
  const tileEdits: NonNullable<WorldBoard["runtime"]>["tileEdits"] = [];
  let tileTypes = [...(authored.runtime?.tileTypes ?? [])];
  if (saved.runtime.state === "present") {
    tileTypes = [...saved.runtime.value.tileTypes];
    const layerArea = saved.sizeX * saved.sizeY;
    for (const edit of saved.runtime.value.tileEdits) {
      const layerIndex = Math.floor(edit.index / layerArea);
      const tileIndex = edit.index % layerArea;
      const layer = layers[layerIndex];
      if (layer === undefined || tileIndex < 0 || tileIndex >= layer.tiles.length) throw new Error(`saved board tile edit ${edit.index} is out of range`);
      const previous = layer.tiles[tileIndex] ?? null;
      const tile = edit.tile === null ? null : restoreWorldTile(edit.tile);
      layer.tiles[tileIndex] = tile;
      tileEdits.push({
        index: edit.index,
        tile,
        previous,
        scope: "board",
        ...(edit.owner === null ? {} : { owner: edit.owner }),
      });
    }
  } else if (saved.runtime.state === "null") {
    throw new Error("the saved board runtime cannot be null");
  }
  return {
    ...authored,
    ambient: { ...saved.ambient },
    ...((saved as any).activeAmbient !== undefined ? { activeAmbient: { ...(saved as any).activeAmbient } } : {}),
    vectors: saved.vectors.map((vector) => ({ ...vector, points: vector.points.map((point) => ({ ...point })) })),
    programs: saved.programs.map((program) => ({ ...program, points: program.points.map((point) => ({ ...point })) })),
    rawItems,
    items: rawItems.filter((item) => item.itemFile !== ""),
    layers,
    runtime: { tileEdits, tileTypes },
  };
}

function spriteSource(sprite: LedgerSprite, board: WorldBoard): SpriteActorSource {
  const actorLink = sprite.actorId.state === "present"
    ? { actorId: actorId(sprite.actorId.value) }
    : sprite.actorId.state === "null" ? { actorId: null } : {};
  const item = sprite.kind === "item"
    ? board.items?.find((candidate) => candidate.slot === sprite.sourceSlot) ?? board.rawItems?.find((candidate) => candidate.slot === sprite.sourceSlot)
    : undefined;
  return {
    id: sprite.id,
    kind: sprite.kind,
    source: sprite.source,
    x: sprite.x,
    y: sprite.y,
    layer: sprite.layer,
    facing: sprite.facing,
    visible: sprite.visible,
    controlled: sprite.controlled,
    ...(sprite.sourceSlot === null ? {} : { sourceSlot: sprite.sourceSlot }),
    ...(sprite.handle === null ? {} : { handle: sprite.handle }),
    ...actorLink,
    ...(item === undefined ? {} : { boardItem: item }),
  };
}

function restoreSprite(base: SpriteActor, sprite: LedgerSprite): SpriteActor {
  const { actorId: discardedActorId, ...withoutActorId } = base;
  void discardedActorId;
  const actorLink = sprite.actorId.state === "present"
    ? { actorId: actorId(sprite.actorId.value) }
    : sprite.actorId.state === "null" ? { actorId: null } : {};
  return {
    ...withoutActorId,
    ...actorLink,
    id: sprite.id,
    kind: sprite.kind,
    index: sprite.index,
    handle: sprite.handle,
    sourceSlot: sprite.sourceSlot,
    source: sprite.source,
    x: sprite.x,
    y: sprite.y,
    layer: sprite.layer,
    facing: sprite.facing,
    state: sprite.visible ? "waiting" : "hidden",
    visible: sprite.visible,
    controlled: sprite.controlled,
    speed: sprite.speed,
    idleTime: sprite.idleTime,
    collisionBase: { points: sprite.collisionBase.points.map((point) => ({ ...point })) },
    activationBase: { points: sprite.activationBase.points.map((point) => ({ ...point })) },
    visual: {
      ...base.visual,
      movement: [...sprite.visual.movement],
      idle: [...sprite.visual.idle],
      battle: [...sprite.visual.battle],
      custom: sprite.visual.custom.map((stance) => ({ ...stance })),
      animation: sprite.visual.animation,
      file: sprite.visual.file,
      stance: sprite.visual.stance,
    },
    queue: { moves: [], waypoint: null },
    movement: { active: null, waitTicks: 0, pendingExit: null, under: [], lastStepTick: null, lastStepDistance: 0 },
    prev: null,
    frozenUntil: null,
    multitaskProgram: sprite.multitaskProgram,
    multitaskThread: null,
  };
}

function variablesFromGlobals(globals: Readonly<Record<string, Value>>): Record<string, string | number | boolean> {
  const variables: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(globals)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") setRecord(variables, name, value);
  }
  return variables;
}

/** Install the rebuilt authored board and apply its durable ledger values without an arrive/reset path. */
export function installRecoveryBoard(state: GameState, authored: WorldBoard, ledger: GameLedgerV1): WorldBoard {
  const saved = ledger.world.board;
  if (saved.state !== "present") throw new Error("the recovery ledger has no board to install");
  const board = restoreBoard(authored, saved.value);
  const fresh = createSpritesSection();
  const players = ledger.sprites.players.map((sprite) => spriteSource(sprite, board));
  hydrateSprites({
    board,
    players,
    actors: state.actors,
    selectedPlayer: ledger.sprites.selectedPlayer,
    tick: ledger.time.tick,
    variables: variablesFromGlobals(state.vm.globals),
  }, fresh);
  const freshPlayers = new Map(fresh.players.map((player) => [player.id, player]));
  const freshItems = new Map(fresh.items.map((item) => [item.id, item]));
  state.sprites = fresh;
  state.sprites.players = ledger.sprites.players.map((sprite, index) => {
    const base = freshPlayers.get(sprite.id) ?? actorFromSource(spriteSource(sprite, board), board, index, null);
    return restoreSprite(base, sprite);
  });
  state.sprites.items = ledger.sprites.items.map((sprite, index) => {
    const base = freshItems.get(sprite.id) ?? actorFromSource(spriteSource(sprite, board), board, index, sprite.handle);
    return restoreSprite(base, sprite);
  });
  state.sprites.selectedPlayer = ledger.sprites.selectedPlayer;
  state.sprites.nextItemHandle = ledger.sprites.nextItemHandle;
  if (ledger.sprites.randomEncounter.state === "absent") delete state.sprites.randomEncounter;
  else if (ledger.sprites.randomEncounter.state === "null") state.sprites.randomEncounter = null;
  else state.sprites.randomEncounter = {
    boardKey: ledger.sprites.randomEncounter.value.boardKey,
    tile: { ...ledger.sprites.randomEncounter.value.tile },
    tiles: ledger.sprites.randomEncounter.value.tiles,
  };
  state.world = { ...state.world, board };
  return board;
}



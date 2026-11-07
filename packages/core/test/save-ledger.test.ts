// The game ledger and its domain-separated hash
// (docs/spec/formats/save-game.md#game-ledger-and-savable-continuation): the
// projection keeps exactly the game-owned progress fields, the persistent-root
// walker keeps the reached object/cell graph with live identity, ordinary
// saves keep the whole continuation, and the hash is FNV-1a over the versioned
// envelope rather than `hashGameState`.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  actorId,
  addActor,
  assetKey,
  boardEmitterKey,
  canon,
  createGameState,
  expireProgramTileEdits,
  fnv1a64,
  GameLedgerError,
  GAME_LEDGER_DOMAIN,
  GAME_LEDGER_VERSION,
  hashGameLedger,
  hashGameState,
  hashState,
  projectGameLedger,
  removeActorSprite,
  restoreGameState,
  snapshot,
  tagNonFinite,
  type CallableValue,
  type GameLedgerV1,
  type GameState,
  type LedgerValue,
  type ObjectRecord,
  type RefId,
  type SpriteActor,
  type Thread,
  type Value,
  type WorldBoard,
  type WorldItem,
  type WorldTile,
} from "../src/index.ts";

const BOARD_KEY = "start.brd";
const ITEM_FILE = "Items/chest.itm";

/** One authored board item slot, defaults included. */
function boardItem(slot: number, itemFile: string, x: number, y: number): WorldItem {
  return {
    slot,
    itemFile,
    activationPrg: "",
    multitaskPrg: "",
    initialVar: "",
    initialValue: "",
    finalVar: "",
    finalValue: "",
    loadingVar: "",
    loadingValue: "",
    activate: 0,
    activationType: 0,
    x,
    y,
    layer: 1,
    reserved: 0,
  };
}

/** A board tile value of the given tileset, so the durable-edit tests stay readable. */
function tile(asset: string, index: number): WorldTile {
  return { asset: assetKey(asset), tile: index };
}

function board(): WorldBoard {
  const rawItems = [
    boardItem(0, "", 0, 0),
    boardItem(1, ITEM_FILE, 64, 96),
    boardItem(2, ITEM_FILE, 128, 96),
  ];
  return {
    key: assetKey(BOARD_KEY),
    coordType: 0,
    sizeX: 8,
    sizeY: 6,
    sizeL: 1,
    width: 256,
    height: 192,
    background: { r: 0, g: 0, b: 0 },
    ambient: { r: 10, g: 20, b: 30 },
    layers: [{ tiles: [null] }],
    vectors: [{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], attributes: 1, closed: 0, layer: 1, type: 1, handle: "vector-1" }],
    programs: [{
      program: "Prg/step.prg",
      graphic: "",
      initialVar: "",
      initialValue: "",
      finalVar: "",
      finalValue: "",
      activate: 0,
      activationType: 0,
      repeatDistance: 32,
      layer: 1,
      points: [{ x: 5, y: 6 }],
      closed: 0,
      handle: "program-1",
    }],
    rawItems,
    items: rawItems.filter((item) => item.itemFile !== ""),
    images: [{ file: "Images/sign.img", left: 0, top: 0, layer: 1, drawType: 0, transparent: { r: 0, g: 0, b: 0 }, reserved: 0 }],
    runtime: {
      // The first edit is durable board progress; the second belongs to thread 1
      // and expires with it, so it is continuation.
      tileEdits: [
        { index: 0, tile: tile("Tiles/grass.tle", 4), previous: null, scope: "board" },
        { index: 1, tile: tile("Tiles/water.tle", 1), previous: null, scope: "program", owner: 1 },
      ],
      tileTypes: ["NORMAL", "WATER"],
    },
  };
}

function sprite(init: Partial<SpriteActor> & { readonly id: string; readonly kind: "player" | "item"; readonly index: number }): SpriteActor {
  return {
    handle: init.kind === "item" ? init.index : null,
    sourceSlot: init.kind === "item" ? init.index + 1 : null,
    source: init.id,
    x: 32,
    y: 32,
    layer: 1,
    facing: "S",
    state: "waiting",
    visible: true,
    controlled: false,
    speed: 0.05,
    idleTime: 0,
    collisionBase: { points: [{ x: 0, y: -15 }] },
    activationBase: { points: [{ x: 0, y: -24 }] },
    visual: {
      movement: [],
      idle: [],
      battle: [],
      custom: [],
      animation: null,
      file: null,
      stance: null,
      frame: 0,
      frameTicks: 0,
      idleTicks: 0,
      stanceHeld: false,
      stanceComplete: false,
    },
    queue: { moves: [], waypoint: null },
    movement: { active: null, waitTicks: 0, pendingExit: null, under: [], lastStepTick: null, lastStepDistance: 0 },
    prev: null,
    frozenUntil: null,
    multitaskProgram: null,
    multitaskThread: null,
    ...init,
  };
}

function callable(def: string, captures: string[] = [], receiver: string | null = null): CallableValue {
  return { type: "callable", def, captures, receiver };
}

function object(handle: number, className: string, members: Record<string, Value>, keys?: string[]): ObjectRecord {
  return {
    handle,
    className,
    program: className === "" ? null : { kind: "inline", text: "class " + className + "\nendClass\n", ir: "1" },
    members,
    keys: keys ?? Object.keys(members),
  };
}

/** A migrated, validated candidate with every ledger-bearing section populated. */
function fixture(): GameState {
  const state = createGameState({ seed: 7 });
  state.world = { ...state.world, board: board() };

  addActor(state.actors, { kind: "party", source: "Characters/hero.chr", name: "Hero" });
  addActor(state.actors, { kind: "enemy", source: "Characters/slime.chr", name: "Slime" });
  addActor(state.actors, { kind: "npc", source: "Characters/elder.chr", name: "Elder" });
  const hero = state.actors.actors[0]!;
  hero.stats.hp = 42;
  hero.stats.maxHp = 50;
  hero.statuses.poison = 2;
  hero.progression.remainingExperience = 9;
  hero.equipment.equipped.push("Items/sword.itm");
  hero.equipment.bonuses.dp = 3;
  hero.behaviour = "hero";
  hero.customEvents.push("talked");
  state.actors.actors[1]!.stats.hp = 5;
  state.party.members = [hero.id];
  state.party.selected = hero.id;
  state.party.steps = 12;

  state.inventory.nextId = 2;
  state.inventory.items = [{ id: 1, source: ITEM_FILE, handle: "0", quantity: 2 }];
  state.inventory.equipment = [{ actorId: hero.id, slot: "weapon", itemId: 1 }];
  state.inventory.gold = 50;

  state.sprites.players = [sprite({ id: "Characters/hero.chr", kind: "player", index: 0, actorId: hero.id, controlled: true })];
  state.sprites.items = [
    sprite({ id: ITEM_FILE, kind: "item", index: 0, sourceSlot: 1, x: 200, y: 32 }),
    sprite({ id: ITEM_FILE, kind: "item", index: 1, sourceSlot: 2, x: 128, y: 96 }),
  ];
  state.sprites.selectedPlayer = "Characters/hero.chr";
  state.sprites.nextItemHandle = 2;
  state.sprites.randomEncounter = { boardKey: BOARD_KEY, tile: { x: 1, y: 2 }, tiles: 5 };

  state.triggers.boardKey = BOARD_KEY;
  state.triggers.fired.door = true;
  state.triggers.repeat["step"] = 32;
  state.triggers.suppressed.push("shop");
  state.triggers.deactivated.push("arrival");
  state.triggers.deactivateAt = { x: 10, y: 20, layer: 1 };
  state.triggers.active = { key: "door", thread: 1, setVar: "opened", setValue: "1", source: "region", silentMovement: false };
  state.triggers.lastKeySeq = 4;
  state.triggers.silentUntilIdle = true;

  // Party is an object the globals keep; 9 and 7 are reachable only from a
  // listener and a frame local, so they stay out of the ledger graph.
  state.vm.globals = {
    party: { kind: "object", handle: 5, className: "Party" },
    count: 3,
    name: "hero",
    nothing: null,
    notANumber: Number.NaN,
    above: Number.POSITIVE_INFINITY,
    below: Number.NEGATIVE_INFINITY,
    loot: callable("loot", ["cell1", "cell4"], "5"),
  };
  state.vm.objects = [
    object(5, "Party", { gold: 10, self: { kind: "object", handle: 5, className: "Party" }, next: { kind: "object", handle: 6, className: "" } }, ["gold", "self", "next"]),
    object(9, "Loot", { dead: 1 }),
    object(6, "", { back: { kind: "object", handle: 5, className: "Party" } }),
    object(7, "Hidden", { value: 1 }),
  ];
  state.vm.cells = { cell1: 7, cell4: { kind: "object", handle: 6, className: "" } };
  state.vm.cellSeq = 6;
  state.vm.defOwners = {
    loot: { kind: "inline", text: "function loot()\nendFunction\n", ir: "1" },
    dead: { kind: "inline", text: "function dead()\nendFunction\n", ir: "1" },
  };
  state.vm.redirects = [["oldname", "newname"]];
  state.vm.effectSeq = 3;
  state.vm.messagesOff = true;
  const frame = {
    program: { kind: "inline" as const, text: "var secret\nend()\n", ir: "1" },
    ip: 2,
    locals: { secret: { value: { kind: "object" as const, handle: 7, className: "Hidden" }, ref: "local:secret" as RefId } },
    operands: [],
    errorHandler: null,
    autoLocal: false,
  };
  const thread: Thread = {
    id: 1,
    kind: "board",
    owner: "world",
    source: "board:" + BOARD_KEY,
    target: null,
    frames: [frame],
    status: "ready",
    wait: null,
    queue: [],
    pending: null,
    detached: [],
    collect: null,
  };
  state.vm.threads = [thread];
  state.events.nextListener = 2;
  state.events.listeners = [{ id: 1, emitter: "object:5", type: "hit", once: false, callable: callable("dead") }];
  state.events.dispatch = { emitter: "object:5", event: 5, order: [1], index: 0, thread: null };
  state.events.emitters = { [boardEmitterKey(BOARD_KEY)]: 5, "object:9": 9 };
  state.engine = { ...state.engine, nextBattleId: 4 };
  return state;
}

function projected(state: GameState = fixture()): GameLedgerV1 {
  return projectGameLedger(state);
}

function ledgerHash(state: GameState = fixture()): string {
  return hashGameLedger(projectGameLedger(state));
}

/** `assert.notEqual`, which the shared test declarations do not carry. */
function differs(actual: unknown, expected: unknown, message?: string): void {
  ok(actual !== expected, message);
}

function schemaOf(state: GameState): string {
  return canon(tagNonFinite(state) as never);
}

function failure(run: () => unknown): { code: string; path: string } {
  try {
    run();
  } catch (error) {
    ok(error instanceof GameLedgerError, "the projection fails with a GameLedgerError");
    return { code: error.code, path: error.path };
  }
  throw new Error("expected the projection to refuse the candidate");
}

/** Assert no `undefined` value or sparse hole reaches the projection (it must be plain data). */
function assertNoUndefined(value: unknown, path = "ledger"): void {
  if (value === undefined) throw new Error(`${path} is undefined`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUndefined(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) assertNoUndefined((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

test("the v1 projection maps exactly the accepted fields and keeps their order", () => {
  const state = fixture();
  const ledger = projected(state);

  deepEqual(ledger.party, { members: [1], selected: 1, steps: 12, stepRemainder: 0 });
  equal(ledger.actors.nextId, 4);
  equal(ledger.actors.actors.length, 3);
  deepEqual(ledger.actors.actors.map((actor) => actor.kind), ["party", "enemy", "npc"]);
  const hero = ledger.actors.actors[0]!;
  deepEqual(hero.stats, {
    experience: 0, hp: 42, maxHp: 50, dp: 0, fp: 0, smp: 0, maxSmp: 0, level: 0, criticalOn: -1, criticalBy: -1,
  });
  deepEqual(hero.statuses, { poison: 2 });
  deepEqual(hero.equipment, { equipped: ["Items/sword.itm"], bonuses: { hp: 0, dp: 3, fp: 0, smp: 0 } });
  equal(hero.progression.remainingExperience, 9);
  equal(hero.progression.legacyLevelUp, false);
  equal(hero.behaviour, "hero");
  deepEqual(hero.customEvents, ["talked"]);
  equal("version" in ledger.actors, false);
  equal("version" in hero, false);

  deepEqual(ledger.inventory, {
    nextId: 2,
    items: [{ id: 1, source: ITEM_FILE, handle: "0", quantity: 2 }],
    equipment: [{ actorId: 1, slot: "weapon", itemId: 1 }],
    gold: 50,
  });

  deepEqual(ledger.script.globals, {
    party: { kind: "object", handle: 5, className: "Party" },
    count: 3,
    name: "hero",
    nothing: null,
    notANumber: { t: "nan" },
    above: { t: "inf" },
    below: { t: "-inf" },
    loot: { type: "callable", def: "loot", captures: ["cell1", "cell4"], receiver: "5", owner: null },
  });
  deepEqual(ledger.script.redirects, [["oldname", "newname"]]);

  const graph = ledger.script.persistentGraph;
  // Reached objects in table order with live handles; 9 (listener-only) and 7
  // (frame-local-only) are not progress this ledger roots.
  deepEqual(graph.objects.map((entry) => entry.handle), [5, 6]);
  deepEqual(graph.objects[0]!.keys, ["gold", "self", "next"]);
  deepEqual(graph.objects[0]!.members.self, { kind: "object", handle: 5, className: "Party" });
  deepEqual(graph.objects[0]!.program, {
    kind: "inline",
    text: "class Party\nendClass\n",
    ir: "1",
    includes: [],
    redirects: [],
    dialect: null,
    owner: null,
  });
  deepEqual(graph.objects[1]!.program, null);
  deepEqual(graph.cells, { state: "present", value: { seq: 6, values: { cell1: 7, cell4: { kind: "object", handle: 6, className: "" } } } });
  deepEqual(Object.keys(graph.defOwners.state === "present" ? graph.defOwners.value : {}), ["loot"]);
  deepEqual(ledger.script.emitters, { [boardEmitterKey(BOARD_KEY)]: 5 });

  ok(ledger.world.board.state === "present");
  const current = ledger.world.board.value;
  equal(current.key, BOARD_KEY);
  equal(current.sizeX, 8);
  equal(current.ambient.r, 10);
  deepEqual(current.vectors[0]!.points, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  equal(current.programs[0]!.repeatDistance, 32);
  deepEqual(current.rawItems.map((item) => [item.slot, item.itemFile, item.x]), [[0, "", 0], [1, ITEM_FILE, 64], [2, ITEM_FILE, 128]]);
  ok(current.runtime.state === "present");
  // Only the durable board-scope edit survives; the program-scope one does not.
  deepEqual(current.runtime.value.tileEdits, [
    { index: 0, tile: { asset: "tiles/grass.tle", tile: 4, nativeWidth: null, nativeHeight: null, width: null, height: null, tint: null, animation: null }, scope: "board", owner: null },
  ]);
  deepEqual(current.runtime.value.tileTypes, ["NORMAL", "WATER"]);

  deepEqual(ledger.sprites.players.map((entry) => [entry.id, entry.index, entry.handle, entry.sourceSlot]), [["Characters/hero.chr", 0, null, null]]);
  deepEqual(ledger.sprites.items.map((entry) => [entry.id, entry.index, entry.handle, entry.sourceSlot, entry.x]), [
    [ITEM_FILE, 0, 0, 1, 200],
    [ITEM_FILE, 1, 1, 2, 128],
  ]);
  deepEqual(ledger.sprites.players[0]!.actorId, { state: "present", value: 1 });
  equal(ledger.sprites.selectedPlayer, "Characters/hero.chr");
  equal(ledger.sprites.nextItemHandle, 2);
  deepEqual(ledger.sprites.randomEncounter, { state: "present", value: { boardKey: BOARD_KEY, tile: { x: 1, y: 2 }, tiles: 5 } });

  deepEqual(ledger.triggers, {
    boardKey: BOARD_KEY,
    fired: { door: true },
    repeat: { step: 32 },
    suppressed: ["shop"],
    deactivated: ["arrival"],
    deactivateAt: { x: 10, y: 20, layer: 1 },
  });
  const raw = ledger as unknown as Record<string, unknown>;
  const triggers = raw.triggers as Record<string, unknown>;
  for (const key of ["active", "lastKeySeq", "silentUntilIdle", "version"]) equal(key in triggers, false);

  deepEqual(ledger.rng, state.rng);
  deepEqual(ledger.time, { tick: 0 });
  assertNoUndefined(ledger);
});

test("the projection is pure, repeatable and plain data", () => {
  const state = fixture();
  const before = schemaOf(state);
  const objects = state.vm.objects.length;
  const cells = Object.keys(state.vm.cells ?? {}).length;
  const first = projectGameLedger(state);
  const second = projectGameLedger(state);
  equal(schemaOf(state), before);
  equal(state.vm.objects.length, objects);
  equal(Object.keys(state.vm.cells ?? {}).length, cells);
  deepEqual(first, second);
  equal(hashGameLedger(first), hashGameLedger(second));
  // The projection survives the canonicalizer, so it is plain data.
  ok(canon(first as never).length > 0);
});

test("the ledger hash is the tagged envelope hash and not hashGameState", () => {
  const state = fixture();
  const ledger = projectGameLedger(state);
  equal(GAME_LEDGER_DOMAIN, "tkr.game-ledger");
  equal(GAME_LEDGER_VERSION, 4);
  equal(
    hashGameLedger(ledger),
    hashState({ domain: "tkr.game-ledger", version: 4, ledger } as never),
  );
  differs(hashGameLedger(ledger), hashGameState(state));
  const minimal = minimalLedger();
  equal(hashGameLedger(minimal), MINIMAL_LEDGER_HASH);
  // The pinned vector is FNV-1a over exactly this canonical envelope text, so
  // the domain, version and ledger are all covered.
  equal(
    MINIMAL_LEDGER_HASH,
    fnv1a64(canon({ domain: "tkr.game-ledger", version: 4, ledger: minimal } as never)),
  );
  // A different domain or version hashes differently even for the same ledger.
  differs(hashState({ domain: "tkr.game-ledger", version: 2, ledger } as never), hashGameLedger(ledger));
});

/** The smallest whole v1 ledger, used to pin the envelope vector. */
function minimalLedger(): GameLedgerV1 {
  return {
    party: { members: [], selected: null, steps: 0, stepRemainder: 0 },
    actors: { nextId: 1, actors: [] },
    inventory: { nextId: 1, items: [], equipment: [], gold: 0 },
    script: {
      globals: {},
      redirects: [],
      persistentGraph: { objects: [], cells: { state: "absent" }, defOwners: { state: "absent" } },
      emitters: {},
    },
    world: { movement: { walking: 0, pushing: 0 }, board: { state: "absent" } },
    sprites: { players: [], items: [], selectedPlayer: null, nextItemHandle: 0, randomEncounter: { state: "absent" } },
    triggers: { boardKey: null, fired: {}, repeat: {}, suppressed: [], deactivated: [], deactivateAt: null },
    rng: { s0: 1, s1: 2, s2: 3, s3: 4 },
    time: { tick: 0 },
  };
}

const MINIMAL_LEDGER_HASH = "1c0294691eabdcac";

test("each excluded continuation and metadata field changes the full save but not the ledger", () => {
  const baseline = ledgerHash();
  const fullSave = hashGameState(fixture());
  const exclusions: Array<[string, (state: GameState) => void]> = [
    ["thread frame local", (state) => { state.vm.threads[0]!.frames[0]!.locals.extra = { value: 5, ref: "local:extra" as RefId }; }],
    ["thread status", (state) => { state.vm.threads[0]!.status = "finished"; }],
    ["thread wait", (state) => { state.vm.threads[0]!.wait = { kind: "ticks", until: 9 } as never; }],
    ["thread queue", (state) => { state.vm.threads[0]!.queue.push({ text: "end()", file: "prg/a.prg", line: 1 }); }],
    ["vm files", (state) => { state.vm.files.push({ id: "f1", mode: "input", area: "files", path: "a", data: "", position: 0, loaded: true }); }],
    ["vm block", (state) => { state.vm.block = { thread: 1, kind: "global", since: 0 }; }],
    ["vm effect seq", (state) => { state.vm.effectSeq = 99; }],
    ["vm request seq", (state) => { state.vm.requestSeq = 7; }],
    ["vm messages off", (state) => { delete state.vm.messagesOff; }],
    ["event listener", (state) => { state.events.listeners.push({ id: 2, emitter: "game", type: "x", once: true, callable: callable("dead") }); }],
    ["event queue", (state) => { state.events.queue.push({ emitter: "object:5", event: 5 }); }],
    ["event dispatch", (state) => { state.events.dispatch = null; }],
    ["menu screens", (state) => { state.menu.screens.push({ screen: "items", actorId: null, selection: 2 }); }],
    ["menu graphic", (state) => { state.menu.graphic = "UI/menu.img"; }],
    ["battle", (state) => { state.battle = { ...state.battle, phase: "active" } as typeof state.battle; }],
    ["engine next battle", (state) => { state.engine = { ...state.engine, nextBattleId: 8 }; }],
    ["surface", (state) => { state.surfaces = { shots: [{ rev: 1 }] } as never; }],
    ["sprite state", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, state: "moving" }; }],
    ["sprite queue", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, queue: { moves: [{ source: "keyboard", target: { x: 1, y: 1 }, facing: "E" }], waypoint: null } }; }],
    ["sprite movement", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, movement: { active: null, waitTicks: 3, pendingExit: null, under: [], lastStepTick: 2, lastStepDistance: 1 } }; }],
    ["sprite prev", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, prev: { x: 1, y: 2 } }; }],
    ["sprite frozen", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, frozenUntil: 12 }; }],
    ["sprite multitask thread", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, multitaskThread: 1 }; }],
    ["sprite animation clock", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, visual: { ...state.sprites.items[0]!.visual, frame: 3, frameTicks: 4, idleTicks: 5, stanceHeld: true, stanceComplete: true } }; }],
    ["program-scope tile edit", (state) => {
      const board0 = state.world.board!;
      state.world = { ...state.world, board: { ...board0, runtime: { ...board0.runtime!, tileEdits: [...board0.runtime!.tileEdits, { index: 2, tile: tile("Tiles/lava.tle", 0), previous: null, scope: "program", owner: 1 }] } } };
    }],
    ["section version", (state) => { state.party.version = 99; }],
    ["input", (state) => { state.input = { ...state.input, held: ["E"] } as never; }],
    ["unreached object", (state) => { state.vm.objects.push(object(40, "", { loose: 1 })); }],
    ["unreached cell", (state) => { state.vm.cells!.cell5 = "unused"; state.vm.cellSeq = 6; }],
  ];
  for (const [name, change] of exclusions) {
    const state = fixture();
    change(state);
    equal(ledgerHash(state), baseline, `${name} must not change the ledger hash`);
    differs(hashGameState(state), fullSave, `${name} must stay in the full save`);
  }
});

test("each ledger-bearing field changes the projection hash independently", () => {
  const baseline = ledgerHash();
  const changes: Array<[string, (state: GameState) => void]> = [
    ["party steps", (state) => { state.party.steps += 1; }],
    ["party step remainder", (state) => { state.party.stepRemainder += 1; }],
    ["runtime walking setting", (state) => { state.world.movement.walking = 1; }],
    ["runtime pushing setting", (state) => { state.world.movement.pushing = 1; }],
    ["party members", (state) => { addActor(state.actors, { kind: "party", source: "Characters/two.chr" }); state.party.members.push(4); }],
    ["actor hp", (state) => { state.actors.actors[0]!.stats.hp = 43; }],
    ["actor statuses", (state) => { state.actors.actors[0]!.statuses.poison = 3; }],
    ["actor equipment", (state) => { state.actors.actors[0]!.equipment.equipped.push("Items/shield.itm"); }],
    ["actor bonuses", (state) => { state.actors.actors[0]!.equipment.bonuses.dp = 4; }],
    ["actor progression", (state) => { state.actors.actors[0]!.progression.maxLevel = 50; }],
    ["actor behaviour", (state) => { state.actors.actors[0]!.behaviour = null; }],
    ["actor events", (state) => { state.actors.actors[0]!.customEvents.push("hurt"); }],
    ["actors nextId", (state) => { state.actors.nextId = 5; }],
    ["inventory gold", (state) => { state.inventory.gold = 51; }],
    ["inventory quantity", (state) => { state.inventory.items[0]!.quantity = 3; }],
    ["inventory handle", (state) => { state.inventory.items[0]!.handle = "1"; }],
    ["equipment slot", (state) => { state.inventory.equipment[0]!.slot = "armor"; }],
    ["global value", (state) => { state.vm.globals.count = 4; }],
    ["global name", (state) => { state.vm.globals.extra = 1; }],
    ["redirect", (state) => { state.vm.redirects.push(["a", "b"]); }],
    ["cell value", (state) => { state.vm.cells!.cell1 = 8; }],
    ["cell seq", (state) => { state.vm.cellSeq = 7; }],
    ["object member", (state) => { (state.vm.objects[0]!.members.gold) = 11; }],
    ["object keys order", (state) => { const record0 = state.vm.objects[0]!; state.vm.objects[0] = { ...record0, keys: ["next", "gold", "self"] }; }],
    ["object handle", (state) => { state.vm.globals.party = { kind: "object", handle: 6, className: "" }; }],
    ["def owners", (state) => { state.vm.defOwners!.loot = { kind: "inline", text: "function loot(a)\nendFunction\n", ir: "1" }; }],
    ["emitters", (state) => { state.events.emitters = { [boardEmitterKey(BOARD_KEY)]: 5, battle: 5 }; }],
    ["board key", (state) => { state.world = { ...state.world, board: { ...state.world.board!, key: assetKey("other.brd") } }; state.triggers.boardKey = "other.brd"; state.sprites.randomEncounter = { boardKey: "other.brd", tile: { x: 1, y: 2 }, tiles: 5 }; }],
    ["board size", (state) => { state.world = { ...state.world, board: { ...state.world.board!, sizeX: 9 } }; }],
    ["board ambient", (state) => { state.world = { ...state.world, board: { ...state.world.board!, ambient: { r: 11, g: 20, b: 30 } } }; }],
    ["board vector point", (state) => { const board0 = state.world.board!; state.world = { ...state.world, board: { ...board0, vectors: [{ ...board0.vectors![0]!, points: [{ x: 9, y: 9 }] }] } }; }],
    ["board program layer", (state) => { const board0 = state.world.board!; state.world = { ...state.world, board: { ...board0, programs: [{ ...board0.programs![0]!, layer: 2 }] } }; }],
    ["authored slot default", (state) => {
      const board0 = state.world.board!;
      const rawItems = board0.rawItems!.map((item) => item.slot === 1 ? { ...item, x: 65 } : item);
      state.world = { ...state.world, board: { ...board0, rawItems, items: rawItems.filter((item) => item.itemFile !== "") } };
    }],
    ["board tile edit", (state) => {
      const board0 = state.world.board!;
      state.world = { ...state.world, board: { ...board0, runtime: { ...board0.runtime!, tileEdits: [...board0.runtime!.tileEdits, { index: 3, tile: tile("Tiles/sand.tle", 0), previous: null, scope: "board" }] } } };
    }],
    ["tile types", (state) => { const board0 = state.world.board!; state.world = { ...state.world, board: { ...board0, runtime: { ...board0.runtime!, tileTypes: ["NORMAL", "LAVA"] } } }; }],
    ["sprite x", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, x: 201 }; }],
    ["sprite facing", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, facing: "N" }; }],
    ["sprite visible", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, visible: false }; }],
    ["sprite controlled", (state) => { state.sprites.players[0] = { ...state.sprites.players[0]!, controlled: false }; }],
    ["sprite speed", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, speed: 0.5 }; }],
    ["sprite idle time", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, idleTime: 4 }; }],
    ["sprite collision base", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, collisionBase: { points: [{ x: 1, y: 1 }] } }; }],
    ["sprite activation base", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, activationBase: { points: [{ x: 2, y: 2 }] } }; }],
    ["sprite visual selection", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, visual: { ...state.sprites.items[0]!.visual, animation: "idle.S", file: "Images/a.img", stance: "wave" } }; }],
    ["sprite visual config", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, visual: { ...state.sprites.items[0]!.visual, custom: [{ animation: "wave", handle: "a" }] } }; }],
    ["sprite multitask program", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, multitaskProgram: "Prg/chest.prg" }; }],
    ["sprite actor link", (state) => { state.sprites.players[0] = { ...state.sprites.players[0]!, actorId: null }; }],
    ["selected player", (state) => { state.sprites.players.push(sprite({ id: "Characters/two.chr", kind: "player", index: 1 })); state.sprites.selectedPlayer = "Characters/two.chr"; }],
    ["next item handle", (state) => {
      state.sprites.items.push(sprite({ id: ITEM_FILE, kind: "item", index: 2, sourceSlot: 2 }));
      state.sprites.items[2] = { ...state.sprites.items[2]!, sourceSlot: 1 };
      state.sprites.nextItemHandle = 3;
    }],
    ["encounter progress", (state) => { state.sprites.randomEncounter = { boardKey: BOARD_KEY, tile: { x: 1, y: 2 }, tiles: 6 }; }],
    ["trigger fired", (state) => { state.triggers.fired.door = false; }],
    ["trigger repeat", (state) => { state.triggers.repeat.step = 33; }],
    ["trigger suppressed", (state) => { state.triggers.suppressed.push("inn"); }],
    ["trigger deactivated", (state) => { state.triggers.deactivated.push("exit"); }],
    ["trigger deactivateAt", (state) => { state.triggers.deactivateAt = { x: 11, y: 20, layer: 1 }; }],
    ["rng", (state) => { state.rng.s0 += 1; }],
    ["tick", (state) => { state.time.tick = 5; }],
  ];
  for (const [name, change] of changes) {
    const state = fixture();
    change(state);
    differs(ledgerHash(state), baseline, `${name} must change the ledger hash`);
  }
});

test("object key order canonicalizes but the saved member order stays significant", () => {
  const first = fixture();
  const second = fixture();
  // A different insertion order in the globals is canonicalized by the hash.
  second.vm.globals = {
    loot: callable("loot", ["cell1", "cell4"], "5"),
    below: Number.NEGATIVE_INFINITY,
    above: Number.POSITIVE_INFINITY,
    notANumber: Number.NaN,
    nothing: null,
    name: "hero",
    count: 3,
    party: { kind: "object", handle: 5, className: "Party" },
  };
  deepEqual(projected(second).script.globals, projected(first).script.globals);
  equal(ledgerHash(second), ledgerHash(first));
  // `keys` is the object's one enumeration order, so it stays significant.
  const reordered = fixture();
  reordered.vm.objects = reordered.vm.objects.map((record) => record.handle === 5
    ? { ...record, keys: ["self", "gold", "next"] }
    : record);
  differs(ledgerHash(reordered), ledgerHash(first));
  deepEqual(projected(reordered).script.persistentGraph.objects[0]!.keys, ["self", "gold", "next"]);
});

test("the board authored slots stay separate from live sprite placement", () => {
  const state = fixture();
  const ledger = projected(state);
  ok(ledger.world.board.state === "present");
  const current = ledger.world.board.value;
  // The moved sprite keeps its authored board default and its live placement.
  equal(current.rawItems[1]!.x, 64);
  equal(ledger.sprites.items[0]!.x, 200);
  // Duplicate filenames stay two instances because slot and handle differ.
  equal(ledger.sprites.items[0]!.id, ledger.sprites.items[1]!.id);
  differs(ledger.sprites.items[0]!.handle, ledger.sprites.items[1]!.handle);
  differs(ledger.sprites.items[0]!.sourceSlot, ledger.sprites.items[1]!.sourceSlot);

  // A compact `items` view that disagrees with `rawItems` is refused.
  const mismatched = fixture();
  const board0 = mismatched.world.board!;
  mismatched.world = { ...mismatched.world, board: { ...board0, items: board0.items!.map((item) => item.slot === 1 ? { ...item, x: 200 } : item) } };
  deepEqual(failure(() => projected(mismatched)), { code: "ledger.board", path: "world.board.items[0]" });

  // A sprite naming a slot that holds another item is refused.
  const wrongSlot = fixture();
  wrongSlot.sprites.items[0] = { ...wrongSlot.sprites.items[0]!, id: "Items/other.itm", source: "Items/other.itm" };
  deepEqual(failure(() => projected(wrongSlot)), { code: "ledger.board", path: "sprites.items[0].sourceSlot" });

  // An item sprite with no board to name is refused.
  const noBoard = fixture();
  noBoard.world = { movement: noBoard.world.movement };
  deepEqual(failure(() => projected(noBoard)), { code: "ledger.board", path: "sprites.items[0].sourceSlot" });

});

test("party and inventory references are checked without running an equip operation", () => {
  const cases: Array<[string, (state: GameState) => void, string, string]> = [
    ["party member kind", (state) => { state.party.members = [2]; state.party.selected = 2; }, "ledger.reference", "party.members[0]"],
    ["party member missing", (state) => { state.party.members = [9]; state.party.selected = 9; }, "ledger.reference", "party.members[0]"],
    ["party selection", (state) => { state.party.selected = 2; }, "ledger.reference", "party.selected"],
    ["duplicate actor id", (state) => { state.actors.actors[1]!.id = 1 as never; }, "ledger.identity", "actors.actors[1].id"],
    ["actor nextId", (state) => { state.actors.nextId = 3; }, "ledger.identity", "actors.nextId"],
    ["duplicate item id", (state) => { state.inventory.items.push({ id: 1, source: "Items/two.itm", handle: "9", quantity: 1 }); }, "ledger.identity", "inventory.items[1].id"],
    ["item id above nextId", (state) => { state.inventory.nextId = 1; }, "ledger.identity", "inventory.items[0].id"],
    ["equipment actor", (state) => { state.inventory.equipment[0]!.actorId = 9; }, "ledger.reference", "inventory.equipment[0].actorId"],
    ["equipment item", (state) => { state.inventory.equipment[0]!.itemId = 9; }, "ledger.reference", "inventory.equipment[0].itemId"],
    ["equipment slot twice", (state) => { state.inventory.equipment.push({ actorId: 1, slot: "weapon", itemId: 1 }); }, "ledger.identity", "inventory.equipment[1].slot"],
    ["sprite index", (state) => { state.sprites.items[1] = { ...state.sprites.items[1]!, index: -1 }; }, "ledger.shape", "sprites.items[1].index"],
    ["duplicate item handle", (state) => { state.sprites.items[1] = { ...state.sprites.items[1]!, handle: 0 }; }, "ledger.identity", "sprites.items[1].handle"],
    ["next item handle", (state) => { state.sprites.nextItemHandle = 1; }, "ledger.identity", "sprites.nextItemHandle"],
    ["selected player", (state) => { state.sprites.selectedPlayer = "Characters/none.chr"; }, "ledger.reference", "sprites.selectedPlayer"],
  ];
  for (const [name, change, code, path] of cases) {
    const state = fixture();
    change(state);
    deepEqual(failure(() => projected(state)), { code, path }, name);
  }
  // Saved actor equipment is projected verbatim: no equip operation runs, so
  // stats are never re-derived or double-adjusted.
  const state = fixture();
  const before = JSON.stringify(state.actors.actors[0]!.stats);
  const ledger = projected(state);
  equal(JSON.stringify(state.actors.actors[0]!.stats), before);
  deepEqual(ledger.actors.actors[0]!.stats, { ...state.actors.actors[0]!.stats });
  deepEqual(ledger.actors.actors[0]!.equipment, state.actors.actors[0]!.equipment);
});

test("the persistent-root walker keeps rooted cycles and refuses stale handles", () => {
  const state = fixture();
  const graph = projected(state).script.persistentGraph;
  // The object self-cycle and the mutual 5↔6 cycle are each kept once.
  equal(graph.objects.length, 2);
  equal(graph.objects.filter((entry) => entry.handle === 5).length, 1);
  deepEqual(graph.objects[1]!.members.back, { kind: "object", handle: 5, className: "Party" });

  // A closure that captures its own cell is kept once.
  const selfCapture = fixture();
  selfCapture.vm.globals.recursive = callable("recursive", ["cell4"], null);
  deepEqual(projected(selfCapture).script.persistentGraph.cells, {
    state: "present",
    value: { seq: 6, values: { cell1: 7, cell4: { kind: "object", handle: 6, className: "" } } },
  });

  const cases: Array<[string, (state: GameState) => void, string, string]> = [
    ["dangling handle", (mutated) => { mutated.vm.globals.party = { kind: "object", handle: 99, className: "Party" }; }, "ledger.reference", "vm.globals.party"],
    ["missing captured cell", (mutated) => { mutated.vm.globals.loot = callable("loot", ["cell9"], "5"); }, "ledger.reference", "vm.globals.loot.captures[0]"],
    ["class mismatch", (mutated) => { mutated.vm.globals.party = { kind: "object", handle: 5, className: "Other" }; }, "ledger.reference", "vm.globals.party"],
    ["duplicate handle", (mutated) => { mutated.vm.objects.push(object(5, "Party", { gold: 1 })); }, "ledger.identity", "vm.objects[4]"],
    ["key without member", (mutated) => { mutated.vm.objects[0] = { ...mutated.vm.objects[0]!, keys: ["gold", "self", "next", "ghost"] }; }, "ledger.reference", "vm.objects[0].keys[3]"],
    ["member without key", (mutated) => { mutated.vm.objects[0] = { ...mutated.vm.objects[0]!, keys: ["gold", "self"] }; }, "ledger.identity", "vm.objects[0].members.next"],
    ["receiver without object", (mutated) => { mutated.vm.globals.loot = callable("loot", [], "42"); }, "ledger.reference", "vm.globals.loot.receiver"],
    ["malformed callable", (mutated) => { mutated.vm.globals.loot = { type: "callable", def: "", captures: [], receiver: null }; }, "ledger.shape", "vm.globals.loot.def"],
    ["cell above seq", (mutated) => { mutated.vm.cellSeq = 3; }, "ledger.identity", "vm.cells.cell4"],
    ["cells without seq", (mutated) => { delete mutated.vm.cellSeq; }, "ledger.shape", "vm.cellSeq"],
    ["bad def owner", (mutated) => { mutated.vm.defOwners!.loot = { kind: "sideways", ir: "1" } as never; }, "ledger.shape", "vm.defOwners.loot.kind"],
    ["not a script value", (mutated) => { mutated.vm.globals.flag = true as never; }, "ledger.shape", "vm.globals.flag"],
  ];
  for (const [name, change, code, path] of cases) {
    const mutated = fixture();
    change(mutated);
    deepEqual(failure(() => projected(mutated)), { code, path }, name);
  }
});

test("an omitted high object handle or a cell gap cannot alias a live reference", () => {
  const state = fixture();
  const ledger = projected(state);
  // Handle 9 and 7 stay live in the full save but are not ledger progress.
  equal(state.vm.objects.some((record) => record.handle === 9), true);
  equal(ledger.script.persistentGraph.objects.some((entry) => entry.handle === 9), false);
  // The high-water cell id is carried, so a future cell can never take cell1..cell6.
  deepEqual(ledger.script.persistentGraph.cells, { state: "present", value: { seq: 6, values: { cell1: 7, cell4: { kind: "object", handle: 6, className: "" } } } });
  // Projection is read-only, so the allocator still sees every live handle.
  equal(state.vm.objects.length, 4);
  equal(state.vm.cellSeq, 6);
});

test("a full save keeps the continuation the ledger leaves out", () => {
  const state = fixture();
  const json = snapshot(state);
  const restored = restoreGameState(json);
  equal(restored.vm.threads.length, 1);
  deepEqual(restored.vm.threads[0]!.frames[0]!.locals.secret!.value, { kind: "object", handle: 7, className: "Hidden" });
  equal(restored.events.listeners.length, 1);
  deepEqual(restored.triggers.active, state.triggers.active);
  equal(restored.world.board!.runtime!.tileEdits.length, 2);
  equal(restored.menu.screens.length, 0);
  // The readback is the same candidate, so it projects to the same ledger.
  deepEqual(projectGameLedger(restored), projectGameLedger(state));
  equal(hashGameLedger(projectGameLedger(restored)), ledgerHash(state));
});

test("an altered readback changes the projected hash exactly when it bears progress", () => {
  const state = fixture();
  const json = snapshot(state);
  const baseline = ledgerHash(state);

  const bearing = JSON.parse(json) as { party: { steps: number } };
  bearing.party.steps += 1;
  differs(ledgerHash(restoreGameState(JSON.stringify(bearing))), baseline);

  const continuation = JSON.parse(json) as { vm: { threads: Array<{ status: string }> } };
  continuation.vm.threads[0]!.status = "finished";
  equal(ledgerHash(restoreGameState(JSON.stringify(continuation))), baseline);
});

test("optional and nullable source fields keep their three-way presence", () => {
  const absent = fixture();
  absent.world = { movement: absent.world.movement };
  absent.sprites.players = [];
  absent.sprites.items = [];
  absent.sprites.selectedPlayer = null;
  absent.sprites.nextItemHandle = 0;
  delete absent.sprites.randomEncounter;
  absent.triggers.boardKey = null;
  const absentLedger = projectGameLedger(absent);
  deepEqual(absentLedger.world.board, { state: "absent" });
  deepEqual(absentLedger.sprites.randomEncounter, { state: "absent" });
  deepEqual(absentLedger.script.persistentGraph.cells, { state: "present", value: { seq: 6, values: { cell1: 7, cell4: { kind: "object", handle: 6, className: "" } } } });
  deepEqual(absentLedger.sprites.players, []);
  assertNoUndefined(absentLedger);

  const explicitNull = fixture();
  explicitNull.world = { ...explicitNull.world, board: null };
  explicitNull.sprites.players = [];
  explicitNull.sprites.items = [];
  explicitNull.sprites.selectedPlayer = null;
  explicitNull.sprites.nextItemHandle = 0;
  explicitNull.sprites.randomEncounter = null;
  explicitNull.triggers.boardKey = null;
  const nullLedger = projectGameLedger(explicitNull);
  deepEqual(nullLedger.world.board, { state: "null" });
  deepEqual(nullLedger.sprites.randomEncounter, { state: "null" });
  // Absent and explicit null are different ledgers.
  differs(hashGameLedger(nullLedger), hashGameLedger(absentLedger));

  const links = fixture();
  links.sprites.players = [sprite({ id: "Characters/hero.chr", kind: "player", index: 0, controlled: true })];
  equal("actorId" in links.sprites.players[0]!, false);
  deepEqual(projectGameLedger(links).sprites.players[0]!.actorId, { state: "absent" });
  const unlinked = fixture();
  unlinked.sprites.players[0] = { ...unlinked.sprites.players[0]!, actorId: null };
  deepEqual(projectGameLedger(unlinked).sprites.players[0]!.actorId, { state: "null" });

  const hosted = fixture();
  hosted.vm.objects[2] = { ...hosted.vm.objects[2]!, hostType: "Sprite" };
  const hostedGraph = projectGameLedger(hosted).script.persistentGraph;
  deepEqual(hostedGraph.objects[1]!.hostType, { state: "present", value: "Sprite" });
  deepEqual(projectGameLedger(fixture()).script.persistentGraph.objects[1]!.hostType, { state: "absent" });

  // A candidate with no closure table and no definition owners says so.
  const bare = fixture();
  delete bare.vm.cells;
  delete bare.vm.cellSeq;
  delete bare.vm.defOwners;
  bare.vm.globals = { count: 1 };
  const bareLedger = projectGameLedger(bare);
  deepEqual(bareLedger.script.persistentGraph.cells, { state: "absent" });
  deepEqual(bareLedger.script.persistentGraph.defOwners, { state: "absent" });
  deepEqual(bareLedger.script.persistentGraph.objects, []);
  deepEqual(bareLedger.script.emitters, {});
});

test("game-modified durable settings are saved values, never reset from an asset", () => {
  const state = fixture();
  const modified = {
    ...state.sprites.items[0]!,
    speed: 0.5,
    idleTime: 3,
    x: 240,
    y: 48,
    collisionBase: { points: [{ x: 4, y: -20 }] },
    visual: {
      ...state.sprites.items[0]!.visual,
      movement: ["walk.E"],
      custom: [{ animation: "wave", handle: "hand" }],
      animation: "stance.wave",
      file: "Images/hand.img",
      stance: "wave",
    },
    multitaskProgram: "Prg/chest.prg",
  };
  state.sprites.items[0] = modified;
  const ledger = projected(state);
  const item = ledger.sprites.items[0]!;
  equal(item.speed, 0.5);
  equal(item.idleTime, 3);
  equal(item.x, 240);
  equal(item.y, 48);
  deepEqual(item.collisionBase, { points: [{ x: 4, y: -20 }] });
  deepEqual(item.visual, {
    movement: ["walk.E"],
    idle: [],
    battle: [],
    custom: [{ animation: "wave", handle: "hand" }],
    animation: "stance.wave",
    file: "Images/hand.img",
    stance: "wave",
  });
  equal(item.multitaskProgram, "Prg/chest.prg");
  // The authored slot default is untouched by the moved sprite.
  ok(ledger.world.board.state === "present");
  equal(ledger.world.board.value.rawItems[1]!.x, 64);
  // Frame clocks are continuation, so they never re-enter the durable projection.
  for (const key of ["frame", "frameTicks", "idleTicks", "stanceHeld", "stanceComplete"]) {
    equal(key in item.visual, false, `${key} is a transient frame clock`);
  }
});

test("file program references and animated durable tiles project whole", () => {
  const state = fixture();
  state.vm.objects[0] = {
    ...state.vm.objects[0]!,
    program: {
      kind: "file",
      path: "Prg/party.prg",
      sourceHash: "abc",
      ir: "1",
      includes: ["Prg/util.prg"],
      redirects: [["a", "b"]],
      dialect: "tk2",
      owner: "pkg",
    },
  };
  state.vm.defOwners!.loot = { kind: "file", path: "Prg/loot.prg", sourceHash: "def", ir: "1" };
  const board0 = state.world.board!;
  const animated = {
    asset: assetKey("Tiles/water.tle"),
    tile: 2,
    nativeWidth: 16,
    nativeHeight: 32,
    width: 32,
    height: 64,
    tint: { r: 1, g: 2, b: 3 },
    animation: { ticksPerFrame: 4, frames: [tile("Tiles/water.tle", 1), tile("Tiles/water.tle", 2)] },
  };
  state.world = { ...state.world,
    board: {
      ...board0,
      runtime: {
        ...board0.runtime!,
        tileEdits: [{ index: 4, tile: animated, previous: tile("Tiles/grass.tle", 1), scope: "board" }],
      },
    },
  };

  const ledger = projected(state);
  deepEqual(ledger.script.persistentGraph.objects[0]!.program, {
    kind: "file",
    path: "Prg/party.prg",
    sourceHash: "abc",
    ir: "1",
    includes: ["Prg/util.prg"],
    redirects: [["a", "b"]],
    dialect: "tk2",
    owner: "pkg",
  });
  ok(ledger.script.persistentGraph.defOwners.state === "present");
  deepEqual(ledger.script.persistentGraph.defOwners.value.loot, {
    kind: "file",
    path: "Prg/loot.prg",
    sourceHash: "def",
    ir: "1",
    includes: [],
    redirects: [],
    dialect: null,
    owner: null,
  });
  ok(ledger.world.board.state === "present");
  const edit = ledger.world.board.value.runtime.state === "present"
    ? ledger.world.board.value.runtime.value.tileEdits[0]!
    : undefined;
  ok(edit !== undefined);
  deepEqual(edit.tile, {
    asset: "tiles/water.tle",
    tile: 2,
    nativeWidth: 16,
    nativeHeight: 32,
    width: 32,
    height: 64,
    tint: { r: 1, g: 2, b: 3 },
    animation: {
      ticksPerFrame: 4,
      frames: [
        { asset: "tiles/water.tle", tile: 1, nativeWidth: null, nativeHeight: null, width: null, height: null, tint: null, animation: null },
        { asset: "tiles/water.tle", tile: 2, nativeWidth: null, nativeHeight: null, width: null, height: null, tint: null, animation: null },
      ],
    },
  });
  equal("previous" in edit, false, "the record's previous value is baseline bookkeeping, not board progress");
});

test("malformed ledger-only fields are refused with a located path", () => {
  const cases: Array<[string, (state: GameState) => void, string, string]> = [
    ["actor kind", (state) => { state.actors.actors[0]!.kind = "monster" as never; }, "ledger.shape", "actors.actors[0].kind"],
    ["actor stat type", (state) => { state.actors.actors[0]!.stats.hp = "many" as never; }, "ledger.shape", "actors.actors[0].stats.hp"],
    ["compact item count", (state) => {
      const board0 = state.world.board!;
      state.world = { ...state.world, board: { ...board0, items: board0.items!.slice(1) } };
    }, "ledger.board", "world.board.items"],
    ["tile edit scope", (state) => {
      const board0 = state.world.board!;
      state.world = { ...state.world, board: { ...board0, runtime: { ...board0.runtime!, tileEdits: [{ index: 0, tile: null, previous: null, scope: "global" as never }] } } };
    }, "ledger.shape", "world.board.runtime.tileEdits[0].scope"],
    ["sprite slot range", (state) => { state.sprites.items[0] = { ...state.sprites.items[0]!, sourceSlot: 9 }; }, "ledger.board", "sprites.items[0].sourceSlot"],
    ["dictionary with program", (state) => {
      state.vm.objects[2] = { ...state.vm.objects[2]!, program: { kind: "inline", text: "end()\n", ir: "1" } };
    }, "ledger.shape", "vm.objects[2].program"],
    ["class without program", (state) => { state.vm.objects[0] = { ...state.vm.objects[0]!, program: null }; }, "ledger.shape", "vm.objects[0].program"],
    ["redirect pair", (state) => { state.vm.redirects = [["a"]] as never; }, "ledger.shape", "vm.redirects[0]"],
    ["array script value", (state) => { state.vm.globals.list = [1] as never; }, "ledger.shape", "vm.globals.list"],
    ["receiver text", (state) => { state.vm.globals.loot = callable("loot", [], "abc"); }, "ledger.shape", "vm.globals.loot.receiver"],
    ["non-value object", (state) => { state.vm.globals.shape = {} as never; }, "ledger.shape", "vm.globals.shape"],
    ["cell seq without cells", (state) => { delete state.vm.cells; }, "ledger.shape", "vm.cellSeq"],
  ];
  for (const [name, change, code, path] of cases) {
    const state = fixture();
    change(state);
    deepEqual(failure(() => projected(state)), { code, path }, name);
  }
});

test("a destroyed party member leaves a saved sprite index that still projects", () => {
  const state = fixture();
  state.sprites.players = [
    sprite({ id: "Characters/one.chr", kind: "player", index: 0, actorId: actorId(1) }),
    sprite({ id: "Characters/two.chr", kind: "player", index: 1 }),
  ];
  state.sprites.selectedPlayer = "Characters/two.chr";
  state.sprites.players[1] = { ...state.sprites.players[1]!, controlled: true };
  // A destroyed actor's sprite is removed from the list without reindexing the
  // survivors, so the remaining player keeps index 1 at position 0.
  equal(removeActorSprite(state.sprites, actorId(1)), true);
  equal(state.sprites.players.length, 1);
  equal(state.sprites.players[0]!.index, 1);
  const ledger = projected(state);
  deepEqual(ledger.sprites.players.map((entry) => [entry.id, entry.index]), [["Characters/two.chr", 1]]);
  equal(ledger.sprites.selectedPlayer, "Characters/two.chr");
  assertNoUndefined(ledger);
});

test("program-scope tile edits and their expiry never reach the ledger", () => {
  const state = fixture();
  const board0 = state.world.board!;
  const programTile = tile("Tiles/water.tle", 1);
  const durableTile = tile("Tiles/sand.tle", 3);
  state.world = { ...state.world,
    board: {
      ...board0,
      runtime: {
        ...board0.runtime!,
        tileEdits: [
          { index: 0, tile: programTile, previous: null, scope: "program", owner: 7 },
          { index: 0, tile: durableTile, previous: programTile, scope: "board" },
        ],
      },
    },
  };
  const ledger = projected(state);
  ok(ledger.world.board.state === "present");
  const runtime = ledger.world.board.value.runtime;
  ok(runtime.state === "present");
  deepEqual(runtime.value.tileEdits, [
    { index: 0, tile: { asset: "tiles/sand.tle", tile: 3, nativeWidth: null, nativeHeight: null, width: null, height: null, tint: null, animation: null }, scope: "board", owner: null },
  ]);
  equal("previous" in runtime.value.tileEdits[0]!, false);

  const ledgerBefore = hashGameLedger(ledger);
  const fullBefore = hashGameState(state);
  // Thread 7 is gone, so expiry drops the program edit and rewrites the durable
  // edit's previous value to the true baseline: continuation only.
  expireProgramTileEdits(state);
  equal(state.world.board!.runtime!.tileEdits.length, 1);
  equal(state.world.board!.runtime!.tileEdits[0]!.previous, null);
  equal(hashGameLedger(projectGameLedger(state)), ledgerBefore);
  differs(hashGameState(state), fullBefore);
});

test("saved encounter and trigger board names may lag the current board", () => {
  // A random encounter records the battle-enabled board that started it and is
  // only reset when the player next enters an eligible board, so it can name a
  // board the candidate has already left.
  const left = fixture();
  left.sprites.randomEncounter = { boardKey: "cave.brd", tile: { x: 3, y: 4 }, tiles: 2 };
  const leftLedger = projected(left);
  deepEqual(leftLedger.sprites.randomEncounter, {
    state: "present",
    value: { boardKey: "cave.brd", tile: { x: 3, y: 4 }, tiles: 2 },
  });
  ok(leftLedger.world.board.state === "present");
  equal(leftLedger.world.board.value.key, BOARD_KEY);

  // Trigger progress is re-pointed at the current board by the next trigger
  // phase, so a candidate captured before that reset keeps the prior name.
  const stale = fixture();
  stale.triggers.boardKey = "cave.brd";
  const staleLedger = projected(stale);
  equal(staleLedger.triggers.boardKey, "cave.brd");
  equal(staleLedger.triggers.fired.door, true);

  // Neither name is a relationship to the current board, so a candidate with no
  // board at all keeps them as saved progress.
  const boardless = fixture();
  boardless.world = { movement: boardless.world.movement };
  boardless.sprites.players = [];
  boardless.sprites.items = [];
  boardless.sprites.selectedPlayer = null;
  boardless.sprites.nextItemHandle = 0;
  boardless.sprites.randomEncounter = { boardKey: "cave.brd", tile: { x: 3, y: 4 }, tiles: 2 };
  boardless.triggers.boardKey = "cave.brd";
  const boardlessLedger = projected(boardless);
  deepEqual(boardlessLedger.world.board, { state: "absent" });
  deepEqual(boardlessLedger.sprites.randomEncounter, {
    state: "present",
    value: { boardKey: "cave.brd", tile: { x: 3, y: 4 }, tiles: 2 },
  });
  equal(boardlessLedger.triggers.boardKey, "cave.brd");
  assertNoUndefined(boardlessLedger);
});

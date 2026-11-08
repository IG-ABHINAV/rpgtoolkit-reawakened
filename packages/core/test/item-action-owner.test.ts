import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  createActorEventSink,
  createActorService,
  createEmptyCharacter,
  createEmptyItem,
  createGameState,
  createMenuOwnerPorts,
  queueNativeEvent,
  type ActorHooks,
  type GameState,
  type InventoryRuntime,
  type ItemActionRequest,
  type ItemActionSelection,
  type MenuOwnerPorts,
} from "../src/index.ts";
import { findObject, readMember } from "../src/script/objects.ts";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const SWORD = "item/sword.itm";
const AXE = "item/axe.itm";
const TONIC = "item/tonic.itm";
const SLOT_FLAGS = [0, 0, 0, 1, 1, 0, 0, 0];

const ITEMS = {
  [SWORD]: { ...createEmptyItem(), name: "Sword", description: "sharp", equipable: 1, equipSlots: SLOT_FLAGS, equipBonus: [2, 1, 1, 3], onEquipProgram: "sword-equip.prg", onRemoveProgram: "sword-remove.prg" },
  [AXE]: { ...createEmptyItem(), name: "Axe", equipable: 1, equipSlots: SLOT_FLAGS, equipBonus: [5, 0, 0, 0], onEquipProgram: "axe-equip.prg" },
  [TONIC]: { ...createEmptyItem(), name: "Tonic", menuUsable: 1, menuUseHp: 4, menuUseSmp: -10, menuUseProgram: "tonic.prg" },
};

type Fixture = {
  readonly state: GameState;
  readonly ports: MenuOwnerPorts;
  readonly inventoryEvents: { readonly type: string; readonly detail: unknown }[];
  readonly log: string[];
  hooks: ActorHooks;
  readonly queueTypes: () => string[];
};

function fixture(): Fixture {
  const state = createGameState({ seed: 5 });
  const hero = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    name: "Hero",
    stats: { hp: 8, maxHp: 10, smp: 1, maxSmp: 4, dp: 1, fp: 1, level: 1, experience: 0 },
  });
  state.party.members = [hero.id];
  state.party.selected = hero.id;
  const log: string[] = [];
  const inventoryEvents: { readonly type: string; readonly detail: unknown }[] = [];
  const queueTypes = (): string[] => state.events.queue.map((queued) => String(readMember(findObject(state.vm, queued.event)!, "type")));
  const result: Fixture = { state, log, inventoryEvents, hooks: {}, queueTypes } as Fixture;
  const service = createActorService(state.actors, () => result.hooks, createActorEventSink(state.vm, state.events, state.actors));
  const runtime: InventoryRuntime = {
    item: (source) => ITEMS[source as keyof typeof ITEMS],
    character: () => ({ ...createEmptyCharacter(), bodySlots: [0, 1, 1, 1, 1, 1, 1] }),
    applyEquipment: (id, equipped, catalog) => service.applyEquipment(id, equipped, catalog) !== null,
    updateStats: (id, patch) => service.updateStats(id, patch, { cause: "script", source: null }) !== null,
    prepareEquipment: (id, equipped, catalog) => service.prepareEquipment(id, equipped, catalog),
    commitPreparedEquipment: (prepared) => service.commitPreparedEquipment(prepared) !== null,
    discardPreparedEquipment: (prepared) => service.discardPreparedEquipment(prepared),
  };
  const ports = createMenuOwnerPorts(state, undefined, runtime, (event) => {
    log.push(`${event.type}@${queueTypes().join(",")}`);
    inventoryEvents.push(event);
  });
  return Object.assign(result, { ports });
}

function give(f: Fixture, source: string, handle: string, amount: number): number {
  ok(f.ports.inventory.apply({ type: "addItem", source, handle, amount }).ok);
  return f.state.inventory.items.find((entry) => entry.source === source)!.id;
}

/** The owner replaces actor records on commit, so read the one hero record fresh on every access. */
function liveHero(f: Fixture): { readonly id: number; readonly stats: GameState["actors"]["actors"][number]["stats"]; readonly equipment: GameState["actors"]["actors"][number]["equipment"] } {
  return {
    get id() { return f.state.actors.actors[0]!.id; },
    get stats() { return f.state.actors.actors[0]!.stats; },
    get equipment() { return f.state.actors.actors[0]!.equipment; },
  };
}

function equip(f: Fixture, entryId: number, slot = "right-hand"): void {
  ok(f.ports.inventory.apply({ type: "equip", actorId: f.state.actors.actors[0]!.id, slot, entryId }).ok);
}

function selectionOf(f: Fixture, request: ItemActionRequest): ItemActionSelection {
  const preflight = f.ports.inventory.preflightItemAction(request);
  if (!preflight.ok) throw new Error(preflight.error.message);
  return preflight.selection;
}

function snapshotOf(f: Fixture): string {
  return JSON.stringify([f.state.actors, f.state.inventory, f.state.events.queue, f.state.vm.objects.length]);
}

test("use applies clamped HP/SMP once, then consumes the exact stack with committed-quantity events", () => {
  const f = fixture();
  const hero = liveHero(f);
  const tonic = give(f, TONIC, "Tonic", 2);
  const request: ItemActionRequest = { kind: "use", entryId: tonic, actorId: hero.id };
  const selection = selectionOf(f, request);
  const before = snapshotOf(f);
  deepEqual(f.ports.inventory.commitItemAction(request, selection, { programStarted: false, step: "effects" }), { status: "complete", error: null });
  equal(hero.stats.hp, 10);
  equal(hero.stats.smp, 0);
  equal(f.state.inventory.items[0]!.quantity, 2);
  deepEqual(f.inventoryEvents.slice(1), []);
  ok(snapshotOf(f) !== before);
  deepEqual(f.ports.inventory.commitItemAction(request, selection, { programStarted: true, step: "consume" }), { status: "complete", error: null });
  deepEqual(f.inventoryEvents.slice(1), [
    { type: "itemRemoved", detail: { entryId: tonic, source: TONIC, handle: "Tonic", amount: 1, previousQuantity: 2, currentQuantity: 1 } },
  ]);
  f.state.inventory.items[0]!.quantity = 0;
  const failed = f.ports.inventory.commitItemAction(request, selection, { programStarted: true, step: "consume" });
  equal(failed.status, "interrupted");
  equal(failed.error?.path, "inventory.items.quantity");
  const hooks = f.ports.inventory.itemActionHooks(request, selection);
  deepEqual(hooks.use, { program: "tonic.prg", item: { source: TONIC, handle: "Tonic", entryId: tonic, name: "Tonic", description: "", menuUseHp: 4, menuUseSmp: -10 } });
  equal(hooks.remove, null);
});

test("use preflight refuses an unusable item and an unknown target, accepts a fallen actor, and refuses effects for a departed member", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  equal(f.ports.inventory.preflightItemAction({ kind: "use", entryId: sword, actorId: hero.id }).ok, false);
  const tonic = give(f, TONIC, "Tonic", 1);
  hero.stats.hp = 0;
  equal(f.ports.inventory.preflightItemAction({ kind: "use", entryId: tonic, actorId: hero.id }).ok, true);
  hero.stats.hp = 5;
  equal(f.ports.inventory.preflightItemAction({ kind: "use", entryId: tonic, actorId: hero.id + 9 }).ok, false);
  const unchanged = snapshotOf(f);
  const selection = selectionOf(f, { kind: "use", entryId: tonic, actorId: hero.id });
  f.state.party.members = [];
  const refused = f.ports.inventory.commitItemAction({ kind: "use", entryId: tonic, actorId: hero.id }, selection, { programStarted: false, step: "effects" });
  equal(refused.status, "refused");
  equal(refused.error?.path, "inventory.action.actorId");
  equal(snapshotOf(f), unchanged);
});

test("replace swaps distinct stacks atomically with exact stack identities and ordered events", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  const axe = give(f, AXE, "Axe", 2);
  equip(f, sword);
  f.inventoryEvents.length = 0;
  f.log.length = 0;
  hero.stats.hp = 0;
  const request: ItemActionRequest = { kind: "replace", entryId: axe, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  deepEqual(selection.displaced, { slot: "right-hand", entryId: sword, source: SWORD, handle: "Sword" });
  const hooks = f.ports.inventory.itemActionHooks(request, selection);
  equal(hooks.remove?.program, "sword-remove.prg");
  equal(hooks.equip?.program, "axe-equip.prg");
  f.hooks = { equipmentChanged: () => { queueNativeEvent(f.state.vm, f.state.events, "game", "hookEvent", {}); return {}; } };
  deepEqual(f.ports.inventory.commitItemAction(request, selection, { programStarted: true }), { status: "complete", error: null });
  deepEqual(f.state.inventory.equipment, [{ actorId: hero.id, slot: "right-hand", itemId: axe }]);
  deepEqual(f.state.inventory.items.map((entry) => [entry.id, entry.quantity]), [[sword, 1], [axe, 1]]);
  deepEqual(f.inventoryEvents, [
    { type: "itemRemoved", detail: { entryId: axe, source: AXE, handle: "Axe", amount: 1, previousQuantity: 2, currentQuantity: 1 } },
    { type: "itemAdded", detail: { entryId: sword, source: SWORD, handle: "Sword", amount: 1, previousQuantity: 0, currentQuantity: 1 } },
  ]);
  deepEqual(hero.equipment.bonuses, { hp: 5, dp: 0, fp: 0, smp: 0 });
  equal(hero.stats.hp, 3);
  // Hook events precede the actor's revived event, which precedes both inventory events.
  deepEqual(f.queueTypes(), ["hookEvent", "revived"]);
  deepEqual(f.log, ["itemRemoved@hookEvent,revived", "itemAdded@hookEvent,revived"]);
});

test("same-stack replacement at MAX_SAFE_INTEGER publishes no quantity change and emits nothing", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 2);
  equip(f, sword);
  f.state.inventory.items[0]!.quantity = MAX_SAFE;
  f.inventoryEvents.length = 0;
  const request: ItemActionRequest = { kind: "replace", entryId: sword, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  deepEqual(f.ports.inventory.commitItemAction(request, selection, { programStarted: true }), { status: "complete", error: null });
  equal(f.state.inventory.items[0]!.quantity, MAX_SAFE);
  deepEqual(f.inventoryEvents, []);
  equal(f.state.inventory.equipment.length, 1);
  equal(hero.equipment.equipped.length, 1);
});

test("an overflowing displaced return refuses at preflight and interrupts after execution started", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  const axe = give(f, AXE, "Axe", 1);
  equip(f, sword);
  const request: ItemActionRequest = { kind: "replace", entryId: axe, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  f.state.inventory.items[0]!.quantity = MAX_SAFE;
  const unchanged = snapshotOf(f);
  const refused = f.ports.inventory.preflightItemAction(request);
  equal(refused.ok, false);
  equal(!refused.ok && refused.error.path, "inventory.items.quantity");
  const interrupted = f.ports.inventory.commitItemAction(request, selection, { programStarted: true });
  equal(interrupted.status, "interrupted");
  equal(interrupted.error?.path, "inventory.items.quantity");
  equal(f.ports.inventory.commitItemAction(request, selection, { programStarted: false }).status, "refused");
  equal(snapshotOf(f), unchanged);
});

test("removal of an empty slot is a complete no-op and an occupied slot returns the exact stack", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  const request: ItemActionRequest = { kind: "removeEquipment", actorId: hero.id, slot: "right-hand" };
  const empty = selectionOf(f, request);
  equal(empty.displaced, null);
  const unchanged = snapshotOf(f);
  deepEqual(f.ports.inventory.commitItemAction(request, empty, { programStarted: false }), { status: "complete", error: null });
  equal(snapshotOf(f), unchanged);
  equal(f.ports.inventory.preflightItemAction({ kind: "removeEquipment", actorId: hero.id, slot: "no-such-slot" }).ok, false);
  equip(f, sword);
  f.inventoryEvents.length = 0;
  const occupied = selectionOf(f, request);
  equal(f.ports.inventory.commitItemAction(request, empty, { programStarted: true }).status, "interrupted");
  deepEqual(f.ports.inventory.commitItemAction(request, occupied, { programStarted: true }), { status: "complete", error: null });
  deepEqual(f.state.inventory.equipment, []);
  equal(f.state.inventory.items[0]!.quantity, 1);
  deepEqual(f.inventoryEvents, [
    { type: "itemAdded", detail: { entryId: sword, source: SWORD, handle: "Sword", amount: 1, previousQuantity: 0, currentQuantity: 1 } },
  ]);
  deepEqual(hero.equipment.equipped, []);
  equal(f.ports.inventory.itemActionHooks(request, occupied).remove?.program, "sword-remove.prg");
});

test("a stale displaced tuple or stack identity interrupts instead of substituting another stack", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  const axe = give(f, AXE, "Axe", 3);
  equip(f, sword);
  const request: ItemActionRequest = { kind: "replace", entryId: axe, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  ok(f.ports.inventory.apply({ type: "unequip", actorId: hero.id, slot: "right-hand" }).ok);
  ok(f.ports.inventory.apply({ type: "equip", actorId: hero.id, slot: "right-hand", entryId: axe }).ok);
  const before = snapshotOf(f);
  const stale = f.ports.inventory.commitItemAction(request, selection, { programStarted: true });
  equal(stale.status, "interrupted");
  equal(snapshotOf(f), before);
});

test("hook failures and projection conflicts discard staged events and publish neither owner", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  const axe = give(f, AXE, "Axe", 1);
  equip(f, sword);
  const request: ItemActionRequest = { kind: "replace", entryId: axe, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  const stagedThenFail = (result: () => never | { equipped?: string[]; bonuses?: { hp: number; dp: number; fp: number; smp: number } }): ActorHooks => ({
    equipmentChanged: () => {
      queueNativeEvent(f.state.vm, f.state.events, "game", "hookEvent", {});
      return result();
    },
  });
  const cases: Array<[string, ActorHooks]> = [
    ["a throw", stagedThenFail(() => { throw new Error("hook refused"); })],
    ["an empty equipped patch", stagedThenFail(() => ({ equipped: [] }))],
    ["incompatible bonuses", stagedThenFail(() => ({ bonuses: { hp: 99, dp: 0, fp: 0, smp: 0 } }))],
  ];
  for (const [name, hooks] of cases) {
    f.hooks = hooks;
    const before = snapshotOf(f);
    const events = f.inventoryEvents.length;
    const refused = f.ports.inventory.commitItemAction(request, selection, { programStarted: false });
    equal(refused.status, "refused", name);
    equal(refused.error?.path, "actors", name);
    const interrupted = f.ports.inventory.commitItemAction(request, selection, { programStarted: true });
    equal(interrupted.status, "interrupted", name);
    equal(snapshotOf(f), before, name);
    equal(f.inventoryEvents.length, events, name);
  }
  f.hooks = {};
  deepEqual(f.ports.inventory.commitItemAction(request, selection, { programStarted: false }), { status: "complete", error: null });
});

test("missing definitions are listed in canonical order and shrink as the host supplies them", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 1);
  const axe = give(f, AXE, "Axe", 1);
  equip(f, sword);
  const request: ItemActionRequest = { kind: "replace", entryId: axe, actorId: hero.id, slot: "right-hand" };
  deepEqual(f.ports.inventory.missingItemActionAssets(request), []);
  const bare = createMenuOwnerPorts(f.state, undefined, { item: () => undefined, character: () => undefined, applyEquipment: () => true });
  deepEqual(bare.inventory.missingItemActionAssets(request), [
    { area: "items", path: "axe.itm" },
    { area: "items", path: "sword.itm" },
    { area: "characters", path: "hero.tem" },
  ]);
  deepEqual(bare.inventory.missingItemActionAssets({ kind: "replace", entryId: 999, actorId: hero.id, slot: "right-hand" }), []);
  deepEqual(bare.inventory.missingItemActionAssets({ kind: "removeEquipment", actorId: hero.id, slot: "no-such-slot" }), []);
  deepEqual(bare.inventory.missingItemActionAssets({ kind: "removeEquipment", actorId: hero.id, slot: "left-hand" }), [], "a removal of an empty slot needs no definitions");
});

test("a statsChanged or revive hook cannot mutate canonical stats, and its failure discards the staged event", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 2);
  const request: ItemActionRequest = { kind: "replace", entryId: sword, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  for (const [name, hooks] of [
    ["statsChanged mutates previous then throws", {
      statsChanged: (_actor: unknown, context: { previous: { hp: number } }) => {
        queueNativeEvent(f.state.vm, f.state.events, "game", "hookEvent", {});
        context.previous.hp = 999;
        throw new Error("stats hook refused");
      },
    }],
    ["revive mutates its input then throws", {
      statsChanged: () => ({}),
      revive: () => { throw new Error("revive hook refused"); },
    }],
  ] as const) {
    hero.stats.hp = 0;
    const canonical = JSON.stringify(f.state.actors);
    f.hooks = hooks as ActorHooks;
    const stagedQueue = f.state.events.queue.length;
    const refused = f.ports.inventory.commitItemAction(request, selection, { programStarted: false });
    equal(refused.status, "refused", name);
    equal(refused.error?.path, "actors", name);
    equal(JSON.stringify(f.state.actors), canonical, `${name}: canonical stats are untouched`);
    equal(f.state.events.queue.length, stagedQueue, `${name}: the staged event is discarded`);
  }
  f.hooks = {};
});

test("an empty-slot replacement emits only the incoming itemRemoved and runs no remove hook", () => {
  const f = fixture();
  const hero = liveHero(f);
  const sword = give(f, SWORD, "Sword", 2);
  const request: ItemActionRequest = { kind: "replace", entryId: sword, actorId: hero.id, slot: "right-hand" };
  const selection = selectionOf(f, request);
  deepEqual(f.ports.inventory.itemActionHooks(request, selection), {
    use: null,
    remove: null,
    equip: { program: "sword-equip.prg", item: { source: SWORD, handle: "Sword", entryId: sword, name: "Sword", description: "sharp" } },
  });
  const events = f.inventoryEvents.length;
  deepEqual(f.ports.inventory.commitItemAction(request, selection, { programStarted: false }), { status: "complete", error: null });
  deepEqual(f.inventoryEvents.slice(events), [
    { type: "itemRemoved", detail: { entryId: sword, source: SWORD, handle: "Sword", amount: 1, previousQuantity: 2, currentQuantity: 1 } },
  ]);
  equal(hero.equipment.equipped.length, 1);
});

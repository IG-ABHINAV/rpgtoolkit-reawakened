/**
 * Asset-aware equipment consistency for recovery candidates (#797;
 * docs/spec/formats/save-game.md#game-ledger-and-savable-continuation,
 * docs/spec/engine/plugins-and-battle.md#e-82).
 *
 * The fixtures build the expected references from the documented tuple format,
 * not from the implementation, so a derivation change fails here.
 */
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  applyEquipment,
  checkEquipmentConsistency,
  createActorService,
  createEmptyCharacter,
  createEmptyItem,
  createGameState,
  createMenuOwnerPorts,
  type ActorRecord,
  type ActorsSection,
  type Character,
  type EquipmentAssetLookup,
  type EquipmentItemDefinition,
  type Item,
  type InventorySection,
} from "../src/index.ts";

function reference(actorId: number, slot: string, itemId: number): string {
  return `tkr-equipment:${JSON.stringify([actorId, slot, itemId])}`;
}

function sword(): Item {
  return {
    ...createEmptyItem(),
    name: "Sword",
    equipable: 1,
    usedBy: 0,
    equipSlots: [0, 0, 0, 1, 1, 0, 0, 0],
    equipBonus: [2, 1, 1, 3],
  };
}

function hero(): Character {
  return { ...createEmptyCharacter(), name: "Hero", bodySlots: [0, 1, 1, 1, 1, 1, 1] };
}

function assets(item: Item = sword(), character: Character = hero()): EquipmentAssetLookup {
  return {
    item: (source) => (source === "item/sword.itm" ? item : undefined),
    character: (source) => (source === "hero.tem" ? character : undefined),
  };
}

function partyActor(kind: "party" | "enemy" = "party"): ActorRecord {
  const state = createGameState({ seed: 7 });
  return addActor(state.actors, { kind, source: "hero.tem", name: "Hero" });
}

/** One equippable stack in the right hand, already consumed by the equip action (E-81). */
function inventory(actorId: number): InventorySection {
  return {
    version: 2,
    nextId: 2,
    items: [{ id: 1, source: "item/sword.itm", handle: "Sword", quantity: 0 }],
    equipment: [{ actorId, slot: "right-hand", itemId: 1 }],
    gold: 0,
  };
}

function stateWith(actor: ActorRecord): ActorsSection {
  return { version: 2, nextId: actor.id + 1, actors: [actor] };
}

function project(actor: ActorRecord, equipped: string[], bonuses = { hp: 0, dp: 0, fp: 0, smp: 0 }): void {
  actor.equipment = { equipped, bonuses };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("compatible assets and a consistent projection validate without side effects", () => {
  const actor = partyActor();
  const expected = reference(actor.id, "right-hand", 1);
  project(actor, [expected], { hp: 2, dp: 1, fp: 1, smp: 3 });
  actor.stats.hp = 41;
  actor.stats.maxHp = 60;
  const inventorySection = inventory(actor.id);
  const actors = stateWith(actor);
  const stats = { ...actor.stats };
  const before = JSON.stringify({ inventorySection, actors });
  deepFreeze(inventorySection);
  deepFreeze(actors);
  const result = checkEquipmentConsistency(inventorySection, actors, assets());
  deepEqual(result, { ok: true, error: null });
  deepEqual(actor.stats, stats);
  equal(JSON.stringify({ inventorySection, actors }), before);
});

test("an unknown actor id is refused with the tuple path", () => {
  const actor = partyActor();
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(99), stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].actorId");
});

test("a non-party actor tuple is refused", () => {
  const actor = partyActor("enemy");
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].actorId");
});

test("an unrecognised slot is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const inventorySection = inventory(actor.id);
  inventorySection.equipment = [{ actorId: actor.id, slot: "weapon", itemId: 1 }];
  const result = checkEquipmentConsistency(inventorySection, stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].slot");
});

test("a duplicate actor slot is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const inventorySection = inventory(actor.id);
  inventorySection.equipment = [
    { actorId: actor.id, slot: "right-hand", itemId: 1 },
    { actorId: actor.id, slot: "right-hand", itemId: 1 },
  ];
  const result = checkEquipmentConsistency(inventorySection, stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[1].slot");
});

test("a missing inventory stack is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const inventorySection = inventory(actor.id);
  inventorySection.equipment = [{ actorId: actor.id, slot: "right-hand", itemId: 4 }];
  const result = checkEquipmentConsistency(inventorySection, stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].itemId");
});

test("a missing item definition is refused without substituting a default", () => {
  const actor = partyActor();
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), {
    item: () => undefined,
    character: () => hero(),
  });
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].itemId");
  ok(result.error?.message.includes("item/sword.itm"));
  deepEqual(actor.equipment, { equipped: [], bonuses: { hp: 0, dp: 0, fp: 0, smp: 0 } });
});

test("a malformed item definition is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets({ ...sword(), equipBonus: [1, 2] }));
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].itemId");
});

test("a missing character definition is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), {
    item: () => sword(),
    character: () => undefined,
  });
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].actorId");
  ok(result.error?.message.includes("hero.tem"));
});

test("a malformed character definition is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets(sword(), { ...hero(), bodySlots: [0, 1] }));
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].actorId");
});

test("an ineligible item, character and slot combination is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const ineligible = [
    { ...sword(), equipable: 0 },
    { ...sword(), equipSlots: [0, 0, 0, 0, 0, 0, 0, 0] },
  ];
  for (const item of ineligible) {
    const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets(item));
    equal(result.ok, false);
    equal(result.error?.path, "inventory.equipment[0].slot");
  }
  const character = { ...hero(), bodySlots: [0, 1, 1, 1, 0, 1, 1] };
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets(sword(), character));
  equal(result.ok, false);
  equal(result.error?.path, "inventory.equipment[0].slot");
});

test("duplicate item filenames in distinct slots validate with distinct references", () => {
  const actor = partyActor();
  const right = reference(actor.id, "right-hand", 1);
  const left = reference(actor.id, "left-hand", 2);
  project(actor, [right, left], { hp: 4, dp: 2, fp: 2, smp: 6 });
  const inventorySection = inventory(actor.id);
  inventorySection.nextId = 3;
  inventorySection.items = [
    { id: 1, source: "item/sword.itm", handle: "Sword", quantity: 0 },
    { id: 2, source: "item/sword.itm", handle: "Sword (bound)", quantity: 1 },
  ];
  inventorySection.equipment = [
    { actorId: actor.id, slot: "right-hand", itemId: 1 },
    { actorId: actor.id, slot: "left-hand", itemId: 2 },
  ];
  deepEqual(checkEquipmentConsistency(inventorySection, stateWith(actor), assets()), { ok: true, error: null });
});

test("reordered saved references are refused", () => {
  const actor = partyActor();
  const right = reference(actor.id, "right-hand", 1);
  const left = reference(actor.id, "left-hand", 2);
  project(actor, [left, right], { hp: 4, dp: 2, fp: 2, smp: 6 });
  const inventorySection = inventory(actor.id);
  inventorySection.nextId = 3;
  inventorySection.items = [
    { id: 1, source: "item/sword.itm", handle: "Sword", quantity: 0 },
    { id: 2, source: "item/sword.itm", handle: "Sword (bound)", quantity: 1 },
  ];
  inventorySection.equipment = [
    { actorId: actor.id, slot: "right-hand", itemId: 1 },
    { actorId: actor.id, slot: "left-hand", itemId: 2 },
  ];
  const result = checkEquipmentConsistency(inventorySection, stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "actors.actors[0].equipment.equipped");
});

test("a missing saved reference behind an inventory tuple is refused", () => {
  const actor = partyActor();
  project(actor, []);
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "actors.actors[0].equipment.equipped");
});

test("changed item bonuses are refused without rewriting saved progress", () => {
  const actor = partyActor();
  project(actor, [reference(actor.id, "right-hand", 1)], { hp: 2, dp: 1, fp: 1, smp: 3 });
  actor.stats.hp = 41;
  const before = JSON.stringify({ actor });
  const items = sword();
  const changed = { ...items, equipBonus: [5, 0, 0, 0] };
  const result = checkEquipmentConsistency(inventory(actor.id), stateWith(actor), assets(changed));
  equal(result.ok, false);
  equal(result.error?.path, "actors.actors[0].equipment.bonuses");
  equal(JSON.stringify({ actor }), before);
});

test("a legacy nonempty saved projection without inventory tuples is refused, not reset", () => {
  const actor = partyActor();
  project(actor, [reference(actor.id, "right-hand", 1)], { hp: 2, dp: 1, fp: 1, smp: 3 });
  const before = JSON.stringify({ actor });
  const empty = { version: 2, nextId: 1, items: [], equipment: [], gold: 0 } satisfies InventorySection;
  const result = checkEquipmentConsistency(empty, stateWith(actor), assets());
  equal(result.ok, false);
  equal(result.error?.path, "actors.actors[0].equipment");
  equal(JSON.stringify({ actor }), before);

  const bonusesOnly = partyActor();
  project(bonusesOnly, [], { hp: 2, dp: 1, fp: 1, smp: 3 });
  const onlyBonuses = checkEquipmentConsistency(empty, stateWith(bonusesOnly), assets());
  equal(onlyBonuses.ok, false);
  equal(onlyBonuses.error?.path, "actors.actors[0].equipment");
});

test("an empty inventory and an unprojected actor are consistent", () => {
  const actor = partyActor();
  const empty = { version: 2, nextId: 1, items: [], equipment: [], gold: 0 } satisfies InventorySection;
  deepEqual(checkEquipmentConsistency(empty, stateWith(actor), assets()), { ok: true, error: null });
});

test("a composed item replacement publishes a projection checkEquipmentConsistency accepts", () => {
  const state = createGameState({ seed: 13 });
  const actor = addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
  state.party.members = [actor.id];
  state.party.selected = actor.id;
  const item = sword();
  const character = hero();
  const service = createActorService(state.actors);
  const runtime = {
    item: (source: string) => source === "item/sword.itm" ? item : undefined,
    character: () => character,
    applyEquipment: (actorId: number, equipped: readonly string[], catalog: readonly EquipmentItemDefinition[]) =>
      service.applyEquipment(actorId, equipped, catalog) !== null,
    prepareEquipment: (actorId: number, equipped: readonly string[], catalog: readonly EquipmentItemDefinition[]) =>
      service.prepareEquipment(actorId, equipped, catalog),
    commitPreparedEquipment: (prepared: Parameters<typeof service.commitPreparedEquipment>[0]) =>
      service.commitPreparedEquipment(prepared) !== null,
    discardPreparedEquipment: (prepared: Parameters<typeof service.discardPreparedEquipment>[0]) =>
      service.discardPreparedEquipment(prepared),
  };
  const ports = createMenuOwnerPorts(state, undefined, runtime);
  ok(ports.inventory.apply({ type: "addItem", source: "item/sword.itm", handle: "Sword", amount: 1 }).ok);
  const equippedId = state.inventory.items[0]!.id;
  ok(ports.inventory.apply({ type: "equip", actorId: actor.id, slot: "right-hand", entryId: equippedId }).ok);
  ok(ports.inventory.apply({ type: "addItem", source: "item/sword.itm", handle: "Sword 2", amount: 1 }).ok);
  const incomingId = state.inventory.items[1]!.id;
  const request = { kind: "replace" as const, entryId: incomingId, actorId: actor.id, slot: "right-hand" };
  const preflight = ports.inventory.preflightItemAction(request);
  ok(preflight.ok, "the composed replacement preflights");
  deepEqual(
    ports.inventory.commitItemAction(request, preflight.selection, { programStarted: true }),
    { status: "complete", error: null },
  );
  equal(state.inventory.equipment[0]?.itemId, incomingId, "the composed replacement changed the tuple");
  deepEqual(checkEquipmentConsistency(state.inventory, state.actors, runtime), { ok: true, error: null });
});

test("a renamed actor keeps a consistent projection after an allowed equip", () => {
  const state = createGameState({ seed: 11 });
  const actor = addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
  const item = { ...sword(), usedBy: 1, allowedCharacters: ["Hero"] };
  const character = hero();
  const runtime = {
    item: () => item,
    character: () => character,
    applyEquipment: (actorId: number, equipped: readonly string[], catalog: readonly EquipmentItemDefinition[]) =>
      applyEquipment(state.actors, actorId, equipped, catalog) !== null,
  };
  const ports = createMenuOwnerPorts(state, undefined, runtime);
  ok(ports.inventory.apply({ type: "addItem", source: "item/sword.itm", handle: "Sword", amount: 1 }).ok);
  const entryId = state.inventory.items[0]!.id;
  ok(ports.inventory.apply({ type: "equip", actorId: actor.id, slot: "right-hand", entryId }).ok);
  equal(state.actors.actors[0]!.name, "Hero");
  equal(state.actors.actors[0]!.equipment.equipped.length, 1);

  // The actor name is script-writable progress: a later rename must not
  // invalidate the saved projection even though the item lists "Hero".
  const service = createActorService(state.actors);
  ok(service.rename(actor.id, "Renamed Hero") !== null);
  equal(state.actors.actors[0]!.name, "Renamed Hero");
  deepEqual(checkEquipmentConsistency(state.inventory, state.actors, runtime), { ok: true, error: null });

  // The live equip path still enforces the usedBy name list against the current name.
  ok(ports.inventory.apply({ type: "addItem", source: "item/sword.itm", handle: "Sword", amount: 1 }).ok);
  const secondEntry = state.inventory.items[0]!.id;
  const refused = ports.inventory.apply({ type: "equip", actorId: actor.id, slot: "left-hand", entryId: secondEntry });
  equal(refused.ok, false);
  equal(refused.error?.path, "inventory.action.eligibility");
});

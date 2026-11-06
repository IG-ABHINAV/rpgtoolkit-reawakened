import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  advanceScriptTick,
  addActor,
  applyMenuStateEffect,
  createAssetIndex,
  createEngine,
  createEmptyBoard,
  createGameState,
  startProgram,
  hashGameState,
  PACKAGE_ROOT,
  restoreGameState,
  createInventorySection,
  createMenuOwnerPorts,
  createMenuSection,
  createPartySection,
  PARTY_SCHEMA_VERSION,
  INVENTORY_SCHEMA_VERSION,
  MENU_SCHEMA_VERSION,
  snapshot,
  writeBoard,
  validateInventorySection,
  createEmptyCharacter,
  writeCharacter,
  createEmptyItem,
  applyEquipment,
  validateMenuSection,
  validatePartySection,
  type EffectRecord,
  type Engine,
  type GameState,
  type PartyEvent,
  type PluginDefinition,
  type ResolvedPlugin,
  type ScriptError,
} from "../src/index.ts";
import { slotLocation, slotTokenAt } from "../src/menu/equipment.ts";
import { createScriptServices } from "./script-test-services.ts";
import { writeItem } from "../src/formats/actor/item.ts";
import { INVENTORY_COMMANDS } from "../src/script/packs/inventory.ts";
import { runWaitsPhase } from "../src/script/vm.ts";
import { defaultWaitPoll } from "../src/script/waits.ts";
import { createShopSessionRuntime } from "../src/engine/shop-session.ts";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "menu");
const saveFixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "save");

function issue(value: { readonly path: string; readonly message: string } | null): void {
  ok(value !== null);
  ok(value.path.length > 0);
  ok(value.message.length > 0);
}

function rejected(result: { readonly ok: boolean; readonly error: { readonly path: string; readonly message: string } | null }): void {
  equal(result.ok, false);
  issue(result.error);
}

function actorState(): GameState {
  const state = createGameState({ seed: 91 });
  addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
  addActor(state.actors, { kind: "party", source: "mage.tem", name: "Mage" });
  return state;
}

function fixture(name: string): string {
  return readFileSync(join(saveFixtureDirectory, name), "utf8");
}

test("every editor equipment location names its slot token and back, and no other value names a slot", () => {
  const expected = ["head", "neck", "right-hand", "left-hand", "body", "legs",
    "accessory-7", "accessory-8", "accessory-9", "accessory-10", "accessory-11", "accessory-12",
    "accessory-13", "accessory-14", "accessory-15", "accessory-16"];
  for (const [index, token] of expected.entries()) {
    const location = index + 1;
    equal(slotTokenAt(location), token, `${location} names ${token}`);
    equal(slotLocation(token), location, `${token} is location ${location}`);
    equal(slotLocation(slotTokenAt(location)!), location, `${location} round-trips`);
  }
  for (const location of [0, 17, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    equal(slotTokenAt(location), null, `${location} names no slot`);
  }
  for (const token of ["", "head ", "accessory-6", "accessory-17", "accessory", "accessory-x"]) {
    equal(slotLocation(token), null, `"${token}" names no location`);
  }
});

test("fresh party, inventory and menu sections are exact plain JSON values", () => {
  equal(PARTY_SCHEMA_VERSION, 3);
  equal(INVENTORY_SCHEMA_VERSION, 2);
  equal(MENU_SCHEMA_VERSION, 2);
  const party = createPartySection();
  const inventory = createInventorySection();
  const menu = createMenuSection();
  deepEqual(party, { version: 3, members: [], selected: null, steps: 0, stepRemainder: 0 });
  deepEqual(inventory, { version: 2, nextId: 1, items: [], equipment: [], gold: 0 });
  deepEqual(menu, { version: 2, screens: [], graphic: null });
  deepEqual(JSON.parse(JSON.stringify(party)), party);
  deepEqual(JSON.parse(JSON.stringify(inventory)), inventory);
  deepEqual(JSON.parse(JSON.stringify(menu)), menu);
});

test("validators reject malformed fields, duplicates and dead actor or item references", () => {
  const state = actorState();
  const actorIds = state.actors.actors.map((actor) => actor.id);
  const party = createPartySection();
  const inventory = createInventorySection();
  const menu = createMenuSection();

  issue(validatePartySection({ members: [actorIds[0], actorIds[0]], selected: actorIds[0], steps: 0 }, state.actors));
  issue(validatePartySection({ ...party, members: [999], selected: 999 }, state.actors));
  const sixIds = [...actorIds, ...Array.from({ length: 4 }, (_, index) =>
    addActor(state.actors, { kind: "party", source: `extra-${index}.tem` }).id)];
  issue(validatePartySection({ ...party, members: sixIds, selected: sixIds[0] }, state.actors));
  issue(validatePartySection({ ...party, selected: undefined }, state.actors));
  issue(validatePartySection({ ...party, steps: -1 }, state.actors));
  issue(validatePartySection({ ...party, stepRemainder: -1 }, state.actors));
  issue(validatePartySection({ ...party, stepRemainder: 8192 }, state.actors));
  issue(validateInventorySection({ ...inventory, items: [{ id: 1, source: "a.itm", handle: "A", quantity: -1 }] }, state.actors));
  issue(validateInventorySection({ ...inventory, items: [{ id: 1, source: "a.itm", handle: "A", quantity: 0 }, { id: 1, source: "b.itm", handle: "B", quantity: 1 }] }, state.actors));
  issue(validateInventorySection({ ...inventory, items: [{ id: 1, source: "a.itm", handle: "A", quantity: 0 }, { id: 2, source: "a.itm", handle: "A", quantity: 1 }], nextId: 3 }, state.actors));
  issue(validateInventorySection({ ...inventory, gold: -1 }, state.actors));
  issue(validateInventorySection({ ...inventory, items: [{ id: 1, source: "a.itm", handle: "A", quantity: 1 }], equipment: [{ actorId: 999, slot: "weapon", itemId: 1 }], nextId: 2 }, state.actors));
  issue(validateInventorySection({ ...inventory, items: [{ id: 1, source: "a.itm", handle: "A", quantity: 1 }], equipment: [{ actorId: actorIds[0], slot: "weapon", itemId: 1 }, { actorId: actorIds[0], slot: "weapon", itemId: 1 }], nextId: 2 }, state.actors));
  issue(validateInventorySection({ ...inventory, items: [{ id: 1, source: "a.itm", handle: "A", quantity: 1 }], equipment: [{ actorId: actorIds[0], slot: "weapon", itemId: 2 }], nextId: 2 }, state.actors));
  issue(validateMenuSection({ version: 2, screens: [{ screen: "status", actorId: 999, selection: 0 }], graphic: null }, state.actors));
  issue(validateMenuSection({ version: 2, screens: [{ screen: "", actorId: null, selection: 0 }], graphic: null }, state.actors));
  issue(validateMenuSection({ version: 2, screens: [{ screen: "status", actorId: null, selection: -1 }], graphic: null }, state.actors));
  issue(validateMenuSection({ version: 2, screens: [], graphic: undefined }, state.actors));
  equal(validatePartySection(party, state.actors), null);
  equal(validateInventorySection(inventory, state.actors), null);
  equal(validateMenuSection(menu, state.actors), null);
});

test("owner actions isolate sections and reject invalid actions atomically", () => {
  const state = actorState();
  const ports = createMenuOwnerPorts(state);
  const actorId = state.actors.actors[0]!.id;
  const actorBefore = JSON.stringify(state.actors);
  const vmBefore = JSON.stringify(state.vm);
  const timeBefore = JSON.stringify(state.time);
  const partyAction = { type: "roster" as const, members: [actorId], selected: actorId };
  const inventoryAction = { type: "addItem" as const, source: "item/potion.itm", handle: "Potion", amount: 2 };
  const menuAction = { type: "navigation" as const, screens: [{ screen: "status", actorId, selection: 1 }] };
  const inventoryBeforeParty = JSON.stringify(state.inventory);
  const menuBeforeParty = JSON.stringify(state.menu);
  deepEqual(ports.party.apply(partyAction), { ok: true, error: null });
  deepEqual(ports.party.apply({ type: "steps", value: 3 }), { ok: true, error: null });
  equal(JSON.stringify(state.inventory), inventoryBeforeParty);
  equal(JSON.stringify(state.menu), menuBeforeParty);
  const partyBeforeInventory = JSON.stringify(state.party);
  const menuBeforeInventory = JSON.stringify(state.menu);
  deepEqual(ports.inventory.apply(inventoryAction), { ok: true, error: null });
  deepEqual(ports.inventory.apply({ type: "addGold", amount: 17 }), { ok: true, error: null });
  equal(JSON.stringify(state.party), partyBeforeInventory);
  equal(JSON.stringify(state.menu), menuBeforeInventory);
  const partyBeforeMenu = JSON.stringify(state.party);
  const inventoryBeforeMenu = JSON.stringify(state.inventory);
  deepEqual(ports.menu.apply(menuAction), { ok: true, error: null });
  deepEqual(ports.menu.apply({ type: "graphic", value: "menu.png" }), { ok: true, error: null });
  equal(JSON.stringify(state.party), partyBeforeMenu);
  equal(JSON.stringify(state.inventory), inventoryBeforeMenu);
  equal(state.party.members.length, 1);
  equal(state.party.steps, 3);
  equal(state.inventory.gold, 17);
  equal(state.inventory.equipment.length, 0);
  equal(state.menu.screens.length, 1);
  equal(state.menu.graphic, "menu.png");
  equal(JSON.stringify(state.actors), actorBefore);
  equal(JSON.stringify(state.vm), vmBefore);
  equal(JSON.stringify(state.time), timeBefore);
  const unchanged = snapshot(state);
  rejected(ports.party.apply({ type: "roster", members: [actorId, actorId], selected: actorId }));
  equal(snapshot(state), unchanged);
  rejected(ports.party.apply({ type: "steps", value: undefined } as never));
  equal(snapshot(state), unchanged);
  rejected(ports.party.apply({ type: "steps" } as never));
  equal(snapshot(state), unchanged);
  rejected(ports.inventory.apply({ type: "addItem", source: "item/potion.itm", handle: "Potion", amount: 0 }));
  equal(snapshot(state), unchanged);
  rejected(ports.inventory.apply({ type: "addItem", source: "item/potion.itm", handle: "Potion", amount: 1.5 }));
  equal(snapshot(state), unchanged);
  rejected(ports.inventory.apply({ type: "unequip", actorId, slot: "accessory-17" }));
  equal(snapshot(state), unchanged);
  rejected(ports.inventory.apply({ type: "addGold", amount: Number.MAX_SAFE_INTEGER }));
  equal(snapshot(state), unchanged);
  rejected(ports.menu.apply({ type: "navigation", screens: undefined } as never));
  equal(snapshot(state), unchanged);
  rejected(ports.menu.apply({ type: "navigation", screens: [{ screen: "status", actorId: 999, selection: 0 }] }));
  equal(snapshot(state), unchanged);
});

test("menu updateCurrent atomically updates only the active frame and refuses an empty stack", () => {
  const state = actorState();
  const ports = createMenuOwnerPorts(state);
  const [first, second] = state.actors.actors;
  if (first === undefined || second === undefined) throw new Error("actor fixture is incomplete");
  const before = snapshot(state);
  deepEqual(ports.menu.apply({ type: "updateCurrent", actorId: first.id, selection: 2 }), {
    ok: false,
    error: { path: "menu.screens", message: "no active menu frame" },
  });
  equal(snapshot(state), before);
  ports.menu.apply({ type: "navigation", screens: [
    { screen: "main", actorId: null, selection: 0 },
    { screen: "items", actorId: null, selection: 0 },
  ] });
  deepEqual(ports.menu.apply({ type: "updateCurrent", actorId: second.id, selection: 9 }), { ok: true, error: null });
  deepEqual(state.menu.screens, [
    { screen: "main", actorId: null, selection: 0 },
    { screen: "items", actorId: second.id, selection: 9 },
  ]);
  const unchanged = snapshot(state);
  rejected(ports.menu.apply({ type: "updateCurrent", actorId: 999, selection: 0 }));
  rejected(ports.menu.apply({ type: "updateCurrent", actorId: first.id, selection: -1 }));
  equal(snapshot(state), unchanged);
});
test("authored RPGCode party operations preserve actor identity and emit only committed events", () => {
  const state = createGameState({ seed: 21 });
  const first = addActor(state.actors, { kind: "party", source: "first.tem", name: "First" });
  const second = addActor(state.actors, { kind: "party", source: "second.tem", name: "Second" });
  const third = addActor(state.actors, { kind: "party", source: "third.tem", name: "Third" });
  state.party.members = [first.id, second.id];
  state.party.selected = first.id;
  const events: PartyEvent[] = [];
  const ports = createMenuOwnerPorts(state, (event) => events.push(event));
  const services = createScriptServices(state);
  const program = readFileSync(join(fixtureDirectory, "party-operations.prg"), "utf8").split("\n").filter((line) => !line.startsWith("newplyr(") && !line.startsWith("newplayer(")).join("\n");
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  let lastEffect = 0;
  for (let tick = 0; tick < 24; tick += 1) {
    advanceScriptTick(state, services);
    for (const effect of state.vm.effects) {
      if (effect.seq <= lastEffect) continue;
      lastEffect = effect.seq;
      if (["activeplayer", "addplayer", "removeplayer", "restoreplayer", "destroyplayer"].includes(effect.name)) {
        applyMenuStateEffect(ports, effect);
      }
    }
  }
  deepEqual(state.party.members, [first.id, third.id]);
  equal(state.party.selected, third.id);
  equal(state.actors.actors.some((actor) => actor.id === second.id), false);
  deepEqual(events, [
    { type: "memberAdded", detail: { actorId: third.id, index: 2 } },
    { type: "activeMemberChanged", detail: { previousActorId: first.id, currentActorId: second.id } },
    { type: "memberRemoved", detail: { actorId: second.id, index: 1 } },
    { type: "activeMemberChanged", detail: { previousActorId: second.id, currentActorId: third.id } },
    { type: "memberAdded", detail: { actorId: second.id, index: 2 } },
    { type: "memberRemoved", detail: { actorId: second.id, index: 2 } },
  ]);
  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.party, state.party);
  deepEqual(restored.actors, state.actors);
});

test("headless RPGCode Inn restores every active party member without changing unrelated state", () => {
  const holder: { value: GameState | null } = { value: null };
  let seeded = false;
  const engine = createEngine({
    seed: 23,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 24,
    program: readFileSync(join(fixtureDirectory, "inn-operations.prg"), "utf8"),
    phaseRegistrations: [{ phase: "input", run: (state) => {
      holder.value = state;
      if (seeded) return;
      seeded = true;
      const fallen = addActor(state.actors, { kind: "party", source: "fallen.tem", name: "Fallen" });
      const tired = addActor(state.actors, { kind: "party", source: "tired.tem", name: "Tired" });
      state.party.members = [fallen.id, tired.id];
      state.party.selected = fallen.id;
      fallen.stats = { ...fallen.stats, hp: 0, maxHp: 45, smp: 0, maxSmp: 17 };
      tired.stats = { ...tired.stats, hp: 12, maxHp: 38, smp: 3, maxSmp: 11 };
      fallen.statuses.poison = 4;
      tired.statuses.sleep = 2;
      state.inventory.gold = 29;
    }}],
  });
  runEngine(engine);
  const state = holder.value;
  if (state === null) throw new Error("Inn fixture did not reach the input phase");
  deepEqual(state.party.members, [1, 2]);
  equal(state.party.selected, 1);
  deepEqual(state.actors.actors.map(({ stats }) => [stats.hp, stats.maxHp, stats.smp, stats.maxSmp]), [[45, 45, 17, 17], [38, 38, 11, 11]]);
  deepEqual(state.actors.actors.map(({ statuses }) => statuses), [{ poison: 4 }, { sleep: 2 }]);
  equal(state.inventory.gold, 29);
  deepEqual(state.inventory.items, []);
});
test("headless RPGCode CallShop resolves filename assets and parks until the menu closes", () => {
  const itemBytes = (name: string): Uint8Array => {
    const result = writeItem({
      ...createEmptyItem(),
      minor: 3,
      legacyWalk: { frames: Array.from({ length: 16 }, () => ({ top: "", bottom: "" })), restTiles: ["", ""] },
      name,
      buyPrice: 2,
      sellPrice: 1,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const holder: { value: GameState | null } = { value: null };
  const engine = createEngine({
    seed: 24,
    assetIndex: createAssetIndex(["Boards/test.brd", "Item/potion.itm", "Item/elixir.itm"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 8,
    program: readFileSync(join(fixtureDirectory, "shop-operations.prg"), "utf8"),
    phaseRegistrations: [{ phase: "input", run: (state) => { holder.value = state; } }],
  });
  runEngine(engine, new Map([
    ["boards/test.brd", boardBytes],
    ["item/potion.itm", itemBytes("Potion")],
    ["item/elixir.itm", itemBytes("Elixir")],
  ]));
  const state = holder.value;
  if (state === null) throw new Error("CallShop fixture did not reach the input phase");
  const sources = ["item/potion.itm", "item/elixir.itm"];
  const activeWaiter = state.vm.threads.find((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === "callshop");
  if (activeWaiter?.wait?.kind !== "menu.screen") throw new Error("CallShop did not park on its menu wait");
  deepEqual(activeWaiter.wait.payload, [sources]);
  equal(state.vm.globals.shopreturned, undefined, "the RPGCode call resumes only after the menu closes");

  const restored = restoreGameState(snapshot(state));
  const restoredWaiter = restored.vm.threads.find((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === "callshop");
  if (restoredWaiter?.wait?.kind !== "menu.screen") throw new Error("restored CallShop waiter is missing");
  const restoredShop = createShopSessionRuntime(() => restored.vm.threads);
  const restoredPorts = createMenuOwnerPorts(restored, undefined, {
    item: () => undefined,
    character: () => undefined,
    applyEquipment: () => true,
    shopStock: restoredShop.stock,
    setShopStock: restoredShop.setStock,
    closeShop: restoredShop.close,
  });
  deepEqual(restoredPorts.shop.stock(), sources);
  runWaitsPhase(restored.vm, { tick: restored.time.tick, shopStock: restoredPorts.shop.stock() }, defaultWaitPoll);
  equal(restoredWaiter.status, "waiting", "restored CallShop remains parked while stock is active");

  const duplicate = restoreGameState(snapshot(restored));
  const duplicateWaiter = duplicate.vm.threads.find((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === "callshop");
  if (duplicateWaiter?.wait?.kind !== "menu.screen") throw new Error("duplicate fixture lacks its original waiter");
  const duplicateCopy = JSON.parse(JSON.stringify(duplicateWaiter)) as NonNullable<typeof duplicateWaiter>;
  duplicateCopy.id = Math.max(...duplicate.vm.threads.map((thread) => thread.id)) + 1;
  duplicate.vm.threads.push(duplicateCopy);
  const duplicateShop = createShopSessionRuntime(() => duplicate.vm.threads);
  equal(duplicateShop.setStock(sources), false, "a second CallShop cannot activate over an existing session");
  deepEqual(duplicateShop.stock(), [], "ambiguous duplicate waiters fail closed");
  duplicateShop.close();
  deepEqual(duplicateWaiter.wait?.kind === "menu.screen" ? duplicateWaiter.wait.payload : null, []);
  deepEqual(duplicateCopy.wait?.kind === "menu.screen" ? duplicateCopy.wait.payload : null, [], "close invalidates every malformed duplicate waiter");
  duplicate.vm.threads = duplicate.vm.threads.filter((thread) => thread !== duplicateWaiter);
  deepEqual(duplicateShop.stock(), [], "the remaining waiter stays closed after the first waiter resolves");
  runWaitsPhase(duplicate.vm, { tick: duplicate.time.tick, shopStock: duplicateShop.stock() }, defaultWaitPoll);
  equal(duplicateCopy.status, "ready", "the remaining malformed waiter resumes closed");
  deepEqual(duplicateShop.stock(), [], "a resolved duplicate cannot reopen stock");

  const resetState = restoreGameState(snapshot(state));
  const resetWaiter = resetState.vm.threads.find((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === "callshop");
  if (resetWaiter?.wait?.kind !== "menu.screen") throw new Error("reset fixture lacks its CallShop waiter");
  const resetCopy = JSON.parse(JSON.stringify(resetWaiter)) as NonNullable<typeof resetWaiter>;
  const resetShop = createShopSessionRuntime(() => resetState.vm.threads);
  resetState.vm.threads = [];
  equal(resetShop.setStock(sources), true);
  resetState.vm.threads.push(resetCopy);
  deepEqual(resetShop.stock(), sources);
  resetState.vm.threads = [];
  resetShop.reset();
  deepEqual(resetShop.stock(), [], "engine reset clears closure-owned stock with the replaced VM");

  restoredPorts.shop.close();
  const closed = restoreGameState(snapshot(restored));
  const closedWaiter = closed.vm.threads.find((thread) => thread.wait?.kind === "menu.screen" && thread.wait.id === "callshop");
  if (closedWaiter?.wait?.kind !== "menu.screen") throw new Error("closed CallShop waiter was not persisted");
  const closedShop = createShopSessionRuntime(() => closed.vm.threads);
  const closedPorts = createMenuOwnerPorts(closed, undefined, {
    item: () => undefined,
    character: () => undefined,
    applyEquipment: () => true,
    shopStock: closedShop.stock,
    setShopStock: closedShop.setStock,
    closeShop: closedShop.close,
  });
  deepEqual(closedPorts.shop.stock(), []);
  runWaitsPhase(closed.vm, { tick: closed.time.tick, shopStock: closedPorts.shop.stock() }, defaultWaitPoll);
  equal(closedWaiter.status, "ready", "closed CallShop resumes after restore");
  equal(closedWaiter.wait, null);
  deepEqual(closedPorts.shop.stock(), [], "a restored closed shop does not reopen");
});

test("headless RPGCode smoke applies documented party commands through the engine owners", () => {
  const holder: { value: GameState | null } = { value: null };
  let seeded = false;
  const engine = createEngine({
    seed: 22,
    assetIndex: createAssetIndex(["Boards/test.brd", "Characters/third.tem", "Characters/graphic.tem"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 24,
    program: readFileSync(join(fixtureDirectory, "party-operations.prg"), "utf8"),
    phaseRegistrations: [{ phase: "input", run: (state) => {
      holder.value = state;
      if (seeded) return;
      seeded = true;
      const first = addActor(state.actors, { kind: "party", source: "first.tem", name: "First" });
      const second = addActor(state.actors, { kind: "party", source: "second.tem", name: "Second" });
      state.party.members = [first.id, second.id];
      state.party.selected = first.id;
    }}],
  });
  runEngine(engine, new Map([["boards/test.brd", boardBytes], ["characters/third.tem", thirdCharacterBytes], ["characters/graphic.tem", graphicCharacterBytes]]));
  const latest = holder.value;
  if (latest === null) throw new Error("headless party smoke did not reach the input phase");
  const first = latest.actors.actors.find((actor) => actor.source === "first.tem");
  const third = latest.actors.actors.find((actor) => actor.source === "third.tem");
  if (first === undefined || third === undefined) throw new Error("headless party actors were not preserved");
  deepEqual(latest.party.members, [first.id, third.id]);
  equal(latest.party.selected, third.id);
  equal(latest.vm.globals.selected, "Third", "party virtuals expose the ordered compatibility slot");
  equal(latest.actors.actors.some((actor) => actor.source === "second.tem"), false);
  const addedSprite = latest.sprites.players.find((player) => player.actorId === third.id);
  ok(addedSprite !== undefined, "added party actor has a linked sprite");
  equal(addedSprite?.source, "graphic.tem", "newplyr/newplayer load graphics without changing actor source");
});
test("party semantic actions preserve selection by actor identity and queue exact post-commit events", () => {
  const state = actorState();
  const events: PartyEvent[] = [];
  const ports = createMenuOwnerPorts(state, (event) => events.push(event));
  const [first, second] = state.actors.actors;
  if (first === undefined || second === undefined) throw new Error("party actor fixture is incomplete");

  deepEqual(ports.party.apply({ type: "add", actorId: first.id }), { ok: true, error: null });
  deepEqual(state.party.members, [first.id]);
  equal(state.party.selected, first.id);
  deepEqual(events.splice(0), [
    { type: "memberAdded", detail: { actorId: first.id, index: 0 } },
    { type: "activeMemberChanged", detail: { previousActorId: null, currentActorId: first.id } },
  ]);
  deepEqual(ports.party.apply({ type: "add", actorId: second.id }), { ok: true, error: null });
  deepEqual(ports.party.apply({ type: "select", actorId: second.id }), { ok: true, error: null });
  deepEqual(events.splice(0), [
    { type: "memberAdded", detail: { actorId: second.id, index: 1 } },
    { type: "activeMemberChanged", detail: { previousActorId: first.id, currentActorId: second.id } },
  ]);

  deepEqual(ports.party.apply({ type: "swap", firstActorId: first.id, secondActorId: second.id }), { ok: true, error: null });
  deepEqual(state.party.members, [second.id, first.id]);
  equal(state.party.selected, second.id);
  deepEqual(events.splice(0), [
    { type: "membersSwapped", detail: { firstActorId: first.id, secondActorId: second.id, firstIndex: 0, secondIndex: 1 } },
  ]);

  deepEqual(ports.party.apply({ type: "remove", actorId: second.id }), { ok: true, error: null });
  deepEqual(state.party.members, [first.id]);
  equal(state.party.selected, first.id);
  deepEqual(events.splice(0), [
    { type: "memberRemoved", detail: { actorId: second.id, index: 0 } },
    { type: "activeMemberChanged", detail: { previousActorId: second.id, currentActorId: first.id } },
  ]);
  deepEqual(ports.party.apply({ type: "restore", actorId: second.id }), { ok: true, error: null });
  deepEqual(state.party.members, [first.id, second.id]);
  deepEqual(events.splice(0), [{ type: "memberAdded", detail: { actorId: second.id, index: 1 } }]);

  const before = snapshot(state);
  deepEqual(ports.party.apply({ type: "restore", actorId: second.id }), { ok: true, error: null });
  deepEqual(ports.party.apply({ type: "select", actorId: first.id }), { ok: true, error: null });
  deepEqual(ports.party.apply({ type: "remove", actorId: 999 }), { ok: true, error: null });
  deepEqual(ports.party.apply({ type: "swap", firstActorId: first.id, secondActorId: first.id }), { ok: true, error: null });
  equal(snapshot(state), before);
  deepEqual(events, []);

  rejected(ports.party.apply({ type: "add", actorId: 999 }));
  equal(snapshot(state), before);
  deepEqual(events, []);
  const capped = actorState();
  const cappedIds = [...capped.actors.actors.map((value) => value.id)];
  for (let index = 0; index < 3; index += 1) cappedIds.push(addActor(capped.actors, { kind: "party", source: `extra-${index}.tem` }).id);
  const sixth = addActor(capped.actors, { kind: "party", source: "sixth.tem" });
  capped.party.members = cappedIds;
  capped.party.selected = cappedIds[0] ?? null;
  const capEvents: PartyEvent[] = [];
  const capPorts = createMenuOwnerPorts(capped, (event) => capEvents.push(event));
  const capBefore = snapshot(capped);
  rejected(capPorts.party.apply({ type: "add", actorId: sixth.id }));
  equal(snapshot(capped), capBefore);
  deepEqual(capEvents, []);
});

test("owner ports copy input and expose deeply immutable read views", () => {
  const state = actorState();
  const ports = createMenuOwnerPorts(state);
  const actorId = state.actors.actors[0]!.id;
  const screens = [{ screen: "status", actorId, selection: 2 }];
  deepEqual(ports.menu.apply({ type: "navigation", screens }), { ok: true, error: null });
  deepEqual(ports.inventory.apply({ type: "addItem", source: "item/potion.itm", handle: "Potion", amount: 1 }), { ok: true, error: null });
  screens[0]!.selection = 99;
  equal(state.menu.screens[0]!.selection, 2);
  equal(state.inventory.items[0]!.quantity, 1);
  const view = ports.menu.read() as unknown as { screens: Array<{ selection: number }> };
  try { view.screens[0]!.selection = 77; } catch { /* frozen views are expected */ }
  try { view.screens.push({ selection: 88 }); } catch { /* frozen views are expected */ }
  equal(state.menu.screens[0]!.selection, 2);
  equal(state.menu.screens.length, 1);
});

test("owner commits detach action arrays even when they alias the current section", () => {
  const state = actorState();
  const ports = createMenuOwnerPorts(state);
  const actorId = state.actors.actors[0]!.id;
  ports.party.apply({ type: "roster", members: [actorId], selected: actorId });
  const members = state.party.members;
  ports.party.apply({ type: "roster", members, selected: actorId });
  members.push(actorId);
  deepEqual(state.party.members, [actorId]);


  ports.menu.apply({ type: "navigation", screens: [{ screen: "items", actorId, selection: 0 }] });
  const screens = state.menu.screens;
  ports.menu.apply({ type: "navigation", screens });
  screens[0]!.selection = -1;
  equal(state.menu.screens[0]!.selection, 0);
});

test("inventory actions preserve stack identity, emit exact quantity events, and reject atomically", () => {
  const state = actorState();
  const events: { readonly type: string }[] = [];
  const ports = createMenuOwnerPorts(state, undefined, undefined, (event) => events.push(event));
  const added = { type: "addItem" as const, source: "Item/Potion.itm", handle: "Potion", amount: 1 };
  ok(ports.inventory.apply(added).ok);
  const entryId = state.inventory.items[0]!.id;
  equal(entryId, 1);
  equal(state.inventory.items[0]!.source, "item/potion.itm");
  ok(ports.inventory.apply({ ...added, amount: 2 }).ok);
  equal(state.inventory.items[0]!.id, entryId);
  equal(state.inventory.items[0]!.quantity, 3);
  equal(state.inventory.nextId, 2);
  ok(ports.inventory.apply({ type: "removeItem", entryId, amount: 1 }).ok);
  equal(state.inventory.items[0]!.quantity, 2);
  ok(ports.inventory.apply({ type: "removeItem", entryId, amount: 2 }).ok);
  equal(state.inventory.items.length, 0);
  const retired = snapshot(state);
  rejected(ports.inventory.apply({ type: "removeItem", entryId, amount: 1 }));
  equal(snapshot(state), retired);
  ok(ports.inventory.apply(added).ok);
  equal(state.inventory.items[0]!.id, 2);
  equal(state.inventory.nextId, 3);
  const beforeInvalidGold = snapshot(state);
  rejected(ports.inventory.apply({ type: "addGold", amount: -1 }));
  equal(snapshot(state), beforeInvalidGold);
  deepEqual(events, [
    { type: "itemAdded", detail: { entryId: 1, source: "item/potion.itm", handle: "Potion", amount: 1, previousQuantity: 0, currentQuantity: 1 } },
    { type: "itemAdded", detail: { entryId: 1, source: "item/potion.itm", handle: "Potion", amount: 2, previousQuantity: 1, currentQuantity: 3 } },
    { type: "itemRemoved", detail: { entryId: 1, source: "item/potion.itm", handle: "Potion", amount: 1, previousQuantity: 3, currentQuantity: 2 } },
    { type: "itemRemoved", detail: { entryId: 1, source: "item/potion.itm", handle: "Potion", amount: 2, previousQuantity: 2, currentQuantity: 0 } },
    { type: "itemAdded", detail: { entryId: 2, source: "item/potion.itm", handle: "Potion", amount: 1, previousQuantity: 0, currentQuantity: 1 } },
  ]);
});

test("shop buy and sell actions commit item and gold events atomically", () => {
  const state = actorState();
  state.inventory.gold = 20;
  const potion = { ...createEmptyItem(), name: "Potion", buyPrice: 3, sellPrice: 1 };
  const events: { readonly type: string; readonly detail: unknown }[] = [];
  const stock = ["item/potion.itm"];
  const ports = createMenuOwnerPorts(state, undefined, {
    item: (source) => source === stock[0] ? potion : undefined,
    character: () => undefined,
    applyEquipment: () => true,
    shopStock: () => stock,
  }, (event) => events.push(event));
  deepEqual(ports.shop.stock(), stock);
  ok(ports.inventory.apply({ type: "buyItem", source: stock[0]!, amount: 2 }).ok);
  const entryId = state.inventory.items[0]!.id;
  equal(state.inventory.items[0]!.quantity, 2);
  equal(state.inventory.gold, 14);
  const beforeUnavailable = snapshot(state);
  const unavailable = ports.inventory.apply({ type: "buyItem", source: "item/missing.itm", amount: 1 });
  deepEqual(unavailable.error, { path: "shop.stock", message: "item is not in the active shop stock" });
  equal(snapshot(state), beforeUnavailable);
  const beforeUnaffordable = snapshot(state);
  const unaffordable = ports.inventory.apply({ type: "buyItem", source: stock[0]!, amount: 5 });
  deepEqual(unaffordable.error, { path: "inventory.gold", message: "insufficient gold" });
  equal(snapshot(state), beforeUnaffordable);
  stock.length = 0;
  const beforeNoShop = snapshot(state);
  const noShop = ports.inventory.apply({ type: "sellItem", entryId, amount: 1 });
  deepEqual(noShop.error, { path: "shop.stock", message: "selling requires an active shop" });
  equal(snapshot(state), beforeNoShop);
  stock.push("item/potion.itm");
  ok(ports.inventory.apply({ type: "sellItem", entryId, amount: 1 }).ok);
  equal(state.inventory.items[0]!.quantity, 1);
  equal(state.inventory.gold, 15);
  const beforeTooMany = snapshot(state);
  rejected(ports.inventory.apply({ type: "sellItem", entryId, amount: 2 }));
  equal(snapshot(state), beforeTooMany);
  ok(ports.inventory.apply({ type: "sellItem", entryId, amount: 1 }).ok);
  equal(state.inventory.items.length, 0);
  equal(state.inventory.gold, 16);
  deepEqual(events, [
    { type: "itemAdded", detail: { entryId: 1, source: "item/potion.itm", handle: "Potion", amount: 2, previousQuantity: 0, currentQuantity: 2 } },
    { type: "goldChanged", detail: { previous: 20, current: 14, delta: -6 } },
    { type: "itemRemoved", detail: { entryId, source: "item/potion.itm", handle: "Potion", amount: 1, previousQuantity: 2, currentQuantity: 1 } },
    { type: "goldChanged", detail: { previous: 14, current: 15, delta: 1 } },
    { type: "itemRemoved", detail: { entryId, source: "item/potion.itm", handle: "Potion", amount: 1, previousQuantity: 1, currentQuantity: 0 } },
    { type: "goldChanged", detail: { previous: 15, current: 16, delta: 1 } },
  ]);
});
test("shop activation validates every canonical source before exposing ordered stock", () => {
  const state = actorState();
  const potion = { ...createEmptyItem(), name: "Potion", buyPrice: 2, sellPrice: 1 };
  const before = snapshot(state);
  let stock: readonly string[] = [];
  const ports = createMenuOwnerPorts(state, undefined, {
    item: (source) => source === "item/potion.itm" ? potion : undefined,
    character: () => undefined,
    applyEquipment: () => true,
    shopStock: () => stock,
    setShopStock: (sources) => { stock = [...sources]; },
  });
  const unavailable = ports.shop.activate(["Potion.itm", "Missing.itm"]);
  deepEqual(unavailable.error, { path: "shop.stock", message: "item definition is unavailable: item/missing.itm" });
  deepEqual(ports.shop.stock(), []);
  ok(ports.shop.activate(["Potion.itm", "item/POTION.ITM"]).ok);
  deepEqual(ports.shop.stock(), ["item/potion.itm", "item/potion.itm"]);
  equal(snapshot(state), before, "the ephemeral shop context is not saved in menu state");
  ports.shop.close();
  deepEqual(ports.shop.stock(), []);
});
test("active shops sell available inventory even when its item is not stocked", () => {
  const state = actorState();
  const potion = { ...createEmptyItem(), name: "Potion", buyPrice: 2, sellPrice: 1 };
  const elixir = { ...createEmptyItem(), name: "Elixir", buyPrice: 9, sellPrice: 4 };
  const events: { readonly type: string; readonly detail: unknown }[] = [];
  const ports = createMenuOwnerPorts(state, undefined, {
    item: (source) => source === "item/potion.itm" ? potion : source === "item/elixir.itm" ? elixir : undefined,
    character: () => undefined,
    applyEquipment: () => true,
    shopStock: () => ["item/potion.itm"],
  }, (event) => events.push(event));
  ok(ports.inventory.apply({ type: "addItem", source: "item/elixir.itm", handle: "Elixir", amount: 3 }).ok);
  const entryId = state.inventory.items[0]!.id;
  ok(ports.inventory.apply({ type: "sellItem", entryId, amount: 2 }).ok);
  equal(state.inventory.items[0]!.quantity, 1);
  equal(state.inventory.gold, 8);
  deepEqual(events.slice(1), [
    { type: "itemRemoved", detail: { entryId, source: "item/elixir.itm", handle: "Elixir", amount: 2, previousQuantity: 3, currentQuantity: 1 } },
    { type: "goldChanged", detail: { previous: 0, current: 8, delta: 8 } },
  ]);
});
test("shop rejects invalid quantities and arithmetic or inventory boundaries without mutation", () => {
  const state = actorState();
  const events: { readonly type: string }[] = [];
  let definition = { ...createEmptyItem(), name: "Potion", buyPrice: 0, sellPrice: 0 };
  const stock = ["item/potion.itm"];
  const ports = createMenuOwnerPorts(state, undefined, {
    item: () => definition,
    character: () => undefined,
    applyEquipment: () => true,
    shopStock: () => stock,
  }, (event) => events.push(event));
  ok(ports.inventory.apply({ type: "buyItem", source: stock[0]!, amount: 1 }).ok);
  equal(state.inventory.gold, 0);
  equal(events.length, 1, "zero-price trade emits no gold event");
  const entryId = state.inventory.items[0]!.id;
  state.inventory.items[0]!.quantity = Number.MAX_SAFE_INTEGER;
  const maxed = snapshot(state);
  const overflowQuantity = ports.inventory.apply({ type: "buyItem", source: stock[0]!, amount: 1 });
  equal(overflowQuantity.error?.path, "inventory.items.quantity");
  equal(snapshot(state), maxed);
  definition = { ...definition, buyPrice: -1 };
  const invalidBuyPrice = ports.inventory.apply({ type: "buyItem", source: stock[0]!, amount: 1 });
  equal(invalidBuyPrice.error?.path, "inventory.action.price");
  equal(snapshot(state), maxed);
  definition = { ...definition, buyPrice: Number.MAX_SAFE_INTEGER, sellPrice: 1 };
  state.inventory.gold = Number.MAX_SAFE_INTEGER;
  const costOverflow = ports.inventory.apply({ type: "buyItem", source: stock[0]!, amount: 2 });
  equal(costOverflow.error?.path, "inventory.gold");
  const goldBoundary = snapshot(state);
  const quantityInvalid = ports.inventory.apply({ type: "sellItem", entryId, amount: 0 });
  equal(quantityInvalid.error?.path, "inventory.action");
  equal(snapshot(state), goldBoundary);
  definition = { ...definition, sellPrice: Number.MAX_SAFE_INTEGER };
  const proceedsOverflow = ports.inventory.apply({ type: "sellItem", entryId, amount: 1 });
  equal(snapshot(state), goldBoundary);
  equal(proceedsOverflow.error?.path, "inventory.gold");
  equal(events.length, 1, "rejected trades emit no events");
});

test("existing ports follow section replacement and restored sections", () => {
  const state = actorState();
  const ports = createMenuOwnerPorts(state);
  const actorId = state.actors.actors[0]!.id;
  deepEqual(ports.party.apply({ type: "steps", value: 4 }), { ok: true, error: null });
  state.party = createPartySection();
  state.inventory = createInventorySection();
  state.menu = createMenuSection();
  equal(ports.party.read().steps, 0);
  equal(ports.inventory.read().gold, 0);
  equal(ports.menu.read().graphic, null);
  const restored = restoreGameState(snapshot(state));
  restored.party = { version: 3, members: [actorId], selected: actorId, steps: 8, stepRemainder: 0 };
  restored.inventory = { version: 2, nextId: 2, items: [{ id: 1, source: "potion.itm", handle: "Potion", quantity: 1 }], equipment: [], gold: 12 };
  restored.menu = { version: 2, screens: [{ screen: "status", actorId, selection: 0 }], graphic: "menu.png" };
  state.party = restored.party;
  state.inventory = restored.inventory;
  state.menu = restored.menu;
  deepEqual(ports.party.read(), restored.party);
  deepEqual(ports.inventory.read(), restored.inventory);
  deepEqual(ports.menu.read(), restored.menu);
  deepEqual(ports.party.apply({ type: "steps", value: 9 }), { ok: true, error: null });
  equal(state.party.steps, 9);
});

test("menu.state rejects invalid actions through the catchable ScriptError path", () => {
  const state = actorState();
  const ports = createMenuOwnerPorts(state);
  const effect: EffectRecord = { name: "menu.state", patch: { section: "party", path: [], op: "merge", value: null }, args: [{ type: "roster", members: [999], selected: 999 }], kind: "state-write", tick: 0, thread: 1, out: {}, result: null, wait: null, request: null, seq: 1 };
  throws(() => applyMenuStateEffect(ports, effect), (error: unknown) => {
    const scriptError = error as ScriptError;
    equal(scriptError.code, "menu.state-invalid");
    ok(scriptError.message.includes("members"));
    return true;
  });
});

test("v1 party, inventory and menu placeholders migrate to fresh v2 sections idempotently", () => {
  const migrated = restoreGameState(fixture("menu-v1.json"));
  deepEqual(migrated.party, createPartySection());
  deepEqual(migrated.inventory, createInventorySection());
  deepEqual(migrated.menu, createMenuSection());
  const once = snapshot(migrated);
  const twice = restoreGameState(once);
  equal(snapshot(twice), once);
  equal(hashGameState(twice), hashGameState(migrated));
});

test("restore rejects malformed v1 placeholders and unsupported menu section versions", () => {
  const raw = JSON.parse(fixture("menu-v1.json")) as Record<string, unknown>;
  const malformed = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  malformed.party = { version: 1 };
  throws(() => restoreGameState(JSON.stringify(malformed)), (error: unknown) => (error as ScriptError).code === "restore.shape");
  const unsupported = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const schema = unsupported.schema as Record<string, unknown>;
  schema.menu = 3;
  unsupported.menu = { version: 3, screens: [], graphic: null };
  throws(() => restoreGameState(JSON.stringify(unsupported)), (error: unknown) => (error as ScriptError).code === "restore.shape");
});

const authoredProgram = readFileSync(join(fixtureDirectory, "state-ports.prg"), "utf8");
const boardBytes = (() => {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
})();
const thirdCharacterBytes = (() => {
  const encoded = writeCharacter({
    ...createEmptyCharacter(),
    minor: 8,
    name: "Third",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
    idleAnimations: Array(8).fill(""),
    idleTime: 3,
    speed: 0.05,
    customStances: [],
    vectorBases: [],
  });
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
})();
const graphicCharacterBytes = (() => {
  const encoded = writeCharacter({
    ...createEmptyCharacter(),
    minor: 8,
    name: "Graphic",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
    idleAnimations: Array(8).fill(""),
    idleTime: 3,
    speed: 0.05,
    customStances: [],
    vectorBases: [],
  });
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
})();

function menuEngine(onState: (state: GameState) => void, effects: EffectRecord[]): { engine: Engine; state: () => GameState | null } {
  const actions = [
    { section: "party" as const, action: { type: "steps" as const, value: 6 } },
    { section: "inventory" as const, action: { type: "addGold" as const, amount: 23 } },
    { section: "menu" as const, action: { type: "navigation" as const, screens: [{ screen: "status", actorId: null, selection: 1 }] } },
  ];
  let call = 0;
  let latest: GameState | null = null;
  const definition: PluginDefinition = {
    id: "menu-state-test",
    version: "1.0.0",
    commands: [
      {
        name: "state",
        aliases: [],
        params: [],
        call: () => {
          const next = actions[call++];
          if (next === undefined) return { value: null };
          return { value: null, effects: [{ kind: "state-write", section: next.section, args: [next.action] }] };
        },
      },
    ],
  };
  const plugin: ResolvedPlugin = { namespace: "menu", definition };
  let resetPosted = false;
  const seenEffects = new Set<number>();
  const engine = createEngine({
    seed: 17,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 20,
    program: authoredProgram,
    plugins: [plugin],
    phaseRegistrations: [
      { phase: "input", run: (state) => {
        latest = state;
        if (state.actors.actors.length === 0) addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
      }},
      { phase: "events", run: (state, postEffect) => {
        for (const effect of state.vm.effects) {
          if (effect.name !== "state" || seenEffects.has(effect.seq)) continue;
          seenEffects.add(effect.seq);
          effects.push(effect);
        }
        if (state.menu.screens.length > 0 && !resetPosted) {
          resetPosted = true;
          onState(state);
          postEffect?.("engine", {
            name: "reset",
            kind: "state-write",
            thread: 0,
            args: [],
            out: {},
            result: null,
            patch: { section: "engine", path: [], op: "merge", value: null },
            wait: null,
            request: null,
          });
        }
      }},
    ],
  });
  return { engine, state: () => latest };
}

function runEngine(engine: Engine, assets: ReadonlyMap<string, Uint8Array> = new Map([["boards/test.brd", boardBytes]])): string[] {
  const hashes: string[] = [];
  let report = engine.advance(0, []);
  hashes.push(report.stateHash);
  for (let turn = 0; turn < 24; turn += 1) {
    const asset = report.requests.find((request) => request.kind === "asset");
    const inputs = asset === undefined ? [] : [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: asset.reqId, bytes: assets.get(asset.key) ?? null } }];
    report = engine.advance(1, inputs);
    hashes.push(report.stateHash);
    if (report.requests.length === 0 && report.ticksRun === 0) break;
  }
  return hashes;
}

test("authored RPGCode dispatches menu.state adapters through all owners and reset clears all sections", () => {
  const effects: EffectRecord[] = [];
  let savedBeforeReset: string | null = null;
  let savedBeforeResetHash: string | null = null;
  const created = menuEngine((state) => {
    if (state.menu.screens.length > 0) {
      savedBeforeReset = snapshot(state);
      savedBeforeResetHash = hashGameState(state);
    }
  }, effects);
  runEngine(created.engine);
  equal(effects.filter((effect) => effect.kind === "state-write").length, 3);
  deepEqual(effects.slice(0, 3).map((effect) => [effect.patch?.section, effect.args[0]]), [
    ["party", { type: "steps", value: 6 }],
    ["inventory", { type: "addGold", amount: 23 }],
    ["menu", { type: "navigation", screens: [{ screen: "status", actorId: null, selection: 1 }] }],
  ]);
  ok(effects.slice(0, 3).every((effect) => effect.name === "state"));
  ok(savedBeforeReset !== null);
  if (savedBeforeReset !== null && savedBeforeResetHash !== null) equal(hashGameState(restoreGameState(savedBeforeReset)), savedBeforeResetHash);
  const afterReset = created.state();
  ok(afterReset !== null);
  equal(afterReset.party.members.length, 0);
  equal(afterReset.party.steps, 0);
  equal(afterReset.inventory.gold, 0);
  equal(afterReset.menu.screens.length, 0);
});

test("identically seeded authored engines have identical per-tick state hashes", () => {
  const first = menuEngine(() => undefined, []);
  const second = menuEngine(() => undefined, []);
  deepEqual(runEngine(first.engine), runEngine(second.engine));
});
test("equipment actions consume and return stack quantities while applying stable actor references", () => {
  const state = actorState();
  const actor = state.actors.actors[0]!;
  const itemName = `tkr-equipment:${JSON.stringify([actor.id, "right-hand", 1])}`;
  const item = {
    ...createEmptyItem(),
    name: itemName,
    equipable: 1,
    equipSlots: [0, 0, 0, 1, 1, 0, 0, 0],
    equipBonus: [2, 1, 1, 3],
  };
  const character = {
    ...createEmptyCharacter(),
    bodySlots: [0, 1, 1, 1, 1, 1, 1],
  };
  const events: { readonly type: string }[] = [];
  const ports = createMenuOwnerPorts(state, undefined, {
    item: () => item,
    character: () => character,
    applyEquipment: (actorId, equipped, catalog) => applyEquipment(state.actors, actorId, equipped, catalog) !== null,
  }, (event) => events.push(event));
  ok(ports.inventory.apply({ type: "addItem", source: "item/sword.itm", handle: itemName, amount: 2 }).ok);
  const entryId = state.inventory.items[0]!.id;
  const startingStats = { ...actor.stats };
  ok(ports.inventory.apply({ type: "equip", actorId: actor.id, slot: "right-hand", entryId }).ok);
  ok(ports.inventory.apply({ type: "equip", actorId: actor.id, slot: "left-hand", entryId }).ok);
  equal(state.inventory.items[0]!.quantity, 0);
  equal(state.inventory.equipment.length, 2);
  equal(new Set(state.actors.actors[0]!.equipment.equipped).size, 2);
  ok(state.actors.actors[0]!.equipment.equipped.every((reference) => reference.startsWith("tkr-equipment:")));
  equal(state.actors.actors[0]!.equipment.equipped.includes(`${itemName}#1`), true);
  equal(state.actors.actors[0]!.stats.hp, startingStats.hp + 4);
  equal(state.actors.actors[0]!.stats.maxHp, startingStats.maxHp + 4);
  equal(state.actors.actors[0]!.stats.smp, startingStats.smp + 6);
  equal(state.actors.actors[0]!.stats.maxSmp, startingStats.maxSmp + 6);
  const equippedHash = hashGameState(restoreGameState(snapshot(state)));
  equal(equippedHash, hashGameState(state));
  ok(ports.inventory.apply({ type: "unequip", actorId: actor.id, slot: "right-hand" }).ok);
  equal(state.inventory.items[0]!.quantity, 1);
  ok(ports.inventory.apply({ type: "unequip", actorId: actor.id, slot: "left-hand" }).ok);
  equal(state.inventory.items[0]!.quantity, 2);
  equal(state.inventory.equipment.length, 0);
  equal(state.actors.actors[0]!.stats.hp, startingStats.hp);
  equal(state.actors.actors[0]!.stats.maxHp, startingStats.maxHp);
  equal(state.actors.actors[0]!.stats.smp, startingStats.smp);
  equal(state.actors.actors[0]!.stats.maxSmp, startingStats.maxSmp);
  const beforeGold = snapshot(state);
  equal(ports.inventory.apply({ type: "addGold", amount: 0 }).ok, true);
  equal(snapshot(state), beforeGold);
  ok(ports.inventory.apply({ type: "addGold", amount: 100 }).ok);
  ok(ports.inventory.apply({ type: "removeGold", amount: 40 }).ok);
  const beforeUnaffordable = snapshot(state);
  rejected(ports.inventory.apply({ type: "removeGold", amount: 61 }));
  equal(snapshot(state), beforeUnaffordable);
  rejected(ports.inventory.apply({ type: "removeGold", amount: -1 }));
  equal(snapshot(state), beforeUnaffordable);
  equal(state.inventory.gold, 60);
  const beforeOverflow = snapshot(state);
  rejected(ports.inventory.apply({ type: "addGold", amount: Number.MAX_SAFE_INTEGER }));
  equal(snapshot(state), beforeOverflow);
  deepEqual(events.map((event) => event.type), [
    "itemAdded",
    "itemRemoved",
    "itemRemoved",
    "itemAdded",
    "itemAdded",
    "goldChanged",
    "goldChanged",
  ]);
  deepEqual(events.slice(-2), [
    { type: "goldChanged", detail: { previous: 0, current: 100, delta: 100 } },
    { type: "goldChanged", detail: { previous: 100, current: 60, delta: -40 } },
  ]);
});
test("RPGCode equipment locations map and clamp to all canonical inventory slots", () => {
  const state = actorState();
  const actor = state.actors.actors[0]!;
  state.party.members = [actor.id];
  const services = createScriptServices(state);
  const remove = INVENTORY_COMMANDS.find((command) => command.name === "remove");
  if (remove === undefined) throw new Error("missing remove builtin");
  const expected = [
    "head", "head", "neck", "right-hand", "left-hand", "body", "legs",
    "accessory-7", "accessory-8", "accessory-9", "accessory-10", "accessory-11",
    "accessory-12", "accessory-13", "accessory-14", "accessory-15", "accessory-16", "accessory-16",
  ];
  for (let location = 0; location <= 17; location += 1) {
    const result = remove.call(services.view, [
      { value: "Hero", ref: null },
      { value: location, ref: null },
    ], () => ({ value: null }));
    deepEqual(result.effects?.[0]?.args, [
      "itemAction.start",
      { kind: "removeEquipment", actorId: actor.id, slot: expected[location] },
      "remove",
    ]);
  }
});
test("RPGCode CallShop rejects empty and unavailable stock before opening", () => {
  const state = actorState();
  const services = createScriptServices(state);
  const callShop = INVENTORY_COMMANDS.find((command) => command.name === "callshop");
  const continuation = INVENTORY_COMMANDS.find((command) => command.name === "__inventory_shop_asset");
  if (callShop === undefined || continuation === undefined) throw new Error("missing CallShop implementation");
  const next = () => ({ value: null });
  const unchanged = snapshot(state);
  throws(() => callShop.call(services.view, [], next), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "menu.shop-invalid");
  const paths = ["Potion.itm", "Elixir.itm"];
  const start = callShop.call(services.view, [{ value: "Potion", ref: null }], next);
  deepEqual(start.request, { kind: "asset", area: "items", path: "Potion.itm" });
  const item = writeItem({
    ...createEmptyItem(),
    minor: 3,
    legacyWalk: { frames: Array.from({ length: 16 }, () => ({ top: "", bottom: "" })), restTiles: ["", ""] },
    name: "Potion",
  });
  if (!item.ok) throw new Error(item.error.message);
  const bytes = Array.from(item.value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const firstContinuation = continuation.call(services.view, [
    { value: 1, ref: null }, { value: bytes, ref: null }, { value: "Potion.itm", ref: null },
    { value: JSON.stringify(paths), ref: null }, { value: "[]", ref: null },
  ], next);
  const secondItem = writeItem({
    ...createEmptyItem(),
    minor: 3,
    legacyWalk: { frames: Array.from({ length: 16 }, () => ({ top: "", bottom: "" })), restTiles: ["", ""] },
    name: "Elixir",
  });
  if (!secondItem.ok) throw new Error(secondItem.error.message);
  const secondBytes = Array.from(secondItem.value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const opened = continuation.call(services.view, [
    { value: 1, ref: null }, { value: secondBytes, ref: null }, { value: "Elixir.itm", ref: null },
    { value: JSON.stringify(paths), ref: null }, { value: JSON.stringify(["item/potion.itm"]), ref: null },
  ], next);
  // The resolved stock reaches the VM's own control, which activates it and either enters a registered `shop`
  // provider or leaves the standalone `menu.screen` wait (docs/spec/engine/rpgcode-functions.md#e-83).
  deepEqual(opened.effects?.[0], { kind: "vm.control", args: ["menu.open", "shop", ["item/potion.itm", "item/elixir.itm"]] });
  equal(opened.wait, undefined);
  deepEqual(firstContinuation.request, { kind: "asset", area: "items", path: "Elixir.itm" });
  throws(() => continuation.call(services.view, [
    { value: 0, ref: null }, { value: "", ref: null }, { value: "Elixir.itm", ref: null },
    { value: JSON.stringify(paths), ref: null }, { value: JSON.stringify(["item/potion.itm"]), ref: null },
  ], next), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "asset.missing");
  throws(() => continuation.call(services.view, [
    { value: 1, ref: null }, { value: "00", ref: null }, { value: "Elixir.itm", ref: null },
    { value: JSON.stringify(["Elixir.itm"]), ref: null }, { value: "[]", ref: null },
  ], next), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "format.item");
  equal(snapshot(state), unchanged);
});
test("headless RPGCode inventory commands request assets and apply item, equipment and gold operations", () => {
  const item = writeItem({
    ...createEmptyItem(),
    minor: 3,
    legacyWalk: { frames: Array.from({ length: 16 }, () => ({ top: "", bottom: "" })), restTiles: ["", ""] },
    name: "Sword",
    equipable: 1,
    equipSlots: [0, 0, 0, 1, 1, 0, 0, 0],
    equipBonus: [2, 1, 1, 3],
  });
  if (!item.ok) throw new Error(item.error.message);
  const character = writeCharacter({
    ...createEmptyCharacter(),
    name: "Hero",
    minor: 8,
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
    idleAnimations: Array(8).fill(""),
    idleTime: 3,
    speed: 0.05,
    customStances: [],
    vectorBases: [],
    bodySlots: [0, 1, 1, 1, 1, 1, 1],
  });
  if (!character.ok) throw new Error(character.error.message);
  const latest: { value: GameState | null } = { value: null };
  let seeded = false;
  const engine = createEngine({
    seed: 31,
    assetIndex: createAssetIndex(["Boards/test.brd", "Item/sword.itm", "Chrs/hero.tem"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 64,
    height: 64,
    maxTicks: 32,
    program: readFileSync(join(fixtureDirectory, "inventory-operations.prg"), "utf8"),
    phaseRegistrations: [{ phase: "input", run: (state) => {
      latest.value = state;
      if (seeded) return;
      seeded = true;
      const hero = addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
      state.party.members = [hero.id];
      state.party.selected = hero.id;
    }}],
  });
  runEngine(engine, new Map([
    ["boards/test.brd", boardBytes],
    ["item/sword.itm", item.value],
    ["chrs/hero.tem", character.value],
  ]));
  if (latest.value === null) throw new Error("inventory smoke did not reach the input phase");
  equal(latest.value.inventory.items.length, 1);
  equal(latest.value.vm.globals.handlecount, 1);
  equal(latest.value.vm.globals.filecount, 1);
  equal(latest.value.vm.globals.goldbeforetake, 50);
  equal(latest.value.inventory.items[0]!.handle, "Sword");
  equal(latest.value.inventory.items[0]!.quantity, 1);
  equal(latest.value.inventory.equipment.length, 0);
  equal(latest.value.inventory.items[0]!.id, 2);
  equal(latest.value.inventory.nextId, 3);
  equal(latest.value.inventory.gold, 49);
  equal(latest.value.actors.actors[0]!.equipment.equipped.length, 0);
});

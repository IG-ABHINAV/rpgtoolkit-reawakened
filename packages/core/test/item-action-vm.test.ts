// The composed item-action continuation on the script VM (E-80, E-81 and #589;
// docs/spec/engine/plugins-and-battle.md#epic-85-item-action-proposal).
//
// The inventory owner is stubbed so each test pins the VM protocol alone: which owner operation runs when,
// what an item program sees, what is saved at each boundary and what the caller receives. The owner's own
// preflight, staging and events are tested with the owner.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  addActor,
  advanceScriptTick,
  applyMenuStateEffect,
  assetKey,
  CATALOGUE_PLUGIN,
  CORE_PLUGIN,
  createActorService,
  createAssetIndex,
  createEmptyCharacter,
  createEmptyItem,
  createGameState,
  createMenuOwnerPorts,
  createPluginLayers,
  createScriptServices,
  drainDiagnostics,
  fileProgramRef,
  hashGameLedger,
  hashGameState,
  IR_VERSION,
  PACKAGE_ROOT,
  replyToRequest,
  projectGameLedger,
  restoreGameState,
  runPackageStartup,
  restoreRecoveryCandidate,
  ScriptError,
  snapshot,
  startProgram,
  startThread,
  snapshotRecoveryCandidate,
  stepThread,
  UI_PLUGIN,
  verifyRestoredHandles,
  writeItem,
  type CommandRequest,
  type EffectRecord,
  type GameState,
  type Item,
  type ItemActionHooks,
  type ItemActionPhase,
  type ItemActionRequest,
  type ItemActionResult,
  type InventoryRuntime,
  type ItemActionSelection,
  type MenuOwnerPorts,
  type MenuProvider,
  type PluginDefinition,
  type PluginLayers,
  type ProgramLoader,
  type ScriptServices,
  type SectionKey,
} from "../src/index.ts";
import { INVENTORY_COMMANDS } from "../src/script/packs/inventory.ts";
import { advanceOrFail } from "./script-failures.ts";

// Type-level guard for the public provider context: the VM's item-action preflight/commit operations are
// internal, and a native provider must use the returned `item.action` transition instead.
const publicProviderContext: MenuProvider = ({ context }) => {
  // @ts-expect-error native providers must not reach the VM's item-action commit surface
  void context.inventory.preflightItemAction;
  return { kind: "complete" };
};
void publicProviderContext;

type Asset = { readonly area: "items" | "characters"; readonly path: string };
type Script = {
  needed: readonly Asset[];
  refuse: { readonly path: string; readonly message: string } | null;
  displaced: boolean;
  hooks: ItemActionHooks;
  commit: (request: ItemActionRequest, phase: ItemActionPhase) => ItemActionResult | null;
};
type Harness = {
  script: Script;
  requests: CommandRequest[];
  loaded: Set<string>;
  events: string[];
  results: ItemActionResult[];
  providerStates: unknown[];
  inventoryEvents: { readonly type: string; readonly detail: unknown }[];
};

const NO_HOOKS: ItemActionHooks = { use: null, remove: null, equip: null };
const COMPLETE: ItemActionResult = { status: "complete", error: null };

function harness(script: Partial<Script> = {}): Harness {
  return {
    script: { needed: [], refuse: null, displaced: false, hooks: NO_HOOKS, commit: () => null, ...script },
    requests: [],
    loaded: new Set(),
    events: [],
    results: [],
    providerStates: [],
    inventoryEvents: [],
  };
}

function assetId(asset: Asset): string {
  return `${asset.area}:${asset.path.toLowerCase()}`;
}

function hook(program: string, handle: string): ItemActionHooks["use"] {
  return { program, item: { source: `item/${handle.toLowerCase()}.itm`, handle, entryId: 1 } };
}

function loaderOf(files: Record<string, string>): ProgramLoader {
  const bytes = new Map<string, Uint8Array>();
  for (const [name, text] of Object.entries(files)) bytes.set(assetKey(`Prg/${name}`), new TextEncoder().encode(text));
  return {
    index: createAssetIndex(Object.keys(files).map((name) => `Prg/${name}`)),
    root: PACKAGE_ROOT,
    read: (key: string) => bytes.get(key),
  };
}

function newState(): { state: GameState; hero: number } {
  const state = createGameState({ seed: 0 });
  const hero = addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero" });
  state.party.members = [hero.id];
  state.party.selected = hero.id;
  state.inventory.items = [{ id: 1, source: "item/potion.itm", handle: "Potion", quantity: 2 }];
  state.inventory.nextId = 2;
  state.vm.globals.log = "";
  return { state, hero: hero.id };
}

function selectionFor(request: ItemActionRequest, displaced: boolean): ItemActionSelection {
  const entryId = "entryId" in request ? request.entryId : null;
  return {
    kind: request.kind,
    actorId: request.actorId,
    actorSource: "hero.tem",
    entryId,
    entrySource: entryId === null ? null : "item/potion.itm",
    entryHandle: entryId === null ? null : "Potion",
    displaced: displaced ? { slot: "right-hand", entryId: 2, source: "item/old.itm", handle: "Old" } : null,
    slot: "slot" in request ? request.slot : null,
  };
}

/** The real owner ports with the item-action operations replaced by a scripted stub that logs into `vm.globals.log`. */
function portsFor(state: GameState, h: Harness): MenuOwnerPorts {
  const real = createMenuOwnerPorts(state);
  return {
    ...real,
    inventory: {
      read: () => real.inventory.read(),
      apply: (action) => real.inventory.apply(action),
      missingItemActionAssets: () => h.script.needed.filter((asset) => !h.loaded.has(assetId(asset))),
      preflightItemAction: (request) => h.script.refuse !== null
        ? { ok: false, error: h.script.refuse }
        : { ok: true, selection: selectionFor(request, h.script.displaced) },
      itemActionHooks: () => h.script.hooks,
      commitItemAction: (request, _selection, phase) => {
        const label = `${request.kind}${phase.step === undefined ? "" : `:${phase.step}`}:started=${phase.programStarted}`;
        state.vm.globals.log = `${String(state.vm.globals.log)}commit:${label};`;
        return h.script.commit(request, phase) ?? COMPLETE;
      },
    },
  };
}

const SLOT_FLAGS = [0, 0, 0, 1, 1, 0, 0, 0];
function realItemDefinitions(): Record<string, Item> {
  return {
    "item/potion.itm": { ...createEmptyItem(), name: "Potion", menuUsable: 1, menuUseHp: 4 },
    "item/sword.itm": {
      ...createEmptyItem(), name: "Sword", equipable: 1, equipSlots: SLOT_FLAGS, onRemoveProgram: "remove.prg",
    },
    "item/axe.itm": {
      ...createEmptyItem(), name: "Axe", equipable: 1, equipSlots: SLOT_FLAGS,
    },
  };
}
function realRuntime(state: GameState, items: Record<string, Item>): InventoryRuntime {
  const service = createActorService(state.actors);
  return {
    item: (source) => items[source],
    character: () => ({ ...createEmptyCharacter(), bodySlots: [0, 1, 1, 1, 1, 1, 1] }),
    applyEquipment: (actorId, equipped, catalog) => service.applyEquipment(actorId, equipped, catalog) !== null,
    updateStats: (actorId, patch) => service.updateStats(actorId, patch, { cause: "script", source: null }) !== null,
    prepareEquipment: (actorId, equipped, catalog) => service.prepareEquipment(actorId, equipped, catalog),
    commitPreparedEquipment: (prepared) => service.commitPreparedEquipment(prepared) !== null,
    discardPreparedEquipment: (prepared) => service.discardPreparedEquipment(prepared),
  };
}
function realPortsFor(state: GameState, h: Harness, items: Record<string, Item>): MenuOwnerPorts {
  return createMenuOwnerPorts(state, undefined, realRuntime(state, items), (event) => h.inventoryEvents.push(event));
}
function servicesFor(
  state: GameState,
  h: Harness,
  loader: ProgramLoader,
  provider: PluginDefinition | null = null,
  layers: PluginLayers = createPluginLayers(),
  ports: MenuOwnerPorts = portsFor(state, h),
  postEffect?: (section: SectionKey, effect: EffectRecord) => void,
): ScriptServices {
  return createScriptServices(
    state,
    [
      { definition: CORE_PLUGIN },
      { definition: UI_PLUGIN },
      { definition: CATALOGUE_PLUGIN },
      ...(provider === null ? [] : [{ definition: provider }]),
    ],
    undefined,
    undefined,
    loader,
    "default",
    postEffect,
    (request) => h.requests.push(request),
    layers,
    [],
    false,
    undefined,
    undefined,
    ports,
  );
}

/** A native `items` provider that starts `action` on entry and records every event and the state it was given. */
function nativeProvider(h: Harness, action: ItemActionRequest): PluginDefinition {
  return {
    id: "item-action-test",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      items: ({ event, state }) => {
        h.events.push(event.type);
        h.providerStates.push(state);
        if (event.type === "enter") return { kind: "item.action", state: { marker: 7 }, action };
        if (event.type === "item.action.completed") {
          h.results.push(event.result);
          return { kind: "complete" };
        }
        throw new Error(`unexpected provider event ${event.type}`);
      },
    },
  };
}

function answer(state: GameState, h: Harness, succeeded: boolean, load: boolean): void {
  const request = h.requests.at(-1)!;
  if (load) h.loaded.add(`${String(request.area)}:${String(request.path).toLowerCase()}`);
  replyToRequest(state.vm, Number(request.reqId), { ok: succeeded, value: succeeded ? "00" : "missing" });
}

function finished(state: GameState): boolean {
  return state.vm.threads.every((thread) => thread.status === "finished");
}

function runToEnd(state: GameState, services: ScriptServices, budget?: number): void {
  for (let tick = 0; tick < 600 && !finished(state); tick += 1) advanceOrFail(state, services, budget);
  ok(finished(state), "the program finishes");
}

/** Run to the end tolerating reported-but-handled failures; the caller inspects the diagnostics. */
function runQuiet(state: GameState, services: ScriptServices): void {
  for (let tick = 0; tick < 600 && !finished(state); tick += 1) advanceScriptTick(state, services);
  ok(finished(state), "the program finishes");
}

const LOG_HOOK = (name: string, extra = ""): string =>
  `log = log + "${name}:" + context.target + ":" + context.slot + ":" + context.item.handle + ";"\n${extra}`;

// --- Native providers -------------------------------------------------------------------------

test("a native use action requests definitions, applies effects, runs the use program, consumes, then completes once", () => {
  const { state, hero } = newState();
  const h = harness({ needed: [{ area: "items", path: "potion.itm" }], hooks: { ...NO_HOOKS, use: hook("use.prg", "Potion") } });
  const loader = loaderOf({
    "game.prg": "itemmenu()\nafter = 1\nend()\n",
    "use.prg": 'log = log + "use:" + context.source + ">" + context.target + ":" + context.item.handle + ";"\n',
  });
  const services = servicesFor(state, h, loader, nativeProvider(h, { kind: "use", entryId: 1, actorId: hero }));
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);

  equal(state.vm.threads[0]?.status, "waiting");
  deepEqual(h.requests.map((request) => [request.kind, request.area, request.path]), [["asset", "items", "potion.itm"]]);
  deepEqual(h.events, ["enter"], "no provider call while the definition is pending");
  equal(state.vm.globals.log, "", "no effect or program before the definition arrives");
  equal(state.menu.screens.at(-1)?.screen, "items");

  answer(state, h, true, true);
  advanceOrFail(state, services);

  equal(
    state.vm.globals.log,
    `commit:use:effects:started=false;use:${hero}>${hero}:Potion;commit:use:consume:started=true;`,
    "effects, then the program, then consumption",
  );
  deepEqual(h.events, ["enter", "item.action.completed"]);
  deepEqual(h.providerStates, [null, { marker: 7 }], "the completion carries the saved provider state");
  deepEqual(h.results, [COMPLETE]);
  equal(state.menu.screens.length, 0);
  equal(state.vm.globals.after, 1, "the facade call returned on the same thread");
  ok(finished(state));
  const thread = state.vm.threads[0]!;
  equal(thread.source, null, "the hook's source and target are restored");
  equal(thread.target, null);
  equal(thread.frames.length, 0);
});

test("a native completion is a separate ready step charged to the thread, ordered against another thread and saved at its boundary", () => {
  const { state, hero } = newState();
  const h = harness({ refuse: { path: "inventory.action.actorId", message: "no such actor" } });
  const loader = loaderOf({ "game.prg": "itemmenu()\nend()\n" });
  const action: ItemActionRequest = { kind: "use", entryId: 1, actorId: hero };
  const provider = nativeProvider(h, action);
  const services = servicesFor(state, h, loader, provider);
  const main = startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  const other = startThread(state.vm, { ref: { kind: "inline", text: "while (1) {\nn = n + 1\n}\n", ir: IR_VERSION }, kind: "board", owner: "script" });

  for (let step = 0; step < 50 && h.events.length === 0; step += 1) equal(stepThread(main, state.vm, services, 1), 1);
  deepEqual(h.events, ["enter"], "preflight refusal does not call the provider inline");
  equal(main.pending?.command, "__item_action_complete", "the completion is queued on the same thread");
  equal(main.status, "ready");

  equal(stepThread(other, state.vm, services, 1), 1);
  deepEqual(h.events, ["enter"], "another thread's turn does not dispatch it");

  const saved = snapshot(state);
  equal(stepThread(main, state.vm, services, 1), 1, "the dispatch is exactly one ordinary step of the budget");
  deepEqual(h.events, ["enter", "item.action.completed"]);
  equal(h.results[0]?.status, "refused");
  equal(h.results[0]?.error?.path, "inventory.action.actorId");

  const resumed = harness({ refuse: h.script.refuse });
  const restored = restoreGameState(saved);
  const restoredServices = servicesFor(restored, resumed, loader, nativeProvider(resumed, action));
  verifyRestoredHandles(restored.vm, restoredServices);
  const again = restored.vm.threads.find((thread) => thread.id === main.id)!;
  equal(stepThread(again, restored.vm, restoredServices, 1), 1);
  deepEqual(resumed.events, ["item.action.completed"], "restore dispatches the saved completion once and does not re-enter");
  equal(resumed.results[0]?.status, "refused");
  equal(hashGameState(restored), hashGameState(state), "the restored run is the unsaved run");
});

test("a replaced or killed hook discards its action: no completion, committed effects stay, menu frames are removed", () => {
  for (const [name, hookBody] of [
    ["replaceProgram", 'replaceprogram("after.prg")\n'],
    ["killThread", "killthread(getthreadid())\n"],
  ] as const) {
    const { state, hero } = newState();
    const h = harness({ displaced: true, hooks: { ...NO_HOOKS, remove: hook("remove.prg", "Old") } });
    const loader = loaderOf({ "game.prg": "itemmenu()\nend()\n", "remove.prg": hookBody, "after.prg": "after = 1\nend()\n" });
    const services = servicesFor(state, h, loader, nativeProvider(h, { kind: "replace", entryId: 1, actorId: hero, slot: "right-hand" }));
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    runToEnd(state, services);
    deepEqual(h.events, ["enter"], `${name}: no completion is dispatched`);
    equal(state.vm.globals.log, "", `${name}: the abandoned action never reached its commit`);
    equal(state.menu.screens.length, 0, `${name}: the menu frame its operation opened is removed`);
    if (name === "replaceProgram") {
      equal(state.vm.globals.after, 1, "the replacement continues on the same thread");
      equal(state.vm.threads.length, 1);
    } else {
      equal(state.vm.threads.length, 0, "the killed thread has no return");
    }
  }
});

test("a definition request that fails, or whose definition never becomes usable, refuses at inventory.action.asset", () => {
  for (const [name, ok_, load] of [["failed reply", false, false], ["undecodable definition", true, false]] as const) {
    const { state, hero } = newState();
    const h = harness({ needed: [{ area: "items", path: "potion.itm" }] });
    const loader = loaderOf({ "game.prg": "itemmenu()\nend()\n" });
    const services = servicesFor(state, h, loader, nativeProvider(h, { kind: "use", entryId: 1, actorId: hero }));
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    advanceOrFail(state, services);
    answer(state, h, ok_, load);
    advanceOrFail(state, services);
    equal(h.results[0]?.status, "refused", name);
    equal(h.results[0]?.error?.path, "inventory.action.asset", name);
    equal(state.vm.globals.log, "", `${name}: no effect or program ran`);
    ok(finished(state));
  }
});

test("a restore with a cold definition cache asks for the missing definitions again before advancing", () => {
  const { state, hero } = newState();
  const h = harness({ needed: [{ area: "items", path: "potion.itm" }], hooks: { ...NO_HOOKS, use: hook("use.prg", "Potion") } });
  const loader = loaderOf({ "game.prg": "itemmenu()\nend()\n", "use.prg": 'log = log + "use;"\n' });
  const action: ItemActionRequest = { kind: "use", entryId: 1, actorId: hero };
  const services = servicesFor(state, h, loader, nativeProvider(h, action));
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(h.requests.length, 1);
  const saved = snapshot(state);

  const cold = harness({ needed: h.script.needed, hooks: h.script.hooks });
  const restored = restoreGameState(saved);
  const restoredServices = servicesFor(restored, cold, loader, nativeProvider(cold, action));
  verifyRestoredHandles(restored.vm, restoredServices);
  equal(restored.vm.threads[0]?.wait, null, "an unanswered request is not pretended to survive the restore");
  advanceOrFail(restored, restoredServices);
  deepEqual(cold.requests.map((request) => request.path), ["potion.itm"], "the definition is requested again");
  equal(restored.vm.globals.log, "", "nothing ran before the definition arrived");
  answer(restored, cold, true, true);
  runToEnd(restored, restoredServices);
  equal(restored.vm.globals.log, "commit:use:effects:started=false;use;commit:use:consume:started=true;");
  deepEqual(cold.events, ["item.action.completed"]);
});

test("a native action re-resolves a changed inventory after its definition reply was pending", () => {
  const { state, hero } = newState();
  const items: Record<string, Item> = {};
  const h = harness();
  const ports = realPortsFor(state, h, items);
  const loader = loaderOf({ "game.prg": "itemmenu()\nafter = 1\nend()\n" });
  const action: ItemActionRequest = { kind: "use", entryId: 1, actorId: hero };
  const services = servicesFor(state, h, loader, nativeProvider(h, action), undefined, ports);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(h.requests.length, 1, "the missing definition was requested");

  // The state changes while the reply is pending: the stack is gone and the definition arrives.
  state.inventory.items[0]!.quantity = 0;
  items["item/potion.itm"] = { ...createEmptyItem(), name: "Potion", menuUsable: 1, menuUseHp: 4 };
  answer(state, h, true, true);
  runToEnd(state, services);

  equal(h.results[0]?.status, "refused");
  equal(h.results[0]?.error?.path, "inventory.items.quantity");
  equal(state.vm.globals.log, "", "no effect or item program ran");
  equal(state.vm.globals.after, 1);
});

test("an item program mutating the selected stack before commit is revalidated with committed quantities", () => {
  const { state, hero } = newState();
  const items = realItemDefinitions();
  state.inventory.items = [
    { id: 1, source: "item/sword.itm", handle: "Sword", quantity: 0 },
    { id: 2, source: "item/axe.itm", handle: "Axe", quantity: 2 },
  ];
  state.inventory.nextId = 3;
  state.inventory.equipment = [{ actorId: hero, slot: "right-hand", itemId: 1 }];
  const h = harness();
  const ports = realPortsFor(state, h, items);
  const loader = loaderOf({
    "game.prg": "itemmenu()\nafter = 1\nend()\n",
    "remove.prg": 'log = log + "remove-start;"\ngiveitem("axe")\nlog = log + "remove-end;"\n',
  });
  const action: ItemActionRequest = { kind: "replace", entryId: 2, actorId: hero, slot: "right-hand" };
  const services = servicesFor(
    state, h, loader, nativeProvider(h, action), undefined, ports,
    (section, effect) => applyMenuStateEffect(ports, effect),
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(state.vm.globals.log, "remove-start;", "the remove program mutated the selected stack");
  equal(h.requests.length, 1, "giveitem requested its definition");
  const request = h.requests.at(-1)!;
  h.loaded.add(`${String(request.area)}:${String(request.path).toLowerCase()}`);
  replyToRequest(state.vm, Number(request.reqId), { ok: true, value: itemBytes("Axe") });
  runToEnd(state, services);

  equal(state.vm.globals.log, "remove-start;remove-end;");
  deepEqual(h.inventoryEvents, [
    {
      type: "itemAdded",
      detail: { entryId: 2, source: "item/axe.itm", handle: "Axe", amount: 1, previousQuantity: 2, currentQuantity: 3 },
    },
    {
      type: "itemRemoved",
      detail: { entryId: 2, source: "item/axe.itm", handle: "Axe", amount: 1, previousQuantity: 3, currentQuantity: 2 },
    },
    {
      type: "itemAdded",
      detail: { entryId: 1, source: "item/sword.itm", handle: "Sword", amount: 1, previousQuantity: 0, currentQuantity: 1 },
    },
  ], "the program's mutation is followed by commit events using the quantities at commit");
  equal(state.inventory.items.find((entry) => entry.id === 2)?.quantity, 2);
  equal(state.vm.globals.after, 1);
});

// --- RPGCode providers: the blocking context methods ---------------------------------------------

function rpgcodeProgram(call: string, readError: boolean): string {
  const body = `outcome = context.inventory.${call}; outcomeStatus = outcome.status${readError ? "; outcomePath = outcome.error.path" : ""}`;
  return `registerPlugin({ name: "rpg-items", commands: {}, menuProviders: { items: (context) => { ${body} } } })\nitemmenu()\nafter = 1\nend()\n`;
}

test("an RPGCode provider's context.inventory.use blocks the calling thread and returns the plain result", () => {
  const { state, hero } = newState();
  const h = harness({ needed: [{ area: "items", path: "potion.itm" }], hooks: { ...NO_HOOKS, use: hook("use.prg", "Potion") } });
  const loader = loaderOf({
    "game.prg": rpgcodeProgram(`use({ entryId: 1, actorId: ${hero} })`, false),
    "use.prg": 'log = log + "use:" + context.source + ";"\n',
  });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(state.vm.threads[0]?.status, "waiting");
  equal(h.requests.length, 1);
  equal(state.vm.globals.outcomestatus, undefined, "the call has not returned");
  answer(state, h, true, true);
  runToEnd(state, services);
  equal(state.vm.globals.log, `commit:use:effects:started=false;use:${hero};commit:use:consume:started=true;`);
  equal(state.vm.globals.outcomestatus, "complete");
  equal(state.vm.globals.after, 1);
  equal(state.menu.screens.length, 0);
});

test("an RPGCode context method returns a refusal as data and rejects a malformed action as a catchable error", () => {
  const { state, hero } = newState();
  const h = harness({ refuse: { path: "inventory.action.actorId", message: "no such actor" } });
  const loader = loaderOf({
    "game.prg": rpgcodeProgram(`use({ entryId: 1, actorId: ${hero} })`, true),
    "bad.prg": rpgcodeProgram("use({ entryId: 1 })", false),
  });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  equal(state.vm.globals.outcomestatus, "refused");
  equal(state.vm.globals.outcomepath, "inventory.action.actorId");

  const second = newState();
  const secondServices = servicesFor(second.state, h, loader);
  startProgram(second.state.vm, fileProgramRef(loader, "bad.prg"));
  throws(
    () => advanceOrFail(second.state, secondServices),
    (error: unknown) => error instanceof ScriptError && error.code === "builtin.bad-arg",
  );
});

test("an RPGCode provider reads the read-only inventory views and cannot assign to them", () => {
  const { state } = newState();
  const h = harness();
  const loader = loaderOf({
    "game.prg": `registerPlugin({ name: "rpg-items", commands: {}, menuProviders: { items: (context) => {
  gold = context.inventory.gold
  count = context.inventory.items.length
  firstHandle = context.inventory.items[0].handle
  firstQuantity = context.inventory.items[0].quantity
  equippedCount = context.inventory.equipment.length
} } })
itemmenu()
after = 1
end()
`,
    "assign.prg": `registerPlugin({ name: "rpg-items", commands: {}, menuProviders: { items: (context) => { context.inventory.gold = 99 } } })
itemmenu()
end()
`,
  });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  equal(state.vm.globals.gold, state.inventory.gold);
  equal(state.vm.globals.count, 1);
  equal(state.vm.globals.firsthandle, "Potion");
  equal(state.vm.globals.firstquantity, 2);
  equal(state.vm.globals.equippedcount, 0);
  const second = newState();
  const secondServices = servicesFor(second.state, h, loader);
  startProgram(second.state.vm, fileProgramRef(loader, "assign.prg"));
  throws(
    () => advanceOrFail(second.state, secondServices),
    (error: unknown) => error instanceof ScriptError && error.code === "assign.read-only",
  );
  equal(second.state.inventory.gold, 0);
});

test("an RPGCode action saved while its definition request is pending restores cold and re-requests it", () => {
  const { state, hero } = newState();
  state.actors.actors[0]!.stats = { ...state.actors.actors[0]!.stats, hp: 5, maxHp: 10 };
  const startup = `registerPlugin({ name: "rpg-items", commands: {}, menuProviders: { items: (context) => {
  outcome = context.inventory.use({ entryId: 1, actorId: ${hero} })
  outcomeStatus = outcome.status
} } })
`;
  const loader = loaderOf({
    "startup.prg": startup,
    "game.prg": "itemmenu()\nafter = 1\nend()\n",
  });
  const items: Record<string, Item> = {};
  const h = harness();
  const layers = createPluginLayers();
  const ports = realPortsFor(state, h, items);
  const services = servicesFor(state, h, loader, null, layers, ports);
  runPackageStartup(state, services, [fileProgramRef(loader, "startup.prg")], []);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(h.requests.length, 1, "the RPGCode caller requested its missing definition");
  const saved = snapshot(state);

  const cold = harness();
  const coldItems: Record<string, Item> = {};
  const restoredLayers = createPluginLayers();
  const scratch = createGameState({ seed: 0 });
  const scratchServices = servicesFor(scratch, cold, loader, null, restoredLayers, realPortsFor(scratch, cold, coldItems));
  runPackageStartup(scratch, scratchServices, [fileProgramRef(loader, "startup.prg")], []);
  const restored = restoreGameState(saved);
  const restoredServices = servicesFor(restored, cold, loader, null, restoredLayers, realPortsFor(restored, cold, coldItems));
  verifyRestoredHandles(restored.vm, restoredServices);
  equal(restored.vm.threads[0]?.wait, null, "an unanswered request is not pretended to survive the restore");
  advanceOrFail(restored, restoredServices);
  deepEqual(cold.requests.map((request) => request.path), ["potion.itm"], "the definition is requested again");
  equal(restored.vm.globals.outcomestatus, undefined, "the call has not returned before definitions arrive");

  coldItems["item/potion.itm"] = { ...createEmptyItem(), name: "Potion", menuUsable: 1, menuUseHp: 4 };
  answer(restored, cold, true, true);
  runToEnd(restored, restoredServices);

  equal(restored.vm.globals.outcomestatus, "complete");
  equal(restored.actors.actors[0]?.stats.hp, 9);
  equal(restored.inventory.items[0]?.quantity, 1, "the restored action consumed exactly once");
  equal(restored.vm.globals.after, 1);
});

test("a restored native action whose hook kills the thread still removes the menu frame it opened", () => {
  const { state, hero } = newState();
  const h = harness({ displaced: true, needed: [{ area: "items", path: "potion.itm" }], hooks: { ...NO_HOOKS, remove: hook("remove.prg", "Old") } });
  const loader = loaderOf({ "game.prg": "itemmenu()\nend()\n", "remove.prg": "killthread(getthreadid())\n" });
  const services = servicesFor(state, h, loader, nativeProvider(h, { kind: "replace", entryId: 1, actorId: hero, slot: "right-hand" }));
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(h.requests.length, 1);
  equal(state.menu.screens.length, 1, "the provider frame is open at the saved boundary");
  const saved = snapshot(state);

  const resumed = harness({ displaced: true, needed: h.script.needed, hooks: h.script.hooks });
  const restored = restoreGameState(saved);
  const restoredServices = servicesFor(restored, resumed, loader, nativeProvider(resumed, { kind: "replace", entryId: 1, actorId: hero, slot: "right-hand" }));
  verifyRestoredHandles(restored.vm, restoredServices);
  advanceOrFail(restored, restoredServices);
  answer(restored, resumed, true, true);
  runToEnd(restored, restoredServices);
  equal(restored.menu.screens.length, 0, "the restored continuation carries its menu base depth");
  deepEqual(resumed.events, [], "no completion is dispatched to the restored provider");
  equal(restored.vm.threads.length, 0);
});

// --- Script adapters: equip and remove -------------------------------------------------------------

const EQUIP_PROGRAM = 'equip("Hero", 3, "Potion")\nafter = 1\nend()\n';

test("equip runs the displaced remove program, one commit, then the new equip program before the next statement", () => {
  const { state, hero } = newState();
  const h = harness({
    displaced: true,
    hooks: { use: null, remove: hook("remove.prg", "Old"), equip: hook("equip.prg", "Potion") },
  });
  const loader = loaderOf({ "game.prg": EQUIP_PROGRAM, "remove.prg": LOG_HOOK("remove"), "equip.prg": LOG_HOOK("equip") });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  equal(
    state.vm.globals.log,
    `remove:${hero}:right-hand:Old;commit:replace:started=true;equip:${hero}:right-hand:Potion;`,
  );
  equal(state.vm.globals.after, 1);
  equal(state.vm.threads[0]?.source, null);
});

test("an empty slot skips the remove program, and removing an empty slot completes without a commit", () => {
  const { state, hero } = newState();
  const h = harness({ displaced: false, hooks: { use: null, remove: null, equip: hook("equip.prg", "Potion") } });
  const loader = loaderOf({
    "game.prg": 'equip("Hero", 3, "Potion")\nremove("Hero", 4)\nafter = 1\nend()\n',
    "equip.prg": LOG_HOOK("equip"),
  });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  equal(state.vm.globals.log, `commit:replace:started=false;equip:${hero}:right-hand:Potion;`);
  equal(state.vm.globals.after, 1);
});

test("a fractional slot location keeps the old accessory-<location> token instead of rounding into a slot", () => {
  const { state, hero } = newState();
  const h = harness({ hooks: { use: null, remove: null, equip: hook("equip.prg", "Potion") } });
  const loader = loaderOf({ "game.prg": 'equip("Hero", 2.5, "Potion")\nafter = 1\nend()\n', "equip.prg": LOG_HOOK("equip") });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  const log = String(state.vm.globals.log);
  ok(log.includes(`equip:${hero}:accessory-2.5:Potion`), log);
  equal(log.includes(":neck:"), false, "a fractional location is not rounded into neck");
});

test("the same equip is identical under a one-step budget and a full budget", () => {
  const logs: string[] = [];
  for (const budget of [1, 1000]) {
    const { state } = newState();
    const h = harness({
      displaced: true,
      hooks: { use: null, remove: hook("remove.prg", "Old"), equip: hook("equip.prg", "Potion") },
    });
    const loader = loaderOf({ "game.prg": EQUIP_PROGRAM, "remove.prg": LOG_HOOK("remove"), "equip.prg": LOG_HOOK("equip") });
    const services = servicesFor(state, h, loader);
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    runToEnd(state, services, budget);
    logs.push(String(state.vm.globals.log));
  }
  equal(logs[0], logs[1]);
  ok(logs[0]!.includes("commit:replace:started=true;"));
});

test("a refused adapter raises a catchable menu.state-invalid that a handler can take", () => {
  const refusal = { path: "inventory.action.eligibility", message: "item is not eligible" };
  const plain = newState();
  const h = harness({ refuse: refusal });
  const loader = loaderOf({
    "game.prg": EQUIP_PROGRAM,
    "handled.prg": "function f() {\n  setErrorHandler(:failed)\n  equip(\"Hero\", 3, \"Potion\")\n  skipped = 1\n  return 0\n  :failed\n  handled = 1\n  return 0\n}\nf()\nafter = 1\nend()\n",
  });
  const services = servicesFor(plain.state, h, loader);
  startProgram(plain.state.vm, fileProgramRef(loader, "game.prg"));
  throws(
    () => advanceOrFail(plain.state, services),
    (error: unknown) => error instanceof ScriptError && error.code === "menu.state-invalid" && error.message.includes("inventory.action.eligibility"),
  );

  const handled = newState();
  const handledServices = servicesFor(handled.state, h, loader);
  startProgram(handled.state.vm, fileProgramRef(loader, "handled.prg"));
  runQuiet(handled.state, handledServices);
  deepEqual(drainDiagnostics(handledServices).map((diagnostic) => diagnostic.code), ["menu.state-invalid"], "the failure is still reported");
  equal(handled.state.vm.globals.handled, 1);
  equal(handled.state.vm.globals.skipped, undefined);
  equal(handled.state.vm.globals.after, 1);
});

test("a missing item program is reported and the action continues; a caller handler abandons it", () => {
  const { state } = newState();
  const h = harness({ displaced: false, hooks: { use: null, remove: null, equip: hook("missing.prg", "Potion") } });
  const loader = loaderOf({ "game.prg": EQUIP_PROGRAM });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceScriptTick(state, services);
  deepEqual(drainDiagnostics(services).map((diagnostic) => diagnostic.code), ["program.missing"]);
  equal(state.vm.globals.log, "commit:replace:started=false;", "the commit ran and the missing equip program was not an interruption");
  equal(state.vm.globals.after, 1);

  const handled = newState();
  const handledHarness = harness({ displaced: true, hooks: { use: null, remove: hook("missing.prg", "Old"), equip: null } });
  const handledLoader = loaderOf({
    "game.prg": "function f() {\n  setErrorHandler(:failed)\n  equip(\"Hero\", 3, \"Potion\")\n  skipped = 1\n  return 0\n  :failed\n  handled = 1\n  return 0\n}\nf()\nend()\n",
  });
  const handledServices = servicesFor(handled.state, handledHarness, handledLoader);
  startProgram(handled.state.vm, fileProgramRef(handledLoader, "game.prg"));
  advanceScriptTick(handled.state, handledServices);
  equal(handled.state.vm.globals.handled, 1);
  equal(handled.state.vm.globals.skipped, undefined);
  equal(handled.state.vm.globals.log, "", "the abandoned action never committed");
  ok(handled.state.vm.threads[0]!.frames.every((frame) => frame.itemActions === undefined), "no pending action is left behind");
});

test("nested actions started inside an item program stack per frame and resume last in, first out", () => {
  const { state, hero } = newState();
  const h = harness({
    displaced: true,
    hooks: { use: null, remove: hook("remove.prg", "Old"), equip: hook("equip.prg", "Potion") },
  });
  const loader = loaderOf({
    "game.prg": EQUIP_PROGRAM,
    "remove.prg": 'if (depth == 0) {\n  depth = 1\n  log = log + "outer;"\n  equip("Hero", 4, "Potion")\n  log = log + "back;"\n}\n',
    "equip.prg": LOG_HOOK("equip"),
  });
  const services = servicesFor(state, h, loader);
  const main = startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  let deepest = 0;
  for (let step = 0; step < 2000 && main.status !== "finished"; step += 1) {
    stepThread(main, state.vm, services, 1);
    const stacked = main.frames.filter((frame) => frame.itemActions !== undefined).length;
    deepest = Math.max(deepest, stacked);
    if (stacked === 2) {
      for (const frame of main.frames) {
        if (frame.itemActions !== undefined) equal(frame.itemActions.length, 1, "each frame holds only its own action");
      }
    }
  }
  equal(deepest, 2, "the nested action lives on the hook program's frame, the outer on the caller's");
  equal(
    state.vm.globals.log,
    `outer;commit:replace:started=true;equip:${hero}:left-hand:Potion;back;commit:replace:started=true;equip:${hero}:right-hand:Potion;`,
  );
  ok(main.frames.length === 0 && main.status === "finished");
});

test("saved mid equip program, an action restores to its phase and commits exactly once", () => {
  const { state } = newState();
  const h = harness({ displaced: false, hooks: { use: null, remove: null, equip: hook("equip.prg", "Potion") } });
  const loader = loaderOf({
    "game.prg": EQUIP_PROGRAM,
    "equip.prg": 'log = log + "equip-start;"\nsleep(1)\nlog = log + "equip-end;"\n',
  });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(state.vm.globals.log, "commit:replace:started=false;equip-start;", "saved after the commit, before the equip program finishes");
  const saved = snapshot(state);

  const raw = JSON.parse(saved) as { vm: { threads: Array<{ frames: Array<{ itemActions?: Array<{ phase: string }> }> }> } };
  equal(raw.vm.threads[0]?.frames[0]?.itemActions?.[0]?.phase, "equip.hook");

  const resumed = harness({ displaced: false, hooks: h.script.hooks });
  const restored = restoreGameState(saved);
  const restoredServices = servicesFor(restored, resumed, loader);
  verifyRestoredHandles(restored.vm, restoredServices);
  runToEnd(restored, restoredServices);
  equal(restored.vm.globals.log, "commit:replace:started=false;equip-start;equip-end;", "the commit is not redone");
  equal(restored.vm.globals.after, 1);
});

test("saved mid use and remove programs, an action restores its phase and commits exactly once", () => {
  for (const [name, kind, hookName, action, loaderFiles] of [
    [
      "use",
      "use",
      "use",
      { kind: "use", entryId: 1, actorId: 0 } as ItemActionRequest,
      { "game.prg": "itemmenu()\nafter = 1\nend()\n", "use.prg": 'log = log + "use-start;"\nsleep(1)\nlog = log + "use-end;"\n' },
    ],
    [
      "remove",
      "remove",
      "remove",
      { kind: "replace", entryId: 1, actorId: 0, slot: "right-hand" } as ItemActionRequest,
      { "game.prg": "itemmenu()\nafter = 1\nend()\n", "remove.prg": 'log = log + "remove-start;"\nsleep(1)\nlog = log + "remove-end;"\n' },
    ],
  ] as const) {
    const { state, hero } = newState();
    const resolvedAction = { ...action, actorId: hero } as ItemActionRequest;
    const h = harness({
      needed: kind === "use" ? [{ area: "items", path: "potion.itm" }] : [],
      displaced: kind === "remove",
      hooks: { ...NO_HOOKS, [hookName]: hook(`${hookName}.prg`, kind === "use" ? "Potion" : "Old") },
    });
    const loader = loaderOf(loaderFiles);
    const services = servicesFor(state, h, loader, nativeProvider(h, resolvedAction));
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    advanceOrFail(state, services);
    if (kind === "use") {
      answer(state, h, true, true);
      advanceOrFail(state, services);
    }
    equal(state.vm.globals.log, `${kind === "use" ? "commit:use:effects:started=false;" : ""}${hookName}-start;`, `${name}: saved inside its hook`);
    const saved = snapshot(state);
    const raw = JSON.parse(saved) as { vm: { threads: Array<{ frames: Array<{ itemActions?: Array<{ phase: string }> }> }> } };
    equal(raw.vm.threads[0]?.frames[0]?.itemActions?.[0]?.phase, `${hookName}.hook`, `${name}: the saved phase is its hook`);

    const resumed = harness({
      needed: h.script.needed,
      displaced: h.script.displaced,
      hooks: h.script.hooks,
    });
    const restored = restoreGameState(saved);
    const restoredServices = servicesFor(restored, resumed, loader, nativeProvider(resumed, resolvedAction));
    verifyRestoredHandles(restored.vm, restoredServices);
    runToEnd(restored, restoredServices);
    equal(
      restored.vm.globals.log,
      `${kind === "use" ? "commit:use:effects:started=false;" : ""}${hookName}-start;${hookName}-end;${kind === "use" ? "commit:use:consume:started=true;" : "commit:replace:started=true;"}`,
      `${name}: the program resumes and the commit is not redone`,
    );
    deepEqual(resumed.events, ["item.action.completed"], `${name}: exactly one completion`);
    equal(restored.vm.globals.after, 1);
  }
});

test("an interrupted native action completes with its result, and an interrupted adapter raises", () => {
  const interrupted: ItemActionResult = {
    status: "interrupted",
    error: { path: "inventory.items.quantity", message: "the selected stack changed" },
  };
  {
    const { state, hero } = newState();
    const h = harness({
      needed: [{ area: "items", path: "potion.itm" }],
      commit: (_request, phase) => phase.step === "consume" ? interrupted : null,
    });
    const loader = loaderOf({ "game.prg": "itemmenu()\nafter = 1\nend()\n" });
    const services = servicesFor(state, h, loader, nativeProvider(h, { kind: "use", entryId: 1, actorId: hero }));
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    advanceOrFail(state, services);
    answer(state, h, true, true);
    runToEnd(state, services);
    deepEqual(h.events, ["enter", "item.action.completed"], "the native provider receives one completion");
    deepEqual(h.results, [interrupted], "the interrupted result crosses item.action.completed");
    equal(state.vm.globals.log, "commit:use:effects:started=false;commit:use:consume:started=true;");
    equal(state.vm.globals.after, 1);
  }
  {
    const { state } = newState();
    const h = harness({
      displaced: true,
      hooks: { ...NO_HOOKS, remove: hook("remove.prg", "Old") },
      commit: () => interrupted,
    });
    const loader = loaderOf({ "game.prg": EQUIP_PROGRAM, "remove.prg": "" });
    const services = servicesFor(state, h, loader);
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    throws(
      () => advanceOrFail(state, services),
      (error: unknown) => error instanceof ScriptError && error.code === "menu.state-invalid" &&
        error.message.includes("inventory.items.quantity: the selected stack changed"),
      "the adapter raises the interrupted result at its caller",
    );
  }
});

test("a hook-local program error is reported and continues, unlike a missing hook program", () => {
  for (const [name, files, program, expected] of [
    ["missing hook program", {}, "missing.prg", "program.missing"],
    ["hook-local error", { "error.prg": "missingCall()\nhookAfter = 1\n" }, "error.prg", "unknown.command"],
  ] as const) {
    const { state } = newState();
    const h = harness({ hooks: { ...NO_HOOKS, equip: hook(program, "Potion") } });
    const loader = loaderOf({ "game.prg": EQUIP_PROGRAM, ...files });
    const services = servicesFor(state, h, loader);
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    runQuiet(state, services);
    deepEqual(drainDiagnostics(services).map((diagnostic) => diagnostic.code), [expected], `${name}: the located diagnostic`);
    equal(state.vm.globals.log, "commit:replace:started=false;", `${name}: the action committed and continued`);
    equal(state.vm.globals.after, 1, `${name}: the caller continued`);
    if (name === "hook-local error") equal(state.vm.globals.hookafter, 1, "the hook program continued after its own error");
  }
});

test("a recovery candidate captured mid equip program carries no pending action into the durable ledger", () => {
  const { state } = newState();
  const h = harness({ displaced: false, hooks: { use: null, remove: null, equip: hook("equip.prg", "Potion") } });
  const loader = loaderOf({
    "game.prg": EQUIP_PROGRAM,
    "equip.prg": 'log = log + "equip-start;"\nsleep(1)\nlog = log + "equip-end;"\n',
  });
  const services = servicesFor(state, h, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  ok(state.vm.threads[0]!.frames.some((frame) => (frame.itemActions?.length ?? 0) > 0), "an item action is pending outside any menu");
  equal(state.menu.screens.length, 0);

  const withoutThreads = restoreGameState(snapshot(state));
  withoutThreads.vm.threads = [];
  equal(
    hashGameLedger(projectGameLedger(state)),
    hashGameLedger(projectGameLedger(withoutThreads)),
    "the durable ledger has no part of the pending continuation",
  );

  const candidate = snapshotRecoveryCandidate(state, {
    version: 1,
    board: { key: "boards/start.brd", hash: "0123456789abcdef" },
    boardDependencies: [],
    entryProgram: null,
    programs: [],
    listenerAnchors: [],
  });
  const restored = restoreRecoveryCandidate(candidate, state.audio);
  equal(
    hashGameLedger(projectGameLedger(restored.state)),
    hashGameLedger(projectGameLedger(state)),
    "recovery restores the same durable ledger; the engine installs none of the saved VM continuation",
  );
});

// --- Save validation --------------------------------------------------------------------------------

function boundarySave(): { saved: string; loader: ProgramLoader; h: Harness; action: ItemActionRequest } {
  const { state, hero } = newState();
  const h = harness({ refuse: { path: "inventory.action.actorId", message: "no such actor" } });
  const loader = loaderOf({ "game.prg": "itemmenu()\nend()\n" });
  const action: ItemActionRequest = { kind: "use", entryId: 1, actorId: hero };
  const services = servicesFor(state, h, loader, nativeProvider(h, action));
  const main = startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  for (let step = 0; step < 50 && h.events.length === 0; step += 1) stepThread(main, state.vm, services, 1);
  return { saved: snapshot(state), loader, h, action };
}

test("a malformed or inconsistent pending action is refused as restore.shape", () => {
  const { saved } = boundarySave();
  type Raw = { vm: { threads: Array<{ pending: unknown; frames: Array<{ itemActions?: Array<Record<string, unknown>> }> }> } };
  const refuse = (edit: (raw: Raw) => void, label: string): void => {
    const raw = JSON.parse(saved) as Raw;
    edit(raw);
    throws(
      () => restoreGameState(JSON.stringify(raw)),
      (error: unknown) => error instanceof ScriptError && error.code === "restore.shape",
      label,
    );
  };
  const record = (raw: Raw): Record<string, unknown> => raw.vm.threads[0]!.frames[0]!.itemActions![0]!;
  refuse((raw) => { record(raw).phase = "bogus"; }, "unknown phase");
  refuse((raw) => { record(raw).action = { kind: "use", entryId: "1", actorId: 1 }; }, "action field types");
  refuse((raw) => { record(raw).provider = null; }, "native action with no provider continuation");
  refuse((raw) => { record(raw).requested = [1]; }, "requested keys");
  refuse((raw) => { raw.vm.threads[0]!.pending = null; }, "completion with no pending dispatch");
  refuse((raw) => { raw.vm.threads[0]!.frames[0]!.itemActions = []; }, "empty stack");
  // The saved selection must name its own action's actor, slot and stack (a corrupted save, not a runtime error).
  const withSelection = (edit: (selection: Record<string, unknown>) => void, label: string): void => {
    const boundary = boundarySave();
    const raw = JSON.parse(boundary.saved) as Raw & { vm: { threads: Array<{ frames: Array<{ itemActions?: Array<Record<string, unknown>> }> }> } };
    const record = raw.vm.threads[0]!.frames[0]!.itemActions![0]!;
    record.phase = "preflight";
    record.result = null;
    raw.vm.threads[0]!.pending = null;
    // Parsed save JSON: the selection shape is what the validator under test must accept or refuse.
    const selection: Record<string, unknown> = {
      kind: "use", actorId: boundary.action.actorId, actorSource: "hero.tem",
      entryId: 1, entrySource: "item/potion.itm", entryHandle: "Potion", displaced: null, slot: null,
    };
    record.selection = selection;
    edit(selection);
    throws(() => restoreGameState(JSON.stringify(raw)), (error: unknown) => error instanceof ScriptError && error.code === "restore.shape", label);
  };
  withSelection((selection) => { selection.actorId = 999; }, "selection for another actor");
  withSelection((selection) => { selection.displaced = { slot: "left-hand", entryId: 2, source: "item/a.itm", handle: "A" }; }, "use with a displaced tuple");
  withSelection((selection) => { selection.slot = "right-hand"; }, "use with a slot");
});

test("restore requires the saved native provider identity to resolve before any thread resumes", () => {
  const { saved, loader, h } = boundarySave();
  const restored = restoreGameState(saved);
  const withoutProvider = servicesFor(restored, h, loader);
  throws(
    () => verifyRestoredHandles(restored.vm, withoutProvider),
    (error: unknown) => error instanceof ScriptError && error.code === "restore.menu-provider",
  );
});

test("a v6 save migrates to the item-action vm shape unchanged", () => {
  const fresh = createGameState({ seed: 3 });
  const raw = JSON.parse(snapshot(fresh)) as { schema: { vm: number } };
  equal(raw.schema.vm, 7);
  raw.schema.vm = 6;
  equal(snapshot(restoreGameState(JSON.stringify(raw))), snapshot(fresh));
});

// --- #1198: exact-handle and file resolution for the equip adapter -------------------------------------

function itemBytes(name: string): string {
  const item = writeItem({
    ...createEmptyItem(),
    minor: 3,
    legacyWalk: { frames: Array.from({ length: 16 }, () => ({ top: "", bottom: "" })), restTiles: ["", ""] },
    name,
  });
  if (!item.ok) throw new Error(item.error.message);
  return Array.from(item.value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("equip selects an exact handle, then a unique folded handle, then the file's own stack, and refuses ambiguity", () => {
  const { state, hero } = newState();
  state.inventory.items = [
    { id: 1, source: "item/sword.itm", handle: "Sword", quantity: 1 },
    { id: 2, source: "item/blade-a.itm", handle: "Blade", quantity: 1 },
    { id: 3, source: "item/blade-b.itm", handle: "Blade", quantity: 1 },
    { id: 4, source: "item/twin.itm", handle: "Shiny", quantity: 1 },
    { id: 5, source: "item/twin.itm", handle: "Dull", quantity: 1 },
    { id: 6, source: "item/case.itm", handle: "Case", quantity: 1 },
    { id: 7, source: "item/case2.itm", handle: "CASE", quantity: 1 },
    { id: 8, source: "item/solo.itm", handle: "Renamed", quantity: 0 },
  ];
  const services = createScriptServices(state, [{ definition: CORE_PLUGIN }, { definition: CATALOGUE_PLUGIN }]);
  const equip = INVENTORY_COMMANDS.find((command) => command.name === "equip")!;
  const select = INVENTORY_COMMANDS.find((command) => command.name === "__inventory_equip_select")!;
  const next = () => ({ value: null });
  const call = (query: string) => equip.call(services.view, [
    { value: "Hero", ref: null }, { value: 3, ref: null }, { value: query, ref: null },
  ], next);
  const started = (query: string): unknown => call(query).effects?.[0]?.args;
  const entry = (entryId: number): unknown => ["itemAction.start", { kind: "replace", entryId, actorId: hero, slot: "right-hand" }, "equip"];
  const ambiguous = (error: unknown): boolean =>
    error instanceof ScriptError && error.code === "menu.state-invalid" && error.message.startsWith("inventory.action.entryId:");

  deepEqual(started("Sword"), entry(1), "a unique exact handle");
  deepEqual(started("sword"), entry(1), "a unique case-insensitive handle");
  deepEqual(started("CASE"), entry(7), "an exact match beats a folded one");
  throws(() => call("case"), ambiguous);
  throws(() => call("Blade"), ambiguous);
  deepEqual(started("solo"), entry(8), "a file with one stack selects it even if unavailable");
  equal(call("nothing").effects, undefined, "an unknown item is a silent no-op");

  const twin = call("twin");
  deepEqual(twin.request, { kind: "asset", area: "items", path: "twin.itm" });
  const resume = (name: string) => select.call(services.view, [
    { value: 1, ref: null }, { value: itemBytes(name), ref: null },
    { value: hero, ref: null }, { value: "right-hand", ref: null }, { value: "item/twin.itm", ref: null },
  ], next).effects?.[0]?.args;
  deepEqual(resume("Shiny"), entry(4), "the stack named for the definition");
  deepEqual(resume("dull"), entry(5), "folded when no exact name matches");
  throws(() => resume("Other"), ambiguous);

  const none = equip.call(services.view, [{ value: "Nobody", ref: null }, { value: 3, ref: null }, { value: "Sword", ref: null }], next);
  equal(none.effects, undefined, "an unresolved party handle is a silent no-op");
});

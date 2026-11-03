import type { ActorsSection } from "../actors/model.ts";
import { deriveEquipmentBonuses, type ActorRuleResult, type EquipmentItemDefinition } from "../actors/rules.ts";
import type { Character, Item } from "../formats/actor/model.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import { equipmentCatalog, slotLocation, validEquipment } from "./equipment.ts";
import {
  validateActionFields,
  validateInventorySection,
  type InventoryEquipment,
  type InventoryItem,
  type InventorySection,
  type MenuStateResult,
  type StateIssue,
} from "./model.ts";

export type InventoryAction =
  | { readonly type: "addItem"; readonly source: string; readonly handle: string; readonly amount: number }
  | { readonly type: "removeItem"; readonly entryId: number; readonly amount: number }
  | { readonly type: "consumeBattleItem"; readonly item: string; readonly target: number; readonly handle: string | null }
  | { readonly type: "equip"; readonly actorId: number; readonly slot: string; readonly entryId: number }
  | { readonly type: "unequip"; readonly actorId: number; readonly slot: string }
  | { readonly type: "buyItem"; readonly source: string; readonly amount: number }
  | { readonly type: "sellItem"; readonly entryId: number; readonly amount: number }
  | { readonly type: "addGold"; readonly amount: number }
  | { readonly type: "removeGold"; readonly amount: number };

export type InventoryEvent =
  | { readonly type: "itemAdded" | "itemRemoved"; readonly detail: { readonly entryId: number; readonly source: string; readonly handle: string; readonly amount: number; readonly previousQuantity: number; readonly currentQuantity: number } }
  | { readonly type: "goldChanged"; readonly detail: { readonly previous: number; readonly current: number; readonly delta: number } };

export type ItemActionRequest =
  | { readonly kind: "use"; readonly entryId: number; readonly actorId: number }
  | { readonly kind: "replace"; readonly entryId: number; readonly actorId: number; readonly slot: string }
  | { readonly kind: "removeEquipment"; readonly actorId: number; readonly slot: string };
export type ItemActionSelection = {
  readonly kind: ItemActionRequest["kind"];
  readonly actorId: number;
  readonly actorSource: string;
  readonly entryId: number | null;
  readonly entrySource: string | null;
  readonly entryHandle: string | null;
  readonly displaced: { readonly slot: string; readonly entryId: number; readonly source: string; readonly handle: string } | null;
  readonly slot: string | null;
};
export type ItemActionPreflight =
  | { readonly ok: true; readonly selection: ItemActionSelection }
  | { readonly ok: false; readonly error: StateIssue };
/**
 * `programStarted`: an item program (or, for `use`, the stat effect) has begun, so a failure is `interrupted`
 * rather than `refused`. `step` applies to `use` only: `"effects"` applies HP/SMP, `"consume"` consumes the
 * exact stack after the program; `replace` and `removeEquipment` commit once with `step` omitted.
 */
export type ItemActionPhase = { readonly programStarted: boolean; readonly step?: "effects" | "consume" };
export type ItemActionAsset = { readonly area: "items" | "characters"; readonly path: string };
export type ItemActionHook = { readonly program: string; readonly item: { readonly [key: string]: string | number } };
export type ItemActionHooks = { readonly use: ItemActionHook | null; readonly remove: ItemActionHook | null; readonly equip: ItemActionHook | null };
export type ItemActionResult =
  | { readonly status: "complete"; readonly error: null }
  | { readonly status: "refused" | "interrupted"; readonly error: StateIssue };
export type InventoryRuntime = {
  readonly item: (source: string) => Item | undefined;
  readonly character: (source: string) => Character | undefined;
  readonly applyEquipment: (actorId: number, equipped: readonly string[], catalog: readonly EquipmentItemDefinition[]) => boolean;
  readonly updateStats?: (actorId: number, patch: { readonly hp: number; readonly smp: number }) => boolean;
  readonly prepareEquipment?: (actorId: number, equipped: readonly string[], catalog: readonly EquipmentItemDefinition[]) => ActorRuleResult | null;
  readonly commitPreparedEquipment?: (prepared: ActorRuleResult) => boolean;
  readonly discardPreparedEquipment?: (prepared: ActorRuleResult) => void;
  readonly shopStock?: () => readonly string[];
  readonly setShopStock?: (sources: readonly string[]) => boolean | void;
  readonly closeShop?: () => void;
};

const ACCEPTED: MenuStateResult = Object.freeze({ ok: true, error: null });
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function rejected(path: string, message: string): MenuStateResult {
  return { ok: false, error: { path, message } };
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function safeAmount(value: unknown, allowZero = false): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
}
function exactAction(recordValue: Record<string, unknown>, keys: readonly string[]): StateIssue | null {
  return validateActionFields(recordValue, keys, "inventory.action");
}
function safeClampedDelta(current: number, maximum: number, delta: number): number {
  if (delta >= 0) return delta > maximum - current ? maximum : current + delta;
  return delta < -current ? 0 : current + delta;
}

function failedItemAction(phase: ItemActionPhase, path: string, message: string): ItemActionResult {
  return {
    status: phase.programStarted ? "interrupted" : "refused",
    error: { path, message },
  };
}

function matchingSelection(selection: ItemActionSelection, inventory: InventorySection): boolean {
  if (selection.entryId !== null) {
    const entry = inventory.items.find((candidate) => candidate.id === selection.entryId);
    if (entry === undefined || entry.source !== selection.entrySource || entry.handle !== selection.entryHandle) return false;
  }
  if (selection.displaced !== null) {
    const tuple = inventory.equipment.find((candidate) => candidate.actorId === selection.actorId && candidate.slot === selection.displaced!.slot);
    const entry = inventory.items.find((candidate) => candidate.id === selection.displaced!.entryId);
    if (tuple?.itemId !== selection.displaced.entryId || entry?.source !== selection.displaced.source ||
        entry.handle !== selection.displaced.handle) return false;
  } else if (selection.slot !== null &&
      inventory.equipment.some((candidate) => candidate.actorId === selection.actorId && candidate.slot === selection.slot)) {
    return false;
  }
  return true;
}

/** Validate one item action without publishing state, hooks, or events. */
export function preflightItemAction(
  state: { readonly inventory: InventorySection; readonly actors: ActorsSection; readonly party: { readonly members: readonly number[] } },
  request: ItemActionRequest,
  runtime: InventoryRuntime | undefined,
): ItemActionPreflight {
  if (!safeAmount(request.actorId)) return { ok: false, error: { path: "inventory.action.actorId", message: "expected a positive actor id" } };
  const actor = state.actors.actors.find((candidate) =>
    candidate.id === request.actorId && candidate.kind === "party" && state.party.members.includes(candidate.id));
  if (actor === undefined) return { ok: false, error: { path: "inventory.action.actorId", message: "expected a live party actor" } };
  const slot = request.kind === "use" ? null : request.slot;
  if (slot !== null && (typeof slot !== "string" || slotLocation(slot) === null)) {
    return { ok: false, error: { path: "inventory.action.slot", message: "unknown equipment slot" } };
  }
  const entryId = request.kind === "removeEquipment" ? null : request.entryId;
  const selected = entryId === null ? undefined : state.inventory.items.find((candidate) => candidate.id === entryId);
  if (entryId !== null && selected === undefined) {
    return { ok: false, error: { path: "inventory.action.entryId", message: "unknown inventory entry" } };
  }
  if (selected !== undefined && selected.quantity < 1) {
    return { ok: false, error: { path: "inventory.items.quantity", message: "no available item" } };
  }
  const tuple = slot === null ? undefined : state.inventory.equipment.find((candidate) =>
    candidate.actorId === actor.id && candidate.slot === slot);
  const displaced = tuple === undefined ? undefined : state.inventory.items.find((candidate) => candidate.id === tuple.itemId);
  if (tuple !== undefined && displaced === undefined) {
    return { ok: false, error: { path: "inventory.equipment.itemId", message: "equipped item entry is missing" } };
  }
  if (request.kind === "removeEquipment" && tuple === undefined) {
    return {
      ok: true,
      selection: {
        kind: request.kind, actorId: actor.id, actorSource: actor.source,
        entryId: null, entrySource: null, entryHandle: null, displaced: null, slot,
      },
    };
  }
  if (runtime === undefined) return { ok: false, error: { path: "inventory.action.asset", message: "item and character definitions are unavailable" } };
  const item = selected === undefined ? undefined : runtime.item(selected.source);
  const oldItem = displaced === undefined ? undefined : runtime.item(displaced.source);
  const character = slot === null ? undefined : runtime.character(actor.source);
  if ((selected !== undefined && item === undefined) || (displaced !== undefined && oldItem === undefined) ||
      (slot !== null && character === undefined)) {
    return { ok: false, error: { path: "inventory.action.asset", message: "item or character definition is not available" } };
  }
  if (request.kind === "use" && item?.menuUsable !== 1) {
    return { ok: false, error: { path: "inventory.action.eligibility", message: "item cannot be used from the menu" } };
  }
  if (request.kind === "replace" && !validEquipment(actor, request.slot, item!, character!)) {
    return { ok: false, error: { path: "inventory.action.eligibility", message: "item is not eligible for this actor and slot" } };
  }
  if (request.kind === "replace" && displaced !== undefined && selected!.id !== displaced.id &&
      displaced.quantity >= MAX_SAFE) {
    return { ok: false, error: { path: "inventory.items.quantity", message: "quantity exceeds the safe-integer range" } };
  }
  if (request.kind === "removeEquipment" && displaced !== undefined && displaced.quantity >= MAX_SAFE) {
    return { ok: false, error: { path: "inventory.items.quantity", message: "quantity exceeds the safe-integer range" } };
  }
  if (request.kind === "use") {
    const { hp, smp } = useTargets(actor, item!);
    if (!Number.isSafeInteger(hp) || !Number.isSafeInteger(smp)) {
      return { ok: false, error: { path: "actors", message: "actor stat update exceeds valid bounds" } };
    }
  }
  if (request.kind !== "use") {
    let equipment = state.inventory.equipment.filter((candidate) =>
      !(candidate.actorId === actor.id && candidate.slot === slot));
    if (request.kind === "replace") equipment = [...equipment, { actorId: actor.id, slot: request.slot, itemId: selected!.id }];
    let items = state.inventory.items;
    if (request.kind === "replace" && selected!.id !== displaced?.id) {
      items = items.map((candidate) => candidate.id === selected!.id ? { ...candidate, quantity: candidate.quantity - 1 } : candidate);
    }
    if (displaced !== undefined && displaced.id !== selected?.id) {
      items = items.map((candidate) => candidate.id === displaced.id ? { ...candidate, quantity: candidate.quantity + 1 } : candidate);
    }
    const candidate = { ...state.inventory, items, equipment };
    const issue = validateInventorySection(candidate, state.actors);
    if (issue !== null) return { ok: false, error: issue };
    if (equipmentCatalog(actor.id, equipment, items, runtime.item) === null) {
      return { ok: false, error: { path: "inventory.action.asset", message: "an equipped item definition is not available" } };
    }
  }
  return {
    ok: true,
    selection: {
      kind: request.kind,
      actorId: actor.id,
      actorSource: actor.source,
      entryId: selected?.id ?? null,
      entrySource: selected?.source ?? null,
      entryHandle: selected?.handle ?? null,
      displaced: tuple === undefined || displaced === undefined ? null : {
        slot: tuple.slot, entryId: displaced.id, source: displaced.source, handle: displaced.handle,
      },
      slot,
    },
  };
}

/** The hp/smp a menu use sets: each signed delta clamped to its pool without an unsafe intermediate sum. */
function useTargets(actor: ActorsSection["actors"][number], item: Item): { readonly hp: number; readonly smp: number } {
  return {
    hp: safeClampedDelta(actor.stats.hp, actor.stats.maxHp, item.menuUseHp),
    smp: safeClampedDelta(actor.stats.smp, actor.stats.maxSmp, item.menuUseSmp),
  };
}

/**
 * Step `"effects"` of a menu `use`: apply the clamped HP/SMP once through the actor stat owner (cause
 * `script`, source `null`) after revalidating the preflight selection. Nothing has started yet, so every
 * failure is `refused` and changes no state. The item program and the `"consume"` step follow.
 */
function applyItemUseEffect(
  state: { readonly inventory: InventorySection; readonly actors: ActorsSection; readonly party: { readonly members: readonly number[] } },
  request: ItemActionRequest,
  selection: ItemActionSelection,
  runtime: InventoryRuntime | undefined,
): ItemActionResult {
  const refuse = (path: string, message: string): ItemActionResult => ({ status: "refused", error: { path, message } });
  if (request.kind !== "use" || selection.kind !== "use") return refuse("inventory.action.type", "expected a use action");
  const validated = preflightItemAction(state, request, runtime);
  if (!validated.ok) return refuse(validated.error.path, validated.error.message);
  if (validated.selection.actorSource !== selection.actorSource || validated.selection.entryId !== selection.entryId ||
      validated.selection.entrySource !== selection.entrySource || validated.selection.entryHandle !== selection.entryHandle) {
    return refuse("inventory.action.entryId", "selected actor or stack changed");
  }
  const actor = state.actors.actors.find((candidate) => candidate.id === selection.actorId)!;
  const target = useTargets(actor, runtime!.item(selection.entrySource!)!);
  try {
    if (runtime!.updateStats?.(actor.id, target) !== true) return refuse("actors", "actor stat update was refused");
  } catch (error) {
    return refuse("actors", error instanceof Error ? error.message : "actor stat update was refused");
  }
  return { status: "complete", error: null };
}

/**
 * Commit a preflighted action at its current boundary. `use` is two calls: `step: "effects"` applies HP/SMP
 * (refused on failure, no inventory event), then the item program runs, then `step: "consume"` consumes one
 * unit of the exact selected stack (always `interrupted` on failure; neither the target actor nor the
 * definition is revalidated). `replace`/`removeEquipment` omit `step`: they stage one candidate, prepare the
 * actor once, check the canonical projection, then publish actor and inventory together. `programStarted`
 * selects `refused` (nothing ran) versus `interrupted` (an item program began) for failures.
 */
export function commitItemAction(
  state: { inventory: InventorySection; actors: ActorsSection; party: { readonly members: readonly number[] } },
  request: ItemActionRequest,
  selection: ItemActionSelection,
  phase: ItemActionPhase,
  runtime: InventoryRuntime | undefined,
  onInventoryEvent?: (event: InventoryEvent) => void,
): ItemActionResult {
  const fail = (path: string, message: string) => failedItemAction(request.kind === "use" && phase.step === "consume" ? { programStarted: true } : phase, path, message);
  if (selection.kind !== request.kind) return fail("inventory.action.type", "selection does not belong to this action");
  if ((request.kind === "use") !== (phase.step !== undefined)) return fail("inventory.action.step", "step is required for use and invalid otherwise");
  if (request.kind === "use" && phase.step === "effects") return applyItemUseEffect(state, request, selection, runtime);
  if (request.kind === "use") {
    const stack = state.inventory.items.find((entry) => entry.id === selection.entryId);
    if (stack === undefined || stack.source !== selection.entrySource || stack.handle !== selection.entryHandle) {
      return fail("inventory.action.entryId", "selected stack changed");
    }
    if (stack.quantity < 1) return fail("inventory.items.quantity", "no available item to consume");
    const quantity = stack.quantity - 1;
    const candidate = {
      ...state.inventory,
      items: quantity === 0 && !state.inventory.equipment.some((entry) => entry.itemId === stack.id)
        ? state.inventory.items.filter((entry) => entry.id !== stack.id)
        : state.inventory.items.map((entry) => entry.id === stack.id ? { ...entry, quantity } : entry),
    };
    const issue = validateInventorySection(candidate, state.actors);
    if (issue !== null) return fail(issue.path, issue.message);
    state.inventory = candidate;
    onInventoryEvent?.({ type: "itemRemoved", detail: { entryId: stack.id, source: stack.source, handle: stack.handle, amount: 1, previousQuantity: stack.quantity, currentQuantity: quantity } });
    return { status: "complete", error: null };
  }
  const actor = state.actors.actors.find((candidate) => candidate.id === selection.actorId);
  if (actor?.source !== selection.actorSource || !matchingSelection(selection, state.inventory)) {
    return fail(selection.entryId === null ? "inventory.equipment.itemId" : "inventory.action.entryId", "selected actor, stack, or equipment tuple changed");
  }
  const validated = preflightItemAction(state, request, runtime);
  if (!validated.ok) return fail(validated.error.path, validated.error.message);
  const inventory = state.inventory;
  const incoming = selection.entryId === null ? undefined : inventory.items.find((entry) => entry.id === selection.entryId);
  const oldEntry = selection.displaced === null ? undefined : inventory.items.find((entry) => entry.id === selection.displaced!.entryId);
  if (request.kind === "removeEquipment" && selection.displaced === null) return { status: "complete", error: null };

  let nextItems = inventory.items;
  let nextEquipment = inventory.equipment.filter((entry) =>
    !(entry.actorId === selection.actorId && entry.slot === selection.slot));
  if (request.kind === "replace") {
    nextEquipment = [...nextEquipment, { actorId: selection.actorId, slot: request.slot, itemId: incoming!.id }];
  }
  const events: InventoryEvent[] = [];
  if (incoming !== undefined && incoming.id !== oldEntry?.id) {
    const quantity = incoming.quantity - 1;
    nextItems = nextItems.map((entry) => entry.id === incoming.id ? { ...entry, quantity } : entry);
    events.push({ type: "itemRemoved", detail: { entryId: incoming.id, source: incoming.source, handle: incoming.handle, amount: 1, previousQuantity: incoming.quantity, currentQuantity: quantity } });
  }
  if (oldEntry !== undefined && oldEntry.id !== incoming?.id) {
    const quantity = oldEntry.quantity + 1;
    if (!Number.isSafeInteger(quantity)) return fail("inventory.items.quantity", "quantity exceeds the safe-integer range");
    nextItems = nextItems.map((entry) => entry.id === oldEntry.id ? { ...entry, quantity } : entry);
    events.push({ type: "itemAdded", detail: { entryId: oldEntry.id, source: oldEntry.source, handle: oldEntry.handle, amount: 1, previousQuantity: oldEntry.quantity, currentQuantity: quantity } });
  }
  const candidate = { ...inventory, items: nextItems, equipment: nextEquipment };
  const issue = validateInventorySection(candidate, state.actors);
  if (issue !== null) return fail(issue.path, issue.message);
  const catalog = equipmentCatalog(selection.actorId, candidate.equipment, candidate.items, runtime!.item);
  if (catalog === null) return fail("inventory.action.asset", "an equipped item definition is not available");
  let prepared: ActorRuleResult | null | undefined;
  try {
    prepared = runtime!.prepareEquipment?.(selection.actorId, catalog.equipped, catalog.catalog);
  } catch (error) {
    return fail("actors", error instanceof Error ? error.message : "actor equipment operation refused");
  }
  if (prepared === undefined || prepared === null) return fail("actors", "actor equipment operation refused");
  try {
    const bonuses = deriveEquipmentBonuses(catalog.catalog, catalog.equipped);
    const preparedEquipment = prepared.actor.equipment;
    if (preparedEquipment.equipped.length !== catalog.equipped.length ||
        preparedEquipment.equipped.some((reference, index) => reference !== catalog.equipped[index]) ||
        preparedEquipment.bonuses.hp !== bonuses.hp || preparedEquipment.bonuses.dp !== bonuses.dp ||
        preparedEquipment.bonuses.fp !== bonuses.fp || preparedEquipment.bonuses.smp !== bonuses.smp) {
      runtime!.discardPreparedEquipment?.(prepared);
      return fail("actors", "prepared actor equipment does not match the canonical inventory projection");
    }
    if (runtime!.commitPreparedEquipment?.(prepared) !== true) {
      runtime!.discardPreparedEquipment?.(prepared);
      return fail("actors", "actor equipment operation refused");
    }
  } catch (error) {
    runtime!.discardPreparedEquipment?.(prepared);
    return fail("actors", error instanceof Error ? error.message : "actor equipment operation refused");
  }
  state.inventory = candidate;
  for (const event of events) onInventoryEvent?.(event);
  return { status: "complete", error: null };
}

/**
 * The item and character definitions an action needs to preflight and commit that the runtime cannot yet
 * resolve, in order: selected/incoming item, displaced item, other retained equipped items, actor character.
 * Empty when the actor, stack or slot is invalid (preflight then refuses). Paths drop the leading `item/`.
 */
export function missingItemActionAssets(
  state: { readonly inventory: InventorySection; readonly actors: ActorsSection; readonly party: { readonly members: readonly number[] } },
  request: ItemActionRequest,
  runtime: InventoryRuntime | undefined,
): readonly ItemActionAsset[] {
  const actor = state.actors.actors.find((candidate) =>
    candidate.id === request.actorId && candidate.kind === "party" && state.party.members.includes(candidate.id));
  const slot = request.kind === "use" ? null : request.slot;
  if (actor === undefined || (slot !== null && slotLocation(slot) === null)) return [];
  const entryId = request.kind === "removeEquipment" ? null : request.entryId;
  const selected = entryId === null ? undefined : state.inventory.items.find((entry) => entry.id === entryId);
  if (entryId !== null && selected === undefined) return [];
  const items: InventoryItem[] = selected === undefined ? [] : [selected];
  if (request.kind === "removeEquipment" &&
      !state.inventory.equipment.some((entry) => entry.actorId === actor.id && entry.slot === slot)) {
    return [];
  }
  if (request.kind !== "use") {
    const tuples = state.inventory.equipment.filter((entry) => entry.actorId === actor.id);
    const displaced = tuples.find((entry) => entry.slot === slot);
    if (displaced !== undefined) {
      const stack = state.inventory.items.find((entry) => entry.id === displaced.itemId);
      if (stack === undefined) return [];
      items.push(stack);
    }
    for (const entry of tuples) {
      if (entry.slot === slot) continue;
      const stack = state.inventory.items.find((candidate) => candidate.id === entry.itemId);
      if (stack === undefined) return [];
      items.push(stack);
    }
  }
  const wanted: ItemActionAsset[] = items.map((stack) => ({ area: "items", path: stack.source.replace(/^item\//, "") }));
  if (request.kind !== "use") wanted.push({ area: "characters", path: actor.source });
  const seen = new Set<string>();
  const missing: ItemActionAsset[] = [];
  for (const asset of wanted) {
    const key = `${asset.area}:${asset.path.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const found = asset.area === "items" ? runtime?.item(`item/${asset.path}`) : runtime?.character(asset.path);
    if (found === undefined) missing.push(asset);
  }
  return missing;
}

/** The non-empty item programs an action runs, with the plain item data each receives (E-95 item context). */
export function itemActionHooks(
  state: { readonly inventory: InventorySection },
  selection: ItemActionSelection,
  runtime: InventoryRuntime | undefined,
): ItemActionHooks {
  if (runtime === undefined) return { use: null, remove: null, equip: null };
  const lookup = runtime.item;
  const hookFor = (entryId: number | null | undefined, program: (item: Item) => string, extra?: (item: Item) => { [key: string]: number }): ItemActionHook | null => {
    const entry = entryId === null || entryId === undefined ? undefined : state.inventory.items.find((candidate) => candidate.id === entryId);
    const item = entry === undefined ? undefined : lookup(entry.source);
    if (entry === undefined || item === undefined) return null;
    const source = program(item);
    if (source === "") return null;
    return {
      program: source,
      item: { source: entry.source, handle: entry.handle, entryId: entry.id, name: item.name, description: item.description, ...extra?.(item) },
    };
  };
  return {
    use: selection.kind === "use"
      ? hookFor(selection.entryId, (item) => item.menuUseProgram, (item) => ({ menuUseHp: item.menuUseHp, menuUseSmp: item.menuUseSmp }))
      : null,
    remove: selection.kind === "use" ? null : hookFor(selection.displaced?.entryId, (item) => item.onRemoveProgram),
    equip: selection.kind === "replace" ? hookFor(selection.entryId, (item) => item.onEquipProgram) : null,
  };
}

/** Apply one inventory action atomically; event details describe committed available-quantity changes. */
export function applyInventoryAction(
  state: { inventory: InventorySection; actors: ActorsSection },
  value: unknown,
  runtime: InventoryRuntime | undefined,
): { readonly result: MenuStateResult; readonly events: readonly InventoryEvent[] } {
  const action = record(value);
  if (action === null) return { result: rejected("inventory.action", "expected an action object"), events: [] };
  const current = state.inventory;
  let next: InventorySection = current;
  let event: InventoryEvent | null = null;
  let actorOperation: { readonly actorId: number; readonly equipment: readonly InventoryEquipment[] } | null = null;
  let keys: readonly string[];
  let trailingEvent: InventoryEvent | null = null;

  switch (action.type) {
    case "buyItem": {
      keys = ["type", "source", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.amount) || typeof action.source !== "string") return { result: rejected("inventory.action", "expected item source and positive safe integer amount"), events: [] };
      const source = assetKey(`item/${action.source.replaceAll("\\", "/").replace(/^item\//i, "")}`);
      if (!(runtime?.shopStock?.() ?? []).includes(source)) return { result: rejected("shop.stock", "item is not in the active shop stock"), events: [] };
      const definition = runtime?.item(source);
      if (definition === undefined) return { result: rejected("inventory.action.asset", "item definition is unavailable"), events: [] };
      if (!Number.isSafeInteger(definition.buyPrice) || definition.buyPrice < 0) return { result: rejected("inventory.action.price", "buy price must be a non-negative safe integer"), events: [] };
      const cost = definition.buyPrice * action.amount;
      if (!Number.isSafeInteger(cost)) return { result: rejected("inventory.gold", "trade total exceeds the safe-integer range"), events: [] };
      if (cost > current.gold) return { result: rejected("inventory.gold", "insufficient gold"), events: [] };
      const old = current.items.find((entry) => entry.source === source && entry.handle === definition.name);
      const previousQuantity = old?.quantity ?? 0;
      const currentQuantity = previousQuantity + action.amount;
      if (!Number.isSafeInteger(currentQuantity)) return { result: rejected("inventory.items.quantity", "quantity exceeds the safe-integer range"), events: [] };
      let item: InventoryItem;
      if (old === undefined) {
        if (!safeAmount(current.nextId) || current.nextId === MAX_SAFE) return { result: rejected("inventory.nextId", "item identity counter is exhausted"), events: [] };
        item = { id: current.nextId, source, handle: definition.name, quantity: currentQuantity };
        next = { ...current, nextId: current.nextId + 1, items: [...current.items, item] };
      } else {
        item = old;
        next = { ...current, items: current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry) };
      }
      next = { ...next, gold: current.gold - cost };
      event = { type: "itemAdded", detail: { entryId: item.id, source, handle: item.handle, amount: action.amount, previousQuantity, currentQuantity } };
      if (cost > 0) trailingEvent = { type: "goldChanged", detail: { previous: current.gold, current: next.gold, delta: -cost } };
      break;
    }
    case "sellItem": {
      keys = ["type", "entryId", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.entryId) || !safeAmount(action.amount)) return { result: rejected("inventory.action", "expected positive entry id and amount"), events: [] };
      if ((runtime?.shopStock?.().length ?? 0) === 0) return { result: rejected("shop.stock", "selling requires an active shop"), events: [] };
      const old = current.items.find((entry) => entry.id === action.entryId);
      if (old === undefined) return { result: rejected("inventory.action.entryId", "unknown inventory entry"), events: [] };
      if (old.quantity < action.amount) return { result: rejected("inventory.items.quantity", "insufficient available quantity"), events: [] };
      const definition = runtime?.item(old.source);
      if (definition === undefined) return { result: rejected("inventory.action.asset", "item definition is unavailable"), events: [] };
      if (!Number.isSafeInteger(definition.sellPrice) || definition.sellPrice < 0) return { result: rejected("inventory.action.price", "sell price must be a non-negative safe integer"), events: [] };
      const proceeds = definition.sellPrice * action.amount;
      const gold = current.gold + proceeds;
      if (!Number.isSafeInteger(proceeds) || !Number.isSafeInteger(gold)) return { result: rejected("inventory.gold", "trade total exceeds the safe-integer range"), events: [] };
      const currentQuantity = old.quantity - action.amount;
      const retained = currentQuantity !== 0 || current.equipment.some((entry) => entry.itemId === old.id);
      next = { ...current, gold, items: retained
        ? current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry)
        : current.items.filter((entry) => entry.id !== old.id) };
      event = { type: "itemRemoved", detail: { entryId: old.id, source: old.source, handle: old.handle, amount: action.amount, previousQuantity: old.quantity, currentQuantity } };
      if (proceeds > 0) trailingEvent = { type: "goldChanged", detail: { previous: current.gold, current: gold, delta: proceeds } };
      break;
    }
    case "addItem": {
      keys = ["type", "source", "handle", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (typeof action.source !== "string" || !action.source.toLowerCase().endsWith(".itm")) return { result: rejected("inventory.action.source", "expected an .itm asset reference"), events: [] };
      const relativeSource = action.source.replaceAll("\\", "/").replace(/^item\//i, "");
      const source = assetKey(`item/${relativeSource}`);
      if (typeof action.handle !== "string") return { result: rejected("inventory.action.handle", "expected an item handle"), events: [] };
      if (!safeAmount(action.amount)) return { result: rejected("inventory.action.amount", "expected a positive safe integer"), events: [] };
      const old = current.items.find((entry) => entry.source === source && entry.handle === action.handle);
      const previousQuantity = old?.quantity ?? 0;
      const currentQuantity = previousQuantity + action.amount;
      if (!Number.isSafeInteger(currentQuantity)) return { result: rejected("inventory.items.quantity", "quantity exceeds the safe-integer range"), events: [] };
      if (old === undefined) {
        if (!safeAmount(current.nextId) || current.nextId === MAX_SAFE) return { result: rejected("inventory.nextId", "item identity counter is exhausted"), events: [] };
        const item: InventoryItem = { id: current.nextId, source, handle: action.handle, quantity: currentQuantity };
        next = { ...current, nextId: current.nextId + 1, items: [...current.items, item] };
        event = { type: "itemAdded", detail: { entryId: item.id, source: item.source, handle: item.handle, amount: action.amount, previousQuantity, currentQuantity } };
      } else {
        next = { ...current, items: current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry) };
        event = { type: "itemAdded", detail: { entryId: old.id, source: old.source, handle: old.handle, amount: action.amount, previousQuantity, currentQuantity } };
      }
      break;
    }
    case "consumeBattleItem": {
      keys = ["type", "item", "target", "handle"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (typeof action.item !== "string" || action.item.trim() === "") {
        return { result: rejected("inventory.consume.item", "expected an item asset source"), events: [] };
      }
      if (!safeAmount(action.target)) {
        return { result: rejected("inventory.consume.target", "expected a positive actor id"), events: [] };
      }
      const relative = action.item.replaceAll("\\", "/").replace(/^item\//i, "");
      if (!relative.toLowerCase().endsWith(".itm")) {
        return { result: rejected("inventory.consume.item", "expected an .itm asset source"), events: [] };
      }
      const source = assetKey(`item/${relative}`);
      const definition = runtime?.item(source);
      if (definition === undefined) {
        return { result: rejected("inventory.consume.item", "item definition is unavailable"), events: [] };
      }
      if (!state.actors.actors.some((actor) => actor.id === action.target)) {
        return { result: rejected("inventory.consume.target", "target actor is unavailable"), events: [] };
      }
      if (action.handle !== null && (typeof action.handle !== "string" || action.handle === "")) {
        return { result: rejected("inventory.consume.handle", "expected null or a non-empty stack handle"), events: [] };
      }
      const sourceEntries = current.items.filter((entry) => entry.source === source);
      // A named stack is exact: never fall back to the canonical or sole stack of the source.
      const entry = action.handle !== null
        ? sourceEntries.find((candidate) => candidate.handle === action.handle)
        : sourceEntries.find((candidate) => candidate.handle === definition.name) ?? (sourceEntries.length === 1 ? sourceEntries[0] : undefined);
      if (entry === undefined) {
        return {
          result: rejected("inventory.consume.entry", action.handle !== null
            ? "no inventory stack matches the item source and handle"
            : sourceEntries.length === 0
              ? "no inventory stack matches the item source"
              : "item source matches multiple non-canonical inventory stacks"),
          events: [],
        };
      }
      return applyInventoryAction(state, { type: "removeItem", entryId: entry.id, amount: 1 }, runtime);
    }
    case "removeItem": {
      keys = ["type", "entryId", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.entryId) || !safeAmount(action.amount)) return { result: rejected("inventory.action", "expected a positive entry id and amount"), events: [] };
      const old = current.items.find((entry) => entry.id === action.entryId);
      if (old === undefined) return { result: rejected("inventory.action.entryId", "unknown inventory entry"), events: [] };
      if (old.quantity < action.amount) return { result: rejected("inventory.items.quantity", "insufficient available quantity"), events: [] };
      const currentQuantity = old.quantity - action.amount;
      const retained = currentQuantity !== 0 || current.equipment.some((entry) => entry.itemId === old.id);
      next = { ...current, items: retained
        ? current.items.map((entry) => entry.id === old.id ? { ...entry, quantity: currentQuantity } : entry)
        : current.items.filter((entry) => entry.id !== old.id) };
      event = { type: "itemRemoved", detail: { entryId: old.id, source: old.source, handle: old.handle, amount: action.amount, previousQuantity: old.quantity, currentQuantity } };
      break;
    }
    case "equip": {
      keys = ["type", "actorId", "slot", "entryId"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.actorId) || typeof action.slot !== "string" || !safeAmount(action.entryId)) return { result: rejected("inventory.action", "expected actor, slot, and entry identities"), events: [] };
      const actor = state.actors.actors.find((candidate) => candidate.id === action.actorId);
      const entry = current.items.find((candidate) => candidate.id === action.entryId);
      const slot = action.slot;
      if (actor === undefined || actor.kind !== "party") return { result: rejected("inventory.action.actorId", "expected a live party actor"), events: [] };
      if (entry === undefined) return { result: rejected("inventory.action.entryId", "unknown inventory entry"), events: [] };
      if (entry.quantity < 1) return { result: rejected("inventory.items.quantity", "no available item to equip"), events: [] };
      if (current.equipment.some((candidate) => candidate.actorId === actor.id && candidate.slot === slot)) return { result: rejected("inventory.action.slot", "actor slot is already occupied"), events: [] };
      if (runtime === undefined) return { result: rejected("inventory.action.asset", "item and character definitions are unavailable"), events: [] };
      const item = runtime.item(entry.source);
      const character = runtime.character(actor.source);
      if (item === undefined || character === undefined) return { result: rejected("inventory.action.asset", "item or character definition is not available"), events: [] };
      if (!validEquipment(actor, slot, item, character)) return { result: rejected("inventory.action.eligibility", "item is not eligible for this actor and slot"), events: [] };
      const previousQuantity = entry.quantity;
      const currentQuantity = previousQuantity - 1;
      const equipment = [...current.equipment, { actorId: actor.id, slot, itemId: entry.id }];
      const retained = currentQuantity !== 0 || equipment.some((candidate) => candidate.itemId === entry.id);
      next = { ...current,
        items: retained ? current.items.map((candidate) => candidate.id === entry.id ? { ...candidate, quantity: currentQuantity } : candidate) : current.items.filter((candidate) => candidate.id !== entry.id),
        equipment,
      };
      actorOperation = { actorId: actor.id, equipment };
      event = { type: "itemRemoved", detail: { entryId: entry.id, source: entry.source, handle: entry.handle, amount: 1, previousQuantity, currentQuantity } };
      break;
    }
    case "unequip": {
      keys = ["type", "actorId", "slot"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.actorId) || typeof action.slot !== "string") return { result: rejected("inventory.action", "expected actor and slot identities"), events: [] };
      if (slotLocation(action.slot) === null) return { result: rejected("inventory.action.slot", "unknown equipment slot"), events: [] };
      const actor = state.actors.actors.find((candidate) => candidate.id === action.actorId);
      if (actor === undefined || actor.kind !== "party") return { result: rejected("inventory.action.actorId", "expected a live party actor"), events: [] };
      const oldEquipment = current.equipment.find((candidate) => candidate.actorId === actor.id && candidate.slot === action.slot);
      if (oldEquipment === undefined) return { result: { ok: true, error: null }, events: [] };
      if (runtime === undefined) return { result: rejected("inventory.action.asset", "item definitions are unavailable"), events: [] };
      const itemEntry = current.items.find((candidate) => candidate.id === oldEquipment.itemId);
      if (itemEntry === undefined) return { result: rejected("inventory.equipment.itemId", "equipped item entry is missing"), events: [] };
      const currentQuantity = itemEntry.quantity + 1;
      if (!Number.isSafeInteger(currentQuantity)) return { result: rejected("inventory.items.quantity", "quantity exceeds the safe-integer range"), events: [] };
      const equipment = current.equipment.filter((candidate) => candidate !== oldEquipment);
      next = { ...current,
        items: current.items.map((candidate) => candidate.id === itemEntry.id ? { ...candidate, quantity: currentQuantity } : candidate),
        equipment,
      };
      actorOperation = { actorId: actor.id, equipment };
      event = { type: "itemAdded", detail: { entryId: itemEntry.id, source: itemEntry.source, handle: itemEntry.handle, amount: 1, previousQuantity: itemEntry.quantity, currentQuantity } };
      break;
    }
    case "addGold":
    case "removeGold": {
      keys = ["type", "amount"];
      const error = exactAction(action, keys);
      if (error !== null) return { result: { ok: false, error }, events: [] };
      if (!safeAmount(action.amount, true)) return { result: rejected("inventory.action.amount", "expected a non-negative safe integer"), events: [] };
      if (action.amount === 0) return { result: ACCEPTED, events: [] };
      const currentGold = action.type === "addGold" ? current.gold + action.amount : current.gold - action.amount;
      if (!Number.isSafeInteger(currentGold) || currentGold < 0) return { result: rejected("inventory.gold", "gold operation exceeds available safe-integer bounds"), events: [] };
      next = { ...current, gold: currentGold };
      event = { type: "goldChanged", detail: { previous: current.gold, current: currentGold, delta: currentGold - current.gold } };
      break;
    }
    default:
      return { result: rejected("inventory.action.type", "unknown inventory action"), events: [] };
  }

  const validation = validateInventorySection(next, state.actors);
  if (validation !== null) return { result: { ok: false, error: validation }, events: [] };
  if (actorOperation !== null) {
    if (runtime === undefined) return { result: rejected("inventory.action.asset", "item definitions are unavailable"), events: [] };
    const catalog = equipmentCatalog(actorOperation.actorId, actorOperation.equipment, next.items, runtime.item);
    if (catalog === null) return { result: rejected("inventory.equipment", "an equipped item definition is not available"), events: [] };
    try {
      if (!runtime.applyEquipment(actorOperation.actorId, catalog.equipped, catalog.catalog)) {
        return { result: rejected("inventory.equipment", "actor equipment operation refused"), events: [] };
      }
    } catch {
      return { result: rejected("inventory.equipment", "actor equipment operation refused"), events: [] };
    }
  }
  state.inventory = next;
  return { result: ACCEPTED, events: event === null ? [] : trailingEvent === null ? [event] : [event, trailingEvent] };
}

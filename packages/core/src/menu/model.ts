/** Section-owned save data; docs/spec/formats/save-game.md#reawakened-canonical-party-inventory-and-menu-state. */
import type { ActorsSection } from "../actors/model.ts";
import type { PlainData } from "../ports/plain-data.ts";

export const PARTY_SCHEMA_VERSION = 3;
export const INVENTORY_SCHEMA_VERSION = 2;
export const MENU_SCHEMA_VERSION = 2;

export type PartySection = {
  version: number;
  members: number[];
  selected: number | null;
  steps: number;
  /** Accumulated movement below one tile, in 1/256-pixel units. */
  stepRemainder: number;
};
export type InventoryItem = { id: number; source: string; handle: string; quantity: number };
export type InventoryEquipment = { actorId: number; slot: string; itemId: number };
export type InventorySection = {
  version: number;
  nextId: number;
  items: InventoryItem[];
  equipment: InventoryEquipment[];
  gold: number;
};
export type MenuScreen = { screen: string; actorId: number | null; selection: number };
export type MenuSection = { version: number; screens: MenuScreen[]; graphic: string | null };
export type StateIssue = { readonly path: string; readonly message: string };
export type MenuStateResult = { readonly ok: boolean; readonly error: StateIssue | null };
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export function createPartySection(): PartySection {
  return { version: PARTY_SCHEMA_VERSION, members: [], selected: null, steps: 0, stepRemainder: 0 };
}
export function createInventorySection(): InventorySection {
  return { version: INVENTORY_SCHEMA_VERSION, nextId: 1, items: [], equipment: [], gold: 0 };
}
export function createMenuSection(): MenuSection {
  return { version: MENU_SCHEMA_VERSION, screens: [], graphic: null };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function issue(path: string, message: string): StateIssue {
  return { path, message };
}
function fields(value: unknown, keys: readonly string[], path: string): StateIssue | null {
  if (!record(value)) return issue(path, "expected an object");
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) return issue(`${path}.${key}`, "required field is missing");
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return issue(`${path}.${key}`, "unexpected field");
  }
  return null;
}
function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function actorExists(actors: ActorsSection, id: unknown, partyOnly = false): boolean {
  return integer(id, 1) && actors.actors.some((actor) => actor.id === id && (!partyOnly || actor.kind === "party"));
}

/** Validate decoded data once at the section boundary, returning a located issue. */
export function validatePartySection(value: unknown, actors: ActorsSection): StateIssue | null {
  const shape = fields(value, ["version", "members", "selected", "steps", "stepRemainder"], "party");
  if (shape !== null) return shape;
  const section = value as Record<string, unknown>;
  if (section.version !== PARTY_SCHEMA_VERSION) return issue("party.version", "expected version 3");
  if (!Array.isArray(section.members)) return issue("party.members", "expected an array");
  if (section.members.length > 5) return issue("party.members", "expected at most five members");
  const seen = new Set<number>();
  for (const [index, member] of section.members.entries()) {
    if (!actorExists(actors, member, true)) return issue(`party.members[${index}]`, "expected a live party actor id");
    if (seen.has(member as number)) return issue(`party.members[${index}]`, "duplicate party member");
    seen.add(member as number);
  }
  if (section.members.length === 0 ? section.selected !== null : !seen.has(section.selected as number)) {
    return issue("party.selected", "expected a member id, or null for an empty party");
  }
  if (!integer(section.steps, 0)) return issue("party.steps", "expected a non-negative safe integer");
  if (!integer(section.stepRemainder, 0) || section.stepRemainder >= 32 * 256) {
    return issue("party.stepRemainder", "expected a non-negative safe integer below 8192");
  }
  return null;
}

export function validateInventorySection(value: unknown, actors: ActorsSection): StateIssue | null {
  const shape = fields(value, ["version", "nextId", "items", "equipment", "gold"], "inventory");
  if (shape !== null) return shape;
  const section = value as Record<string, unknown>;
  if (section.version !== INVENTORY_SCHEMA_VERSION) return issue("inventory.version", "expected version 2");
  if (!integer(section.nextId, 1)) return issue("inventory.nextId", "expected a positive safe integer");
  if (!integer(section.gold, 0)) return issue("inventory.gold", "expected a non-negative safe integer");
  if (!Array.isArray(section.items)) return issue("inventory.items", "expected an array");
  const ids = new Set<number>();
  const identities = new Map<string, Set<string>>();
  for (const [index, value] of section.items.entries()) {
    const path = `inventory.items[${index}]`;
    const shape = fields(value, ["id", "source", "handle", "quantity"], path);
    if (shape !== null) return shape;
    const item = value as Record<string, unknown>;
    if (!integer(item.id, 1) || item.id >= section.nextId || ids.has(item.id)) return issue(`${path}.id`, "expected a distinct positive identity below nextId");
    if (!nonempty(item.source)) return issue(`${path}.source`, "expected a non-empty asset reference");
    if (typeof item.handle !== "string") return issue(`${path}.handle`, "expected a string");
    if (!integer(item.quantity, 0)) return issue(`${path}.quantity`, "expected a non-negative safe integer");
    const handles = identities.get(item.source) ?? new Set<string>();
    if (handles.has(item.handle)) return issue(`${path}.handle`, "duplicate source/handle identity");
    handles.add(item.handle);
    identities.set(item.source, handles);
    ids.add(item.id);
  }
  if (!Array.isArray(section.equipment)) return issue("inventory.equipment", "expected an array");
  const slots = new Map<number, Set<string>>();
  for (const [index, value] of section.equipment.entries()) {
    const path = `inventory.equipment[${index}]`;
    const shape = fields(value, ["actorId", "slot", "itemId"], path);
    if (shape !== null) return shape;
    const entry = value as Record<string, unknown>;
    if (!actorExists(actors, entry.actorId)) return issue(`${path}.actorId`, "expected a live actor id");
    if (!nonempty(entry.slot)) return issue(`${path}.slot`, "expected a non-empty slot name");
    if (!integer(entry.itemId, 1) || !ids.has(entry.itemId)) return issue(`${path}.itemId`, "expected an existing inventory identity");
    const actorSlots = slots.get(entry.actorId as number) ?? new Set<string>();
    if (actorSlots.has(entry.slot)) return issue(`${path}.slot`, "duplicate actor/slot assignment");
    actorSlots.add(entry.slot);
    slots.set(entry.actorId as number, actorSlots);
  }
  return null;
}

export function validateMenuSection(value: unknown, actors: ActorsSection): StateIssue | null {
  const shape = fields(value, ["version", "screens", "graphic"], "menu");
  if (shape !== null) return shape;
  const section = value as Record<string, unknown>;
  if (section.version !== MENU_SCHEMA_VERSION) return issue("menu.version", "expected version 2");
  if (section.graphic !== null && !nonempty(section.graphic)) return issue("menu.graphic", "expected a non-empty asset reference or null");
  if (!Array.isArray(section.screens)) return issue("menu.screens", "expected an array");
  for (const [index, value] of section.screens.entries()) {
    const path = `menu.screens[${index}]`;
    const shape = fields(value, ["screen", "actorId", "selection"], path);
    if (shape !== null) return shape;
    const screen = value as Record<string, unknown>;
    if (!nonempty(screen.screen)) return issue(`${path}.screen`, "expected a non-empty screen name");
    if (screen.actorId !== null && !actorExists(actors, screen.actorId)) return issue(`${path}.actorId`, "expected a live actor id or null");
    if (!integer(screen.selection, 0)) return issue(`${path}.selection`, "expected a non-negative safe integer");
  }
  return null;
}

/**
 * A frozen deep copy of a section an owner publishes (E-80/E-81). The *live* section is never frozen: a reader must
 * not be able to change an owner's state, and an owner's own in-place writer must not be broken by a read.
 */
export function readonlyCopy<T extends PlainData>(value: T): DeepReadonly<T> {
  return readonlySection(JSON.parse(JSON.stringify(value)) as T);
}

/** Freeze `value` and its children in place. Callers publishing live state use `readonlyCopy`. */
export function readonlySection<T>(value: T): DeepReadonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) readonlySection(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Exact action keys are also validated at the effect boundary. */
export function validateActionFields(value: unknown, keys: readonly string[], path: string): StateIssue | null {
  return fields(value, keys, path);
}

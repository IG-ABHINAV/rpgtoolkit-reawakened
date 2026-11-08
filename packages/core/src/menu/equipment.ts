/**
 * The pure equipment derivation shared by the inventory owner and the save
 * equipment consistency check (docs/spec/engine/plugins-and-battle.md#e-82).
 *
 * A saved `(actorId, slot, itemId)` tuple derives an actor-scoped opaque
 * reference and the actor catalog entry built from the current `.itm`
 * definition. Nothing here mutates state, applies a bonus to an actor or runs a
 * behaviour hook.
 */
import type { ActorRecord } from "../actors/model.ts";
import type { Character, Item } from "../formats/actor/model.ts";
import type { EquipmentItemDefinition } from "../actors/rules.ts";
import type { InventoryEquipment, InventoryItem } from "./model.ts";

/** The six standard body slots as canonical save tokens (E-82). */
const STANDARD_SLOTS: Readonly<Record<string, number>> = {
  head: 1,
  neck: 2,
  "right-hand": 3,
  "left-hand": 4,
  body: 5,
  legs: 6,
};

/** The six body slots in the order the screens list them (E-82). */
export const BODY_SLOT_TOKENS = ["head", "neck", "right-hand", "left-hand", "body", "legs"] as const;

/** The one token every named accessory shares in the item-side flag table (E-82). */
export const ACCESSORY_SLOT_TOKEN = "accessory";

/** The `.itm` flag index every named accessory shares (E-82). */
export const ACCESSORY_FLAG_INDEX = 7;

/** The editor locations of the named accessory slots, `accessory-7` … `accessory-16` (E-82). */
export const ACCESSORY_LOCATIONS: readonly number[] = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** The editor's equipment location for a canonical slot token, or null when it is unknown. */
export function slotLocation(slot: string): number | null {
  const standard = STANDARD_SLOTS[slot];
  if (standard !== undefined) return standard;
  const match = /^accessory-(\d{1,2})$/.exec(slot);
  if (match === null) return null;
  const location = Number(match[1]);
  return ACCESSORY_LOCATIONS.includes(location) ? location : null;
}

/**
 * The `.itm` / `.tem` array index that stores one canonical slot token's value (E-82).
 *
 * The two hand locations are stored in the opposite order to the canonical tokens, so `right-hand` reads index 4 and
 * `left-hand` index 3; every named accessory shares `ACCESSORY_FLAG_INDEX`. The item-side flags and the character-side
 * body slots use the same indices, and `packs/menu.ts` exposes them to the screens through this function, so the list a
 * screen offers and this module's refusal cannot disagree. Null for a token that names no slot.
 */
export function slotFlagIndex(slot: string): number | null {
  const location = slotLocation(slot);
  if (location === null) return null;
  if (location === 3) return 4;
  if (location === 4) return 3;
  return location <= 6 ? location : ACCESSORY_FLAG_INDEX;
}

/**
 * The canonical slot token an editor equipment location names (E-82), the inverse of `slotLocation`. Null for a
 * location that is not a whole number: a fractional or non-finite value names no slot, so the caller must not round it
 * into a neighbouring one.
 */
export function slotTokenAt(location: number): string | null {
  if (!Number.isInteger(location)) return null;
  const clamped = location;
  for (const token of BODY_SLOT_TOKENS) if (STANDARD_SLOTS[token] === clamped) return token;
  return ACCESSORY_LOCATIONS.includes(clamped) ? `accessory-${clamped}` : null;
}

/** The character array index that names one accessory slot's accessory (E-82). */
export function accessoryNameIndex(location: number): number {
  return location - 6;
}

/** The deterministic actor-scoped reference a saved tuple derives (E-82). */
function equippedReference(actorId: number, slot: string, itemId: number): string {
  return `tkr-equipment:${JSON.stringify([actorId, slot, itemId])}`;
}

/**
 * Derive one actor's equipped references and catalog from its inventory tuples
 * and the current item definitions, disambiguating deterministically against
 * the finite catalog (E-82). Returns null when an equipped definition is
 * unavailable.
 */
export function equipmentCatalog(
  actorId: number,
  equipment: readonly InventoryEquipment[],
  items: readonly InventoryItem[],
  itemForSource: (source: string) => Item | undefined,
): { readonly equipped: string[]; readonly catalog: EquipmentItemDefinition[] } | null {
  const entries = equipment.filter((entry) => entry.actorId === actorId);
  const names: string[] = [];
  const definitions: Array<{ entry: InventoryEquipment; item: Item }> = [];
  for (const entry of entries) {
    const stack = items.find((candidate) => candidate.id === entry.itemId);
    const item = stack === undefined ? undefined : itemForSource(stack.source);
    if (item === undefined) return null;
    names.push(item.name);
    definitions.push({ entry, item });
  }
  const used = new Set(names);
  const equipped: string[] = [];
  const catalog: EquipmentItemDefinition[] = [];
  for (const { entry, item } of definitions) {
    const base = equippedReference(actorId, entry.slot, entry.itemId);
    let id = base;
    let suffix = 0;
    while (used.has(id)) {
      suffix += 1;
      id = `${base}#${suffix}`;
    }
    used.add(id);
    equipped.push(id);
    catalog.push({ name: item.name, id, equipBonus: item.equipBonus });
  }
  return { equipped, catalog };
}

/**
 * The slot- and asset-only eligibility rule (E-82): flags and character slots
 * only. It deliberately ignores the `usedBy` name list, which the live `equip`
 * operation checks against `actor.name`; a name is script-writable progress and
 * is not part of an asset's slot compatibility.
 */
export function validEquipmentSlot(slot: string, item: Item, character: Character): boolean {
  const location = slotLocation(slot);
  const flagIndex = slotFlagIndex(slot);
  if (location === null || flagIndex === null || item.equipable !== 1) return false;
  if (item.equipSlots[flagIndex] !== 1) return false;
  if (location <= 6 && character.bodySlots[flagIndex] !== 1) return false;
  if (location >= 7) {
    const characterSlot = character.accessorySlots[accessoryNameIndex(location)];
    return characterSlot !== undefined && characterSlot !== "" && characterSlot === item.accessoryName;
  }
  return true;
}

/** The pure eligibility rule the `equip` operation enforces (E-82). */
export function validEquipment(
  actor: ActorRecord,
  slot: string,
  item: Item,
  character: Character,
): boolean {
  const names = item.allowedCharacters.filter((name) => name !== "");
  if (item.usedBy === 1 && !names.includes(actor.name)) return false;
  return validEquipmentSlot(slot, item, character);
}

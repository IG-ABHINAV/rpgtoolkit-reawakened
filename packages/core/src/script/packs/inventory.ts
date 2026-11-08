import type { Value } from "../../ports/value.ts";
import type { PlainData } from "../../ports/plain-data.ts";
import { assetKey } from "../../formats/resolver/resolver.ts";
import { BinaryReader } from "../../formats/binary/reader.ts";
import { readItem } from "../../formats/actor/item.ts";
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import { foldAscii } from "../values.ts";
import type { HostObjectType } from "../host.ts";
import { createObject, writeMember } from "../objects.ts";
import { objectValue } from "../../audio/script.ts";
import { isItemActionRequest, ITEM_ACTION_ASSET_COMMAND, ITEM_ACTION_COMPLETE_COMMAND } from "../item-action.ts";
import type { ItemActionRequest } from "../../menu/ports.ts";
import { slotTokenAt } from "../../menu/equipment.ts";
import type { CommandEffect, CommandResult, CommandView, PluginDefinition } from "../plugin.ts";

const INVENTORY_GROUP = "items-inventory-shop-gold-28";
const ITEM_NAMES = ["giveitem", "takeitem", "itemcount", "givegp", "takegp", "getgp", "equip", "remove"] as const;

/** The hydrated host object the RPGCode menu context carries as `context.inventory` (E-81, #589). */
export const INVENTORY_HOST_TYPE_NAME = "inventory";

type ItemOperation = "addItem" | "removeItem";

function integer(args: readonly Arg[], index: number): number {
  const value = args[index]?.value;
  return typeof value === "number" ? value : Number.NaN;
}
function text(args: readonly Arg[], index: number): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : "";
}
function output(args: readonly Arg[], index: number, value: Value): readonly (readonly [number, Value])[] {
  return args[index] === undefined || args[index]?.ref === null ? [] : [[index, value]];
}
function menuAction(view: CommandView, action: object): CommandResult {
  if (view.state === undefined) return { value: null };
  return { value: null, effects: [{ kind: "state-write", section: "inventory", args: [action as never] }] };
}
function docs(summary: string, behaviour: string): BuiltinDoc {
  return { summary, behaviour, groups: [INVENTORY_GROUP], tags: ["legacy"], waits: { kind: "never", summary: "Does not wait." } };
}
function waitingDocs(summary: string, behaviour: string): BuiltinDoc {
  return { ...docs(summary, behaviour), waits: { kind: "other", summary: "Blocks the calling thread while item programs and definition requests run; does not wait when nothing needs them." } };
}
function itemFilename(value: string): string {
  const filename = value.trim().replaceAll("\\", "/");
  return filename.toLowerCase().endsWith(".itm") ? filename : `${filename}.itm`;
}
function itemSource(filename: string): string {
  const relative = filename.replace(/^item\//i, "");
  return assetKey(`item/${relative}`);
}
function itemActionStart(action: ItemActionRequest, adapter: "equip" | "remove" | null): CommandResult {
  const effect: CommandEffect = { kind: "vm.control", args: ["itemAction.start", action as unknown as PlainData, adapter] };
  return { value: null, effects: [effect] };
}
const AMBIGUOUS_STACK = "inventory.action.entryId: the item query names more than one inventory stack";
/** #1198: a unique exact handle first, then a unique case-insensitive handle; several of either is ambiguous. */
function stackByHandle(view: CommandView, query: string): number | "ambiguous" | undefined {
  const items = view.state?.inventory.items ?? [];
  const exact = items.filter((entry) => entry.handle === query);
  if (exact.length > 0) return exact.length === 1 ? exact[0]!.id : "ambiguous";
  const folded = items.filter((entry) => entry.handle.toLowerCase() === query.toLowerCase());
  if (folded.length > 0) return folded.length === 1 ? folded[0]!.id : "ambiguous";
  return undefined;
}
function itemRequest(operation: ItemOperation, filename: string): CommandResult {
  const path = itemFilename(filename);
  return {
    value: null,
    request: { kind: "asset", area: "items", path },
    then: { command: "__inventory_item_asset", args: [operation, path] },
  };
}
function shopRequest(paths: readonly string[], index = 0, sources: readonly string[] = []): CommandResult {
  const path = paths[index];
  if (path === undefined) throw new ScriptError("menu.shop-invalid", "shop stock requires at least one item filename");
  return {
    value: null,
    request: { kind: "asset", area: "items", path },
    then: { command: "__inventory_shop_asset", args: [path, JSON.stringify(paths), JSON.stringify(sources)] },
  };
}
function jsonStrings(value: string, label: string): string[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new ScriptError("request.bad-reply", `${label} must be a JSON string list`);
  }
  if (!Array.isArray(decoded) || !decoded.every((entry) => typeof entry === "string")) {
    throw new ScriptError("request.bad-reply", `${label} must be a JSON string list`);
  }
  return decoded;
}
function partyActor(view: CommandView, handle: unknown): number | undefined {
  const state = view.state;
  if (state === undefined) return undefined;
  const members = new Set(state.party.members);
  const value = String(handle);
  return state.actors.actors.find((candidate) => members.has(candidate.id) &&
    (String(candidate.id) === value || candidate.name.toLowerCase() === value.toLowerCase() || candidate.source.toLowerCase() === value.toLowerCase()))?.id;
}
function slotAt(location: number): string {
  const clamped = Math.min(16, Math.max(1, location));
  // A location that names no slot keeps the old `accessory-<location>` token, which the owner then refuses; it must not
  // be rounded into a neighbouring slot.
  return slotTokenAt(clamped) ?? `accessory-${clamped}`;
}
function params(names: readonly { name: string; optional?: boolean; byRef?: boolean }[]): BuiltinSpec["params"] {
  return names.map(({ name, optional = false, byRef = false }) => ({ name, optional, byRef, variadic: false }));
}

const GIVE_ITEM: BuiltinSpec = {
  name: "giveitem", aliases: [], params: params([{ name: "itm" }]),
  doc: docs("Add one item from an item file to the inventory.", "Resolves the supplied filename (appending .itm when absent), then adds one unit through the inventory owner."),
  call: (_view, args) => itemRequest("addItem", text(args, 0)),
};
const TAKE_ITEM: BuiltinSpec = {
  name: "takeitem", aliases: [], params: params([{ name: "itm" }]),
  doc: docs("Remove one available item from the inventory by item filename.", "Resolves the supplied filename (appending .itm when absent), then removes one available unit through the inventory owner; keyItem does not restrict this script built-in."),
  call: (_view, args) => itemRequest("removeItem", text(args, 0)),
};
const GIVE_GOLD: BuiltinSpec = {
  name: "givegp", aliases: [], params: params([{ name: "gp" }]),
  doc: docs("Add gold through the inventory owner.", "A non-negative safe integer is accepted; zero is a no-op, and invalid or overflowing additions are refused atomically."),
  call: (view, args) => menuAction(view, { type: "addGold", amount: integer(args, 0) }),
};
const TAKE_GOLD: BuiltinSpec = {
  name: "takegp", aliases: [], params: params([{ name: "gp" }]),
  doc: docs("Remove gold through the inventory owner.", "A non-negative safe integer is accepted; zero is a no-op, and invalid or unaffordable removals are refused atomically."),
  call: (view, args) => menuAction(view, { type: "removeGold", amount: integer(args, 0) }),
};
const GET_GOLD: BuiltinSpec = {
  name: "getgp", aliases: [], params: params([{ name: "ret", optional: true, byRef: true }]),
  doc: docs("Read current inventory gold.", "Returns the current gold balance and writes it to the optional by-reference output."),
  call: (view, args) => {
    const gold = view.state?.inventory.gold ?? 0;
    return { value: gold, out: output(args, 0, gold) };
  },
};
const ITEM_COUNT: BuiltinSpec = {
  name: "itemcount", aliases: [], params: params([{ name: "fileName" }, { name: "ret", optional: true, byRef: true }]),
  doc: docs("Count available inventory items by filename or handle.", "An argument ending in .itm compares filenames case-insensitively; otherwise it compares item handles case-insensitively. The result is available quantity."),
  call: (view, args) => {
    const query = text(args, 0).replaceAll("\\", "/").toLowerCase();
    const byFilename = query.endsWith(".itm");
    const wanted = byFilename ? query.replace(/^item\//, "") : query;
    let count = 0;
    for (const entry of view.state?.inventory.items ?? []) {
      const candidate = byFilename ? entry.source.toLowerCase().replace(/^item\//, "") : entry.handle.toLowerCase();
      if (candidate !== wanted) continue;
      count += entry.quantity;
      if (!Number.isSafeInteger(count)) throw new ScriptError("inventory.count-range", "item count exceeds the safe-integer range");
    }
    return { value: count, out: output(args, 1, count) };
  },
};
const EQUIP: BuiltinSpec = {
  name: "equip", aliases: [], params: params([{ name: "handle" }, { name: "location" }, { name: "item" }]),
  doc: waitingDocs("Equip one available item on a party member, running the old item's remove program and the new item's equip program.", "Resolves handle as a party member handle or character filename, clamps the 1-based location to 1–16, then selects the stack: a unique exact item handle, else a unique case-insensitive handle (a matched handle selects that exact stack even if unavailable), else the stack of the item file's own definition name, else its only stack. Several matches are refused with a catchable `menu.state-invalid` at `inventory.action.entryId`. It runs the composed `replace` action on this thread: the displaced item's remove program, the replacement, then the new item's equip program, and the call returns only after those programs finish. A refused or interrupted action raises a catchable `menu.state-invalid`; an unknown party member or item is a silent no-op."),
  call: (view, args) => {
    const actorId = partyActor(view, args[0]?.value);
    if (actorId === undefined) return { value: null };
    const slot = slotAt(integer(args, 1));
    const query = text(args, 2);
    const byHandle = stackByHandle(view, query);
    if (byHandle === "ambiguous") throw new ScriptError("menu.state-invalid", AMBIGUOUS_STACK);
    if (byHandle !== undefined) return itemActionStart({ kind: "replace", entryId: byHandle, actorId, slot }, "equip");
    const source = itemSource(itemFilename(query));
    const stacks = (view.state?.inventory.items ?? []).filter((entry) => entry.source === source);
    if (stacks.length === 0) return { value: null };
    if (stacks.length === 1) return itemActionStart({ kind: "replace", entryId: stacks[0]!.id, actorId, slot }, "equip");
    return {
      value: null,
      request: { kind: "asset", area: "items", path: itemFilename(query) },
      then: { command: "__inventory_equip_select", args: [actorId, slot, source] },
    };
  },
};
const REMOVE: BuiltinSpec = {
  name: "remove", aliases: [], params: params([{ name: "handle" }, { name: "location" }]),
  doc: waitingDocs("Unequip an item from a party member, running its remove program.", "Resolves handle as a party member handle or character filename and clamps the 1-based location to 1–16, then runs the composed `removeEquipment` action on this thread: an occupied slot's remove program runs before the item returns to available inventory, and an empty slot completes as a no-op. A refused or interrupted action raises a catchable `menu.state-invalid`; an unknown party member is a silent no-op."),
  call: (view, args) => {
    const actorId = partyActor(view, args[0]?.value);
    if (actorId === undefined) return { value: null };
    return itemActionStart({ kind: "removeEquipment", actorId, slot: slotAt(integer(args, 1)) }, "remove");
  },
};
function itemReplyName(args: readonly Arg[]): string {
  const hex = text(args, 1);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "item asset reply must be hexadecimal bytes");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  const parsed = readItem(new BinaryReader(bytes));
  if (!parsed.ok) throw new ScriptError("format.item", parsed.error.message);
  return parsed.value.name;
}
const EQUIP_SELECT: BuiltinSpec = {
  name: "__inventory_equip_select", aliases: [],
  params: params([{ name: "ok" }, { name: "bytes" }, { name: "actorId" }, { name: "slot" }, { name: "source" }]),
  doc: { ...docs("Select the stack named for an item file.", "Reads the item definition's name from the reply, chooses the stack of that file named for it (exact, then case-insensitive), refuses several candidates and starts the composed replace action."), access: "internal" },
  call: (view, args) => {
    if (integer(args, 0) === 0) throw new ScriptError("asset.missing", `equipment item asset not found: ${text(args, 4)}`);
    const name = itemReplyName(args);
    const stacks = (view.state?.inventory.items ?? []).filter((entry) => entry.source === text(args, 4));
    if (stacks.length === 0) return { value: null };
    const exact = stacks.filter((entry) => entry.handle === name);
    const named = exact.length > 0 ? exact : stacks.filter((entry) => entry.handle.toLowerCase() === name.toLowerCase());
    if (named.length !== 1) throw new ScriptError("menu.state-invalid", AMBIGUOUS_STACK);
    return itemActionStart({ kind: "replace", entryId: named[0]!.id, actorId: integer(args, 2), slot: text(args, 3) }, "equip");
  },
};
function actionDictionary(view: CommandView, name: string, kind: ItemActionRequest["kind"], arg: Arg | undefined): ItemActionRequest {
  const value = arg?.value;
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") {
    throw new ScriptError("builtin.bad-arg", `${name}: the action must be a dictionary`);
  }
  const members = view.objectMembers?.(value.handle);
  if (members === undefined) throw new ScriptError("builtin.bad-arg", `${name}: the action must be a live dictionary`);
  const wanted = kind === "use" ? ["entryId", "actorId"] : kind === "replace" ? ["entryId", "actorId", "slot"] : ["actorId", "slot"];
  const folded = new Map<string, Value>();
  for (const key of Object.keys(members)) folded.set(foldAscii(key), members[key]!);
  if (folded.size !== Object.keys(members).length || folded.size !== wanted.length || !wanted.every((key) => folded.has(foldAscii(key)))) {
    throw new ScriptError("builtin.bad-arg", `${name}: the action takes exactly ${wanted.join(", ")}`);
  }
  const request = { kind, ...Object.fromEntries(wanted.map((key) => [key, folded.get(foldAscii(key))])) };
  if (!isItemActionRequest(request)) throw new ScriptError("builtin.bad-arg", `${name}: ${wanted.join(", ")} have the wrong types`);
  return request;
}
function internalDocs(summary: string, behaviour: string, kind: DocWaitKind = "other"): BuiltinDoc {
  return {
    ...docs(summary, behaviour),
    access: "internal",
    waits: { kind, summary: kind === "never" ? "Does not wait." : "Runs on the calling thread across item programs and host definition requests." },
  };
}
type DocWaitKind = "never" | "other";
function hostAction(name: string, kind: ItemActionRequest["kind"], summary: string): BuiltinSpec {
  return {
    name, aliases: [], params: params([{ name: "self" }, { name: "action" }]),
    doc: internalDocs(summary, "Blocks the calling thread through the shared item-action lifecycle: definitions are requested as needed, the owner preflights, item programs run with their E-95 contexts, and the owner commits. Returns `{ status, error }` with status `complete`, `refused` or `interrupted`."),
    call: (view, args) => itemActionStart(actionDictionary(view, name, kind, args[1]), null),
  };
}
const USE_ITEM = hostAction("__inventory_use", "use", "Use an inventory stack on a party member from the menu context.");
const REMOVE_STACK: BuiltinSpec = {
  name: "__inventory_remove_stack", aliases: [], params: params([{ name: "self" }, { name: "action" }]),
  doc: internalDocs("Remove available units from one inventory stack from the menu context.", "Validates `entryId` and `amount`, then applies the E-81 primitive `removeItem` through the inventory owner and returns its standard result. It runs no item program and changes nothing when the owner refuses."),
  call: (view, args) => {
    const value = args[1]?.value;
    if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") {
      throw new ScriptError("builtin.bad-arg", "__inventory_remove_stack: the action must be a dictionary");
    }
    const members = view.objectMembers?.(value.handle);
    if (members === undefined) throw new ScriptError("builtin.bad-arg", "__inventory_remove_stack: the action must be a live dictionary");
    const folded = new Map<string, Value>();
    for (const key of Object.keys(members)) folded.set(foldAscii(key), members[key]!);
    if (folded.size !== 2 || !folded.has("entryid") || !folded.has("amount")) {
      throw new ScriptError("builtin.bad-arg", "__inventory_remove_stack: the action takes exactly entryId, amount");
    }
    const entryId = folded.get("entryid")!;
    const amount = folded.get("amount")!;
    if (typeof entryId !== "number" || !Number.isSafeInteger(entryId) || entryId < 1) {
      throw new ScriptError("builtin.bad-arg", "__inventory_remove_stack: entryId must be a positive safe integer");
    }
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1) {
      throw new ScriptError("builtin.bad-arg", "__inventory_remove_stack: amount must be a positive safe integer");
    }
    return menuAction(view, { type: "removeItem", entryId, amount });
  },
};
const REPLACE_EQUIPMENT = hostAction("__inventory_replace", "replace", "Replace an occupied or empty equipment slot from the menu context.");
const REMOVE_EQUIPMENT = hostAction("__inventory_remove_equipment", "removeEquipment", "Remove an equipped item from the menu context.");
const ITEM_ACTION_ASSET: BuiltinSpec = {
  name: ITEM_ACTION_ASSET_COMMAND, aliases: [], params: params([{ name: "ok" }, { name: "bytes" }]),
  doc: internalDocs("Resume an item action after a definition request.", "Delivers the host reply to the pending item action on the calling frame.", "never"),
  call: (_view, args) => ({ value: null, effects: [{ kind: "vm.control", args: ["itemAction.resume", integer(args, 0)] }] }),
};
const ITEM_ACTION_COMPLETE: BuiltinSpec = {
  name: ITEM_ACTION_COMPLETE_COMMAND, aliases: [], params: [],
  doc: internalDocs("Deliver a native item action's completion.", "Dispatches the one `item.action.completed` event to the saved native provider continuation.", "never"),
  call: () => ({ value: null, effects: [{ kind: "vm.control", args: ["itemAction.complete"] }] }),
};
/** A fresh RPGCode dictionary whose entries are the given plain records, indexed 0..n-1. */
function dictionary(vm: Parameters<typeof createObject>[0], rows: readonly { readonly [key: string]: Value }[]): Value {
  const array = createObject(vm, null);
  rows.forEach((row, index) => {
    const record = createObject(vm, null);
    for (const [key, value] of Object.entries(row)) writeMember(record, key, value);
    writeMember(array, String(index), objectValue(record));
  });
  writeMember(array, "length", rows.length);
  return objectValue(array);
}

/** The hydrated `context.inventory` object of an RPGCode menu provider (E-81, #589). */
export const INVENTORY_HOST_TYPE: HostObjectType = {
  name: INVENTORY_HOST_TYPE_NAME,
  methods: {
    use: "__inventory_use",
    replace: "__inventory_replace",
    removeequipment: "__inventory_remove_equipment",
    removeitem: "__inventory_remove_stack",
    buyitem: "__inventory_buy",
    sellitem: "__inventory_sell",
  },
  readOnlyMembers: ["items", "equipment", "gold"],
  /**
   * Read-only views over the owner sections (E-81): `gold` is the balance and `items`/`equipment` are
   * fresh dictionaries built per read, so a provider sees current committed state and cannot mutate it.
   */
  read(context, name) {
    const state = context.state;
    if (name === "gold") return state.inventory.gold;
    if (name === "items") {
      return dictionary(context.vm, state.inventory.items.map((entry) => ({
        id: entry.id, source: entry.source, handle: entry.handle, quantity: entry.quantity,
      })));
    }
    if (name === "equipment") {
      return dictionary(context.vm, state.inventory.equipment.map((entry) => ({
        actorid: entry.actorId, slot: entry.slot, itemid: entry.itemId,
      })));
    }
    return undefined;
  },
  write() {
    return "read-only";
  },
  remove() {
    return "system-owned";
  },
};
const ITEM_ASSET_CONTINUATION: BuiltinSpec = {
  name: "__inventory_item_asset", aliases: [], params: params([{ name: "ok" }, { name: "bytes" }, { name: "operation" }, { name: "file" }]),
  doc: { ...docs("Resume an inventory item asset request.", "Parses the item definition and sends a typed operation through the inventory owner."), access: "internal" },
  call: (view, args) => {
    const operation = text(args, 2);
    if (operation !== "addItem" && operation !== "removeItem") throw new ScriptError("inventory.operation", "unknown item operation");
    if (integer(args, 0) === 0) throw new ScriptError("asset.missing", `inventory item asset not found: ${text(args, 3)}`);
    const hex = text(args, 1);
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "item asset reply must be hexadecimal bytes");
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    const parsed = readItem(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.item", parsed.error.message);
    const filename = text(args, 3);
    const source = itemSource(filename);
    const inventory = view.state?.inventory;
    const entry = inventory?.items.find((candidate) => candidate.source.toLowerCase() === source);
    if (operation === "removeItem") {
      if (entry === undefined) return { value: null };
      return menuAction(view, { type: "removeItem", entryId: entry.id, amount: 1 });
    }
    return menuAction(view, { type: "addItem", source, handle: parsed.value.name, amount: 1 });
  },
};

const CALL_SHOP: BuiltinSpec = {
  name: "callshop", aliases: [],
  params: [{ name: "item", optional: false, byRef: false, variadic: true }],
  doc: docs("Run a blocking shop session with the listed items.", "Resolves every filename relative to Item (appending .itm when absent) before activating any stock; then yields to the menu owner until it closes the session. The menu owns screen presentation."),
  call: (_view, args) => {
    if (args.length === 0) throw new ScriptError("menu.shop-invalid", "CallShop requires at least one item filename");
    return shopRequest(args.map((arg) => itemFilename(String(arg.value))));
  },
};
const SHOP_ASSET_CONTINUATION: BuiltinSpec = {
  name: "__inventory_shop_asset", aliases: [],
  params: params([{ name: "ok" }, { name: "bytes" }, { name: "file" }, { name: "paths" }, { name: "sources" }]),
  doc: { ...docs("Resume a shop item request.", "Parses every stock item before committing the active shop context, then waits until the shop closes."), access: "internal" },
  call: (_view, args) => {
    const path = text(args, 2);
    if (integer(args, 0) === 0) throw new ScriptError("asset.missing", `shop item asset not found: ${path}`);
    const hex = text(args, 1);
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "shop item reply must be hexadecimal bytes");
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    const parsed = readItem(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.item", parsed.error.message);
    const paths = jsonStrings(text(args, 3), "shop paths");
    const sources = [...jsonStrings(text(args, 4), "shop sources"), itemSource(path)];
    if (paths.length === 0 || paths[sources.length - 1] !== path) throw new ScriptError("request.bad-reply", "shop request sequence is inconsistent");
    if (sources.length < paths.length) return shopRequest(paths, sources.length, sources);
    // The menu owner activates the stock and presents it (E-83): a registered `shop` provider runs on this
    // thread and the caller resumes when it returns; with none registered the control leaves the standalone
    // `menu.screen` wait that the wait poll resolves once the stock is cleared.
    return { value: null, effects: [{ kind: "vm.control", args: ["menu.open", "shop", sources] }] };
  },
};
/**
 * One shop transaction from the menu context (E-83): read `{ source|entryId, amount }` from the provider's
 * dictionary and post the inventory owner's own action, which is the only transaction owner and refuses
 * atomically. The screen pre-checks the two refusals a player can reach, so a refused action changes nothing.
 */
function shopAction(view: CommandView, args: readonly Arg[], name: string, kind: "buyItem" | "sellItem"): CommandResult {
  const value = args[1]?.value;
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") {
    throw new ScriptError("builtin.bad-arg", `${name}: the action must be a dictionary`);
  }
  const members = view.objectMembers?.(value.handle);
  if (members === undefined) throw new ScriptError("builtin.bad-arg", `${name}: the action must be a live dictionary`);
  const folded = new Map<string, Value>();
  for (const key of Object.keys(members)) folded.set(foldAscii(key), members[key]!);
  const fields = kind === "buyItem" ? ["source", "amount"] : ["entryId", "amount"];
  if (folded.size !== fields.length || !fields.every((key) => folded.has(foldAscii(key)))) {
    throw new ScriptError("builtin.bad-arg", `${name}: the action takes exactly ${fields.join(", ")}`);
  }
  const amount = folded.get(foldAscii("amount"));
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1) {
    throw new ScriptError("builtin.bad-arg", `${name}: amount must be a positive safe integer`);
  }
  if (kind === "buyItem") {
    const source = folded.get(foldAscii("source"));
    if (typeof source !== "string" || source.trim() === "") throw new ScriptError("builtin.bad-arg", `${name}: source must be a non-empty item source`);
    return menuAction(view, { type: "buyItem", source, amount });
  }
  const entryId = folded.get(foldAscii("entryId"));
  if (typeof entryId !== "number" || !Number.isSafeInteger(entryId) || entryId < 1) {
    throw new ScriptError("builtin.bad-arg", `${name}: entryId must be a positive safe integer`);
  }
  return menuAction(view, { type: "sellItem", entryId, amount });
}
const BUY_ITEM: BuiltinSpec = {
  name: "__inventory_buy", aliases: [], params: params([{ name: "self" }, { name: "action" }]),
  doc: internalDocs("Buy one shop row's units from the menu context.", "Validates `source` and `amount`, then applies the E-83 `buyItem` action through the inventory owner, which checks the active shop stock, the definition, the gold and the resulting quantity and refuses atomically. It runs no item program and changes nothing when the owner refuses."),
  call: (view, args) => shopAction(view, args, "__inventory_buy", "buyItem"),
};
const SELL_ITEM: BuiltinSpec = {
  name: "__inventory_sell", aliases: [], params: params([{ name: "self" }, { name: "action" }]),
  doc: internalDocs("Sell one inventory stack to the active shop from the menu context.", "Validates `entryId` and `amount`, then applies the E-83 `sellItem` action through the inventory owner, which checks the active shop, the stack's available quantity and the resulting gold and refuses atomically. It runs no item program and changes nothing when the owner refuses."),
  call: (view, args) => shopAction(view, args, "__inventory_sell", "sellItem"),
};
const INN: BuiltinSpec = {
  name: "inn", aliases: [], params: [],
  doc: { ...docs("Fully heal the player party.", "Sets every party member's current HP and SMP to their maxima immediately, including fallen members; it does not change status effects, equipment, inventory, roster or gold."), groups: [INVENTORY_GROUP, "battle-stats-menus-33"] },
  call: () => ({ value: null, effects: [{ kind: "state-write", section: "party", args: [{ type: "inn" }] }] }),
};
export const INVENTORY_COMMANDS: readonly BuiltinSpec[] = [GIVE_ITEM, TAKE_ITEM, ITEM_COUNT, GIVE_GOLD, TAKE_GOLD, GET_GOLD, EQUIP, REMOVE, EQUIP_SELECT, USE_ITEM, REPLACE_EQUIPMENT, REMOVE_EQUIPMENT, REMOVE_STACK, ITEM_ACTION_ASSET, ITEM_ACTION_COMPLETE, ITEM_ASSET_CONTINUATION, CALL_SHOP, SHOP_ASSET_CONTINUATION, BUY_ITEM, SELL_ITEM, INN];
export const INVENTORY_COMMAND_NAMES = new Set<string>([...ITEM_NAMES, "inn", "callshop", "__inventory_item_asset", "__inventory_equip_select", "__inventory_use", "__inventory_replace", "__inventory_remove_equipment", "__inventory_remove_stack", ITEM_ACTION_ASSET_COMMAND, ITEM_ACTION_COMPLETE_COMMAND, "__inventory_shop_asset", "__inventory_buy", "__inventory_sell"]);
export const INVENTORY_PLUGIN: PluginDefinition = { id: "inventory", version: "1.0.0", commands: INVENTORY_COMMANDS };

/**
 * The menu pack (#585): the read-only owner views and the small read commands the stock menu screens
 * need, plus the two owner actions the screens call by name.
 *
 * Everything here reads the owners through the canonical sections and changes them only by posting an
 * owner action, never by editing a section in place (AD-10; docs/spec/engine/plugins-and-battle.md#e-80-stock-menu).
 * The commands wait on a host request when they need an asset or the save list; nothing here keeps state.
 */

import { BinaryReader } from "../../formats/binary/reader.ts";
import { readItem } from "../../formats/actor/item.ts";
import { readCharacter } from "../../formats/actor/character.ts";
import { specialAvailable } from "./battle.ts";
import type { Item } from "../../formats/actor/model.ts";
import { ACCESSORY_FLAG_INDEX, ACCESSORY_LOCATIONS, ACCESSORY_SLOT_TOKEN, accessoryNameIndex, BODY_SLOT_TOKENS, slotFlagIndex } from "../../menu/equipment.ts";
import type { Result } from "../../formats/result.ts";
import { objectValue } from "../../audio/script.ts";
import type { PlainData } from "../../ports/plain-data.ts";
import type { Value } from "../../ports/value.ts";
import { createObject, writeMember } from "../objects.ts";
import type { HostObjectType } from "../host.ts";
import { foldAscii } from "../values.ts";
import type { Arg, BuiltinDoc, BuiltinSpec, ParamSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import type { CommandEffect, CommandResult, CommandView, PluginDefinition } from "../plugin.ts";
import { pack } from "./common.ts";

const MENU_GROUP = "battle-stats-menus-33";

/** The hydrated `context.menu` object of an RPGCode menu provider (E-80, #585). */
export const MENU_HOST_TYPE_NAME = "menu";
/** The hydrated `context.party` object of an RPGCode menu provider (E-80, #585). */
export const PARTY_HOST_TYPE_NAME = "party";

const ITEM_DATA_CONTINUATION = "__menu_item_asset";
const SAVE_LIST_CONTINUATION = "__save_list_continue";
const UPDATE_CURRENT_COMMAND = "__menu_update_current";
const DRAW_GRAPHIC_COMMAND = "__menu_draw_graphic";
/** The recorded name of `context.menu.drawGraphic`: the image effect the engine treats as optional decoration. */
export const MENU_GRAPHIC_EFFECT = "host:menu:drawgraphic";

function parameter(name: string, optional = false): ParamSpec {
  return { name, optional, byRef: false, variadic: false };
}
function text(args: readonly Arg[], index: number): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : "";
}
function numeric(args: readonly Arg[], index: number): number {
  const value = args[index]?.value;
  return typeof value === "number" ? value : Number.NaN;
}
function docs(summary: string, behaviour: string, waits: NonNullable<BuiltinDoc["waits"]>): BuiltinDoc {
  return { summary, behaviour, groups: [MENU_GROUP], waits };
}
function nativeDocs(summary: string, behaviour: string, waits: NonNullable<BuiltinDoc["waits"]>): BuiltinDoc {
  return { ...docs(summary, behaviour, waits), groups: [MENU_GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"] };
}
function internalDocs(summary: string, behaviour: string, waits: NonNullable<BuiltinDoc["waits"]>): BuiltinDoc {
  return { ...docs(summary, behaviour, waits), access: "internal" };
}
const NO_WAIT: NonNullable<BuiltinDoc["waits"]> = { kind: "never", summary: "Does not wait." };
const ASSET_WAIT: NonNullable<BuiltinDoc["waits"]> = { kind: "host-request", summary: "Waits for the host to load and return the requested asset." };

function record(vm: Parameters<typeof createObject>[0], fields: Readonly<Record<string, Value>>): Value {
  const object = createObject(vm, null);
  for (const [key, value] of Object.entries(fields)) writeMember(object, key, value);
  return objectValue(object);
}

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
/** The canonical item asset path (`Item/<file>.itm`) a menu command reads. */
function itemPath(value: string, command: string): string {
  let path = value.trim().replaceAll("\\", "/");
  if (path.toLowerCase().startsWith("item/")) path = path.slice("item/".length);
  if (path === "") throw new ScriptError("builtin.bad-arg", `${command}: the file name must not be empty`);
  return path.toLowerCase().endsWith(".itm") ? path : `${path}.itm`;
}
/** The canonical character asset path (`Chrs/<file>.tem`) a menu command reads. */
function characterPath(value: string, command: string): string {
  let path = value.trim().replaceAll("\\", "/");
  if (path.toLowerCase().startsWith("chrs/")) path = path.slice("chrs/".length);
  if (path === "") throw new ScriptError("builtin.bad-arg", `${command}: the file name must not be empty`);
  return path.toLowerCase().endsWith(".tem") ? path : `${path}.tem`;
}
function replyBytes(args: readonly Arg[], what: string): Uint8Array {
  if (numeric(args, 0) !== 1) throw new ScriptError("asset.missing", `${what} asset was not found`);
  const hex = text(args, 1);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", `${what} asset reply must be hexadecimal bytes`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/**
 * The slot fit a `.itm` file states, keyed by canonical E-82 slot token.
 *
 * The stored flags use the editor's locations, and every named accessory shares one flag plus the file's accessory
 * name; `slotFlagIndex` is the owner's own index rule, so the list the menu offers and the owner's refusal cannot
 * disagree about the item side of the rule.
 */
function slotDictionary(vm: Parameters<typeof createObject>[0], item: Item): Value {
  const record = createObject(vm, null);
  for (const token of [...BODY_SLOT_TOKENS, ACCESSORY_SLOT_TOKEN]) {
    const index = token === ACCESSORY_SLOT_TOKEN ? ACCESSORY_FLAG_INDEX : slotFlagIndex(token);
    writeMember(record, token, index !== null && item.equipSlots[index] === 1 ? 1 : 0);
  }
  return objectValue(record);
}

const MENU_GRAPHIC: BuiltinSpec = {
  name: "menugraphic", aliases: [], params: [parameter("file")],
  doc: docs(
    "Choose an image for the menu.",
    "Stores the reference in the menu section's `graphic` field through the menu owner, so the next stock menu screen draws it across its panel behind its text; the picture is resolved in `Bitmap/` like every other bitmapped image. An empty string clears it, a reference that resolves to no asset draws nothing and reports one `asset.missing` diagnostic while the menu still opens, and the call does not wait.",
    NO_WAIT,
  ),
  call: (_view, args) => ({
    value: null,
    effects: [{ kind: "state-write", section: "menu", args: [{ type: "graphic", value: text(args, 0) }] }],
  }),
};

const ITEM_DATA: BuiltinSpec = {
  name: "menuitemdata", aliases: [], params: [parameter("file")],
  doc: nativeDocs(
    "Read an item file's menu fields and description.",
    "Loads Item/<file>.itm (the prefix and extension may be omitted) and returns its stored menu-relevant values as a dictionary without changing any actor, inventory or menu state: `name` and `description` (the text exactly as stored, the empty string when none), `keyitem` and `menuy` (the stored bytes passed through unchanged: a non-zero `keyitem` is a key item, and `menuy` follows the file's own 1 = usable-from-the-menu rule), `equipable`, `slots` (the six body slots keyed by their canonical E-82 tokens, 1 when the file fits that slot), `accessory` (the file's accessory name, the empty string when it names none), and `usedby` with `allowed` (the stored flag and the stored character names). It refuses nothing itself, checks no quantity and waits for the host to load the file.",
    ASSET_WAIT,
  ),
  call: (_view, args) => ({
    value: null,
    request: { kind: "asset", area: "items", path: itemPath(text(args, 0), "menuitemdata") },
    then: { command: ITEM_DATA_CONTINUATION, args: [] },
  }),
};

const ITEM_ASSET: BuiltinSpec = {
  name: ITEM_DATA_CONTINUATION, aliases: [], params: [parameter("ok"), parameter("bytes")],
  doc: internalDocs("Resume an item asset request for the stock menu.", "Reads the `.itm` bytes and returns the menu fields as a dictionary with lowercase keys.", NO_WAIT),
  call: (view, args) => {
    const bytes = replyBytes(args, "item");
    const parsed: Result<Item> = readItem(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.item", parsed.error.message);
    const item = parsed.value;
    const allowed = item.allowedCharacters.filter((name) => name !== "");
    const names = createObject(view.state!.vm, null);
    allowed.forEach((name, index) => writeMember(names, String(index), name));
    writeMember(names, "length", allowed.length);
    return {
      value: record(view.state!.vm, {
        name: item.name,
        description: item.description,
        keyitem: item.keyItem,
        menuy: item.menuUsable,
        equipable: item.equipable,
        slots: slotDictionary(view.state!.vm, item),
        accessory: item.accessoryName,
        usedby: item.usedBy,
        allowed: objectValue(names),
      }),
    };
  },
};

const CHARACTER_DATA: BuiltinSpec = {
  name: "menucharacterdata", aliases: [], params: [parameter("file"), parameter("actorId")],
  doc: nativeDocs(
    "Read a character file's portrait, slot names and special moves.",
    "Loads Chrs/<file>.tem (the prefix and extension may be omitted) and returns `name`, `portrait` (the stored profile-picture reference, the empty string when none), `bodyslots` (the six body slots keyed by their canonical E-82 tokens, 1 when the character accepts that slot), `accessoryslots` (a dictionary from `accessory-7` through `accessory-16` of the stored accessory name for each, the empty string when the slot has none), `specialname` and `hasspecial` (the stored menu label and the stored flag, passed through unchanged), and `specialmoves` — a dictionary indexed from 0 through `specialcount - 1` of the non-empty slots, each `{ file, minexp, minlevel, available }`, where `available` follows the same learn-condition rule `battlecharacterdata` uses and is evaluated against the actor named by `actorId`, so the same list works on the board where no battle exists. It reads the file and changes no actor, sprite, equipment or battle state; the owner still validates every equip and every move the screen runs.",
    ASSET_WAIT,
  ),
  call: (_view, args) => {
    const actorId = numeric(args, 1);
    if (!Number.isSafeInteger(actorId) || actorId < 1) throw new ScriptError("builtin.bad-arg", "menucharacterdata: actorId must be a positive safe integer");
    return {
      value: null,
      request: { kind: "asset", area: "characters", path: characterPath(text(args, 0), "menucharacterdata") },
      then: { command: CHARACTER_DATA_CONTINUATION, args: [actorId] },
    };
  },
};

const CHARACTER_DATA_CONTINUATION = "__menu_character_asset";

const CHARACTER_ASSET: BuiltinSpec = {
  name: CHARACTER_DATA_CONTINUATION, aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("actorId")],
  doc: internalDocs("Resume a character asset request for the stock menu.", "Reads the `.tem` bytes and returns the portrait reference and the body and accessory slot names.", NO_WAIT),
  call: (view, args) => {
    const bytes = replyBytes(args, "character");
    const parsed = readCharacter(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.character", parsed.error.message);
    const character = parsed.value;
    const vm = view.state!.vm;
    const body = createObject(vm, null);
    for (const token of BODY_SLOT_TOKENS) {
      const index = slotFlagIndex(token);
      writeMember(body, token, index !== null && character.bodySlots[index] === 1 ? 1 : 0);
    }
    const accessories = createObject(vm, null);
    for (const location of ACCESSORY_LOCATIONS) {
      writeMember(accessories, `accessory-${location}`, character.accessorySlots[accessoryNameIndex(location)] ?? "");
    }
    const actorId = numeric(args, 2);
    const moves = createObject(vm, null);
    let count = 0;
    for (const slot of character.specialMoves) {
      if (slot.file === "") continue;
      const entry = createObject(vm, null);
      writeMember(entry, "file", slot.file);
      writeMember(entry, "minexp", slot.minExp);
      writeMember(entry, "minlevel", slot.minLevel);
      writeMember(entry, "available", specialAvailable(view, actorId, slot) ? 1 : 0);
      writeMember(moves, String(count), objectValue(entry));
      count += 1;
    }
    writeMember(moves, "length", count);
    return {
      value: record(vm, {
        name: character.name,
        portrait: character.profilePicture,
        bodyslots: objectValue(body),
        accessoryslots: objectValue(accessories),
        specialname: character.specialMoveCategory,
        hasspecial: character.hasSpecialMoves === 0 ? 1 : 0,
        specialcount: count,
        specialmoves: objectValue(moves),
      }),
    };
  },
};

const SAVE_LIST: BuiltinSpec = {
  name: "savelist", aliases: [], params: [],
  doc: nativeDocs(
    "List the save area's file names.",
    "Issues one host request for the names in the game's save area and returns them as a dictionary indexed from 0 through `length - 1`, in the order the host reported them. An engine with no game identity or no save area returns an empty list and its ordinary refusal diagnostic rather than an error the script must catch. It reads no save and changes no state; the stock `dirsav` picker draws its rows from it.",
    { kind: "host-request", summary: "Waits for the host to list the save area." },
  ),
  call: () => ({
    value: null,
    request: { kind: "listBlobs", area: "saves" },
    then: { command: SAVE_LIST_CONTINUATION, args: [] },
  }),
};

const SAVE_LIST_REPLY: BuiltinSpec = {
  name: SAVE_LIST_CONTINUATION, aliases: [], params: [parameter("ok"), parameter("names")],
  doc: internalDocs("Resume a save-area listing.", "Splits the host's newline-separated names into the dictionary `savelist` returns.", NO_WAIT),
  call: (view, args) => {
    const raw = text(args, 1);
    const names = raw === "" ? [] : raw.split("\n").filter((name) => name !== "");
    return { value: dictionary(view.state!.vm, names.map((name) => ({ name }))) };
  },
};

const UPDATE_CURRENT: BuiltinSpec = {
  name: UPDATE_CURRENT_COMMAND, aliases: [], params: [parameter("self"), parameter("action")],
  doc: internalDocs(
    "Update the current menu frame from a menu provider.",
    "Validates `actorId` (a live actor id or null) and `selection` (a non-negative safe integer), commits both fields atomically through the menu owner and returns the owner's result. With an empty stack it refuses with `menu.screens` and changes nothing.",
    NO_WAIT,
  ),
  call: (view, args) => {
    const value = args[1]?.value;
    if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") {
      throw new ScriptError("builtin.bad-arg", `${UPDATE_CURRENT_COMMAND}: the action must be a dictionary`);
    }
    const members = view.objectMembers?.(value.handle);
    if (members === undefined) throw new ScriptError("builtin.bad-arg", `${UPDATE_CURRENT_COMMAND}: the action must be a live dictionary`);
    const folded = new Map<string, Value>();
    for (const key of Object.keys(members)) folded.set(foldAscii(key), members[key]!);
    if (folded.size !== Object.keys(members).length || folded.size !== 2 || !folded.has("actorid") || !folded.has("selection")) {
      throw new ScriptError("builtin.bad-arg", `${UPDATE_CURRENT_COMMAND}: the action takes exactly actorId, selection`);
    }
    const actorId = folded.get("actorid")!;
    const selection = folded.get("selection")!;
    if (typeof selection !== "number" || !Number.isSafeInteger(selection) || selection < 0) {
      throw new ScriptError("builtin.bad-arg", `${UPDATE_CURRENT_COMMAND}: selection must be a non-negative safe integer`);
    }
    if (actorId !== null && (typeof actorId !== "number" || !Number.isSafeInteger(actorId) || actorId < 1)) {
      throw new ScriptError("builtin.bad-arg", `${UPDATE_CURRENT_COMMAND}: actorId must be a positive safe integer or null`);
    }
    return {
      value: null,
      effects: [{ kind: "state-write", section: "menu", args: [{ type: "updateCurrent", actorId, selection } as unknown as PlainData] }],
    };
  },
};

const DRAW_GRAPHIC: BuiltinSpec = {
  name: DRAW_GRAPHIC_COMMAND, aliases: [], params: [parameter("self"), parameter("x"), parameter("y"), parameter("width"), parameter("height"), parameter("canvas")],
  doc: internalDocs(
    "Draw the stored menu graphic into a rectangle of a canvas.",
    "Does nothing when no graphic is stored. Otherwise records an image draw of the stored reference at the integer rectangle on the canvas; a reference that resolves to no asset, or whose bytes the host cannot supply, is reported once as `asset.missing` and the engine keeps running.",
    NO_WAIT,
  ),
  call: (view, args) => {
    for (let index = 1; index <= 5; index += 1) {
      if (!Number.isFinite(numeric(args, index))) throw new ScriptError("builtin.bad-arg", `${DRAW_GRAPHIC_COMMAND}: x, y, width, height and canvas must be numbers`);
    }
    const graphic = view.state?.menu.graphic ?? "";
    if (graphic === "") return { value: null, effects: [] };
    return {
      value: null,
      effects: [{ kind: "state-write", section: "surfaces", args: [graphic, numeric(args, 1), numeric(args, 2), numeric(args, 3), numeric(args, 4), numeric(args, 5)] }],
    };
  },
};

/** The hydrated `context.menu` object of an RPGCode menu provider (E-80, #585). */
export const MENU_HOST_TYPE: HostObjectType = {
  name: MENU_HOST_TYPE_NAME,
  methods: { updatecurrent: UPDATE_CURRENT_COMMAND, drawgraphic: DRAW_GRAPHIC_COMMAND },
  readOnlyMembers: ["screens", "graphic", "saveallowed", "movesound", "choosesound", "cancelsound"],
  read(context, name) {
    const state = context.state;
    switch (name.toLowerCase()) {
      case "screens":
        return dictionary(context.vm, state.menu.screens.map((screen) => ({
          screen: screen.screen, actorid: screen.actorId, selection: screen.selection,
        })));
      case "graphic":
        return state.menu.graphic ?? "";
      case "saveallowed":
        return (state.world.board?.disableSaving ?? 0) === 0 ? 1 : 0;
      case "movesound":
        return context.menuSounds?.().move ?? "";
      case "choosesound":
        return context.menuSounds?.().choose ?? "";
      case "cancelsound":
        return context.menuSounds?.().cancel ?? "";
      default:
        return undefined;
    }
  },
  write() {
    return "read-only";
  },
  remove() {
    return "system-owned";
  },
};

/**
 * The hydrated `context.party` object of an RPGCode menu provider (E-80, #585). Each read builds a fresh
 * dictionary from the party, actor and sprite owners, so a screen that re-reads it sees committed state and cannot
 * mutate it; the only action is the party owner's `inn`.
 */
export const PARTY_HOST_TYPE: HostObjectType = {
  name: PARTY_HOST_TYPE_NAME,
  methods: { inn: "inn" },
  readOnlyMembers: ["members", "selected", "steps"],
  read(context, name) {
    const state = context.state;
    switch (name.toLowerCase()) {
      case "members": {
        const members = state.party.members;
        const rows: Array<{ readonly [key: string]: Value }> = [];
        for (const id of members) {
          const actor = state.actors.actors.find((candidate) => candidate.id === id);
          if (actor === undefined) continue;
          rows.push({
            id: actor.id,
            handle: String(actor.id),
            name: actor.name,
            source: actor.source,
            level: actor.stats.level,
            hp: actor.stats.hp,
            maxhp: actor.stats.maxHp,
            smp: actor.stats.smp,
            maxsmp: actor.stats.maxSmp,
            dp: actor.stats.dp,
            fp: actor.stats.fp,
          });
        }
        return dictionary(context.vm, rows);
      }
      case "selected":
        return state.party.selected ?? 0;
      case "steps":
        return state.party.steps;
      default:
        return undefined;
    }
  },
  write() {
    return "read-only";
  },
  remove() {
    return "system-owned";
  },
};

export const STOCK_MENU_COMMANDS: readonly BuiltinSpec[] = [
  MENU_GRAPHIC, ITEM_DATA, ITEM_ASSET, CHARACTER_DATA, CHARACTER_ASSET, SAVE_LIST, SAVE_LIST_REPLY, UPDATE_CURRENT, DRAW_GRAPHIC,
];

/** The names the menu pack owns, so the catalogue layer does not also answer them. */
export const STOCK_MENU_COMMAND_NAMES = new Set<string>([
  "menugraphic", "menuitemdata", "menucharacterdata", "savelist", ITEM_DATA_CONTINUATION, CHARACTER_DATA_CONTINUATION, SAVE_LIST_CONTINUATION, UPDATE_CURRENT_COMMAND, DRAW_GRAPHIC_COMMAND,
]);

export const STOCK_MENU_PLUGIN: PluginDefinition = pack(
  "menu",
  "Stock-menu provider views and the read commands its screens use (E-80, #585).",
  STOCK_MENU_COMMANDS,
);

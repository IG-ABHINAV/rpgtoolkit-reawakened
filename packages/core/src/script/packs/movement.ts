/** Movement and input built-ins (E-22, E-32, E-60; ticket 5.7). */
import type { Value } from "../../ports/value.ts";
import type { Wait } from "../../ports/wait.ts";
import type { InputSection } from "../../save/sections/input.ts";
import type { GameState } from "../../save/state.ts";
import type { SpriteActor, SpritePoint, Facing } from "../../sprites/model.ts";
import { enqueueDirectionMove, movementCadence } from "../../sprites/movement.ts";
import { enqueueMove, enqueuePathMove, enqueuePointPathMove, setWaypoint } from "../../sprites/runtime.ts";
import type { Character } from "../../formats/actor/index.ts";
import { actorFromSource } from "../../sprites/model.ts";
import { createInitialPlayer } from "../../sprites/runtime.ts";
import { findPath } from "../../sprites/pathfinding.ts";
import { playStance } from "../../sprites/animation.ts";
import type { WorldVector } from "../../world/model.ts";
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import type { CommandEffect, CommandResult, CommandView } from "../plugin.ts";
import { ScriptError } from "../errors.ts";
import { readCharacter } from "../../formats/actor/character.ts";
import { BinaryReader } from "../../formats/binary/reader.ts";
import { actorInputFromCharacter } from "../../actors/hydrate.ts";

const PAUSE = 4;
const PATHFIND = 1;
const WAYPOINT = 8;
const WAYPOINT_LINK = 16;
const DIRECTIONS: readonly Facing[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function number(args: readonly Arg[], index: number, fallback = 0): number {
  const value = args[index]?.value;
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function string(args: readonly Arg[], index: number, fallback = ""): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : fallback;
}
function output(args: readonly Arg[], index: number, value: Value): readonly (readonly [number, Value])[] {
  return args[index]?.ref === null || args[index] === undefined ? [] : [[index, value]];
}
function sprites(view: CommandView) { return view.state?.sprites; }
function actor(view: CommandView, id: string): SpriteActor | null {
  const state = view.state?.sprites;
  return state?.players.find((value) => value.id === id) ?? state?.items.find((value) => value.id === id) ?? null;
}
function playerId(view: CommandView, arg: number | string): string {
  const state = view.state?.sprites;
  if (typeof arg === "string" && arg !== "") return arg;
  if (typeof arg === "number" && Number.isInteger(arg) && state?.players[arg] !== undefined) return state.players[arg]!.id;
  return state?.selectedPlayer ?? state?.players[0]?.id ?? "";
}
function itemId(view: CommandView, arg: number | string): string {
  const state = view.state?.sprites;
  if (typeof arg === "string") return arg;
  const item = state?.items.find((value) => value.handle === arg || value.index === arg);
  return item?.id ?? "";
}
function blocking(view: CommandView): boolean {
  const thread = view.state?.vm.threads.find((value) => value.id === view.thread);
  return thread?.kind === "blocking";
}
function waitFor(view: CommandView, flags: number): boolean { return blocking(view) || (flags & PAUSE) !== 0; }
function pointsDuration(value: SpriteActor, points: readonly SpritePoint[]): number {
  let x = value.x;
  let y = value.y;
  const cadence = movementCadence(value, 0);
  let ticks = 0;
  for (const point of points) {
    const distance = Math.sqrt((point.x - x) * (point.x - x) + (point.y - y) * (point.y - y));
    ticks += Math.max(1, Math.ceil(distance / 4)) * cadence;
    x = point.x;
    y = point.y;
  }
  return Math.max(1, ticks);
}
function movementResult(view: CommandView, name: string, id: string, points: readonly SpritePoint[], flags: number, args: readonly Arg[]): CommandResult {
  const tick = view.clock.tick();
  const actorValue = actor(view, id);
  const effects: CommandEffect[] = [{ kind: "state-write", section: "sprites", args: args.map((arg) => arg.value as never) }];
  if (!waitFor(view, flags) || actorValue === null || points.length === 0) return { value: null, effects };
  effects.push({ kind: "vm.control", args: ["move", id, tick + pointsDuration(actorValue, points)] });
  return { value: null, effects };
}
function docs(summary: string, behaviour: string, waits: BuiltinDoc["waits"] = { kind: "never", summary: "Does not wait." }): BuiltinDoc {
  return { summary, behaviour, groups: ["players-party-sprite-movement-31", "mouse-buttons-cursor-maps-11"], tags: ["legacy"], waits };
}
function movementParams(): BuiltinSpec["params"] { return [{ name: "args", optional: true, byRef: false, variadic: true }]; }
function direction(value: string): Facing {
  const found = DIRECTIONS.find((candidate) => candidate.toLowerCase() === value.trim().toLowerCase());
  if (found === undefined) throw new ScriptError("builtin.bad-arg", `unknown movement direction "${value}"`);
  return found;
}
function pointsFromArgs(args: readonly Arg[], start: number): SpritePoint[] {
  const points: SpritePoint[] = [];
  for (let index = start; index + 1 < args.length; index += 2) points.push({ x: number(args, index), y: number(args, index + 1) });
  return points;
}
function vector(view: CommandView, id: string): WorldVector | null {
  return view.state?.world.board?.vectors?.find((value) => value.handle === id || String(value.handle) === id) ?? null;
}
function moveEffect(_name: string, args: readonly Arg[]): CommandEffect { return { kind: "state-write", section: "sprites", args: args.map((arg) => arg.value as never) }; }

function stanceResult(view: CommandView, id: string, stance: string, args: readonly Arg[]): CommandResult {
  const effects: CommandEffect[] = [moveEffect("stance", args)];
  if (actor(view, id) === null) return { value: null, effects };
  return {
    value: null,
    effects,
    wait: { kind: "sprite.stance", global: blocking(view), actor: id, stance },
  };
}
const PUSH: BuiltinSpec = {
  name: "push", aliases: [], params: movementParams(),
  doc: docs("Move the selected player in one or more directions.", "Queues each comma-separated direction as a fixed 4-pixel movement step. A blocking program or the pause flag waits until all queued steps finish; other threads continue.", { kind: "until-event", summary: "Waits for the queued movement to finish." }),
  call: (view, args) => {
    const id = playerId(view, string(args, 1, ""));
    const flags = number(args, 2);
    const dirs = string(args, 0).split(",").filter((value) => value.trim() !== "").map(direction);
    const value = actor(view, id);
    const points: SpritePoint[] = [];
    let x = value?.x ?? 0; let y = value?.y ?? 0;
    const vectors: Record<Facing, [number, number]> = { N: [0, -32], NE: [32, -32], E: [32, 0], SE: [32, 32], S: [0, 32], SW: [-32, 32], W: [-32, 0], NW: [-32, -32] };
    for (const dir of dirs) { const delta = vectors[dir]; x += delta[0]; y += delta[1]; points.push({ x, y }); }
    return movementResult(view, "push", id, points, flags, args);
  },
};
const PUSH_ITEM: BuiltinSpec = {
  name: "pushitem", aliases: [], params: movementParams(),
  doc: docs("Move an item in one or more directions.", "Queues fixed 32-pixel item steps and waits when the flags request pause or the caller is blocking."),
  call: (view, args) => {
    const id = itemId(view, args[0]?.value as number | string ?? "");
    const flags = number(args, 2);
    const dirs = string(args, 1).split(",").filter((value) => value.trim() !== "").map(direction);
    const value = actor(view, id);
    const points: SpritePoint[] = [];
    let x = value?.x ?? 0;
    let y = value?.y ?? 0;
    const vectors: Record<Facing, [number, number]> = { N: [0, -32], NE: [32, -32], E: [32, 0], SE: [32, 32], S: [0, 32], SW: [-32, 32], W: [-32, 0], NW: [-32, -32] };
    for (const dir of dirs) { const delta = vectors[dir]; x += delta[0]; y += delta[1]; points.push({ x, y }); }
    return movementResult(view, "pushitem", id, points, flags, args);
  },
};
const PLAYER_STEP: BuiltinSpec = {
  name: "playerstep", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "flags", optional: true, byRef: false, variadic: false }],
  doc: docs("Move a player to a board point.", "Finds a deterministic route to x,y, queues it, and waits only for a blocking thread or the pause flag."),
  call: (view, args) => { const id = playerId(view, number(args, 0)); const flags = number(args, 3); const value = actor(view, id); const board = view.state?.world.board; const path = value === null || board === undefined || board === null ? null : findPath(board, view.state?.sprites ?? null, value, { x: number(args, 1), y: number(args, 2) }, 1); return movementResult(view, "playerstep", id, path?.points ?? [], flags, args); },
};
const ITEM_STEP: BuiltinSpec = {
  name: "itemstep", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "flags", optional: true, byRef: false, variadic: false }],
  doc: docs("Move an item to a board point.", "Finds a deterministic route to x,y, queues it, and waits only for a blocking thread or the pause flag."),
  call: (view, args) => { const id = itemId(view, args[0]?.value as number | string ?? ""); const flags = number(args, 3); const value = actor(view, id); const board = view.state?.world.board; const path = value === null || board === undefined || board === null ? null : findPath(board, view.state?.sprites ?? null, value, { x: number(args, 1), y: number(args, 2) }, 1); return movementResult(view, "itemstep", id, path?.points ?? [], flags, args); },
};
function pathCommand(name: "playerpath" | "itempath"): BuiltinSpec {
  return { name, aliases: [], params: movementParams(), doc: docs("Queue a player or item path.", "Queues explicit points, a deterministic path-find route, or a copied/live-linked waypoint vector. The pause flag or a blocking program waits for completion."), call: (view, args) => {
    const flags = number(args, 1); const id = name === "playerpath" ? playerId(view, number(args, 0)) : itemId(view, args[0]?.value as number | string ?? ""); const value = actor(view, id); const board = view.state?.world.board; let points = pointsFromArgs(args, 2);
    if ((flags & (WAYPOINT | WAYPOINT_LINK)) !== 0) { const source = vector(view, string(args, 2)); points = source?.points ?? []; }
    else if ((flags & PATHFIND) !== 0 && value !== null && board !== undefined && board !== null && points.length > 0) points = findPath(board, view.state?.sprites ?? null, value, points[0]!, 1).points;
    return movementResult(view, name, id, points, flags, args);
  } };
}
const PLAYER_LOCATION: BuiltinSpec = { name: "playerlocation", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }, { name: "layer", optional: false, byRef: true, variadic: false }], doc: docs("Read a player's location.", "Returns the player's current pixel x,y and one-based layer immediately through by-reference outputs."), call: (view, args) => { const value = actor(view, playerId(view, number(args, 0))); return { value: value?.x ?? 0, out: [...output(args, 1, value?.x ?? 0), ...output(args, 2, value?.y ?? 0), ...output(args, 3, (value?.layer ?? 0) + 1)] }; } };
const ITEM_LOCATION: BuiltinSpec = { ...PLAYER_LOCATION, name: "itemlocation", doc: docs("Read an item's location.", "Returns the item's current pixel x,y and one-based layer immediately through by-reference outputs."), call: (view, args) => { const value = actor(view, itemId(view, args[0]?.value as number | string ?? "")); return { value: value?.x ?? 0, out: [...output(args, 1, value?.x ?? 0), ...output(args, 2, value?.y ?? 0), ...output(args, 3, (value?.layer ?? 0) + 1)] }; } };
const ACTIVE_PLAYER: BuiltinSpec = { name: "activeplayer", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }], doc: docs("Select the active party member.", "Resolves the supplied stable player handle and commits the selected actor id through the party owner."), call: (view, args) => {
  const party = view.state?.party;
  const raw = args[0]?.value;
  const member = typeof raw === "number"
    ? party?.members.find((id) => id === raw)
    : typeof raw === "string"
      ? party?.members.find((id) => {
        const actorRecord = view.state?.actors.actors.find((candidate) => candidate.id === id);
        return actorRecord?.name === raw || actorRecord?.source === raw || String(id) === raw;
      })
      : undefined;
  if (member === undefined) return { value: null };
  return { value: null, effects: [{ kind: "state-write", section: "party", args: [{ type: "select", actorId: member }] }] };
} };
function partyMember(view: CommandView, handle: unknown): number | undefined {
  const party = view.state?.party;
  if (typeof handle !== "string" && typeof handle !== "number") return undefined;
  return party?.members.find((id) => {
    const actorRecord = view.state?.actors.actors.find((candidate) => candidate.id === id);
    return actorRecord?.name === String(handle) || actorRecord?.source === String(handle) || String(id) === String(handle);
  });
}
function partyFileActor(view: CommandView, file: unknown): number | undefined {
  if (typeof file !== "string") return undefined;
  return view.state?.actors.actors.find((candidate) => candidate.kind === "party" && (candidate.source === file || candidate.name === file))?.id;
}
function partyFileAction(name: "addplayer" | "restoreplayer", type: "add" | "restore"): BuiltinSpec {
  return { name, aliases: [], params: [{ name: "file", optional: false, byRef: false, variadic: false }], doc: docs(name === "addplayer" ? "Add a character-file-backed player to the party." : "Restore a previously removed player to the party.", "Applies a roster change through the party owner; addplayer requests and parses the character asset when it is not already hydrated."), call: (view, args) => {
    const file = string(args, 0);
    const actorId = partyFileActor(view, file);
    if (actorId !== undefined) return { value: null, effects: [{ kind: "state-write", section: "party", args: [{ type, actorId }] }] };
    if (type === "restore" || file === "") return { value: null };
    return {
      value: null,
      request: { kind: "asset", area: "characters", path: file },
      then: { command: "__party_addplayer_asset", args: [file] },
    };
  } };
}
const ADD_PLAYER = partyFileAction("addplayer", "add");
const RESTORE_PLAYER = partyFileAction("restoreplayer", "restore");
const NEW_PLAYER: BuiltinSpec = { name: "newplyr", aliases: ["newplayer"], params: [{ name: "file", optional: false, byRef: false, variadic: false }], doc: docs("Change the main player's graphics from a character file.", "Requests the character asset and updates graphics on the selected sprite while preserving actor identity, stats and roster position."), call: (_view, args) => ({
  value: null,
  request: { kind: "asset", area: "characters", path: string(args, 0) },
  then: { command: "__party_newplyr_asset", args: [string(args, 0)] },
}) };
function partyAction(name: "removeplayer" | "destroyplayer"): BuiltinSpec {
  return { name, aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }], doc: docs(name === "removeplayer" ? "Remove a player from the active party roster." : "Permanently remove a player from the party.", "Resolves the documented player handle to its stable actor id and applies the membership change through the party owner."), call: (view, args) => {
    const actorId = partyMember(view, args[0]?.value);
    if (actorId === undefined) return { value: null };
    return { value: null, effects: [{ kind: "state-write", section: "party", args: [{ type: name === "removeplayer" ? "remove" : "destroy", actorId }] }] };
  } };
}
const REMOVE_PLAYER = partyAction("removeplayer");
const DESTROY_PLAYER = partyAction("destroyplayer");
function partyAssetContinuation(name: "__party_addplayer_asset" | "__party_newplyr_asset"): BuiltinSpec {
  return {
    name,
    aliases: [],
    params: [
      { name: "ok", optional: false, byRef: false, variadic: false },
      { name: "bytes", optional: false, byRef: false, variadic: false },
      { name: "file", optional: false, byRef: false, variadic: false },
    ],
    doc: { ...docs("Resume a character asset request.", "Parses the AssetReply bytes with the documented character reader and applies the resulting owner action."), access: "internal" },
    call: (_view, args) => {
      if (number(args, 0) === 0) return { value: null };
      const hex = string(args, 1);
      if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", "character asset reply must be hexadecimal bytes");
      const bytes = new Uint8Array(hex.length / 2);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      const parsed = readCharacter(new BinaryReader(bytes));
      if (!parsed.ok) throw new ScriptError("format.character", parsed.error.message);
      const file = string(args, 2);
      if (name === "__party_addplayer_asset") {
        return {
          value: null,
          effects: [
            { kind: "state-write", section: "party", args: [{ type: "add", actor: actorInputFromCharacter(file, "party", parsed.value) } as never] },
            { kind: "state-write", section: "sprites", args: [file, hex] },
          ],
        };
      }
      return { value: null, effects: [{ kind: "state-write", section: "sprites", args: [file, hex] }] };
    },
};
}
const ADD_PLAYER_ASSET = partyAssetContinuation("__party_addplayer_asset");
const NEW_PLAYER_ASSET = partyAssetContinuation("__party_newplyr_asset");
const PLAYER_DIRECTION: BuiltinSpec = { name: "playerdirection", aliases: [], params: movementParams(), doc: docs("Read or set a player's facing.", "Returns the current facing index, or emits an effect to set it when a direction is supplied."), call: (view, args) => { const value = actor(view, playerId(view, number(args, 0))); if (args.length < 2) return { value: value === null ? 0 : DIRECTIONS.indexOf(value.facing) }; return { value: null, effects: [moveEffect("playerdirection", args)] }; } };
const PLAYER_SPEED: BuiltinSpec = { name: "playerspeed", aliases: [], params: movementParams(), doc: docs("Set a player's walking speed.", "Emits an effect changing the selected player's deterministic step delay."), call: (_view, args) => ({ value: null, effects: [moveEffect("playerspeed", args)] }) };
const ITEM_DIRECTION: BuiltinSpec = { ...PLAYER_DIRECTION, name: "itemdirection", doc: docs("Get or set an item's facing.", "Returns the current facing index, or emits an effect to set it when a direction is supplied."), call: (view, args) => { const value = actor(view, itemId(view, args[0]?.value as number | string ?? "")); if (args.length < 2) return { value: value === null ? 0 : DIRECTIONS.indexOf(value.facing) }; return { value: null, effects: [moveEffect("itemdirection", args)] }; } };
const ITEM_SPEED: BuiltinSpec = { ...PLAYER_SPEED, name: "itemspeed", doc: docs("Set an item's walking speed.", "Emits an effect changing the item's deterministic step delay."), call: (_view, args) => ({ value: null, effects: [moveEffect("itemspeed", args)] }) };
const PLAYER_GET_PATH: BuiltinSpec = { name: "playergetpath", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "index", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }], doc: docs("Read one queued player path point.", "Returns whether the point exists and writes its pixel coordinates to x and y."), call: (view, args) => { const point = actor(view, playerId(view, number(args, 0)))?.queue.moves[number(args, 1)]?.target; return { value: point === undefined ? 0 : 1, out: [...output(args, 2, point?.x ?? 0), ...output(args, 3, point?.y ?? 0)] }; } };
const ITEM_GET_PATH: BuiltinSpec = { ...PLAYER_GET_PATH, name: "itemgetpath", doc: docs("Read one queued item path point.", "Returns whether the point exists and writes its pixel coordinates to x and y."), call: (view, args) => { const point = actor(view, itemId(view, args[0]?.value as number | string ?? ""))?.queue.moves[number(args, 1)]?.target; return { value: point === undefined ? 0 : 1, out: [...output(args, 2, point?.x ?? 0), ...output(args, 3, point?.y ?? 0)] }; } };
const WANDER: BuiltinSpec = { name: "wander", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "restrict", optional: true, byRef: false, variadic: false }], doc: docs("Take a deterministic random step.", "Draws one direction from the injected seedable RNG and emits a one-step item movement effect."), call: (view, args) => { const id = itemId(view, args[0]?.value as number | string ?? ""); const draw = view.rng.nextUint32(); const dir = DIRECTIONS[draw % DIRECTIONS.length] ?? "S"; return { value: null, effects: [moveEffect("wander", [{ value: id, ref: null }, { value: dir, ref: null }, ...args])] }; } };
const WAIT: BuiltinSpec = { name: "wait", aliases: [], params: [{ name: "dest", optional: true, byRef: true, variadic: false }], doc: docs("Wait for a key press.", "Parks the script until the lowest unclaimed key in the input queue is available, then returns it and optionally writes it by reference.", { kind: "until-input", summary: "Waits for a key press." }), call: (_view, args) => ({ value: null, wait: { kind: "input.key", global: true, key: null, resumeRefs: args.flatMap((arg) => arg.ref === null ? [] : [arg.ref]) } as Wait }) };
const POINTER_FIELDS = ["x", "y", "buttons", "downs", "ups"] as const;
/** The baseline a `waitinput` call passes back: the five compared pointer fields of a previous result, or the record as it is now. */
function pointerBaseline(view: CommandView, last: Value | undefined): NonNullable<Extract<Wait, { readonly kind: "input.key" }>["pointer"]> {
  // RPGCode's `null` is 0, so an omitted, null or zero `last` all mean "the record as it is now".
  if (last === undefined || last === null || last === 0 || last === "") {
    const now = view.state?.input.pointer;
    return { x: now?.x ?? 0, y: now?.y ?? 0, buttons: now?.buttons ?? 0, downs: now?.downs ?? 0, ups: now?.ups ?? 0 };
  }
  if (typeof last !== "object" || !("kind" in last) || last.kind !== "object") throw new ScriptError("builtin.bad-arg", "waitinput: `last` must be the dictionary an earlier waitinput returned");
  const members = view.objectMembers?.(last.handle);
  if (members === undefined) throw new ScriptError("builtin.bad-arg", "waitinput: `last` must be a live dictionary");
  const found: Record<string, number> = {};
  for (const field of POINTER_FIELDS) {
    const value = members[field];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ScriptError("builtin.bad-arg", `waitinput: \`last\` has no numeric \`${field}\``);
    found[field] = Math.trunc(value);
  }
  return { x: found.x!, y: found.y!, buttons: found.buttons!, downs: found.downs!, ups: found.ups! };
}
const WAIT_INPUT: BuiltinSpec = {
  name: "waitinput", aliases: [], params: [{ name: "last", optional: true, byRef: false, variadic: false }],
  doc: {
    summary: "Wait for the next key or pointer change.",
    behaviour: "In plain terms: like `wait()`, but it also wakes for the mouse or a finger, so a menu written in RPGCode can answer hovers and taps; pass back the dictionary the previous call returned as `last` (omitted, `null` or 0 means the record as it is now) so nothing that happened while the script was busy is missed. Technically: parks as an input wait exactly like `wait()` (global, the lowest unclaimed key with the same sequence floor) and also resumes when the pointer record's `x`, `y`, `buttons`, `downs` or `ups` differs from the baseline, `last` when given or the record as it was when the command ran. Returns a dictionary `{ kind, key, x, y, buttons, downs, ups, downx, downy, button }`: `kind` is \"key\" or \"pointer\" (a key wins a same-tick tie), `key` is the key name or the empty string, and for a key the first five pointer fields repeat the baseline so the next call still sees a pointer change that arrived with it. `wait()` and `get()` never wake for the pointer.",
    groups: ["mouse-buttons-cursor-maps-11", "reawakened-additions-not-part-of-the-282-legacy-catalogue"],
    waits: { kind: "until-input", summary: "Waits for a key press or a pointer change." },
    throws: [{ code: "builtin.bad-arg", when: "`last` is not a dictionary carrying numeric x, y, buttons, downs and ups" }],
  },
  call: (view, args) => ({ value: null, wait: { kind: "input.key", global: true, key: null, pointer: pointerBaseline(view, args[0]?.value) } as Wait }),
};
const GET: BuiltinSpec = { name: "get", aliases: [], params: [{ name: "dest", optional: true, byRef: true, variadic: false }], doc: docs("Get the next buffered key.", "Returns and claims the lowest unclaimed key immediately, or returns an empty string when the buffer has no eligible key.") , call: (view, args) => { const key = view.state?.input.keys.find((candidate) => !(view.state?.engine.claims ?? []).includes(candidate.seq)); if (key === undefined) return { value: "", out: output(args, 0, "") }; return { value: key.name, out: output(args, 0, key.name), effects: [{ kind: "state-write", section: "input", args: [key.seq] }] }; } };
const CLEAR_BUFFER: BuiltinSpec = { name: "clearbuffer", aliases: [], params: [], doc: docs("Clear all buffered keys.", "Claims every currently buffered key through the engine sequence protocol and removes only those claimed records immediately."), call: (_view) => ({ value: null, effects: [{ kind: "state-write", section: "input", args: [] }] }) };
const SET_BUTTON: BuiltinSpec = { name: "setbutton", aliases: [], params: [{ name: "file", optional: false, byRef: false, variadic: false }, { name: "slot", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "width", optional: false, byRef: false, variadic: false }, { name: "height", optional: false, byRef: false, variadic: false }], doc: docs("Create a clickable button.", "Creates or replaces a button slot at pixel x,y with the supplied dimensions until clearButtons removes it."), call: (_view, args) => ({ value: null, effects: [{ kind: "state-write", section: "input", args: args.map((arg) => arg.value as never) }] }) };
const CHECK_BUTTON: BuiltinSpec = { name: "checkbutton", aliases: [], params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }], doc: docs("Check whether a button was clicked.", "Returns 1 when the pixel is inside an enabled button slot, otherwise 0; it does not wait."), call: (view, args) => { const input = view.state?.input; const x = number(args, 0); const y = number(args, 1); return { value: input?.buttons.some((button) => "id" in button && button.enabled && x >= button.x && x < button.x + button.w && y >= button.y && y < button.y + button.h) ? 1 : 0 }; } };
const CLEAR_BUTTONS: BuiltinSpec = { name: "clearbuttons", aliases: [], params: [{ name: "slots", optional: true, byRef: false, variadic: true }], doc: docs("Clear clickable buttons.", "Removes every button, or only the numeric slots supplied, immediately and without waiting."), call: (_view, args) => ({ value: null, effects: [{ kind: "state-write", section: "input", args: args.map((arg) => arg.value as never) }] }) };
const MOUSE_MOVE: BuiltinSpec = { name: "mousemove", aliases: [], params: [{ name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }], doc: docs("Read the pointer position.", "Returns the current window-relative pointer x and y through by-reference outputs without waiting."), call: (view, args) => ({ value: null, out: [...output(args, 0, view.state?.input.pointer.x ?? 0), ...output(args, 1, view.state?.input.pointer.y ?? 0)] }) };
const MOUSE_CLICK: BuiltinSpec = { name: "mouseclick", aliases: [], params: [{ name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }, { name: "noWait", optional: true, byRef: false, variadic: false }], doc: docs("Wait for or read a pointer click.", "Writes the current pointer position immediately when noWait is true; otherwise parks until a click is available.", { kind: "until-event", summary: "Waits for a pointer click." }), call: (view, args) => { const pointer = view.state?.input.pointer; if (number(args, 2) !== 0 && pointer !== undefined) return { value: null, out: [...output(args, 0, pointer.x), ...output(args, 1, pointer.y)] }; return { value: null, wait: { kind: "input.mouse", global: true, id: "mouseclick", payload: [], resumeRefs: args.flatMap((arg) => arg.ref === null ? [] : [arg.ref]) } }; } };
const PLAYER_STANCE: BuiltinSpec = { name: "playerstance", aliases: [], params: [{ name: "handle", optional: false, byRef: false, variadic: false }, { name: "stance", optional: false, byRef: false, variadic: false }, { name: "flags", optional: true, byRef: false, variadic: false }], doc: docs("Play a player's stance animation.", "Starts the named stance through the sprite animation owner, then waits for that owner to report completion."), call: (view, args) => stanceResult(view, playerId(view, args[0]?.value as number | string ?? ""), string(args, 1), args) };
const ITEM_STANCE: BuiltinSpec = { ...PLAYER_STANCE, name: "itemstance", doc: docs("Play an item's stance animation.", "Starts the named item stance through the sprite animation owner, then waits for that owner to report completion."), call: (view, args) => stanceResult(view, itemId(view, args[0]?.value as number | string ?? ""), string(args, 1), args) };

export const MOVEMENT_COMMANDS: readonly BuiltinSpec[] = [PUSH, PUSH_ITEM, PLAYER_STEP, ITEM_STEP, pathCommand("playerpath"), pathCommand("itempath"), PLAYER_LOCATION, ITEM_LOCATION, ACTIVE_PLAYER, ADD_PLAYER, REMOVE_PLAYER, RESTORE_PLAYER, DESTROY_PLAYER, NEW_PLAYER, ADD_PLAYER_ASSET, NEW_PLAYER_ASSET, PLAYER_DIRECTION, ITEM_DIRECTION, PLAYER_SPEED, ITEM_SPEED, PLAYER_GET_PATH, ITEM_GET_PATH, WANDER, WAIT, WAIT_INPUT, GET, CLEAR_BUFFER, SET_BUTTON, CHECK_BUTTON, CLEAR_BUTTONS, MOUSE_MOVE, MOUSE_CLICK, PLAYER_STANCE, ITEM_STANCE];

export function applyInputEffect(state: GameState, name: string, args: readonly Value[]): void {
  state.engine.claims ??= [];
  if (name === "get") {
    const seq = numberValue(args[0]);
    if (!state.engine.claims.includes(seq)) state.engine.claims.push(seq);
    return;
  }
  if (name === "clearbuffer") {
    for (const key of state.input.keys) if (!state.engine.claims.includes(key.seq)) state.engine.claims.push(key.seq);
    return;
  }
  if (name === "setbutton") {
    const [, slot, x, y, width, height] = args;
    const id = String(slot ?? "");
    state.input.buttons = [...state.input.buttons.filter((button) => !("id" in button && button.id === id)), { id, x: numberValue(x), y: numberValue(y), w: numberValue(width), h: numberValue(height), action: id, enabled: true }];
    return;
  }
  if (name === "clearbuttons") {
    const slots = args.map((value) => String(value));
    state.input.buttons = slots.length === 0 ? [] : state.input.buttons.filter((button) => !("id" in button && slots.includes(button.id)));
  }
}
function numberValue(value: Value | undefined): number { return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0; }

export function applySpriteEffect(state: GameState, name: string, args: readonly Value[]): boolean {
  const idArg = args[0];
  const selected = state.sprites.selectedPlayer ?? state.sprites.players[0]?.id ?? "";
  const playerCommand = name === "playerstep" || name === "playerpath" || name === "playerdirection" || name === "playerspeed" || name === "playerstance";
  const playerId = playerCommand
    ? state.sprites.players.find((value) => value.id === String(idArg) || String(value.index) === String(idArg))?.id ?? selected
    : selected;
  const id = name === "push" ? selected : playerCommand ? playerId : String(idArg ?? "");
  if (name === "__party_addplayer_asset") {
    const file = String(args[0] ?? "");
    const character = args[1] as unknown as Character;
    const member = state.actors.actors.find((value) => value.kind === "party" && value.source === file);
    const board = state.world.board;
    if (member === undefined || board === null || board === undefined || state.sprites.players.some((value) => value.actorId === member.id)) return member !== undefined;
    createInitialPlayer(state.sprites, board, {
      id: `player:${member.id}`,
      actorId: member.id,
      kind: "player",
      source: file,
      x: board.start?.x ?? 64,
      y: board.start?.y ?? 64,
      layer: board.start?.layer ?? 1,
      controlled: state.party.selected === member.id,
      character,
    });
    return true;
  }
  if (name === "__party_newplyr_asset") {
    const file = String(args[0] ?? "");
    const character = args[1] as unknown as Character;
    const player = state.sprites.players.find((value) => value.id === state.sprites.selectedPlayer);
    const board = state.world.board;
    if (player === undefined || board === null || board === undefined) return true;
    const graphic = actorFromSource({
      id: player.id, actorId: player.actorId ?? null, kind: "player", source: file,
      x: player.x, y: player.y, layer: player.layer, character,
    }, board, player.index, null);
    state.sprites.players = state.sprites.players.map((value) => value.id === player.id
      ? { ...value, source: file, visual: graphic.visual }
      : value);
    return true;
  }
  if (name === "newplyr" || name === "newplayer") {
    const player = state.sprites.players.find((value) => value.id === state.sprites.selectedPlayer);
    const graphic = state.sprites.players.find((value) => value.source === String(args[0] ?? ""));
    if (player === undefined || graphic === undefined) return true;
    state.sprites.players = state.sprites.players.map((value) => value.id === player.id ? { ...value, source: graphic.source, visual: graphic.visual } : value);
    return true;
  }
  const actor = [...state.sprites.players, ...state.sprites.items].find((value) => value.id === id || String(value.handle) === id);
  if (actor === undefined && name !== "activeplayer") return false;
  if (name === "activeplayer") { const target = String(args[0] ?? ""); state.sprites.selectedPlayer = state.sprites.players.find((value) => value.id === target || String(value.index) === target)?.id ?? state.sprites.selectedPlayer; return true; }
  if (name === "pushitem") { const dirs = String(args[1] ?? "").split(",").filter((value) => value !== ""); for (const raw of dirs) enqueueDirectionMove(state.sprites, id, direction(raw), 0, false); return true; }
  if (name === "playerstep" || name === "itemstep") { const board = state.world.board; if (board === null || board === undefined) return false; const path = findPath(board, state.sprites, actor!, { x: numberValue(args[1]), y: numberValue(args[2]) }, 1); return enqueuePointPathMove(state.sprites, actor!.id, path.points, true, 1); }
  if (name === "playerpath" || name === "itempath") { const flags = numberValue(args[1]); const points = ((flags & (WAYPOINT | WAYPOINT_LINK)) !== 0 ? (state.world.board?.vectors?.find((value) => String(value.handle) === String(args[2]))?.points ?? []) : pointsFromValues(args.slice(2))); if ((flags & (WAYPOINT | WAYPOINT_LINK)) !== 0) return setWaypoint(state.sprites, actor!.id, points, numberValue(args[3]), (flags & WAYPOINT_LINK) !== 0); return enqueuePointPathMove(state.sprites, actor!.id, points, true, (flags & PATHFIND) !== 0 ? 1 : undefined); }
  if (name === "playerdirection" || name === "itemdirection") { const facing = direction(String(args[1] ?? args[0] ?? "S")); replaceActor(state, actor!.id, { facing }); return true; }
  if (name === "playerspeed" || name === "itemspeed") { replaceActor(state, actor!.id, { speed: numberValue(args[1] ?? args[0]) }); return true; }
  if (name === "wander") { enqueueDirectionMove(state.sprites, actor!.id, direction(String(args[1] ?? "S")), 0, false); return true; }
  if (name === "playerstance" || name === "itemstance") { return playStance(state.sprites, actor!.id, String(args[1] ?? ""), state.time.tick) !== null; }
  return false;
}
function pointsFromValues(values: readonly Value[]): SpritePoint[] {
  const points: SpritePoint[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: numberValue(values[index]), y: numberValue(values[index + 1]) });
  }
  return points;
}
function replaceActor(state: GameState, id: string, update: Partial<SpriteActor>): void { state.sprites.players = state.sprites.players.map((value) => value.id === id ? { ...value, ...update } : value); state.sprites.items = state.sprites.items.map((value) => value.id === id ? { ...value, ...update } : value); }

export const MOVEMENT_PLUGIN = { id: "movement", version: "1.0.0", doc: { summary: "Movement, input and sprite-control commands.", groups: [] }, commands: MOVEMENT_COMMANDS } as const;

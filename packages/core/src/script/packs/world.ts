/** Board reads and edits (E-14; docs/spec/engine/rpgcode-functions.md#e-14). */
import type { Value } from "../../ports/value.ts";
import type { WorldBoard, WorldProgram, WorldVector } from "../../world/model.ts";
import { ScriptError } from "../errors.ts";
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import type { CommandEffect, CommandResult, PluginDefinition } from "../plugin.ts";
import { applyWorldEffect } from "../../world/effects.ts";
import { applyCameraEffect } from "../../world/camera.ts";
import { MOVEMENT_COMMANDS, applyInputEffect, applySpriteEffect } from "./movement.ts";
import { resolvePixelMovement } from "../../world/movement-settings.ts";

function numberArg(args: readonly Arg[], index: number, fallback = 0): number {
  const value = args[index]?.value;
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function stringArg(args: readonly Arg[], index: number, fallback = ""): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : fallback;
}
function output(args: readonly Arg[], index: number, value: Value): readonly (readonly [number, Value])[] {
  const arg = args[index];
  return arg?.ref === null || arg === undefined ? [] : [[index, value]];
}
function board(view: { readonly state?: { readonly world: { readonly board?: WorldBoard | null } } }): WorldBoard {
  const current = view.state?.world.board ?? null;
  if (current === null) throw new ScriptError("world.no-board", "board operation requires a loaded board");
  return current;
}
function location(current: WorldBoard, args: readonly Arg[], layerIndex: number): { readonly index: number; readonly layer: number } | null {
  const x = numberArg(args, 0) - 1;
  const y = numberArg(args, 1) - 1;
  const layer = layerIndex < 0 ? numberArg(args, 2, 1) : layerIndex;
  const layerOffset = layer - 1;
  if (x < 0 || y < 0 || x >= current.sizeX || y >= current.sizeY || layerOffset < 0 || layerOffset >= current.layers.length) return null;
  return { index: y * current.sizeX + x, layer: layerOffset };
}
function tileName(current: WorldBoard, args: readonly Arg[]): string {
  const found = location(current, args, -1);
  if (found === null) return "";
  return current.layers[found.layer]?.tiles[found.index]?.asset ?? "";
}
function typeName(current: WorldBoard, args: readonly Arg[]): string {
  const layer = numberArg(args, 3, 1);
  const x = numberArg(args, 0) - 1;
  const y = numberArg(args, 1) - 1;
  const layerOffset = layer - 1;
  if (x < 0 || y < 0 || x >= current.sizeX || y >= current.sizeY || layerOffset < 0 || layerOffset >= current.layers.length) return "";
  const types = current.runtime?.tileTypes ?? [];
  const flat = layerOffset * current.sizeX * current.sizeY + y * current.sizeX + x;
  return types[flat] ?? "NORMAL";
}
function vector(current: WorldBoard, args: readonly Arg[]): WorldVector | undefined {
  return current.vectors?.[numberArg(args, 0)];
}
function program(current: WorldBoard, args: readonly Arg[]): WorldProgram | undefined {
  return current.programs?.[numberArg(args, 0)];
}
function effect(args: readonly Arg[], kind: CommandEffect["kind"] = "state-write"): CommandResult {
  return { value: null, effects: [{ kind, section: "world", args: args.map((arg) => arg.value as never) }] };
}
function docs(summary: string, behaviour: string, tags: BuiltinDoc["tags"] = ["legacy"]): BuiltinDoc {
  return { summary, behaviour, groups: ["board-tiles-vectors-screen-effects-33"], tags, waits: { kind: "never", summary: "The command completes in the current script turn." } };
}
function noArgs(name: string, params: BuiltinSpec["params"] = []): BuiltinSpec {
  return { name, aliases: [], params, doc: docs(`Obsolete ${name} command.`, "Raises a catchable obsolete-command error and skips the statement.", ["legacy", "obsolete"]), call: () => { throw new ScriptError("builtin.obsolete", `"${name}" is obsolete: the statement is skipped`); } };
}

const GET_NAME: BuiltinSpec = {
  name: "getboardname", aliases: [], params: [{ name: "name", optional: true, byRef: true, variadic: false }],
  doc: docs("Get the file name of the current board.", "Return the loaded board asset key immediately and optionally write it to the by-reference output."),
  call: (view, args) => { const value = board(view).key; return { value, out: output(args, 0, value) }; },
};
const PUT: BuiltinSpec = {
  name: "put", aliases: [], params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  doc: docs("Put a tile on the board until the program ends.", "Record a board tile replacement for the current turn; arguments are x, y, optional one-based layer, and tile asset key. The effect is applied before the next statement and does not wait."),
  call: (view, args) => { board(view); if (args.length !== 3 && args.length !== 4) throw new ScriptError("builtin.bad-arg", '"put" expects x,y,tile or x,y,layer,tile'); return effect(args); },
};
const LAYER_PUT: BuiltinSpec = {
  name: "layerput", aliases: [], params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }, { name: "tile", optional: false, byRef: false, variadic: false }],
  doc: docs("Put a tile on a board layer until the board is left.", "Record a replacement at x, y and one-based layer using the tile asset key; apply it immediately and do not wait."),
  call: (view, args) => { board(view); return effect(args); },
};
function tileGetter(name: string, alias = ""): BuiltinSpec {
  return { name, aliases: alias === "" ? [] : [alias], params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }, { name: "dest", optional: true, byRef: true, variadic: false }], doc: docs("Read the tile file at a board position.", "Return the tile asset key at x, y and one-based layer immediately, writing the optional by-reference destination."), call: (view, args) => { const value = tileName(board(view), args); return { value, out: output(args, 3, value) }; } };
}
const TILE_TYPE_GET: BuiltinSpec = {
  name: "getboardtiletype", aliases: [], params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }, { name: "dest", optional: true, byRef: true, variadic: false }], doc: docs("Read the type of a board tile.", "Return the stored tile type at x, y and one-based layer immediately, writing the optional by-reference destination."), call: (view, args) => { const value = typeName(board(view), args); return { value, out: output(args, 3, value) }; },
};
const TILE_TYPE: BuiltinSpec = {
  name: "tiletype", aliases: [], params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "type", optional: false, byRef: false, variadic: false }, { name: "layer", optional: true, byRef: false, variadic: false }], doc: docs("Change a tile type at a board position.", "Set the type string at x, y and optional one-based layer immediately; the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};
const AMBIENT: BuiltinSpec = {
  name: "setambientlevel", aliases: [], params: [{ name: "red", optional: false, byRef: false, variadic: false }, { name: "green", optional: false, byRef: false, variadic: false }, { name: "blue", optional: false, byRef: false, variadic: false }], doc: docs("Set the board's ambient light level.", "Write red, green and blue levels in the inclusive -255..255 range immediately; the next draw list uses the new values and the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};
const FORCE_REDRAW: BuiltinSpec = {
  name: "forceredraw", aliases: [], params: [], doc: docs("Force a redrawing of the screen.", "Redraws the board, thread animations and overlay into the presented frame immediately, applying any pending ambient light changes. The call does not wait."), call: (_view, args) => effect(args),
};
const GET_VECTOR: BuiltinSpec = {
  name: "boardgetvector", aliases: [], params: [{ name: "vector", optional: false, byRef: false, variadic: false }, { name: "type", optional: false, byRef: true, variadic: false }, { name: "pointCount", optional: false, byRef: true, variadic: false }, { name: "layer", optional: false, byRef: true, variadic: false }, { name: "closed", optional: false, byRef: true, variadic: false }, { name: "attributes", optional: false, byRef: true, variadic: false }], doc: docs("Read a board vector's properties.", "Read the vector at index and write type, point count, layer, closed flag and attributes to the by-reference outputs immediately."), call: (view, args) => { const value = vector(board(view), args); return { value: value === undefined ? 0 : 1, out: [ [1, value?.type ?? 0], [2, value?.points.length ?? 0], [3, value?.layer ?? 0], [4, value?.closed ?? 0], [5, value?.attributes ?? 0] ] }; },
};
const SET_VECTOR: BuiltinSpec = {
  name: "boardsetvector", aliases: [], params: [{ name: "vector", optional: false, byRef: false, variadic: false }, { name: "type", optional: false, byRef: false, variadic: false }, { name: "pointCount", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }, { name: "closed", optional: false, byRef: false, variadic: false }, { name: "attributes", optional: false, byRef: false, variadic: false }], doc: docs("Set a board vector's properties.", "Replace the vector properties and resize its point list immediately; the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};
const GET_VECTOR_POINT: BuiltinSpec = {
  name: "boardgetvectorpoint", aliases: [], params: [{ name: "vector", optional: false, byRef: false, variadic: false }, { name: "point", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }], doc: docs("Read one point from a board vector.", "Return the vector point in pixel coordinates and write x and y to the by-reference outputs immediately."), call: (view, args) => { const current = vector(board(view), args)?.points[numberArg(args, 1)]; return { value: current === undefined ? 0 : 1, out: [[2, current?.x ?? 0], [3, current?.y ?? 0]] }; },
};
const SET_VECTOR_POINT: BuiltinSpec = {
  name: "boardsetvectorpoint", aliases: [], params: [{ name: "vector", optional: false, byRef: false, variadic: false }, { name: "point", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "apply", optional: true, byRef: false, variadic: false }], doc: docs("Move one point on a board vector.", "Set the point in pixel coordinates immediately; the optional apply flag is accepted for legacy scripts and the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};
const GET_PROGRAM: BuiltinSpec = {
  name: "boardgetprogram", aliases: [], params: [{ name: "program", optional: false, byRef: false, variadic: false }, { name: "name", optional: false, byRef: true, variadic: false }, { name: "pointCount", optional: false, byRef: true, variadic: false }, { name: "layer", optional: false, byRef: true, variadic: false }, { name: "closed", optional: false, byRef: true, variadic: false }, { name: "attributes", optional: false, byRef: true, variadic: false }, { name: "repeat", optional: false, byRef: true, variadic: false }], doc: docs("Read a board program's properties.", "Read the program name, point count, layer, closed flag, attributes and repeat distance into by-reference outputs immediately."), call: (view, args) => { const value = program(board(view), args); return { value: value === undefined ? 0 : 1, out: [[1, value?.program ?? ""], [2, value?.points.length ?? 0], [3, value?.layer ?? 0], [4, value?.closed ?? 0], [5, value?.activationType ?? 0], [6, value?.repeatDistance ?? 0]] }; },
};
const SET_PROGRAM: BuiltinSpec = {
  name: "boardsetprogram", aliases: [], params: [{ name: "program", optional: false, byRef: false, variadic: false }, { name: "name", optional: false, byRef: false, variadic: false }, { name: "pointCount", optional: false, byRef: false, variadic: false }, { name: "layer", optional: false, byRef: false, variadic: false }, { name: "closed", optional: false, byRef: false, variadic: false }, { name: "attributes", optional: false, byRef: false, variadic: false }, { name: "repeat", optional: false, byRef: false, variadic: false }], doc: docs("Set a board program's properties.", "Replace or append the program at index and resize its point list immediately; the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};
const GET_PROGRAM_POINT: BuiltinSpec = {
  name: "boardgetprogrampoint", aliases: [], params: [{ name: "program", optional: false, byRef: false, variadic: false }, { name: "point", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: true, variadic: false }, { name: "y", optional: false, byRef: true, variadic: false }], doc: docs("Read one point from a board program.", "Return the program point in pixel coordinates and write x and y to the by-reference outputs immediately."), call: (view, args) => { const current = program(board(view), args)?.points[numberArg(args, 1)]; return { value: current === undefined ? 0 : 1, out: [[2, current?.x ?? 0], [3, current?.y ?? 0]] }; },
};
const SET_PROGRAM_POINT: BuiltinSpec = {
  name: "boardsetprogrampoint", aliases: [], params: [{ name: "program", optional: false, byRef: false, variadic: false }, { name: "point", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }], doc: docs("Move one point on a board program.", "Set the program point in pixel coordinates immediately; the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};
const PRG: BuiltinSpec = {
  name: "prg", aliases: [], params: [{ name: "program", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: true, byRef: false, variadic: false }], doc: docs("Move a board program to a new location until the board is left.", "Set the first program point to pixel x and y and optional one-based layer immediately; the call does not wait."), call: (view, args) => { board(view); return effect(args); },
};

const GET_CORNER: BuiltinSpec = {
  name: "getcorner", aliases: ["getCorner"], params: [{ name: "topX", optional: false, byRef: true, variadic: false }, { name: "topY", optional: false, byRef: true, variadic: false }],
  doc: docs("Get the corner of the currently shown portion of the board.", "Retrieve the top-left pixel coordinates of the visible screen area on the board. Technically, writes the camera's current top-left world coordinates into the topX and topY by-reference integer parameters immediately; the call does not wait.", ["legacy"]),
  call: (view, args) => {
    const camera = view.state?.camera;
    const x = camera !== undefined ? Math.round(camera.x) : 0;
    const y = camera !== undefined ? Math.round(camera.y) : 0;
    return { value: 0, out: [...output(args, 0, x), ...output(args, 1, y)] };
  },
};
const CAMERA_PAN_TO: BuiltinSpec = {
  name: "camerapanto", aliases: ["cameraPanTo"], params: [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "duration", optional: false, byRef: false, variadic: false }, { name: "easing", optional: false, byRef: false, variadic: false }],
  doc: docs("Pan the camera to a point.", "Move the camera smoothly from its current position to the specified target coordinates over a duration of time. Technically, duration is in seconds converted to ticks via durationTicks = ceil(duration * 60) (minimum 1 tick for positive duration). Easing must be one of 'linear', 'smoothstep', 'easeIn', 'easeOut', or 'easeInOut'. Non-blocking; the camera position interpolates deterministically on each engine tick.", ["experimental"]),
  call: (_view, args) => {
    if (args.length < 4) throw new ScriptError("builtin.bad-arg", '"cameraPanTo" expects x, y, duration, easing');
    const x = numberArg(args, 0);
    const y = numberArg(args, 1);
    const rawDur = args[2]?.value;
    const duration = typeof rawDur === "number" && Number.isFinite(rawDur) ? rawDur : 0;
    const easing = stringArg(args, 3, "linear");
    return {
      value: null,
      effects: [{ kind: "state-write", section: "camera", args: ["panTo", x, y, duration, easing] }],
    };
  },
};
const CAMERA_FOLLOW: BuiltinSpec = {
  name: "camerafollow", aliases: ["cameraFollow"], params: [{ name: "entityId", optional: false, byRef: false, variadic: false }],
  doc: docs("Follow an entity with the camera.", "Keep the camera focused on the given entity as it moves across the board. Technically, sets the camera target to the specified entity ID. On each tick, the camera clamps or centers the viewport relative to the tracked entity's position without blocking the script.", ["experimental"]),
  call: (_view, args) => {
    if (args.length < 1) throw new ScriptError("builtin.bad-arg", '"cameraFollow" expects entityId');
    const raw = args[0]?.value;
    const entityId = typeof raw === "number" || typeof raw === "string" ? raw : 0;
    return {
      value: null,
      effects: [{ kind: "state-write", section: "camera", args: ["follow", entityId] }],
    };
  },
};
const CAMERA_RESET: BuiltinSpec = {
  name: "camerareset", aliases: ["cameraReset"], params: [],
  doc: docs("Restore default player-follow camera behaviour.", "Return the camera to its default mode of following the selected player character. Technically, resets the tracking target to the active player with default deadzone and smoothing (both zero), clamping to board bounds or centering if the board is smaller than the viewport.", ["experimental"]),
  call: () => ({
    value: null,
    effects: [{ kind: "state-write", section: "camera", args: ["reset"] }],
  }),
};
const CAMERA_SHAKE: BuiltinSpec = {
  name: "camerashake", aliases: ["cameraShake"], params: [{ name: "duration", optional: false, byRef: false, variadic: false }, { name: "amplitude", optional: false, byRef: false, variadic: false }],
  doc: docs("Make the camera wobble for a while; a larger amplitude feels stronger, and the command does not hold up the script.", "Make the screen wobble with a continuous vibration that gradually feels stronger with higher amplitude. Technically, duration is in seconds converted with durationTicks = ceil(duration * 60) (minimum 1 tick for positive duration), and amplitude is in logical-viewport pixels. Evaluates using the shared deterministic shake(amplitude, ticks) primitive cycling (-a,-a), (a,-a), (-a,a), (a,a) per tick without RNG. Non-blocking; a new shake replaces any active shake.", ["experimental"]),
  call: (_view, args) => {
    if (args.length < 2) throw new ScriptError("builtin.bad-arg", '"cameraShake" expects duration, amplitude');
    const rawDur = args[0]?.value;
    const rawAmp = args[1]?.value;
    if (typeof rawDur !== "number" || !Number.isFinite(rawDur) || typeof rawAmp !== "number" || !Number.isFinite(rawAmp)) {
      throw new ScriptError("builtin.bad-arg", "cameraShake arguments must be finite numbers");
    }
    return {
      value: null,
      effects: [{ kind: "state-write", section: "camera", args: ["shake", rawDur, rawAmp] }],
    };
  },
};

const SEND: BuiltinSpec = {
  name: "send", aliases: [], params: [{ name: "file", optional: false, byRef: false, variadic: false }, { name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, { name: "layer", optional: true, byRef: false, variadic: false }],
  doc: {
    summary: "Send the player to a new board.",
    behaviour: "Move the player to another board of your game, at the position you name, and carry on there: the old board's background threads stop, the new board's threads and its enter program start, and the camera jumps straight to the player with no scrolling. Technically, x and y name a position on the board you are going to, in that board's own coordinate mode: when the board sets the editor's \"Use pixel coordinates\" option they are board pixels, and otherwise they are one-based tile coordinates. layer is one-based (omitted or below 1 means layer 1). The call records the request and parks the calling thread until the next tick; between the two ticks the engine loads the board (time stands still while its files arrive), places the player, re-aligns the camera without smoothing, deactivates the program under the player, switches the board music and starts the board threads and enter program, so the script resumes on the new board. A second send in the same tick replaces the first, and a board name that is not in the game raises a located diagnostic and changes nothing.",
    groups: ["board-tiles-vectors-screen-effects-33"],
    tags: ["legacy"],
    waits: { kind: "ticks", summary: "Parks the calling thread for one tick while the engine swaps boards." },
    see: ["docs/spec/engine/movement-and-collision.md#reawakened-send-board", "docs/spec/engine/main-loop-and-startup.md#reawakened-board-entry"],
  },
  call: (view, args) => {
    const file = args[0]?.value;
    if (typeof file !== "string" || file.trim() === "") throw new ScriptError("builtin.bad-arg", '"send" expects a board file name as its first argument');
    const x = args[1]?.value;
    const y = args[2]?.value;
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) throw new ScriptError("builtin.bad-arg", '"send" expects numeric x and y coordinates');
    const layer = Math.max(1, numberArg(args, 3, 1));
    return {
      value: null,
      effects: [{ kind: "state-write", section: "engine", args: [file, Math.trunc(x), Math.trunc(y), layer] }],
      wait: { kind: "sleep", global: true, until: view.clock.tick() + 1, resumesCall: true },
    };
  },
};

const LIFECYCLE_RESET: BuiltinSpec = {
  name: "reset", aliases: [], params: [],
  doc: { summary: "Reset the game.", behaviour: "Clear the reset sections, preserve rng and time, restart plugins and rerun startup from E-02 step 3. The call posts the lifecycle request and does not wait.", groups: ["program-flow-errors-debugging-25"], waits: { kind: "never", summary: "Does not wait." }, tags: ["legacy"], see: ["docs/spec/engine/main-loop-and-startup.md#reawakened-reset-sections"] },
  call: () => ({ value: null, effects: [{ kind: "state-write", section: "engine", args: ["reset"] }] }),
};
const LIFECYCLE_MAIN_FILE: BuiltinSpec = {
  name: "mainfile", aliases: ["mainFile"], params: [{ name: "gam", optional: false, byRef: false, variadic: false }],
  doc: { summary: "Load a new main file.", behaviour: "Request a switch to the named game project and return immediately; the engine performs the new boot sequence.", groups: ["files-saves-os-15", "board-tiles-vectors-screen-effects-33"], waits: { kind: "never", summary: "Does not wait." }, tags: ["legacy"], see: ["docs/spec/engine/main-loop-and-startup.md#e-06"] },
  call: (_view, args) => {
    const file = args[0]?.value;
    if (typeof file !== "string" || file.trim() === "") throw new ScriptError("builtin.bad-arg", '"mainFile" expects a main file name');
    return { value: null, effects: [{ kind: "state-write", section: "engine", args: ["mainFile", file] }] };
  },
};
const LIFECYCLE_GONE: BuiltinSpec = {
  name: "gone", aliases: [], params: [],
  doc: { summary: "Suppress the current board trigger until the board is left.", behaviour: "Mark only the currently running board-trigger instance suppressed; the source program, sprites and unrelated threads are unchanged and the call does not wait.", groups: ["program-flow-errors-debugging-25"], waits: { kind: "never", summary: "Does not wait." }, tags: ["legacy"], see: ["docs/spec/engine/movement-and-collision.md#reawakened-gone-trigger-suppression"] },
  call: () => ({ value: null, effects: [{ kind: "state-write", section: "triggers", args: ["gone"] }] }),
};
const LIFECYCLE_OVER: BuiltinSpec = {
  name: "over", aliases: [], params: [],
  doc: { summary: "Show the game-over flow.", behaviour: "Request the board-rendering game-over flow and return immediately; host window behaviour is not selected by this command.", groups: ["program-flow-errors-debugging-25"], waits: { kind: "never", summary: "Does not wait." }, tags: ["legacy"], see: ["docs/spec/engine/rpgcode-functions.md#e-55"] },
  call: () => ({ value: null, effects: [{ kind: "state-write", section: "engine", args: ["over"] }] }),
};
const LIFECYCLE_QUIT: BuiltinSpec = {
  name: "quitgame", aliases: ["dos", "windows"], params: [],
  doc: { summary: "Quit the game.", behaviour: "Post one quit request to the runner and return immediately.", groups: ["program-flow-errors-debugging-25", "reawakened-additions-not-part-of-the-282-legacy-catalogue"], waits: { kind: "never", summary: "Does not wait." }, tags: ["legacy"], see: ["docs/spec/engine/main-loop-and-startup.md#e-06"] },
  call: () => ({ value: null, effects: [{ kind: "state-write", section: "engine", args: ["quit"] }] }),
};
const LIFECYCLE_COMMANDS: readonly BuiltinSpec[] = [
  LIFECYCLE_RESET, LIFECYCLE_MAIN_FILE, LIFECYCLE_GONE, LIFECYCLE_OVER, LIFECYCLE_QUIT,
  noArgs("win"),
  noArgs("start", [{ name: "file", optional: false, byRef: false, variadic: false }]),
  noArgs("godos", [{ name: "command", optional: false, byRef: false, variadic: false }]),
];
const PIXEL_MOVEMENT: BuiltinSpec = {
  name: "pixelmovement",
  aliases: [],
  params: [{ name: "settings", optional: true, byRef: false, variadic: true }],
  doc: {
    summary: "Choose whether walking and scripted pushes use pixel steps.",
    behaviour: "Returns the current walking setting as 1 or 0 when called without arguments. A one- or two-argument setter returns the new walking setting immediately. One argument sets walking; two set walking and pushing independently, except tile walking forces 32-pixel pushes. Numeric zero is false and other numbers are true; a string is false only when exactly \"off\" ignoring case. More than two arguments change nothing. Settings apply immediately without cancelling or rebuilding queued movement.",
    groups: ["players-party-sprite-movement-31"],
    waits: { kind: "never", summary: "Does not wait." },
    tags: ["legacy"],
  },
  call: (view, args) => {
    const current = view.state?.world.movement ?? { walking: 0, pushing: 0 };
    const updated = resolvePixelMovement(current, args.map((arg) => arg.value));
    return {
      value: (updated ?? current).walking === 1 ? 1 : 0,
      effects: updated === null
        ? []
        : [{ kind: "state-write", section: "world", args: args.map((arg) => arg.value as never) }],
    };
  },
};


const WORLD_COMMANDS: readonly BuiltinSpec[] = [
  GET_NAME, PUT, LAYER_PUT, tileGetter("getboardtile", "boardgettile"), TILE_TYPE_GET, TILE_TYPE, PIXEL_MOVEMENT,
  noArgs("animatedtiles", [{ name: "list", optional: true, byRef: true, variadic: false }]),
  noArgs("parallax", [{ name: "setting", optional: false, byRef: false, variadic: false }]), AMBIENT, FORCE_REDRAW,
  GET_VECTOR, SET_VECTOR, GET_VECTOR_POINT, SET_VECTOR_POINT, GET_PROGRAM, SET_PROGRAM, GET_PROGRAM_POINT, SET_PROGRAM_POINT, PRG,
  noArgs("setconstants", [{ name: "args", optional: true, byRef: false, variadic: true }]), noArgs("underarrow"),
  GET_CORNER, CAMERA_PAN_TO, CAMERA_FOLLOW, CAMERA_RESET, CAMERA_SHAKE, SEND,
  ...LIFECYCLE_COMMANDS,
  ...MOVEMENT_COMMANDS,
];

/** Apply the recorded owner effects for world and movement/input packs. */
export { applyWorldEffect, applyCameraEffect, applyInputEffect, applySpriteEffect };

export const WORLD_PLUGIN: PluginDefinition = { id: "world", version: "1.0.0", doc: { summary: "Board, layer, tile, vector and program operations.", groups: [] }, commands: WORLD_COMMANDS };

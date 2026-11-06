import { dosPaletteEntry } from "../../formats/tileset/dos-palette.ts";
import { assetKey } from "../../formats/resolver/resolver.ts";
import type { PlainData } from "../../ports/plain-data.ts";
import type { Rgb } from "../../ports/draw.ts";
import { colourSurface, surfaceSize } from "../../raster/surfaces.ts";
import type { AssetKey, SurfaceId } from "../../ports/keys.ts";
import type { Arg, BuiltinDoc, BuiltinSpec, ParamSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import type { CommandEffect, CommandResult, CommandView, PluginDefinition } from "../plugin.ts";
import type { UiSection } from "../../save/sections/ui.ts";
import { createUiSection } from "../../save/sections/ui.ts";
import type { SurfacesSection } from "../../save/sections/surfaces.ts";
import { findObject, isDictionary } from "../objects.ts";
import { toNumberValue, toStringValue } from "../values.ts";
import { layoutText } from "../../render/text.ts";

const DEFAULT_FONT = "media/fonts/tkr-8x8.fnt";
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function values(args: readonly Arg[]): PlainData[] {
  return args.map((arg) => arg.value as PlainData);
}
function number(args: readonly Arg[], index: number, fallback = 0): number {
  const value = args[index]?.value;
  return value === undefined ? fallback : toNumberValue(value as never);
}
function text(args: readonly Arg[], index: number): string {
  return toStringValue(args[index]?.value as never ?? "");
}
function byRef(args: readonly Arg[], index: number, value: number | string): readonly (readonly [number, number | string])[] {
  return args[index]?.ref === null || args[index]?.ref === undefined ? [] : [[index, value]];
}
function rgb(args: readonly Arg[], start: number): Rgb {
  return {
    r: Math.max(0, Math.min(255, Math.trunc(number(args, start)))),
    g: Math.max(0, Math.min(255, Math.trunc(number(args, start + 1)))),
    b: Math.max(0, Math.min(255, Math.trunc(number(args, start + 2)))),
  };
}
function spliceVariables(value: string, view: CommandView): string {
  const globals = view.state?.vm.globals ?? {};
  return value.replace(/<([A-Za-z_][A-Za-z0-9_]*)>/g, (whole, name: string) => {
    const found = globals[name];
    return found === undefined ? whole : toStringValue(found as never);
  });
}
function canonicalFont(value: string): AssetKey {
  const lowered = value.trim().toLowerCase();
  // The fallback keys are unchanged from the shipped behaviour: when the project ships no Liberation
  // face the renderer substitutes the bitmap font anyway, so this only keeps the saved state stable.
  if (lowered === "" || lowered === "arial" || lowered === "sans-serif" || lowered === "liberation sans" || lowered === "liberationsans") return assetKey("media/fonts/liberation-sans.ttf");
  if (lowered === "times new roman" || lowered === "serif" || lowered === "liberation serif" || lowered === "liberationserif") return assetKey("media/fonts/liberation-serif.ttf");
  if (lowered === "courier new" || lowered === "monospace" || lowered === "liberation mono" || lowered === "liberationmono") return assetKey("media/fonts/liberation-mono.ttf");
  return assetKey(value);
}
function effect(args: readonly PlainData[] = [], kind: CommandEffect["kind"] = "state-write"): CommandEffect {
  return kind === "pure"
    ? { kind, args: [...args] }
    : { kind, section: "ui", args: [...args] };
}
function uiCommand(
  name: string,
  params: readonly ParamSpec[],
  doc: BuiltinDoc,
  call: (view: CommandView, args: readonly Arg[]) => CommandResult,
  aliases: readonly string[] = [],
): BuiltinSpec {
  return { name: name.toLowerCase(), aliases: aliases.map((alias) => alias.toLowerCase()), params, doc, call };
}
function plainDoc(summary: string, behaviour: string, waits: BuiltinDoc["waits"] = { kind: "never", summary: "Completes in the current script turn." }): BuiltinDoc {
  return { summary, behaviour, groups: ["message-window-text-fonts-30"], waits };
}
function reawakenedDoc(summary: string, behaviour: string): BuiltinDoc {
  return { ...plainDoc(summary, behaviour), groups: [DIALOGUE, REAWAKENED_ADDITIONS] };
}

/**
 * The optional canvas argument of `text` and `pixelText` (E-56): absent or the screen handle 0 keeps the screen text layer;
 * a live canvas handle is passed on as a fourth effect argument so the engine draws the glyphs into that canvas.
 */
function canvasTarget(view: CommandView, args: readonly Arg[], index: number, name: string): readonly PlainData[] {
  if (args[index] === undefined) return [];
  const handle = Math.trunc(number(args, index));
  if (handle === 0) return [];
  const surfaces = view.state?.surfaces;
  if (surfaces === undefined || surfaceSize(surfaces, handle as SurfaceId) === null) throw new ScriptError("surface.unknown", `${name}: no canvas ${String(handle)}`);
  return [handle];
}

const textParam: ParamSpec = { name: "text", optional: false, byRef: false, variadic: false };
const NO_ARGS: readonly ParamSpec[] = [];
const DIALOGUE = "message-window-text-fonts-30";
const CURSOR_GROUP = "mouse-buttons-cursor-maps-11";
const REAWAKENED_ADDITIONS = "reawakened-additions-not-part-of-the-282-legacy-catalogue";
const DEFAULT_ARROW = "media/cursors/tkr-arrow.png";
const DEFAULT_HAND = "media/cursors/tkr-hand.png";

function cursorDoc(summary: string, behaviour: string): BuiltinDoc {
  return { summary, behaviour, groups: [CURSOR_GROUP], waits: { kind: "never", summary: "Completes in the current script turn." }, see: ["docs/spec/engine/rpgcode-functions.md#reawakened-default-cursors"] };
}

function uiState(view: CommandView): UiSection {
  return view.state?.ui as UiSection ?? createUiSection();
}

function output(args: readonly Arg[], index: number, value: number): readonly (readonly [number, number])[] {
  return args[index]?.ref === null || args[index] === undefined ? [] : [[index, value]];
}

function uiEffect(name: string, args: readonly PlainData[]): CommandEffect {
  return { kind: "state-write", section: "ui", args: [...args] };
}
function dictionary(view: CommandView, value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || !("handle" in value) || typeof value.handle !== "number" || view.state === undefined) return null;
  const record = findObject(view.state.vm, value.handle);
  return record !== undefined && isDictionary(record) ? record.members : null;
}

function itemOptions(view: CommandView, value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || value === 0) return {};
  return dictionary(view, value);
}

function surfaceEffect(view: CommandView, args: readonly PlainData[]): CommandEffect {
  return { kind: "state-write", section: "ui", args: [view.thread ?? -1, ...args] };
}
function surfaceSelectionKey(owner: number, id: string): string {
  return `${owner}:${id}`;
}

export const UI_COMMANDS: readonly BuiltinSpec[] = [
  uiCommand("createCursorMap", [{ name: "ret", optional: true, byRef: true, variadic: false }], cursorDoc("Create a cursor map.", "Creates an empty cursor map and returns its integer handle, also writing the optional reference; points are added in order and the call does not wait."), (view, args) => {
    const ui = uiState(view);
    const id = ui.nextCursorMapId ?? 1;
    return { value: id, out: output(args, 0, id), effects: [uiEffect("createcursormap", [id])] };
  }),
  uiCommand("cursorMapAdd", [
    { name: "x", optional: false, byRef: false, variadic: false },
    { name: "y", optional: false, byRef: false, variadic: false },
    { name: "map", optional: false, byRef: false, variadic: false },
  ], cursorDoc("Add a point to a cursor map.", "Appends the integer pixel point `(x,y)` to the selected map; map order defines keyboard selection order and the call does not wait."), (_view, args) => ({ value: null, effects: [uiEffect("cursormapadd", [Math.trunc(number(args, 0)), Math.trunc(number(args, 1)), Math.trunc(number(args, 2))])] })),
  uiCommand("cursorMapRun", [
    { name: "map", optional: false, byRef: false, variadic: false },
    { name: "ret", optional: true, byRef: true, variadic: false },
  ], { summary: "Run a cursor map and wait for a point to be chosen.", behaviour: "Blocks while showing the hand at the selected point. Selection starts at the first point; Up/Left and Down/Right navigate with wrapping, and Enter/Return/Space confirms. Escape does not cancel, the runner reads no mouse input, and the result is the selected zero-based index.", groups: [CURSOR_GROUP], waits: { kind: "until-input", summary: "Yields until a cursor-map point is selected." }, see: ["docs/spec/engine/rpgcode-functions.md#reawakened-cursor-map-runner"] }, (_view, args) => {
    const map = Math.trunc(number(args, 0));
    const refs = args[1]?.ref === null || args[1]?.ref === undefined ? [] : [args[1].ref];
    return { value: null, effects: [uiEffect("cursormaprun", [map])], wait: { kind: "input.key", global: true, key: null, cursorMap: map, cursorSelection: 0, resumeRefs: refs } };
  }),
  uiCommand("killCursorMap", [{ name: "map", optional: false, byRef: false, variadic: false }], cursorDoc("Kill a cursor map.", "Removes the selected map and any active selection; later runs of that handle wait for a valid map and the call does not wait."), (_view, args) => ({ value: null, effects: [uiEffect("killcursormap", [Math.trunc(number(args, 0))])] })),
  uiCommand("cursorMapHand", [
    { name: "cursor", optional: false, byRef: false, variadic: false },
    { name: "stretch", optional: true, byRef: false, variadic: false },
  ], cursorDoc("Choose the cursor-map hand.", "Selects a bundled or custom hand image. Technically, an empty name restores the bundled 32×32 hand, `stretch` defaults on and scales custom images to 32×32 with nearest-neighbour sampling, and the call does not wait."), (_view, args) => ({ value: null, effects: [uiEffect("cursormaphand", [text(args, 0), number(args, 1, 1) === 0 ? 0 : 1])] })),
  uiCommand("mouseCursor", [
    { name: "file", optional: false, byRef: false, variadic: false },
    { name: "hotspotX", optional: true, byRef: false, variadic: false },
    { name: "hotspotY", optional: true, byRef: false, variadic: false },
    { name: "red", optional: true, byRef: false, variadic: false },
    { name: "green", optional: true, byRef: false, variadic: false },
    { name: "blue", optional: true, byRef: false, variadic: false },
  ], cursorDoc("Choose the mouse cursor.", "Uses the bundled 32×32 arrow for `TK DEFAULT` or an empty file; otherwise uses the custom image with the supplied hot spot and transparent RGB key, and the call does not wait. A custom cursor is drawn at the current pointer position."), (_view, args) => ({ value: null, effects: [uiEffect("mousecursor", [text(args, 0), Math.trunc(number(args, 1)), Math.trunc(number(args, 2)), Math.trunc(number(args, 3)), Math.trunc(number(args, 4)), Math.trunc(number(args, 5))])] })),
  uiCommand("dialogue", [textParam], { ...plainDoc("Show one dialogue message and wait for the player.", "Shows the message after `<var>` splicing, then waits for the next unclaimed input key and returns its name.", { kind: "until-input", summary: "Waits for a key press." }), see: ["docs/spec/engine/plugins-and-battle.md#e-123"] }, (view, args) => {
    const state = view.state;
    const thread = state?.vm.threads.find((candidate) => candidate.id === view.thread);
    const source = thread?.source === null || thread?.source === undefined
      ? undefined
      : state?.sprites.players.find((sprite) => sprite.id === thread.source)
        ?? state?.sprites.items.find((sprite) => sprite.id === thread.source);
    const actorId = source?.actorId;
    if (state === undefined || actorId === undefined || actorId === null || !state.actors.actors.some((actor) => actor.id === actorId)) {
      throw new ScriptError("dialogue.no-source", "dialogue requires a live actor as its source");
    }
    const target = thread?.target === null || thread?.target === undefined
      ? undefined
      : state.sprites.players.find((sprite) => sprite.id === thread.target)
        ?? state.sprites.items.find((sprite) => sprite.id === thread.target);
    const targetActorId = target?.actorId;
    const targetId = targetActorId !== undefined && targetActorId !== null && state.actors.actors.some((actor) => actor.id === targetActorId)
      ? targetActorId
      : null;
    const line = spliceVariables(text(args, 0), view);
    return {
      value: null,
      effects: [effect([line])],
      wait: { kind: "input.key", global: true, key: null, dialogue: { actorId, targetId, text: line } },
    };
  }),
  uiCommand("mwin", [textParam], plainDoc("Show a line of dialogue.", "Shows the fixed 600×100 logical-pixel message window at the top, appending the text after `<var>` splicing and rendering all glyphs at once; it does not wait."), (view, args) => ({ value: null, effects: [effect([spliceVariables(text(args, 0), view)])] })),
  uiCommand("mwincls", NO_ARGS, plainDoc("Clear and hide the dialogue window.", "Hides the message window and clears all of its text immediately; it does not wait."), () => ({ value: null, effects: [effect()] })),
  uiCommand("mwinSize", [{ name: "percent", optional: true, byRef: false, variadic: true }], { summary: "Obsolete.", behaviour: "Raises the catchable obsolete-command error for every call; the fixed message-window geometry cannot be changed.", groups: [DIALOGUE], tags: ["obsolete"], waits: { kind: "never", summary: "Does not wait." } }, () => { throw new ScriptError("builtin.obsolete", '"mwinsize" is obsolete: the statement is skipped'); }),
  uiCommand("show", [textParam], plainDoc("Show a line of dialogue.", "Acts exactly like `mwin`: appends the spliced text to the fixed message window and does not wait."), (view, args) => ({ value: null, effects: [effect([spliceVariables(text(args, 0), view)])] })),
  uiCommand("mbox", [textParam], plainDoc("Show a line of dialogue.", "Acts exactly like `mwin`: appends the spliced text to the fixed message window and does not wait."), (view, args) => ({ value: null, effects: [effect([spliceVariables(text(args, 0), view)])] })),
  uiCommand("winGraphic", [{ name: "file", optional: false, byRef: false, variadic: false }], plainDoc("Choose the message-window background image.", "Stores the supplied asset name as the message-window background; the next draw uses it and the call does not wait."), (_view, args) => ({ value: null, effects: [effect([text(args, 0)])] })),
  uiCommand("winColor", [{ name: "dos", optional: false, byRef: false, variadic: false }], plainDoc("Choose the message-window colour.", "Converts the DOS palette index to RGB and stores it as the window background; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([Math.trunc(number(args, 0))])] })),
  uiCommand("winColorRgb", [{ name: "r", optional: false, byRef: false, variadic: false }, { name: "g", optional: false, byRef: false, variadic: false }, { name: "b", optional: false, byRef: false, variadic: false }], plainDoc("Choose the message-window RGB colour.", "Clamps each channel to 0–255 and stores the resulting background colour; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([rgb(args, 0).r, rgb(args, 0).g, rgb(args, 0).b])] })),
  uiCommand("setMwinTranslucency", [{ name: "percent", optional: false, byRef: false, variadic: false }], plainDoc("Set how see-through the message window is.", "Clamps the background blend to 0–100 percent (0 invisible, 100 opaque); the call does not wait."), (_view, args) => ({ value: null, effects: [effect([Math.max(0, Math.min(100, Math.trunc(number(args, 0))))])] })),
  uiCommand("textSpeed", [{ name: "speed", optional: true, byRef: false, variadic: true }], { summary: "Obsolete.", behaviour: "Raises the catchable obsolete-command error for every call; message text is always shown all at once.", groups: [DIALOGUE], tags: ["obsolete"], waits: { kind: "never", summary: "Does not wait." } }, () => { throw new ScriptError("builtin.obsolete", '"textspeed" is obsolete: the statement is skipped'); }),
  uiCommand("font", [{ name: "font", optional: false, byRef: false, variadic: false }], plainDoc("Choose the font for later text.", "Resolves the name case-insensitively, applying the documented Liberation family substitution when needed; later text uses that asset and the call does not wait."), (_view, args) => ({ value: null, effects: [effect([text(args, 0)])] })),
  uiCommand("fontSize", [{ name: "size", optional: false, byRef: false, variadic: false }], plainDoc("Choose the font size in pixels.", "Stores a positive logical-pixel font size used for glyph metrics and square `text` cells; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([Math.max(1, Math.min(256, Math.trunc(number(args, 0))))])] })),
  uiCommand("bold", [{ name: "enable", optional: false, byRef: false, variadic: false }], plainDoc("Turn bold text on or off.", "Stores the boolean-style flag (zero is off, non-zero is on) in the current FontRef; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([number(args, 0) === 0 ? 0 : 1])] })),
  uiCommand("italics", [{ name: "enable", optional: false, byRef: false, variadic: false }], plainDoc("Turn italic text on or off.", "Stores the boolean-style flag (zero is off, non-zero is on) in the current FontRef; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([number(args, 0) === 0 ? 0 : 1])] })),
  uiCommand("underline", [{ name: "enable", optional: false, byRef: false, variadic: false }], plainDoc("Turn underlining on or off.", "Stores the boolean-style flag (zero is off, non-zero is on); underline is emitted as a separate line command and the call does not wait."), (_view, args) => ({ value: null, effects: [effect([number(args, 0) === 0 ? 0 : 1])] })),
  uiCommand("color", [{ name: "dos", optional: false, byRef: false, variadic: false }], plainDoc("Choose a DOS text colour.", "Converts the DOS palette index to RGB and stores it as the active text colour; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([Math.trunc(number(args, 0))])] })),
  uiCommand("colorRgb", [{ name: "r", optional: false, byRef: false, variadic: false }, { name: "g", optional: false, byRef: false, variadic: false }, { name: "b", optional: false, byRef: false, variadic: false }], plainDoc("Choose an RGB text colour.", "Clamps each channel to 0–255 and stores the resulting active text colour; the call does not wait."), (_view, args) => ({ value: null, effects: [effect([rgb(args, 0).r, rgb(args, 0).g, rgb(args, 0).b])] })),
  uiCommand("getColor", [{ name: "r", optional: false, byRef: true, variadic: false }, { name: "g", optional: false, byRef: true, variadic: false }, { name: "b", optional: false, byRef: true, variadic: false }], plainDoc("Read the active text colour.", "Writes the current RGB channels to the three references in order and returns immediately."), (view, args) => { const color = (view.state?.ui as UiSection | undefined)?.color ?? WHITE; return { value: color.r, out: [...byRef(args, 0, color.r), ...byRef(args, 1, color.g), ...byRef(args, 2, color.b)], effects: [effect([], "pure")] }; }),
  uiCommand("getFontSize", [{ name: "ret", optional: true, byRef: true, variadic: false }], plainDoc("Read the active font size.", "Returns and optionally writes the current logical-pixel font size immediately."), (view, args) => { const size = (view.state?.ui as UiSection | undefined)?.font?.size ?? 8; return { value: size, out: byRef(args, 0, size), effects: [effect([], "pure")] }; }),
  uiCommand("getTextWidth", [{ name: "text", optional: false, byRef: false, variadic: false }, { name: "ret", optional: true, byRef: true, variadic: false }], plainDoc("Measure text width in pixels.", "Measures the spliced string using the active FontRef metrics, writes the optional result reference and does not wait."), (view, args) => { const ui = (view.state?.ui as UiSection | undefined); const ref = ui?.font ?? { asset: DEFAULT_FONT as never, size: 8, bold: false, italic: false }; const value = spliceVariables(text(args, 0), view); const result = layoutText(value, ref).width; return { value: result, out: byRef(args, 1, result), effects: [effect([value, result], "pure")] }; }),
  uiCommand("getTextHeight", [{ name: "text", optional: false, byRef: false, variadic: false }, { name: "ret", optional: true, byRef: true, variadic: false }], plainDoc("Measure text height in pixels.", "Measures the spliced string using the active FontRef line height, writes the optional result reference and does not wait."), (view, args) => { const ui = (view.state?.ui as UiSection | undefined); const ref = ui?.font ?? { asset: DEFAULT_FONT as never, size: 8, bold: false, italic: false }; const value = spliceVariables(text(args, 0), view); const result = layoutText(value, ref).height; return { value: result, out: byRef(args, 1, result), effects: [effect([value, result], "pure")] }; }),
  uiCommand("print", [textParam], plainDoc("Print one line below the previous text.", "Draws the spliced text at the UI cursor, then advances the cursor by one active-font line; the call does not wait."), (view, args) => ({ value: null, effects: [effect([spliceVariables(text(args, 0), view)], "draw-audio-cue")] })),
  uiCommand("text", [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, textParam, { name: "canvas", optional: true, byRef: false, variadic: false }], plainDoc("Draw text in square cells.", "Keeps a fractional 1-based cell coordinate, scales it by the font size and truncates the resulting pixel origin toward zero, so it maps to `(trunc((x - 1) × fontSize), trunc((y - 1) × fontSize))`; newlines advance one cell row, glyphs are clipped and the call does not wait. With a canvas handle the glyphs are drawn into that canvas's pixels (and so are redrawn by clearing the canvas), not onto the screen's text layer; an unknown canvas raises `surface.unknown`."), (view, args) => ({ value: null, effects: [effect([number(args, 0), number(args, 1), spliceVariables(text(args, 2), view), ...canvasTarget(view, args, 3, "text")])] })),
  uiCommand("pixelText", [{ name: "x", optional: false, byRef: false, variadic: false }, { name: "y", optional: false, byRef: false, variadic: false }, textParam, { name: "canvas", optional: true, byRef: false, variadic: false }], plainDoc("Draw text at pixel coordinates.", "Uses the supplied logical-pixel origin, the active FontRef metrics and clipping; the call does not wait. With a canvas handle the glyphs are drawn into that canvas's pixels (and so are redrawn by clearing the canvas), not onto the screen's text layer; an unknown canvas raises `surface.unknown`."), (view, args) => ({ value: null, effects: [effect([Math.trunc(number(args, 0)), Math.trunc(number(args, 1)), spliceVariables(text(args, 2), view), ...canvasTarget(view, args, 3, "pixelText")], "draw-audio-cue")] })),
  uiCommand("staticText", [{ name: "args", optional: true, byRef: false, variadic: true }], { summary: "Obsolete.", behaviour: "Raises the catchable obsolete-command error and skips the statement.", groups: [DIALOGUE], tags: ["obsolete"], waits: { kind: "never", summary: "Does not wait." } }, () => { throw new ScriptError("builtin.obsolete", '"statictext" is obsolete: the statement is skipped'); }),
  uiCommand("declareCustomTouchControls", NO_ARGS, reawakenedDoc("Explicitly declare usable game-owned touch controls.", "Sets a persistent game-state declaration used by hosts to suppress runner fallback controls. Capability queries and ordinary accessibility surfaces do not set it."), () => ({ value: null, effects: [effect()] })),
  uiCommand("uiBegin", [
    { name: "id", optional: false, byRef: false, variadic: false },
    { name: "role", optional: false, byRef: false, variadic: false },
    { name: "x", optional: false, byRef: false, variadic: false },
    { name: "y", optional: false, byRef: false, variadic: false },
    { name: "w", optional: false, byRef: false, variadic: false },
    { name: "h", optional: false, byRef: false, variadic: false },
  ], reawakenedDoc("Declare a script-drawn surface so the engine navigates and describes it.", "Opens a per-thread surface with logical-pixel bounds; returns 1 when accepted and 0 when malformed. Close it with uiEnd()."), (view, args) => {
    const owner = view.thread ?? -1;
    const id = text(args, 0);
    const role = text(args, 1);
    const x = number(args, 2); const y = number(args, 3);
    const w = number(args, 4); const h = number(args, 5);
    const valid = view.thread !== undefined && owner >= 0 && id !== "" &&
      (role === "menu" || role === "list" || role === "dialog" || role === "surface") &&
      [x, y, w, h].every(Number.isSafeInteger) && w > 0 && h > 0;
    const argsData = [id, role, x, y, w, h, valid ? 1 : 0] as PlainData[];
    return { value: valid ? 1 : 0, effects: [surfaceEffect(view, argsData)] };
  }),
  uiCommand("uiItem", [
    { name: "label", optional: false, byRef: false, variadic: false },
    { name: "options", optional: true, byRef: false, variadic: false },
  ], reawakenedDoc("Append one item to the open surface.", "Adds one navigable item to the calling thread's open surface. Optional dictionary fields are id, value, enabled, role, bounds and explicit semantic action."), (view, args) => {
    const optionsValue = args[1]?.value;
    const options = itemOptions(view, optionsValue);
    const bounds = options?.bounds === undefined ? null : dictionary(view, options.bounds);
    const boundsData = bounds === null ? null : {
      x: typeof bounds.x === "number" ? bounds.x : 0,
      y: typeof bounds.y === "number" ? bounds.y : 0,
      w: typeof bounds.w === "number" ? bounds.w : 0,
      h: typeof bounds.h === "number" ? bounds.h : 0,
    };
    const action = options?.action;
    const actionValid = action === undefined || (typeof action === "string" && /^(confirm|cancel|game\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*)$/.test(action));
    const allowedOptions: Record<string, true> = { id: true, value: true, enabled: true, role: true, bounds: true, action: true };
    const optionsValid = options !== null && Object.keys(options).every((key) => allowedOptions[key] === true);
    const enabledValid = options?.enabled === undefined || typeof options.enabled === "number" || options.enabled === "0" || options.enabled === "1";
    const boundsValid = options?.bounds === undefined || (
      bounds !== null && boundsData !== null &&
      [boundsData.x, boundsData.y, boundsData.w, boundsData.h].every(Number.isSafeInteger) &&
      boundsData.w > 0 && boundsData.h > 0
    );
    const argsData = [
      text(args, 0),
      options?.id === undefined ? null : options.id as PlainData,
      options?.value === undefined ? null : options.value as PlainData,
      options?.enabled === undefined ? 1 : (options.enabled === 0 || options.enabled === "0" ? 0 : 1),
      options?.role === undefined ? null : options.role as PlainData,
      action === undefined ? null : action as PlainData,
      boundsData,
      optionsValid && enabledValid && boundsValid && actionValid ? 1 : 0,
    ] as PlainData[];
    return { value: null, effects: [surfaceEffect(view, argsData)] };
  }),
  uiCommand("uiEnd", NO_ARGS, reawakenedDoc("Close the open surface and publish it for this frame.", "Closes the calling thread's open surface and publishes its ordered items for navigation, accessibility and pointer hit-testing."), (view) => ({ value: null, effects: [surfaceEffect(view, [])] })),
  uiCommand("uiSelection", [{ name: "ret", optional: true, byRef: true, variadic: false }], reawakenedDoc("Read the focused item index of the open surface.", "Returns the 0-based focus index, or −1 when the calling thread has no focusable surface; writes the optional reference."), (view, args) => {
    const owner = view.thread ?? -1;
    const selected = (view.state?.ui.actionSurfaces ?? []).find((surface) => surface.owner === owner)?.selection ?? -1;
    return { value: selected, out: output(args, 0, selected), effects: [effect([], "pure")] };
  }),
  uiCommand("uiFocus", [{ name: "index", optional: false, byRef: false, variadic: false }], reawakenedDoc("Move the cursor to an item of the open surface.", "Sets focus to an enabled item by its 0-based index; invalid and disabled indexes are ignored."), (view, args) => {
    const index = number(args, 0);
    return { value: null, effects: Number.isSafeInteger(index) ? [surfaceEffect(view, [index])] : [effect([], "pure")] };
  }),
  uiCommand("uiActivated", [{ name: "ret", optional: true, byRef: true, variadic: false }], reawakenedDoc("Did the focused item get confirmed on this frame?", "Returns the 0-based activated item index for this frame, or −1 otherwise, and writes the optional reference."), (view, args) => {
    const owner = view.thread ?? -1;
    const claim = view.state?.ui.surfaceActivated;
    const index = claim !== null && claim !== undefined && claim.owner === owner ? claim.index : -1;
    return { value: index, out: output(args, 0, index), effects: [surfaceEffect(view, [owner])] };
  }),
  uiCommand("uiCancelled", NO_ARGS, reawakenedDoc("Did `cancel` arrive on this frame for the open surface?", "Returns 1 when cancel was claimed for this author surface on this frame, otherwise 0."), (view) => {
    const owner = view.thread ?? -1;
    const claimed = view.state?.ui.surfaceCancelled === true && view.state.ui.surfaceCancelledOwner === owner;
    return { value: claimed ? 1 : 0, effects: claimed ? [surfaceEffect(view, [owner])] : [effect([], "pure")] };
  }),
  uiCommand("prompt", [{ name: "question", optional: false, byRef: false, variadic: false }, { name: "ret", optional: true, byRef: true, variadic: false }], { summary: "Ask the player for text.", behaviour: "Shows a modal prompt and yields until the UI supplies a typed value; the value is returned and written to the optional reference.", groups: [DIALOGUE], waits: { kind: "until-input", summary: "Yields until the prompt is answered." } }, (view, args) => ({ value: null, effects: [effect([spliceVariables(text(args, 0), view)])], wait: { kind: "render.msgbox", global: true, id: "prompt", payload: [spliceVariables(text(args, 0), view)], resumeRefs: args[1]?.ref === null || args[1]?.ref === undefined ? [] : [args[1].ref] } })),
  uiCommand("msgBox", [{ name: "text", optional: false, byRef: false, variadic: false }, { name: "title", optional: true, byRef: false, variadic: false }, { name: "style", optional: true, byRef: false, variadic: false }, { name: "textColor", optional: true, byRef: false, variadic: false }, { name: "backColor", optional: true, byRef: false, variadic: false }, { name: "bitmap", optional: true, byRef: false, variadic: false }], { summary: "Ask a question with buttons.", behaviour: "Shows a centred wrapped panel, merges the title as its first body line, then yields until the first OK or Yes/No button is selected; it returns 1, 6 or 7.", groups: [DIALOGUE], waits: { kind: "until-input", summary: "Yields until a button is selected." } }, (_view, args) => { const style = Math.trunc(number(args, 2)); if (style !== 0 && style !== 1) throw new ScriptError("builtin.bad-arg", "msgbox: style must be 0 (OK) or 1 (Yes/No)"); return { value: 0, effects: [effect(values(args))], wait: { kind: "render.msgbox", global: true, id: "msgbox", payload: values(args), resumeRefs: [] } }; }),
];

export const UI_PLUGIN: PluginDefinition = {
  id: "ui",
  version: "1.0.0",
  doc: { summary: "Deterministic message-window, text and modal prompt commands.", groups: [{ id: DIALOGUE, name: "Message window, text and fonts", summary: "Dialogue, text layout and modal prompts." }] },
  commands: UI_COMMANDS,
};

export function applyUiEffect(
  state: { ui: UiSection; surfaces?: SurfacesSection; engine?: { claims?: number[] }; time?: { tick: number } },
  name: string,
  args: readonly PlainData[],
  /** Resolve a `font(name)` argument against the assets the project ships, when the caller has them. */
  resolveFont?: (name: string) => AssetKey | null,
  /** Report malformed author UI without raising into the script. */
  reportSurfaceError?: (owner: number, message: string) => void,
): void {
  const ui = state.ui;
  if (ui.message === undefined) Object.assign(ui, createUiSection());
  if (ui.backgroundSurface === null && state.surfaces !== undefined && state.surfaces.entries !== undefined) {
    ui.backgroundSurface = colourSurface(state.surfaces, ui.message.background);
    ui.backgroundRev = 0;
  }
  const first = args[0];
  const stringArg = (value: PlainData | undefined): string => typeof value === "string" ? value : "";
  const numberArg = (value: PlainData | undefined): number => typeof value === "number" ? value : 0;
  const setBackground = (background: Rgb): void => {
    ui.message = { ...ui.message, background };
    if (state.surfaces !== undefined) ui.backgroundSurface = colourSurface(state.surfaces, background);
  };
  switch (name.toLowerCase()) {
    case "declarecustomtouchcontrols":
      ui.customTouchControlsDeclared = true;
      return;
    case "uibegin": {
      const owner = numberArg(first);
      if (numberArg(args[7]) !== 1) {
        reportSurfaceError?.(owner, "uiBegin rejected a malformed author surface");
        return;
      }
      const id = stringArg(args[1]); const role = stringArg(args[2]);
      const bounds = { x: numberArg(args[3]), y: numberArg(args[4]), w: numberArg(args[5]), h: numberArg(args[6]) };
      const accepted = owner >= 0 && id !== "" &&
        (role === "menu" || role === "list" || role === "dialog" || role === "surface") &&
        Object.values(bounds).every(Number.isSafeInteger) && bounds.w > 0 && bounds.h > 0;
      if (!accepted) {
        reportSurfaceError?.(owner, "uiBegin rejected a malformed author surface");
        return;
      }
      ui.surfaceBuilders = [
        ...ui.surfaceBuilders.filter((builder) => builder.owner !== owner),
        { owner, id, role, bounds, items: [], invalid: false, openedTick: state.time?.tick ?? 0 },
      ];
      return;
    }
    case "uiitem": {
      const owner = numberArg(first);
      const builderIndex = ui.surfaceBuilders.findIndex((builder) => builder.owner === owner);
      if (builderIndex < 0) return;
      const builder = ui.surfaceBuilders[builderIndex]!;
      const label = stringArg(args[1]);
      const idValue = args[2];
      const value = args[3];
      const enabledValue = args[4];
      const roleValue = args[5];
      const actionValue = args[6];
      const boundsValue = args[7];
      const accepted = numberArg(args[8]) === 1;
      const itemId = typeof idValue === "string" ? idValue : `item-${builder.items.length}`;
      const role = typeof roleValue === "string" ? roleValue : builder.role === "list" ? "listitem" : builder.role === "surface" ? "button" : "menuitem";
      const allowedRole = role === "menuitem" || role === "button" || role === "listitem" || role === "text";
      const enabled = numberArg(enabledValue) !== 0;
      const boundsRecord = typeof boundsValue === "object" && boundsValue !== null && !Array.isArray(boundsValue) ? boundsValue as Record<string, PlainData> : null;
      const explicitBounds = boundsRecord === null ? null : {
        x: typeof boundsRecord.x === "number" ? boundsRecord.x : NaN,
        y: typeof boundsRecord.y === "number" ? boundsRecord.y : NaN,
        w: typeof boundsRecord.w === "number" ? boundsRecord.w : NaN,
        h: typeof boundsRecord.h === "number" ? boundsRecord.h : NaN,
      };
      const validBounds = explicitBounds === null || (
        Object.values(explicitBounds).every(Number.isSafeInteger) &&
        explicitBounds.w > 0 && explicitBounds.h > 0 &&
        explicitBounds.x >= builder.bounds.x && explicitBounds.y >= builder.bounds.y &&
        explicitBounds.x + explicitBounds.w <= builder.bounds.x + builder.bounds.w &&
        explicitBounds.y + explicitBounds.h <= builder.bounds.y + builder.bounds.h
      );
      const validAction = actionValue === null || (typeof actionValue === "string" && /^(confirm|cancel|game\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*)$/.test(actionValue));
      if (builder.items.length >= 256 || label === "" || (typeof idValue !== "string" && idValue !== null) ||
          (typeof idValue === "string" && idValue === "") ||
          (typeof value !== "string" && value !== null) || !allowedRole || !validBounds || !validAction ||
          (typeof actionValue !== "string" && actionValue !== null) || !accepted ||
          builder.items.some((item) => item.id === itemId)) {
        ui.surfaceBuilders[builderIndex] = { ...builder, invalid: true };
        return;
      }
      const bounds = explicitBounds ?? { x: builder.bounds.x, y: builder.bounds.y, w: 0, h: 0 };
      ui.surfaceBuilders[builderIndex] = {
        ...builder,
        items: [...builder.items, { id: itemId, label, value: typeof value === "string" ? value : null, enabled, role, bounds, ...(typeof actionValue === "string" ? { action: actionValue } : {}) }],
      };
      return;
    }
    case "uiend": {
      const owner = numberArg(first);
      const builder = ui.surfaceBuilders.find((candidate) => candidate.owner === owner);
      ui.surfaceBuilders = ui.surfaceBuilders.filter((candidate) => candidate.owner !== owner);
      if (builder === undefined) return;
      if (builder.invalid || builder.items.length === 0) {
        reportSurfaceError?.(owner, "uiEnd rejected a malformed or empty author surface");
        return;
      }
      const count = builder.items.length;
      const items = builder.items.map((item, index) => {
        if (item.bounds.h > 0) return item;
        const top = Math.floor(index * builder.bounds.h / count);
        const bottom = Math.floor((index + 1) * builder.bounds.h / count);
        return { ...item, bounds: { x: builder.bounds.x, y: builder.bounds.y + top, w: builder.bounds.w, h: bottom - top } };
      });
      const selectionKey = surfaceSelectionKey(owner, builder.id);
      let selection = ui.surfaceSelection[selectionKey] ?? 0;
      if (selection < 0 || selection >= items.length || items[selection]?.enabled !== true) selection = items.findIndex((item) => item.enabled);
      if (selection < 0) selection = -1;
      ui.surfaceSelection[selectionKey] = selection;
      const surface = { id: builder.id, owner, role: builder.role, bounds: builder.bounds, items, selection, publishedTick: state.time?.tick ?? 0 };
      ui.actionSurfaces = [...ui.actionSurfaces.filter((candidate) => candidate.owner !== owner), surface];
      return;
    }
    case "uifocus": {
      const owner = numberArg(first); const index = Math.trunc(numberArg(args[1]));
      ui.actionSurfaces = ui.actionSurfaces.map((surface) => {
        const item = surface.items[index];
        if (surface.owner !== owner || item === undefined || !item.enabled) return surface;
        ui.surfaceSelection[surfaceSelectionKey(owner, surface.id)] = index;
        return { ...surface, selection: index };
      });
      return;
    }
    case "uiactivated": {
      const owner = numberArg(first);
      const claim = ui.surfaceActivated;
      if (claim?.owner === owner) {
        if (typeof claim.inputSeq === "number" && state.engine !== undefined) {
          const claims = state.engine.claims ??= [];
          if (!claims.includes(claim.inputSeq)) claims.push(claim.inputSeq);
        }
        ui.surfaceActivated = null;
      }
      return;
    }
    case "uicancelled": {
      const owner = numberArg(first);
      if (ui.surfaceCancelledOwner !== owner) return;
      if (typeof ui.surfaceCancelledSeq === "number" && state.engine !== undefined) {
        const claims = state.engine.claims ??= [];
        if (!claims.includes(ui.surfaceCancelledSeq)) claims.push(ui.surfaceCancelledSeq);
      }
      ui.surfaceCancelled = false;
      ui.surfaceCancelledSeq = null;
      ui.surfaceCancelledOwner = null;
      return;
    }
    case "dialogue":
    case "mwin":
    case "show":
    case "mbox": {
      const line = stringArg(first);
      ui.message = { ...ui.message, visible: true, text: ui.message.text === "" ? line : `${ui.message.text}\n${line}` };
      return;
    }
    case "mwincls": ui.message = { ...ui.message, visible: false, text: "" }; return;
    case "wingraphic": ui.message = { ...ui.message, graphic: stringArg(first) }; return;
    case "wincolor": setBackground(dosPaletteEntry(numberArg(first))); return;
    case "wincolorrgb": setBackground({ r: numberArg(args[0]), g: numberArg(args[1]), b: numberArg(args[2]) }); return;
    case "setmwintranslucency": ui.message = { ...ui.message, translucency: Math.max(0, Math.min(100, Math.trunc(numberArg(first)))) }; return;
    case "font": {
      const requested = stringArg(first);
      ui.font = { ...ui.font, asset: resolveFont?.(requested) ?? canonicalFont(requested) };
      return;
    }
    case "fontsize": ui.font = { ...ui.font, size: Math.max(1, Math.min(256, Math.trunc(numberArg(first)))) }; return;
    case "bold": ui.font = { ...ui.font, bold: numberArg(first) !== 0 }; return;
    case "italics": ui.font = { ...ui.font, italic: numberArg(first) !== 0 }; return;
    case "underline": ui.underline = numberArg(first) !== 0; return;
    case "color": ui.color = dosPaletteEntry(numberArg(first)); ui.message = { ...ui.message, color: ui.color }; return;
    case "colorrgb": ui.color = { r: numberArg(args[0]), g: numberArg(args[1]), b: numberArg(args[2]) }; ui.message = { ...ui.message, color: ui.color }; return;
    case "text": {
      // A canvas target (fourth argument) is drawn into that canvas by the engine, never onto the screen text layer.
      if (numberArg(args[3]) !== 0) return;
      // E-56 (docs/spec/engine/rpgcode-functions.md#reawakened-text-cell-size): the cell
      // coordinate keeps its fraction, is scaled, and only the pixel origin is truncated
      // toward zero, so ((x - 1) × size) is floored as a pixel value, not a cell.
      const x = Math.trunc((numberArg(args[0]) - 1) * ui.font.size);
      const y = Math.trunc((numberArg(args[1]) - 1) * ui.font.size);
      ui.draws = [...ui.draws, { x, y, cell: true, text: stringArg(args[2]), font: ui.font, rgb: ui.color, underline: ui.underline }];
      ui.cursorX = x; ui.cursorY = y;
      return;
    }
    case "pixeltext": {
      if (numberArg(args[3]) !== 0) return;
      ui.draws = [...ui.draws, { x: numberArg(args[0]), y: numberArg(args[1]), cell: false, text: stringArg(args[2]), font: ui.font, rgb: ui.color, underline: ui.underline }];
      ui.cursorX = numberArg(args[0]); ui.cursorY = numberArg(args[1]);
      return;
    }
    case "print": {
      ui.draws = [...ui.draws, { x: ui.cursorX, y: ui.cursorY + ui.font.size, cell: false, text: stringArg(first), font: ui.font, rgb: ui.color, underline: ui.underline }];
      ui.cursorY += ui.font.size;
      return;
    }
    case "prompt": ui.modal = { modalId: ui.nextModalId++, kind: "prompt", text: stringArg(first), title: "", style: 0, textColor: ui.color, background: ui.message.background, graphic: "", selected: 0, result: null }; return;
    case "msgbox": ui.modal = { modalId: ui.nextModalId++, kind: "msgbox", text: stringArg(args[0]), title: stringArg(args[1]), style: numberArg(args[2]) === 1 ? 1 : 0, textColor: typeof args[3] === "number" ? dosPaletteEntry(numberArg(args[3])) : ui.color, background: typeof args[4] === "number" ? dosPaletteEntry(numberArg(args[4])) : ui.message.background, graphic: stringArg(args[5]), selected: 0, result: null }; return;
    case "createcursormap": {
      const id = Math.trunc(numberArg(first));
      const maps = ui.cursorMaps ?? [];
      ui.cursorMaps = [...maps, { id, points: [], selected: 0 }];
      ui.nextCursorMapId = Math.max(ui.nextCursorMapId ?? 1, id + 1);
      return;
    }
    case "cursormapadd": {
      const x = Math.trunc(numberArg(args[0]));
      const y = Math.trunc(numberArg(args[1]));
      const id = Math.trunc(numberArg(args[2]));
      ui.cursorMaps = (ui.cursorMaps ?? []).map((map) => map.id === id ? { ...map, points: [...map.points, { x, y }] } : map);
      return;
    }
    case "cursormaprun": {
      ui.activeCursorMap = Math.trunc(numberArg(first));
      return;
    }
    case "killcursormap": {
      const id = Math.trunc(numberArg(first));
      ui.cursorMaps = (ui.cursorMaps ?? []).filter((map) => map.id !== id);
      if (ui.activeCursorMap === id) delete ui.activeCursorMap;
      return;
    }
    case "cursormaphand": {
      const cursor = stringArg(first).trim();
      const asset = cursor === "" ? DEFAULT_HAND : assetKey(cursor);
      ui.cursorHand = { asset, stretch: numberArg(args[1]) !== 0, width: 32, height: 32 };
      return;
    }
    case "mousecursor": {
      const file = stringArg(first).trim();
      if (file.toLowerCase() === "none") { ui.mouseCursor = null; return; }
      ui.mouseCursor = {
        asset: file === "" || file.toLowerCase() === "tk default" ? DEFAULT_ARROW : assetKey(file),
        x: 0,
        y: 0,
        hotspotX: Math.trunc(numberArg(args[1])),
        hotspotY: Math.trunc(numberArg(args[2])),
        transparent: { r: Math.trunc(numberArg(args[3])), g: Math.trunc(numberArg(args[4])), b: Math.trunc(numberArg(args[5])) },
        width: 32,
        height: 32,
      };
      return;
    }
    default: return;
  }
}

export { BLACK, DEFAULT_FONT, WHITE };

/**
 * Minimal responders for the non-stub 9.11 catalogue (ticket 3.22).
 *
 * The domain owners can replace these layers later. Until then every catalogue
 * name has the real AD-8 shape: waits yield plain data, requests cross the
 * AD-17 boundary, and all other parts are recorded by the VM.
 *
 * Source: docs/spec/engine/rpgcode-functions.md and the discovery catalogue.
 */
import type { PlainData } from "../ports/plain-data.ts";
import type { NamedWaitKind, Wait } from "../ports/wait.ts";
import { MAX_TICK, secondsToTicks } from "../time/time.ts";
import type { BuiltinDoc, BuiltinSpec, ParamSpec } from "./builtins.ts";
import { ScriptError } from "./errors.ts";
import { IR_VERSION } from "./program.ts";
import type { CommandEffect, PluginDefinition } from "./plugin.ts";
import { CATALOGUE_STUBS_PLUGIN } from "./catalogue-stubs.ts";
import { PURE_SPECS } from "./builtins/pure.ts";
import type { SectionKey } from "../save/state.ts";
import { effectCommand } from "./packs/common.ts";
import { UI_COMMANDS } from "./packs/ui.ts";
import { GRAPHICS_COMMANDS } from "./packs/graphics.ts";
import { RENDER_PLUGIN } from "./packs/render.ts";
import { toNumberValue, toStringValue } from "./values.ts";
import { INVENTORY_COMMANDS, INVENTORY_COMMAND_NAMES } from "./packs/inventory.ts";
import { BATTLE_COMMAND_NAMES } from "./packs/battle.ts";
const MENU_SCREENS = ["main", "items", "equipment", "abilities"] as const;
const MENU_COMMANDS: readonly BuiltinSpec[] = [
  ...MENU_SCREENS.map((screen) => ({
    aliases: [],
    name: screen === "main" ? "mainmenu" : screen === "items" ? "itemmenu" : screen === "equipment" ? "equipmentmenu" : "abilitiesmenu",
    params: [],
    doc: { summary: `Open the ${screen} menu.`, behaviour: "Blocks on the calling script thread until the menu provider completes normally.", groups: ["battle-stats-menus-33"] },
    call: () => ({ value: null, effects: [{ kind: "vm.control" as const, args: ["menu.open", screen] }] }),
  })),
  {
    name: "internalmenu",
    aliases: [],
    params: [{ name: "n", optional: false, byRef: false, variadic: false }],
    doc: { summary: "Open a menu by compatibility index.", behaviour: "Maps 0, 1, 2 and 4 to the main, items, equipment and abilities menu facades; other values raise a catchable invalid-argument error.", groups: ["battle-stats-menus-33"] },
    call: (_view, args) => {
      const index = Number(args[0]?.value);
      const screen = index === 0 ? "main" : index === 1 ? "items" : index === 2 ? "equipment" : index === 4 ? "abilities" : null;
      if (screen === null) throw new ScriptError("builtin.bad-arg", `"internalmenu": unsupported menu index ${String(args[0]?.value)}`);
      return { value: null, effects: [{ kind: "vm.control", args: ["menu.open", screen] }] };
    },
  },
];

const TICKET_4_29_DOCS: Readonly<Record<string, BuiltinDoc>> = {
  mwin: {
    summary: "Show the message window.",
    behaviour: "Shows the message window, a fixed strip at the top of the screen, with all of the text at once. Technically, the window is 600 by 100 logical pixels, centred horizontally, with no margin and 50% default translucency; the call does not wait.",
    groups: ["message-window-text-fonts-30"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-message-window-defaults"],
  },
  text: {
    summary: "Displays text on the screen.",
    behaviour: "Draws text on a grid of square cells as wide and tall as the current font size, counting from cell (1, 1) at the top left. Technically, each coordinate is truncated toward zero and maps to the pixel origin ((x - 1) × size, (y - 1) × size); text outside the surface is clipped and the call does not wait.",
    groups: ["message-window-text-fonts-30"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-text-cell-size"],
  },
  textspeed: {
    summary: "Obsolete.",
    behaviour: "Raises the catchable obsolete-command error on any call and skips the statement; the message window shows all of its text at once.",
    groups: ["message-window-text-fonts-30"],
    tags: ["obsolete"],
    replacedBy: { kind: "syntax", text: "Use mwin; the text appears all at once." },
    reason: "The message window is fixed and reveals its whole text at once, so there is no speed to set.",
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-message-window-defaults"],
  },
  msgbox: {
    summary: "Display a message box with one or two buttons. Toolkit 3.1 used cursor maps for some choices; this does not establish that Reawakened msgbox uses cursor maps.",
    behaviour: "Shows a centred wrapped panel, merges the title as its first body line, then blocks until a button is selected; it returns 1 (OK), 6 (Yes) or 7 (No). Toolkit 3.1's cursor-map behavior is legacy evidence, not a claim about Reawakened usage.",
    groups: ["message-window-text-fonts-30"],
    waits: { kind: "until-input", summary: "Yields until a button is selected." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-msgbox-layout"],
  },
  animation: {
    summary: "Play an animation at pixel x,y. If animation() is called in a thread, it may be looped using the last parameter and returns an id that can be used to end the animation.",
    behaviour: "Starts the named .anm or animated GIF at the given pixel position. Technically, frames advance every fixed delay tick, a true loop flag keeps the animation running until endAnimation, and the call returns a deterministic animation id without waiting.",
    groups: ["graphics-canvases-animation-video-31"],
    waits: { kind: "never", summary: "Starts playback without waiting." },
    see: ["docs/spec/engine/plugins-and-battle.md#e-54"],
  },
  sizedanimation: {
    summary: "Play a resized animation at pixel x,y. If sizedAnimation() is called in a thread, it may be looped using the last parameter and returns an id that can be used to end...",
    behaviour: "Starts the named .anm or animated GIF at the given pixel position and size. Technically, height precedes width as in the legacy call, the first-page GIF delay is used, a true loop flag keeps the animation running until endAnimation, and the call returns a deterministic animation id without waiting.",
    groups: ["graphics-canvases-animation-video-31"],
    waits: { kind: "never", summary: "Starts playback without waiting." },
    see: ["docs/spec/engine/plugins-and-battle.md#e-54"],
  },
  endanimation: {
    summary: "End a multitasking animation.",
    behaviour: "Stops the animation with the supplied id. Technically, an unknown id is ignored and the call completes immediately.",
    groups: ["graphics-canvases-animation-video-31"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/plugins-and-battle.md#e-54"],
  },
  fade: {
    summary: "Perform a fade using the current colour. There are several different types of fades.",
    behaviour: "Plays a screen effect and waits for it to finish. Technically, types 0 to 5 select the effect (0 when the argument is omitted), each running 30 fixed ticks; any other type does nothing and raises no error.",
    groups: ["board-tiles-vectors-screen-effects-33"],
    waits: { kind: "ticks", summary: "Blocks for the fixed 30-tick transition." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-fade-types"],
  },
  wipe: {
    summary: "'Wipe' a graphic to the screen. file: filename of the image to wipe to. effect: numeric value between 1 and 12. The valid types are:",
    behaviour: "Reveals the named image over the screen and waits until it is fully shown. Technically, effects 1 to 4 reveal from a side, 5 to 8 sweep diagonally and 9 to 12 push the old image off; speed is logical pixels per fixed tick and defaults to 1, a speed of 0 or less raises a catchable bad-argument error, and the last frame is exactly the new image.",
    groups: ["board-tiles-vectors-screen-effects-33"],
    waits: { kind: "ticks", summary: "Blocks for the fixed-tick wipe transition." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-wipe-effects-and-speed"],
  },
  zoom: {
    summary: "Zoom into the centre of the board by the specified percent.",
    behaviour: "Zooms the view in towards the centre of the board and waits until it is done (LOW confidence in the exact meaning). Technically, the argument is the shrink amount from 0 to 75, the visible part becomes 100 minus that per cent of the screen, and each call blocks for a bounded 30 fixed ticks; other values raise a catchable bad-argument error.",
    groups: ["board-tiles-vectors-screen-effects-33"],
    waits: { kind: "ticks", summary: "Blocks for the fixed 30-tick zoom." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-zoom"],
  },
  cursormaphand: {
    summary: "Choose the image used for the cursor-map hand.",
    behaviour: "Changes the pointing hand used by cursor maps. Technically, the bundled hand is 32 by 32 pixels with no hot spot and is drawn at an offset of (-40, -10) from the cursor-map point; the stretch option scales a supplied image to 32 by 32; the call does not wait.",
    groups: ["mouse-buttons-cursor-maps-11"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-default-cursors"],
  },
  mousecursor: {
    summary: "Change the mouse cursor. \"TK DEFAULT\" or \"\" restores the default cursor.",
    behaviour: "Changes the mouse pointer. Technically, the default arrow is the bundled 32 by 32 pixel image with hot spot (0, 0), restored by \"TK DEFAULT\" or an empty file name; the call does not wait.",
    groups: ["mouse-buttons-cursor-maps-11"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-default-cursors"],
  },
  drawenemy: {
    summary: "Draw an enemy.",
    behaviour: "Draws battle asset frame 0 at logical-pixel coordinates without mutating battle state or consuming randomness; the call does not wait.",
    groups: ["battle-stats-menus-33"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#reawakened-draw-enemy"],
  },
  reset: {
    summary: "Reset the game.",
    behaviour: "Clears the documented engine sections, preserves the injected RNG and fixed clock, then reruns startup from the reset entry point without waiting.",
    groups: ["program-flow-errors-debugging-25"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/main-loop-and-startup.md#reawakened-reset-sections"],
  },
  start: {
    summary: "Obsolete.",
    behaviour: "Raises the catchable obsolete-command error and skips the statement; opening a game is a host lifecycle operation.",
    groups: ["program-flow-errors-debugging-25", "files-saves-os-15"],
    tags: ["obsolete"],
    replacedBy: { kind: "syntax", text: "Use the host lifecycle operation for loading a game." },
    reason: "The Reawakened host owns game loading instead of shell-open commands.",
    see: ["docs/spec/engine/main-loop-and-startup.md#reawakened-startup-ports"],
  },
  mainfile: {
    summary: "Load a new main file.",
    behaviour: "Requests a board-rendering lifecycle switch to the named project and returns immediately; the host performs the actual load.",
    groups: ["files-saves-os-15", "board-tiles-vectors-screen-effects-33"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/main-loop-and-startup.md#e-06"],
  },
  win: {
    summary: "Obsolete.",
    behaviour: "Raises the catchable obsolete-command error and skips the statement; use the configured game-over flow instead.",
    groups: ["program-flow-errors-debugging-25", "battle-stats-menus-33"],
    tags: ["obsolete"],
    replacedBy: { kind: "syntax", text: "Use the configured game-over flow." },
    reason: "Game-over presentation is owned by the board-rendering lifecycle.",
    see: ["docs/spec/engine/rpgcode-functions.md#e-55"],
  },
  gone: {
    summary: "Suppress the currently running board trigger until the board is left.",
    behaviour: "Writes only trigger suppression for the currently running board-trigger instance; it does not delete source or sprites and does not wait.",
    groups: ["program-flow-errors-debugging-25"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/movement-and-collision.md#reawakened-gone-trigger-suppression"],
  },
  over: {
    summary: "Show the game-over flow.",
    behaviour: "Requests the deterministic game-over flow in the board-rendering lifecycle and returns immediately.",
    groups: ["program-flow-errors-debugging-25"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#e-55"],
  },
  godos: {
    summary: "Obsolete.",
    behaviour: "Raises the catchable obsolete-command error and skips the statement; arbitrary shell execution is unavailable.",
    groups: ["program-flow-errors-debugging-25"],
    tags: ["obsolete"],
    replacedBy: { kind: "syntax", text: "Use an explicitly configured host platform service." },
    reason: "The Reawakened host does not expose arbitrary shell execution to scripts.",
    see: ["docs/spec/engine/rpgcode-functions.md#e-55"],
  },
  dos: {
    summary: "Quit the game.",
    behaviour: "Emits one deterministic quit request through the host lifecycle seam and returns immediately.",
    groups: ["program-flow-errors-debugging-25", "reawakened-additions-not-part-of-the-282-legacy-catalogue"],
    see: ["docs/spec/engine/rpgcode-functions.md#e-55"],
  },
  windows: {
    summary: "Quit the game.",
    behaviour: "Acts as the legacy alias of dos and emits one deterministic quit request through the host lifecycle seam; it returns immediately.",
    groups: ["program-flow-errors-debugging-25"],
    waits: { kind: "never", summary: "Does not wait." },
  },
  quitgame: {
    summary: "Quit the game.",
    behaviour: "Emits one deterministic quit request through the host lifecycle seam and returns immediately.",
    groups: ["reawakened-additions-not-part-of-the-282-legacy-catalogue"],
    waits: { kind: "never", summary: "Does not wait." },
    see: ["docs/spec/engine/rpgcode-functions.md#e-94"],
  },
};

const UI_NATIVE_SUMMARIES: Readonly<Record<string, string>> = {
  mwincls: "Clear and hide the message window.",
  show: "Show the message window.",
  mbox: "Show the message window.",
  wingraphic: "Set the message window background image.",
  font: "Load a true type font. TK2 fonts are not supported.",
  wincolor: "Set the message window's colour using a DOS code.",
  wincolorrgb: "Set the message window's colour.",
  setmwintranslucency: "Set the translucency of the message window. 0% is invisible; 100% is opaque.",
  pixeltext: "Displays text on the screen using pixel coordinates.",
  fontsize: "Set the font size.",
  bold: "Toggle emboldening of text.",
  italics: "Toggle italicizing of text.",
  underline: "Toggle underlining of text.",
  color: "Change to a DOS colour.",
  colorrgb: "Change the active colour to an RGB value.",
  getcolor: "Get the current colour.",
  getfontsize: "Get the current font size.",
  gettextwidth: "Get the width of a string of text in pixels, relative to the current font and size.",
  gettextheight: "Get the height of a string of text in pixels, relative to the current font and size.",
  print: "Write the specified string one line down from the last call to text().",
  prompt: "Ask the player a question and return the result.",
  statictext: "obsolete.",
};

function documentCommands(commands: readonly BuiltinSpec[]): readonly BuiltinSpec[] {
  const uiDocs = new Map(UI_COMMANDS.flatMap((command) => command.doc === undefined ? [] : [[command.name, command.doc] as const]));
  return commands.map((command) => {
    const source = TICKET_4_29_DOCS[command.name] ?? uiDocs.get(command.name);
    if (source === undefined) return command;
    const summary = UI_NATIVE_SUMMARIES[command.name] ?? source.summary;
    const obsolete = command.name === "mwinsize" || command.name === "statictext";
    const doc = obsolete
      ? { ...source, summary, replacedBy: { kind: "syntax" as const, text: "Use the fixed message-window commands instead." }, reason: "The Reawakened message window has fixed geometry and renders all text at once." }
      : { ...source, summary };
    return { ...command, doc };
  });
}
type Row = {
  readonly name: string;
  readonly kind: "mixed" | "wait" | "request" | "spawn-thread" | "flow-control";
  readonly params: string;
  readonly sections: readonly SectionKey[];
  readonly wait: string | null;
  readonly obsolete: boolean;
  readonly byRefOut: boolean;
};

const ROWS: readonly Row[] = [
  { name: "wingraphic", kind: "mixed", params: "file", sections: ["ui"], wait: null, obsolete: false, byRefOut: false },
  { name: "font", kind: "mixed", params: "file", sections: ["ui"], wait: null, obsolete: false, byRefOut: false },
  { name: "textspeed", kind: "mixed", params: "speed", sections: ["ui"], wait: null, obsolete: false, byRefOut: false },
  { name: "prompt", kind: "wait", params: "question[,&dest]", sections: ["ui"], wait: "render.msgbox", obsolete: false, byRefOut: true },
  { name: "msgbox", kind: "wait", params: "...", sections: ["ui"], wait: "render.msgbox", obsolete: false, byRefOut: false },
  { name: "wait", kind: "wait", params: "[&dest]", sections: [], wait: "input.key", obsolete: false, byRefOut: true },
  { name: "get", kind: "mixed", params: "[&dest]", sections: ["input"], wait: null, obsolete: false, byRefOut: true },
  { name: "mouseclick", kind: "wait", params: "&x,&y[,noWait]", sections: [], wait: "input.mouse", obsolete: false, byRefOut: true },
  { name: "scan", kind: "mixed", params: "x,y,layer,&mem", sections: ["world"], wait: null, obsolete: false, byRefOut: false },
  { name: "mem", kind: "mixed", params: "x,y[,layer],mem", sections: ["world"], wait: null, obsolete: false, byRefOut: false },
  { name: "cursormaprun", kind: "wait", params: "...", sections: ["ui"], wait: "input.key", obsolete: false, byRefOut: false },
  { name: "bitmap", kind: "mixed", params: "file[,cnv]", sections: ["surfaces"], wait: null, obsolete: false, byRefOut: false },
  { name: "setimage", kind: "mixed", params: "file,x,y,w,h", sections: ["surfaces"], wait: null, obsolete: false, byRefOut: false },
  { name: "setimagetransparent", kind: "mixed", params: "file,x,y,w,h,r,g,b", sections: ["surfaces"], wait: null, obsolete: false, byRefOut: false },
  { name: "setimagetranslucent", kind: "mixed", params: "file,x,y,w,h[,%]", sections: ["surfaces"], wait: null, obsolete: false, byRefOut: false },
  { name: "setimageadditive", kind: "mixed", params: "file,x,y,w,h,%", sections: ["surfaces"], wait: null, obsolete: false, byRefOut: false },
  { name: "wipe", kind: "mixed", params: "file,effect[,speed]", sections: ["fx"], wait: null, obsolete: false, byRefOut: false },
  { name: "viewbrd", kind: "mixed", params: "file[,x,y[,cnv]]", sections: ["surfaces"], wait: null, obsolete: false, byRefOut: false },
  { name: "addplayer", kind: "mixed", params: "file", sections: ["party","inventory"], wait: null, obsolete: false, byRefOut: false },
  { name: "newplayer", kind: "mixed", params: "file", sections: ["party","sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "newplyr", kind: "mixed", params: "file", sections: ["party","sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "activeplayer", kind: "mixed", params: "handle", sections: ["party"], wait: null, obsolete: false, byRefOut: false },
  { name: "restoreplayer", kind: "mixed", params: "file", sections: ["party","sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "playerdirection", kind: "mixed", params: "[h,]dir", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "playerspeed", kind: "mixed", params: "[h,]speed", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "playerstance", kind: "mixed", params: "slot[,h]", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "characterspeed", kind: "mixed", params: "speed", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "walkspeed", kind: "mixed", params: "fast/slow", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "createitem", kind: "mixed", params: "file[,mem]", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "itemdirection", kind: "mixed", params: "[h,]dir", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "itemspeed", kind: "mixed", params: "[h,]speed", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "itemstance", kind: "mixed", params: "slot[,h]", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "push", kind: "mixed", params: "dirs[,h[,flags]]", sections: ["sprites"], wait: "movement", obsolete: false, byRefOut: false },
  { name: "pushitem", kind: "mixed", params: "itemnum,dirs", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "playerstep", kind: "mixed", params: "h,x,y[,flags]", sections: ["sprites"], wait: "movement", obsolete: false, byRefOut: false },
  { name: "itemstep", kind: "mixed", params: "itemnum,x,y[,flags]", sections: ["sprites"], wait: "movement", obsolete: false, byRefOut: false },
  { name: "playerpath", kind: "mixed", params: "h,flags,\u2026", sections: ["sprites"], wait: "movement", obsolete: false, byRefOut: false },
  { name: "itempath", kind: "mixed", params: "h,flags,\u2026", sections: ["sprites"], wait: "movement", obsolete: false, byRefOut: false },
  { name: "smartstep", kind: "mixed", params: "...", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "stance", kind: "mixed", params: "slot,handle", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "posture", kind: "mixed", params: "slot,handle", sections: ["sprites"], wait: null, obsolete: false, byRefOut: false },
  { name: "inn", kind: "mixed", params: "", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "equip", kind: "mixed", params: "h,slot,item", sections: ["inventory","vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "remove", kind: "mixed", params: "h,slot", sections: ["inventory","vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "getitemname", kind: "mixed", params: "item,&dest", sections: [], wait: null, obsolete: false, byRefOut: true },
  { name: "getitemdesc", kind: "mixed", params: "item,&dest", sections: [], wait: null, obsolete: false, byRefOut: true },
  { name: "getitemcost", kind: "mixed", params: "item,&dest", sections: [], wait: null, obsolete: false, byRefOut: true },
  { name: "getitemsellprice", kind: "mixed", params: "item,&dest", sections: [], wait: null, obsolete: false, byRefOut: true },
  { name: "callshop", kind: "wait", params: "item1,\u2026", sections: ["menu"], wait: "menu.screen", obsolete: false, byRefOut: false },
  { name: "fight", kind: "mixed", params: "skill,bkg", sections: ["battle","engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "fightenemy", kind: "mixed", params: "e1,\u2026,bkg", sections: ["battle","engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "fightmenugraphic", kind: "mixed", params: "file", sections: ["ui","battle"], wait: null, obsolete: false, byRefOut: false },
  { name: "menugraphic", kind: "mixed", params: "file", sections: ["ui"], wait: null, obsolete: false, byRefOut: false },
  { name: "mediaplay", kind: "mixed", params: "file", sections: ["audio"], wait: null, obsolete: false, byRefOut: false },
  { name: "wav", kind: "mixed", params: "file", sections: ["audio"], wait: null, obsolete: false, byRefOut: false },
  { name: "sound", kind: "mixed", params: "", sections: [], wait: null, obsolete: true, byRefOut: false },
  { name: "mp3pause", kind: "mixed", params: "file", sections: ["audio"], wait: "audio.track", obsolete: false, byRefOut: false },
  { name: "playavi", kind: "mixed", params: "file", sections: ["engine"], wait: "video", obsolete: false, byRefOut: false },
  { name: "playavismall", kind: "mixed", params: "file", sections: ["engine"], wait: "video", obsolete: false, byRefOut: false },
  { name: "midiplay", kind: "mixed", params: "file", sections: ["audio"], wait: null, obsolete: false, byRefOut: false },
  { name: "playmidi", kind: "mixed", params: "file", sections: ["audio"], wait: null, obsolete: false, byRefOut: false },
  { name: "mp3", kind: "mixed", params: "file", sections: ["audio"], wait: null, obsolete: false, byRefOut: false },
  { name: "animation", kind: "mixed", params: "file,x,y[,persist]", sections: ["fx"], wait: null, obsolete: false, byRefOut: false },
  { name: "sizedanimation", kind: "mixed", params: "file,x,y,xs,ys[,persist]", sections: ["fx"], wait: null, obsolete: false, byRefOut: false },
  { name: "run", kind: "spawn-thread", params: "prg", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "change", kind: "flow-control", params: "prg", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "rpgcode", kind: "flow-control", params: "line", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "delay", kind: "wait", params: "sec", sections: ["vm"], wait: "sleep", obsolete: false, byRefOut: false },
  { name: "done", kind: "flow-control", params: "", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "stop", kind: "flow-control", params: "", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "branch", kind: "flow-control", params: ":label", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "fbranch", kind: "flow-control", params: ":label", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "autocommand", kind: "flow-control", params: "...", sections: ["vm"], wait: null, obsolete: false, byRefOut: false },
  { name: "save", kind: "mixed", params: "file", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "load", kind: "mixed", params: "file", sections: ["world","sprites","party","inventory","triggers","vm","battle","menu","ui","camera","fx","audio","surfaces","rng","time"], wait: null, obsolete: false, byRefOut: false },
  { name: "dirsav", kind: "mixed", params: "...", sections: ["menu"], wait: "menu.screen", obsolete: false, byRefOut: false },
  { name: "reset", kind: "flow-control", params: "", sections: ["engine","world","sprites","party","inventory","triggers","vm","battle","menu","ui","camera","fx","audio","surfaces","input"], wait: null, obsolete: false, byRefOut: false },
  { name: "start", kind: "flow-control", params: "file", sections: [], wait: null, obsolete: true, byRefOut: false },
  { name: "mainfile", kind: "flow-control", params: "gam", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "win", kind: "flow-control", params: "", sections: ["engine"], wait: null, obsolete: true, byRefOut: false },
  { name: "gone", kind: "flow-control", params: "", sections: ["triggers"], wait: null, obsolete: false, byRefOut: false },
  { name: "over", kind: "flow-control", params: "", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "godos", kind: "flow-control", params: "command", sections: [], wait: null, obsolete: true, byRefOut: false },
  { name: "dos", kind: "flow-control", params: "", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "windows", kind: "flow-control", params: "", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "quitgame", kind: "flow-control", params: "", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "openfileinput", kind: "request", params: "file,folder", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "openfileoutput", kind: "request", params: "file,folder", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "openfileappend", kind: "request", params: "file,folder", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "openfilebinary", kind: "request", params: "file,folder", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "fileinput", kind: "mixed", params: "handle,&line", sections: [], wait: null, obsolete: false, byRefOut: true },
  { name: "fileprint", kind: "mixed", params: "handle,text", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
  { name: "fileget", kind: "mixed", params: "handle,&byte", sections: [], wait: null, obsolete: false, byRefOut: true },
  { name: "fileput", kind: "mixed", params: "handle,byte", sections: ["engine"], wait: null, obsolete: false, byRefOut: false },
];

const PARAM_NAMES: Readonly<Record<string, string>> = { "%": "percent", "0/1": "flag", "on/off": "state" };

function params(notation: string, byRefOut: boolean): ParamSpec[] {
  const text = notation.trim();
  if (text === "" || text === "—") return [];
  if (text === "...") return [{ name: "args", optional: true, byRef: false, variadic: true }];
  const result: ParamSpec[] = [];
  let depth = 0;
  let token = "";
  const flush = (): void => {
    const raw = token.trim();
    token = "";
    if (raw === "") return;
    const byRef = raw.startsWith("&");
    const bare = byRef ? raw.slice(1) : raw;
    if (bare === "..." || bare === "…") {
      result.push({ name: "args", optional: true, byRef: false, variadic: true });
      return;
    }
    result.push({ name: PARAM_NAMES[bare] ?? bare, optional: depth > 0, byRef, variadic: false });
  };
  for (const ch of text) {
    if (ch === ",") flush();
    else if (ch === "[") { flush(); depth += 1; }
    else if (ch === "]") { flush(); depth -= 1; }
    else token += ch;
  }
  flush();
  if (byRefOut && result.length > 0 && !result.some((param) => param.variadic)) {
    const last = result.length - 1;
    if (!result[last]!.byRef) result[last] = { ...result[last]!, byRef: true };
  }
  return result;
}

function values(args: readonly { readonly value: unknown }[]): PlainData[] {
  return args.map((arg) => arg.value as PlainData);
}

function makeWait(row: Row, args: readonly { readonly value: unknown; readonly ref: string | null }[], tick: number): Wait {
  const refs = args.filter((arg) => arg.ref !== null).map((arg) => arg.ref!);
  if (row.wait === "sleep") {
    const seconds = toNumberValue(args[0]?.value as never ?? 0);
    const ticks = secondsToTicks(seconds);
    if (ticks === null || ticks < 1 || tick + ticks > MAX_TICK) throw new ScriptError("builtin.bad-arg", `"${row.name}": ${seconds} is not a valid duration`);
    return { kind: "sleep", global: true, until: tick + ticks, resumesCall: true };
  }
  if (row.wait === "movement") return { kind: "movement", global: true, moves: [{ sprite: "script", until: tick + 1 }] };
  if (row.wait === "input.key") return { kind: "input.key", global: true, key: null, resumeRefs: refs };
  return { kind: row.wait as NamedWaitKind, global: true, id: row.name, payload: values(args), resumeRefs: refs };
}

function controlFor(row: Row, args: readonly { readonly value: unknown }[], thread: number | undefined): CommandEffect | null {
  if (row.name === "run") return { kind: "vm.control", args: ["run", { kind: "inline", text: toStringValue(args[0]?.value as never ?? ""), ir: IR_VERSION }] };
  if (row.name === "rpgcode" && thread !== undefined) return { kind: "vm.control", args: ["threadTell", thread, toStringValue(args[0]?.value as never ?? "")] };
  if (row.name === "branch" || row.name === "fbranch") return { kind: "vm.control", args: ["jump", toStringValue(args[0]?.value as never ?? "")] };
  if (row.name === "end" || row.name === "done" || row.name === "stop") return { kind: "vm.control", args: ["end"] };
  return null;
}

function makeResponder(row: Row): BuiltinSpec {
  const declared = params(row.params, row.byRefOut);
  return {
    name: row.name,
    aliases: [],
    params: declared,
    ...(row.name === "sound" ? {
      doc: {
        summary: "Obsolete.",
        behaviour: "Raises builtin.obsolete and skips the statement without producing an audio cue.",
        groups: ["audio-23"],
        see: ["docs/spec/engine/audio-media.md#legacy-audio-command-mapping"],
        tags: ["obsolete"],
        replacedBy: { kind: "syntax", text: "No supported replacement; the statement is skipped." },
        reason: "Toolkit 3.1's sound command has no supported Reawakened behavior.",
      },
    } : {}),
    call: (view, args) => {
      if (row.obsolete) throw new ScriptError("builtin.obsolete", `"${row.name}" is obsolete: the statement is skipped`);
      const out: (readonly [number, number])[] = [];
      for (let i = 0; i < declared.length; i += 1) if (declared[i]?.byRef && i < args.length) out.push([i, 0]);
      const effects: CommandEffect[] = row.sections.map((section) => ({ kind: row.kind, section }));
      if (effects.length === 0 && row.wait === null && row.kind !== "request") effects.push({ kind: row.kind });
      const control = controlFor(row, args, view.thread);
      if (control !== null) effects.push(control);
      const result: { value: null; out: readonly (readonly [number, number])[]; effects: readonly CommandEffect[]; wait?: Wait; request?: { kind: string; area: string; path: string; folder: string } } = { value: null, out, effects };
      if (row.wait !== null) result.wait = makeWait(row, args, view.clock.tick());
      if (row.kind === "request") result.request = { kind: "asset", area: "files", path: toStringValue(args[0]?.value as never ?? ""), folder: toStringValue(args[1]?.value as never ?? "") };
      return result;
    },
  };
}


export const CATALOGUE_RESPONDERS_PLUGIN: PluginDefinition = {
  id: "catalogue-responders",
  version: "1.0.0",
  commands: documentCommands(ROWS.map(makeResponder)),
};

function fallbackDocumentation(command: BuiltinSpec): BuiltinSpec {
  const { doc: _doc, ...withoutDoc } = command;
  if (command.name === "camerapanto" || command.name === "camerafollow" || command.name === "camerareset" || command.name === "camerashake") {
    return { ...withoutDoc, doc: { summary: `${command.name} applies a deterministic camera effect.`, behaviour: "Records the camera effect immediately and does not wait.", groups: [] } };
  }
  if (command.name === "text") {
    return { ...withoutDoc, doc: { summary: "Displays text on the screen.", behaviour: "Draws text using the fixed logical cell size and does not wait.", groups: ["message-window-text-fonts-30"] } };
  }
  if (command.name === "fade") {
    return { ...withoutDoc, doc: { summary: "Perform a fade using the current colour. There are several different types of fades.", behaviour: "Records the selected deterministic fade effect and does not wait.", groups: ["board-tiles-vectors-screen-effects-33"] } };
  }
  return withoutDoc;
}

const PACK_CATALOGUE_FALLBACKS: readonly BuiltinSpec[] = [
  effectCommand("camerapanto", "camera"),
  effectCommand("camerafollow", "camera"),
  effectCommand("camerareset", "camera"),
  effectCommand("camerashake", "fx", "draw-audio-cue"),
  effectCommand("text", "ui"),
  effectCommand("msgbox", "ui", "mixed"),
  effectCommand("fade", "fx", "draw-audio-cue"),
].map(fallbackDocumentation);

/** Every command of the render owner pack (UI, effects, surfaces, animation) that the catalogue layer does not already supply. */
const RENDER_PACK_FALLBACKS: readonly BuiltinSpec[] = RENDER_PLUGIN.commands.filter(
  (command) => !PACK_CATALOGUE_FALLBACKS.some((fallback) => fallback.name === command.name),
);

/** File commands are implemented by CORE_PLUGIN's sandboxed pack (ticket 3.16). */

const MEDIA_PACK_NAMES: Record<string, true> = {
  mediaplay: true, midiplay: true, playmidi: true,
  mediastop: true, mediarest: true, midirest: true,
  wav: true, mp3: true, wavstop: true, mp3pause: true, setvolume: true,
  playavi: true, playavismall: true,
};
const CATALOGUE_GRAPHICS_NAMES = new Set(GRAPHICS_COMMANDS.flatMap((command) => [command.name, ...command.aliases]));
const CATALOGUE_OWNED_NAMES = new Set([
  ...CATALOGUE_STUBS_PLUGIN.commands.map((command) => command.name).filter((name) => !CATALOGUE_GRAPHICS_NAMES.has(name)),
  ...CATALOGUE_RESPONDERS_PLUGIN.commands.map((command) => command.name).filter((name) => !CATALOGUE_GRAPHICS_NAMES.has(name)),
  ...INVENTORY_COMMAND_NAMES,
  ...BATTLE_COMMAND_NAMES,
]);
const CORE_FILE_COMMANDS = new Set(["save", "load", "openfileinput", "openfileoutput", "openfileappend", "openfilebinary", "fileinput", "fileprint", "fileget", "fileput"]);
const MOVEMENT_PACK_NAMES: Record<string, true> = {
  push: true, pushitem: true, playerstep: true, itemstep: true, playerpath: true, itempath: true,
  playerlocation: true, itemlocation: true, playergetpath: true, itemgetpath: true, activeplayer: true,
  removeplayer: true, destroyplayer: true,
  addplayer: true, restoreplayer: true,
  newplyr: true, newplayer: true,
  playerdirection: true, itemdirection: true, playerspeed: true, itemspeed: true, playerstance: true,
  itemstance: true, wander: true, wait: true, get: true, clearbuffer: true, setbutton: true,
  checkbutton: true, clearbuttons: true, mousemove: true, mouseclick: true,
};
const CORE_PURE_COMMANDS = new Set(PURE_SPECS.flatMap((command) => [command.name, ...command.aliases]));
/** The default catalogue layer combines safe stubs and responders not owned by CORE_PLUGIN. */
export const CATALOGUE_PLUGIN: PluginDefinition = {
  id: "catalogue",
  version: "1.0.0",
  commands: [
    ...documentCommands(CATALOGUE_STUBS_PLUGIN.commands.filter((command) => command.name !== "internalmenu" && MOVEMENT_PACK_NAMES[command.name] !== true && !CATALOGUE_GRAPHICS_NAMES.has(command.name) && MEDIA_PACK_NAMES[command.name] !== true && !BATTLE_COMMAND_NAMES.has(command.name) && !INVENTORY_COMMAND_NAMES.has(command.name))),
    ...CATALOGUE_RESPONDERS_PLUGIN.commands.filter(
      (command) => MOVEMENT_PACK_NAMES[command.name] !== true && !CATALOGUE_GRAPHICS_NAMES.has(command.name) && MEDIA_PACK_NAMES[command.name] !== true && !BATTLE_COMMAND_NAMES.has(command.name) && !CORE_FILE_COMMANDS.has(command.name) && !CORE_PURE_COMMANDS.has(command.name) && !INVENTORY_COMMAND_NAMES.has(command.name),
    ),
    ...INVENTORY_COMMANDS,
    ...MENU_COMMANDS,
    ...PACK_CATALOGUE_FALLBACKS.filter((command) => !CATALOGUE_OWNED_NAMES.has(command.name)),
    ...documentCommands(RENDER_PACK_FALLBACKS.filter((command) => !CATALOGUE_OWNED_NAMES.has(command.name))),
  ],
};

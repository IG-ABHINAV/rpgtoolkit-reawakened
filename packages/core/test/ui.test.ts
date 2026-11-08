import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import {
  applyUiEffect,
  assetKey,
  colourSurface,
  composeUi,
  composeUiMargins,
  uiAccessibilityTree,
  createGameState,
  createScriptServices,
  createSurfacesSection,
  hashGameState,
  pollInputKey,
  pollRenderMsgBox,
  restoreGameState,
  snapshot,
  UI_COMMANDS,
  UI_PLUGIN,
  type Arg,
  type Wait,
} from "../src/index.ts";
import { resetUiForProgramStart } from "../src/save/sections/ui.ts";
import { killSurface } from "../src/raster/surfaces.ts";
import { pollMenuScreen } from "../src/script/waits.ts";
import type { DrawCommand } from "../src/ports/draw.ts";

function textAdvance(cmd: DrawCommand, index: number): number | undefined {
  return cmd.kind === "text" ? cmd.advances[index]?.advance : undefined;
}

function arg(value: Arg["value"], ref: string | null = null): Arg {
  return { value, ref: ref as never };
}

function command(name: string, state: ReturnType<typeof createGameState>, args: readonly Arg[]) {
  const services = createScriptServices(state, [{ definition: UI_PLUGIN }]);
  const spec = services.commands.get(name)?.spec;
  if (spec === undefined) throw new Error(`missing ${name}`);
  return spec.call(services.view, args, () => ({ value: null }));
}

function firstEffect(result: ReturnType<typeof command>): NonNullable<NonNullable<ReturnType<typeof command>["effects"]>[number]> {
  const effect = result.effects?.[0];
  if (effect === undefined) throw new Error("command emitted no effect");
  return effect;
}

test("UI pack exposes message, cursor-map, accessibility surface and touch declaration commands", () => {
  equal(UI_COMMANDS.length, 42);
  equal(new Set(UI_COMMANDS.map((entry) => entry.name)).size, 42);
  equal(UI_COMMANDS.every((entry) => (entry.doc?.summary.length ?? 0) > 0 && (entry.doc?.behaviour.length ?? 0) > 0), true);
});
test("dialogue UI effect uses the message window and appends text", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "dialogue", ["Hello Ada"]);
  equal(state.ui.message.visible, true);
  equal(state.ui.message.text, "Hello Ada");
  applyUiEffect(state, "dialogue", ["How are you?"]);
  equal(state.ui.message.text, "Hello Ada\nHow are you?");
});

test("dialogue without a live source actor raises its catchable error", () => {
  const state = createGameState({ seed: 0 });
  let code = "";
  try {
    command("dialogue", state, [arg("Hello")]);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") code = error.code;
  }
  equal(code, "dialogue.no-source");
});

test("message-window effects splice globals and use deterministic defaults", () => {
  const state = createGameState({ seed: 0 });
  state.vm.globals.name = "Ada";
  const effect = firstEffect(command("mwin", state, [arg("Hello <name>")]));
  applyUiEffect(state, "mwin", effect.args ?? []);
  equal(state.ui.message.visible, true);
  equal(state.ui.message.text, "Hello Ada");
  deepEqual(state.ui.message.background, { r: 0, g: 0, b: 0 });
  equal(state.ui.message.translucency, 50);
  equal(composeUi(state.ui, 800, 600).some((entry) => entry.kind === "rect"), true);
});
test("custom touch suppression requires an explicit persistent declaration", () => {
  const state = createGameState({ seed: 0 });
  const initialHash = hashGameState(state);
  applyUiEffect(state, "mwincls", []);
  equal(state.ui.customTouchControlsDeclared, false);
  applyUiEffect(state, "declareCustomTouchControls", []);
  equal(state.ui.customTouchControlsDeclared, true);
  equal(hashGameState(state) === initialHash, false);
  resetUiForProgramStart(state.ui, (id) => killSurface(state.surfaces, id));
  equal(state.ui.customTouchControlsDeclared, true);
  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  equal(restored.ui.customTouchControlsDeclared, true);
  equal(hashGameState(restored), hashGameState(state));

  const legacy = JSON.parse(saved) as { schema: { ui: number }; ui: Record<string, unknown> };
  legacy.schema.ui = 2;
  delete legacy.ui.surfaceCancelledSeq;
  delete legacy.ui.surfaceCancelledOwner;
  const migrated = restoreGameState(JSON.stringify(legacy));
  equal(migrated.ui.surfaceCancelledSeq, null);
  equal(migrated.ui.surfaceCancelledOwner, null);
});
test("pending author UI results are hash-significant, snapshot-migrated, and reset with their UI lifecycle", () => {
  const state = createGameState({ seed: 0 });
  state.ui.surfaceActivated = {
    owner: 7, surfaceId: "title", itemId: "play", index: 0, action: null, inputSeq: 41, cancelled: false,
  };
  state.ui.surfaceResultsPending = true;
  const pendingHash = hashGameState(state);
  state.ui.surfaceResultsPending = false;
  equal(hashGameState(state) === pendingHash, false, "the lifecycle marker participates in the canonical state hash");
  state.ui.surfaceResultsPending = true;

  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  equal(restored.ui.surfaceResultsPending, true, "snapshot restore preserves the pending one-shot lifecycle");
  equal(hashGameState(restored), hashGameState(state));

  const legacy = JSON.parse(saved) as { schema: { ui: number }; ui: Record<string, unknown> };
  legacy.schema.ui = 7;
  delete legacy.ui.surfaceResultsPending;
  equal(restoreGameState(JSON.stringify(legacy)).ui.surfaceResultsPending, false, "v7 snapshots migrate without a phantom pending result");

  resetUiForProgramStart(state.ui, (id) => killSurface(state.surfaces, id));
  equal(state.ui.surfaceResultsPending, false, "starting a new program clears the previous surface's lifecycle marker");
});

test("legacy UI save migration preserves surface lifetime metadata and defaults Plane 3 commands", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "mwincls", []);
  state.time.tick = 7;
  applyUiEffect(state, "uiBegin", [7, "title", "menu", 0, 0, 16, 16, 1]);
  applyUiEffect(state, "uiItem", [7, "Play", "play", null, 1, null, null, null, 1]);
  applyUiEffect(state, "uiEnd", [7]);
  applyUiEffect(state, "uiBegin", [8, "builder", "surface", 0, 0, 16, 16, 1]);
  const old = JSON.parse(snapshot(state)) as {
    schema: { ui: number };
    ui: { authorMarginCommands?: unknown; actionSurfaces: Record<string, unknown>[]; surfaceBuilders: Record<string, unknown>[] };
  };
  old.schema.ui = 4;
  delete old.ui.authorMarginCommands;
  delete old.ui.actionSurfaces[0]?.publishedTick;
  delete old.ui.surfaceBuilders[0]?.openedTick;
  Object.assign(old.ui, { surfacePointerClaim: { surfaceId: "title", owner: 7, itemId: "play", index: 0, action: null, inputSeq: null } });
  const migrated = restoreGameState(JSON.stringify(old));
  equal(migrated.ui.actionSurfaces[0]?.publishedTick, 7);
  equal(migrated.ui.surfaceBuilders[0]?.openedTick, 7);
  equal(migrated.ui.surfacePointerClaim?.cancelled, false);
  deepEqual(migrated.ui.authorMarginCommands, []);
});

test("author surface claims consume their shared input sequence once", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "mwincls", []);
  state.ui.surfaceActivated = { owner: 7, surfaceId: "title", itemId: "play", index: 0, action: null, inputSeq: 41, cancelled: false, };
  applyUiEffect(state, "uiActivated", [7]);
  deepEqual(state.engine.claims, [41]);
  equal(state.ui.surfaceActivated, null);

  state.ui.surfaceCancelled = true;
  state.ui.surfaceCancelledSeq = 42;
  state.ui.surfaceCancelledOwner = 7;
  applyUiEffect(state, "uiCancelled", [8]);
  deepEqual(state.engine.claims, [41]);
  equal(state.ui.surfaceCancelled, true);
  applyUiEffect(state, "uiCancelled", [7]);
  deepEqual(state.engine.claims, [41, 42]);
  equal(state.ui.surfaceCancelled, false);
  equal(state.ui.surfaceCancelledSeq, null);
  equal(state.ui.surfaceCancelledOwner, null);
});

test("author text crossing Plane 1 is emitted in the margin command layer", () => {
  const outside = createGameState({ seed: 0 });
  applyUiEffect(outside, "pixeltext", [-4, 4, "Go", 0]);
  ok(composeUiMargins(outside.ui, 32, 32).some((command) => command.kind === "text"));

  const inside = createGameState({ seed: 0 });
  applyUiEffect(inside, "pixeltext", [4, 4, "Go", 0]);
  equal(composeUiMargins(inside.ui, 32, 32).length, 0);
});

test("author UI effects publish one ordered navigation surface and accessibility subtree", () => {
  const state = createGameState({ seed: 0 });
  applyUiEffect(state, "uiBegin", [7, "title", "menu", 10, 20, 200, 120, 1]);
  applyUiEffect(state, "uiItem", [7, "Play", "play", null, 1, null, "confirm", null, 1]);
  applyUiEffect(state, "uiItem", [7, "Settings", "settings", "audio", 0, "button", null, null, 1]);
  applyUiEffect(state, "uiEnd", [7]);
  const surface = state.ui.actionSurfaces[0];
  ok(surface);
  equal(surface.selection, 0);
  deepEqual(surface.items.map(({ id, label, enabled, bounds }) => ({ id, label, enabled, bounds })), [
    { id: "play", label: "Play", enabled: true, bounds: { x: 10, y: 20, w: 200, h: 60 } },
    { id: "settings", label: "Settings", enabled: false, bounds: { x: 10, y: 80, w: 200, h: 60 } },
  ]);
  deepEqual(uiAccessibilityTree(state.ui), [{
    id: "surface:7:title",
    role: "menu",
    label: "title",
    value: null,
    state: { disabled: false, selected: false, checked: null },
    focused: false,
    bounds: { x: 10, y: 20, w: 200, h: 120 },
    children: [
      { id: "7:title:play", role: "menuitem", label: "Play", value: null, state: { disabled: false, selected: true, checked: null }, focused: true, bounds: { x: 10, y: 20, w: 200, h: 60 }, children: [] },
      { id: "7:title:settings", role: "button", label: "Settings", value: "audio", state: { disabled: true, selected: false, checked: null }, focused: false, bounds: { x: 10, y: 80, w: 200, h: 60 }, children: [] },
    ],
  }]);
  equal(composeUi(state.ui, 320, 240).some((entry) => entry.kind === "rect"), true);
});
test("malformed author surfaces report diagnostics without publishing a partial surface", () => {
  const state = createGameState({ seed: 0 });
  const reports: string[] = [];
  applyUiEffect(state, "uiBegin", [9, "broken", "menu", 0, 0, 0, 10, 0], undefined, (_owner, message) => reports.push(message));
  applyUiEffect(state, "uiEnd", [9], undefined, (_owner, message) => reports.push(message));
  deepEqual(reports, ["uiBegin rejected a malformed author surface"]);
  equal(state.ui.actionSurfaces.length, 0);
});


test("engine-backed message windows use the default translucent colour surface", () => {
  const state = createGameState({ seed: 0 });
  state.surfaces = createSurfacesSection();
  const expected = colourSurface(state.surfaces, { r: 0, g: 0, b: 0 });
  const effect = firstEffect(command("mwin", state, [arg("Hello")]));
  applyUiEffect(state, "mwin", effect.args ?? []);
  equal(state.ui.message.translucency, 50);
  equal(state.ui.backgroundSurface, expected);
  equal(composeUi(state.ui, 800, 600)[0]?.kind, "blit");
});

test("a winGraphic message window draws its image in the fixed window instead of the colour", () => {
  const state = createGameState({ seed: 0 });
  state.surfaces = createSurfacesSection();
  for (const [name, value] of [["wingraphic", "mwin.jpg"], ["mwin", "Your story goes here..."]] as const) {
    const effect = firstEffect(command(name, state, [arg(value)]));
    applyUiEffect(state, name, effect.args ?? []);
  }
  equal(state.ui.message.graphic, "mwin.jpg");
  const graphic = assetKey("bitmap/mwin.jpg");
  const commands = composeUi(state.ui, 640, 480, undefined, false, undefined, graphic);
  const blit = commands[0];
  equal(blit?.kind, "blit");
  if (blit?.kind !== "blit") return;
  deepEqual(blit.source, { asset: graphic, tile: null });
  deepEqual(blit.src, { x: 0, y: 0, w: 600, h: 100 });
  deepEqual(blit.dst, { x: 20, y: 0, w: 600, h: 100 });
  equal(blit.alpha, 128);
  equal(blit.blend, "translucent");
  equal(blit.key, null);
  // The text still follows the image, and the colour surface is not drawn under it.
  equal(commands[1]?.kind, "text");
  equal(commands.some((entry) => entry.kind === "blit" && "surface" in entry.source), false);
});

test("a narrow window clips the image with it", () => {
  const state = createGameState({ seed: 0 });
  const effect = firstEffect(command("wingraphic", state, [arg("mwin.jpg")]));
  applyUiEffect(state, "winGraphic", effect.args ?? []);
  const effectMwin = firstEffect(command("mwin", state, [arg("Hello")]));
  applyUiEffect(state, "mwin", effectMwin.args ?? []);
  const blit = composeUi(state.ui, 400, 300, undefined, false, undefined, assetKey("bitmap/mwin.jpg"))[0];
  equal(blit?.kind, "blit");
  if (blit?.kind !== "blit") return;
  deepEqual(blit.src, { x: 100, y: 0, w: 400, h: 100 });
  deepEqual(blit.dst, { x: 0, y: 0, w: 400, h: 100 });
});

test("without a resolved key the message window keeps its colour background", () => {
  const state = createGameState({ seed: 0 });
  const effect = firstEffect(command("wingraphic", state, [arg("mwin.jpg")]));
  applyUiEffect(state, "winGraphic", effect.args ?? []);
  const effectMwin = firstEffect(command("mwin", state, [arg("Hello")]));
  applyUiEffect(state, "mwin", effectMwin.args ?? []);
  const commands = composeUi(state.ui, 640, 480);
  equal(commands[0]?.kind, "rect");
});

test("text and pixelText record draws and text metrics", () => {
  const state = createGameState({ seed: 0 });
  for (const [name, args] of [["text", [arg(2), arg(3), arg("A\\nB")]], ["pixeltext", [arg(10), arg(20), arg("C")]]] as const) {
    const effect = firstEffect(command(name, state, args));
    applyUiEffect(state, name, effect.args ?? []);
  }
  equal(state.ui.draws.length, 2);
  equal(state.ui.draws[0]?.x, 8);
  equal(state.ui.draws[0]?.y, 16);
  equal(state.ui.draws[0]?.cell, true);
  equal(state.ui.draws[1]?.x, 10);
  equal(state.ui.draws[1]?.cell, false);
  equal(command("gettextwidth", state, [arg("AB")]).value, 16);
});

test("cell text lays out multi-line strings with one cell row per line", () => {
  const state = createGameState({ seed: 0 });
  const effect = firstEffect(command("text", state, [arg(1), arg(1), arg("A\nB\nC")]));
  applyUiEffect(state, "text", effect.args ?? []);
  const commands = composeUi(state.ui, 800, 600).filter((entry) => entry.kind === "text");
  equal(commands.length, 3);
  equal(commands[0]?.x, 0);
  equal(commands[0]?.y, 0);
  equal(commands[1]?.x, 0);
  equal(commands[1]?.y, 8);
  equal(commands[2]?.x, 0);
  equal(commands[2]?.y, 16);
  // First glyph of the first line is the 8px-wide default bitmap cell.
  equal(textAdvance(commands[0]!, 0), 8);
});

test("prompt and msgBox waits resolve from modal state or unclaimed keys", () => {
  const state = createGameState({ seed: 0 });
  const prompt = command("prompt", state, [arg("Name?"), arg("", "answer")]);
  const promptEffect = firstEffect(prompt);
  applyUiEffect(state, "prompt", promptEffect.args ?? []);
  const promptWait = prompt.wait as Wait;
  equal(pollRenderMsgBox({ tick: 0, ui: state.ui as never, input: { keys: [], focused: true }, claims: [] }, promptWait), null);
  const typed = pollRenderMsgBox({ tick: 0, input: { keys: [{ seq: 3, name: "Enter", code: "Enter", char: "Ada" }], focused: true }, claims: [] }, promptWait);
  deepEqual(typed, { value: "Ada", ok: true, claim: 3 });

  const msg = command("msgbox", state, [arg("Continue?"), arg("Notice"), arg(1)]);
  const msgEffect = firstEffect(msg);
  applyUiEffect(state, "msgbox", msgEffect.args ?? []);
  const msgWait = msg.wait as Wait;
  equal(pollRenderMsgBox({ tick: 0, input: { keys: [{ seq: 4, name: "No", code: "KeyN", char: null }], focused: true }, claims: [] }, msgWait)?.value, 7);
});
test("menu.screen CallShop waits resolve only after active stock closes", () => {
  const wait: Wait = { kind: "menu.screen", global: true, id: "callshop", payload: [], resumeRefs: [] };
  equal(pollMenuScreen({ tick: 0, shopStock: ["item/potion.itm"] }, wait), null);
  deepEqual(pollMenuScreen({ tick: 1, shopStock: [] }, wait), { value: null, ok: true });
});

test("cursor maps navigate with wrapping, select by keyboard, and ignore mouse and Escape", () => {
  const state = createGameState({ seed: 0 });
  const created = command("createcursormap", state, [arg(0, "map")]);
  equal(created.value, 1);
  applyUiEffect(state, "createcursormap", firstEffect(created).args ?? []);
  applyUiEffect(state, "cursormapadd", [10, 20, 1]);
  applyUiEffect(state, "cursormapadd", [50, 60, 1]);
  const run = command("cursormaprun", state, [arg(1)]);
  applyUiEffect(state, "cursormaprun", firstEffect(run).args ?? []);
  const pointerCursor = command("mousecursor", state, [arg("TK DEFAULT"), arg(0), arg(0), arg(255), arg(0), arg(255)]);
  applyUiEffect(state, "mousecursor", firstEffect(pointerCursor).args ?? []);
  state.input.pointer = { ...state.input.pointer, x: 12, y: 14, buttons: 0 };
  const wait = run.wait as Wait;
  equal(wait.kind, "input.key");
  if (wait.kind !== "input.key") throw new Error("expected cursor map input wait");
  equal(wait.cursorSelection, 0, "selection starts at the first point");

  const initialCommands = composeUi(state.ui, 100, 100, state.input, true, wait.cursorSelection);
  const initial = initialCommands.at(-1);
  ok(initialCommands.some((entry) => entry.kind === "blit" && "asset" in entry.source && entry.source.asset === "media/cursors/tkr-arrow.png"), "configured mouse cursor remains visible");
  ok(initialCommands.some((entry) => entry.kind === "blit" && "asset" in entry.source && entry.source.asset === "media/cursors/tkr-hand.png"), "configured mouse cursor does not suppress the active map hand");
  equal(initial?.kind, "blit");
  if (initial?.kind === "blit") {
    equal(initial.dst.x, -30);
    equal(initial.dst.y, 10);
  }
  const mouse = pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [], pointer: { x: 50, y: 60, buttons: 1 }, focused: true },
    claims: [],
  }, wait);
  equal(mouse, null, "mouse presses do not choose cursor-map points");
  equal(wait.cursorSelection, 0);
  const escape = pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [{ seq: 1, name: "Escape", code: "Escape", char: null }], focused: true },
    claims: [],
  }, wait);
  equal(escape, null, "Escape does not cancel the runner");
  const numberKey = pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [{ seq: 2, name: "1", code: "Digit1", char: "1" }], focused: true },
    claims: [],
  }, wait);
  equal(numberKey, null, "numeric keys do not choose a cursor-map point");
  equal(wait.cursorSelection, 0, "numeric keys do not change the selected point");

  for (const [seq, name, selected] of [[2, "Left", 1], [3, "Right", 0], [4, "Right", 1]] as const) {
    const navigation = pollInputKey({
      tick: 0,
      ui: state.ui as never,
      input: { keys: [{ seq, name, code: `Arrow${name}`, char: null }], focused: true },
      claims: [],
    }, wait);
    equal(navigation?.keepWaiting, true, "navigation claims its input but leaves the cursor-map wait pending");
    equal(navigation?.claim, seq, "the exact queued key sequence is claimed");
    equal(wait.cursorSelection, selected);
  }
  const navigated = composeUi(state.ui, 100, 100, undefined, true, wait.cursorSelection).at(-1);
  equal(navigated?.kind, "blit");
  if (navigated?.kind === "blit") {
    equal(navigated.dst.x, 10);
    equal(navigated.dst.y, 50);
  }
  const enter = pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [{ seq: 5, name: "Enter", code: "Enter", char: null }], focused: true },
    claims: [],
  }, wait);
  deepEqual(enter, { value: 1, ok: true, claim: 5 });
  const space = pollInputKey({
    tick: 0,
    ui: state.ui as never,
    input: { keys: [{ seq: 6, name: "Space", code: "Space", char: null }], focused: true },
    claims: [],
  }, wait);
  deepEqual(space, { value: 1, ok: true, claim: 6 });
});

test("mouseCursor restores the bundled arrow and button slots stay in the overlay", () => {
  const state = createGameState({ seed: 0 });
  const cursor = command("mousecursor", state, [arg("TK DEFAULT"), arg(0), arg(0), arg(255), arg(0), arg(255)]);
  applyUiEffect(state, "mousecursor", firstEffect(cursor).args ?? []);
  state.input.pointer = { ...state.input.pointer, x: 12, y: 14, buttons: 0 };
  state.input.buttons = [{ slot: 1, asset: "button.png", x: 2, y: 3, width: 10, height: 11 }];
  const commands = composeUi(state.ui, 100, 100, state.input);
  const arrow = commands.at(-1);
  equal(arrow?.kind, "blit");
  if (arrow?.kind === "blit" && "asset" in arrow.source) equal(arrow.source.asset, "media/cursors/tkr-arrow.png");
  equal(commands.filter((entry) => entry.kind === "blit").length, 2);
});

// The stock menu screens end to end (E-80; docs/spec/engine/plugins-and-battle.md#e-80-stock-menu, #585).
//
// Each test boots a whole authored game with the real `stock_menu` package and drives it with key events, so the
// assertions are about what a player sees and what the owners hold: the menu stack, the overlay blit in the draw
// list, inventory state, the host requests a screen issues, and the cue a key posts to the `ui` track.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  hashGameState,
  utf8Decode,
  restoreGameState,
  snapshot,
  createEmptyItem,
  createEmptyMainFile,
  createEmptySpecialMove,
  createEngine,
  fnv1a64,
  hashDrawList,
  hashState,
  IR_VERSION,
  inputPhaseRegistration,
  PACKAGE_ROOT,
  startThread,
  writeBoard,
  writeCharacter,
  writeItem,
  writeMainFile,
  writeSpecialMove,
  type AssetIndex,
  type AssetKey,
  type Engine,
  type GameState,
  type InputEvent,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

type Files = Map<string, Uint8Array>;
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const STOCK_MENU = (() => {
  const folder = join(repoRoot, "stock", "stock_menu");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  return { manifest, source: readFileSync(join(folder, manifest.program), "utf8") };
})();

function catalogue(): readonly PackageCatalogueEntry[] {
  const { manifest, source } = STOCK_MENU;
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: source, ir: IR_VERSION, dialect: "tk3" },
  }];
}

/** The engine's bundled `media/` files: the default bitmap font and the bundled TrueType faces. */
function bundledFiles(): Map<AssetKey, Uint8Array> {
  const bundled = new Map<AssetKey, Uint8Array>();
  for (const name of readdirSync(join(repoRoot, "media", "fonts"))) {
    bundled.set(assetKey(`media/fonts/${name}`), new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", name))));
  }
  for (const name of readdirSync(join(repoRoot, "media", "cursors"))) {
    bundled.set(assetKey(`media/cursors/${name}`), new Uint8Array(readFileSync(join(repoRoot, "media", "cursors", name))));
  }
  return bundled;
}
const BUNDLED = bundledFiles();

function boardBytes(disableSaving: number): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 }, disableSaving },
  }));
}

/** A 16-bit mono PCM wave with `samples` silent frames: enough for the audio owner to compute a length. */
function waveBytes(samples = 256): Uint8Array {
  const data = samples * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) bytes[at + index] = text.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, data, true);
  return bytes;
}

type GameOptions = {
  readonly startup: string;
  readonly disableSaving?: number;
  readonly sounds?: boolean;
  /** The logical resolution; the stock menu derives every position from it (E-80 stock item 4). */
  readonly width?: number;
  readonly height?: number;
  /** `gear1.itm` … `gearN.itm`: extra equippable items, each fitting the head slot. */
  readonly gear?: number;
  /** `Move 1` … `Move N` in the hero's special-move slots (`mv1.spc` …), all usable from the menu. */
  readonly moves?: number;
  /** The names the host lists in the save area: `saved/slot1.sav` … `saved/slotN.sav` (default: one save and two decoys). */
  readonly saves?: number;
  /** `ally1.tem` … `allyN.tem`: extra characters a script can `addplayer`. */
  readonly allies?: number;
  /** The host keeps the bytes it is asked to save and lists, loads and overwrites them like a real save area. */
  readonly persist?: boolean;
  /**
   * `Item/amulet.itm` fits only the named-accessory slots (`equipSlots[7]`) and is named `Amulet`; this value is what
   * `hero.tem` wears in `accessory-7`, so passing `"Amulet"` fits and any other name does not.
   */
  readonly accessory?: string;
};

function authoredGame(options: GameOptions): { readonly files: Files; readonly index: AssetIndex; readonly main: string } {
  const files: Files = new Map();
  const paths = [
    "main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg",
    "Item/potion.itm", "Item/key.itm", "Item/sword.itm", "Bitmap/layout.png", "Bitmap/ghost.png", "Media/move.wav", "Media/confirm.wav", "Media/cancel.wav",
    "SpcMove/fire.spc", "Prg/fire.prg",
    ...Array.from({ length: options.allies ?? 0 }, (_, index) => `Chrs/ally${index + 1}.tem`),
    ...Array.from({ length: options.gear ?? 0 }, (_, index) => `Item/gear${index + 1}.itm`),
    ...(options.accessory !== undefined ? ["Item/amulet.itm"] : []),
    ...Array.from({ length: options.moves ?? 0 }, (_, index) => `SpcMove/mv${index + 1}.spc`),
  ];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePlugins: ["stock_menu"],
    ...(options.sounds === true ? { cursorMoveSound: "move.wav", cursorSelectSound: "confirm.wav", cursorCancelSound: "cancel.wav" } : {}),
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), boardBytes(options.disableSaving ?? 0));
  const emptyCharacter = createEmptyCharacter();
  const accessorySlots = [...emptyCharacter.accessorySlots];
  // `accessorySlots[1]` is the name `accessory-7` wears (docs/spec/engine/plugins-and-battle.md#e-82).
  if (options.accessory !== undefined) accessorySlots[1] = options.accessory;
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({
    ...emptyCharacter,
    minor: 5,
    name: "Hero",
    stats: { ...emptyCharacter.stats, hp: 10, maxHp: 20, level: 1 },
    bodySlots: [0, 1, 1, 1, 1, 1, 1],
    accessorySlots,
    profilePicture: "layout.png",
    hasSpecialMoves: 0,
    specialMoves: createEmptyCharacter().specialMoves.map((slot, index) => index === 0
      ? { ...slot, file: "fire.spc" }
      : index <= (options.moves ?? 0) ? { ...slot, file: `mv${index}.spc` } : slot),
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  })));
  for (let index = 1; index <= (options.allies ?? 0); index += 1) {
    files.set(assetKey(`chrs/ally${index}.tem`), unwrap(writeCharacter({
      ...createEmptyCharacter(), minor: 5, name: `Ally ${index}`, stats: { ...createEmptyCharacter().stats, hp: 8, maxHp: 8, level: 1 },
      bodySlots: [0, 1, 1, 1, 1, 1, 1], hasSpecialMoves: 0, movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""],
    })));
  }
  files.set(assetKey("item/potion.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Potion",
    description: "Restores 10 HP",
    menuUsable: 1,
    equipable: 1,
    equipSlots: [0, 1, 0, 0, 0, 0, 0, 0],
    menuUseHp: 10,
  })));
  files.set(assetKey("item/sword.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Iron sword",
    description: "Cuts things",
    equipable: 1,
    // Stored slot order: the hands are swapped, so index 4 is the canonical right hand (docs/spec: slotLocation).
    equipSlots: [0, 0, 0, 0, 1, 0, 0, 0],
  })));
  if (options.accessory !== undefined) files.set(assetKey("item/amulet.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Amulet",
    description: "",
    equipable: 1,
    // Index 7 is the one flag every named accessory shares; the name must match the member's `accessory-7` entry.
    equipSlots: [0, 0, 0, 0, 0, 0, 0, 1],
    accessoryName: "Amulet",
  })));
  files.set(assetKey("item/key.itm"), unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    name: "Brass key",
    description: "Opens the cellar",
    menuUsable: 1,
    keyItem: 1,
  })));
  files.set(assetKey("spcmove/fire.spc"), unwrap(writeSpecialMove({
    ...createEmptySpecialMove(), minor: 3, name: "Fire", description: "A spark", program: "fire.prg",
  })));
  for (let index = 1; index <= (options.gear ?? 0); index += 1) {
    files.set(assetKey(`item/gear${index}.itm`), unwrap(writeItem({
      ...createEmptyItem(), minor: 4, movementAnimations: Array(8).fill(""), name: `Gear ${index}`, description: "", equipable: 1, equipSlots: [0, 1, 0, 0, 0, 0, 0, 0],
    })));
  }
  for (let index = 1; index <= (options.moves ?? 0); index += 1) {
    files.set(assetKey(`spcmove/mv${index}.spc`), unwrap(writeSpecialMove({ ...createEmptySpecialMove(), minor: 3, name: `Move ${index}`, description: "", program: "" })));
  }
  files.set(assetKey("prg/fire.prg"), new TextEncoder().encode("abilityused = 1\n"));
  files.set(assetKey("bitmap/layout.png"), encodePng(1, 1, new Uint8Array([200, 40, 40, 255])));
  for (const name of ["move", "confirm", "cancel"]) files.set(assetKey(`media/${name}.wav`), waveBytes());
  files.set(assetKey("prg/start.prg"), new TextEncoder().encode("end()\n"));
  return { files, index: createAssetIndex(paths), main: "main.gam" };
}

type Session = {
  readonly engine: Engine;
  state(): GameState;
  /** Advance until `until` holds, answering every host request with the authored game's files. */
  pump(until: (state: GameState) => boolean, key?: string, limit?: number, initial?: InputRecord[]): GameState;
  readonly requests: string[];
  readonly loads: string[];
  readonly diagnostics: string[];
  readonly saves: string[];
  /** The save area a persistent host holds: path (`<GameId>/saved/slotK.sav`) to the bytes saved there. */
  readonly store: Map<string, Uint8Array>;
};

function boot(options: GameOptions): Session {
  const game = authoredGame(options);
  let latest: GameState | null = null;
  const requests: string[] = [];
  const saves: string[] = [];
  const loads: string[] = [];
  const diagnostics: string[] = [];
  const store = new Map<string, Uint8Array>();
  const engine = createEngine({
    seed: 7,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: "stock-menu-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: options.width ?? 320,
    height: options.height ?? 240,
    input: { bindings: { keys: { KeyM: "menu", Escape: "cancel", Enter: "confirm", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } } },
    maxTicks: 4000,
    packageCatalogue: catalogue(),
    bundled: BUNDLED,
    phaseRegistrations: [inputPhaseRegistration(), { phase: "audio", run: (state) => { latest = state; } }],
  });
  const state = (): GameState => {
    if (latest === null) throw new Error("the engine has not advanced");
    return latest;
  };
  function answer(request: { readonly kind: string; readonly reqId: number; readonly key?: string; readonly blob?: { readonly path: string }; readonly bytes?: Uint8Array }): InputEvent[] {
    requests.push(request.kind);
    if (request.kind === "asset") return [{ kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key as never) ?? null }];
    // A real host lists the names relative to the game's own folder, so `<GameId>/saved/slot1.sav` is `saved/slot1.sav`.
    if (request.kind === "listBlobs" && options.persist === true) {
      const names = new Set([...store.keys()].map((path) => path.slice(path.indexOf("/") + 1)));
      for (let index = 1; index <= (options.saves ?? 0); index += 1) names.add(`saved/slot${index}.sav`);
      return [{ kind: "blob.listed", reqId: request.reqId, names: [...names] }];
    }
    if (request.kind === "listBlobs") return [{ kind: "blob.listed", reqId: request.reqId, names: options.saves === undefined ? ["files/other.sav", "saved/not-a-save.txt", "saved/slot1.sav"] : Array.from({ length: options.saves }, (_, index) => `saved/slot${index + 1}.sav`) }];
    if (request.kind === "loadBlob") {
      loads.push(request.blob?.path ?? "");
      return [{ kind: "blob.loaded", reqId: request.reqId, bytes: options.persist === true ? store.get(request.blob?.path ?? "") ?? null : null }];
    }
    if (request.kind === "saveBlob") {
      saves.push(request.blob?.path ?? "");
      if (options.persist === true && request.bytes !== undefined) store.set(request.blob?.path ?? "", new Uint8Array(request.bytes));
      return [{ kind: "blob.saved", reqId: request.reqId, ok: true }];
    }
    return [];
  }
  function pump(until: (state: GameState) => boolean, key?: string, limit = 20, initial: InputRecord[] = []): GameState {
    let replies: InputRecord[] = [...initial];
    let queued = key;
    let keyEndTick: number | null = null;

    for (let step = 0; step < limit; step += 1) {
      if (queued !== undefined && latest !== null) {
        const tick = state().time.tick;
        const code = queued === "ENTER" ? "Enter" : queued === "ESC" ? "Escape" : queued === "UP" ? "ArrowUp" : queued === "DOWN" ? "ArrowDown" : queued === "LEFT" ? "ArrowLeft" : queued === "RIGHT" ? "ArrowRight" : queued === "M" ? "KeyM" : queued;
        replies.push(
          { tick, event: { kind: "key", name: queued, code, char: null, down: true } },
          { tick: tick + 1, event: { kind: "key", name: queued, code, char: null, down: false } },
        );
        keyEndTick = tick + 1;
        queued = undefined;
      }
      // A key needs its down tick, its up tick and one to be handled; an injected report needs its tick and one to be handled.
      const ticks = keyEndTick !== null && replies.some((record) => record.event.kind === "key") ? 3 : 2;
      const report = engine.advance(ticks, replies);
      diagnostics.push(...report.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`));
      replies = report.requests.flatMap((request) => answer(request as never).map((event) => ({ tick: report.tickAfter, event })));
      if (report.loading) continue;
      const ready = state().menu.screens.length === 0 || state().vm.threads.some((thread) => thread.status === "waiting" && (thread.wait?.kind === "input.key" || thread.wait?.kind === "render.msgbox"));
      if (queued === undefined && replies.length === 0 && ready && (keyEndTick === null || state().time.tick > keyEndTick) && until(state())) return state();
    }
    const current = latest;
    throw new Error(`the menu did not reach the expected state: screens=${JSON.stringify(current?.menu.screens ?? null)} threads=${(current?.vm.threads ?? []).map((thread) => `${thread.kind}:${thread.status}:${thread.wait?.kind ?? "-"}`).join(",")} requests=${requests.join(",")} diagnostics=${diagnostics.join("; ")}`);
  }
  const session = { engine, state, pump, requests, saves, loads, diagnostics, store };
  pump((current) => current.engine.boot?.stage === "running" && !current.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"));
  if (options.startup !== "end()\n") {
    startThread(state().vm, { ref: { kind: "inline", text: options.startup, ir: IR_VERSION }, kind: "blocking", owner: "script" });
  }
  return session;
}

/** Send one key on the next tick and let the screen handle it. */
function press(session: Session, key: string): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, key);
}

/** Deliver one pointer report on the next tick; a press and its release are two reports on two ticks, like a real host. */
function pointer(session: Session, x: number, y: number, buttons: number): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, undefined, 20, [{ tick, event: { kind: "pointer", x, y, buttons } }]);
}

/** Deliver one gamepad report (the action bitmask: up 1, down 2, left 4, right 8, confirm 16, cancel 32, menu 64). */
function pad(session: Session, buttons: number): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, undefined, 20, [{ tick, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons } }]);
}

/** A key script that gives one of each of `count` gear items, then opens `screen`. */
function giveGear(count: number, screen: string): string {
  return `${Array.from({ length: count }, (_, index) => `giveitem("gear${index + 1}")`).join("\n")}\n${screen}\n`;
}

/** The overlay blit the menu contributes to the draw list (E-80 §4). */
function overlayBlits(engine: Engine): number {
  return engine.drawList().commands.filter((command) => command.kind === "blit" && "surface" in command.source).length;
}

/**
 * What the screen's latest redraw drew, read from the script's own effect log: every `pixelText` string in order, and
 * every focus bar (a `fillRect` that starts at x = 16, below the panel fill), since the last panel fill `(8, 8, …)`.
 */
function drawn(session: Session): { readonly texts: string[]; readonly bars: string[] } {
  const effects = session.state().vm.effects;
  let start = 0;
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index]!;
    if (effect.name === "fillrect" && effect.args[0] === 8 && effect.args[1] === 8) { start = index; break; }
  }
  const redraw = effects.slice(start);
  return {
    texts: redraw.filter((effect) => effect.name === "pixeltext").map((effect) => String(effect.args[2])),
    bars: redraw.filter((effect) => effect.name === "fillrect" && effect.args[0] === 16).map((effect) => `${String(effect.args[1])}-${String(effect.args[3])}`),
  };
}

test("three separately delivered keys move the selection in order", () => {
  const session = boot({ startup: "mainmenu()\n" });
  equal(session.pump((state) => state.menu.screens.length === 1).menu.screens[0]!.selection, 0);
  equal(press(session, "DOWN").menu.screens[0]!.selection, 1);
  equal(press(session, "DOWN").menu.screens[0]!.selection, 2);
  equal(press(session, "UP").menu.screens[0]!.selection, 1);
});

test("the menu key opens the main screen and the menu key closes it", () => {
  const session = boot({ startup: "end()\n" });
  session.pump((state) => state.engine.boot?.stage === "running" && !state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"));
  const opened = session.pump((state) => state.menu.screens.length === 1, "M");
  equal(opened.menu.screens[0]!.screen, "main");
  ok(overlayBlits(session.engine) >= 1, "the screen is one overlay blit in the draw list");
  const closed = press(session, "ESC");
  equal(closed.menu.screens.length, 0, "cancel closes the outermost screen");
});

test("a direction pressed on the tick the menu key opens the menu queues no movement", () => {
  const session = boot({ startup: "end()\n" });
  const before = session.state().sprites.players[0]!;
  const tick = session.state().time.tick;
  session.engine.advance(1, [
    { tick, event: { kind: "key", name: "M", code: "KeyM", char: null, down: true } },
    { tick, event: { kind: "key", name: "ArrowRight", code: "ArrowRight", char: null, down: true } },
  ]);
  const after = session.state().sprites.players[0]!;
  ok(session.state().vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), "the menu key started the menu thread");
  deepEqual(after.queue.moves, [], "no step is queued behind the menu");
  equal(after.movement.active, null);
  deepEqual([after.x, after.y], [before.x, before.y]);
});

const HERO = "Hero  HP 10/20  SMP 0/0  Lv 1";
const GIVE = 'giveitem("potion")\ngiveitem("key")\n';
/** [the call, the screen it opens, everything its first redraw prints in order, the focus bar's y range]. */
const DIRECT_ENTRIES: readonly (readonly [string, string, readonly string[], string])[] = [
  ["mainmenu()", "main", ["Gold 0", "Time 0:00:00", HERO, "Items", "Equip", "Abilities", "Save", "Load", "Quit"], "85-108"],
  ["itemmenu()", "items", ["Items", "Potion", "x 1", "Brass key", "x 1"], "48-71"],
  ["equipmentmenu()", "equipment", ["Equip", "Hero"], "48-71"],
  ["abilitiesmenu()", "abilities", ["Abilities", "Hero"], "48-71"],
  ["internalmenu(0)", "main", ["Gold 0", "Time 0:00:00", HERO, "Items", "Equip", "Abilities", "Save", "Load", "Quit"], "85-108"],
  ["internalmenu(1)", "items", ["Items", "Potion", "x 1", "Brass key", "x 1"], "48-71"],
  ["internalmenu(2)", "equipment", ["Equip", "Hero"], "48-71"],
  ["internalmenu(4)", "abilities", ["Abilities", "Hero"], "48-71"],
];
for (const [call, expected, texts, bar] of DIRECT_ENTRIES) {
  test(`${call} opens ${expected} directly and draws its rows`, () => {
    const session = boot({ startup: `${GIVE}${call}\n` });
    const state = session.pump((current) => current.menu.screens.length === 1);
    equal(state.menu.screens[0]!.screen, expected, `${call} opens ${expected}`);
    const redraw = drawn(session);
    deepEqual(redraw.texts, texts, `${expected} prints exactly these lines, in this order`);
    deepEqual(redraw.bars, [bar], "the first row is focused");
    ok(overlayBlits(session.engine) >= 1, `${expected} reaches the draw list as an overlay blit`);
    equal(press(session, "ESC").menu.screens.length, 0, `${expected} closes on cancel`);
    deepEqual(session.diagnostics, []);
  });
}

/** Every screen depth of the stock menu, as the keys that reach it from the main screen (E-80 #menu-navigation rule 2). */
const NESTED_DEPTHS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["items list", ["ENTER"], ["main", "items"]],
  ["items action", ["ENTER", "ENTER"], ["main", "items"]],
  ["items member", ["ENTER", "ENTER", "ENTER"], ["main", "items"]],
  ["items info", ["ENTER", "ENTER", "DOWN", "ENTER"], ["main", "items"]],
  ["equipment member", ["DOWN", "ENTER"], ["main", "equipment"]],
  ["equipment slot", ["DOWN", "ENTER", "ENTER"], ["main", "equipment"]],
  ["equipment item", ["DOWN", "ENTER", "ENTER", "ENTER"], ["main", "equipment"]],
  ["abilities member", ["DOWN", "DOWN", "ENTER"], ["main", "abilities"]],
  ["abilities list", ["DOWN", "DOWN", "ENTER", "ENTER"], ["main", "abilities"]],
  ["abilities action", ["DOWN", "DOWN", "ENTER", "ENTER", "ENTER"], ["main", "abilities"]],
  ["abilities info", ["DOWN", "DOWN", "ENTER", "ENTER", "ENTER", "DOWN", "ENTER"], ["main", "abilities"]],
  ["save picker", ["DOWN", "DOWN", "DOWN", "ENTER"], ["main"]],
  ["load picker", ["DOWN", "DOWN", "DOWN", "DOWN", "ENTER"], ["main"]],
];
for (const [label, keys, stack] of NESTED_DEPTHS) {
  test(`the menu key closes the whole stack from the ${label}`, () => {
    const session = boot({ startup: 'giveitem("potion")\nmainmenu()\n' });
    session.pump((state) => state.menu.screens.length === 1);
    for (const key of keys) press(session, key);
    deepEqual(session.state().menu.screens.map((screen) => screen.screen), stack, `${label} is open before the menu key`);
    const closed = press(session, "M");
    equal(closed.menu.screens.length, 0, `${label}: the menu key closed every screen`);
    equal(session.saves.length + session.loads.length, 0, "closing wrote and read no save");
    // A later menu opens and behaves normally, so the unwinding left nothing behind.
    startThread(session.state().vm, { ref: { kind: "inline", text: "mainmenu()\n", ir: IR_VERSION }, kind: "blocking", owner: "script" });
    equal(session.pump((state) => state.menu.screens.length === 1).menu.screens[0]!.screen, "main");
    equal(press(session, "DOWN").menu.screens[0]!.selection, 1, "the reopened menu still takes input");
  });
}

test("a child screen returns to the same usable main menu", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  equal(press(session, "ENTER").menu.screens.at(-1)?.screen, "items");
  equal(press(session, "ESC").menu.screens.at(-1)?.screen, "main");
  equal(press(session, "DOWN").menu.screens[0]?.selection, 1);
  deepEqual(session.diagnostics, []);
});

test("a key item cannot be dropped and an ordinary item is dropped once", () => {
  const session = boot({ startup: 'giveitem("key")\ngiveitem("potion")\nitemmenu()\n' });
  let state = session.pump((current) => current.menu.screens.length === 1);
  equal(state.inventory.items.length, 2);
  // Stack 1 is the key, stack 2 the potion. Confirm opens the action rows, two downs select Drop, confirm drops.
  for (const key of ["ENTER", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(state.inventory.items.find((entry) => entry.handle === "Brass key")?.quantity, 1, "the key item is still carried");
  equal(state.inventory.items.length, 2, "the attempted drop did not remove any stack");
  // Back to the list, move to the potion, and drop it: one unit leaves the stack.
  for (const key of ["ESC", "DOWN", "ENTER", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(state.inventory.items.find((entry) => entry.handle === "Potion"), undefined, "the potion stack is gone");
  equal(state.inventory.items.find((entry) => entry.handle === "Brass key")?.quantity, 1, "the key is untouched");
});

test("item info prints the stored description, returns to the actions, and use consumes the chosen stack", () => {
  const session = boot({ startup: 'giveitem("potion")\nitemmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "DOWN", "ENTER"]) press(session, key);
  deepEqual(drawn(session).texts, ["Potion", "Restores 10 HP"], "Info prints the item's stored description under its handle");
  equal(session.state().inventory.items[0]?.quantity, 1, "Info does not consume the item");
  press(session, "ESC");
  deepEqual(drawn(session).texts, ["Potion", "Use", "Info", "Drop"], "cancel returns to the action rows");
  for (const key of ["UP", "ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.items.length, 0, "Use consumes the item");
  equal(session.state().actors.actors[0]?.stats.hp, 20, "Use applies the menu HP effect");
  deepEqual(session.diagnostics, []);
});

test("item info prints the handle when the stored description is empty", () => {
  const session = boot({ gear: 1, startup: giveGear(1, "itemmenu()") });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "DOWN", "ENTER"]) press(session, key);
  deepEqual(drawn(session).texts, ["Gear 1", "Gear 1"], "no description: the handle is the text");
});

test("equipment selects a member, slot and item, then removes it", () => {
  const session = boot({ startup: 'giveitem("potion")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.equipment[0]?.slot, "head", "the selected item is equipped in the head slot");
  for (const key of ["ENTER", "ENTER"]) press(session, key);
  equal(session.state().inventory.equipment.length, 0, "Remove clears the slot");
  equal(session.state().inventory.items[0]?.quantity, 1, "Remove returns the item to inventory");
  deepEqual(session.diagnostics, []);
});

/** The horizontal extent of the ink drawn in one 16-pixel text band between two columns, or null when the row is blank there. */
function inkExtent(session: Session, y: number, fromX: number, toX: number): number | null {
  const state = session.state();
  const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
  if (entry === undefined) throw new Error("the render-now surface does not exist");
  const surface = session.engine.surfacePixels(entry.id, entry.rev);
  if (surface === null) throw new Error("the drawn menu pixels are not available");
  let first = -1;
  let last = -1;
  for (let x = fromX; x < toX; x += 1) {
    for (let row = y; row < y + 16; row += 1) {
      const at = (row * surface.w + x) * 4;
      const background = (row * surface.w + toX) * 4;
      const differs = [0, 1, 2].some((channel) => surface.rgba[at + channel] !== surface.rgba[background + channel]);
      if (differs) {
        if (first < 0) first = x;
        last = x;
      }
    }
  }
  return first < 0 ? null : last - first + 1;
}

const FITTING = 'giveitem("potion")\ngiveitem("sword")\nequipmentmenu()\n';

test("the head slot offers the potion that fits it and not the sword that does not", () => {
  const session = boot({ startup: FITTING });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "ENTER"]) press(session, key);
  deepEqual(drawn(session).texts, ["head", "Potion"], "the item list holds only the potion");
  press(session, "DOWN");
  equal(session.state().menu.screens.at(-1)?.selection, 0, "so `down` stays on its one row");
  press(session, "ENTER");
  deepEqual(session.state().inventory.equipment.map((entry) => [entry.slot, entry.itemId]), [["head", 1]]);
  deepEqual(session.diagnostics, []);
});

test("the right hand offers the sword that fits it and not the potion that does not", () => {
  const session = boot({ startup: FITTING });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "ENTER");
  pointer(session, 60, rowY(2), 0);
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["right-hand", "Iron sword"], "the item list holds only the sword");
  press(session, "ENTER");
  deepEqual(session.state().inventory.equipment.map((entry) => [entry.slot, entry.itemId]), [["right-hand", 2]]);
  deepEqual(session.diagnostics, []);
});

test("the accessory slot offers a matching accessory item, and equipping it fills accessory-7", () => {
  const session = boot({ accessory: "Amulet", startup: 'giveitem("amulet")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "ENTER");
  // Six body-slot rows fill the page at 320 x 240, so one page right puts the cursor on accessory-7.
  press(session, "RIGHT");
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["accessory-7", "Amulet"], "the item's shared accessory flag and its name both fit");
  press(session, "ENTER");
  deepEqual(session.state().inventory.equipment.map((entry) => [entry.slot, entry.itemId]), [["accessory-7", 1]], "the accessory is worn in accessory-7");
  deepEqual(session.diagnostics, []);
});

test("an accessory item whose name the member does not wear is offered nowhere", () => {
  const session = boot({ accessory: "Bracelet", startup: 'giveitem("amulet")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "ENTER");
  press(session, "RIGHT");
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["accessory-7", "Nothing fits"], "the accessory's own flag and name fit, but this hero wears another");
});

test("the left hand has nothing that fits, so the list says so and confirming changes nothing", () => {
  const session = boot({ startup: FITTING });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "ENTER");
  pointer(session, 60, rowY(3), 0);
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["left-hand", "Nothing fits"]);
  press(session, "ENTER");
  equal(session.state().inventory.equipment.length, 0, "nothing was equipped");
  deepEqual(session.diagnostics, []);
});

test("an equipped item whose every unit is worn still prints its name on the slot row", () => {
  const session = boot({ startup: 'giveitem("sword")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "DOWN", "DOWN", "ENTER", "ENTER"]) press(session, key);
  deepEqual(session.state().inventory.equipment.map((entry) => entry.slot), ["right-hand"]);
  equal(session.state().inventory.items[0]?.quantity, 0, "the only unit is worn");
  const worn = inkExtent(session, 52 + 24 * 2, 152, 300);
  const empty = inkExtent(session, 52 + 24 * 3, 152, 300);
  ok(worn !== null && worn > 40, `the worn sword's name is drawn (ink width ${String(worn)})`);
  ok(empty !== null && empty <= 16, `an empty slot draws only the dash (ink width ${String(empty)})`);
});

test("the abilities list prints the move's stored display name, not its file name", () => {
  const session = boot({ startup: "abilitiesmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "ENTER");
  const label = inkExtent(session, 52, 24, 150);
  const cost = inkExtent(session, 52, 152, 300);
  ok(label !== null && cost !== null, "the move row is drawn");
  // The stored name is `Fire` (four glyphs) and the file is `fire.spc` (eight); the cost column `SMP 0` is five.
  ok(label < cost, `four glyphs are narrower than the five-glyph cost (label ${label}, cost ${cost})`);
});

test("abilities show the stored description, and Use runs the move's board program", () => {
  const session = boot({ startup: "abilitiesmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "ENTER", "DOWN", "ENTER"]) press(session, key);
  deepEqual(drawn(session).texts, ["Fire", "A spark"], "Info prints the move's stored description under its name");
  press(session, "ESC");
  deepEqual(drawn(session).texts, ["Fire", "Use", "Info"], "cancel returns to the action rows");
  for (const key of ["UP", "ENTER"]) press(session, key);
  equal(session.state().vm.globals.abilityused, 1, "Use runs the move's board program");
  deepEqual(session.diagnostics, []);
});

test("Save is gated by the board's disable-saving flag", () => {
  const session = boot({ startup: "mainmenu()\n", disableSaving: 1 });
  let state = session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["DOWN", "DOWN", "DOWN", "ENTER"]) state = press(session, key);
  equal(session.requests.includes("saveBlob"), false, "a saving-disabled board issues no save");
  equal(session.requests.includes("listBlobs"), false, "the picker is not opened at all");
  equal(state.menu.screens.length, 1, "the menu stays open");
});

// Full-engine scenarios, kept on purpose (AGENTS.md: tests stay fast): Save and Load go through the picker, the host's
// save area, the engine's real save (one `snapshotGameSave` of the whole state, about half a second by itself) and its
// real restore. A smaller test would not exercise the contract they pin: which bytes leave the engine, under which name,
// and what comes back.
test("Save through the picker overwrites the chosen listed file with a whole saved game", () => {
  const session = boot({ persist: true, saves: 1, startup: 'marker = 11\nmainmenu()\n' });
  session.pump((current) => current.menu.screens.length === 1);
  pointer(session, 60, commandY(3), 0);
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["Save game", "slot1", "New save"], "the picker lists the saved file and the new-save row");
  session.pump(() => session.saves.length === 1, "ENTER");
  ok(/^[^/]+\/saved\/slot1\.sav$/.test(session.saves[0]!), `Save wrote ${session.saves[0]}: the listed name under the game's folder, one prefix`);
  const bytes = session.store.get(session.saves[0]!)!;
  const text = utf8Decode(bytes);
  ok(bytes.length > 1000 && text.startsWith("{") && text.includes('"marker":11'), "the file is a whole saved game holding the script's variable");
  equal(session.store.size, 1, "one entry in the save area");
  deepEqual(session.diagnostics, []);
});

test("Load restores a real saved game through the picker: the saved variable and inventory come back, with no diagnostic", () => {
  const session = boot({ persist: true, startup: 'giveitem("potion")\nmarker = 11\nsave("slot1")\nmainmenu()\n' });
  session.pump((current) => current.menu.screens.length === 1);
  const [savedPath] = [...session.store.keys()];
  ok(savedPath !== undefined && /^[^/]+\/saved\/slot1\.sav$/.test(savedPath), `the script's save is in the host's area at ${String(savedPath)}`);
  // The game moves on after the save (another script would be frozen behind the open menu, so the state is changed
  // directly); Load must bring the saved values back.
  const live = session.state();
  live.vm.globals.marker = 99;
  for (const entry of live.inventory.items) entry.quantity = 0;
  pointer(session, 60, commandY(4), 0);
  press(session, "ENTER");
  deepEqual(drawn(session).texts, ["Load game", "slot1"], "the Load picker lists the file the way a host lists it");
  session.pump(() => session.loads.length === 1, "ENTER");
  deepEqual(session.loads, [savedPath], "Load asked for the file that was saved");
  const restored = session.pump((current) => current.menu.screens.length === 1 && current.vm.globals.marker === 11);
  equal(restored.inventory.items.find((entry) => entry.handle === "Potion")?.quantity, 1, "the saved inventory came back");
  deepEqual(session.diagnostics, [], "restoring raised no diagnostic");
});

test("dirsav can be entered directly and returns the selected base name", () => {
  const session = boot({ startup: 'choice = dirsav("Load", 0, 0, 0, "")\n' });
  session.pump((state) => session.requests.includes("listBlobs") && state.vm.threads.some((thread) => thread.wait?.kind === "input.key"));
  const state = press(session, "ENTER");
  equal(state.vm.globals.choice, "slot1");
  deepEqual(session.diagnostics, []);
});

test("MenuGraphic is stored on the menu section and drawn by the screen", () => {
  const session = boot({ startup: 'menugraphic("layout.png")\nmainmenu()\n' });
  const state = session.pump((current) => current.menu.screens.length === 1);
  equal(state.menu.graphic, "layout.png", "menugraphic writes the menu section through its owner");
  const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
  ok(entry, "the render-now surface exists");
  const surface = session.engine.surfacePixels(entry.id, entry.rev);
  ok(surface, "the drawn menu pixels are available");
  const offset = (15 * 320 + 15) * 4;
  deepEqual([...surface.rgba.subarray(offset, offset + 4)], [200, 40, 40, 255], "the custom image is drawn behind the rows");
});

for (const [label, reference, detail] of [
  ["a graphic that is not in the asset index", "absent.png", "is not in the asset index"],
  ["a graphic the host cannot supply bytes for", "ghost.png", "asset not found"],
] as const) {
  test(`a named MenuGraphic that is ${label} reports one diagnostic and the engine keeps running`, () => {
    const session = boot({ startup: `menugraphic("${reference}")\nmainmenu()\n` });
    session.pump((current) => current.menu.screens.length === 1);
    // Every key redraws the panel, so a diagnostic per draw would show here.
    press(session, "DOWN");
    const state = press(session, "DOWN");
    equal(state.menu.screens[0]!.selection, 2, "the menu still takes input after the failed picture");
    equal(state.engine.boot?.stage, "running", "the engine did not stop");
    ok(state.engine.failed !== true, "the engine did not fail");
    const missing = session.diagnostics.filter((entry) => entry.startsWith("asset.missing"));
    equal(missing.length, 1, session.diagnostics.join("; "));
    ok(missing[0]!.includes(detail), missing[0]);
    equal(session.diagnostics.length, 1, "nothing else is reported");
  });
}

test("Quit asks first: the first confirm only opens the question, No and cancel return to Quit, and nothing is sent", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "UP");
  equal(session.state().menu.screens[0]!.selection, 5, "the cursor is on Quit");
  let state = press(session, "ENTER");
  equal(state.menu.screens.length, 1, "the first confirm only opens the question");
  equal(state.menu.screens[0]!.selection, 0, "No is focused first");
  deepEqual(drawn(session).texts, ["Quit the game?", "No", "Yes"]);
  equal(session.requests.filter((kind) => kind === "quit").length, 0, "nothing is quit yet");
  state = press(session, "ENTER");
  equal(state.menu.screens[0]!.selection, 5, "No returns to Quit");
  press(session, "ENTER");
  state = press(session, "ESC");
  equal(state.menu.screens[0]!.selection, 5, "cancel returns to Quit");
  equal(session.requests.filter((kind) => kind === "quit").length, 0, "neither quit anything");
});

test("Yes on the Quit question closes the menu and sends exactly one quit request; the menu key closes it without quitting", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  for (const key of ["UP", "ENTER", "M"]) press(session, key);
  equal(session.state().menu.screens.length, 0, "the menu key closes everything from the question");
  equal(session.requests.filter((kind) => kind === "quit").length, 0, "closing the question quits nothing");
  startThread(session.state().vm, { ref: { kind: "inline", text: "mainmenu()\n", ir: IR_VERSION }, kind: "blocking", owner: "script" });
  session.pump((current) => current.menu.screens.length === 1);
  for (const key of ["UP", "ENTER", "DOWN"]) press(session, key);
  equal(session.state().menu.screens[0]!.selection, 1, "Yes is the second row");
  equal(press(session, "ENTER").menu.screens.length, 0, "Yes closes the menu");
  session.pump(() => session.requests.includes("quit"));
  equal(session.requests.filter((kind) => kind === "quit").length, 1);
});

/** The files the `ui` track has started, most recent last. */
function uiFiles(state: GameState): string[] {
  const track = state.audio.tracks.find((candidate) => candidate.name === "ui");
  if (track === undefined) return [];
  return track.voices.flatMap((voice) => (voice.state === "playing" ? [voice.file as string] : []));
}

test("a cursor move plays the main file's move sound on the ui track, and no name is silent", () => {
  const loud = boot({ startup: "mainmenu()\n", sounds: true });
  loud.pump((state) => state.menu.screens.length === 1);
  const loudState = press(loud, "DOWN");
  ok(uiFiles(loudState).includes(assetKey("media/move.wav")), `the move cue plays: ${uiFiles(loudState).join(",")}`);

  const silent = boot({ startup: "mainmenu()\n" });
  silent.pump((state) => state.menu.screens.length === 1);
  const silentState = press(silent, "DOWN");
  deepEqual(uiFiles(silentState), [], "without a main-file name the move is silent");
});

test("confirm and cancel play their configured ui cues", () => {
  const session = boot({ startup: "mainmenu()\n", sounds: true });
  session.pump((state) => state.menu.screens.length === 1);
  ok(uiFiles(press(session, "ENTER")).includes(assetKey("media/confirm.wav")), "confirm plays its cue");
  ok(uiFiles(press(session, "ESC")).includes(assetKey("media/cancel.wav")), "cancel plays its cue");
});

test("the same input log replays to the same draw list and state hash", () => {
  const runOnce = (first: string): { readonly draw: string; readonly pixels: string; readonly hash: string } => {
    const session = boot({ startup: "mainmenu()\n", sounds: true });
    let state = session.pump((current) => current.menu.screens.length === 1);
    state = press(session, first);
    const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
    ok(entry);
    const surface = session.engine.surfacePixels(entry.id, entry.rev);
    ok(surface);
    // The engine's own per-advance state hash (the projection that skips audio settings and step counters).
    return { draw: hashDrawList(session.engine.drawList()), pixels: fnv1a64(surface.rgba), hash: hashGameState(state) };
  };
  deepEqual(runOnce("DOWN"), runOnce("DOWN"), "two runs of one input log agree");
});

// ---- pixels: what the paged lists and the focus bar look like (E-80 stock items 4 and 5) ----------------------

type Pixels = { readonly w: number; readonly h: number; readonly rgba: Uint8Array };
function pixelsOf(session: Session): Pixels {
  const state = session.state();
  const entry = state.surfaces.entries[String(state.surfaces.renderNow)];
  if (entry === undefined) throw new Error("the render-now surface does not exist");
  const surface = session.engine.surfacePixels(entry.id, entry.rev);
  if (surface === null) throw new Error("the drawn menu pixels are not available");
  return surface;
}
/** True when any pixel of the 16-pixel text band at `top` between two columns differs from the row's own background (x = 18). */
function hasInk(pixels: Pixels, top: number, fromX: number, toX: number): boolean {
  for (let y = top; y < top + 16 && y < pixels.h; y += 1) {
    const background = (y * pixels.w + 18) * 4;
    for (let x = fromX; x < toX; x += 1) {
      const at = (y * pixels.w + x) * 4;
      if ([0, 1, 2].some((channel) => pixels.rgba[at + channel] !== pixels.rgba[background + channel])) return true;
    }
  }
  return false;
}
/** The page positions k (0-based, 24 px apart from y = 52) whose label column holds text. */
function textRows(session: Session): number[] {
  const pixels = pixelsOf(session);
  const rows: number[] = [];
  for (let k = 0; 52 + 24 * k + 16 <= pixels.h; k += 1) if (hasInk(pixels, 52 + 24 * k, 24, 150)) rows.push(k);
  return rows;
}
/** Whether the page indicator's ink is on the header line, right of the header's own text. */
function hasPageIndicator(session: Session): boolean {
  return hasInk(pixelsOf(session), 24, 190, 300);
}
/** The first and last y of the focus bar (the rows whose pixel at x = 20 is the bar colour), or null. */
function focusBar(session: Session): { readonly top: number; readonly bottom: number } | null {
  const pixels = pixelsOf(session);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < pixels.h; y += 1) {
    const at = (y * pixels.w + 20) * 4;
    if (pixels.rgba[at] === 40 && pixels.rgba[at + 1] === 64 && pixels.rgba[at + 2] === 140) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return top < 0 ? null : { top, bottom };
}
const selectionOf = (session: Session): number | undefined => session.state().menu.screens.at(-1)?.selection;

function openSlotList(size: { readonly width?: number; readonly height?: number } = {}): Session {
  const session = boot({ startup: "equipmentmenu()\n", ...size });
  session.pump((state) => state.menu.screens.length === 1);
  press(session, "ENTER");
  return session;
}

test("equipment slots page at 320x240: six rows, an indicator, and the focused row stays in the frame", () => {
  const session = openSlotList();
  deepEqual(textRows(session), [0, 1, 2, 3, 4, 5], "six of the sixteen slots are drawn");
  ok(hasPageIndicator(session), "the page indicator is drawn");
  deepEqual(focusBar(session), { top: 48, bottom: 71 }, "the first row's 24-pixel bar");
  press(session, "UP");
  equal(selectionOf(session), 15, "up wraps over the whole list, not the page");
  const last = focusBar(session);
  deepEqual(last, { top: 48 + 24 * 3, bottom: 48 + 24 * 3 + 23 }, "slot 15 is row 3 of the last page");
  ok(last !== null && last.bottom < 240 - 42, "the focus bar ends above the message line");
  deepEqual(textRows(session), [0, 1, 2, 3], "the last page holds the remaining four slots");
});

test("equipment slots all fit at 640x480: sixteen rows, no indicator, nothing pages", () => {
  const session = openSlotList({ width: 640, height: 480 });
  deepEqual(textRows(session), Array.from({ length: 16 }, (_, index) => index));
  ok(!hasPageIndicator(session), "no indicator when everything fits");
  press(session, "RIGHT");
  equal(selectionOf(session), 0, "left and right do nothing on a list that fits");
  press(session, "UP");
  equal(selectionOf(session), 15);
  deepEqual(focusBar(session), { top: 48 + 24 * 15, bottom: 48 + 24 * 15 + 23 }, "slot 15 is drawn in place on the one page");
});

test("left and right page by a whole page and clamp at both ends", () => {
  const session = openSlotList();
  const walk = (key: string): number | undefined => { press(session, key); return selectionOf(session); };
  deepEqual([walk("RIGHT"), walk("RIGHT"), walk("RIGHT")], [6, 12, 15], "right turns a page, and from 12 stops on the last row (12 + 6 would pass it)");
  deepEqual([walk("LEFT"), walk("LEFT"), walk("LEFT")], [9, 3, 0], "left turns a page, and from 3 stops on the first row (3 - 6 would pass it)");
});

// [list, session, keys to open it, rows, the page size P for its height, the logical height]. The equipment item list is
// drawn on a 200-pixel-high screen (P = 4) so five fixture items are enough to page it: each item costs the engine
// asset round trips, and seven would push the test past the one-second budget.
for (const [label, make, keys, rows, page, height] of [
  ["the equipment item list", () => boot({ gear: 5, height: 200, startup: giveGear(5, "equipmentmenu()") }), ["ENTER", "ENTER"], 5, 4, 200],
  ["the abilities list", () => boot({ moves: 8, startup: "abilitiesmenu()\n" }), ["ENTER"], 9, 6, 240],
  ["the save picker", () => boot({ saves: 9, startup: "mainmenu()\n" }), ["DOWN", "DOWN", "DOWN", "ENTER"], 10, 6, 240],
] as const) {
  test(`${label} pages at ${height} pixels high and keeps the focused row in the frame`, () => {
    const session = make();
    session.pump((state) => state.menu.screens.length === 1);
    for (const key of keys) press(session, key);
    equal(textRows(session).length, page, `${page} of the ${rows} rows are drawn`);
    ok(hasPageIndicator(session), "the page indicator is drawn");
    press(session, "RIGHT");
    equal(selectionOf(session), page, "right turns to the second page");
    deepEqual(focusBar(session), { top: 48, bottom: 71 }, "the cursor is the first row of the new page");
    press(session, "RIGHT");
    equal(selectionOf(session), rows - 1, "right clamps on the last row (for the picker that is `New save`)");
    const bar = focusBar(session);
    ok(bar !== null && bar.top === 48 + 24 * (rows - 1 - page) && bar.bottom < height - 42, "the last row is drawn on its page, above the message line");
    deepEqual(textRows(session), Array.from({ length: rows - page }, (_, index) => index), "the second page holds the rest");
  });
}

/** The y of row `k` of a list's visible page, in the middle of its 24-pixel bar (first bar top 48). */
const rowY = (k: number): number => 48 + 24 * k + 12;
/** The y of command `k` of the main screen at 240 pixels high (bars from h - 155 = 85). */
const commandY = (k: number): number => 85 + 24 * k + 12;

test("hovering a row moves the cursor without activating it, and a stationary pointer never overrides the keyboard", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  pointer(session, 60, commandY(3), 0);
  equal(selectionOf(session), 3, "hovering Save moves the cursor to it");
  equal(session.state().menu.screens.length, 1, "hovering opens nothing");
  pointer(session, 60, 30, 0);
  equal(selectionOf(session), 3, "a pointer over no row leaves the cursor where it was");
  press(session, "UP");
  equal(selectionOf(session), 2, "a key still moves the cursor");
  pointer(session, 60, 30, 1);
  pointer(session, 60, 30, 0);
  equal(selectionOf(session), 2, "a pointer that has not moved onto a row does not take the cursor back");
});

test("pointer rows map through the visible page", () => {
  const session = openSlotList();
  press(session, "RIGHT");
  equal(selectionOf(session), 6);
  pointer(session, 60, rowY(1), 0);
  equal(selectionOf(session), 7, "the second row of page two is slot 7, not slot 1");
  pointer(session, 60, rowY(5), 0);
  equal(selectionOf(session), 11);
  pointer(session, 60, rowY(6), 0);
  equal(selectionOf(session), 11, "the space below the page is no row");
  pointer(session, 4, rowY(2), 0);
  equal(selectionOf(session), 11, "the panel margin is no row");
});

test("release over the pressed row activates it; the press alone never does", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  let state = pointer(session, 60, commandY(1), 1);
  equal(state.menu.screens.length, 1, "pressing Equip activates nothing");
  equal(state.menu.screens[0]!.selection, 1, "but the press puts the cursor on it (a touch has no hover)");
  state = pointer(session, 60, commandY(1), 0);
  deepEqual(state.menu.screens.map((screen) => screen.screen), ["main", "equipment"], "the release opened Equip, by the same path as confirm");
});

test("moving off the pressed row cancels the press, and returning to it does not re-arm it", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  pointer(session, 60, commandY(1), 1);
  pointer(session, 60, commandY(2), 1);
  let state = pointer(session, 60, commandY(2), 0);
  equal(state.menu.screens.length, 1, "released over another row: nothing opens");
  equal(state.menu.screens[0]!.selection, 2, "the cursor followed the pointer");
  pointer(session, 60, commandY(1), 1);
  pointer(session, 60, 30, 1);
  pointer(session, 60, commandY(1), 1);
  state = pointer(session, 60, commandY(1), 0);
  equal(state.menu.screens.length, 1, "off the row and back again: the press stays cancelled");
});

test("a secondary-button release is cancel", () => {
  const session = boot({ startup: 'giveitem("potion")\nitemmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  pointer(session, 60, rowY(0), 2);
  equal(session.state().menu.screens.length, 1, "the secondary press alone does nothing");
  const state = pointer(session, 60, rowY(0), 0);
  equal(state.menu.screens.length, 0, "its release left the screen");
});

/** Whether two sessions' overlays hold exactly the same pixels. */
function sameOverlay(left: Session, right: Session): boolean {
  const a = pixelsOf(left).rgba;
  const b = pixelsOf(right).rgba;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

test("the pointer and the keyboard reach the same state and the same pixels", () => {
  const startup = 'giveitem("potion")\ngiveitem("key")\nmainmenu()\n';
  const byKeys = boot({ startup });
  byKeys.pump((state) => state.menu.screens.length === 1);
  for (const key of ["ENTER", "DOWN"]) press(byKeys, key);

  const byPointer = boot({ startup });
  byPointer.pump((state) => state.menu.screens.length === 1);
  pointer(byPointer, 60, commandY(0), 1);
  pointer(byPointer, 60, commandY(0), 0);
  pointer(byPointer, 60, rowY(1), 0);

  deepEqual(byPointer.state().menu, byKeys.state().menu, "the same menu section: stack and cursor");
  deepEqual(byKeys.state().menu.screens.map((screen) => [screen.screen, screen.selection]), [["main", 0], ["items", 1]]);
  ok(sameOverlay(byPointer, byKeys), "the same overlay pixels");
});

test("the cursor lives in the menu frame in every sub-mode, with the member being operated beside it", () => {
  const session = boot({ startup: 'giveitem("potion")\ngiveitem("key")\nmainmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  const top = () => session.state().menu.screens.at(-1);
  for (const key of ["ENTER", "DOWN"]) press(session, key);
  deepEqual([top()?.screen, top()?.selection], ["items", 1], "the item list's cursor is the frame's");
  press(session, "ENTER");
  deepEqual([top()?.screen, top()?.selection], ["items", 0], "the action list starts at its own first row");
  press(session, "DOWN");
  equal(top()?.selection, 1, "the action cursor is the frame's too");
  press(session, "ENTER");
  press(session, "ESC");
  equal(top()?.selection, 1, "back on the action list at the row that was left");
  press(session, "ESC");
  equal(top()?.selection, 1, "back on the item list at the stack that was chosen");
});

test("the equipment cursor follows the member and the slot in the frame, and survives a save and restore mid-menu", () => {
  const session = boot({ allies: 1, startup: 'addplayer("ally1.tem")\nequipmentmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  const top = () => session.state().menu.screens.at(-1);
  press(session, "DOWN");
  deepEqual([top()?.actorId, top()?.selection], [2, 1], "on the member list the frame's actor follows the cursor");
  press(session, "ENTER");
  deepEqual([top()?.actorId, top()?.selection], [2, 0], "the slot list operates on the chosen member");
  press(session, "RIGHT");
  deepEqual([top()?.actorId, top()?.selection], [2, 6], "the slot cursor is the frame's");
  const before = hashGameState(session.state());
  const restored = restoreGameState(snapshot(session.state()));
  equal(hashGameState(restored), before, "the saved menu restores to the same state");
  deepEqual(restored.menu.screens, session.state().menu.screens);
  press(session, "ESC");
  deepEqual([top()?.actorId, top()?.selection], [2, 1], "cancelling returns to the member the player came from");
});

test("a gamepad pages, confirms and cancels through the same actions", () => {
  const session = boot({ startup: "mainmenu()\n" });
  session.pump((state) => state.menu.screens.length === 1);
  const stack = (): string[] => session.state().menu.screens.map((screen) => screen.screen);
  // The action bitmask changes from one report to the next, so each new bit is one press edge: no release needed between.
  pad(session, 2);
  equal(selectionOf(session), 1, "down moved the cursor to Equip");
  pad(session, 16);
  deepEqual(stack(), ["main", "equipment"], "confirm opened Equip");
  pad(session, 0);
  pad(session, 16);
  pad(session, 8);
  equal(selectionOf(session), 6, "right turned a page of the slot list");
  pad(session, 4);
  equal(selectionOf(session), 0, "left turned it back");
  pad(session, 32);
  deepEqual(stack(), ["main", "equipment"], "cancel left the slot list for the member list");
  pad(session, 64);
  deepEqual(stack(), [], "the menu button closed the whole menu");
});

test("the main screen keeps every command visible with five party members", () => {
  const session = boot({ allies: 4, startup: 'addplayer("ally1.tem")\naddplayer("ally2.tem")\naddplayer("ally3.tem")\naddplayer("ally4.tem")\nmainmenu()\n' });
  session.pump((state) => state.menu.screens.length === 1);
  equal(session.state().party.members.length, 5);
  press(session, "UP");
  const bar = focusBar(session);
  deepEqual(bar, { top: 85 + 24 * 5, bottom: 85 + 24 * 5 + 23 }, "Quit, the last command, is on screen at its pinned place");
  ok(bar !== null && bar.bottom <= 240 - 11, "the last command ends inside the panel");
  const pixels = pixelsOf(session);
  const dim = (y: number): boolean => hasInk(pixels, y, 24, 120);
  ok(dim(44), "the first party line is drawn");
  ok(dim(62), "and a `+k more` line follows it instead of four more lines that would run into the commands");
});

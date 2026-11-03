// The stock menu's test rig: one authored game, its asset bytes, the headless host that answers its requests, and the
// helpers that drive it with keys, pointer reports and gamepad reports. Shared by the stock-menu suite and the Epic 8
// acceptance fixture so both drive the same real `stock_menu` package.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { encodePng } from "./battle-ui-rig.ts";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyItem,
  createEmptyMainFile,
  createEmptySpecialMove,
  createEngine,
  inputPhaseRegistration,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  writeBoard,
  writeCharacter,
  writeItem,
  writeMainFile,
  writeSpecialMove,
  startThread,
  IR_VERSION,
  type AssetIndex,
  type AssetKey,
  type AudioCue,
  type Engine,
  type EngineInit,
  type GameState,
  type InputEvent,
  type InputRecord,
  type PackageCatalogueEntry,
  type TickReport,
} from "../src/index.ts";
export type Files = Map<string, Uint8Array>;
export const testDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(testDir, "..", "..", "..");

export function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export const STOCK_MENU = (() => {
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

export function catalogue(): readonly PackageCatalogueEntry[] {
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
export function bundledFiles(): Map<AssetKey, Uint8Array> {
  const bundled = new Map<AssetKey, Uint8Array>();
  for (const name of readdirSync(join(repoRoot, "media", "fonts"))) {
    bundled.set(assetKey(`media/fonts/${name}`), new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", name))));
  }
  for (const name of readdirSync(join(repoRoot, "media", "cursors"))) {
    bundled.set(assetKey(`media/cursors/${name}`), new Uint8Array(readFileSync(join(repoRoot, "media", "cursors", name))));
  }
  return bundled;
}
export const BUNDLED = bundledFiles();

export function boardBytes(disableSaving: number): Uint8Array {
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
export function waveBytes(samples = 256): Uint8Array {
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

export type GameOptions = {
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

export function authoredGame(options: GameOptions): { readonly files: Files; readonly index: AssetIndex; readonly main: string } {
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

/** One authored game: its asset bytes by lower-case key, the asset index the engine is given, and its main file. */
export type HostGame = { readonly files: Files; readonly index: AssetIndex; readonly main: string };

/** Everything the headless host needs to boot one game: what is loaded, how big the screen is and what the script does first. */
export type HostConfig = {
  readonly game: HostGame;
  readonly catalogue: readonly PackageCatalogueEntry[];
  readonly width: number;
  readonly height: number;
  readonly seed?: number;
  readonly gameIdentity?: string;
  readonly maxTicks?: number;
  /** The host keeps the bytes it is asked to save and lists, loads and overwrites them like a real save area. */
  readonly persist?: boolean;
  readonly saves?: number;
  /** The save area to start from, so a second engine can load what a first one saved; default empty. */
  readonly store?: Map<string, Uint8Array>;
  /** The RPGCode the first blocking thread runs once the game is running; `end()\n` runs nothing. */
  readonly startup: string;
  /** Phase hooks installed after the input and audio ones, for a test that has to observe or post state. */
  readonly phaseRegistrations?: NonNullable<EngineInit["phaseRegistrations"]>;
};

export type Session = {
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
  /** Every audio cue the engine has reported, in order. */
  readonly cues: AudioCue[];
  /**
   * Advance exactly `ticks` ticks delivering `inputs` (absolute ticks), answering the host requests the ticks raise, and
   * return the report. Unlike `pump` it waits for nothing: it is how a replay applies one input log in any chunking.
   */
  advance(ticks: number, inputs?: readonly InputRecord[]): TickReport;
};

/** Boot the authored stock-menu game described by `options`. */
export function boot(options: GameOptions): Session {
  return bootHost({
    game: authoredGame(options),
    catalogue: catalogue(),
    width: options.width ?? 320,
    height: options.height ?? 240,
    ...(options.persist === undefined ? {} : { persist: options.persist }),
    ...(options.saves === undefined ? {} : { saves: options.saves }),
    startup: options.startup,
  });
}

/** Boot any authored game on the headless host: the same request answering, save area and key delivery for every suite. */
export function bootHost(config: HostConfig): Session {
  const game = config.game;
  const options = { persist: config.persist, saves: config.saves, startup: config.startup };
  let latest: GameState | null = null;
  const cues: AudioCue[] = [];
  const requests: string[] = [];
  const saves: string[] = [];
  const loads: string[] = [];
  const diagnostics: string[] = [];
  const store = config.store ?? new Map<string, Uint8Array>();
  /** Host answers to the last tick's requests, delivered with the next tick's input. */
  let pending: InputRecord[] = [];
  const engine = createEngine({
    seed: config.seed ?? 7,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: config.gameIdentity ?? "stock-menu-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: config.width,
    height: config.height,
    input: { bindings: { keys: { KeyM: "menu", Escape: "cancel", Enter: "confirm", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } } },
    maxTicks: config.maxTicks ?? 4000,
    packageCatalogue: config.catalogue,
    bundled: BUNDLED,
    // The movement phase is what turns held input into travel (the runner registers it too), so a rig test can walk
    // the board player with a real held key and observe the resulting `party.steps`.
    phaseRegistrations: [inputPhaseRegistration(), movementPhaseRegistration(), { phase: "audio", run: (state) => { latest = state; } }, ...(config.phaseRegistrations ?? [])],
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
  function advance(ticks: number, inputs: readonly InputRecord[] = []): TickReport {
    const report = engine.advance(ticks, [...pending, ...inputs]);
    diagnostics.push(...report.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`));
    cues.push(...report.audioCues);
    pending = report.requests.flatMap((request) => answer(request as never).map((event) => ({ tick: report.tickAfter, event })));
    return report;
  }
  function pump(until: (state: GameState) => boolean, key?: string, limit = 20, initial: InputRecord[] = []): GameState {
    pending = [...pending, ...initial];
    let queued = key;
    let keyEndTick: number | null = null;

    for (let step = 0; step < limit; step += 1) {
      if (queued !== undefined && latest !== null) {
        const tick = state().time.tick;
        const code = queued === "ENTER" ? "Enter" : queued === "ESC" ? "Escape" : queued === "UP" ? "ArrowUp" : queued === "DOWN" ? "ArrowDown" : queued === "LEFT" ? "ArrowLeft" : queued === "RIGHT" ? "ArrowRight" : queued === "M" ? "KeyM" : queued;
        pending.push(
          { tick, event: { kind: "key", name: queued, code, char: null, down: true } },
          { tick: tick + 1, event: { kind: "key", name: queued, code, char: null, down: false } },
        );
        keyEndTick = tick + 1;
        queued = undefined;
      }
      // A key needs its down tick, its up tick and one to be handled; an injected report needs its tick and one to be handled.
      const ticks = keyEndTick !== null && pending.some((record) => record.event.kind === "key") ? 3 : 2;
      const report = advance(ticks, []);
      if (report.loading) continue;
      const ready = state().menu.screens.length === 0 || state().vm.threads.some((thread) => thread.status === "waiting" && (thread.wait?.kind === "input.key" || thread.wait?.kind === "render.msgbox"));
      if (queued === undefined && pending.length === 0 && ready && (keyEndTick === null || state().time.tick > keyEndTick) && until(state())) return state();
    }
    const current = latest;
    throw new Error(`the menu did not reach the expected state: screens=${JSON.stringify(current?.menu.screens ?? null)} threads=${(current?.vm.threads ?? []).map((thread) => `${thread.kind}:${thread.status}:${thread.wait?.kind ?? "-"}`).join(",")} requests=${requests.join(",")} diagnostics=${diagnostics.join("; ")}`);
  }
  const session = { engine, state, pump, advance, requests, saves, loads, diagnostics, store, cues };
  pump((current) => current.engine.boot?.stage === "running" && !current.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"));
  if (options.startup !== "end()\n") {
    startThread(state().vm, { ref: { kind: "inline", text: options.startup, ir: IR_VERSION }, kind: "blocking", owner: "script" });
  }
  return session;
}

/** Send one key on the next tick and let the screen handle it. */
export function press(session: Session, key: string): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, key);
}

/** Deliver one pointer report on the next tick; a press and its release are two reports on two ticks, like a real host. */
export function pointer(session: Session, x: number, y: number, buttons: number): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, undefined, 20, [{ tick, event: { kind: "pointer", x, y, buttons } }]);
}

/** Deliver one gamepad report (the action bitmask: up 1, down 2, left 4, right 8, confirm 16, cancel 32, menu 64). */
export function pad(session: Session, buttons: number): GameState {
  const tick = session.state().time.tick;
  return session.pump((current) => current.time.tick > tick, undefined, 20, [{ tick, event: { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons } }]);
}

/** A key script that gives one of each of `count` gear items, then opens `screen`. */
export function giveGear(count: number, screen: string): string {
  return `${Array.from({ length: count }, (_, index) => `giveitem("gear${index + 1}")`).join("\n")}\n${screen}\n`;
}

/** The overlay blit the menu contributes to the draw list (E-80 §4). */
export function overlayBlits(engine: Engine): number {
  return engine.drawList().commands.filter((command) => command.kind === "blit" && "surface" in command.source).length;
}

export type Redraw = { readonly texts: string[]; readonly bars: string[] };

/**
 * What the screen's latest redraw drew, read from the script's own effect log: every `pixelText` string in order, and
 * every focus bar (a `fillRect` that starts at x = 16, below the panel fill), since the last panel fill `(8, 8, …)`.
 */
export function drawn(session: Session): Redraw {
  return drawnTexts(session.state());
}

/** The same read against a state a test already holds (for example the one a key press returned). */
export function drawnTexts(state: GameState): Redraw {
  const effects = state.vm.effects;
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

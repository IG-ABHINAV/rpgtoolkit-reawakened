// A whole game that boots the real stock_battle package into a seeded fight with a screen, for the default battle UI
// tests and its golden frames (docs/spec/engine/battle.md#bat-11, entry 7.11).
//
// Every asset is authored here in code (G7): the sprites are small procedural pictures, not legacy artwork.
import { TextEncoder } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { equal, ok } from "node:assert/strict";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  IR_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyItem,
  createEmptyMainFile,
  createEmptySpecialMove,
  createEngine,
  fnv1a64,
  PACKAGE_ROOT,
  registerActorObject,
  TILE_BITMAP_MAGIC,
  writeAnimation,
  writeBattleBackground,
  writeBoard,
  writeCharacter,
  writeEnemy,
  writeItem,
  writeMainFile,
  writeSpecialMove,
  writeTileBitmap,
  writeTileset,
  type ActorRecord,
  type AudioCue,
  type Engine,
  type GameState,
  type PackageCatalogueEntry,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const encoder = new TextEncoder();

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

// ---- procedural pictures ---------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
const KEY: Rgb = [255, 0, 255];

class Picture {
  readonly rgba: Uint8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, fill: Rgb) {
    this.w = w;
    this.h = h;
    this.rgba = new Uint8Array(w * h * 4);
    this.rect(0, 0, w, h, fill);
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) this.dot(i, j, c);
  }
  dot(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const at = (y * this.w + x) * 4;
    this.rgba[at] = c[0];
    this.rgba[at + 1] = c[1];
    this.rgba[at + 2] = c[2];
    this.rgba[at + 3] = 255;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgb): void {
    for (let j = -ry; j <= ry; j += 1) for (let i = -rx; i <= rx; i += 1) if (i * i * ry * ry + j * j * rx * rx <= rx * rx * ry * ry) this.dot(cx + i, cy + j, c);
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Straight RGBA as a PNG with stored (uncompressed) blocks, so the bytes are the same on every runtime. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const scan = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) scan.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const zlib: number[] = [0x78, 0x01];
  for (let offset = 0; offset < scan.length; offset += 65535) {
    const length = Math.min(65535, scan.length - offset);
    zlib.push(offset + length === scan.length ? 1 : 0, length & 255, length >>> 8, ~length & 255, (~length >>> 8) & 255);
    for (let i = 0; i < length; i += 1) zlib.push(scan[offset + i]!);
  }
  let a = 1;
  let b = 0;
  for (const value of scan) { a = (a + value) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0;
  zlib.push(adler >>> 24, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255);
  const u32 = (value: number): number[] => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  const chunk = (name: string, data: readonly number[]): number[] => {
    const body = new Uint8Array([...[...name].map((ch) => ch.charCodeAt(0)), ...data]);
    return [...u32(data.length), ...body, ...u32(crc32(body))];
  };
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]), ...chunk("IDAT", zlib), ...chunk("IEND", [])]);
}

type Stance = "rest" | "fight" | "special" | "die";

function slime(stance: Stance): Picture {
  const p = new Picture(64, 64, KEY);
  if (stance === "die") {
    p.ellipse(32, 54, 26, 6, [80, 120, 80]);
    return p;
  }
  const lift = stance === "fight" ? 6 : 0;
  p.ellipse(32, 44 - lift, 24, 18 + lift / 2, [40, 90, 40]);
  p.ellipse(32, 44 - lift, 22, 16 + lift / 2, [90, 200, 90]);
  p.ellipse(24, 38 - lift, 4, 5, [255, 255, 255]);
  p.ellipse(40, 38 - lift, 4, 5, [255, 255, 255]);
  p.rect(23, 38 - lift, 3, 4, [0, 0, 0]);
  p.rect(39, 38 - lift, 3, 4, [0, 0, 0]);
  return p;
}

function bat(stance: Stance): Picture {
  const p = new Picture(64, 64, KEY);
  if (stance === "die") {
    p.ellipse(32, 54, 20, 5, [100, 70, 120]);
    return p;
  }
  const flap = stance === "fight" ? 10 : 0;
  p.ellipse(32, 32, 9, 11, [70, 40, 90]);
  p.ellipse(14, 26 - flap, 14, 9, [110, 60, 140]);
  p.ellipse(50, 26 - flap, 14, 9, [110, 60, 140]);
  p.rect(26, 20, 3, 5, [70, 40, 90]);
  p.rect(35, 20, 3, 5, [70, 40, 90]);
  p.rect(28, 30, 3, 3, [255, 220, 60]);
  p.rect(34, 30, 3, 3, [255, 220, 60]);
  return p;
}

function hero(body: Rgb, trim: Rgb, stance: Stance): Picture {
  const p = new Picture(64, 64, KEY);
  if (stance === "die") {
    p.rect(8, 50, 48, 8, body);
    p.ellipse(52, 52, 6, 6, [235, 200, 170]);
    return p;
  }
  const reach = stance === "fight" ? 12 : stance === "special" ? 8 : 0;
  p.ellipse(32, 14, 8, 9, [235, 200, 170]);
  p.rect(22, 22, 20, 24, body);
  p.rect(22, 22, 20, 4, trim);
  p.rect(24, 46, 6, 14, trim);
  p.rect(34, 46, 6, 14, trim);
  p.rect(42, 26, 6 + reach, 5, [235, 200, 170]);
  if (stance === "special") p.ellipse(54, 24, 6, 6, [255, 240, 120]);
  if (stance === "fight") p.rect(52 + reach / 2, 10, 3, 24, [220, 220, 235]);
  return p;
}

function backdrop(): Picture {
  const p = new Picture(SCREEN_WIDTH, SCREEN_HEIGHT, [24, 32, 72]);
  for (let y = 0; y < SCREEN_HEIGHT; y += 1) p.rect(0, y, SCREEN_WIDTH, 1, [24 + Math.floor(y / 12), 32 + Math.floor(y / 9), 72 + Math.floor(y / 8)]);
  p.rect(0, 336, SCREEN_WIDTH, 144, [64, 110, 64]);
  p.ellipse(120, 70, 28, 28, [250, 246, 200]);
  for (let i = 0; i < 9; i += 1) p.ellipse(40 + i * 76, 330, 40, 22 + ((i * 7) % 5) * 4, [40, 80, 56]);
  return p;
}

// ---- authored game data ------------------------------------------------------------------------------------------

const STANCE_FILES: Record<string, Record<Stance, string>> = {
  slime: { rest: "slime_rest.anm", fight: "slime_fight.anm", special: "slime_rest.anm", die: "slime_die.anm" },
  bat: { rest: "bat_rest.anm", fight: "bat_fight.anm", special: "bat_rest.anm", die: "bat_die.anm" },
  hero: { rest: "hero_rest.anm", fight: "hero_fight.anm", special: "hero_special.anm", die: "hero_die.anm" },
  mage: { rest: "mage_rest.anm", fight: "mage_fight.anm", special: "mage_special.anm", die: "mage_die.anm" },
  rogue: { rest: "rogue_rest.anm", fight: "rogue_fight.anm", special: "rogue_rest.anm", die: "rogue_die.anm" },
};

function animationBytes(image: string, secondImage: string | null = null, delaySeconds = 0.2): Uint8Array {
  const frames = [{ image, transparent: { r: KEY[0], g: KEY[1], b: KEY[2] }, sound: "" }];
  if (secondImage !== null) frames.push({ image: secondImage, transparent: { r: KEY[0], g: KEY[1], b: KEY[2] }, sound: "" });
  return unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM",
    major: 2,
    minor: 3,
    width: 64,
    height: 64,
    frames,
    delay: delaySeconds,
    residue: new Uint8Array(),
  }));
}

function enemyBytes(name: string, key: string, values: { hp: number; canRun: number; special?: string[] }): Uint8Array {
  const files = STANCE_FILES[key]!;
  return unwrap(writeEnemy({
    magic: "RPGTLKIT ENEMY",
    major: 2,
    minor: 1,
    name,
    hp: values.hp,
    smp: 10,
    fp: 6,
    dp: 1,
    canRun: values.canRun,
    criticalOn: -1,
    criticalBy: -1,
    specialMoves: values.special ?? [],
    weaknesses: [],
    strengths: [],
    aiLevel: 0,
    customAi: 0,
    aiProgram: "",
    experienceReward: 5,
    goldReward: 3,
    defeatProgram: "",
    runAwayProgram: "",
    stances: [files.rest, files.fight, files.rest, files.special, files.die, ""],
    customStances: [],
    residue: new Uint8Array(),
  }));
}

function characterBytes(name: string, key: string, specials: readonly string[], category: string, learnAt: { readonly minExp: number; readonly minLevel: number }): Uint8Array {
  const files = STANCE_FILES[key]!;
  const base = createEmptyCharacter();
  const slots = base.specialMoves.map((slot, index) => index < specials.length
    ? { file: specials[index]!, minExp: learnAt.minExp, minLevel: learnAt.minLevel, condVar: "", condValue: "" }
    : slot);
  return unwrap(writeCharacter({
    ...base,
    minor: 5,
    name,
    movementAnimations: Array(8).fill(""),
    specialMoves: slots,
    specialMoveCategory: category,
    hasSpecialMoves: specials.length === 0 ? 1 : 0,
    battleStances: [files.fight, files.rest, files.special, files.die, files.rest, ""],
    customStances: [],
  }));
}

function moveBytes(name: string, values: { fp: number; cost: number; desc?: string }): Uint8Array {
  return unwrap(writeSpecialMove({ ...createEmptySpecialMove(), minor: 3, name, damage: values.fp, smpCost: values.cost, description: values.desc ?? "", usableInBattle: 0 }));
}

function itemBytes(name: string, values: { hp: number; smp: number; battle: number; desc?: string }): Uint8Array {
  return unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    restAnimation: "",
    reservedAnimation: "",
    customStances: [],
    name,
    description: values.desc ?? "",
    battleUsable: values.battle,
    battleUseHp: values.hp,
    battleUseSmp: values.smp,
  }));
}

/** A 10 ms mono 8 kHz 16-bit PCM silence: enough for the engine to learn a length and emit a cue. */
function wavBytes(): Uint8Array {
  const samples = 80;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

function backgroundBytes(image: string): Uint8Array {
  return unwrap(writeBattleBackground({
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 3,
    image,
    music: "",
    menuMoveSound: "move.wav",
    menuChooseSound: "choose.wav",
    readySound: "",
    cantDoSound: "cant.wav",
    residue: new Uint8Array(),
  }));
}

// ---- the authored .tbm battle background ------------------------------------------------------------------------
//
// A 20 × 15 grid of 32-pixel tiles is exactly the 640 × 480 screen, so the composed picture is a 1:1 copy of the art
// below (docs/spec/formats/tiles.md#tile-bitmap-tbm, docs/spec/formats/battle-data.md#fight-background-bkg). Five
// three-row bands of one solid tile each; the third band's cells carry a tint, so a background that ignores the
// per-cell tint cannot pass.
export const TBM_COLUMNS = 20;
export const TBM_ROWS = 15;

export type TbmBand = {
  /** The tile's stored colour. */
  readonly colour: Rgb;
  /** The cell tint added to that colour. */
  readonly tint: Rgb;
  /** The colour the screen must show where the band is not covered by the UI. */
  readonly shown: Rgb;
};

export const TBM_BANDS: readonly TbmBand[] = [
  { colour: [40, 90, 60], tint: [0, 0, 0], shown: [40, 90, 60] },
  { colour: [120, 70, 40], tint: [20, 10, 0], shown: [140, 80, 40] },
  { colour: [70, 80, 130], tint: [0, 0, 0], shown: [70, 80, 130] },
  { colour: [150, 130, 40], tint: [-10, -10, 0], shown: [140, 120, 40] },
  { colour: [90, 40, 90], tint: [0, 0, 0], shown: [90, 40, 90] },
];

/** The band a tile row belongs to: three rows of tiles each. */
export function tbmBand(row: number): TbmBand {
  return TBM_BANDS[Math.min(TBM_BANDS.length - 1, Math.floor(row / 3))]!;
}

/** The colour the battle background must show at a screen pixel, before the UI draws over it. */
export function tbmColourAt(x: number, y: number): readonly [number, number, number] {
  const row = Math.min(TBM_ROWS - 1, Math.floor(y / 32));
  return tbmBand(row).shown;
}

/** One solid 32 × 32 tile per band, detail 1 (24-bit RGB, column-major; docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso). */
function tilesetBytes(): Uint8Array {
  const tiles = TBM_BANDS.map((band) => {
    const pixels = new Uint8Array(32 * 32 * 3);
    for (let at = 0; at < pixels.length; at += 3) {
      pixels[at] = band.colour[0];
      pixels[at + 1] = band.colour[1];
      pixels[at + 2] = band.colour[2];
    }
    return { pixels };
  });
  return unwrap(writeTileset({ version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false }, tiles, residue: new Uint8Array() }));
}

/** The 20 × 15 tile picture, stored with its padding row and column (x outer, y inner). */
function tileBitmapBytes(): Uint8Array {
  const cells = [];
  for (let x = 0; x <= TBM_COLUMNS; x += 1) {
    for (let y = 0; y <= TBM_ROWS; y += 1) {
      if (x >= TBM_COLUMNS || y >= TBM_ROWS) {
        cells.push({ tile: "", r: 0, g: 0, b: 0 });
        continue;
      }
      const band = tbmBand(y);
      cells.push({ tile: `meadow.tst${TBM_BANDS.indexOf(band) + 1}`, r: band.tint[0], g: band.tint[1], b: band.tint[2] });
    }
  }
  return unwrap(writeTileBitmap({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: TBM_COLUMNS, height: TBM_ROWS, cells, residue: new Uint8Array() }));
}

function fieldBoard(): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  }));
}

export type RigOptions = {
  readonly seed?: number;
  /** Enemy files, in slot order (one to four of `slime`, `bat`). */
  readonly enemies?: readonly ("slime" | "bat")[];
  /** The slime's HP (default 30); a small value lets one attack defeat it. */
  readonly slimeHp?: number;
  /** Authored stance animations use this frame delay in whole ticks and two frames (default: one frame, 0.2 s). */
  readonly stanceDelayTicks?: number;
  /** Override frame delays by fighter for mixed-cadence tests. */
  readonly stanceDelays?: Readonly<Record<string, number>>;
  /** Extra battle-usable item stacks appended to the default inventory. */
  readonly extraItems?: number;
  /** Prefix for generated extra-item labels, useful for clipping tests. */
  readonly extraItemLabelPrefix?: string;
  /** Quantity shown for generated extra items. */
  readonly extraItemQuantity?: number;
  /** How many fights the fight program runs back to back (default one); each ends when its enemies are gone or the party runs. */
  readonly fights?: number;
  /** A game HUD already on the reserved overlay before the first fight: drawn and switched on, drawn and switched off, or none. */
  readonly hud?: "on" | "off";
  /** The experience and level at which the party's special moves are learned (default: from the start). */
  readonly learnSpecialsAt?: { readonly minExp: number; readonly minLevel: number };
  readonly party?: readonly { readonly key: "hero" | "mage" | "rogue"; readonly hp: number; readonly smp: number }[];
  readonly inventory?: readonly { readonly source: string; readonly handle: string; readonly quantity: number }[];
  /**
   * The battle background picture the `.bkg` names: the authored PNG (default, the golden frames), the authored
   * 20 × 15 tile bitmap, or none (the stock screen's flat fallback colour).
   */
  readonly background?: "png" | "tbm" | "none";
  /** Instrument scanner completion in the one regression test that distinguishes fast-path from fallback scanning. */
  readonly watchFastPathCompletion?: boolean;
};

const DEFAULT_PARTY = [
  { key: "hero", hp: 42, smp: 12 },
  { key: "mage", hp: 30, smp: 3 },
  { key: "rogue", hp: 0, smp: 6 },
] as const;

const NAMES = { hero: "Hero", mage: "Mage", rogue: "Rogue" } as const;
const SPECIALS: Record<string, { specials: readonly string[]; category: string }> = {
  hero: { specials: ["fire.spc", "blaze.spc"], category: "Skills" },
  mage: { specials: ["fire.spc", "blaze.spc"], category: "Magic" },
  rogue: { specials: [], category: "" },
};

/** All authored files of the game, keyed as the engine asks for them (lower-case asset keys). */
export function gameFiles(options: RigOptions = {}): { readonly files: Map<string, Uint8Array>; readonly paths: readonly string[] } {
  const files = new Map<string, Uint8Array>();
  const paths: string[] = [];
  const put = (path: string, bytes: Uint8Array): void => {
    paths.push(path);
    files.set(assetKey(path), bytes);
  };
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    useCustomFightPrg: 1,
    customFightPrg: "fight.prg",
    packagePlugins: ["stock_battle"],
  };
  put("main.gam", unwrap(writeMainFile(main)));
  put("Boards/start.brd", fieldBoard());
  const hud = options.hud === undefined ? "" : `rendernow(1)\nhud = cnvrendernow\ncolorrgb(200,30,30)\nfillrect(4,4,60,20,hud)\n${options.hud === "off" ? "rendernow(0)\n" : ""}`;
  put("Prg/start.prg", encoder.encode(`${hud}ready = 1\nafterfight = 0\nend()\n`));
  const enemies = options.enemies ?? ["slime", "bat", "slime"];
  const fightCall = `fightenemy(${enemies.map((name) => `"${name}"`).join(", ")}, "meadow")`;
  const fights = Array.from({ length: options.fights ?? 1 }, (_, index) => `${fightCall}\nafterfight = ${index + 1}\n`).join("");
  put("Prg/fight.prg", encoder.encode(`${fights}end()\n`));
  const backgroundKind = options.background ?? "png";
  put("Bkrounds/meadow.bkg", backgroundBytes(backgroundKind === "none" ? "" : backgroundKind === "tbm" ? "meadow.tbm" : "meadow.png"));
  if (backgroundKind === "png") {
    const background = backdrop();
    put("Bitmap/meadow.png", encodePng(background.w, background.h, background.rgba));
  } else if (backgroundKind === "tbm") {
    put("Tiles/meadow.tst", tilesetBytes());
    put("Bitmap/meadow.tbm", tileBitmapBytes());
  }
  put("Enemy/slime.ene", enemyBytes("Slime", "slime", { hp: options.slimeHp ?? 30, canRun: 1 }));
  // The bat forbids running, so any fight that includes one has a blocked Run.
  put("Enemy/bat.ene", enemyBytes("Bat", "bat", { hp: 18, canRun: 0 }));
  for (const key of ["hero", "mage", "rogue"] as const) {
    put(`Chrs/${key}.tem`, characterBytes(NAMES[key], key, SPECIALS[key]!.specials, SPECIALS[key]!.category, options.learnSpecialsAt ?? { minExp: 0, minLevel: 1 }));
  }
  const arts: Record<string, (stance: Stance) => Picture> = {
    slime,
    bat,
    hero: (stance) => hero([60, 90, 220], [230, 200, 60], stance),
    mage: (stance) => hero([170, 50, 90], [250, 230, 240], stance),
    rogue: (stance) => hero([70, 130, 90], [50, 50, 50], stance),
  };
  for (const [key, art] of Object.entries(arts)) {
    for (const stance of ["rest", "fight", "special", "die"] as const) {
      const anm = STANCE_FILES[key]![stance];
      const png = anm.replace(".anm", ".png");
      if (files.has(assetKey(`Misc/${anm}`))) continue;
      const picture = art(stance);
      const ticks = options.stanceDelays?.[key] ?? options.stanceDelayTicks;
      if (ticks !== undefined) picture.rect(30, 38, 4, 4, [255, 255, 255]);
      put(`Bitmap/${png}`, encodePng(picture.w, picture.h, picture.rgba));
      if (ticks === undefined) {
        put(`Misc/${anm}`, animationBytes(png));
      } else {
        // A second, visibly different frame so a frame change is observable in rendered pixels.
        const second = art(stance === "die" ? "die" : "fight");
        second.rect(30, 38, 4, 4, [0, 0, 0]);
        const secondPng = anm.replace(".anm", "_b.png");
        put(`Bitmap/${secondPng}`, encodePng(second.w, second.h, second.rgba));
        put(`Misc/${anm}`, animationBytes(png, secondPng, ticks / 60));
      }
    }
  }
  put("SpcMove/fire.spc", moveBytes("Fire", { fp: 12, cost: 4, desc: "A concentrated fiery blast that burns a single foe." }));
  put("SpcMove/blaze.spc", moveBytes("Blaze", { fp: 30, cost: 30, desc: "A raging inferno that consumes all targets in its path." }));
  put("Item/potion.itm", itemBytes("Potion", { hp: 20, smp: 0, battle: 1, desc: "Restores 20 HP to one ally, living or fallen." }));
  put("Item/ether.itm", itemBytes("Ether", { hp: 0, smp: 8, battle: 1, desc: "Restores 8 SMP to one party member." }));
  for (let gem = 1; gem <= (options.extraItems ?? 0); gem += 1) {
    const suffix = String(gem).padStart(2, "0");
    const label = `${options.extraItemLabelPrefix ?? "Gem "}${suffix}`;
    put(`Item/gem${suffix}.itm`, itemBytes(label, { hp: 1, smp: 0, battle: 1, desc: `Gem number ${gem}.` }));
  }
  put("Item/key.itm", itemBytes("Brass Key", { hp: 0, smp: 0, battle: 0 }));
  for (const sound of ["move.wav", "choose.wav", "cant.wav"]) put(`Media/${sound}`, wavBytes());
  return { files, paths };
}

function catalogue(options: RigOptions): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  let startup = readFileSync(join(folder, manifest.program), "utf8");
  if (options.watchFastPathCompletion === true) {
    const fastPathReturn = "                return 1\n            }\n            stockBattleUi.controlSig = stockBattleUi.nextControlSig";
    const passScanner = "        if (ui.playerCount > 0) {\n            bar = ui.barScan";
    const passEnd = "            ui.barScan = (bar + 1) % ui.playerCount\n        }\n        return 0\n    },\n    box:";
    const refreshScan = "        size = battle.partySize(1)\n        if (size > 0) {\n            index = stockBattleUi.barScan";
    const refreshScanEnd = "            stockBattleUi.barScan = (index + 1) % size\n        }\n        return 0\n    },\n    draw:";
    if (!startup.includes(fastPathReturn) || !startup.includes(passScanner) || !startup.includes(passEnd) || !startup.includes(refreshScan) || !startup.includes(refreshScanEnd)) {
      throw new Error("stock battle test hook location changed");
    }
    startup = startup.replace(
      passScanner,
      "        if (stockBattleUi.testFastPathWatch != 0) {\n            ui.barScan = 3\n        }\n        if (ui.playerCount > 0) {\n            bar = ui.barScan",
    ).replace(
      passEnd,
      "            ui.barScan = (bar + 1) % ui.playerCount\n        }\n        if (stockBattleUi.testFastPathWatch != 0) {\n            ui.barScan = 3\n        }\n        return 0\n    },\n    box:",
    ).replace(
      refreshScan,
      "        size = battle.partySize(1)\n        if (size > 0) {\n            if (stockBattleUi.testFastPathWatch != 0) {\n                stockBattleUi.barScan = 3\n            }\n            index = stockBattleUi.barScan",
    ).replace(
      refreshScanEnd,
      "            stockBattleUi.barScan = (index + 1) % size\n        }\n        if (stockBattleUi.testFastPathWatch != 0) {\n            stockBattleUi.barScan = 3\n        }\n        return 0\n    },\n    draw:",
    ).replace(
      fastPathReturn,
      "                if (stockBattleUi.testFastPathWatch != 0) {\n                    stockBattleUi.testFastPathCompleted = 1\n                }\n                return 1\n            }\n            stockBattleUi.controlSig = stockBattleUi.nextControlSig",
    );
  }
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: startup, ir: IR_VERSION, dialect: "tk3" },
  }];
}

type Reply = { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } | { readonly kind: "key"; readonly name: string; readonly code: string; readonly char: string | null; readonly down: boolean } | { readonly kind: "action"; readonly action: string; readonly down: boolean; readonly source: string; readonly modalId: number | null } };

export type UiRig = {
  readonly engine: Engine;
  readonly files: Map<string, Uint8Array>;
  readonly diagnostics: { readonly code: string; readonly message: string }[];
  readonly requested: string[];
  /** Every audio cue the engine has reported, in order. */
  readonly cues: AudioCue[];
  state(): GameState;
  /** The UI's own dictionary (`stockBattleUi`) as plain data, or null before the screen exists. */
  ui(): Record<string, unknown> | null;
  /** Mutate live state in the next triggers phase, before stock battle's render/refresh phase. */
  mutateNextTick(mutate: (state: GameState) => void): void;
  tick(count?: number): void;
  /** Press one key (down, then up on the next tick) and run `ticks` ticks. */
  press(name: string, ticks?: number): void;
  /** Send one normalized semantic action press/release pair through engine ticks. */
  action(action: string, source: string, ticks?: number): void;
  /** Run until `done` is true, at most `limit` ticks. */
  until(done: (state: GameState) => boolean, limit?: number): void;
  /** The composed frame. */
  frame(): { readonly w: number; readonly h: number; readonly rgba: Uint8Array };
  charges(): number[][];
};

const KEY_CODES: Record<string, string> = { UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight", ENTER: "Enter", ESC: "Escape", SPACE: "Space" };

/** Boot the game; the party and the fight request are seeded on the first running tick, like a 5.11 handoff. */
export function bootUiRig(options: RigOptions = {}): UiRig {
  const game = gameFiles(options);
  const party = options.party ?? DEFAULT_PARTY;
  const gems = Array.from({ length: options.extraItems ?? 0 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    const name = `${options.extraItemLabelPrefix ?? "Gem "}${suffix}`;
    return { source: `item/gem${suffix}.itm`, handle: name, quantity: options.extraItemQuantity ?? 1 };
  });
  const stock = options.inventory ?? [{ source: "item/potion.itm", handle: "Potion", quantity: 3 }, { source: "item/ether.itm", handle: "Ether", quantity: 1 }, { source: "item/key.itm", handle: "Brass Key", quantity: 1 }, ...gems];
  let latest: GameState | null = null;
  let nextTickMutation: ((state: GameState) => void) | null = null;
  let seeded = false;
  const font = new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")));
  const engine = createEngine({
    seed: options.seed ?? 291,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-ui-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    maxTicks: 100000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    packageCatalogue: catalogue(options),
    phaseRegistrations: [{
      phase: "triggers",
      run: (state, post) => {
        latest = state;
        if (nextTickMutation !== null) {
          const mutate = nextTickMutation;
          nextTickMutation = null;
          mutate(state);
        }
        if (seeded || post === undefined || state.vm.globals.ready !== 1 || state.world.board === null || state.world.board === undefined) return;
        seeded = true;
        const ids: number[] = [];
        for (const member of party) {
          const record = addActor(state.actors, {
            kind: "party",
            source: `${member.key}.tem`,
            name: NAMES[member.key],
            stats: { experience: 0, hp: member.hp, maxHp: member.key === "mage" ? 30 : 42, smp: member.smp, maxSmp: member.key === "mage" ? 20 : 12, fp: 8, dp: 2, level: 1, criticalOn: -1, criticalBy: -1 },
          });
          registerActorObject(state.vm, state.events, state.actors, record.id);
          ids.push(record.id);
        }
        state.party.members = ids;
        state.party.selected = ids[0] ?? null;
        state.inventory.items = stock.map((entry, index) => ({ id: index + 1, source: entry.source, handle: entry.handle, quantity: entry.quantity }));
        state.inventory.nextId = stock.length + 1;
        post("battle", {
          thread: 0,
          name: "battle.customFight",
          kind: "state-write",
          args: [{
            trigger: "random",
            board: { key: "boards/start.brd", skill: 1, background: "meadow.bkg" },
            actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 80, y: 63, layer: 0 },
            program: "fight.prg",
          }],
          out: {},
          result: null,
          patch: null,
          wait: null,
          request: null,
        });
      },
    }],
  });
  const diagnostics: { code: string; message: string }[] = [];
  const requested: string[] = [];
  const cues: AudioCue[] = [];
  let replies: Reply[] = [];
  const advance = (inputs: readonly Reply[] = [], ticks = 1): number => {
    const report = engine.advance(ticks, [...replies, ...inputs] as never);
    replies = [];
    diagnostics.push(...report.diagnostics);
    cues.push(...report.audioCues);
    if (report.requests.length > 0) {
      for (const request of report.requests) {
        if (request.kind !== "asset") continue;
        requested.push(request.key);
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      }
    }
    return report.ticksRun;
  };
  const read = (value: unknown): unknown => {
    const state = latest;
    if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object" && "handle" in value && state !== null) {
      const record = state.vm.objects.find((object) => object.handle === (value as { handle: number }).handle);
      if (record === undefined) return null;
      return Object.fromEntries(Object.entries(record.members).map(([name, member]) => [name, read(member)]));
    }
    return value;
  };
  const rig: UiRig = {
    engine,
    files: game.files,
    diagnostics,
    requested,
    cues,
    state() {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
    ui() {
      if (latest === null) return null;
      const value = read(latest.vm.globals.stockbattleui);
      return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
    },
    mutateNextTick(mutate) {
      if (nextTickMutation !== null) throw new Error("a live-state mutation is already queued");
      nextTickMutation = mutate;
    },
    tick(count = 1) {
      // A broken host/engine can repeat requests forever without completing a tick.
      const maxStalledAdvances = 1024;
      let stalledAdvances = 0;
      for (let remaining = count; remaining > 0;) {
        // One advance computes one state hash, and with canvases in the state a hash is expensive: run in chunks
        // while nothing is loading, a tick at a time while the host answers asset requests.
        const chunk = replies.length > 0 ? 1 : Math.min(remaining, 8);
        const ran = advance([], chunk);
        if (ran === 0) {
          stalledAdvances += 1;
          if (replies.length === 0) throw new Error("battle UI rig could not advance and has no asset replies");
          if (stalledAdvances > maxStalledAdvances) throw new Error("battle UI rig could not advance after repeated asset replies");
        } else {
          stalledAdvances = 0;
        }
        remaining -= ran;
      }
    },
    press(name, ticks = 4) {
      const code = KEY_CODES[name] ?? name;
      const tick = latest?.time.tick ?? 0;
      advance([
        { tick, event: { kind: "key", name, code, char: null, down: true } },
        { tick: tick + 1, event: { kind: "key", name, code, char: null, down: false } },
      ], ticks);
      // A sound or picture used for the first time is requested during these ticks; let the host answer it so the
      // cue it was waiting for is reported before the caller looks.
      for (let guard = 0; guard < 6 && replies.length > 0; guard += 1) advance([], 2);
    },
    action(action, source, ticks = 4) {
      const tick = latest?.time.tick ?? 0;
      advance([
        { tick, event: { kind: "action", action, down: true, source, modalId: null } },
        { tick: tick + 1, event: { kind: "action", action, down: false, source, modalId: null } },
      ], ticks);
      for (let guard = 0; guard < 6 && replies.length > 0; guard += 1) advance([], 2);
    },
    until(done, limit = 4000) {
      for (let i = 0; i < limit;) {
        if (latest !== null && done(latest)) return;
        const chunk = replies.length > 0 ? 1 : 4;
        advance([], chunk);
        i += chunk;
      }
      throw new Error(`the condition did not hold within ${limit} ticks: ${JSON.stringify(diagnostics.map((d) => d.code))}`);
    },
    frame() {
      engine.surfacePixels(0 as never, -1);
      const state = rig.state();
      const surface = engine.surfacePixels(0 as never, state.surfaces.entries["0"]!.rev);
      if (surface === null) throw new Error("the frame is not readable");
      return { w: surface.w, h: surface.h, rgba: surface.rgba };
    },
    charges() {
      const battle = rig.state().battle;
      return battle === null ? [] : battle.parties.map((entries) => entries.map((entry) => entry.charge));
    },
  };
  return rig;
}

export const MAGE = 1;
export const THRESHOLD = 75;

export function actor(rig: UiRig, source: string): ActorRecord {
  const found = rig.state().actors.actors.find((candidate) => candidate.source === source);
  if (found === undefined) throw new Error(`no actor ${source}`);
  return found;
}

export function ui(rig: UiRig): Record<string, unknown> {
  const dictionary = rig.ui();
  if (dictionary === null) throw new Error("the screen is not up");
  return dictionary;
}

export function entries(value: unknown, count: number): Record<string, unknown>[] {
  const dictionary = value as Record<string, Record<string, unknown>>;
  return Array.from({ length: count }, (_, index) => dictionary[String(index)]!);
}

export function cueNames(rig: UiRig): string[] {
  return rig.cues.filter((cue) => cue.kind === "media.play").map((cue) => String(cue.asset).split("/").pop() ?? "");
}

export function awaitMenu(rig: UiRig): void {
  rig.until(() => {
    const dictionary = rig.ui();
    return dictionary !== null && dictionary["mode"] === "command";
  }, 2000);
  rig.tick(8);
}

/** Pinned pictures that are being drawn (not hidden). */
export function pinnedCount(rig: UiRig): number {
  return rig.state().fx.animations.filter((animation) => animation.pinned === true && animation.hidden !== true).length;
}

export function pinnedTimelines(rig: UiRig): { readonly id: number; readonly originTick: number; readonly loop: boolean }[] {
  return rig.state().fx.animations.filter((animation) => animation.pinned === true).map((animation) => ({ id: animation.id, originTick: animation.originTick, loop: animation.loop }));
}


export function countColour(rig: UiRig, box: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }, colour: readonly [number, number, number]): { readonly count: number; readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number } {
  const frame = rig.frame();
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = box.y1; y <= box.y2; y += 1) {
    for (let x = box.x1; x <= box.x2; x += 1) {
      const at = (y * frame.w + x) * 4;
      if (frame.rgba[at] === colour[0] && frame.rgba[at + 1] === colour[1] && frame.rgba[at + 2] === colour[2]) {
        count += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { count, minX, maxX, minY, maxY };
}


/** Sample label glyphs only (not the separate > cursor), alongside the active Mage's name. */
export function assertCommandLabelYellow(rig: UiRig, y: number): void {
  const label = { x1: 32, y1: y, x2: 112, y2: y + 17 };
  const activeName = { x1: 175, y1: 382, x2: 259, y2: 400 };
  ok(countColour(rig, label, SELECTION_YELLOW).count > 30, "selected command label is exact highlight yellow");
  equal(countColour(rig, label, [255, 255, 255]).count, 0, "selected command label is not white");
  ok(countColour(rig, activeName, SELECTION_YELLOW).count > 30, "active character name uses the same yellow");
}


export function regionHash(rig: UiRig, box: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }): string {
  const frame = rig.frame();
  const pixels = new Uint8Array((box.x2 - box.x1 + 1) * (box.y2 - box.y1 + 1) * 4);
  let offset = 0;
  for (let y = box.y1; y <= box.y2; y += 1) {
    const start = (y * frame.w + box.x1) * 4;
    const end = (y * frame.w + box.x2 + 1) * 4;
    pixels.set(frame.rgba.subarray(start, end), offset);
    offset += end - start;
  }
  return fnv1a64(pixels);
}


export const LIST_FIELD = { x1: 16, y1: 28, x2: 623, y2: 329 };
export const ENEMY_BAR_RED: readonly [number, number, number] = [220, 64, 56];
export const COMMAND_FIELD = { x1: 8, y1: 348, x2: 151, y2: 479 };
export const PARTY_FIELD = { x1: 160, y1: 348, x2: 631, y2: 479 };
export const LIST_HIGHLIGHT: readonly [number, number, number] = [40, 64, 140];
export const SELECTION_YELLOW: readonly [number, number, number] = [255, 224, 64];
export const TARGET_PICKER_FIELD = { x1: 8, y1: 255, x2: 151, y2: 323 };
export const TARGET_MESSAGE_FIELD = { x1: 0, y1: 324, x2: 639, y2: 343 };

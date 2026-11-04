// Actor artwork from its walk animation (E-21, E-54; docs/spec/formats/animation.md#layout,
// docs/spec/formats/character.md#defaults-and-fall-backs, docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso).
//
// The demo's player was drawn as a plain marker rectangle because no engine phase selected the character's walk
// animation and no `SpriteDraw` frame named the animation frame's tileset cell (#1252). These cases drive the real
// engine over authored character, animation and tileset bytes and assert the pixel source, the frame clock and the
// composed frame, so the artwork cannot silently fall back to the marker again.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import {
  ANIMATION_MAGIC,
  SINGLE_TILE_MAGIC,
  TILE_BITMAP_MAGIC,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEngine,
  createSpriteRuntime,
  decodeAnimationFrames,
  PACKAGE_ROOT,
  writeAnimation,
  writeBoard,
  writeCharacter,
  writeMainFile,
  writeSingleTile,
  writeTileBitmap,
  writeTileset,
  createEmptyMainFile,
  type AssetIndex,
  type AssetKey,
  type DrawCommand,
  type Engine,
  type GameState,
  type InputRecord,
  type RunnerRequest,
  type SurfaceId,
  type SurfacePixels,
} from "../src/index.ts";

type Files = Map<AssetKey, Uint8Array>;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A detail-1 tileset whose first two tiles are distinct solid colours, so a drawn pixel names its frame. */
function tilesetBytes(): Uint8Array {
  const pixels = (r: number, g: number, b: number): Uint8Array => {
    const out = new Uint8Array(32 * 32 * 3);
    for (let index = 0; index < 32 * 32; index += 1) {
      out[index * 3] = r;
      out[index * 3 + 1] = g;
      out[index * 3 + 2] = b;
    }
    return out;
  };
  return unwrap(writeTileset({
    version: 20,
    detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
    tiles: [{ pixels: pixels(220, 30, 30) }, { pixels: pixels(30, 200, 60) }],
    residue: new Uint8Array(),
  }));
}

/** A two-frame walk animation whose frames name tileset cells; the header may be wider than the cell it names. */
function walkAnimationBytes(width = 32, height = 32, images: readonly [string, string] = ["hero.tst1", "hero.tst2"], transparent = { r: 255, g: 255, b: 255 }): Uint8Array {
  return unwrap(writeAnimation({
    magic: ANIMATION_MAGIC,
    major: 2,
    minor: 3,
    width,
    height,
    frames: images.map((image) => ({ image, transparent, sound: "" })),
    delay: 0.15,
    residue: new Uint8Array(),
  }));
}

/** A tile bitmap picture; `tile` "" makes a valid, fully transparent picture (docs/spec/formats/tiles.md#tile-bitmap-tbm). */
function tileBitmapBytes(tile = "hero.tst1"): Uint8Array {
  return unwrap(writeTileBitmap({
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 1,
    height: 1,
    cells: [
      { tile, r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  }));
}

/** A solid single-tile `.gph` picture (docs/spec/formats/tiles.md#single-tile-gph); 32x32 is detail 1, 16x16 detail 2. */
function singleTileBytes(size = 32, colour: readonly [number, number, number] = [20, 40, 220]): Uint8Array {
  const value = colour[0] + 256 * colour[1] + 65536 * colour[2];
  return new TextEncoder().encode(writeSingleTile({
    magic: SINGLE_TILE_MAGIC,
    major: 2,
    minor: 0,
    detail: size === 32 ? 1 : 2,
    compression: 0,
    width: size,
    height: size,
    pixels: Array(size * size).fill(value),
  }));
}

/** A character whose only directional animation is the south walk, with no idle slots (walk is the idle fallback). */
function characterBytes(walkFile = "hero_s.anm"): Uint8Array {
  return unwrap(writeCharacter({
    ...createEmptyCharacter(),
    minor: 7,
    name: "Hero",
    movementAnimations: [walkFile, "", "", "", "", "", "", ""],
    battleStances: Array(6).fill(""),
    idleAnimations: Array(8).fill(""),
    idleTime: 0,
    speed: 0.05,
  }));
}

function boardBytes(): Uint8Array {
  const empty = createEmptyBoard();
  const cells = 10 * 10;
  return unwrap(writeBoard({
    ...empty,
    sizeX: 10,
    sizeY: 10,
    sizeL: 1,
    tileMatrix: Array(cells).fill(0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  }));
}

type GameOptions = {
  readonly walkFile?: string;
  readonly animation?: Uint8Array;
  /** Extra authored files by package path; each joins the asset index too. */
  readonly extra?: Readonly<Record<string, Uint8Array>>;
};

function authorGame(options: GameOptions = {}): { readonly files: Files; readonly index: AssetIndex; readonly main: string } {
  const walkFile = options.walkFile ?? "hero_s.anm";
  const files: Files = new Map();
  const paths: string[] = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", `Misc/${walkFile}`, "Tiles/hero.tst"];
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "", startupPrg: "", initBoard: "start.brd", initChar: "hero.tem" };
  files.set("main.gam" as AssetKey, unwrap(writeMainFile(main)));
  files.set("boards/start.brd" as AssetKey, boardBytes());
  files.set("chrs/hero.tem" as AssetKey, characterBytes(walkFile));
  files.set(`misc/${walkFile}` as AssetKey, options.animation ?? walkAnimationBytes());
  files.set("tiles/hero.tst" as AssetKey, tilesetBytes());
  for (const [path, bytes] of Object.entries(options.extra ?? {})) {
    files.set(assetKey(path), bytes);
    paths.push(path);
  }
  return { files, index: createAssetIndex(paths), main: "main.gam" };
}

type Run = {
  readonly engine: Engine;
  readonly state: () => GameState;
  readonly requests: readonly AssetKey[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
};

/** Boot the authored game with a real sprites owner, answering asset requests like a host, and run `ticks`. */
function run(ticks: number, options: GameOptions = {}): Run {
  const game = authorGame(options);
  const spriteRuntime = createSpriteRuntime();
  const requests: AssetKey[] = [];
  const diagnostics: Run["diagnostics"][number][] = [];
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 17,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    mainFile: game.main,
    gameIdentity: "sprite-artwork-test",
    startup: {
      presence: { hasPlayer: () => spriteRuntime.hasPlayer() },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    width: 320,
    height: 240,
    maxTicks: 600,
    spriteRuntime,
    include: { shading: true, images: true, sprites: true },
    phaseRegistrations: [{ phase: "audio", run: (state: GameState) => { latest = state; } }],
  });
  let remaining = ticks;
  let replies: InputRecord[] = [];
  for (let guard = 0; guard < 1000; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    remaining -= report.ticksRun;
    diagnostics.push(...report.diagnostics);
    for (const request of report.requests) if (request.kind === "asset") requests.push(request.key);
    if (report.loading) {
      replies = report.requests.flatMap((request: RunnerRequest) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: game.files.get(request.key) ?? null } }]
        : []);
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) break;
  }
  if (latest === null) throw new Error("no tick ran");
  return { engine, state: () => latest as GameState, requests, diagnostics };
}

function blitsOf(commands: readonly DrawCommand[], asset: string): Extract<DrawCommand, { kind: "blit" }>[] {
  return commands.filter((command): command is Extract<DrawCommand, { kind: "blit" }> =>
    command.kind === "blit" && "asset" in command.source && command.source.asset === asset);
}

function spriteBlits(commands: readonly DrawCommand[]): Extract<DrawCommand, { kind: "blit" }>[] {
  return blitsOf(commands, "tiles/hero.tst");
}

/** Read pixel `(x, y)` of the presented screen. */
function presented(host: Run): { readonly w: number; readonly h: number; readonly rgba: Uint8Array } {
  let screen: SurfacePixels | null = null;
  for (let rev = 0; rev < 64 && screen === null; rev += 1) screen = host.engine.surfacePixels(0 as SurfaceId, rev);
  if (screen === null) throw new Error("the presented screen is readable");
  return screen;
}

function pixelAt(screen: { readonly w: number; readonly rgba: Uint8Array }, x: number, y: number): readonly number[] {
  const index = (y * screen.w + x) * 4;
  return [screen.rgba[index] ?? -1, screen.rgba[index + 1] ?? -1, screen.rgba[index + 2] ?? -1, screen.rgba[index + 3] ?? -1];
}

test("the decoder resolves an animation frame's tileset reference to its asset and 1-based tile", () => {
  const decoded = decodeAnimationFrames(walkAnimationBytes(), "hero_s.anm", "misc/hero_s.anm" as AssetKey, (image) =>
    image === "hero.tst1" || image === "hero.tst2"
      ? { asset: "tiles/hero.tst" as AssetKey, tile: null }
      : null);
  ok(decoded !== null, "the animation decodes");
  // The resolver receives the frame's whole image reference; a tile reference keeps the classification's index.
  deepEqual(decoded.frames.map((frame) => [frame.asset, frame.tile]), [["tiles/hero.tst", 1], ["tiles/hero.tst", 2]]);
});

test("the engine draws the player's walk-animation tile, not the marker rectangle (#1252)", () => {
  const host = run(3);
  const state = host.state();
  const player = state.sprites.players[0];
  ok(player !== undefined, "the initial player exists");
  equal(state.world.board?.key, "boards/start.brd");
  deepEqual(host.diagnostics.map((diagnostic) => diagnostic.code), []);
  // The engine asks for the character's animation files and for the tileset its frames name.
  equal(host.requests.includes("misc/hero_s.anm" as AssetKey), true, JSON.stringify(host.requests));
  equal(host.requests.includes("tiles/hero.tst" as AssetKey), true, JSON.stringify(host.requests));

  equal(player.visual.animation, "walk.S");
  equal(player.visual.file, "hero_s.anm");
  equal(player.visual.frame, 0);
  const list = host.engine.drawList(0, { shading: true, images: true, sprites: true });
  deepEqual(spriteBlits(list.commands).map((command) => [command.source, command.dst]), [
    [{ asset: "tiles/hero.tst", tile: 1 }, { x: 48, y: 32, w: 32, h: 32 }],
  ]);
  // No marker rectangle anywhere in the frame, and the tile's own colour reaches the presented pixels.
  equal(list.commands.some((command) => command.kind === "rect" && command.rgb.r === 64 && command.rgb.g === 96 && command.rgb.b === 224), false);
  const screen = presented(host);
  deepEqual(pixelAt(screen, 64, 48), [220, 30, 30, 255], "the first walk frame's tile colour is presented");
});

test("a wide animation frame naming a 32x32 cell draws one cell, not the header's width (#1258)", () => {
  // A 64x32 frame canvas whose art is a 32x32 tileset cell: the source may not read 64 pixels of a 32-pixel strip.
  const host = run(3, { walkFile: "hero_wide.anm", animation: walkAnimationBytes(64, 32) });
  deepEqual(host.diagnostics.map((diagnostic) => diagnostic.code), []);
  const list = host.engine.drawList(0, { shading: true, images: true, sprites: true });
  const blits = spriteBlits(list.commands);
  deepEqual(blits.map((command) => [command.src, command.dst]), [
    [{ x: 0, y: 0, w: 32, h: 32 }, { x: 32, y: 32, w: 32, h: 32 }],
  ]);
  const screen = presented(host);
  // The cell fills x 32..63 from the canvas origin; row 40 is inside the 32x32 cell.
  deepEqual(pixelAt(screen, 32, 40), [220, 30, 30, 255], "the first cell column is the tile");
  deepEqual(pixelAt(screen, 63, 40), [220, 30, 30, 255], "the cell's last column is still the tile");
  // No pixel of the frame is the second tile's colour: the source never walked into the adjacent cell.
  for (const x of [32, 47, 63]) {
    for (const y of [32, 47, 63]) equal(pixelAt(screen, x, y).join(",") === "30,200,60,255", false, `(${x}, ${y}) is the adjacent cell`);
  }
});

test("an animation frame that is a tile bitmap draws as its tile cells for the live renderer (#1262)", () => {
  const host = run(3, {
    walkFile: "hero_tbm.anm",
    animation: walkAnimationBytes(32, 32, ["hero_frame.tbm", "hero_frame.tbm"], { r: 255, g: 0, b: 255 }),
    extra: { "Bitmap/hero_frame.tbm": tileBitmapBytes() },
  });
  deepEqual(host.diagnostics.map((diagnostic) => diagnostic.code), []);
  // The bitmap's bytes are read for its cells, and the cell's tile is the asset a runner decodes.
  equal(host.requests.includes("bitmap/hero_frame.tbm" as AssetKey), true, JSON.stringify(host.requests));
  equal(host.requests.includes("tiles/hero.tst" as AssetKey), true, JSON.stringify(host.requests));
  const list = host.engine.drawList(0, { shading: true, images: true, sprites: true });
  deepEqual(spriteBlits(list.commands).map((command) => [command.source, command.dst]), [
    [{ asset: "tiles/hero.tst", tile: 1 }, { x: 48, y: 32, w: 32, h: 32 }],
  ]);
  // The live texture provider cannot decode a `.tbm`, so no command may name one (runner-harness/src/textures.ts).
  equal(list.commands.some((command) => command.kind === "blit" && "asset" in command.source && command.source.asset === "bitmap/hero_frame.tbm"), false);
  equal(list.commands.some((command) => command.kind === "rect" && command.rgb.r === 64 && command.rgb.g === 96 && command.rgb.b === 224), false);
  const screen = presented(host);
  deepEqual(pixelAt(screen, 64, 48), [220, 30, 30, 255], "the cell's tile colour is presented");
});

test("an animation frame that is a single tile .gph draws through the tile decoder (#1261)", () => {
  const host = run(3, {
    walkFile: "hero_gph.anm",
    animation: walkAnimationBytes(32, 32, ["hero.gph", "hero.gph"]),
    extra: { "Tiles/hero.gph": singleTileBytes() },
  });
  // The image decoder refuses a .gph; routing it there used to stop the game during preparation.
  deepEqual(host.diagnostics.map((diagnostic) => diagnostic.code), []);
  equal(host.state().world.board?.key, "boards/start.brd");
  equal(host.requests.includes("tiles/hero.gph" as AssetKey), true, JSON.stringify(host.requests));
  const list = host.engine.drawList(0, { shading: true, images: true, sprites: true });
  deepEqual(blitsOf(list.commands, "tiles/hero.gph").map((command) => [command.source, command.dst]), [
    [{ asset: "tiles/hero.gph", tile: null }, { x: 48, y: 32, w: 32, h: 32 }],
  ]);
  equal(list.commands.some((command) => command.kind === "rect" && command.rgb.r === 64 && command.rgb.g === 96 && command.rgb.b === 224), false);
  const screen = presented(host);
  deepEqual(pixelAt(screen, 64, 48), [20, 40, 220, 255], "the single tile's colour is presented");
});

test("walk frames advance once per animation delay and the draw follows the frame (#1252)", () => {
  // 0.15 s at 60 Hz is 9 ticks: tick 3 is still frame 0; by tick 15 the second frame owns the draw.
  const first = run(3);
  equal(first.state().sprites.players[0]?.visual.frame, 0);
  const later = run(15);
  const player = later.state().sprites.players[0];
  equal(player?.visual.frame, 1);
  const list = later.engine.drawList(0, { shading: true, images: true, sprites: true });
  deepEqual(spriteBlits(list.commands).map((command) => command.source), [{ asset: "tiles/hero.tst", tile: 2 }]);
});

test("a tile-bitmap cell keeps its tile's own size: a 16x16 .gph fills a quarter of the cell (#1265)", () => {
  const host = run(3, {
    walkFile: "hero_small.anm",
    animation: walkAnimationBytes(32, 32, ["hero_small.tbm", "hero_small.tbm"]),
    extra: {
      "Bitmap/hero_small.tbm": tileBitmapBytes("small.gph"),
      "Tiles/small.gph": singleTileBytes(16, [200, 20, 200]),
    },
  });
  deepEqual(host.diagnostics.map((diagnostic) => diagnostic.code), []);
  const list = host.engine.drawList(0, { shading: true, images: true, sprites: true });
  // A 16x16 single tile is drawn at its own size from the cell's corner; the 32x32 default would read past it.
  deepEqual(blitsOf(list.commands, "tiles/small.gph").map((command) => [command.source, command.src, command.dst]), [
    [{ asset: "tiles/small.gph", tile: 1 }, { x: 0, y: 0, w: 16, h: 16 }, { x: 48, y: 32, w: 16, h: 16 }],
  ]);
  const screen = presented(host);
  deepEqual(pixelAt(screen, 52, 36), [200, 20, 200, 255], "the 16x16 tile is in the cell's top-left quarter");
  // The rest of the 32x32 cell stays transparent: the board behind shows through, not the tile.
  equal(pixelAt(screen, 68, 52).join(",") === "200,20,200,255", false, "the cell's other quarters are empty");
});

test("a tile-bitmap frame keeps its transparent colour key (#1266)", () => {
  const red = { r: 220, g: 30, b: 30 };
  const keyed = run(3, {
    walkFile: "hero_keyed.anm",
    animation: walkAnimationBytes(32, 32, ["hero_frame.tbm", "hero_frame.tbm"], red),
    extra: { "Bitmap/hero_frame.tbm": tileBitmapBytes() },
  });
  deepEqual(keyed.diagnostics.map((diagnostic) => diagnostic.code), []);
  const keyedBlit = spriteBlits(keyed.engine.drawList(0, { shading: true, images: true, sprites: true }).commands)[0];
  deepEqual(keyedBlit?.key, red, "the frame's transparent colour is the blit key");
  equal(pixelAt(presented(keyed), 64, 48).join(",") === "220,30,30,255", false, "the keyed-out red leaves the board behind");

  const shown = run(3, {
    walkFile: "hero_keyed_white.anm",
    animation: walkAnimationBytes(32, 32, ["hero_frame.tbm", "hero_frame.tbm"]),
    extra: { "Bitmap/hero_frame.tbm": tileBitmapBytes() },
  });
  deepEqual(pixelAt(presented(shown), 64, 48), [220, 30, 30, 255], "a white key leaves the red tile visible");
});

test("an all-empty tile-bitmap frame is transparent, not the fallback marker (#1267)", () => {
  const host = run(3, {
    walkFile: "hero_empty.anm",
    animation: walkAnimationBytes(32, 32, ["hero_empty.tbm", "hero_empty.tbm"]),
    extra: { "Bitmap/hero_empty.tbm": tileBitmapBytes("") },
  });
  deepEqual(host.diagnostics.map((diagnostic) => diagnostic.code), []);
  const list = host.engine.drawList(0, { shading: true, images: true, sprites: true });
  // The bitmap decodes to no cells: a valid transparent picture draws nothing and is not the marker.
  equal(list.commands.some((command) => command.kind === "rect" && command.rgb.r === 64 && command.rgb.g === 96 && command.rgb.b === 224), false);
  equal(list.commands.some((command) => command.kind === "blit" && "asset" in command.source && (command.source.asset === "bitmap/hero_empty.tbm" || command.source.asset === "tiles/hero.tst")), false);
  equal(pixelAt(presented(host), 64, 48).join(",") === "64,96,224,255", false, "no marker is presented");
});

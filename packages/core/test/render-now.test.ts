// Engine-level checks of the drawing seams the default battle screen stands on (docs/spec/engine/main-loop-and-startup.md#e-57,
// docs/spec/engine/rpgcode-functions.md#e-56, #reawakened-pinnedanimation, docs/spec/engine/display-input-audio.md#e-110).
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { SCRIPT_SCREEN } from "../src/raster/surfaces.ts";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  readSurfacePixels,
  renderNowEnabled,
  SINGLE_TILE_MAGIC,
  TILE_BITMAP_MAGIC,
  writeAnimation,
  writeBoard,
  writeCharacter,
  writeMainFile,
  writeTileBitmap,
  writeSingleTile,
  writeTileset,
  type Engine,
  type GameState,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const here = dirname(fileURLToPath(import.meta.url));
const font = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "fonts", "tkr-8x8.fnt")));
const encoder = new TextEncoder();
const SIZE = 64;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

type Game = {
  readonly engine: Engine;
  readonly requests: { readonly key: string; readonly tick: number }[];
  readonly animationReadiness: { readonly tick: number; readonly id: number; readonly loaded: boolean }[];
  state(): GameState;
  advance(ticks: number, keys?: readonly string[]): void;
  frame(): { readonly w: number; readonly h: number; readonly rgba: Uint8Array };
};

/** A tiny game whose start program is `program`; `extra` are more authored files by path. */
function boot(program: string, extra: Readonly<Record<string, Uint8Array>> = {}, eager = false): Game {
  const empty = createEmptyBoard();
  const files = new Map<string, Uint8Array>();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg", ...Object.keys(extra)];
  files.set(assetKey("main.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" })));
  files.set(assetKey("boards/start.brd"), unwrap(writeBoard({
    ...empty, sizeX: 40, sizeY: 30, sizeL: 1, tileMatrix: Array.from({ length: 1200 }, () => 0), tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""], properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  })));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(program));
  for (const [path, bytes] of Object.entries(extra)) files.set(assetKey(path), bytes);
  let latest: GameState | null = null;
  const animationReadiness: { readonly tick: number; readonly id: number; readonly loaded: boolean }[] = [];
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-ui-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SIZE,
    height: SIZE,
    maxTicks: 1000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    ...(eager ? { scriptObservers: {} } : {}),
    phaseRegistrations: [
      { phase: "input", run: (state) => {
        for (const animation of state.fx.animations ?? []) animationReadiness.push({ tick: state.time.tick, id: animation.id, loaded: animation.loaded });
      } },
      { phase: "audio", run: (state) => { latest = state; } },
    ],
  });
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } | { readonly kind: "key"; readonly name: string; readonly code: string; readonly char: null; readonly down: boolean } }[] = [];
  const game: Game = {
    engine,
    requests: [],
    animationReadiness,
    state() {
      if (latest === null) throw new Error("no tick has run");
      return latest;
    },
    advance(ticks, keys = []) {
      for (let remaining = ticks; remaining > 0;) {
        const tick = latest?.time.tick ?? 0;
        const inputs = keys.length === 0 ? [] : keys.flatMap((name, index) => [
          { tick: tick + index * 2, event: { kind: "key" as const, name, code: name, char: null, down: true } },
          { tick: tick + index * 2 + 1, event: { kind: "key" as const, name, code: name, char: null, down: false } },
        ]);
        keys = [];
        const report = engine.advance(1, [...replies, ...inputs] as never);
        remaining -= 1;
        replies = [];
        if (report.diagnostics.length > 0) throw new Error(`diagnostics: ${JSON.stringify(report.diagnostics)}`);
        for (const request of report.requests) {
          if (request.kind === "asset") {
            game.requests.push({ key: request.key, tick: report.tickAfter });
            replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
          }
        }
      }
    },
    frame() {
      engine.surfacePixels(0 as never, -1);
      const surface = engine.surfacePixels(0 as never, game.state().surfaces.entries["0"]!.rev);
      if (surface === null) throw new Error("the frame is not readable");
      return surface;
    },
  };
  game.advance(40);
  return game;
}

function pixel(image: { readonly w: number; readonly rgba: Uint8Array }, x: number, y: number): number[] {
  return [...image.rgba.slice((y * image.w + x) * 4, (y * image.w + x) * 4 + 4)];
}

function canvasPixel(game: Game, handle: number, x: number, y: number): number[] {
  const surfaces = game.state().surfaces;
  const rev = surfaces.entries[String(handle)]!.rev;
  const pixels = readSurfacePixels(surfaces, handle as never, rev);
  if (pixels === null) throw new Error("the canvas is not readable");
  return pixel(pixels, x, y);
}

test("an enabled render-now canvas is composed above the board and a disabled one adds nothing", () => {
  const on = boot("rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nend()\n");
  deepEqual(pixel(on.frame(), 10, 10), [255, 0, 0, 255], "the canvas pixel shows in the frame");
  deepEqual(pixel(on.frame(), 40, 40), [0, 0, 0, 255], "clear canvas pixels leave the board visible");
  const blits = on.engine.drawList().commands.filter((command) => command.kind === "blit" && "surface" in command.source);
  equal(blits.length, 1, "one 1:1 blit of the canvas");
  const off = boot("rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nrendernow(0)\nend()\n");
  deepEqual(pixel(off.frame(), 10, 10), [0, 0, 0, 255], "rendernow(0) removes the overlay");
  equal(off.engine.drawList().commands.some((command) => command.kind === "blit" && "surface" in command.source), false);
});

/** Screen-sized surfaces that are canvases: the presented frame and the script-screen layer are not. */
function bigSurfaces(game: Game): number {
  const surfaces = game.state().surfaces;
  return Object.values(surfaces.entries).filter((entry) => entry.id !== (0 as never) && entry.id !== SCRIPT_SCREEN && entry.bitmap.w === SIZE && entry.bitmap.h === SIZE).length;
}

test("rendernow(false) only switches drawing off: the reserved canvas, its handle and its pixels persist, and rendernow(true) shows it as it was", () => {
  const game = boot("rendernow(1)\nfirst = cnvrendernow\non1 = rendernowenabled()\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,first)\nrendernow(0)\noff = cnvrendernow\non2 = rendernowenabled()\nrendernow(1)\nsecond = cnvrendernow\non3 = rendernowenabled()\nn = 0\nwhile (n < 5) {\n  rendernow(0)\n  rendernow(1)\n  n = n + 1\n}\nend()\n");
  const globals = game.state().vm.globals;
  ok(typeof globals.first === "number" && globals.first > 0);
  equal(globals.off, globals.first, "the handle persists while drawing is off");
  equal(globals.second, globals.first, "switching on again keeps the same canvas");
  deepEqual([globals.on1, globals.on2, globals.on3], [1, 0, 1], "rendernowenabled follows the flag");
  equal(bigSurfaces(game), 1, "five more off/on toggles still leave exactly one screen-sized canvas");
  deepEqual(canvasPixel(game, globals.first as number, 10, 10), [255, 0, 0, 255], "its pixels survived the toggles");
  deepEqual(pixel(game.frame(), 10, 10), [255, 0, 0, 255], "and it is drawn again");
  const off = boot("rendernow(1)\ncolorrgb(0,0,255)\nfillrect(0,0,20,20,cnvrendernow)\nrendernow(0)\nend()\n");
  equal(bigSurfaces(off), 1, "switched off, the canvas is still allocated");
  equal(off.state().surfaces.renderNowOn, false, "the saved state records the flag");
  deepEqual(pixel(off.frame(), 10, 10), [0, 0, 0, 255], "an off canvas adds nothing to the frame");
  deepEqual(canvasPixel(off, off.state().surfaces.renderNow as number, 10, 10), [0, 0, 255, 255], "its pixels are still there");
});

test("a killed reserved canvas is made again by rendernow(true), and an older save that names a handle without the flag means on", () => {
  const game = boot("rendernow(1)\nfirst = cnvrendernow\nkillcanvas(first)\nafterkill = cnvrendernow\nrendernow(1)\nsecond = cnvrendernow\ncolorrgb(0,255,0)\nfillrect(0,0,20,20,second)\nend()\n");
  const globals = game.state().vm.globals;
  equal(globals.afterkill, 0, "a killed canvas is no canvas");
  ok(typeof globals.second === "number" && globals.second > 0 && globals.second !== globals.first);
  deepEqual(pixel(game.frame(), 10, 10), [0, 255, 0, 255]);
  const legacy = game.state().surfaces;
  delete legacy.renderNowOn;
  ok(renderNowEnabled(legacy), "no flag and a live handle: on, as older saves meant");
});

test("text and pixelText with a canvas draw into that canvas, not the screen text layer", () => {
  const game = boot('rendernow(1)\nc = cnvrendernow\ncolorrgb(255,255,255)\npixelText(2,24,"HI",c)\ntext(1,5,"A",c)\nend()\n');
  const handle = game.state().surfaces.renderNow ?? 0;
  ok(handle > 0);
  let lit = 0;
  for (let y = 24; y < 32; y += 1) for (let x = 0; x < 20; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) lit += 1;
  ok(lit > 10, `the glyphs are in the canvas (${lit} pixels)`);
  let cell = 0;
  for (let y = 32; y < 40; y += 1) for (let x = 0; x < 8; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) cell += 1;
  ok(cell > 3, "text(1,5) lands in the fifth cell row of the canvas");
  equal(game.state().ui.draws.length, 0, "the screen text layer got nothing");
});

test("canvas cell text keeps a fractional cell coordinate and truncates the scaled origin (E-56)", () => {
  const game = boot('rendernow(1)\nc = cnvrendernow\ncolorrgb(255,255,255)\ntext(1.5,5.9,"A",c)\nend()\n');
  const handle = game.state().surfaces.renderNow ?? 0;
  ok(handle > 0);
  let leftHalf = 0;
  let glyph = 0;
  for (let y = 39; y < 47; y += 1) {
    for (let x = 0; x < 4; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) leftHalf += 1;
    for (let x = 4; x < 12; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) glyph += 1;
  }
  equal(leftHalf, 0, "the fractional 1.5 keeps its half cell: x is trunc(0.5 × 8) = 4, not cell 0");
  ok(glyph > 3, `the glyphs start at x=4, y=trunc(4.9 × 8)=39 (${glyph} pixels)`);
  let truncatedRow = 0;
  for (let y = 32; y < 39; y += 1) for (let x = 4; x < 12; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) truncatedRow += 1;
  equal(truncatedRow, 0, "truncating the cell first would put the glyphs at y=32; the scaled pixel origin is 39");
});

test("canvas text interleaved with graphics and rendernow has eager and batched pixel parity", () => {
  const program = 'rendernow(1)\nc = cnvrendernow\ncolorrgb(10,20,30)\nfillrect(0,0,63,63,c)\ncolorrgb(255,255,255)\npixelText(2,8,"HI",c)\nsetpixel(63,63,c)\ntext(1,4,"A",c)\nrendernow(0)\nrendernow(1)\nend()\n';
  const batched = boot(program);
  const eager = boot(program, {}, true);
  const a = batched.state().surfaces;
  const b = eager.state().surfaces;
  const id = a.renderNow!;
  deepEqual(a.entries[String(id)], b.entries[String(b.renderNow!)]);
  deepEqual(batched.frame().rgba, eager.frame().rgba);
  equal(a.renderNowOn, true);
  deepEqual(canvasPixel(batched, id, 63, 63), [255, 255, 255, 255]);
});

function solid(r: number, g: number, b: number): Uint8Array {
  const pixels = new Uint8Array(16 * 16 * 4);
  for (let at = 0; at < pixels.length; at += 4) pixels.set([r, g, b, 255], at);
  return pixels;
}

/** A two-frame 16 x 16 animation (red then green) whose delay is `delay` seconds. */
function redGreen(delay: number): Record<string, Uint8Array> {
  const animation = unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 16, height: 16,
    frames: [
      { image: "red.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
      { image: "green.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
    ],
    delay, residue: new Uint8Array(),
  }));
  return { "Misc/blink.anm": animation, "Bitmap/red.png": encodePng(16, 16, solid(255, 0, 0)), "Bitmap/green.png": encodePng(16, 16, solid(0, 255, 0)) };
}

/** A wide canvas whose first frame names a smaller picture or a single tileset cell. */
function wideAnimation(image: string): Uint8Array {
  return unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 64, height: 32,
    frames: [{ image, transparent: { r: 255, g: 0, b: 255 }, sound: "" }],
    delay: 1, residue: new Uint8Array(),
  }));
}

function wideFiles(image: string): Record<string, Uint8Array> {
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba.set([20, 40, 220, 255], at);
  const tile = (r: number, g: number, b: number): Uint8Array => {
    const pixels = new Uint8Array(32 * 32 * 3);
    for (let at = 0; at < pixels.length; at += 3) pixels.set([r, g, b], at);
    return pixels;
  };
  return {
    ...redGreen(1),
    "Misc/wide.anm": wideAnimation(image),
    "Bitmap/blue.png": encodePng(32, 32, rgba),
    "Tiles/two.tst": unwrap(writeTileset({
      version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
      tiles: [{ pixels: tile(220, 30, 30) }, { pixels: tile(30, 200, 60) }], residue: new Uint8Array(),
    })),
    "Tiles/one.gph": encoder.encode(writeSingleTile({
      magic: SINGLE_TILE_MAGIC, major: 2, minor: 0, detail: 1, compression: 0,
      width: 32, height: 32, pixels: Array(32 * 32).fill(220 + 30 * 256 + 30 * 65536),
    })),
    "Bitmap/one.tbm": unwrap(writeTileBitmap({
      magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 1, height: 1,
      cells: [{ tile: "two.tst1", r: 0, g: 0, b: 0 }, ...Array.from({ length: 3 }, () => ({ tile: "", r: 0, g: 0, b: 0 }))],
      residue: new Uint8Array(),
    })),
    "Bitmap/multi.tbm": unwrap(writeTileBitmap({
      magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 2, height: 1,
      cells: [
        { tile: "two.tst1", r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
        { tile: "one.gph", r: 0, g: 0, b: 0 }, ...Array.from({ length: 3 }, () => ({ tile: "", r: 0, g: 0, b: 0 })),
      ], residue: new Uint8Array(),
    })),
  };
}

for (const command of ["animation", "pinnedanimation"] as const) {
  test(`${command} samples the picture, fills its canvas and permits later draws (#1271)`, () => {
    const game = boot(`id = ${command}("wide.anm", 0, 0, 1)\nother = pinnedanimation("blink.anm", 48, 48, 1)\nthreadSleep(getThreadId(), 120)\nend()\n`, wideFiles("blue.png"));
    const commands = game.engine.drawList(0, { shading: true, images: true, sprites: true }).commands;
    const picture = commands.find((entry) => entry.kind === "blit" && "asset" in entry.source && entry.source.asset === "bitmap/blue.png");
    ok(picture?.kind === "blit");
    deepEqual(picture.src, { x: 0, y: 0, w: 32, h: 32 });
    deepEqual(picture.dst, { x: 0, y: 0, w: 64, h: 32 });
    deepEqual([picture.key, picture.tint, picture.alpha, picture.blend], [{ r: 255, g: 0, b: 255 }, { r: 0, g: 0, b: 0 }, 255, "normal"]);
    const screen = game.frame();
    deepEqual(pixel(screen, 8, 8), [20, 40, 220, 255]);
    deepEqual(pixel(screen, 56, 8), [20, 40, 220, 255]);
    deepEqual(pixel(screen, 56, 56), [255, 0, 0, 255], "the subsequent animation was rasterised");
  });
}

test("a script animation samples one tileset cell, not its neighbour (#1271)", () => {
  const game = boot('id = animation("wide.anm", 0, 0, 1)\nthreadSleep(getThreadId(), 120)\nend()\n', wideFiles("two.tst1"));
  const command = game.engine.drawList(0, { shading: true, images: true, sprites: true }).commands
    .find((entry) => entry.kind === "blit" && "asset" in entry.source && entry.source.asset === "tiles/two.tst");
  ok(command?.kind === "blit");
  deepEqual(command.src, { x: 0, y: 0, w: 32, h: 32 });
  deepEqual(command.dst, { x: 0, y: 0, w: 64, h: 32 });
  const screen = game.frame();
  deepEqual(pixel(screen, 8, 8), [220, 30, 30, 255]);
  deepEqual(pixel(screen, 56, 8), [220, 30, 30, 255], "the adjacent green cell is never sampled");
});

test("a script animation samples a single tile at its own size (#1271)", () => {
  const game = boot('id = animation("wide.anm", 0, 0, 1)\nthreadSleep(getThreadId(), 120)\nend()\n', wideFiles("one.gph"));
  const command = game.engine.drawList(0, { shading: true, images: true, sprites: true }).commands
    .find((entry) => entry.kind === "blit" && "asset" in entry.source && entry.source.asset === "tiles/one.gph");
  ok(command?.kind === "blit");
  deepEqual(command.src, { x: 0, y: 0, w: 32, h: 32 });
  deepEqual(command.dst, { x: 0, y: 0, w: 64, h: 32 });
  deepEqual(pixel(game.frame(), 56, 8), [220, 30, 30, 255]);
});

test("a sized script animation samples a composed tile bitmap at its own size (#1271)", () => {
  const game = boot('id = sizedanimation("wide.anm", 0, 0, 24, 48, 1)\nthreadSleep(getThreadId(), 120)\nend()\n', wideFiles("one.tbm"));
  const command = game.engine.drawList(0, { shading: true, images: true, sprites: true }).commands
    .find((entry) => entry.kind === "blit" && "asset" in entry.source && entry.source.asset === "bitmap/one.tbm");
  ok(command?.kind === "blit");
  deepEqual(command.src, { x: 0, y: 0, w: 32, h: 32 });
  deepEqual(command.dst, { x: 0, y: 0, w: 48, h: 24 });
  deepEqual(pixel(game.frame(), 40, 12), [220, 30, 30, 255]);
});

test("tile-bitmap animation waits for every picture dependency before its clock starts (#1321)", () => {
  const game = boot('id = animation("wide.anm", 0, 0, 1)\nthreadSleep(getThreadId(), 120)\nend()\n', wideFiles("multi.tbm"));
  const first = game.requests.find((entry) => entry.key === "tiles/two.tst");
  const second = game.requests.find((entry) => entry.key === "tiles/one.gph");
  ok(first !== undefined && second !== undefined);
  equal(second.tick, first.tick, "no simulation tick runs while either picture dependency is pending");
  const animation = game.state().fx.animations[0];
  ok(animation !== undefined && animation.loaded);
  ok(animation.originTick >= second.tick, "the animation starts after both picture dependencies are available");
  deepEqual(pixel(game.frame(), 56, 8), [220, 30, 30, 255]);
});

test("a pinned animation with one picture keeps its original animation-phase start tick", () => {
  const animation = unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 16, height: 16,
    frames: [
      { image: "red.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
      { image: "red.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" },
    ],
    delay: 0.017, residue: new Uint8Array(),
  }));
  const game = boot('id = pinnedanimation("timing.anm", 4, 4, 1)\nthreadSleep(getThreadId(), 120)\nend()\n', {
    "Misc/timing.anm": animation,
    "Bitmap/red.png": encodePng(16, 16, solid(255, 0, 0)),
  });
  const loaded = game.state().fx.animations[0];
  ok(loaded !== undefined && loaded.loaded);
  const firstLoadedPhase = game.animationReadiness.find((sample) => sample.id === loaded.id && sample.loaded);
  ok(firstLoadedPhase !== undefined);
  equal(firstLoadedPhase.tick, loaded.originTick + 1, "a single-picture animation becomes loaded in the animation phase, not pre-tick drive");
});

const PAINT_CANVAS_WHITE = "rendernow(1)\nc = cnvrendernow\ncolorrgb(255,255,255)\nfillrect(0,0,40,40,c)\n";

test("a pinned animation shows every frame of a one-tick delay on its own tick while the script is busy, above the render-now canvas", () => {
  // 0.017 s is one 60 Hz tick. The loop burns the whole step budget every tick, so a script that had to draw the
  // frames itself could not keep up; the engine plays the animation.
  const game = boot(`${PAINT_CANVAS_WHITE}id = pinnedanimation("blink.anm", 4, 4, 1)\nn = 0\nwhile (1) {\n  n = n + 1\n}\n`, redGreen(0.017));
  const seen: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    game.advance(1);
    const frame = game.frame();
    const colour = pixel(frame, 10, 10);
    seen.push(colour[0] === 255 && colour[1] === 0 ? "red" : colour[1] === 255 && colour[0] === 0 ? "green" : `other ${colour.join(",")}`);
    deepEqual(pixel(frame, 30, 30), [255, 255, 255, 255], "the canvas still shows outside the picture");
  }
  ok(seen.every((name, index) => name === (index === 0 ? seen[0] : seen[index - 1] === "red" ? "green" : "red")), `alternates every tick: ${seen.join(" ")}`);
  ok(seen[0] === "red" || seen[0] === "green", `a frame shows above the canvas: ${seen[0]}`);
});

test("an ordinary animation still draws below the render-now canvas and is saved without the pinned flag", () => {
  const game = boot(`${PAINT_CANVAS_WHITE}id = animation("blink.anm", 4, 4, 1)\nthreadSleep(getThreadId(), 5)\nend()\n`, redGreen(0.017));
  deepEqual(pixel(game.frame(), 10, 10), [255, 255, 255, 255], "the canvas covers an ordinary animation");
  const animations = game.state().fx.animations;
  equal(animations.length, 1);
  equal(animations[0]!.pinned, undefined, "an ordinary animation records no pinned flag");
  const bare = boot("id = animation(\"blink.anm\", 4, 4, 1)\nthreadSleep(getThreadId(), 5)\nend()\n", redGreen(0.017));
  const colour = pixel(bare.frame(), 10, 10);
  ok(colour[3] === 255 && (colour[0] === 255 || colour[1] === 255), `with no canvas the animation's picture shows (${colour.join(",")})`);
});

test("a one-shot pinned animation holds its last frame until endanimation, which an ordinary one-shot does not", () => {
  const pinned = boot(`${PAINT_CANVAS_WHITE}id = pinnedanimation("blink.anm", 4, 4, 0)\nthreadSleep(getThreadId(), 1)\nendanimation(id)\nthreadSleep(getThreadId(), 5)\nend()\n`, redGreen(0.1));
  // The animation lasts 12 ticks; boot has run 40, so a pinned one has held its last frame (green) for a while.
  deepEqual(pixel(pinned.frame(), 10, 10), [0, 255, 0, 255], "the last frame is still shown after the one-shot ended");
  equal(pinned.state().fx.animations[0]!.pinned, true, "the saved animation records that it is pinned");
  pinned.advance(40);
  deepEqual(pixel(pinned.frame(), 10, 10), [255, 255, 255, 255], "endanimation removes it and the canvas shows again");
  equal(pinned.state().fx.animations.length, 0);
  const ordinary = boot("id = animation(\"blink.anm\", 4, 4, 0)\nthreadSleep(getThreadId(), 5)\nend()\n", redGreen(0.1));
  equal(ordinary.state().fx.animations.length, 0, "an ordinary one-shot is removed when it ends");
});

test("a hidden pinned animation keeps its timeline: a held last frame is not replayed when it is shown again", () => {
  const game = boot(`${PAINT_CANVAS_WHITE}id = pinnedanimation("blink.anm", 4, 4, 0)\nthreadSleep(getThreadId(), 1)\nshowpinnedanimation(id, 0)\nthreadSleep(getThreadId(), 1)\nshowpinnedanimation(id, 1)\nthreadSleep(getThreadId(), 5)\nend()\n`, redGreen(0.1));
  const origin = game.state().fx.animations[0]!.originTick;
  deepEqual(pixel(game.frame(), 10, 10), [0, 255, 0, 255], "the one-shot has played and holds green");
  game.advance(30);
  deepEqual(pixel(game.frame(), 10, 10), [255, 255, 255, 255], "hidden, it is not drawn and the canvas shows");
  const hidden = game.state().fx.animations[0]!;
  equal(hidden.hidden, true, "the saved animation records that it is hidden");
  equal(hidden.originTick, origin, "hiding did not restart it");
  equal(hidden.frame, 1, "its timeline kept its last frame");
  game.advance(60);
  deepEqual(pixel(game.frame(), 10, 10), [0, 255, 0, 255], "shown again it is still on the held last frame, not replaying from red");
  const shown = game.state().fx.animations[0]!;
  equal(shown.hidden, undefined);
  equal(shown.originTick, origin);
});

test("ending and finishing animations releases the surfaces decoded for an animated GIF", () => {
  const gif = new Uint8Array(readFileSync(join(here, "fixtures", "authored", "gif-anim89a.gif")));
  const extra = { "Bitmap/spin.gif": gif };
  const baseline = Object.keys(boot("end()\n", extra).state().surfaces.entries).length;
  const restarted = boot("n = 0\nwhile (n < 4) {\n  id = pinnedanimation(\"spin.gif\", 0, 0, 1)\n  threadSleep(getThreadId(), 6/60)\n  endanimation(id)\n  n = n + 1\n}\nend()\n", extra);
  restarted.advance(10);
  equal(restarted.state().fx.animations.length, 0);
  equal(Object.keys(restarted.state().surfaces.entries).length, baseline, "four start/end cycles leave no GIF frame surface behind");
  const finished = boot("id = animation(\"spin.gif\", 0, 0, 0)\nthreadSleep(getThreadId(), 3)\nend()\n", extra);
  finished.advance(150);
  equal(finished.state().fx.animations.length, 0, "the one-shot finished and was removed");
  equal(Object.keys(finished.state().surfaces.entries).length, baseline, "its frame surfaces were released when it finished");
});

test("get() returns a pressed key once and never again, and clearbuffer() empties the queue", () => {
  const game = boot("count = 0\nloops = 0\nwhile (loops < 100) {\n  k = get()\n  if (k != \"\") {\n    count = count + 1\n  }\n  loops = loops + 1\n  threadSleep(getThreadId(), 1/60)\n}\ndone = 1\nend()\n");
  game.advance(2, ["DOWN"]);
  game.advance(80);
  equal(game.state().vm.globals.done, 1);
  equal(game.state().vm.globals.count, 1, "one press is one key");
  equal(game.state().input.keys.length, 0, "the claimed key left the queue");
});

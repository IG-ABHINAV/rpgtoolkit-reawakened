import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createGameState,
  createSurfacesSection,
  decodeSurfaceBytes,
  encodeSurfaceBytes,
  blitSurface,
  getPixel,
  GRAPHICS_PLUGIN,
  readSurfacePixels,
  type Arg,
  type CommandView,
  type SurfaceId,
} from "../src/index.ts";
import { beginSurfaceBatch, endSurfaceBatch, flushSurfaceBatch, SCRIPT_SCREEN } from "../src/raster/surfaces.ts";
import type { SurfacesSection } from "../src/save/sections/surfaces.ts";

function arg(value: unknown, ref: string | null = null): Arg {
  return { value: value as never, ref: ref as never };
}

function command(name: string) {
  const found = GRAPHICS_PLUGIN.commands.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing graphics command ${name}`);
  return found;
}

function view() {
  const state = createGameState({ seed: 1 });
  state.surfaces = createSurfacesSection(8, 8);
  // A scene with no board: the composed frame is the script-screen layer drawn over an empty background.
  const refreshScreen = (): void => {
    if (state.surfaces.entries[String(SCRIPT_SCREEN)] === undefined) return;
    blitSurface(state.surfaces, SCRIPT_SCREEN, 0 as SurfaceId, 0, 0);
  };
  const commandView: CommandView = { state, rng: { nextUint32: () => 0 }, clock: { tick: () => 0 }, gameId: "test-game", refreshScreen };
  return { state, commandView };
}

test("graphics pack registers all canvas and drawing names with the restore alias", () => {
  const names = GRAPHICS_PLUGIN.commands.flatMap((entry) => [entry.name, ...entry.aliases]);
  for (const name of ["createcanvas", "killcanvas", "drawcanvas", "drawcanvastransparent", "canvasdrawpart", "canvasgetscreen", "clear", "bitmap", "setimage", "setimagetransparent", "setimagetranslucent", "setimageadditive", "drawline", "drawrect", "fillrect", "drawcircle", "fillcircle", "setpixel", "getpixel", "savescreen", "restorescreen", "restorescreenarray", "restorearrayscreen", "rendernow", "viewbrd", "getres", "drawenemy"]) {
    equal(names.includes(name), true, name);
  }
});

test("drawing primitives mutate persistent canvases and getPixel writes all outputs", () => {
  const { state, commandView } = view();
  const create = command("createcanvas").call(commandView, [arg(4), arg(4), arg(0, "global:canvas")], () => ({ value: null }));
  const canvas = create.value as number;
  equal(typeof canvas, "number");
  command("setpixel").call(commandView, [arg(1), arg(1), arg(canvas)], () => ({ value: null }));
  command("drawline").call(commandView, [arg(0), arg(0), arg(3), arg(0), arg(canvas)], () => ({ value: null }));
  command("fillrect").call(commandView, [arg(2), arg(2), arg(3), arg(3), arg(canvas)], () => ({ value: null }));
  deepEqual(getPixel(state.surfaces, canvas as never, 1, 1), { r: 255, g: 255, b: 255 });
  deepEqual(getPixel(state.surfaces, canvas as never, 3, 3), { r: 255, g: 255, b: 255 });
  const output = command("getpixel").call(commandView, [arg(1), arg(1), arg(0, "global:r"), arg(0, "global:g"), arg(0, "global:b"), arg(canvas)], () => ({ value: null }));
  deepEqual(output.out, [[2, 255], [3, 255], [4, 255]]);
});

test("canvas blits, screen capture and numbered screen restore use surface revisions", () => {
  const { state, commandView } = view();
  const create = command("createcanvas").call(commandView, [arg(2), arg(2)], () => ({ value: null }));
  const canvas = create.value as number;
  command("setpixel").call(commandView, [arg(0), arg(0), arg(canvas)], () => ({ value: null }));
  // A draw that names no destination lands on the script-screen layer, not on the derived presented frame.
  command("drawcanvas").call(commandView, [arg(canvas), arg(2), arg(2)], () => ({ value: null }));
  const layer = SCRIPT_SCREEN;
  equal(getPixel(state.surfaces, layer, 2, 2)?.r, 255);
  command("savescreen").call(commandView, [arg(2)], () => ({ value: null }));
  command("clear").call(commandView, [], () => ({ value: null }));
  equal(getPixel(state.surfaces, layer, 2, 2)?.r, 0, "clear blanks the layer a script draws on");
  command("restorescreen").call(commandView, [arg(2)], () => ({ value: null }));
  equal(getPixel(state.surfaces, layer, 2, 2)?.r, 255);
  commandView.refreshScreen?.();
  equal(getPixel(state.surfaces, 0 as never, 2, 2)?.r, 255, "the composed frame shows the restored layer");
});

type Section = SurfacesSection;

/** The saved snapshot must be the canonical encoding of the pixels commands and readers see. */
function assertSnapshotMatchesPixels(surfaces: Section, id: number, label: string): void {
  const entry = surfaces.entries[String(id)]!;
  const pixels = readSurfacePixels(surfaces, id as never, entry.rev)!.rgba;
  equal(entry.bitmap.b64, encodeSurfaceBytes(pixels), `${label}: b64 is stale or non-canonical`);
  deepEqual(decodeSurfaceBytes(entry.bitmap.b64), pixels, `${label}: b64 does not decode to the live pixels`);
}

const NONE = () => ({ value: null });

for (const mode of ["eager", "batched", "batched with a flush after every command"] as const) {
  test(`drawing commands handle offscreen, reversed, fractional and infinite inputs: ${mode}`, () => {
    const { state, commandView } = view();
    const run = (name: string, ...values: number[]) => {
      const result = command(name).call(commandView, values.map((value) => arg(value)), NONE);
      if (mode === "batched with a flush after every command") flushSurfaceBatch(state.surfaces);
      return result;
    };
    const canvas = command("createcanvas").call(commandView, [arg(8), arg(8)], NONE).value as number;
    if (mode !== "eager") beginSurfaceBatch(state.surfaces);
    try {
      run("setpixel", 2.8, 3.2, canvas);
      run("setpixel", -1.5, 3, canvas);
      run("setpixel", 10, 3, canvas);
      run("setpixel", Number.POSITIVE_INFINITY, 3, canvas);
      run("setpixel", Number.NaN, 3, canvas);
      run("fillrect", 6.7, 5.9, 4.1, 4.2, canvas); // reversed and fractional
      run("drawrect", 7, 7, 0, 0, canvas);
      run("drawline", 7.9, 0.1, 0.2, 7.8, canvas);
      run("fillcircle", 0.4, 0.4, 2.8, canvas); // partly offscreen
      run("drawcircle", -20.5, -20.5, 5.2, canvas); // wholly offscreen
      run("fillcircle", Number.NaN, 3, 2, canvas);
      run("fillcircle", Number.POSITIVE_INFINITY, 3, 2, canvas);
      // An infinite edge clips to the surface: this fills columns 5..7 of rows 1..2.
      run("fillrect", 5, 1, Number.POSITIVE_INFINITY, 2, canvas);
      run("fillrect", Number.NEGATIVE_INFINITY, 6, 1, 6, canvas);
      run("fillrect", Number.NaN, 0, 3, 3, canvas);
      if (mode === "eager") assertSnapshotMatchesPixels(state.surfaces, canvas, mode);
    } finally {
      if (mode !== "eager") endSurfaceBatch(state.surfaces);
    }
    const at = (x: number, y: number) => getPixel(state.surfaces, canvas as never, x, y)?.r;
    equal(at(2, 3), 255);
    equal(at(4, 4), 255);
    equal(at(6, 5), 255);
    equal(at(7, 5), 255); // on the drawrect outline's right edge
    equal(at(3, 5), 0);
    equal(at(0, 0), 255);
    equal(at(7, 7), 255);
    equal(at(7, 0), 255);
    equal(at(0, 7), 255);
    equal(at(1, 1), 255);
    equal(at(7, 1), 255);
    equal(at(7, 2), 255);
    equal(at(4, 1), 0);
    equal(at(0, 6), 255);
    equal(at(1, 6), 255);
    equal(at(2, 6), 0);
    assertSnapshotMatchesPixels(state.surfaces, canvas, `${mode} final`);
  });
}

test("random drawing, blit and clear commands keep every snapshot canonical and eager/batched states identical (seeded)", () => {
  let seed = 0x9f3a11;
  const next = (): number => {
    seed = (seed ^ (seed << 13)) >>> 0;
    seed = (seed ^ (seed >>> 17)) >>> 0;
    seed = (seed ^ (seed << 5)) >>> 0;
    return seed / 4294967296;
  };
  function pick<T>(items: readonly T[]): T {
    return items[Math.floor(next() * items.length)]!;
  }
  const SIZES = [[1, 1], [2, 2], [3, 1], [5, 7], [8, 8], [13, 5], [16, 16]] as const;
  for (let trial = 0; trial < 250; trial += 1) {
    const eager = view();
    const batched = view();
    const sizes = [pick(SIZES), pick(SIZES), pick(SIZES)];
    const canvases: number[] = [0];
    for (const [w, h] of sizes) {
      for (const side of [eager, batched]) {
        const id = command("createcanvas").call(side.commandView, [arg(w), arg(h)], NONE).value as number;
        if (side === eager) canvases.push(id);
      }
    }
    beginSurfaceBatch(batched.state.surfaces);
    try {
      for (let step = 0; step < 1 + Math.floor(next() * 14); step += 1) {
        const target = pick(canvases);
        const size = eager.state.surfaces.entries[String(target)]!.bitmap;
        const c = (extent: number, nonFinite = true): number => {
          const t = next();
          if (nonFinite && t < 0.07) return pick([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]);
          if (t < 0.5) return Math.floor(next() * (extent + 10)) - 5;
          if (t < 0.85) return next() * (extent + 10) - 5;
          return pick([0, extent - 1, extent, -1, 0.5]);
        };
        const colour = { r: Math.floor(next() * 256), g: Math.floor(next() * 256), b: Math.floor(next() * 256) };
        const name = pick(["setpixel", "fillrect", "drawrect", "drawline", "fillcircle", "drawcircle", "clear", "drawcanvas", "drawcanvas", "drawcanvastransparent", "canvasdrawpart", "canvasgetscreen"]);
        const finite = name === "drawrect" || name === "drawline";
        const source = pick(canvases);
        const args: number[] = name === "setpixel" ? [c(size.w), c(size.h), target]
          : name === "clear" ? [target]
          : name === "drawcircle" || name === "fillcircle" ? [c(size.w), c(size.h), pick([0, 1, 2.5, 4, 9, -1, 30]), target]
          : name === "drawcanvas" ? [source, c(size.w, false), c(size.h, false), pick([0, 1, 3, 9]), pick([0, 1, 3, 9]), target]
          : name === "drawcanvastransparent" ? [source, c(size.w, false), c(size.h, false), 7, 7, 7, pick([2, 4, 9]), pick([2, 4, 9]), target]
          : name === "canvasdrawpart" ? [source, c(size.w, false), c(size.h, false), pick([0, 1, 2]), pick([0, 1]), pick([1, 3, 8]), pick([1, 3, 8]), target]
          : name === "canvasgetscreen" ? [target]
          : [c(size.w, !finite), c(size.h, !finite), c(size.w, !finite), c(size.h, !finite), target];
        for (const side of [eager, batched]) {
          (side.state.ui as { colour?: unknown }).colour = colour;
          command(name).call(side.commandView, args.map((value) => arg(value)), NONE);
        }
        if (next() < 0.25) {
          flushSurfaceBatch(batched.state.surfaces);
          for (const id of canvases) assertSnapshotMatchesPixels(batched.state.surfaces, id, `trial ${trial} step ${step} ${name} flush`);
        }
      }
    } finally {
      endSurfaceBatch(batched.state.surfaces);
    }
    for (const id of canvases) {
      assertSnapshotMatchesPixels(eager.state.surfaces, id, `trial ${trial} eager`);
      assertSnapshotMatchesPixels(batched.state.surfaces, id, `trial ${trial} batched`);
    }
    equal(JSON.stringify(batched.state.surfaces), JSON.stringify(eager.state.surfaces), `trial ${trial}: batched state differs from the eager state`);
  }
});

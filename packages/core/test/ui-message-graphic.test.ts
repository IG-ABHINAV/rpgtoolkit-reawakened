// The message window's `winGraphic` background (E-55;
// docs/spec/engine/rpgcode-functions.md#reawakened-message-window-image): the engine resolves the reference through
// the asset index, fetches the picture, and the window draws it once its texture is decoded. #1243.
//
// The game and its picture are authored here from the format layouts (G7): a 600 x 100 PNG written with stored blocks.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  writeMainFile,
  type AssetKey,
  type Engine,
  type InputRecord,
  type SurfacePixels,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const encoder = new TextEncoder();
const WINDOW = { r: 200, g: 100, b: 40 } as const;

function mainFileBytes(startupPrg: string): Uint8Array {
  const written = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function messageWindowFiles(startup: string, graphic: Uint8Array | null): Map<AssetKey, Uint8Array> {
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), mainFileBytes("start.prg")],
    [assetKey("prg/start.prg"), encoder.encode(startup)],
  ]);
  if (graphic !== null) files.set(assetKey("bitmap/mwin.png"), graphic);
  return files;
}

function engineFor(files: Map<AssetKey, Uint8Array>): Engine {
  return createEngine({
    seed: 5,
    assetIndex: createAssetIndex([...files.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "message-graphic-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 640,
    height: 480,
    maxTicks: 30,
  });
}

/** Advance with the host's asset replies, as a runner does, and collect every request the engine made. */
function run(engine: Engine, files: Map<AssetKey, Uint8Array>, ticks: number): { readonly requested: readonly AssetKey[]; readonly diagnostics: readonly string[] } {
  const requested: AssetKey[] = [];
  const diagnostics: string[] = [];
  let replies: InputRecord[] = [];
  let remaining = ticks;
  for (let guard = 0; guard < 60; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    remaining -= report.ticksRun;
    diagnostics.push(...report.diagnostics.map((entry) => entry.code));
    const assetRequests = report.requests.flatMap((request) => (request.kind === "asset" ? [request] : []));
    for (const request of assetRequests) requested.push(request.key);
    if (report.loading || assetRequests.length > 0) {
      replies = assetRequests.map((request) => ({ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }));
      continue;
    }
    if (remaining <= 0) break;
  }
  return { requested, diagnostics };
}

function png(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = WINDOW.r;
    rgba[at + 1] = WINDOW.g;
    rgba[at + 2] = WINDOW.b;
    rgba[at + 3] = 255;
  }
  return encodePng(width, height, rgba);
}

test("winGraphic draws the indexed image inside the message window", () => {
  const files = messageWindowFiles('winGraphic("mwin.png");\nmwin("Your story goes here...");\nwait();\n', png(600, 100));
  const engine = engineFor(files);
  const { requested, diagnostics } = run(engine, files, 10);

  // The name resolves through the asset index, exactly like `setImage`'s pictures.
  equal(requested.includes(assetKey("bitmap/mwin.png")), true, `requested ${JSON.stringify(requested)}`);
  equal(diagnostics.includes("render.failed"), false, `diagnostics ${JSON.stringify(diagnostics)}`);

  const commands = engine.drawList(0).commands;
  const blit = commands.find((command) => command.kind === "blit" && "asset" in command.source && command.source.asset === assetKey("bitmap/mwin.png"));
  ok(blit !== undefined, "the message window blits its background image");
  if (blit === undefined || blit.kind !== "blit") return;
  deepEqual(blit.src, { x: 0, y: 0, w: 600, h: 100 });
  deepEqual(blit.dst, { x: 20, y: 0, w: 600, h: 100 });
  equal(blit.alpha, 128);
  equal(blit.blend, "translucent");
  equal(blit.key, null);

  // The pixels prove the image is painted, not just named: a 50% blend of the authored colour over the black frame.
  let pixels: SurfacePixels | null = null;
  for (let rev = 0; rev < 512 && pixels === null; rev += 1) pixels = engine.surfacePixels(0 as never, rev);
  ok(pixels !== null, "the frame is readable");
  if (pixels === null) return;
  const at = (x: number, y: number): number[] => [...pixels.rgba.slice((y * pixels.w + x) * 4, (y * pixels.w + x) * 4 + 4)];
  deepEqual(at(20, 1), [100, 50, 20, 255]);
  deepEqual(at(619, 99), [100, 50, 20, 255]);
  equal(at(0, 0)[3], 0, "the image does not paint outside the window");
  // The message text still draws on top of the image.
  ok(commands.some((command) => command.kind === "text" && command.text.includes("Your story goes here")));
});

test("an unresolved winGraphic reference is a diagnostic and keeps the colour background", () => {
  const files = messageWindowFiles('winGraphic("missing.png");\nmwin("Hello");\nwait();\n', null);
  const engine = engineFor(files);
  const { diagnostics } = run(engine, files, 10);
  equal(diagnostics.filter((code) => code === "asset.missing").length, 1, `diagnostics ${JSON.stringify(diagnostics)}`);

  const commands = engine.drawList(0).commands;
  equal(commands.some((command) => command.kind === "blit" && "asset" in command.source), false);
  equal(commands.some((command) => command.kind === "blit" && "surface" in command.source), true);
});

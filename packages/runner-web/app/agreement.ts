/**
 * The agreement page: replays every **gating row of `golden/ledger.json`** through `render-webgl2` and reports the
 * worst per-channel difference against the reference rasteriser for the same draw list.
 *
 * A ledger row is either an authored scene (`S-*`, replayed by `runTracerScene`) or a closing-suite baseline
 * (`closing:<game>:<frame>`, booted through `runClosingFrames`). The page draws each row's draw list through WebGL2 in
 * headless Chromium and, separately, through `rasterize` over the very same pixels, decodes and textures, so the two
 * images are a like-for-like comparison of the replayer against the oracle (D-7). Every row also renders twice with
 * `flush()` between the renders, and the two WebGL2 images must be identical: discarding a cache may not change a pixel
 * (AD-27, G4 rule 3).
 */

import { assetKey, DEFAULT_FONT_ASSET, rasterizePresentation, type AssetKey, type DrawList, type HostDisplayGeometry, type RasterAsset, type RasterSurfaces, type ScratchId, type SurfaceId } from "@tk-reawakened/core";
import { createWebgl2Renderer, type RenderStats, type TexturePixels } from "@tk-reawakened/render-webgl2";
import {
  decodeAssetTexture,
  parseClosingPlan,
  runClosingFrames,
  runTracerScene,
  type ClosingFiles,
  type TracerScene,
} from "@tk-reawakened/runner-harness";
import { fontProvider } from "../src/index.ts";

type LedgerRow = { readonly path: string; readonly scene: string; readonly class: string; readonly gating: boolean; readonly producer: string };

type RowReport = {
  readonly scene: string;
  readonly kind: "scene" | "closing" | "partial" | "vacuous" | "skipped";
  readonly commands: number;
  readonly worst: number;
  readonly at: string;
  readonly drawn: number;
  readonly deferred: number;
  readonly diagnostics: string;
  readonly flushStable: boolean;
  readonly error: string | null;
};

declare global {
  interface Window {
    __agreement?: readonly RowReport[];
    __scratchFeedback?: boolean;
  }
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`/${path}`);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function servedFiles(url: string): Promise<ClosingFiles> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const wire = (await response.json()) as { files: readonly { path: string; bytes: string }[] };
  const files = new Map<string, Uint8Array>();
  for (const file of wire.files) {
    const binary = atob(file.bytes);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    files.set(file.path, bytes);
  }
  return files;
}

function worstChannel(actual: Uint8Array, expected: Uint8Array, width: number): { worst: number; at: string } {
  let worst = 0;
  let at = "none";
  const channels = ["r", "g", "b", "a"];
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0));
    if (difference <= worst) continue;
    const pixel = Math.floor(index / 4);
    worst = difference;
    at = `(${pixel % width},${Math.floor(pixel / width)}).${channels[index % 4]}`;
  }
  return { worst, at };
}

type Presentation = {
  readonly list: DrawList;
  readonly textures: ReadonlyMap<AssetKey, TexturePixels>;
  readonly fonts: ReadonlyMap<AssetKey, RasterAsset>;
  readonly surfaces: ReadonlyMap<string, TexturePixels>;
};

/** Render one draw list several times with a cache flush before each render, and compare every pass with the reference rasteriser. */
function renderBoth(input: Presentation): { actual: Uint8Array; worst: number; at: string; stats: RenderStats; flushStable: boolean } {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
  if (gl === null) throw new Error("agreement: no WebGL2 context");
  const renderer = createWebgl2Renderer(gl);
  const geometry: HostDisplayGeometry = {
    content: { width: input.list.width, height: input.list.height },
    game: { x: 0, y: 0, width: input.list.width, height: input.list.height },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const options = {
    textures: (asset: AssetKey) => input.textures.get(asset) ?? null,
    surfaces: (id: SurfaceId, rev: number) => input.surfaces.get(`${id}:${rev}`) ?? null,
    fonts: (asset: AssetKey) => input.fonts.get(asset),
    ...(input.fonts.get(DEFAULT_FONT_ASSET) === undefined ? {} : { fallbackFont: input.fonts.get(DEFAULT_FONT_ASSET) }),
  };
  const stats = renderer.render(input.list, geometry, options);
  const read = (): Uint8Array => {
    const pixels = new Uint8Array(input.list.width * input.list.height * 4);
    gl.readPixels(0, 0, input.list.width, input.list.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // `readPixels` is bottom-up; the reference's buffer is top-first.
    const stride = input.list.width * 4;
    const topFirst = new Uint8Array(pixels.length);
    for (let row = 0; row < input.list.height; row += 1) {
      topFirst.set(pixels.subarray(row * stride, (row + 1) * stride), (input.list.height - 1 - row) * stride);
    }
    return topFirst;
  };
  const reads: Uint8Array[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    if (pass > 0) renderer.flush();
    renderer.render(input.list, geometry, options);
    reads.push(read());
  }
  const first = reads[0]!;
  const flushStable = reads.every((frame) => frame.every((value, index) => value === first[index]));
  // Exercise first-use and resized scratch FBOs on the actual WebGL2 context; sampler feedback is an INVALID_OPERATION.
  for (let drained = 0; drained < 16 && gl.getError() !== gl.NO_ERROR; drained += 1) { /* discard errors from preceding ledger frame */ }
  let scratchNoErrors = true;
  for (const width of [2, 3]) {
    const scratchList: DrawList = {
      tick: 0, width, height: 2, marginCommands: [],
      commands: [
        { kind: "pushTarget", scratch: 1 as ScratchId },
        { kind: "fill", rgb: { r: 20, g: 30, b: 40 } },
        { kind: "popTarget" },
        { kind: "fill", rgb: { r: 50, g: 60, b: 70 } },
      ],
    };
    renderer.render(scratchList, {
      content: { width, height: 2 }, game: { x: 0, y: 0, width, height: 2 },
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    }, options);
    scratchNoErrors &&= gl.getError() === gl.NO_ERROR;
  }
  window.__scratchFeedback = (window.__scratchFeedback ?? true) && scratchNoErrors;
  renderer.dispose();

  // The oracle is the independent reference rasteriser replaying the same draw list; never the engine's own screen pixels.
  const assets = new Map<AssetKey, RasterAsset>([...input.textures, ...input.fonts]);
  for (const command of [...input.list.commands, ...input.list.marginCommands]) {
    if (command.kind === "text" && !assets.has(command.font.asset)) {
      const fallback = input.fonts.get(DEFAULT_FONT_ASSET);
      if (fallback !== undefined) assets.set(command.font.asset, fallback);
    }
  }
  const surfaces = new Map<SurfaceId, { readonly w: number; readonly h: number; readonly rgba: Uint8Array }>() as RasterSurfaces;
  surfaces.get = (id: SurfaceId, rev?: number) => input.surfaces.get(`${id}:${rev ?? 0}`);
  const raster = rasterizePresentation(input.list, geometry, assets, surfaces);
  if (raster.error !== null) throw new Error(`agreement: the reference refused the frame: ${raster.error}`);
  const reference = raster.rgba!;

  const { worst, at } = worstChannel(first, reference, input.list.width);
  return { actual: first, worst, at, stats, flushStable };
}

/** Everything a scene needs: its own asset files, keyed by the paths the scene names. */
async function sceneFiles(scene: TracerScene): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const path of scene.boardFiles) {
    try {
      files.set(path, await fetchBytes(path));
    } catch {
      // A scene may name an optional file (a sprite sheet it never draws); a missing one shows up as a difference.
    }
  }
  return files;
}

void (async () => {
  window.__scratchFeedback = true;
  const ledgerResponse = await fetch("/golden/ledger.json");
  if (!ledgerResponse.ok) throw new Error(`agreement: golden/ledger.json answered ${ledgerResponse.status}`);
  const ledger = (await ledgerResponse.json()) as { goldens: readonly LedgerRow[] };
  const rows = ledger.goldens.filter((row) => row.gating && row.class !== "legacy-screenshot");

  const planText = new TextDecoder().decode(await fetchBytes("golden/closing/plan.json"));
  const plan = parseClosingPlan(planText);
  const bundled = await servedFiles(`/api/bundled?folders=${encodeURIComponent(plan.bundled.join(","))}`);
  const reports: RowReport[] = [];
  const gameFiles = new Map<string, ClosingFiles>();
  const filesFor = async (game: string): Promise<ClosingFiles> => {
    const cached = gameFiles.get(game);
    if (cached !== undefined) return cached;
    const files = await servedFiles(`/api/game?root=${encodeURIComponent(`fixtures/legacy/${game}`)}`);
    gameFiles.set(game, files);
    return files;
  };

  for (const row of rows) {
    try {
    if (row.scene.startsWith("closing:")) {
      const [, gameName, label] = row.scene.split(":");
      const game = plan.games.find((candidate) => candidate.name === gameName);
      if (game === undefined || gameName === undefined || label === undefined) {
        reports.push({ scene: row.scene, kind: "skipped", commands: 0, worst: 0, at: "none", drawn: 0, deferred: 0, diagnostics: "", flushStable: true, error: `the closing plan does not list ${gameName}` });
        continue;
      }
      const files = await filesFor(gameName);
      const run = runClosingFrames(plan, game, files, bundled);
      const frame = run.frames.find((candidate) => candidate.label === label);
      if (frame === undefined) {
        reports.push({ scene: row.scene, kind: "skipped", commands: 0, worst: 0, at: "none", drawn: 0, deferred: 0, diagnostics: "", flushStable: true, error: `${gameName} captured no ${label} frame` });
        continue;
      }
      const textures = new Map<AssetKey, TexturePixels>();
      for (const [path, bytes] of [...files, ...bundled]) {
        const key = assetKey(path);
        const decoded = decodeAssetTexture(key, bytes);
        if (decoded !== null) textures.set(key, { w: decoded.w, h: decoded.h, rgba: decoded.rgba });
      }
      const surfaces = new Map<string, TexturePixels>();
      for (const [key, pixels] of frame.surfaces) {
        if (pixels !== null) surfaces.set(key, { w: pixels.w, h: pixels.h, rgba: pixels.rgba });
      }
      const fonts = new Map<AssetKey, RasterAsset>([...fontProvider(bundled), ...fontProvider(files)]);
      const result = renderBoth({ list: frame.drawList as DrawList, textures, fonts, surfaces });
      const kind = frame.drawList.commands.length === 0 ? "vacuous" : result.stats.deferred > 0 ? "partial" : "closing";
      reports.push({ scene: row.scene, kind, commands: frame.drawList.commands.length, worst: result.worst, at: result.at, drawn: result.stats.drawn, deferred: result.stats.deferred, diagnostics: result.stats.diagnostics.join("; "), flushStable: result.flushStable, error: null });
      continue;
    }

    const sceneText = new TextDecoder().decode(await fetchBytes(`golden/scenes/${row.scene}.json`));
    const scene = JSON.parse(sceneText) as TracerScene;
    const tracer = runTracerScene(scene, await sceneFiles(scene));
    if (tracer.error !== null) {
      reports.push({ scene: row.scene, kind: "skipped", commands: 0, worst: 0, at: "none", drawn: 0, deferred: 0, diagnostics: "", flushStable: true, error: tracer.error });
      continue;
    }
    const textures = new Map<AssetKey, TexturePixels>();
    for (const [key, texture] of tracer.textures) textures.set(key, { w: texture.w, h: texture.h, rgba: texture.rgba });
    const result = renderBoth({ list: tracer.drawList, textures, fonts: new Map(), surfaces: new Map() });
    reports.push({ scene: row.scene, kind: tracer.drawList.commands.length === 0 ? "vacuous" : "scene", commands: tracer.drawList.commands.length, worst: result.worst, at: result.at, drawn: result.stats.drawn, deferred: result.stats.deferred, diagnostics: result.stats.diagnostics.join("; "), flushStable: result.flushStable, error: null });
    } catch (error) {
      // One row's failure is reported, never allowed to stop the page: the lane compares every row it could replay.
      reports.push({ scene: row.scene, kind: "skipped", commands: 0, worst: 0, at: "none", drawn: 0, deferred: 0, diagnostics: "", flushStable: true, error: error instanceof Error ? error.message : String(error) });
    }
  }

  window.__agreement = reports;
  window.document.title = `agreement: ${reports.length} rows replayed`;
})();

/**
 * The desktop player page (entry 9.11): the same `runner-web` build, booted from a package the **main process** read from
 * disk. It reports what the entry's evidence needs — the tick-120 hashes, the four measurements and the save it wrote —
 * and nothing else; the window chrome, launch resolution and library are the player application's (entry 9.10).
 */

import { assetKey, DEFAULT_FONT_ASSET, rasterizePresentation, type AssetKey, type DrawList, type HostDisplayGeometry, type RasterAsset, type RasterSurfaces, type SurfaceId } from "@tk-reawakened/core";
import { createWebgl2Renderer } from "@tk-reawakened/render-webgl2";
import { decodeAssetTexture, parseClosingPlan, runClosingFrames } from "@tk-reawakened/runner-harness";
import { fontProvider, packageFiles, PcmSink } from "@tk-reawakened/runner-web";

/** What a wrapper's bridge must provide: the desktop preload's four calls, and the mobile host's identical four. */
export type PlayerHost = {
  openPackage(): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
};

export type PlayerReport = {
  scheme: string;
  serviceWorkers: number;
  packageName: string;
  tick: number;
  stateHash: string;
  drawHash: string;
  commands: number;
  webgl2: string;
  blendWorst: number;
  audio: { lengthTicks: number | null; energy: number };
  frame: { worst: number; width: number; height: number };
  save: { gameId: string; path: string; written: boolean; bytes: number };
  error: string | null;
};

/**
 * Boot the page's measurement against one wrapper's bridge and report what it measured. One implementation for the
 * desktop shell and the mobile wrapper (runners.md#mobile's MUST NOT: a platform difference is a host service, never a
 * second rendering, input or asset path).
 */
export async function bootPlayerPage(bridge: PlayerHost | undefined): Promise<PlayerReport> {
  const report = { error: null as string | null } as PlayerReport;
  try {
    const host = bridge;
    if (host === undefined) throw new Error("the host bridge is absent");
    // The page is on `app://`, and no service worker is registered or claimed.
    const scheme = location.protocol.replace(":", "");
    // The scheme is registered without `allowServiceWorkers`, so the API refuses here; that refusal is the proof that no
    // worker is registered (ADR 0013 decision 3).
    let serviceWorkers = 0;
    try {
      serviceWorkers = "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0;
    } catch {
      serviceWorkers = 0;
    }

    const opened = await host.openPackage();
    if (opened === null) throw new Error("no package was named on the command line");
    const files = packageFiles(opened.name, new Uint8Array(opened.bytes));

    const planText = await (await fetch("/golden/closing/plan.json")).text();
    const plan = parseClosingPlan(planText);
    const game = plan.games.find((candidate) => candidate.name === "demo");
    if (game === undefined) throw new Error("the plan does not list demo");
    // Bundled assets travel with the build, not with the game; a desktop origin has no directory listing, so the build
    // writes the list beside the bundle.
    const bundled = new Map<string, Uint8Array>();
    const listed = (await (await fetch("/apps/bundled.json")).json()) as { files: readonly string[] };
    for (const name of listed.files) {
      const response = await fetch(`/${name}`);
      if (response.ok) bundled.set(name, new Uint8Array(await response.arrayBuffer()));
    }
    void plan.bundled;
    const run = runClosingFrames(plan, game, files, bundled);
    const frame = run.frames.find((candidate) => candidate.tick === 120);
    if (frame === undefined) throw new Error("no tick-120 frame");

    // Measurement 1: WebGL2 present, and its limits.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
    if (gl === null) throw new Error("no WebGL2 context");
    const webgl2 = `webgl2 ${String(gl.getParameter(gl.VERSION))} max ${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))}`;

    // The frame through the replayer, and the same draw list through the reference — measurement 5.
    const textures = new Map<AssetKey, { w: number; h: number; rgba: Uint8Array }>();
    for (const [path, bytes] of files) {
      const key = assetKey(path);
      const decoded = decodeAssetTexture(key, bytes);
      if (decoded !== null) textures.set(key, { w: decoded.w, h: decoded.h, rgba: decoded.rgba });
    }
    const fonts = fontProvider(bundled);
    const renderer = createWebgl2Renderer(gl);
    const list = frame.drawList as DrawList;
    const geometry: HostDisplayGeometry = {
      content: { width: list.width, height: list.height },
      game: { x: 0, y: 0, width: list.width, height: list.height },
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const stats = renderer.render(list, geometry, {
      textures: (asset) => textures.get(asset) ?? null,
      surfaces: (id, rev) => {
        const pixels = frame.surfaces.get(`${id}:${rev}`);
        return pixels === null || pixels === undefined ? null : { w: pixels.w, h: pixels.h, rgba: pixels.rgba };
      },
      fonts: (asset) => fonts.get(asset),
      ...(fonts.get(DEFAULT_FONT_ASSET) === undefined ? {} : { fallbackFont: fonts.get(DEFAULT_FONT_ASSET) }),
    });
    const pixels = new Uint8Array(list.width * list.height * 4);
    gl.readPixels(0, 0, list.width, list.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const stride = list.width * 4;
    const topFirst = new Uint8Array(pixels.length);
    for (let row = 0; row < list.height; row += 1) topFirst.set(pixels.subarray(row * stride, (row + 1) * stride), (list.height - 1 - row) * stride);
    const assets = new Map<AssetKey, RasterAsset>([...textures, ...fonts]);
    const surfaces = new Map<SurfaceId, { readonly w: number; readonly h: number; readonly rgba: Uint8Array }>() as RasterSurfaces;
    surfaces.get = (id: SurfaceId, rev?: number) => {
      const surface = frame.surfaces.get(`${id}:${rev ?? 0}`);
      return surface === null || surface === undefined ? undefined : { w: surface.w, h: surface.h, rgba: surface.rgba };
    };
    const reference = rasterizePresentation(list, geometry, assets, surfaces);
    let worst = 0;
    if (reference.error === null) {
      for (let index = 0; index < reference.rgba.length; index += 1) worst = Math.max(worst, Math.abs(reference.rgba[index]! - topFirst[index]!));
    }
    renderer.dispose();

    // Measurement 2: the D-7 blend bound, on the committed vector that exercises the blend arithmetic.
    const kit = (await (await fetch("/tools/fixtures/conformance/raster/vectors.json")).json()) as {
      vectors: readonly { id: string; width: number; height: number; texture?: { asset: string; w: number; h: number; rgba: string }; commands: readonly unknown[]; rgba: string }[];
    };
    const blend = kit.vectors.find((vector) => vector.id === "translucent-127");
    let blendWorst = 0;
    if (blend !== undefined) {
      const blendCanvas = document.createElement("canvas");
      const blendGl = blendCanvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
      if (blendGl !== null) {
        const texture = blend.texture;
        const blendTextures = new Map<AssetKey, { w: number; h: number; rgba: Uint8Array }>();
        if (texture !== undefined) {
          const bytes = new Uint8Array(texture.rgba.length / 2);
          for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(texture.rgba.slice(index * 2, index * 2 + 2), 16);
          blendTextures.set(texture.asset as AssetKey, { w: texture.w, h: texture.h, rgba: bytes });
        }
        const blendRenderer = createWebgl2Renderer(blendGl);
        const blendList: DrawList = { tick: 0, width: blend.width, height: blend.height, commands: blend.commands as DrawList["commands"], marginCommands: [] };
        const blendGeometry: HostDisplayGeometry = {
          content: { width: blend.width, height: blend.height },
          game: { x: 0, y: 0, width: blend.width, height: blend.height },
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        };
        blendRenderer.render(blendList, blendGeometry, { textures: (asset) => blendTextures.get(asset) ?? null });
        const out = new Uint8Array(blend.width * blend.height * 4);
        blendGl.readPixels(0, 0, blend.width, blend.height, blendGl.RGBA, blendGl.UNSIGNED_BYTE, out);
        const expected = new Uint8Array(blend.rgba.length / 2);
        for (let index = 0; index < expected.length; index += 1) expected[index] = Number.parseInt(blend.rgba.slice(index * 2, index * 2 + 2), 16);
        const bs = blend.width * 4;
        const flipped = new Uint8Array(out.length);
        for (let row = 0; row < blend.height; row += 1) flipped.set(out.subarray(row * bs, (row + 1) * bs), (blend.height - 1 - row) * bs);
        for (let index = 0; index < expected.length; index += 1) blendWorst = Math.max(blendWorst, Math.abs(expected[index]! - flipped[index]!));
        blendRenderer.dispose();
      }
    }

    // Measurement 3: audio of the expected length, pulled from the same sink the browser uses.
    const audioBytes = new Uint8Array(
      await (await fetch("/packages/core/test/fixtures/audio/files/pcm16-mono-8000.wav")).arrayBuffer(),
    );
    let lengthTicks: number | null = null;
    const sink = new PcmSink({
      readAsset: () => audioBytes,
      outputRateHz: 8_000,
      onEvent: (event) => {
        if (event.kind === "ready") lengthTicks = event.lengthTicks;
      },
    });
    sink.handle({ kind: "load", voice: 1, track: "sfx", asset: "media/probe.wav" as AssetKey, data: audioBytes });
    sink.handle({ kind: "play", voice: 1, cue: 1, loop: false, volume: 100, positionTicks: 0 });
    const audioFrames = 2_400;
    const left = new Float32Array(audioFrames);
    const right = new Float32Array(audioFrames);
    sink.render(left, right, audioFrames);

    // The save this runner writes, under the descriptor's GameId, for the web runner to read back.
    const gameId = "desktop-probe-game";
    const savePath = "slot-1.json";
    const saveBytes = new TextEncoder().encode(JSON.stringify({ gameId, tick: frame.tick }));
    const written = await host.writeBlob("saves", gameId, savePath, saveBytes);
    // The web runner reads it back through the same AD-17 key, which is what makes the save portable between runners.
    const readBack = await host.readBlob("saves", gameId, savePath);

    report.scheme = scheme;
    report.serviceWorkers = serviceWorkers;
    report.packageName = opened.name;
    report.tick = frame.tick;
    report.stateHash = frame.stateHash;
    report.drawHash = frame.drawHash;
    report.commands = frame.commands;
    report.webgl2 = webgl2;
    report.blendWorst = blendWorst;
    report.audio = { lengthTicks, energy: PcmSink.energy(left, audioFrames) };
    report.frame = { worst, width: list.width, height: list.height };
    report.save = { gameId, path: savePath, written: written && readBack !== null && readBack.length === saveBytes.length, bytes: saveBytes.length };
    report.error = null;
    void stats;
    void frame.pixels;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  return report;
}

/**
 * The web runner (D-3, D-5, D-8, D-11; docs/spec/engine/runners.md).
 *
 * A browser host for the core, and nothing more: it fetches the bytes the core asks for, hands back an AD-14 reply, and
 * presents the draw list through `render-webgl2`. The boot sequence is `runner-harness`'s `runClosingFrames`, the same
 * function the headless closing suite uses, so this host's hashes are the baseline's by construction rather than by a
 * copy of the boot code.
 *
 * What is here today is the tracer's path: a served game folder, one scripted frame, the presentation. Streaming load
 * modes, prefetch hints, the service worker and the library land with entries 9 and 10; the live interactive player page
 * lands with entry 16. Both are named in the runner page's Implementation status table.
 */

import {
  assetKey,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readDistributionManifest,
  DEFAULT_FONT_ASSET,
  readLegacyFont,
  readTrueTypeFont,
  type AssetKey,
  type DrawList,
  type InputRecord,
  type RasterAsset,
  type SurfaceId,
} from "@tk-reawakened/core";

export type { InputRecord };
import {
  decodeAssetTexture,
  parseClosingPlan,
  runClosingFrames,
  type ClosingFiles,
  type ClosingGamePlan,
  type ClosingPlan,
} from "@tk-reawakened/runner-harness";
import { createWebgl2Renderer, type RenderStats, type TexturePixels } from "@tk-reawakened/render-webgl2";
import { parseInstallDescriptor } from "./package-source.ts";

/** One file of a served game or of the bundled assets, as the browser received it. */
export type ServedFile = { readonly path: string; readonly bytes: Uint8Array };

/** Decode a served file list into the map the harness takes (`path -> bytes`, `/`-separated). */
export function toFiles(files: readonly ServedFile[]): ClosingFiles {
  const map = new Map<string, Uint8Array>();
  for (const file of files) map.set(file.path, file.bytes);
  return map;
}

type WireFiles = { readonly files: readonly { readonly path: string; readonly bytes: string }[] };

async function getFiles(url: string): Promise<ClosingFiles> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`runner-web: ${url} answered ${response.status}`);
  const wire = (await response.json()) as WireFiles;
  return toFiles(wire.files.map((file) => ({ path: file.path, bytes: base64Bytes(file.bytes) })));
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Fetch one game folder: its files keyed by their path inside the game (`Main/x.gam`, `Tiles/x.tst`, …). */
export function fetchGame(base: string, root: string): Promise<ClosingFiles> {
  return getFiles(`${base}/api/game?root=${encodeURIComponent(root)}`);
}

/** Fetch the bundled assets, keyed as the harness keys them (`media/fonts/…`, `media/cursors/…`). */
export function fetchBundled(base: string, folders: readonly string[]): Promise<ClosingFiles> {
  return getFiles(`${base}/api/bundled?folders=${encodeURIComponent(folders.join(","))}`);
}

/**
 * Fetch the bundled assets one static file at a time, from the file list the build writes to `apps/bundled.json`. Unlike
 * `fetchBundled` it asks the server for no API: every URL is an ordinary static path a service worker can cache, which
 * is what lets a second launch boot with no network and no `/api/` request at all.
 */
export async function fetchBundledFiles(base: string, files: readonly string[]): Promise<ClosingFiles> {
  const entries = await Promise.all(files.map(async (path) => {
    const response = await fetch(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!response.ok) throw new Error(`runner-web: ${path} answered ${response.status}`);
    return { path, bytes: new Uint8Array(await response.arrayBuffer()) };
  }));
  return toFiles(entries);
}

export type FrameReport = {
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly commands: number;
  readonly render: RenderStats;
};

/** Decoded textures for a draw list, decoded once per asset from the game's own bytes (AD-28). */
export function textureProvider(files: ClosingFiles): (asset: AssetKey) => TexturePixels | null {
  const byKey = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of files) byKey.set(assetKey(path), bytes);
  const cache = new Map<AssetKey, TexturePixels | null>();
  return (asset: AssetKey): TexturePixels | null => {
    const cached = cache.get(asset);
    if (cached !== undefined) return cached;
    const bytes = byKey.get(asset);
    const decoded = bytes === undefined ? null : decodeAssetTexture(asset, bytes);
    const pixels = decoded === null ? null : { w: decoded.w, h: decoded.h, rgba: decoded.rgba };
    cache.set(asset, pixels);
    return pixels;
  };
}

/**
 * Decoded textures for a session whose bytes arrive over time. `lookup` is the session's synchronous byte cache and
 * `prepared` the decode worker's pixels, if any; a texture is decoded once, from the worker's pixels when they are ready
 * and from the bytes otherwise. A key with no bytes yet is not cached as missing, because its bytes may still arrive.
 *
 * A kind the host cannot decode itself — a composed tile bitmap, whose pixels the core builds from other tiles — is
 * taken from `pictures`, the engine's `picturePixels` accessor (docs/spec/engine/runners.md#picture-pixels). That
 * result is not cached as missing: the core may not have composed the picture on the first frame that names it.
 */
export function liveTextureProvider(
  lookup: (asset: AssetKey) => Uint8Array | null,
  prepared?: (asset: AssetKey) => TexturePixels | null,
  pictures?: (asset: AssetKey) => TexturePixels | null,
): (asset: AssetKey) => TexturePixels | null {
  const cache = new Map<AssetKey, TexturePixels | null>();
  return (asset: AssetKey): TexturePixels | null => {
    const cached = cache.get(asset);
    if (cached !== undefined) return cached;
    const ready = prepared?.(asset) ?? null;
    if (ready !== null) {
      cache.set(asset, ready);
      return ready;
    }
    const bytes = lookup(asset);
    if (bytes === null) {
      const picture = pictures?.(asset) ?? null;
      if (picture !== null) cache.set(asset, picture);
      return picture;
    }
    const decoded = decodeAssetTexture(asset, bytes);
    if (decoded !== null) {
      const pixels = { w: decoded.w, h: decoded.h, rgba: decoded.rgba };
      cache.set(asset, pixels);
      return pixels;
    }
    const picture = pictures?.(asset) ?? null;
    if (picture === null) return null;
    cache.set(asset, picture);
    return picture;
  };
}

export type ScriptedFrameOptions = {
  readonly planText: string;
  readonly game: string;
  readonly files: ClosingFiles;
  readonly bundled: ClosingFiles;
  readonly gl: WebGL2RenderingContext;
  /** Which captured frame to present; the plan's `board` frame is tick 120. */
  readonly tick?: number;
  /** Font assets by key, decoded by the core; a text command without one is counted deferred. */
  readonly fonts?: ReadonlyMap<AssetKey, RasterAsset>;
};

/**
 * Boot from a distribution package: one file, no folder access (entry 9.7). `loadPackage` applies the untrusted-package
 * limits L1–L21, so a tampered or malformed package is refused with the rule it hit before anything is served; what it
 * returns is exactly the file map the folder path produces, which is why a package boot reaches the same hashes.
 */
export type DistributionPackage = {
  readonly files: ClosingFiles;
  readonly main: string;
};

/** Load a distribution package and return its validated descriptor-selected main path. */
export function distributionPackage(name: string, bytes: Uint8Array): DistributionPackage {
  const loaded = loadPackage({ kind: "tpk", name, bytes });
  if (!loaded.ok) throw new Error(`runner-web: ${name} refused: ${loaded.error.message}`);
  const descriptor = readDistributionManifest(loaded.value);
  if (!descriptor.ok) throw new Error(`runner-web: ${name} refused: ${descriptor.error.message}`);
  const files = new Map<string, Uint8Array>();
  for (const file of loaded.value.files) {
    if (file.path === "manifest.json") continue;
    files.set(file.path, file.bytes);
  }
  return { files, main: descriptor.value.main };
}

/** Decode a distribution package to its game files (`path -> bytes`). */
export function packageFiles(name: string, bytes: Uint8Array): ClosingFiles {
  return distributionPackage(name, bytes).files;
}

export type InteractivePackage = DistributionPackage & {
  readonly gameId: string;
  readonly gameIdentity: string;
};

/** Validate the install sidecar against the package and its descriptor-selected main file. */
export async function interactivePackage(name: string, bytes: Uint8Array, value: unknown): Promise<InteractivePackage> {
  const descriptor = parseInstallDescriptor(value, name);
  if (descriptor.size !== bytes.length) throw new Error(`runner-web: descriptor size does not match ${name}`);
  const digestBytes = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestBytes);
  const actualHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actualHash !== descriptor.sha256) throw new Error(`runner-web: descriptor SHA-256 does not match ${name}`);
  const pkg = distributionPackage(name, bytes);
  const mainBytes = [...pkg.files].find(([path]) => assetKey(path) === assetKey(pkg.main))?.[1];
  if (mainBytes === undefined) throw new Error(`runner-web: descriptor main ${pkg.main} is absent`);
  const gameIdentity = derivePackageIdentity([...pkg.files].map(([path, fileBytes]) => ({ path, bytes: fileBytes })));
  const gameId = deriveGameId(mainBytes, gameIdentity);
  if (gameId !== descriptor.gameId) throw new Error(`runner-web: descriptor gameId does not match ${pkg.main} and its package identity`);
  return { ...pkg, gameId, gameIdentity };
}

/**
 * Decode the fonts a host carries into the map a text command's `asset` names (AD-15). Only formats the core reads
 * decode: a legacy `.fnt` as a `LegacyFont`, a TrueType as a `TrueTypeFont`; anything else is left out, and a text
 * command naming it is counted deferred rather than drawn with a guess.
 */
export function fontProvider(files: ClosingFiles): ReadonlyMap<AssetKey, RasterAsset> {
  const fonts = new Map<AssetKey, RasterAsset>();
  for (const [path, bytes] of files) {
    const key = assetKey(path);
    if (key.endsWith(".fnt")) {
      const font = readLegacyFont(bytes, path);
      if (font.ok) fonts.set(key, font.value);
    } else if (key.endsWith(".ttf")) {
      const font = readTrueTypeFont(bytes, path);
      if (font.ok) fonts.set(key, font.value);
    }
  }
  return fonts;
}

/**
 * Boot one game exactly as the headless closing suite does and present one captured frame through WebGL2. Returns the
 * hashes the core reported, so a lane can compare them with the committed baseline without trusting the renderer.
 */
export function runScriptedFrame(options: ScriptedFrameOptions): FrameReport {
  const plan: ClosingPlan = parseClosingPlan(options.planText);
  const game: ClosingGamePlan | undefined = plan.games.find((candidate) => candidate.name === options.game);
  if (game === undefined) throw new Error(`runner-web: the plan does not list ${options.game}`);
  const run = runClosingFrames(plan, game, options.files, options.bundled);
  const frame = run.frames.find((candidate) => candidate.tick === (options.tick ?? 120)) ?? run.frames.at(-1);
  if (frame === undefined) throw new Error(`runner-web: ${options.game} captured no frame`);
  const renderer = createWebgl2Renderer(options.gl);
  const render = renderer.render(frame.drawList as DrawList, {
    textures: textureProvider(options.files),
    surfaces: (id: SurfaceId, rev: number) => {
      const pixels = frame.surfaces.get(`${id}:${rev}`);
      return pixels === undefined || pixels === null ? null : { w: pixels.w, h: pixels.h, rgba: pixels.rgba };
    },
    fonts: (asset: AssetKey) => options.fonts?.get(asset),
    ...(options.fonts?.get(DEFAULT_FONT_ASSET) === undefined ? {} : { fallbackFont: options.fonts.get(DEFAULT_FONT_ASSET) }),
  });
  return { tick: frame.tick, stateHash: frame.stateHash, drawHash: frame.drawHash, commands: frame.commands, render };
}

export * from "./audio-sink.ts";
export * from "./blob-host.ts";
export * from "./decode-ahead.ts";
export * from "./decode-types.ts";
export * from "./load-mode.ts";
export * from "./package-source.ts";
export * from "./opfs-store.ts";
export * from "./session-assets.ts";
export * from "./stall-overlay.ts";
export * from "./register-worker.ts";
export * from "./service-worker-core.ts";
export * from "./player-page.ts";
export * from "./video.ts";

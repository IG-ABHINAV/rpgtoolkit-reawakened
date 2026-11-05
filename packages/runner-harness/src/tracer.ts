import { assetKey, BinaryReader, createAssetIndex, createEngine, expandTileToRgba, hashDrawList, readBoard, readTileBitmap, readTileset, resolveTileReference, rasterizePresentation, tileDimensions, PACKAGE_ROOT } from "@tk-reawakened/core";
import type { AssetIndex, AssetKey, DecodedTexture, DrawList, HostDisplayGeometry, RasterSurfaces, SpriteDraw, BoardBlit, SurfaceId } from "@tk-reawakened/core";
import { encodeRgbaPng } from "./png.ts";

export type SceneLayerImage = {
  readonly type: "normal" | "parallax" | "stretch";
  readonly file: string;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
};
export type SceneBlit = {
  readonly asset?: string;
  readonly src?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly dst?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly rect?: readonly [number, number, number, number];
  readonly mode?: "normal" | "additive" | "translucent";
  readonly key?: { readonly r: number; readonly g: number; readonly b: number } | null;
  readonly tint?: { readonly r: number; readonly g: number; readonly b: number };
  readonly alpha?: number;
  readonly blend?: "normal" | "additive" | "translucent";
};
export type TracerScene = {
  readonly schema: number;
  readonly name: string;
  readonly boardFiles: readonly string[];
  readonly ambient: readonly [number, number, number];
  readonly view: {
    readonly viewport: readonly [number, number];
    readonly camera: readonly [number, number];
    readonly include: { readonly shading: boolean; readonly images: boolean; readonly sprites: boolean };
    readonly layerImages?: readonly SceneLayerImage[];
    readonly blits?: readonly SceneBlit[];
  };
  readonly tick: number;
  readonly sprites?: readonly SpriteDraw[];
};
export type TracerTick = { readonly tick: number; readonly stateHash: string; readonly drawHash: string };
export type TracerResult = {
  readonly scene: string;
  readonly drawList: DrawList;
  readonly drawHash: string;
  readonly stateHash: string;
  readonly pixels: Uint8Array;
  readonly png: Uint8Array;
  readonly error: string | null;
  readonly ticks: readonly TracerTick[];
  /** The decoded textures the draw list's blits name, so a replayer can draw the same scene (AD-27). */
  readonly textures: ReadonlyMap<AssetKey, DecodedTexture>;
};

function scenePath(path: string): string {
  if (path.includes("/Boards/")) return `Boards/${path.split("/Boards/")[1] ?? ""}`;
  if (path.includes("/Tiles/")) return `Tiles/${path.split("/Tiles/")[1] ?? ""}`;
  if (path.includes("/fixtures/authored/")) {
    const basename = path.split("/").at(-1) ?? path;
    if (basename.endsWith(".brd")) return `Boards/${basename}`;
    if (basename.endsWith(".tst") || basename.endsWith(".iso")) return `Tiles/${basename}`;
  }
  if (path.includes("/Bitmap/")) return `Bitmap/${path.split("/Bitmap/")[1] ?? ""}`;
  return path;
}

function sceneAssetKey(file: string, kind: "bitmap" | "tile"): AssetKey {
  const normalized = file.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("/")) return assetKey(normalized);
  return assetKey(`${kind === "bitmap" ? "Bitmap" : "Tiles"}/${normalized}`);
}

function tileTexture(tileTextures: ReadonlyMap<AssetKey, DecodedTexture>, reference: string, assetIndex: AssetIndex): DecodedTexture | null {
  const resolved = resolveTileReference(assetIndex, PACKAGE_ROOT, reference);
  if (!resolved.ok || (resolved.value.kind !== "tileset" && resolved.value.kind !== "isometric")) return null;
  const texture = tileTextures.get(resolved.value.asset);
  if (texture === undefined) return null;
  const tileWidth = resolved.value.kind === "isometric" ? 64 : 32;
  const tile = resolved.value.tile - 1;
  if (tile < 0 || (tile + 1) * tileWidth > texture.w || 32 > texture.h) return null;
  const rgba = new Uint8Array(tileWidth * 32 * 4);
  for (let y = 0; y < 32; y += 1) {
    const from = (y * texture.w + tile * tileWidth) * 4;
    rgba.set(texture.rgba.subarray(from, from + tileWidth * 4), y * tileWidth * 4);
  }
  return { w: tileWidth, h: 32, rgba };
}

function decodeTileBitmap(bytes: Uint8Array, tileTextures: ReadonlyMap<AssetKey, DecodedTexture>, assetIndex: AssetIndex): DecodedTexture | null {
  const parsed = readTileBitmap(new BinaryReader(bytes));
  if (!parsed.ok || parsed.value.width <= 0 || parsed.value.height <= 0) return null;
  const width = parsed.value.width * 32;
  const height = parsed.value.height * 32;
  const rgba = new Uint8Array(width * height * 4);
  for (let x = 0; x < parsed.value.width; x += 1) for (let y = 0; y < parsed.value.height; y += 1) {
    const cell = parsed.value.cells[x * (parsed.value.height + 1) + y];
    if (cell === undefined || cell.tile === "") continue;
    const tile = tileTexture(tileTextures, cell.tile, assetIndex);
    if (tile === null) continue;
    for (let row = 0; row < Math.min(32, tile.h); row += 1) {
      const from = row * tile.w * 4;
      const to = ((y * 32 + row) * width + x * 32) * 4;
      rgba.set(tile.rgba.subarray(from, from + Math.min(32, tile.w) * 4), to);
    }
  }
  return { w: width, h: height, rgba };
}

function sceneBlits(scene: TracerScene, available: ReadonlyMap<AssetKey, Uint8Array>, textures: Map<AssetKey, DecodedTexture>, assetIndex: AssetIndex): readonly BoardBlit[] {
  const blits: BoardBlit[] = [];
  const imageSize = (file: string): { readonly key: AssetKey; readonly texture: DecodedTexture } | null => {
    const key = sceneAssetKey(file, "bitmap");
    const bytes = available.get(key);
    if (bytes === undefined) return null;
    let texture = textures.get(key);
    if (texture === undefined) {
      texture = decodeTileBitmap(bytes, textures, assetIndex) ?? undefined;
      if (texture !== undefined) textures.set(key, texture);
    }
    return texture === undefined ? null : { key, texture };
  };
  if (scene.view.include.images && scene.view.layerImages === undefined) {
    const boardBytes = available.get(assetKey(scenePath(scene.boardFiles[0] ?? "")));
    if (boardBytes !== undefined) {
      const parsed = readBoard(new BinaryReader(boardBytes));
      if (parsed.ok) for (const image of parsed.value.images) {
        const resolved = imageSize(image.file);
        if (resolved !== null) blits.push({ asset: resolved.key, src: { x: 0, y: 0, w: resolved.texture.w, h: resolved.texture.h }, dst: { x: image.left, y: image.top, w: resolved.texture.w, h: resolved.texture.h }, key: { r: image.transparent.r, g: image.transparent.g, b: image.transparent.b } });
      }
    }
  }
  for (const image of scene.view.layerImages ?? []) {
    const resolved = imageSize(image.file);
    if (resolved === null) continue;
    const width = image.type === "stretch" ? scene.view.viewport[0] : resolved.texture.w;
    const height = image.type === "stretch" ? scene.view.viewport[1] : resolved.texture.h;
    blits.push({ asset: resolved.key, src: { x: 0, y: 0, w: resolved.texture.w, h: resolved.texture.h }, dst: { x: image.x, y: image.y, w: width, h: height }, key: { r: 0, g: 1, b: 2 } });
  }
  for (const blit of scene.view.blits ?? []) {
    if (blit.asset !== undefined && blit.src !== undefined && blit.dst !== undefined) {
      blits.push({ asset: sceneAssetKey(blit.asset, "bitmap"), src: blit.src, dst: blit.dst, ...(blit.key === undefined ? {} : { key: blit.key }), ...(blit.tint === undefined ? {} : { tint: blit.tint }), ...(blit.alpha === undefined ? {} : { alpha: blit.alpha }), ...(blit.blend === undefined ? {} : { blend: blit.blend }) });
      continue;
    }
    if (blit.rect === undefined || blit.mode === undefined) continue;
    const [x, y, w, h] = blit.rect;
    const white = assetKey("__scene-white");
    const black = assetKey("__scene-black");
    textures.set(white, { w: 1, h: 1, rgba: new Uint8Array([255, 255, 255, 255]) });
    textures.set(black, { w: 1, h: 1, rgba: new Uint8Array([0, 0, 0, 255]) });
    blits.push({ asset: blit.mode === "additive" ? white : black, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x, y, w, h }, alpha: blit.alpha ?? 255, blend: "translucent" });
  }
  return blits;
}

/** Run an authored scene through the real core engine and rasterizer with no host I/O. */
export function runTracerScene(scene: TracerScene, files: ReadonlyMap<string, Uint8Array>): TracerResult {
  if (scene.schema !== 1 || scene.boardFiles.length === 0) throw new Error("invalid tracer scene schema");
  const logicalPaths = scene.boardFiles.map(scenePath);
  const index = createAssetIndex(logicalPaths);
  const available = new Map<AssetKey, Uint8Array>();
  for (let i = 0; i < scene.boardFiles.length; i += 1) {
    const source = files.get(scene.boardFiles[i] ?? "");
    if (source) available.set(assetKey(logicalPaths[i] ?? ""), new Uint8Array(source));
  }
  const textures = new Map<AssetKey, DecodedTexture>();
  for (const [key, bytes] of available) {
    if (!key.endsWith(".tst") && !key.endsWith(".iso")) continue;
    const parsed = readTileset(bytes, key);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const model = parsed.value;
    const { width: storedWidth, height: storedHeight } = tileDimensions(model.detail);
    const scale = model.detail.size === 16 ? 2 : 1;
    const tileWidth = storedWidth * scale;
    const tileHeight = storedHeight * scale;
    const rgba = new Uint8Array(tileWidth * model.tiles.length * tileHeight * 4);
    for (let tile = 1; tile <= model.tiles.length; tile += 1) {
      const expanded = expandTileToRgba(model, tile - 1);
      if (!expanded.ok) throw new Error(expanded.error.message);
      for (let y = 0; y < tileHeight; y += 1) for (let x = 0; x < tileWidth; x += 1) {
        const from = ((Math.floor(x / scale) * storedHeight + Math.floor(y / scale)) * 4);
        const to = (y * tileWidth * model.tiles.length + (tile - 1) * tileWidth + x) * 4;
        rgba.set(expanded.value.subarray(from, from + 4), to);
      }
    }
    textures.set(key, { w: tileWidth * model.tiles.length, h: tileHeight, rgba });
  }
  for (const [key, bytes] of available) {
    if (!key.includes("/Bitmap/") && !key.startsWith("bitmap/")) continue;
    const texture = decodeTileBitmap(bytes, textures, index);
    if (texture !== null) textures.set(key, texture);
  }
  const blits = sceneBlits(scene, available, textures, index);
  const cameraTarget = {
    getPlayerPosition: () => ({ x: scene.view.camera[0] + Math.floor(scene.view.viewport[0] / 2), y: scene.view.camera[1] + Math.floor(scene.view.viewport[1] / 2) }),
    getEntityPosition: () => null,
  };
  const engine = createEngine({
    seed: 0,
    assetIndex: index,
    assetRoot: PACKAGE_ROOT,
    initialBoard: logicalPaths[0] ?? "",
    width: scene.view.viewport[0],
    height: scene.view.viewport[1],
    maxTicks: 60,
    cameraTarget,
    assets: textures,
    globalAmbient: { r: scene.ambient[0], g: scene.ambient[1], b: scene.ambient[2] },
    ...(scene.sprites === undefined ? {} : { sprites: scene.sprites }),
    ...(blits.length === 0 ? {} : { blits }),
  });
  let report = engine.advance(0, []);
  let guard = 0;
  while (report.loading && guard++ < scene.boardFiles.length + 16) {
    const records = report.requests.filter((request) => request.kind === "asset").map((request) => ({ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: available.get(request.key) ?? null } }));
    report = engine.advance(0, records);
  }
  if (report.loading) return { scene: scene.name, drawList: engine.drawList(0, scene.view.include), drawHash: "", stateHash: report.stateHash, pixels: new Uint8Array(), png: new Uint8Array(), error: "engine remained loading after asset replies", ticks: [], textures };
  while (report.tickAfter < scene.tick) {
    const remaining = scene.tick - report.tickAfter;
    report = engine.advance(Math.min(remaining, 60), []);
  }
  const drawList = engine.drawList(0, scene.view.include);
  const geometry: HostDisplayGeometry = {
    content: { width: drawList.width, height: drawList.height },
    game: { x: 0, y: 0, width: drawList.width, height: drawList.height },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const surfaces = new Map<SurfaceId, DecodedTexture>() as RasterSurfaces;
  surfaces.get = (surface: SurfaceId, rev: number = 0) => engine.surfacePixels(surface, rev) ?? undefined;
  const raster = rasterizePresentation(drawList, geometry, textures, surfaces);
  if (raster.error) return { scene: scene.name, drawList, drawHash: hashDrawList(drawList), stateHash: report.stateHash, pixels: raster.rgba, png: new Uint8Array(), error: raster.error, ticks: [{ tick: report.tickAfter, stateHash: report.stateHash, drawHash: hashDrawList(drawList) }], textures };
  const image: DecodedTexture = { w: raster.width, h: raster.height, rgba: raster.rgba };
  return { scene: scene.name, drawList, drawHash: hashDrawList(drawList), stateHash: report.stateHash, pixels: raster.rgba, png: encodeRgbaPng(image), error: null, ticks: [{ tick: report.tickAfter, stateHash: report.stateHash, drawHash: hashDrawList(drawList) }], textures };
}

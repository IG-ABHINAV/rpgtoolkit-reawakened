import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assetKey,
  composeBoard,
  createAssetIndex,
  decodeTexture,
  expandTileToRgba,
  hydrateBoard,
  rasterize,
  readTileset,
  tileDimensions,
  PACKAGE_ROOT,
  type AssetKey,
  type DecodedTexture,
  type SpriteDraw,
  type WorldBoard,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
function buildTilesetTexture(key: AssetKey, bytes: Uint8Array): DecodedTexture {
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
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const from = (Math.floor(x / scale) * storedHeight + Math.floor(y / scale)) * 4;
        const to = (y * tileWidth * model.tiles.length + (tile - 1) * tileWidth + x) * 4;
        rgba.set(expanded.value.subarray(from, from + 4), to);
      }
    }
  }
  return { w: tileWidth * model.tiles.length, h: tileHeight, rgba };
}

test("S-01c village with item sprite matches oracle PNG sprite pixels exactly through rasterizer", () => {
  const scenePath = join(REPO_ROOT, "golden", "scenes", "S-01c.json");
  const scene = JSON.parse(readFileSync(scenePath, "utf8")) as {
    readonly boardFiles: readonly string[];
    readonly sprites: readonly SpriteDraw[];
    readonly ambient: readonly [number, number, number];
    readonly view: {
      readonly viewport: readonly [number, number];
      readonly camera: readonly [number, number];
      readonly include: { readonly shading: boolean; readonly images: boolean; readonly sprites: boolean };
    };
    readonly tick: number;
  };

  const fileMap = new Map<AssetKey, Uint8Array>();
  for (const file of scene.boardFiles) {
    const bytes = new Uint8Array(readFileSync(join(REPO_ROOT, file)));
    const key = file.includes("/Boards/")
      ? assetKey(`Boards/${file.split("/Boards/")[1] ?? ""}`)
      : file.includes("/Tiles/")
        ? assetKey(`Tiles/${file.split("/Tiles/")[1] ?? ""}`)
        : file.includes("/Bitmap/")
          ? assetKey(`Bitmap/${file.split("/Bitmap/")[1] ?? ""}`)
          : assetKey(file);
    fileMap.set(key, bytes);
  }

  const logicalPaths = Array.from(fileMap.keys());
  const index = createAssetIndex(logicalPaths);
  const boardKey = logicalPaths[0]!;
  const boardBytes = fileMap.get(boardKey)!;

  const hydrated = hydrateBoard(boardKey, boardBytes, index, PACKAGE_ROOT, fileMap, scene.tick);
  if (hydrated.value === null) throw new Error(hydrated.error?.message ?? "hydration failed");
  const board = hydrated.value.board;

  const textures = new Map<AssetKey, DecodedTexture>();
  for (const [key, bytes] of fileMap) {
    if (key.endsWith(".tst") || key.endsWith(".iso")) {
      textures.set(key, buildTilesetTexture(key, bytes));
    }
  }

  const drawList = composeBoard({
    board,
    tick: scene.tick,
    camera: { x: scene.view.camera[0], y: scene.view.camera[1] },
    viewport: { width: scene.view.viewport[0], height: scene.view.viewport[1] },
    alpha: 0,
    include: scene.view.include,
    sprites: scene.sprites,
    assets: textures,
    globalAmbient: { r: scene.ambient[0], g: scene.ambient[1], b: scene.ambient[2] },
  });

  const playerCmd = drawList.commands.find((c) => c.kind === "rect" && c.rect.x === 200 && c.rect.y === 175);
  equal(playerCmd !== undefined, true);
  if (playerCmd?.kind === "rect") {
    deepEqual(playerCmd.rgb, { r: 64, g: 96, b: 224 });
    equal(playerCmd.rect.w, 16);
    equal(playerCmd.rect.h, 16);
  }

  const chestCmd = drawList.commands.find((c) => c.kind === "rect" && c.rect.x === 296 && c.rect.y === 175);
  equal(chestCmd !== undefined, true);
  if (chestCmd?.kind === "rect") {
    deepEqual(chestCmd.rgb, { r: 192, g: 128, b: 32 });
    equal(chestCmd.rect.w, 16);
    equal(chestCmd.rect.h, 16);
  }

  const rendered = rasterize(drawList, textures);
  equal(rendered.error, null);

  const referenceBytes = new Uint8Array(readFileSync(join(REPO_ROOT, "golden", "reference", "S-01c.png")));
  const reference = decodeTexture(referenceBytes, "S-01c.png");
  if (!reference.ok) throw new Error(reference.error.message);

  equal(rendered.width, reference.value.w);
  equal(rendered.height, reference.value.h);

  for (let y = 175; y <= 190; y += 1) {
    for (let x = 200; x <= 215; x += 1) {
      const at = (y * rendered.width + x) * 4;
      const refAt = (y * reference.value.w + x) * 4;
      deepEqual(
        Array.from(rendered.rgba.subarray(at, at + 4)),
        Array.from(reference.value.rgba.subarray(refAt, refAt + 4)),
      );
    }
  }

  for (let y = 175; y <= 190; y += 1) {
    for (let x = 296; x <= 311; x += 1) {
      const at = (y * rendered.width + x) * 4;
      const refAt = (y * reference.value.w + x) * 4;
      deepEqual(
        Array.from(rendered.rgba.subarray(at, at + 4)),
        Array.from(reference.value.rgba.subarray(refAt, refAt + 4)),
      );
    }
  }
});

const baseBoard: WorldBoard = {
  key: assetKey("boards/test.brd"),
  coordType: 0,
  sizeX: 4,
  sizeY: 4,
  sizeL: 2,
  width: 128,
  height: 128,
  background: { r: 10, g: 20, b: 30 },
  ambient: { r: 5, g: 5, b: 5 },
  layers: [
    {
      tiles: Array.from({ length: 16 }, (_, i) => ({
        asset: assetKey("tiles/layer1.tst"),
        tile: i + 1,
      })),
    },
    {
      tiles: Array.from({ length: 16 }, (_, i) => ({
        asset: assetKey("tiles/layer2.tst"),
        tile: i + 1,
      })),
    },
  ],
};

test("R-55 fix: two sprites crossing in y on one layer, moving sprite A last still draws it behind a sprite with greater y", () => {
  const spriteA: SpriteDraw = { id: "a", key: "player", layer: 1, x: 50, y: 40, drawId: 1 };
  const spriteB: SpriteDraw = { id: "b", key: "npc", layer: 1, x: 50, y: 70, drawId: 2 };

  // Sprite A moved last (placed at end of input array):
  // Since A.y (40) < B.y (70), A must draw first (behind B).
  const list1 = composeBoard({
    board: baseBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [spriteB, spriteA],
  });

  const rects1 = list1.commands.filter((c) => c.kind === "rect");
  equal(rects1.length, 2);
  // Sprite A rect (y = 40 - 16 = 24) comes before Sprite B rect (y = 70 - 16 = 54)
  equal(rects1[0]?.rect.y, 24);
  equal(rects1[1]?.rect.y, 54);

  // Now sprite A moves past B to y = 90 (> 70). Still placed last in input array:
  const spriteAMoved: SpriteDraw = { ...spriteA, y: 90 };
  const list2 = composeBoard({
    board: baseBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [spriteB, spriteAMoved],
  });

  const rects2 = list2.commands.filter((c) => c.kind === "rect");
  equal(rects2.length, 2);
  // Sprite B rect (y = 54) comes before Sprite A rect (y = 90 - 16 = 74)
  equal(rects2[0]?.rect.y, 54);
  equal(rects2[1]?.rect.y, 74);
});

test("drawId tie-breaker: players and items with equal y order strictly by drawId", () => {
  const player: SpriteDraw = { id: "p", key: "player", layer: 1, x: 50, y: 60, drawId: 1 };
  const item: SpriteDraw = { id: "i", key: "chest", layer: 1, x: 50, y: 60, drawId: 2 };

  const list = composeBoard({
    board: baseBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    // Input in reverse order:
    sprites: [item, player],
  });

  const rects = list.commands.filter((c) => c.kind === "rect");
  equal(rects.length, 2);
  // Player (drawId 1) has blueish color (64, 96, 224) and draws first
  deepEqual(rects[0]?.rgb, { r: 64, g: 96, b: 224 });
  // Item (drawId 2) has brownish color (192, 128, 32) and draws second
  deepEqual(rects[1]?.rgb, { r: 192, g: 128, b: 32 });
});

test("layer ordering: each layer's tiles are redrawn over lower-layer sprites, and sprite on higher layer draws on top", () => {
  const lowerSprite: SpriteDraw = { id: "s1", key: "player", layer: 1, x: 30, y: 100, drawId: 1 };
  const higherSprite: SpriteDraw = { id: "s2", key: "npc", layer: 2, x: 30, y: 20, drawId: 2 };

  const list = composeBoard({
    board: baseBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [lowerSprite, higherSprite],
  });

  // Commands must be:
  // 1. Fill background
  // 2. Layer 1 tiles (16 blits)
  // 3. Layer 1 sprite (lowerSprite rect)
  // 4. Layer 2 tiles (16 blits) -> drawing over layer 1 sprite!
  // 5. Layer 2 sprite (higherSprite rect)
  equal(list.commands[0]?.kind, "fill");

  const l1TileBlits = list.commands.slice(1, 17);
  for (const cmd of l1TileBlits) {
    equal(cmd.kind, "blit");
    if (cmd.kind === "blit" && "asset" in cmd.source) {
      equal(cmd.source.asset, assetKey("tiles/layer1.tst"));
    }
  }

  const s1Cmd = list.commands[17];
  equal(s1Cmd?.kind, "rect");
  if (s1Cmd?.kind === "rect") {
    equal(s1Cmd.rect.y, 100 - 16);
  }

  const l2TileBlits = list.commands.slice(18, 34);
  for (const cmd of l2TileBlits) {
    equal(cmd.kind, "blit");
    if (cmd.kind === "blit" && "asset" in cmd.source) {
      equal(cmd.source.asset, assetKey("tiles/layer2.tst"));
    }
  }

  const s2Cmd = list.commands[34];
  equal(s2Cmd?.kind, "rect");
  if (s2Cmd?.kind === "rect") {
    equal(s2Cmd.rect.y, 20 - 16);
  }
});

test("under-vector redraw honours attribute flags 1, 2, and 4", () => {
  // Vector polygon from (10, 30) to (60, 40)
  const vectorPoly = [
    { x: 10, y: 30 },
    { x: 60, y: 30 },
    { x: 60, y: 40 },
    { x: 10, y: 40 },
  ];

  // 32x32 sprite at x: 35, y: 60:
  // anchorX = 16, anchorY = 32
  // boardLeft = 19, boardTop = 28. Frame y is 28..60 (overlaps 30..40).
  // Collision base: x is 20..51, y is 60 - 15 = 45..60 (does NOT overlap 30..40).
  const sprite: SpriteDraw = {
    id: "test",
    key: "player",
    layer: 1,
    x: 35,
    y: 60,
    drawId: 1,
    width: 32,
    height: 32,
  };

  // With flag 4 (frame-intersection trigger):
  const boardWithFlag4: WorldBoard = {
    ...baseBoard,
    vectors: [{ points: vectorPoly, attributes: 4, closed: 1, layer: 1, type: 2, handle: "under1" }],
  };
  const listWithFlag4 = composeBoard({
    board: boardWithFlag4,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [sprite],
  });
  const spanBlits4 = listWithFlag4.commands.filter((c) => c.kind === "blit" && c.dst.h === 1);
  equal(spanBlits4.length > 0, true);

  // Without flag 4, collision base test fails and no span blits are emitted:
  const boardWithoutFlag4: WorldBoard = {
    ...baseBoard,
    vectors: [{ points: vectorPoly, attributes: 0, closed: 1, layer: 1, type: 2, handle: "under1" }],
  };
  const listWithoutFlag4 = composeBoard({
    board: boardWithoutFlag4,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [sprite],
  });
  const spanBlits0 = listWithoutFlag4.commands.filter((c) => c.kind === "blit" && c.dst.h === 1);
  equal(spanBlits0.length, 0);

  // Test Flag 2 (covers all layers below):
  // Under-vector on layer 2 covering (20, 20) to (50, 50). Sprite on layer 1 at (35, 45).
  const underPoly = [
    { x: 20, y: 20 },
    { x: 50, y: 20 },
    { x: 50, y: 50 },
    { x: 20, y: 50 },
  ];
  const spriteL1: SpriteDraw = { id: "l1", key: "player", layer: 1, x: 35, y: 45, drawId: 1 };
  const boardFlag2: WorldBoard = {
    ...baseBoard,
    vectors: [{ points: underPoly, attributes: 2, closed: 1, layer: 2, type: 2, handle: "under2" }],
  };
  const listFlag2 = composeBoard({
    board: boardFlag2,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [spriteL1],
  });
  const spanBlitsL2 = listFlag2.commands.filter((c) => c.kind === "blit" && c.dst.h === 1);
  equal(spanBlitsL2.length > 0, true);

  // Test Flag 1 (also covers board background):
  const boardFlag1: WorldBoard = {
    ...baseBoard,
    vectors: [{ points: underPoly, attributes: 1, closed: 1, layer: 1, type: 2, handle: "underBg" }],
  };
  const listFlag1 = composeBoard({
    board: boardFlag1,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: false, images: false, sprites: true },
    sprites: [spriteL1],
  });
  const bgSpanRects = listFlag1.commands.filter((c) => c.kind === "rect" && c.rect.h === 1 && c.rgb.r === 10 && c.rgb.g === 20 && c.rgb.b === 30);
  equal(bgSpanRects.length > 0, true);
});

test("presentation alpha smoothly interpolates sprite position from prev", () => {
  const sprite: SpriteDraw = {
    id: "moving",
    key: "player",
    layer: 1,
    x: 100,
    y: 100,
    prev: [0, 0],
    drawId: 1,
  };

  const atHalf = composeBoard({
    board: baseBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0.5,
    include: { shading: false, images: false, sprites: true },
    sprites: [sprite],
  });

  const rectHalf = atHalf.commands.find((c) => c.kind === "rect" && c.rect.w === 16 && c.rect.h === 16);
  equal(rectHalf !== undefined, true);
  // Interpolated pos: x = 0 + (100 - 0)*0.5 = 50, y = 50.
  if (rectHalf?.kind === "rect") {
    // Interpolated pos: x = 0 + (100 - 0)*0.5 = 50, y = 50.
    // Top-left = x - 8 = 42, y - 16 = 34.
    equal(rectHalf.rect.x, 42);
    equal(rectHalf.rect.y, 34);
  }
});
test("sprite frames from tile references and image textures carry key, alpha, blend, and ambient tint", () => {
  const tileSprite: SpriteDraw = {
    id: "tileSprite",
    key: "hero",
    layer: 1,
    x: 64,
    y: 64,
    drawId: 1,
    width: 32,
    height: 32,
    frame: {
      asset: assetKey("tiles/layer1.tst"),
      tile: 5,
      transparent: { r: 0, g: 1, b: 2 },
    },
  };

  const imageSprite: SpriteDraw = {
    id: "imgSprite",
    key: "fx",
    layer: 1,
    x: 64,
    y: 80,
    drawId: 2,
    width: 24,
    height: 24,
    frame: {
      file: "hero.png",
      transparent: { r: 255, g: 0, b: 255 },
    },
    translucency: 180,
    blend: "additive",
  };

  const heroTex: DecodedTexture = { w: 24, h: 24, rgba: new Uint8Array(24 * 24 * 4) };
  const assets = new Map<AssetKey, DecodedTexture>([
    [assetKey("hero.png"), heroTex],
  ]);

  const list = composeBoard({
    board: baseBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 128, height: 128 },
    alpha: 0,
    include: { shading: true, images: false, sprites: true },
    sprites: [tileSprite, imageSprite],
    assets,
    globalAmbient: { r: 10, g: 20, b: 30 },
  });

  const tileBlit = list.commands.find((c) => c.kind === "blit" && "asset" in c.source && c.source.tile === 5);
  equal(tileBlit !== undefined, true);
  if (tileBlit?.kind === "blit") {
    deepEqual(tileBlit.tint, { r: 15, g: 25, b: 35 });
    deepEqual(tileBlit.key, { r: 0, g: 1, b: 2 });
  }

  const imgBlit = list.commands.find((c) => c.kind === "blit" && "asset" in c.source && c.source.asset === assetKey("hero.png"));
  equal(imgBlit !== undefined, true);
  if (imgBlit?.kind === "blit") {
    deepEqual(imgBlit.tint, { r: 15, g: 25, b: 35 });
    deepEqual(imgBlit.key, { r: 255, g: 0, b: 255 });
    equal(imgBlit.alpha, 180);
    equal(imgBlit.blend, "additive");
  }
});

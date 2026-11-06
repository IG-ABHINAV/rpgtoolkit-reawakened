import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assetKey,
  composeBoard,
  createAssetIndex,
  hydrateBoard,
  initCameraForBoard,
  createCameraSection,
  PACKAGE_ROOT,
  tileToPixel,
  type AssetKey,
  type BoardView,
  type DrawCommand,
  type SpriteDraw,
  type WorldBoard,
  type WorldShadeLayer,
  type WorldTile,
  type WorldVector,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const AUTHORED = join(here, "fixtures", "authored");

const ISO_TILE: WorldTile = { asset: assetKey("tiles/art.iso"), tile: 2, nativeWidth: 64, nativeHeight: 32, width: 64, height: 32 };
const FLAT_TILE: WorldTile = { asset: assetKey("tiles/art.tst"), tile: 3 };

type BoardExtra = {
  shadeLayers?: WorldShadeLayer[];
  vectors?: WorldVector[];
  start?: NonNullable<WorldBoard["start"]>;
  width?: number;
  height?: number;
};

function board(layout: "stacked" | "rotated", tile: (x: number, y: number) => WorldTile | null, extra: BoardExtra = {}): WorldBoard {
  const rotated = layout === "rotated";
  const sizeX = 3;
  const sizeY = rotated ? 2 : 5;
  const gridWidth = rotated ? sizeX + sizeY : sizeX;
  const gridHeight = rotated ? gridWidth : sizeY;
  return {
    key: assetKey("boards/iso.brd"),
    coordType: rotated ? 2 : 1,
    sizeX,
    sizeY,
    sizeL: 1,
    gridWidth,
    gridHeight,
    width: 64 * sizeX - 32,
    height: rotated ? 32 * sizeY : 16 * sizeY - 16,
    background: { r: 1, g: 2, b: 3 },
    ambient: { r: 0, g: 0, b: 0 },
    layers: [{ tiles: Array.from({ length: gridWidth * gridHeight }, (_, cell) => tile(cell % gridWidth, Math.floor(cell / gridWidth))) }],
    ...extra,
  };
}

function blits(commands: readonly DrawCommand[]): Array<Extract<DrawCommand, { kind: "blit" }>> {
  return commands.filter((command): command is Extract<DrawCommand, { kind: "blit" }> => command.kind === "blit");
}

const view = (b: WorldBoard, extra: { sprites?: readonly SpriteDraw[]; camera?: { x: number; y: number } } = {}): BoardView => ({
  board: b,
  tick: 0,
  camera: { x: 0, y: -100 },
  viewport: { width: 640, height: 640 },
  alpha: 0,
  include: { shading: true, images: false, sprites: true },
  ...extra,
});

test("both isometric layouts paint tiles in projected (y, x) painter order, each into its own 64x32 diamond", () => {
  for (const layout of ["stacked", "rotated"] as const) {
    const b = board(layout, () => ISO_TILE);
    const drawn = blits(composeBoard(view(b)).commands);
    const gridWidth = b.gridWidth ?? 0;
    const gridHeight = b.gridHeight ?? 0;
    const expected: Array<{ x: number; y: number }> = [];
    for (let y = 1; y <= gridHeight; y += 1) {
      for (let x = 1; x <= gridWidth; x += 1) {
        const centre = tileToPixel(layout === "rotated" ? "iso-rotated" : "iso-stacked", b.sizeX, x, y);
        const dst = { x: centre.x - 32, y: centre.y - 16 + 100 };
        // Diamonds wholly outside the 640x640 viewport (the rotated grid's corners lie off the board) are culled.
        if (dst.x + 64 > 0 && dst.y + 32 > 0 && dst.x < 640 && dst.y < 640) expected.push(dst);
      }
    }
    expected.sort((left, right) => left.y - right.y || left.x - right.x);
    equal(expected.length > 0, true);
    deepEqual(drawn.map((command) => ({ x: command.dst.x, y: command.dst.y })), expected, layout);
    for (const command of drawn) {
      equal(command.dst.w, 64);
      equal(command.dst.h, 32);
      equal(command.iso2d, false);
      deepEqual(command.src, { x: 0, y: 0, w: 64, h: 32 });
    }
  }
});

test("ordinary tiles on an isometric board are projected: iso2d blit of the 32x32 source into the diamond", () => {
  const drawn = blits(composeBoard(view(board("stacked", () => FLAT_TILE))).commands);
  equal(drawn.length > 0, true);
  for (const command of drawn) {
    equal(command.iso2d, true);
    deepEqual(command.src, { x: 0, y: 0, w: 32, h: 32 });
    deepEqual({ w: command.dst.w, h: command.dst.h }, { w: 64, h: 32 });
  }
});

test("shading is read from the stored grid, which is (sizeX + sizeY) wide on rotated boards", () => {
  // Rotated 3x2: stored grid is 5x5, so cell (x=2, y=1) is record cell 7.
  const shaded = board("rotated", () => ISO_TILE, {
    shadeLayers: [{ castLayer: 0, records: [{ runCount: 7, r: 0, g: 0, b: 0 }, { runCount: 1, r: 9, g: 8, b: 7 }, { runCount: 17, r: 0, g: 0, b: 0 }] }],
  });
  const tints = blits(composeBoard(view(shaded)).commands).map((command) => ({ at: `${command.dst.x},${command.dst.y}`, tint: command.tint }));
  const centre = tileToPixel("iso-rotated", 3, 3, 2);
  const hit = tints.filter((entry) => entry.tint.r !== 0);
  deepEqual(hit, [{ at: `${centre.x - 32},${centre.y - 16 + 100}`, tint: { r: 9, g: 8, b: 7 } }]);
});

test("sprites keep strict (layer, projected y, drawId) order on isometric boards", () => {
  const b = board("rotated", () => null);
  const sprites: SpriteDraw[] = [
    { id: "lower", key: "item", layer: 1, x: 64, y: 40, drawId: 1 },
    { id: "upper", key: "player", layer: 1, x: 96, y: 24, drawId: 2 },
  ];
  const rects = composeBoard(view(b, { sprites, camera: { x: 0, y: 0 } })).commands.filter((command) => command.kind === "rect");
  deepEqual(rects.map((command) => (command.kind === "rect" ? command.rect.y : null)), [8, 24]);
});

test("under-vector redraw leaves isometric tiles alone but still repaints background spans", () => {
  const b = board("stacked", () => ISO_TILE, {
    vectors: [{ points: [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 64 }, { x: 0, y: 64 }], attributes: 3, closed: 1, layer: 1, type: 2, handle: "" }],
  });
  const sprite: SpriteDraw = { id: "p", key: "player", layer: 1, x: 80, y: 40, drawId: 1 };
  const commands = composeBoard(view(b, { sprites: [sprite], camera: { x: 0, y: 0 } })).commands;
  equal(blits(commands).some((command) => command.dst.h === 1), false);
  equal(commands.some((command) => command.kind === "rect" && command.rect.h === 1), true);
});

test("authored isometric boards hydrate with the documented grid and pixel dimensions", () => {
  for (const [file, coordType, gridWidth, width, height] of [
    ["iso-oracle-stacked.brd", 1, 3, 160, 64],
    ["iso-oracle-rotated.brd", 2, 5, 160, 64],
  ] as const) {
    const logical = [`Boards/${file}`, "Tiles/iso-oracle-grass.iso", "Tiles/iso-oracle-ordinary.tst"];
    const files = new Map<AssetKey, Uint8Array>(logical.map((path) => [assetKey(path), new Uint8Array(readFileSync(join(AUTHORED, path.split("/")[1] ?? "")))]));
    const key = assetKey(logical[0] ?? "");
    const hydrated = hydrateBoard(key, files.get(key) ?? new Uint8Array(), createAssetIndex(logical), PACKAGE_ROOT, files);
    equal(hydrated.error, null);
    const world = hydrated.value?.board;
    equal(world?.coordType, coordType);
    equal(world?.gridWidth, gridWidth);
    equal(world?.gridHeight, 5);
    equal(world?.width, width);
    equal(world?.height, height);
    equal(world?.layers[0]?.tiles.length, (world?.gridWidth ?? 0) * (world?.gridHeight ?? 0));
  }
});

test("with no tracked sprite the camera centres on the start position, stored in pixels (E-53)", () => {
  const big = board("stacked", () => null, { width: 2000, height: 2000, start: { x: 700, y: 400, layer: 1 } });
  const camera = initCameraForBoard(createCameraSection(128, 64), big);
  deepEqual({ x: camera.x, y: camera.y }, { x: 700 - 64, y: 400 - 32 });
});

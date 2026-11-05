import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { canon, createAssetIndex, createEmptyBoard, PACKAGE_ROOT, writeBoard } from "../src/index.ts";
import { assetKey } from "../src/formats/resolver/resolver.ts";
import { hydrateBoard } from "../src/world/hydrate.ts";
import { createGameState } from "../src/save/state.ts";
import { restoreGameState, snapshot } from "../src/save/snapshot.ts";


test("hydrateBoard rejects malformed board bytes without partial world state", () => {
  const index = createAssetIndex(["Boards/village.brd", "Tiles/village.tst", "Tiles/water.tan"]);
  const result = hydrateBoard(assetKey("boards/village.brd"), new Uint8Array([0]), index, PACKAGE_ROOT, new Map());
  equal(result.value, null);
  equal(result.error !== null, true);
  equal(result.missing, null);
});
test("hydrateBoard builds plain world data and compacts empty item slots", () => {
  const source = createEmptyBoard();
  const board = {
    ...source,
    sizeX: 2,
    sizeY: 1,
    sizeL: 1,
    layerTitles: ["", ""],
    lut: [""],
    tileMatrix: [0, 0],
    tileRuns: [{ lutIndex: 0, count: 2, marker: true }],
    sprites: [
      { itemFile: "", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 0, y: 0, layer: 1, reserved: -1 },
      { itemFile: "chest.itm", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 32, y: 32, layer: 1, reserved: -1 },
    ],
  };
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const index = createAssetIndex(["Boards/test.brd"]);
  const result = hydrateBoard(assetKey("boards/test.brd"), encoded.value, index, PACKAGE_ROOT, new Map());
  if (result.value === null) throw new Error(result.error?.message ?? "expected hydration");
  equal(result.value.board.gridWidth, 2);
  equal(result.value.board.gridHeight, 1);
  equal(result.value.board.items?.length, 1);
  equal(result.value.board.items?.[0]?.slot, 1);
  equal(result.value.board.rawItems?.length, 2);
  const state = createGameState({ seed: 7 });
  const restored = restoreGameState(snapshot({ ...state, world: { ...state.world, board: result.value.board } })).world.board;
  if (restored === null || restored === undefined) throw new Error("expected restored board");
  deepEqual(restored, result.value.board);
  equal(canon(result.value.board as never), canon(restored as never));
});

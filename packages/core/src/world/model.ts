/**
 * Plain-data run-time board state (AD-10; docs/spec/formats/board.md#coordinates,
 * #items-placed-on-the-board-sprites and #animated-tiles). Format residue and
 * decoded pixels stay outside GameState.
 */
import type { AssetKey } from "../ports/keys.ts";
import type { Tint } from "../ports/draw.ts";
import type { PlainData } from "../ports/plain-data.ts";

type DataRecord = { readonly [key: string]: PlainData };
export type WorldRgb = DataRecord & { readonly r: number; readonly g: number; readonly b: number };
export type WorldPoint = DataRecord & { readonly x: number; readonly y: number };

export type WorldAnimatedTile = DataRecord & {
  readonly ticksPerFrame: number;
  readonly frames: WorldTile[];
};
export type WorldTile = DataRecord & {
  readonly asset: AssetKey;
  readonly tile: number;
  readonly nativeWidth?: number;
  readonly nativeHeight?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tint?: Tint;
  readonly animation?: WorldAnimatedTile;
};
export type WorldLayer = DataRecord & { readonly tiles: (WorldTile | null)[] };
export type WorldShadeRecord = DataRecord & { readonly runCount: number; readonly r: number; readonly g: number; readonly b: number };
export type WorldShadeLayer = DataRecord & { readonly castLayer: number; readonly records: WorldShadeRecord[] };
export type WorldLight = DataRecord & { readonly layer: number; readonly type: number; readonly nodes: WorldPoint[]; readonly colours: WorldRgb[] };
export type WorldVector = DataRecord & { readonly points: WorldPoint[]; readonly attributes: number; readonly closed: number; readonly layer: number; readonly type: number; readonly handle: string };
export type WorldProgram = DataRecord & {
  readonly program: string;
  readonly graphic: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly repeatDistance: number;
  readonly layer: number;
  readonly points: WorldPoint[];
  readonly closed: number;
  readonly handle: string;
};
export type WorldItem = DataRecord & {
  readonly slot: number;
  readonly itemFile: string;
  readonly activationPrg: string;
  readonly multitaskPrg: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly loadingVar: string;
  readonly loadingValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly reserved: number;
};
export type WorldImageCell = DataRecord & {
  readonly x: number;
  readonly y: number;
  readonly tile: WorldTile | null;
  readonly tint?: Tint;
};
export type WorldImage = DataRecord & {
  readonly file: string;
  readonly left: number;
  readonly top: number;
  readonly layer: number;
  readonly drawType: number;
  readonly transparent: WorldRgb;
  readonly reserved: number;
  readonly asset?: AssetKey;
  readonly width?: number;
  readonly height?: number;
  readonly cells?: WorldImageCell[];
};
export type WorldTileset = DataRecord & {
  readonly asset: AssetKey;
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  readonly width: number;
  readonly height: number;
};

/** One runtime tile replacement and its value before the edit. */
export type WorldTileEdit = DataRecord & {
  readonly index: number;
  readonly tile: WorldTile | null;
  readonly previous: WorldTile | null;
  readonly scope: "program" | "board";
  readonly owner?: number;
};

/** Runtime-only board state that is still part of the saveable world section. */
export type WorldRuntime = DataRecord & {
  readonly tileEdits: WorldTileEdit[];
  readonly tileTypes: string[];
};

/** Runtime emitter key for a loaded board (EMIT-8, ACT-9). */
export function boardEmitterKey(key: AssetKey | string): string {
  return `board:${key}`;
}

/** Hydrated, JSON-safe board data used by the compositor and movement systems. */
export type WorldBoard = DataRecord & {
  readonly key: AssetKey;
  readonly coordType: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeL: number;
  readonly gridWidth?: number;
  readonly gridHeight?: number;
  readonly width: number;
  readonly height: number;
  readonly background: WorldRgb;
  readonly ambient: WorldRgb;
  readonly activeAmbient?: WorldRgb;
  readonly backgroundImage?: string;
  readonly backgroundDrawType?: number;
  readonly backgroundMusic?: string;
  readonly enterPrg?: string;
  readonly battleBackground?: string;
  readonly battleSkill?: number;
  readonly allowBattles?: number;
  readonly disableSaving?: number;
  readonly layers: WorldLayer[];
  readonly lut?: string[];
  readonly tileMatrix?: number[];
  readonly shadeLayers?: WorldShadeLayer[];
  readonly lights?: WorldLight[];
  readonly vectors?: WorldVector[];
  readonly programs?: WorldProgram[];
  readonly rawItems?: WorldItem[];
  readonly items?: WorldItem[];
  readonly images?: WorldImage[];
  readonly threads?: string[];
  readonly constants?: string[];
  readonly layerTitles?: string[];
  readonly links?: DataRecord & { readonly north: string; readonly south: string; readonly east: string; readonly west: string };
  readonly start?: DataRecord & { readonly x: number; readonly y: number; readonly layer: number };
  readonly tilesets?: WorldTileset[];
  readonly runtime?: WorldRuntime;
};

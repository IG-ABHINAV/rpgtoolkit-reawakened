/** Owner: core/render (E-54, E-59; docs/spec/engine/plugins-and-battle.md#e-54, docs/spec/engine/rpgcode-functions.md#e-59). */
import type { AssetKey, SurfaceId } from "../../ports/keys.ts";

export type FxColor = { r: number; g: number; b: number };

/** A resolved frame used by a stand-alone script animation (E-54). */
export type AnimationFrameState = {
  image: string;
  asset: AssetKey | null;
  tile: number | null;
  surface?: SurfaceId;
  srcWidth: number;
  srcHeight: number;
  transparent: FxColor;
  sound: string;
};

/** Saveable playback state for one `animation`/`sizedAnimation` call (E-54). */
export type AnimationState = {
  id: number;
  file: string;
  asset: AssetKey | null;
  x: number;
  y: number;
  width: number;
  height: number;
  loop: boolean;
  /** `pinnedanimation`: drawn above the render-now canvas and a one-shot holds its last frame until ended. Absent for the ordinary commands. */
  pinned?: true;
  /** `showpinnedanimation(id, false)`: not drawn, but the clock, frame and hold keep running. Absent while shown. */
  hidden?: true;
  originTick: number;
  delayTicks: number;
  frame: number;
  frames: AnimationFrameState[];
  loaded: boolean;
  finished: boolean;
  preparation: { stage: "source-ready"; picturesReady: boolean } | { stage: "pictures-requested"; picturesReady: null } | null;
  soundFrame: number;
};

export type FadeState = {
  kind: "fade";
  type: 0 | 1 | 2 | 3 | 4 | 5;
  elapsedTicks: number;
  totalTicks: 30;
};

export type WipeState = {
  kind: "wipe";
  file: string;
  asset: AssetKey | null;
  effect: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  speed: number;
  elapsedTicks: number;
  progress: number;
  total: number;
};

export type ZoomState = {
  kind: "zoom";
  from: number;
  target: number;
  elapsedTicks: number;
  totalTicks: 30;
};

export type EarthquakeState = {
  kind: "earthquake";
  intensity: number;
  pass: number;
};

export type FxSection = {
  borderColor: FxColor;
  fade: FadeState | null;
  wipe: WipeState | null;
  zoomPercent: number;
  zoom: ZoomState | null;
  earthquake: EarthquakeState | null;
  animations: AnimationState[];
  nextAnimationId: number;
};

export function createFxSection(): FxSection {
  return {
    borderColor: { r: 0, g: 0, b: 0 },
    fade: null,
    wipe: null,
    zoomPercent: 0,
    zoom: null,
    earthquake: null,
    animations: [],
    nextAnimationId: 1,
  };
}

import type { WorldBoard } from "../../world/model.ts";

/** Runtime settings owned by the loaded game, retained when a board changes. */
export type WorldMovementSettings = {
  walking: number | null;
  pushing: number | null;
};

/** Owner: core/world. */
export type WorldSection = { readonly board?: WorldBoard | null; movement: WorldMovementSettings };

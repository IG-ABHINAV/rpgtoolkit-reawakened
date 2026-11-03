/**
 * State section declarations for AD-10. The seven sections the board-rendering
 * epic owns (`world`, `camera`, `ui`, `fx`, `surfaces`, `input`, `engine`) live
 * in modules under `save/sections/`; this barrel re-exports them and the
 * sections owned elsewhere (`actors`, `party`, `inventory`, `menu`, `sprites`,
 * `triggers`, `battle`, `audio`, `events`).
 *
 * AD-10 (one state tree, one owner per section); AD-11 (one canonical form);
 * docs/spec/formats/save-game.md#reawakened-canonical-party-inventory-and-menu-state
 * (the saved game).
 */

export type { WorldSection } from "./sections/world.ts";
export {
  createCameraSection,
  type CameraEasing,
  type CameraPanState,
  type CameraPoint,
  type CameraSection,
  type CameraShakeState,
  type CameraTrackingTarget,
} from "./sections/camera.ts";
export { createUiSection, type UiSection, type UiMessageWindow, type UiModal, type UiTextDraw, type UiCursorPoint, type UiCursorMap, type UiCursorImage, type UiCursorHand, type UiButton } from "./sections/ui.ts";
export {
  createFxSection,
  type AnimationFrameState,
  type AnimationState,
  type EarthquakeState,
  type FadeState,
  type FxColor,
  type FxSection,
  type WipeState,
  type ZoomState,
} from "./sections/fx.ts";
export type { RgbaSnapshot, SurfaceState, SurfacesSection } from "./sections/surfaces.ts";
export { INPUT_SCHEMA_VERSION, type InputBindings, type InputButton, type InputButtonSlot, type InputGamepad, type InputImageButton, type InputPointer, type InputSection } from "./sections/input.ts";
export type { EngineSection } from "./sections/engine.ts";
export type { EventsSection } from "../events/model.ts";

export type { SpritesSection } from "../sprites/model.ts";

/** Owner: `core/actors` (ACT-1/ACT-3; AD-10). */
export type { ActorsSection } from "../actors/model.ts";

/** Owner: `core/menu` (roster, selection, steps). */
export { createPartySection, PARTY_SCHEMA_VERSION, type PartySection } from "../menu/model.ts";

/** Owner: `core/menu` (items, equipment, gold). */
export { createInventorySection, INVENTORY_SCHEMA_VERSION, type InventorySection } from "../menu/model.ts";

/** Owner: `core/triggers` (armed and fired state, repeat counters). */
export type { TriggersSection } from "../triggers/model.ts";

/** Owner: `core/battle` (fighter references and charge only). */
export { BATTLE_SCHEMA_VERSION, createBattleSection, type BattleSection, type BattleFighter, type BattleIssue, type BattleParty, type BattleState, validateBattleSection, isBattleFighterUsable } from "../battle/model.ts";

/** Owner: `core/menu` (open screens). */
export { createMenuSection, MENU_SCHEMA_VERSION, type MenuSection } from "../menu/model.ts";

/** Owner: `core/audio` (tracks, voices, `cueId`, script settings): schema v2, docs/spec/engine/audio-media.md#audio-state. */
export type { AudioStateV2 as AudioSection } from "../audio/model.ts";

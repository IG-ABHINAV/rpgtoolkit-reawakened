/**
 * The save tree, the RNG and time sections, and snapshots (AD-7, AD-10,
 * AD-11, AD-23).
 *
 * AD-10 (one state tree) and AD-11 (one canonical form); docs/spec/formats/save-game.md#layout-minor-4 (the
 * saved game).
 */

export { createGameState, createSchemaState, SCHEMA_VERSIONS } from "./state.ts";
export type { GameState, GameStateIsPlainData, SchemaState, SectionKey } from "./state.ts";
export { restoreGameState, snapshot } from "./snapshot.ts";
export type { RestoreOptions } from "./snapshot.ts";
export { snapshotGameSave, restoreGameSave, snapshotRecoveryCandidate, restoreRecoveryCandidate } from "./game-save.ts";
export type { RestoredGameSave, RestoredRecoveryCandidate, RecoveryAssetFingerprint, RecoveryAssetManifest, RecoveryListenerAnchor } from "./game-save.ts";
export { deriveGameId, deriveGameIdFromContentHash, derivePackageIdentity, foldPackageIdentity, packageIdentityRecord } from "./game-id.ts";
export type { PackageIdentityFile } from "./game-id.ts";
export { hashGameState } from "./hash.ts";
export { checkEquipmentConsistency } from "./equipment-check.ts";
export type { EquipmentAssetLookup, EquipmentCheckResult } from "./equipment-check.ts";
export {
  promoteRecovery,
  RECOVERY_STORE_VERSION,
  RecoveryStoreError,
  selectRecovery,
} from "./recovery-store.ts";
export type {
  RecoveryCandidateMeta,
  RecoveryPointer,
  RecoveryPromoteOptions,
  RecoverySelectOptions,
  RecoveryStorage,
  RecoveryValidate,
  RecoveryValidation,
  ValidatedRecovery,
} from "./recovery-store.ts";
export {
  GAME_LEDGER_DOMAIN,
  GAME_LEDGER_VERSION,
  GameLedgerError,
  hashGameLedger,
  hashGameLedgerV3,
  projectGameLedger,
  LEDGER_BOARD,
  LEDGER_IDENTITY,
  LEDGER_REFERENCE,
  LEDGER_SHAPE,
} from "./ledger.ts";
export type {
  GameLedgerEnvelope,
  GameLedgerV1,
  GameLedgerV1IsPlainData,
  LedgerActor,
  LedgerActorBonuses,
  LedgerActorEquipment,
  LedgerActorProgression,
  LedgerActorStats,
  LedgerActors,
  LedgerBoard,
  LedgerBoardProgram,
  LedgerBoardRuntime,
  LedgerBoardVector,
  LedgerCallableValue,
  LedgerCells,
  LedgerInventory,
  LedgerInventoryEquipment,
  LedgerInventoryItem,
  LedgerObject,
  LedgerObjectValue,
  LedgerParty,
  LedgerPersistentGraph,
  LedgerPoint,
  LedgerPresence,
  LedgerProgramRef,
  LedgerRandomEncounter,
  LedgerRawItem,
  LedgerRng,
  LedgerScript,
  LedgerSprite,
  LedgerSpriteBase,
  LedgerSpriteVisual,
  LedgerSprites,
  LedgerTaggedNumber,
  LedgerTile,
  LedgerTileEdit,
  LedgerTime,
  LedgerTint,
  LedgerTriggers,
  LedgerValue,
  LedgerWorld,
} from "./ledger.ts";
export {
  createFxSection,
  BATTLE_SCHEMA_VERSION,
  createBattleSection,
  validateBattleSection,
  isBattleFighterUsable,
  type BattleSection,
  type BattleFighter,
  type BattleIssue,
  type BattleParty,
  type BattleState,
  type CameraSection,
  type EngineSection,
  type FxSection,
  type InputSection,
  type InventorySection,
  type MenuSection,
  type PartySection,
  type SpritesSection,
  type RgbaSnapshot,
  type SurfaceState,
  type SurfacesSection,
  type TriggersSection,
  type UiSection,
  type WorldMovementSettings,
  type WorldSection,
} from "./sections.ts";
export { DISPLAY_SCHEMA_VERSION, HOST_FEATURES_SCHEMA_VERSION, createDisplaySection, normalizeDisplayGeometry, normalizeHostFeatures } from "./sections/host.ts";
export type { DisplaySection, HostFeaturesSection } from "./sections/host.ts";

export type { ActorsSection } from "../actors/model.ts";

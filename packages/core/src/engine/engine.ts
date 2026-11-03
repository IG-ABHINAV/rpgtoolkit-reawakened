import { fnv1a64, hashDrawList, utf8Decode, utf8Encode } from "../canon/index.ts";
import { restoreGameSave, snapshotGameSave, restoreRecoveryCandidate, snapshotRecoveryCandidate, type RecoveryAssetManifest, type RecoveryListenerAnchor, type RestoredRecoveryCandidate } from "../save/game-save.ts";
import { deriveGameId } from "../save/game-id.ts";
import { restoreGameState, snapshot } from "../save/snapshot.ts";
import { createPluginLayers, type PluginLayers } from "../script/layers.ts";
import { actorEmitterKey, actorId } from "../actors/model.ts";
import type { AudioSaveProjection } from "../audio/save.ts";
import { projectGameLedger, type GameLedgerV1, type LedgerProgramRef, type LedgerTile } from "../save/ledger.ts";
import { applyRecoveryLedger, installRecoveryBoard } from "./recovery.ts";
import { updateActorStats, type ActorRuleResult, type ActorTransition } from "../actors/rules.ts";
import { queueActorTransition, registerActorObject } from "../actors/object.ts";
import { resolveAsset, assetKey, resolveTileReference } from "../formats/resolver/resolver.ts";
import { classifyImageReference } from "../formats/animation/image-reference.ts";
import { decodeTexture, type DecodedTexture } from "../formats/image/index.ts";
import { expandSingleTileToRgba, readSingleTile } from "../formats/single-tile/index.ts";
import { expandTileToRgba, readTileset, tileDimensions } from "../formats/tileset/index.ts";
import { compositeTileBitmap, readTileBitmap, tileBitmapCell, type TileBitmapTile } from "../formats/tile-bitmap/index.ts";
import { readTileAnimation } from "../formats/tile-animation/reader.ts";
import { err, ok, type Result } from "../formats/result.ts";
import { readCharacter } from "../formats/actor/character.ts";
import { readItem } from "../formats/actor/item.ts";
import type { Character, Item } from "../formats/actor/model.ts";
import { actorInputFromCharacter } from "../actors/hydrate.ts";
import { readMainFile } from "../formats/main-file/reader.ts";
import { planPrefetch, prefetchSignature, type PrefetchFacts } from "../prefetch/plan.ts";
import { readBattleBackground } from "../formats/battle/battle-background.ts";
import { BinaryReader } from "../formats/binary/reader.ts";
import type { MainFile } from "../formats/main-file/model.ts";
import { readLegacyFont } from "../formats/font/reader.ts";
import { gateTrueType } from "../formats/font/truetype.ts";
import type { AssetKind } from "../formats/main-file/layout.ts";
import type { AssetIndex, AssetRoot } from "../formats/resolver/model.ts";
import type { DrawCommand, DrawList, Rgb, Tint } from "../ports/draw.ts";
import type { InputRecord } from "../ports/input.ts";
import type { Engine, Diagnostic, Breakpoint, DrawListInclude, RecoveryStatus, ResumeMode, SurfacePixels } from "../ports/engine.ts";
import type { InputConfig } from "../input/input.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { Value } from "../ports/value.ts";
import type { RunnerRequest } from "../ports/requests.ts";
import type { StartupPorts } from "../ports/startup.ts";
import type { AssetKey, SurfaceId } from "../ports/keys.ts";
import type { BlobKey } from "../ports/requests.ts";
import { createGameState, type GameState, type SectionKey } from "../save/state.ts";
import { resetUiForProgramStart } from "../save/sections/ui.ts";
import { applyMenuStateEffect, createMenuOwnerPorts } from "../menu/index.ts";
import { createShopSessionRuntime } from "./shop-session.ts";
import { hashGameState } from "../save/hash.ts";
import { assembleAudioDecoders, decodeAudioInfo } from "../audio/info.ts";
import { createAudioRuntime } from "../audio/runtime.ts";
import { createMediaScriptService, mediaVoiceRef } from "../audio/script.ts";
import { mediaEventsActive, queueAudioEvent, MEDIA_EMITTER } from "../audio/events.ts";
import type { AudioInfo } from "../formats/audio/model.ts";
import type { AssetDecoder } from "../formats/registry/decoder.ts";
import { BUILTIN_TRACKS, MAX_VOICES } from "../audio/model.ts";
import type { Logger } from "../ports/logger.ts";
import { composeBoard, type BoardBlit, type SpriteDraw } from "../render/compose.ts";
import { composeUi, composeUiCursor, renderNowBlit } from "../render/ui.ts";
import { emitText, layoutText, resolveFontAsset } from "../render/text.ts";
import { applyFxDrawList, advanceFx, applyFxEffect } from "../render/fx.ts";
import { advanceAnimations, animationBlits, loadAnimation, releaseAnimationSurfaces } from "../render/animation.ts";
import { hydrateBoard } from "../world/hydrate.ts";
import { coordLayout, tileToPixel } from "../world/coords.ts";
import { boardEmitterKey, type WorldBoard, type WorldTile } from "../world/model.ts";
import type { AnimationState, FxSection } from "../save/sections.ts";
import { applyInputEvent, claimInputBefore, createInputSection, inputView, processGamepadEvents, pruneClaimed } from "../input/index.ts";
import { applyWorldEffect, expireProgramTileEdits } from "../world/effects.ts";
import { applyCameraEffect, createCameraSection, initCameraForBoard, positionAt, realignCamera, updateCamera } from "../world/camera.ts";
import { applyInputEffect, applySpriteEffect } from "../script/packs/world.ts";
import type { CameraPoint, CameraTarget } from "../ports/camera.ts";
import type { SpriteActor, Facing } from "../sprites/model.ts";
import { resetSpritesSection, placeSelectedPlayer, selectActor as selectPartyActor, removeActorSprite, spriteDraws, createInitialPlayer, type SpriteRuntime } from "../sprites/runtime.ts";
import { boardCollisionAt } from "../sprites/movement.ts";
import { resetTriggersSection } from "../triggers/model.ts";
import { applyTriggerEffect } from "../triggers/runtime.ts";
import { clearPathfindingCache } from "../sprites/pathfinding.ts";
import { runRandomEncounterPhase } from "../sprites/encounters.ts";
import { EffectBus, type EffectApplier, type PostEffect } from "./effects.ts";
import { engineEffect, pluginManifestFor, privateFontKeys, programKeys, resolveManifestPlugins } from "./boot.ts";
import type { EnginePhase, EngineRequestKind, EngineSection } from "../save/sections/engine.ts";
import { collectStateGarbage, runEngineCancelableEvent, runEngineCancelableEventOutcome, runEventsPhase } from "../events/dispatch.ts";
import { deferUnregisterEmitter, queueNativeEvent, registerEmitter, unregisterEmitter } from "../events/emitter.ts";
import {
  IR_VERSION,
  createScriptServices,
  defaultWaitPoll,
  drainDiagnostics,
  ENGINE_DEFAULT_MANIFEST,
  ENGINE_PLUGIN_TABLE,
  endBoardThreads,
  endItemThreads,
  fileProgramRef,
  runPackageStartup,
  compileRestoredPrograms,
  verifyRestoredHandles,
  runThreadsPhase,
  discardMenuFrames,
  runWaitsPhase,
  layerRoots,
  withOwner,
  ScriptError,
  toDiagnostic,
  replyToRequest,
  startProgram,
  startThread,
  STEP_BUDGET,
  stepThread,
  applyUiEffect,
  type EffectRecord,
  type ProgramLoader,
  type ProgramRef,
  type ResolvedPlugin,
  type ScriptServices,
  createVmState,
} from "../script/index.ts";
import { hasLiveBlockingThread, type ObjectRecord, type Thread, type VmState } from "../script/state.ts";
import { findObject, readMember } from "../script/objects.ts";
import type { PackageCatalogueEntry, PluginDefinition } from "../script/plugin.ts";
import { DEFAULT_FONT_ASSET } from "../raster/text.ts";
import type { WaitView } from "../ports/wait.ts";
import { runTimePhase } from "../time/time.ts";
import { blitTexture, rasterize, readSurfacePixels, replaceSurface, surfaceTextures, createSurfacesSection, ensureScriptScreen, scriptScreen, type RasterAsset, type SurfacePixelCache } from "../raster/index.ts";
import { beginSurfaceBatch, endSurfaceBatch, flushSurfaceBatch } from "../raster/surfaces.ts";
import { guardExternalPlugins } from "./surface-guard.ts";

/** AD-26's immutable phase order. */
export const ENGINE_PHASES = [
  "input",
  "waits",
  "threads",
  "events",
  "movement",
  "edges",
  "triggers",
  "animation",
  "audio",
  "time",
] as const satisfies readonly EnginePhase[];

// Compile-time exhaustiveness: the saved `EnginePhase` union (the `engine` section's `phase`) and this list are
// one set, so a phase added to one must be added to the other.
type _MissingPhases = Exclude<EnginePhase, (typeof ENGINE_PHASES)[number]>;
const _phasesAreExhaustive: [_MissingPhases] extends [never] ? true : never = true;
void _phasesAreExhaustive;

export type { EnginePhase };

export type EnginePhaseRegistration = {
  readonly phase: EnginePhase;
  readonly rank?: number;
  readonly run: (state: GameState, postEffect?: (section: SectionKey, effect: PostEffect) => void) => void;
};

/** A section owner reset callback (E-06; docs/spec/engine/main-loop-and-startup.md#reawakened-reset-sections). */
export type EngineResetRegistration = {
  readonly section: SectionKey;
  readonly rank?: number;
  readonly reset: (state: GameState) => void;
};
/** Optional E-05 overlays supplied by the runner, never enabled implicitly in goldens. */
export type DebugOverlayConfig = {
  readonly fps?: number;
  readonly drawVectorsFlags?: number;
  readonly pathColor?: Rgb;
  readonly path?: readonly { readonly x: number; readonly y: number }[];
  readonly destination?: { readonly x: number; readonly y: number };
};

type EngineCommonInit = {
  /** Observation-only, outside state; ADR 0010. Rebound with services on boot/reset. */
  readonly scriptObservers?: import("../script/observers.ts").ScriptObservers;
  readonly seed: number;
  readonly assetIndex: AssetIndex;
  readonly assetRoot: AssetRoot;
  readonly width: number;
  readonly height: number;
  readonly maxTicks: number;
  /** Resolved plugin layers; when absent boot builds them from the main file (E-02 step 3). */
  readonly plugins?: readonly ResolvedPlugin[];
  /** Host-resolved package catalogue; it supplies definitions and program references, never file access. */
  readonly packageCatalogue?: readonly PackageCatalogueEntry[];
  readonly resetRegistrations?: readonly EngineResetRegistration[];
  readonly phaseRegistrations?: readonly EnginePhaseRegistration[];
  readonly effectAppliers?: readonly { readonly section: SectionKey; readonly applier: EffectApplier }[];
  readonly cameraTarget?: CameraTarget;
  readonly spriteRuntime?: SpriteRuntime;
  /** The author's default SoundFont (docs/spec/engine/audio-media.md#soundfont-layers rank 3); `null` or absent for none. */
  readonly defaultSoundFont?: AssetKey | null;
  readonly input?: InputConfig;
  readonly include?: DrawListInclude;
  /** Decoded image assets supplied by a host or deterministic scene runner. */
  readonly assets?: ReadonlyMap<AssetKey, DecodedTexture>;
  /** Files the host ships with the engine under `media/` (the default bitmap font, bundled TrueType fonts and cursor images), as bytes like every other asset. */
  readonly bundled?: ReadonlyMap<AssetKey, Uint8Array>;
  /** Additional scene/editor image commands, kept as draw-list data. */
  readonly blits?: readonly BoardBlit[];
  /** Additional static scene/editor sprite draw data; run-time actors come from `state.sprites` (E-52). */
  readonly sprites?: readonly SpriteDraw[];
  /** Script ambient summed with the board ambient once per tile blit (E-17). */
  readonly globalAmbient?: Tint;
  readonly debug?: DebugOverlayConfig;
};

/**
 * Scene mode: load one board and optionally run one program, with no start-up
 * sequence. The tracer bullet, the golden scenes and the editor previews use it.
 * There is no main file, so there is no game identity: every save-area operation
 * fails with a located `save.no-game-identity` error rather than borrowing one.
 */
export type SceneInit = EngineCommonInit & {
  readonly initialBoard: string;
  readonly program?: string | ProgramRef;
  readonly mainFile?: never;
  readonly startup?: never;
  readonly gameIdentity?: never;
  readonly recoveryCandidate?: never;
};

/**
 * Boot mode: run E-02 from the main file at the index path `mainFile`
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence).
 *
 * `gameIdentity` is the host's AD-17 identity for the game — `derivePackageIdentity`
 * for a package, a host-chosen stable string for a folder. Core hashes it with the
 * main file's bytes into the `GameId` that prefixes every save-area path; there is
 * no default.
 */
export type BootInit = EngineCommonInit & {
  readonly mainFile: string;
  readonly startup: StartupPorts;
  /** Host-validated candidate bytes for an explicit recovery launch; omitted or null means ordinary boot. */
  readonly recoveryCandidate?: Uint8Array | null;
  readonly initialBoard?: never;
  readonly program?: never;
  readonly gameIdentity: string;
};

export type EngineInit = SceneInit | BootInit;
type RequestEntry = { readonly reqId: number; readonly key: AssetKey; readonly kind: EngineRequestKind };
type PendingBlobRequest = {
  readonly reqId: number;
  readonly vmReqId: number;
  readonly kind: "loadBlob" | "saveBlob";
  readonly blob: BlobKey;
  readonly gameSave: boolean;
  readonly gameLoad: boolean;
  readonly hex: string | null;
  published: boolean;
};
type RecoveryCandidate = { readonly bytes: Uint8Array; readonly tick: number };
type RecoveryLaunch = {
  readonly candidate: RestoredRecoveryCandidate;
  readonly ledger: GameLedgerV1;
  readonly staged: GameState;
  readonly boardKey: AssetKey;
};
type PreparedRecovery = {
  readonly board: WorldBoard;
  readonly boardPrograms: ProgramRef[];
  readonly entryProgram: ProgramRef | null;
  readonly itemPrograms: Map<string, ProgramRef>;
};
type SourceLocation = { file: string; line: number };
type Paused = { thread: number; frame: number; line: number };
type BlobReplyResult = "ignored" | "consumed" | "loaded";
type Arrival = { readonly x: number; readonly y: number; readonly layer: number; readonly unit: "pixel" | "tile" };

const DEFAULT_ENGINE_PLUGINS: readonly ResolvedPlugin[] = resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins;
/** The engine's own packs: the only plugin definitions that may run mid-thread without a surface flush. */
const FIRST_PARTY_PLUGINS: ReadonlySet<PluginDefinition> = new Set(Object.values(ENGINE_PLUGIN_TABLE));
const SCRIPT_REQUEST_BASE = 0x40000000;
const SCRIPT_ASSET_AREAS: Readonly<Record<string, { readonly folder: string; readonly kind: "script-character" | "script-item" | "script-asset" }>> = {
  characters: { folder: "characters", kind: "script-character" },
  items: { folder: "item", kind: "script-item" },
  enemies: { folder: "enemy", kind: "script-asset" },
  specialMoves: { folder: "spcmove", kind: "script-asset" },
  statusEffects: { folder: "statuse", kind: "script-asset" },
  backgrounds: { folder: "bkrounds", kind: "script-asset" },
};

function encodeInlineScriptString(value: string): string {
  const codeUnits: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    codeUnits.push(value.charCodeAt(index).toString(16).padStart(4, "0"));
  }
  return codeUnits.join("");
}
function decodeHex(value: string): Uint8Array | null {
  if (value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const high = Number.parseInt(value.slice(index * 2, index * 2 + 1), 16);
    const low = Number.parseInt(value.slice(index * 2 + 1, index * 2 + 2), 16);
    if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
    bytes[index] = high * 16 + low;
  }
  return bytes;
}
function encodeHex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

/** Create the deterministic fixed-tick engine; host assets arrive only as AD-14 replies. */
const DEFAULT_GAME_AUDIO_SETTINGS = {
  tracks: BUILTIN_TRACKS.map(([name, voiceCount]) => ({ name, voiceCount })),
  voiceCap: MAX_VOICES,
};
export function createEngine(init: EngineInit): Engine {
  const index = init.assetIndex;
  let recoveryCandidateBytes = init.mainFile === undefined || init.recoveryCandidate == null
    ? null
    : new Uint8Array(init.recoveryCandidate);
  const recoveryLaunchRequested = recoveryCandidateBytes !== null;
  const state: GameState = createGameState({ seed: init.seed });
  state.input = createInputSection(init.input);
  state.engine = { claims: [] };
  const defaultFontAsset = DEFAULT_FONT_ASSET;
  let root: AssetRoot = init.assetRoot;
  let mainFile: MainFile | null = null;
  let sceneBoardKey: AssetKey | null = null;
  let loader: ProgramLoader | null = null;
  let initialCharacterKey: AssetKey | null = null;
  let initialCharacterResolved = true;
  let mainKey: AssetKey | null = null;
  const installedFonts = new Map<AssetKey, Uint8Array>();
  const cache = new Map<AssetKey, Uint8Array>();
  const inventoryItemDefinitions = new Map<AssetKey, Item>();
  const inventoryCharacterDefinitions = new Map<AssetKey, Character>();
  const decodedImages = new Map<AssetKey, DecodedTexture>();
  const decodedTiles = new Map<AssetKey, DecodedTexture>();
  const decodedBundled = new Map<AssetKey, RasterAsset | null>();
  const canvasTextAssets = new Map<AssetKey, RasterAsset>();
  const pending = new Map<number, RequestEntry>();
  const pendingBlobs = new Map<number, PendingBlobRequest>();
  const pendingImageEffects: Array<{ readonly key: AssetKey; readonly effect: EffectRecord }> = [];
  const pendingBoardPreviews: Array<{ readonly key: AssetKey; readonly effect: EffectRecord }> = [];
  const queuedInputs: InputRecord[] = [];
  const requestsOut: RunnerRequest[] = [];
  /** The last prefetch plan sent, so a board entry only sends a hint set that differs from it. */
  let lastPrefetch = "";
  /** Backgrounds unavailable for prefetch, including decode failures; do not request them again. */
  const missingBattleBackgrounds = new Set<AssetKey>();
  /** Sound facts from battle backgrounds fetched only for prefetch; kept out of the saved asset cache so prefetch hints stay hash-neutral. */
  const prefetchedBattleBackgrounds = new Map<AssetKey, PrefetchFacts["battle"]>();
  /** In-flight prefetch-only asset requests and their ids; these deliberately do not live in the saved engine section. */
  const prefetchPending = new Map<number, AssetKey>();
  let nextPrefetchReqId = 1;
  /**
   * A hint's own counter, deliberately **not** `nextRequestId`: that one lives in the saved `engine` section, so drawing
   * from it would move a state hash for a request that must change nothing (AD-5). A hint earns no reply, so its id only
   * has to be unique within the run.
   */
  let nextHintId = 1;
  let recoveryCaptureRequested = false;
  let preBattleRecoveryCandidate: RecoveryCandidate | null = null;
  let recoveryLaunch: RecoveryLaunch | null = null;
  let preparedRecovery: PreparedRecovery | null = null;
  let recoveryInitialized = false;
  let recoveryResumed = false;
  const diagnostics: Diagnostic[] = [];
  const registrations = [...(init.phaseRegistrations ?? [])].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
  const registrationByPhase = new Map<EnginePhase, EnginePhaseRegistration[]>();
  for (const registration of registrations) {
    const list = registrationByPhase.get(registration.phase) ?? [];
    list.push(registration);
    registrationByPhase.set(registration.phase, list);
  }
  const bus = new EffectBus(state, (diagnostic) => diagnostics.push(diagnostic));

  const shopSession = createShopSessionRuntime(() => state.vm.threads);
  const menuOwners = createMenuOwnerPorts(
    state,
    (event) => {
      if (event.type === "memberRemoved" && !state.actors.actors.some((actor) => actor.id === event.detail.actorId)) {
        removeActorSprite(state.sprites, actorId(event.detail.actorId));
        if (init.spriteRuntime !== undefined && init.spriteRuntime.section !== state.sprites) init.spriteRuntime.removeActor(actorId(event.detail.actorId));
      }
      if (event.type === "activeMemberChanged") {
        selectPartyActor(state.sprites, event.detail.currentActorId === null ? null : actorId(event.detail.currentActorId));
        if (init.spriteRuntime !== undefined && init.spriteRuntime.section !== state.sprites) {
          init.spriteRuntime.selectActor(event.detail.currentActorId === null ? null : actorId(event.detail.currentActorId));
        }
      }
      registerEmitter(state.vm, state.events, "party");
      queueNativeEvent(state.vm, state.events, "party", event.type, event.detail);
    },
    {
      item(source) {
        const resolved = resolveAsset(index, root, "items", source);
        if (!resolved.ok) return undefined;
        const cached = inventoryItemDefinitions.get(resolved.value);
        if (cached !== undefined) return cached;
        const bytes = cache.get(resolved.value);
        if (bytes === undefined) return undefined;
        const parsed = readItem(new BinaryReader(bytes));
        if (!parsed.ok) return undefined;
        inventoryItemDefinitions.set(resolved.value, parsed.value);
        return parsed.value;
      },
      character(source) {
        const resolved = resolveAsset(index, root, "characters", source);
        if (!resolved.ok) return undefined;
        const cached = inventoryCharacterDefinitions.get(resolved.value);
        if (cached !== undefined) return cached;
        const bytes = cache.get(resolved.value);
        if (bytes === undefined) return undefined;
        const parsed = readCharacter(new BinaryReader(bytes));
        if (!parsed.ok) return undefined;
        inventoryCharacterDefinitions.set(resolved.value, parsed.value);
        return parsed.value;
      },
      applyEquipment(actorId, equipped, catalog) {
        return services.actors.applyEquipment(actorId, equipped, catalog) !== null;
      },
      updateStats(actorId, patch) {
        return services.actors.updateStats(actorId, patch, { cause: "script", source: null }) !== null;
      },
      prepareEquipment(actorId, equipped, catalog) {
        return services.actors.prepareEquipment(actorId, equipped, catalog);
      },
      commitPreparedEquipment(prepared) {
        return services.actors.commitPreparedEquipment(prepared) !== null;
      },
      discardPreparedEquipment(prepared) {
        services.actors.discardPreparedEquipment(prepared);
      },
      shopStock: () => shopSession.stock(),
      setShopStock: shopSession.setStock,
      closeShop: shopSession.close,
    },
    (event) => {
      registerEmitter(state.vm, state.events, "inventory");
      queueNativeEvent(state.vm, state.events, "inventory", event.type, event.detail);
    },
    () => {
      const candidate = {
        ...state.actors,
        actors: state.actors.actors.map((actor) => ({
          ...actor,
          stats: { ...actor.stats },
          equipment: { ...actor.equipment, equipped: [...actor.equipment.equipped], bonuses: { ...actor.equipment.bonuses } },
          statuses: { ...actor.statuses },
        })),
      };
      const transitions: ActorTransition[] = [];
      try {
        for (const id of state.party.members) {
          const actor = candidate.actors.find((entry) => entry.id === id && entry.kind === "party");
          if (actor === undefined) return { ok: false, error: { path: "party.inn", message: "party member actor is unavailable" } };
          const result = updateActorStats(candidate, id, { hp: actor.stats.maxHp, smp: actor.stats.maxSmp }, {
            cause: "script",
            hooks: services.actors.hooks(id),
          });
          if (result === null) return { ok: false, error: { path: "party.inn", message: "actor restoration was refused" } };
          transitions.push(...result.transitions);
        }
      } catch {
        return { ok: false, error: { path: "party.inn", message: "actor restoration was refused" } };
      }
      state.actors.actors = candidate.actors;
      for (const transition of transitions) queueActorTransition(state.vm, state.events, state.actors, transition);
      return { ok: true, error: null };
    },
  );
  for (const section of ["party", "inventory", "menu"] as const) {
    bus.register(section, (effect) => applyMenuStateEffect(menuOwners, effect));
  }
  // The script-facing media owner (MEDIA-1): starts post through the one bus so
  // the audio applier stays the only start route; `bind` fills the returned voice.
  const media = createMediaScriptService(
    state,
    (name, args) => bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue")),
    (file) => {
      const resolved = resolveAsset(index, root, "media", file);
      return resolved.ok ? resolved.value : null;
    },
    (code, op, detail) => {
      const file = detail["file"];
      const text = Object.entries(detail).map(([key, value]) => `${key}=${String(value)}`).join(" ");
      diagnostics.push({ code, file: typeof file === "string" ? file : "", line: 0, message: `${op}: ${code} ${text}`.trimEnd() });
    },
  );
  bus.register("world", (effect) => applyWorldEffect(state, effect));
  bus.register("camera", (effect) => applyCameraEffect(state, effect));
  bus.register("ui", (effect) => {
    const lower = effect.name.toLowerCase();
    if ((lower === "text" || lower === "pixeltext") && typeof effect.args[3] === "number" && effect.args[3] !== 0) {
      applyCanvasText(lower === "text", effect.args);
      return;
    }
    applyUiEffect(state, effect.name, effect.args, (name) => resolveFontAsset(name, index.keys));
  });
  bus.register("fx", (effect) => applyFxEffect(state, effect));
  bus.register("surfaces", (effect) => applySurfaceEffect(effect));
  bus.register("engine", (effect) => applyEngineEffect(effect));
  bus.register("input", (effect) => {
    const values = effect.args as readonly Value[]; // Script effects use the VM Value subset.
    applyInputEffect(state, effect.name, values);
  });
  bus.register("sprites", (effect) => {
    const values = effect.args as readonly Value[]; // Script effects use the VM Value subset.
    if (effect.name === "createplayer") {
      const key = assetKey(typeof effect.args[0] === "string" ? effect.args[0] : "");
      const bytes = cache.get(key);
      if (bytes === undefined) return;
      const character = readCharacter(new BinaryReader(bytes, key));
      if (!character.ok) {
        diagnostics.push({ code: "asset.invalid", file: key, line: character.error.offset, message: character.error.message });
        return;
      }
      if (state.sprites.players.length !== 0) return;
      const result = menuOwners.party.apply({ type: "add", actor: actorInputFromCharacter(key, "party", character.value) });
      if (result.error !== null) {
        diagnostics.push({ code: "party.invalid", file: key, line: 0, message: result.error.message });
        return;
      }
      const actor = state.actors.actors.find((candidate) => candidate.kind === "party" && candidate.source === key);
      if (actor === undefined) return;
      createInitialPlayer(state.sprites, null, {
        id: `player:${actor.id}`,
        actorId: actor.id,
        kind: "player",
        source: key,
        x: 64,
        y: 64,
        layer: 1,
        controlled: state.party.selected === actor.id,
        character: character.value,
      });
      const runtime = init.spriteRuntime;
      if (runtime !== undefined && runtime.section !== state.sprites && !runtime.section.players.some((player) => player.actorId === actor.id)) {
        runtime.createPlayer(null, {
          id: `player:${actor.id}`,
          actorId: actor.id,
          kind: "player",
          source: key,
          x: 64,
          y: 64,
          layer: 1,
          controlled: state.party.selected === actor.id,
          character: character.value,
        });
      }
      return;
    }
    if (effect.name === "__party_addplayer_asset" || effect.name === "__party_newplyr_asset") {
      const file = typeof effect.args[0] === "string" ? effect.args[0] : "";
      const hex = typeof effect.args[1] === "string" ? effect.args[1] : "";
      const bytes = new Uint8Array(hex.length / 2);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      const character = readCharacter(new BinaryReader(bytes));
      if (!character.ok) return;
      applySpriteEffect(state, effect.name, [file, character.value] as unknown as readonly Value[]);
      const runtime = init.spriteRuntime;
      const board = state.world.board;
      if (runtime === undefined || runtime.section === state.sprites || board === null || board === undefined) return;
      if (effect.name === "__party_addplayer_asset") {
        const member = state.actors.actors.find((actor) => actor.kind === "party" && actor.source === file);
        const sprite = member === undefined ? undefined : state.sprites.players.find((player) => player.actorId === member.id);
        if (member !== undefined && sprite !== undefined && !runtime.section.players.some((player) => player.actorId === member.id)) {
          runtime.createPlayer(board, {
            id: sprite.id, actorId: member.id, kind: "player", source: file,
            x: sprite.x, y: sprite.y, layer: sprite.layer,
            controlled: state.party.selected === member.id,
            character: character.value,
          });
        }
      } else if (state.party.selected !== null) {
        runtime.changePlayerGraphics(actorId(state.party.selected), file, character.value);
      }
      return;
    }
    applySpriteEffect(state, effect.name, values);
    if (effect.name === "hideitem" || effect.name === "removeitem") expireProgramTileEdits(state);
  });
  bus.register("triggers", (effect) => applyTriggerEffect(state, effect));
  /**
   * Run `command` on a new thread with the plain-data 5.11 request as its one argument. A drawn handoff and a
   * custom request share it: the same blocking rule and the same located diagnostics.
   */
  function startBattleRequest(command: string, request: unknown, what: string): void {
    const serialized = JSON.stringify(request);
    if (serialized === undefined) {
      diagnostics.push({ code: "battle.bad-handoff", file: mainKey ?? "", line: 0, message: `${what} is not plain serializable data` });
      return;
    }
    const kind = blockingAlive() ? "board" : "blocking";
    if (kind === "blocking") resetUiForProgramStart(state.ui);
    const ref: ProgramRef = {
      kind: "inline",
      text: `${command}(${JSON.stringify(encodeInlineScriptString(serialized))})`,
      ir: IR_VERSION,
    };
    try {
      startThread(state.vm, { ref, kind, owner: kind === "blocking" ? "script" : "world" });
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      diagnostics.push({ code: error.code, file: error.pos?.file ?? mainKey ?? "", line: error.pos?.line ?? 0, message: error.message });
    }
  }
  bus.register("battle", (effect) => {
    const payload = effect.args[0];
    if (effect.name === "battle.customFight") {
      // A custom encounter is spelled out (BAT-9 rule 2): the request has no fighters, so the main file's program
      // runs in place of the draw and names its own enemies with `FightEnemy`.
      startBattleRequest("__battle_custom_fight", payload, "custom fight request");
      return;
    }
    if (effect.name === "battle.noEnemies") {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload) || typeof payload.message !== "string") {
        diagnostics.push({ code: "battle.bad-handoff", file: mainKey ?? "", line: 0, message: "random no-enemies event requires a message" });
        return;
      }
      if (!blockingAlive()) {
        resetUiForProgramStart(state.ui);
        startProgram(state.vm, { kind: "inline", text: "wait()", ir: IR_VERSION });
      }
      bus.postEffect("ui", engineEffect("ui", "mwin", [payload.message]));
      return;
    }
    if (effect.name !== "battle.randomEncounter") return;
    startBattleRequest("__battle_start_handoff", payload, "random encounter handoff");
  });
  // The audio callback runs during an originating engine phase; services are
  // initialized below before any phase can post an engine-originated start.
  let services!: ScriptServices;
  // The audio track engine owns `state.audio`: it applies the `audio` effects and asks for a file's bytes only to
  // learn its length (docs/spec/engine/audio-media.md#audio-core-pins), then drops them.
  let audioDecoders: readonly AssetDecoder[] = [];
  const audioInfo = new Map<AssetKey, AudioInfo | null>();
  const decoderLogger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (record) => void diagnostics.push({ code: record.code, file: "", line: 0, message: record.message }),
    error: (record) => void diagnostics.push({ code: record.code, file: "", line: 0, message: record.message }),
  };
  // Scene mode has no game file, so a host may supply the author default directly. Boot mode
  // takes it from the main file's audio-settings block and ignores this start-up value.
  let defaultSoundFont = init.mainFile === undefined ? init.defaultSoundFont ?? null : null;
  let mainFileAudioNeedsApply = init.mainFile !== undefined;
  if (defaultSoundFont !== null && !index.byKey.has(defaultSoundFont)) {
    diagnostics.push({ code: "media.soundfont-missing", file: defaultSoundFont, line: 0, message: `default SoundFont "${defaultSoundFont}" is not in the asset index` });
    defaultSoundFont = null;
  }
  const audio = createAudioRuntime(state, {
    lookup: (key) => {
      const info = audioInfo.get(key);
      return info === undefined ? { kind: "pending" } : info === null ? { kind: "unsupported" } : { kind: "known", lengthTicks: info.lengthTicks };
    },
    need: (key) => request(key, "audio"),
    defaultSoundFont,
    bindVoice: (handle, result) => media.bind(handle, result),
    engineBeforePlay: (detail) => runEngineCancelableEventOutcome(state, services, MEDIA_EMITTER, "beforePlay", detail, STEP_BUDGET),
    transition: (event) => queueAudioEvent(state, event),
    transitionsActive: () => mediaEventsActive(state),
    notify: (note) => {
      if (note.kind !== "diag") return;
      const file = note.detail.file;
      const detail = Object.entries(note.detail).map(([name, value]) => `${name}=${String(value)}`).join(" ");
      diagnostics.push({ code: note.code, file: typeof file === "string" ? file : "", line: 0, message: `${note.op}: ${note.code} ${detail}`.trimEnd() });
    },
  });
  let audioRegistered = false;
  function registerAudio(): void {
    if (audioRegistered) return;
    audioRegistered = true;
    audio.register(bus);
    // Keep the host's explicit section override last, just as in scene mode.
    for (const registration of init.effectAppliers ?? []) {
      if (registration.section === "audio") bus.register("audio", registration.applier);
    }
  }
  // Boot mode registers after the main file supplies the game's audio settings; scene mode has none.
  if (init.mainFile === undefined) registerAudio();
  for (const registration of init.effectAppliers ?? []) {
    if (registration.section !== "audio") bus.register(registration.section, registration.applier);
  }
  let nextRequestId = 1;
  let failed = false;
  let quitRequested = false;
  let breakpoints: readonly Breakpoint[] = [];
  state.surfaces = createSurfacesSection(init.width, init.height);
  state.camera = createCameraSection(init.width, init.height);
  const surfaceCache: SurfacePixelCache = new Map();
  let frameHash: string | null = null;
  /** The failure of the last rebuilt frame, kept so a script that reads it is told even when the frame is current. */
  let frameFailure: { readonly hash: string; readonly message: string } | null = null;
  // Presentation inputs are plain draw-list data; decoded textures remain runner-owned (AD-29).
  const presentation = {
    ...(init.assets === undefined ? {} : { assets: init.assets }),
    ...(init.blits === undefined ? {} : { blits: init.blits }),
    ...(init.sprites === undefined ? {} : { sprites: init.sprites }),
    ...(init.globalAmbient === undefined ? {} : { globalAmbient: init.globalAmbient }),
  };
  // Read before the branch narrows `init`: a JavaScript caller can omit the
  // boot-mode identity even though the type requires it, and that must fail loudly.
  const hostGameIdentity: string | undefined = init.gameIdentity;
  if (init.mainFile === undefined) {
    const resolved = resolveAsset(index, root, "boards", init.initialBoard);
    if (resolved.ok) sceneBoardKey = resolved.value;
    else diagnostics.push({ code: "asset.invalid", file: init.initialBoard, line: 0, message: resolved.error.message });
  } else {
    const found = index.byKey.get(assetKey(init.mainFile));
    if (found === undefined) {
      diagnostics.push({ code: "asset.invalid", file: init.mainFile, line: 0, message: `main file "${init.mainFile}" is not in the asset index` });
      failed = true;
      state.engine.boot = { stage: "stopped", main: "", fonts: [] };
    } else {
      mainKey = found;
      state.engine.boot = { stage: "main", main: found, fonts: [] };
    }
    if (typeof hostGameIdentity !== "string" || hostGameIdentity === "") {
      diagnostics.push({
        code: "startup.no-game-identity",
        file: init.mainFile,
        line: 0,
        message: "boot needs the host's AD-17 game identity; a scene engine has none (docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load)",
      });
      failed = true;
      state.engine.boot = { stage: "stopped", main: "", fonts: [] };
    }
  }
  let activePlugins: readonly ResolvedPlugin[] = init.plugins ?? DEFAULT_ENGINE_PLUGINS;
  /**
   * AD-17's `GameId`, or `null` until it can be derived. Boot mode has the host's
   * `gameIdentity`; scene mode never has one, so every save-area operation there
   * fails explicitly (never a borrowed or path-derived identity).
   */
  let currentGameId: string | null = null;
  /** Recompute the `GameId` once the main file's bytes are known. */
  function refreshGameId(): void {
    const bytes = mainKey === null ? undefined : cache.get(mainKey);
    if (bytes !== undefined && hostGameIdentity !== undefined) currentGameId = deriveGameId(bytes, hostGameIdentity);
  }
  function recoveryAssetManifest(): RecoveryAssetManifest | null {
    const board = state.world.board;
    if (board === null || board === undefined || loader === null) return null;
    const ledger = projectGameLedger(state);
    const boardBytes = cache.get(board.key);
    if (boardBytes === undefined) return null;
    const hydrated = hydrateBoard(board.key, boardBytes, index, root, cache, state.time.tick);
    if (hydrated.error !== null || hydrated.missing !== null || hydrated.value === null) return null;
    const boardDependencies: RecoveryAssetManifest["boardDependencies"] = [];
    const dependencyKeys = new Set<AssetKey>();
    const addBoardDependency = (key: AssetKey): boolean => {
      if (dependencyKeys.has(key)) return true;
      const bytes = cache.get(key);
      if (bytes === undefined) return false;
      dependencyKeys.add(key);
      boardDependencies.push({ key, hash: fnv1a64(bytes) });
      return true;
    };
    for (const key of hydrated.value.dependencies) if (!addBoardDependency(key)) return null;
    const fingerprintTile = (tile: LedgerTile): boolean => {
      const resolved = resolveTileReference(index, root, tile.asset);
      if (!resolved.ok) return false;
      if (resolved.value.kind !== "empty" && !addBoardDependency(resolved.value.asset)) return false;
      if (tile.animation !== null) {
        for (const frame of tile.animation.frames) if (!fingerprintTile(frame)) return false;
      }
      return true;
    };
    const savedBoard = ledger.world.board;
    if (savedBoard.state !== "present") return null;
    const edits = savedBoard.value.runtime.state === "present" ? savedBoard.value.runtime.value.tileEdits : [];
    for (const edit of edits) {
      if (edit.tile !== null && !fingerprintTile(edit.tile)) return null;
    }
    const programs = new Map<string, RecoveryAssetManifest["programs"][number]>();
    const fingerprintAsset = (key: AssetKey): boolean => {
      const existing = programs.get(key);
      if (existing !== undefined) return true;
      const bytes = cache.get(key);
      if (bytes === undefined) return false;
      programs.set(key, { key, hash: fnv1a64(bytes) });
      return true;
    };
    const materializeProgramRef = (ref: LedgerProgramRef): ProgramRef => {
      const common = {
        ir: ref.ir,
        ...(ref.includes.length === 0 ? {} : { includes: [...ref.includes] }),
        ...(ref.redirects.length === 0 ? {} : { redirects: ref.redirects.map(([from, to]) => [from, to] as [string, string]) }),
        ...(ref.dialect === null ? {} : { dialect: ref.dialect }),
        ...(ref.owner === null ? {} : { owner: ref.owner }),
      };
      return ref.kind === "file"
        ? { kind: "file", path: ref.path, sourceHash: ref.sourceHash, ...common }
        : { kind: "inline", text: ref.text, ...common };
    };
    const fingerprintProgramRef = (ref: ProgramRef): boolean => {
      if (ref.kind === "file") {
        const resolved = resolveAsset(index, root, "programs", ref.path);
        if (!resolved.ok || !fingerprintAsset(resolved.value)) return false;
      }
      try {
        const compiled = services.programs.get(ref);
        return Object.values(compiled.fileKeys).every((key) => fingerprintAsset(assetKey(key)));
      } catch {
        return false;
      }
    };
    const fingerprintProgram = (name: string): RecoveryAssetManifest["programs"][number] | null => {
      const resolved = resolveAsset(index, root, "programs", name);
      if (!resolved.ok || !fingerprintAsset(resolved.value)) return null;
      if (loader === null) return null;
      try {
        if (!fingerprintProgramRef(fileProgramRef(loader, name))) return null;
      } catch {
        return null;
      }
      return programs.get(resolved.value) ?? null;
    };
    const entryProgram = board.enterPrg === undefined || board.enterPrg === "" ? null : fingerprintProgram(board.enterPrg);
    if (board.enterPrg !== undefined && board.enterPrg !== "" && entryProgram === null) return null;
    for (const name of board.threads ?? []) if (name !== "" && fingerprintProgram(name) === null) return null;
    for (const item of state.sprites.items) {
      if (item.multitaskProgram !== null && fingerprintProgram(item.multitaskProgram) === null) return null;
    }
    const graph = ledger.script.persistentGraph;
    for (const object of graph.objects) {
      if (object.program !== null && !fingerprintProgramRef(materializeProgramRef(object.program))) return null;
    }
    if (graph.defOwners.state === "present") {
      for (const ref of Object.values(graph.defOwners.value)) {
        if (!fingerprintProgramRef(materializeProgramRef(ref))) return null;
      }
    }
    const listenerAnchors = recoveryListenerAnchors(graph.objects.map((object) => object.handle));
    if (listenerAnchors === null) return null;
    return {
      version: 1,
      board: { key: board.key, hash: fnv1a64(boardBytes) },
      boardDependencies,
      entryProgram,
      programs: [...programs.values()],
      listenerAnchors,
    };
  }
  /**
   * The startup-installed listeners whose target the ledger keeps
   * (docs/spec/engine/interruption-recovery.md#recovery-and-pause). A listener installed after startup is not
   * part of startup state and never anchors its object. `null` refuses capture: a listener whose object identity a
   * later boot could not reproduce must never be persisted against a guessed handle.
   */
  function recoveryListenerAnchors(durableHandles: readonly number[]): RecoveryListenerAnchor[] | null {
    const durable = new Set(durableHandles);
    const anchors: RecoveryListenerAnchor[] = [];
    const seen = new Set<number>();
    const sorted = [...new Set(state.events.listeners.map((listener) => listener.emitter))].sort();
    for (const emitter of sorted) {
      if (!emitter.startsWith("object:")) continue;
      const handle = Number(emitter.slice("object:".length));
      if (!Number.isSafeInteger(handle) || handle < 1) return null;
      if (!startupListenerEmitters.has(emitter) || !durable.has(handle) || seen.has(handle)) continue;
      seen.add(handle);
      const anchor = startupAnchorOf(handle);
      if (anchor === null) return null;
      anchors.push({ handle, ...anchor });
    }
    return anchors;
  }
  function recoveryCaptureEligible(allowOpenTick = false): boolean {
    const selectedPlayer = state.sprites.selectedPlayer;
    return !failed &&
      state.engine.failed !== true &&
      state.engine.boot?.stage === "running" &&
      (allowOpenTick || state.engine.openTick === undefined) &&
      pending.size === 0 &&
      pendingBlobs.size === 0 &&
      pendingImageEffects.length === 0 &&
      pendingBoardPreviews.length === 0 &&
      !state.vm.threads.some((thread) => thread.wait?.kind === "request") &&
      !quitRequested &&
      state.engine.transition === undefined &&
      state.engine.video === undefined &&
      state.battle === null &&
      state.menu.screens.length === 0 &&
      state.world.board != null &&
      selectedPlayer !== null &&
      state.sprites.players.some((player) => player.id === selectedPlayer);
  }
  function serializeRecoveryCandidate(): RecoveryCandidate | null {
    try {
      const recoveryAssets = recoveryAssetManifest();
      if (recoveryAssets === null) return null;
      return { bytes: utf8Encode(snapshotRecoveryCandidate(state, recoveryAssets)), tick: state.time.tick };
    } catch {
      return null;
    }
  }
  function capturePreBattleRecoveryCandidate(): void {
    // Script-issued battle starts run inside an open tick; this is the coherent pre-commit boundary.
    if (!recoveryCaptureEligible(true)) return;
    const candidate = serializeRecoveryCandidate();
    if (candidate !== null) preBattleRecoveryCandidate = candidate;
  }
  function discardRecoveryCandidates(): void {
    recoveryCaptureRequested = false;
    preBattleRecoveryCandidate = null;
  }
  let pluginLayers = createPluginLayers();
  const packageStartupLifecycle = { active: false, packageName: undefined as string | undefined };
  let startupServicesReady = false;
  /** Make batched surface drawing visible in the state tree; a no-op outside a thread phase or when nothing is dirty. */
  function flushSurfaces(): void {
    flushSurfaceBatch(state.surfaces);
  }
  function makeServices(
    plugins: readonly ResolvedPlugin[],
    programLoader?: ProgramLoader,
    runStartups = true,
    layers: PluginLayers = pluginLayers,
  ): ScriptServices {
    const listenersBeforeStartup = [...state.events.listeners];
    audioDecoders = assembleAudioDecoders(plugins.map((plugin) => plugin.definition), decoderLogger);
    const nextServices = createScriptServices(
      state,
      guardExternalPlugins(plugins, FIRST_PARTY_PLUGINS, flushSurfaces),
      undefined,
      undefined,
      programLoader,
      currentGameId,
      (section, effect) => bus.dispatchRecorded(section, effect),
      (request) => {
        if ((request.kind === "loadBlob" || request.kind === "saveBlob") &&
            typeof request.reqId === "number" && Number.isSafeInteger(request.reqId) &&
            request.reqId > 0 && request.reqId < SCRIPT_REQUEST_BASE &&
            typeof request.blob === "object" && request.blob !== null && !Array.isArray(request.blob)) {
          const rawBlob = request.blob as Record<string, unknown>;
          if ((rawBlob.area === "saves" || rawBlob.area === "files") && typeof rawBlob.path === "string" && rawBlob.path !== "") {
            // AD-17: no identity means no save area. Refuse at the seam as well as
            // in the builtins, so a future command cannot publish a shared path.
            if (currentGameId === null) {
              diagnostics.push({
                code: "save.no-game-identity",
                file: mainKey ?? "",
                line: 0,
                message: `${request.kind} refused: this engine has no game identity (docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load)`,
              });
              try {
                replyToRequest(state.vm, request.reqId, { ok: false, value: "this game has no save area" });
              } catch (error) {
                if (error instanceof ScriptError) diagnostics.push(toDiagnostic(error));
              }
              return;
            }
            const reqId = SCRIPT_REQUEST_BASE + request.reqId;
            const gameSave = request.kind === "saveBlob" && request.gameSave === true;
            const gameLoad = request.kind === "loadBlob" && request.gameLoad === true;
            const hex = typeof request.hex === "string" ? request.hex : "";
            const bytes = request.kind === "saveBlob" && !gameSave ? decodeHex(hex) : null;
            const published = request.kind === "loadBlob" || (!gameSave && bytes !== null);
            const blob: BlobKey = { area: rawBlob.area, path: rawBlob.path };
            pendingBlobs.set(reqId, { reqId, vmReqId: request.reqId, kind: request.kind, blob, gameSave, gameLoad, hex, published });
            if (request.kind === "loadBlob") requestsOut.push({ kind: "loadBlob", reqId, blob });
            else if (bytes !== null) requestsOut.push({ kind: "saveBlob", reqId, blob, bytes });
            return;
          }
        }
        const scriptArea = request.kind === "asset" && typeof request.area === "string" && Object.hasOwn(SCRIPT_ASSET_AREAS, request.area) ? SCRIPT_ASSET_AREAS[request.area] : undefined;
        if (request.kind === "asset" && scriptArea !== undefined &&
            typeof request.path === "string" && typeof request.reqId === "number" &&
            Number.isSafeInteger(request.reqId) && request.reqId > 0 && request.reqId < SCRIPT_REQUEST_BASE) {
          const area = request.area as AssetKind;
          const resolved = resolveAsset(index, root, area, request.path);
          const key = resolved.ok ? resolved.value : assetKey(`${scriptArea.folder}/${request.path}`);
          const reqId = SCRIPT_REQUEST_BASE + request.reqId;
          pending.set(reqId, { reqId, key, kind: scriptArea.kind });
          requestsOut.push({ kind: "asset", reqId, key });
          return;
        }
        if (request.kind !== "playVideo" || typeof request.key !== "string" || (request.presentation !== "full" && request.presentation !== "small") || typeof request.reqId !== "number") return;
        state.engine.video = { reqId: request.reqId, key: request.key as AssetKey, presentation: request.presentation, ended: false };
        requestsOut.push({ kind: "playVideo", reqId: request.reqId, key: request.key as AssetKey, presentation: request.presentation });
      },
      layers,
      undefined,
      packageStartupLifecycle,
      media,
      init.scriptObservers,
      menuOwners,
      mainFile?.gameOverPrg ?? null,
      {
        enemies: mainFile?.enemies ?? [],
        stockBattleAvailable: plugins.some((plugin) => plugin.definition.id === "stock_battle"),
      },
      () => expireProgramTileEdits(state),
      () => { recoveryCaptureRequested = true; },
      capturePreBattleRecoveryCandidate,
      () => refreshFrame(true),
    );
    media.activateDeclared();
    if (runStartups) {
      nextServices.setPackageStartup(true);
      try {
        runPackageStartup(
          state,
          nextServices,
          plugins.flatMap((plugin) => plugin.startup === undefined ? [] : [withOwner(plugin.startup, plugin.package?.name ?? plugin.definition.id)]),
          plugins,
          listenersBeforeStartup,
        );
      } catch (error) {
        if (!(error instanceof ScriptError)) throw error;
        fail(toDiagnostic(error));
      } finally {
        nextServices.setPackageStartup(false);
      }
    }
    startupServicesReady = runStartups;
    return nextServices;
  }
  function applyLoadedGame(candidate: GameState, projection: AudioSaveProjection): void {
    const previous = restoreGameState(snapshot(state));
    const previousServices = services;
    const previousLayers = pluginLayers;
    const previousStartupServicesReady = startupServicesReady;
    const previousFailed = failed;
    const previousNextRequestId = nextRequestId;
    const previousFrameHash = frameHash;
    const previousFrameFailure = frameFailure;
    const restoredLayers = createPluginLayers();
    try {
      Object.assign(state, createGameState({ seed: init.seed }));
      makeServices(activePlugins, loader ?? undefined, true, restoredLayers);
      if (failed) throw new ScriptError("restore.shape", "installed package start-up failed during restore");
      Object.assign(state, previous);
      services = previousServices;
      pluginLayers = previousLayers;
      startupServicesReady = previousStartupServicesReady;
      failed = previousFailed;

      Object.assign(state, candidate);
      // A save may carry a bare section; the restored continuation must still render, so the engine completes
      // the surface section it owns, exactly as it does at creation (never inventing game data).
      if (Object.keys(state.surfaces).length === 0) state.surfaces = createSurfacesSection(init.width, init.height);
      // A loaded continuation replaces the object table, so no startup lifetime identity survives.
      clearStartupAnchors();
      if (typeof candidate.engine.nextRequestId === "number" && Number.isSafeInteger(candidate.engine.nextRequestId) && candidate.engine.nextRequestId >= 1) {
        nextRequestId = candidate.engine.nextRequestId;
      }
      pluginLayers = restoredLayers;
      const restoredServices = makeServices(activePlugins, loader ?? undefined, false, restoredLayers);
      runPackageStartup(state, restoredServices, [], activePlugins, restoredServices.listenersBeforePackageStartup);
      compileRestoredPrograms(state.vm, restoredServices);
      verifyRestoredHandles(state.vm, restoredServices, state.events);
      services = restoredServices;
      startupServicesReady = true;
      audio.load(projection);
      clearPathfindingCache();
      surfaceCache.clear();
      frameHash = null;
      frameFailure = null;
      refreshFrame(true);
    } catch (error) {
      Object.assign(state, previous);
      services = previousServices;
      pluginLayers = previousLayers;
      startupServicesReady = previousStartupServicesReady;
      failed = previousFailed;
      frameHash = previousFrameHash;
      frameFailure = previousFrameFailure;
      nextRequestId = previousNextRequestId;
      throw error;
    }
  }
  services = init.mainFile === undefined
    ? makeServices(activePlugins, undefined, true)
    : makeServices([], undefined, false);
  if (init.mainFile === undefined && !failed && init.program !== undefined) {
    const ref: ProgramRef = typeof init.program === "string"
      ? { kind: "inline", text: init.program, ir: IR_VERSION, dialect: "tk3" }
      : init.program;
    resetUiForProgramStart(state.ui);
    startProgram(state.vm, ref);
  }

  function request(key: AssetKey, kind: RequestEntry["kind"]): void {
    for (const item of pending.values()) if (item.key === key) return;
    if (cache.has(key)) return;
    const entry: RequestEntry = { reqId: nextRequestId++, key, kind };
    pending.set(entry.reqId, entry);
    requestsOut.push({ kind: "asset", reqId: entry.reqId, key });
  }
  const IMAGE_EFFECTS: Record<string, true> = {
    bitmap: true,
    setimage: true,
    setimagetransparent: true,
    setimagetranslucent: true,
    setimageadditive: true,
  };
  function imageTexture(key: AssetKey): DecodedTexture | null {
    const cached = decodedImages.get(key);
    if (cached !== undefined) return cached;
    // A tile bitmap is an image like any other for `bitmap` and the `setimage*` family
    // (docs/spec/formats/tiles.md#tile-bitmap-tbm: "can be used wherever an image file is accepted"), but its pixels
    // are tiles from other files, so it is composed from the tile decoders rather than the picture decoders.
    if (key.toLowerCase().endsWith(".tbm")) return tileBitmapTexture(key);
    const bytes = cache.get(key);
    if (bytes === undefined) return null;
    const decoded = decodeTexture(bytes, key);
    if (!decoded.ok) {
      diagnostics.push({ code: "asset.invalid", file: key, line: decoded.error.offset, message: decoded.error.message });
      failed = true;
      return null;
    }
    decodedImages.set(key, decoded.value);
    return decoded.value;
  }
  /**
   * Decode a tile bitmap to one texture (docs/spec/formats/tiles.md#tile-bitmap-tbm), or null while one of its tiles
   * is still being fetched — the caller keeps the effect queued and the picture lands when the reply arrives.
   *
   * The cells name tiles from other files (a tileset, a single tile, an animated tile), so each reference is resolved
   * through the same resolver and decoded through the same readers the boards use
   * (docs/spec/formats/README.md#tile-references). An animated-tile cell takes frame 0: the texture is decoded once
   * and cached, so the picture is the board's frame at tick 0.
   */
  function tileBitmapTexture(key: AssetKey): DecodedTexture | null {
    const bytes = cache.get(key);
    if (bytes === undefined) {
      request(key, "image");
      return null;
    }
    const parsed = readTileBitmap(new BinaryReader(bytes, key));
    if (!parsed.ok) {
      diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
      failed = true;
      return null;
    }
    const tiles = new Map<string, TileBitmapTile>();
    const columns = Math.max(0, parsed.value.width);
    const rows = Math.max(0, parsed.value.height);
    for (let x = 0; x < columns; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const cell = tileBitmapCell(parsed.value, x, y);
        if (cell === undefined || cell.tile === "" || tiles.has(cell.tile)) continue;
        const tile = tileCellPixels(cell.tile);
        if (tile === null) return null;
        if (!tile.ok) {
          diagnostics.push({ code: "asset.invalid", file: key, line: tile.error.offset, message: tile.error.message });
          failed = true;
          return null;
        }
        tiles.set(cell.tile, tile.value);
      }
    }
    const composed = compositeTileBitmap(parsed.value, tiles);
    if (!composed.ok) {
      diagnostics.push({ code: "asset.invalid", file: key, line: composed.error.offset, message: composed.error.message });
      failed = true;
      return null;
    }
    decodedImages.set(key, composed.value);
    return composed.value;
  }
  /**
   * The row-major pixels of one tile reference of a tile bitmap (docs/spec/formats/README.md#tile-references), or null
   * when its file is not in the cache yet (the request is made here).
   *
   * The tile is taken out of the texture `tileTexture` builds for the same file, so a tile bitmap and a board decode a
   * tileset once, through one expander, and share the cache. `tileTexture` lays a tileset out as one strip of tiles
   * `sourceOffset` (core/raster) steps through, which is 32 pixels per tile (16×16 details doubled) or 64 for the
   * diamonds of an `.iso` tileset; tile references are 1-based, so `name.tst8` is the eighth slice.
   */
  function tileCellPixels(reference: string): Result<TileBitmapTile> | null {
    const resolved = resolveTileReference(index, root, reference);
    if (!resolved.ok) return resolved;
    let kind = resolved.value;
    if (kind.kind === "empty") {
      return err({
        offset: 0,
        section: "docs/spec/formats/README.md#tile-references",
        message: `tile bitmap cell reference "${reference}" is empty`,
      });
    }
    if (kind.kind === "animatedTile") {
      const animationBytes = cache.get(kind.asset);
      if (animationBytes === undefined) {
        request(kind.asset, requestKindFor(kind.asset));
        return null;
      }
      const animation = readTileAnimation(new BinaryReader(animationBytes, kind.asset));
      if (!animation.ok) return animation;
      const first = animation.value.frames[0] ?? "";
      if (first === "") {
        return err({
          offset: 0,
          section: "docs/spec/formats/tiles.md#animated-tile-tan",
          message: `animated tile "${kind.path}" has no first frame`,
        });
      }
      const frame = resolveTileReference(index, root, first);
      if (!frame.ok) return frame;
      if (frame.value.kind !== "tileset" && frame.value.kind !== "isometric" && frame.value.kind !== "singleTile") {
        return err({
          offset: 0,
          section: "docs/spec/formats/tiles.md#animated-tile-tan",
          message: `animated tile "${kind.path}" names "${first}", which is not a tile`,
        });
      }
      kind = frame.value;
    }
    if (!cache.has(kind.asset)) {
      request(kind.asset, requestKindFor(kind.asset));
      return null;
    }
    const strip = tileTexture(kind.asset);
    if (strip === null) return null;
    if (kind.kind === "singleTile") return ok({ w: strip.w, h: strip.h, rgba: strip.rgba });
    const tileWidth = kind.kind === "isometric" ? strip.h * 2 : strip.h;
    const left = (kind.tile - 1) * tileWidth;
    if (kind.tile < 1 || left + tileWidth > strip.w) {
      return err({
        offset: 0,
        section: "docs/spec/formats/README.md#tile-references",
        message: `tile "${reference}" is out of range: ${kind.asset} holds ${strip.w / tileWidth} tile(s)`,
      });
    }
    const rgba = new Uint8Array(tileWidth * strip.h * 4);
    for (let y = 0; y < strip.h; y += 1) {
      const from = (y * strip.w + left) * 4;
      rgba.set(strip.rgba.subarray(from, from + tileWidth * 4), y * tileWidth * 4);
    }
    return ok({ w: tileWidth, h: strip.h, rgba });
  }
  function tileTexture(key: AssetKey): DecodedTexture | null {
    const cached = decodedTiles.get(key);
    if (cached !== undefined) return cached;
    const bytes = cache.get(key);
    if (bytes === undefined) return null;
    const lower = key.toLowerCase();
    if (lower.endsWith(".gph")) {
      const parsed = readSingleTile(bytes, key);
      if (!parsed.ok) {
        diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
        failed = true;
        return null;
      }
      const rgba = expandSingleTileToRgba(parsed.value, "row-major");
      if (!rgba.ok) return null;
      const texture = { w: parsed.value.width, h: parsed.value.height, rgba: rgba.value };
      decodedTiles.set(key, texture);
      return texture;
    }
    if (!lower.endsWith(".tst") && !lower.endsWith(".iso")) return null;
    const parsed = readTileset(bytes, key);
    if (!parsed.ok) {
      diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
      failed = true;
      return null;
    }
    const native = tileDimensions(parsed.value.detail);
    const scale = parsed.value.detail.size === 16 ? 2 : 1;
    const width = native.width * scale;
    const height = native.height * scale;
    const rgba = new Uint8Array(width * parsed.value.tiles.length * height * 4);
    for (let tile = 0; tile < parsed.value.tiles.length; tile += 1) {
      const expanded = expandTileToRgba(parsed.value, tile);
      if (!expanded.ok) return null;
      for (let x = 0; x < native.width; x += 1) {
        for (let y = 0; y < native.height; y += 1) {
          const source = (x * native.height + y) * 4;
          for (let dx = 0; dx < scale; dx += 1) {
            for (let dy = 0; dy < scale; dy += 1) {
              const targetX = tile * width + x * scale + dx;
              const targetY = y * scale + dy;
              const target = (targetY * width * parsed.value.tiles.length + targetX) * 4;
              rgba[target] = expanded.value[source] ?? 0;
              rgba[target + 1] = expanded.value[source + 1] ?? 0;
              rgba[target + 2] = expanded.value[source + 2] ?? 0;
              rgba[target + 3] = expanded.value[source + 3] ?? 0;
            }
          }
        }
      }
    }
    const texture = { w: width * parsed.value.tiles.length, h: height, rgba };
    decodedTiles.set(key, texture);
    return texture;
  }
  function imageAsset(file: unknown): AssetKey | null {
    if (typeof file !== "string" || file === "") return null;
    const resolved = resolveAsset(index, root, "bitmaps", file);
    return resolved.ok ? resolved.value : null;
  }
  function imageDiagnostic(file: unknown, message: string): void {
    const located = typeof file === "string" && file !== "" ? file : "<image>";
    diagnostics.push({ code: "asset.missing", file: located, line: 0, message });
    failed = true;
    if (state.engine.boot !== undefined) state.engine.boot.stage = "stopped";
  }
  /** E-56 `text` / `pixelText` with a canvas: draw the glyphs into that canvas with the active font, colour and underline. */
  function applyCanvasText(cells: boolean, args: readonly PlainData[]): void {
    const canvas = args[3] as SurfaceId;
    const value = typeof args[2] === "string" ? args[2] : "";
    const font = state.ui.font;
    const x = typeof args[0] === "number" ? (cells ? (args[0] - 1) * font.size : args[0]) : 0;
    const y = typeof args[1] === "number" ? (cells ? (args[1] - 1) * font.size : args[1]) : 0;
    const layout = layoutText(value, font);
    const width = Math.ceil(layout.width);
    const height = Math.ceil(layout.height);
    if (width <= 0 || height <= 0) return;
    const commands = emitText(value, 0, 0, state.ui.color, font, { underline: state.ui.underline });
    const assets = rasterAssets(canvasTextAssets);
    const fallbackFont = assets.get(defaultFontAsset);
    if (fallbackFont !== undefined && !assets.has(font.asset)) assets.set(font.asset, fallbackFont);
    const rendered = rasterize({ tick: state.time.tick, width, height, commands }, assets);
    if (rendered.error !== null) {
      diagnostics.push({ code: "render.failed", file: "", line: 0, message: `text: ${rendered.error}` });
      return;
    }
    blitTexture(state.surfaces, { w: rendered.width, h: rendered.height, rgba: rendered.rgba }, canvas, x, y);
  }
  function applySurfaceImage(effect: EffectRecord, texture: DecodedTexture): void {
    const args = effect.args;
    let destination = 0 as SurfaceId;
    let x = 0;
    let y = 0;
    let width: number | undefined;
    let height: number | undefined;
    let keyColour: { readonly r: number; readonly g: number; readonly b: number } | undefined;
    let alpha = 255;
    let additive = false;
    if (effect.name === "bitmap") {
      destination = typeof args[1] === "number" ? args[1] as SurfaceId : destination;
      const size = state.surfaces.entries[String(destination)]?.bitmap;
      width = size?.w;
      height = size?.h;
    } else {
      x = typeof args[1] === "number" ? args[1] : 0;
      y = typeof args[2] === "number" ? args[2] : 0;
      width = typeof args[3] === "number" ? args[3] : undefined;
      height = typeof args[4] === "number" ? args[4] : undefined;
      const destinationIndex = effect.name === "setimagetransparent" ? 8 : effect.name === "setimageadditive" ? 6 : 5;
      destination = typeof args[destinationIndex] === "number" ? args[destinationIndex] as SurfaceId : destination;
      if (effect.name === "setimagetransparent") keyColour = {
        r: typeof args[5] === "number" ? args[5] : 0,
        g: typeof args[6] === "number" ? args[6] : 0,
        b: typeof args[7] === "number" ? args[7] : 0,
      };
      if (effect.name === "setimagetranslucent") alpha = 128;
      if (effect.name === "setimageadditive") {
        const percent = typeof args[5] === "number" ? Math.max(0, Math.min(100, Math.trunc(args[5]))) : 0;
        alpha = Math.trunc(percent * 255 / 100);
        additive = true;
      }
    }
    if (width === undefined || height === undefined) {
      imageDiagnostic(args[0], `${effect.name}: image dimensions are invalid`);
      return;
    }
    // An image that names no canvas lands on the script-screen layer, exactly like the drawing commands
    // (docs/spec/engine/runners.md#surface-read-and-state-hash); destination 0 is the derived presented frame.
    if (destination === (0 as SurfaceId)) destination = ensureScriptScreen(state.surfaces);
    if (!blitTexture(state.surfaces, texture, destination, x, y, width, height, keyColour, alpha, additive)) {
      imageDiagnostic(args[0], `${effect.name}: destination surface is not live`);
    }
  }
  function applySurfaceEffect(effect: EffectRecord): void {
    if (!IMAGE_EFFECTS[effect.name]) {
      if (effect.name === "viewbrd") {
        const key = typeof effect.args[0] === "string" ? resolveAsset(index, root, "boards", effect.args[0]) : null;
        if (key === null || !key.ok) {
          imageDiagnostic(effect.args[0], `viewbrd: board "${String(effect.args[0] ?? "")}" is not in the asset index`);
          return;
        }
        pendingBoardPreviews.push({ key: key.value, effect });
        request(key.value, "board-preview");
      }
      return;
    }
    const key = imageAsset(effect.args[0]);
    if (key === null) {
      imageDiagnostic(effect.args[0], `${effect.name}: image is not in the asset index`);
      return;
    }
    const texture = imageTexture(key);
    if (texture === null) {
      pendingImageEffects.push({ key, effect });
      request(key, "image");
      return;
    }
    applySurfaceImage(effect, texture);
  }
  function syncEngineState(): void {
    const next: EngineSection = {
      nextRequestId,
      ...(state.engine.nextBattleId === undefined ? {} : { nextBattleId: state.engine.nextBattleId }),
      pending: Array.from(pending.values(), (entry) => ({ reqId: entry.reqId, key: entry.key, kind: entry.kind })),
      failed,
      claims: state.engine.claims ?? [],
      ...(state.engine.phase === undefined ? {} : { phase: state.engine.phase }),
      ...(state.engine.video === undefined ? {} : { video: state.engine.video }),
    };
    if (state.engine.openTick !== undefined) next.openTick = state.engine.openTick;
    if (state.engine.pendingEffects !== undefined) next.pendingEffects = state.engine.pendingEffects;
    if (state.engine.effectDropped !== undefined) next.effectDropped = state.engine.effectDropped;
    if (state.engine.effectDiagnostics !== undefined) next.effectDiagnostics = state.engine.effectDiagnostics;
    if (state.engine.boot !== undefined) next.boot = state.engine.boot;
    if (state.engine.transition !== undefined) next.transition = state.engine.transition;
    if (state.engine.pendingEnterThread !== undefined) next.pendingEnterThread = state.engine.pendingEnterThread;
    state.engine = next;
  }
  function finalizeBlobRequests(): void {
    for (const entry of pendingBlobs.values()) {
      if (entry.published) continue;
      if (entry.gameSave) {
        // A save may not capture a thread parked on a host request that has no
        // answer yet: restoring it would drop the request and strand the thread.
        // Assets, deferred image effects and every other in-flight blob request
        // are therefore answered (or applied) before the snapshot is taken.
        const otherBlob = [...pendingBlobs.values()].some((other) => other !== entry);
        if (pending.size > 0 || pendingImageEffects.length > 0 || pendingBoardPreviews.length > 0 || otherBlob) continue;
        try {
          const savedState = restoreGameState(snapshot(state));
          replyToRequest(savedState.vm, entry.vmReqId, { ok: true, value: 1 });
          const bytes = utf8Encode(snapshotGameSave(savedState));
          requestsOut.push({ kind: "saveBlob", reqId: entry.reqId, blob: entry.blob, bytes });
          entry.published = true;
        } catch (error) {
          pendingBlobs.delete(entry.reqId);
          const message = error instanceof Error ? error.message : String(error);
          try {
            replyToRequest(state.vm, entry.vmReqId, { ok: false, value: message });
          } catch (replyError) {
            if (replyError instanceof ScriptError) diagnostics.push(toDiagnostic(replyError));
          }
          if (error instanceof ScriptError) diagnostics.push(toDiagnostic(error));
        }
      } else if (entry.kind === "saveBlob") {
        pendingBlobs.delete(entry.reqId);
        try {
          replyToRequest(state.vm, entry.vmReqId, { ok: false, value: "file data is not valid hexadecimal" });
        } catch (error) {
          if (error instanceof ScriptError) diagnostics.push(toDiagnostic(error));
        }
      }
    }
  }
  /** Learn an audio file's length from its reply and drop the bytes; no bytes, or bytes no decoder accepts, is an unknown length. */
  function rememberAudio(key: AssetKey, bytes: Uint8Array | null): void {
    if (bytes === null) {
      diagnostics.push({ code: "asset.missing", file: key, line: 0, message: `asset not found: ${key}` });
      audioInfo.set(key, null);
      return;
    }
    audioInfo.set(key, decodeAudioInfo(audioDecoders, bytes, key, { index, root }));
  }
  function consumeAsset(record: InputRecord, consumed: InputRecord[]): void {
    if (record.event.kind !== "asset") return;
    const prefetchKey = prefetchPending.get(record.event.reqId);
    if (prefetchKey !== undefined) {
      prefetchPending.delete(record.event.reqId);
      consumed.push(record);
      if (record.event.bytes === null) {
        missingBattleBackgrounds.add(prefetchKey);
      } else {
        const parsed = readBattleBackground(new BinaryReader(new Uint8Array(record.event.bytes), prefetchKey));
        if (parsed.ok) {
          prefetchedBattleBackgrounds.set(prefetchKey, {
            music: parsed.value.music,
            menuMoveSound: parsed.value.menuMoveSound,
            menuChooseSound: parsed.value.menuChooseSound,
            readySound: parsed.value.readySound,
            cantDoSound: parsed.value.cantDoSound,
          });
        } else {
          missingBattleBackgrounds.add(prefetchKey);
          diagnostics.push({ code: "asset.invalid", file: prefetchKey, line: parsed.error.offset, message: parsed.error.message });
        }
        if (state.world.board !== undefined && state.world.board !== null) postPrefetch(state.world.board);
      }
      return;
    }
    const entry = pending.get(record.event.reqId);
    if (entry === undefined) return;
    pending.delete(entry.reqId);
    consumed.push(record);
    if (entry.kind === "initial-character") {
      initialCharacterResolved = true;
      if (record.event.bytes === null) {
        diagnostics.push({ code: "asset.missing", file: entry.key, line: 0, message: `asset not found: ${entry.key}` });
      } else {
        cache.set(entry.key, new Uint8Array(record.event.bytes));
      }
      return;
    }
    if (entry.kind === "script-character" || entry.kind === "script-item" || entry.kind === "script-asset") {
      if (record.event.bytes === null) {
        replyToRequest(state.vm, entry.reqId - SCRIPT_REQUEST_BASE, { ok: false, value: "" });
      } else {
        let hex = "";
        for (const byte of record.event.bytes) hex += byte.toString(16).padStart(2, "0");
        cache.set(entry.key, new Uint8Array(record.event.bytes));
        replyToRequest(state.vm, entry.reqId - SCRIPT_REQUEST_BASE, { ok: true, value: hex });
      }
      return;
    }
    if (entry.kind === "audio") {
      rememberAudio(entry.key, record.event.bytes);
      audio.retry();
      return;
    }
    if (record.event.bytes === null) {
      diagnostics.push({ code: "asset.missing", file: entry.key, line: 0, message: `asset not found: ${entry.key}` });
      failed = true;
      pendingImageEffects.splice(0, pendingImageEffects.length, ...pendingImageEffects.filter((item) => item.key !== entry.key));
      pendingBoardPreviews.splice(0, pendingBoardPreviews.length, ...pendingBoardPreviews.filter((item) => item.key !== entry.key));
      if (state.engine.boot !== undefined) state.engine.boot.stage = "stopped";
      return;
    }
    cache.set(entry.key, new Uint8Array(record.event.bytes));
    if (entry.kind === "image") {
      imageTexture(entry.key);
    } else if (entry.kind === "tile") {
      tileTexture(entry.key);
    }
    // An image effect waits for a texture, and a tile bitmap's texture waits for its tiles, so every arriving asset
    // may complete one. A texture that is still not ready keeps its effect queued for the next reply.
    retryPendingImageEffects();
  }
  /** Apply every queued image effect whose texture is now ready, in the order they were queued. */
  function retryPendingImageEffects(): void {
    if (pendingImageEffects.length === 0 || failed) return;
    for (let index = 0; index < pendingImageEffects.length;) {
      const item = pendingImageEffects[index]!;
      const texture = imageTexture(item.key);
      if (texture === null) {
        // A picture that cannot be decoded is reported once and its effect is dropped, as before; one that is only
        // waiting for another asset stays queued.
        if (failed) pendingImageEffects.splice(index, 1);
        else index += 1;
        continue;
      }
      pendingImageEffects.splice(index, 1);
      applySurfaceImage(item.effect, texture);
    }
  }
  function consumeBlob(record: InputRecord, consumed: InputRecord[]): BlobReplyResult {
    const event = record.event;
    if (event.kind !== "blob.loaded" && event.kind !== "blob.saved") return "ignored";
    const entry = pendingBlobs.get(event.reqId);
    if (entry === undefined ||
        (entry.kind === "loadBlob" && event.kind !== "blob.loaded") ||
        (entry.kind === "saveBlob" && event.kind !== "blob.saved")) return "ignored";
    pendingBlobs.delete(entry.reqId);
    consumed.push(record);
    if (entry.gameLoad && event.kind === "blob.loaded") {
      if (event.bytes === null) {
        replyToRequest(state.vm, entry.vmReqId, { ok: false, value: "saved game was not found" });
        return "consumed";
      }
      try {
        const restored = restoreGameSave(utf8Decode(event.bytes), state.audio);
        diagnostics.push(...restored.diagnostics);
        applyLoadedGame(restored.state, restored.audio);
        discardRecoveryCandidates();
        pending.clear();
        pendingBlobs.clear();
        pendingImageEffects.length = 0;
        pendingBoardPreviews.length = 0;
        return "loaded";
      } catch (error) {
        if (error instanceof ScriptError) diagnostics.push(toDiagnostic(error));
        else diagnostics.push({ code: "restore.shape", file: "", line: 0, message: error instanceof Error ? error.message : String(error) });
        replyToRequest(state.vm, entry.vmReqId, { ok: false, value: error instanceof Error ? error.message : String(error) });
        return "consumed";
      }
    }
    if (event.kind === "blob.loaded") {
      replyToRequest(state.vm, entry.vmReqId, {
        ok: event.bytes !== null,
        value: event.bytes === null ? "" : encodeHex(event.bytes),
      });
    } else {
      // Game saves report success as 1 so scripts can observe the result; file writes keep the legacy null value.
      const value = event.ok && entry.gameSave ? 1 : null;
      replyToRequest(state.vm, entry.vmReqId, { ok: event.ok, value });
    }
    return "consumed";
  }
  function bundledAsset(key: AssetKey, bytes: Uint8Array): RasterAsset | null {
    const lower = key.toLowerCase();
    if (lower.endsWith(".ttf")) return bytes;
    if (lower.endsWith(".fnt")) {
      const parsed = readLegacyFont(bytes, key);
      if (parsed.ok) return parsed.value;
      diagnostics.push({ code: "asset.invalid", file: key, line: parsed.error.offset, message: parsed.error.message });
      return null;
    }
    if (lower.endsWith(".png")) {
      const decoded = decodeTexture(bytes, key);
      if (decoded.ok) return decoded.value;
      diagnostics.push({ code: "asset.invalid", file: key, line: decoded.error.offset, message: decoded.error.message });
      return null;
    }
    return null;
  }
  function rasterAssets(assets = new Map<AssetKey, RasterAsset>()): Map<AssetKey, RasterAsset> {
    for (const key of cache.keys()) {
      if (isBitmapKey(key)) imageTexture(key);
      else {
        const lower = key.toLowerCase();
        if (lower.endsWith(".tst") || lower.endsWith(".iso") || lower.endsWith(".gph")) tileTexture(key);
      }
    }
    assets.clear();
    for (const [key, bytes] of init.bundled ?? []) {
      if (!decodedBundled.has(key)) decodedBundled.set(key, bundledAsset(key, bytes));
      const asset = decodedBundled.get(key);
      if (asset !== undefined && asset !== null) assets.set(key, asset);
    }
    for (const [key, bytes] of installedFonts) assets.set(key, bytes);
    for (const [key, texture] of decodedImages) assets.set(key, texture);
    for (const [key, texture] of decodedTiles) assets.set(key, texture);
    return assets;
  }
  function decodedAssets(): ReadonlyMap<AssetKey, DecodedTexture> {
    const assets = new Map<AssetKey, DecodedTexture>();
    for (const [key, texture] of decodedImages) assets.set(key, texture);
    for (const [key, texture] of decodedTiles) assets.set(key, texture);
    return assets;
  }
  function isBitmapKey(key: AssetKey): boolean {
    const lower = key.toLowerCase();
    return (lower.startsWith("bitmap/") || lower.includes("/bitmap/")) && !lower.endsWith(".tbm") && !lower.endsWith(".tan");
  }
  function requestKindFor(key: AssetKey): EngineRequestKind {
    return isBitmapKey(key) ? "image" : "tile";
  }
  function prepareBoardPreviews(): boolean {
    if (pendingBoardPreviews.length === 0) return true;
    const item = pendingBoardPreviews[0];
    if (item === undefined) return true;
    const bytes = cache.get(item.key);
    if (bytes === undefined) {
      request(item.key, "board-preview");
      return false;
    }
    const hydrated = hydrateBoard(item.key, bytes, index, root, cache, state.time.tick);
    if (hydrated.error !== null || hydrated.value === null) {
      fail({ code: "asset.invalid", file: hydrated.error?.path ?? item.key, line: hydrated.error?.offset ?? 0, message: hydrated.error?.message ?? `cannot load preview board "${item.key}"` });
      pendingBoardPreviews.shift();
      return false;
    }
    if (hydrated.missing !== null) {
      request(hydrated.missing, requestKindFor(hydrated.missing));
      return false;
    }
    for (const dependency of hydrated.value.dependencies) {
      if (isBitmapKey(dependency)) {
        if (imageTexture(dependency) === null) {
          pendingBoardPreviews.shift();
          return false;
        }
      } else {
        const lower = dependency.toLowerCase();
        if ((lower.endsWith(".tst") || lower.endsWith(".iso") || lower.endsWith(".gph")) && tileTexture(dependency) === null) {
          pendingBoardPreviews.shift();
          return false;
        }
      }
    }
    const args = item.effect.args;
    const destination = typeof args[3] === "number" ? args[3] as SurfaceId : 0 as SurfaceId;
    const destinationSize = state.surfaces.entries[String(destination)]?.bitmap;
    if (destinationSize === undefined) {
      imageDiagnostic(args[0], `viewbrd: destination surface ${String(destination)} is not live`);
      pendingBoardPreviews.shift();
      return false;
    }
    const list = composeBoard({
      board: hydrated.value.board,
      tick: state.time.tick,
      camera: { x: 0, y: 0 },
      viewport: { width: destinationSize.w, height: destinationSize.h },
      alpha: 0,
      include: { shading: true, images: true, sprites: false },
      assets: decodedAssets(),
    });
    const rendered = rasterize(list, rasterAssets());
    if (rendered.error !== null) {
      fail({ code: "asset.invalid", file: item.key, line: 0, message: `viewbrd: ${rendered.error}` });
      pendingBoardPreviews.shift();
      return false;
    }
    const x = typeof args[1] === "number" ? args[1] : 0;
    const y = typeof args[2] === "number" ? args[2] : 0;
    blitTexture(state.surfaces, { w: rendered.width, h: rendered.height, rgba: rendered.rgba }, destination, x, y);
    pendingBoardPreviews.shift();
    return true;
  }

  /** `send` posts its request here; the engine swaps boards between ticks (E-19). A later send replaces an earlier one. */
  function applyEngineEffect(effect: EffectRecord): void {
    const [, second] = effect.args;
    if (effect.name === "send") {
      const [board, x, y, layer] = effect.args;
      if (typeof board === "string" && typeof x === "number" && typeof y === "number" && typeof layer === "number") state.engine.transition = { board, x, y, layer };
      return;
    }
    if (effect.name === "reset") {
      resetLifecycle();
      return;
    }
    if (effect.name === "mainFile" && typeof second === "string") {
      resetLifecycle(second);
      return;
    }
    if (effect.name === "quit" && !quitRequested) {
      quitRequested = true;
      requestsOut.push({ kind: "quit", reqId: nextRequestId++ });
    }
  }
  function resetLifecycle(nextMain?: string): void {
    discardRecoveryCandidates();
    clearStartupAnchors();
    const rng = state.rng;
    const time = state.time;
    const fresh = createGameState({ seed: 0 });
    state.world = fresh.world;
    state.sprites = fresh.sprites;
    state.actors = fresh.actors;
    state.party = fresh.party;
    state.inventory = fresh.inventory;
    state.triggers = fresh.triggers;
    state.vm = createVmState();
    state.events = fresh.events;
    state.battle = fresh.battle;
    state.menu = fresh.menu;
    state.input = createInputSection(init.input);
    state.ui = fresh.ui;
    state.camera = createCameraSection(init.width, init.height);
    state.fx = fresh.fx;
    state.surfaces = createSurfacesSection(init.width, init.height);
    state.rng = rng;
    state.time = time;
    shopSession.reset();
    pending.clear();
    pendingImageEffects.length = 0;
    pendingBoardPreviews.length = 0;
    queuedInputs.length = 0;
    installedFonts.clear();
    decodedImages.clear();
    decodedTiles.clear();
    failed = false;
    quitRequested = false;
    state.engine = mainKey === null ? { claims: [] } : { claims: [], boot: { stage: "assets", main: mainKey, fonts: [] } };
    for (const registration of [...(init.resetRegistrations ?? [])].sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))) registration.reset(state);
    if (init.spriteRuntime !== undefined) resetSpritesSection(init.spriteRuntime.section);
    if (nextMain !== undefined) {
      const found = index.byKey.get(assetKey(nextMain));
      if (found === undefined) {
        failed = true;
        state.engine.boot = { stage: "stopped", main: "", fonts: [] };
        diagnostics.push({ code: "asset.invalid", file: nextMain, line: 0, message: `main file "${nextMain}" is not in the asset index` });
      } else {
        mainKey = found;
        refreshGameId();
        mainFileAudioNeedsApply = true;
        state.engine.boot = { stage: "main", main: found, fonts: [] };
      }
    }
    // Package layers are session data derived from the installed packages, never
    // carried across a reset (docs/spec/engine/rpgcode-package-loader.md#reset-and-restore):
    // reusing the table would stack a second copy of every RPGCode layer and run a
    // wrapped engine command twice.
    pluginLayers = createPluginLayers();
    if (nextMain !== undefined) {
      startupServicesReady = false;
      services = makeServices([], loader ?? undefined, false);
    } else {
      services = makeServices(activePlugins, loader ?? undefined, true);
    }
    audio.retry();
  }
  function fail(diagnostic: Diagnostic): void {
    diagnostics.push(diagnostic);
    failed = true;
    if (state.engine.boot !== undefined) state.engine.boot.stage = "stopped";
  }
  function blockingAlive(): boolean {
    return hasLiveBlockingThread(state.vm);
  }

  /** Hydrate board `key`, requesting its file and then each missing tile asset in turn. */
  function loadBoard(key: AssetKey, tick = state.time.tick): "pending" | WorldBoard | null {
    const bytes = cache.get(key);
    if (bytes === undefined) {
      request(key, "board");
      return "pending";
    }
    const result = hydrateBoard(key, bytes, index, root, cache, tick);
    if (result.error !== null) {
      fail({ code: "asset.invalid", file: result.error.path, line: result.error.offset, message: result.error.message });
      return null;
    }
    if (result.missing !== null) {
      request(result.missing, requestKindFor(result.missing));
      return "pending";
    }
    const board = result.value?.board ?? null;
    if (board === null) failed = true;
    return board;
  }

  /**
   * Compile `name` from the fetched sources and start it as a thread. A missing,
   * pre-compiled or syntactically wrong program is a located diagnostic and no
   * thread, never a throw out of `advance`.
   */
  function startFileProgram(name: string, owner: string, kind: "board" | "blocking"): Thread | null {
    if (loader === null) return null;
    try {
      const ref = fileProgramRef(loader, name);
      services.programs.get(ref);
      return startThread(state.vm, { ref, kind, owner: kind === "blocking" ? "script" : "world" });
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      diagnostics.push({ code: error.code, file: error.pos?.file ?? owner, line: error.pos?.line ?? 0, message: error.message });
      return null;
    }
  }
  /**
   * Board entry always posts one `music.play` carrying the resolved key, or `null` for an empty or missing name; the
   * audio applier decides same-file carry-on, replacement and silence (docs/spec/engine/audio-media.md#board-effect-mapping,
   * Q5 to Q8). A missing file is silence, not an error (Q6).
   */
  function postBoardMusic(board: WorldBoard): void {
    const name = board.backgroundMusic ?? "";
    const music = name === "" ? null : resolveAsset(index, root, "media", name);
    const asset = music !== null && music.ok ? music.value : null;
    bus.postEffect("audio", engineEffect("audio", "music.play", [asset, true, null, "board"], "draw-audio-cue"));
  }
  /**
   * Send the prefetch plan for `board` ([runners.md#prefetch]): a stream request with no reply that no hash reads. Only a
   * plan that differs from the last one is sent, and every fact is one the engine already holds — no speculative read.
   */
  function postPrefetch(board: WorldBoard): void {
    const boardMusic = board.backgroundMusic === undefined || board.backgroundMusic === ""
      ? null
      : (() => {
        const resolved = resolveAsset(index, root, "media", board.backgroundMusic);
        return resolved.ok ? resolved.value : null;
      })();
    const linkedBoardMusic: (AssetKey | null)[] = [];
    for (const edge of ["north", "south", "east", "west"] as const) {
      const link = board.links?.[edge] ?? "";
      if (link === "" || link.toLowerCase().endsWith(".prg")) continue;
      const target = resolveAsset(index, root, "boards", link);
      if (!target.ok) continue;
      const bytes = cache.get(target.value);
      // A linked board is hinted only when its bytes are already here: the hint never causes a read (AD-5).
      if (bytes === undefined) continue;
      const hydrated = hydrateBoard(target.value, bytes, index, root, cache, state.time.tick);
      const backgroundMusic = hydrated.error === null && hydrated.value?.board !== null && hydrated.value?.board !== undefined
        ? hydrated.value.board.backgroundMusic ?? ""
        : "";
      if (backgroundMusic === "") continue;
      const resolved = resolveAsset(index, root, "media", backgroundMusic);
      linkedBoardMusic.push(resolved.ok ? resolved.value : null);
    }
    let battle: PrefetchFacts["battle"] = null;
    const backgroundKey = board.battleBackground === undefined || board.battleBackground === ""
      ? null
      : (() => {
        const resolved = resolveAsset(index, root, "backgrounds", board.battleBackground ?? "");
        return resolved.ok ? resolved.value : null;
      })();
    if (backgroundKey !== null && !missingBattleBackgrounds.has(backgroundKey)) {
      const cached = prefetchedBattleBackgrounds.get(backgroundKey);
      if (cached !== undefined) {
        battle = cached;
      } else if (![...prefetchPending.values()].includes(backgroundKey)) {
        // The planner needs the background's sound fields; use a prefetch-only request so the saved state hash is unchanged.
        const reqId = nextPrefetchReqId++;
        prefetchPending.set(reqId, backgroundKey);
        requestsOut.push({ kind: "asset", reqId, key: backgroundKey });
      }
    }
    const sound = (name: string | undefined): AssetKey | null => {
      if (name === undefined || name === "") return null;
      const resolved = resolveAsset(index, root, "media", name);
      return resolved.ok ? resolved.value : null;
    };
    const facts: PrefetchFacts = {
      boardMusic,
      boardMusicIsMidi: boardMusic !== null && /\.(mid|midi|kar)$/i.test(boardMusic),
      linkedBoardMusic,
      battle,
      main: {
        cursorMoveSound: sound(mainFile?.cursorMoveSound),
        cursorSelectSound: sound(mainFile?.cursorSelectSound),
        cursorCancelSound: sound(mainFile?.cursorCancelSound),
      },
      defaultBank: defaultSoundFont,
    };
    const plan = planPrefetch(facts);
    const signature = prefetchSignature(plan);
    if (signature === lastPrefetch) return;
    lastPrefetch = signature;
    if (plan.length > 0) requestsOut.push({ kind: "prefetch", reqId: nextHintId++, hints: plan });
  }

  function eventType(event: number): string | null {
    const record = findObject(state.vm, event);
    const value = record === undefined ? null : readMember(record, "type");
    return typeof value === "string" ? value : null;
  }
  function hasUnreturnedBattleEnd(): boolean {
    let unreturned = 0;
    const dispatch = state.events.dispatch;
    if (dispatch?.emitter === "game") {
      const type = eventType(dispatch.event);
      if (type === "battleEnded") unreturned += 1;
      else if (type === "boardReturned" && unreturned > 0) unreturned -= 1;
    }
    for (const queued of state.events.queue) {
      if (queued.emitter !== "game") continue;
      const type = eventType(queued.event);
      if (type === "battleEnded") unreturned += 1;
      else if (type === "boardReturned" && unreturned > 0) unreturned -= 1;
    }
    return unreturned > 0;
  }
  function returnToBoardAfterBattle(): void {
    if (!hasUnreturnedBattleEnd()) return;
    const board = state.world.board;
    if (board === null || board === undefined) return;
    queueNativeEvent(state.vm, state.events, "game", "boardReturned", { boardKey: board.key });
    postBoardMusic(board);
    // Returning to the same board re-hints nothing new, but a plan that differs (a changed bank, a new main) still goes.
    postPrefetch(board);
  }
  /** The player's position when a sprites owner supplies one, else the arrival point converted by the board's own layout (E-11). */
  function cameraAim(board: WorldBoard, arrival: Arrival): CameraPoint {
    const player = (init.cameraTarget ?? init.spriteRuntime)?.getPlayerPosition() ?? null;
    if (player !== null) return player;
    if (arrival.unit === "pixel") return { x: arrival.x, y: arrival.y };
    return tileToPixel(coordLayout(board.coordType), board.sizeX, arrival.x, arrival.y);
  }
  /** Compute R-53's continuous opposite-edge arrival without changing the source board. */
  function edgeArrival(player: SpriteActor, direction: Facing, board: WorldBoard): Arrival | null {
    const points = player.collisionBase.points;
    if (points.length === 0) return null;
    let left = points[0]!.x;
    let top = points[0]!.y;
    let right = left;
    let bottom = top;
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index]!;
      if (point.x < left) left = point.x;
      if (point.x > right) right = point.x;
      if (point.y < top) top = point.y;
      if (point.y > bottom) bottom = point.y;
    }
    const minX = -left;
    const maxX = board.width - right;
    const minY = -top;
    const maxY = board.height - bottom;
    let x: number;
    let y: number;
    if (direction === "E" || direction === "W") {
      x = direction === "E" ? minX : maxX;
      y = Math.max(minY, Math.min(maxY, player.y));
    } else {
      y = direction === "S" ? minY : maxY;
      x = Math.max(minX, Math.min(maxX, player.x));
    }
    if (boardCollisionAt(player, board, x, y) !== null) return null;
    return { x, y, layer: player.layer, unit: "pixel" };
  }

  function clearPendingExit(playerId: string): void {
    state.sprites.players = state.sprites.players.map((actor) => actor.id === playerId
      ? { ...actor, movement: { ...actor.movement, pendingExit: null } }
      : actor);
  }

  function stopOldBoardThreads(): void {
    // Every thread this teardown ends loses the menu frames its open provider or item action added.
    for (const thread of state.vm.threads) {
      const doomed = thread.kind === "board" ||
        (thread.kind === "item" && state.sprites.items.some((item) => (item.handle === null ? item.id : `item:${item.source}`) === thread.source));
      if (doomed) discardMenuFrames(services, thread);
    }
    endBoardThreads(state.vm);
    for (const item of state.sprites.items) {
      const source = item.handle === null ? item.id : `item:${item.source}`;
      endItemThreads(state.vm, source);
    }
    expireProgramTileEdits(state);
  }

  /** Emit the board lifecycle notification on the shared queued bus. */
  function boardLifecycle(type: "entered" | "left", board: WorldBoard, player: SpriteActor | undefined): number {
    const actor = state.actors.actors.find((candidate) => candidate.kind === "party") ?? state.actors.actors[0];
    const detail = {
      actorid: actor?.id ?? null,
      boardkey: board.key,
    };
    const boardEvent = queueNativeEvent(state.vm, state.events, boardEmitterKey(board.key), type, detail);
    if (actor !== undefined) {
      registerActorObject(state.vm, state.events, state.actors, actor.id);
      queueNativeEvent(state.vm, state.events, actorEmitterKey(actor.id), type, detail);
    }
    return boardEvent;
  }

  /** Board entry (E-19, E-47; docs/spec/engine/main-loop-and-startup.md#reawakened-board-entry). */
  function arrive(board: WorldBoard, arrival: Arrival, fromSend: boolean): void {
    const previous = state.world.board;
    const player = state.sprites.players.find((candidate) => candidate.id === state.sprites.selectedPlayer) ?? state.sprites.players[0];
    if (fromSend) stopOldBoardThreads();
    if (previous !== undefined && previous !== null && previous.key !== board.key) {
      const leftEvent = boardLifecycle("left", previous, player);
      deferUnregisterEmitter(state.events, boardEmitterKey(previous.key), leftEvent);
    }
    registerEmitter(state.vm, state.events, boardEmitterKey(board.key));
    clearPathfindingCache();
    state.world = { board };
    resetTriggersSection(state.triggers);
    state.triggers.boardKey = board.key;
    // Keep the boot poll pending through any blocking board-enter program.
    if (!fromSend) state.triggers.lastKeySeq = -1;
    const placement: PlainData[] = [arrival.x, arrival.y, arrival.layer, arrival.unit];
    placeSelectedPlayer(state.sprites, arrival.x, arrival.y, arrival.layer, arrival.unit);
    bus.postEffect("sprites", engineEffect("sprites", "placeplayer", placement));
    state.camera = realignCamera(state.camera, board, cameraAim(board, arrival));
    if (fromSend) bus.postEffect("triggers", engineEffect("triggers", "deactivateat", placement));
    postBoardMusic(board);
    postPrefetch(board);
    boardLifecycle("entered", board, player);
    // An empty list is stored as one empty string and empty entries are ignored (docs/spec/formats/board.md#threads-constants-and-settings).
    for (const name of board.threads ?? []) if (name !== "") startFileProgram(name, board.key, "board");
    if (board.enterPrg !== undefined && board.enterPrg !== "") {
      // docs/spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle
      // A blocking enter program is a new outermost program; reset the message window.
      const blocking = blockingAlive();
      if (!blocking) resetUiForProgramStart(state.ui);
      const enterThread = startFileProgram(board.enterPrg, board.key, blocking ? "board" : "blocking");
      if (blocking && enterThread !== null) state.engine.pendingEnterThread = enterThread.id;
      else delete state.engine.pendingEnterThread;
    } else {
      delete state.engine.pendingEnterThread;
    }
  }

  /** Resolve the selected player's pending edge exit during AD-26's edges phase. */
  function runEdgesPhase(): void {
    const board = state.world.board;
    const player = state.sprites.players.find((actor) => actor.id === state.sprites.selectedPlayer) ?? state.sprites.players[0];
    const direction = player?.movement.pendingExit;
    if (board === null || board === undefined || player === undefined || direction === null || direction === undefined) return;
    const edge = direction === "N" ? "north" : direction === "S" ? "south" : direction === "E" ? "east" : direction === "W" ? "west" : null;
    const link = edge === null ? "" : board.links?.[edge] ?? "";
    if (link === "") {
      clearPendingExit(player.id);
      return;
    }
    if (link.toLowerCase().endsWith(".prg")) {
      clearPendingExit(player.id);
      // docs/spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle
      // An edge link that runs a program starts a new outermost program.
      resetUiForProgramStart(state.ui);
      startFileProgram(link, board.key, "blocking");
      return;
    }
    const target = resolveAsset(index, root, "boards", link);
    if (!target.ok) {
      clearPendingExit(player.id);
      diagnostics.push({ code: "asset.missing", file: link, line: 0, message: `edge link board "${link}" is not in the asset index` });
      return;
    }
    const loaded = loadBoard(target.value);
    if (loaded === "pending") return;
    if (loaded === null) {
      clearPendingExit(player.id);
      return;
    }
    const arrival = edgeArrival(player, direction, loaded);
    if (arrival === null) {
      clearPendingExit(player.id);
      return;
    }
    registerEmitter(state.vm, state.events, boardEmitterKey(loaded.key));
    const actor = state.actors.actors.find((candidate) => candidate.kind === "party") ?? state.actors.actors[0];
    const allowed = runEngineCancelableEvent(
      state,
      services,
      boardEmitterKey(loaded.key),
      "beforeEnter",
      { actorid: actor?.id ?? null, boardkey: loaded.key, entry: { x: arrival.x, y: arrival.y, layer: arrival.layer, unit: arrival.unit } },
      STEP_BUDGET,
    );
    if (!allowed) {
      clearPendingExit(player.id);
      // A canceled entry leaves the target board available for another attempt; preserve
      // its package/script listeners rather than treating it as an unloaded board.
      return;
    }
    clearPendingExit(player.id);
    arrive(loaded, arrival, true);
  }

  /** E-02 step 9's tail: the main file's `initBoard` entered at the board's start position. */
  function bootBoardKey(main: MainFile): AssetKey | null {
    if (main.initBoard === "") {
      fail({ code: "startup.no-board", file: mainKey ?? "", line: 0, message: "the main file names no initBoard" });
      return null;
    }
    const resolved = resolveAsset(index, root, "boards", main.initBoard);
    if (!resolved.ok) {
      fail({ code: "asset.missing", file: mainKey ?? "", line: 0, message: `initBoard "${main.initBoard}" is not in the asset index` });
      return null;
    }
    return resolved.value;
  }
  /**
   * Apply package-owned track metadata after game-file settings and before the
   * audio applier registers (docs/spec/engine/audio-media.md#media-4).
   */
  function applyPackageAudioTracks(plugins: readonly ResolvedPlugin[]): void {
    const report = (packageName: string, index: number, reason: string): void => {
      diagnostics.push({
        code: "media.package-track",
        file: mainKey ?? "",
        line: 0,
        message: `package "${packageName}" audioTracks[${index}] rejected: ${reason} (docs/spec/engine/audio-media.md#media-4)`,
      });
    };
    for (const plugin of plugins) {
      const packageMetadata = plugin.package;
      if (packageMetadata === undefined) continue;
      const declarations: unknown = plugin.definition.audioTracks;
      if (declarations === undefined) continue;
      if (!Array.isArray(declarations)) {
        report(packageMetadata.name, 0, "audioTracks must be an array");
        continue;
      }
      for (let index = 0; index < declarations.length; index += 1) {
        const declaration: unknown = declarations[index];
        if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) {
          report(packageMetadata.name, index, "declaration must be an object");
          continue;
        }
        const record = declaration as { readonly name?: unknown; readonly voiceCount?: unknown };
        const hasVoiceCount = Object.prototype.hasOwnProperty.call(record, "voiceCount");
        const voiceCount = hasVoiceCount ? record.voiceCount : 1;
        if (typeof record.name !== "string" || typeof voiceCount !== "number" || !Number.isInteger(voiceCount) || voiceCount < 1) {
          report(packageMetadata.name, index, "name must be a string and voiceCount must be a positive integer when present");
          continue;
        }
        const problem = audio.configurePackageTrack(record.name, voiceCount);
        if (problem !== null) report(packageMetadata.name, index, problem);
      }
    }
  }

  /**
   * Apply the main file's audio-settings block before the audio applier registers
   * (docs/spec/formats/main-file.md#tkr-audio-settings-extension). An over-cap block keeps the
   * Epic 6 defaults and cap 32, keeps the independent default SoundFont and reports once.
   */
  function applyMainFileAudio(main: MainFile, plugins: readonly ResolvedPlugin[]): void {
    const settings = main.audioSettings;
    if (settings === null) {
      audio.setDefaultSoundFont(null);
      audio.applyGameAudio(DEFAULT_GAME_AUDIO_SETTINGS);
    } else {
      let font: AssetKey | null = null;
      if (settings.defaultSoundFont !== null) {
        const resolved = assetKey(settings.defaultSoundFont);
        if (index.byKey.has(resolved)) {
          font = resolved;
        } else {
          diagnostics.push({
            code: "media.soundfont-missing",
            file: resolved,
            line: 0,
            message: `TKR audio default SoundFont "${settings.defaultSoundFont}" is not in the asset index (docs/spec/formats/main-file.md#tkr-audio-settings-extension)`,
          });
        }
      }
      audio.setDefaultSoundFont(font);
      const applied = audio.applyGameAudio({ tracks: settings.tracks, voiceCap: settings.voiceCap });
      if (!applied.ok) {
        const track = settings.tracks[applied.overflowIndex]!;
        diagnostics.push({
          code: "media.voice-cap",
          file: mainKey ?? "",
          line: applied.overflowIndex,
          message: `TKR audio settings exceed the ${settings.voiceCap}-voice cap at track ${applied.overflowIndex} "${track.name}"; Epic 6 defaults and cap 32 apply (docs/spec/formats/main-file.md#tkr-audio-settings-extension)`,
        });
      }
    }
    applyPackageAudioTracks(plugins);
    registerAudio();
  }

  function startBoot(boot: NonNullable<EngineSection["boot"]>): boolean {
    if (mainKey === null) return false;
    if (boot.stage === "main") {
      const bytes = cache.get(mainKey);
      if (bytes === undefined) {
        request(mainKey, "main");
        return false;
      }
      const parsed = readMainFile(new BinaryReader(bytes, mainKey));
      if (!parsed.ok) {
        fail({ code: "asset.invalid", file: mainKey, line: parsed.error.offset, message: parsed.error.message });
        return false;
      }
      mainFile = parsed.value;
      if (root.kind === "game") root = { kind: "game", projectPath: mainFile.projectPath };
      refreshGameId();
      for (const key of [...privateFontKeys(index, root), ...programKeys(index, root)]) request(key, key.endsWith(".ttf") ? "font" : "program");
      if (mainFile.initChar !== "") {
        const resolved = resolveAsset(index, root, "characters", mainFile.initChar);
        if (!resolved.ok) {
          diagnostics.push({ code: "asset.missing", file: mainKey, line: 0, message: `initChar "${mainFile.initChar}" is not in the asset index` });
        } else {
          initialCharacterKey = resolved.value;
          initialCharacterResolved = cache.has(resolved.value);
          if (!initialCharacterResolved) request(resolved.value, "initial-character");
        }
      }
      boot.stage = "assets";
      return true;
    }
    if (boot.stage === "assets") {
      if (mainFile === null) return false;
      const fonts = privateFontKeys(index, root);
      const programs = programKeys(index, root);
      if (!initialCharacterResolved || ![...fonts, ...programs].every((key) => cache.has(key))) return false;
      for (const key of fonts) {
        const gated = gateTrueType(cache.get(key) ?? new Uint8Array(), key);
        if (!gated.ok) {
          diagnostics.push({ code: "font.rejected", file: key, line: gated.error.offset, message: gated.error.message });
          continue;
        }
        installedFonts.set(key, cache.get(key) ?? new Uint8Array());
        boot.fonts.push(key);
      }
      const manifest = pluginManifestFor(mainFile, mainKey, init.packageCatalogue ?? []);
      const resolvedPlugins = resolveManifestPlugins(manifest.manifest, mainKey, init.packageCatalogue ?? []);
      diagnostics.push(...manifest.diagnostics, ...resolvedPlugins.diagnostics);
      loader = { index, root, read: (key) => cache.get(key) };
      activePlugins = init.plugins ?? resolvedPlugins.plugins;
      if (mainFileAudioNeedsApply) {
        applyMainFileAudio(mainFile, activePlugins);
        mainFileAudioNeedsApply = false;
      } else {
        registerAudio();
      }
      if (!startupServicesReady) services = makeServices(activePlugins, loader, true);
      if (failed) return false;
      if (initialCharacterKey !== null && cache.has(initialCharacterKey)) {
        bus.postEffect("sprites", engineEffect("sprites", "createplayer", [initialCharacterKey]));
      }
      if (mainFile.startupPrg !== "") {
        resetUiForProgramStart(state.ui);
        startFileProgram(mainFile.startupPrg, mainKey, "blocking");
      }
      boot.stage = "startup";
      return true;
    }
    return false;
  }
  function recoveryError(code: string, message: string): Error & { readonly code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  }
  function recoveryFailure(code: string, message: string, file = mainKey ?? ""): false {
    recoveryCandidateBytes = null;
    recoveryLaunch = null;
    preparedRecovery = null;
    fail({ code, file, line: 0, message });
    return false;
  }
  /**
   * Map each saved listener target to the object the fresh startup created for it
   * (docs/spec/engine/interruption-recovery.md#recovery-and-pause). Every anchor must name the object a fresh startup
   * reproduced at the same ordinal and the same class, and that object must carry a startup listener of its own;
   * anything else is refused rather than attached to a look-alike.
   */
  function recoveryListenerHandles(manifest: RecoveryAssetManifest): Map<number, number> {
    const handles = new Map<number, number>();
    if (manifest.listenerAnchors.length === 0) return handles;
    const byOrdinal = new Map<number, number>();
    for (const [handle, ordinal] of startupOrdinals) byOrdinal.set(ordinal, handle);
    const listenedTo = new Set(state.events.listeners
      .map((listener) => listener.emitter)
      .filter((emitter) => emitter.startsWith("object:")));
    for (const anchor of manifest.listenerAnchors) {
      const fresh = byOrdinal.get(anchor.ordinal);
      const live = fresh === undefined ? undefined : state.vm.objects.find((record) => record.handle === fresh);
      const original = fresh === undefined ? undefined : startupObjects.get(fresh);
      if (fresh === undefined || live === undefined || original !== live) {
        throw recoveryError("recovery.listener-anchor", `saved listener target ${anchor.handle} has no matching startup object`);
      }
      if (live.className !== anchor.className || (live.hostType ?? null) !== anchor.hostType) {
        throw recoveryError("recovery.listener-anchor", `saved listener target ${anchor.handle} does not match the startup object at ordinal ${anchor.ordinal}`);
      }
      if (!listenedTo.has(`object:${fresh}`)) {
        throw recoveryError("recovery.listener-anchor", `the startup object for saved listener target ${anchor.handle} has no startup listener`);
      }
      for (const mapped of handles.values()) {
        if (mapped === fresh) throw recoveryError("recovery.listener-anchor", `two saved listener targets resolve to startup object ${fresh}`);
      }
      handles.set(anchor.handle, fresh);
    }
    return handles;
  }
  function initializeRecovery(): boolean {
    if (recoveryCandidateBytes === null) return recoveryFailure("recovery.candidate-missing", "recovery was requested without candidate bytes");
    try {
      const candidate = restoreRecoveryCandidate(utf8Decode(recoveryCandidateBytes), state.audio);
      const ledger = projectGameLedger(candidate.state);
      if (ledger.world.board.state !== "present") throw new Error("the recovery candidate has no saved board");
      const cloneDiagnostics: Diagnostic[] = [];
      const staged = restoreGameState(snapshot(state), cloneDiagnostics);
      if (cloneDiagnostics.length > 0) throw new Error(cloneDiagnostics.map((entry) => entry.message).join("; "));
      applyRecoveryLedger(staged, ledger, recoveryListenerHandles(candidate.recoveryAssets));
      recoveryLaunch = { candidate, ledger, staged, boardKey: assetKey(ledger.world.board.value.key) };
      return true;
    } catch (error) {
      const details = error as { readonly code?: unknown };
      const code = typeof details.code === "string" ? details.code : "recovery.candidate-invalid";
      return recoveryFailure(code, error instanceof Error ? error.message : String(error));
    }
  }
  function verifyRecoveryBoardDependencies(
    dependencies: readonly AssetKey[],
    ledger: GameLedgerV1,
    manifest: RecoveryAssetManifest,
  ): boolean {
    const required = new Set<AssetKey>(dependencies);
    const savedBoard = ledger.world.board;
    if (savedBoard.state !== "present") return recoveryFailure("recovery.board-missing", "the recovery ledger has no board");
    const collectTile = (tile: LedgerTile): boolean => {
      const resolved = resolveTileReference(index, root, tile.asset);
      if (!resolved.ok) return recoveryFailure("recovery.asset-missing", `saved board tile "${tile.asset}" is not in the asset index`);
      if (resolved.value.kind !== "empty") required.add(resolved.value.asset);
      if (tile.animation !== null) {
        for (const frame of tile.animation.frames) if (!collectTile(frame)) return false;
      }
      return true;
    };
    if (savedBoard.value.runtime.state === "present") {
      for (const edit of savedBoard.value.runtime.value.tileEdits) {
        if (edit.tile !== null && !collectTile(edit.tile)) return false;
      }
    }
    const expected = new Map<string, string>();
    for (const fingerprint of manifest.boardDependencies) {
      if (expected.has(fingerprint.key)) return recoveryFailure("recovery.asset-manifest", `duplicate board dependency "${fingerprint.key}"`);
      expected.set(fingerprint.key, fingerprint.hash);
    }
    if (expected.size !== required.size) return recoveryFailure("recovery.asset-manifest", "the recovery candidate's board dependency list is incomplete or stale");
    for (const key of required) {
      const hash = expected.get(key);
      if (hash === undefined) return recoveryFailure("recovery.asset-manifest", `board dependency "${key}" is not fingerprinted`);
      if (!index.byKey.has(key)) return recoveryFailure("recovery.asset-missing", `board dependency "${key}" is not in the asset index`, key);
      const bytes = cache.get(key);
      if (bytes === undefined) {
        request(key, requestKindFor(key));
        return false;
      }
      if (fnv1a64(bytes) !== hash) return recoveryFailure("recovery.asset-changed", `board dependency "${key}" changed since the checkpoint`, key);
    }
    return true;
  }
  function preflightRecoveryPrograms(board: WorldBoard, ledger: GameLedgerV1, manifest: RecoveryAssetManifest): boolean {
    const programFingerprints = new Map<string, string>();
    for (const fingerprint of manifest.programs) {
      if (programFingerprints.has(fingerprint.key)) return recoveryFailure("recovery.asset-manifest", `duplicate program asset "${fingerprint.key}"`);
      const key = assetKey(fingerprint.key);
      if (key !== fingerprint.key) return recoveryFailure("recovery.asset-manifest", `program asset key "${fingerprint.key}" is not canonical`);
      if (!index.byKey.has(key)) return recoveryFailure("recovery.asset-missing", `program asset "${key}" is not in the asset index`, key);
      const bytes = cache.get(key);
      if (bytes === undefined) {
        request(key, "program");
        return false;
      }
      if (fnv1a64(bytes) !== fingerprint.hash) return recoveryFailure("recovery.asset-changed", `program asset "${key}" changed since the checkpoint`, key);
      programFingerprints.set(key, fingerprint.hash);
    }
    const entryName = board.enterPrg ?? "";
    const entryAsset = entryName === "" ? null : resolveAsset(index, root, "programs", entryName);
    if (entryAsset !== null && !entryAsset.ok) return recoveryFailure("recovery.asset-missing", `entry program "${entryName}" is not in the asset index`);
    const expectedEntry = manifest.entryProgram;
    if (entryAsset === null ? expectedEntry !== null : expectedEntry === null || expectedEntry.key !== entryAsset.value) {
      return recoveryFailure("recovery.asset-manifest", "the entry program fingerprint does not match the saved board");
    }
    if (entryAsset !== null && !programFingerprints.has(entryAsset.value)) {
      return recoveryFailure("recovery.asset-manifest", `entry program "${entryAsset.value}" is not fingerprinted`);
    }
    if (entryAsset !== null && expectedEntry?.hash !== programFingerprints.get(entryAsset.value)) {
      return recoveryFailure("recovery.asset-manifest", "the entry program hashes disagree in the recovery manifest");
    }
    const currentLoader = loader;
    if (currentLoader === null) return recoveryFailure("recovery.program-loader", "the program loader is unavailable");
    const resolveProgram = (name: string): ProgramRef | null => {
      const resolved = resolveAsset(index, root, "programs", name);
      if (!resolved.ok) {
        recoveryFailure("recovery.asset-missing", `required program "${name}" is not in the asset index`);
        return null;
      }
      if (!programFingerprints.has(resolved.value)) {
        recoveryFailure("recovery.asset-manifest", `required program "${resolved.value}" is not fingerprinted`);
        return null;
      }
      try {
        const ref = fileProgramRef(currentLoader, name);
        const compiled = services.programs.get(ref);
        for (const key of Object.values(compiled.fileKeys)) {
          if (!programFingerprints.has(key)) {
            recoveryFailure("recovery.asset-manifest", `included program asset "${key}" is not fingerprinted`);
            return null;
          }
        }
        return ref;
      } catch (error) {
        const details = error as { readonly code?: unknown };
        const code = typeof details.code === "string" ? details.code : "recovery.program-invalid";
        recoveryFailure(code, error instanceof Error ? error.message : String(error));
        return null;
      }
    };
    const boardPrograms: ProgramRef[] = [];
    for (const name of board.threads ?? []) {
      if (name === "") continue;
      const ref = resolveProgram(name);
      if (ref === null) return false;
      boardPrograms.push(ref);
    }
    const entryProgram = entryName === "" ? null : resolveProgram(entryName);
    if (entryName !== "" && entryProgram === null) return false;
    const itemPrograms = new Map<string, ProgramRef>();
    for (const sprite of ledger.sprites.items) {
      if (!sprite.visible || sprite.multitaskProgram === null) continue;
      const ref = resolveProgram(sprite.multitaskProgram);
      if (ref === null) return false;
      itemPrograms.set(sprite.id, ref);
    }
    preparedRecovery = { board, boardPrograms, entryProgram, itemPrograms };
    return true;
  }
  function queueRecoveryBoardEntered(staged: GameState, board: WorldBoard): void {
    const actor = staged.actors.actors.find((candidate) => candidate.kind === "party") ?? staged.actors.actors[0];
    const detail = { actorid: actor?.id ?? null, boardkey: board.key };
    registerEmitter(staged.vm, staged.events, boardEmitterKey(board.key));
    queueNativeEvent(staged.vm, staged.events, boardEmitterKey(board.key), "entered", detail);
    if (actor !== undefined) {
      registerActorObject(staged.vm, staged.events, staged.actors, actor.id);
      queueNativeEvent(staged.vm, staged.events, actorEmitterKey(actor.id), "entered", detail);
    }
  }
  function stepRecovery(): boolean {
    if (!recoveryInitialized) {
      recoveryInitialized = true;
      if (!initializeRecovery()) return false;
    }
    const launch = recoveryLaunch;
    if (launch === null) return false;
    const savedBoard = launch.ledger.world.board;
    if (savedBoard.state !== "present") return recoveryFailure("recovery.board-missing", "the recovery ledger has no saved board");
    if (launch.candidate.recoveryAssets.board.key !== savedBoard.value.key || launch.candidate.recoveryAssets.board.key !== launch.boardKey) {
      return recoveryFailure("recovery.asset-manifest", "the board fingerprint does not match the ledger board");
    }
    const resolved = resolveAsset(index, root, "boards", savedBoard.value.key);
    if (!resolved.ok || resolved.value !== launch.boardKey) {
      return recoveryFailure("recovery.asset-missing", `saved board "${savedBoard.value.key}" is not in the asset index`);
    }
    const boardBytes = cache.get(launch.boardKey);
    if (boardBytes === undefined) {
      request(launch.boardKey, "board");
      return false;
    }
    if (fnv1a64(boardBytes) !== launch.candidate.recoveryAssets.board.hash) {
      return recoveryFailure("recovery.asset-changed", `board asset "${launch.boardKey}" changed since the checkpoint`, launch.boardKey);
    }
    const hydrated = hydrateBoard(launch.boardKey, boardBytes, index, root, cache, launch.ledger.time.tick);
    if (hydrated.error !== null) return recoveryFailure("asset.invalid", hydrated.error.message, hydrated.error.path);
    if (hydrated.missing !== null) {
      request(hydrated.missing, requestKindFor(hydrated.missing));
      return false;
    }
    if (hydrated.value === null) return recoveryFailure("asset.invalid", "the saved board could not be hydrated", launch.boardKey);
    if (!verifyRecoveryBoardDependencies(hydrated.value.dependencies, launch.ledger, launch.candidate.recoveryAssets)) return false;
    const authoredBoard = hydrated.value.board;
    if (!preflightRecoveryPrograms(authoredBoard, launch.ledger, launch.candidate.recoveryAssets)) return false;
    try {
      compileRestoredPrograms(launch.staged.vm, services);
      verifyRestoredHandles(launch.staged.vm, services, launch.staged.events);
      const staged = launch.staged;
      endBoardThreads(staged.vm);
      for (const item of staged.sprites.items) {
        endItemThreads(staged.vm, item.handle === null ? item.id : `item:${item.source}`);
      }
      const board = installRecoveryBoard(staged, authoredBoard, launch.ledger);
      const player = staged.sprites.players.find((candidate) => candidate.id === staged.sprites.selectedPlayer);
      if (player !== undefined) staged.camera = realignCamera(staged.camera, board, { x: player.x, y: player.y });
      queueRecoveryBoardEntered(staged, board);
      if (staged.engine.boot === undefined) throw new Error("the recovery launch lost its boot state");
      delete staged.engine.transition;
      delete staged.engine.openTick;
      staged.engine.boot.stage = "recovery-paused";
      const runtime = init.spriteRuntime;
      const spriteInstall = runtime?.prepareRecovery(board, staged.sprites);
      try {
        spriteInstall?.commit();
      } catch (error) {
        spriteInstall?.rollback();
        throw error;
      }
      preparedRecovery = { ...preparedRecovery!, board };
      clearPathfindingCache();
      // Services and event sinks created during startup retain section references.
      // Replace their contents, not the section objects behind those services.
      for (const key of ["world", "sprites", "actors", "party", "inventory", "triggers", "vm", "rng", "time", "engine", "events", "camera"] as const) {
        const target = state[key] as unknown as Record<string, unknown>;
        const source = staged[key] as unknown as Record<string, unknown>;
        for (const field of Object.keys(target)) if (!Object.hasOwn(source, field)) delete target[field];
        Object.assign(target, source);
      }
      recoveryCandidateBytes = null;
      recoveryLaunch = null;
      // The committed object table holds staged copies; handles and ordinals did not change.
      repinStartupAnchors();
      return true;
    } catch (error) {
      const details = error as { readonly code?: unknown };
      const code = typeof details.code === "string" ? details.code : "recovery.install-failed";
      return recoveryFailure(code, error instanceof Error ? error.message : String(error), launch.boardKey);
    }
  }
  function resumeRecovery(): boolean {
    if (recoveryResumed || preparedRecovery === null || state.engine.boot?.stage !== "recovery-paused") return false;
    const prepared = preparedRecovery;
    const stagedVm: VmState = { ...state.vm, threads: [...state.vm.threads] };
    let items = state.sprites.items;
    try {
      items = state.sprites.items.map((item) => {
        if (!item.visible || item.multitaskProgram === null) return item;
        const ref = prepared.itemPrograms.get(item.id);
        if (ref === undefined) throw new Error(`item program "${item.multitaskProgram}" was not prepared`);
        const source = item.handle === null ? item.id : `item:${item.source}`;
        const thread = startThread(stagedVm, { ref, kind: "item", owner: "world", source, target: source });
        return { ...item, multitaskThread: thread.id };
      });
      for (const ref of prepared.boardPrograms) startThread(stagedVm, { ref, kind: "board", owner: "world" });
      if (prepared.entryProgram !== null) {
        const blocking = stagedVm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished");
        if (!blocking) resetUiForProgramStart(state.ui);
        startThread(stagedVm, { ref: prepared.entryProgram, kind: blocking ? "board" : "blocking", owner: blocking ? "world" : "script" });
      }
    } catch (error) {
      const details = error as { readonly code?: unknown };
      const code = typeof details.code === "string" ? details.code : "recovery.resume-failed";
      diagnostics.push({ code, file: prepared.board.key, line: 0, message: error instanceof Error ? error.message : String(error) });
      return false;
    }
    postBoardMusic(prepared.board);
    postPrefetch(prepared.board);
    state.vm.threads = stagedVm.threads;
    state.sprites.items = items;
    if (init.spriteRuntime !== undefined && init.spriteRuntime.section !== state.sprites) init.spriteRuntime.section.items = items;
    state.engine.boot!.stage = "running";
    recoveryResumed = true;
    recoveryLaunch = null;
    preparedRecovery = null;
    return true;
  }
  /**
   * Lifetime identities of the objects startup left alive (docs/spec/engine/interruption-recovery.md#recovery-and-pause).
   * A handle can be reused after its object is freed, so the table keeps the record reference, not the number alone;
   * the ordinal is the object's position in handle order at the end of startup, which a fresh boot reproduces.
   */
  let startupObjects = new Map<number, ObjectRecord>();
  let startupOrdinals = new Map<number, number>();
  /** Emitters that already had a listener when startup finished, the only listeners a fresh boot reproduces. */
  let startupListenerEmitters = new Set<string>();
  function recordStartupAnchors(): void {
    startupObjects = new Map(state.vm.objects.map((record) => [record.handle, record]));
    startupOrdinals = new Map([...startupObjects.keys()].sort((left, right) => left - right).map((handle, ordinal) => [handle, ordinal]));
    startupListenerEmitters = new Set(state.events.listeners.map((listener) => listener.emitter));
  }
  /**
   * Re-point the startup table after a recovery commit replaces the object table with staged copies:
   * handles and ordinals are unchanged by the commit, so the live record at each handle is the same object.
   */
  function repinStartupAnchors(): void {
    for (const handle of startupOrdinals.keys()) {
      const record = state.vm.objects.find((candidate) => candidate.handle === handle);
      if (record === undefined) startupObjects.delete(handle);
      else startupObjects.set(handle, record);
    }
  }
  function clearStartupAnchors(): void {
    startupObjects = new Map();
    startupOrdinals = new Map();
    startupListenerEmitters = new Set();
  }
  /** The saved listener target that provably is the startup object its emitter key names, or `null`. */
  function startupAnchorOf(handle: number): { readonly ordinal: number; readonly className: string; readonly hostType: string | null } | null {
    const live = state.vm.objects.find((record) => record.handle === handle);
    const original = startupObjects.get(handle);
    const ordinal = startupOrdinals.get(handle);
    if (live === undefined || original !== live || ordinal === undefined) return null;
    return { ordinal, className: live.className, hostType: live.hostType ?? null };
  }
  function stepBoot(boot: NonNullable<EngineSection["boot"]>): boolean {
    if (boot.stage === "recovery") return stepRecovery();
    if (boot.stage === "main" || boot.stage === "assets") return startBoot(boot);
    if (boot.stage === "startup") {
      if (blockingAlive()) return false;
      const ports = init.startup;
      if (mainFile === null || ports === undefined) return false;
      if (!ports.presence.hasPlayer()) {
        fail({ code: "startup.no-player", file: mainKey ?? "", line: 0, message: "an initial character must be defined" });
        return false;
      }
      recordStartupAnchors();
      if (recoveryCandidateBytes !== null) {
        delete state.engine.transition;
        boot.stage = "recovery";
        return true;
      }
      if (ports.savedGame.restored()) {
        boot.stage = "running";
        return false;
      }
      boot.stage = "board";
      return true;
    }
    if (boot.stage === "board") {
      if (mainFile === null) return false;
      const key = bootBoardKey(mainFile);
      if (key === null) return false;
      const loaded = loadBoard(key);
      if (loaded === "pending" || loaded === null) return false;
      arrive(loaded, { x: loaded.start?.x ?? 64, y: loaded.start?.y ?? 64, layer: loaded.start?.layer ?? 1, unit: "pixel" }, false);
      boot.stage = "running";
      return true;
    }
    return false;
  }
  function stepTransition(transition: NonNullable<EngineSection["transition"]>): boolean {
    const target = resolveAsset(index, root, "boards", transition.board);
    if (!target.ok) {
      diagnostics.push({ code: "asset.missing", file: transition.board, line: 0, message: `send: board "${transition.board}" is not in the asset index` });
      delete state.engine.transition;
      return true;
    }
    const loaded = loadBoard(target.value);
    if (loaded === "pending" || loaded === null) return false;
    delete state.engine.transition;
    arrive(loaded, { x: transition.x, y: transition.y, layer: transition.layer, unit: "tile" }, true);
    return true;
  }
  function stepScene(): boolean {
    if (sceneBoardKey === null || state.world.board !== undefined && state.world.board !== null) return false;
    const loaded = loadBoard(sceneBoardKey);
    if (loaded === "pending" || loaded === null) return false;
    registerEmitter(state.vm, state.events, boardEmitterKey(loaded.key));
    clearPathfindingCache();
    state.world = { board: loaded };
    state.camera = initCameraForBoard(state.camera, loaded, init.cameraTarget);
    postPrefetch(loaded);
    boardLifecycle("entered", loaded, state.sprites.players[0]);
    return true;
  }
  /**
   * Run every engine-owned step that needs no tick (start-up stages, a pending
   * `send`, the scene board) until one waits for a host reply or a tick.
   */
  function drive(): void {
    requestRestoredAnimationAssets();
    for (let guard = 0; guard < 64; guard += 1) {
      if (failed || pending.size > 0 || pendingBlobs.size > 0 || state.engine.openTick !== undefined) return;
      if (pendingBoardPreviews.length > 0 && !prepareBoardPreviews()) return;
      const boot = state.engine.boot;
      const transition = state.engine.transition;
      let progressed: boolean;
      if (boot === undefined) progressed = transition !== undefined ? stepTransition(transition) : stepScene();
      else if (transition !== undefined && boot.stage !== "main" && boot.stage !== "assets") progressed = stepTransition(transition);
      else progressed = stepBoot(boot);
      if (!progressed) return;
    }
  }
  /** Ticks run once nothing is outstanding: a scene needs its board, boot needs the start-up program or the main loop. */
  function canTick(): boolean {
    if (failed || pending.size > 0 || pendingBlobs.size > 0 || state.engine.transition !== undefined) return false;
    if (state.engine.video !== undefined && !state.engine.video.ended) return false;
    const boot = state.engine.boot;
    if (boot === undefined) return state.world.board !== undefined && state.world.board !== null;
    return boot.stage === "startup" || boot.stage === "running";
  }
  function phaseView(): WaitView {
    return {
      tick: state.time.tick,
      input: inputView(state.input),
      ui: state.ui,
      sprites: [...state.sprites.players, ...state.sprites.items].map((actor) => ({
        id: actor.id,
        stance: actor.visual.stance,
        stanceComplete: actor.visual.stanceComplete,
      })),
      claims: state.engine.claims ?? [],
      audio: state.audio,
      events: state.events,
      shopStock: shopSession.stock(),
      ...(state.engine.pendingEffects?.audio === undefined ? {} : { pendingAudio: state.engine.pendingEffects.audio }),
      mediaStart: (handle: number) => {
        const record = state.vm.objects.find((item) => item.handle === handle);
        return record === undefined ? null : mediaVoiceRef(record);
      },
      ...(state.engine.video === undefined ? {} : { video: { reqId: state.engine.video.reqId, ended: state.engine.video.ended } }),
    };
  }
  function resolveAnimationFile(file: string): AssetKey | null {
    const preferred = file.toLowerCase().endsWith(".gif") ? "bitmaps" : "animations";
    const first = resolveAsset(index, root, preferred, file);
    if (first.ok) return first.value;
    const second = preferred === "bitmaps" ? "animations" : "bitmaps";
    const fallback = resolveAsset(index, root, second, file);
    return fallback.ok ? fallback.value : null;
  }
  function resolveAnimationImage(image: string): { readonly asset: AssetKey; readonly tile: number | null } | null {
    const reference = classifyImageReference(image);
    if (reference.kind === "empty") return null;
    if (reference.kind === "tile") {
      const resolved = resolveAsset(index, root, "tiles", reference.tileset);
      return resolved.ok ? { asset: resolved.value, tile: reference.index } : null;
    }
    if (reference.kind === "singleTile") {
      const resolved = resolveTileReference(index, root, reference.path);
      return resolved.ok && resolved.value.kind === "singleTile" ? { asset: resolved.value.asset, tile: null } : null;
    }
    const resolved = resolveAsset(index, root, "bitmaps", reference.kind === "picture" || reference.kind === "tileBitmap" ? reference.path : image);
    return resolved.ok ? { asset: resolved.value, tile: null } : null;
  }
  /** Ask the host for every picture the frames of a loaded animation draw that is not in the cache yet; true if any was asked for. */
  function requestFrameAssets(animation: AnimationState): boolean {
    let waiting = false;
    for (const frame of animation.frames) {
      if (frame.asset === null || frame.surface !== undefined || cache.has(frame.asset)) continue;
      request(frame.asset, requestKindFor(frame.asset));
      waiting = true;
    }
    return waiting;
  }
  /**
   * A game loaded into an engine that never played its animations holds them already loaded, with no pictures cached.
   * Ask for those pictures, leaving each animation's frame and origin tick as saved; ticks wait for the replies, so the
   * frame clock continues on the same ticks as in the saved run.
   */
  function requestRestoredAnimationAssets(): void {
    for (const animation of (state.fx as Partial<FxSection>).animations ?? []) {
      if (animation.loaded && !animation.finished) requestFrameAssets(animation);
    }
  }
  /** The effects to draw: an animation whose pictures are still being fetched (a game just loaded) is left out until they arrive. */
  function drawableFx(): FxSection {
    const animations = (state.fx as Partial<FxSection>).animations ?? [];
    const ready = animations.filter((animation) => animation.frames.every((frame) => frame.asset === null || frame.surface !== undefined || cache.has(frame.asset)));
    return { ...state.fx, animations: ready };
  }
  function prepareAnimations(): void {
    const animations = (state.fx as Partial<FxSection>).animations ?? [];
    for (const animation of animations) {
      if (animation.loaded || animation.finished) continue;
      const key = animation.asset ?? resolveAnimationFile(animation.file);
      if (key === null) {
        animation.finished = true;
        diagnostics.push({ code: "asset.missing", file: animation.file, line: 0, message: `animation "${animation.file}" is not in the asset index` });
        continue;
      }
      animation.asset = key;
      const bytes = cache.get(key);
      if (bytes === undefined) {
        request(key, "animation");
        continue;
      }
      if (!loadAnimation(state, animation, bytes, resolveAnimationImage)) {
        animation.finished = true;
        diagnostics.push({ code: "asset.invalid", file: key, line: 0, message: `cannot decode animation "${animation.file}"` });
        continue;
      }
      // A frame's picture is a separate asset. The animation starts playing, and its frame clock starts, only once every
      // picture is in the cache, so the first drawn frame is never a missing texture and the frames are on the same
      // ticks on every run.
      const waiting = requestFrameAssets(animation);
      if (waiting) {
        releaseAnimationSurfaces(state, animation);
        animation.loaded = false;
        animation.frames = [];
      }
    }
  }
  function runAnimationPhase(): void {
    advanceFx(state);
    prepareAnimations();
    const sounds = advanceAnimations(state);
    for (const sound of sounds) {
      const resolved = resolveAsset(index, root, "media", sound.sound);
      if (!resolved.ok) {
        diagnostics.push({ code: "asset.missing", file: sound.sound, line: 0, message: `animation sound "${sound.sound}" is not in the asset index` });
        continue;
      }
      bus.postEffect("audio", engineEffect("audio", "sfx.play", [resolved.value, false, null, "frame"], "draw-audio-cue"));
    }
  }
  // Script drawing inside runThreadsPhase is held in working buffers (withSurfaceBatch) and written
  // into the canonical `bitmap.b64` snapshots when the phase ends, including after a thrown command
  // or a breakpoint pause. Only code that can observe the state tree mid-command defeats that:
  //  - effectAppliers and scriptObservers are host callbacks the engine cannot vouch for, so
  //    batching is off whenever either is installed and every edit materialises immediately;
  //  - package, catalogue and main-file plugins, and their listeners and host-object hooks, are handed
  //    `view.state`; guardExternalPlugins flushes the batch before any of that code runs (see
  //    makeServices), so they see exactly what an eager engine would show;
  //  - the engine's own packs read pixels through the surface API, which sees the working buffers, and
  //    never trigger a flush;
  //  - phaseRegistrations run outside the threads phase, and resetRegistrations run after reset has
  //    installed a fresh, unbatched surfaces section.
  const canBatchSurfaces = (init.effectAppliers?.length ?? 0) === 0
    && init.scriptObservers === undefined;
  function withSurfaceBatch<T>(run: () => T): T {
    if (!canBatchSurfaces) return run();
    const surfaces = state.surfaces;
    beginSurfaceBatch(surfaces);
    try {
      return run();
    } finally {
      endSurfaceBatch(surfaces);
    }
  }

  function runPhase(phase: EnginePhase, consumed: InputRecord[]): void {
    state.engine.phase = phase;
    switch (phase) {
      case "input": {
        // Backfill older/manual waits before this tick's input records are appended.
        for (const thread of state.vm.threads) {
          if (thread.wait?.kind === "input.key" && thread.wait.parkSeq === undefined) thread.wait.parkSeq = state.input.nextSeq;
        }
        const records = takeQueuedInputs(state.time.tick);
        for (const record of records) {
          if (record.event.kind === "asset") {
            consumeAsset(record, consumed);
            continue;
          }
          applyInputEvent(state.input, record.event);
          consumed.push(record);
        }
        processGamepadEvents(state.input);
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state);
        return;
      }
      case "waits":
        // `get()` and `clearBuffer()` claims made during threads are pruned before rebuilding waits-phase claims.
        pruneClaimed(state.input, state.engine.claims ?? []);
        state.engine.claims = [];
        const videoBefore = state.engine.video;
        runWaitsPhase(state.vm, phaseView(), defaultWaitPoll, (seq, discardBefore) => {
          const claims = state.engine.claims ??= [];
          // Use this waiter's park floor, not its selected sequence: another input wait can preserve intervening keys.
          if (discardBefore !== undefined) claimInputBefore(state.input, discardBefore, claims);
          if (seq !== undefined && !claims.includes(seq)) claims.push(seq);
        }, undefined, (wait) => {
          if (wait.kind === "input.key" && wait.dialogue !== undefined) {
            queueNativeEvent(state.vm, state.events, "game", "dialogue.completed", wait.dialogue);
          }
        });
        if (videoBefore?.ended === true && state.engine.video?.reqId === videoBefore.reqId) {
          const music = state.audio.tracks.find((track) => track.name === "music");
          const file = music?.file;
          if (music !== undefined && file !== undefined && file !== null) {
            const voice = music.voices.find((item) => item.index === 0);
            bus.postEffect("audio", engineEffect("audio", "music.play", [file, voice?.loop ?? false, true, "video"], "draw-audio-cue"));
          }
          delete state.engine.video;
        }
        pruneClaimed(state.input, state.engine.claims ?? []);
        return;
      case "threads": {
        const liveBlockingBefore = new Set(
          state.vm.threads.filter((thread) => thread.kind === "blocking" && thread.status !== "finished").map((thread) => thread.id),
        );
        withSurfaceBatch(() => runThreadsPhase(state.vm, services, STEP_BUDGET));
        if (state.engine.pendingEnterThread !== undefined) {
          const enterThread = state.vm.threads.find((thread) => thread.id === state.engine.pendingEnterThread);
          if (enterThread === undefined || enterThread.status === "finished") {
            delete state.engine.pendingEnterThread;
          } else if (!blockingAlive()) {
            enterThread.kind = "blocking";
            enterThread.owner = "script";
            delete state.engine.pendingEnterThread;
          }
        }
        for (const thread of state.vm.threads) {
          if (thread.kind === "blocking" && thread.status === "finished" && liveBlockingBefore.has(thread.id)) {
            onBlockingThreadFinished(thread);
          }
        }
        expireProgramTileEdits(state);
        return;
      }
      case "events":
        returnToBoardAfterBattle();
        runEventsPhase(state, services, STEP_BUDGET);
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "time":
        runTimePhase(state.time);
        collectStateGarbage(state, layerRoots(services.layers));
        return;
      case "movement":
        state.camera = updateCamera(state.camera, state.world.board ?? null, init.cameraTarget ?? init.spriteRuntime);
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "edges":
        runEdgesPhase();
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "triggers":
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        if (mainFile !== null) {
          runRandomEncounterPhase(state, {
            fightingDisabled: mainFile.fightingDisabled,
            enemies: mainFile.enemies,
            fightType: mainFile.fightType,
            chances: mainFile.chances,
            useCustomFightPrg: mainFile.useCustomFightPrg,
            customFightPrg: mainFile.customFightPrg,
          }, (section, effect) => bus.postEffect(section, effect));
        }
        return;
      case "animation":
        runAnimationPhase();
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      case "audio":
        audio.phase();
        audio.retry();
        for (const registration of registrationByPhase.get(phase) ?? []) registration.run(state, (section, effect) => bus.postEffect(section, effect));
        return;
      default: {
        const neverPhase: never = phase;
        return neverPhase;
      }
    }
  }
  function takeQueuedInputs(tick: number): InputRecord[] {
    const ready: InputRecord[] = [];
    const deferred: InputRecord[] = [];
    for (const record of queuedInputs) {
      if (record.tick === tick) ready.push(record);
      else deferred.push(record);
    }
    queuedInputs.length = 0;
    queuedInputs.push(...deferred);
    return ready;
  }
  function processPreTickEvents(consumed: InputRecord[]): void {
    const records = takeQueuedInputs(state.time.tick);
    const deferred: InputRecord[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      if (record.event.kind === "asset") {
        consumeAsset(record, consumed);
      } else if (record.event.kind === "blob.loaded" || record.event.kind === "blob.saved") {
        const result = consumeBlob(record, consumed);
        if (result === "ignored") deferred.push(record);
        if (result === "loaded") {
          for (const queued of records.slice(index + 1)) {
            if (queued.event.kind === "asset" || queued.event.kind === "blob.loaded" || queued.event.kind === "blob.saved") continue;
            deferred.push({ ...queued, tick: state.time.tick });
          }
          break;
        }
      } else if (record.event.kind === "video.ended") {
        if (state.engine.video?.reqId === record.event.reqId) state.engine.video = { ...state.engine.video, ended: true };
        consumed.push(record);
      } else if (record.event.kind === "focus") {
        if (record.event.state === "lost" && state.engine.openTick === undefined) {
          // Records queued before the blur happened before it. Apply the keys among them first, so a key pressed in
          // the blur's own frame is released with the rest instead of surviving into the resumed game
          // (display-input-audio.md rule 4; issue #1120).
          for (let at = 0; at < deferred.length;) {
            const earlier = deferred[at]!;
            if (earlier.event.kind !== "key") {
              at += 1;
              continue;
            }
            applyInputEvent(state.input, earlier.event);
            consumed.push(earlier);
            deferred.splice(at, 1);
          }
        }
        applyInputEvent(state.input, record.event);
        consumed.push(record);
      } else {
        deferred.push(record);
      }
    }
    queuedInputs.unshift(...deferred);
  }
  function consumeStoppedInputs(consumed: InputRecord[]): void {
    if (!failed) return;
    const records = takeQueuedInputs(state.time.tick);
    for (const record of records) {
      applyInputEvent(state.input, record.event);
      consumed.push(record);
    }
  }
  /** Hide the message window when an outermost (blocking) program ends, without clearing its text. */
  function onBlockingThreadFinished(thread: Thread): void {
    if (thread.kind !== "blocking") return;
    if (blockingAlive()) return;
    if (state.ui.message === undefined) return;
    state.ui.message = { ...state.ui.message, visible: false };
    state.ui.modal = null;
  }

  function currentDrawList(alpha = 0, include = init.include ?? { shading: false, images: false, sprites: false }): DrawList {
    const spriteInput = [...spriteDraws(state.sprites), ...(presentation.sprites ?? [])];
    const board: WorldBoard | null = state.world.board ?? null;
    const camera = positionAt(state.camera, Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0);
    const debugCommands = (): DrawList["commands"] => {
      const debug = init.debug;
      if (debug === undefined) return [];
      const commands: DrawList["commands"] = [];
      const colour = debug.pathColor ?? { r: 255, g: 255, b: 255 };
      const linePoints = (points: readonly { readonly x: number; readonly y: number }[], rgb: Rgb, closed = false): void => {
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1]!;
          const b = points[i]!;
          commands.push({ kind: "line", x1: Math.round(a.x - camera.x), y1: Math.round(a.y - camera.y), x2: Math.round(b.x - camera.x), y2: Math.round(b.y - camera.y), rgb });
        }
        if (closed && points.length > 2) {
          const a = points[points.length - 1]!;
          const b = points[0]!;
          commands.push({ kind: "line", x1: Math.round(a.x - camera.x), y1: Math.round(a.y - camera.y), x2: Math.round(b.x - camera.x), y2: Math.round(b.y - camera.y), rgb });
        }
      };
      const flags = debug.drawVectorsFlags ?? 0;
      if ((flags & 1) !== 0) for (const vector of board?.vectors ?? []) linePoints(vector.points, colour, vector.closed !== 0);
      if ((flags & 2) !== 0) for (const sprite of spriteInput) if (sprite.collisionBase !== undefined) linePoints(sprite.collisionBase, { r: 255, g: 128, b: 0 }, true);
      if ((flags & 4) !== 0 && debug.path !== undefined) linePoints(debug.path, colour);
      if ((flags & 8) !== 0 && debug.destination !== undefined) {
        const x = Math.round(debug.destination.x - camera.x);
        const y = Math.round(debug.destination.y - camera.y);
        commands.push({ kind: "ellipse", rect: { x: x - 5, y: y - 5, w: 10, h: 10 }, rgb: colour, filled: false });
      }
      if (debug.fps !== undefined) commands.push({ kind: "text", x: 4, y: 4, text: `FPS ${Math.round(debug.fps)}`, font: state.ui.font, rgb: colour, advances: [] });
      return commands;
    };
    const empty = { tick: state.time.tick, width: init.width, height: init.height, commands: [] as DrawList["commands"] };
    const base = board === null
      ? empty
      : composeBoard({
        board,
        tick: state.time.tick,
        camera: positionAt(state.camera, Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0),
        viewport: { width: init.width, height: init.height },
        alpha: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0,
        include,
        assets: decodedAssets(),
        ...presentation,
        sprites: spriteInput,
      });
    const cursorMap = state.ui.activeCursorMap;
    const waitingCursor = cursorMap === undefined
      ? undefined
      : state.vm.threads.find((thread) => thread.status === "waiting" && thread.wait?.kind === "input.key" && thread.wait.cursorMap === cursorMap);
    const cursorSelection = waitingCursor?.wait?.kind === "input.key" ? waitingCursor.wait.cursorSelection : undefined;
    const fx = drawableFx();
    const withFx = applyFxDrawList(base, fx);
    // A script-screen layer is visible only while an outermost program runs (#1045).
    const activeSurface = blockingAlive();
    const scriptLayer = activeSurface ? surfaceBlit(state.surfaces, scriptScreen(state.surfaces)) : null;
    // E-57: the enabled render-now canvas sits above the board, sprites and animations and below UI text and the message window.
    const overlay = renderNowBlit(state.surfaces);
    // Pinned animations (`pinnedanimation`) are engine-owned pictures that sit directly above that canvas.
    const withScript = scriptLayer === null ? withFx : { ...withFx, commands: [...withFx.commands, scriptLayer] };
    const withOverlay = { ...withScript, commands: [...withScript.commands, ...(overlay === null ? [] : [overlay]), ...animationBlits(fx, true)] };
    // docs/spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle
    const uiForCompose = activeSurface
      ? state.ui
      : { ...state.ui, draws: [], message: { ...state.ui.message, visible: false }, modal: null };
    const withUi = { ...withOverlay, commands: [...withOverlay.commands, ...debugCommands(), ...composeUi(uiForCompose, init.width, init.height, state.input, false, cursorSelection)] };
    return { ...withUi, commands: [...withUi.commands, ...composeUiCursor(state.ui, state.input, cursorSelection, waitingCursor !== undefined)] };
  }
  /** A blit of one whole persistent surface, sized from its stored bitmap (E-57's script-screen layer). */
  function surfaceBlit(surfaces: GameState["surfaces"], id: SurfaceId | null): DrawCommand | null {
    if (id === null) return null;
    const current = surfaces.entries[String(id)];
    // A layer nothing has ever drawn on has revision 0; skipping it keeps a game that never draws to the screen
    // identical to one that does not know the layer exists.
    if (current === undefined || current.rev === 0) return null;
    return {
      kind: "blit",
      source: { surface: current.id, rev: current.rev },
      src: { x: 0, y: 0, w: current.bitmap.w, h: current.bitmap.h },
      dst: { x: 0, y: 0, w: current.bitmap.w, h: current.bitmap.h },
      key: null,
      tint: { r: 0, g: 0, b: 0 },
      alpha: 255,
      blend: "normal",
      iso2d: false,
    };
  }
  /**
   * Rebuild the presented screen (surface 0) from the current state. `report` is true only for the deterministic
   * operations a script or a restore asks for; the presentation refresh at the end of `advance` renders the same frame
   * silently, so a simulation that never reads the screen never reports a presentation failure, and a script that
   * reads a frame that cannot be replayed is told (docs/spec/engine/runners.md#surface-read-and-state-hash).
   */
  function refreshFrame(report: boolean): void {
    const list = currentDrawList(0);
    // The rasteriser reads the list's size and commands, never its tick, so a static scene is rebuilt once, not every
    // tick. A rebuild is also forced when an asset has arrived, because a command that named it may now replay.
    const nextHash = `${hashDrawList({ ...list, tick: 0 })}:${cache.size}:${installedFonts.size}`;
    if (nextHash === frameHash) {
      if (report && frameFailure !== null && frameFailure.hash === nextHash) reportRenderFailure(frameFailure.message);
      return;
    }
    const assets = new Map(rasterAssets());
    // A font the game does not ship (a legacy family name such as "Comic Sans MS") draws in the default bitmap font.
    const fallbackFont = assets.get(defaultFontAsset);
    if (fallbackFont !== undefined) for (const command of list.commands) if (command.kind === "text" && !assets.has(command.font.asset)) assets.set(command.font.asset, fallbackFont);
    const rendered = rasterize(list, assets, surfaceTextures(state.surfaces, surfaceCache));
    // A frame that could not be replayed is never left as a silently blank or partial image.
    frameFailure = rendered.error === null ? null : { hash: nextHash, message: rendered.error };
    if (report && frameFailure !== null) reportRenderFailure(frameFailure.message);
    replaceSurface(state.surfaces, 0 as SurfaceId, rendered.width, rendered.height, rendered.rgba);
    frameHash = nextHash;
  }
  function reportRenderFailure(message: string): void {
    diagnostics.push({ code: "render.failed", file: state.world.board?.key ?? "", line: 0, message });
  }
  function threadLocation(thread: Thread): SourceLocation | null {
    const frame = thread.frames[thread.frames.length - 1];
    if (frame === undefined) return null;
    const program = services.programs.get(frame.program);
    return program.ops[frame.ip]?.pos ?? program.ops[frame.ip - 1]?.pos ?? null;
  }
  function breakpointAt(location: SourceLocation | null): boolean {
    if (location === null) return false;
    return breakpoints.some((breakpoint) => breakpoint.file === location.file && breakpoint.line === location.line);
  }
  function pauseAt(thread: Thread, location: SourceLocation | null): Paused | null {
    if (location === null) return null;
    return { thread: thread.id, frame: Math.max(0, thread.frames.length - 1), line: location.line };
  }
  function beginOpenTick(): void {
    const readyThreads = state.vm.threads
      .filter((thread) => thread.status === "ready")
      .sort((left, right) => left.id - right.id)
      .map((thread) => thread.id);
    state.engine.openTick = { readyThreads, readyIndex: 0, currentThread: readyThreads[0] ?? 0, stepsUsed: 0 };
  }
  function nextOpenThread(): void {
    const cursor = state.engine.openTick;
    if (cursor === undefined) return;
    cursor.readyIndex += 1;
    const next = cursor.readyThreads[cursor.readyIndex];
    if (next === undefined) delete state.engine.openTick;
    else cursor.currentThread = next;
  }
  function runOpenThreads(mode: ResumeMode): Paused | null {
    if (state.engine.openTick === undefined) beginOpenTick();
    const cursor = state.engine.openTick;
    if (cursor === undefined) return null;
    while (state.engine.openTick !== undefined) {
      const active = state.vm.threads.find((thread) => thread.id === cursor.currentThread);
      if (active === undefined || active.status !== "ready") {
        nextOpenThread();
        continue;
      }
      const before = threadLocation(active);
      const suppressed = cursor.skip !== undefined && before !== null && cursor.skip.file === before.file && cursor.skip.line === before.line;
      if (!suppressed && breakpointAt(before)) {
        if (before !== null) cursor.skip = { file: before.file, line: before.line };
        return pauseAt(active, before);
      }
      const steps = stepThread(active, state.vm, services, 1);
      cursor.stepsUsed += steps;
      const after = threadLocation(active);
      if (after === null || before === null || after.file !== before.file || after.line !== before.line) delete cursor.skip;
      else if (before !== null) cursor.skip = { file: before.file, line: before.line };
      if (mode === "step" && steps > 0) {
        const paused = pauseAt(active, after ?? before);
        if (active.status !== "ready") nextOpenThread();
        return paused;
      }
      if (active.status !== "ready") nextOpenThread();
    }
    return null;
  }
  function finishOpenTick(consumed: InputRecord[], mode: ResumeMode): Paused | null {
    const paused = withSurfaceBatch(() => runOpenThreads(mode));
    if (paused !== null || state.engine.openTick !== undefined) return paused;
    for (const phase of ENGINE_PHASES) {
      if (phase !== "input" && phase !== "waits" && phase !== "threads") runPhase(phase, consumed);
    }
    return null;
  }

  const engine: Engine = {
    advance(ticks: number, inputs: readonly InputRecord[], maxTicks?: number, resume: ResumeMode = "continue") {
      requestsOut.length = 0;
      const consumed: InputRecord[] = [];
      const failedAtStart = failed;
      for (const input of inputs) queuedInputs.push(input);
      processPreTickEvents(consumed);
      drive();
      if (failedAtStart) consumeStoppedInputs(consumed);
      const requestedTicks = Number.isFinite(ticks) ? Math.max(0, Math.trunc(ticks)) : 0;
      const cap = maxTicks ?? init.maxTicks;
      const bounded = Math.min(requestedTicks, Math.max(0, Math.trunc(cap)));
      let ticksRun = 0;
      let paused: Paused | null = null;
      while (canTick() && state.input.focused && (state.engine.openTick !== undefined || ticksRun < bounded)) {
        if (state.engine.openTick === undefined) {
          runPhase("input", consumed);
          if (!state.input.focused) break;
          runPhase("waits", consumed);
        }
        if (state.engine.openTick === undefined && breakpoints.length === 0 && resume !== "step") {
          runPhase("threads", consumed);
          for (const phase of ENGINE_PHASES) {
            if (phase !== "input" && phase !== "waits" && phase !== "threads") runPhase(phase, consumed);
          }
        } else {
          paused = finishOpenTick(consumed, resume);
          if (paused !== null) break;
        }
        ticksRun += 1;
        resume = "continue";
        drive();
      }
      syncEngineState();
      finalizeBlobRequests();
      refreshFrame(false);
      const reportDiagnostics = [...diagnostics.splice(0), ...drainDiagnostics(services)];
      return {
        ticksRun,
        tickAfter: state.time.tick,
        consumed,
        audioCues: audio.drain(),
        requests: [...requestsOut],
        diagnostics: reportDiagnostics,
        loading: !failed && (pending.size > 0 || pendingBlobs.size > 0),
        paused,
        stateHash: hashGameState(state),
      };
    },
    recoveryCandidate() {
      if (recoveryCaptureRequested) {
        recoveryCaptureRequested = false;
        if (recoveryCaptureEligible()) {
          preBattleRecoveryCandidate = null;
          return serializeRecoveryCandidate();
        }
      }
      const preBattle = preBattleRecoveryCandidate;
      preBattleRecoveryCandidate = null;
      return preBattle;
    },
    recoveryStatus(): RecoveryStatus {
      if (!recoveryLaunchRequested) return "none";
      if (recoveryResumed) return "resumed";
      if (failed || state.engine.failed === true || state.engine.boot?.stage === "stopped") return "failed";
      if (state.engine.boot?.stage === "recovery-paused") return "paused";
      return "loading";
    },
    resumeRecovery,
    drawList(alpha = 0, include: DrawListInclude = { shading: false, images: false, sprites: false }) {
      return currentDrawList(alpha, include);
    },
    surfacePixels(id: SurfaceId, rev: number): SurfacePixels | null {
      return readSurfacePixels(state.surfaces, id, rev, surfaceCache);
    },
    setBreakpoints(next: readonly Breakpoint[]) { breakpoints = next; },
  };
  return engine;
}

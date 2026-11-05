import { canon, reviveNonFinite, tagNonFinite } from "../canon/index.ts";
import { audioSaveProjection, type AudioSaveProjection } from "../audio/save.ts";
import { AUDIO_SCHEMA_VERSION, createAudioSection, createTrack, type AudioStateV2 } from "../audio/model.ts";
import { ScriptError } from "../script/errors.ts";
import { isRecord } from "../script/cells.ts";
import type { Diagnostic } from "../ports/engine.ts";
import { refuseNewerFrameIr, refuseNewerIr, restoreGameState, type RestoreOptions } from "./snapshot.ts";
import { SCHEMA_VERSIONS } from "./state.ts";
import type { GameState } from "./state.ts";

export type RestoredGameSave = {
  readonly state: GameState;
  readonly audio: AudioSaveProjection;
  readonly diagnostics: Diagnostic[];
};

export type RecoveryAssetFingerprint = {
  readonly key: string;
  readonly hash: string;
};

/**
 * A startup-installed listener target the durable ledger also holds: `handle` is the
 * saved object handle and `ordinal` its position among the objects alive when startup
 * finished, the only lifetime identity a fresh boot reproduces for the same object.
 */
export type RecoveryListenerAnchor = {
  readonly handle: number;
  readonly ordinal: number;
  readonly className: string;
  readonly hostType: string | null;
};

/** File identities and startup listener anchors required to rebuild a paused recovery board. */
export type RecoveryAssetManifest = {
  readonly version: 1;
  readonly board: RecoveryAssetFingerprint;
  readonly boardDependencies: RecoveryAssetFingerprint[];
  readonly entryProgram: RecoveryAssetFingerprint | null;
  readonly programs: RecoveryAssetFingerprint[];
  readonly listenerAnchors: RecoveryListenerAnchor[];
};

export type RestoredRecoveryCandidate = RestoredGameSave & {
  readonly recoveryAssets: RecoveryAssetManifest;
};

function parseRecoveryAssetFingerprint(value: unknown, path: string): RecoveryAssetFingerprint {
  const fingerprint = record(value, path);
  exactKeys(fingerprint, ["key", "hash"], path);
  if (typeof fingerprint.key !== "string" || fingerprint.key === "") shape(`${path}.key must be a non-empty asset key`);
  if (typeof fingerprint.hash !== "string" || !/^[0-9a-f]{16}$/.test(fingerprint.hash)) shape(`${path}.hash must be a 16-character FNV-1a hash`);
  return { key: fingerprint.key, hash: fingerprint.hash };
}

function parseRecoveryListenerAnchor(value: unknown, path: string): RecoveryListenerAnchor {
  const anchor = record(value, path);
  exactKeys(anchor, ["handle", "ordinal", "className", "hostType"], path);
  if (typeof anchor.handle !== "number" || !Number.isSafeInteger(anchor.handle) || anchor.handle < 1) shape(`${path}.handle must be a positive object handle`);
  if (typeof anchor.ordinal !== "number" || !Number.isSafeInteger(anchor.ordinal) || anchor.ordinal < 0) shape(`${path}.ordinal must be a non-negative integer`);
  if (typeof anchor.className !== "string") shape(`${path}.className must be a string`);
  if (anchor.hostType !== null && typeof anchor.hostType !== "string") shape(`${path}.hostType must be a string or null`);
  return { handle: anchor.handle, ordinal: anchor.ordinal, className: anchor.className, hostType: anchor.hostType as string | null };
}

function parseRecoveryAssetManifest(value: unknown): RecoveryAssetManifest {
  const manifest = record(value, "recoveryAssets");
  exactKeys(manifest, ["version", "board", "boardDependencies", "entryProgram", "programs", "listenerAnchors"], "recoveryAssets");
  if (manifest.version !== 1) shape("recoveryAssets.version must be 1");
  if (!Array.isArray(manifest.boardDependencies)) shape("recoveryAssets.boardDependencies must be an array");
  if (!Array.isArray(manifest.programs)) shape("recoveryAssets.programs must be an array");
  if (!Array.isArray(manifest.listenerAnchors)) shape("recoveryAssets.listenerAnchors must be an array");
  const listenerAnchors = (manifest.listenerAnchors as unknown[]).map((entry, index) => parseRecoveryListenerAnchor(entry, `recoveryAssets.listenerAnchors[${index}]`));
  const handles = new Set<number>();
  const ordinals = new Set<number>();
  for (const anchor of listenerAnchors) {
    if (handles.has(anchor.handle)) shape(`recoveryAssets.listenerAnchors names object handle ${anchor.handle} twice`);
    if (ordinals.has(anchor.ordinal)) shape(`recoveryAssets.listenerAnchors names startup ordinal ${anchor.ordinal} twice`);
    handles.add(anchor.handle);
    ordinals.add(anchor.ordinal);
  }
  return {
    version: 1,
    board: parseRecoveryAssetFingerprint(manifest.board, "recoveryAssets.board"),
    boardDependencies: manifest.boardDependencies.map((entry, index) => parseRecoveryAssetFingerprint(entry, `recoveryAssets.boardDependencies[${index}]`)),
    entryProgram: manifest.entryProgram === null ? null : parseRecoveryAssetFingerprint(manifest.entryProgram, "recoveryAssets.entryProgram"),
    programs: manifest.programs.map((entry, index) => parseRecoveryAssetFingerprint(entry, `recoveryAssets.programs[${index}]`)),
    listenerAnchors,
  };
}

/** Serialize an engine checkpoint with asset fingerprints for the later recovery launch. */
export function snapshotRecoveryCandidate(state: GameState, recoveryAssets: RecoveryAssetManifest): string {
  const manifest = parseRecoveryAssetManifest(recoveryAssets);
  return canon({ ...gameSaveRoot(state), recoveryAssets: manifest } as never);
}

function restoreGameSaveEnvelope(json: string, currentAudio: AudioStateV2, recovery = false, restoreOptions: RestoreOptions = {}): {
  readonly save: RestoredGameSave;
  readonly recoveryAssets: RecoveryAssetManifest | null;
} {
  let parsed: unknown;
  try {
    parsed = reviveNonFinite(JSON.parse(json));
  } catch {
    throw new ScriptError("restore.shape", "a saved game must be valid UTF-8 JSON");
  }
  const root = record(parsed, "root");
  // A newer save is refused before any payload — including the recovery manifest
  // and the audio projection — is examined (owner ruling 2026-10-30). A legacy
  // save has `compiler` and no `ir`; it is always older and is migrated by
  // `restoreGameState`.
  if (isRecord(root.schema)) {
    const shape = root.schema.schema;
    if (typeof shape === "number" && Number.isInteger(shape) && shape > SCHEMA_VERSIONS.schema) {
      throw new ScriptError("restore.shape", `the saved game schema version ${shape} is newer than ${SCHEMA_VERSIONS.schema}`);
    }
    refuseNewerIr(root.schema.ir);
  }
  refuseNewerFrameIr(root);
  const recoveryAssets = recovery && Object.hasOwn(root, "recoveryAssets") ? parseRecoveryAssetManifest(root.recoveryAssets) : null;
  if (recovery) delete root.recoveryAssets;
  let projection: Record<string, unknown>;
  let tick: number;
  let cueId: number;
  let tracks: unknown[];
  if (root.audio !== undefined && root.audio !== null && typeof root.audio === "object" && Object.hasOwn(root.audio, "tracks")) {
    projection = record(root.audio, "audio projection");
    exactKeys(projection, ["tick", "cueId", "tracks"], "audio projection");
    tick = number(projection.tick, "audio.tick", 0);
    cueId = number(projection.cueId, "audio.cueId", 1);
    if (!Array.isArray(projection.tracks)) shape("audio.tracks must be an array");
    tracks = projection.tracks as unknown[];
  } else {
    const defaultSection = createAudioSection();
    projection = { tick: number(record(root.time, "time").tick, "time.tick", 0), cueId: defaultSection.cueId, tracks: [] };
    tick = projection.tick as number;
    cueId = defaultSection.cueId;
    tracks = [];
  }
  const currentByName = new Map(currentAudio.tracks.map((track) => [asciiFold(track.name), track]));
  const seen = new Set<string>();
  const migratedTracks = tracks.map((value, index) => {
    const track = record(value, `audio.tracks[${index}]`);
    exactKeys(track, ["name", "state", "flags", "file", "voices", "positionTicks", "lengthTicks", "fade"], `audio.tracks[${index}]`);
    if (typeof track.name !== "string" || track.name === "") shape(`audio.tracks[${index}].name must be a non-empty string`);
    const name = asciiFold(track.name);
    if (seen.has(name)) shape(`audio.tracks[${index}].name duplicates an earlier track`);
    seen.add(name);
    if (!Array.isArray(track.voices)) shape(`audio.tracks[${index}].voices must be an array`);
    for (const [voiceIndex, voiceValue] of (track.voices as unknown[]).entries()) {
      const voice = record(voiceValue, `audio.tracks[${index}].voices[${voiceIndex}]`);
      exactKeys(voice, ["index", "state", "file", "cueId", "priority", "volume", "loop", "startTick", "positionTicks", "lengthTicks", "endTick", "pausedTick", "fade"], `audio.tracks[${index}].voices[${voiceIndex}]`);
    }
    const configured = currentByName.get(name);
    return { ...track, voiceCount: configured?.voiceCount ?? 1 };
  });
  const schema = record(root.schema, "schema");
  const audioVersion = number(schema.audio, "schema.audio", 1);
  if (audioVersion > AUDIO_SCHEMA_VERSION) shape(`schema.audio must be no greater than ${AUDIO_SCHEMA_VERSION}`);
  root.audio = {
    schema: AUDIO_SCHEMA_VERSION,
    cueId,
    soundFont: currentAudio.soundFont,
    tracks: migratedTracks,
    settings: currentAudio.settings,
  };
  const diagnostics: Diagnostic[] = [];
  const state = restoreGameState(canon(tagNonFinite(root) as never), diagnostics, { ...restoreOptions, ...(recovery ? { requireCurrentIr: true } : {}) });
  if (state.time.tick !== tick) shape("audio.tick must match time.tick");
  state.audio = resetPlayback(currentAudio);
  return { save: { state, audio: projection as unknown as AudioSaveProjection, diagnostics }, recoveryAssets };
}

/** Validate and migrate an untrusted canonical game save against the live game's audio configuration. */
export function restoreGameSave(json: string, currentAudio: AudioStateV2, options: RestoreOptions = {}): RestoredGameSave {
  return restoreGameSaveEnvelope(json, currentAudio, false, options).save;
}

/** Validate a checkpoint candidate and its recovery-only asset fingerprints. */
export function restoreRecoveryCandidate(json: string, currentAudio: AudioStateV2, options: RestoreOptions = {}): RestoredRecoveryCandidate {
  const restored = restoreGameSaveEnvelope(json, currentAudio, true, options);
  if (restored.recoveryAssets === null) throw new ScriptError("recovery.assets-missing", "the recovery candidate has no asset fingerprint manifest");
  return { ...restored.save, recoveryAssets: restored.recoveryAssets };
}

/** Build the same projection for normal saves and recovery candidates. */
function gameSaveRoot(state: GameState): Record<string, unknown> {
  const root = tagNonFinite(state) as Record<string, unknown>;
  const input = { ...(root.input as Record<string, unknown>) };
  delete input.registeredActions;
  delete input.actionRegistry;
  delete input.actionOrder;
  delete input.controlActions;
  return { ...root, input, audio: audioSaveProjection(state.audio, state.time.tick) };
}

/** Serialize the complete canonical game state while keeping only audio playback in a game save. */
export function snapshotGameSave(state: GameState): string {
  return canon(gameSaveRoot(state) as never);
}

function shape(path: string): never {
  throw new ScriptError("restore.shape", `the saved game ${path} is invalid`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) return shape(`${path} must be an object`);
  return value;
}

function number(value: unknown, path: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return shape(`${path} must be a safe integer no less than ${min}`);
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    shape(`${path} must contain only ${sortedExpected.join(", ")}`);
  }
}

function asciiFold(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}

function resetPlayback(current: AudioStateV2): AudioStateV2 {
  return {
    schema: current.schema,
    cueId: current.cueId,
    soundFont: current.soundFont,
    tracks: current.tracks.map((track) => createTrack(track.name, track.voiceCount)),
    settings: { masterVolume: current.settings.masterVolume, trackVolumes: current.settings.trackVolumes.map((volume) => ({ ...volume, fade: volume.fade === null ? null : { ...volume.fade } })) },
  };
}



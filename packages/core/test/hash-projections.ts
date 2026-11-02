// Independent re-statements of the state-hash projection, for tests only. They use the plain canonicalizer
// (`hashState`), never `hashGameState`'s surface-fragment cache, so a test can compare the optimized hash with
// the straightforward one (docs/spec/formats/save-game.md#state-hash-request-projection).
import { withoutSettings } from "../src/audio/model.ts";
import { hashState } from "../src/canon/canon.ts";
import type { GameState } from "../src/save/state.ts";

/**
 * The current projection: the whole state without `vm.stepCounters`, `audio.settings` and `engine.nextRequestId`.
 * The pending-request list stays in it, ids included.
 */
export function projectedState(state: GameState) {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  return { ...state, vm, engine, audio: withoutSettings(state.audio) };
}

/** `hashGameState` must equal this for every state. */
export function referenceHashProjection(state: GameState): string {
  return hashState(projectedState(state));
}

/** Only valid after checking the no-active-voice and load-cue preconditions in the calling test. */
export function noActiveAudioContinuationProjection(state: GameState) {
  const projected = projectedState(state);
  const { cueId: _cueId, ...audio } = projected.audio;
  return { ...projected, audio };
}

/**
 * The projection before the 2026-11-01 owner ruling (#1047): identical except that the saved request-id counter was
 * hashed. Only the counter regressions use it, to show that the old projection moved with bookkeeping the new one
 * ignores.
 */
export function hashWithRequestCounter(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  return hashState({ ...state, vm, audio: withoutSettings(state.audio) });
}

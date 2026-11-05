// Independent re-statements of the state-hash projection, for tests only. They use the plain canonicalizer
// (`hashState`), never `hashGameState`'s surface-fragment cache, so a test can compare the optimized hash with
// the straightforward one (docs/spec/formats/save-game.md#state-hash-request-projection).
import { withoutSettings } from "../src/audio/model.ts";
import { hashState } from "../src/canon/canon.ts";
import type { GameState } from "../src/save/state.ts";

/**
 * The current projection: the whole state without `vm.stepCounters`, `audio.settings`, `engine.nextRequestId`, and the
 * two screen surfaces — the derived presented frame (0) and the script-screen layer (-1) it is composited from
 * (docs/spec/engine/runners.md#surface-read-and-state-hash). The pending-request list stays in it, ids
 * included.
 */
export function projectedState(state: GameState) {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  const section = state.surfaces as Partial<GameState["surfaces"]>;
  let surfacesProjection: unknown = section;
  if (section.entries !== undefined) {
    // The presented frame (0) and the script-screen layer (-1) are the screen, not application store.
    const entries = Object.fromEntries(Object.entries(section.entries).filter(([id]) => id !== "0" && id !== "-1"));
    surfacesProjection = { ...section, entries };
  }
  return { ...state, vm, engine, audio: withoutSettings(state.audio), surfaces: surfacesProjection as GameState["surfaces"] };
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
 * The projection immediately before #1047: it hashed the saved request counter and all surfaces, while excluding
 * VM step counters and audio settings. Later screen-surface exclusions mean it is not the current projection with
 * only the counter restored. Keep it independent of `projectedState`; fixed vectors protect this historical oracle.
 */
export function hashWithRequestCounter(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  return hashState({ ...state, vm, audio: withoutSettings(state.audio) });
}

/**
 * The engine runner boundary: one API every runner drives (AD-1, AD-24).
 *
 * `createEngine(init)` returns an `Engine` (deferred to the engine epic).
 * `advance` runs whole fixed ticks and reports what happened; `drawList` is a
 * pure function of current state; `surfacePixels` and `picturePixels` are the
 * pixel accessors (AD-27, AD-28); `setBreakpoints` takes data and a hit stops
 * mid-tick.
 */

import type { AccessibilityNode } from "./accessibility.ts";
import type { AudioCue } from "./audio.ts";
import type { Bytes } from "./bytes.ts";
import type { DrawList } from "./draw.ts";
import type { HostDisplayGeometry, NormalizedHostFeatures } from "./host.ts";
import type { InputRecord } from "./input.ts";
import type { RegisteredAction } from "../save/sections/input.ts";
import type { AssetKey, SurfaceId } from "./keys.ts";
import type { RunnerRequest } from "./requests.ts";

/**
 * A located runtime diagnostic (AD-24). A script error is visible to RPGCode
 * handlers and also appears here.
 */
export type Diagnostic = {
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
};

/** Where a breakpoint stopped: thread, frame and source line (AD-1). */
export type PausedState = {
  readonly thread: number;
  readonly frame: number;
  readonly line: number;
};

/** A source breakpoint, set as data through `setBreakpoints` (AD-1). */
export type Breakpoint = {
  readonly file: string;
  readonly line: number;
};

/** How an `advance` call resumes an open breakpoint tick. */
export type ResumeMode = "continue" | "step";
/** Host-visible lifecycle of a recovery launch supplied to BootInit. */
export type RecoveryStatus = "none" | "loading" | "paused" | "resumed" | "failed";

/**
 * A persistent surface's pixels. Outputs never alias state: `rgba` owns its
 * whole buffer (`byteOffset` 0) and is a copy (AD-1, AD-27, AD-28).
 */
export type SurfacePixels = {
  readonly w: number;
  readonly h: number;
  readonly rgba: Bytes;
};

/**
 * The result of one `advance` batch (AD-1, AD-14). `consumed` is the canonical
 * input log written by the core; `audioCues` are the cues emitted during the
 * batch, in emission order, so the concatenation over batches does not depend
 * on how ticks were batched; `loading` is set while a blocking request
 * freezes time; `paused` is set when a breakpoint hit mid-tick; `stateHash` is
 * the state hash without the script volume settings (`hashGameState`).
 */
export type TickReport = {
  readonly ticksRun: number;
  readonly tickAfter: number;
  readonly consumed: readonly InputRecord[];
  readonly audioCues: readonly AudioCue[];
  readonly requests: readonly RunnerRequest[];
  readonly diagnostics: readonly Diagnostic[];
  readonly loading: boolean;
  readonly paused: PausedState | null;
  readonly stateHash: string;
};

/**
 * The engine a runner drives (AD-1). Every argument and result is
 * structured-cloneable plain data, so the core runs in a Worker.
 */
/** Optional compositor inputs used by headless golden scenes and editor previews. */
export type DrawListInclude = {
  readonly shading: boolean;
  readonly images: boolean;
  readonly sprites: boolean;
};
export interface Engine {
  /**
   * Run whole fixed ticks, consuming `inputs` in array order. When an open
   * breakpoint tick exists, it is completed first. `maxTicks` caps catch-up;
   * `resume` may request exactly one VM instruction and another pause.
   */
  advance(ticks: number, inputs: readonly InputRecord[], maxTicks?: number, resume?: ResumeMode): TickReport;

  /** A pure function of current state; `alpha` is 0 in tests (AD-1). */
  drawList(alpha?: number, include?: DrawListInclude): DrawList;
  /** Current engine and registered game action names in deterministic order. */
  registeredActionNames(): readonly string[];
  /** Register a game.* action during deterministic startup/runtime initialization. */
  registerGameAction(action: RegisteredAction): boolean;
  /** Claim or release the current pointer gesture from held-goal movement. */
  setPointerMovementSuppressed(suppressed: boolean): void;
  /** Report an action reference that has no runtime registration, at most once per boot. */
  reportUnknownAction(action: string): void;

  /** Whether the game explicitly declared usable custom touch controls. */
  customTouchControlsDeclared(): boolean;
  /** Current normalized host capabilities, including logged changes. */
  hostFeatures(): NormalizedHostFeatures;

  /** Last consumed, normalized host geometry used for display planes and pointer mapping. */
  hostDisplayGeometry(): HostDisplayGeometry;
  /** Monotonic, non-state token bumped whenever reset/restore replaces cached surfaces. */
  surfaceCacheEpoch(): number;
  /** Plain-data tree for currently published UI surfaces; hosts request it only when needed. */
  accessibilityTree(): readonly AccessibilityNode[];
  /** Highest-priority core claim at a runner fallback control point, or null when no core target claims it. */
  runnerControlPointerPreemption(x: number, y: number): number | "author" | null;
  /**
   * The pixels of surface `id` at revision `rev`, or `null` when the surface
   * is unknown or `rev` is no longer available (AD-27). A presentation-only
   * author-margin snapshot is available after the draw list that names it has
   * been built. It does not enter saved state; a later, different snapshot
   * replaces it, and lookups for stale revisions miss rather than aliasing new
   * pixels. Runners that render asynchronously capture snapshot pixels before
   * requesting a later draw list.
   */
  surfacePixels(id: SurfaceId, rev: number): SurfacePixels | null;
  /**
   * The pixels the core decoded for picture `key` — a composed tile bitmap, or
   * any picture a runner cannot decode itself — or `null` when it has not been
   * decoded (docs/spec/engine/runners.md#picture-pixels, AD-28). A copy, so a
   * runner cannot disturb the cache it came from.
   */
  picturePixels(key: AssetKey): SurfacePixels | null;
  /**
   * Return one explicit checkpoint or queued pre-battle candidate, or `null`
   * when no candidate is pending or the current state is ineligible.
   */
  recoveryCandidate(): { readonly bytes: Uint8Array; readonly tick: number } | null;
  /** Whether a recovery launch is loading, paused for host Resume, resumed, or refused. */
  recoveryStatus(): RecoveryStatus;

  /** Resume a paused recovery launch. Returns true only for the first successful resume. */
  resumeRecovery(): boolean;
  /** Set source breakpoints as data; a hit stops mid-tick (AD-1). */
  setBreakpoints(breakpoints: readonly Breakpoint[]): void;
}

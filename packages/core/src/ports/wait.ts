/**
 * Waits: one wake contract (AD-9; docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-1, R-32).
 *
 * A blocked thread holds a `Wait` — plain data in `Thread.wait` — until the
 * one `WaitPoll` resolves it. Every kind carries its own payload, never a
 * closure or a timer (AD-9: "a wait uses no closure and no timer"):
 *
 * - `sleep` stores the absolute end tick `T + ticks`; `until: null` is the
 *   indefinite sleep (`threadSleep(id, 0)`) that only `threadWake` ends.
 * - `input.key` waits for a key; the input owner stores the key name into `key`.
 * - `movement` waits for coupled sprite movement.
 * - `request` waits for a host reply, while `blob` is the file-I/O request wait.
 * - `audio.track` waits on a saved track/voice cue and is polled from core audio state.
 * - `event.dispatch` waits for a cancelable emit's delivery (EMIT-16) and is polled from the `events` section.
 *
 * `global` marks a blocking command (R-32). A cooperative wait parks only its
 * own thread. Wait payloads are plain data so a save can restore them exactly.
 */

import type { PlainData } from "./plain-data.ts";
import type { Value } from "./value.ts";

/** One sprite's move inside a `movement` wait: it ends at absolute tick `until`. */
export type WaitMove = { sprite: string; until: number };

/** The reply the host (or a replay) gives a request (AD-5). */
export type WaitReply = { ok: boolean; value: Value };

/** A request's continuation: a named command and plain-data arguments, never a closure. */
export type WaitContinuation = { command: string; args: PlainData[] };

/** A sleep wait, in whole ticks (THR-1). */
export type SleepWait = {
  kind: "sleep";
  global: boolean;
  until: number | null;
  resumesCall: boolean;
};

/** One owner-registered named wait kind. */
export type NamedWaitKind = "render.msgbox" | "input.mouse" | "menu.screen" | "audio.track" | "video" | "event.dispatch";

export type NamedWait = {
  kind: NamedWaitKind;
  global: boolean;
  /** Stable command name, useful to a resolver and to replay diagnostics. */
  id: string;
  payload: PlainData[];
  /** References receive the resolver's returned value, in declaration order. */
  resumeRefs: string[];
};

/** A key wait may carry cursor-map navigation/selection state. */
export type InputKeyWait = {
  kind: "input.key";
  global: boolean;
  key: string | null;
  parkSeq?: number;
  resumeRefs?: string[];
  cursorMap?: number;
  cursorSelection?: number;
  dialogue?: { actorId: number; targetId: number | null; text: string };
  /**
   * `waitInput`: also resume when the pointer record differs from this baseline
   * (docs/spec/engine/rpgcode-functions.md#reawakened-waitinput). The baseline travels with the script, not the park
   * time, so a press and release that arrive while the script is busy are still seen by the next wait.
   */
  pointer?: { x: number; y: number; buttons: number; downs: number; ups: number };
};

/** A wait for coupled sprite movement (`multiRun`, E-33). */
export type MovementWait = { kind: "movement"; global: boolean; moves: WaitMove[] };

/** A wait for the 5.10 sprite animation owner to report stance completion. */
export type StanceWait = { kind: "sprite.stance"; global: boolean; actor: string; stance: string };

/** A wait for a host reply (AD-5), located at the call that made it. */
export type RequestWait = {
  kind: "request";
  global: boolean;
  reqId: number;
  deadline: number | null;
  reply: WaitReply | null;
  then: WaitContinuation | null;
  file: string;
  line: number;
};

/** A sandboxed file/blob request wait (AD-9, AD-17). */
export type BlobWait = {
  kind: "blob";
  global: boolean;
  reqId: number;
  deadline: number | null;
  reply: WaitReply | null;
  then: WaitContinuation | null;
  file: string;
  line: number;
};

/** Every wait kind the VM registry knows (AD-9). */
export type Wait = SleepWait | InputKeyWait | MovementWait | StanceWait | RequestWait | BlobWait | NamedWait;

/** The wait kind names, namespaced where an owner part owns the kind. */
export type WaitKind = Wait["kind"];

export type WaitInputView = {
  readonly nextSeq?: number;
  readonly keys: readonly { readonly seq: number; readonly name: string; readonly code: string; readonly char: string | null }[];
  readonly focused: boolean;
  readonly pointer?: { readonly x: number; readonly y: number; readonly buttons: number; readonly downs?: number; readonly ups?: number; readonly downX?: number; readonly downY?: number; readonly button?: number };
};
export type WaitUiView = { readonly [name: string]: unknown };

export type WaitSpriteView = {
  readonly id: string;
  readonly stance: string | null;
  readonly stanceComplete: boolean;
};

/** The read-only audio state needed by `audio.track` polling. */
export type WaitAudioView = {
  readonly tracks: readonly {
    readonly name: string;
    readonly voices: readonly {
      readonly index: number;
      readonly state: "playing" | "paused";
      readonly cueId: number;
      readonly loop: boolean;
      readonly startTick: number;
      readonly lengthTicks: number | null;
      readonly endTick: number | null;
    }[];
  }[];
};
/** The video reply currently held by the engine. */
export type WaitVideoView = { readonly reqId: number; readonly ended: boolean };

/** The read-only events state needed by `event.dispatch` polling: the queue and the delivery in progress (EMIT-15). */
export type WaitEventsView = {
  readonly queue: readonly { readonly event: number }[];
  readonly dispatch: { readonly event: number } | null;
};

/** What the waits phase may read while deciding. */
export type WaitView = {
  readonly tick: number;
  readonly input?: WaitInputView;
  readonly ui?: WaitUiView;
  readonly sprites?: readonly WaitSpriteView[];
  readonly claims?: readonly number[];
  readonly audio?: WaitAudioView;
  readonly video?: WaitVideoView;
  readonly events?: WaitEventsView;
  /** The active stock list is nonempty while a shop screen owns the menu. */
  readonly shopStock?: readonly string[];
  /** The audio effects still held for an asset, so a pending start's wait can tell "not yet" from "never". */
  readonly pendingAudio?: readonly { readonly seq: number }[];
  /** The bound voice identity of a script voice object, or `null` while it has not started. */
  readonly mediaStart?: (handle: number) => { readonly track: string; readonly slot: number; readonly cueId: number } | null;
};

/** A wake result or an input claim that leaves the wait parked. */
export type WaitResult =
  | {
      readonly value: Value;
      readonly ok: boolean;
      /** A dictionary the VM builds as the resumed call's value (`waitInput`); `value` is then ignored. */
      readonly record?: { readonly [field: string]: PlainData };
      readonly claim?: number;
      /** Per-waiter sequence floor: claim queued input records older than this when resolving. */
      readonly discardBefore?: number;
      readonly keepWaiting?: false;
    }
  | {
      readonly value: null;
      readonly ok: true;
      readonly claim: number;
      readonly discardBefore?: never;
      readonly record?: never;
      readonly keepWaiting: true;
    };

/** The one resolver signature: `null` means not resolved; `keepWaiting` claims input without waking. */
export type WaitPoll = (view: WaitView, wait: Wait) => WaitResult | null;

/** One kind's resolver, registered into the single `WaitPoll`. */
export type WaitKindResolver = {
  readonly kind: string;
  readonly poll: WaitPoll;
};

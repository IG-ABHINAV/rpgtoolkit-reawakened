/**
 * Everything from outside is an input (AD-5, AD-14).
 *
 * Inputs are `{ tick, event }`, where `tick` is `time.tick` at the start of
 * the consuming tick; inputs apply in array order within a tick. The core
 * returns the consumed list in `TickReport.consumed` and that concatenation is
 * the canonical replay log.
 */

import type { Bytes, PortData } from "./bytes.ts";
import type { HostDisplayGeometry, NormalizedHostFeatures } from "./host.ts";

/** A key press or release (E-110). */
export type KeyInput = {
  readonly kind: "key";
  readonly name: string;
  readonly code: string;
  readonly char: string | null;
  readonly down: boolean;
  /** Host auto-repeat is deliberately not a new press edge. */
  readonly repeat?: boolean;
};

/** Cancellation of the active pointer gesture, without a release edge (E-111). */
export type PointerCancelInput = { readonly kind: "pointer.cancel" };

/** A pointer event in logical integer pixels (E-111). */
export type PointerInput = {
  readonly kind: "pointer";
  readonly x: number;
  readonly y: number;
  readonly buttons: number;
};

/**
 * Normalized gamepad data (E-112). Hosts convert controller APIs to this
 * integer payload before crossing the core boundary.
 */
export type GamepadInput = {
  readonly kind: "gamepad";
  readonly device: number;
  readonly connected: boolean;
  readonly axes: { readonly x: number; readonly y: number };
  readonly buttons: number;
};

/** Complete live set of connected normalized devices used to reconcile a restored gamepad section. */
export type HostGamepadsInput = {
  readonly kind: "host.gamepads";
  readonly devices: readonly {
    readonly device: number;
    readonly axes: { readonly x: number; readonly y: number };
    readonly buttons: number;
  }[];
};

/** The window gained or lost focus. */
export type FocusInput = {
  readonly kind: "focus";
  readonly state: "lost" | "gained";
};

/** A complete host capability update, captured as deterministic input. */
export type HostFeaturesInput = {
  readonly kind: "host.features";
  readonly features: NormalizedHostFeatures;
};

/** A complete measured display geometry update, captured as deterministic input. */
export type HostDisplayInput = {
  readonly kind: "host.display";
  readonly geometry: HostDisplayGeometry;
};

/** The reply to an `asset` request: the bytes, or `null` when missing. */
export type AssetReply = {
  readonly kind: "asset";
  readonly reqId: number;
  readonly bytes: Bytes | null;
};

/** The reply to a `loadBlob` request. */
export type BlobLoaded = {
  readonly kind: "blob.loaded";
  readonly reqId: number;
  readonly bytes: Bytes | null;
};

/** The reply to a `saveBlob` request. */
export type BlobSaved = {
  readonly kind: "blob.saved";
  readonly reqId: number;
  readonly ok: boolean;
};

/** The reply to a `listBlobs` request. */
export type BlobListed = {
  readonly kind: "blob.listed";
  readonly reqId: number;
  readonly names: readonly string[];
};

/** The reply to an `extension.call` request. */
export type ExtensionResult = {
  readonly kind: "extension.result";
  readonly reqId: number;
  readonly result: PortData;
};

/** A stream audio cue finished. */
export type AudioEnded = {
  readonly kind: "audio.ended";
  readonly cueId: number;
};

/** A stream video finished. */
export type VideoEnded = {
  readonly kind: "video.ended";
  readonly reqId: number;
};

/** A normalized semantic action edge, consumed on its stamped tick (ACT-4). */
export type ActionInput =
  | {
      readonly kind: "action";
      readonly action: string;
      readonly down: boolean;
      readonly source: string;
      readonly modalId: null;
    }
  | {
      readonly kind: "action";
      readonly action: "confirm" | "cancel";
      readonly down: boolean;
      readonly source: string;
      /** Non-null binds a modal-only action to the exact modal instance that received the press. */
      readonly modalId: number;
    };

/** The one published input event union (AD-14). */
export type InputEvent =
  | KeyInput
  | PointerInput
  | PointerCancelInput
  | GamepadInput
  | ActionInput
  | FocusInput
  | HostFeaturesInput
  | HostDisplayInput
  | HostGamepadsInput
  | AssetReply
  | BlobLoaded
  | BlobSaved
  | BlobListed
  | ExtensionResult
  | AudioEnded
  | VideoEnded;

/** One external input, stamped with the tick that consumes it. */
export type InputRecord = {
  readonly tick: number;
  readonly event: InputEvent;
};
/** Historical runner protocol v1 event union; active v2 adds ActionInput and HostGamepadsInput. */
export type InputEventV1 =
  | KeyInput
  | PointerInput
  | PointerCancelInput
  | GamepadInput
  | FocusInput
  | HostFeaturesInput
  | HostDisplayInput
  | AssetReply
  | BlobLoaded
  | BlobSaved
  | BlobListed
  | ExtensionResult
  | AudioEnded
  | VideoEnded;
export type InputRecordV1 = { readonly tick: number; readonly event: InputEventV1 };

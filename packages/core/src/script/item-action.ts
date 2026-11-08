/**
 * The saveable continuation of one composed item action (docs/spec/engine/plugins-and-battle.md#epic-85-item-action-proposal).
 *
 * `use`, `replace` and `removeEquipment` run on the calling thread as a plain-data phase record stored on the
 * frame that started them (`Frame.itemActions`, innermost last). The record names the exact action, its phase,
 * the stack and displaced-tuple identities the owner selected at preflight, the item programs still to run and the
 * caller destination. Nothing in it is a closure, a Promise or a second thread (G1), so a save at any boundary
 * (before a hook can yield, after a commit but before an equip hook finishes, at a ready completion) restores to
 * the same phase. Nested actions started inside an item program live on that program's own frames and resume
 * last-in-first-out.
 *
 * The owner (`MenuOwnerPorts.inventory`) never runs a program: the VM asks it for the missing definitions,
 * preflights, commits, and drives the item programs between those calls.
 */

import type { ItemActionRequest, ItemActionResult, ItemActionSelection } from "../menu/ports.ts";
import type { ItemActionHooks } from "../menu/ports.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { Frame } from "./state.ts";

/** The internal command a host-request reply for an item definition resumes with. */
export const ITEM_ACTION_ASSET_COMMAND = "__item_action_asset";
/** The internal command the ready completion of a native action dispatches through (one ordinary VM step). */
export const ITEM_ACTION_COMPLETE_COMMAND = "__item_action_complete";

/** Who receives the action's result. */
export type ItemActionOrigin = "native" | "rpgcode" | "adapter";

/** The phase a pending action is in; `*.hook` phases mean an item program frame is (or just was) above the owner frame. */
export type ItemActionStage =
  | "assets"
  | "preflight"
  | "effects"
  | "commit"
  | "consume"
  | "remove.hook"
  | "equip.hook"
  | "use.hook"
  | "completion";

const STAGES: readonly ItemActionStage[] = [
  "assets", "preflight", "effects", "commit", "consume", "remove.hook", "equip.hook", "use.hook", "completion",
];
const RESUME_STAGES: readonly string[] = ["preflight", "commit", "consume"];

/** One pending action. Plain data only; a saved frame holds it verbatim. */
export type ItemActionRecord = {
  origin: ItemActionOrigin;
  /** `equip` or `remove` when a legacy script adapter started the action: its failure raises, its success is void. */
  adapter: "equip" | "remove" | null;
  action: ItemActionRequest;
  phase: ItemActionStage;
  /** The stage to run once every required definition is loaded; `null` outside the `assets` phase. */
  next: "preflight" | "commit" | "consume" | null;
  /** Canonical keys (`area:path`) already requested during this run of the action; reset on restore. */
  requested: string[];
  /** The owner's preflight identities, or `null` before preflight completes. */
  selection: ItemActionSelection | null;
  /** The non-empty item programs and their plain item data, fixed at preflight. */
  hooks: ItemActionHooks | null;
  /** True once an owner effect or an item program has begun, so a later failure is `interrupted`. */
  started: boolean;
  /** The native provider's saved continuation (identity, screen, parents, state); `null` for script callers. */
  provider: { [key: string]: PlainData } | null;
  /** The result waiting for its ready completion dispatch (`completion` phase only). */
  result: ItemActionResult | null;
  /** The call op's instruction position in the owner frame and its source position. */
  opIp: number;
  file: string;
  line: number;
};

export function assetKey(area: string, path: string): string {
  return `${area}:${path.toLowerCase()}`;
}

/** The innermost pending action on a frame, or `undefined`. */
export function topItemAction(frame: Frame): ItemActionRecord | undefined {
  const records = frame.itemActions;
  if (records === undefined || records.length === 0) return undefined;
  return records[records.length - 1] as unknown as ItemActionRecord;
}

export function isHookStage(stage: ItemActionStage): boolean {
  return stage === "remove.hook" || stage === "equip.hook" || stage === "use.hook";
}

function plain(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The exact variant and field types of one action; ids need only be numbers (invalid values are an owner refusal). */
export function isItemActionRequest(value: unknown): value is ItemActionRequest {
  if (!plain(value)) return false;
  const keys = Object.keys(value);
  if (value.kind === "use") {
    return keys.length === 3 && typeof value.entryId === "number" && typeof value.actorId === "number";
  }
  if (value.kind === "replace") {
    return keys.length === 4 && typeof value.entryId === "number" && typeof value.actorId === "number" &&
      typeof value.slot === "string";
  }
  return value.kind === "removeEquipment" && keys.length === 3 && typeof value.actorId === "number" &&
    typeof value.slot === "string";
}

function isResult(value: unknown): value is ItemActionResult {
  if (!plain(value)) return false;
  if (value.status === "complete") return value.error === null && Object.keys(value).length === 2;
  if (value.status !== "refused" && value.status !== "interrupted") return false;
  return plain(value.error) && typeof value.error.path === "string" && typeof value.error.message === "string";
}

function isHook(value: unknown): boolean {
  if (value === null) return true;
  if (!plain(value) || typeof value.program !== "string" || !plain(value.item)) return false;
  return Object.values(value.item).every((entry) => typeof entry === "string" || typeof entry === "number");
}

/** Whether a saved selection is a complete identity that agrees with its action (contract restore validation). */
function selectionIssue(selection: { readonly [key: string]: unknown }, action: ItemActionRequest): boolean {
  if (selection.kind !== action.kind) return false;
  if (typeof selection.actorId !== "number" || !Number.isSafeInteger(selection.actorId) || selection.actorId < 1) return false;
  if (selection.actorId !== action.actorId) return false;
  if (typeof selection.actorSource !== "string") return false;
  if (selection.entryId !== null && (typeof selection.entryId !== "number" || !Number.isSafeInteger(selection.entryId))) return false;
  if (action.kind === "removeEquipment" && selection.entryId !== null) return false;
  if (selection.entryId === null) {
    if (selection.entrySource !== null || selection.entryHandle !== null) return false;
  } else if (typeof selection.entrySource !== "string" || typeof selection.entryHandle !== "string") return false;
  if ("entryId" in action && selection.entryId !== action.entryId) return false;
  const displaced = selection.displaced;
  if (action.kind === "use" && (displaced !== null || selection.slot !== null)) return false;
  if (displaced !== null) {
    if (!plain(displaced)) return false;
    if (typeof displaced.slot !== "string" || typeof displaced.source !== "string" || typeof displaced.handle !== "string") return false;
    if (typeof displaced.entryId !== "number" || !Number.isSafeInteger(displaced.entryId)) return false;
    if ("slot" in action && displaced.slot !== action.slot) return false;
  }
  if (selection.slot !== null && typeof selection.slot !== "string") return false;
  if ("slot" in action && selection.slot !== action.slot) return false;
  return true;
}

/**
 * A located message when `value` is not a well-formed pending-action record, else `null`. The check is
 * structural: the save carries no program or provider objects to resolve, which restore verifies separately.
 */
export function itemActionRecordIssue(value: unknown): string | null {
  if (!plain(value)) return "is not an object";
  if (value.origin !== "native" && value.origin !== "rpgcode" && value.origin !== "adapter") return "has no valid origin";
  if (value.adapter !== null && value.adapter !== "equip" && value.adapter !== "remove") return "has no valid adapter";
  if ((value.adapter === null) === (value.origin === "adapter")) return "adapter does not match its origin";
  if (!isItemActionRequest(value.action)) return "has no valid action";
  if (typeof value.phase !== "string" || !STAGES.includes(value.phase as ItemActionStage)) return "has no valid phase";
  if (value.phase === "assets") {
    if (typeof value.next !== "string" || !RESUME_STAGES.includes(value.next)) return "waits for assets with no next stage";
  } else if (value.next !== null) return "has a next stage outside the assets phase";
  if (!Array.isArray(value.requested) || !value.requested.every((key) => typeof key === "string")) return "has no valid requested list";
  if (value.selection !== null && !plain(value.selection)) return "has no valid selection";
  if (value.selection !== null && !selectionIssue(value.selection as { readonly [key: string]: unknown }, value.action as ItemActionRequest)) {
    return "has a malformed selection";
  }
  const needsSelection = value.phase !== "assets" && value.phase !== "preflight";
  if (needsSelection && value.selection === null && value.phase !== "completion") return "reached its phase without a selection";
  if (value.hooks !== null) {
    if (!plain(value.hooks) || !isHook(value.hooks.use) || !isHook(value.hooks.remove) || !isHook(value.hooks.equip)) {
      return "has no valid hooks";
    }
  }
  if (typeof value.started !== "boolean") return "has no valid started flag";
  if (value.origin === "native") {
    if (!plain(value.provider) || typeof value.provider.providerId !== "string" || typeof value.provider.screen !== "string") {
      return "is native but has no provider continuation";
    }
  } else if (value.provider !== null) return "has a provider continuation outside a native action";
  if (value.phase === "completion") {
    if (value.origin !== "native" || !isResult(value.result)) return "is complete without a native result";
  } else if (value.result !== null) return "has a result outside the completion phase";
  if (typeof value.opIp !== "number" || !Number.isSafeInteger(value.opIp) || value.opIp < 0) return "has no valid call position";
  if (typeof value.file !== "string" || typeof value.line !== "number" || !Number.isSafeInteger(value.line)) {
    return "has no valid source position";
  }
  return null;
}

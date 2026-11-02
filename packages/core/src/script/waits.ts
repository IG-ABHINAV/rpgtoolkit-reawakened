/**
 * The wait registry: per-kind resolvers folded into AD-9's one `WaitPoll`
 * (docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-1; R-32).
 *
 * AD-9 rules `poll(view, wait)` the only wake resolver. Each kind contributes
 * one resolver and `createWaitPoll` dispatches on `wait.kind`; a kind
 * registered twice is refused (`wait.duplicate-kind`), and a wait whose kind
 * nobody registered fails loudly (`wait.unknown-kind`) rather than sleeping
 * forever. Owner epics add their kinds (`menu.screen` and the like) by
 * building their own poll over `WAIT_KIND_RESOLVERS` plus theirs.
 *
 * Every resolver is pure over the wait payload and the tick: no closure, no
 * timer, nothing outside state.
 */

import type { Wait, WaitKindResolver, WaitPoll, WaitResult, WaitView } from "../ports/wait.ts";
import { ScriptError } from "./errors.ts";
import { DICTIONARY_CLASS } from "./objects.ts";

/** The text a request that ran out its tick deadline resumes with. */
export const REQUEST_TIMEOUT_TEXT = "the request timed out";

const DONE: WaitResult = { value: null, ok: true };

/** `sleep`: due at `until`; `until: null` is indefinite and only a wake ends it. */
export function pollSleep(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "sleep" || wait.until === null) return null;
  return view.tick >= wait.until ? DONE : null;
}

type InputKeyWait = Extract<Wait, { readonly kind: "input.key" }>;

function pollCursorMapKey(wait: InputKeyWait, key: string, count: number, claim?: number): WaitResult | null {
  const normalized = key.toLowerCase();
  let selected = Math.max(0, Math.min(count - 1, Math.trunc(wait.cursorSelection ?? 0)));
  if (normalized === "left" || normalized === "up" || normalized === "arrowleft" || normalized === "arrowup") selected = (selected + count - 1) % count;
  else if (normalized === "right" || normalized === "down" || normalized === "arrowright" || normalized === "arrowdown") selected = (selected + 1) % count;
  else if (normalized === "enter" || normalized === "return" || normalized === "space" || normalized === " ") {
    return claim === undefined ? { value: selected, ok: true } : { value: selected, ok: true, claim };
  } else return null;
  wait.cursorSelection = selected;
  return null;
}

/** `input.key`: resolve ordinary keys or cursor-map navigation/selection. */
export function pollInputKey(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "input.key") return null;
  const floor = wait.parkSeq ?? 0;
  const claimed = new Set(view.claims ?? []);
  const cursorMaps = (view.ui as { readonly cursorMaps?: readonly { readonly id: number; readonly points: readonly { readonly x: number; readonly y: number }[] }[] } | undefined)?.cursorMaps;
  const map = wait.cursorMap === undefined ? undefined : cursorMaps?.find((entry) => entry.id === wait.cursorMap);
  if (map !== undefined) {
    const count = map.points.length;
    if (count === 0) {
      wait.key = null;
      return null;
    }
    if (view.input !== undefined) {
      for (const key of view.input.keys) {
        if (key.seq < floor || claimed.has(key.seq)) continue;
        const result = pollCursorMapKey(wait, key.name, count, key.seq);
        if (result !== null) return result;
      }
    }
    if (wait.key !== null) {
      const result = pollCursorMapKey(wait, wait.key, count);
      wait.key = null;
      if (result !== null) return result;
    }
    return null;
  }
  if (view.input !== undefined) {
    for (const key of view.input.keys) {
      if (key.seq < floor || claimed.has(key.seq)) continue;
      return { value: key.name, ok: true, claim: key.seq, discardBefore: floor };
    }
  }
  if (wait.key === null) return null;
  return { value: wait.key, ok: true, discardBefore: floor };
}
/** `menu.screen`: resolve provider input, or wait for the active shop context to close. */
export function pollMenuScreen(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "menu.screen") return null;
  const saved = wait.payload[0];
  if (saved !== null && typeof saved === "object" && !Array.isArray(saved) && typeof saved.providerId === "string") {
    const floor = typeof saved.parkSeq === "number" ? saved.parkSeq : 0;
    if (saved.phase !== "input") return { value: null, ok: true };
    const claimed = new Set(view.claims ?? []);
    for (const key of view.input?.keys ?? []) {
      if (key.seq < floor || claimed.has(key.seq)) continue;
      return { value: key.name, ok: true, claim: key.seq };
    }
    return null;
  }
  if (view.shopStock === undefined) throw new ScriptError("wait.no-menu-view", "a menu.screen wait was polled with no shop view");
  return view.shopStock.length === 0 ? DONE : null;
}


/** `movement`: resolved when every collected move has reached its end tick. */
export function pollMovement(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "movement") return null;
  for (const move of wait.moves) {
    if (view.tick < move.until) return null;
  }
  return DONE;
}

/** `sprite.stance`: resolve only from the animation owner completion result. */
export function pollStance(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "sprite.stance") return null;
  const actor = view.sprites?.find((value) => value.id === wait.actor);
  if (actor === undefined) return null;
  return actor.stanceComplete || actor.stance !== wait.stance ? DONE : null;
}

/** `request` and `blob`: resolved by the stored reply, else by the tick deadline. */
export function pollRequest(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "request" && wait.kind !== "blob") return null;
  if (wait.reply !== null) return { value: wait.reply.value, ok: wait.reply.ok };
  if (wait.deadline !== null && view.tick >= wait.deadline) return { value: REQUEST_TIMEOUT_TEXT, ok: false };
  return null;
}

/** Resolve the UI's prompt or button result from modal state or a key event. */
export function pollRenderMsgBox(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "render.msgbox") return null;
  const modal = view.ui?.modal;
  if (modal !== null && typeof modal === "object" && "result" in modal) {
    const result = modal.result;
    if (typeof result === "string" || typeof result === "number") return { value: result, ok: true };
  }
  if (view.input === undefined) return null;
  const claimed = new Set(view.claims ?? []);
  for (const key of view.input.keys) {
    if (claimed.has(key.seq)) continue;
    const normalized = key.name.toLowerCase();
    if (wait.id === "prompt") {
      if (normalized === "enter" || normalized === "return" || normalized === "space") return { value: key.char ?? "", ok: true, claim: key.seq };
      continue;
    }
    const style = wait.payload[2] === 1 ? 1 : 0;
    if (normalized === "yes" || normalized === "y") return { value: 6, ok: true, claim: key.seq };
    if (normalized === "no" || normalized === "n") return { value: 7, ok: true, claim: key.seq };
    if (normalized === "enter" || normalized === "return" || normalized === "space") return { value: style === 1 ? 6 : 1, ok: true, claim: key.seq };
  }
  return null;
}

/** The audio owner resolver for finite-end and loop-pass waits. */
export function pollAudioTrack(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "audio.track") return null;
  // mediaPlay preserves its return value here while the call is parked. Legacy
  // void waits have no second payload entry.
  const returned = wait.payload[1];
  const done: WaitResult = returned !== null && typeof returned === "object" && !Array.isArray(returned)
    && returned.kind === "object" && typeof returned.handle === "number" && typeof returned.className === "string"
    ? { value: { kind: "object", handle: returned.handle, className: returned.className }, ok: true }
    : DONE;
  const raw = wait.payload[0];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  let trackName = raw.track;
  let voiceIndex = raw.voice;
  let cueId = raw.cueId;
  const pass = raw.pass;
  const passIndex = raw.passIndex;
  if (typeof trackName !== "string" || (voiceIndex !== null && typeof voiceIndex !== "number") || (cueId !== null && typeof cueId !== "number") || typeof pass !== "boolean" || (passIndex !== null && typeof passIndex !== "number")) return null;
  if (cueId === 0) {
    // A start still held for its asset (MEDIA-1): park until it binds, or wake
    // when the held effect is gone without a voice ever starting.
    const handle = raw.handle;
    const seq = raw.seq;
    if (typeof handle !== "number" || typeof seq !== "number") return DONE;
    const bound = view.mediaStart?.(handle) ?? null;
    if (bound === null || bound.cueId <= 0) {
      return view.pendingAudio?.some((effect) => effect.seq === seq) === true ? null : DONE;
    }
    trackName = bound.track;
    voiceIndex = bound.slot;
    cueId = bound.cueId;
  }
  if (typeof voiceIndex !== "number" || typeof cueId !== "number") return done;
  const track = view.audio?.tracks.find((item) => item.name === trackName);
  const voice = track?.voices.find((item) => item.index === voiceIndex && item.cueId === cueId);
  if (voice === undefined) return done;
  if (voice.state === "paused") return null;
  if (!pass && (voice.loop || voice.lengthTicks === null)) return done;
  if (pass && voice.loop && voice.lengthTicks !== null && passIndex !== null) {
    const currentPass = Math.floor((view.tick - voice.startTick) / voice.lengthTicks);
    return currentPass > passIndex ? done : null;
  }
  return voice.endTick !== null && view.tick >= voice.endTick ? done : null;
}
/** `video`: wake only for the matching, unskippable video completion reply. */
export function pollVideo(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "video") return null;
  const payload = wait.payload[0];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const reqId = payload.reqId;
  if (typeof reqId !== "number" || view.video?.reqId !== reqId || view.video.ended !== true) return null;
  return DONE;
}

/**
 * `event.dispatch` (EMIT-16): wake once the cancelable event named by the payload
 * is neither queued nor the delivery in progress, with the event object as the
 * value of the emit. The view carries no events state only when a host built it
 * without the section, which is a fault, not a "not yet".
 */
export function pollEventDispatch(view: WaitView, wait: Wait): WaitResult | null {
  if (wait.kind !== "event.dispatch") return null;
  const handle = wait.payload[0];
  if (typeof handle !== "number") return null;
  const events = view.events;
  if (events === undefined) throw new ScriptError("wait.no-events-view", "an event.dispatch wait was polled with no events state in the wait view");
  if (events.dispatch?.event === handle || events.queue.some((queued) => queued.event === handle)) return null;
  if (wait.id === "media.beforePlay") {
    const rawRecord = wait.payload[1];
    const sequence = wait.payload[2];
    const returnVoice = wait.payload[3] === true;
    const waitForEnd = wait.payload[4] === true;
    if (rawRecord === null || typeof rawRecord !== "object" || Array.isArray(rawRecord) || typeof rawRecord.handle !== "number" || typeof sequence !== "number") return DONE;
    const bound = view.mediaStart?.(rawRecord.handle) ?? null;
    if (bound !== null && bound.cueId > 0) {
      if (waitForEnd) {
        const track = view.audio?.tracks.find((item) => item.name === bound.track);
        const voice = track?.voices.find((item) => item.index === bound.slot && item.cueId === bound.cueId);
        if (voice !== undefined && voice.state === "playing" && voice.endTick !== null && view.tick < voice.endTick) return null;
      }
      return returnVoice
        ? { value: { kind: "object", handle: rawRecord.handle, className: typeof rawRecord.className === "string" ? rawRecord.className : "" }, ok: true }
        : DONE;
    }
    if (view.pendingAudio?.some((effect) => effect.seq === sequence) === true) return null;
    return DONE;
  }
  return { value: { kind: "object", handle, className: DICTIONARY_CLASS }, ok: true };
}

/** UI-owned wait kinds, kept separate so hosts can extend the VM registry without duplicate registration. */

export const UI_WAIT_KIND_RESOLVERS: readonly WaitKindResolver[] = [
  { kind: "render.msgbox", poll: pollRenderMsgBox },
  { kind: "menu.screen", poll: pollMenuScreen },
];

/** The VM-owned wait kinds. */
export const WAIT_KIND_RESOLVERS: readonly WaitKindResolver[] = [
  { kind: "sleep", poll: pollSleep },
  { kind: "input.key", poll: pollInputKey },
  { kind: "movement", poll: pollMovement },
  { kind: "sprite.stance", poll: pollStance },
  { kind: "request", poll: pollRequest },
  { kind: "blob", poll: pollRequest },
  { kind: "audio.track", poll: pollAudioTrack },
  { kind: "video", poll: pollVideo },
  { kind: "event.dispatch", poll: pollEventDispatch },
];

/** Fold per-kind resolvers into the one `WaitPoll` (AD-9). Throws
 * `wait.duplicate-kind` when two resolvers claim a kind.
 */
export function createWaitPoll(resolvers: readonly WaitKindResolver[]): WaitPoll {
  const byKind = new Map<string, WaitPoll>();
  for (const resolver of resolvers) {
    if (byKind.has(resolver.kind)) {
      throw new ScriptError("wait.duplicate-kind", `the wait kind "${resolver.kind}" is registered twice (AD-9)`);
    }
    byKind.set(resolver.kind, resolver.poll);
  }
  return (view, wait) => {
    const resolve = byKind.get(wait.kind);
    if (resolve === undefined) throw new ScriptError("wait.unknown-kind", `no resolver is registered for wait kind "${wait.kind}"`);
    return resolve(view, wait);
  };
}

/** The default poll for VM and UI-owned kinds. */
export const defaultWaitPoll: WaitPoll = createWaitPoll([...WAIT_KIND_RESOLVERS, ...UI_WAIT_KIND_RESOLVERS]);

/** A short plain description of a wait, for diagnostics (deadlock reports). */
export function describeWait(wait: Wait): string {
  switch (wait.kind) {
    case "sleep":
      return wait.until === null ? "sleep(indefinite)" : `sleep(until tick ${wait.until})`;
    case "input.key":
      return "input.key";
    case "movement":
      return `movement(${wait.moves.length} move(s))`;
    case "sprite.stance":
      return `sprite.stance(${wait.actor})`;
    case "request":
    case "blob":
      return `${wait.kind}(reqId ${wait.reqId})`;
    default:
      return `${wait.kind}(${wait.id})`;
  }
}

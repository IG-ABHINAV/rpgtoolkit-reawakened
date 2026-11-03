/**
 * The `events` phase: delivery of queued events (AD-26; EMIT-3, EMIT-10, EMIT-14;
 * docs/spec/engine/rpgcode-modules-and-objects.md#emit-14).
 *
 * The dispatcher is core-owned, not a script loop (discovery/step-budget-spike.md,
 * recommendation 2). It takes the oldest queued event, fixes the list of
 * listeners at that moment, and runs the listeners of the list in order, each on
 * a new `persistent` world-owned thread whose one statement calls the listener
 * with the event. Everything it needs between two steps is the `events` section
 * (the cursor), so a save taken between any two listeners restores and finishes
 * as the unsaved run does (G1).
 *
 * The listeners started in one phase share one `STEP_BUDGET`. A listener the
 * budget interrupts, or that waits, carries on in the following `threads` phases
 * like any thread and the dispatcher waits for it, so delivery order never
 * changes. No delivery happens while a blocking command waits (R-32).
 */

import { IR_VERSION } from "../script/program.ts";
import { pendingAudioRoots } from "../audio/pending.ts";
import { findObject, readMember } from "../script/objects.ts";
import { findBlockingThread, findThread, killThread, localRef, refreshBlock, startThread, type Thread } from "../script/state.ts";
import { collectGarbage, discardMenuFrames, STEP_BUDGET, stepThread, type ScriptServices } from "../script/vm.ts";
import type { CallableValue } from "../ports/value.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { GameState } from "../save/state.ts";
import { eventRoots, forgetNativeDetail, listenerCoversEmitter, pruneDeadEmitters, queueNativeEvent, unregisterEmitter } from "./emitter.ts";
import type { DispatchCursor, QueuedEvent } from "./model.ts";

/** The one statement of a listener's thread, and the two locals it reads. */
const LISTENER_NAME = "__listener";
const EVENT_NAME = "__event";
const LISTENER_PROGRAM = `${LISTENER_NAME}(${EVENT_NAME})`;

/** Fix the list of listeners for `next` as of now (EMIT-4): its emitter's, of its type, in table order. */
function beginDispatch(state: GameState, next: QueuedEvent): DispatchCursor | null {
  const event = findObject(state.vm, next.event);
  if (event === undefined) return null;
  const type = readMember(event, "type");
  const order = state.events.listeners
    .filter((listener) => listenerCoversEmitter(listener.emitter, next.emitter) && listener.type === type)
    .map((listener) => listener.id);
  return { emitter: next.emitter, event: next.event, order, index: 0, thread: null };
}
function retireCompletedEmitters(state: GameState): void {
  const retiring = state.events.retiring;
  if (retiring === undefined) return;
  const active = state.events.dispatch?.emitter;
  const pending = new Set(state.events.queue.map((queued) => queued.emitter));
  for (const key of retiring) if (key !== active && !pending.has(key)) unregisterEmitter(state.events, key);
}

/** Start the thread that calls `callable` with the event object (EMIT-14). */
function startListenerThread(state: GameState, callable: CallableValue, event: number): Thread {
  const thread = startThread(state.vm, {
    ref: { kind: "inline", text: LISTENER_PROGRAM, ir: IR_VERSION },
    kind: "persistent",
    owner: "world",
  });
  const locals = thread.frames[0]!.locals;
  locals[LISTENER_NAME] = { value: callable, ref: localRef(LISTENER_NAME) };
  locals[EVENT_NAME] = { value: { kind: "object", handle: event, className: "" }, ref: localRef(EVENT_NAME) };
  return thread;
}

/**
 * Run the `events` phase (EMIT-14): deliver queued events, oldest first, until
 * the queue is empty, the shared step budget is spent, a listener is still
 * running or a blocking command waits.
 */
export function runEventsPhase(
  state: GameState,
  services: ScriptServices,
  budget: number = STEP_BUDGET,
  onlyEvent?: QueuedEvent,
): void {
  const { vm, events } = state;
  let remaining = budget;
  let pendingOnly = onlyEvent;
  for (;;) {
    if (findBlockingThread(vm) !== null) return;
    const cursor = events.dispatch;
    if (cursor === null) {
      if (pendingOnly !== undefined) {
        const pending = beginDispatch(state, pendingOnly);
        events.dispatch = pending;
        if (pending === null) forgetNativeDetail(events, pendingOnly.event);
        pendingOnly = undefined;
        continue;
      }
      const next = events.queue.shift();
      if (next === undefined) {
        retireCompletedEmitters(state);
        return;
      }
      events.dispatch = beginDispatch(state, next);
      if (events.dispatch === null) forgetNativeDetail(events, next.event);
      continue;
    }
    if (cursor.thread !== null) {
      const running = findThread(vm, cursor.thread);
      if (running !== undefined && running.status !== "finished") return;
      if (running !== undefined) {
        discardMenuFrames(services, running);
        if (killThread(vm, running.id)) services.onThreadRemoved?.(running.id);
      }
      cursor.thread = null;
      cursor.index += 1;
      continue;
    }
    if (cursor.index >= cursor.order.length) {
      forgetNativeDetail(events, cursor.event);
      events.dispatch = null;
      if (onlyEvent !== undefined) return;
      continue;
    }
    if (remaining <= 0) return;
    const at = events.listeners.findIndex((listener) => listener.id === cursor.order[cursor.index]);
    if (at < 0) {
      cursor.index += 1;
      continue;
    }
    const listener = events.listeners[at]!;
    if (listener.once) events.listeners.splice(at, 1);
    const thread = startListenerThread(state, listener.callable, cursor.event);
    cursor.thread = thread.id;
    remaining -= stepThread(thread, vm, services, remaining);
    refreshBlock(vm, services.view.clock.tick());
  }
}

/**
 * The result of an engine-originated cancelable event. `failed` means the
 * listener attempted to wait or exhausted the bounded synchronous budget; the
 * caller can report the failure without parking its phase.
 */
export type EngineCancelableEventOutcome = "allowed" | "canceled" | "failed";

/**
 * Dispatch one engine-originated cancelable event without parking the engine
 * phase (EMIT-11). The listeners still run as ordinary VM listener threads,
 * through the same callable machinery and registration order as queued events.
 */
export function runEngineCancelableEventOutcome(
  state: GameState,
  services: ScriptServices,
  emitter: string,
  type: string,
  detail: Readonly<Record<string, PlainData>>,
  budget: number = STEP_BUDGET,
): EngineCancelableEventOutcome {
  if (state.events.dispatch !== null || findBlockingThread(state.vm) !== null) {
    services.diagnostics.push({
      code: "event.dispatch-active",
      file: "<engine>",
      line: 0,
      message: "an engine cancelable event cannot start while another event is dispatching",
    });
    return "failed";
  }
  const event = queueNativeEvent(state.vm, state.events, emitter, type, detail, true);
  const queued = state.events.queue.filter((item) => item.event !== event);
  state.events.queue = [];
  // An engine-originated event can fire from inside a command (a battle start posting its music), and the listener's
  // own step re-points the command thread; the command's thread owns the rest of that command.
  const callerThread = services.view.thread;
  try {
    runEventsPhase(state, services, budget, { emitter, event });
  } finally {
    services.setCommandThread(callerThread);
  }
  const generated = state.events.queue;
  state.events.queue = [...queued, ...generated];
  const active = state.events.dispatch as unknown as DispatchCursor | null;
  if (active !== null) {
    const thread = active.thread === null ? undefined : findThread(state.vm, active.thread);
    const waiting = thread?.status === "waiting";
    services.diagnostics.push({
      code: waiting ? "event.wait-forbidden" : "event.budget-exceeded",
      file: "<engine>",
      line: 0,
      message: waiting ? `engine event listener for "${type}" attempted to wait` : `engine event "${type}" exceeded its step budget`,
    });
    if (thread !== undefined) {
      discardMenuFrames(services, thread);
      if (killThread(state.vm, thread.id)) services.onThreadRemoved?.(thread.id);
    }
    forgetNativeDetail(state.events, event);
    state.events.dispatch = null;
    return "failed";
  }
  const eventRecord = findObject(state.vm, event);
  if (eventRecord !== undefined) {
    const detailValue = readMember(eventRecord, "detail");
    const detailRecord = typeof detailValue === "object" && detailValue !== null && "kind" in detailValue && detailValue.kind === "object"
      ? findObject(state.vm, detailValue.handle)
      : undefined;
    if (detailRecord !== undefined) {
      const mutable = detail as unknown as Record<string, PlainData>;
      for (const name of Object.keys(mutable)) {
        const original = mutable[name];
        const value = readMember(detailRecord, name);
        if (typeof original === "boolean" && (value === 0 || value === 1)) mutable[name] = value === 1;
        else if (typeof value === "string" || typeof value === "number") mutable[name] = value;
        else mutable[name] = null;
      }
    }
  }
  return eventRecord === undefined ? "failed" : readMember(eventRecord, "canceled") === 1 ? "canceled" : "allowed";
}

/**
 * Backwards-compatible boolean wrapper used by existing engine events.
 */
export function runEngineCancelableEvent(
  state: GameState,
  services: ScriptServices,
  emitter: string,
  type: string,
  detail: Readonly<Record<string, PlainData>>,
  budget: number = STEP_BUDGET,
): boolean {
  return runEngineCancelableEventOutcome(state, services, emitter, type, detail, budget) === "allowed";
}

/**
 * The end-of-tick pass with the roots the state holds outside the ordinary object
 * graph (R-34, EMIT-14, EMIT-16): the listener table and the queued events keep
 * their callables' cells and receivers and their event objects alive, as does a
 * thread parked on a cancelable emit, and the listeners of an emitter the pass
 * freed go with it. `extra` are further script values kept outside the state,
 * such as the callables the layer table of `registerPlugin` holds (entry 19.8).
 * The held `audio` effects are the other such root: a `media.play` still waiting
 * for its file's bytes keeps the `media.voice` object it carries, so the reply
 * binds the voice the play built (`pendingAudioRoots`, audio-media.md pin 4,
 * entry 21.11).
 */
export function collectStateGarbage(state: GameState, extra: readonly unknown[] = []): void {
  const roots = (): unknown[] => [...eventRoots(state.events, state.vm), ...extra, ...pendingAudioRoots(state)];
  collectGarbage(state.vm, roots());
  if (pruneDeadEmitters(state.events, state.vm) > 0) collectGarbage(state.vm, roots());
}

import { actorEmitterKey, actorId, getActor, type ActorId, type ActorsSection } from "./model.ts";
import type { ActorRuleResult, ActorTransition } from "./rules.ts";
import { forgetNativeDetail, queueNativeEvent, registerEmitter } from "../events/emitter.ts";
import type { EventsSection } from "../events/model.ts";
import { createHostObject } from "../script/objects.ts";
import type { VmState } from "../script/state.ts";
import type { ObjectRecord } from "../script/state.ts";

/** A private staging window over the shared event queue; `discard` removes everything queued since it opened. */
export type ActorEventStage = { readonly discard: () => void };
/**
 * The callback shape used by the actor owner to publish committed transitions. `stage` opens a staging window
 * for an operation whose hooks may queue events before its owners commit (the composed item-action boundary).
 */
export type ActorEventSink = ((result: ActorRuleResult) => void) & { readonly stage?: () => ActorEventStage };

/**
 * Open a staging window: events queued from now on stay in emission order, and `discard` retires the ones this
 * window queued (queue entries, their event objects, native details and any emitter first registered inside it).
 * Committing is simply not discarding, so successful hook events precede the transitions published after them.
 */
export function stageActorEvents(vm: VmState, events: EventsSection): ActorEventStage {
  const queued = events.queue.length;
  const objects = vm.objects.length;
  return {
    discard() {
      for (const entry of events.queue.splice(queued)) forgetNativeDetail(events, entry.event);
      const retired = new Set(vm.objects.splice(objects).map((record) => record.handle));
      const emitters = events.emitters;
      if (emitters === undefined) return;
      for (const key of Object.keys(emitters)) if (retired.has(emitters[key]!)) delete emitters[key];
    },
  };
}
/** Register the actor's one script object and emitter under `actor:<id>`. */
export function registerActorObject(
  vm: VmState,
  events: EventsSection,
  actors: ActorsSection,
  actor: ActorId | number,
): ObjectRecord | null {
  const id = actorId(actor);
  if (getActor(actors, id) === null) return null;
  const key = actorEmitterKey(id);
  const existingHandle = events.emitters?.[key];
  const existing = existingHandle === undefined ? undefined : vm.objects.find((record) => record.handle === existingHandle);
  return registerEmitter(vm, events, key, existing ?? createHostObject(vm, "actor"));
}

/** Register all currently-owned actors before their first event can be queued. */
export function registerActorObjects(vm: VmState, events: EventsSection, actors: ActorsSection): void {
  for (const actor of actors.actors) registerActorObject(vm, events, actors, actor.id);
}

/** Queue one committed actor transition on the actor's emitter in result order. */
export function queueActorTransition(vm: VmState, events: EventsSection, actors: ActorsSection, transition: ActorTransition): void {
  const actor = getActor(actors, transition.actorId);
  if (actor === null) return;
  registerActorObject(vm, events, actors, actor.id);
  switch (transition.type) {
    case "fallen":
    case "revived":
      {
        const detail = { cause: transition.cause, source: transition.source };
        queueNativeEvent(vm, events, actorEmitterKey(actor.id), transition.type, detail);
      }
      return;
    case "statusChanged":
      queueNativeEvent(vm, events, actorEmitterKey(actor.id), transition.type, {
        status: transition.status,
        // Script member names are folded; readEvent exposes the specified previousRounds spelling.
        previousrounds: transition.previousRounds,
        rounds: transition.rounds,
        expired: transition.expired,
        source: transition.source,
      });
      return;
    case "leveledUp":
      queueNativeEvent(vm, events, actorEmitterKey(actor.id), transition.type, {
        level: transition.level,
        experience: transition.experience,
        applied: transition.applied,
      });
      return;
  }
}

/** Publish all transitions from one actor owner operation through the shared queued bus. */
export function queueActorTransitions(vm: VmState, events: EventsSection, actors: ActorsSection, result: ActorRuleResult): void {
  for (const transition of result.transitions) queueActorTransition(vm, events, actors, transition);
}

/** Build the actor-owner publisher used by script services and host aliases. */
export function createActorEventSink(vm: VmState, events: EventsSection, actors: ActorsSection): ActorEventSink {
  registerActorObjects(vm, events, actors);
  const sink: ActorEventSink = Object.assign(
    (result: ActorRuleResult): void => queueActorTransitions(vm, events, actors, result),
    { stage: () => stageActorEvents(vm, events) },
  );
  return sink;
}

import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  createGameState,
  createInputSection,
  CATALOGUE_PLUGIN,
  CORE_PLUGIN,
  UI_PLUGIN,
  createScriptServices as coreCreateScriptServices,
  runThreadsPhase,
  runWaitsPhase,
  startProgram,
  type GameState,
  type PluginDefinition,
  type ScriptServices,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

type Event = Parameters<typeof applyInputEvent>[1];

function makeState(): GameState {
  const state = createGameState({ seed: 1 });
  state.input = createInputSection({ bindings: { keys: { Enter: "confirm" } } });
  return state;
}

/** One engine-shaped tick for the input waits: input events, then the waits phase with a real claim, then threads. */
function step(state: GameState, services: ScriptServices, events: Event[] = []): void {
  for (const event of events) applyInputEvent(state.input, event);
  runWaitsPhase(
    state.vm,
    { tick: state.time.tick, input: state.input, claims: [], events: state.events },
    undefined,
    (seq) => { if (seq !== undefined) state.input.keys = state.input.keys.filter((key) => key.seq !== seq); },
    services,
  );
  runThreadsPhase(state.vm, services, 100);
  state.time.tick += 1;
}

const press = (x: number, y: number): Event => ({ kind: "pointer", x, y, buttons: 1 });
const release = (x: number, y: number): Event => ({ kind: "pointer", x, y, buttons: 0 });
const enter = (down: boolean): Event => ({ kind: "key", name: "Enter", code: "Enter", char: null, down });

test("waitInput hands a script the press and release that arrived together, then waits again", () => {
  const state = makeState();
  const program = [
    "first = waitinput()",
    "k1 = first.kind",
    "d1 = first.newdowns",
    "u1 = first.newups",
    "x1 = first.downx",
    "b1 = first.button",
    "second = waitinput(first)",
    "k2 = second.kind",
    "m2 = second.moved",
    "end()",
  ].join("\n");
  const thread = startProgram(state.vm, { kind: "inline", ir: "1", text: program });
  const services = createScriptServices(state);
  runThreadsPhase(state.vm, services, 100);
  equal(thread.wait?.kind, "input.key", "waitInput parks as a global input wait, so a menu keeps owning input");
  step(state, services);
  equal(thread.status, "waiting", "a stationary pointer wakes nothing");
  // A stalled host stamps the press and the release to one tick; both edges survive.
  step(state, services, [press(40, 50), release(44, 52)]);
  deepEqual(
    ["k1", "d1", "u1", "x1", "b1"].map((name) => state.vm.globals[name]),
    ["pointer", 1, 1, 40, 1],
  );
  equal(thread.status, "waiting");
  step(state, services);
  step(state, services);
  equal(thread.status, "waiting", "the second wait baselines on the first result and sees nothing new");
  step(state, services, [{ kind: "pointer", x: 60, y: 70, buttons: 0 }]);
  deepEqual([state.vm.globals.k2, state.vm.globals.m2], ["pointer", 1]);
  equal(thread.status, "finished");
});

test("waitInput delivers a key first and reports the pointer change that came with it on the next call", () => {
  const state = makeState();
  const program = "first = waitinput()\nk1 = first.kind\nn1 = first.key\nsecond = waitinput(first)\nk2 = second.kind\nd2 = second.newdowns\nend()";
  const thread = startProgram(state.vm, { kind: "inline", ir: "1", text: program });
  const services = createScriptServices(state);
  runThreadsPhase(state.vm, services, 100);
  step(state, services, [press(9, 9), enter(true)]);
  deepEqual([state.vm.globals.k1, state.vm.globals.n1], ["key", "confirm"], "a key wins the same-tick tie");
  step(state, services);
  deepEqual([state.vm.globals.k2, state.vm.globals.d2], ["pointer", 1], "the pointer press was not lost behind the key");
  equal(thread.status, "finished");
});

test("legacy wait() and get() never wake for the pointer", () => {
  const state = makeState();
  const thread = startProgram(state.vm, { kind: "inline", ir: "1", text: "wait()\nend()" });
  const services = createScriptServices(state);
  runThreadsPhase(state.vm, services, 100);
  step(state, services, [press(1, 1), release(1, 1)]);
  equal(thread.status, "waiting");
});

function nativeProvider(): PluginDefinition {
  const park = (state: unknown) => ({ kind: "wait" as const, state: state as never, wait: { kind: "menu.screen" as const, global: true, id: "test-menu", payload: [], resumeRefs: [] } });
  return {
    id: "test-menu", version: "1.0.0", commands: [],
    menuProviders: {
      main: (input) => {
        const event = input.event;
        const log = (input.state as { log: unknown[] } | null)?.log ?? [];
        if (event.type === "enter") return park({ log: [] });
        if (event.type === "pointer") return park({ log: [...log, [event.moved, event.newDowns, event.newUps, event.x, event.downX]] });
        if (event.type === "input") return park({ log: [...log, ["key", event.key]] });
        return { kind: "complete" as const };
      },
    },
  };
}

test("a native menu provider receives the pointer as its own event and keeps a pointer change that arrived with a key", () => {
  const state = makeState();
  const thread = startProgram(state.vm, { kind: "inline", ir: "1", text: "mainmenu()\nend()" });
  const services = coreCreateScriptServices(state, [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeProvider() }]);
  runThreadsPhase(state.vm, services, 100);
  equal(thread.wait?.kind, "menu.screen");
  const log = (): unknown[] => ((thread.wait?.kind === "menu.screen" ? thread.wait.payload[0] : null) as { state: { log: unknown[] } }).state.log;
  step(state, services);
  step(state, services, [press(30, 40), release(34, 40)]);
  deepEqual(log(), [[1, 1, 1, 34, 30]], "one pointer event carries the move and both edges");
  step(state, services);
  equal(log().length, 1, "nothing new, nothing delivered");
  step(state, services, [press(5, 6), enter(true)]);
  deepEqual(log().at(-1), ["key", "confirm"], "the key wins the tie");
  step(state, services);
  deepEqual(log().at(-1), [1, 1, 0, 5, 5], "the press that arrived with the key is delivered next");
  ok(thread.status === "waiting");
});

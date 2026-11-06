// Threads and waits (ticket 3.9; E-93, THR-1..THR-3, R-32, AD-5, AD-9): the thread
// lifecycle, sleep and wake with THR-1's tick formula, queued `tellThread` with
// per-thread source/target, the global block of a blocking command, request
// replies and tick timeouts, `multiRun`, the step budget, deadlock reporting,
// and snapshot/replay identity.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  applyInputEvent,
  advanceScriptTick,
  canon,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  IR_VERSION,
  createGameState,
  createVmState,
  createWaitPoll,
  endBoardThreads,
  endItemThreads,
  hashState,
  killThread,
  pollMovement,
  replyToRequest,
  restoreGameState,
  runThreadsPhase,
  runWaitsPhase,
  secondsToTicks,
  snapshot,
  startProgram,
  startThread,
  STEP_BUDGET,
  stepThread,
  WAIT_KIND_RESOLVERS,
  type BuiltinSpec,
  type GameState,
  type PluginDefinition,
  type ProgramRef,
  type ScriptError,
  type Wait,
  type WaitResult,
  type WaitView,
} from "../src/index.ts";
import { actorFromSource } from "../src/sprites/model.ts";
import { createScriptServices } from "./script-test-services.ts";

function ref(text: string): ProgramRef {
  return { kind: "inline", text, ir: IR_VERSION };
}

/** What the test plugin's commands saw: `mark` calls, request continuations. */
type Log = {
  marks: Array<[number, number]>;
  continuations: Array<Array<unknown>>;
};

function param(name: string, variadic = false) {
  return { name, optional: false, byRef: false, variadic };
}

/**
 * The test doubles: `mark(n)` records the tick it ran at; `move(sprite, ticks)`
 * stands in for the movement owner's command (it reports the `move` control
 * effect); `ask`/`ask2` make a request with and without a continuation;
 * `askdone` is the named continuation.
 */
function makePlugin(log: Log): PluginDefinition {
  const mark: BuiltinSpec = {
    name: "mark",
    aliases: [],
    params: [param("n")],
    call: (view, args) => {
      log.marks.push([view.clock.tick(), args[0]!.value as number]);
      return { value: null };
    },
  };
  const move: BuiltinSpec = {
    name: "move",
    aliases: [],
    params: [param("sprite"), param("ticks")],
    call: (_view, args) => ({
      value: null,
      effects: [{ kind: "vm.control", args: ["move", args[0]!.value as string, args[1]!.value as number] }],
    }),
  };
  const ask: BuiltinSpec = {
    name: "ask",
    aliases: [],
    params: [],
    call: () => ({
      value: null,
      request: { kind: "asset", name: "a" },
      then: { command: "askdone", args: ["tail"] },
      timeoutTicks: 10,
    }),
  };
  const ask2: BuiltinSpec = {
    name: "ask2",
    aliases: [],
    params: [],
    call: () => ({ value: null, request: { kind: "asset", name: "b" } }),
  };
  const askdone: BuiltinSpec = {
    name: "askdone",
    aliases: [],
    params: [param("rest", true)],
    call: (_view, args) => {
      log.continuations.push(args.map((arg) => arg.value));
      return { value: args[1]?.value ?? null };
    },
  };
  return { id: "test.threads", version: "1.0.0", commands: [mark, move, ask, ask2, askdone] };
}

function setup(program: string): { state: GameState; log: Log; plugins: PluginDefinition[] } {
  const log: Log = { marks: [], continuations: [] };
  const plugins = [makePlugin(log)];
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, ref(program));
  return { state, log, plugins };
}

function runTicks(state: GameState, plugins: PluginDefinition[], ticks: number, budget?: number): string[] {
  const services = createScriptServices(state, plugins);
  const hashes: string[] = [];
  for (let index = 0; index < ticks; index += 1) {
    advanceScriptTick(state, services, budget);
    hashes.push(hashState(state));
  }
  return hashes;
}

function errorOf(run: () => unknown): ScriptError {
  try {
    run();
  } catch (error) {
    equal(typeof (error as ScriptError).code, "string");
    return error as ScriptError;
  }
  throw new Error("expected the call to throw");
}

test("THR-1: seconds convert with max(1, floor(seconds * 60 + 0.5)); zero is indefinite", () => {
  equal(secondsToTicks(1), 60);
  equal(secondsToTicks(0.5), 30);
  equal(secondsToTicks(0.05), 3);
  equal(secondsToTicks(0.001), 1); // a small positive sleep never aliases the indefinite sleep
  equal(secondsToTicks(0.0084), 1);
  equal(secondsToTicks(0), 0);
  equal(secondsToTicks(-0), 0);
  equal(secondsToTicks(-1), null);
  equal(secondsToTicks(Number.NaN), null);
  equal(secondsToTicks(Number.POSITIVE_INFINITY), null);
  equal(secondsToTicks(9007199254740992), null); // over 2^53 - 1 ticks
});

test("lifecycle: kinds, owners, source/target, ids and cleanup", () => {
  const vm = createVmState();
  const main = startProgram(vm, ref("end()"));
  const board = startThread(vm, { ref: ref("end()"), kind: "board", owner: "script" });
  const persistent = startThread(vm, { ref: ref("end()"), kind: "persistent", owner: "script" });
  const item = startThread(vm, {
    ref: ref("end()"),
    kind: "item",
    owner: "world",
    source: "itemA",
    target: "itemA",
  });

  deepEqual([main.id, board.id, persistent.id, item.id], [1, 2, 3, 4]);
  equal(main.source, null);
  equal(main.target, null);
  equal(item.source, "itemA");
  equal(item.target, "itemA");
  equal(item.owner, "world");

  equal(errorOf(() => startProgram(vm, ref("end()"))).code, "thread.blocking-exists");
  equal(
    errorOf(() => startThread(vm, { ref: ref("end()"), kind: "item", owner: "script" })).code,
    "thread.bad-owner",
  );
  equal(
    errorOf(() => startThread(createVmState(), { ref: ref("end()"), kind: "blocking", owner: "world" })).code,
    "thread.bad-owner",
  );

  // A finished thread stays registered until it is killed or its board or item goes.
  board.status = "finished";
  equal(vm.threads.length, 4);
  endItemThreads(vm, "itemB");
  equal(vm.threads.length, 4);
  endBoardThreads(vm);
  deepEqual(vm.threads.map((thread) => thread.id), [1, 3, 4]);
  endItemThreads(vm, "itemA");
  deepEqual(vm.threads.map((thread) => thread.id), [1, 3]);
  equal(killThread(vm, 99), false);
  equal(killThread(vm, 3), true);
  deepEqual(vm.threads.map((thread) => thread.id), [1]);
});

test("thread() starts a board or persistent thread, returns the id and stays registered when finished", () => {
  const { state, log, plugins } = setup('t = thread("mark(5)", 1)\nu = thread("mark(6)", 0)\nend()\n');
  runTicks(state, plugins, 3);

  equal(state.vm.globals.t, 2);
  equal(state.vm.globals.u, 3);
  deepEqual(
    state.vm.threads.map((thread) => [thread.id, thread.kind, thread.owner, thread.status]),
    [
      [1, "blocking", "script", "finished"],
      [2, "persistent", "script", "finished"],
      [3, "board", "script", "finished"],
    ],
  );
  // The new threads take their first turn on the tick after they were started.
  deepEqual(log.marks, [
    [1, 5],
    [1, 6],
  ]);
});

test("killThread removes a thread, including the caller, and refuses an unknown id", () => {
  const { state, plugins } = setup("killthread(2)\nkillthread(getthreadid())\nend()\n");
  startThread(state.vm, { ref: ref("end()"), kind: "board", owner: "script" });
  runTicks(state, plugins, 1);
  deepEqual(state.vm.threads, []);

  const missing = setup("killthread(99)\n");
  const error = errorOf(() => runTicks(missing.state, missing.plugins, 1));
  equal(error.code, "thread.unknown");
  equal(error.pos !== null, true);
});

test("threadSleep wakes threads on the due tick in ascending id order", () => {
  const { state, log, plugins } = setup(
    'a = thread("mark(2)", 0)\nb = thread("mark(3)", 0)\nthreadsleep(b, 0.05)\nthreadsleep(a, 0.05)\nend()\n',
  );
  runTicks(state, plugins, 1);
  deepEqual(
    state.vm.threads.slice(1).map((thread) => thread.wait),
    [
      { kind: "sleep", global: false, until: 3, resumesCall: false },
      { kind: "sleep", global: false, until: 3, resumesCall: false },
    ],
  );

  runTicks(state, plugins, 2);
  deepEqual(log.marks, []);
  runTicks(state, plugins, 1);
  // Woken in the waits phase of tick 3 and run in that tick's threads phase, 2 before 3.
  deepEqual(log.marks, [
    [3, 2],
    [3, 3],
  ]);
});

test("an indefinite sleep ends only on threadWake, and a woken thread runs on the next tick", () => {
  const { state, log, plugins } = setup("threadsleep(getthreadid(), 0.05)\nthreadwake(2)\nend()\n");
  startThread(state.vm, {
    ref: ref("threadsleep(getthreadid(), 0)\nmark(9)\n"),
    kind: "board",
    owner: "script",
  });

  runTicks(state, plugins, 1);
  deepEqual(state.vm.threads[0]!.wait, { kind: "sleep", global: false, until: 3, resumesCall: true });
  deepEqual(state.vm.threads[1]!.wait, { kind: "sleep", global: false, until: null, resumesCall: true });

  runTicks(state, plugins, 10);
  deepEqual(log.marks, [[4, 9]]);
});

test("threadSleepRemaining reports (end - now) / 60, and 0 for an indefinite sleep", () => {
  const { state, plugins } = setup(
    "threadsleep(2, 1)\nthreadsleepremaining(2, r)\nthreadsleep(2, 0)\nthreadsleepremaining(2, q)\nthreadwake(2)\nend()\n",
  );
  startThread(state.vm, { ref: ref("x = 1\n"), kind: "board", owner: "script" });
  runTicks(state, plugins, 1);

  equal(state.vm.globals.r, 1);
  equal(state.vm.globals.q, 0);
  equal(state.vm.threads[1]!.status, "finished");
});

test("an invalid duration or id is a located error and no wait is entered", () => {
  for (const program of [
    "threadsleep(1, 0-1)\n",
    "threadsleep(1, 1/0)\n",
    "threadsleep(1, 0/0)\n",
    "threadsleep(1, 9007199254740992)\n",
  ]) {
    const { state, plugins } = setup(program);
    runTicks(state, plugins, 1);
    equal(state.vm.threads[0]!.wait, null, program);
    equal(state.vm.threads[0]!.status, "finished", program);
  }
  const unknown = setup("threadsleep(99, 1)\n");
  equal(errorOf(() => runTicks(unknown.state, unknown.plugins, 1)).code, "thread.unknown");
});

test("tellThread queues code for the target's next turn, with the target's source/target and budget", () => {
  const { state, plugins } = setup(
    'callerSrc = sourcehandle()\ntellthread(2, "src = sourcehandle()")\ntellthread(2, "tgt = targethandle()")\nend()\n',
  );
  const target = startThread(state.vm, {
    ref: ref("x = 1\nend()\n"),
    kind: "item",
    owner: "world",
    source: "npc",
    target: "pc",
  });
  const services = createScriptServices(state, plugins);
  const main = state.vm.threads[0]!;

  // The caller runs to its end without being interrupted; the code is only queued.
  stepThread(main, state.vm, services, 100);
  equal(main.status, "finished");
  equal(state.vm.globals.callersrc, 0);
  deepEqual(
    target.queue.map((queued) => queued.text),
    ["src = sourcehandle()", "tgt = targethandle()"],
  );
  equal(state.vm.globals.src, undefined);

  // The queued code spends the target's own budget.
  equal(stepThread(target, state.vm, services, 4), 4);
  equal(target.status, "ready");

  stepThread(target, state.vm, services, 1000);
  equal(state.vm.globals.src, "npc");
  equal(state.vm.globals.tgt, "pc");
  equal(state.vm.globals.x, 1);
  equal(target.status, "finished");
  deepEqual(target.queue, []);
  deepEqual(target.detached, []);
});

test("R-32: a blocking command freezes every other thread until it ends", () => {
  const { state, log, plugins } = setup("sleep(5)\nmark(1)\nend()\n");
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "script" });
  const cooperative = startThread(state.vm, { ref: ref("mark(3)\n"), kind: "board", owner: "script" });
  cooperative.status = "waiting";
  cooperative.wait = { kind: "sleep", global: false, until: 2, resumesCall: false };

  runTicks(state, plugins, 1);
  deepEqual(state.vm.block, { thread: 1, kind: "sleep", since: 0 });
  runTicks(state, plugins, 4);
  // Ticks 1 to 4: nothing ran, not even the thread whose own sleep ended at tick 2.
  deepEqual(log.marks, []);
  equal(state.vm.block !== null, true);

  runTicks(state, plugins, 1);
  deepEqual(log.marks, [
    [5, 1],
    [5, 2],
    [5, 3],
  ]);
  equal(state.vm.block, null);
});

test("#1167: a live blocking program owns the threads phase; an older background thread does not step first", () => {
  const log: Log = { marks: [], continuations: [] };
  const plugins = [makePlugin(log)];
  const state = createGameState({ seed: 0 });
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "world" }); // id 1, ready before the blocker
  startProgram(state.vm, ref("sleep(5)\nmark(1)\nend()\n")); // id 2, the blocking program

  runTicks(state, plugins, 1);
  equal(state.vm.block?.kind, "sleep"); // the blocking program parked
  deepEqual(log.marks, []); // the older board thread took no step

  runTicks(state, plugins, 4);
  deepEqual(log.marks, []); // ticks 1-4: the world stays frozen

  runTicks(state, plugins, 1); // tick 5: the sleep wakes, the blocker resumes and ends
  deepEqual(log.marks, [
    [5, 1],
    [5, 2],
  ]); // control returns: the blocker ran first in the phase it ended in, then the board thread
  equal(state.vm.block, null);
});

test("#1167: a newer background thread does not step while the blocking program is live either", () => {
  const { state, log, plugins } = setup("sleep(5)\nmark(1)\nend()\n"); // blocker id 1
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "world" }); // id 2

  runTicks(state, plugins, 1);
  equal(state.vm.block?.kind, "sleep");
  deepEqual(log.marks, []);

  runTicks(state, plugins, 5);
  deepEqual(log.marks, [
    [5, 1],
    [5, 2],
  ]);
});

test("#1167: a nested function call inside the blocking program keeps the blocking ownership", () => {
  const log: Log = { marks: [], continuations: [] };
  const plugins = [makePlugin(log)];
  const state = createGameState({ seed: 0 });
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "world" }); // id 1
  startProgram(state.vm, ref("helper()\nsleep(5)\nmark(3)\nend()\nfunction helper() {\n  mark(1)\n}\n")); // id 2

  runTicks(state, plugins, 1);
  deepEqual(log.marks, [[0, 1]]); // the nested call ran inside the blocking program
  equal(state.vm.block?.kind, "sleep");

  runTicks(state, plugins, 5);
  deepEqual(log.marks, [
    [0, 1],
    [5, 3], // the blocking program finished inside the phase...
    [5, 2], // ...and only then did the background thread take its turn
  ]);
});

test("#1167: resumption from a wait runs the blocking thread before older background threads", () => {
  const log: Log = { marks: [], continuations: [] };
  const plugins = [makePlugin(log)];
  const state = createGameState({ seed: 0 });
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "world" }); // id 1
  startProgram(state.vm, ref("sleep(2)\nmark(1)\nend()\n")); // id 2

  runTicks(state, plugins, 3); // tick 2: the sleep wakes and the threads phase runs the blocker first
  deepEqual(log.marks, [
    [2, 1],
    [2, 2],
  ]);
});

test("#1167: a blocking thread parked in a non-global wait does not hold up the world", () => {
  const log: Log = { marks: [], continuations: [] };
  const hold: BuiltinSpec = {
    name: "hold",
    aliases: [],
    params: [param("ticks")],
    call: (view, args) => ({
      value: null,
      wait: { kind: "test.hold", global: false, until: view.clock.tick() + Number(args[0]!.value) } as unknown as Wait,
    }),
  };
  const holdPoll = (view: WaitView, wait: Wait): WaitResult | null =>
    view.tick >= (wait as Wait & { until: number }).until ? { value: null, ok: true } : null;
  const plugins = [makePlugin(log), { id: "test.hold", version: "1.0.0", commands: [hold] } as PluginDefinition];
  const poll = createWaitPoll([...WAIT_KIND_RESOLVERS, { kind: "test.hold", poll: holdPoll }]);
  const state = createGameState({ seed: 0 });
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "world" }); // id 1
  startProgram(state.vm, ref("hold(2)\nmark(1)\nend()\n")); // id 2
  const services = createScriptServices(state, plugins);

  for (let tick = 0; tick < 3; tick += 1) advanceScriptTick(state, services, undefined, poll);
  deepEqual(log.marks, [
    [0, 2], // the board thread ran in tick 0 while the blocker held a non-global wait
    [2, 1], // the blocker resumed in tick 2 and was not blocked behind the board thread
  ]);
});

test("a request waits globally; its reply runs the continuation with the reply prepended", () => {
  const { state, log, plugins } = setup("r = ask()\nmark(2)\nend()\n");
  startThread(state.vm, { ref: ref("mark(3)\n"), kind: "board", owner: "script" });

  runTicks(state, plugins, 3);
  equal(state.vm.requestSeq, 1);
  deepEqual(state.vm.effects[0]!.request, { kind: "asset", name: "a", reqId: 1 });
  equal(state.vm.effects[0]!.kind, "request");
  deepEqual(log.marks, []); // R-32: the world stands still until the reply
  equal(state.vm.block?.kind, "request");

  replyToRequest(state.vm, 1, { ok: true, value: 42 });
  // The logged effect is a copy: the stored reply does not leak into it.
  equal((state.vm.effects[0]!.wait as Wait & { reply: unknown }).reply, null);
  runTicks(state, plugins, 1);

  deepEqual(log.continuations, [[1, 42, "tail"]]);
  equal(state.vm.globals.r, 42);
  deepEqual(log.marks, [
    [3, 2],
    [3, 3],
  ]);
});

test("a failure reply prepends 0 and records a located diagnostic", () => {
  const { state, log, plugins } = setup("\nr = ask()\nend()\n");
  runTicks(state, plugins, 1);
  replyToRequest(state.vm, 1, { ok: false, value: "boom" });
  runTicks(state, plugins, 1);

  deepEqual(log.continuations, [[0, "boom", "tail"]]);
  const diagnostic = state.vm.effects.find((effect) => effect.kind === "diagnostic");
  deepEqual(diagnostic?.args, ["request.failed", "<inline>", 2, "boom"]);
});

test("a request without a continuation resumes the call with the reply, or 0 on failure", () => {
  const good = setup("r = ask2()\nend()\n");
  runTicks(good.state, good.plugins, 1);
  replyToRequest(good.state.vm, 1, { ok: true, value: 7 });
  runTicks(good.state, good.plugins, 1);
  equal(good.state.vm.globals.r, 7);

  const bad = setup("r = ask2()\nend()\n");
  runTicks(bad.state, bad.plugins, 1);
  replyToRequest(bad.state.vm, 1, { ok: false, value: "no" });
  runTicks(bad.state, bad.plugins, 1);
  equal(bad.state.vm.globals.r, 0);
  equal(bad.state.vm.effects.some((effect) => effect.kind === "diagnostic"), true);
});

test("a request that outlasts its tick timeout resumes with an error result and a diagnostic", () => {
  const { state, log, plugins } = setup("r = ask()\nend()\n");
  runTicks(state, plugins, 10);
  deepEqual(log.continuations, []);
  equal((state.vm.threads[0]!.wait as Wait & { deadline: number }).deadline, 10);

  runTicks(state, plugins, 1); // the waits phase of tick 10
  deepEqual(log.continuations, [[0, "the request timed out", "tail"]]);
  const diagnostic = state.vm.effects.find((effect) => effect.kind === "diagnostic");
  deepEqual(diagnostic?.args, ["request.failed", "<inline>", 1, "the request timed out"]);
});

test("replies for an unknown or already-answered request are refused", () => {
  const { state, plugins } = setup("r = ask2()\nend()\n");
  runTicks(state, plugins, 1);
  equal(errorOf(() => replyToRequest(state.vm, 9, { ok: true, value: 0 })).code, "request.unknown");
  replyToRequest(state.vm, 1, { ok: true, value: 0 });
  equal(errorOf(() => replyToRequest(state.vm, 1, { ok: true, value: 0 })).code, "request.duplicate-reply");
});

test("multiRun collects several moves into one movement wait; the block lifts when the last ends", () => {
  const { state, log, plugins } = setup(
    'multirun()\nmove("a", 3)\nmove("b", 5)\nmultirun()\nmark(1)\nend()\n',
  );
  startThread(state.vm, { ref: ref("mark(2)\n"), kind: "board", owner: "script" });

  runTicks(state, plugins, 1);
  deepEqual(state.vm.threads[0]!.wait, {
    kind: "movement",
    global: true,
    moves: [
      { sprite: "a", until: 3 },
      { sprite: "b", until: 5 },
    ],
  });
  equal(state.vm.block?.kind, "movement");
  runTicks(state, plugins, 4);
  deepEqual(log.marks, []);
  runTicks(state, plugins, 1);
  deepEqual(log.marks, [
    [5, 1],
    [5, 2],
  ]);
});

test("standalone scheduler waits for a live sprite's queued movement (#1313)", () => {
  const { state, log, plugins } = setup("mark(1)\nend()\n");
  const player = actorFromSource({ id: "hero", kind: "player", source: "hero.tem", x: 48, y: 64, layer: 1 }, null, 0, null);
  player.queue.moves.push({ source: "direction", target: { x: 80, y: 64 }, facing: "E" });
  state.sprites.players = [player];
  const thread = state.vm.threads[0]!;
  thread.wait = { kind: "sprite.movement", actor: player.id, global: true };
  thread.status = "waiting";
  const services = createScriptServices(state, plugins);
  advanceScriptTick(state, services);
  deepEqual(log.marks, []);
  equal(thread.status, "waiting");
  player.queue.moves.length = 0;
  advanceScriptTick(state, services);
  deepEqual(log.marks.map((mark) => mark[1]), [1]);
});

test("a multiRun live wait keeps a completed actor's milestone while another actor moves (#1317)", () => {
  const { state, log, plugins } = setup("mark(1)\nend()\n");
  const done = { ...actorFromSource({ id: "done", kind: "item", source: "done.itm", x: 64, y: 64, layer: 1 }, null, 0, 0), queue: { moves: [], waypoint: null } };
  const moving = actorFromSource({ id: "moving", kind: "item", source: "moving.itm", x: 64, y: 96, layer: 1 }, null, 1, 1);
  moving.queue.moves.push({ source: "direction", target: { x: 96, y: 96 }, facing: "E" });
  state.sprites.items = [done, moving];
  const thread = state.vm.threads[0]!;
  thread.wait = { kind: "movement", global: true, moves: [{ sprite: "done", until: 0, actual: true }, { sprite: "moving", until: 0, actual: true }] };
  thread.status = "waiting";
  const services = createScriptServices(state, plugins);
  advanceScriptTick(state, services);
  equal(thread.status, "waiting");
  if (thread.wait?.kind !== "movement") throw new Error("expected the live movement wait");
  deepEqual(thread.wait.moves.map((move) => move.sprite), ["moving"], "the completed actor's milestone survives the other actor's movement");
  const saved = snapshot(state);
  equal(snapshot(restoreGameState(saved)), saved, "a partially completed live collection remains saveable");
  state.sprites.items = state.sprites.items.map((item) => item.id === "moving" ? { ...item, queue: { moves: [], waypoint: null } } : item);
  advanceScriptTick(state, services);
  deepEqual(log.marks.map((mark) => mark[1]), [1]);
});

test("multiRun with no moves does not wait, and a lone move waits for its own end", () => {
  const empty = setup("multirun()\nmultirun()\nmark(1)\nend()\n");
  runTicks(empty.state, empty.plugins, 1);
  deepEqual(empty.log.marks, [[0, 1]]);

  const lone = setup('move("a", 2)\nmark(1)\nend()\n');
  runTicks(lone.state, lone.plugins, 2);
  deepEqual(lone.log.marks, []);
  runTicks(lone.state, lone.plugins, 1);
  deepEqual(lone.log.marks, [[2, 1]]);
});

test("registering a wait kind twice fails, and an unregistered kind fails loudly", () => {
  equal(
    errorOf(() => createWaitPoll([...WAIT_KIND_RESOLVERS, { kind: "movement", poll: pollMovement }])).code,
    "wait.duplicate-kind",
  );

  const vm = createVmState();
  const thread = startProgram(vm, ref("end()"));
  thread.status = "waiting";
  thread.wait = { kind: "custom.unregistered", global: false } as unknown as Wait;
  equal(errorOf(() => runWaitsPhase(vm, { tick: 0 })).code, "wait.unknown-kind");
});

test("budget: exactly the budget of VM steps per thread per tick, resumed next tick", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, ref("x = 1\n".repeat(50)));
  startThread(state.vm, { ref: ref("y = 1\n".repeat(50)), kind: "board", owner: "script" });
  const services = createScriptServices(state);

  runThreadsPhase(state.vm, services, 20);
  // R-32 (#1167): a live blocking thread owns the phase; the background thread waits for it to finish.
  deepEqual(state.vm.threads.map((thread) => thread.frames[0]!.ip), [20, 0]);
  runThreadsPhase(state.vm, services, 20);
  deepEqual(state.vm.threads.map((thread) => thread.frames[0]!.ip), [40, 0]);

  equal(errorOf(() => runThreadsPhase(state.vm, services, 0)).code, "vm.bad-budget");
  equal(errorOf(() => runThreadsPhase(state.vm, services, 1.5)).code, "vm.bad-budget");
});

test("budget: a never-yielding loop is preempted at STEP_BUDGET, not failed, and resumes", () => {
  equal(STEP_BUDGET, 1000);
  const state = createGameState({ seed: 0 });
  const main = startProgram(state.vm, ref("while (1) {\nn = n + 1\n}\n"));
  const services = createScriptServices(state);

  for (let turn = 0; turn < 3; turn += 1) {
    equal(stepThread(main, state.vm, services, STEP_BUDGET), STEP_BUDGET);
    equal(main.status, "ready");
  }
  const before = state.vm.globals.n as number;
  advanceScriptTick(state, services);
  equal((state.vm.globals.n as number) > before, true);
});

test("deadlock: two mutually parked threads fail the tick, naming both ids and waits", () => {
  const { state, plugins } = setup("threadsleep(2, 0)\nthreadsleep(getthreadid(), 0)\n");
  startThread(state.vm, { ref: ref("threadsleep(getthreadid(), 0)\n"), kind: "board", owner: "script" });

  const error = errorOf(() => runTicks(state, plugins, 1));
  equal(error.code, "vm.deadlock");
  equal(error.message.includes("thread 1"), true);
  equal(error.message.includes("thread 2"), true);
  equal(error.message.includes("sleep(indefinite)"), true);
  equal(error.pos !== null, true);
});

test("no deadlock while a timed sleep, a request or a key wait can still end", () => {
  const timed = setup("threadsleep(getthreadid(), 1)\n");
  runTicks(timed.state, timed.plugins, 5);

  const asking = setup("r = ask2()\n");
  runTicks(asking.state, asking.plugins, 5);

  const key = setup("end()\n");
  key.state.vm.threads[0]!.status = "waiting";
  key.state.vm.threads[0]!.wait = { kind: "input.key", global: true, key: null };
  runTicks(key.state, key.plugins, 5);
  equal(key.state.vm.block?.kind, "input.key");
});
test("input key wait accepts the next key buffered after the thread parks", () => {
  const { state, plugins } = setup("wait(pressed)\nend()\n");
  const services = createScriptServices(state, plugins);
  advanceScriptTick(state, services);
  const wait = state.vm.threads[0]?.wait;
  if (wait?.kind !== "input.key") throw new Error("expected the thread to park on a key wait");
  equal(wait.parkSeq, state.input.nextSeq);
  applyInputEvent(state.input, { kind: "key", name: "A", code: "KeyA", char: "a", down: true });
  advanceScriptTick(state, services);
  equal(state.vm.globals.pressed, "A");
  equal(state.vm.threads[0]?.status, "finished");
});
test("advanceScriptTick shares a host-key wait's backlog discard before any thread can get", () => {
  const { state, plugins } = setup("pressed = wait()\nafter = get()\nend()\n");
  applyInputEvent(state.input, { kind: "key", name: "A", code: "KeyA", char: "a", down: true });
  applyInputEvent(state.input, { kind: "key", name: "B", code: "KeyB", char: "b", down: true });
  const services = createScriptServices(state, plugins);
  advanceScriptTick(state, services);
  const waiting = state.vm.threads[0];
  if (waiting?.wait?.kind !== "input.key") throw new Error("expected wait() to park");
  equal(waiting.wait.parkSeq, state.input.nextSeq);
  deepEqual(state.input.keys.map((key) => key.name), ["A", "B"], "pre-park backlog remains until the wait resolves");
  // Simulate a legacy/manual wait without a persisted floor; the scheduler must backfill before polling.
  delete waiting.wait.parkSeq;
  startThread(state.vm, { ref: ref("other = get()\nend()\n"), kind: "persistent", owner: "script" });

  waiting.wait.key = "C";
  advanceScriptTick(state, services);
  equal(state.vm.globals.pressed, "C", "the host-provided key wakes the waiter");
  equal(state.vm.globals.after, "", "the resumed thread cannot get pre-park keys");
  equal(state.vm.globals.other, "", "the shared backlog is cleared before another thread can get");
  deepEqual(state.input.keys, [], "advanceScriptTick prunes the shared queue");
});

test("snapshot and replay: a mid-sleep and a mid-request restore with identical per-tick hashes", () => {
  const program = "threadsleep(getthreadid(), 0.5)\nx = 1\nr = ask()\nend()\n";
  const first = setup(program);
  startThread(first.state.vm, { ref: ref("while (1) {\nn = n + 1\n}\n"), kind: "board", owner: "script" });
  runTicks(first.state, first.plugins, 10, 50);
  const json = snapshot(first.state);

  const second = setup(program);
  const restored = restoreGameState(json);
  equal(canon(restored), json);

  const live = runTicks(first.state, first.plugins, 25, 50);
  const replay = runTicks(restored, second.plugins, 25, 50);
  deepEqual(replay, live);
  // At tick 30 the sleep ended and the request is pending; deliver the same reply to both.
  replyToRequest(first.state.vm, 1, { ok: true, value: 5 });
  replyToRequest(restored.vm, 1, { ok: true, value: 5 });
  deepEqual(runTicks(restored, second.plugins, 3, 50), runTicks(first.state, first.plugins, 3, 50));
  equal(canon(restored), canon(first.state));
});

test("snapshot and replay preserves a request wait and continuation", () => {
  const first = setup("r = ask()\nend()\n");
  runTicks(first.state, first.plugins, 1);
  const json = snapshot(first.state);
  const restored = restoreGameState(json);
  const second = setup("end()\n");
  equal(canon(restored), json);
  equal(restored.vm.threads[0]!.wait?.kind, "request");

  replyToRequest(first.state.vm, 1, { ok: true, value: 7 });
  replyToRequest(restored.vm, 1, { ok: true, value: 7 });
  deepEqual(
    runTicks(restored, second.plugins, 2, 50),
    runTicks(first.state, first.plugins, 2, 50),
  );
  equal(canon(restored), canon(first.state));
});

test("the thread and wait commands are VM-owned, not catalogue stubs", () => {
  const stubNames = new Set(CATALOGUE_STUBS_PLUGIN.commands.map((command) => command.name));
  const coreNames = new Set(CORE_PLUGIN.commands.map((command) => command.name));
  for (const name of [
    "thread",
    "killthread",
    "getthreadid",
    "threadsleep",
    "threadwake",
    "threadsleepremaining",
    "tellthread",
    "sourcehandle",
    "targethandle",
    "multirun",
  ]) {
    equal(coreNames.has(name), true, `${name} is a core command`);
    equal(stubNames.has(name), false, `${name} is not a stub`);
  }
});

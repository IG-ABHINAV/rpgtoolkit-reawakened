// The VM-backed test host (AD-1; the tracer ticket's acceptance): the tracer
// program end to end through `runLog`, snapshot/restore across every split, and
// the empty Engine contract that keeps the golden job green.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  actorEmitterKey,
  addActor,
  IR_VERSION,
  createHostObject,
  ENGINE_DEFAULT_MANIFEST,
  hashState,
  registerActorObject,
  snapshot,
  STOCK_RPG_PLUGIN,
  type BuiltinSpec,
  type Diagnostic,
  type LogRecord,
  type PluginDefinition,
  type SurfaceId,
} from "@tk-reawakened/core";
import { createNullAudio, createScriptHost, restoreScriptHost, runLog, type Run } from "../src/index.ts";

const TRACER = 'greeting = "hi"\ncount = 2\nsleep(count)\ncount = 3\nend()\n';

function actorBehaviourPlugin(version: string, delta: number): PluginDefinition {
  return {
    id: "test-actors",
    version,
    commands: [],
    behaviourStartup(registerBehaviour) {
      registerBehaviour("test-actors.hero", {
        statsChanged: () => ({ dp: delta }),
      });
    },
  };
}

const ACTOR_BEHAVIOUR_PLUGIN = actorBehaviourPlugin("1.0.0", 42);

const HOST_OBJECT_PLUGIN: PluginDefinition = {
  id: "test-host-objects",
  version: "1.0.0",
  commands: [],
  hostTypes: [{
    name: "test-object",
    methods: { ping: "ping" },
  }],
};

const MISSING_PACKAGE_PROGRAM = "HP! = 5\nend()\n";
function savedActorRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("actors" in parsed)) {
    throw new Error("snapshot has no actors section");
  }
  const actors = parsed.actors;
  if (typeof actors !== "object" || actors === null || Array.isArray(actors) || !("actors" in actors) || !Array.isArray(actors.actors)) {
    throw new Error("snapshot actors section has no actor records");
  }
  const actor = actors.actors[0];
  if (typeof actor !== "object" || actor === null || Array.isArray(actor)) throw new Error("snapshot has no first actor");
  return actor;
}


const ACTOR_STARTUP_CALLS: string[] = [];
const ACTOR_STARTUP_PLUGIN: PluginDefinition = {
  id: "test-startup-actors",
  version: "1.0.0",
  commands: [{
    name: "seedactor",
    aliases: [],
    params: [],
    call: (view) => {
      if (view.state === undefined) return { value: null };
      const actor = addActor(view.state.actors, {
        kind: "party",
        source: "hero.tem",
        behaviour: "test-startup-actors.hero",
        stats: { hp: 10, maxHp: 10, dp: 1 },
      });
      view.state.party.members = [actor.id];
      view.state.party.selected = actor.id;
      return { value: null };
    },
  }],
  behaviourStartup(registerBehaviour) {
    registerBehaviour("test-startup-actors.hero", {
      statsChanged: () => {
        ACTOR_STARTUP_CALLS.push("statsChanged");
        return { dp: 42 };
      },
    });
  },
};

test("selects the TK2 dialect and compatibility manifest entry", () => {
  const host = createScriptHost({
    program: "#score! = 2\n#Mwin(Hello)\n#end\n",
    seed: 0,
    dialect: "tk2",
    manifest: [{ id: "tk2" }],
  });
  host.advance(1, []);
  equal(host.state().vm.globals.score, 2);
  equal(host.state().vm.threads[0]!.status, "finished");
});

test("TK2 #FBranch is an alias of #Branch: jumps without returning to caller and survives mid-run snapshot/restore", () => {
  const program = "#x! = 1\n#FBranch(:target)\n#x! = 99\n:target\n#x! = x + 10\n#sleep(1)\n#x! = x + 100\n#end\n";
  const host = createScriptHost({
    program,
    seed: 0,
    dialect: "tk2",
  });

  host.advance(1, []);
  equal(host.state().vm.globals.x, 11);
  equal(host.state().vm.threads[0]!.status, "waiting");

  const snap = snapshot(host.state());
  const restored = restoreScriptHost(snap, { dialect: "tk2" });

  host.advance(1, []);
  restored.advance(1, []);

  equal(host.state().vm.globals.x, 111);
  equal(restored.state().vm.globals.x, 111);
  equal(host.state().vm.threads[0]!.status, "finished");
  equal(restored.state().vm.threads[0]!.status, "finished");
  equal(hashState(host.state()), hashState(restored.state()));

  const methodProgram = "#Method Worker() {\n  #val! = 20\n  #FBranch(:skip_label)\n  #val! = 888\n  :skip_label\n  #ReturnMethod(val + 5)\n}\n#result! = Worker()\n#end\n";
  const methodHost = createScriptHost({
    program: methodProgram,
    seed: 0,
    dialect: "tk2",
  });
  methodHost.advance(1, []);
  equal(methodHost.state().vm.globals.result, 25);
});

function tracerHost(seed = 0) {
  return createScriptHost({ program: TRACER, seed });
}

test("runs the tracer program to completion across the sleep yield through runLog", () => {
  const host = tracerHost();
  const records = runLog(host, { schema: 1, ticks: 3, log: [] }, 1, createNullAudio());

  equal(records.length, 3);
  deepEqual(
    records.map((record) => record.tick),
    [1, 2, 3],
  );
  equal(host.state().vm.globals.greeting, "hi");
  equal(host.state().vm.globals.count, 3);
  equal(host.state().vm.threads[0]!.status, "finished");
});

test("the mid-run snapshot restores into a fresh host and finishes with the identical state hash", () => {
  const host = tracerHost();
  host.advance(1, []);
  equal(host.state().vm.threads[0]!.status, "waiting");

  const restored = restoreScriptHost(host.snapshot(), {});
  host.advance(2, []);
  restored.advance(2, []);

  equal(restored.stateHash(), host.stateHash());
  equal(restored.state().vm.globals.count, 3);
});

test("every split point from 0 to 3 ticks restores to the identical hash", () => {
  const total = 3;
  for (let split = 0; split <= total; split++) {
    const host = tracerHost();
    host.advance(split, []);
    const restored = restoreScriptHost(host.snapshot(), {});

    for (let step = 0; step < total - split; step++) {
      host.advance(1, []);
      restored.advance(1, []);
      equal(restored.stateHash(), host.stateHash(), `split ${split}, tick ${split + step + 1}`);
    }
    equal(restored.stateHash(), host.stateHash(), `split ${split} final`);
  }
});

test("batch sizes 1, 2 and 3 ticks give identical per-tick state and draw hashes", () => {
  const run: Run = { schema: 1, ticks: 3, log: [] };
  const batch = (n: number) => runLog(tracerHost(), run, n, createNullAudio());

  const byTick = new Map<number, { state: string; draw: string }>();
  for (const record of batch(1)) byTick.set(record.tick, { state: record.state, draw: record.draw });
  for (const n of [2, 3]) {
    for (const record of batch(n)) {
      const seen = byTick.get(record.tick);
      equal(seen !== undefined, true, `tick ${record.tick} appears at n=${n}`);
      deepEqual({ state: record.state, draw: record.draw }, seen);
    }
  }
});

test("the host satisfies the Engine contract with empty requests, diagnostics and cues", () => {
  const report = tracerHost().advance(1, []);
  equal(report.ticksRun, 1);
  equal(report.tickAfter, 1);
  deepEqual(report.consumed, []);
  deepEqual(report.audioCues, []);
  deepEqual(report.requests, []);
  deepEqual(report.diagnostics, []);
  equal(report.loading, false);
  equal(report.paused, null);
  equal(typeof report.stateHash, "string");
});

test("an empty batch changes nothing and maxTicks clamps the advance", () => {
  const host = tracerHost();
  const before = host.stateHash();

  const empty = host.advance(0, []);
  equal(empty.ticksRun, 0);
  equal(empty.tickAfter, 0);
  equal(empty.stateHash, before);

  const clamped = host.advance(5, [], 2);
  equal(clamped.ticksRun, 2);
  equal(clamped.tickAfter, 2);
});

test("drawList is a pure function of state and has no commands", () => {
  const host = tracerHost();
  const before = host.drawList(0);
  deepEqual(before, { tick: 0, width: 320, height: 240, commands: [], marginCommands: [] });

  host.advance(1, []);
  deepEqual(host.drawList(0), host.drawList(1));
  equal(host.drawList(0).tick, 1);
});

test("surfacePixels is null and setBreakpoints changes no state", () => {
  const host = tracerHost();
  equal(host.surfacePixels(0 as SurfaceId, 0), null);

  const before = host.stateHash();
  host.setBreakpoints([{ file: "a.prg", line: 1 }]);
  equal(host.stateHash(), before);
});

test("a fixture built-in drawing through view.rng leaves the draw in state and restores identically", () => {
  const roll: BuiltinSpec = {
    name: "roll",
    aliases: [],
    params: [{ name: "target", optional: false, byRef: true, variadic: false }],
    call: (view) => ({ value: null, out: [[0, view.rng.nextUint32()]] }),
  };
  const plugins: readonly PluginDefinition[] = [
    { id: "test.roll", version: "1.0.0", commands: [roll] },
  ];
  const program = "roll(r)\nend()\n";

  const host = createScriptHost({ program, seed: 5, plugins });
  host.advance(1, []);
  const drawn = host.state().vm.globals.r;
  equal(typeof drawn, "number");

  const restored = restoreScriptHost(host.snapshot(), { plugins });
  equal(restored.state().vm.globals.r, drawn);
  equal(restored.stateHash(), host.stateHash());

  host.advance(1, []);
  restored.advance(1, []);
  equal(restored.stateHash(), host.stateHash());
});

test("registers behaviour-only plugins before a host program runs", () => {
  const host = createScriptHost({
    program: "HP! = 5\nend()\n",
    seed: 0,
    plugins: [ACTOR_BEHAVIOUR_PLUGIN],
  });
  const actor = addActor(host.state().actors, {
    kind: "party",
    source: "hero.tem",
    behaviour: "test-actors.hero",
    stats: { hp: 10, maxHp: 10, dp: 1 },
  });
  host.state().party.members = [actor.id];
  host.state().party.selected = actor.id;

  host.advance(1, []);
  equal(host.state().actors.actors[0]?.stats.hp, 5);
  equal(host.state().actors.actors[0]?.stats.dp, 42);
});

test("restores the host with behaviour hooks attached to the restored actor service", () => {
  const host = createScriptHost({
    program: "HP! = 5\nend()\n",
    seed: 0,
    plugins: [ACTOR_BEHAVIOUR_PLUGIN],
  });
  const actor = addActor(host.state().actors, {
    kind: "party",
    source: "hero.tem",
    behaviour: "test-actors.hero",
    stats: { hp: 10, maxHp: 10, dp: 1 },
  });
  host.state().party.members = [actor.id];
  host.state().party.selected = actor.id;

  const restored = restoreScriptHost(host.snapshot(), { plugins: [ACTOR_BEHAVIOUR_PLUGIN] });
  restored.advance(1, []);
  equal(restored.state().actors.actors[0]?.stats.hp, 5);
  equal(restored.state().actors.actors[0]?.stats.dp, 42);
});
test("restore keeps actor data with core defaults when its package is absent, then uses newer package code", () => {
  const host = createScriptHost({
    program: MISSING_PACKAGE_PROGRAM,
    seed: 0,
    plugins: [ACTOR_BEHAVIOUR_PLUGIN],
  });
  const actor = addActor(host.state().actors, {
    kind: "party",
    source: "hero.tem",
    behaviour: "test-actors.hero",
    stats: { hp: 10, maxHp: 10, dp: 1 },
  });
  host.state().party.members = [actor.id];
  host.state().party.selected = actor.id;
  const saved = host.snapshot();
  const savedActor = savedActorRecord(saved);
  equal(savedActor.behaviour, "test-actors.hero");
  equal(Object.hasOwn(savedActor, "hooks"), false);
  equal(Object.values(savedActor).some((value) => typeof value === "function"), false);

  const withoutPackage = restoreScriptHost(saved, {});
  const missingReport = withoutPackage.advance(1, []);
  equal(withoutPackage.state().actors.actors[0]?.stats.hp, 5);
  equal(withoutPackage.state().actors.actors[0]?.stats.dp, 1);
  equal(missingReport.diagnostics.filter((entry) => entry.code === "behaviour.missing").length, 1);
  equal(missingReport.diagnostics.find((entry) => entry.code === "behaviour.missing")?.file, "<package startup>");
  equal(missingReport.diagnostics.find((entry) => entry.code === "behaviour.missing")?.line, 0);

  const newerPlugin = actorBehaviourPlugin("2.0.0", 99);
  const withNewerPackage = restoreScriptHost(saved, { plugins: [newerPlugin] });
  const newerReport = withNewerPackage.advance(1, []);
  equal(newerReport.diagnostics.some((entry) => entry.code === "behaviour.missing"), false);
  equal(withNewerPackage.state().actors.actors[0]?.stats.hp, 5);
  equal(withNewerPackage.state().actors.actors[0]?.stats.dp, 99);
  equal(withNewerPackage.state().actors.actors[0]?.id, actor.id);
});

test("restore keeps an unknown host type as data until its first method call", () => {
  const host = createScriptHost({
    program: "saved.ping()\nend()\n",
    seed: 0,
    plugins: [HOST_OBJECT_PLUGIN],
  });
  const object = createHostObject(host.state().vm, "test-object");
  host.state().vm.globals.saved = { kind: "object", handle: object.handle, className: object.className };
  const saved = host.snapshot();

  const restored = restoreScriptHost(saved, {});
  equal(restored.state().vm.objects[0]?.hostType, "test-object");
  const report = restored.advance(1, []);
  const failure = report.diagnostics.find((entry) => entry.code === "object.invalid");
  equal(failure?.file, "<inline>");
  equal(failure?.line, 1);
  equal(failure?.message.includes('host type "test-object" is not installed'), true);
});


test("mid-expression yield restores into a fresh host with identical per-tick stateHash", () => {
  const program = "result = 1 + sleep(2) + 3\nend()\n";
  const host = createScriptHost({ program, seed: 0 });

  // Tick 1: runs 1 + sleep(2) -> thread enters waiting with operands [result-ref, 1]
  host.advance(1, []);
  equal(host.state().vm.threads[0]!.status, "waiting");
  equal(host.state().vm.threads[0]!.frames[0]!.operands.length > 0, true);

  // Restore during the wait
  const restored = restoreScriptHost(host.snapshot(), {});
  equal(restored.stateHash(), host.stateHash());

  // Advance tick 2: wait not yet expired (sleep until tick 2)
  host.advance(1, []);
  restored.advance(1, []);
  equal(restored.stateHash(), host.stateHash());

  // Advance tick 3: wakes, evaluates 1 + 0 + 3 -> result is 4
  host.advance(1, []);
  restored.advance(1, []);
  equal(restored.stateHash(), host.stateHash());
  equal(host.state().vm.globals.result, 4);
  equal(restored.state().vm.globals.result, 4);

  equal(host.state().vm.threads[0]!.status, "finished");
  equal(restored.state().vm.threads[0]!.status, "finished");
});

test("restore reruns startup hooks on scratch and actual services", () => {
  ACTOR_STARTUP_CALLS.length = 0;
  const packageStartup = {
    kind: "inline" as const,
    text: "seedactor()\nHP! = 5\nend()\n",
    ir: IR_VERSION,
    dialect: "tk3" as const,
  };
  const host = createScriptHost({
    seed: 0,
    program: "HP! = 6\nend()\n",
    packageStartups: [{ owner: "test-startup-actors", ref: packageStartup }],
    plugins: [ACTOR_STARTUP_PLUGIN],
  });
  equal(ACTOR_STARTUP_CALLS.length, 1);
  equal(host.state().actors.actors[0]?.stats.hp, 5);
  equal(host.state().actors.actors[0]?.stats.dp, 42);
  equal((host.state().vm.stepCounters?.["test-startup-actors"] ?? 0) > 0, true);

  const restored = restoreScriptHost(host.snapshot(), {
    plugins: [ACTOR_STARTUP_PLUGIN],
    packageStartups: [{ owner: "test-startup-actors", ref: packageStartup }],
  });
  restored.advance(1, []);
  equal(ACTOR_STARTUP_CALLS.length, 3);
  equal(restored.state().actors.actors[0]?.stats.hp, 6);
  equal(restored.state().actors.actors[0]?.stats.dp, 42);
  equal((restored.state().vm.stepCounters?.["test-startup-actors"] ?? 0) > 0, true);
});
test("restore preserves a startup RPGCode menu override over the same native provider", () => {
  const nativeEvents: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "test-native-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      main: ({ event }) => {
        nativeEvents.push(event.type);
        return { kind: "complete" };
      },
    },
  };
  const startup = {
    kind: "inline" as const,
    text: 'registerPlugin({ name: "menu-override", commands: {}, menuProviders: { main: (context) => { sleep(1); winner = "rpg" } } })\n',
    ir: IR_VERSION,
    dialect: "tk3" as const,
  };
  const host = createScriptHost({
    seed: 0,
    program: "mainmenu()\nend()\n",
    plugins: [nativeMenu],
    packageStartups: [{ owner: nativeMenu.id, ref: startup }],
  });
  host.advance(1, []);
  equal(host.state().menu.screens.length, 1);
  const restored = restoreScriptHost(host.snapshot(), {
    plugins: [nativeMenu],
    packageStartups: [{ owner: nativeMenu.id, ref: startup }],
  });
  host.advance(1, []);
  restored.advance(1, []);
  equal(host.stateHash(), restored.stateHash());
  equal(restored.state().vm.globals.winner, "rpg");
  deepEqual(nativeEvents, []);
});
test("stock_rpg actor talked delivery survives restore from a queued event exactly once", () => {
  const startup = {
    kind: "inline" as const,
    text: readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../stock/stock_rpg/startup.prg"), "utf8"),
    ir: IR_VERSION,
    dialect: "tk3" as const,
  };
  const probe: PluginDefinition = {
    id: "talked-restore-probe",
    version: "1.0.0",
    commands: [
      {
        name: "queuetalked",
        aliases: [],
        params: [],
        call: () => ({
          value: null,
          effects: [{
            kind: "emit",
            args: ["actor:1", "talked", { actorId: 1, targetId: null, text: "restored dialogue" }],
          }],
        }),
      },
      {
        name: "recordtalked",
        aliases: [],
        params: [{ name: "event", optional: false, byRef: false, variadic: false }],
        call: (view) => {
          if (view.state !== undefined) {
            view.state.vm.globals.talkedCount = Number(view.state.vm.globals.talkedCount ?? 0) + 1;
          }
          return { value: null };
        },
      },
    ],
    listeners: [{ emitter: "actor:*", type: "talked", command: "recordtalked" }],
  };
  const manifest = [...ENGINE_DEFAULT_MANIFEST, { id: "stock_rpg" }, { id: probe.id }];
  const options = {
    manifest,
    plugins: [STOCK_RPG_PLUGIN, probe],
    packageStartups: [{ owner: "stock_rpg", ref: startup }],
  };
  const createPendingHost = () => {
    const pendingHost = createScriptHost({
      ...options,
      seed: 0,
      program: "queueTalked()\nsleep(1)\nend()\n",
    });
    const actor = addActor(pendingHost.state().actors, { kind: "npc", source: "speaker.tem" });
    registerActorObject(pendingHost.state().vm, pendingHost.state().events, pendingHost.state().actors, actor.id);
    return pendingHost;
  };
  const baseline = createPendingHost();
  const host = createPendingHost();
  baseline.advance(1, []);
  host.advance(1, []);
  const queued = host.state().events.queue[0];
  if (queued === undefined) throw new Error("talked event was not queued before the script wait");
  equal(queued.emitter, actorEmitterKey(1));
  deepEqual(host.state().events.nativeDetails?.[String(queued.event)], {
    actorId: 1,
    targetId: null,
    text: "restored dialogue",
  });

  const restored = restoreScriptHost(host.snapshot(), options);
  const countDialogueListeners = (state: ReturnType<typeof host.state>) => state.events.listeners.filter(({ emitter, type }) =>
    emitter === "game" && type === "dialogue.completed"
  ).length;
  equal(countDialogueListeners(host.state()), 1, "the stock package startup listener is registered");
  equal(countDialogueListeners(restored.state()), 1, "restore rebuilds the startup listener without duplication");
  deepEqual(restored.state().events.queue, host.state().events.queue, "restore preserves the pending talked event");

  baseline.advance(5, []);
  restored.advance(5, []);
  equal(restored.state().vm.globals.talkedCount, 1);
  equal(restored.state().events.queue.length, 0);
  equal(restored.stateHash(), baseline.stateHash(), "restored pending delivery matches uninterrupted replay");
  restored.advance(1, []);
  equal(restored.state().vm.globals.talkedCount, 1, "the restored event is not delivered twice");
});

test("a runtime failure reaches the report as a located diagnostic and runLog observes it", () => {
  const records: LogRecord[] = [];
  const host = createScriptHost({
    program: "a = 1\nnope()\nb = 2\n",
    seed: 0,
    sinks: [(record) => records.push(record)],
  });
  const seen: Diagnostic[] = [];
  const log = runLog(host, { schema: 1, ticks: 2, log: [] }, 1, createNullAudio(), (observation) => {
    seen.push(...observation.diagnostics);
  });

  equal(log.length, 2);
  deepEqual(seen, [
    { code: "unknown.command", file: "<inline>", line: 2, message: 'no built-in or function named "nope"' },
  ]);
  equal(host.state().vm.globals.b, 2);
  deepEqual(
    records.filter((record) => record.code !== "command.overridden").map((record) => record.code),
    ["unknown.command"],
  );
  // Draining is per advance: a later batch with no failure reports none.
  deepEqual(host.advance(1, []).diagnostics, []);
});
test("services sandboxed file blobs and preserves R-38b line endings", () => {
  const blobs = {
    blobs: {
      "saves:game/saved/input.txt": new Uint8Array([65, 13, 10, 66, 10, 67]),
    },
    assets: {},
  };
  const host = createScriptHost({
    program: [
      'openFileInput("input.txt", "Saved")',
      'fileInput("input.txt", first)',
      'fileInput("input.txt", second)',
      'fileInput("input.txt", third)',
      'fileInput("input.txt", fourth)',
      "end()",
    ].join("\n"),
    seed: 0,
    gameId: "game",
    blobs,
  });
  host.advance(12, []);
  equal(host.state().vm.globals.first, "A");
  equal(host.state().vm.globals.second, "B");
  equal(host.state().vm.globals.third, "C");
  equal(host.state().vm.globals.fourth, "");
  equal(host.state().vm.files.length, 1);
});

test("writes only through the sandbox blob port", () => {
  const blobs: { blobs: Record<string, Uint8Array>; assets: Record<string, Uint8Array> } = { blobs: {}, assets: {} };
  const host = createScriptHost({
    program: 'openFileOutput("output.txt", "Saved")\nfilePrint("output.txt", "ok")\nend()\n',
    seed: 0,
    gameId: "game",
    blobs,
  });
  host.advance(12, []);
  deepEqual([...(blobs.blobs["saves:game/saved/output.txt"] ?? [])], [111, 107, 13, 10]);
});
test("writes binary bytes with filePut through the sandbox blob port", () => {
  const blobs: { blobs: Record<string, Uint8Array>; assets: Record<string, Uint8Array> } = { blobs: {}, assets: {} };
  const host = createScriptHost({
    program: 'openFileOutput("binary.dat", "Saved")\nfilePut("binary.dat", 65)\nfilePut("binary.dat", 66)\nend()\n',
    seed: 0,
    gameId: "game",
    blobs,
  });
  host.advance(12, []);
  deepEqual([...(blobs.blobs["saves:game/saved/binary.dat"] ?? [])], [65, 66]);
});

const CLOSURES = [
  "function make() {",
  "  local(n)",
  "  n = 1",
  "  return () => { n = n + 1; sleep(2); n = n + 10; return n }",
  "}",
  "f = make()",
  "r = f()",
  "after = r + 1",
  "end()",
  "",
].join("\n");

test("a host restored while a closure is parked mid-call finishes with the same state hash (entry 18.6)", () => {
  const host = createScriptHost({ program: CLOSURES, seed: 0 });
  host.advance(1, []);
  equal(host.state().vm.threads[0]!.status, "waiting");
  equal(host.state().vm.threads[0]!.frames.length, 2, "the closure's frame is parked on the stack");

  const restored = restoreScriptHost(host.snapshot(), {});
  equal(restored.stateHash(), host.stateHash());
  host.advance(4, []);
  restored.advance(4, []);
  equal(restored.stateHash(), host.stateHash());
  equal(restored.state().vm.globals.r, 12);
  equal(restored.state().vm.globals.after, 13);
});

test("restoreScriptHost reports dangling battle fighters through TickReport and keeps them", () => {
  const host = createScriptHost({ program: "end()\n", seed: 0 });
  const saved = JSON.parse(host.snapshot()) as { battle: unknown; actors: { actors: unknown[] } };
  saved.battle = { id: 1, boardKey: "board", background: "fight.bkg", canRun: true, outcome: null, parties: [[{ party: 0, actorId: 987654, charge: 3 }], []] };
  const restored = restoreScriptHost(JSON.stringify(saved), {});
  equal(restored.state().battle?.parties[0][0]?.actorId, 987654);
  const diagnostics = restored.advance(0, []).diagnostics.filter((item) => item.code === "restore.battle-fighter");
  equal(diagnostics.length, 1);
  equal(diagnostics[0]?.message.includes("battle.parties[0][0].actorId"), true);
});

test("restoreScriptHost refuses a snapshot whose closure data is damaged, with a typed error naming the place", () => {
  const host = createScriptHost({ program: CLOSURES, seed: 0 });
  host.advance(1, []);
  const snap = host.snapshot();

  const refused = (text: string): { code: string; message: string } => {
    try {
      restoreScriptHost(text, {});
    } catch (error) {
      const failure = error as { code: string; message: string };
      return { code: failure.code, message: failure.message };
    }
    throw new Error("expected restoreScriptHost to refuse the snapshot");
  };

  const missingCell = refused(snap.replace('"cells":{"cell1":2}', '"cells":{}'));
  equal(missingCell.code, "restore.cell-missing");
  equal(missingCell.message.includes("vm.globals.f.captures[0]"), true, missingCell.message);

  // The shape is whole but the definition is gone: only the program-aware check can see it.
  const gone = refused(snap.replaceAll("<inline>#lambda_1", "<inline>#lambda_7"));
  equal(gone.code, "restore.callable-unknown-def");
  equal(gone.message.includes("<inline>#lambda_7"), true);
});

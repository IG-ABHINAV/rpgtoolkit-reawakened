// Epic 8 stock dialogue integration acceptance (#595).
// This deliberately boots the real Engine and stock_rpg startup: a short
// full-engine run is required to prove package startup, input, and event routing.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  actorEmitterKey, actorFromSource, addActor, assetKey, createAssetIndex,
  createEmptyBoard, createEngine, ENGINE_DEFAULT_MANIFEST, IR_VERSION,
  killThread, PACKAGE_ROOT, registerActorObject, startThread, STOCK_RPG_PLUGIN,
  writeBoard, type EventView, type GameState, type InputRecord,
  type PackageCatalogueEntry, type PluginDefinition, type WorldBoard,
} from "../src/index.ts";
import { resolveManifestPlugins } from "../src/engine/boot.ts";
import { readEvent } from "../src/events/native.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const stockFolder = join(repoRoot, "stock", "stock_rpg");
const manifest = JSON.parse(readFileSync(join(stockFolder, "manifest.json"), "utf8")) as {
  name: string; version: string; namespace: string; requests: PackageCatalogueEntry["requests"]; program: string;
};
const heard: EventView[] = [];
const completed: EventView[] = [];
const probe: PluginDefinition = {
  id: "restore-dialogue-probe", version: "1.0.0",
  commands: [
    {
      name: "recordtalked", aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state !== undefined) {
          const event = readEvent(view.state, args[0]?.value);
          if (event !== undefined) heard.push(event);
        }
        return { value: null };
      },
    },
    {
      name: "recordcompleted", aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state !== undefined) {
          const event = readEvent(view.state, args[0]?.value);
          if (event !== undefined) completed.push(event);
        }
        return { value: null };
      },
    },
  ],
  listeners: [{ emitter: "actor:*", type: "talked", command: "recordtalked" }, {
    emitter: "game", type: "dialogue.completed", command: "recordcompleted",
  }],
};

function runDialogue(killAtWait: boolean): { readonly state: GameState; readonly speakerId: number; readonly targetId: number } {
  completed.length = 0;
  heard.length = 0;
  const boardResult = ((): Uint8Array => {
    const result = createEmptyBoard();
    const written = writeBoard(result);
    if (!written.ok) throw new Error(written.error.message);
    return written.value;
  })();
  const baseCatalogue = [
    {
      name: manifest.name, version: manifest.version, namespace: manifest.namespace,
      requests: manifest.requests, definition: STOCK_RPG_PLUGIN,
      startup: { kind: "inline" as const, text: readFileSync(join(stockFolder, manifest.program), "utf8"), ir: IR_VERSION, dialect: "tk3" as const },
    },
    { name: probe.id, version: probe.version, namespace: probe.id, requests: [], definition: probe },
  ] satisfies readonly PackageCatalogueEntry[];
  const manifestPlugins = [{ id: "stock_rpg", version: manifest.version, namespace: manifest.namespace, requests: manifest.requests }];
  const resolved = resolveManifestPlugins(manifestPlugins, "main.gam", baseCatalogue).plugins;
  const plugins = [
    ...resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins,
    ...resolved,
    { definition: probe },
  ];
  const latest: { state: GameState | null } = { state: null };
  const getLatest = (): GameState | null => latest.state;
  let setup = false;
  let source: number | null = null;
  let target: number | null = null;
  let threadId: number | null = null;
  const files = new Map([[assetKey("boards/test.brd"), boardResult]]);
  const engine = createEngine({
    seed: 3, assetIndex: createAssetIndex([assetKey("boards/test.brd")]), assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd", width: 32, height: 32, maxTicks: 80,
    plugins, packageCatalogue: baseCatalogue, program: "end()\n",
    phaseRegistrations: [{
      phase: "audio",
      run: (state) => {
        latest.state = state;
        if (setup || !state.events.listeners.some((listener) => listener.emitter === "game" && listener.type === "dialogue.completed")) return;
        setup = true;
        const speaker = addActor(state.actors, { kind: "npc", source: "speaker.tem" });
        const targetActor = addActor(state.actors, { kind: "npc", source: "target.tem" });
        source = speaker.id;
        target = targetActor.id;
        state.sprites.players.push(
          actorFromSource({ id: "speaker", kind: "player", source: "speaker.tem", actorId: speaker.id, x: 0, y: 0, layer: 0 }, { coordType: 0 } as WorldBoard, 0, null),
          actorFromSource({ id: "target", kind: "player", source: "target.tem", actorId: targetActor.id, x: 1, y: 0, layer: 0 }, { coordType: 0 } as WorldBoard, 0, null),
        );
        registerActorObject(state.vm, state.events, state.actors, speaker.id);
        registerActorObject(state.vm, state.events, state.actors, targetActor.id);
        // Probe listens to every actor emitter; the assertion below verifies the
        // real event was routed only to the speaking actor.
        const thread = startThread(state.vm, {
          ref: { kind: "inline", text: 'result = dialogue("Hello, <heroName>")\nend()\n', ir: IR_VERSION },
          kind: "board", owner: "script",
        });
        thread.source = "speaker";
        thread.target = "target";
        threadId = thread.id;
        state.vm.globals.heroName = "Hero";
      },
    }],
  });
  let report = engine.advance(0, []);
  let replies: InputRecord[] = [];
  let sawWait = false;
  for (let guard = 0; guard < 80; guard += 1) {
    const current = getLatest();
    const active = current?.vm.threads.find((thread) => thread.id === threadId);
    if (killAtWait && active?.wait?.kind === "input.key") {
      sawWait = true;
      killThread(current!.vm, active.id);
    } else if (!killAtWait && active?.wait?.kind === "input.key") {
      sawWait = true;
      replies = [{ tick: report.tickAfter, event: { kind: "key", name: "Enter", code: "Enter", char: null, down: true } }];
    }
    const assetReplies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
    if (assetReplies.length > 0) replies = [...assetReplies, ...replies];
    report = engine.advance(report.loading ? 0 : 1, replies);
    replies = [];
    const currentAfterTick = getLatest();
    if (currentAfterTick !== null && currentAfterTick.vm.threads.some((thread) => thread.id === threadId && thread.status === "finished")) break;
    if (killAtWait && sawWait && !currentAfterTick?.vm.threads.some((thread) => thread.id === threadId && thread.status !== "finished")) break;
  }
  const finalState = getLatest();
  if (finalState === null || source === null || target === null || threadId === null) throw new Error("full engine never started dialogue");
  ok(sawWait, "dialogue reached its real input-key wait");
  return { state: finalState, speakerId: source, targetId: target };
}

test("stock_rpg completed dialogue emits actor-isolated talked; killed dialogue emits none", () => {
  const complete = runDialogue(false);
  equal(complete.state.ui.message.text, "Hello, Hero", "the message window displayed the interpolated dialogue");
  equal(complete.state.vm.threads.some((candidate) => candidate.source === "speaker" && candidate.status === "finished"), true, "real input completed the dialogue thread");
  deepEqual(completed.map(({ emitter, type, detail }) => ({ emitter, type, detail })), [{
    emitter: "game",
    type: "dialogue.completed",
    detail: { actorId: complete.speakerId, targetId: complete.targetId, text: "Hello, Hero" },
  }], "real dialogue completion queued the interpolated text");
  deepEqual(heard.map(({ emitter, type, detail }) => ({ emitter, type, detail })), [{
    emitter: actorEmitterKey(complete.speakerId),
    type: "talked",
    detail: { actorId: complete.speakerId, targetId: complete.targetId, text: "Hello, Hero" },
  }]);

  const interrupted = runDialogue(true);
  equal(interrupted.state.vm.threads.some((candidate) => candidate.source === "speaker" && candidate.status === "finished"), false);
  equal(heard.length, 0, "killing while dialogue waits emits no talked event");
  equal(completed.length, 0, "killing while dialogue waits queues no dialogue.completed event");
});

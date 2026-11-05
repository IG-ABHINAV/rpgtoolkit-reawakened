// Package command layers through registerPlugin (MOD-4, PKG-5; entry 19.8;
// docs/spec/engine/rpgcode-modules-and-objects.md#registerplugin-layers-entry-198;
// ADR 0004 decision 8).
//
// Three authored package start-up programs under `fixtures/packages/` (chime,
// shout, lag) register command interceptors that wrap mwin and sleep. The layers
// are held outside saved state in the running game's layer table, reached
// through the one environment table without a second dispatch mechanism,
// rebuilt at every start-up (runPackageStartup) on a fresh state, and removed by
// the registration's remove callable.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  CATALOGUE_PLUGIN,
  advanceScriptTick,
  assetKey,
  createAssetIndex,
  createGameState,
  createPluginLayers,
  createScriptServices as coreCreateScriptServices,
  fileProgramRef,
  hashState,
  PACKAGE_ROOT,
  restoreGameState,
  resolveCall,
  runPackageStartup,
  ScriptError,
  snapshot,
  startProgram,
  UI_PLUGIN,
  verifyRestoredHandles,
  CORE_PLUGIN,
  type GameState,
  type PluginDefinition,
  type PluginLayers,
  type ProgramLoader,
  type ResolvedPlugin,
  type ScriptServices,
} from "../src/index.ts";
import { addRegistration } from "../src/script/layers.ts";
import { advanceOrFail } from "./script-failures.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "packages");

/** The fixture folder as a `Prg/` loader, with `extra` files added. */
function loaderOf(extra: Record<string, string> = {}): ProgramLoader {
  const files: Record<string, string> = {};
  for (const name of readdirSync(FIXTURES)) files[name] = readFileSync(join(FIXTURES, name), "utf8");
  Object.assign(files, extra);
  const bytes = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(files)) {
    bytes.set(assetKey(`Prg/${name}`), new TextEncoder().encode(content));
  }
  return {
    index: createAssetIndex(Object.keys(files).map((name) => `Prg/${name}`)),
    root: PACKAGE_ROOT,
    read: (key: string) => bytes.get(key),
  };
}

/** Script services with the UI plugin (for `mwin`), the loader, and the session layer table. */
function servicesOf(state: GameState, loader: ProgramLoader, layers: PluginLayers): ScriptServices {
  return coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }],
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
  );
}

/**
 * Build a fresh game: create `state`, create `layers`, run `startups` in order
 * on `state` through `runPackageStartup`, and then start `main` as thread 1.
 */
function freshGame(
  loader: ProgramLoader,
  startups: readonly string[],
  main = "game.prg",
  seed = 0,
): { state: GameState; services: ScriptServices; layers: PluginLayers } {
  const state = createGameState({ seed });
  const layers = createPluginLayers();
  const services = servicesOf(state, loader, layers);
  runPackageStartup(state, services, startups.map((name) => fileProgramRef(loader, name)), []);
  startProgram(state.vm, fileProgramRef(loader, main));
  return { state, services, layers };
}

/**
 * Rebuild a host after restore: start-up runs on a scratch fresh state to
 * rebuild the identical layer table, then loads `json` and checks the handles.
 */
function restoreGame(
  json: string,
  loader: ProgramLoader,
  startups: readonly string[],
  seed = 0,
): { state: GameState; services: ScriptServices; layers: PluginLayers } {
  const scratch = createGameState({ seed });
  const layers = createPluginLayers();
  const scratchServices = servicesOf(scratch, loader, layers);
  runPackageStartup(scratch, scratchServices, startups.map((name) => fileProgramRef(loader, name)), []);

  const state = restoreGameState(json);
  const services = servicesOf(state, loader, layers);
  verifyRestoredHandles(state.vm, services);
  return { state, services, layers };
}

function finished(state: GameState): boolean {
  return state.vm.threads.every((thread) => thread.status === "finished");
}

function runToEnd(state: GameState, services: ScriptServices, limit = 60): number {
  let ticks = 0;
  while (!finished(state) && ticks < limit) {
    advanceOrFail(state, services);
    ticks += 1;
  }
  equal(finished(state), true, "the program finished within the tick limit");
  return ticks;
}

function engineLines(state: GameState): unknown[] {
  return state.vm.effects
    .filter((effect) => effect.name === "mwin")
    .map((effect) => effect.args[0]);
}

function sleepTicks(state: GameState): unknown[] {
  return state.vm.effects
    .filter((effect) => effect.name === "sleep")
    .map((effect) => effect.args[0]);
}

// --- Acceptance 1: onion order, `next`, waits, save/restore, removal -------------------------

test("a package registers a wrapper for one command: next reaches the engine", () => {
  const loader = loaderOf();
  const { state, services } = freshGame(loader, ["chime.prg"]);
  runToEnd(state, services);

  deepEqual(engineLines(state), ["chime:hello", "chime:again"]);
  equal(state.vm.globals.trace, "chime> <chime chime> <chime ");
  equal(state.vm.globals.done, 1);
});

test("three registered layers run in ruled order and next reaches the layer below then the engine", () => {
  const loader = loaderOf();
  // chime installed first (innermost), then shout, then lag (outermost).
  const { state, services } = freshGame(loader, ["chime.prg", "shout.prg", "lag.prg"]);
  runToEnd(state, services);

  // lag sees the line first, then shout uppercases it, then chime prefixes it, then the engine.
  deepEqual(engineLines(state), ["chime:HELLO", "chime:AGAIN"]);
  equal(
    state.vm.globals.trace,
    "lag> slow> <slow shout> chime> <chime <shout <lag " +
      "slow> <slow " +
      "lag> slow> <slow shout> chime> <chime <shout <lag ",
  );
  // shout doubled every sleep: lag's sleep(1) becomes sleep(2), the game's sleep(1) becomes sleep(2).
  deepEqual(sleepTicks(state), [2, 2, 2]);
});

test("a layer that waits parks and saves/restores cleanly; the restored run finishes with the same state hash", () => {
  const loader = loaderOf();
  const startups = ["chime.prg", "shout.prg", "lag.prg"];
  const { state: straight, services: straightServices } = freshGame(loader, startups);
  const total = runToEnd(straight, straightServices);
  const straightHash = hashState(straight);

  // Split at every tick: lag's sleep(1) doubles to 2 ticks, so ticks 0..5 park inside the layers.
  let parkedInLayer = 0;
  for (let split = 0; split <= total; split += 1) {
    const { state, services } = freshGame(loader, startups);
    for (let tick = 0; tick < split; tick += 1) advanceOrFail(state, services);

    const json = snapshot(state);
    const { state: restored, services: restoredServices } = restoreGame(json, loader, startups);
    equal(hashState(restored), hashState(state), `split ${split}: state hash matches right after restore`);

    const waitingInLayer = state.vm.threads.some(
      (thread) => thread.status === "waiting" && thread.frames.length > 1,
    );
    if (waitingInLayer) parkedInLayer += 1;

    runToEnd(state, services);
    runToEnd(restored, restoredServices);
    equal(hashState(restored), hashState(state), `split ${split}: restored finishes where straight finishes`);
    equal(hashState(restored), straightHash, `split ${split}: and where the uninterrupted run finishes`);
  }
  equal(parkedInLayer >= 4, true, `saves landed inside wrapped layers (${parkedInLayer} times)`);
});

test("removing a package removes only its layers; the layers below and above it keep working", () => {
  const loader = loaderOf({
    "game.prg": `
trace = ""
mwin("one")
shoutHandle.remove()
mwin("two")
done = 1
end()
`,
  });
  const startups = ["chime.prg", "shout.prg", "lag.prg"];
  const { state, services } = freshGame(loader, startups);
  runToEnd(state, services);

  // First line: lag -> shout (HELLO) -> chime (chime:HELLO) -> engine.
  // shout removed: lag and chime stay. Second line: lag -> chime (chime:two, not CHIME:TWO) -> engine.
  deepEqual(engineLines(state), ["chime:ONE", "chime:two"]);
  equal(
    state.vm.globals.trace,
    "lag> slow> <slow shout> chime> <chime <shout <lag " +
      "lag> chime> <chime <lag ",
  );
  // Before removal, sleep was doubled (2 ticks). After removal of shout, the layer below lag's sleep is the engine bare sleep (1 tick).
  deepEqual(sleepTicks(state), [2, 1]);
});

test("calling remove a second time returns 0 and does not error", () => {
  const loader = loaderOf({
    "game.prg": `
r1 = shoutHandle.remove()
r2 = shoutHandle.remove()
end()
`,
  });
  const { state, services } = freshGame(loader, ["shout.prg"]);
  runToEnd(state, services);

  equal(state.vm.globals.r1, 1, "the first remove removed the layers");
  equal(state.vm.globals.r2, 0, "the second remove saw none left");
});

test("no new resolution tier exists in resolveCall: resolveCall resolves through the 4 ruled tiers only", () => {
  const loader = loaderOf();
  const { state, services } = freshGame(loader, ["chime.prg", "shout.prg", "lag.prg"]);

  // Without passing `held`, resolveCall resolves through tiers 2..4 only (built-in, script function, extension).
  const program = services.programs.get(fileProgramRef(loader, "game.prg"));
  // mwin is an extension command (from the UI pack): resolveCall finds it through the extension tier.
  const extensionOnly = services.commands.extension("mwin");
  equal(extensionOnly !== undefined, true);
  // resolveCall with no held callable sees the extension/built-in, not the package layer:
  // resolveCall itself is unchanged and has no layer tier.
  const resolved = resolveCall("mwin", 1, program, services.commands);
  equal(resolved?.kind, "command");
});

test("registerPlugin accepts a menu-only registration and empty menu maps do not mask the screen", () => {
  const loader = loaderOf({
    "menu-only.prg": `
emptyHandle = registerPlugin({ name: "empty", commands: {}, menuProviders: {} })
menuHandle = registerPlugin({ name: "menu-only", commands: {}, menuProviders: { main: (context) => null } })
`,
  });
  const state = createGameState({ seed: 0 });
  const layers = createPluginLayers();
  const services = servicesOf(state, loader, layers);
  startProgram(state.vm, fileProgramRef(loader, "menu-only.prg"));
  advanceOrFail(state, services);
  equal(layers.menuStacks.get("main")?.length, 1);
  equal(layers.menuLayers.size, 1);
  equal([...layers.registrations.values()].filter((registration) => registration.name === "empty")[0]?.menuLayers.length, 0);
  equal(services.menuOwners.menu.updateCurrent({ actorId: null, selection: 0 }).ok, false);
  advanceOrFail(state, services);
  equal(finished(state), true);
});

test("an RPGCode menu-only provider enters through a direct facade call and returns on the same thread", () => {
  const loader = loaderOf({
    "game.prg": 'registerPlugin({ name: "menu-only", commands: {}, menuProviders: { main: (context) => { entered = context.screen } } })\nmainmenu()\nend()\n',
  });
  const state = createGameState({ seed: 0 });
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(state.vm.globals.entered, "main");
  equal(state.menu.screens.length, 0);
  equal(finished(state), true);
});

test("a facade call without a custom or stock provider refuses without changing the menu stack", () => {
  const loader = loaderOf({ "game.prg": "mainmenu()\nend()\n" });
  const state = createGameState({ seed: 0 });
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  throws(
    () => advanceOrFail(state, services),
    (error: unknown) => error instanceof ScriptError && error.code === "menu.provider-missing",
  );
  equal(state.menu.screens.length, 0);
});

test("a native menu provider waits and resumes its same-thread facade call", () => {
  const loader = loaderOf({ "game.prg": "mainmenu()\nend()\n" });
  const state = createGameState({ seed: 0 });
  const providerEvents: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "test-menu",
    version: "1.2.0",
    commands: [],
    menuProviders: {
      main: ({ event }) => {
        providerEvents.push(event.type);
        return event.type === "input"
          ? { kind: "complete" }
          : { kind: "wait", state: { entered: true }, wait: { kind: "menu.screen", global: true, id: "test-menu", payload: [], resumeRefs: [] } };
      },
    },
  };
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(state.vm.threads[0]?.status, "waiting");
  equal(state.menu.screens.at(-1)?.screen, "main");
  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  const providerPlugins = [
    { definition: CORE_PLUGIN },
    { definition: UI_PLUGIN },
    { definition: CATALOGUE_PLUGIN },
    { definition: nativeMenu },
  ] as const;
  const restoredServices = coreCreateScriptServices(restored, providerPlugins, undefined, undefined, loader);
  verifyRestoredHandles(restored.vm, restoredServices);
  const changedProvider = { ...nativeMenu, version: "1.3.0" };
  const incompatibleServices = coreCreateScriptServices(
    restored,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: changedProvider }],
    undefined,
    undefined,
    loader,
  );
  throws(
    () => verifyRestoredHandles(restored.vm, incompatibleServices),
    (error: unknown) => error instanceof ScriptError && error.code === "restore.menu-provider",
  );
  const seq = restored.input.nextSeq;
  restored.input.nextSeq += 1;
  restored.input.keys.push({ seq, name: "enter", code: "Enter", char: null, action: null, resolvedActions: [] });
  advanceOrFail(restored, restoredServices);
  deepEqual(providerEvents, ["enter", "input"]);
  equal(restored.menu.screens.length, 0);
  equal(finished(restored), true);
});
test("the unified registry lets a later RPGCode provider win and routes a TypeScript parent through an RPGCode child", () => {
  const loader = loaderOf({
    "game.prg": 'registerPlugin({ name: "items-rpg", commands: {}, menuProviders: { items: (context) => { entered = context.screen } } })\nmainmenu()\nend()\n',
  });
  const state = createGameState({ seed: 0 });
  const events: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "native-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      main: ({ event }) => {
        events.push(`main:${event.type}`);
        return event.type === "child.closed"
          ? { kind: "complete" }
          : { kind: "open", state: { main: true }, screen: "items" };
      },
      items: ({ event }) => { events.push(`native-items:${event.type}`); return { kind: "complete" }; },
    },
  };
  const plugins = [
    { definition: CORE_PLUGIN },
    { definition: UI_PLUGIN },
    { definition: CATALOGUE_PLUGIN },
    { definition: nativeMenu },
  ];
  const layers = createPluginLayers();
  const services = coreCreateScriptServices(state, plugins, undefined, undefined, loader, "default", undefined, undefined, layers);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  const threadId = state.vm.threads[0]?.id;
  runToEnd(state, services);
  deepEqual(events, ["main:enter", "main:child.closed"]);
  equal(state.vm.globals.entered, "items");
  equal(state.menu.screens.length, 0);
  equal(state.vm.threads[0]?.id, threadId, "cross-surface nesting stays on the caller thread");
});
test("a saved RPGCode child frame validates its native parent and resumes after restore", () => {
  const loader = loaderOf({
    "startup.prg": 'registerPlugin({ name: "items-rpg", commands: {}, menuProviders: { items: (context) => { entered = context.screen; sleep(2) } } })\n',
    "game.prg": "mainmenu()\nend()\n",
  });
  const events: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "native-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      main: ({ event }) => {
        events.push(`main:${event.type}`);
        return event.type === "child.closed" ? { kind: "complete" } : { kind: "open", state: {}, screen: "items" };
      },
    },
  };
  const plugins = [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }];
  const state = createGameState({ seed: 0 });
  const layers = createPluginLayers();
  const services = coreCreateScriptServices(state, plugins, undefined, undefined, loader, "default", undefined, undefined, layers);
  runPackageStartup(state, services, [fileProgramRef(loader, "startup.prg")], []);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  advanceOrFail(state, services);
  equal(state.vm.threads[0]?.status, "waiting");
  ok(state.vm.threads[0]?.frames.some((frame) => frame.menuContinuation !== undefined));
  const restored = restoreGameState(snapshot(state));
  const restoredLayers = createPluginLayers();
  const scratch = createGameState({ seed: 0 });
  const scratchServices = coreCreateScriptServices(scratch, plugins, undefined, undefined, loader, "default", undefined, undefined, restoredLayers);
  runPackageStartup(scratch, scratchServices, [fileProgramRef(loader, "startup.prg")], []);
  const restoredServices = coreCreateScriptServices(restored, plugins, undefined, undefined, loader, "default", undefined, undefined, restoredLayers);
  verifyRestoredHandles(restored.vm, restoredServices);
  runToEnd(restored, restoredServices);
  deepEqual(events, ["main:enter", "main:child.closed"]);
  equal(restored.vm.globals.entered, "items");
  equal(restored.menu.screens.length, 0);
});
test("an RPGCode provider frame resumes around a native child facade call", () => {
  const loader = loaderOf({
    "startup.prg": 'registerPlugin({ name: "main-rpg", commands: {}, menuProviders: { main: (context) => { itemmenu(); parentResumed = 1 } } })\n',
    "game.prg": "mainmenu()\nend()\n",
  });
  const nativeEvents: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "native-child",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      items: ({ event }) => {
        nativeEvents.push(event.type);
        return event.type === "input"
          ? { kind: "complete" }
          : { kind: "wait", state: {}, wait: { kind: "menu.screen", global: true, id: "native-child", payload: [], resumeRefs: [] } };
      },
    },
  };
  const plugins = [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }];
  const state = createGameState({ seed: 0 });
  const layers = createPluginLayers();
  const services = coreCreateScriptServices(state, plugins, undefined, undefined, loader, "default", undefined, undefined, layers);
  runPackageStartup(state, services, [fileProgramRef(loader, "startup.prg")], []);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  equal(state.vm.threads[0]?.status, "waiting");
  const seq = state.input.nextSeq;
  state.input.nextSeq += 1;
  state.input.keys.push({ seq, name: "enter", code: "Enter", char: null, action: null, resolvedActions: [] });
  runToEnd(state, services);
  deepEqual(nativeEvents, ["enter", "input"]);
  equal(state.vm.globals.parentresumed, 1);
  equal(state.menu.screens.length, 0);
});
test("a later native registration replaces an earlier RPGCode provider in the same registry", () => {
  const loader = loaderOf({
    "register.prg": 'registerPlugin({ name: "rpg-first", commands: {}, menuProviders: { main: (context) => { entered = "rpg" } } })\nend()\n',
    "game.prg": "mainmenu()\nend()\n",
  });
  const state = createGameState({ seed: 0 });
  const layers = createPluginLayers();
  const initialServices = coreCreateScriptServices(state, [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }], undefined, undefined, loader, "default", undefined, undefined, layers);
  startProgram(state.vm, fileProgramRef(loader, "register.prg"));
  runToEnd(state, initialServices);
  const events: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "native-later",
    version: "1.0.0",
    commands: [],
    menuProviders: { main: ({ event }) => { events.push(event.type); return { kind: "complete" }; } },
  };
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  deepEqual(events, ["enter"]);
  equal(state.vm.globals.entered, undefined);
});
test("removing an RPGCode winner reveals the preceding native provider", () => {
  const loader = loaderOf({
    "game.prg": 'rpgHandle = registerPlugin({ name: "rpg-override", commands: {}, menuProviders: { main: (context) => { winner = "rpg" } } })\nmainmenu()\nrpgHandle.remove()\nmainmenu()\nend()\n',
  });
  const events: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "native-base",
    version: "1.0.0",
    commands: [],
    menuProviders: { main: ({ event }) => { events.push(event.type); return { kind: "complete" }; } },
  };
  const state = createGameState({ seed: 0 });
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  equal(state.vm.globals.winner, "rpg");
  deepEqual(events, ["enter"]);
});
test("removing an RPGCode provider does not cancel its already-entered frame", () => {
  const loader = loaderOf({
    "game.prg": 'rpgHandle = registerPlugin({ name: "rpg-override", commands: {}, menuProviders: { main: (context) => { sleep(1); winner = "rpg-finished" } } })\nthread("rpgHandle.remove()", 0)\nmainmenu()\nend()\n',
  });
  const events: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "native-base",
    version: "1.0.0",
    commands: [],
    menuProviders: { main: ({ event }) => { events.push(event.type); return { kind: "complete" }; } },
  };
  const state = createGameState({ seed: 0 });
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  runToEnd(state, services);
  equal(state.vm.globals.winner, "rpg-finished");
  deepEqual(events, []);
  equal(state.menu.screens.length, 0);
});

test("InternalMenu routes the four compatibility indices and rejects index 3", () => {
  const screens: string[] = [];
  const nativeMenu: PluginDefinition = {
    id: "compat-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      main: ({ event }) => { if (event.type === "enter") screens.push("main"); return { kind: "complete" }; },
      items: ({ event }) => { if (event.type === "enter") screens.push("items"); return { kind: "complete" }; },
      equipment: ({ event }) => { if (event.type === "enter") screens.push("equipment"); return { kind: "complete" }; },
      abilities: ({ event }) => { if (event.type === "enter") screens.push("abilities"); return { kind: "complete" }; },
    },
  };
  const loader = loaderOf({ "game.prg": "internalmenu(0)\ninternalmenu(1)\ninternalmenu(2)\ninternalmenu(4)\nend()\n" });
  const state = createGameState({ seed: 0 });
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceOrFail(state, services);
  deepEqual(screens, ["main", "items", "equipment", "abilities"]);
  equal(state.menu.screens.length, 0);

  const invalidLoader = loaderOf({ "game.prg": "internalmenu(3)\nend()\n" });
  const invalidState = createGameState({ seed: 0 });
  const invalidServices = coreCreateScriptServices(
    invalidState,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    invalidLoader,
  );
  startProgram(invalidState.vm, fileProgramRef(invalidLoader, "game.prg"));
  throws(
    () => advanceOrFail(invalidState, invalidServices),
    (error: unknown) => error instanceof ScriptError && error.code === "builtin.bad-arg",
  );
  equal(invalidState.menu.screens.length, 0);
});

test("a native provider cannot save a closure in its continuation state", () => {
  const loader = loaderOf({ "game.prg": "mainmenu()\nend()\n" });
  const state = createGameState({ seed: 0 });
  const nativeMenu: PluginDefinition = {
    id: "invalid-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      main: () => ({
        kind: "wait",
        state: (() => null) as never,
        wait: { kind: "menu.screen", global: true, id: "invalid-menu", payload: [], resumeRefs: [] },
      }),
    },
  };
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  throws(
    () => advanceOrFail(state, services),
    (error: unknown) => error instanceof ScriptError && error.code === "menu.provider-result",
  );
  equal(state.menu.screens.length, 0);
  equal(state.vm.threads[0]?.status, "finished");
});

test("a resumed provider exception cleans its menu stack and reaches the caller handler", () => {
  const loader = loaderOf({
    "game.prg": "function guarded() {\nsetErrorHandler(:caught)\nmainmenu()\nafter = 1\nreturn 0\n:caught\nhandled = 1\nreturn 0\n}\nguarded()\nend()\n",
  });
  const state = createGameState({ seed: 0 });
  const nativeMenu: PluginDefinition = {
    id: "throwing-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      main: () => ({ kind: "open", state: { entered: true }, screen: "items" }),
      items: ({ event }) => {
        if (event.type === "input") throw new Error("provider exploded");
        return { kind: "wait", state: { entered: true }, wait: { kind: "menu.screen", global: true, id: "throwing-menu", payload: [], resumeRefs: [] } };
      },
    },
  };
  const services = coreCreateScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: nativeMenu }],
    undefined,
    undefined,
    loader,
  );
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceScriptTick(state, services);
  advanceScriptTick(state, services);
  equal(state.menu.screens.length, 2);
  equal(state.vm.threads[0]?.status, "waiting");
  const seq = state.input.nextSeq;
  state.input.nextSeq += 1;
  state.input.keys.push({ seq, name: "enter", code: "Enter", char: null, action: null, resolvedActions: [] });
  advanceScriptTick(state, services);
  equal(state.vm.globals.handled, 1, "the caller's error handler should run");
  equal(state.vm.globals.after, undefined);
  equal(state.menu.screens.length, 0);
  equal(finished(state), true);
});

for (const failureCase of [
  {
    name: "invalid resumed wait",
    provider: {
      id: "invalid-wait",
      version: "1.0.0",
      commands: [],
      menuProviders: {
        main: ({ event }: { readonly event: { readonly type: string } }) => event.type === "input"
          ? ({
            kind: "wait",
            state: {},
            wait: { kind: "input.key", global: true, key: null, resumeRefs: [] },
          } as never)
          : { kind: "wait", state: {}, wait: { kind: "menu.screen", global: true, id: "invalid-wait", payload: [], resumeRefs: [] } },
      },
    } satisfies PluginDefinition,
  },
  {
    name: "missing nested child provider",
    provider: {
      id: "missing-child",
      version: "1.0.0",
      commands: [],
      menuProviders: {
        main: ({ event }: { readonly event: { readonly type: string } }) => event.type === "input"
          ? { kind: "open", state: {}, screen: "items" }
          : { kind: "wait", state: {}, wait: { kind: "menu.screen", global: true, id: "missing-child", payload: [], resumeRefs: [] } },
      },
    } satisfies PluginDefinition,
  },
]) {
  test(`resumed provider ${failureCase.name} unwinds through the caller handler`, () => {
    const loader = loaderOf({
      "game.prg": "function guarded() {\nsetErrorHandler(:caught)\nmainmenu()\nafter = 1\nreturn 0\n:caught\nhandled = 1\nreturn 0\n}\nguarded()\nend()\n",
    });
    const state = createGameState({ seed: 0 });
    const services = coreCreateScriptServices(
      state,
      [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: failureCase.provider }],
      undefined,
      undefined,
      loader,
    );
    startProgram(state.vm, fileProgramRef(loader, "game.prg"));
    advanceScriptTick(state, services);
    equal(state.vm.threads[0]?.status, "waiting");
    const seq = state.input.nextSeq;
    state.input.nextSeq += 1;
    state.input.keys.push({ seq, name: "enter", code: "Enter", char: null, action: null, resolvedActions: [] });
    advanceScriptTick(state, services);
    equal(state.vm.globals.handled, 1);
    equal(state.vm.globals.after, undefined);
    equal(state.menu.screens.length, 0);
    equal(finished(state), true);
  });
}
test("restore validates every nested parent provider identity before resuming the child", () => {
  const loader = loaderOf({ "game.prg": "mainmenu()\nend()\n" });
  const parentMenu: PluginDefinition = {
    id: "parent-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: { main: () => ({ kind: "open", state: { parent: true }, screen: "items" }) },
  };
  const childMenu: PluginDefinition = {
    id: "child-menu",
    version: "1.0.0",
    commands: [],
    menuProviders: {
      items: () => ({
        kind: "wait",
        state: { child: true },
        wait: { kind: "menu.screen", global: true, id: "child-menu", payload: [], resumeRefs: [] },
      }),
    },
  };
  const state = createGameState({ seed: 0 });
  const plugins = [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: parentMenu }, { definition: childMenu }];
  const services = coreCreateScriptServices(state, plugins, undefined, undefined, loader);
  startProgram(state.vm, fileProgramRef(loader, "game.prg"));
  advanceScriptTick(state, services);
  advanceScriptTick(state, services);
  equal(state.vm.threads[0]?.status, "waiting");
  equal(state.menu.screens.length, 2);

  const restored = restoreGameState(snapshot(state));
  const withParent = coreCreateScriptServices(restored, plugins, undefined, undefined, loader);
  verifyRestoredHandles(restored.vm, withParent);
  const withoutParent = coreCreateScriptServices(
    restored,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: childMenu }],
    undefined,
    undefined,
    loader,
  );
  throws(
    () => verifyRestoredHandles(restored.vm, withoutParent),
    (error: unknown) => error instanceof ScriptError && error.code === "restore.menu-provider",
  );
  const changedParent = coreCreateScriptServices(
    restored,
    [{ definition: CORE_PLUGIN }, { definition: UI_PLUGIN }, { definition: CATALOGUE_PLUGIN }, { definition: { ...parentMenu, version: "2.0.0" } }, { definition: childMenu }],
    undefined,
    undefined,
    loader,
  );
  throws(
    () => verifyRestoredHandles(restored.vm, changedParent),
    (error: unknown) => error instanceof ScriptError && error.code === "restore.menu-provider",
  );
});

// --- Errors and edge cases ------------------------------------------------------------------

test("registerPlugin fails cleanly when a command value is not a callable", () => {
  const loader = loaderOf({
    "bad.prg": `
registerPlugin({
  name: "bad",
  commands: { mwin: 42 }
})
end()
`,
  });
  const state = createGameState({ seed: 0 });
  const layers = createPluginLayers();
  const services = servicesOf(state, loader, layers);
  startProgram(state.vm, fileProgramRef(loader, "bad.prg"));
  throws(
    () => advanceOrFail(state, services),
    (error: unknown) => error instanceof ScriptError && error.code === "callable.not-callable",
  );
  equal(layers.layers.size, 0, "nothing was registered");
});

test("registerPlugin fails cleanly when the definition is not a dictionary", () => {
  const loader = loaderOf({
    "bad.prg": `registerPlugin("not-a-dict")\nend()\n`,
  });
  const state = createGameState({ seed: 0 });

  const layers = createPluginLayers();
  const services = servicesOf(state, loader, layers);
  startProgram(state.vm, fileProgramRef(loader, "bad.prg"));
  throws(
    () => advanceOrFail(state, services),
    (error: unknown) => error instanceof ScriptError && error.code === "object.invalid",
  );
});

test("registerPlugin fails cleanly when wrapping a command that does not exist", () => {
  const loader = loaderOf({
    "bad.prg": `
registerPlugin({
  name: "bad",
  commands: { nonexistentCommandXYZ: (next) => next() }
})
end()
`,
  });
  const state = createGameState({ seed: 0 });
  const layers = createPluginLayers();
  const services = servicesOf(state, loader, layers);
  startProgram(state.vm, fileProgramRef(loader, "bad.prg"));
  throws(
    () => advanceOrFail(state, services),
    (error: unknown) => error instanceof ScriptError && error.code === "unknown.command",
  );
});

test("an interceptor with wrong arity fails with callable.arity naming the command", () => {
  const loader = loaderOf({
    "bad-arity.prg": `
registerPlugin({
  name: "bad-arity",
  commands: {
    // mwin takes 1 argument; with next it needs 2. A 3-param lambda fails on mwin("hello").
    mwin: (a, b, next) => next(a)
  }
})
`,
  });
  const { state, services } = freshGame(loader, ["bad-arity.prg"]);
  throws(
    () => advanceOrFail(state, services),
    (error: unknown) =>
      error instanceof ScriptError &&
      error.code === "callable.arity" &&
      error.message.includes("mwin"),
  );
});

test("calling a layer handle when the layer was not rebuilt on restore fails with callable.unknown-def", () => {
  const loader = loaderOf({
    "game.prg": `h = bindingOf("mwin")\nend()\n`,
    "game2.prg": `h("hi")\nend()\n`,
  });
  // Start-up registers chime, then game.prg captures bindingOf("mwin") into global h.
  const { state, services } = freshGame(loader, ["chime.prg"], "game.prg");
  runToEnd(state, services);
  const json = snapshot(state);

  // Restore into a host whose start-up was NOT run: the layer table is empty.
  const restored = restoreGameState(json);
  const emptyLayers = createPluginLayers();
  const servicesWithoutStartup = servicesOf(restored, loader, emptyLayers);
  verifyRestoredHandles(restored.vm, servicesWithoutStartup);

  // Start game2.prg which calls the saved layer handle h:
  startProgram(restored.vm, fileProgramRef(loader, "game2.prg"));
  throws(
    () => runToEnd(restored, servicesWithoutStartup),
    (error: unknown) =>
      error instanceof ScriptError &&
      error.code === "callable.unknown-def" &&
      error.message.includes("package layers are rebuilt by package start-up"),
  );
});

test("package start-up that waits is refused with package.startup-unfinished", () => {
  const loader = loaderOf({
    "waiter.prg": `sleep(1)\nend()\n`,
  });
  const state = createGameState({ seed: 0 });
  const services = servicesOf(state, loader, createPluginLayers());
  throws(
    () => runPackageStartup(state, services, [fileProgramRef(loader, "waiter.prg")], []),
    (error: unknown) =>
      error instanceof ScriptError &&
      error.code === "package.startup-unfinished" &&
      error.pos !== null &&
      error.pos !== undefined &&
      error.pos.file !== "" &&
      error.message.includes("waits"),
  );
});

test("package startup delay and positive threadSleep report unfinished without clock access", () => {
  for (const [name, source] of [["delay.prg", "delay(1)\nend()\n"], ["threadsleep.prg", "threadsleep(getthreadid(), 1)\nend()\n"]] as const) {
    const loader = loaderOf({ [name]: source });
    const state = createGameState({ seed: 0 });
    const services = servicesOf(state, loader, createPluginLayers());
    throws(
      () => runPackageStartup(state, services, [fileProgramRef(loader, name)], []),
      (error: unknown) => error instanceof ScriptError && error.code === "package.startup-unfinished",
    );
  }
});
test("package startup helper rejects randomness directly", () => {
  const loader = loaderOf({ "random.prg": `random(3)\nend()\n` });
  const state = createGameState({ seed: 0 });
  const services = servicesOf(state, loader, createPluginLayers());
  throws(
    () => runPackageStartup(state, services, [fileProgramRef(loader, "random.prg")], []),
    (error: unknown) => error instanceof ScriptError && error.code === "package.startup-forbidden",
  );
});
test("package startup helper rejects native clock access directly", () => {
  const state = createGameState({ seed: 0 });
  const definition: PluginDefinition = {
    id: "clock-package",
    version: "1.0.0",
    commands: [{
      name: "readclock",
      aliases: [],
      params: [],
      call: (view) => {
        const state = view.state;
        if (state === undefined) return { value: null };
        try { Object.defineProperty(state, "rng", { value: { nextUint32: () => 1 } }); } catch { /* guarded state */ }
        try { delete (state as Record<string, unknown>).time; } catch { /* guarded state */ }
        try { Object.getOwnPropertyDescriptor(state, "time"); } catch { /* guarded state */ }
        state.rng;
        return { value: null };
      },
    }],
  };
  const services = coreCreateScriptServices(state, [{ definition: CORE_PLUGIN }, { definition }]);
  const plugin: ResolvedPlugin = { definition, startup: { kind: "inline", text: "readclock()\nend()\n", ir: "1", dialect: "tk3" } };
  throws(
    () => runPackageStartup(state, services, [plugin.startup!], [plugin]),
    (error: unknown) => error instanceof ScriptError && error.code === "package.startup-forbidden",
  );
});


test("failed package startup removes package listeners, layers and behaviours but preserves prior listeners", () => {
  const loader = loaderOf({
    "rollback.prg": `h = registerPlugin({ name: "temporary", commands: { random: (value, next) => next(value) } })\ngame.on("startup", (event) => { observed = 1 })\nthread("threadsleep(getthreadid(), 0)", 1)\nforbiddenrng()\nend()\n`,
  });
  const state = createGameState({ seed: 0 });
  const prior: PluginDefinition = {
    id: "prior",
    version: "1.0.0",
    commands: [{ name: "priorlistener", aliases: [], params: [], call: () => ({ value: null }) }],
    listeners: [{ emitter: "game", type: "prior", command: "priorlistener" }],
  };
  const packageDefinition: PluginDefinition = {
    id: "rollback-package",
    version: "1.0.0",
  commands: [
      { name: "packagelistener", aliases: [], params: [], call: () => ({ value: null }) },
      { name: "forbiddenrng", aliases: [], params: [], call: (view) => { view.rng.nextUint32(); return { value: null }; } },
    ],
    listeners: [{ emitter: "game", type: "package", command: "packagelistener" }],
    behaviourStartup(register) {
      register("rollback-package.actor", { statsChanged: () => ({ dp: 1 }) });
    },
  };
  coreCreateScriptServices(state, [{ definition: CORE_PLUGIN }, { definition: prior }], undefined, undefined, loader);
  const services = coreCreateScriptServices(state, [{ definition: CORE_PLUGIN }, { definition: packageDefinition }], undefined, undefined, loader, "default", undefined, undefined, createPluginLayers());
  const listenersBeforeStartup = services.listenersBeforePackageStartup;
  const baselineRegistration = addRegistration(services.layers, "preexisting", [{
    command: "random",
    interceptor: { type: "callable", def: "prior-interceptor", captures: [], receiver: null },
    engine: { type: "callable", def: "prior-engine", captures: [], receiver: null },
  }]);
  equal(services.behaviours.registerForNamespace("rollback-package", "rollback-package.prior", { statsChanged: () => ({ dp: 2 }) }), true);
  const plugin: ResolvedPlugin = { definition: packageDefinition, startup: fileProgramRef(loader, "rollback.prg") };
  throws(
    () => runPackageStartup(state, services, [plugin.startup!], [plugin]),
    (error: unknown) => error instanceof ScriptError && error.code === "package.startup-forbidden",
  );
  equal(state.vm.threads.some((thread) => thread.status !== "finished"), false);
  deepEqual(state.events.listeners.map((listener) => listener.id), listenersBeforeStartup.map((listener) => listener.id));
  equal(services.layers.layers.has(baselineRegistration.layers[0]!), true);
  equal(services.layers.registrations.has(baselineRegistration.id), true);
  deepEqual(services.behaviours.definitions().map((definition) => definition.name), ["rollback-package.prior"]);
  equal(state.events.listeners.some((listener) => listener.id !== listenersBeforeStartup.find((before) => before.id === listener.id)?.id), false);
});

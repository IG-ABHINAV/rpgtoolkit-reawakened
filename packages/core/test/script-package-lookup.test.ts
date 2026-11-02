// Package script functions join the ordinary and the namespaced lookup (entry 19.21, issue #1051;
// docs/spec/engine/rpgcode-modules-and-objects.md#pkg-script-function-lookup-proposal): a function a
// package's start-up program defines is callable bare (`pkgfn()`) and qualified (`demo.pkgfn()`), with the
// priority order, the collision table, the `command.overridden` warnings, the duplicate-package rejection,
// deterministic manifest order and restore of the export index that the spec rules.
import { deepEqual, equal, ok } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  advanceScriptTick,
  applyPluginManifestPatch,
  assetKey,
  CORE_PLUGIN,
  createAssetIndex,
  createCollectingSink,
  createGameState,
  createLogger,
  createPluginLayers,
  createScriptServices,
  drainDiagnostics,
  hashState,
  IR_VERSION,
  PACKAGE_ROOT,
  parsePluginManifest,
  restoreGameState,
  runPackageStartup,
  ScriptError,
  snapshot,
  startProgram,
  verifyRestoredHandles,
  type BuiltinSpec,
  type Diagnostic,
  type GameState,
  type LogRecord,
  type LogSink,
  type PluginDefinition,
  type PluginLayers,
  type ProgramLoader,
  type ProgramRef,
  type ResolvedPlugin,
  type ScriptServices,
} from "../src/index.ts";
import { resolveManifestPlugins } from "../src/engine/boot.ts";

const encoder = new TextEncoder();

type PackageSpec = {
  readonly name: string;
  readonly source: string;
  readonly namespace?: string;
  /** The package's own native commands. */
  readonly commands?: readonly BuiltinSpec[];
};

type RigSpec = {
  readonly packages?: readonly PackageSpec[];
  /** Native packs that are not the engine's own, registered before the packages. */
  readonly natives?: readonly PluginDefinition[];
  readonly files?: Readonly<Record<string, string>>;
};

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly records: LogRecord[];
  readonly spec: RigSpec;
  readonly plugins: readonly ResolvedPlugin[];
  readonly startups: readonly ProgramRef[];
};

function loaderOf(files: Readonly<Record<string, string>>): ProgramLoader {
  const bytes = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(files)) bytes.set(assetKey(`Prg/${name}`), encoder.encode(content));
  return {
    index: createAssetIndex(Object.keys(files).map((name) => `Prg/${name}`)),
    root: PACKAGE_ROOT,
    read: (key) => bytes.get(key),
  };
}

function native(name: string, value: string, params: BuiltinSpec["params"] = []): BuiltinSpec {
  return { name, aliases: [], params, call: () => ({ value }) };
}

type RigPlan = { readonly plugins: ResolvedPlugin[]; readonly startups: ProgramRef[] };

function plan(spec: RigSpec): RigPlan {
  const plugins: ResolvedPlugin[] = [{ definition: CORE_PLUGIN }, ...(spec.natives ?? []).map((definition) => ({ definition }))];
  const startups: ProgramRef[] = [];
  for (const pkg of spec.packages ?? []) {
    const startup: ProgramRef = { kind: "inline", text: pkg.source, ir: IR_VERSION, dialect: "tk3", owner: pkg.name };
    const namespace = pkg.namespace ?? pkg.name;
    plugins.push({
      definition: { id: pkg.name, version: "1.0.0", commands: pkg.commands ?? [] },
      namespace,
      package: { name: pkg.name, version: "1.0.0", namespace, requests: [] },
      startup,
    });
    startups.push(startup);
  }
  return { plugins, startups };
}

function servicesOver(state: GameState, rigPlan: RigPlan, spec: RigSpec, layers: PluginLayers, sink: LogSink): ScriptServices {
  return createScriptServices(state, rigPlan.plugins, createLogger([sink]), undefined, loaderOf(spec.files ?? {}), undefined, undefined, undefined, layers);
}

/** A fresh game: the packages start in manifest order on a fresh state, then `game` starts as thread 1. */
function boot(spec: RigSpec, game: string): Rig {
  const rigPlan = plan(spec);
  const state = createGameState({ seed: 3 });
  const { sink, records } = createCollectingSink();
  const services = servicesOver(state, rigPlan, spec, createPluginLayers(), sink);
  runPackageStartup(state, services, rigPlan.startups, rigPlan.plugins);
  startProgram(state.vm, { kind: "inline", text: game, ir: IR_VERSION, dialect: "tk3" });
  return { state, services, records, spec, plugins: rigPlan.plugins, startups: rigPlan.startups };
}

/** The host's restore: package start-up on a scratch fresh state, then the saved state over rebuilt services. */
function restore(rig: Rig, json: string): Rig {
  const rigPlan = plan(rig.spec);
  const layers = createPluginLayers();
  const { sink, records } = createCollectingSink();
  const scratch = createGameState({ seed: 3 });
  const scratchServices = servicesOver(scratch, rigPlan, rig.spec, layers, sink);
  runPackageStartup(scratch, scratchServices, rigPlan.startups, rigPlan.plugins);
  const state = restoreGameState(json);
  const services = servicesOver(state, rigPlan, rig.spec, layers, sink);
  verifyRestoredHandles(state.vm, services);
  return { state, services, records, spec: rig.spec, plugins: rigPlan.plugins, startups: rigPlan.startups };
}
function run(rig: Rig, ticks = 20): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (let tick = 0; tick < ticks && rig.state.vm.threads.some((thread) => thread.status !== "finished"); tick += 1) {
    advanceScriptTick(rig.state, rig.services);
    out.push(...drainDiagnostics(rig.services));
  }
  return out;
}

function overrides(rig: Rig): Record<string, unknown>[] {
  return rig.records
    .filter((record) => record.code === "command.overridden")
    .map((record) => {
      const data = record.data as Record<string, unknown>;
      return (data.notice ?? data) as Record<string, unknown>;
    })
    .filter((data) => data.kind === "package-function");
}

const DEMO: PackageSpec = { name: "demo", source: "function pkgfn(n) { return n + 100 }\n" };

test("a package script function is callable bare and package-qualified", () => {
  const rig = boot({ packages: [DEMO] }, "r = pkgfn(2)\nq = demo.pkgfn(3)\n");
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.r, 102);
  equal(rig.state.vm.globals.q, 103);
  deepEqual(overrides(rig), []);
});

test("a name no package, program or command supplies is unknown.command, bare and qualified", () => {
  const bare = boot({ packages: [DEMO] }, "r = nosuch(2)\n");
  deepEqual(run(bare).map((item) => [item.code, item.message]), [["unknown.command", 'no built-in or function named "nosuch"']]);
  const qualified = boot({ packages: [DEMO] }, "r = demo.nosuch(2)\n");
  deepEqual(run(qualified).map((item) => [item.code, item.message]), [
    ["unknown.command", 'the package namespace "demo" supplies no command "nosuch" taking 1 argument(s)'],
  ]);
});

test("a package function called with the wrong number of arguments is unknown.command, never another binding", () => {
  const bare = boot({ packages: [DEMO] }, "r = pkgfn(1, 2)\n");
  deepEqual(run(bare).map((item) => item.code), ["unknown.command"]);
  const qualified = boot({ packages: [DEMO] }, "r = demo.pkgfn(1, 2)\n");
  deepEqual(run(qualified).map((item) => [item.code, item.message]), [
    ["unknown.command", 'the package namespace "demo" supplies no command "pkgfn" taking 2 argument(s)'],
  ]);
});

test("a package's native command still answers its qualified call when it has no script function of that name", () => {
  const rig = boot({ packages: [{ ...DEMO, commands: [native("nat", "native")] }] }, "r = demo.nat()\ns = nat()\n");
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.r, "native");
  equal(rig.state.vm.globals.s, "native");
});

test("collision: an engine built-in outranks a package function bare, which stays reachable qualified, with one warning", () => {
  const rig = boot(
    { packages: [{ name: "demo", source: "function castint(n) { return 777 }\n" }] },
    "r = castint(4.75)\nq = demo.castint(4.75)\nr2 = castint(1.5)\n",
  );
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.r, 4);
  equal(rig.state.vm.globals.q, 777);
  const warnings = overrides(rig);
  equal(warnings.length, 1);
  deepEqual(warnings[0], {
    name: "castint",
    argc: 1,
    kind: "package-function",
    previous: 'built-in "core"',
    replacement: 'package "demo"',
    winner: 'built-in "core"',
  });
});

test("collision: a package function beats a native plugin command of matching arity, the command keeps other arities", () => {
  const rig = boot(
    {
      natives: [{ id: "nativepack", version: "1.0.0", commands: [native("nat", "native")] }],
      packages: [{ name: "demo", source: "function nat(n) { return \"package\" }\n" }],
    },
    "a = nat(1)\nb = nat()\nc = demo.nat(1)\n",
  );
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, "package");
  equal(rig.state.vm.globals.b, "native");
  equal(rig.state.vm.globals.c, "package");
  deepEqual(overrides(rig), [{
    name: "nat",
    argc: 1,
    kind: "package-function",
    previous: 'plugin "nativepack"',
    replacement: 'package "demo"',
    winner: 'package "demo"',
  }]);
});

test("collision: a program function outranks a package function of matching arity; other arities coexist", () => {
  const rig = boot(
    { packages: [DEMO] },
    "function pkgfn(n) { return \"program\" }\nfunction pkgfn(a, b, c) { return \"three\" }\na = pkgfn(1)\nb = demo.pkgfn(1)\nc = pkgfn(1, 2, 3)\n",
  );
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, "program");
  equal(rig.state.vm.globals.b, 101);
  equal(rig.state.vm.globals.c, "three");
  const warnings = overrides(rig);
  equal(warnings.length, 1);
  deepEqual(warnings[0]!.previous, 'package "demo"');
  deepEqual(warnings[0]!.winner, 'program "<inline>"');
  deepEqual(warnings[0]!.argc, 1);
});

test("collision: an included function outranks a package function, whenever the include is performed", () => {
  const rig = boot(
    { packages: [DEMO], files: { "lib.prg": "function pkgfn(n) { return \"included\" }\n" } },
    '#include "lib.prg"\na = pkgfn(1)\nb = demo.pkgfn(1)\n',
  );
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, "included");
  equal(rig.state.vm.globals.b, 101);
  equal(overrides(rig).length, 1);
});

test("collision: two packages with one signature: the later manifest entry wins bare, both stay reachable qualified", () => {
  const rig = boot(
    {
      packages: [
        { name: "alpha", source: "function pkgfn(n) { return \"alpha\" }\nfunction wide(a) { return \"alpha1\" }\n" },
        { name: "beta", source: "function pkgfn(n) { return \"beta\" }\nfunction wide(a, b) { return \"beta2\" }\n" },
      ],
    },
    "a = pkgfn(1)\nb = alpha.pkgfn(1)\nc = beta.pkgfn(1)\nd = wide(1)\ne = wide(1, 2)\n",
  );
  deepEqual(run(rig), []);
  deepEqual(["a", "b", "c", "d", "e"].map((key) => rig.state.vm.globals[key]), ["beta", "alpha", "beta", "alpha1", "beta2"]);
  deepEqual(overrides(rig), [{
    name: "pkgfn",
    argc: 1,
    kind: "package-function",
    previous: 'package "alpha"',
    replacement: 'package "beta"',
    winner: 'package "beta"',
  }]);
});

test("collision: a package function beats its own native command of matching arity, even qualified", () => {
  const rig = boot(
    {
      packages: [{
        name: "demo",
        source: "function both(n) { return \"script\" }\n",
        commands: [native("both", "native")],
      }],
    },
    "a = demo.both(1)\nb = demo.both()\nc = both(1)\nd = both()\n",
  );
  deepEqual(run(rig), []);
  deepEqual(["a", "b", "c", "d"].map((key) => rig.state.vm.globals[key]), ["script", "native", "script", "native"]);
  const warnings = overrides(rig);
  equal(warnings.length, 1);
  equal(warnings[0]!.winner, 'package "demo"');
});

test("a callable variable and a registerPlugin layer outrank a package function bare; a qualified call bypasses both", () => {
  const variable = boot({ packages: [DEMO] }, "pkgfn = (n) => 7\na = pkgfn(1)\nb = demo.pkgfn(1)\n");
  deepEqual(run(variable), []);
  equal(variable.state.vm.globals.a, 7);
  equal(variable.state.vm.globals.b, 101);

  const layer = boot(
    { packages: [DEMO] },
    "registerPlugin({ name: \"wrap\", commands: { pkgfn: (n, next) => next(n) + 1000 } })\na = pkgfn(1)\nb = demo.pkgfn(1)\n",
  );
  deepEqual(run(layer), []);
  equal(layer.state.vm.globals.a, 1101);
  equal(layer.state.vm.globals.b, 101);
});

test("a live object named like the namespace answers before the package", () => {
  const rig = boot({ packages: [DEMO] }, "demo = { pkgfn: (n) => 9 }\na = demo.pkgfn(1)\nb = pkgfn(1)\n");
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, 9);
  equal(rig.state.vm.globals.b, 101);
});

test("a package namespace wins over a file of the same name, with the existing hides-file warning", () => {
  const rig = boot({ packages: [DEMO], files: { "demo.prg": "function pkgfn(n) { return \"file\" }\n" } }, 'a = demo.pkgfn(1)\n#include "demo.prg"\n');
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, 101);
  ok(rig.records.some((record) => record.code === "namespace.hides-file"));
});

test("a package exports the functions its start-up includes, literal or performed at run time", () => {
  const files = { "lib.prg": "function libfn(n) { return n * 2 }\n", "more.prg": "function morefn(n) { return n * 3 }\n" };
  const rig = boot(
    { files, packages: [{ name: "demo", source: '#include "lib.prg"\ninclude("more.prg")\nfunction own(n) { return n }\n' }] },
    "a = libfn(2)\nb = demo.morefn(2)\nc = own(5)\n",
  );
  deepEqual(run(rig), []);
  deepEqual(["a", "b", "c"].map((key) => rig.state.vm.globals[key]), [4, 6, 5]);
});

test("package A's functions never appear as package B's: B's namespace does not reach them", () => {
  const rig = boot(
    { packages: [{ name: "alpha", source: "function onlya(n) { return \"a\" }\n" }, { name: "beta", source: "function onlyb(n) { return \"b\" }\n" }] },
    "a = alpha.onlya(1)\nb = beta.onlya(1)\n",
  );
  const diagnostics = run(rig);
  equal(rig.state.vm.globals.a, "a");
  deepEqual(diagnostics.map((item) => [item.code, item.message]), [
    ["unknown.command", 'the package namespace "beta" supplies no command "onlya" taking 1 argument(s)'],
  ]);
  const source = rig.services.commands.packageFunction;
  equal(source.findIn("beta", "onlya", 1), undefined);
  equal(source.findIn("alpha", "onlya", 1)?.package, "alpha");
  deepEqual(rig.services.layers.exports.map((entry) => entry.name), ["alpha", "beta"]);
});

test("the winner and the warnings do not depend on anything but the manifest order", () => {
  const sources = ["one", "two", "three"].map((name) => ({ name, source: `function pkgfn(n) { return \"${name}\" }\n` }));
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const order of orders) {
    const packages = order.map((at) => sources[at]!);
    const rig = boot({ packages }, "a = pkgfn(1)\n");
    deepEqual(run(rig), []);
    equal(rig.state.vm.globals.a, packages[2]!.name, `order ${order.join("")}`);
    deepEqual(
      overrides(rig).map((warning) => [warning.previous, warning.replacement]),
      [
        [`package "${packages[0]!.name}"`, `package "${packages[1]!.name}"`],
        [`package "${packages[0]!.name}"`, `package "${packages[2]!.name}"`],
        [`package "${packages[1]!.name}"`, `package "${packages[2]!.name}"`],
      ],
      `order ${order.join("")}`,
    );
  }
});

test("repeated calls neither re-register the exports nor repeat a warning", () => {
  const rig = boot({ packages: [DEMO, { name: "later", source: "function pkgfn(n) { return \"later\" }\n" }] }, "a = pkgfn(1)\nb = pkgfn(2)\nc = pkgfn(3)\n");
  deepEqual(run(rig), []);
  equal(overrides(rig).length, 1);
  equal(rig.services.layers.exports.length, 2);
});

test("a save taken inside a package function resumes the same binding and later calls bind the same package", () => {
  const spec: RigSpec = {
    packages: [
      { name: "alpha", source: "function slow(n) { sleep(2)\nreturn n + 100 }\nfunction pkgfn(n) { return \"alpha\" }\n" },
      { name: "beta", source: "function pkgfn(n) { return \"beta\" }\n" },
    ],
  };
  const game = "r = slow(5)\ns = pkgfn(1)\nt = alpha.pkgfn(1)\n";
  const straight = boot(spec, game);
  deepEqual(run(straight), []);

  const saved = boot(spec, game);
  advanceScriptTick(saved.state, saved.services);
  drainDiagnostics(saved.services);
  equal(saved.state.vm.threads[0]?.status, "waiting");
  ok((saved.state.vm.threads[0]?.frames.length ?? 0) > 1, "the save is inside the package function");
  const restored = restore(saved, snapshot(saved.state));
  equal(hashState(restored.state), hashState(saved.state));
  deepEqual(run(restored), []);
  equal(restored.state.vm.globals.r, 105);
  equal(restored.state.vm.globals.s, "beta");
  equal(restored.state.vm.globals.t, "alpha");
  equal(hashState(restored.state), hashState(straight.state));
});

test("a restored game on a host whose package start-up did not run cannot bind a package function", () => {
  const rig = boot({ packages: [DEMO] }, "r = pkgfn(2)\n");
  advanceScriptTick(rig.state, rig.services);
  const empty = restore({ ...rig, spec: { packages: [] } }, snapshot(rig.state));
  startProgram(empty.state.vm, { kind: "inline", text: "q = pkgfn(1)\n", ir: IR_VERSION, dialect: "tk3" });
  deepEqual(run(empty).map((item) => item.code), ["unknown.command"]);
});

test("a package left out of the manifest has neither exports nor a namespace on the next rebuild", () => {
  const rig = boot({ packages: [] }, "a = pkgfn(1)\nb = demo.pkgfn(1)\n");
  deepEqual(run(rig).map((item) => [item.code, item.message]), [
    ["unknown.command", 'no built-in or function named "pkgfn"'],
    ["include.missing", 'the file "demo.prg" could not be loaded for `demo.pkgfn`'],
  ]);
});

test("a package identity listed twice is rejected as manifest.duplicate-package at the later entry", () => {
  const entry = { id: "demo", version: "1.0.0" };
  const parsed = parsePluginManifest([{ id: "core" }, entry, { ...entry, namespace: "other" }]);
  deepEqual(parsed.diagnostics.map((item) => [item.code, item.index]), [["manifest.duplicate-package", 2]]);
  equal(parsed.manifest, null);

  const patched = applyPluginManifestPatch([{ id: "core" }, entry], [{ op: "append", entry: { ...entry, namespace: "other" } }]);
  deepEqual(patched.diagnostics.map((item) => [item.code, item.index]), [["manifest.duplicate-package", 0]]);
  deepEqual(patched.manifest, [{ id: "core" }, entry]);

  const catalogue = [{ name: "demo", version: "1.0.0", requests: [], definition: { id: "demo", version: "1.0.0", commands: [] } }] as const;
  const resolved = resolveManifestPlugins([{ id: "core" }, entry, { ...entry }], "main.gam", catalogue);
  deepEqual(resolved.diagnostics.map((item) => [item.code, item.line]), [["manifest.duplicate-package", 0]]);
  equal(resolved.plugins.filter((plugin) => plugin.package?.name === "demo").length, 1);
});

test("a handle made for a package function runs that package's function, not another package's", () => {
  const rig = boot(
    {
      packages: [
        { name: "alpha", source: "function pkgfn(n) { return \"alpha\" }\n" },
        { name: "beta", source: "function pkgfn(n) { return \"beta\" }\n" },
      ],
    },
    "h = bindingOf(\"pkgfn\")\na = h(1)\nb = pkgfn(1)\n",
  );
  deepEqual(run(rig), []);
  deepEqual(["a", "b"].map((key) => rig.state.vm.globals[key]), ["beta", "beta"]);
});

test("an aborted package start-up leaves no exports behind", () => {
  const rigPlan = plan({
    packages: [
      { name: "alpha", source: "function alphaOnly(n) { return 1 }\n" },
      { name: "beta", source: "random(40)\nfunction betaOnly(n) { return 2 }\n" },
    ],
  });
  const state = createGameState({ seed: 3 });
  const { sink } = createCollectingSink();
  const services = servicesOver(state, rigPlan, {}, createPluginLayers(), sink);
  let code = "";
  try {
    runPackageStartup(state, services, rigPlan.startups, rigPlan.plugins);
  } catch (error) {
    code = error instanceof ScriptError ? error.code : "";
  }
  equal(code, "package.startup-forbidden");
  deepEqual(services.layers.exports, []);
  startProgram(state.vm, { kind: "inline", text: "a = alphaOnly(1)\nb = betaOnly(1)\n", ir: IR_VERSION, dialect: "tk3" });
  const rig: Rig = { state, services, records: [], spec: {}, plugins: rigPlan.plugins, startups: rigPlan.startups };
  deepEqual(run(rig).map((item) => item.code), ["unknown.command", "unknown.command"]);
});

test("a program recompiled for a run-time include does not repeat the package conflict warning", () => {
  const rig = boot(
    { packages: [DEMO], files: { "lib.prg": "function other(n) { return 1 }\n", "more.prg": "function more(n) { return 2 }\n" } },
    "function pkgfn(n) { return \"program\" }\ninclude(\"more.prg\")\ninclude(\"lib.prg\")\na = pkgfn(1)\n",
  );
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, "program");
  equal(overrides(rig).length, 1);
});

test("a built-in shadowed while a package also supplies the name still names the engine pack as the earlier binding", () => {
  const rig = boot(
    {
      packages: [{
        name: "demo",
        source: "function castint(n) { return 777 }\n",
        commands: [native("castint", "native", [{ name: "n", optional: false, byRef: false, variadic: false }])],
      }],
    },
    "a = castint(1.5)\nb = demo.castint(1.5)\n",
  );
  deepEqual(run(rig), []);
  equal(rig.state.vm.globals.a, "native");
  equal(rig.state.vm.globals.b, 777);
  const warnings = overrides(rig);
  equal(warnings.length, 1);
  deepEqual(warnings[0]!.previous, 'built-in "core"');
  deepEqual(warnings[0]!.winner, 'built-in "core"');
});

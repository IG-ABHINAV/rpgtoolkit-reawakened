import { deepEqual, equal, throws } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  createGameState,
  createScriptServices,
  fileProgramRef,
  PACKAGE_ROOT,
  utf8Encode,
  CORE_PLUGIN,
  CATALOGUE_PLUGIN,
  type ProgramLoader,
} from "@tk-reawakened/core";
import { TK2_COMPAT_PLUGIN } from "@tk-reawakened/plugin-tk2-compat";
import {
  buildCorpus,
  buildFetchedCorpus,
  compareScriptsGolden,
  formatScriptsGolden,
  runAllCorpusPrograms,
  runCorpusProgram,
  runFetchedCorpus,
  verifyCatalogueCompleteness,
  type FetchedGameFiles,
} from "../src/corpus.ts";
import { PLATFORM_FIXTURE_SOURCES } from "../src/platform-fixtures.ts";
import { checkSnapshotRestore } from "../src/restore-check.ts";
import type { ScriptHost } from "../src/script-host.ts";
import { createScriptHost, restoreScriptHost } from "../src/script-host.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

function loadCatalogueNames(): readonly string[] {
  const jsonPath = join(
    REPO_ROOT,
    "_bmad-output",
    "initiative-rpgtoolkit-reawakened",
    "epic-rpgcode-vm",
    "discovery",
    "command-effect-catalogue.json",
  );
  const raw = readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(raw) as { names: readonly { name: string }[] };
  return parsed.names.map((n) => n.name);
}

function loadMappedTk2Commands(): readonly { name: string; mapsTo?: string }[] {
  const csvPath = join(
    REPO_ROOT,
    "_bmad-output",
    "initiative-rpgtoolkit-reawakened",
    "epic-rpgcode-vm",
    "discovery",
    "tk2-rpgcode-commands.csv",
  );
  const raw = readFileSync(csvPath, "utf8");
  const lines = raw.trim().split("\n");
  const result: { name: string; mapsTo?: string }[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const name = parts[0]?.trim();
    const mapsTo = parts[3]?.trim();
    const cls = parts[4]?.trim();
    if (cls === "mapped" && name) {
      result.push({ name, ...(mapsTo ? { mapsTo } : {}) });
    }
  }
  return result;
}

test("verifyCatalogueCompleteness: all legacy and Reawakened catalogue names resolve", () => {
  const names = loadCatalogueNames();
  equal(names.length, 283);
  const mapped = loadMappedTk2Commands();
  const summary = verifyCatalogueCompleteness(names, mapped);
  equal(summary.catalogueCount, 283);
  equal(summary.mappedCount, mapped.length);
});

test("verifyCatalogueCompleteness: missing catalogue name throws with diagnostic", () => {
  const mapped = loadMappedTk2Commands();
  throws(
    () => verifyCatalogueCompleteness(["nonexistentCommandName123"], mapped),
    /Catalogue completeness failed: 1 names did not resolve: nonexistentCommandName123/,
  );
});

test("verifyCatalogueCompleteness: missing mapped TK2 command throws with diagnostic", () => {
  const names = loadCatalogueNames();
  throws(
    () => verifyCatalogueCompleteness(names, [{ name: "badCmd", mapsTo: "unmappedTargetCmd" }]),
    /TK2 mapped completeness failed: 1 commands did not resolve: badCmd -> unmappedtargetcmd/,
  );
});

test("corpus: all 27 programs run to completion and pass random-step snapshot restore", () => {
  const programs = buildCorpus();
  equal(programs.length, 27);

  const results = runAllCorpusPrograms(42);
  equal(results.length, 27);
  for (const result of results) {
    equal(typeof result.stateHash === "string" && result.stateHash.length === 16, true);
    equal(result.ticks > 0, true);
  }
});

test("corpus: synthetic-12-cancelable-emit parks on event.dispatch, resumes with the changed event, and restores from every tick to the same state hash (entry 19.11)", () => {
  const emit = buildCorpus().find((p) => p.id === "synthetic-12-cancelable-emit");
  if (!emit) throw new Error("synthetic-12-cancelable-emit missing");

  const straight = emit.createHost(0);
  straight.advance(emit.ticks, []);
  const state = straight.state();
  equal(
    state.vm.globals.log,
    "sco1z|15scz|020",
    "the first event is halved and cancelled, the second only halved; the once listener ran for the first only",
  );
  equal(state.vm.threads[0]?.status, "finished");
  equal(state.events.dispatch, null);

  const parkedAt = emit.createHost(0);
  let parkedTicks = 0;
  for (let tick = 0; tick < emit.ticks; tick += 1) {
    parkedAt.advance(1, []);
    if (parkedAt.state().vm.threads.some((thread) => thread.wait?.kind === "event.dispatch")) parkedTicks += 1;
  }
  equal(parkedTicks > 0, true, "the emitting thread was parked on an event.dispatch wait at a tick boundary");

  for (let split = 0; split < emit.ticks; split += 1) {
    const fresh = emit.createHost(0);
    fresh.advance(split, []);
    const restored = emit.restoreHost(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore(
      { fresh, fromSnapshot: restored },
      { ticks: emit.ticks - split, split, inputsForTick: undefined },
    );
    equal(fresh.stateHash(), straight.stateHash(), `split ${split} ends where the straight run ends`);
  }
});

test("corpus: synthetic-13-package-layers registers layers, runs onion dispatch, removes mid-run, and restores from every tick to the same state hash (entry 19.8)", () => {
  const pkg = buildCorpus().find((p) => p.id === "synthetic-13-package-layers");
  if (!pkg) throw new Error("synthetic-13-package-layers missing");

  const straight = pkg.createHost(0);
  straight.advance(pkg.ticks, []);
  const globals = straight.state().vm.globals;
  equal(
    globals.trace,
    "s>c><c<sp><pc><c",
    "shout was outermost for the first call and doubled sleep; after removal chime ran bare",
  );
  const lines = straight
    .state()
    .vm.effects.filter((effect) => effect.name === "mwin")
    .map((effect) => effect.args[0]);
  deepEqual(lines, ["c:HI", "c:again"]);
  equal(straight.state().vm.threads[0]?.status, "finished");

  for (let split = 0; split < pkg.ticks; split += 1) {
    const fresh = pkg.createHost(0);
    fresh.advance(split, []);
    const restored = pkg.restoreHost(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore(
      { fresh, fromSnapshot: restored },
      { ticks: pkg.ticks - split, split, inputsForTick: undefined },
    );
    equal(fresh.stateHash(), straight.stateHash(), `split ${split} ends where the straight run ends`);
  }
});

// Entry 19.14: the three package goldens run the authored fixtures of packages/core/test/fixtures/platform/.
const PLATFORM_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "test",
  "fixtures",
  "platform",
);

test("corpus: the platform fixture copies are the fixture files without their comment lines (entry 19.14)", () => {
  const files = readdirSync(PLATFORM_FIXTURE_DIR).sort();
  deepEqual(Object.keys(PLATFORM_FIXTURE_SOURCES).sort(), files, "every fixture file has a copy and no copy lacks a file");
  for (const file of files) {
    const withoutComments = readFileSync(join(PLATFORM_FIXTURE_DIR, file), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    equal(PLATFORM_FIXTURE_SOURCES[file], withoutComments, `${file} drifted from its corpus copy`);
  }
});

/** Restore the program from a snapshot taken at every tick and check each run ends where the straight run ends. */
function restoresFromEveryTick(id: string): ScriptHost {
  const program = buildCorpus().find((p) => p.id === id);
  if (!program) throw new Error(`${id} missing`);
  const straight = program.createHost(0);
  straight.advance(program.ticks, []);
  for (let split = 0; split <= program.ticks; split += 1) {
    const fresh = program.createHost(0);
    fresh.advance(split, []);
    const restored = program.restoreHost(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore(
      { fresh, fromSnapshot: restored },
      { ticks: program.ticks - split, split, inputsForTick: undefined },
    );
    equal(fresh.stateHash(), straight.stateHash(), `split ${split} ends where the straight run ends`);
  }
  return straight;
}

test("corpus: synthetic-14-object-package pins one seeded run of the fighters objects and restores from every tick (entry 19.14)", () => {
  const straight = restoresFromEveryTick("synthetic-14-object-package");
  const globals = straight.state().vm.globals;
  equal(globals.log, "direct:5;torn-off:7;rebound:3;potion:22;killed:slime;");
  equal(globals.done, 1);
});

test("corpus: synthetic-15-emitter-package pins one seeded run of the shield and restores from every tick (entry 19.14)", () => {
  const straight = restoresFromEveryTick("synthetic-15-emitter-package");
  const globals = straight.state().vm.globals;
  equal(
    globals.log,
    "w1r0:6>0;blocked:6;w0r1:10>5;first:5;hurt:5;w1r2:6>0;blocked:6;w1r3:6>0;blocked:6;bare:40;hurt:40;foe:4;",
  );
  equal(globals.fallen, 1);
  equal(globals.done, 1);
});

test("corpus: synthetic-16-namespaced-packages pins one seeded run of the override and restores from every tick (entry 19.14)", () => {
  const straight = restoresFromEveryTick("synthetic-16-namespaced-packages");
  const globals = straight.state().vm.globals;
  equal(globals.log, "weather:5+storm;weather:5;weather:5+storm;weather:3;");
  equal(globals.trace, "storm> weather> <weather <storm weather> <weather ");
  equal(globals.done, 1);
});

test("corpus: synthetic-10-closures restores from a snapshot taken at every tick and finishes with the same state hash (entry 18.6)", () => {
  const closures = buildCorpus().find((p) => p.id === "synthetic-10-closures");
  if (!closures) throw new Error("synthetic-10-closures missing");

  const straight = closures.createHost(0);
  straight.advance(closures.ticks, []);
  equal(straight.state().vm.globals.r, 42, "the lambda parked mid-call by sleep returned 21 * 2");
  equal(straight.state().vm.globals.wrapped, 5, "the bindingOf wrapper added one to castint(4.75)");
  equal(straight.state().vm.globals.late, 13, "lib.prg called a handle whose program had already ended");
  equal(straight.state().vm.cellSeq, 11, "three captured locals and the eight loop closures were made");
  equal(Object.keys(straight.state().vm.cells ?? {}).length, 4, "the seven abandoned loop closures' cells were freed");

  for (let split = 0; split < closures.ticks; split += 1) {
    const fresh = closures.createHost(0);
    fresh.advance(split, []);
    const restored = closures.restoreHost(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore(
      { fresh, fromSnapshot: restored },
      { ticks: closures.ticks - split, split, inputsForTick: undefined },
    );
    equal(fresh.stateHash(), straight.stateHash(), `split ${split} ends where the straight run ends`);
  }
});

test("corpus: synthetic-11-middleware layers wrap mwin and sleep, and restores from every tick finish with the same state hash (entry 18.7)", () => {
  const middleware = buildCorpus().find((p) => p.id === "synthetic-11-middleware");
  if (!middleware) throw new Error("synthetic-11-middleware missing");

  const straight = middleware.createHost(0);
  straight.advance(middleware.ticks, []);
  const globals = straight.state().vm.globals;
  equal(
    globals.trace,
    "hud>audio>weather><weather<audio<hud" + "pace><pace" + "hud>audio>weather><weather<audio<hud",
    "hud is the outermost layer, weather the innermost, and pace waits inside its own call",
  );
  const lines = straight
    .state()
    .vm.effects.filter((effect) => effect.name === "mwin")
    .map((effect) => effect.args[0]);
  equal(lines.join("|"), "weather:audio:hud:hello|weather:audio:hud:again");
  equal(globals.seen, 2, "the counter's two handles shared one cell");

  for (let split = 0; split < middleware.ticks; split += 1) {
    const fresh = middleware.createHost(0);
    fresh.advance(split, []);
    const restored = middleware.restoreHost(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore(
      { fresh, fromSnapshot: restored },
      { ticks: middleware.ticks - split, split, inputsForTick: undefined },
    );
    equal(fresh.stateHash(), straight.stateHash(), `split ${split} ends where the straight run ends`);
  }
});

test("corpus: start.prg runs headlessly to completion in 3 ticks with scripted input", () => {
  const programs = buildCorpus();
  const demoStart = programs.find((p) => p.id === "sample-start-demo");
  if (!demoStart) throw new Error("sample-start-demo missing");

  const host = demoStart.createHost(0);
  equal(host.state().vm.threads[0]?.status, "ready"); // tick 0 initial start
  host.advance(1, []);
  equal(host.state().vm.threads[0]?.status, "waiting"); // after cursorMapRun wait
  host.advance(1, demoStart.inputsForTick ? demoStart.inputsForTick(1) : []);
  equal(host.state().vm.threads[0]?.status, "waiting"); // after intro() wait
  host.advance(1, demoStart.inputsForTick ? demoStart.inputsForTick(2) : []);
  equal(host.state().vm.threads[0]?.status, "finished"); // after end()
});

test("corpus: whole fetched corpus suite over fixtures/legacy runs all 10 programs headlessly with scripted inputs", () => {
  const fixturesRoot = join(REPO_ROOT, "fixtures", "legacy");
  if (!existsSync(fixturesRoot)) return; // skip only if fixtures not fetched locally

  const demoPrg = join(fixturesRoot, "demo", "Prg");
  const basicPrg = join(fixturesRoot, "Basic", "Prg");
  const demoFiles: Record<string, Uint8Array> = {};
  for (const f of readdirSync(demoPrg).sort()) {
    if (f.endsWith(".prg")) demoFiles[f] = readFileSync(join(demoPrg, f));
  }
  const basicFiles: Record<string, Uint8Array> = {};
  for (const f of readdirSync(basicPrg).sort()) {
    if (f.endsWith(".prg")) basicFiles[f] = readFileSync(join(basicPrg, f));
  }

  const fetchedCorpus: FetchedGameFiles = { demo: demoFiles, basic: basicFiles };
  const results = runFetchedCorpus(fetchedCorpus, 0);
  equal(results.length, 10);

  // Re-pinned by ticket 6.6: the `audio` section grew from the empty placeholder to schema v2 (five stopped tracks,
  // the cue counter, the script bank). Nothing else moved: hashing each final state with the placeholder put back
  // gives every previous value (60b9d135ecc2665c, c70da0e285468911, d1a2feea4d6699d3, 148143e8efdad422,
  // 91341281743ee68f, 1eda27c040030408, 4aead264e9d81fc0 and 249a5a6f76a4cb12).
  // Re-pinned by ticket 19.10: the state tree gained the `events` section (empty here) and `schema.events`. Nothing else
  // moved: hashing each final state without them gives every previous value (bcccb726d88cf025, c7276b9169328503,
  // 9128c9fb95d1f969, a7e3084cbafc59c0, 2e8a007d7bae1d31, 6717598c0b7e163a, 69af004598505635 and eaef689c32b9ae98).
  // Re-pinned by ticket 20.3: the empty `actors` section is now part of the hashed state tree.
  // Re-pinned by ticket 20.6: the actor section schema and persisted progression contract advanced to version 2.
  // Re-pinned by tickets 8.2 and 21.5: schema-2 party/inventory/menu state is hashed; MEDIA-1 returns a voice from
  // one-argument `mediaPlay(file)`. The legacy corpus calls are bare statements, so they ignore the value and keep
  // the same playback cues; the returned object changes the hashed VM state. Closing PNGs remain visual baselines.
  // Re-pinned by ticket 7.9: the samples' built-in FightEnemy calls now retain their started battle sections.
  // Re-pinned by story 8.25 (#814): `schema.compiler` became `schema.ir`, `schema` moved to version 2 and `vm`
  // to version 6. Hashing each final state with the old schema fields put back gives every previous value.
  // Re-pinned by ticket 23.10 (#848): `font("Arial")` now resolves to the Liberation face the host bundles instead of
  // a key nothing ships, and the saved `ui.font.asset` is part of the hashed state. Only `sample-start-basic` moved.
  // Re-pinned by issue #1048: the presented screen (surface 0) and the script-screen layer no longer contribute to the
  // state hash. Only `sample-start-demo` and `sample-start-basic` moved, because only their start programs draw to the
  // screen (`clear()`); the other programs never put a screen entry into the saved state.
  // Re-pinned by #589: `vm` moved to schema version 7 (the per-frame `itemActions` stack). Nothing else moved:
  // with the version put back to 6 every previous value (see git history) is reproduced exactly.
  // #585 (menu graphic): only both sample-start hashes moved because their menuGraphic("layout.png") now writes menu.graphic.
  // Re-pinned again by #585 (pointer record): the input section moved to schema 3 (`downs`, `ups`, `downX`, `downY`, `button`
  // joined `input.pointer`), so every state hash moved once and nothing else did. With the schema put back to 2 and the
  // pointer record reduced to {x, y, buttons}, every previous value above and in golden/scripts/golden.json is reproduced exactly.
  // Restoring the old mixed/ui responder reproduces both previous hashes and all eight closing baselines exactly.
  // Re-pinned by #1231: the party section gained the saved `stepRemainder` and moved to schema 3, so every
  // state hash moved once and nothing else did (draw hashes, ticks and diagnostics are unchanged).
  const expectedHashes: Record<string, string> = {
    "sample-start-demo": "4fa5f696c0eed1d3",
    "sample-system-demo": "9bab3f5f1c5707c5",
    "sample-sys-test-demo": "9bab3f5f1c5707c5",
    "sample-win-demo": "74716f4480794887",
    "sample-oldman-demo": "9166f736d1965256",
    "sample-man-demo": "51dc8fa86fb9fbe8",
    "sample-man-wander-demo": "afb0e9d840b47ce5",
    "sample-start-basic": "ed8dd75eac6674af",
    "sample-system-basic": "9bab3f5f1c5707c5",
    "sample-wander-basic": "3317060cd68120f5",
  };

  for (const res of results) {
    equal(res.stateHash, expectedHashes[res.id], `hash mismatch for ${res.id}`);
  }
});

test("corpus: defined finish line for programs that never end (Basic/Prg/wander.prg)", () => {
  const programs = buildCorpus();
  const wander = programs.find((p) => p.id === "sample-wander-basic");
  if (!wander) throw new Error("sample-wander-basic missing");

  equal(wander.ticks, 5);
  const host1 = wander.createHost(0);
  for (let i = 0; i < 5; i++) host1.advance(1, []);
  const hash1 = host1.stateHash();

  const host2 = wander.createHost(0);
  for (let i = 0; i < 5; i++) host2.advance(1, []);
  const hash2 = host2.stateHash();

  equal(hash1, hash2);
  equal(hash1, "3317060cd68120f5"); // re-pinned by #1231 (party schema 3, stepRemainder); was b79b37884bda3c8e (#585)

  for (let split = 0; split <= 5; split++) {
    const fresh = wander.createHost(0);
    for (let t = 0; t < split; t++) fresh.advance(1, []);
    const snap = fresh.snapshot();
    const restored = wander.restoreHost(snap);
    checkSnapshotRestore({ fresh, fromSnapshot: restored }, { ticks: 5 - split, split });
    equal(fresh.stateHash(), hash1);
    equal(restored.stateHash(), hash1);
  }
});

test("corpus: man_wander.prg transfers control to man.prg via run() and completes headlessly", () => {
  const programs = buildCorpus();
  const manWander = programs.find((p) => p.id === "sample-man-wander-demo");
  if (!manWander) throw new Error("sample-man-wander-demo missing");

  const host = manWander.createHost(0);
  equal(host.state().vm.threads[0]?.status, "ready");
  host.advance(1, []); // real movement command runs through the hydrated-free corpus host without a generic catalogue wait
  equal(host.state().vm.threads[0]?.status, "ready");
  host.advance(1, []); // intercept branch reaches man.prg and parks on its input wait
  equal(host.state().vm.threads[0]?.wait?.kind, "input.key");
  host.advance(1, manWander.inputsForTick ? manWander.inputsForTick(3) : []); // ENTER completes wait() and program
  equal(host.state().vm.threads[0]?.status, "finished");
});

test("corpus: synthetic-9-mismatch restarts thread from updated source with fresh frame", () => {
  const v1 = "x = 1\nsleep(1)\ny = 2\nend()\n";
  const v2 = "x = 10\ny = 20\nend()\n";

  const loader1: ProgramLoader = {
    index: createAssetIndex(["Prg/main.prg"]),
    root: PACKAGE_ROOT,
    read: (k) => (k === assetKey("Prg/main.prg") ? utf8Encode(v1) : undefined),
  };
  const loader2: ProgramLoader = {
    index: createAssetIndex(["Prg/main.prg"]),
    root: PACKAGE_ROOT,
    read: (k) => (k === assetKey("Prg/main.prg") ? utf8Encode(v2) : undefined),
  };

  const ref = fileProgramRef(loader1, "main.prg");
  const host1 = createScriptHost({ program: ref, loader: loader1, seed: 0 });
  host1.advance(1, []);
  equal(host1.state().vm.globals.x, 1);
  const snap = host1.snapshot();

  // Restore into host where loader2 holds updated source v2
  const restoredHost = restoreScriptHost(snap, { loader: loader2 });
  restoredHost.advance(1, []);
  equal(restoredHost.state().vm.globals.x, 10);
  equal(restoredHost.state().vm.globals.y, 20);
  equal(restoredHost.state().vm.threads[0]?.status, "finished");
});

test("scripts golden compare: detects hash mismatch and missing entries", () => {
  const results = runAllCorpusPrograms(0);
  const formatted = formatScriptsGolden(results);

  // Success case
  const cmpGood = compareScriptsGolden(results, formatted);
  equal(cmpGood.ok, true);

  // Mismatch case
  const mutated = formatted.replace(
    results[0]!.stateHash,
    "0000000000000000",
  );
  const cmpBad = compareScriptsGolden(results, mutated);
  equal(cmpBad.ok, false);
  if (!cmpBad.ok) {
    equal(cmpBad.message.includes("hash mismatch"), true);
  }

  // Missing entry case
  const missing = JSON.stringify({ schema: 1, programs: [] });
  const cmpMissing = compareScriptsGolden(results, missing);
  equal(cmpMissing.ok, false);
  if (!cmpMissing.ok) {
    equal(cmpMissing.message.includes("lacks entry"), true);
  }
});

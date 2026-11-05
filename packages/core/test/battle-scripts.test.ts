// Two battle scripts over one actor model (ticket 20.13; docs/spec/engine/actors.md,
// docs/spec/engine/actors.md#store-and-action-boundary, docs/spec/engine/rpgcode-modules-and-objects.md#emit-13).
//
// The scripts are the authored fixtures under test/fixtures/authored/battle-scripts/ (G7). Each one
// sends the cancelable `beforeDamage` event on the game emitter from its own battle thread, parks
// for the listeners' one tick, and then applies the surviving damage and the reward through its
// package's commands, which dispatch through the actor owner. The two games differ only in the
// behaviour their package registers in `behaviourStartup`: the core rules, the commands and the
// actor model are the same. Re-record state hashes with BATTLE_SCRIPTS_GOLDEN_RECORD=1 node --test
// packages/core/test/battle-scripts.test.ts.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addActor,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  hashGameState,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  writeBoard,
  ENGINE_DEFAULT_MANIFEST,
} from "../src/index.ts";
import { resolveManifestPlugins } from "../src/engine/boot.ts";
import type { ActorHooks } from "../src/actors/rules.ts";
import type { Diagnostic, GameState, PluginDefinition, ResolvedPlugin } from "../src/index.ts";

type Files = Map<string, Uint8Array>;
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

function fixture(name: string): string {
  return readFileSync(join(testDir, "fixtures", "authored", "battle-scripts", name), "utf8");
}

/**
 * One battle package: the same four commands for both games, so only the registered behaviour can
 * change the result (docs/spec/engine/actors.md#store-and-action-boundary).
 */
function battlePlugin(namespace: string, hooks: ActorHooks | null): ResolvedPlugin {
  const definition: PluginDefinition = {
    id: namespace,
    version: "1.0.0",
    commands: [
      {
        name: "spawn",
        aliases: [],
        params: [
          { name: "hp", optional: false, byRef: false, variadic: false },
          { name: "maxHp", optional: false, byRef: false, variadic: false },
          { name: "threshold", optional: false, byRef: false, variadic: false },
        ],
        call: (view, args) => {
          if (view.state === undefined) return { value: 0 };
          const hp = Number(args[0]?.value ?? 0);
          const maxHp = Number(args[1]?.value ?? 0);
          const threshold = Number(args[2]?.value ?? 0);
          const actor = addActor(view.state.actors, {
            kind: "party",
            source: "hero.tem",
            behaviour: hooks === null ? null : `${namespace}.hero`,
            stats: { experience: 0, hp, maxHp, dp: 0, fp: 0, smp: 0, maxSmp: 0, level: 1, criticalOn: 0, criticalBy: 0 },
            progression: {
              levelType: threshold,
              experienceIncrease: threshold,
              maxLevel: 99,
              levelHp: 0,
              levelDp: 0,
              levelFp: 0,
              levelSm: 0,
              levelUpType: 1,
              remainingExperience: threshold,
              nextRequirement: threshold,
              legacyLevelUp: false,
            },
          });
          return { value: actor.id };
        },
      },
      {
        name: "hit",
        aliases: [],
        params: [
          { name: "id", optional: false, byRef: false, variadic: false },
          { name: "amount", optional: false, byRef: false, variadic: false },
        ],
        call: (view, args) => {
          const actors = view.actors;
          if (actors === undefined) return { value: 0 };
          const id = Number(args[0]?.value ?? 0);
          const amount = Number(args[1]?.value ?? 0);
          const before = actors.readActor(id);
          if (before === null) return { value: 0 };
          const result = actors.updateStats(id, { hp: before.stats.hp - amount }, { cause: "damage" });
          return { value: before.stats.hp - (result?.actor.stats.hp ?? before.stats.hp) };
        },
      },
      {
        name: "reward",
        aliases: [],
        params: [
          { name: "id", optional: false, byRef: false, variadic: false },
          { name: "amount", optional: false, byRef: false, variadic: false },
        ],
        call: (view, args) => {
          const actors = view.actors;
          if (actors === undefined) return { value: null };
          actors.awardExperience(Number(args[0]?.value ?? 0), Number(args[1]?.value ?? 0));
          return { value: null };
        },
      },
      {
        name: "hpof",
        aliases: [],
        params: [{ name: "id", optional: false, byRef: false, variadic: false }],
        call: (view, args) => ({ value: view.actors?.readActor(Number(args[0]?.value ?? 0))?.stats.hp ?? 0 }),
      },
      {
        name: "levelof",
        aliases: [],
        params: [{ name: "id", optional: false, byRef: false, variadic: false }],
        call: (view, args) => ({ value: view.actors?.readActor(Number(args[0]?.value ?? 0))?.stats.level ?? 0 }),
      },
    ],
    ...(hooks === null ? {} : { behaviourStartup(register: (name: string, value: ActorHooks) => boolean) { register(`${namespace}.hero`, hooks); } }),
  };
  return { namespace, definition };
}

/** The Zelda-style rules: health is counted in whole hearts of four points, one heart per level. */
const ZELDA_HOOKS: ActorHooks = {
  statsChanged: (_actor, context) => (context.operation === "stats" ? { hp: Math.max(0, Math.floor(context.proposal.hp / 4) * 4) } : {}),
  levelUp: () => ({ deltas: { maxHp: 4 } }),
  revive: () => ({ hp: 4 }),
};

/** The FF-style rules: three points of armour on every hit, five hundred health per level. */
const FF_HOOKS: ActorHooks = {
  statsChanged: (_actor, context) => (context.operation === "stats" ? { hp: Math.max(0, context.proposal.hp + 3) } : {}),
  levelUp: () => ({ deltas: { maxHp: 500 } }),
  revive: () => ({ hp: 1 }),
};

type BattleRun = {
  readonly hashes: readonly string[];
  readonly finalHash: string;
  readonly snapshots: readonly string[];
  readonly state: GameState;
  readonly diagnostics: readonly Diagnostic[];
};

type GoldenRow = { readonly id: string; readonly finalHash: string; readonly ticks: readonly string[] };

/** Read the pinned battle goldens; a row of the wrong shape is a hard error, never a silent miss. */
function readGolden(): readonly GoldenRow[] {
  // The per-tick hashes include each program's source hash (R-42), so a text-only
  // edit that leaves the lowered instructions identical still moves them; the
  // zelda rows were re-recorded when the formatter made the fixture canonical
  // (entry 10.13) and were verified against identical lowering.
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, "golden", "actors", "battle-scripts.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("programs" in parsed) || !Array.isArray(parsed.programs)) {
    throw new Error("golden/actors/battle-scripts.json: root must be an object with a programs array");
  }
  return parsed.programs.map((row: unknown): GoldenRow => {
    if (
      typeof row !== "object" || row === null
      || !("id" in row) || typeof row.id !== "string"
      || !("finalHash" in row) || typeof row.finalHash !== "string"
      || !("ticks" in row) || !Array.isArray(row.ticks) || !row.ticks.every((tick: unknown) => typeof tick === "string")
    ) {
      throw new Error("golden/actors/battle-scripts.json: each row needs string id, finalHash and ticks");
    }
    return { id: row.id, finalHash: row.finalHash, ticks: row.ticks };
  });
}

/** The engine's own packs stay installed; the battle package only adds its four commands. */
const DEFAULT_PLUGINS: readonly ResolvedPlugin[] = resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins;

const BOARD = (() => {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
})();

function files(): Files {
  return new Map([[assetKey("boards/test.brd"), BOARD]]);
}

/** Boot one battle package and play its script to `end()` from `seed`. */
function runBattle(kind: "zelda" | "ff", hooks: ActorHooks | null, seed = 11): BattleRun {
  const namespace = `${kind === "zelda" ? "zelda-battle" : "ff-battle"}`;
  const hashes: string[] = [];
  const snapshots: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const capture: { state: GameState | null } = { state: null };
  let recorded = -1;
  const engine = createEngine({
    seed,
    assetIndex: createAssetIndex([...files().keys()]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 600,
    program: fixture(`${kind}.prg`),
    plugins: [...DEFAULT_PLUGINS, battlePlugin(namespace, hooks)],
    phaseRegistrations: [
      {
        phase: "audio",
        run: (state) => {
          capture.state = state;
          if (state.time.tick === recorded) return;
          recorded = state.time.tick;
          snapshots.push(snapshot(state));
          hashes.push(hashGameState(state));
        },
      },
    ],
  });
  const game = files();
  let report = engine.advance(0, []);
  diagnostics.push(...report.diagnostics);
  for (let guard = 0; guard < 400; guard += 1) {
    const replies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: game.get(request.key) ?? null } }]
      : []);
    report = engine.advance(report.loading ? 0 : 1, replies);
    diagnostics.push(...report.diagnostics);
    if (report.loading) continue;
    if (capture.state !== null && Number(capture.state.vm.globals.ended ?? 0) === 1) break;
  }
  if (capture.state === null) throw new Error("the battle script never advanced");
  ok(Number(capture.state.vm.globals.ended ?? 0) === 1, "the battle script must reach end()");
  const finalHash = hashes[hashes.length - 1];
  if (finalHash === undefined) throw new Error("the battle script recorded no tick");
  return { hashes, finalHash, snapshots, state: capture.state, diagnostics };
}

const GOLDEN: readonly GoldenRow[] = readGolden();

function goldenFor(id: string): GoldenRow {
  const row = GOLDEN.find((entry) => entry.id === id);
  ok(row !== undefined, `golden/actors/battle-scripts.json lacks ${id}`);
  return row;
}

test("the two battle scripts share one actor model and differ only through their registered behaviour", () => {
  const zelda = runBattle("zelda", ZELDA_HOOKS);
  const ff = runBattle("ff", FF_HOOKS);
  equal(zelda.diagnostics.length, 0);
  equal(ff.diagnostics.length, 0);
  // Zelda: 48 health in hearts of four, six hits of ten, so the hero falls and is never revived.
  equal(zelda.state.vm.globals.health, 0);
  equal(zelda.state.vm.globals.lvl, 2);
  // FF: 9999 health, six rolled hits with three points of armour each, then 1500 experience.
  ok(Number(ff.state.vm.globals.health) > 1000, "the FF-style hero must survive the six hits");
  equal(ff.state.vm.globals.lvl, 2);
  const zeldaActor = zelda.state.actors.actors[0];
  const ffActor = ff.state.actors.actors[0];
  equal(zeldaActor?.stats.maxHp, 52, "one heart of four per level");
  equal(ffActor?.stats.maxHp, 10499, "five hundred health per level");
  equal(zeldaActor?.behaviour, "zelda-battle.hero");
  equal(ffActor?.behaviour, "ff-battle.hero");
  // The same core operation with no registered behaviour is the unmodified core rule.
  const core = runBattle("zelda", null);
  equal(core.state.actors.actors[0]?.stats.hp, 0, "the core rule falls the hero without the hearts rounding");
  equal(core.state.actors.actors[0]?.stats.maxHp, 48, "the core rule grows no health without the level-up hook");
  equal(core.state.actors.actors[0]?.stats.level, 2);
  equal(zelda.state.vm.globals.log, "0:10>12;1:10>12;2:10>12;3:10>12;4:10>0;5:10>0;", "the hearts rule decides every committed hit");
  deepEqual(core.state.actors.actors[0]?.behaviour, null);
  equal(core.diagnostics.some((diagnostic) => diagnostic.code.startsWith("plugin.")), false);
});

test("every battle tick saves and restores to the same hash", () => {
  for (const [kind, hooks] of [["zelda", ZELDA_HOOKS], ["ff", FF_HOOKS]] as const) {
    const run = runBattle(kind, hooks);
    equal(run.snapshots.length, run.hashes.length);
    ok(run.snapshots.length > 4, "a battle must span several ticks");
    run.snapshots.forEach((json, index) => {
      const restored = hashGameState(restoreGameState(json));
      equal(restored, run.hashes[index], `${kind} tick ${index} restores to its own hash`);
    });
    equal(hashGameState(restoreGameState(run.snapshots[run.snapshots.length - 1]!)), run.finalHash);
  }
});

test("a battle script replays to the pinned per-tick hashes", () => {
  const runs = [
    { id: "zelda", run: runBattle("zelda", ZELDA_HOOKS) },
    { id: "ff", run: runBattle("ff", FF_HOOKS) },
  ] as const;
  if (process.env["BATTLE_SCRIPTS_GOLDEN_RECORD"] === "1") {
    const programs = runs.map(({ id, run }) => ({ id, finalHash: run.finalHash, ticks: run.hashes }));
    writeFileSync(join(repoRoot, "golden", "actors", "battle-scripts.json"), `${JSON.stringify({ schema: 1, programs }, null, 2)}\n`);
    return;
  }
  for (const { id, run } of runs) {
    const row = goldenFor(id);
    equal(run.hashes.length, row.ticks.length, `${id} tick count`);
    deepEqual([...run.hashes], [...row.ticks], `${id} per-tick hashes`);
    equal(run.finalHash, row.finalHash, `${id} final hash`);
  }
});

test("a different seed changes the FF damage rolls and nothing in the Zelda script", () => {
  const zeldaA = runBattle("zelda", ZELDA_HOOKS, 11);
  const zeldaB = runBattle("zelda", ZELDA_HOOKS, 12);
  equal(zeldaB.state.vm.globals.log, zeldaA.state.vm.globals.log, "the Zelda-style script rolls no dice");
  equal(zeldaB.state.vm.globals.health, zeldaA.state.vm.globals.health);
  const ffA = runBattle("ff", FF_HOOKS, 11);
  const ffB = runBattle("ff", FF_HOOKS, 12);
  ok(ffA.state.vm.globals.log !== ffB.state.vm.globals.log, "the FF-style script rolls from the seed");
});




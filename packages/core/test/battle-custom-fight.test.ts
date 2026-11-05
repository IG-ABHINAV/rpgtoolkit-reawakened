// A custom encounter is spelled out, not drawn (BAT-9 rule 2, docs/spec/engine/battle.md#bat-9): the 5.11 request
// carries no fighters, the engine runs the main file's fight program in place of the draw, and the program names
// its own enemies with FightEnemy. The first half drives the real `__battle_custom_fight` start command and the
// real stock_battle package on the script VM; the second half boots a whole game through the engine.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { UI_PLUGIN } from "../src/script/packs/ui.ts";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  BATTLE_PLUGIN,
  BinaryWriter,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  IR_VERSION,
  composeUi,
  CORE_PLUGIN,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  createInitialPlayer,
  createGameState,
  createPluginLayers,
  createScriptServices,
  defaultWaitPoll,
  enqueueDirectionMove,
  fileProgramRef,
  hashDrawList,
  hashGameState,
  hashState,
  nextUint32,
  PACKAGE_ROOT,
  registerActorObject,
  restoreGameState,
  runEventsPhase,
  runMovementPhase,
  runPackageStartup,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startThread,
  STATUS_EFFECT_MAGIC,
  STEP_BUDGET,
  verifyRestoredHandles,
  writeBattleBackground,
  WORLD_PLUGIN,
  writeBoard,
  writeCharacter,
  writeEnemy,
  writeMainFile,
  type Engine,
  type GameState,
  type PackageCatalogueEntry,
  type PluginLayers,
  type ProgramLoader,
  type BattleBackground,
  type ResolvedPlugin,
  type ScriptServices,
  type Wait,
  type WaitPoll,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const stockSource = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");
const stockManifest = JSON.parse(readFileSync(join(repoRoot, "stock", "stock_battle", "manifest.json"), "utf8")) as {
  readonly name: string;
  readonly version: string;
  readonly namespace: string;
  readonly requests: PackageCatalogueEntry["requests"];
};
const fightSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-custom-fight.prg"), "utf8");
const replacementBattleSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-replacement-package.prg"), "utf8");
const replacementStartSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-replacement-start.prg"), "utf8");
const gameOverSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-outcome-game-over.prg"), "utf8");
const mainFileApiSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-main-file-custom-fight.prg"), "utf8");
const mainFileQueriesSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-main-file-custom-fight-queries.prg"), "utf8");
const encoder = new TextEncoder();

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The engine's inline-script encoding of a request: four hex digits per UTF-16 code unit. */
function encodeRequest(value: unknown): string {
  const serialized = JSON.stringify(value);
  let encoded = "";
  for (let index = 0; index < serialized.length; index += 1) encoded += serialized.charCodeAt(index).toString(16).padStart(4, "0");
  return encoded;
}

// ---- authored assets ---------------------------------------------------------------------------------------

function boundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(values.length === 0 ? -1 : values.length - 1);
  for (const value of values) writer.str(value);
}

function enemyBytes(name: string): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT ENEMY");
  writer.i16(2);
  writer.i16(1);
  writer.str(name);
  for (const value of [8, 3, 3, 2]) writer.i32(value);
  writer.i8(1);
  writer.i16(-1);
  writer.i16(-1);
  boundedStrings(writer, []);
  boundedStrings(writer, []);
  boundedStrings(writer, []);
  writer.i8(0);
  writer.i8(0);
  writer.str("");
  writer.i32(5);
  writer.i32(3);
  writer.str("");
  writer.str("");
  boundedStrings(writer, ["", "", "", "", "", ""]);
  writer.i32(-1);
  return writer.toBytes();
}

function characterBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT CHAR");
  writer.i16(2);
  writer.i16(8);
  writer.str("Hero");
  for (const name of ["exp!", "dp!", "fp!", "hp!", "maxhp!", "name$", "smp!", "maxsm!", "level!"]) writer.str(name);
  for (const value of [10, 100, 100, 10, 40, 40, 40, 1]) writer.i32(value);
  writer.str("");
  for (let index = 0; index < 201; index += 1) {
    writer.str("");
    writer.i32(0);
    writer.i32(0);
    writer.str("");
    writer.str("");
  }
  writer.str("");
  writer.i8(0);
  for (let index = 0; index < 11; index += 1) writer.str("");
  for (let index = 0; index < 7; index += 1) writer.i8(1);
  writer.i32(90);
  writer.i16(5);
  writer.i32(0);
  for (let index = 0; index < 4; index += 1) writer.i16(5);
  writer.str("");
  writer.i8(0);
  writer.i8(1);
  for (let index = 0; index < 8; index += 1) writer.str("");
  for (let index = 0; index < 6; index += 1) writer.str("");
  for (let index = 0; index < 8; index += 1) writer.str("");
  writer.f64(3);
  writer.f64(0.05);
  writer.i32(-1);
  writer.i16(-1);
  return writer.toBytes();
}

function backgroundBytes(): Uint8Array {
  const result = writeBattleBackground({
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music: "",
    menuMoveSound: "",
    menuChooseSound: "",
    readySound: "",
    cantDoSound: "",
    residue: new Uint8Array(),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function statusEffectBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("Custom fight status");
  writer.i16(2);
  for (const value of [0, 0, 0, 0, 0, 0, 0, 0]) writer.i16(value);
  writer.str("");
  return writer.toBytes();
}

const authoredAssets: Readonly<Record<string, Uint8Array>> = {
  "night.bkg": backgroundBytes(),
  "slime.ene": enemyBytes("Slime"),
  "bat.ene": enemyBytes("Bat"),
  "player0.tem": characterBytes(),
  "player1.tem": characterBytes(),
};

// ---- E-79 name and stance queries (Epic 7.29) ----------------------------------------------------------------

/**
 * An enemy whose five ruled stance slots hold distinct animation files, so a query that reads the wrong slot cannot
 * pass: the enemy order is REST, FIGHT, DEFEND, SPECIAL MOVE, DIE
 * (docs/spec/engine/rpgcode-functions.md#fighteranimationfile, BAT-3 callback 122).
 */
function stanceEnemyBytes(name: string): Uint8Array {
  return unwrap(writeEnemy({
    magic: "RPGTLKIT ENEMY",
    major: 2,
    minor: 1,
    name,
    hp: 8,
    smp: 3,
    fp: 3,
    dp: 2,
    canRun: 1,
    criticalOn: -1,
    criticalBy: -1,
    specialMoves: [],
    weaknesses: [],
    strengths: [],
    aiLevel: 0,
    customAi: 0,
    aiProgram: "",
    experienceReward: 0,
    goldReward: 0,
    defeatProgram: "",
    runAwayProgram: "",
    stances: ["enemy-rest.anm", "enemy-fight.anm", "enemy-defend.anm", "enemy-special.anm", "enemy-die.anm", ""],
    customStances: [],
    residue: new Uint8Array(),
  }));
}

/**
 * A minor-5 character whose battle stances hold distinct animation files in the character order, which differs from
 * the enemy order: FIGHT, DEFEND, SPECIAL MOVE, DIE, REST (docs/spec/formats/character.md#layout slot 29).
 */
function stanceCharacterBytes(): Uint8Array {
  return unwrap(writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array.from({ length: 8 }, () => ""),
    battleStances: ["hero-fight.anm", "hero-defend.anm", "hero-special.anm", "hero-die.anm", "hero-rest.anm", ""],
  }));
}

/** The 5.11 custom request the evaluator posts: the board, the player and the program's name, and no fighters. */
function customRequest(program: string): Record<string, unknown> {
  return {
    trigger: "random",
    board: { key: "boards/field.brd", skill: 1, background: "night.bkg" },
    actor: { id: "player:0", kind: "player", index: 0, source: "player0.tem", x: 80, y: 63, layer: 0 },
    program,
  };
}

/** A dictionary object value as plain data, nested dictionaries included. */
function plain(state: GameState, value: unknown): unknown {
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object" && "handle" in value && typeof value.handle === "number") {
    const record = state.vm.objects.find((object) => object.handle === value.handle);
    if (record === undefined) throw new Error("the context object is not live");
    return Object.fromEntries(Object.entries(record.members).map(([name, member]) => [name, plain(state, member)]));
  }
  return value;
}

function actorSources(state: GameState, entries: readonly { readonly actorId: number }[]): (string | undefined)[] {
  return entries.map(({ actorId }) => state.actors.actors.find((actor) => actor.id === actorId)?.source);
}

// ---- the script VM rig -------------------------------------------------------------------------------------

const scriptBytes: Record<string, Uint8Array> = {
  [assetKey("Prg/stock-battle.prg")]: encoder.encode(stockSource),
  [assetKey("Prg/fight.prg")]: encoder.encode(fightSource),
  [assetKey("Prg/replacement-battle.prg")]: encoder.encode(replacementBattleSource),
  [assetKey("Prg/replacement-start.prg")]: encoder.encode(replacementStartSource),
  [assetKey("Prg/battle-outcome-game-over.prg")]: encoder.encode(gameOverSource),
};
const loader: ProgramLoader = {
  index: createAssetIndex(Object.keys(scriptBytes)),
  root: PACKAGE_ROOT,
  read: (key) => scriptBytes[key],
};
const plugins = [
  { definition: CORE_PLUGIN },
  { definition: CATALOGUE_STUBS_PLUGIN },
  { definition: CATALOGUE_RESPONDERS_PLUGIN },
  { definition: WORLD_PLUGIN },
  { definition: BATTLE_PLUGIN },
  { definition: UI_PLUGIN },
] as const;
const stockBattlePlugin: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [] },
};
const startupRef = { ...fileProgramRef(loader, "stock-battle.prg"), owner: "stock_battle" };
const replacementBattlePlugin: ResolvedPlugin = {
  namespace: "replacement_battle",
  definition: { id: "replacement_battle", version: "1.0.0", commands: [] },
};
const replacementStartupRef = { ...fileProgramRef(loader, "replacement-battle.prg"), owner: "replacement_battle" };
// A non-empty pool the custom path must never read: a drawn fight would request one of these files.
const enemyPool = [
  { enemyFile: "pool-a.ene", skillLevel: 1 },
  { enemyFile: "pool-b.ene", skillLevel: 1 },
] as const;
type EnemyPoolEntry = { readonly enemyFile: string; readonly skillLevel: number };
const replacementEnemyPool: readonly EnemyPoolEntry[] = [
  { enemyFile: "slime.ene", skillLevel: 1 },
  { enemyFile: "bat.ene", skillLevel: 1 },
];

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly layers: PluginLayers;
  readonly seed: number;
  readonly stock: boolean;
  readonly replacement: boolean;
  readonly pool: readonly EnemyPoolEntry[];
  readonly gameOverProgram: string | null;
  readonly players: readonly number[];
};

function servicesFor(
  state: GameState,
  layers: PluginLayers,
  stock: boolean,
  replacement = false,
  pool: readonly EnemyPoolEntry[] = enemyPool,
  gameOverProgram: string | null = null,
): ScriptServices {
  const battlePlugins = [
    ...(stock ? [stockBattlePlugin] : []),
    ...(replacement ? [replacementBattlePlugin] : []),
  ];
  return createScriptServices(
    state,
    [...plugins, ...battlePlugins],
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    gameOverProgram,
    { enemies: pool, stockBattleAvailable: stock },
  );
}

function makeRig(options: {
  readonly mode: string;
  readonly seed?: number;
  readonly players?: number;
  readonly stock?: boolean;
  readonly replacement?: boolean;
  readonly pool?: readonly EnemyPoolEntry[];
  readonly gameOverProgram?: string | null;
}): Rig {
  const seed = options.seed ?? 17;
  const stock = options.stock ?? true;
  const replacement = options.replacement ?? false;
  const pool = options.pool ?? enemyPool;
  const gameOverProgram = options.gameOverProgram ?? null;
  const state = createGameState({ seed });
  const players = Array.from({ length: options.players ?? 1 }, (_, index) => {
    const actor = addActor(state.actors, {
      kind: "party",
      source: `player${index}.tem`,
      name: `Player${index}`,
      stats: { experience: 0, hp: 20, maxHp: 20, smp: 6, maxSmp: 10, fp: 2, dp: 3, level: 1, criticalOn: -1, criticalBy: -1 },
    });
    registerActorObject(state.vm, state.events, state.actors, actor.id);
    return actor.id;
  });
  state.party.members = [...players];
  state.party.selected = players[0] ?? null;
  state.world = {
    ...state.world,
    board: {
      key: assetKey("boards/field.brd"),
      coordType: 0,
      sizeX: 1,
      sizeY: 1,
      sizeL: 1,
      width: 1,
      height: 1,
      background: { r: 0, g: 0, b: 0 },
      ambient: { r: 0, g: 0, b: 0 },
      layers: [],
    },
  };
  const layers = createPluginLayers();
  const battlePlugins = [
    ...(stock ? [stockBattlePlugin] : []),
    ...(replacement ? [replacementBattlePlugin] : []),
  ];
  const startupRefs = [
    ...(stock ? [startupRef] : []),
    ...(replacement ? [replacementStartupRef] : []),
  ];
  const services = servicesFor(state, layers, stock, replacement, pool, gameOverProgram);
  if (startupRefs.length > 0) runPackageStartup(state, services, startupRefs, battlePlugins);
  Object.assign(state.vm.globals, { custommode: options.mode, customcalls: 0, afterfight: 0, turncount: 0 });
  return { state, services, layers, seed, stock, replacement, pool, gameOverProgram, players };
}

/** Start the custom request the way the engine's battle applier does: one blocking thread, the encoded request. */
function startCustomRequest(rig: Rig, request: unknown, afterMarker = false): void {
  const call = `__battle_custom_fight(${JSON.stringify(encodeRequest(request))})`;
  startThread(rig.state.vm, {
    ref: { kind: "inline", text: afterMarker ? `global(afterCall)\n${call}\nafterCall = 1` : call, ir: IR_VERSION },
    kind: "blocking",
    owner: "script",
  });
}
function startReplacementProgram(rig: Rig): void {
  startThread(rig.state.vm, {
    ref: fileProgramRef(loader, "replacement-start.prg"),
    kind: "blocking",
    owner: "script",
  });
}

function pollAssets(rig: Rig): WaitPoll {
  return (view, wait: Wait) => {
    if (wait.kind !== "request") return defaultWaitPoll(view, wait);
    const request = rig.state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request;
    if (request === null || request === undefined) return defaultWaitPoll(view, wait);
    const name = typeof request.path === "string" ? request.path.toLowerCase().split("/").at(-1) ?? "" : "";
    const bytes = request.area === "enemies" || request.area === "characters" || request.area === "backgrounds" ? authoredAssets[name] : undefined;
    return bytes === undefined ? { ok: false, value: null } : { ok: true, value: hex(bytes) };
  };
}

function tick(rig: Rig, poll: WaitPoll): void {
  runWaitsPhase(rig.state.vm, { tick: rig.state.time.tick, events: rig.state.events }, poll, undefined, rig.services);
  runThreadsPhase(rig.state.vm, rig.services, STEP_BUDGET);
  runEventsPhase(rig.state, rig.services, STEP_BUDGET);
  rig.state.time.tick += 1;
}

function alive(state: GameState): boolean {
  return state.vm.threads.some((thread) => thread.status !== "finished");
}

function sleeping(state: GameState): boolean {
  return state.vm.threads.some((thread) => thread.wait?.kind === "sleep");
}

function tickUntil(rig: Rig, poll: WaitPoll, ready: () => boolean, limit = 600): void {
  for (let elapsed = 0; elapsed < limit; elapsed += 1) {
    tick(rig, poll);
    if (ready()) return;
  }
  throw new Error(`the custom fight did not reach the expected state: tick=${rig.state.time.tick} diagnostics=${JSON.stringify(rig.services.diagnostics.map(({ code }) => code))}`);
}

function runToEnd(rig: Rig, poll = pollAssets(rig)): void {
  tickUntil(rig, poll, () => !alive(rig.state));
}

function globals(rig: Rig): Record<string, unknown> {
  return rig.state.vm.globals;
}

function charges(state: GameState): number[][] {
  if (state.battle === null) throw new Error("no battle is active");
  return state.battle.parties.map((party) => party.map(({ charge }) => charge));
}

/** What the stock loop's seeding draws, in its order: every enemy against 123, then every player against 75. */
function expectedSeedCharges(seed: number, enemyCount: number, playerCount: number): number[][] {
  const rng = createGameState({ seed }).rng;
  const enemy: number[] = [];
  const player: number[] = [];
  for (let index = 0; index < enemyCount; index += 1) enemy.push(nextUint32(rng) % 123);
  for (let index = 0; index < playerCount; index += 1) player.push(nextUint32(rng) % 75);
  return [enemy, player];
}

test("a custom encounter runs the main file's program with the request as its context, loads no enemy and takes no random number", () => {
  const rig = makeRig({ mode: "record" });
  const rngBefore = clonePlain(rig.state.rng);
  const request = customRequest("fight.prg");
  startCustomRequest(rig, request);
  runToEnd(rig);
  const seen = globals(rig);
  equal(seen.customcalls, 1);
  equal(seen.seentrigger, "random");
  equal(seen.seenkey, "boards/field.brd");
  equal(seen.seenskill, 1);
  equal(seen.seenbackground, "night.bkg");
  equal(seen.seenactorid, "player:0");
  equal(seen.seenactorsource, "player0.tem");
  equal(seen.seenactorx, 80);
  equal(seen.seenactorlayer, 0);
  equal(seen.seenprogram, "fight.prg");
  equal(seen.afterfight, 1);
  equal(seen.seensource, 0, "the program starts with no source: the handle commands answer 0 for an empty slot");
  equal(seen.seentarget, 0, "the program starts with no target");
  deepEqual(plain(rig.state, seen.seencontext), { ...request, source: null, target: null }, "the request is the context");
  equal("fighters" in (plain(rig.state, seen.seencontext) as object), false, "a custom request carries no fighters");
  deepEqual(rig.state.rng, rngBefore, "the engine takes no random number for a custom encounter");
  equal(rig.state.battle, null);
  equal(rig.state.actors.actors.length, 1, "no enemy was loaded: only the party member exists");
  deepEqual(rig.services.diagnostics, []);
});

test("a custom request that carries fighters, a blank program or malformed fields is a located battle.bad-handoff and runs nothing", () => {
  const withoutProgram = customRequest("fight.prg");
  delete withoutProgram.program;
  const withoutBoard = customRequest("fight.prg");
  delete withoutBoard.board;
  const cases: readonly (readonly [string, unknown])[] = [
    ["fighters", { ...customRequest("fight.prg"), fighters: [{ party: "enemy", id: "enemy:0", index: 0, source: "slime.ene", skill: 1 }] }],
    ["blank program", customRequest("  ")],
    ["no program", withoutProgram],
    ["no board", withoutBoard],
    ["not a random trigger", { ...customRequest("fight.prg"), trigger: "board" }],
  ];
  for (const [label, request] of cases) {
    const rig = makeRig({ mode: "record" });
    startCustomRequest(rig, request);
    runToEnd(rig);
    ok(rig.services.diagnostics.some(({ code }) => code === "battle.bad-handoff"), `${label}: a located battle.bad-handoff`);
    equal(globals(rig).customcalls, 0, `${label}: the program did not run`);
    equal(rig.state.battle, null, `${label}: no battle exists`);
  }
});

test("a program that spells its enemies out with FightEnemy gets the BAT-9 setup and a complete stock battle", () => {
  const rig = makeRig({ mode: "fight-order", seed: 291, players: 2 });
  startCustomRequest(rig, customRequest("fight.prg"));
  const poll = pollAssets(rig);
  // The loop's first park is its one-tick sleep after it seeds every fighter's charge from the game's RNG.
  tickUntil(rig, poll, () => rig.state.battle !== null && sleeping(rig.state));
  const started = rig.state.battle;
  if (started === null) throw new Error("the battle did not start");
  deepEqual(actorSources(rig.state, started.parties[0]), ["bat.ene", "slime.ene", "bat.ene"], "the enemies are the written ones, in the order written, with the repeat kept");
  deepEqual(actorSources(rig.state, started.parties[1]), ["player0.tem", "player1.tem"]);
  equal(started.background, "night.bkg", "the context supplies the board's background");
  equal(started.canRun, true);
  deepEqual(charges(rig.state), expectedSeedCharges(rig.seed, 3, 2), "nothing drew a random number before the loop seeded the charges");
  tickUntil(rig, poll, () => globals(rig).afterfight === 1);
  equal(rig.state.battle?.outcome, 2, "the stock outcome path decided a win");
  equal(globals(rig).customcalls, 1);
  ok(Number(globals(rig).turncount) >= 1, "a player took a turn");
  deepEqual(rig.state.battle?.parties[0].map(({ actorId }) => rig.state.actors.actors.find((actor) => actor.id === actorId)?.stats.hp), [0, 0, 0]);
  const gold = rig.state.vm.effects.filter((effect) => effect.patch?.section === "inventory");
  equal(gold.length, 1, "the outcome adapter posted its one gold effect");
  deepEqual(gold[0]?.args, [{ type: "addGold", amount: 9 }]);
  deepEqual(rig.services.diagnostics, []);
  equal(alive(rig.state), false, "the program returned from FightEnemy and ended");
});

test("FightEnemy from a custom program accepts one to four enemies and refuses none or five without starting a battle", () => {
  for (const [mode, expected] of [["fight-one", ["slime.ene"]], ["fight-four", ["slime.ene", "bat.ene", "slime.ene", "bat.ene"]]] as const) {
    const rig = makeRig({ mode });
    startCustomRequest(rig, customRequest("fight.prg"));
    const poll = pollAssets(rig);
    tickUntil(rig, poll, () => rig.state.battle !== null);
    deepEqual(actorSources(rig.state, rig.state.battle!.parties[0]), expected, mode);
  }
  for (const mode of ["fight-none", "fight-five"]) {
    const rig = makeRig({ mode });
    startCustomRequest(rig, customRequest("fight.prg"));
    runToEnd(rig);
    ok(rig.services.diagnostics.some(({ code }) => code === "builtin.bad-arg"), `${mode}: a catchable builtin.bad-arg`);
    equal(rig.state.battle, null, `${mode}: no battle exists`);
    equal(globals(rig).afterfight, 1, `${mode}: the program carried on after the reported error`);
  }
});

test("a custom program name that matches no file is a catchable program.missing and starts no battle", () => {
  const rig = makeRig({ mode: "fight-order" });
  const rngBefore = clonePlain(rig.state.rng);
  startCustomRequest(rig, customRequest("missing.prg"), true);
  runToEnd(rig);
  ok(rig.services.diagnostics.some(({ code }) => code === "program.missing"), "the located program.missing diagnostic");
  equal(globals(rig).aftercall, 1, "the thread continued past the reported error to its explicit marker");
  equal(globals(rig).customcalls, 0, "nothing ran");
  equal(rig.state.battle, null);
  deepEqual(rig.state.rng, rngBefore);
});

test("without the stock_battle package a custom program still runs and its FightEnemy call is a catchable battle.package-missing", () => {
  const rig = makeRig({ mode: "fight-nopackage", stock: false });
  startCustomRequest(rig, customRequest("fight.prg"));
  runToEnd(rig);
  equal(globals(rig).customcalls, 1);
  ok(rig.services.diagnostics.some(({ code }) => code === "battle.package-missing"));
  equal(globals(rig).afterfight, 1, "the program carried on after the reported error");
  equal(rig.state.battle, null);
});
test("FightEnemy starts a core-prepared battle through a replacement loop without stock_battle", () => {
  const rig = makeRig({ mode: "replacement", stock: false, replacement: true });
  globals(rig).replacementstart = "explicit";
  globals(rig).replacementoutcome = 2;
  startReplacementProgram(rig);
  runToEnd(rig);
  equal(globals(rig).replacementbattlecalls, 1, `globals=${JSON.stringify(globals(rig))} diagnostics=${JSON.stringify(rig.services.diagnostics)} battle=${JSON.stringify(rig.state.battle)}`);
  equal(globals(rig).replacementfightcalls, 0, "FightEnemy does not dispatch through the fight wrapper");
  equal(globals(rig).replacementenemycount, 1);
  equal(globals(rig).replacementplayercount, 1);
  equal(globals(rig).replacementafter, 1);
  equal(rig.state.battle?.outcome, 2);
  deepEqual(rig.services.diagnostics, []);
});
test("Fight and FightEnemy run a replacement loop through every public finish outcome without stock_battle", () => {
  for (const [outcome, start] of [[0, "explicit"], [1, "random"], [2, "explicit"], [3, "random"], [4, "explicit"]] as const) {
    const rig = makeRig({
      mode: `replacement-${outcome}`,
      stock: false,
      replacement: true,
      pool: replacementEnemyPool,
      gameOverProgram: outcome === 4 ? "battle-outcome-game-over.prg" : null,
    });
    Object.assign(globals(rig), { replacementstart: start, replacementoutcome: outcome });
    startReplacementProgram(rig);
    runToEnd(rig);

    equal(globals(rig).replacementbattlecalls, 1, `outcome ${outcome}: replacement loop ran once`);
    equal(globals(rig).replacementfightcalls, start === "random" ? 1 : 0, `outcome ${outcome}: Fight uses the fight wrapper, FightEnemy does not`);
    ok(Number(globals(rig).replacementenemycount) >= 1 && Number(globals(rig).replacementenemycount) <= 4);
    equal(globals(rig).replacementplayercount, 1);
    equal(globals(rig).replacementafter, 1);
    deepEqual(rig.services.diagnostics, []);
    if (outcome === 4) {
      equal(rig.state.battle, null);
      equal(globals(rig).gameoverprogramcount, 1);
    } else {
      equal(rig.state.battle?.outcome, outcome);
    }

    const inventoryEffects = rig.state.vm.effects.filter((effect) => effect.patch?.section === "inventory");
    equal(inventoryEffects.length, outcome === 2 ? 1 : 0, `outcome ${outcome}: only a win applies gold`);
    if (outcome === 2) deepEqual(inventoryEffects[0]?.args[0], { type: "addGold", amount: 3 });
  }
});

test("a replacement package overrides the registered stock battle loop", () => {
  const rig = makeRig({ mode: "replacement-over-stock", stock: true, replacement: true, pool: replacementEnemyPool });
  globals(rig).replacementstart = "explicit";
  globals(rig).replacementoutcome = 2;
  startReplacementProgram(rig);
  runToEnd(rig);
  equal(globals(rig).replacementbattlecalls, 1);
  equal(globals(rig).replacementfightcalls, 0);
  equal(globals(rig).replacementafter, 1);
  equal(rig.state.battle?.outcome, 2);
  deepEqual(rig.services.diagnostics, []);
});

test("seeded Fight setup is deterministic with the replacement battle loop", () => {
  const run = (seed: number): { readonly enemies: (string | undefined)[]; readonly hash: string; readonly rng: unknown; readonly tick: number } => {
    const rig = makeRig({ mode: "replacement-seeded", seed, stock: false, replacement: true, pool: replacementEnemyPool });
    Object.assign(globals(rig), { replacementstart: "random", replacementoutcome: 2 });
    startReplacementProgram(rig);
    runToEnd(rig);
    const battle = rig.state.battle;
    if (battle === null) throw new Error("the replacement loop did not leave a completed battle");
    return {
      enemies: actorSources(rig.state, battle.parties[0]),
      hash: hashGameState(rig.state),
      rng: clonePlain(rig.state.rng),
      tick: rig.state.time.tick,
    };
  };
  const first = run(291);
  deepEqual(run(291), first);
  ok(run(292).hash !== first.hash, "a different seed changes the setup state");
});

test("a replacement battle restores while its registered loop is suspended", () => {
  const rig = makeRig({ mode: "replacement-restore", seed: 291, stock: false, replacement: true, pool: replacementEnemyPool });
  Object.assign(globals(rig), { replacementstart: "random", replacementoutcome: 2, replacementpause: 1 });
  startReplacementProgram(rig);
  const poll = pollAssets(rig);
  tickUntil(rig, poll, () => globals(rig).replacementbattlecalls === 1);
  ok(rig.state.battle !== null, "the replacement loop has an active battle");
  ok(
    sleeping(rig.state),
    `globals=${JSON.stringify(globals(rig))} threads=${JSON.stringify(rig.state.vm.threads.map(({ id, status, wait }) => ({ id, status, wait })))}`,
  );
  const saved = snapshot(rig.state);

  const layers = createPluginLayers();
  const scratch = createGameState({ seed: rig.seed });
  runPackageStartup(
    scratch,
    servicesFor(scratch, layers, false, true, rig.pool, rig.gameOverProgram),
    [replacementStartupRef],
    [replacementBattlePlugin],
  );
  const state = restoreGameState(saved);
  const services = servicesFor(state, layers, false, true, rig.pool, rig.gameOverProgram);
  verifyRestoredHandles(state.vm, services);
  const restored: Rig = { ...rig, state, services, layers };
  const restoredPoll = pollAssets(restored);
  equal(hashGameState(state), hashGameState(rig.state), "replacement state restores before resuming");
  for (let elapsed = 0; elapsed < 600 && globals(rig).replacementafter !== 1; elapsed += 1) {
    tick(rig, poll);
    tick(restored, restoredPoll);
    equal(hashGameState(state), hashGameState(rig.state), `replacement restore tick ${rig.state.time.tick}`);
  }
  equal(globals(rig).replacementafter, 1);
  equal(globals(restored).replacementafter, 1);
  equal(rig.state.battle?.outcome, 2);
  equal(restored.state.battle?.outcome, 2);
  deepEqual(rig.services.diagnostics, []);
  deepEqual(restored.services.diagnostics, []);
});

test("the same seed and program reproduce the same state, diagnostics and hash", () => {
  const run = (): { hash: string; diagnostics: readonly string[]; tick: number } => {
    const rig = makeRig({ mode: "fight-order", seed: 291, players: 2 });
    startCustomRequest(rig, customRequest("fight.prg"));
    const poll = pollAssets(rig);
    tickUntil(rig, poll, () => globals(rig).afterfight === 1);
    return { hash: hashGameState(rig.state), diagnostics: rig.services.diagnostics.map(({ code }) => code), tick: rig.state.time.tick };
  };
  const first = run();
  deepEqual(run(), first);
  const other = makeRig({ mode: "fight-order", seed: 292, players: 2 });
  startCustomRequest(other, customRequest("fight.prg"));
  tickUntil(other, pollAssets(other), () => globals(other).afterfight === 1);
  ok(hashGameState(other.state) !== first.hash, "a different seed gives a different battle");
});

/** Save at `saveTick`, restore into fresh services, and require the restored run to match the straight one tick by tick. */
function restoredRunMatches(saveTick: number): void {
  const rig = makeRig({ mode: "fight-order", seed: 291, players: 2 });
  startCustomRequest(rig, customRequest("fight.prg"));
  const poll = pollAssets(rig);
  while (rig.state.time.tick < saveTick) tick(rig, poll);
  const saved = snapshot(rig.state);
  const layers = createPluginLayers();
  const scratch = createGameState({ seed: rig.seed });
  runPackageStartup(scratch, servicesFor(scratch, layers, true), [startupRef], [stockBattlePlugin]);
  const state = restoreGameState(saved);
  const services = servicesFor(state, layers, true);
  verifyRestoredHandles(state.vm, services);
  const restored: Rig = { ...rig, state, services, layers };
  const restoredPoll = pollAssets(restored);
  equal(hashGameState(state), hashGameState(rig.state), `restored at tick ${saveTick}`);
  for (let elapsed = 0; elapsed < 600 && globals(rig).afterfight !== 1; elapsed += 1) {
    tick(rig, poll);
    tick(restored, restoredPoll);
    equal(hashGameState(state), hashGameState(rig.state), `restored at tick ${saveTick}, then tick ${rig.state.time.tick}`);
  }
  equal(globals(rig).afterfight, 1);
  equal(globals(restored).afterfight, 1);
  equal(restored.state.battle?.outcome, 2);
  deepEqual(restored.services.diagnostics, []);
}

test("a save taken while the custom program waits on its enemy files, inside the stock loop and during the outcome restores to the same run", () => {
  // With seed 291 the program starts on tick 0, ticks 1 to 3 wait on the three enemy files, ticks 4 to 7 sleep in the
  // stock loop, ticks 8 to 10 sit inside the cancelable damage event, and from tick 12 the outcome adapter waits on
  // the enemy and character files. These save points cross each of those stages.
  for (const saveTick of [1, 2, 4, 9, 11, 13, 15]) restoredRunMatches(saveTick);
});

// ---- the engine: a whole game boots, a custom request is posted, the program runs -----------------------------

type GameFiles = Map<string, Uint8Array>;

function fieldBoard(battles = false): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: {
      ...empty.properties,
      start: { x: 64, y: 64, layer: 1 },
      ...(battles ? { allowBattles: 1, battleSkill: 1, battleBackground: "night.bkg" } : {}),
    },
  }));
}

type GameOptions = {
  /** Whether the main file loads `stock_battle` (default true). */
  readonly stock?: boolean;
  /** The seed of the engine's game RNG (default 291). */
  readonly seed?: number;
  /** How many party members the hook seeds (default 1). */
  readonly heroes?: number;
  /**
   * Let the engine's own random-encounter evaluator post the custom request: the main file's fight settings and the
   * board's battle settings are authored, and the test posts nothing. Every tile the player steps is an encounter.
   */
  readonly encounter?: boolean;
  /** The main file's custom fight program (default "fight.prg"). */
  readonly customFight?: string;
  /**
   * Replace authored game files by their lower-case game path (`chrs/hero.tem`, `enemy/slime.ene`). A test that needs
   * different source data — distinct battle-stance animation names, for example — supplies it here.
   */
  readonly assets?: Readonly<Record<string, Uint8Array>>;
};

function authorGame(programs: Readonly<Record<string, string>>, options: GameOptions = {}): { readonly files: GameFiles; readonly paths: readonly string[] } {
  const files: GameFiles = new Map();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Enemy/slime.ene", "Enemy/bat.ene", "Bkrounds/night.bkg", "StatusE/custom-fight.ste"];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    // These fixtures place their own player (`createInitialPlayer`) and seed their own party, so the main file names
    // no initial character: E-02 would otherwise add a second player at the board start, and the movement double
    // that walks toward the encounter would move that one instead.
    initChar: "",
    useCustomFightPrg: 1,
    ...(options.encounter === true ? { fightingDisabled: 0, fightType: 1, chances: 1 } : {}),
    customFightPrg: options.customFight ?? "fight.prg",
    packagePlugins: options.stock === false ? [] : ["stock_battle"],
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), fieldBoard(options.encounter === true));
  files.set(assetKey("chrs/hero.tem"), characterBytes());
  files.set(assetKey("enemy/slime.ene"), authoredAssets["slime.ene"]!);
  files.set(assetKey("enemy/bat.ene"), authoredAssets["bat.ene"]!);
  files.set(assetKey("Bkrounds/night.bkg"), backgroundBytes());
  files.set(assetKey("StatusE/custom-fight.ste"), statusEffectBytes());
  for (const [name, text] of Object.entries(programs)) {
    paths.push(`Prg/${name}`);
    files.set(assetKey(`Prg/${name}`), encoder.encode(text));
  }
  for (const [path, bytes] of Object.entries(options.assets ?? {})) files.set(assetKey(path), bytes);
  return { files, paths };
}

function stockCatalogue(): readonly PackageCatalogueEntry[] {
  return [{
    name: stockManifest.name,
    version: stockManifest.version,
    namespace: stockManifest.namespace,
    requests: stockManifest.requests,
    definition: { id: stockManifest.name, version: stockManifest.version, commands: [] },
    startup: { kind: "inline", text: stockSource, ir: IR_VERSION, dialect: "tk3" },
  }];
}

type Booted = {
  readonly engine: Engine;
  readonly files: GameFiles;
  readonly diagnostics: { readonly code: string; readonly message: string }[];
  readonly posted: { rngAtPost: unknown };
  peek(): GameState | null;
  state(): GameState;
};

/**
 * Boot a game whose start program only sets `customMode` and `ready`. One phase registration then seeds a party member
 * and posts the custom request the evaluator would post, as a `triggers` effect, on the first running tick.
 */
function bootGame(mode: string, program = "fight.prg", extra: Readonly<Record<string, string>> = {}, options: GameOptions = {}): Booted {
  const game = authorGame({
    "start.prg": `customMode = "${mode}"\ncustomCalls = 0\nafterFight = 0\nturnCount = 0\nready = 1\nend()\n`,
    "fight.prg": fightSource,
    ...extra,
  }, options);
  let latest: GameState | null = null;
  let seeded = false;
  const posted = { rngAtPost: null as unknown };
  const engine = createEngine({
    seed: options.seed ?? 291,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-custom-fight-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 4000,
    packageCatalogue: options.stock === false ? [] : stockCatalogue(),
    phaseRegistrations: [...(options.encounter === true ? [{
      // The host's movement: the held right arrow walks the player one tile at a time while its queue is empty.
      phase: "movement" as const,
      run: (state: GameState) => {
        const player = state.sprites.players[0];
        if (player === undefined) return;
        if (state.input.held["ArrowRight"] === true && player.queue.moves.length === 0) enqueueDirectionMove(state.sprites, player.id, "E");
        runMovementPhase(state.sprites, state.world.board ?? null, state.time.tick, {});
      },
    }] : []), {
      phase: "triggers",
      run: (state, post) => {
        latest = state;
        if (seeded || post === undefined || state.vm.globals.ready !== 1 || state.world.board === null || state.world.board === undefined) return;
        seeded = true;
        const members = Array.from({ length: options.heroes ?? 1 }, (_, index) => {
          const hero = addActor(state.actors, {
            kind: "party",
            source: "hero.tem",
            name: index === 0 ? "Hero" : `Hero ${index + 1}`,
            stats: { experience: 0, hp: 20, maxHp: 20, smp: 6, maxSmp: 10, fp: 2, dp: 3, level: 1, criticalOn: -1, criticalBy: -1 },
          });
          registerActorObject(state.vm, state.events, state.actors, hero.id);
          return hero.id;
        });
        state.party.members = members;
        state.party.selected = members[0] ?? null;
        posted.rngAtPost = clonePlain(state.rng);
        if (options.encounter === true) {
          // The player's sprite stands on the board; the movement phase below walks it, and the engine's own
          // random-encounter evaluator watches the tiles it crosses.
          createInitialPlayer(state.sprites, state.world.board, { id: "player:0", kind: "player", source: "hero.tem", x: 80, y: 63, layer: 1 });
          return;
        }
        post("battle", {
          thread: 0,
          name: "battle.customFight",
          kind: "state-write",
          args: [{ ...customRequest(program), actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 80, y: 63, layer: 0 } }],
          out: {},
          result: null,
          patch: null,
          wait: null,
          request: null,
        });
      },
    }],
  });
  const diagnostics: { code: string; message: string }[] = [];
  return {
    engine,
    files: game.files,
    diagnostics,
    posted,
    peek: () => latest,
    state: () => {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
  };
}

/** Play the host: answer every asset request from the game's files until `done` holds or the guard runs out. */
function play(booted: Booted, done: (state: GameState) => boolean): void {
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } }[] = [];
  for (let guard = 0; guard < 4000; guard += 1) {
    const report = booted.engine.advance(1, replies);
    replies = [];
    booted.diagnostics.push(...report.diagnostics);
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: booted.files.get(request.key) ?? null } }]
        : []);
      continue;
    }
    const state = booted.peek();
    if (state !== null && done(state)) return;
  }
  throw new Error(`the engine did not settle: ${JSON.stringify(booted.diagnostics.map(({ code }) => code))}`);
}

test("the engine runs a custom request's program on a new thread with the request as context and takes no random number", () => {
  const booted = bootGame("record");
  play(booted, (state) => state.vm.globals.afterfight === 1);
  const state = booted.state();
  const seen = state.vm.globals;
  equal(seen.customcalls, 1);
  equal(seen.seentrigger, "random");
  equal(seen.seenkey, "boards/field.brd");
  equal(seen.seenbackground, "night.bkg");
  equal(seen.seenactorsource, "hero.tem");
  equal(seen.seenprogram, "fight.prg");
  equal("fighters" in (plain(state, seen.seencontext) as object), false);
  deepEqual(state.rng, booted.posted.rngAtPost, "no random number was taken between the request and the program's end");
  equal(state.battle, null);
  deepEqual(booted.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
});

test("the engine reports a custom request whose program is not in the game as program.missing and the game carries on", () => {
  const booted = bootGame("record", "nothing-here.prg");
  play(booted, (state) => state.vm.globals.ready === 1 && booted.diagnostics.some(({ code }) => code === "program.missing"));
  equal(booted.state().vm.globals.customcalls, 0);
  equal(booted.state().battle, null);
  for (let tick = 0; tick < 5; tick += 1) booted.engine.advance(1, []);
  equal(booted.state().engine.boot?.stage, "running");
});

test("the engine hands a custom program's FightEnemy call to the stock loop with the BAT-9 setup and no draw before the loop seeds", () => {
  const booted = bootGame("fight-order");
  // The loop's first park is its one-tick sleep after it seeds every fighter's charge from the game's RNG.
  play(booted, (state) => state.battle !== null && sleeping(state));
  const state = booted.state();
  const battle = state.battle;
  if (battle === null) throw new Error("the battle did not start");
  deepEqual(actorSources(state, battle.parties[0]), ["bat.ene", "slime.ene", "bat.ene"], "the written enemies, in the order written");
  deepEqual(actorSources(state, battle.parties[1]), ["hero.tem"]);
  equal(battle.background, "night.bkg");
  equal(battle.canRun, true);
  deepEqual(charges(state), expectedSeedCharges(291, 3, 1), "nothing drew a random number between the request and the loop's seeding");
  equal(state.vm.globals.customcalls, 1);
  equal(state.vm.globals.afterfight, 0, "the program is still inside FightEnemy, waiting on the stock loop");
  equal(alive(state), true);
  deepEqual(booted.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
});

test("the engine applies stock battle win rewards through Epic 8 inventory", () => {
  const booted = bootGame("fight-order");
  play(booted, (state) => state.vm.globals.afterfight === 1);
  const state = booted.state();
  equal(state.battle?.outcome, 2);
  equal(state.inventory.gold, 9);
  equal(booted.diagnostics.some(({ code }) => code === "menu.state-invalid"), false);
});

// ---- one main-file all-API program, the real custom-fight path, with and without stock_battle -----------------

type MainFileApiRun = {
  readonly outcome: number | null | undefined;
  readonly recorded: Record<string, unknown>;
  readonly stockPresent: boolean;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly gold: number;
  readonly diagnostics: readonly string[];
  readonly drewCustomText: boolean;
  readonly heroActorId: number | null;
  readonly enemyDefeatedDetailKeys: readonly (readonly string[])[];
};

const ARROW_RIGHT = { kind: "key" as const, name: "ArrowRight", code: "ArrowRight", char: "", down: true };
const ARROW_RIGHT_UP = { ...ARROW_RIGHT, down: false };
const ENTER = { kind: "key" as const, name: "Enter", code: "Enter", char: "", down: true };

/**
 * Boot a game whose main file names the all-API program as its custom fight program and whose fight settings and board
 * make every step an encounter. The test posts no request: it holds the arrow key, the engine's own evaluator rolls the
 * encounter and posts `battle.customFight`, and the engine runs the program, which registers its own battle handler and
 * starts the fight with the public FightEnemy. The handler then waits for a key, which the test delivers as input.
 */
function runMainFileApiFight(options: { readonly stock: boolean; readonly seed: number }): MainFileApiRun {
  const booted = bootGame("api", "api-fight.prg", { "api-fight.prg": mainFileApiSource }, {
    stock: options.stock,
    seed: options.seed,
    heroes: 2,
    encounter: true,
    customFight: "api-fight.prg",
  });
  const press = (event: typeof ARROW_RIGHT | typeof ENTER): void => {
    booted.engine.advance(0, [{ tick: booted.engine.advance(0, []).tickAfter, event }]);
  };
  play(booted, (state) => state.vm.globals.ready === 1 && state.party.members.length === 2);
  equal(booted.state().battle, null, "no fight exists before the player steps");
  press(ARROW_RIGHT);
  play(booted, (state) => state.vm.globals.apicalls === 1);
  press(ARROW_RIGHT_UP);

  // The program's own loop has started: the core prepared the battle, the handler runs, and it waits on a key.
  const waiting = booted.state();
  equal(waiting.battle?.outcome, null, "the fight is live while the loop waits for input");
  equal(waiting.vm.globals.apiafterfight, 0, "FightEnemy has not returned");
  equal(waiting.vm.globals.apicoverage, "party-size;battle-read;charge;stats;status;damage-defeated;draw;");
  ok(waiting.vm.threads.some((thread) => thread.wait?.kind === "input.key"), "the loop is parked on a key wait");
  equal(waiting.vm.globals.apipressed, 0, "no key has been read yet");

  press(ENTER);
  play(booted, (state) => state.vm.globals.apiafterfight === 1);
  // Drain the event queue the program filled (status changes and the two defeated emits) before reading any count.
  for (let tick = 0; tick < 5; tick += 1) booted.engine.advance(1, []);
  const state = booted.state();
  const detailKeys = (name: string): string[] => {
    const value = state.vm.globals[name];
    if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object" || !("handle" in value) || typeof value.handle !== "number") {
      throw new Error(`${name} did not hold an event detail`);
    }
    const record = state.vm.objects.find((object) => object.handle === value.handle);
    if (record === undefined) throw new Error(`${name} held a dangling object handle`);
    return [...record.keys];
  };
  // The event-detail globals hold VM object handles, whose numbers legitimately differ when the stock package is loaded;
  // their exact key sets are asserted from the live records above, so they stay out of the comparable state.
  const recorded = Object.fromEntries(Object.entries(state.vm.globals).filter(([name]) => name.startsWith("api") && !name.endsWith("detail")));
  // The comparable core state: everything the battle touches, without the clock or the package's own VM objects.
  const projection = clonePlain({
    battle: state.battle,
    actors: state.actors,
    party: state.party,
    rng: state.rng,
    inventory: state.inventory,
    recorded,
  });
  return {
    outcome: state.battle?.outcome,
    recorded,
    stockPresent: state.vm.globals.stockbattle !== undefined,
    stateHash: hashState(projection as Parameters<typeof hashState>[0]),
    drawHash: hashDrawList({ tick: 0, width: 640, height: 480, commands: composeUi(state.ui, 640, 480, state.input, false), marginCommands: [] }),
    gold: state.inventory.gold,
    diagnostics: booted.diagnostics.map(({ code, message }) => `${code}: ${message}`),
    drewCustomText: state.ui.draws.some((draw) => draw.text.startsWith("Custom fight ")),
    heroActorId: state.battle?.parties[1][0]?.actorId ?? null,
    enemyDefeatedDetailKeys: [detailKeys("apienemydefeateddetail"), detailKeys("apienemy2defeateddetail")],
  };
}

test("one main-file all-API custom fight program runs the real path identically with stock_battle absent and present-but-replaced", () => {
  const absent = runMainFileApiFight({ stock: false, seed: 291 });
  const replaced = runMainFileApiFight({ stock: true, seed: 291 });
  equal(absent.stockPresent, false, "the absent run has no stock_battle package, so any stock internal the program read would be a diagnostic");
  equal(replaced.stockPresent, true, "the replaced run has the stock_battle package loaded");

  for (const [label, run] of [["absent", absent], ["replaced", replaced]] as const) {
    deepEqual(run.diagnostics, [], `${label}: the program read nothing missing and reported nothing`);
    const seen = run.recorded;
    equal(seen.apicalls, 1, `${label}: the program's own battle handler ran once`);
    equal(seen.apicoverage, "party-size;battle-read;charge;stats;status;damage-defeated;draw;input;finish;");
    equal(seen.apiafterfight, 1, `${label}: FightEnemy returned to the program`);
    equal(seen.apienemycount, 2);
    equal(seen.apiherocount, 2);
    equal(seen.apiinitialoutcome, 0);
    equal(seen.apirunallowed, 1);
    equal(seen.apibackground, "night.bkg");
    equal(seen.apiaddedenemycharge, Number(seen.apiinitialenemycharge) + 8);
    equal(seen.apireleasedenemycharge, 0);
    equal(seen.apienemypercent, 18);
    equal(typeof seen.apiheropercent, "number");
    equal(seen.apiherohp, 9);
    equal(seen.apiheromaxhp, 21);
    equal(seen.apiherosmp, 5);
    equal(seen.apiheromaxsmp, 9);
    equal(seen.apiherofp, 6);
    equal(seen.apiherodp, 7);
    equal(seen.apistatusname, "custom-fight.ste");
    equal(seen.apistatuschanges, 2);
    equal(seen.apienemydamage, 8);
    equal(seen.apienemy2damage, 8);
    equal(seen.apienemydefeated, 1);
    equal(seen.apienemy2defeated, 1);
    ok(run.heroActorId !== null && run.heroActorId > 0, `${label}: the fight has a real hero actor id`);
    equal(seen.apienemydefeatedcause, "script", `${label}: the custom loop states the ruled cause`);
    equal(seen.apienemydefeatedsource, run.heroActorId, `${label}: the known hero actor id is the source`);
    deepEqual(run.enemyDefeatedDetailKeys[0], ["cause", "source"], `${label}: the first local detail carries exactly the ruled keys`);
    deepEqual(run.enemyDefeatedDetailKeys[1], ["cause", "source"], `${label}: the second local detail carries exactly the ruled keys`);
    equal(seen.apienemy2defeatedcause, "script");
    equal(seen.apienemy2defeatedsource, run.heroActorId);
    equal(seen.apigamedefeatedcount, 0, `${label}: no stock package re-emits the custom loop's defeated event on the game`);
    equal(typeof seen.apiseededroll, "number");
    equal(seen.apipressed, "Enter", `${label}: the program read the delivered key`);
    equal(run.outcome, 2, `${label}: the program's finish(2) took the BAT-8 outcome path`);
    equal(run.gold, 6, `${label}: the adapter paid both enemies' gold once`);
    ok(run.drewCustomText, `${label}: the program's drawing reached the UI`);
  }

  equal(replaced.outcome, absent.outcome);
  equal(replaced.stateHash, absent.stateHash, "the same seed and inputs reproduce the same core state with and without the package");
  equal(replaced.drawHash, absent.drawHash, "and the same draw list");
  deepEqual(replaced.recorded, absent.recorded, "and the same recorded values, including the seeded draw");

  const repeated = runMainFileApiFight({ stock: false, seed: 291 });
  equal(repeated.stateHash, absent.stateHash, "the same seed reproduces the run");
  equal(repeated.drawHash, absent.drawHash);
  const otherSeed = runMainFileApiFight({ stock: false, seed: 292 });
  ok(otherSeed.recorded.apiseededroll !== absent.recorded.apiseededroll, "a different seed changes the program's seeded roll");
  ok(otherSeed.stateHash !== absent.stateHash, "and the state hash");
  ok(otherSeed.drawHash !== absent.drawHash, "and the drawn text, which carries the roll");
  equal(otherSeed.recorded.apicoverage, absent.recorded.apicoverage, "while the program still covers the same operations");
});

// ---- 7.29: the E-79 queries that 7.12 leaves unasserted -----------------------------------------------------

test("a main-file custom fight with stock_battle absent reads fighter names and every stance animation through E-79", () => {
  // The main file names the focused query program as its custom fight program, no stock_battle package is loaded,
  // and both source assets store distinct names per stance, so a query that reads the wrong slot cannot pass.
  const booted = bootGame("queries", "queries.prg", { "queries.prg": mainFileQueriesSource }, {
    stock: false,
    seed: 307,
    heroes: 2,
    encounter: true,
    customFight: "queries.prg",
    assets: {
      "chrs/hero.tem": stanceCharacterBytes(),
      "enemy/slime.ene": stanceEnemyBytes("Slime"),
      "enemy/bat.ene": stanceEnemyBytes("Bat"),
    },
  });
  const press = (event: typeof ARROW_RIGHT): void => {
    booted.engine.advance(0, [{ tick: booted.engine.advance(0, []).tickAfter, event }]);
  };
  play(booted, (state) => state.vm.globals.ready === 1 && state.party.members.length === 2);
  press(ARROW_RIGHT);
  play(booted, (state) => state.vm.globals.queryafterfight === 1);
  press(ARROW_RIGHT_UP);

  const state = booted.state();
  const seen = state.vm.globals;
  equal(seen.stockbattle, undefined, "the main file loaded no stock_battle package");
  equal(seen.querycalls, 1, "the program's own battle handler ran once");
  equal(seen.queryafterfight, 1, "FightEnemy returned to the program");
  equal(state.battle?.outcome, 2, "the program's finish(2) took the BAT-8 outcome path with no package");
  deepEqual(booted.diagnostics.map(({ code, message }) => `${code}: ${message}`), [], "no query reached a missing package or asset");

  equal(seen.queryenemyname, "Slime", "callback 121 returns the first enemy's own display name");
  equal(seen.queryenemy2name, "Bat", "and the second enemy's, from its own record");
  equal(seen.queryheroname, "Hero", "and the first party member's actor name");
  equal(seen.queryhero2name, "Hero 2", "and the second party member's");

  equal(seen.queryenemyfight, "enemy-fight.anm", "callback 122 returns the enemy's FIGHT slot (slot 1 in the enemy order)");
  equal(seen.queryenemydefend, "enemy-defend.anm", "the enemy's DEFEND slot (2)");
  equal(seen.queryenemyspecial, "enemy-special.anm", "the enemy's SPECIAL MOVE slot (3)");
  equal(seen.queryenemydie, "enemy-die.anm", "the enemy's DIE slot (4)");
  equal(seen.queryenemyrest, "enemy-rest.anm", "the enemy's REST slot (0)");
  equal(seen.queryherofight, "hero-fight.anm", "and the character's FIGHT slot (0 in the character order)");
  equal(seen.queryherodefend, "hero-defend.anm", "the character's DEFEND slot (1)");
  equal(seen.queryherospecial, "hero-special.anm", "the character's SPECIAL MOVE slot (2)");
  equal(seen.queryherodie, "hero-die.anm", "the character's DIE slot (3)");
  equal(seen.queryherorest, "hero-rest.anm", "the character's REST slot (4)");
  equal(seen.queryenemyattackalias, "enemy-fight.anm", "the `attack` alias, matched ignoring case and punctuation, names the FIGHT slot");
});

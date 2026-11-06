import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  advanceScriptTick,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  BATTLE_PLUGIN,
  IR_VERSION,
  CORE_PLUGIN,
  createGameState,
  createMediaScriptService,
  createScriptServices,
  replyToRequest,
  restoreGameState,
  snapshot,
  startProgram,
  readStepCounters,
  STEP_BUDGET,
  writeBattleBackground,
  writeEnemy,
  type BattleBackground,
  type CommandResult,
  type Enemy,
  type GameState,
  type ScriptError,
  type ScriptServices,
} from "../src/index.ts";
import type { Arg, BuiltinSpec } from "../src/script/builtins.ts";
import type { CommandView } from "../src/script/plugin.ts";

type BattleStartServices = ScriptServices & {
  readonly mediaPosts: Array<{ readonly name: string; readonly args: readonly unknown[] }>;
};

const plugins = [{ definition: CORE_PLUGIN }, { definition: BATTLE_PLUGIN }] as const;
const enemyPool = [
  { enemyFile: "slime.ene", skillLevel: 1 },
  { enemyFile: "bat.ene", skillLevel: 1 },
] as const;

function authoredEnemy(name: string, canRun: number): Uint8Array {
  const enemy: Enemy = {
    magic: "RPGTLKIT ENEMY",
    major: 2,
    minor: 1,
    name,
    hp: 6,
    smp: 0,
    fp: 2,
    dp: 1,
    canRun,
    criticalOn: 0,
    criticalBy: 0,
    specialMoves: [],
    weaknesses: [],
    strengths: [],
    aiLevel: 0,
    customAi: 0,
    aiProgram: "",
    experienceReward: 1,
    goldReward: 1,
    defeatProgram: "",
    runAwayProgram: "",
    stances: ["", "", "", "", "", ""],
    customStances: [],
    residue: new Uint8Array(),
  };
  const result = writeEnemy(enemy);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function authoredBackground(music = ""): Uint8Array {
  const background: BattleBackground = {
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music,
    menuMoveSound: "",
    menuChooseSound: "",
    readySound: "",
    cantDoSound: "",
    residue: new Uint8Array(),
  };
  const result = writeBattleBackground(background);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
function encodeHandoff(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("handoff must serialize to plain data");
  let encoded = "";
  for (let index = 0; index < serialized.length; index += 1) {
    encoded += serialized.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}
function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function startState(seed = 17): GameState {
  const state = createGameState({ seed });
  const hero = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    name: "Hero",
    stats: { hp: 9, maxHp: 20, smp: 3, maxSmp: 5, dp: 2, fp: 4, level: 1 },
  });
  const fallen = addActor(state.actors, {
    kind: "party",
    source: "fallen.tem",
    name: "Fallen",
    stats: { hp: 0, maxHp: 10, level: 1 },
  });
  state.party.members = [hero.id, fallen.id];
  state.party.selected = hero.id;
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
  return state;
}

function services(
  state: GameState,
  stockBattleAvailable = true,
  enemies: readonly { readonly enemyFile: string; readonly skillLevel: number }[] = enemyPool,
  musicFiles: readonly string[] = ["battle.mid"],
) {
  const mediaPosts: Array<{ readonly name: string; readonly args: readonly unknown[] }> = [];
  const media = createMediaScriptService(
    state,
    (name, args) => {
      mediaPosts.push({ name, args });
      return { seq: mediaPosts.length };
    },
    (file) => musicFiles.includes(file) ? assetKey(`media/${file}`) : null,
    () => {},
  );
  const scriptServices = createScriptServices(
    state,
    plugins,
    undefined,
    undefined,
    undefined,
    "battle-start-test",
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    media,
    undefined,
    undefined,
    null,
    { enemies, stockBattleAvailable },
  );
  return { ...scriptServices, mediaPosts };
}

function startingHp(state: GameState, party: readonly { readonly actorId: number }[] | undefined): (number | undefined)[] {
  return (party ?? []).map(({ actorId }) => state.actors.actors.find((actor) => actor.id === actorId)?.stats.hp);
}

function command(name: string): BuiltinSpec {
  const spec = BATTLE_PLUGIN.commands.find((candidate) => candidate.name === name);
  if (spec === undefined) throw new Error(`missing battle builtin ${name}`);
  return spec;
}
function parsePending(encoded: string): { enemySources: string[]; next: number } {
  const value: unknown = JSON.parse(encoded);
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("enemySources" in value) || !("next" in value) || !Array.isArray(value.enemySources)) {
    throw new Error("battle setup continuation has an invalid shape");
  }
  const next = value.next;
  if (typeof next !== "number" || !Number.isSafeInteger(next)) throw new Error("battle setup continuation has an invalid cursor");
  const enemySources: string[] = [];
  for (const source of value.enemySources) {
    if (typeof source !== "string") throw new Error("battle setup continuation has an invalid enemy source");
    enemySources.push(source);
  }
  return { enemySources, next };
}

function invoke(spec: BuiltinSpec, view: CommandView, values: readonly unknown[]): CommandResult {
  const args: Arg[] = values.map((value) => ({ value: value as Arg["value"], ref: null }));
  return spec.call(view, args, () => ({ value: null }));
}
function failureCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as ScriptError).code;
  }
  throw new Error("expected battle setup to fail");
}

function finishRequestedBattleAssets(
  view: CommandView,
  first: CommandResult,
  assets: Readonly<Record<string, Uint8Array>>,
): CommandResult {
  let result = first;
  for (let guard = 0; result.request !== undefined; guard += 1) {
    if (guard >= 8) throw new Error("battle setup requested too many assets");
    const path = result.request.path;
    const continuation = result.then?.args[0];
    const handler = result.then?.command;
    if (typeof path !== "string" || typeof continuation !== "string" || typeof handler !== "string") {
      throw new Error("battle setup did not preserve a plain continuation");
    }
    const bytes = assets[path] ?? (result.request.area === "backgrounds" ? authoredBackground() : undefined);
    if (bytes === undefined) throw new Error(`missing authored battle asset fixture ${path}`);
    result = invoke(command(handler), view, [1, hex(bytes), continuation]);
  }
  return result;
}

function requestId(state: GameState): number {
  const thread = state.vm.threads.find((candidate) => candidate.wait?.kind === "request");
  if (thread?.wait?.kind !== "request") throw new Error("expected a saved enemy request");
  return thread.wait.reqId;
}

function resumeSavedStart(state: GameState, service: BattleStartServices, enemyBytes: Uint8Array): void {
  for (let guard = 0; guard < 8; guard += 1) {
    const thread = state.vm.threads.find((candidate) => candidate.wait?.kind === "request");
    if (thread?.wait?.kind !== "request") return;
    const bytes = thread.wait.then?.command === "__battle_start_background_asset" ? authoredBackground() : enemyBytes;
    replyToRequest(state.vm, thread.wait.reqId, { ok: true, value: hex(bytes) });
    advanceScriptTick(state, service);
  }
  throw new Error("saved battle start did not settle");
}

test("Fight draws one to four matching enemies deterministically from the seeded RNG", () => {
  const draw = (seed: number) => {
    const state = startState(seed);
    const service = services(state);
    const result = invoke(command("fight"), service.view, [1, "night.bkg"]);
    if (result.then?.args[0] === undefined || typeof result.then.args[0] !== "string") throw new Error("Fight must save its asset continuation as plain data");
    return parsePending(result.then.args[0]);
  };
  const first = draw(73);
  const restoredSeed = draw(73);
  deepEqual(first, restoredSeed);
  equal(first.enemySources.length >= 1 && first.enemySources.length <= 4, true);
  equal(first.enemySources.every((source) => source === "slime.ene" || source === "bat.ene"), true);
  const observedCounts = new Set<number>();
  for (let seed = 1; seed <= 64; seed += 1) observedCounts.add(draw(seed).enemySources.length);
  ok(observedCounts.has(1) && observedCounts.has(4), "seeded count boundaries include one and four enemies");

  const state = startState();
  const service = services(state);
  const empty = invoke(command("fight"), service.view, [9, "night.bkg"]);
  equal(empty.request, undefined);
  equal(empty.effects?.[0]?.kind, "vm.control");
  const ref = empty.effects?.[0]?.args?.[1];
  equal(typeof ref === "object" && ref !== null && "text" in ref ? ref.text : null, 'mwin("No enemies of skill level 9 found.")');
});

test("FightEnemy loads explicit enemies in order and BAT-9 includes fallen players", () => {
  const state = startState();
  const service = services(state);
  const rngBefore = clonePlain(state.rng);
  const first = invoke(command("fightenemy"), service.view, ["slime", "bat.ene", "night.bkg"]);
  const completed = finishRequestedBattleAssets(service.view, first, {
    "slime.ene": authoredEnemy("Slime", 1),
    "bat.ene": authoredEnemy("Bat", 0),
  });
  deepEqual(state.rng, rngBefore, "explicit enemy setup consumes no random draws");
  equal(completed.effects?.[0]?.kind, "vm.control");
  const battle = state.battle;
  ok(battle);
  equal(battle.background, "night.bkg");
  equal(battle.canRun, false);
  deepEqual(battle.parties.map((party) => party.map((fighter) => fighter.party)), [[0, 0], [1, 1]]);
  deepEqual(battle.parties[0]?.map((fighter) => state.actors.actors.find((actor) => actor.id === fighter.actorId)?.source), ["slime.ene", "bat.ene"]);
  deepEqual(battle.parties[1]?.map((fighter) => state.actors.actors.find((actor) => actor.id === fighter.actorId)?.name), ["Hero", "Fallen"]);
  equal(battle.parties[1]?.[1]?.charge, 0);
  deepEqual(startingHp(state, battle.parties[0]), [6, 6], "the enemies start at their file's HP");
  deepEqual(startingHp(state, battle.parties[1]), [9, 0], "the party keeps its current HP and the fallen member starts fallen");
});

test("Fight completes setup with ordered parties, the background, canRun from every drawn enemy and starting HP including fallen members", () => {
  const assets = { "slime.ene": authoredEnemy("Slime", 1), "bat.ene": authoredEnemy("Bat", 0) };
  const sourcesFor = (seed: number): string[] => {
    const state = startState(seed);
    const first = invoke(command("fight"), services(state).view, [1, "night.bkg"]);
    const continuation = first.then?.args[0];
    if (typeof continuation !== "string") throw new Error("Fight must save its asset continuation as plain data");
    return parsePending(continuation).enemySources;
  };
  let withBat: number | null = null;
  let slimeOnly: number | null = null;
  for (let seed = 1; seed <= 64 && (withBat === null || slimeOnly === null); seed += 1) {
    const sources = sourcesFor(seed);
    if (withBat === null && sources.includes("bat.ene")) withBat = seed;
    if (slimeOnly === null && sources.every((source) => source === "slime.ene")) slimeOnly = seed;
  }
  if (withBat === null || slimeOnly === null) throw new Error("no seed in range draws both a forbidding and an all-runnable group");

  for (const [seed, canRun] of [[withBat, false], [slimeOnly, true]] as const) {
    const state = startState(seed);
    const service = services(state);
    const first = invoke(command("fight"), service.view, [1, "night.bkg"]);
    const drawn = parsePending(String(first.then?.args[0])).enemySources;
    const rngAfterDraw = clonePlain(state.rng);
    const completed = finishRequestedBattleAssets(service.view, first, assets);
    deepEqual(completed.effects?.map(({ kind, args }) => [kind, args?.[0], args?.[1]]), [["vm.control", "executeProgramRef", { kind: "inline", text: "battle()", ir: IR_VERSION }]], `seed ${seed}: completion starts the registered battle handler`);
    deepEqual(state.rng, rngAfterDraw, `seed ${seed}: setup after the draw takes no further random number`);
    const battle = state.battle;
    ok(battle, `seed ${seed}: a battle exists`);
    equal(battle.background, "night.bkg");
    equal(battle.canRun, canRun, `seed ${seed}: canRun is false when any drawn enemy forbids running`);
    deepEqual(battle.parties[0]?.map((fighter) => state.actors.actors.find((actor) => actor.id === fighter.actorId)?.source), drawn, `seed ${seed}: the enemies are the drawn ones in drawn order`);
    deepEqual(battle.parties[1]?.map((fighter) => state.actors.actors.find((actor) => actor.id === fighter.actorId)?.name), ["Hero", "Fallen"]);
    deepEqual(startingHp(state, battle.parties[0]), drawn.map(() => 6));
    deepEqual(startingHp(state, battle.parties[1]), [9, 0], `seed ${seed}: the fallen member starts fallen`);
  }
});
test("battle setup starts a resolved background music asset on the battle track", () => {
  const state = startState();
  const service = services(state);
  const first = invoke(command("fightenemy"), service.view, ["slime", "night.bkg"]);
  finishRequestedBattleAssets(service.view, first, {
    "slime.ene": authoredEnemy("Slime", 1),
    "night.bkg": authoredBackground("battle.mid"),
  });
  ok(state.battle);
  deepEqual(service.mediaPosts, [{
    name: "music.play",
    args: [assetKey("media/battle.mid"), true, false, "battle"],
  }]);

  const missingState = startState();
  const missingService = services(missingState, true, enemyPool, []);
  const missingFirst = invoke(command("fightenemy"), missingService.view, ["slime", "night.bkg"]);
  finishRequestedBattleAssets(missingService.view, missingFirst, {
    "slime.ene": authoredEnemy("Slime", 1),
    "night.bkg": authoredBackground("missing.mid"),
  });
  equal(missingState.battle !== null, true);
  deepEqual(missingService.mediaPosts, []);
});

test("FightEnemy enforces one-to-four enemy boundaries and preserves order", () => {
  const state = startState();
  const service = services(state);
  equal(failureCode(() => invoke(command("fightenemy"), service.view, ["night.bkg"])), "builtin.bad-arg");
  equal(failureCode(() => invoke(command("fightenemy"), service.view, ["slime", "slime", "slime", "slime", "slime", "night.bkg"])), "builtin.bad-arg");

  const oneState = startState();
  const oneService = services(oneState);
  const one = invoke(command("fightenemy"), oneService.view, ["slime", "night.bkg"]);
  finishRequestedBattleAssets(oneService.view, one, { "slime.ene": authoredEnemy("Slime", 1) });
  equal(oneState.battle?.parties[0]?.length, 1);

  const fourState = startState();
  const fourService = services(fourState);
  const four = invoke(command("fightenemy"), fourService.view, ["slime", "bat", "slime", "bat", "night.bkg"]);
  finishRequestedBattleAssets(fourService.view, four, {
    "slime.ene": authoredEnemy("Slime", 1),
    "bat.ene": authoredEnemy("Bat", 1),
  });
  equal(fourState.battle?.parties[0]?.length, 4);
  deepEqual(
    fourState.battle?.parties[0]?.map((fighter) => fourState.actors.actors.find((actor) => actor.id === fighter.actorId)?.source),
    ["slime.ene", "bat.ene", "slime.ene", "bat.ene"],
  );
});

test("random encounter handoff uses its drawn enemies without drawing again", () => {
  const state = startState(29);
  const service = services(state);
  const rngBefore = clonePlain(state.rng);
  const handoff = {
    trigger: "random",
    board: { key: "boards/field.brd", skill: 1, background: "night.bkg" },
    actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 32, y: 48, layer: 1 },
    fighters: [
      { party: "player", id: "player:0", index: 0, source: "hero.tem", skill: null },
      { party: "enemy", id: "enemy:0", index: 0, source: "slime.ene", skill: 1 },
      { party: "enemy", id: "enemy:1", index: 1, source: "bat.ene", skill: 1 },
    ],
  };
  const first = invoke(command("__battle_start_handoff"), service.view, [encodeHandoff(handoff)]);
  finishRequestedBattleAssets(service.view, first, {
    "slime.ene": authoredEnemy("Slime", 1),
    "bat.ene": authoredEnemy("Bat", 0),
  });
  deepEqual(state.rng, rngBefore);
  equal(state.battle?.background, "night.bkg");
  deepEqual(state.battle?.parties.map((party) => party.map((fighter) => fighter.party)), [[0, 0], [1, 1]]);
  deepEqual(
    state.battle?.parties[0]?.map((fighter) => state.actors.actors.find((actor) => actor.id === fighter.actorId)?.source),
    ["slime.ene", "bat.ene"],
  );
  equal(typeof JSON.stringify(state.battle), "string");
  equal(state.battle?.canRun, false, "canRun comes from the drawn enemy that forbids running");

  const runnableState = startState(29);
  const runnableService = services(runnableState);
  const runnableRng = clonePlain(runnableState.rng);
  const runnableFirst = invoke(command("__battle_start_handoff"), runnableService.view, [encodeHandoff(handoff)]);
  finishRequestedBattleAssets(runnableService.view, runnableFirst, {
    "slime.ene": authoredEnemy("Slime", 1),
    "bat.ene": authoredEnemy("Bat", 1),
  });
  deepEqual(runnableState.rng, runnableRng, "deriving canRun draws nothing");
  equal(runnableState.battle?.canRun, true, "canRun is true when every drawn enemy allows running");
});

test("battle setup validates party, package and enemy run permissions", () => {
  const noParty = startState(37);
  noParty.party.members = [];
  const noPartyService = services(noParty);
  const emptyRng = clonePlain(noParty.rng);
  equal(failureCode(() => invoke(command("fight"), noPartyService.view, [1, "night.bkg"])), "battle.empty-party");
  deepEqual(noParty.rng, emptyRng);

  const noPackage = startState(41);
  const noPackageService = services(noPackage, false);
  const noPackageRng = clonePlain(noPackage.rng);
  equal(failureCode(() => invoke(command("fight"), noPackageService.view, [1, "night.bkg"])), "battle.package-missing");
  deepEqual(noPackage.rng, noPackageRng);
  const noPool = startState(43);
  const noPoolService = services(noPool, false, []);
  const noPoolRng = clonePlain(noPool.rng);
  const noPoolResult = invoke(command("fight"), noPoolService.view, [1, "night.bkg"]);
  equal(noPoolResult.effects?.[0]?.kind, "vm.control");
  const noPoolRef = noPoolResult.effects?.[0]?.args?.[1];
  equal(typeof noPoolRef === "object" && noPoolRef !== null && "text" in noPoolRef ? noPoolRef.text : null, 'mwin("No enemies of skill level 1 found.")');
  deepEqual(noPool.rng, noPoolRng);

  const runnable = startState();
  const runnableService = services(runnable);
  const first = invoke(command("fightenemy"), runnableService.view, ["slime", "night.bkg"]);
  finishRequestedBattleAssets(runnableService.view, first, { "slime.ene": authoredEnemy("Slime", 2) });
  equal(runnable.battle?.canRun, true);
});

test("random encounter handoff reports a missing stock package before requesting assets", () => {
  const state = startState();
  const service = services(state, false);
  const handoff = {
    trigger: "random",
    board: { key: "boards/field.brd", skill: 1, background: "night.bkg" },
    actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 32, y: 48, layer: 1 },
    fighters: [
      { party: "player", id: "player:0", index: 0, source: "hero.tem", skill: null },
      { party: "enemy", id: "enemy:0", index: 0, source: "slime.ene", skill: 1 },
    ],
  };
  equal(failureCode(() => invoke(command("__battle_start_handoff"), service.view, [encodeHandoff(handoff)])), "battle.package-missing");
  equal(state.battle, null);
});


test("battle setup request and seeded draws survive save and restore mid-start", () => {
  const first = startState(91);
  const firstServices = services(first);
  startProgram(first.vm, { kind: "inline", text: '__battle_prepare_random(1, "night.bkg")', ir: "1" });
  advanceScriptTick(first, firstServices);
  const pendingId = requestId(first);
  const saved = snapshot(first);
  const restored = restoreGameState(saved);
  const restoredServices = services(restored);
  equal(requestId(restored), pendingId);

  const bytes = authoredEnemy("Slime", 1);
  resumeSavedStart(first, firstServices, bytes);
  resumeSavedStart(restored, restoredServices, bytes);
  deepEqual(restored.battle, first.battle);
  deepEqual(restored.rng, first.rng);
  deepEqual(restored.actors, first.actors);
});
test("four-enemy battle setup stays within STEP_BUDGET across asset continuations", () => {
  let seedWithFour = 0;
  for (let seed = 1; seed <= 64; seed += 1) {
    const preview = startState(seed);
    const previewService = services(preview);
    const result = invoke(command("__battle_prepare_random"), previewService.view, [1, "night.bkg"]);
    const encoded = result.then?.args[0];
    if (typeof encoded !== "string") throw new Error("random setup did not preserve a plain continuation");
    const pending: unknown = JSON.parse(encoded);
    if (typeof pending !== "object" || pending === null || Array.isArray(pending) || !("enemySources" in pending) || !Array.isArray(pending.enemySources)) {
      throw new Error("random setup continuation has no enemy source list");
    }
    if (pending.enemySources.length === 4) {
      seedWithFour = seed;
      break;
    }
  }
  if (seedWithFour === 0) throw new Error("the authored seeds did not select the four-enemy boundary");

  const state = startState(seedWithFour);
  const service = services(state);
  startProgram(state.vm, { kind: "inline", text: '__battle_prepare_random(1, "night.bkg")', ir: "1", owner: "stock_battle" });
  const thread = state.vm.threads[0]!;
  let maxSteps = 0;
  for (let guard = 0; guard < 8 && thread.status !== "finished"; guard += 1) {
    const beforeSteps = readStepCounters(state.vm).stock_battle ?? 0;
    if (thread.wait?.kind === "request") {
      const bytes = thread.wait.then?.command === "__battle_start_background_asset" ? authoredBackground() : authoredEnemy("Slime", 1);
      replyToRequest(state.vm, thread.wait.reqId, { ok: true, value: hex(bytes) });
    }
    advanceScriptTick(state, service, STEP_BUDGET);
    const used = (readStepCounters(state.vm).stock_battle ?? 0) - beforeSteps;
    maxSteps = Math.max(maxSteps, used);
    ok(used < STEP_BUDGET, `battle setup consumed ${used} steps, below ${STEP_BUDGET}`);
  }
  equal(thread.status, "finished");
  ok(state.battle !== null);
  ok(maxSteps > 0);
});

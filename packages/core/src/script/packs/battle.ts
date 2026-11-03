import type { StatusEffect } from "../../formats/battle/model.ts";
import { readSpecialMove } from "../../formats/battle/special-move.ts";
import { readBattleBackground } from "../../formats/battle/battle-background.ts";
import { readCharacter } from "../../formats/actor/character.ts";
import { readEnemy } from "../../formats/actor/enemy.ts";
import { readItem } from "../../formats/actor/item.ts";
import { readStatusEffect } from "../../formats/battle/status-effect.ts";
import type { Result } from "../../formats/result.ts";
import { BinaryReader } from "../../formats/binary/reader.ts";
import { canon } from "../../canon/index.ts";
import { createObject, findObject, readMember, writeMember } from "../objects.ts";
import type { ActorId, ActorStats } from "../../actors/model.ts";
import { actorInputFromEnemy } from "../../actors/hydrate.ts";
import { registerActorObject } from "../../actors/object.ts";
import type { BattleAction, BattleOperationResult } from "../../battle/port.ts";
import type { ObjectValue, Value } from "../../ports/value.ts";
import type { ObjectRecord } from "../state.ts";
import type { Arg, BuiltinDoc, BuiltinSpec, ParamSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import { recordDiagnostic } from "../effects.ts";
import type { CommandEffect, CommandResult, CommandView, PluginDefinition } from "../plugin.ts";
import { IR_VERSION } from "../program.ts";
import type { PlainData } from "../../ports/plain-data.ts";
import { surfaceSize } from "../../raster/surfaces.ts";
import type { SurfaceId } from "../../ports/keys.ts";

const GROUP = "battle-stats-menus-33";
const NO_WAIT = { kind: "never", summary: "Completes in the current script turn." } as const;
const STATUS_WAIT = { kind: "host-request", summary: "Waits for the host to load and return the requested StatusE `.ste` asset." } as const;
const FIGHTER_HANDLES = "Handles accept `source` or `target` from the current script thread, a party-member name resolved in the actor store's ordered party, an actor object (including the object returned by `battle.fighter(...)`), or an enemy reference `{ party: 0, index }` with a zero-based index.";
const STAT_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.bad-fighter", when: "the handle does not identify an actor or its enemy-reference position is invalid" },
  { code: "battle.not-active", when: "an enemy reference is used without an active battle" },
  { code: "builtin.bad-arg", when: "a stat value or amount is not a valid safe integer for the actor owner" },
];
const STAT_READ_THROWS = STAT_THROWS.filter((item) => item.code !== "builtin.bad-arg");

type StatusOperation = "apply" | "remove";

function parameter(name: string, optional = false, byRef = false): ParamSpec {
  return { name, optional, byRef, variadic: false };
}

function numeric(args: readonly Arg[], index: number): number {
  const value = args[index]?.value;
  return typeof value === "number" ? value : Number.NaN;
}

function integer(args: readonly Arg[], index: number, name: string): number {
  const value = numeric(args, index);
  if (!Number.isSafeInteger(value)) throw new ScriptError("builtin.bad-arg", `${name}: argument ${index + 1} must be a safe integer`);
  return value;
}

function text(args: readonly Arg[], index: number): string {
  const value = args[index]?.value;
  return typeof value === "string" ? value : "";
}

function output(args: readonly Arg[], index: number, value: Value): CommandResult["out"] {
  return args[index] === undefined || args[index]?.ref === null ? [] : [[index, value]];
}

const STATUS_APPLY_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "the target does not identify an active fighter" },
  { code: "asset.missing", when: "the requested StatusE asset is missing" },
  { code: "request.bad-reply", when: "the host asset reply is not valid hexadecimal bytes" },
  { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
  { code: "builtin.bad-arg", when: "the `.ste` rounds value is not a safe integer" },
];
const STATUS_REMOVE_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "the target does not identify an active fighter" },
  { code: "asset.missing", when: "the requested StatusE asset is missing" },
  { code: "request.bad-reply", when: "the host asset reply is not valid hexadecimal bytes" },
  { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
];

function documentation(
  summary: string,
  behaviour: string,
  throws: NonNullable<BuiltinDoc["throws"]> = STAT_THROWS,
  waits: BuiltinDoc["waits"] = NO_WAIT,
): BuiltinDoc {
  return { summary, behaviour, groups: [GROUP], tags: ["legacy"], waits, throws };
}

const BATTLE_READ_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "the party, index, or fighter position is invalid" },
];
const BATTLE_PARTY_SIZE_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-fighter", when: "party is not 0 or 1" },
];
const BATTLE_CHARGE_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  ...BATTLE_READ_THROWS,
  { code: "builtin.bad-arg", when: "the charge or resulting stored charge is not finite" },
];
const BATTLE_FINISH_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "battle.not-active", when: "there is no active battle" },
  { code: "battle.bad-outcome", when: "the outcome is not an integer from 0 through 4" },
  { code: "battle.already-finished", when: "the battle already has an outcome" },
  { code: "battle.cannot-run", when: "outcome 0 is requested while canRun is false" },
];

function internalDocumentation(summary: string, behaviour: string, throws: NonNullable<BuiltinDoc["throws"]> = []): BuiltinDoc {
  return { summary, behaviour, groups: ["internal"], access: "internal", waits: NO_WAIT, throws };
}

const BATTLE_OUTCOME_ADAPTER = `
local(outcome) = battle.outcome
// BAT-6: every participant's statuses end with the battle. Capture both parties
// before outcome handling, because a loss discards the battle section.
local(clearSide)
local(clearIndex)
local(clearSize)
local(clearCount) = 0
local(clearActors) = {}
local(gameOver)
local(size)
local(index)
local(enemy)
local(data)
local(enemyData)
local(reward)
local(runProgram)
local(playerCount)
local(playerIndex)
local(fighter)
local(characterData)
local(plan)
local(step)
local(context)
local(levels)
local(stepFailed)
clearSide = 0
while (clearSide < 2) {
  clearSize = battle.partySize(clearSide)
  clearIndex = 0
  while (clearIndex < clearSize) {
    clearActors[clearCount] = __battle_actor_ref(clearSide, clearIndex)
    clearCount = clearCount + 1
    clearIndex = clearIndex + 1
  }
  clearSide = clearSide + 1
}
if (outcome == 4) {
  __battle_end_loss()
  gameOver = __battle_game_over_program()
  if (gameOver != "") {
    executeProgram(gameOver, { source: null, target: null })
  } else {
    mwin("Game over.")
    reset()
  }
}
if (outcome == 0) {
  size = battle.partySize(0)
  index = 0
  enemyData = {}
  while (index < size) {
    enemy = { party: 0, index: index }
    data = battleenemydata(enemy)
    if (data != null) {
      enemyData[index] = data
    }
    index = index + 1
  }
  reward = __battle_outcome_rewards(enemyData, size)
  runProgram = reward.runprogram
  if (runProgram != "") {
    executeProgram(runProgram, { source: null, target: null })
  }
}
if (outcome == 2) {
  size = battle.partySize(0)
  index = 0
  enemyData = {}
  while (index < size) {
    enemy = { party: 0, index: index }
    data = battleenemydata(enemy)
    if (data != null) {
      enemyData[index] = data
    }
    index = index + 1
  }
  reward = __battle_outcome_rewards(enemyData, size)
  __battle_gain_gold(reward)
  if (reward.experience > 0) {
    mwin("Gained " + reward.experience + " experience.")
  }
  playerCount = battle.partySize(1)
  playerIndex = 0
  while (playerIndex < playerCount) {
    fighter = __battle_actor_ref(1, playerIndex)
    if (fighter != "") {
      characterData = battlecharacterdata(fighter)
      plan = __battle_experience_begin(fighter, reward)
      if (plan != null) {
        if (plan.legacy != 0) {
          stepFailed = 0
          while (__battle_experience_step_ready(fighter, plan) != 0 && stepFailed == 0) {
            if (characterData != null && characterData.levelupprogram != "") {
              context = __battle_levelup_context(fighter)
              executeProgram(characterData.levelupprogram, context)
            }
            step = __battle_experience_step(fighter, plan)
            if (step != null) {
              plan = step.plan
              if (step.leveled != 0) {
                mwin(step.name + " gained a level")
              }
            } else {
              stepFailed = 1
            }
          }
        } else {
          levels = plan.levels
          while (levels > 0) {
            mwin(plan.name + " gained a level")
            levels = levels - 1
          }
        }
      }
    }
    playerIndex = playerIndex + 1
  }
  if (reward.gold > 0) {
    mwin("Gained " + reward.gold + " GP.")
  }
  runProgram = reward.winprogram
  if (runProgram != "") {
    executeProgram(runProgram, { source: null, target: null })
  }
}
clearIndex = 0
while (clearIndex < clearCount) {
  __battle_clear_statuses(clearActors[clearIndex])
  clearIndex = clearIndex + 1
}
game.emit("battleEnded", { outcome: outcome })
`;

function outcomeAdapterEffect(): CommandEffect {
  const ref = {
    kind: "inline",
    text: BATTLE_OUTCOME_ADAPTER,
    ir: IR_VERSION,
    dialect: "tk3",
  };
  return { kind: "vm.control", args: ["executeProgramRef", ref as PlainData] };
}

function owner(view: CommandView) {
  if (view.battle === undefined) throw new ScriptError("battle.not-active", "there is no active battle");
  return view.battle;
}

function resolve<T>(result: BattleOperationResult<T>): T {
  if (!result.ok) throw new ScriptError(result.error.code, result.error.message);
  return result.value;
}

function display(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "unknown";
}

function badFighter(value: unknown): never {
  throw new ScriptError("battle.bad-fighter", `unknown fighter handle "${display(value)}" (party=unknown, index=unknown)`);
}

function folded(value: string): string {
  return value.replaceAll("\\", "/").trim().toLowerCase();
}

function actorRecord(view: CommandView, id: number) {
  return view.actors?.readActor(id) ?? null;
}

function partyActor(view: CommandView, value: string): ActorId | undefined {
  const state = view.state;
  if (state === undefined || view.actors === undefined) return undefined;
  const wanted = folded(value);
  for (const id of state.party.members) {
    const actor = actorRecord(view, id);
    if (actor !== null && (String(actor.id) === wanted || folded(actor.name) === wanted || folded(actor.source) === wanted)) return actor.id;
  }
  return undefined;
}

function anyActor(view: CommandView, value: string): ActorId | undefined {
  const state = view.state;
  if (state === undefined || view.actors === undefined) return undefined;
  const wanted = folded(value);
  const sprite = state.sprites.players.find((player) => folded(player.id) === wanted);
  if (sprite?.actorId !== null && sprite?.actorId !== undefined && actorRecord(view, sprite.actorId) !== null) return sprite.actorId;
  const actor = state.actors.actors.find((candidate) =>
    String(candidate.id) === wanted || folded(candidate.name) === wanted || folded(candidate.source) === wanted,
  );
  return actor?.id;
}

function actorIdForObject(view: CommandView, handle: number): ActorId | undefined {
  const state = view.state;
  if (state === undefined || view.actors === undefined) return undefined;
  const record = state.vm.objects.find((candidate) => candidate.handle === handle);
  if (record?.hostType !== "actor") return undefined;
  for (const [key, registeredHandle] of Object.entries(state.events.emitters ?? {})) {
    if (registeredHandle !== handle || !key.startsWith("actor:")) continue;
    const id = Number(key.slice("actor:".length));
    if (Number.isSafeInteger(id) && actorRecord(view, id) !== null) return id as ActorId;
  }
  return undefined;
}

function sourceOrTarget(view: CommandView, name: "source" | "target"): ActorId | undefined {
  const state = view.state;
  const thread = state?.vm.threads.find((candidate) => candidate.id === view.thread);
  const value = thread?.[name];
  if (value === null || value === undefined) return undefined;
  return anyActor(view, value) ?? partyActor(view, value);
}

function referenceActor(view: CommandView, value: Value | undefined): ActorId {
  const state = view.state;
  if (typeof value === "string") {
    const token = value.toLowerCase();
    if (token === "source" || token === "target") {
      const id = sourceOrTarget(view, token);
      return id === undefined ? badFighter(value) : id;
    }
    const id = partyActor(view, value);
    return id === undefined ? badFighter(value) : id;
  }
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object") {
    const actorId = actorIdForObject(view, value.handle);
    if (actorId !== undefined) return actorId;
    const members = view.objectMembers?.(value.handle) ?? state?.vm.objects.find((record) => record.handle === value.handle)?.members;
    if (members !== undefined && (Object.hasOwn(members, "party") || Object.hasOwn(members, "index"))) {
      const party = typeof members.party === "number" ? members.party : Number.NaN;
      const index = typeof members.index === "number" ? members.index : Number.NaN;
      if (party !== 0) throw new ScriptError("battle.bad-fighter", `enemy references require party 0 (party=${display(members.party)}, index=${display(members.index)})`);
      return resolve(owner(view).fighter(party, index)).actorId;
    }
  }
  return badFighter(value);
}

function activeBattleActor(view: CommandView, value: Value | undefined): ActorId {
  const battle = owner(view);
  resolve(battle.partySize(0));
  const id = referenceActor(view, value);
  for (const party of [0, 1] as const) {
    const size = resolve(battle.partySize(party));
    for (let index = 0; index < size; index += 1) {
      const fighter = battle.fighter(party, index);
      if (fighter.ok && fighter.value.actorId === id) return id;
    }
  }
  throw new ScriptError("battle.bad-fighter", `actor ${id} is not an active fighter (party=unknown, index=unknown)`);
}

function statusPath(value: string): string {
  let path = value.trim().replaceAll("\\", "/").replace(/^StatusE\//i, "");
  if (!path.toLowerCase().endsWith(".ste")) path += ".ste";
  return path;
}

function statusSource(view: CommandView): ActorId | null {
  const state = view.state;
  const thread = state?.vm.threads.find((candidate) => candidate.id === view.thread);
  if (thread?.source === null || thread?.source === undefined) return null;
  return anyActor(view, thread.source) ?? partyActor(view, thread.source) ?? null;
}

function statusRequest(view: CommandView, args: readonly Arg[], operation: StatusOperation): CommandResult {
  const target = activeBattleActor(view, args[0]?.value);
  return {
    value: null,
    request: { kind: "asset", area: "statusEffects", path: statusPath(text(args, 1)) },
    then: { command: "__battle_status_asset", args: [operation, target, statusSource(view), statusPath(text(args, 1))] },
  };
}

function replyBytes(args: readonly Arg[], what: string): Uint8Array {
  if (numeric(args, 0) !== 1) throw new ScriptError("asset.missing", `${what} asset was not found`);
  const hex = text(args, 1);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new ScriptError("request.bad-reply", `${what} asset reply must be hexadecimal bytes`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

const EMPTY_REQUEST_ARGS: readonly PlainData[] = [];

function requestDataAsset(area: string, path: string, continuation: string, args: readonly PlainData[] = EMPTY_REQUEST_ARGS): CommandResult {
  return { value: null, request: { kind: "asset", area, path }, then: { command: continuation, args } };
}

function dataAssetContinuation<T>(
  what: string,
  formatCode: string,
  parse: (reader: BinaryReader) => Result<T>,
  complete: (view: CommandView, args: readonly Arg[], data: T) => CommandResult,
): BuiltinSpec["call"] {
  return (view, args) => {
    const data = parse(new BinaryReader(replyBytes(args, what)));
    if (!data.ok) throw new ScriptError(formatCode, data.error.message);
    return complete(view, args, data.value);
  };
}

function statusFileReply(args: readonly Arg[]): Result<StatusEffect> {
  return readStatusEffect(new BinaryReader(replyBytes(args, "status effect")));
}
function diagnoseStatusDuration(view: CommandView, file: string, rounds: number): void {
  if (rounds >= 1 || view.state === undefined) return;
  recordDiagnostic(
    view.state.vm, view.state.time.tick, view.thread ?? 0, "battle.status-duration", `StatusE/${file}`, 0,
    `StatusE/${file} has fewer than one round; the status lasts until removed`,
  );
}
function statusContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  const status = statusFileReply(args);
  if (!status.ok) throw new ScriptError("format.status-effect", status.error.message);
  const operation = text(args, 2);
  const actorId = integer(args, 3, "battle status operation");
  if (operation !== "apply" && operation !== "remove") throw new ScriptError("request.bad-reply", "unknown status operation");
  const sourceValue = args[4]?.value;
  const source = typeof sourceValue === "number" && Number.isSafeInteger(sourceValue) && sourceValue > 0 ? sourceValue as ActorId : null;
  const file = text(args, 5);
  let rounds = status.value.rounds;
  diagnoseStatusDuration(view, file, rounds);
  if (operation === "apply") {
    if (!Number.isSafeInteger(rounds)) throw new ScriptError("builtin.bad-arg", "applystatus: StatusE rounds must be a safe integer");
    rounds = Math.max(rounds, 0);
  }
  const actors = view.actors;
  if (actors === undefined) throw new ScriptError("battle.bad-fighter", "unknown status target (party=unknown, index=unknown)");
  const result = operation === "apply"
    ? actors.applyStatus(actorId, file, rounds, { source })
    : actors.removeStatus(actorId, file, { source });
  if (result === null) throw new ScriptError("battle.bad-fighter", "unknown status target (party=unknown, index=unknown)");
  return { value: null };
}
function statusFlagsContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  const status = statusFileReply(args);
  if (!status.ok) throw new ScriptError("format.status-effect", status.error.message);
  diagnoseStatusDuration(view, text(args, 2), status.value.rounds);
  const object = createObject(view.state!.vm, null);
  writeMember(object, "speed", status.value.speedUp !== 0 ? 1 : 0);
  writeMember(object, "slow", status.value.slowDown !== 0 ? 1 : 0);
  writeMember(object, "disable", status.value.disable !== 0 ? 1 : 0);
  return { value: { kind: "object", handle: object.handle, className: object.className } };
}

const STATUS_FLAGS_ASSET = {
  name: "__battle_status_flags_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("file")],
  doc: internalDocumentation("Resume a StatusE flag request.", "Reads the StatusE asset and returns only its normalized speed, slow and disable values."),
  call: statusFlagsContinuation,
} satisfies BuiltinSpec;

const STATUS_FLAGS = {
  name: "statusflags", aliases: [], params: [parameter("file")],
  doc: {
    summary: "Read a status file's speed, slow and disable flags.",
    behaviour: "Requests the normalized StatusE `.ste` asset and returns a dictionary with numeric `speed`, `slow` and `disable` values of 1 or 0. It reads only the file and does not change actor counters or stats.",
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: STATUS_WAIT,
    throws: [
      { code: "asset.missing", when: "the requested StatusE asset is missing" },
      { code: "request.bad-reply", when: "the host reply is not valid hexadecimal bytes" },
      { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
    ],
  },
  call: (_view: CommandView, args: readonly Arg[]) => ({
    value: null,
    request: { kind: "asset", area: "statusEffects", path: statusPath(text(args, 0)) },
    then: { command: "__battle_status_flags_asset", args: [statusPath(text(args, 0))] },
  }),
} satisfies BuiltinSpec;

const STATUS_DATA_ASSET = {
  name: "__battle_status_data_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("file")],
  doc: internalDocumentation("Resume a StatusE data request.", "Reads the `.ste` asset and returns its duration, normalized flags, signed per-round HP/SMP values and program reference."),
  call: dataAssetContinuation("status effect", "format.status-effect", readStatusEffect, (view, args, status) => {
    diagnoseStatusDuration(view, text(args, 2), status.rounds);
    const object = createObject(view.state!.vm, null);
    writeMember(object, "rounds", status.rounds);
    writeMember(object, "speed", status.speedUp !== 0 ? 1 : 0);
    writeMember(object, "slow", status.slowDown !== 0 ? 1 : 0);
    writeMember(object, "disable", status.disable !== 0 ? 1 : 0);
    writeMember(object, "hp", status.hpEnabled !== 0 ? 1 : 0);
    writeMember(object, "hpamount", status.hpPerRound);
    writeMember(object, "smp", status.smpEnabled !== 0 ? 1 : 0);
    writeMember(object, "smpamount", status.smpPerRound);
    writeMember(object, "runprogram", status.runProgram !== 0 ? 1 : 0);
    writeMember(object, "program", status.program);
    return { value: { kind: "object", handle: object.handle, className: object.className } };
  }),
} satisfies BuiltinSpec;

const STATUS_DATA = {
  name: "statusdata", aliases: [], params: [parameter("file")],
  doc: {
    summary: "Read a status file's battle-round data.",
    behaviour: "Requests `StatusE/<file>.ste` (prefix and extension may be omitted) and returns `{ rounds, speed, slow, disable, hp, hpamount, smp, smpamount, runprogram, program }`. The six flag fields are normalized to numeric 1 or 0; rounds and signed per-round amounts are read verbatim, and program is the file reference. This reads no actor state and applies no effects.",
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: STATUS_WAIT,
    throws: [
      { code: "asset.missing", when: "the requested StatusE asset is missing" },
      { code: "request.bad-reply", when: "the host reply is not valid hexadecimal bytes" },
      { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
    ],
  },
  call: (_view: CommandView, args: readonly Arg[]) => {
    const path = statusPath(text(args, 0));
    return requestDataAsset("statusEffects", path, "__battle_status_data_asset", [path]);
  },
} satisfies BuiltinSpec;


function assetPath(value: string, folder: string, extension: string, command: string): string {
  let path = value.trim().replaceAll("\\", "/");
  if (path.toLowerCase().startsWith(`${folder.toLowerCase()}/`)) path = path.slice(folder.length + 1);
  if (path === "") throw new ScriptError("builtin.bad-arg", `${command}: the file name must not be empty`);
  return path.toLowerCase().endsWith(extension) ? path : `${path}${extension}`;
}

type BattleStartPending = {
  readonly boardKey: string;
  readonly background: string;
  readonly enemySources: string[];
  readonly loadedHex: string[];
  readonly next: number;
  readonly playerIds: number[];
  readonly runStock: boolean;
};

function pendingBattleStart(encoded: string): BattleStartPending {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new ScriptError("battle.bad-handoff", "battle start continuation is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScriptError("battle.bad-handoff", "battle start continuation is not an object");
  }
  const record = value as Record<string, unknown>;
  const strings = (item: unknown): item is string[] =>
    Array.isArray(item) && item.every((entry) => typeof entry === "string");
  const ids = (item: unknown): item is number[] =>
    Array.isArray(item) && item.every((entry) => typeof entry === "number" && Number.isSafeInteger(entry) && entry > 0);
  if (
    typeof record.boardKey !== "string" || record.boardKey === "" ||
    typeof record.background !== "string" ||
    !strings(record.enemySources) || record.enemySources.length === 0 || record.enemySources.length > 4 ||
    !strings(record.loadedHex) || typeof record.next !== "number" || !Number.isSafeInteger(record.next) || record.next < 0 ||
    record.loadedHex.length !== record.next || record.next > record.enemySources.length ||
    !ids(record.playerIds) || record.playerIds.length === 0 ||
    typeof record.runStock !== "boolean"
  ) throw new ScriptError("battle.bad-handoff", "battle start continuation fields are invalid");
  return {
    boardKey: record.boardKey,
    background: record.background,
    enemySources: record.enemySources,
    loadedHex: record.loadedHex,
    next: record.next,
    playerIds: record.playerIds,
    runStock: record.runStock,
  };
}

function validatedPartyIds(view: CommandView): readonly number[] {
  const members = view.state?.party.members;
  if (members === undefined || members.length === 0) {
    throw new ScriptError("battle.empty-party", "cannot start a battle with an empty party");
  }
  if (members.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new ScriptError("battle.bad-fighter", "player party contains an invalid actor id");
  }
  return members;
}

function statePartyIds(view: CommandView): number[] {
  return [...validatedPartyIds(view)];
}

function seededBelow(view: CommandView, limit: number): number {
  const range = 0x1_0000_0000;
  const ceiling = Math.floor(range / limit) * limit;
  let value: number;
  do value = view.rng.nextUint32();
  while (value >= ceiling);
  return value % limit;
}

function hasBattleHandler(view: CommandView): boolean {
  return view.battleStart?.hasBattleHandler?.() ?? (view.battleStart?.stockBattleAvailable === true);
}

function startBattleAssetRequest(view: CommandView, pending: BattleStartPending): CommandResult {
  const source = pending.enemySources[pending.next]!;
  return {
    value: null,
    request: { kind: "asset", area: "enemies", path: source },
    then: { command: "__battle_start_enemy_asset", args: [JSON.stringify(pending)] },
  };
}

function startBattleBackgroundRequest(view: CommandView, pending: BattleStartPending): CommandResult {
  if (pending.background === "") return finishBattleStart(view, pending, "");
  return {
    value: null,
    request: { kind: "asset", area: "backgrounds", path: assetPath(pending.background, "Bkrounds", ".bkg", "fight") },
    then: { command: "__battle_start_background_asset", args: [JSON.stringify(pending)] },
  };
}

function pendingStart(
  view: CommandView,
  boardKey: string,
  background: string,
  enemySources: readonly string[],
  runLoop: boolean,
): BattleStartPending {
  if (enemySources.length < 1 || enemySources.length > 4) {
    throw new ScriptError("builtin.bad-arg", "a battle must have between one and four enemies");
  }
  return {
    boardKey,
    background,
    enemySources: enemySources.map((source) => assetPath(source, "Enemy", ".ene", "fight")),
    loadedHex: [],
    next: 0,
    playerIds: statePartyIds(view),
    runStock: runLoop,
  };
}

function registeredBattleLoop(): CommandEffect {
  return {
    kind: "vm.control",
    args: ["executeProgramRef", {
      kind: "inline",
      text: "battle()",
      ir: IR_VERSION,
    }, null, null],
  };
}

function finishBattleStart(view: CommandView, pending: BattleStartPending, backgroundMusic: string): CommandResult {
  const state = view.state;
  const actors = view.actors;
  const battle = view.battle;
  if (state === undefined || actors === undefined || battle === undefined) {
    throw new ScriptError("battle.not-active", "battle start owners are unavailable");
  }
  const enemies = pending.loadedHex.map((hex, index) => {
    const bytes = replyBytes([{ value: 1, ref: null }, { value: hex, ref: null }], "enemy");
    const parsed = readEnemy(new BinaryReader(bytes));
    if (!parsed.ok) throw new ScriptError("format.enemy", parsed.error.message);
    return { source: pending.enemySources[index]!, enemy: parsed.value };
  });
  for (const id of pending.playerIds) {
    const player = actors.readActor(id);
    if (player?.kind !== "party") throw new ScriptError("battle.bad-fighter", `party actor ${id} does not exist`);
  }
  const enemyIds = enemies.map(({ source, enemy }) => actors.create(actorInputFromEnemy(source, enemy)).id);
  const started = battle.start({
    boardKey: pending.boardKey,
    background: pending.background,
    canRun: enemies.every(({ enemy }) => enemy.canRun !== 0),
    enemies: enemyIds,
    players: pending.playerIds,
  });
  if (!started.ok) throw new ScriptError(started.error.code, started.error.message);
  if (backgroundMusic !== "") view.media?.playBattleMusic(backgroundMusic);
  return pending.runStock ? { value: null, effects: [registeredBattleLoop()] } : { value: null };
}

function battleStartAssetContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  const bytes = replyBytes(args, "enemy");
  const pending = pendingBattleStart(text(args, 2));
  const hex = text(args, 1);
  if (bytes.length * 2 !== hex.length) throw new ScriptError("request.bad-reply", "enemy asset reply changed while starting a battle");
  const next: BattleStartPending = {
    ...pending,
    loadedHex: [...pending.loadedHex, hex.toLowerCase()],
    next: pending.next + 1,
  };
  return next.next < next.enemySources.length ? startBattleAssetRequest(view, next) : startBattleBackgroundRequest(view, next);
}
function battleStartBackgroundAssetContinuation(view: CommandView, args: readonly Arg[]): CommandResult {
  const pending = pendingBattleStart(text(args, 2));
  const background = readBattleBackground(new BinaryReader(replyBytes(args, "battle background")));
  if (!background.ok) throw new ScriptError("format.battle-background", background.error.message);
  return finishBattleStart(view, pending, background.value.music);
}

function beginBattleStart(view: CommandView, boardKey: string, background: string, sources: readonly string[], runLoop: boolean): CommandResult {
  if (boardKey === "" || typeof background !== "string") throw new ScriptError("battle.bad-handoff", "battle start requires a board key and background");
  if (runLoop && !hasBattleHandler(view)) {
    throw new ScriptError("battle.package-missing", "no battle handler is registered");
  }
  return startBattleAssetRequest(view, pendingStart(view, boardKey, background, sources, runLoop));
}

function beginRandomBattle(view: CommandView, skill: number, background: string, runLoop: boolean): CommandResult {
  const state = view.state;
  const setup = view.battleStart;
  const board = state?.world.board;
  if (setup === undefined || board === null || board === undefined) {
    throw new ScriptError("battle.no-board", "Fight requires a loaded board and main-file enemy pool");
  }
  const pool = setup.enemies.filter((enemy) => enemy.skillLevel === skill);
  if (pool.length === 0) {
    const message = `No enemies of skill level ${skill} found.`;
    const ref = { kind: "inline" as const, text: `mwin(${JSON.stringify(message)})`, ir: IR_VERSION };
    return { value: null, effects: [{ kind: "vm.control", args: ["executeProgramRef", ref, null, null] }] };
  }
  if (runLoop && !hasBattleHandler(view)) {
    throw new ScriptError("battle.package-missing", "no battle handler is registered");
  }
  validatedPartyIds(view);
  const count = 1 + seededBelow(view, 4);
  const sources = Array.from({ length: count }, () => pool[seededBelow(view, pool.length)]!.enemyFile);
  return beginBattleStart(view, board.key, background, sources, runLoop);
}

function beginExplicitBattle(view: CommandView, args: readonly Arg[], runLoop: boolean, allowEmpty = false): CommandResult {
  if (args.length < 2 || args.length > 5) {
    throw new ScriptError("builtin.bad-arg", "FightEnemy requires one to four enemy files followed by a background");
  }
  const background = args[args.length - 1]?.value;
  if (typeof background !== "string") throw new ScriptError("builtin.bad-arg", "FightEnemy background must be a string");
  const names = args.slice(0, -1).map((arg) => arg.value);
  if (allowEmpty) {
    const compact = names.filter((value) => value !== 0 && value !== "");
    if (compact.some((value) => typeof value !== "string")) throw new ScriptError("builtin.bad-arg", "enemy file names must be strings");
    if (compact.length === 0) throw new ScriptError("builtin.bad-arg", "battle setup requires at least one enemy file");
    return beginBattleStart(view, view.state?.world.board?.key ?? "", background, compact as string[], runLoop);
  }
  if (names.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new ScriptError("builtin.bad-arg", "FightEnemy enemy file names must be non-empty strings");
  }
  if (runLoop && !hasBattleHandler(view)) {
    throw new ScriptError("battle.package-missing", "no battle handler is registered");
  }
  const boardKey = view.state?.world.board?.key;
  if (boardKey === undefined) throw new ScriptError("battle.no-board", "FightEnemy requires a loaded board");
  return beginBattleStart(view, boardKey, background, names as string[], runLoop);
}

function decodeHandoffJson(encoded: string): string {
  if (encoded.length % 4 !== 0) throw new ScriptError("battle.bad-handoff", "random battle handoff encoding is invalid");
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 4) {
    const unit = encoded.slice(index, index + 4);
    if (!/^[\da-f]{4}$/i.test(unit)) throw new ScriptError("battle.bad-handoff", "random battle handoff encoding is invalid");
    decoded += String.fromCharCode(Number.parseInt(unit, 16));
  }
  return decoded;
}

type EncounterRequest = {
  readonly record: Readonly<Record<string, unknown>>;
  readonly board: { readonly key: string; readonly skill: number; readonly background: string };
  readonly actor: {
    readonly id: string;
    readonly kind: "player";
    readonly index: number;
    readonly source: string;
    readonly x: number;
    readonly y: number;
    readonly layer: number;
  };
};

/** Decode and validate the plain-data board and player that every 5.11 encounter request carries. */
function decodeEncounterRequest(args: readonly Arg[], label: string): EncounterRequest {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeHandoffJson(text(args, 0)));
  } catch {
    throw new ScriptError("battle.bad-handoff", `${label} is not valid JSON`);
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new ScriptError("battle.bad-handoff", `${label} is not an object`);
  }
  const record = decoded as Record<string, unknown>;
  const board = record.board;
  const actor = record.actor;
  if (typeof board !== "object" || board === null || Array.isArray(board) ||
      typeof actor !== "object" || actor === null || Array.isArray(actor)) {
    throw new ScriptError("battle.bad-handoff", `${label} requires board and actor records`);
  }
  const { key, skill, background } = board as Record<string, unknown>;
  const { id, kind, index, source, x, y, layer } = actor as Record<string, unknown>;
  if (
    record.trigger !== "random" ||
    typeof key !== "string" || key === "" ||
    typeof skill !== "number" || !Number.isSafeInteger(skill) ||
    typeof background !== "string" ||
    typeof id !== "string" || kind !== "player" ||
    typeof index !== "number" || !Number.isSafeInteger(index) ||
    typeof source !== "string" ||
    typeof x !== "number" || !Number.isFinite(x) ||
    typeof y !== "number" || !Number.isFinite(y) ||
    typeof layer !== "number" || !Number.isSafeInteger(layer)
  ) throw new ScriptError("battle.bad-handoff", `${label} fields are invalid`);
  return { record, board: { key, skill, background }, actor: { id, kind, index, source, x, y, layer } };
}

function handoffBattleStart(view: CommandView, args: readonly Arg[]): CommandResult {
  const { record, board } = decodeEncounterRequest(args, "random battle handoff");
  if (!Array.isArray(record.fighters)) throw new ScriptError("battle.bad-handoff", "random battle handoff fields are invalid");
  const fighters = record.fighters as unknown[];
  if (fighters.length < 2 || fighters.length > 5 ||
      typeof fighters[0] !== "object" || fighters[0] === null || Array.isArray(fighters[0]) ||
      (fighters[0] as Record<string, unknown>).party !== "player") {
    throw new ScriptError("battle.bad-handoff", "random battle handoff requires one player reference and one to four enemies");
  }
  const sources: string[] = [];
  for (const fighter of fighters.slice(1)) {
    if (typeof fighter !== "object" || fighter === null || Array.isArray(fighter)) {
      throw new ScriptError("battle.bad-handoff", "random battle enemy reference is invalid");
    }
    const reference = fighter as Record<string, unknown>;
    if (
      reference.party !== "enemy" || typeof reference.id !== "string" ||
      typeof reference.index !== "number" || !Number.isSafeInteger(reference.index) ||
      typeof reference.source !== "string" || reference.source.trim() === "" ||
      (reference.skill !== null && (typeof reference.skill !== "number" || !Number.isSafeInteger(reference.skill)))
    ) throw new ScriptError("battle.bad-handoff", "random battle enemy reference fields are invalid");
    sources.push(reference.source);
  }
  return beginBattleStart(view, board.key, board.background, sources, true);
}

function dictionaryValue(view: CommandView, members: Readonly<Record<string, Value>>): ObjectValue {
  const state = view.state;
  if (state === undefined) throw new ScriptError("builtin.bad-arg", "a program context requires live VM state");
  const object = createObject(state.vm, null);
  for (const [key, value] of Object.entries(members)) writeMember(object, key, value);
  return { kind: "object", handle: object.handle, className: object.className };
}

function dictionary(view: CommandView, members: Readonly<Record<string, Value>>): CommandResult {
  return { value: dictionaryValue(view, members) };
}

/**
 * A custom encounter is spelled out, not drawn (BAT-9 rule 2): the 5.11 request carries no fighters, so nothing
 * is loaded and no random number is taken. The main file's fight program runs through the `executeProgram`
 * frame push with the request as its `context` and `source` and `target` null; it names its own enemies with
 * `FightEnemy`.
 */
function customFightStart(view: CommandView, args: readonly Arg[]): CommandResult {
  const { record, board, actor } = decodeEncounterRequest(args, "custom fight request");
  const program = record.program;
  if (typeof program !== "string" || program.trim() === "") {
    throw new ScriptError("battle.bad-handoff", "custom fight request requires a program name");
  }
  if (Object.hasOwn(record, "fighters")) {
    throw new ScriptError("battle.bad-handoff", "a custom fight request carries no fighters");
  }
  const context = dictionaryValue(view, {
    trigger: "random",
    board: dictionaryValue(view, { key: board.key, skill: board.skill, background: board.background }),
    actor: dictionaryValue(view, { ...actor }),
    program,
    source: null,
    target: null,
  });
  return { value: null, effects: [{ kind: "vm.control", args: ["executeProgram", program, "object", context] }] };
}

function dictionaryObject(view: CommandView, value: Value | undefined, name: string) {
  const state = view.state;
  if (state === undefined || typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") {
    throw new ScriptError("builtin.bad-arg", `${name}: expected a live dictionary`);
  }
  const record = findObject(state.vm, value.handle);
  if (record === undefined || record.className !== "") {
    throw new ScriptError("builtin.bad-arg", `${name}: expected a live dictionary`);
  }
  return record;
}

function rewardAmount(view: CommandView, rewards: Value | undefined, field: "experience" | "gold"): number {
  const record = dictionaryObject(view, rewards, "battle outcome");
  const value = readMember(record, field);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ScriptError("builtin.bad-arg", `battle outcome: ${field} total must be a non-negative safe integer`);
  }
  return value;
}

function markStockBattleOutcomePending(view: CommandView): boolean {
  const value = view.state?.vm.globals.stockbattle;
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") return false;
  const object = findObject(view.state!.vm, value.handle);
  if (object === undefined || readMember(object, "active") !== 1) return false;
  writeMember(object, "coreoutcomepending", 1);
  return true;
}

function battleSlotActor(view: CommandView, party: 0 | 1, index: number) {
  const battle = view.state?.battle;
  if (battle === undefined || battle === null) throw new ScriptError("battle.not-active", "there is no active battle");
  if (!Number.isSafeInteger(index) || index < 0) throw new ScriptError("battle.bad-fighter", `invalid battle fighter index ${display(index)}`);
  const fighter = battle.parties[party][index];
  const actor = fighter === undefined ? null : actorRecord(view, fighter.actorId);
  if (actor === null || actor.kind !== (party === 0 ? "enemy" : "party")) {
    throw new ScriptError("battle.bad-fighter", `no usable fighter exists at this position (party=${party}, index=${index})`);
  }
  return actor;
}

function battleActorFromHandle(view: CommandView, party: 0 | 1, value: Value | undefined) {
  const state = view.state;
  if (state?.battle === undefined || state.battle === null) throw new ScriptError("battle.not-active", "there is no active battle");
  let id: ActorId | undefined;
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object") {
    id = actorIdForObject(view, value.handle);
    if (id === undefined) {
      const record = state.vm.objects.find((candidate) => candidate.handle === value.handle);
      const targetParty = record === undefined ? undefined : readMember(record, "party");
      const targetIndex = record === undefined ? undefined : readMember(record, "index");
      if (targetParty !== party || typeof targetIndex !== "number" || !Number.isSafeInteger(targetIndex) || targetIndex < 0) {
        throw new ScriptError("battle.bad-fighter", `fighter reference must name party ${party} (party=${display(targetParty)}, index=${display(targetIndex)})`);
      }
      return battleSlotActor(view, party, targetIndex);
    }
  } else if (typeof value === "string") {
    id = partyActor(view, value) ?? anyActor(view, value);
    if (id === undefined) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed > 0 && actorRecord(view, parsed) !== null) id = parsed as ActorId;
    }
  }
  const fighter = id === undefined ? undefined : state.battle.parties[party].find((entry) => entry.actorId === id);
  const actor = fighter === undefined ? null : actorRecord(view, fighter.actorId);
  if (actor === null || actor.kind !== (party === 0 ? "enemy" : "party")) return badFighter(value);
  return actor;
}

function outcomeRewardValue(record: ObjectRecord, field: "experience" | "gold"): number {
  const value = readMember(record, field);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ScriptError("builtin.bad-arg", `battle outcome: ${field} reward must be a non-negative safe integer`);
  }
  return value;
}

const OUTCOME_REWARDS = {
  name: "__battle_outcome_rewards", aliases: [], params: [parameter("enemies"), parameter("size")],
  doc: internalDocumentation("Sum battle outcome data.", "Reads each enemy data dictionary in encounter order and returns checked experience and gold totals plus the last non-empty run and win program references."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const enemies = dictionaryObject(view, args[0]?.value, "battle outcome enemies");
    const size = integer(args, 1, "battle outcome enemy count");
    if (size < 0) throw new ScriptError("builtin.bad-arg", "battle outcome enemy count must not be negative");
    let experience = 0;
    let gold = 0;
    let runprogram = "";
    let winprogram = "";
    for (let index = 0; index < size; index += 1) {
      const raw = readMember(enemies, String(index));
      if (raw === undefined || raw === null) continue;
      const data = dictionaryObject(view, raw, "battle enemy data");
      const exp = outcomeRewardValue(data, "experience");
      const gp = outcomeRewardValue(data, "gold");
      experience += exp;
      gold += gp;
      if (!Number.isSafeInteger(experience) || !Number.isSafeInteger(gold)) {
        throw new ScriptError("builtin.bad-arg", "battle outcome reward total exceeds the safe-integer range");
      }
      const run = readMember(data, "runawayprogram");
      const win = readMember(data, "defeatprogram");
      if (typeof run === "string" && run !== "") runprogram = run;
      if (typeof win === "string" && win !== "") winprogram = win;
    }
    return dictionary(view, { experience, gold, runprogram, winprogram });
  },
} satisfies BuiltinSpec;

const GAME_OVER_PROGRAM = {
  name: "__battle_game_over_program", aliases: [], params: [],
  doc: internalDocumentation("Read the configured game-over program.", "Returns the main file's game-over program reference or an empty string when none is configured."),
  call: (view: CommandView) => ({ value: view.gameOverProgram ?? "" }),
} satisfies BuiltinSpec;

const END_LOSS = {
  name: "__battle_end_loss", aliases: [], params: [],
  doc: internalDocumentation("End a lost battle before game over.", "Clears the owner-held battle section after outcome 4 has been recorded, before the game-over program or reset sequence."),
  call: (view: CommandView) => { resolve(owner(view).endLoss()); return { value: null }; },
} satisfies BuiltinSpec;

const GAIN_GOLD = {
  name: "__battle_gain_gold", aliases: [], params: [parameter("rewards")],
  doc: internalDocumentation("Post battle gold to inventory.", "Posts one state-write effect carrying `{ type: \"addGold\", amount }`; the inventory owner consumes it."),
  call: (view: CommandView, args: readonly Arg[]) => ({
    value: null,
    effects: [{
      kind: "state-write",
      section: "inventory",
      args: [{ type: "addGold", amount: rewardAmount(view, args[0]?.value, "gold") }],
    }],
  }),
} satisfies BuiltinSpec;

const BATTLE_ACTOR_REF = {
  name: "__battle_actor_ref", aliases: [], params: [parameter("party"), parameter("index")],
  doc: internalDocumentation("Resolve a battle party slot.", "Returns the actor id as a string for the requested battle party slot, including a fallen fighter."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const party = integer(args, 0, "battle party");
    if (party !== 0 && party !== 1) throw new ScriptError("battle.bad-fighter", "party must be 0 or 1");
    return { value: String(battleSlotActor(view, party as 0 | 1, integer(args, 1, "battle index")).id) };
  },
} satisfies BuiltinSpec;

const EXPERIENCE_BEGIN = {
  name: "__battle_experience_begin", aliases: [], params: [parameter("fighter"), parameter("rewards")],
  doc: internalDocumentation("Begin one battle experience award.", "Adds the full award first. Legacy-program actors receive an ordered step plan; other actors use the actor owner's ordinary progression operation."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const idValue = Number(text(args, 0));
    if (!Number.isSafeInteger(idValue) || idValue <= 0) return badFighter(args[0]?.value);
    const actors = view.actors;
    const actor = actors?.readActor(idValue);
    if (actors === undefined || actor === null || actor === undefined || actor.kind !== "party") return badFighter(args[0]?.value);
    const amount = rewardAmount(view, args[1]?.value, "experience");
    if (actor.progression.legacyLevelUp === true) {
      const plan = actors.beginLegacyBattleExperience(idValue, amount);
      if (plan === null) return badFighter(args[0]?.value);
      return dictionary(view, {
        legacy: 1, remaining: plan.remainingExperience, maxlevel: plan.maxLevel,
        levels: 0, name: plan.actor.name,
      });
    }
    const result = actors.awardExperience(idValue, amount);
    if (result === null) return badFighter(args[0]?.value);
    const levels = result.transitions.filter((transition) => transition.type === "leveledUp").length;
    return dictionary(view, {
      legacy: 0, remaining: 0, maxlevel: result.actor.progression.maxLevel,
      levels, name: result.actor.name,
    });
  },
} satisfies BuiltinSpec;

const EXPERIENCE_STEP_READY = {
  name: "__battle_experience_step_ready", aliases: [], params: [parameter("fighter"), parameter("plan")],
  doc: internalDocumentation("Check for a reached legacy threshold.", "Returns 1 when the legacy plan has a non-positive remainder and the actor is below a positive maximum level; otherwise returns 0."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = Number(text(args, 0));
    if (!Number.isSafeInteger(id) || id <= 0) return badFighter(args[0]?.value);
    const actor = view.actors?.readActor(id);
    if (actor === null || actor === undefined || actor.kind !== "party") return badFighter(args[0]?.value);
    const plan = dictionaryObject(view, args[1]?.value, "legacy experience plan");
    const remaining = readMember(plan, "remaining");
    const maxLevel = readMember(plan, "maxlevel");
    return {
      value: readMember(plan, "legacy") === 1 && typeof remaining === "number" && remaining <= 0 &&
        typeof maxLevel === "number" && maxLevel > 0 && actor.stats.level < maxLevel ? 1 : 0,
    };
  },
} satisfies BuiltinSpec;

const LEVELUP_CONTEXT = {
  name: "__battle_levelup_context", aliases: [], params: [parameter("fighter")],
  doc: internalDocumentation("Build a level-up program context.", "Returns fresh context data with null source and target plus the fighter id, current pre-step level and total experience."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = Number(text(args, 0));
    if (!Number.isSafeInteger(id) || id <= 0) return badFighter(args[0]?.value);
    const actor = view.actors?.readActor(id);
    if (actor === null || actor === undefined || actor.kind !== "party") return badFighter(args[0]?.value);
    const handle = String(actor.id);
    return dictionary(view, {
      source: null, target: null, actor: handle, fighter: handle,
      level: actor.stats.level, experience: actor.stats.experience,
    });
  },
} satisfies BuiltinSpec;

const EXPERIENCE_STEP = {
  name: "__battle_experience_step", aliases: [], params: [parameter("fighter"), parameter("plan")],
  doc: internalDocumentation("Apply one built-in level-up step.", "Applies one actor-owned growth step after its legacy level-up program returns and returns the next plan and display name."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = Number(text(args, 0));
    if (!Number.isSafeInteger(id) || id <= 0) return badFighter(args[0]?.value);
    const plan = dictionaryObject(view, args[1]?.value, "legacy experience plan");
    const remaining = readMember(plan, "remaining");
    if (typeof remaining !== "number" || !Number.isSafeInteger(remaining)) throw new ScriptError("builtin.bad-arg", "legacy experience plan has an invalid remainder");
    const result = view.actors?.completeLegacyBattleLevelStep(id, remaining);
    if (result === null || result === undefined) return badFighter(args[0]?.value);
    const nextPlan = dictionary(view, {
      legacy: 1,
      remaining: result.remainingExperience,
      maxlevel: result.actor.progression.maxLevel,
      levels: 0,
      name: result.actor.name,
    }).value;
    return dictionary(view, {
      plan: nextPlan,
      leveled: result.leveledUp ? 1 : 0,
      name: result.actor.name,
    });
  },
} satisfies BuiltinSpec;

const CLEAR_STATUSES = {
  name: "__battle_clear_statuses", aliases: [], params: [parameter("fighter")],
  doc: internalDocumentation(
    "End every status counter on one battle participant.",
    "Removes each actor-owned status counter through the actor owner in file-name order, emitting the ordinary statusChanged transition for each. Reads no StatusE asset and runs no status program. The outcome adapter calls it for every fighter of both parties so statuses end with the battle (BAT-6).",
    [{ code: "battle.bad-fighter", when: "the fighter is not an existing actor id" }],
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = Number(text(args, 0));
    const actors = view.actors;
    if (actors === undefined || !Number.isSafeInteger(id) || id <= 0) return badFighter(args[0]?.value);
    const actor = actors.readActor(id);
    if (actor === null || actor === undefined) return badFighter(args[0]?.value);
    for (const status of Object.keys(actor.statuses).sort()) actors.removeStatus(actor.id, status, { source: null });
    return { value: null };
  },
} satisfies BuiltinSpec;

const APPLY_OUTCOME = {
  name: "__battle_apply_outcome", aliases: [], params: [parameter("code")],
  doc: internalDocumentation("Apply one battle outcome.", "Records the automatic outcome if the package did not already do so, permits a recorded win or run to be corrected to a simultaneous loss, then completes the core outcome adapter and battle-ended notification."),
  call: (view: CommandView, args: readonly Arg[]) => {
    const code = integer(args, 0, "battle outcome");
    if (code < 0 || code > 4) throw new ScriptError("battle.bad-outcome", `automatic battle outcome must be 0 through 4: ${display(code)}`);
    const battle = owner(view);
    const current = resolve(battle.outcome());
    if (current === null) resolve(battle.decideOutcome(code));
    else if (current !== code && !(code === 4 && (current === 0 || current === 2))) {
      throw new ScriptError("battle.bad-outcome", `cannot replace battle outcome ${current} with ${code}`);
    } else if (current !== code) resolve(battle.decideOutcome(code));
    return { value: null, effects: [outcomeAdapterEffect()] };
  },
} satisfies BuiltinSpec;

const ASSET_WAIT = { kind: "host-request", summary: "Waits for the host to load and return the requested asset." } as const;
const ASSET_REPLY_THROWS: NonNullable<BuiltinDoc["throws"]> = [
  { code: "asset.missing", when: "the requested asset is missing" },
  { code: "request.bad-reply", when: "the host reply is not valid hexadecimal bytes" },
];
const REAWAKENED = [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"];

const MOVE_ASSET = {
  name: "__battle_move_asset", aliases: [], params: [parameter("ok"), parameter("bytes")],
  doc: internalDocumentation("Resume a special-move asset request.", "Reads the `.spc` bytes and returns only the display name, the normalized battle fields and the description as a dictionary with lowercase keys.", [...ASSET_REPLY_THROWS, { code: "format.special-move", when: "the bytes are not a valid special move `.spc` file" }]),
  call: dataAssetContinuation("special move", "format.special-move", readSpecialMove, (view, _args, move) => dictionary(view, {
    name: move.name, fp: move.damage, smp: move.smpCost, targetsmp: move.targetSmpDrain,
    animation: move.animation, program: move.program, statuseffect: move.statusEffect,
    battle: move.usableInBattle, menu: move.usableFromMenu,
    description: move.description,
  })),
} satisfies BuiltinSpec;

const MOVE_DATA = {
  name: "battlemovedata", aliases: [], params: [parameter("file")],
  doc: {
    summary: "Read a special move file's battle numbers, references and description.",
    behaviour: "Loads SpcMove/<file>.spc (the prefix and extension may be omitted) and returns a dictionary of its stored values without changing any actor, inventory or battle state: `name` (the move's stored display name exactly as read, the empty string when the file stores none), `fp` (damage), `smp` (cost to the user), `targetsmp` (SMP drained from the target), `animation`, `program`, `statuseffect` (file names, possibly empty), and `battle` / `menu`, the stored usability bytes passed through unchanged, and `description`, the move's description text exactly as stored (an empty string when the file stores none). The stored byte is 0 for usable and non-zero (1, or -1 in old files) for not usable; comparing it is left to the calling script. Member names are matched ignoring case. It makes no rules about damage, cost or affordability. Failures raise the ordinary asset and format errors, which the standard script error policy turns into a null result.",
    groups: REAWAKENED, tags: ["experimental"], waits: ASSET_WAIT,
    throws: [...ASSET_REPLY_THROWS, { code: "format.special-move", when: "the bytes are not a valid special move `.spc` file" }, { code: "builtin.bad-arg", when: "the file name is empty" }],
  },
  call: (_view: CommandView, args: readonly Arg[]) => requestDataAsset(
    "specialMoves",
    assetPath(text(args, 0), "SpcMove", ".spc", "battlemovedata"),
    "__battle_move_asset",
  ),
} satisfies BuiltinSpec;

const ITEM_ASSET = {
  name: "__battle_item_asset", aliases: [], params: [parameter("ok"), parameter("bytes")],
  doc: internalDocumentation("Resume an item asset request for battle data.", "Reads the `.itm` bytes and returns only the battle-use HP, SMP, animation, program, usable flag and description as a dictionary with lowercase keys.", [...ASSET_REPLY_THROWS, { code: "format.item", when: "the bytes are not a valid item `.itm` file" }]),
  call: dataAssetContinuation("item", "format.item", readItem, (view, _args, item) => dictionary(view, {
    hp: item.battleUseHp, smp: item.battleUseSmp, animation: item.battleAnimation, program: item.battleUseProgram,
    usable: item.battleUsable,
    description: item.description,
  })),
} satisfies BuiltinSpec;

const ITEM_DATA = {
  name: "battleitemdata", aliases: [], params: [parameter("file")],
  doc: {
    summary: "Read an item file's battle-use numbers, references and description.",
    behaviour: "Loads Item/<file>.itm (the prefix and extension may be omitted) and returns a dictionary of its stored battle-use values without changing any actor, inventory or battle state: `hp` and `smp` (the amounts the item restores when used in battle), `animation` and `program` (file names, possibly empty), `usable`, the stored used-in-a-fight byte (1 = usable in battle, 0 = not), and `description`, the item's description text exactly as stored (an empty string when the file stores none). It does not itself refuse an item that is not battle-usable and does not check that it is owned; a menu that lists only usable items compares `usable`. Failures raise the ordinary asset and format errors, which the standard script error policy turns into a null result.",
    groups: REAWAKENED, tags: ["experimental"], waits: ASSET_WAIT,
    throws: [...ASSET_REPLY_THROWS, { code: "format.item", when: "the bytes are not a valid item `.itm` file" }, { code: "builtin.bad-arg", when: "the file name is empty" }],
  },
  call: (_view: CommandView, args: readonly Arg[]) => requestDataAsset(
    "items",
    assetPath(text(args, 0), "Item", ".itm", "battleitemdata"),
    "__battle_item_asset",
  ),
} satisfies BuiltinSpec;

// Battle stance slots. Characters store FIGHT, DEFEND, SPECIAL MOVE, DIE, REST; enemies store REST, FIGHT, DEFEND, SPECIAL MOVE, DIE.
const STANCE_SLOTS: Record<string, { readonly character: number; readonly enemy: number }> = {
  fight: { character: 0, enemy: 1 }, attack: { character: 0, enemy: 1 },
  defend: { character: 1, enemy: 2 }, defense: { character: 1, enemy: 2 },
  special: { character: 2, enemy: 3 }, specialmove: { character: 2, enemy: 3 },
  die: { character: 3, enemy: 4 }, death: { character: 3, enemy: 4 },
  rest: { character: 4, enemy: 0 },
};

const ANIMATION_ASSET = {
  name: "__battle_fighter_animation_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("enemy"), parameter("character"), parameter("enemySlot")],
  doc: internalDocumentation("Resume a fighter source asset request.", "Reads the actor's character or enemy asset and returns the named battle stance animation file, or an empty string when the asset stores none.", [...ASSET_REPLY_THROWS, { code: "format.character", when: "the character bytes are invalid" }, { code: "format.enemy", when: "the enemy bytes are invalid" }]),
  call: (_view: CommandView, args: readonly Arg[]): CommandResult => {
    const bytes = replyBytes(args, "fighter source");
    if (numeric(args, 2) === 1) {
      const enemy = readEnemy(new BinaryReader(bytes));
      if (!enemy.ok) throw new ScriptError("format.enemy", enemy.error.message);
      return { value: enemy.value.stances[numeric(args, 4)] ?? "" };
    }
    const character = readCharacter(new BinaryReader(bytes));
    if (!character.ok) throw new ScriptError("format.character", character.error.message);
    return { value: character.value.battleStances?.[numeric(args, 3)] ?? "" };
  },
} satisfies BuiltinSpec;

const ANIMATION_FILE = {
  name: "fighteranimationfile", aliases: [], params: [parameter("fighter"), parameter("stance")],
  doc: {
    summary: "Look up the animation file a fighter's source asset names for a battle stance.",
    behaviour: `Reads the fighter's source asset (a character file for players and other non-enemies, an enemy file for enemies) and returns the file name stored for the stance: \`fight\` (or \`attack\`), \`defend\`, \`special move\`, \`die\` or \`rest\`, matched ignoring case, spaces and punctuation. It returns an empty string when the asset stores none (or the source is empty) and only reads a file name: it plays nothing and assumes no screen position. ${FIGHTER_HANDLES}`,
    groups: REAWAKENED, tags: ["experimental"], waits: ASSET_WAIT,
    throws: [...STAT_READ_THROWS, ...ASSET_REPLY_THROWS, { code: "builtin.bad-arg", when: "the stance name is not recognised" }, { code: "format.character", when: "a character source is not a valid `.cha` file" }, { code: "format.enemy", when: "an enemy source is not a valid `.ene` file" }],
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = referenceActor(view, args[0]?.value);
    const key = text(args, 1).toLowerCase().replace(/[^a-z]/g, "");
    if (!Object.hasOwn(STANCE_SLOTS, key)) throw new ScriptError("builtin.bad-arg", `fighteranimationfile: unknown stance "${text(args, 1)}"`);
    const slots = STANCE_SLOTS[key]!;
    const actor = actorRecord(view, id);
    if (actor === null) return badFighter(args[0]?.value);
    if (actor.source === "") return { value: "" };
    const enemy = actor.kind === "enemy";
    return {
      value: null,
      request: { kind: "asset", area: enemy ? "enemies" : "characters", path: actor.source },
      then: { command: "__battle_fighter_animation_asset", args: [enemy ? 1 : 0, slots.character, slots.enemy] },
    };
  },
} satisfies BuiltinSpec;

const BACKGROUND_DATA_ASSET = {
  name: "__battle_background_data_asset", aliases: [], params: [parameter("ok"), parameter("bytes")],
  doc: internalDocumentation("Resume a battle-background asset request.", "Reads the `.bkg` bytes and returns the documented battle background values as a plain-data dictionary.", [...ASSET_REPLY_THROWS, { code: "format.battle-background", when: "the bytes are not a valid fight-background `.bkg` file" }]),
  call: dataAssetContinuation("battle background", "format.battle-background", readBattleBackground, (view, _args, background) => dictionary(view, {
    image: background.image,
    music: background.music,
    selectsound: background.menuMoveSound,
    choosesound: background.menuChooseSound,
    readysound: background.readySound,
    cantsound: background.cantDoSound,
  })),
} satisfies BuiltinSpec;

const BACKGROUND_DATA = {
  name: "battlebackgrounddata", aliases: [], params: [],
  doc: {
    summary: "Read the active battle's background settings.",
    behaviour: "Reads the active battle's `.bkg` file without changing battle state and returns `{ image, music, selectsound, choosesound, readysound, cantsound }`, preserving the stored file names. Returns null when the active battle has no background.",
    groups: REAWAKENED, tags: ["experimental"], waits: ASSET_WAIT,
    throws: [
      { code: "battle.not-active", when: "there is no active battle" },
      ...ASSET_REPLY_THROWS,
      { code: "format.battle-background", when: "the bytes are not a valid fight-background `.bkg` file" },
    ],
  },
  call: (view: CommandView): CommandResult => {
    const background = resolve(owner(view).background());
    if (background === "") return { value: null };
    return requestDataAsset(
      "backgrounds",
      assetPath(background, "Bkrounds", ".bkg", "battlebackgrounddata"),
      "__battle_background_data_asset",
    );
  },
} satisfies BuiltinSpec;

const ENEMY_DATA_ASSET = {
  name: "__battle_enemy_data_asset", aliases: [], params: [parameter("ok"), parameter("bytes")],
  doc: internalDocumentation("Resume an enemy asset request.", "Reads the `.ene` bytes and returns battle AI and outcome settings as a plain-data dictionary.", [...ASSET_REPLY_THROWS, { code: "format.enemy", when: "the bytes are not a valid enemy `.ene` file" }]),
  call: dataAssetContinuation("enemy", "format.enemy", readEnemy, (view, _args, enemy) => {
    const specialMoves = createObject(view.state!.vm, null);
    enemy.specialMoves.forEach((file, index) => writeMember(specialMoves, String(index), file));
    return dictionary(view, {
      specialmoves: { kind: "object", handle: specialMoves.handle, className: specialMoves.className },
      specialcount: enemy.specialMoves.length,
      ailevel: enemy.aiLevel,
      customai: enemy.customAi,
      aiprogram: enemy.aiProgram,
      canrun: enemy.canRun,
      experience: enemy.experienceReward,
      gold: enemy.goldReward,
      defeatprogram: enemy.defeatProgram,
      runawayprogram: enemy.runAwayProgram,
    });
  }),
} satisfies BuiltinSpec;

const ENEMY_DATA = {
  name: "battleenemydata", aliases: [], params: [parameter("fighter")],
  doc: {
    summary: "Read an enemy's battle settings.",
    behaviour: "Reads the `.ene` file named by an enemy's source and returns its battle settings without changing actor, inventory or battle state: `specialmoves` is a dictionary indexed from 0 through `specialcount - 1`, `ailevel` is the stored AI level, `customai` is the stored custom-AI flag, and `aiprogram` is the AI program file name. It also returns `canrun`, `experience`, `gold`, `defeatprogram` (the win program), and `runawayprogram`. The actor may be a fallen enemy still present in its battle slot. Blank file names and stored flag values are returned unchanged. It chooses no action and does not check move costs. Member names are matched ignoring case.",
    groups: REAWAKENED, tags: ["experimental"], waits: ASSET_WAIT,
    throws: [
      { code: "battle.not-active", when: "there is no active battle" },
      { code: "battle.bad-fighter", when: "the handle does not identify an active enemy" },
      ...ASSET_REPLY_THROWS,
      { code: "format.enemy", when: "the bytes are not a valid enemy `.ene` file" },
    ],
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const actor = battleActorFromHandle(view, 0, args[0]?.value);
    return requestDataAsset("enemies", actor.source, "__battle_enemy_data_asset");
  },
} satisfies BuiltinSpec;

/**
 * One special-move slot is available to its character when at least one configured condition succeeds
 * (progression-and-levels.md#special-moves): experience at least `minExp`, level at least `minLevel`, or the named
 * script variable equal to the required value (compared as text, or as numbers when both read as finite numbers).
 */
export function specialAvailable(view: CommandView, actorId: number, slot: { readonly minExp: number; readonly minLevel: number; readonly condVar: string; readonly condValue: string }): boolean {
  const actor = actorRecord(view, actorId);
  if (actor !== null && (actor.stats.experience >= slot.minExp || actor.stats.level >= slot.minLevel)) return true;
  if (slot.condVar === "") return false;
  const raw = view.state?.vm.globals[slot.condVar.toLowerCase()];
  if (raw === undefined || raw === null || typeof raw === "object") return false;
  const have = String(raw);
  if (have === slot.condValue) return true;
  const a = Number(have);
  const b = Number(slot.condValue);
  return have.trim() !== "" && slot.condValue.trim() !== "" && Number.isFinite(a) && Number.isFinite(b) && a === b;
}

const CHARACTER_DATA_ASSET = {
  name: "__battle_character_data_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("actor")],
  doc: internalDocumentation("Resume a character asset request.", "Reads the `.cha` bytes and returns the level-up program reference and the special-move list as a plain-data dictionary.", [...ASSET_REPLY_THROWS, { code: "format.character", when: "the bytes are not a valid character `.cha` file" }]),
  call: dataAssetContinuation("character", "format.character", readCharacter, (view, args, character) => {
    const state = view.state;
    if (state === undefined) throw new ScriptError("builtin.bad-arg", "battlecharacterdata requires live VM state");
    const moves = createObject(state.vm, null);
    let count = 0;
    for (const slot of character.specialMoves) {
      if (slot.file === "") continue;
      writeMember(moves, String(count), dictionaryValue(view, {
        file: slot.file, minexp: slot.minExp, minlevel: slot.minLevel,
        available: specialAvailable(view, numeric(args, 2), slot) ? 1 : 0,
      }));
      count += 1;
    }
    return dictionary(view, {
      levelupprogram: character.levelUpProgram,
      specialname: character.specialMoveCategory,
      hasspecial: character.hasSpecialMoves === 0 ? 1 : 0,
      specialcount: count,
      specialmoves: { kind: "object", handle: moves.handle, className: moves.className },
    });
  }),
} satisfies BuiltinSpec;

const CHARACTER_DATA = {
  name: "battlecharacterdata", aliases: [], params: [parameter("fighter")],
  doc: {
    summary: "Read a character's level-up program and special-move list.",
    behaviour: "Reads the `.cha` file named by a party fighter's source and returns `{ levelupprogram, specialname, hasspecial, specialcount, specialmoves }` without changing actor, inventory or battle state. `specialname` is the character's menu label for its special moves (for example \"Magic\"), `hasspecial` is 1 when the character has special moves and 0 when its file says it has none, and `specialmoves` is a dictionary indexed from 0 through `specialcount - 1` of the non-empty slots in slot order, each `{ file, minexp, minlevel, available }`. `available` is 1 when at least one learn condition holds now (experience at least `minexp`, level at least `minlevel`, or the slot's condition variable equals its required value) and 0 otherwise; it does not check the move's own battle flag, cost or file. Fallen party fighters still in the battle are accepted. A blank program reference is returned unchanged. Member names are matched ignoring case.",
    groups: REAWAKENED, tags: ["experimental"], waits: ASSET_WAIT,
    throws: [
      { code: "battle.not-active", when: "there is no active battle" },
      { code: "battle.bad-fighter", when: "the handle does not identify an active party fighter" },
      ...ASSET_REPLY_THROWS,
      { code: "format.character", when: "the bytes are not a valid character `.cha` file" },
    ],
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const actor = battleActorFromHandle(view, 1, args[0]?.value);
    if (actor.source === "") {
      const none = createObject(view.state!.vm, null);
      return dictionary(view, { levelupprogram: "", specialname: "", hasspecial: 0, specialcount: 0, specialmoves: { kind: "object", handle: none.handle, className: none.className } });
    }
    return requestDataAsset("characters", actor.source, "__battle_character_data_asset", [actor.id]);
  },
} satisfies BuiltinSpec;


/** The one plain-data inventory request `battleconsume` posts; tests and the inventory owner read it from the effect log. */
export function inventoryConsumeEffect(item: string, target: number, hp: number, smp: number, handle: string | null): CommandEffect {
  return { kind: "state-write", section: "inventory", args: [{ kind: "inventory.consume", item, target, hp, smp, handle }] };
}

const CONSUME = {
  name: "battleconsume", aliases: [], params: [parameter("item"), parameter("target"), parameter("hp"), parameter("smp"), parameter("handle", true)],
  doc: {
    summary: "Ask the inventory to consume one battle item.",
    behaviour: `Posts exactly one inventory request, \`{ kind: "inventory.consume", item, target, hp, smp, handle }\`, where \`item\` is the item file name as given (backslashes become forward slashes), \`target\` is the numeric actor id, \`hp\` / \`smp\` are the safe-integer amounts the item gave and \`handle\` is the optional name of the one inventory stack to use. \`handle\` names no stack when it is omitted, null, 0 (an unset parameter) or empty, and the request then carries \`handle: null\`. With a \`handle\` the inventory owner consumes exactly that stack and refuses when it is missing or empty; without one it picks the stack from the item file and refuses when that is ambiguous. It changes no inventory list, quantity or actor stat itself; the inventory owner decides what the request does. ${FIGHTER_HANDLES}`,
    groups: REAWAKENED, tags: ["experimental"], waits: NO_WAIT,
    throws: [...STAT_READ_THROWS, { code: "builtin.bad-arg", when: "the item name is empty, handle is neither a string nor one of the no-stack values, or hp / smp is not a safe integer" }],
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const item = text(args, 0).trim().replaceAll("\\", "/");
    if (item === "") throw new ScriptError("builtin.bad-arg", "battleconsume: the item name must not be empty");
    const target = referenceActor(view, args[1]?.value);
    const given = args[4]?.value;
    const noStack = given === undefined || given === null || given === 0 || given === "";
    if (!noStack && typeof given !== "string") {
      throw new ScriptError("builtin.bad-arg", "battleconsume: handle must be a stack name string when given");
    }
    const handle = typeof given === "string" && given !== "" ? given : null;
    return { value: null, effects: [inventoryConsumeEffect(item, target, integer(args, 2, "battleconsume"), integer(args, 3, "battleconsume"), handle)] };
  },
} satisfies BuiltinSpec;

const BATTLE_SCREEN = {
  name: "battlescreensize", aliases: [], params: [],
  doc: {
    summary: "Read the size of the screen a battle screen would draw on.",
    behaviour: "Returns `{ width, height }`, the logical-pixel size of the screen surface, or null when the host has no screen surface (a headless run with no composed frame). It changes nothing and does not wait. A battle package draws its screen only when this is not null, so a headless run needs no drawing commands at all.",
    groups: REAWAKENED, tags: ["experimental"], waits: NO_WAIT,
  },
  call: (view: CommandView): CommandResult => {
    const surfaces = view.state?.surfaces;
    const size = surfaces === undefined || surfaces.entries === undefined ? null : surfaceSize(surfaces, 0 as SurfaceId);
    return size === null ? { value: null } : dictionary(view, { width: size.w, height: size.h });
  },
} satisfies BuiltinSpec;

const BATTLE_INVENTORY = {
  name: "battleinventory", aliases: [], params: [],
  doc: {
    summary: "List the available inventory stacks a battle menu can offer.",
    behaviour: "Returns `{ count, items }` where `items` is a dictionary indexed from 0 through `count - 1` of the inventory stacks that have at least one available unit, in inventory order, each `{ source, handle, quantity }` (the `.itm` file name as stored, the item's handle and the available count). It is a read-only view: it changes no inventory list, quantity or actor stat, loads no item file and does not say whether a stack is usable in battle (read `battleitemdata(source).usable` for that). It reads the same stacks as `itemcount`.",
    groups: REAWAKENED, tags: ["experimental"], waits: NO_WAIT,
    throws: [{ code: "battle.not-active", when: "there is no active battle" }],
  },
  call: (view: CommandView): CommandResult => {
    const state = view.state;
    if (state === undefined) throw new ScriptError("builtin.bad-arg", "battleinventory requires live VM state");
    if (state.battle === undefined || state.battle === null) throw new ScriptError("battle.not-active", "there is no active battle");
    const items = createObject(state.vm, null);
    let count = 0;
    for (const stack of state.inventory.items) {
      if (stack.quantity < 1) continue;
      writeMember(items, String(count), dictionaryValue(view, { source: stack.source, handle: stack.handle, quantity: stack.quantity }));
      count += 1;
    }
    return dictionary(view, { count, items: { kind: "object", handle: items.handle, className: items.className } });
  },
} satisfies BuiltinSpec;

const UNAFFORDABLE = {
  name: "battleunaffordable", aliases: [], params: [],
  doc: {
    summary: "Stop the current action because it cannot be paid for.",
    behaviour: "Always raises the catchable error `battle.unaffordable`. RPGCode has no command to raise an error, so scripts call this after their own comparison of cost and available points; this command decides nothing about affordability.",
    groups: REAWAKENED, tags: ["experimental"], waits: NO_WAIT,
    throws: [{ code: "battle.unaffordable", when: "always" }],
  },
  call: (): CommandResult => { throw new ScriptError("battle.unaffordable", "the action cannot be afforded"); },
} satisfies BuiltinSpec;

const INTEGER_MUL_DIV = {
  name: "integermuldiv", aliases: [], params: [parameter("a"), parameter("b"), parameter("divisor")],
  doc: {
    summary: "Multiply two whole numbers and divide by a third, exactly.",
    behaviour: "Returns a × b ÷ divisor with the product kept exact (no 32-bit wrap-around) and the quotient truncated toward zero, so -7 × 1 ÷ 2 is -3. Deterministically it computes BigInt(a) × BigInt(b) / BigInt(divisor) and reads no state.",
    groups: REAWAKENED, tags: ["experimental"], waits: NO_WAIT,
    throws: [{ code: "builtin.bad-arg", when: "an argument is not a safe integer, the divisor is 0, or the result is not a safe integer" }],
  },
  call: (_view: CommandView, args: readonly Arg[]): CommandResult => {
    const divisor = integer(args, 2, "integermuldiv");
    if (divisor === 0) throw new ScriptError("builtin.bad-arg", "integermuldiv: the divisor must not be 0");
    const quotient = (BigInt(integer(args, 0, "integermuldiv")) * BigInt(integer(args, 1, "integermuldiv"))) / BigInt(divisor);
    if (quotient > BigInt(Number.MAX_SAFE_INTEGER) || quotient < -BigInt(Number.MAX_SAFE_INTEGER)) throw new ScriptError("builtin.bad-arg", "integermuldiv: the result is not a safe integer");
    return { value: Number(quotient) };
  },
} satisfies BuiltinSpec;
const GET_STATUS = {
  name: "getstatus", aliases: [], params: [parameter("fighter"), parameter("index")],
  doc: {
    summary: "Read one of a fighter's active status file names.",
    behaviour: "Returns the filename key of the zero-based status entry in canonical filename order, or an empty string when the index is past the end. Canonical ordering matches snapshots, so enumeration resumes identically after restore. A present zero-round counter remains included until removed. This does not read status rules or change actor state.",
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: NO_WAIT,
    throws: [...STAT_READ_THROWS, { code: "builtin.bad-arg", when: "index is not a non-negative safe integer" }],
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = referenceActor(view, args[0]?.value);
    const index = integer(args, 1, "getstatus");
    if (index < 0) throw new ScriptError("builtin.bad-arg", "getstatus: index must be non-negative");
    const actor = actorRecord(view, id);
    if (actor === null) return { value: "" };
    // Actor maps are key-sorted by canonical snapshots; use the same order live.
    return { value: Object.keys(actor.statuses).sort()[index] ?? "" };
  },
} satisfies BuiltinSpec;
const STATUS_SIGNATURE = {
  name: "statussignature", aliases: [], params: [parameter("fighter")],
  doc: {
    summary: "Read a fighter's status signature.",
    behaviour: `Returns an opaque exact canonical JSON text token for the fighter's current status names and round counters; it changes when the status set or any counter changes, including presence of a zero-round status. Canonical key order matches snapshots, so the result is safe to save and compare after restore regardless of insertion order. This synchronous read does not load StatusE files or change actor state. ${FIGHTER_HANDLES}`,
    groups: [GROUP, "reawakened-additions-not-part-of-the-282-legacy-catalogue"], tags: ["experimental"], waits: NO_WAIT,
    throws: STAT_READ_THROWS,
  },
  call: (view: CommandView, args: readonly Arg[]) => {
    const id = referenceActor(view, args[0]?.value);
    const actor = actorRecord(view, id);
    return { value: actor === null ? "{}" : canon(actor.statuses) };
  },
} satisfies BuiltinSpec;

function statCommand(
  name: string,
  summary: string,
  field: keyof ActorStats,
  mode: "set" | "add" | "get",
  amountName?: string,
): BuiltinSpec {
  const params = mode === "get"
    ? [parameter("handle"), parameter("ret", true, true)]
    : [parameter("handle"), parameter(mode === "set" ? "value" : amountName ?? "add")];
  const statName = field === "maxHp" ? "maximum HP" : field === "maxSmp" ? "maximum SMP" : field;
  const unit = field.toLowerCase().includes("hp") ? "HP points" : field.toLowerCase().includes("smp") ? "SMP points" : `${field} stat points`;
  const operation = mode === "get"
    ? `Reads the live actor-owned ${statName} in ${unit}; the optional trailing by-reference result receives the same current value.`
    : mode === "set"
      ? `Sets the live actor-owned ${statName} in ${unit} through the actor owner. HP and SMP are clamped to [0, maximum]; lowering a maximum also clamps its current value.`
      : field === "hp" || field === "smp"
        ? `Adds the signed ${unit} amount through the actor owner's damage/heal operation (positive heals, negative damages); the owner clamps the result to [0, maximum]${field === "hp" ? " and emits the ordinary fallen transition once when HP crosses to zero" : ""}.`
        : `Adds the signed ${unit} amount to the live actor-owned value through the actor owner; the resulting safe integer is committed atomically.`;
  const behaviour = `${FIGHTER_HANDLES} ${operation} These aliases always read and write the actor store; no stats are copied, and they do not require an active battle for legacy actor handles. The call completes synchronously.`;
  return {
    name,
    aliases: [],
    params,
    doc: documentation(summary, behaviour, mode === "get" ? STAT_READ_THROWS : STAT_THROWS),
    call: (view, args) => {
      const actorId = referenceActor(view, args[0]?.value);
      const actor = actorRecord(view, actorId);
      const actors = view.actors;
      if (actor === null || actors === undefined) return badFighter(args[0]?.value);
      if (mode === "get") {
        const value = actor.stats[field];
        const out = output(args, 1, value);
        return out === undefined ? { value } : { value, out };
      }
      const amount = integer(args, 1, name);
      if (mode === "set") {
        try {
          if (actors.updateStats(actorId, { [field]: amount } as Partial<ActorStats>, { cause: "script" }) === null) return badFighter(args[0]?.value);
        } catch (error) {
          if (error instanceof ScriptError) throw error;
          throw new ScriptError("builtin.bad-arg", `${name}: ${error instanceof Error ? error.message : "invalid stat value"}`);
        }
        return { value: null };
      }
      if (field === "hp" || field === "smp") {
        try {
          actors.damage(actorId, -amount, null, field === "smp" ? "smp" : "hp");
        } catch (error) {
          if (error instanceof ScriptError) throw error;
          throw new ScriptError("builtin.bad-arg", `${name}: ${error instanceof Error ? error.message : "invalid stat amount"}`);
        }
        return { value: null };
      }
      try {
        if (actors.updateStats(actorId, { [field]: actor.stats[field] + amount } as Partial<ActorStats>, { cause: "script" }) === null) return badFighter(args[0]?.value);
      } catch (error) {
        if (error instanceof ScriptError) throw error;
        throw new ScriptError("builtin.bad-arg", `${name}: ${error instanceof Error ? error.message : "invalid stat amount"}`);
      }
      return { value: null };
    },
  };
}

const PARTY_SIZE = {
  name: "__battle_party_size", aliases: [], params: [parameter("self"), parameter("party")],
  doc: internalDocumentation(
    "Read a battle party size.",
    "For `battle.partySize(party)`, returns the number of entries in party 0 (enemies) or party 1 (the player's ordered party). Party is 0 or 1; the read comes from the saved battle section and completes synchronously.",
    BATTLE_PARTY_SIZE_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).partySize(numeric(args, 1))) }),
} satisfies BuiltinSpec;
const FIGHTER = {
  name: "__battle_fighter", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: internalDocumentation(
    "Return a battle fighter object.",
    "For `battle.fighter(party, index)`, returns the same canonical actor host object registered in the actor store, not a copy. Party 0 is enemies, party 1 is the player's ordered party, and index is zero-based; only usable positions resolve.",
    BATTLE_READ_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const fighter = resolve(owner(view).fighter(numeric(args, 1), numeric(args, 2)));
    const state = view.state;
    if (state === undefined) throw new ScriptError("battle.not-active", "there is no active battle");
    const record = registerActorObject(state.vm, state.events, state.actors, fighter.actorId);
    if (record === null) throw new ScriptError("battle.bad-fighter", `no usable fighter exists at this position (party=${display(numeric(args, 1))}, index=${display(numeric(args, 2))})`);
    return { value: { kind: "object", handle: record.handle, className: record.className } };
  },
} satisfies BuiltinSpec;
const AI = {
  name: "ai", aliases: [], params: [parameter("level")],
  doc: {
    summary: "Have the source enemy use the internal AI.",
    behaviour: "Use one of the four built-in enemy strategies by passing a whole-number level from 0 through 3. When stock_battle is loaded, it chooses and performs the source enemy's action at that level; it does not store the level on the actor. The package may wait while it reads enemy and special-move files.",
    groups: [GROUP], tags: ["legacy"], waits: ASSET_WAIT,
    throws: [
      { code: "builtin.bad-arg", when: "level is not an integer from 0 through 3" },
      { code: "battle.not-active", when: "there is no active battle" },
      { code: "battle.bad-fighter", when: "source does not identify an active enemy" },
    ],
  },
  call: (_view: CommandView, args: readonly Arg[]): CommandResult => {
    const level = integer(args, 0, "ai");
    if (level < 0 || level > 3) throw new ScriptError("builtin.bad-arg", "ai: level must be an integer from 0 through 3");
    return { value: null };
  },
} satisfies BuiltinSpec;

const PROGRAM_CONTEXT = {
  name: "__battle_program_context", aliases: [],
  params: [parameter("source"), parameter("target"), parameter("extra", true)],
  doc: internalDocumentation(
    "Build a named program context.",
    "Copies the optional extra dictionary's members except `source` and `target`, then writes the supplied source and target handles so extra values cannot replace them. Returns a fresh dictionary for `executeProgram` without changing the input dictionary or actor state.",
    [{ code: "builtin.bad-arg", when: "extra is not a live dictionary" }],
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const state = view.state;
    if (state === undefined) throw new ScriptError("builtin.bad-arg", "program context requires live VM state");
    const context = createObject(state.vm, null);
    writeMember(context, "source", args[0]?.value ?? null);
    writeMember(context, "target", args[1]?.value ?? null);
    const extra = args[2]?.value;
    if (extra !== undefined && extra !== null && extra !== 0) {
      if (typeof extra !== "object" || !("kind" in extra) || extra.kind !== "object") {
        throw new ScriptError("builtin.bad-arg", "program context extra must be a dictionary");
      }
      const source = state.vm.objects.find((record) => record.handle === extra.handle);
      if (source === undefined || source.className !== "") {
        throw new ScriptError("builtin.bad-arg", "program context extra must be a live dictionary");
      }
      for (const [name, value] of Object.entries(source.members)) {
        if (name !== "source" && name !== "target") writeMember(context, name, value);
      }
    }
    return { value: { kind: "object", handle: context.handle, className: context.className } };
  },
} satisfies BuiltinSpec;
const STATUS_DELTA = {
  name: "__battle_status_delta", aliases: [],
  params: [parameter("target"), parameter("field"), parameter("amount")],
  doc: internalDocumentation(
    "Apply one status stat amount.",
    "Applies a signed HP or SMP amount to an active fighter through actor-owned stats, clamped by the actor owner; positive amounts subtract and can cause a `fallen` transition with cause `status`.",
    [{ code: "battle.bad-fighter", when: "the target is not an active fighter" }, { code: "builtin.bad-arg", when: "the field is not HP or SMP, or the amount cannot be applied safely" }],
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const actorId = activeBattleActor(view, args[0]?.value);
    const field = text(args, 1);
    if (field !== "hp" && field !== "smp") throw new ScriptError("builtin.bad-arg", "status delta field must be hp or smp");
    const amount = integer(args, 2, "status effect amount");
    if (amount === 0) return { value: null };
    const actors = view.actors;
    const stats = actors?.read(actorId);
    if (actors === undefined || stats === null || stats === undefined) {
      throw new ScriptError("battle.bad-fighter", `unknown status target (party=unknown, index=unknown)`);
    }
    try {
      if (actors.updateStats(actorId, { [field]: stats[field] - amount } as Partial<ActorStats>, { cause: "status", source: null }) === null) {
        throw new ScriptError("battle.bad-fighter", `unknown status target (party=unknown, index=unknown)`);
      }
    } catch (error) {
      if (error instanceof ScriptError) throw error;
      throw new ScriptError("builtin.bad-arg", `status effect amount: ${error instanceof Error ? error.message : "invalid amount"}`);
    }
    return { value: null };
  },
} satisfies BuiltinSpec;
const STATUS_ADVANCE = {
  name: "__battle_status_advance", aliases: [],
  params: [parameter("target"), parameter("amount")],
  doc: internalDocumentation(
    "Advance a fighter's status counters.",
    "Ages all actor-owned status counters through the actor owner after the stock battle has applied this turn's status effects.",
    [{ code: "battle.bad-fighter", when: "the target is not an active fighter" }, { code: "builtin.bad-arg", when: "the age is not a non-negative safe integer" }],
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const actorId = activeBattleActor(view, args[0]?.value);
    const amount = integer(args, 1, "status advance");
    if (amount < 0) throw new ScriptError("builtin.bad-arg", "status advance must not be negative");
    const actors = view.actors;
    if (actors === undefined) throw new ScriptError("battle.bad-fighter", "unknown status target (party=unknown, index=unknown)");
    try {
      if (actors.advanceStatus(actorId, amount, { source: null }) === null) {
        throw new ScriptError("battle.bad-fighter", "unknown status target (party=unknown, index=unknown)");
      }
    } catch (error) {
      if (error instanceof ScriptError) throw error;
      throw new ScriptError("builtin.bad-arg", `status advance: ${error instanceof Error ? error.message : "invalid amount"}`);
    }
    return { value: null };
  },
} satisfies BuiltinSpec;


function chargeCommand(
  name: string,
  summary: string,
  behaviour: string,
  params: readonly ParamSpec[],
  action: (args: readonly Arg[]) => BattleAction,
  throws: NonNullable<BuiltinDoc["throws"]> = BATTLE_CHARGE_THROWS,
): BuiltinSpec {
  return {
    name, aliases: [], params,
    doc: internalDocumentation(summary, behaviour, throws),
    call: (view, args) => { resolve(owner(view).apply(action(args))); return { value: null }; },
  };
}
const CHARGE = {
  name: "__battle_charge", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: internalDocumentation(
    "Read a fighter's stored charge.",
    "For `battle.charge(party, index)`, returns the exact stored charge number for that zero-based fighter entry. Storage is not clamped to a threshold; party 0 is enemies and party 1 is the player's ordered party.",
    BATTLE_READ_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).charge(numeric(args, 1), numeric(args, 2))) }),
} satisfies BuiltinSpec;
const CHARGE_PERCENT = {
  name: "__battle_charge_percent", aliases: [], params: [parameter("self"), parameter("party"), parameter("index")],
  doc: internalDocumentation(
    "Read a fighter's charge percentage.",
    "For `battle.chargePercent(party, index)`, computes floor(stored charge × 100 / threshold), then clamps the result to 0–100. The threshold is 123 for enemy party 0 and 75 for player party 1; stored charge itself is unchanged.",
    BATTLE_READ_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => ({ value: resolve(owner(view).chargePercent(numeric(args, 1), numeric(args, 2))) }),
} satisfies BuiltinSpec;
const ADD_CHARGE = chargeCommand(
  "__battle_add_charge",
  "Add to a fighter's stored charge.",
  "For `battle.addCharge(party, index, amount)`, adds a finite numeric amount to the stored charge and commits through the battle owner. The stored value is not clamped to a threshold; party and index are 0-based party/entry selectors.",
  [parameter("self"), parameter("party"), parameter("index"), parameter("amount")],
  (args) => ({ type: "addCharge", party: numeric(args, 1), index: numeric(args, 2), amount: numeric(args, 3) }),
);
const SET_CHARGE = chargeCommand(
  "__battle_set_charge",
  "Set a fighter's stored charge.",
  "For `battle.setCharge(party, index, charge)`, stores the finite numeric value exactly through the battle owner, without threshold clamping. Party and index are 0-based party/entry selectors.",
  [parameter("self"), parameter("party"), parameter("index"), parameter("charge")],
  (args) => ({ type: "setCharge", party: numeric(args, 1), index: numeric(args, 2), charge: numeric(args, 3) }),
);
const RELEASE_CHARGE = chargeCommand(
  "__battle_release_charge",
  "Release a fighter's charge.",
  "For `battle.releaseCharge(party, index)`, sets that fighter's stored charge to exactly 0 through the battle owner. Party and index are 0-based party/entry selectors.",
  [parameter("self"), parameter("party"), parameter("index")],
  (args) => ({ type: "releaseCharge", party: numeric(args, 1), index: numeric(args, 2) }),
  BATTLE_READ_THROWS,
);
const FINISH = {
  name: "__battle_finish", aliases: [], params: [parameter("self"), parameter("code")],
  doc: internalDocumentation(
    "Record a battle outcome.",
    "`battle.finish(code)` accepts integer codes 0 through 4 and records the outcome once through the battle owner. Codes 0, 2 and 4 run the core compatibility outcome adapter; codes 1 and 3 remain package- or custom-program-handled. The adapter announces battleEnded after the applicable outcome handling completes.",
    BATTLE_FINISH_THROWS,
  ),
  call: (view: CommandView, args: readonly Arg[]) => {
    const code = numeric(args, 1);
    resolve(owner(view).apply({ type: "finish", code }));
    return !markStockBattleOutcomePending(view)
      ? { value: null, effects: [outcomeAdapterEffect()] }
      : { value: null };
  },
} satisfies BuiltinSpec;
const STATUS_ASSET = {
  name: "__battle_status_asset", aliases: [], params: [parameter("ok"), parameter("bytes"), parameter("operation"), parameter("actor"), parameter("source"), parameter("file")],
  doc: internalDocumentation(
    "Resume a status-effect asset request.",
    "After the host replies, reads rounds from the `.ste` asset and delegates the counter change to the actor owner, keyed by the supplied file name (extension appended, StatusE prefix removed); the in-file name is display data only.",
    [
      { code: "asset.missing", when: "the requested StatusE asset is missing" },
      { code: "request.bad-reply", when: "the host reply is malformed" },
      { code: "format.status-effect", when: "the bytes are not a valid StatusE `.ste` file" },
      { code: "builtin.bad-arg", when: "the `.ste` rounds value is not a non-negative safe integer" },
      { code: "battle.bad-fighter", when: "the target actor does not exist" },
    ],
  ),
  call: statusContinuation,
} satisfies BuiltinSpec;

const HP = statCommand("hp", "Set a fighter's hp.", "hp", "set");
const GIVE_HP = statCommand("givehp", "Increase a fighter's current hp.", "hp", "add");
const GET_HP = statCommand("gethp", "Get a fighter's hp.", "hp", "get");
const MAX_HP = statCommand("maxhp", "Set a fighter's max hp.", "maxHp", "set");
const GET_MAX_HP = statCommand("getmaxhp", "Get a fighter's max hp.", "maxHp", "get");
const GIVE_SMP = statCommand("givesmp", "Increase a fighter's smp.", "smp", "add", "value");
const SMP = statCommand("smp", "Set a fighter's smp.", "smp", "set");
const GET_SMP = statCommand("getsmp", "Get a fighter's smp.", "smp", "get");
const MAX_SMP = statCommand("maxsmp", "Set a fighter's max smp.", "maxSmp", "set");
const GET_MAX_SMP = statCommand("getmaxsmp", "Get a fighter's max smp.", "maxSmp", "get");
// `fp`, `givefp` and `dp` are Reawakened actor-stat aliases, not legacy 3.1 names (rpgcode-functions.md).
const reawakenedStat = (spec: BuiltinSpec): BuiltinSpec => ({ ...spec, doc: { ...spec.doc!, groups: REAWAKENED, tags: ["experimental"] } });
const FP = reawakenedStat(statCommand("fp", "Set a fighter's fp.", "fp", "set"));
const GIVE_FP = reawakenedStat(statCommand("givefp", "Increase a fighter's fp.", "fp", "add"));
const GET_FP = statCommand("getfp", "Get a fighter's fp.", "fp", "get");
const DP = reawakenedStat(statCommand("dp", "Set a fighter's dp.", "dp", "set"));
const GET_DP = statCommand("getdp", "Get a fighter's dp.", "dp", "get");
const GIVE_EXP: BuiltinSpec = {
  name: "giveexp", aliases: [], params: [parameter("handle"), parameter("amount")],
  doc: documentation(
    "Give experience to a player.",
    `${FIGHTER_HANDLES} Awards a non-negative safe-integer number of experience points through the actor progression owner. It checks each crossed threshold in order and commits level/stat changes synchronously; the command does not wait. Legacy actor handles work without an active battle.`,
    [
      { code: "battle.bad-fighter", when: "the handle does not identify an actor" },
      { code: "battle.not-active", when: "an enemy reference is used without an active battle" },
      { code: "builtin.bad-arg", when: "the amount is not a non-negative safe integer" },
    ],
  ),
  call: (view, args) => {
    const id = referenceActor(view, args[0]?.value);
    const amount = integer(args, 1, "giveexp");
    if (amount < 0) throw new ScriptError("builtin.bad-arg", "giveexp: amount must not be negative");
    if (view.actors?.awardExperience(id, amount) === null || view.actors === undefined) return badFighter(args[0]?.value);
    return { value: null };
  },
};
const APPLY_STATUS: BuiltinSpec = {
  name: "applystatus", aliases: [], params: [parameter("target"), parameter("file")],
  doc: documentation(
    "Apply a status effect to a fighter.",
    `Loads StatusE/<file>.ste (the prefix and extension may be omitted), then starts or restarts the actor-owned counter keyed by that file name, preserving spelling and comparing ignoring case. A file value below 1 is diagnosed and stored as 0, which lasts until removed; re-application replaces the counter and never adds rounds. The embedded name is display data only. The actor owner emits the ordinary \`statusChanged\` event with detail { status, previousRounds, rounds, expired, source }. This call waits for the asset reply but does not tick counters or apply battle-round effects. ${FIGHTER_HANDLES}`,
    STATUS_APPLY_THROWS,
    STATUS_WAIT,
  ),
  call: (view, args) => statusRequest(view, args, "apply"),
};
const REMOVE_STATUS: BuiltinSpec = {
  name: "removestatus", aliases: [], params: [parameter("target"), parameter("file")],
  doc: documentation(
    "Remove a status effect from a fighter.",
    `Loads StatusE/<file>.ste (the prefix and extension may be omitted), then removes the actor-owned counter keyed by that file name, compared ignoring case; when present, the actor owner emits the ordinary \`statusChanged\` event with detail { status, previousRounds, rounds, expired, source }. Removing an absent status is a no-op. The embedded name is display data only. This call waits for the asset reply but does not tick counters or apply battle-round effects. ${FIGHTER_HANDLES}`,
    STATUS_REMOVE_THROWS,
    STATUS_WAIT,
  ),
  call: (view, args) => statusRequest(view, args, "remove"),
};

const BATTLE_START_ASSET: BuiltinSpec = {
  name: "__battle_start_enemy_asset",
  aliases: [],
  params: [parameter("ok"), parameter("bytes"), parameter("continuation")],
  doc: internalDocumentation(
    "Resume battle setup after loading an enemy.",
    "Loads each enemy asset in order, then requests the fight background before committing the battle section.",
    [...ASSET_REPLY_THROWS, { code: "format.enemy", when: "an enemy asset is not a valid `.ene` file" }],
  ),
  call: battleStartAssetContinuation,
};
const BATTLE_START_BACKGROUND_ASSET: BuiltinSpec = {
  name: "__battle_start_background_asset",
  aliases: [],
  params: [parameter("ok"), parameter("bytes"), parameter("continuation")],
  doc: internalDocumentation(
    "Resume battle setup after loading its background.",
    "Reads the background music field, starts it through the engine-owned built-in music track when present, and commits the plain-data battle section.",
    [...ASSET_REPLY_THROWS, { code: "format.battle-background", when: "the asset is not a valid `.bkg` file" }],
  ),
  call: battleStartBackgroundAssetContinuation,
};
const START_HANDOFF: BuiltinSpec = {
  name: "__battle_start_handoff",
  aliases: [],
  params: [parameter("handoff")],
  doc: internalDocumentation(
    "Start a battle from the 5.11 random-encounter handoff.",
    "Consumes the plain-data board and ordered enemy references without drawing again, loads each named `.ene` file and starts the registered battle handler.",
    [{ code: "battle.bad-handoff", when: "the handoff is missing a required board, player or enemy field" }, { code: "battle.empty-party", when: "the ordered player party is empty" }, { code: "battle.package-missing", when: "no battle handler is registered" }, ...ASSET_REPLY_THROWS, { code: "format.enemy", when: "an enemy file is not a valid `.ene` file" }],
  ),
  call: handoffBattleStart,
};
const CUSTOM_FIGHT: BuiltinSpec = {
  name: "__battle_custom_fight",
  aliases: [],
  params: [parameter("request")],
  doc: internalDocumentation(
    "Run the main file's custom fight program for a custom random encounter.",
    "Consumes the plain-data 5.11 custom request (trigger, board, actor and program name), loads no enemy and takes no random number, then runs the named program through `executeProgram` with the request as its `context` and `source` and `target` null. The program names its own enemies with `FightEnemy`.",
    [{ code: "battle.bad-handoff", when: "the request is missing a required trigger, board, player or program field, or carries fighters" }, { code: "program.missing", when: "the named program is not in the asset index" }],
  ),
  call: customFightStart,
};

const PREPARE_RANDOM_BATTLE: BuiltinSpec = {
  name: "__battle_prepare_random",
  aliases: [],
  params: [parameter("skill"), parameter("background")],
  doc: internalDocumentation(
    "Prepare a seeded random battle for a custom fight program.",
    "Draws one to four enemies from the main-file pool entries matching the skill, then loads them and creates the ordered parties and battle section without running a battle loop.",
    [{ code: "battle.empty-party", when: "the ordered player party is empty" }, { code: "asset.missing", when: "an enemy asset is missing" }, { code: "format.enemy", when: "an enemy asset is invalid" }, { code: "builtin.bad-arg", when: "the skill or background is invalid" }],
  ),
  call: (view, args) => {
    const skill = integer(args, 0, "__battle_prepare_random");
    const background = args[1]?.value;
    if (typeof background !== "string") throw new ScriptError("builtin.bad-arg", "__battle_prepare_random background must be a string");
    return beginRandomBattle(view, skill, background, false);
  },
};
const PREPARE_EXPLICIT_BATTLE: BuiltinSpec = {
  name: "__battle_prepare_enemies",
  aliases: [],
  params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  doc: internalDocumentation(
    "Prepare explicit enemies for a custom fight program.",
    "Loads one to four enemy files followed by a background and creates the ordered parties and battle section without running a battle loop.",
    [{ code: "battle.empty-party", when: "the ordered player party is empty" }, { code: "asset.missing", when: "an enemy asset is missing" }, { code: "format.enemy", when: "an enemy asset is invalid" }, { code: "builtin.bad-arg", when: "the enemy list or background is invalid" }],
  ),
  call: (view, args) => beginExplicitBattle(view, args, false, true),
};
const FIGHT: BuiltinSpec = {
  name: "fight",
  aliases: [],
  params: [parameter("skill"), parameter("background")],
  doc: {
    summary: "Start a skill level fight.",
    behaviour: "Draws a uniformly selected count of one to four enemies, then independently draws each enemy uniformly from the main-file pool entries at the requested skill. The seeded game RNG owns every draw. It loads the selected enemy files, builds party 0 in draw order and party 1 from the ordered player party (including fallen members), stores the requested background and the run permission derived from every enemy, then waits for the registered battle handler to return. An empty matching pool shows the exact “No enemies of skill level N found.” message and starts nothing.",
    groups: [GROUP], tags: ["legacy"], waits: ASSET_WAIT,
    throws: [
      { code: "battle.no-board", when: "there is no loaded board" },
      { code: "battle.empty-party", when: "the ordered player party is empty" },
      { code: "battle.package-missing", when: "no battle handler is registered" },
      ...ASSET_REPLY_THROWS,
      { code: "format.enemy", when: "an enemy file is not a valid `.ene` file" },
      { code: "builtin.bad-arg", when: "the skill or background is invalid" },
    ],
  },
  call: (view, args) => {
    const skill = integer(args, 0, "fight");
    const background = args[1]?.value;
    if (typeof background !== "string") throw new ScriptError("builtin.bad-arg", "fight background must be a string");
    return beginRandomBattle(view, skill, background, true);
  },
};
const FIGHT_ENEMY: BuiltinSpec = {
  name: "fightenemy",
  aliases: [],
  params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  doc: {
    summary: "Start a fight.",
    behaviour: "Treats the final argument as the background and each preceding argument as one enemy file, loads them in source order, and builds party 0 in that order and party 1 from the ordered player party (including fallen members). The saved background and run permission from all loaded enemies are passed to the registered battle handler, which this command waits for. This command consumes no enemy-selection randomness.",
    groups: [GROUP], tags: ["legacy"], waits: ASSET_WAIT,
    throws: [
      { code: "battle.no-board", when: "there is no loaded board" },
      { code: "battle.empty-party", when: "the ordered player party is empty" },
      { code: "battle.package-missing", when: "no battle handler is registered" },
      ...ASSET_REPLY_THROWS,
      { code: "format.enemy", when: "an enemy file is not a valid `.ene` file" },
      { code: "builtin.bad-arg", when: "the call does not contain one to four enemy files followed by a string background" },
    ],
  },
  call: (view, args) => beginExplicitBattle(view, args, true),
};

export const BATTLE_COMMANDS: readonly BuiltinSpec[] = [
  FIGHT, FIGHT_ENEMY, BATTLE_START_ASSET, BATTLE_START_BACKGROUND_ASSET, START_HANDOFF, CUSTOM_FIGHT, PREPARE_RANDOM_BATTLE, PREPARE_EXPLICIT_BATTLE,
  PARTY_SIZE, FIGHTER, AI, CHARGE, ADD_CHARGE, SET_CHARGE, RELEASE_CHARGE, CHARGE_PERCENT, FINISH,
  HP, GIVE_HP, GET_HP, MAX_HP, GET_MAX_HP, SMP, GIVE_SMP, GET_SMP, MAX_SMP, GET_MAX_SMP,
  FP, GIVE_FP, GET_FP, DP, GET_DP, GIVE_EXP, APPLY_STATUS, REMOVE_STATUS, STATUS_DATA, STATUS_ASSET, GET_STATUS, STATUS_FLAGS, STATUS_FLAGS_ASSET, STATUS_DATA_ASSET,
  MOVE_DATA, MOVE_ASSET, ITEM_DATA, ITEM_ASSET, ENEMY_DATA, ENEMY_DATA_ASSET, CHARACTER_DATA, CHARACTER_DATA_ASSET, BACKGROUND_DATA, BACKGROUND_DATA_ASSET, ANIMATION_FILE, ANIMATION_ASSET, CONSUME, BATTLE_INVENTORY, BATTLE_SCREEN, UNAFFORDABLE, INTEGER_MUL_DIV,
  STATUS_SIGNATURE, PROGRAM_CONTEXT, STATUS_DELTA, STATUS_ADVANCE,
  OUTCOME_REWARDS, GAME_OVER_PROGRAM, END_LOSS, GAIN_GOLD, BATTLE_ACTOR_REF, EXPERIENCE_BEGIN,
  EXPERIENCE_STEP_READY, LEVELUP_CONTEXT, EXPERIENCE_STEP, CLEAR_STATUSES, APPLY_OUTCOME,
];
export const BATTLE_COMMAND_NAMES = new Set<string>(BATTLE_COMMANDS.flatMap((command) => [command.name, ...command.aliases]));
export const BATTLE_PLUGIN: PluginDefinition = {
  id: "battle",
  version: "1.0.0",
  doc: {
    summary: "For game scripts, inspect active fighters, read or update stored charge, and record a battle outcome through the battle owner.",
    groups: [
      { id: GROUP, name: "Battle, stats & menus", summary: "`battle.partySize`, `battle.fighter`, charge methods (`battle.charge`, `battle.addCharge`, `battle.setCharge`, `battle.releaseCharge`, `battle.chargePercent`), and `battle.finish` are synchronous owner-mediated operations requiring an active battle. Party is 0 for enemies and 1 for the player's ordered party; indexes are zero-based. Invalid party/index/position is `battle.bad-fighter`; no active battle is `battle.not-active`. `battle.canRun`, `battle.background` and `battle.outcome` are read-only; `battlebackgrounddata()` reads the selected `.bkg` settings for the package. `battle.fighter` returns the canonical actor object." },
      { id: "internal", name: "Internal", summary: "Deterministic host continuations for battle methods and StatusE requests." },
    ],
  },
  commands: BATTLE_COMMANDS,
};

import {
  actorId,
  getActor,
  patchActor,
  validateActorProgression,
  type ActorId,
  type ActorProgression,
  type ActorRecord,
  type ActorStats,
  type ActorsSection,
  type ActorEquipmentBonuses,
} from "./model.ts";

export const ACTOR_FALLEN_CAUSES = ["damage", "status", "script"] as const;
export type ActorFallenCause = (typeof ACTOR_FALLEN_CAUSES)[number];
export type ActorSource = ActorId | number | null;

type NumericStat = keyof ActorStats;
const NUMERIC_STATS: readonly NumericStat[] = ["experience", "hp", "maxHp", "dp", "fp", "smp", "maxSmp", "level", "criticalOn", "criticalBy"];
const LEVEL_STATS = ["maxHp", "dp", "fp", "maxSmp"] as const;
type LevelStat = (typeof LEVEL_STATS)[number];

export type ActorTransition =
  | { readonly type: "fallen"; readonly actorId: ActorId; readonly cause: ActorFallenCause; readonly source: ActorId | null }
  | { readonly type: "revived"; readonly actorId: ActorId; readonly cause: ActorFallenCause; readonly source: ActorId | null }
  | { readonly type: "statusChanged"; readonly actorId: ActorId; readonly status: string; readonly previousRounds: number; readonly rounds: number; readonly expired: boolean; readonly source: ActorId | null }
  | { readonly type: "leveledUp"; readonly actorId: ActorId; readonly level: number; readonly experience: number; readonly applied: Readonly<Partial<Record<LevelStat, number>>> };

export type LegacyLevelUpHandoff = {
  readonly actorId: ActorId;
  readonly award: number;
  readonly level: number;
  readonly proposal: Readonly<LevelUpProposal>;
};

export type ActorRuleResult = {
  readonly actor: ActorRecord;
  readonly transitions: readonly ActorTransition[];
  readonly legacyLevelUps?: readonly LegacyLevelUpHandoff[];
};
export type LegacyBattleExperiencePlan = {
  readonly actor: ActorRecord;
  readonly remainingExperience: number;
  readonly maxLevel: number;
};

export type LegacyBattleLevelStep = {
  readonly actor: ActorRecord;
  readonly leveledUp: boolean;
  readonly remainingExperience: number;
  readonly transitions: readonly ActorTransition[];
};

export type StatsChangedContext = {
  readonly operation: "stats" | "equipment" | "levelUp";
  readonly previous: ActorStats;
  readonly proposal: ActorStats;
};
export type StatusChangedContext = {
  readonly status: string;
  readonly previousRounds: number;
  readonly rounds: number;
  readonly source: ActorId | null;
};
export type EquipmentChangedContext = {
  readonly equipped: readonly string[];
  readonly bonuses: ActorEquipmentBonuses;
  readonly previous: ActorEquipmentBonuses;
};
export type ReviveContext = {
  readonly cause: ActorFallenCause;
  readonly source: ActorId | null;
  readonly hp: number;
};
export type LevelUpContext = {
  readonly award: number;
  readonly level: number;
  readonly proposal: Readonly<LevelUpProposal>;
};

export type LevelUpProposal = {
  readonly level: number;
  readonly deltas: Readonly<Partial<Record<LevelStat, number>>>;
  readonly nextRequirement: number;
  readonly remainingExperience: number;
};

export type ActorHooks = {
  readonly levelUp?: (actor: Readonly<ActorRecord>, context: LevelUpContext) => LevelUpHookResult;
  readonly revive?: (actor: Readonly<ActorRecord>, context: ReviveContext) => ReviveHookResult;
  readonly statusChanged?: (actor: Readonly<ActorRecord>, context: StatusChangedContext) => StatusHookResult;
  readonly equipmentChanged?: (actor: Readonly<ActorRecord>, context: EquipmentChangedContext) => EquipmentHookResult;
  readonly statsChanged?: (actor: Readonly<ActorRecord>, context: StatsChangedContext) => StatsHookResult;
};

export type StatsHookResult = Partial<ActorStats>;
export type ReviveHookResult = { readonly hp?: number };
export type StatusHookResult = { readonly rounds?: number };
export type EquipmentHookResult = {
  readonly equipped?: readonly string[];
  readonly bonuses?: Partial<ActorEquipmentBonuses>;
};
export type LevelUpHookResult = {
  readonly deltas?: Partial<Record<LevelStat, number>>;
  readonly stats?: Partial<ActorStats>;
};

export type StatsChangeOptions = {
  readonly cause: ActorFallenCause;
  readonly source?: ActorSource;
  readonly hooks?: ActorHooks;
};

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} hook must return a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} hook must return a plain object`);
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || typeof entry === "function") throw new TypeError(`${name} hook returned invalid ${key}`);
  }
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new RangeError(`${name} returned unknown key: ${key}`);
  }
}

function safeAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${field} exceeds safe integer range`);
  return result;
}

function safeProduct(left: number, right: number, field: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${field} exceeds safe integer range`);
  return result;
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError(`${field} must be finite`);
  return value;
}

function integer(value: unknown, field: string): number {
  const result = finite(value, field);
  if (!Number.isSafeInteger(result)) throw new RangeError(`${field} must be a safe integer`);
  return result;
}

function actorSource(value: ActorSource | undefined): ActorId | null {
  if (value === undefined || value === null) return null;
  return actorId(value);
}

function cause(value: unknown): ActorFallenCause {
  if (!ACTOR_FALLEN_CAUSES.includes(value as ActorFallenCause)) throw new RangeError(`invalid fallen cause: ${String(value)}`);
  return value as ActorFallenCause;
}

function clamp(value: number, maximum: number, field: string): number {
  if (maximum < 0) throw new RangeError(`${field} maximum must not be negative`);
  return Math.max(0, Math.min(maximum, value));
}

function statsWithPatch(base: ActorStats, patch: Partial<ActorStats>): ActorStats {
  for (const key of Object.keys(patch)) {
    if (!(NUMERIC_STATS as readonly string[]).includes(key)) throw new RangeError(`unknown actor stat: ${key}`);
    integer(patch[key as NumericStat], `stats.${key}`);
  }
  const result = { ...base, ...patch };
  for (const key of NUMERIC_STATS) integer(result[key], `stats.${key}`);
  result.hp = clamp(result.hp, result.maxHp, "stats.hp");
  result.smp = clamp(result.smp, result.maxSmp, "stats.smp");
  return result;
}


function applyStatsHook(actor: ActorRecord, previous: ActorStats, proposal: ActorStats, operation: StatsChangedContext["operation"], hooks: ActorHooks | undefined): ActorStats {
  const hook = hooks?.statsChanged;
  if (hook === undefined) return proposal;
  const result = record(hook(actor, { operation, previous, proposal }), "statsChanged") as Partial<ActorStats>;
  return statsWithPatch(proposal, result);
}

function applyReviveHook(actor: ActorRecord, proposal: ActorStats, causeValue: ActorFallenCause, source: ActorId | null, hook: ActorHooks["revive"]): ActorStats {
  if (hook === undefined) return proposal;
  const result = record(hook(actor, { cause: causeValue, source, hp: proposal.hp }), "revive");
  exactKeys(result, ["hp"], "revive");
  return statsWithPatch(proposal, result as ReviveHookResult);
}

/** Apply an owner-backed absolute stat patch and return fallen/revival transitions. */
export function updateActorStats(section: ActorsSection, id: ActorId | number, patch: Partial<ActorStats>, options: StatsChangeOptions): ActorRuleResult | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  const fallenCause = cause(options.cause);
  const source = actorSource(options.source);
  const previous = actor.stats;
  const wasFallen = previous.hp <= 0;
  let proposal = statsWithPatch(previous, patch);
  proposal = applyStatsHook(actor, previous, proposal, "stats", options.hooks);
  if (wasFallen && proposal.hp > 0) proposal = applyReviveHook(actor, proposal, fallenCause, source, options.hooks?.revive);
  patchActor(section, stableId, { stats: proposal });
  const current = getActor(section, stableId);
  if (current === null) return null;
  const transitions: ActorTransition[] = [];
  if (!wasFallen && current.stats.hp <= 0) transitions.push({ type: "fallen", actorId: stableId, cause: fallenCause, source });
  if (wasFallen && current.stats.hp > 0) transitions.push({ type: "revived", actorId: stableId, cause: fallenCause, source });
  return { actor: current, transitions };
}

export type StatusChangeOptions = { readonly source?: ActorSource; readonly hooks?: ActorHooks };

/**
 * Set an actor-owned status counter. Matching identities ignore case; an
 * existing status keeps its key and its counter is replaced, never added.
 */
export function applyActorStatus(
  section: ActorsSection,
  id: ActorId | number,
  status: string,
  amount: number,
  options: StatusChangeOptions = {},
): ActorRuleResult | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  if (typeof status !== "string") throw new TypeError("status identity must be a string");
  const rounds = integer(amount, "status rounds");
  if (rounds < 0) throw new RangeError("status rounds must not be negative");
  const source = actorSource(options.source);
  const existing = Object.keys(actor.statuses).find((key) => key.toUpperCase() === status.toUpperCase());
  const key = existing ?? status;
  const previousRounds = existing === undefined ? 0 : actor.statuses[key]!;
  let nextRounds = rounds;
  if (options.hooks?.statusChanged !== undefined) {
    const result = record(options.hooks.statusChanged(actor, { status: key, previousRounds, rounds, source }), "statusChanged");
    exactKeys(result, ["rounds"], "statusChanged");
    if (result.rounds !== undefined) {
      nextRounds = integer(result.rounds, `status ${key} rounds`);
      if (nextRounds < 0) throw new RangeError(`status ${key} rounds must not be negative`);
    }
  }
  const statuses = { ...actor.statuses };
  Object.defineProperty(statuses, key, { value: nextRounds, enumerable: true, writable: true, configurable: true });
  patchActor(section, stableId, { statuses });
  const current = getActor(section, stableId);
  if (current === null) return null;
  return {
    actor: current,
    transitions: [{ type: "statusChanged", actorId: stableId, status: key, previousRounds, rounds: nextRounds, expired: false, source }],
  };
}

/** Remove one matching actor status and report its ordinary transition. */
export function removeActorStatus(
  section: ActorsSection,
  id: ActorId | number,
  status: string,
  options: StatusChangeOptions = {},
): ActorRuleResult | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  if (typeof status !== "string") throw new TypeError("status identity must be a string");
  const key = Object.keys(actor.statuses).find((candidate) => candidate.toUpperCase() === status.toUpperCase());
  if (key === undefined) return { actor, transitions: [] };
  const previousRounds = actor.statuses[key]!;
  const source = actorSource(options.source);
  let rounds = 0;
  if (options.hooks?.statusChanged !== undefined) {
    const result = record(options.hooks.statusChanged(actor, { status: key, previousRounds, rounds, source }), "statusChanged");
    exactKeys(result, ["rounds"], "statusChanged");
    if (result.rounds !== undefined) {
      rounds = integer(result.rounds, `status ${key} rounds`);
      if (rounds < 0) throw new RangeError(`status ${key} rounds must not be negative`);
    }
  }
  const statuses = { ...actor.statuses };
  if (rounds === 0) delete statuses[key];
  else Object.defineProperty(statuses, key, { value: rounds, enumerable: true, writable: true, configurable: true });
  patchActor(section, stableId, { statuses });
  const current = getActor(section, stableId);
  if (current === null) return null;
  return {
    actor: current,
    transitions: [{ type: "statusChanged", actorId: stableId, status: key, previousRounds, rounds, expired: rounds === 0, source }],
  };
}
export type AdvanceStatusOptions = { readonly source?: ActorSource; readonly hooks?: ActorHooks };

/** Age every actor status by a caller-defined non-negative integer amount. */
export function advanceStatus(section: ActorsSection, id: ActorId | number, amount: number, options: AdvanceStatusOptions = {}): ActorRuleResult | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  const age = integer(amount, "status advance");
  if (age < 0) throw new RangeError("status advance must not be negative");
  const source = actorSource(options.source);
  const nextStatuses: Record<string, number> = {};
  const transitions: ActorTransition[] = [];
  for (const status of Object.keys(actor.statuses).sort()) {
    const previousRounds = integer(actor.statuses[status], `statuses.${status}`);
    if (previousRounds < 0) throw new RangeError(`statuses.${status} must not be negative`);
    let rounds = previousRounds === 0 ? 0 : Math.max(0, previousRounds - age);
    if (options.hooks?.statusChanged !== undefined) {
      const result = record(options.hooks.statusChanged(actor, { status, previousRounds, rounds, source }), "statusChanged");
      exactKeys(result, ["rounds"], "statusChanged");
      if (result.rounds !== undefined) {
        rounds = integer(result.rounds, `status ${status} rounds`);
        if (rounds < 0) throw new RangeError(`status ${status} rounds must not be negative`);
      }
    }
    const expired = previousRounds > 0 && rounds === 0;
    if (!expired) Object.defineProperty(nextStatuses, status, { value: rounds, enumerable: true, writable: true, configurable: true });
    if (rounds !== previousRounds || expired) {
      transitions.push({ type: "statusChanged", actorId: stableId, status, previousRounds, rounds, expired, source });
    }
  }
  patchActor(section, stableId, { statuses: nextStatuses });
  const current = getActor(section, stableId);
  if (current === null) return null;
  return { actor: current, transitions };
}

export type EquipmentItemDefinition = {
  readonly name: string;
  readonly equipBonus: readonly number[];
  readonly id?: string;
};

/** Raw `.itm` fields accepted at the asset boundary; actor operations use the normalized definition. */
export type RawEquipmentItem = {
  readonly itemName: string;
  readonly equipHP: number;
  readonly equipDP: number;
  readonly equipFP: number;
  readonly equipSM: number;
  readonly id?: string;
};

export function equipmentDefinitionFromItem(item: RawEquipmentItem): EquipmentItemDefinition {
  if (typeof item.itemName !== "string" || item.itemName.length === 0) throw new TypeError("itemName must be non-empty");
  if (item.id !== undefined && (typeof item.id !== "string" || item.id.length === 0)) throw new TypeError("item id must be a non-empty string");
  const equipBonus = [item.equipHP, item.equipDP, item.equipFP, item.equipSM];
  equipBonus.forEach((value, index) => integer(value, `item ${item.itemName} equipBonus[${index}]`));
  return {
    name: item.itemName,
    ...(item.id === undefined ? {} : { id: item.id }),
    equipBonus,
  };
}

function validateEquipmentDefinition(item: EquipmentItemDefinition, index: number): void {
  if (typeof item.name !== "string" || item.name.length === 0) throw new TypeError(`item catalog entry ${index} name must be non-empty`);
  if (item.id !== undefined && (typeof item.id !== "string" || item.id.length === 0)) throw new TypeError(`item catalog entry ${index} id must be a non-empty string`);
  if (!Array.isArray(item.equipBonus) || item.equipBonus.length !== 4) throw new TypeError(`item catalog entry ${index} must have four equip bonuses`);
  item.equipBonus.forEach((value, bonusIndex) => integer(value, `item catalog entry ${index} equipBonus[${bonusIndex}]`));
}

/** Derive the four equipment bonuses from the catalog; the same pure rule ApplyEquipment uses (E-82). */
export function deriveEquipmentBonuses(items: readonly EquipmentItemDefinition[], equipped: readonly string[]): ActorEquipmentBonuses {
  items.forEach(validateEquipmentDefinition);
  const result = { hp: 0, dp: 0, fp: 0, smp: 0 };
  for (const reference of equipped) {
    if (typeof reference !== "string" || reference.length === 0) throw new TypeError("equipment references must be non-empty strings");
    const matches = items.filter((candidate) => candidate.name === reference || candidate.id === reference);
    if (matches.length > 1) throw new RangeError(`ambiguous equipped item reference: ${reference}`);
    const item = matches[0];
    if (item === undefined) throw new RangeError(`unknown equipped item: ${reference}`);
    result.hp = safeAdd(result.hp, item.equipBonus[0]!, `item ${reference} HP bonus`);
    result.dp = safeAdd(result.dp, item.equipBonus[1]!, `item ${reference} DP bonus`);
    result.fp = safeAdd(result.fp, item.equipBonus[2]!, `item ${reference} FP bonus`);
    result.smp = safeAdd(result.smp, item.equipBonus[3]!, `item ${reference} SMP bonus`);
  }
  return result;
}

/** Prepare equipment changes without publishing them (E-82, Epic 8.5). */
export function prepareEquipment(section: ActorsSection, id: ActorId | number, equipped: readonly string[], items: readonly EquipmentItemDefinition[], hooks: ActorHooks = {}): ActorRuleResult | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  if (!Array.isArray(equipped) || equipped.some((entry) => typeof entry !== "string")) throw new TypeError("equipment references must be strings");
  if (new Set(equipped).size !== equipped.length) throw new RangeError("equipment references must be unique");
  const hookActor: ActorRecord = {
    ...actor,
    stats: { ...actor.stats },
    statuses: { ...actor.statuses },
    equipment: { equipped: [...actor.equipment.equipped], bonuses: { ...actor.equipment.bonuses } },
    progression: { ...actor.progression },
    customEvents: [...actor.customEvents],
  };
  const previousBonuses = { ...actor.equipment.bonuses };
  let nextEquipped = [...equipped];
  let nextBonuses = deriveEquipmentBonuses(items, nextEquipped);
  if (hooks.equipmentChanged !== undefined) {
    const result = record(hooks.equipmentChanged(hookActor, {
      equipped: [...nextEquipped],
      bonuses: { ...nextBonuses },
      previous: { ...previousBonuses },
    }), "equipmentChanged");
    exactKeys(result, ["equipped", "bonuses"], "equipmentChanged");
    if (result.equipped !== undefined) {
      if (!Array.isArray(result.equipped) || result.equipped.some((entry) => typeof entry !== "string")) throw new TypeError("equipmentChanged equipped must be strings");
      if (new Set(result.equipped).size !== result.equipped.length) throw new RangeError("equipmentChanged equipped must be unique");
      nextEquipped = [...result.equipped];
      nextBonuses = deriveEquipmentBonuses(items, nextEquipped);
    }
    if (result.bonuses !== undefined) {
      const bonusPatch = record(result.bonuses, "equipmentChanged.bonuses");
      exactKeys(bonusPatch, ["hp", "dp", "fp", "smp"], "equipmentChanged.bonuses");
      const merged = { ...nextBonuses, ...bonusPatch };
      nextBonuses = {
        hp: integer(merged.hp, "equipment.bonuses.hp"),
        dp: integer(merged.dp, "equipment.bonuses.dp"),
        fp: integer(merged.fp, "equipment.bonuses.fp"),
        smp: integer(merged.smp, "equipment.bonuses.smp"),
      };
    }
  }
  const wasFallen = actor.stats.hp <= 0;
  const hpDelta = safeAdd(nextBonuses.hp, -previousBonuses.hp, "equipment HP delta");
  const smpDelta = safeAdd(nextBonuses.smp, -previousBonuses.smp, "equipment SMP delta");
  const dpDelta = safeAdd(nextBonuses.dp, -previousBonuses.dp, "equipment DP delta");
  const fpDelta = safeAdd(nextBonuses.fp, -previousBonuses.fp, "equipment FP delta");
  let stats = { ...actor.stats };
  stats.hp = safeAdd(stats.hp, hpDelta, "current HP");
  stats.maxHp = safeAdd(stats.maxHp, hpDelta, "maximum HP");
  stats.dp = safeAdd(stats.dp, dpDelta, "DP");
  stats.fp = safeAdd(stats.fp, fpDelta, "FP");
  stats.smp = safeAdd(stats.smp, smpDelta, "current SMP");
  stats.maxSmp = safeAdd(stats.maxSmp, smpDelta, "maximum SMP");
  stats = statsWithPatch(stats, {});
  stats = applyStatsHook(hookActor, { ...actor.stats }, stats, "equipment", hooks);
  if (wasFallen && stats.hp > 0) stats = applyReviveHook(hookActor, { ...stats }, "script", null, hooks.revive);
  const candidate: ActorsSection = { ...section, actors: [...section.actors] };
  patchActor(candidate, stableId, { equipment: { equipped: nextEquipped, bonuses: nextBonuses }, stats });
  const current = getActor(candidate, stableId);
  if (current === null) return null;
  const transitions: ActorTransition[] = [];
  if (!wasFallen && current.stats.hp <= 0) transitions.push({ type: "fallen", actorId: stableId, cause: "script", source: null });
  if (wasFallen && current.stats.hp > 0) transitions.push({ type: "revived", actorId: stableId, cause: "script", source: null });
  return { actor: current, transitions };
}

/** Apply equipment through the existing actor owner operation. */
export function applyEquipment(section: ActorsSection, id: ActorId | number, equipped: readonly string[], items: readonly EquipmentItemDefinition[], hooks: ActorHooks = {}): ActorRuleResult | null {
  const prepared = prepareEquipment(section, id, equipped, items, hooks);
  if (prepared === null) return null;
  const actor = patchActor(section, id, { equipment: prepared.actor.equipment, stats: prepared.actor.stats });
  return actor === null ? null : { ...prepared, actor };
}

function progressionInput(actor: ActorRecord): ActorProgression {
  validateActorProgression(actor.stats, actor.progression);
  return actor.progression;
}

function growth(base: number, configured: number, type: number): number {
  if (type === 1) return configured;
  const product = safeProduct(base, configured, "percentage growth");
  const result = Math.trunc(product / 100);
  if (!Number.isSafeInteger(result)) throw new RangeError("percentage growth exceeds safe integer range");
  return result;
}

function levelDeltas(actor: ActorRecord, progression: ActorProgression): Partial<Record<LevelStat, number>> {
  return {
    maxHp: growth(safeAdd(actor.stats.maxHp, -actor.equipment.bonuses.hp, "intrinsic maximum HP"), progression.levelHp, progression.levelUpType),
    dp: growth(safeAdd(actor.stats.dp, -actor.equipment.bonuses.dp, "intrinsic DP"), progression.levelDp, progression.levelUpType),
    fp: growth(safeAdd(actor.stats.fp, -actor.equipment.bonuses.fp, "intrinsic FP"), progression.levelFp, progression.levelUpType),
    maxSmp: growth(safeAdd(actor.stats.maxSmp, -actor.equipment.bonuses.smp, "intrinsic maximum SMP"), progression.levelSm, progression.levelUpType),
  };
}

function validateLevelDeltas(deltas: Partial<Record<LevelStat, number>>, name: string): void {
  const value = deltas as Record<string, unknown>;
  exactKeys(value, LEVEL_STATS, name);
  for (const [key, entry] of Object.entries(value)) integer(entry, `${name}.${key}`);
}

function applyLevelDelta(stats: ActorStats, deltas: Partial<Record<LevelStat, number>>): ActorStats {
  validateLevelDeltas(deltas, "level-up deltas");
  const next = { ...stats };
  for (const stat of LEVEL_STATS) {
    const delta = deltas[stat] ?? 0;
    next[stat] = safeAdd(next[stat], delta, `level-up ${stat}`);
  }
  return statsWithPatch(next, {});
}

/** Award integer XP, applying every crossed level threshold synchronously. */
export function awardExperience(section: ActorsSection, id: ActorId | number, amount: number, hooks: ActorHooks = {}): ActorRuleResult | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  const award = integer(amount, "experience award");
  if (award < 0) throw new RangeError("experience award must not be negative");
  const progression = progressionInput(actor);
  if (progression.legacyLevelUp === null) throw new RangeError("legacy level-up precedence is unresolved");
  let experience = safeAdd(actor.stats.experience, award, "total experience");
  let level = integer(actor.stats.level, "stats.level");
  let remaining = progression.remainingExperience;
  let nextRequirement = progression.nextRequirement;
  let stats = actor.stats;
  let appliedCoreLevelUp = false;
  const wasFallen = actor.stats.hp <= 0;
  const transitions: ActorTransition[] = [];
  const legacyLevelUps: LegacyLevelUpHandoff[] = [];
  if (progression.maxLevel > 0 && level < progression.maxLevel) {
    remaining = safeAdd(remaining, -award, "remaining experience");
    while (remaining <= 0 && level < progression.maxLevel) {
      const proposedLevel = safeAdd(level, 1, "actor level");
      let deltas = levelDeltas({ ...actor, stats }, progression);
      const proposal: LevelUpProposal = { level: proposedLevel, deltas, nextRequirement, remainingExperience: remaining };
      if (progression.legacyLevelUp) {
        legacyLevelUps.push({ actorId: stableId, award, level: proposedLevel, proposal });
      } else {
        if (hooks.levelUp !== undefined) {
          const hookResult = record(hooks.levelUp({ ...actor, stats }, { award, level: proposedLevel, proposal }), "levelUp");
          exactKeys(hookResult, ["deltas", "stats"], "levelUp");
          if (hookResult.deltas !== undefined) {
            const deltaPatch = record(hookResult.deltas, "levelUp.deltas") as Partial<Record<LevelStat, number>>;
            validateLevelDeltas(deltaPatch, "levelUp.deltas");
            deltas = { ...deltas, ...deltaPatch };
          }
          if (hookResult.stats !== undefined) {
            const statsPatch = record(hookResult.stats, "levelUp.stats") as Partial<ActorStats>;
            stats = statsWithPatch(stats, statsPatch);
          }
        }
        stats = applyLevelDelta(stats, deltas);
        appliedCoreLevelUp = true;
        transitions.push({ type: "leveledUp", actorId: stableId, level: proposedLevel, experience, applied: { ...deltas } });
      }
      level = proposedLevel;
      if (level >= progression.maxLevel) {
        remaining = 0;
        break;
      }
      const oldRequirement = nextRequirement;
      if (oldRequirement <= 0) throw new RangeError("invalid actor progression threshold");
      if (progression.levelUpType === 0) {
        const product = safeProduct(oldRequirement, progression.experienceIncrease, "percentage threshold");
        nextRequirement = safeAdd(oldRequirement, Math.trunc(product / 100), "next level requirement");
      } else {
        nextRequirement = safeAdd(oldRequirement, progression.experienceIncrease, "next level requirement");
      }
      if (nextRequirement <= 0) throw new RangeError("invalid actor progression threshold");
      remaining = safeAdd(remaining, nextRequirement, "remaining experience");
    }
  }
  stats = statsWithPatch(stats, { level, experience });
  if (appliedCoreLevelUp) {
    stats = applyStatsHook(actor, actor.stats, stats, "levelUp", hooks);
    if (wasFallen && stats.hp > 0) stats = applyReviveHook(actor, stats, "script", null, hooks.revive);
  }
  patchActor(section, stableId, {
    stats,
    progression: { remainingExperience: remaining, nextRequirement },
  });
  const current = getActor(section, stableId);
  if (current === null) return null;
  if (wasFallen && current.stats.hp > 0) transitions.push({ type: "revived", actorId: stableId, cause: "script", source: null });
  return legacyLevelUps.length === 0 ? { actor: current, transitions } : { actor: current, transitions, legacyLevelUps };
}
/** Record full battle XP first so a legacy level-up program sees the new total before growth. */
export function beginLegacyBattleExperienceAward(
  section: ActorsSection,
  id: ActorId | number,
  amount: number,
): LegacyBattleExperiencePlan | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  const award = integer(amount, "experience award");
  if (award < 0) throw new RangeError("experience award must not be negative");
  const progression = progressionInput(actor);
  if (progression.legacyLevelUp !== true) throw new RangeError("legacy level-up program is not enabled");
  const remainingExperience = progression.maxLevel > 0 && actor.stats.level < progression.maxLevel
    ? safeAdd(progression.remainingExperience, -award, "remaining experience")
    : progression.remainingExperience;
  const experience = safeAdd(actor.stats.experience, award, "total experience");
  patchActor(section, stableId, { stats: statsWithPatch(actor.stats, { experience }) });
  const current = getActor(section, stableId);
  return current === null ? null : { actor: current, remainingExperience, maxLevel: progression.maxLevel };
}

/** Apply one legacy level's built-in growth after its program has returned. */
export function completeLegacyBattleLevelStep(
  section: ActorsSection,
  id: ActorId | number,
  remainingExperienceValue: number,
  hooks: ActorHooks = {},
): LegacyBattleLevelStep | null {
  const stableId = actorId(id);
  const actor = getActor(section, stableId);
  if (actor === null) return null;
  const remainingExperience = integer(remainingExperienceValue, "remaining experience");
  if (remainingExperience > 0) throw new RangeError("a legacy level-up step requires a reached threshold");
  const progression = progressionInput(actor);
  if (progression.legacyLevelUp !== true) throw new RangeError("legacy level-up program is not enabled");
  if (progression.maxLevel <= 0 || actor.stats.level >= progression.maxLevel) {
    patchActor(section, stableId, { progression: { remainingExperience: 0 } });
    const current = getActor(section, stableId);
    return current === null ? null : { actor: current, leveledUp: false, remainingExperience: 0, transitions: [] };
  }
  const level = safeAdd(actor.stats.level, 1, "actor level");
  const deltas = levelDeltas(actor, progression);
  const wasFallen = actor.stats.hp <= 0;
  let stats = applyLevelDelta(statsWithPatch(actor.stats, { level }), deltas);
  stats = applyStatsHook(actor, actor.stats, stats, "levelUp", hooks);
  if (wasFallen && stats.hp > 0) stats = applyReviveHook(actor, stats, "script", null, hooks.revive);
  let nextRequirement = progression.nextRequirement;
  let nextRemaining = 0;
  if (level < progression.maxLevel) {
    if (nextRequirement <= 0) throw new RangeError("invalid actor progression threshold");
    if (progression.levelUpType === 0) {
      const product = safeProduct(nextRequirement, progression.experienceIncrease, "percentage threshold");
      nextRequirement = safeAdd(nextRequirement, Math.trunc(product / 100), "next level requirement");
    } else {
      nextRequirement = safeAdd(nextRequirement, progression.experienceIncrease, "next level requirement");
    }
    if (nextRequirement <= 0) throw new RangeError("invalid actor progression threshold");
    nextRemaining = safeAdd(remainingExperience, nextRequirement, "remaining experience");
  }
  patchActor(section, stableId, { stats, progression: { remainingExperience: nextRemaining < 0 ? 0 : nextRemaining, nextRequirement } });
  const current = getActor(section, stableId);
  if (current === null) return null;
  const transitions: ActorTransition[] = [{
    type: "leveledUp",
    actorId: stableId,
    level,
    experience: current.stats.experience,
    applied: { ...deltas },
  }];
  if (wasFallen && current.stats.hp > 0) transitions.push({ type: "revived", actorId: stableId, cause: "script", source: null });
  return { actor: current, leveledUp: true, remainingExperience: nextRemaining, transitions };
}

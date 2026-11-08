import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  advanceStatus,
  applyActorStatus,
  applyEquipment,
  equipmentDefinitionFromItem,
  awardExperience,
  createActorService,
  createActorsSection,
  removeActorStatus,
  updateActorStats,
  type ActorHooks,
  type StatusChangedContext,
} from "../src/index.ts";

function actor(overrides: Record<string, unknown> = {}) {
  const section = createActorsSection();
  const progressionOverrides = overrides.progression;
  const validProgressionOverrides = progressionOverrides !== null && typeof progressionOverrides === "object"
    ? progressionOverrides as Record<string, unknown>
    : {};
  const { progression: _progression, ...actorFields } = overrides;
  const result = addActor(section, {
    kind: "party",
    source: "hero.tem",
    stats: { hp: 10, maxHp: 10, smp: 4, maxSmp: 4, dp: 10, fp: 10, level: 1, experience: 0 },
    progression: {
      levelType: 10,
      nextRequirement: 10,
      remainingExperience: 10,
      maxLevel: 10,
      experienceIncrease: 100,
      levelHp: 10,
      levelDp: 10,
      levelFp: 10,
      levelSm: 10,
      levelUpType: 1,
      ...validProgressionOverrides,
    },
    ...actorFields,
  });
  return { section, actor: result };
}

test("fallen and revival retain the actor and emit one cause/source transition", () => {
  const state = actor();
  const fallen = updateActorStats(state.section, state.actor.id, { hp: 0 }, { cause: "damage", source: 7 });
  ok(fallen);
  equal(fallen.actor.stats.hp, 0);
  deepEqual(fallen.transitions, [
    { type: "fallen", actorId: state.actor.id, cause: "damage", source: 7 },
  ]);
  const duplicate = updateActorStats(state.section, state.actor.id, { hp: 0 }, { cause: "damage", source: 7 });
  ok(duplicate);
  equal(duplicate.transitions.some((transition) => transition.type === "fallen"), false);
  const revived = updateActorStats(state.section, state.actor.id, { hp: 5 }, { cause: "script", source: null });
  ok(revived);
  equal(revived.actor.id, state.actor.id);
  deepEqual(revived.transitions.at(-1), { type: "revived", actorId: state.actor.id, cause: "script", source: null });
  const noRevival = updateActorStats(state.section, state.actor.id, { hp: 0 }, { cause: "status" });
  ok(noRevival);
  equal(noRevival.transitions.some((transition) => transition.type === "revived"), false);
  throws(() => updateActorStats(state.section, state.actor.id, { hp: 0 }, { cause: "bad" as never }));
  throws(() => updateActorStats(state.section, state.actor.id, { hp: 0 }, { cause: "damage", source: 0 }));
});
test("advanceStatus ages all counters in stable order and supports caller timing policies", () => {
  const perTurn = actor();
  perTurn.actor.statuses = { burn: 1, poison: 3, slow: 2 };
  const perTime = actor();
  perTime.actor.statuses = { burn: 1, poison: 3, slow: 2 };
  const first = advanceStatus(perTurn.section, perTurn.actor.id, 2);
  const second = advanceStatus(perTime.section, perTime.actor.id, 1);
  ok(first && second);
  deepEqual(first.actor.statuses, { poison: 1 });
  deepEqual(first.transitions.filter((transition) => transition.type === "statusChanged").map((transition) => transition.status), ["burn", "poison", "slow"]);
  deepEqual(first.transitions.filter((transition) => transition.type === "statusChanged").map((transition) => transition.rounds), [0, 1, 0]);
  deepEqual(first.transitions.filter((transition) => transition.type === "statusChanged").map((transition) => transition.source), [null, null, null]);
  const noChange = advanceStatus(perTime.section, perTime.actor.id, 0);
  ok(noChange);
  deepEqual(noChange.transitions, []);
  const third = advanceStatus(perTime.section, perTime.actor.id, 1);
  ok(third);
  deepEqual(third.actor.statuses, { poison: 1 });
  let hookRounds = -1;
  const expired = advanceStatus(perTurn.section, perTurn.actor.id, 2, {
    hooks: { statusChanged: (_actor, context) => { hookRounds = context.rounds; return {}; } },
  });
  ok(expired);
  equal(hookRounds, 0);
  throws(() => advanceStatus(perTurn.section, perTurn.actor.id, -1));
  throws(() => advanceStatus(perTurn.section, perTurn.actor.id, 1.5));
});
test("zero-round statuses remain indefinite until explicitly removed", () => {
  const state = actor();
  state.actor.statuses = { indefinite: 0 };
  const aged = advanceStatus(state.section, state.actor.id, 99);
  ok(aged);
  deepEqual(aged.actor.statuses, { indefinite: 0 });
  deepEqual(aged.transitions, []);
  const removed = removeActorStatus(state.section, state.actor.id, "INDEFINITE");
  ok(removed);
  deepEqual(removed.actor.statuses, {});
  deepEqual(removed.transitions.map((transition) => transition.type === "statusChanged" && [transition.status, transition.expired]), [["indefinite", true]]);
});


test("equipment derives four bonuses from item data and applies stat deltas", () => {
  const state = actor();
  const blade = equipmentDefinitionFromItem({ itemName: "blade", equipHP: 5, equipDP: 2, equipFP: 3, equipSM: 1 });
  deepEqual(blade, { name: "blade", equipBonus: [5, 2, 3, 1] });
  const equipped = applyEquipment(state.section, state.actor.id, ["blade", "ring"], [
    blade,
    { name: "ring", id: "ring", equipBonus: [2, 1, 4, 2] },
  ]);
  ok(equipped);
  deepEqual(equipped.actor.equipment.bonuses, { hp: 7, dp: 3, fp: 7, smp: 3 });
  deepEqual(equipped.actor.stats, { ...state.actor.stats, hp: 17, maxHp: 17, dp: 13, fp: 17, smp: 7, maxSmp: 7 });
  const removed = applyEquipment(state.section, state.actor.id, [], [
    { name: "blade", equipBonus: [5, 2, 3, 1] },
    { name: "ring", equipBonus: [2, 1, 4, 2] },
  ]);
  ok(removed);
  deepEqual(removed.actor.stats, state.actor.stats);
  throws(() => applyEquipment(state.section, state.actor.id, ["blade", "blade"], [blade]));
  throws(() => applyEquipment(state.section, state.actor.id, ["blade"], [
    blade,
    { name: "blade", equipBonus: [5, 2, 3, 1] },
  ]));
  throws(() => applyEquipment(state.section, state.actor.id, ["missing"], []));
  throws(() => applyEquipment(state.section, state.actor.id, ["bad"], [{ name: "bad", equipBonus: [1, 2, 3] }]));
});

test("preparing equipment leaves actor state unpublished until commit", () => {
  const state = actor();
  let hooks = 0;
  const service = createActorService(state.section, () => ({
    equipmentChanged: () => { hooks += 1; return {}; },
  }));
  const before = JSON.stringify(state.section);
  const prepared = service.prepareEquipment(state.actor.id, ["blade"], [
    { name: "blade", equipBonus: [5, 2, 3, 1] },
  ]);
  ok(prepared);
  equal(hooks, 1);
  equal(JSON.stringify(state.section), before);
  equal(prepared.actor.stats.hp, 15);
  const committed = service.commitPreparedEquipment(prepared);
  ok(committed);
  equal(hooks, 1);
  equal(state.section.actors[0]!.stats.hp, 15);
  const committedState = JSON.stringify(state.section);
  const refusing = createActorService(state.section, () => ({
    equipmentChanged: () => { throw new Error("refused"); },
  }));
  throws(() => refusing.prepareEquipment(state.actor.id, [], []));
  equal(JSON.stringify(state.section), committedState);
});
test("equipment preparation isolates hook inputs and queues actor transitions only on commit", () => {
  const state = actor({ stats: { hp: 0, maxHp: 10 } });
  const events: unknown[] = [];
  const service = createActorService(state.section, () => ({
    equipmentChanged: (record) => {
      record.stats.hp = 900;
      return {};
    },
    revive: () => ({ hp: 4 }),
  }), (result) => events.push(...result.transitions));
  const before = JSON.stringify(state.section);
  const prepared = service.prepareEquipment(state.actor.id, ["charm"], [
    { name: "charm", equipBonus: [1, 0, 0, 0] },
  ]);
  ok(prepared);
  equal(JSON.stringify(state.section), before);
  deepEqual(events, []);
  equal(prepared.actor.stats.hp, 4);
  const committed = service.commitPreparedEquipment(prepared);
  ok(committed);
  equal(state.section.actors[0]!.stats.hp, 4);
  deepEqual(events, [{ type: "revived", actorId: state.actor.id, cause: "script", source: null }]);
});
test("equipment hook patches are closed and preserve unique references", () => {
  const state = actor({ statuses: { poison: 1 } });
  throws(() => applyEquipment(state.section, state.actor.id, ["blade"], [{ name: "blade", equipBonus: [1, 1, 1, 1] }], {
    equipmentChanged: () => ({ equipped: ["blade", "blade"] }),
  }));
  throws(() => applyEquipment(state.section, state.actor.id, ["blade"], [{ name: "blade", equipBonus: [1, 1, 1, 1] }], {
    equipmentChanged: () => ({ bonuses: { hp: 1, unknown: 2 } as never }),
  }));
  throws(() => advanceStatus(state.section, state.actor.id, 0, { hooks: { statusChanged: () => ({ rounds: -1 }) } }));
  throws(() => awardExperience(state.section, state.actor.id, 10, { levelUp: () => ({ deltas: { maxHp: 1, unknown: 2 } as never }) }));
});

test("equipment source normalization rejects malformed identity and bonuses", () => {
  throws(() => equipmentDefinitionFromItem({ itemName: "bad", equipHP: Number.NaN, equipDP: 0, equipFP: 0, equipSM: 0 }));
  throws(() => equipmentDefinitionFromItem({ itemName: "bad", equipHP: 1.5, equipDP: 0, equipFP: 0, equipSM: 0 }));
  throws(() => equipmentDefinitionFromItem({ itemName: "bad", equipHP: 0, equipDP: 0, equipFP: 0, equipSM: 0, id: 1 as never }));
});

test("revival hook follows stats hooks and runs once for stats and equipment crossings", () => {
  const statsState = actor({ stats: { hp: 0, maxHp: 10 } });
  const statsCalls: string[] = [];
  const revivedByStats = updateActorStats(statsState.section, statsState.actor.id, { hp: 0 }, {
    cause: "script",
    hooks: {
      statsChanged: () => { statsCalls.push("stats"); return { hp: 5 }; },
      revive: () => { statsCalls.push("revive"); return {}; },
    },
  });
  ok(revivedByStats);
  deepEqual(statsCalls, ["stats", "revive"]);
  deepEqual(revivedByStats.transitions, [{ type: "revived", actorId: statsState.actor.id, cause: "script", source: null }]);

  const equipmentState = actor({ stats: { hp: 0, maxHp: 10 } });
  const equipmentCalls: string[] = [];
  const revivedByEquipment = applyEquipment(equipmentState.section, equipmentState.actor.id, ["ring"], [{ name: "ring", equipBonus: [0, 0, 0, 0] }], {
    statsChanged: () => { equipmentCalls.push("stats"); return { hp: 5 }; },
    revive: () => { equipmentCalls.push("revive"); return {}; },
  });
  ok(revivedByEquipment);
  deepEqual(equipmentCalls, ["stats", "revive"]);
  deepEqual(revivedByEquipment.transitions, [{ type: "revived", actorId: equipmentState.actor.id, cause: "script", source: null }]);
});

test("a revive hook that leaves HP non-positive emits no revived transition", () => {
  const state = actor({ stats: { hp: 0, maxHp: 10 } });
  const result = updateActorStats(state.section, state.actor.id, { hp: 1 }, {
    cause: "script",
    hooks: { revive: () => ({ hp: 0 }) },
  });
  ok(result);
  equal(result.actor.stats.hp, 0);
  deepEqual(result.transitions, []);
});

test("XP uses fixed and percentage branches, carries multi-level awards, excludes equipment and never refills", () => {
  const fixed = actor({ progression: { levelUpType: 1, levelHp: 5, levelDp: 2, levelFp: 3, levelSm: 4, experienceIncrease: 5 } });
  fixed.actor.equipment.bonuses = { hp: 10, dp: 10, fp: 10, smp: 10 };
  const fixedResult = awardExperience(fixed.section, fixed.actor.id, 25);
  ok(fixedResult);
  equal(fixedResult.actor.stats.experience, 25);
  equal(fixedResult.actor.stats.level, 3);
  equal(fixedResult.actor.stats.hp, 10);
  equal(fixedResult.actor.stats.smp, 4);
  equal(fixedResult.actor.progression.remainingExperience, 20);

  const percentage = actor({
    stats: { hp: 10, maxHp: 20, smp: 4, maxSmp: 20, dp: 20, fp: 20, level: 1, experience: 0 },
    progression: { levelUpType: 0, levelHp: 50, levelDp: 50, levelFp: 50, levelSm: 50, experienceIncrease: 50, nextRequirement: 20, remainingExperience: 20 },
  });
  percentage.actor.equipment.bonuses = { hp: 10, dp: 10, fp: 10, smp: 10 };
  const percentageResult = awardExperience(percentage.section, percentage.actor.id, 20);
  ok(percentageResult);
  equal(percentageResult.actor.stats.maxHp, 25);
  equal(percentageResult.actor.stats.dp, 25);
  equal(percentageResult.actor.stats.fp, 25);
  equal(percentageResult.actor.stats.maxSmp, 25);
});

test("legacy battle steps carry over-threshold XP without persisting a negative remainder", () => {
  const state = actor({
    progression: { maxLevel: 3, levelUpType: 1, experienceIncrease: 5, legacyLevelUp: true },
  });
  const service = createActorService(state.section);
  const plan = service.beginLegacyBattleExperience(state.actor.id, 30);
  ok(plan);
  equal(plan.remainingExperience, -20);
  const firstStep = service.completeLegacyBattleLevelStep(state.actor.id, plan.remainingExperience);
  ok(firstStep);
  equal(firstStep.actor.stats.level, 2);
  equal(firstStep.remainingExperience, -5);
  equal(firstStep.actor.progression.remainingExperience, 0);
  const secondStep = service.completeLegacyBattleLevelStep(state.actor.id, firstStep.remainingExperience);
  ok(secondStep);
  equal(secondStep.actor.stats.level, 3);
  equal(secondStep.remainingExperience, 0);
  equal(secondStep.actor.progression.remainingExperience, 0);
});

test("statsChanged runs only for applied core level-ups", () => {
  const state = actor();
  let calls = 0;
  const belowThreshold = awardExperience(state.section, state.actor.id, 1, { statsChanged: () => { calls += 1; return { dp: 999 }; } });
  ok(belowThreshold);
  equal(calls, 0);
  equal(belowThreshold.actor.stats.dp, 10);
  const levelled = awardExperience(state.section, state.actor.id, 9, { statsChanged: () => { calls += 1; return {}; } });
  ok(levelled);
  equal(calls, 1);
  const maxed = actor({ progression: { maxLevel: 1 } });
  const maxedResult = awardExperience(maxed.section, maxed.actor.id, 100, { statsChanged: () => { calls += 1; return { dp: 999 }; } });
  ok(maxedResult);
  equal(maxedResult.actor.stats.dp, 10);
  equal(calls, 1);
});

test("safe arithmetic rejects overflow without partial actor mutation", () => {
  const equipmentState = actor();
  const beforeEquipment = { ...equipmentState.actor.stats };
  throws(() => applyEquipment(equipmentState.section, equipmentState.actor.id, ["a", "b"], [
    { name: "a", equipBonus: [Number.MAX_SAFE_INTEGER, 0, 0, 0] },
    { name: "b", equipBonus: [1, 0, 0, 0] },
  ]));
  deepEqual(equipmentState.actor.stats, beforeEquipment);

  const levelState = actor({ stats: { maxHp: Number.MAX_SAFE_INTEGER } });
  const beforeLevel = { ...levelState.actor.stats };
  throws(() => awardExperience(levelState.section, levelState.actor.id, 10));
  deepEqual(levelState.actor.stats, beforeLevel);
});
test("safe multiplication accepts an exact MAX_SAFE product and rejects the next unsafe product", () => {
  const exact = actor({
    stats: { hp: 1, maxHp: 1 },
    progression: { levelHp: Number.MAX_SAFE_INTEGER, experienceIncrease: 100, levelUpType: 0 },
  });
  const exactResult = awardExperience(exact.section, exact.actor.id, 10);
  ok(exactResult);
  equal(exactResult.actor.stats.maxHp, 90071992547410);

  const unsafe = actor({
    stats: { hp: 2, maxHp: 2 },
    progression: { levelHp: Number.MAX_SAFE_INTEGER, experienceIncrease: 100, levelUpType: 0 },
  });
  unsafe.actor.equipment.bonuses.hp = -1;
  const before = { ...unsafe.actor.stats };
  throws(() => awardExperience(unsafe.section, unsafe.actor.id, 10));
  deepEqual(unsafe.actor.stats, before);
});

test("status names including __proto__ survive countdown ownership", () => {
  const statuses: Record<string, number> = {};
  Object.defineProperty(statuses, "__proto__", { value: 2, enumerable: true, writable: true, configurable: true });
  const state = actor({ statuses });
  const result = advanceStatus(state.section, state.actor.id, 1);
  ok(result);
  equal(Object.prototype.hasOwnProperty.call(result.actor.statuses, "__proto__"), true);
  equal(result.actor.statuses["__proto__"], 1);
});


test("max level retains XP and legacy program precedence suppresses core growth", () => {
  const state = actor({ progression: { maxLevel: 2, legacyLevelUp: true } });
  let called = false;
  const hooks: ActorHooks = { levelUp: () => { called = true; return { deltas: { maxHp: 999 } }; } };
  const result = awardExperience(state.section, state.actor.id, 100, hooks);
  ok(result);
  equal(result.actor.stats.experience, 100);
  equal(result.actor.stats.level, 2);
  equal(result.actor.stats.maxHp, 10);
  equal(called, false);
  deepEqual(result.transitions, []);
  deepEqual(result.legacyLevelUps?.map((handoff) => handoff.level), [2]);
  equal(result.legacyLevelUps?.[0]?.proposal.deltas.maxHp, 10);
  const maxed = awardExperience(state.section, state.actor.id, 1);
  ok(maxed);
  equal(maxed.actor.stats.experience, 101);
  equal(maxed.legacyLevelUps, undefined);
  throws(() => awardExperience(state.section, state.actor.id, -1));
});
test("unresolved legacy precedence blocks XP instead of choosing core growth", () => {
  const state = actor({ progression: { legacyLevelUp: null } });
  throws(() => awardExperience(state.section, state.actor.id, 1));
  equal(state.actor.stats.experience, 0);
});


test("progression rejects invalid configured growth at actor creation", () => {
  throws(() => actor({ progression: { levelHp: -1 } }));
  throws(() => actor({ progression: { levelHp: 1.5 } }));
  throws(() => actor({ progression: { levelUpType: 2 } }));
});

test("the five hooks are direct synchronous plain-data seams", () => {
  const state = actor();
  const calls: string[] = [];
  const hooks: ActorHooks = {
    statsChanged: (_actor, context) => { calls.push(context.operation); return {}; },
    revive: () => { calls.push("revive"); return {}; },
    statusChanged: () => { calls.push("statusChanged"); return {}; },
    equipmentChanged: () => { calls.push("equipmentChanged"); return {}; },
    levelUp: () => { calls.push("levelUp"); return {}; },
  };
  state.actor.statuses = { poison: 1 };
  updateActorStats(state.section, state.actor.id, { hp: 0 }, { cause: "script", hooks });
  advanceStatus(state.section, state.actor.id, 1, { hooks });
  applyEquipment(state.section, state.actor.id, [], [], hooks);
  updateActorStats(state.section, state.actor.id, { hp: 1 }, { cause: "script", hooks });
  awardExperience(state.section, state.actor.id, 10, hooks);
  ok(calls.includes("revive"));
  ok(calls.includes("statusChanged"));
  ok(calls.includes("equipmentChanged"));
  ok(calls.includes("levelUp"));
  ok(calls.includes("stats"));
});

test("actor status owner restarts counters, removes identities, and emits ordinary transitions", () => {
  const state = actor({ statuses: { Poison: 2 } });
  const published: unknown[] = [];
  const hookCalls: StatusChangedContext[] = [];
  const service = createActorService(
    state.section,
    () => ({
      statusChanged: (_record, context) => { hookCalls.push(context); return {}; },
    }),
    (result) => published.push(...result.transitions),
  );

  const restarted = service.applyStatus(state.actor.id, "poison", 5, { source: 22 });
  ok(restarted);
  deepEqual(state.section.actors[0]?.statuses, { Poison: 5 });
  deepEqual(restarted.transitions, [{
    type: "statusChanged", actorId: state.actor.id, status: "Poison",
    previousRounds: 2, rounds: 5, expired: false, source: 22,
  }]);
  equal(hookCalls[0]?.rounds, 5);

  const removed = service.removeStatus(state.actor.id, "POISON", { source: 22 });
  ok(removed);
  deepEqual(state.section.actors[0]?.statuses, {});
  deepEqual(removed.transitions, [{
    type: "statusChanged", actorId: state.actor.id, status: "Poison",
    previousRounds: 5, rounds: 0, expired: true, source: 22,
  }]);
  equal(service.removeStatus(state.actor.id, "poison")?.transitions.length, 0);
  equal(published.length, 2);
  deepEqual(published, [...restarted.transitions, ...removed.transitions]);

  const zeroRounds = applyActorStatus(state.section, state.actor.id, "slow", 0);
  ok(zeroRounds);
  deepEqual(state.section.actors[0]?.statuses, { slow: 0 });
  const zeroTransition = zeroRounds.transitions[0];
  if (zeroTransition?.type !== "statusChanged") throw new Error("applying a status must emit a statusChanged transition");
  equal(zeroTransition.expired, false);
  const beforeInvalid = JSON.stringify(state.section.actors[0]?.statuses);
  throws(() => service.applyStatus(state.actor.id, "slow", -1));
  equal(JSON.stringify(state.section.actors[0]?.statuses), beforeInvalid);
  const directRemoval = removeActorStatus(state.section, state.actor.id, "SLOW");
  ok(directRemoval);
  deepEqual(state.section.actors[0]?.statuses, {});
});

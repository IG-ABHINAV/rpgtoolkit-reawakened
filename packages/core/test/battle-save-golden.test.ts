// Epic 7.2 save golden (#692, BAT-2/BAT-13): the same deterministic game saved
// out of battle and mid-battle differs only under the root `battle` section, plus
// (since #744) the `engine` section's run-scoped `nextBattleId` counter the mid-battle
// start advances. The mid-battle section is produced by the real battle owner (`start`,
// `setCharge`, `addCharge`) over pre-created actors: it isolates the saved section, not a full engine start.
// Fixtures: fixtures/save/battle-v2-{out,mid}.json. Regenerate deliberately by
// writing `build()` output to the files; the schema-v1 migration fixture `battle-v1.json` is untouched,
// and the party-schema-2 migration fixture is `party-v2.json`.
// #1231 regenerated both fixtures once: the party section moved to schema 3 (it gained the saved
// `stepRemainder`), so `schema.party` is 3 and `party.stepRemainder` is 0; no other key changed.
// #744 regenerated `battle-v2-mid.json` once, for the added `engine.nextBattleId: 2`; no section
// schema version moved and no other key changed.
// #585 regenerated both fixtures once: the input section moved to schema 3 (the pointer record gained downs, ups, downX,
// downY and button), so `schema.input` is 3 and `input.version`/`input.pointer` changed; no other key moved.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { addActor, createBattleOwner, createGameState, restoreGameState, SCHEMA_VERSIONS, snapshot, type BattleState } from "../src/index.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "save");

function build(inBattle: boolean): string {
  const state = createGameState({ seed: 27 });
  const enemy = addActor(state.actors, { kind: "enemy", source: "enemy", name: "enemy", stats: { hp: 7, maxHp: 9 } });
  const player = addActor(state.actors, { kind: "party", source: "player", name: "player", statuses: { "poison.ste": 2 }, stats: { hp: 10, maxHp: 10, smp: 3, maxSmp: 3 } });
  if (inBattle) {
    // The real battle owner (section start + charge actions) over pre-created actors;
    // this isolates the saved `battle` section and is not a full engine battle start.
    const owner = createBattleOwner({
      readBattle: () => state.battle,
      readActors: () => state.actors,
      commit: (section) => { state.battle = section; },
      readBattleCounter: () => state.engine.nextBattleId,
      commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
    });
    const started = owner.start({ boardKey: "boards/castle.brd", background: "night.bkg", canRun: false, enemies: [enemy.id], players: [player.id] });
    ok(started.ok);
    ok(owner.apply({ type: "setCharge", party: 0, index: 0, charge: 123.5 }).ok);
    ok(owner.apply({ type: "addCharge", party: 1, index: 0, amount: 70 }).ok);
    ok(owner.apply({ type: "addCharge", party: 1, index: 0, amount: 4 }).ok);
  }
  return snapshot(state);
}

function golden(name: string, actual: string): string {
  const path = join(dir, name);
  equal(actual, readFileSync(path, "utf8"), `${name} drifted; regenerate it deliberately`);
  return actual;
}

function nextBattleIdOf(root: Record<string, unknown>): unknown {
  const engine = root.engine;
  return typeof engine === "object" && engine !== null && "nextBattleId" in engine ? engine.nextBattleId : undefined;
}

test("save golden: out-of-battle and mid-battle saves differ only under `battle` and the engine run counter", () => {
  const out = golden("battle-v2-out.json", build(false));
  const mid = golden("battle-v2-mid.json", build(true));
  equal(build(false), out);
  equal(build(true), mid);

  const outRoot = JSON.parse(out) as Record<string, unknown>;
  const midRoot = JSON.parse(mid) as Record<string, unknown>;
  deepEqual(Object.keys(midRoot), Object.keys(outRoot));
  const changed = Object.keys(midRoot).filter((key) => JSON.stringify(midRoot[key]) !== JSON.stringify(outRoot[key]));
  // #744: a start advances the run's battle counter in `engine`, so a mid-battle save now differs
  // there too (`nextBattleId`); the section schema version does not move.
  deepEqual(changed, ["battle", "engine"]);
  equal(nextBattleIdOf(outRoot), undefined);
  equal(nextBattleIdOf(midRoot), 2);
  equal(outRoot.battle, null);
  equal((midRoot.schema as { battle: number }).battle, SCHEMA_VERSIONS.battle);

  const battle = midRoot.battle as BattleState;
  deepEqual(battle, {
    id: 1, boardKey: "boards/castle.brd", background: "night.bkg", canRun: false, outcome: null,
    parties: [[{ party: 0, actorId: 1, charge: 123.5 }], [{ party: 1, actorId: 2, charge: 74 }]],
  });
  const text = JSON.stringify(battle);
  ok(!/"(hp|smp|maxHp|maxSmp|stats|statuses|status|audio)"/.test(text));
  // Actor state lives only in the `actors` section, identical in both saves.
  deepEqual(midRoot.actors, outRoot.actors);
  equal(restoreGameState(mid).battle?.parties[1][0]?.charge, 74);
});

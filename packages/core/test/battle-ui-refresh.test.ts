// BAT-11: changes to visible fighter data must reach the rendered screen without keyboard input.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { actor, awaitMenu, bootUiRig, regionHash, ui, type UiRig } from "./battle-ui-rig.ts";

type Box = { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
type Context = "idle" | "command" | "list" | "target";
type Change = { readonly name: string; readonly box: Box; readonly mutate: (rig: UiRig) => () => void };

const nameBox = { x1: 172, y1: 356, x2: 275, y2: 371 };
const hpBox = { x1: 276, y1: 356, x2: 387, y2: 369 };
const smpBox = { x1: 396, y1: 356, x2: 491, y2: 369 };
const chargeBox = { x1: 500, y1: 404, x2: 611, y2: 417 };
const enemyName = { x1: 40, y1: 107, x2: 103, y2: 114 };
const enemyHp = { x1: 40, y1: 118, x2: 103, y2: 123 };

const changes: readonly Change[] = [
  { name: "party name", box: nameBox, mutate: (rig) => {
    const hero = actor(rig, "hero.tem"); const before = hero.name; hero.name = "Zelda"; return () => { hero.name = before; };
  } },
  { name: "party HP", box: hpBox, mutate: (rig) => {
    const stats = actor(rig, "hero.tem").stats; const before = stats.hp; stats.hp = 13; return () => { stats.hp = before; };
  } },
  { name: "party maximum HP", box: hpBox, mutate: (rig) => {
    const stats = actor(rig, "hero.tem").stats; const before = stats.maxHp; stats.maxHp = 80; return () => { stats.maxHp = before; };
  } },
  { name: "party SMP", box: smpBox, mutate: (rig) => {
    const stats = actor(rig, "hero.tem").stats; const before = stats.smp; stats.smp = 2; return () => { stats.smp = before; };
  } },
  { name: "party maximum SMP", box: smpBox, mutate: (rig) => {
    const stats = actor(rig, "hero.tem").stats; const before = stats.maxSmp; stats.maxSmp = 40; return () => { stats.maxSmp = before; };
  } },
  { name: "enemy name", box: enemyName, mutate: (rig) => {
    const enemy = actor(rig, "slime.ene"); const before = enemy.name; enemy.name = "Dragon"; return () => { enemy.name = before; };
  } },
  { name: "enemy HP", box: enemyHp, mutate: (rig) => {
    const stats = actor(rig, "slime.ene").stats; const before = stats.hp; stats.hp = 10; return () => { stats.hp = before; };
  } },
  { name: "enemy maximum HP", box: enemyHp, mutate: (rig) => {
    const stats = actor(rig, "slime.ene").stats; const before = stats.maxHp; stats.maxHp = 60; return () => { stats.maxHp = before; };
  } },
  // The fallen Rogue does not accumulate charge in idle, so only this mutation can change its bar.
  { name: "party charge", box: chargeBox, mutate: (rig) => {
    const fighter = rig.state().battle!.parties[1][2]!; const before = fighter.charge; fighter.charge = 60; return () => { fighter.charge = before; };
  } },
  { name: "fallen status", box: nameBox, mutate: (rig) => {
    const stats = actor(rig, "hero.tem").stats; const before = stats.hp; stats.hp = 0; return () => { stats.hp = before; };
  } },
];

function ready(context: Context): UiRig {
  const rig = bootUiRig();
  if (context === "idle") {
    // Stop before the first ready turn, and keep charges away from the turn threshold.
    rig.until(() => rig.ui()?.["on"] === 1 && rig.ui()?.["staticsig"] !== "", 1000);
    for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
    rig.tick(4);
    equal(ui(rig)["mode"], "idle");
  } else {
    awaitMenu(rig);
    if (context === "list") {
      rig.press("DOWN", 12);
      rig.press("ENTER", 12);
    } else if (context === "target") {
      rig.press("ENTER", 12);
    }
    equal(ui(rig)["mode"], context);
    rig.tick(8);
  }
  return rig;
}

for (const context of ["idle", "command", "list", "target"] as const) {
  // Reuse real-engine setup, restoring each field and its affected pixels between cases.
  // Fallen is last because its animation history is not restored by restoring HP.
  // The parent deliberately exceeds one second: it includes real battle setup and all
  // cross-layer cases. To select a mode, run:
  // node --test --test-name-pattern='^target: fighter data updates its pixels' packages/core/test/battle-ui-refresh.test.ts
  // This selects the parent and all its cases; old per-case top-level filters no longer apply.
  test(`${context}: fighter data updates its pixels without input within six ticks`, async (t) => {
    let shared: UiRig | null = ready(context);
    for (const change of changes) {
      // The full-screen list obscures battlefield labels and bars.
      if (context === "list" && change.name.startsWith("enemy ")) continue;
      // A failed case may leave arbitrary engine state behind. Reboot before continuing.
      if (shared === null) shared = ready(context);
      const rig = shared;
      let failed = false;
      await t.test(change.name, () => {
        try {
          if (context === "idle") {
            // Prevent turns while the shared idle rig advances through the cases.
            for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
            rig.tick(6);
          }
          equal(ui(rig)["mode"], context);
          const before = regionHash(rig, change.box);
          const restore = change.mutate(rig);
          rig.tick(6);
          equal(ui(rig)["mode"], context, "no key or action changed the UI mode");
          ok(regionHash(rig, change.box) !== before, `${change.name} remained stale`);
          deepEqual(rig.diagnostics, []);
          restore();
          rig.tick(6);
          equal(ui(rig)["mode"], context);
          equal(regionHash(rig, change.box), before, `${change.name} was not restored`);
          deepEqual(rig.diagnostics, []);
        } catch (error) {
          failed = true;
          throw error;
        }
      });
      if (failed) shared = null;
    }
  });
}

test("charge refresh covers every bar scan phase and repeated charge changes", () => {
  const rig = ready("command");
  const fighter = rig.state().battle!.parties[1][2]!;
  for (const [phase, charge] of [[0, 60], [1, 0], [2, 30]] as const) {
    rig.until(() => ui(rig)["barscan"] === phase, 120);
    const before = regionHash(rig, chargeBox);
    fighter.charge = charge;
    rig.tick(6);
    equal(ui(rig)["mode"], "command");
    ok(regionHash(rig, chargeBox) !== before, `charge at bar scan phase ${phase} remained stale`);
    deepEqual(rig.diagnostics, []);
  }
});
test("a fighter-stat fast-path redraw synchronizes an unrelated party charge bar", () => {
  const rig = bootUiRig({
    watchFastPathCompletion: true,
    party: [
      { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 },
      { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  awaitMenu(rig);
  rig.tick(8);
  rig.until(() => ui(rig)["barscan"] === 1 && ui(rig)["controlsig"] === ui(rig)["nextcontrolsig"], 120);
  equal(ui(rig)["on"], 1);
  const state = rig.state();
  const changedStatActorId = state.battle!.parties[1][0]!.actorId;
  const fighterId = state.battle!.parties[1][4]!.actorId;
  const oldSceneSignature = ui(rig)["staticsig"];
  const layout = ui(rig)["layout"] as Record<string, number>;
  const chargeRegion = {
    x1: layout["chargex"]! + 1,
    y1: layout["rowy"]! + 4 * layout["rowdy"]! + 1,
    x2: layout["chargex"]! + layout["chargew"]! - 1,
    y2: layout["rowy"]! + 4 * layout["rowdy"]! + layout["barh"]! - 2,
  };
  const before = regionHash(rig, chargeRegion);
  const previousFill = (ui(rig)["bars"] as Record<string, number>)["4"];
  rig.mutateNextTick((live) => {
    const fighter = live.battle!.parties[1][4]!;
    equal(fighter.actorId, fighterId);
    fighter.charge = 60;
    const partyActor = live.actors.actors.find((entry) => entry.id === changedStatActorId);
    ok(partyActor !== undefined);
    partyActor.stats.hp -= 1;
    const uiValue = live.vm.globals.stockbattleui as { handle: number };
    const uiRecord = live.vm.objects.find((object) => object.handle === uiValue.handle);
    ok(uiRecord !== undefined);
    uiRecord.members.testfastpathwatch = 1;
    uiRecord.members.barscan = 3;
  });
  const expected = Math.floor(60 * 100 / 75);
  let fastPathCompleted = false;
  for (let tick = 1; tick <= 16; tick += 1) {
    rig.tick(1);
    const currentUi = ui(rig);
    if (currentUi["testfastpathcompleted"] === 1) {
      fastPathCompleted = true;
      equal(currentUi["barscan"], 3, "fast-path returns with the test-held scanner before party slot 4");
      equal(currentUi["staticsig"] === oldSceneSignature, false, "changed fighter stats reached the fast-path redraw");
      break;
    }
    equal(currentUi["barscan"], 3, "the test-owned pass hook keeps ordinary scanning before party slot 4");
  }
  ok(fastPathCompleted, "the instrumented fast-path return is observed by single-tick stepping");
  equal((ui(rig)["bars"] as Record<string, number>)["4"], expected);
  ok(expected !== previousFill, "the fighter charge changed during the fast-path redraw");
  ok(regionHash(rig, chargeRegion) !== before, "the unrelated party bar reaches pixels before ordinary scanning can mask it");
  deepEqual(rig.diagnostics, []);
});

test("target picker and message update a renamed target without cursor movement", () => {
  const rig = ready("target");
  const picker = { x1: 8, y1: 255, x2: 151, y2: 323 };
  const message = { x1: 0, y1: 324, x2: 639, y2: 343 };
  const oldPicker = regionHash(rig, picker);
  const oldMessage = regionHash(rig, message);
  const cursor = ui(rig)["targetcursor"];
  actor(rig, "slime.ene").name = "Dragon";
  rig.tick(6);
  equal(ui(rig)["targetcursor"], cursor);
  ok(regionHash(rig, picker) !== oldPicker);
  ok(regionHash(rig, message) !== oldMessage);
  ok(ui(rig)["mode"] === "target");
  deepEqual(rig.diagnostics, []);
});

test("a nine-fighter idle battle refreshes simultaneous changes at both ends of the roster", () => {
  const rig = bootUiRig({
    enemies: ["slime", "bat", "slime", "bat"],
    party: [
      { key: "hero", hp: 42, smp: 12 }, { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 }, { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  rig.until(() => rig.ui()?.["on"] === 1 && rig.ui()?.["staticsig"] !== "", 1000);
  for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
  rig.tick(12);
  equal(ui(rig)["mode"], "idle");
  const lastRow = { x1: 172, y1: 452, x2: 275, y2: 467 };
  const firstEnemy = regionHash(rig, enemyName);
  const lastPlayer = regionHash(rig, lastRow);
  const battle = rig.state().battle!;
  const first = rig.state().actors.actors.find((entry) => entry.id === battle.parties[0][0]!.actorId)!;
  const last = rig.state().actors.actors.find((entry) => entry.id === battle.parties[1][4]!.actorId)!;
  first.name = "Dragon";
  last.name = "Wizard";
  rig.tick(6);
  equal(ui(rig)["mode"], "idle");
  ok(regionHash(rig, enemyName) !== firstEnemy, "first enemy name");
  ok(regionHash(rig, lastRow) !== lastPlayer, "last player name");
  deepEqual(rig.diagnostics, []);
});

test("nine on-screen fighters charge once per tick during unchanged idle passes", () => {
  const rig = bootUiRig({
    enemies: ["slime", "bat", "slime", "bat"],
    party: [
      { key: "hero", hp: 42, smp: 12 }, { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 }, { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  rig.until(() => rig.ui()?.["on"] === 1 && rig.ui()?.["staticsig"] !== "", 1000);
  for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
  rig.tick(12);
  equal(ui(rig)["mode"], "idle");
  for (let tick = 0; tick < 8; tick += 1) {
    const before = rig.charges();
    rig.tick(1);
    deepEqual(rig.charges(), before.map((party) => party.map((charge) => charge + 3)), `idle tick ${tick + 1}`);
  }
  deepEqual(rig.diagnostics, []);
});

test("a nine-fighter command screen refreshes the last party member without input", () => {
  const rig = bootUiRig({
    enemies: ["slime", "bat", "slime", "bat"],
    party: [
      { key: "hero", hp: 42, smp: 12 }, { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 }, { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  awaitMenu(rig);
  const lastRow = { x1: 172, y1: 452, x2: 275, y2: 467 };
  const before = regionHash(rig, lastRow);
  const id = rig.state().battle!.parties[1][4]!.actorId;
  rig.state().actors.actors.find((entry) => entry.id === id)!.name = "Wizard";
  rig.tick(6);
  equal(ui(rig)["mode"], "command");
  ok(regionHash(rig, lastRow) !== before);
  deepEqual(rig.diagnostics, []);
});

test("renaming a duplicate target removes the other target's obsolete suffix glyphs", () => {
  const changed = ready("target");
  const reference = bootUiRig();
  awaitMenu(reference);
  actor(reference, "slime.ene").name = "Dragon";
  reference.press("ENTER", 20);
  reference.tick(16);
  equal(ui(reference)["mode"], "target");
  const otherSlimeName = { x1: 40, y1: 219, x2: 103, y2: 226 };
  const picker = { x1: 8, y1: 255, x2: 151, y2: 323 };
  actor(changed, "slime.ene").name = "Dragon";
  changed.tick(6);
  equal(regionHash(changed, otherSlimeName), regionHash(reference, otherSlimeName), "other duplicate's label matches a freshly composed target screen");
  equal(regionHash(changed, picker), regionHash(reference, picker), "picker labels match a freshly composed target screen");
  deepEqual(changed.diagnostics, []);
  deepEqual(reference.diagnostics, []);
});

test("renaming a target while its cursor moves refreshes every duplicate label and the message", () => {
  const changed = ready("target");
  const reference = bootUiRig();
  awaitMenu(reference);
  actor(reference, "bat.ene").name = "Slime";
  reference.press("ENTER", 20);
  reference.press("RIGHT", 20);
  reference.tick(8);
  actor(changed, "bat.ene").name = "Slime";
  changed.press("RIGHT", 1);
  changed.tick(20);
  equal(ui(changed)["targetcursor"], 1, "the renamed fighter is selected");
  const picker = { x1: 8, y1: 255, x2: 151, y2: 323 };
  const message = { x1: 0, y1: 324, x2: 639, y2: 343 };
  equal(regionHash(changed, picker), regionHash(reference, picker), "all three Slime suffixes match a fresh target screen");
  equal(regionHash(changed, message), regionHash(reference, message), "the selected target message uses the new duplicate-aware name");
  deepEqual(changed.diagnostics, []);
  deepEqual(reference.diagnostics, []);
});

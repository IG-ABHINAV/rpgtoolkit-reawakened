import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { actor, awaitMenu, bootUiRig, ui, type UiRig } from "./battle-ui-rig.ts";

// Full-engine duration is intentional: only booting the real engine with stock_battle, driving its
// menu through battleconsume, and letting its inventory owner finish the action proves this
// cross-layer contract. Calling the owner/helper directly would miss duplicate or lost package wiring.
function chooseItemAndTargetMage(rig: UiRig): void {
  rig.press("DOWN", 12);
  rig.press("DOWN", 12);
  rig.press("ENTER", 12);
  equal(ui(rig)["listkind"], "item");
  rig.press("ENTER", 12);
  equal(ui(rig)["mode"], "target");
  rig.press("RIGHT", 12);
}

for (const item of [
  { handle: "Potion", source: "item/potion.itm", hp: 20, smp: 0 },
  { handle: "Ether", source: "item/ether.itm", hp: 0, smp: 8 },
] as const) {
  test(`stock_battle consumes ${item.handle} once and applies its HP/SMP effect once`, () => {
    const rig = bootUiRig({
      party: [
        { key: "hero", hp: 42, smp: 12 },
        { key: "mage", hp: 10, smp: 3 },
        { key: "rogue", hp: 0, smp: 6 },
      ],
      inventory: [{ source: item.source, handle: item.handle, quantity: 2 }],
    });
    awaitMenu(rig);
    const hpBefore = actor(rig, "mage.tem").stats.hp;
    const smpBefore = actor(rig, "mage.tem").stats.smp;

    chooseItemAndTargetMage(rig);
    rig.press("ENTER", 12);
    rig.tick(100);

    const mageAfter = actor(rig, "mage.tem").stats;
    equal(mageAfter.hp, hpBefore + item.hp, `${item.handle} applies its HP effect exactly once`);
    equal(mageAfter.smp, smpBefore + item.smp, `${item.handle} applies its SMP effect exactly once`);
    equal(
      rig.state().inventory.items.find((entry) => entry.handle === item.handle)?.quantity,
      1,
      `${item.handle} inventory quantity decrements exactly once`,
    );

    deepEqual(rig.diagnostics, []);
  });
}

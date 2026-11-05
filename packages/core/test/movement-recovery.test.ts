import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { applyRecoveryLedger } from "../src/engine/recovery.ts";
import { createGameState, projectGameLedger } from "../src/index.ts";

test("recovery fills each absent movement setting from the main-file defaults, not startup mutations", () => {
  const base = projectGameLedger(createGameState({ seed: 1 }));
  const defaults = { walking: 0, pushing: 1 };

  const missingWalking = createGameState({ seed: 2 });
  missingWalking.world.movement = { walking: 1, pushing: 1 };
  applyRecoveryLedger(missingWalking, {
    ...base,
    world: { ...base.world, movement: { walking: null, pushing: 0 } },
  }, defaults);
  deepEqual(missingWalking.world.movement, { walking: 0, pushing: 0 });

  const missingPushing = createGameState({ seed: 3 });
  missingPushing.world.movement = { walking: 0, pushing: 0 };
  applyRecoveryLedger(missingPushing, {
    ...base,
    world: { ...base.world, movement: { walking: 1, pushing: null } },
  }, defaults);
  deepEqual(missingPushing.world.movement, { walking: 1, pushing: 1 });
});

---
title: "Epic 8 end-to-end acceptance"
type: 'feature'
ticket: 14
created: '2026-10-22'
risk: "high"
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-80 to E-87, E-123"
  - "spec - docs/spec/formats/save-game.md"
  - "initiative - CAP-5, CAP-9, CAP-10, CAP-11"
status: done
baseline_revision: eacdf6a9d04678caf389e228a4973def315cb827
---

## Intent

Run a complete player-authored game scenario through menu, party, inventory, dialogue, battle and save/load with the real integrated owners.

## Boundaries

Acceptance and end-to-end fixtures only; no new runtime behavior. The preceding stories own unit and component tests.

## Acceptance

A headless play-through covers every E-80–87 and E-123 behavior, all CAP-10 flows, a mid-script save/load with equal canonical hashes and later behavior under the entry 1 ruling, completed and interrupted dialogue with actor-isolated `talked`, and Epic 7's real battle item consumption through Epic 8's inventory operation.

## Verification

Execute the fixture under the project's deterministic runner and compare committed golden state/draw/event output; run the specific battle, dialogue and restore scenarios against their integrated package/startup paths, not test doubles.

## Implementation map

Run only after the refactor sweep. Link each assertion to an E-xx or CAP id and preserve existing unrelated golden baselines.

## Acceptance evidence

- `packages/core/test/epic-8-acceptance.test.ts`: stock menu item/equipment/ability flows,
  key-item refusal, graphic, cursor sounds, gold, exact game-time display after 120 ticks, and the
  E-123 board gate. Sword and accessory bonuses, occupied-slot replacement and removal are checked;
  `golden/epic8/acceptance.json` pins state, draw and delivered inventory-event checkpoints.
- `packages/core/test/epic-8-shop-party.test.ts`: a player-operated shop. A board script calls
  `CallShop`; scripted keys open the stock menu's shop screen, buy a unit, meet both refusals
  (`Not enough gold`, `Not enough to sell`), sell it back, and close, after which the caller resumes.
  A pointer press/release and a pad press exercise the same rows ([menu-navigation]). No phase hook:
  every transaction comes from input. A game-shipped RPGCode provider reads `context.party.steps`
  after a held-arrow walk, and the count with its sub-tile remainder survives a canonical
  save/restore. A third case opens the main screen with the engine menu key, closes it and walks one tile,
  proving a menu frame no longer freezes the party section. Inn restoration is covered here too.
- `packages/core/test/epic-8-restore-acceptance.test.ts`: host save bytes, canonical round trip,
  post-load gameplay sections compared with an uninterrupted run, deterministic replay, newer-IR
  refusal and older-thread restart.
- `packages/core/test/epic-8-restore-dialogue.test.ts`: spliced displayed and completion-event text,
  real package bridge, actor-specific completion and killed-dialogue suppression.
- `packages/core/test/epic-8-battle-consume.test.ts`: real stock battle item use, exact
  inventory consumption and one-time HP/SMP application.

Perturbations exercised: removing the battle inventory dispatch left both stacks at 2 rather than 1;
disabling the stock dialogue bridge removed the expected actor event; bypassing the save gate
opened the picker; bypassing key-item protection removed the key; suppressing sale proceeds left
80 rather than 85 gold; disabling Inn left HP at 0; skipping older-IR restart gave counter 3 rather
than 4; disabling newer-IR refusal lost the expected diagnostic; skipping loaded-state adoption
left counter 9 rather than 3. Each mutated production file was restored after its run.
Additional review perturbations: suppressing weapon FP or accessory DP bonuses failed the respective
stat assertions; fixing `gametime` at zero failed the exact time assertion; suppressing item-use event
emission failed the event assertion; corrupting completion text failed the dialogue event comparison;
and adding a gold unit on Load failed the uninterrupted inventory comparison. Each mutation was restored.

## Status

Every E-80–E-87 behavior this ticket claims is proven by a committed test, and nothing is blocked:

- **Shop (E-83, #1234).** The stock menu presents the `CallShop` session as a real screen, driven
  only by scripted input (keys, pointer, pad) in `epic-8-shop-party.test.ts`; buying and selling go
  through `inventory.buyItem`/`inventory.sellItem`, refusals change nothing, and closing clears the
  stock so the parked command resumes.
- **Steps (E-87, #1231).** The completed-movement counter is proven in
  `movement-party-steps.test.ts` and read back through the script-visible party view in the same
  Epic 8 scenario; a menu frame no longer breaks it (the menu owner publishes a frozen copy, and the
  movement accumulator writes copy-on-write).
- **Save/load continuation.** `epic-8-restore-acceptance.test.ts` compares the complete replay-hash
  projection at settled checkpoints and proves the single permitted load cue; the saved party
  section, including the step count and remainder, is compared exactly.

The earlier probe result (a walk that left `party.steps` at 0) was the #1231 defect; fixing the
counter and this ticket's rig wiring closes it. The broader "not every behavior" caveat in the
closure audit is withdrawn only for the items listed above; unit and integration suites remain the
normative evidence for their own layers.

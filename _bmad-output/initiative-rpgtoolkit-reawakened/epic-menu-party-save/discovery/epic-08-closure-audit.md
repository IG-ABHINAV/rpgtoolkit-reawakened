---
type: discovery
title: "Closure audit: epic 8 (menu, party, save), criterion by criterion"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Epic 8 closure audit

Audited at **`26740257`**. 19 of 25 children are CLOSED; six are open and own specific criteria, which are marked in
flight rather than unproven. No criterion is contradicted by merged evidence.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Scripted play exercises item use, equip, remove, drop, buy, sell, party swap, inn restoration and a battle item use | **In flight (8.5 / #589)** | The shared inventory operation and its `stock_rpg` callers exist; the criterion is the ticket's own acceptance and 8.5 is **owner-gated by earlier instruction**, so its completion is not mine to claim. `actors.test.ts`/`battle-actions.test.ts` cover the battle item-use and stat limbs |
| 2 | The main, equipment, abilities and inventory screens open directly, are replaceable by RPGCode and preserve menu/input behaviour | **In flight (8.8 / #585)** | `stock/stock_menu` exists and the menu-provider seam is landed (`script-register-plugin.test.ts`, the `menuProviders` facet); the screen-by-screen acceptance belongs to 8.8 |
| 3 | Save then load mid-script restores every ruled section with identical hashes and later behaviour | **Proven for the engine's own path** | `battle-save-golden.test.ts`, the “full-engine save during battle resumes its parked thread” case, and `save-*.test.ts` suites; `pnpm golden`/`pnpm closing` unchanged. The *blob* (host) round trip is criterion 4 |
| 4 | Saving is refused on boards that forbid it; saves use `saveBlob`/`loadBlob`/`listBlobs` keyed by `GameId`; thread continuation follows the approved rule | **Proven** | `packages/core/test/save-*.test.ts` (board save-forbidden, `GameId` keying) and the blob request path in `engine.ts` (`saveBlob`/`loadBlob`), exercised by the `Save("slot")` cases in `battle-cues-engine.test.ts` and `battle-fresh-load.test.ts` |
| 5 | The interaction wrapper queues `dialogue.completed` only after normal completion; the `stock_rpg` bridge emits one actor-scoped `talked` with approved detail and nothing on interruption or failure | **Proven** | `packages/core/test/engine-edges.test.ts` (“engine beforeEnter rejects a waiting listener with a located diagnostic”) plus the dialogue/talked assertions in the stock-package suites; `stock/stock_rpg` is present |
| 6 | Menu, inventory, party and save built-ins register with the VM; every E-80–E-87 and E-123 behaviour has headless coverage | **In flight (8.8 / #585)** | The built-ins are in the catalogue (`catalogue:check`, `command-docs:check` green) and the inventory/party/save suites cover the engine side; the E-80…E-87 *screen* coverage is 8.8's acceptance |

## Findings

- **F-01 (owner-gated, already ticketed).** Six children remain: 8.5 / #589 (owner decision pending, excluded by
  instruction), 8.8 / #585 (screens), 8.10 / #593 (load validation), 8.13 / #594 (sweep), 8.14 / #595 (end-to-end
  acceptance), 8.17 / #777 (interruption-recovery checkpoints, `hitl`). No new ticket: each already exists and owns a
  criterion. The epic cannot close until they do.
  - Recommendation for the owner-gated 8.17: keep interruption recovery limited to *settled* points (pre-battle and
  post-battle ledger states), which is what the merged recovery work already does, and refuse a mid-battle candidate
  rather than inventing a battle-state serialization.
  - Rejected alternative: capture a mid-battle recovery candidate. It needs the battle section to be fully
  reconstructible from a ledger plus the audio section, which the engine does not promise, and would duplicate the
  ordinary save path's guarantees.
- Store: 19/19 closed children read `done`; the six open ones read their real state. No correction.

## Not probed

The four screen criteria (2 and 6) are the open ticket's acceptance, not an audit gap: the catalogue side is proven and
the screen behaviour is 8.8's deliverable.

## Re-audit at the refactor sweep (8.13 / #594)

At **`dc09ccd1`** plus the sweep's own commits. Every child of the epic is now `done` except 8.14 / #595, so the
"in flight" verdicts of the table above are settled: no criterion is contradicted, and each has merged headless coverage.

| # | Done when | Verdict now | Evidence |
|---|---|---|---|
| 1 | Scripted play exercises item use, equip, remove, drop, buy, sell, party swap, inn restoration and a battle item use through the shared inventory operation | **Proven** | `menu-state.test.ts` — "headless RPGCode Inn restores every active party member", "shop buy and sell actions commit item and gold events atomically", "party semantic actions preserve selection by actor identity and queue exact post-commit events", "headless RPGCode inventory commands request assets and apply item, equipment and gold operations"; `item-action-owner.test.ts` / `item-action-vm.test.ts` (use, equip, remove, refusal, interruption); `stock-menu.test.ts` (Drop, and the key-item drop refusal); `battle-item-stack-identity.test.ts` and `battle-actions.test.ts` (battle consumption through the same owner) |
| 2 | The main, equipment, abilities and inventory screens open directly, are replaceable by RPGCode and preserve menu/input behaviour | **Proven** | `stock-menu.test.ts` — the eight direct-entry cases (`mainmenu`, `itemmenu`, `equipmentmenu`, `abilitiesmenu`, `internalmenu(0/1/2/4)`) pinning each screen's drawn lines, plus pointer, gamepad, paging, frame-cursor and replay cases; `script-register-plugin.test.ts` (provider registration, replacement and rollback); `stock-packages.test.ts` (the four providers and the manifest's requests) |
| 3 | Save then load mid-script restores every ruled section with identical hashes and later behaviour | **Proven** | `battle-save-golden.test.ts`, `save-continuation.test.ts`, `save-load.test.ts`, `save-migration.test.ts`, `save-instruction-version.test.ts`, and the Save/Load picker cases in `stock-menu.test.ts` (real bytes, real restore, no diagnostic); `pnpm golden` and `pnpm closing` unchanged |
| 4 | Saving is refused on boards that forbid it; saves use `saveBlob`/`loadBlob`/`listBlobs` keyed by `GameId`; thread continuation follows the approved rule | **Proven** | `save-identity.test.ts` (GameId keying), `save-operation.test.ts` (board gate and the blob requests), `save-continuation.test.ts` (continuation), `stock-menu.test.ts` (the picker lists `saved/slot1.sav` and one `saveBlob`/`loadBlob` leaves) |
| 5 | The interaction wrapper queues `dialogue.completed` only after normal completion; the `stock_rpg` bridge emits one actor-scoped `talked` with approved detail and nothing on interruption or failure | **Proven** | `engine-edges.test.ts` (before-enter rejection path and the dialogue wait), `stock-rpg-bridge.test.ts` ("stock_rpg forwards completed dialogue to the speaker with exact details", "stock_rpg emits no talked event when dialogue is interrupted or lacks a source") |
| 6 | Menu, inventory, party and save built-ins register with the VM; every E-80–E-87 and E-123 behavior has headless coverage | **Proven** | The registration side is gate-enforced (`catalogue:check`, `command-docs:check`, and the 115 registered names carry no duplicate); the behaviour side is `stock-menu.test.ts` (65 cases, with each guard proved by removing it: the menu program's 17 from #585, plus the accessory flag, the `migrateEngine` call and the fractional-location guard from this sweep) plus `menu-state.test.ts`, `item-action-*.test.ts`, `save-*.test.ts` and the `stock_*` package suites |

Sweep-specific: one rule gained a single owner (the E-82 slot flag indices, F-01 in the plan) and one spec paragraph was
corrected to the shipped contract (F-02); no behaviour, draw list, state hash or baseline moved.

## Epic 8 end-to-end acceptance (8.14 / #595)

The acceptance branch adds a real-engine stock-menu play-through and a new
`golden/epic8/acceptance.json` with state and draw checkpoints. The fixture exercises item use,
equipment, ability information and execution, key-item refusal, custom menu graphics and UI sounds,
with a separate saving-disabled board case. Real-engine companion scenarios exercise the
player-operated shop, Inn, save bytes and instruction-version compatibility, the stock dialogue
bridge, and battle item consumption. These are additional acceptance evidence; the separate unit
and integration suites listed above remain relevant.

Both previously blocked items are closed:

- **Shop screen (#1234).** `epic-8-shop-party.test.ts` drives the stock menu's shop from scripted
  input only: the board script calls `CallShop`, keys open the shop, buy, meet both refusals, sell
  and close, and a pointer press/release plus a pad press reach the same rows. No test phase hook
  dispatches owner actions any more; the session ends and the caller resumes.
- **Player steps (E-87, #1231).** The same scenario walks one 32-pixel tile with a held arrow and
  reads the count back through a game-shipped RPGCode provider's `context.party.steps`; the count
  and its sub-tile remainder survive a canonical save/restore. A third case opens the main screen
  with the engine menu key, closes it and then walks one tile, which proves a menu frame no longer freezes the party
  section (the menu owner now publishes a frozen copy and the movement accumulator writes
  copy-on-write).

`epic-8-restore-acceptance.test.ts` compares the complete ruled replay-hash projection at settled
checkpoints and proves the single permitted load cue, including the saved party section with the
step count and remainder.

What is not claimed: the earlier caveat that a headless probe left `party.steps` at `0` described
the #1231 defect and is withdrawn. The acceptance does not assert active-voice equivalence on Load
(the no-active-audio case is what the ruling scopes), and it does not cover a shop opened by a
custom (non-stock) menu provider.

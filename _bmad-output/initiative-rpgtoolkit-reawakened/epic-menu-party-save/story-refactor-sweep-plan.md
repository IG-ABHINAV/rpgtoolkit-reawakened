---
title: "Refactor sweep"
type: 'chore'
ticket: 13
created: '2026-10-22'
status: in-progress
baseline_revision: 'dc09ccd12fc1452c5a54ed1fc881d2ad0632a3df'
risk: "low"
context:
  - "epic - epic-menu-party-save.md, Done when"
  - "docs/spec/engine/plugins-and-battle.md#e-80-stock-menu"
  - "docs/spec/formats/save-game.md#reawakened-canonical-party-inventory-and-menu-state"
---

## Intent

Reconcile ownership and remove dead paths exposed by all implementation stories before integrated acceptance.

## Boundaries

Cleanup only; every missing behavior is a new ticket, never deferred into this sweep. The end-to-end story remains last.
Nothing here changes game behavior: no draw list, state hash, golden or closing baseline moves.

## Acceptance

One owner/port exists per persisted section and operation; no duplicate party/inventory/menu/save implementation remains;
registrations, references, command docs and the Epic 8 envelope agree with the final contracts.

## Verification

Review references and registrations and run the full Epic 8-focused checks after the sweep; compare all changed APIs and
sections against the normative docs.

## Implementation map

Scope is set from the preceding story plans and accepted review findings; no isolated code lane is introduced.

## How the sweep looked for debt

Not a code-style pass. Each epic seam was checked against its contract with a mechanical test, and only what failed a test
was touched:

1. **Duplicate owners.** Every write of a persisted section (`state.party`, `state.inventory`, `state.menu`) was located
   across `packages/core/src`. Only the owner modules write them, plus the two ruled whole-state replacements
   (`engine.applyLoadedGame`, `engine/recovery.applyRecoveryLedger`).
2. **Duplicated rules.** Each rule the epic introduced was searched for a second encoding (the item/character slot flag
   indices, the save-name prefix rule, the pointer record shape, the menu key entry, the page-size formula).
3. **Producers for every consumer.** Every effect name the engine special-cases was matched against the commands that
   produce it (`bitmap`, `setimage*`, `host:menu:drawgraphic`, `viewbrd`, `createplayer`, `hideitem`, `removeitem`,
   `mainFile`, `battle.*`, `__party_*_asset`) — all have a live producer, so no engine branch is unreachable.
4. **Dead code.** Every local function in the epic's modules was checked for a call site, and every dispatch list
   (`migrate*` in `save/snapshot.ts`, the effect bus, the pack registration) was re-read against its definitions after
   review found that the call-site scan alone misses a function defined but never *wired in* (F-07). Exported helpers
   that nothing outside their own module uses were listed and judged one by one (F-05).
5. **Registrations and docs.** The catalogue, the command docs, the pack registrations and the stock packages' manifests
   were compared with the code, and the epic's spec paragraphs were read against the shipped contracts.

## Findings

| # | Finding | Evidence | Outcome |
|---|---|---|---|
| F-01 | The item-side and character-side slot flag indices were encoded three times: `menu/equipment.ts#validEquipmentSlot`, `packs/menu.ts#slotDictionary` and `packs/menu.ts#CHARACTER_ASSET`, each repeating that the two hands are stored opposite to the canonical tokens and that every named accessory shares index 7 | the three tables side by side, and the comment in `slotDictionary` that asked a reader to keep them in step by hand | **Landed, after review caught a regression in the first cut.** `menu/equipment.ts` owns `slotFlagIndex`, `ACCESSORY_FLAG_INDEX`, `accessoryNameIndex`, `slotTokenAt`, `BODY_SLOT_TOKENS` and `ACCESSORY_LOCATIONS`; all three readers call them. The first cut routed the bare `accessory` token through `slotFlagIndex`, which resolves tokens through `slotLocation` and knows no bare `accessory`, so `menuitemdata(...).slots.accessory` became permanently 0 and the shipped menu could never equip an accessory-7…16 item ("Nothing fits"). Nothing covered `menuitemdata`, so no gate saw it; review's A/B probe did. Fixed by giving the literal an owner (`ACCESSORY_FLAG_INDEX`, used by `slotFlagIndex`'s accessory branch and by `slotDictionary`), and now proved by two stock-menu cases: one equips the accessory into `accessory-7`, one shows an accessory whose name the member does not wear is offered nowhere. `validEquipmentSlot` is untouched. |
| F-07 | `save/snapshot.ts#migrateEngine` was defined but never called from the restore dispatch, so the `engine` section had no newer-version refusal while `docs/spec/formats/save-game.md` promises `restore.shape` "for a newer section" and #814 closed that gap by name | the dispatch list beside `migrateAudio`, and `schema.engine` read nowhere else | **Landed** — wired in after `migrateAudio`; `save-instruction-version.test.ts` now asserts a newer `schema.engine` is refused whole with nothing applied, and that test fails when the call is removed |
| F-08 | `packs/inventory.ts#slotAt` re-encoded the slot location → token table `slotLocation` already owns (`accessory-${7..16}` and the six body tokens) | the switch beside the owner | **Landed** — `menu/equipment.ts` exports `slotTokenAt`, the inverse of `slotLocation`; `slotAt` clamps and calls it |
| F-09 | The host-method maps carried capitalised duplicates (`updatecurrent`/`updateCurrent`, `drawgraphic`/`drawGraphic`, `removeequipment`/`removeEquipment`, `removeitem`/`removeItem`) that can never match: the lexer ASCII-folds every identifier, so `type.methods[foldedName]` only ever sees the lowercase key | `lex.ts` folding into `vm.ts`'s `hostMethodDef`, and `HOST_METHOD_NAMES` folding the same names back | **Landed** — the four unreachable keys removed; every stock-menu case (which calls `drawGraphic` and `updateCurrent` from RPGCode) still passes |
| F-02 | The E-80 provider-context paragraph promised a `portrait` on each `context.party.members` row, claimed an exact match with the native #588 context, and listed four of `menucharacterdata`'s eight fields | `packs/menu.ts#PARTY_HOST_TYPE` (no portrait), `menucharacterdata` (returns the portrait), `script/plugin.ts#MenuProviderContext` (section-owner ports, not dictionaries) | **Landed** — spec corrected to the shipped contract (docs-first commit) |
| F-03 | The stock menu's page indicator is drawn at a fixed `w − 168` while the header is caller-supplied through `dirsav(title, …)`; a title of ~14+ glyphs overlaps it at 320 × 240 | `startup.prg` `pager()`/`header()`, header room 128 px at ~9 px per glyph; today's own headers (`accessory-16`, 12 glyphs) just fit | **Filed #1224** — a presentation fix is a behaviour change, so it is not this sweep's |
| F-04 | `packages/core/src/save/recovery-store.ts` has no host caller yet (tests only) | `promoteRecovery`/`selectRecovery`/`hashGameLedger` are referenced from `save/index.ts` and tests, by no runner | **Left** — it is the reference store `docs/spec/engine/interruption-recovery.md#reference-recovery-store-layout` asks a host to implement, not an adapter with a live replacement; deleting it would delete the contract |
| F-05 | `equippedReference`, `tagLedgerNumber`, `ledgerProgramRef`, `RestoreOptions`, `ItemActionOrigin`, `ItemActionStage` and the `Boot*`/`BoardTransition`/`OpenTickCursor` types are exported but used only inside their own module | exported-symbol scan over `packages/*/src` and `packages/*/test` | **Partly landed.** The first record of this row claimed the barrels re-export those modules wholesale and that un-exporting would change the published surface; that was wrong (review checked: `menu/index.ts` re-exports only `model.ts` and `ports.ts`, `save/index.ts` uses explicit named exports and names none of these). The three functions are now module-internal. The types stay exported on purpose: each one is a field of an exported type in its own module (`BootState`/`BoardTransition`/`OpenTickCursor` in `EngineSection`, `ItemActionOrigin`/`ItemActionStage` in `ItemActionRecord`, `RestoreOptions` on `restoreGameState`), so hiding them would only make those declarations unnameable to a consumer, which is a worse contract, not a cleanup |
| F-06 | `input.registration`'s image-backed button slot is labelled "legacy … retained for the already-shipped UI renderer" | `render/ui.ts#drawButtons` still draws `{ asset, … }` slots | **Left** — live, not an obsolete adapter |

Deferred by name elsewhere, and deliberately untouched here: legacy `.sav` import (8.1 owner ruling: canonical format
only), `callplayerswap`'s inert catalogue answer (8.3 owner ruling), and #1221 (button slots activate on press, an
A11Y-6 defect that needs a behaviour change).

## One owner per persisted section

`save/sections.ts` declares each section once and names its owner; every writer of a section lives in that module.

| Section | Owner module | Version |
|---|---|---|
| `world`, `camera`, `ui`, `fx`, `surfaces`, `input`, `engine` | `save/sections/*.ts` | per `SCHEMA_VERSIONS` |
| `actors` | `actors/model.ts` | 2 |
| `sprites` | `sprites/model.ts` | 2 |
| `triggers` | `triggers/model.ts` | 2 |
| `battle` | `battle/model.ts` | `BATTLE_SCHEMA_VERSION` |
| `party`, `inventory`, `menu` | `menu/model.ts` | 2 |
| `audio` | `audio/model.ts` | 2 |
| `events` | `events/model.ts` | 1 |

## One owner per operation

| Operation | The only implementation |
|---|---|
| item add/remove/consume, equip, unequip, buy, sell, gold | `menu/inventory.ts#applyInventoryAction`, reached through `MenuOwnerPorts.inventory` |
| item use/equip/remove programs (resumable phases) | `script/item-action.ts` phases driven by `vm.ts`; the owner never runs a program |
| roster, select, swap, add, remove, restore, destroy, steps, inn | `menu/ports.ts` `PartyAction` / `applyPartyStateEffect` |
| menu screens, graphic, cursor | `menu/ports.ts` `MenuAction` / `updateCurrent` |
| save, load, list | `script/builtins/files.ts` (`Saved/<name>.sav`) with the engine's `saveBlob`/`loadBlob`/`listBlobs` seam; `packs/menu.ts#savelist` only lists |
| whole-state restore | `save/snapshot.ts#restoreGameState` (live state) and `save/game-save.ts#restoreGameSave` (canonical file); `engine.applyLoadedGame` is the single replace point |
| recovery candidate | `save/ledger.ts#projectGameLedger` + `save/recovery-store.ts`; `engine/recovery.ts#applyRecoveryLedger` is the single apply point |
| dialogue completion and `talked` | `script/packs/ui.ts` wrapper + `stock/stock_rpg`; `stock-rpg-bridge.test.ts` pins one event |

## Registrations and documentation

- `packages/core/test/stock-packages.test.ts` pins the `stock_menu` manifest's disclosed requests
  (`asset`, `listBlobs`, `loadBlob`, `saveBlob`, `quit`) and runs all three stock packages.
- `stock/stock_menu/startup.prg` registers the four screen providers plus the `internalmenu` passthrough and the `dirsav`
  layer, exactly as `plugins-and-battle.md#e-80-stock-menu` item 1 describes.
- No pack registers a name or alias twice (115 registered names checked); the catalogue, stubs and packs agree, which
  `catalogue:check` and `command-docs:check` enforce.
- E-80 item 11 was the only epic spec paragraph that disagreed with the code: it promised a member `portrait` the
  context does not carry, described the native context as dictionaries rather than section-owner ports, and listed four
  of `menucharacterdata`'s eight fields and six of `context.menu`'s eight members. It now lists all of them (F-02),
  including `movesound`/`choosesound`/`cancelsound`, which review noticed were still missing while the plan claimed the
  paragraph matched.

## Epic 8 Done-when evidence at the swept head

The criterion-by-criterion audit is `discovery/epic-08-closure-audit.md`, extended with a re-audit at this sweep. All six
criteria are now backed by merged, passing headless coverage; the sweep moved none of them.

## Gates

The full CONTRIBUTING set at the swept head, recorded in the PR body with counts.

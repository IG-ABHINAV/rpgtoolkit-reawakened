---
title: "Default menu screens and player-facing behaviors"
type: 'feature'
ticket: 8
created: '2026-10-22'
status: done
baseline_revision: '961603b596f938ac2ec73c7333b2607ea1f44411'
risk: "high"
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-80"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-80-stock-menu"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-123"
  - "spec - docs/spec/engine/plugins-and-battle.md#epic-85-item-action-proposal"
  - "spec - docs/spec/engine/accessibility.md#a11y-5"
  - "spec - docs/spec/engine/audio-media.md#r-59-routing"
---

## Intent

Deliver the stock player menu screens and all E-80 behaviour through the controller established in entry 7.

## Boundaries

Main, inventory, equipment and abilities screen draw lists and choices; item/party operations stay in entries 3–6, the controller in entry 7, and Save/Load mechanics in entries 9–10, which this screen integration consumes.

## Acceptance

Scripted inputs cover party portraits/stats, gold/play time, item use/info/drop and key-item refusal, member/slot/item selection and removal, abilities use/info, and Save/Load/Quit routed through their implemented behavior, plus direct screen entry, `MenuGraphic` and cursor sounds.

## Verification

Headless golden and state tests assert exact draw-list order, selected values, command results, save gating and deterministic sound cues for each screen.

## Implementation map

Read and invoke the owner ports; presentation replays draw lists and never holds menu/game state inside a renderer.

## Design recorded before code (G7)

The E-80 screen contract was silent on the stock screens' row order, paging, drawing surface, refusal text and the two context views the screens need. `docs/spec/engine/plugins-and-battle.md#e-80-stock-menu` now states it as a TKR engineering contract inside E-80, and `docs/spec/engine/rpgcode-functions.md` records the `menugraphic`, `dirsav`, `menuitemdata` and `savelist` command behaviour. The doc commit lands before the implementation commit.

- Screens are RPGCode `menuProviders` inside the `stock_menu` package, as E-80's replacement rules and the #588 contract already say; each provider is the screen's own blocking loop (draw, `waitInput()` for one key or pointer change, handle it, redraw; the first draft used `threadsleep(1/60)` and `get()`).
- Presentation draws into the reserved render-now overlay and contributes one blit to the draw list; the game's own overlay pixels are stashed and restored.
- The four read-only views the screens need (`context.party`, `context.menu`, `menuitemdata`, `savelist`) are added to the RPGCode provider surface so both languages have the same capabilities.
- The menu key opens the main screen by starting an ordinary blocking thread running `mainmenu()`, so a menu opened by the key is saved and restored like any other menu.

## Verification plan

- Engine-level fixtures: open each screen directly (facade + `InternalMenu`), drive it with scripted key events, assert overlay revision/draw hash, the selection in `menu.screens`, printed rows and the resulting owner state; assert the 1,000-step budget and replay determinism by running the same input log twice.
- Save gating: a board with `disableSaving` refuses Save and no `saveBlob` request leaves the engine; an allowed board issues one.
- Audible cues: the three main-file cursor sounds become `sfx.play` records with source `ui` on move/confirm/cancel; a missing name is silent.
- Perturbation: each load-bearing assertion is proved by removing its guard (key-item refusal, save gate, save routing, replay equality) and watching the test fail.

## Accessibility and pointer addendum (#585 review, 2026-11-03)

These are TKR engineering decisions taken during review, recorded here and in `docs/spec`; none is an owner ruling.

- **Pointer delivery.** The input section's `pointer` record grows to `{ x, y, buttons, downs, ups, downX, downY, button }` (schema 3, with a v2 migration), because a press and release stamped to one tick during an asset stall would otherwise be lost. A new blocking `waitInput([last])` wakes for a key or a change in that record; native providers get a `{ type: "pointer", … }` event. Every game-state hash changes once; the goldens are re-recorded with the cause named.
- **Page size.** One viewport capacity `P = max(1, floor((h − 90) / 24))` for every list, the Items list included (the fixed eight is retired). A list that fits is drawn whole; a longer one draws the page holding the cursor and shows `Page n of m`.
- **Row height.** Rows are 24 px (strict reading of A11Y-7 and the last line of A11Y-13), so the stock pixel baselines and the spec's row height change. 16 equipment slots still fit at 640 × 480 and page at 320 × 240.
- **Main screen.** Gold/Time on the top line, the party block clamped with a dim `+k more` line, the six commands pinned to the bottom of the panel and never moved.
- **One cursor.** The frame's `selection` is the focused list's cursor and `actorId` the member operated on; return cursors are provider locals; the picker writes its cursor to the top frame. No extra frames.
- **Pointer gestures.** Hover moves the cursor; press only moves it; release over the pressed row confirms; leaving the row cancels the press for good; secondary-button release is `cancel`.
- **Quit** asks first (`No` focused, `Yes`).
- **Side finding, tracked separately.** Button slots activate on press (ACT-4, `input/input.ts` `applyPointer`), which A11Y-6 forbids.

## Completion evidence

Merged PR #1216 as `f73450ff32a943ccdaa8681fbde9684e6c199c9e`; it closes #585 and the three defects it fixed on the way (#1217, #1219, #1220).

Every CONTRIBUTING gate ran at the squashed head `9175314d`: `install`, `build`, `typecheck`, `lint`, `fixtures:fetch`, `fixtures:check`, `test` and `test:strict` (3,093 tests, 0 failed, 0 skipped), `golden` (24 compared), `closing` (8/8), `dump:check`, `oracle:check`, `graph`, `licence`, `audit`, `provenance` (963 files, 0 violations), `fixtures:test`, `catalogue:check`, `command-docs`, `no-skips:test`, `icons:test`, `golden:bun`, `script:dogfood`; required CI including `gate` passed on the same head. `packages/core/test/stock-menu.test.ts` holds 63 cases, each proved by removing its guard (17 targeted perturbations on `startup.prg` plus the replay-input swap).

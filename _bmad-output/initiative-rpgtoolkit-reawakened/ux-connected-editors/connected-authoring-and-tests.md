# Connected authoring and small RPGCode tests

**Owner-approved direction, 2026-11-08; interaction details and APIs remain proposals.** This extends the design review after the wireframes. It does not claim these features are implemented or amend normative runtime contracts.

## One tileset browser, contextual actions

Jensen supplied a screenshot of the original 3.1 tile editor: an enlarged pixel canvas with the Current Tileset viewer alongside it. She clarified the behaviour: choosing a tile while a tile editor was active opened another tile editor view; with a board active it selected the tile to paint with. The screenshot establishes visible composition; the contextual behaviour is the owner's reported observation, not inferred from the image alone.

Accepted direction for Reawakened:

- Reuse one tileset-browser feature in both board and tile editing; retain tileset, scroll position and selection when switching tasks.
- Default action follows the active editor: **Open in Tile Editor** for tile editing, **Use as Board Brush** for board editing. Merely focusing the browser must not erase the last active editor context.
- Both actions are explicit in a context menu and a keyboard-accessible action menu. Show the current default in a label/help hint; don't force discovery through right-click.
- Opening an already-open tile focuses another view of its existing document as appropriate, not an independent editable copy. Choosing a brush does not mutate source artwork or paint a board until a paint gesture occurs.
- Board brush targets the active board. Multiple boards do not mean broadcast; no active board means an explained unavailable action or an explicit destination choice, never a guessed board.
- Shared source edits disclose known uses and uncertain references. Browsing, brush selection and source editing are separate operations with different owners.

This refines the [board and artwork wireframes](wireframes.html#artwork); their schematic toolbars are not exhaustive menus. A right-hand browser is useful, not a mandated dock location.

## A connected game, not isolated file editors

Boards, characters, items, enemies, moves, effects, artwork and programs are connected authoring subjects. Their references are navigable: open a linked definition, inspect actual scope, edit, expand into its full editor, then return to the originating selection. A linked editor is not a copied record. Changes synchronize across views of the same authored document, while derived previews disclose stale/pending results when applicable.

Authoring synchronization does **not** imply hot-reloading a running game. A test run has an identified input revision and state. How to restart or deliberately reload that run remains a separate contract; no silent mutation during an assertion sequence.

Testing actions retain distinct meanings:

| Action | What it establishes |
|---|---|
| Preview asset | Visual/audio presentation only, not gameplay correctness |
| Test current board | Explicit board, starting position, player/party and needed state; not normal startup |
| Test one RPGCode file | A program executed with a declared fixture and dependencies |
| Test encounter | Selected rules/provider, actors, moves and starting state |
| Run game normally | Configured startup and real acquisition/transition path |
| Run saved tests | Reusable arrangements, actions and assertions with located pass/fail results |

## RPGCode as the creator-facing test language

Owner direction: retain unit tests and add Playwright-like integration/gameplay automation using RPGCode and a thin game-aware testing layer. Extend the existing framework rather than inventing a competing editor-only runner. [TOOL-5](../../../docs/spec/engine/rpgcode-tooling.md#tool-5) already specifies `script-spec`, `describe`/`it`/`expect`, discovery of `*.spec.prg`, fresh fixtures, injected clock and seeded RNG. That normative contract is not proof every matcher or hook is implemented; implementation readiness must be checked before planning consumers.

“Playwright-like” describes the arrange → act → wait for a meaningful condition → assert experience. It does not require the Playwright library, browser DOM selectors, screen coordinates or wall-clock sleeps. Playwright can independently test the web editor itself; game tests should drive the host-independent engine.

| Level | Scope | Example |
|---|---|---|
| Unit | Small RPGCode operation with minimal state | Given inputs, verify its return value or intended variable change |
| Component | One real gameplay feature in a tiny authored scene | A player and one chest; activate twice and verify reward/state |
| Integration | A few real systems together | Item-use program updates inventory and character health correctly |
| Gameplay | A bounded journey through connected scenes | Approach guard, receive refusal, acquire key, return and cross the door |

These are useful scope labels, not four separate runners or a promise that every assertion surface exists today.

## Slim component fixtures and player action lists

Jensen: “setup move lists for players and mock test boards and stuff that allowed for very slim short ‘component’ tests”. Here a move list means an ordered player movement/interaction sequence, distinct from a character's combat move catalogue.

A mock/test board is **controlled authored data running real engine behaviour**, not mocked collision, triggers or program results. Build only the necessary tiles, actor, object and references; omit unrelated world assets, opening scenes and media. Tests should not quietly replace the behaviour they are meant to prove.

Proposed fixture editor, alongside normal code authoring:

- Small board canvas with a list/numeric alternative for placement and geometry.
- Setup panel: player position/facing, relevant stats, inventory, variables, selected provider and seed.
- Ordered action list: movement input, interact, select a game option or use an item. Drag/reorder has a keyboard alternative.
- Expected results: explicit assertions about observable state and events, with a bounded tick deadline where waiting is required.
- Result panel: assertion source, expected/actual, last completed action, elapsed ticks, relevant observed state and links to the owning program/asset.

Illustrative case, **not executable API syntax**:

1. Arrange a short corridor, one wall and one door to a second tiny board; place one player.
2. Issue a short eastward movement sequence; verify the wall stops the player.
3. Follow a separate short path and activate the door; verify destination and arrival position.
4. Reset into a fresh fixture before the next case; run the same case headlessly or visibly with identical inputs.

Prefer separate cases when collision and door behaviour need independent failure diagnosis. A chest or potion case needs its own minimal setup, not this entire corridor. A fixture-injected key verifies the guard component, not the full acquisition quest.

The visual fixture/action list and RPGCode representation should share one authoritative definition. The storage, supported generated subset and handwritten-code boundary remain open; no promise of arbitrary code-to-visual round-trip. Tests are inspectable authored files suitable for version control and CI, not hidden workspace preferences.

## Runner boundary and acceptance criteria to refine

- A test driver advances the real simulation and supplies supported input events. It must keep advancing when the tested program waits, without blocking the driver on that program.
- G1 still applies: RPGCode threads remain explicit serializable step machines; no Promise/generator escape through test helpers.
- Use deterministic seeds and bounded simulation ticks. A waiting condition fails with a useful timeout, rather than sleeping in real time or hanging the suite.
- Fresh cases isolate boards, party, variables, RNG and provider state. Reports identify the source revision and fixture; authoring edits do not silently enter a running test.
- Assertions must fail for the corresponding incorrect outcome. Before accepting the wall/door examples, demonstrate that breaking the guarded behaviour produces the intended failure, not an unrelated setup error.
- Follow the repository's sub-second ordinary-test rule: smallest fixture and shortest action sequence, boundary assertions where appropriate, no unnecessary full-engine replay.
- Exclude test-only packages, fixtures and helper capabilities from normal game manifests/distribution; verify exclusion rather than rely on naming conventions.
- Reuse existing assertion/report/discovery contracts. New movement helpers, semantic targets, observable event projections, tick deadlines and fixture formats require docs-first specification and capability proof.

## Key source files

- [Experience proposal](EXPERIENCE.md), [shared architecture](architecture.md), [scenario coverage](flow-coverage.md)
- [RPGCode test contract TOOL-5](../../../docs/spec/engine/rpgcode-tooling.md#tool-5)
- [Guardrails](../../../docs/guardrails.md)
- [Planning handoff](editor-epic-handoff.md)

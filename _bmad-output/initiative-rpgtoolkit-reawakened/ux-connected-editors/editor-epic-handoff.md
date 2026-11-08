# Editor epics: where this direction enters planning

**Read-only planning reconnaissance, 2026-11-08.** Checked current `origin/main` at **379cc74e**, not the older design branch snapshot. GitHub parents #1357–#1361 are OPEN. The four editor epic `tickets.toml` files below are empty on that revision: these are envelopes to refine, not a ready implementation queue. No ticket state, epic scope, priority or dependency was changed here; no shipped-editor implementation audit was performed.

**Superseded for queue/readiness:** the owner subsequently requested inception of all five epics. See the [editor delivery plan](editor-delivery-plan.md) and the epic ticket stores. The empty-breakdown statements below describe the pinned reconnaissance snapshot only.

## Existing homes

| Epic / GitHub parent | Existing scope | How the new direction fits |
|---|---|---|
| 11 · [Foundation #1357](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1357) | Shared model/UI, platform services, VS Code/web hosts, workspace/files, main-file settings, program editor and fixture test-run, host-conformance lifecycle | Start here: document identity, active-editor context, focused visits, references, settings ownership, test-result navigation and run boundaries. Do not build separate host-specific tools. |
| 12 · [P0 assets #1358](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1358) | Board, character, item, animation, tile bitmap and packaging | Board/asset editing and contextual tests consume foundation. Establish the reusable tileset browser and board brush action here, with source-edit entry ready for the P1 tile editor. |
| 13 · [P1 tools #1359](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1359) | Pixel/tile/grabber/tileset tools, enemy/move/effect/background, lighting, autotile, image export and upgrades | Complete the tile-edit action using the same browser; evaluate MIT art reuse before committing to a painting implementation. Connected enemy → move → effect editing and small combat fixtures belong in this conversation. |
| 14 · [P2 tools #1360](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1360) | Visual events, skins, audio preview, setup builder and tutorials | Visual test-fixture/action-list authoring has overlap, but its ownership is not yet assigned. Decide deliberately rather than burying basic test execution behind a visual-builder dependency. |
| 15 · [Desktop editor #1361](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1361) | Separate Electron editor application, platform adapters, native lifecycle, signing/updating | Host the same shared editors and test UI. Electron is already selected; measure editor-specific behaviour, not another shell-choice spike. |

The current envelopes declare foundation dependencies on legacy formats, web runner and RPGCode tooling; P0 depends on foundation; P1/P2 depend on P0; desktop measurement depends on the board editor. These are envelope dependencies, not verified ready-to-build entry gates. Foundation explicitly unblocks Epic 22's 22.9 consumer seams; it must not wait for that consumer.

## Test framework is an existing workstream

Epic 10's entry **10.8 / [#948](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/948)** already owns the RPGCode spec package, runner and discovery. Entry **10.9 / [#949](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/949)** owns CLI/results/CI integration. Their scope and [TOOL-5](../../../docs/spec/engine/rpgcode-tooling.md#tool-5) are existing contracts, not evidence here of complete implementation.

Before adding a Playwright-like action layer, audit the actual current framework against fresh fixtures, hook/matcher semantics, engine stepping, input delivery, reporting and strict test-package exclusion. Then distinguish missing contract from missing implementation. Do not create a second runner or assume a full-world fixture API already exists because the spec names boards and party state.

## Reconciliation required before story approval

1. **Code editor integration:** the earlier architecture stack and foundation envelope named **CodeMirror 6**; that choice is superseded by [ADR 0021](../../../docs/adr/0021-monaco-code-editor.md), which selects Monaco for standalone/browser code editing. VS Code retains native text editing. Decide Monaco's version and integration/lifecycle/language support during inception; the decision does not claim a switch has been implemented.
2. **Connected experience across priority buckets:** pixel editing is P1, board editing is P0, and visual events are P2. Shared browser/navigation/test seams should not be independently reinvented in each bucket. Keep existing priority labels until an explicit re-scope; use a small cross-editor tracer to prove the seam.
3. **Settings:** distinguish personal preferences from game documents; settle shared schema metadata, host scopes and reset semantics before generating configuration contributions.
4. **Tests:** assign ownership for fixture documents, player action helpers and visual test authoring. Existing program test-run is not automatically the proposed component-test authoring feature.
5. **Historical notes:** epic Notes retain an October audit saying parents did not exist. Current frontmatter and live GitHub show parents now exist; that old note must not be used as today's blocker. The missing local story breakdown is still directly observable. The historical audit cites #882; no new duplicate defect is filed here.

## Recommended next planning session

**Begin Epic 11 inception, not a broad build of all five epics.** The concrete proposed first proof is:

> Open a tiny authored project in the supported shared hosts → open a program and linked board → edit/save/reopen through one document lifecycle → run a minimal RPGCode fixture → navigate a deliberate assertion failure back to its source.

Plan the shared tileset browser as the next P0/P1 seam: select a brush on a board, open source artwork, preserve selection/scope, then return. Validate its context-menu alternatives before adding a large art-tool inventory. Evaluate the MIT shortlist alongside that planning, not as an unexamined dependency selection.

Deliverables for inception: current implementation inventory; checked prerequisites; a Monaco integration plan and settings decision delta; explicit test-framework gaps; small stories with observable acceptance criteria; GitHub sub-issues and ticket-store mirrors. Present those for review before coding. This document proposes the sequence but does not invent story IDs, declare prerequisites complete, or mark work started.

## Key source files

- [Foundation](../epic-editor-foundation/epic-editor-foundation.md)
- [P0 assets](../epic-editor-assets-p0/epic-editor-assets-p0.md)
- [P1 tools](../epic-editor-p1/epic-editor-p1.md)
- [P2 tools](../epic-editor-p2/epic-editor-p2.md)
- [Desktop editor](../epic-desktop-shell/epic-desktop-shell.md)
- [Tooling entries](../epic-rpgcode-tooling/tickets.toml)
- [Architecture spine](../architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md)
- [New owner direction](connected-authoring-and-tests.md), [MIT art candidates](art-editor-reuse.md)

Relative links resolve in this review branch, but current-state claims above are pinned to `origin/main` revision 379cc74e; the review branch predates some metadata updates. Rebaseline again at inception.

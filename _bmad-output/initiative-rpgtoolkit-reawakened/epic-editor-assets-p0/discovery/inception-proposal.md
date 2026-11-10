# Epic 12 inception: P0 connected asset editing

Status: planned backlog; no implementation or verification is claimed. The approved epic set and user-authorized breakdown do not resolve the open contracts below.

## Outcome and first runnable proof

CAP-15 is a new game made with P0 editors that loads and plays in the web runner. The first thin proof, 12.1, opens an authored board through the 11.2 document path and 11.3 lifecycle, changes one tile, saves, reopens and compares editor composition to the engine in both PWA and VS Code. It is not a complete board editor. No visual-event builder, P1 pixel editor or desktop release is required for that first proof.

## Requirement coverage

| Requirement | Entries and acceptance detail |
|---|---|
| Board creation/navigation/layers T-20–T-22 | 12.1 tracer, 12.10 new/template, remembered settings, coordinate variants, dimensions, zoom/scroll/grid and current-layer visibility |
| Board modes/brush T-23–T-24 | 12.2 contextual palette; 12.10 tile draw, move/copy selection, fill, erase, rectangle and dropper, whole `.tbm` stamp; 12.11 vectors/programs/sprites/images; shading/lighting belong to P1 |
| Board inspector/properties T-26–T-27 | 12.3 links, backgrounds, color/music, threads, constants, layer titles, battles, enter program, ambient and saving; 12.11 vector/program/sprite/image inspector fields and linked visits |
| Basic undo/start/display T-28–T-29, T-33–T-35 | 12.10–12.11 undo/redo, preference consumption, colors, selection, visibility and placeholders; 12.3 startup marker and explicit main-file update; expanded clipboard is P1 |
| Character and item T-50–T-55 | 12.4 reusable stances/vector bases, preview and wizard; 12.5 stats, profile, moves, equipment and level curves; 12.6 item equipment/use cards/prices/eligibility and linked placement |
| Animation/bitmap T-60–T-62 | 12.8 sized/shaded bitmap; 12.7 frame controls, frame image/key/sound, timing, sizes and both wizards; tile wizard generates named bitmap files |
| Delivery T-70/T-71/T-74 | 12.9 canonical writer/descriptor, safe project inventory, explicit test exclusion, output, errors and actual package-only runner boot |
| Connected workflow and CAP-15 | 12.12 references, scope, visits, save-before-run and revision; 12.14 full new-game and package journey; 12.13 cleanup before acceptance |

T-25, T-30–T-32 and lighting/shading aspects of T-23/T-26 are Epic 13. T-28's expanded clipboard is P1 despite P0 basic undo being mandatory in the envelope. T-39 animated tiles are Epic 13; `.tan` selection as a board brush is P0. T-72 setup is Epic 14. Existing 11.4 owns folder-aware pickers, copies and focused visits, 11.6 owns game settings, 11.8 owns run boundaries, and 11.9 owns code test integration; no duplicate service is created here.

## Dependencies, ownership and lanes

| Lane | Entries | Dependencies and interface |
|---|---|---|
| Board | 12.1 → 12.2 → 12.10 → 12.11; 12.3 after 12.1 | 2.5 board format, 4.14 compositor and 4.18 both-isometric composition before 12.10, 11.2/11.3 documents, 11.4 visits, 11.5 preferences, 11.6 main file; no independent renderer |
| Actor | 12.4 → 12.5, 12.6 | 2.6 actor formats, 16.12 animated GIF decoding, 11.3/11.4 documents and visits; 12.6 also waits for board object ownership in 12.11; 12.4 is the shared sprite provider for P1 enemy editing |
| Composition | 12.2 → 12.8 → 12.7 | 11.1 multi-file recovery ruling; one tileset browser, not a second asset model; 12.2 source-edit action is visibly unavailable until the P1 source editor exists |
| Packaging | 12.9 | 9.7 existing package workflow, 11.1 delivery contract and 11.3/11.4 host lifecycle; reuse canonical writer and reader limits rather than a new ZIP implementation |
| Integration | 12.12 → 12.13 → 12.14 | Cross-editor visits, same-document views and test boundaries; 12.14 consumes 11.6–11.8, 11.10 new-project creation and 9.16 interactive runner; 15.10 consumes its desktop acceptance handoff |

Parallel lanes own separate editor components and format adapters; host service/schema, navigation and extensible registration are owned by Epic 11. If the chosen registration mechanism needs edits to a common static barrel/config, serialize those registrations through a single integration owner before parallel work rather than concurrent edits. Internal board object consumers wait on 12.11; board properties are 12.3. The browser preserves last active editor context when focused, exposes both keyboard and menu actions, selects but never paints on browse, and never broadcasts a brush to other boards. It retains selection and scroll; source edits show known uses and uncertain references. Its API must not require the P1 tile editor to exist.

## Provider evidence and gates

`packages/core/src/formats/board/index.ts` exports vector-board models, reader and writer; the board model retains trailing residue and a minor version. `packages/core/src/formats/actor/index.ts` exports character and item readers/writers; their models retain residue, and the writers re-emit it. `packages/core/src/render/compose.ts` exports `composeBoard` with board/view overloads. Those are existing providers, not proof of every edited-field/version path: test representative supported versions and correct an actual documented gap under G7 if found. The 2.5, 2.6 and 4.14 entries provide these dependencies. `epic-web-runner-packaging` 9.7's landed plan identifies the package writer and descriptor path; 9.16 remains a separate interactive-player dependency. A real package contains manifest `schema`, `main`, `index`, and a separate descriptor; never emit a self-running legacy EXE. The host must expose destination, capability and failure honestly, preserve drafts on errors, and prevent launch after a failed save.

| Contract or risk | Affected | Treatment |
|---|---|---|
| Supported-version round-trip and editor compositor use | 12.1, 12.4, 12.11 and all formats | Existing APIs allow work to start; test edited and untouched fields and pursue a docs-first provider correction only if an actual gap is found |
| Multi-file animation wizard commit/recovery | 12.7 | Consume 11.1's explicit shared contract; preview and cancellation must not write, failures must not claim unsupported atomic rollback |
| Package test-only exclusion and destination | 12.9 | Consume 11.1's shared host and TOOL-5 exclusion contract; test-only files cannot reach normal distribution; no assumed native signing/setup |
| Startup marker spans `.brd` and `.gam` | 12.3 | Use explicit separately owned documents and confirmed edits; no invented cross-document undo/atomicity |
| Supported connected uniqueness and reference discovery | 12.2, 12.11–12.12 | Label shared/local fields, known uses and uncertain script references; no unsupported unique-copy or complete usage claim |

## Cross-host and experience acceptance

All controls have keyboard-accessible equivalents and numeric/list alternatives for geometry, selection, frame sequence and colors; overlays have non-color labels, cancel leaves staged changes untouched, and failed writes retain drafts. Linked select/create/open attaches only after confirmation and returns to the initiating selection, or offers recovery if origin vanished. Selection, pan, preview and browser focus are not edits. An authored-view refresh is not a running-game hot reload. Normal startup, explicit board test and asset preview are distinct; tests run a named saved revision and failed save blocks launch. Scenario trace: SC-06/07/14/16/17/26/32/34/38/40 and SC-12 stamp portions in `ux-connected-editors/flow-coverage.md`; supported P1/P2 portions remain with their owners.

The epic envelope names PWA and VS Code; CAP-15 says every editor host. 12.14 proves the two named first-class hosts and exercises actual distribution bytes; Epic 15 must run the shared suite and applicable journey for Electron after its host adapters exist. This is a dependency and acceptance handoff, not evidence of a desktop pass.

## Independent review

P0 review passed after pinning animated GIF, isometric composition and new-project providers. Desktop acceptance explicitly consumes 12.14. See the [validation record](../../ux-connected-editors/editor-delivery-plan.md#validation-and-publication-record); implementation remains unstarted.

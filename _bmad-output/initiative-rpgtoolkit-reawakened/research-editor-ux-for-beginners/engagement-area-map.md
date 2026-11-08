# Creator engagement areas: legacy capability to future experience

**Session:** 2026-11-07. **Status:** accepted product direction; proposed engagement map and paper flows. Not validated personas, a feature backlog, a selected workbench composition, or evidence of implemented Reawakened functionality.

## Owner direction and what stays open

Jensen confirmed Sally's framing: **RPG Maker's clarity of purpose, VS Code's workspace flexibility, and Figma-like direct visual editing. A game maker first, with connected tools and discoverable depth.** This is a direction, not a request to clone those products.

Jensen also selected choice between game-oriented navigation and files/folders, including showing both together. Familiarity with an engineering workspace is Jensen's reported experience, not evidence that all creators prefer an IDE.

VSCodium/Code - OSS-style workbench and a custom workbench remain candidates for comparison. The separate desktop-shell decision is already made: [ADR 0013](../../../docs/adr/0013-desktop-shell-electron.md) selects Electron for the desktop editor and player. No workbench composition, native format, database layout, panel arrangement, extension API, or mandatory authoring sequence was selected by this research. Specialist editors remain valuable; continuity between them is the design problem.

Owner request: “take all the different scenarios and start mapping engagement areas. then see how that maps to the RPGToolkit as it is today vs where it can / should go. lets document those user flows and a prompt.”

## Read this handoff

1. This map groups all 54 existing discovery scenarios into activities, compares the legacy capability baseline with proposed experience, and identifies the next rehearsal for each.
2. [Engagement user flows](engagement-user-flows.md) expands specialist and cross-editor journeys, with failure/recovery and evidence limits.
3. [Reusable design prompt](engagement-design-prompt.md) hands this work to the next research/design session.
4. Retain the [original scenario inventory](creator-scenario-inventory.md) as the source of scenario evidence and confidence. The mapping below does not upgrade that confidence.

## Evidence and the meaning of today

- **Owner observation:** reopened Toolkit 3.1.0 was more capable than remembered, but cumbersome, with hidden settings, cryptic buttons, a busy board canvas and a hard-to-discover project list.
- **Legacy documented:** T-xx references below point to the [editor capability inventory](../../../docs/editor-features.md). It is a capability map, not proof that each operation succeeded in the captured executable. Some inventory sections already contain Reawakened policy; packaging rows are not historical binary claims.
- **Screenshot-observed:** the visual-reference corpus documents UI states from the owner's 3.1.0 session. The additional Status Effect Editor screenshot supplied in this party now confirms the visible form: name, rounds, speed/slow charge, disable, HP/SMP removal with negative-value restoration notes, and a program field. It does not establish zero-duration semantics, stacking, save/reopen, or runtime timing.
- **Proposed:** all new navigation, focused visits, comparisons, previews, contextual tests, asset linking and recovery behaviours below are paper designs unless separately evidenced.
- **Reawakened today:** this handoff does not audit the running editor or claim feature delivery. Existing research is not a shipped-feature list. G2 already requires shared `editor-ui` features and host-specific platform services/chrome. A later implementation comparison must record checkout revision, exercised host, observed operation, and limits; untested rows stay **not assessed**, not “missing”.

The external historical prose source is `/Users/jensen/projects/rpgtoolkit/docs/architecture/editor/visual-reference/README.md` and its five linked chapters. It is a local research input, not bundled or a portable repository link. No legacy implementation source was opened or copied. Reference screenshots from other products illustrate arrangements and marketing, not measured usability or licensed assets for reuse.

The [research pilot](../../../docs/editor-research-pilot.md) explicitly distinguishes synthetic rehearsal from human evidence. Old flow documents' conditional blockers must be rechecked before being described as current blockers. This handoff changes no normative spec or architecture.

## What is an engagement area?

An engagement area is **what a creator is trying to accomplish right now**. It is not automatically a sidebar tab, file type, persona, permission, or locked mode. One task can cross several areas; one editor can support several tasks. The same person may draw, write code, test, and publish in one session.

The areas below are a proposed organising model. “Should explore” means a design recommendation to test, not a committed requirement.

| Area | Creator engagement | Toolkit capability baseline | Future experience to explore | Main rehearsals |
|---|---|---|---|---|
| EA-01 | Orient, start, resume and configure | Workspace, tree, main-file settings, preferences, help: T-01–T-14 | Game and Files views; searchable named destinations; explain effective configuration; start without arranging the workspace | F-01, F-13 |
| EA-02 | Compose and connect places | Boards, objects, links, layers, vectors, properties: T-20–T-35 | Canvas with selective overlays and locking; clear local/shared scope; connected destinations and entry behaviour | F-02, F-03 |
| EA-03 | Make and maintain reusable artwork | Pixel editor, grabber, tilesets, animated tiles, animation, tile bitmaps: T-36–T-39, T-60–T-62 | Sheet-first work; neighbour previews; honest identity/reference effects; reusable sources rather than flattened output | F-04, F-05, F-06 |
| EA-04 | Define people, possessions and progression | Character stats, variable bindings, moves, equipment, levels, items: T-50–T-55 | Linked records, focused and comparison views, understandable units and eligibility, separate definition from placement/inventory | F-07, F-08 |
| EA-05 | Author story, interaction and behaviour | Programs, test fixtures, event builder, board triggers: T-26, T-40–T-46 | Direct code and approachable actions; unfinished work preserved; readable connections; no arbitrary code-to-block promise | F-11, guard rehearsal |
| EA-06 | Shape appearance, motion, sound and interface | Sprite graphics, animation, shading/images, backgrounds, skins, audio utility: T-26, T-52, T-60–T-64, T-80 | Contextual visual/audio previews; distinguish presentation from rules; skin replacement is not full layout authoring | F-03, F-06, F-10, F-12 |
| EA-07 | Design and balance encounters | Project/board fighting settings, enemies, moves, effects, backgrounds: T-12, T-27, T-56–T-58, T-63 | Follow effect → move → enemy → encounter; explicit rules/test setup; inspect real outcomes and shared uses | F-09, F-10 |
| EA-08 | Extend or adapt the tool and game | Project plugins, custom programs, plugin-selected menu/battle systems: T-14, T-40 | Shared editor lifecycle for contributions; visible ownership and effective providers; preserve unavailable data | F-12 |
| EA-09 | Try, understand, diagnose and recover | Test Game, program fixtures, debugging overlays, help, undo: T-07–T-09, T-13, T-28, T-41 | Distinct preview/test/full-game entry; truthful saves; concrete diagnostics; recovery and learning without abandoning the task | All flows |
| EA-10 | Organise, preserve, hand off and release | File tree, upgrades, build tools, associations: T-03, T-43–T-44, T-70–T-74, T-82 | Safe reference-aware changes; preserve originals; distinguish playable game, editable project and ingredient pack; test recipient output | F-04, F-11, F-13 |

## Scenario-to-engagement coverage

Every SC ID occurs once in this table. Secondary areas are intentional crossings, not duplicate personas. “Variation” expands an existing scenario for the next paper/creator test; it is not a claim that this session executed it. F numbers refer to the numbered rehearsals in the companion flow document. The [guard rehearsal](creator-journey-workspace-rehearsal.md) supplies story-first, world-first, interaction-first, returning and code-first routes.

| Scenario | Primary area | Crossing areas | Flow or explicit next variation |
|---|---|---|---|
| SC-01 Premise without a first step | EA-01 | EA-05, EA-02 | F-01 + guard: leave unresolved ideas visible; do not generate an unsolicited whole game |
| SC-02 Shape story before mechanics | EA-05 | EA-02, EA-04 | Guard/Morgan + F-11: retain unfinished writing while connecting assets |
| SC-03 First playable start | EA-01 | EA-02, EA-09 | F-01: blank and explained-template routes; make one intentional change and run |
| SC-04 Return to half-remembered work | EA-01 | EA-09, EA-10 | F-13: identify effective entry points and unresolved references |
| SC-05 Change creative direction | EA-03 | EA-02, EA-10 | F-04: replace selected art while retaining boards and exceptions |
| SC-06 Compose a scene | EA-02 | EA-03 | F-02/F-03: arrange first, add behaviour only when wanted |
| SC-07 Plan floors and routes | EA-02 | EA-09 | F-02: test stairs, arrival, collision and walk-behind separately |
| SC-08 Author a reusable kit | EA-03 | EA-10 | F-04/F-05: make artwork without requiring a board first |
| SC-09 Import an awkward sheet | EA-03 | EA-09 | F-04: grid/spacing/transparency preview, cancel and retry |
| SC-10 Repair a seam | EA-03 | EA-02 | F-04: locked neighbours, shared edit versus independent copy |
| SC-11 Animate a region | EA-03 | EA-06 | F-05/F-06: whole-art preview; synchronisation remains an explicit capability question |
| SC-12 Assemble stamps and terrain | EA-03 | EA-02 | F-05: distinguish visual stamp from live linked assembly or behaviour |
| SC-13 Compose atmosphere | EA-06 | EA-02 | F-03: edit light/shade/images and review baking/export consequences |
| SC-14 Begin a person with a look | EA-04 | EA-06, EA-02 | F-06: stance and geometry review, then placement/interaction |
| SC-15 Design party and progression | EA-04 | EA-07 | F-07: level/unlock boundaries and explicit starting-party ownership |
| SC-16 Design useful items | EA-04 | EA-05, EA-07 | F-08: acquire/use/equip/refuse/cancel; item is not shop stock |
| SC-17 Connect state and world change | EA-05 | EA-02, EA-09 | F-11 + guard: replay, re-entry and persistence conditions |
| SC-18 Design a fight | EA-07 | EA-04, EA-06 | F-09: poison chain through actual encounter, tactics and rewards |
| SC-19 Common action without syntax lesson | EA-05 | EA-09 | F-11: readable action with inspectable implementation and limits |
| SC-20 Learn code from an example | EA-09 | EA-05 | F-11: small fixture, contextual help, explain observed change |
| SC-21 Push boundaries in code | EA-05 | EA-08, EA-09 | F-11/F-12: direct code-to-test route without visual round-trip promises |
| SC-22 Make a custom screen | EA-06 | EA-05, EA-08 | F-12: skin versus layout; representative data and runtime input test |
| SC-23 Prototype an unusual mechanic | EA-05 | EA-08, EA-09 | F-11 variation: minimal nonstandard prototype, explicit capability limits |
| SC-24 Configure an acquired extension | EA-08 | EA-01, EA-09 | F-12: inspect contribution, configure, test and preserve unsupported data |
| SC-25 Author an extension editor | EA-08 | EA-04, EA-09 | F-12 variation: save/reopen/undo and unavailable-provider behaviour; no API selected |
| SC-26 Test a local change | EA-09 | EA-02, EA-05 | F-01/F-02/F-11: distinguish current-board test from normal game start |
| SC-27 Trace unexpected behaviour | EA-09 | EA-05 | F-11: inspect actual branch/state; no invented causal explanation |
| SC-28 Compare combat runs | EA-07 | EA-09 | F-09: fixed inputs and selected system; measured result versus prediction |
| SC-29 Recover interrupted work | EA-09 | EA-10 | F-13 variation: failed save and recovery with host-specific guarantees |
| SC-30 Deliberately revise shared data | EA-10 | EA-03, EA-04 | F-04/F-07/F-08: affected-use review and uncertain dynamic references |
| SC-31 Hand off an editable project | EA-10 | EA-01 | F-13: recipient opens intended revision without machine-local dependencies |
| SC-32 Give someone a playable game | EA-10 | EA-09 | F-13: test exported package rather than development source |
| SC-33 Find an occasional setting | EA-01 | EA-09 | F-01: search cursor/input/startup and show effective source |
| SC-34 Fit the editor to accessibility needs | EA-01 | EA-02, EA-09 | All-flow variation: keyboard/non-colour path, labels, focus return, scalable views |
| SC-35 Collaborate through conversation | EA-05 | EA-09 | F-11 variation: inspect scoped proposal, reject unrelated edits, preserve authorship/privacy |
| SC-36 Work without an assistant | EA-01 | EA-05, EA-09 | All flows: direct tools/local help; no conversational gate or generated-edit dependency |
| SC-37 Switch representations mid-task | EA-05 | EA-09 | F-11: preserve handwritten exception; show authoritative source and conversion limit |
| SC-38 Connect two places | EA-02 | EA-05, EA-09 | F-02: arrival, return, entry script and trapped destination recovery |
| SC-39 Direct an interruptible scene | EA-05 | EA-02, EA-06 | F-11 variation: full/skip paths restore controls and intended state; inspect waits |
| SC-40 Design sound in context | EA-06 | EA-09 | F-06/F-10: frame sound and cross-scene music under project audio configuration |
| SC-41 Make a noncombat game | EA-01 | EA-04, EA-05 | F-01/F-07 variation: omit combat setup without hiding unrelated capabilities |
| SC-42 Tune many records | EA-04 | EA-07, EA-10 | F-07/F-08/F-09 variation: explicit selection, old/new values, preserved exceptions |
| SC-43 Reuse behaviour safely | EA-05 | EA-10 | F-11: two chests, independent reward/opened state where intended |
| SC-44 Reconcile external edits | EA-03 | EA-09, EA-10 | F-04: retain both versions before choosing reload or reconciliation |
| SC-45 Resolve overlapping contributions | EA-10 | EA-09 | F-13 variation: preserve both revisions; semantic conflict is not solved by text merge |
| SC-46 Translate without breaking layout | EA-06 | EA-05 | F-12 variation: longer text, substitutions, glyphs, same branches; localisation model open |
| SC-47 Teach through a bounded exercise | EA-09 | EA-05 | F-11 variation: learner modifies an example, explains it, resets only the exercise |
| SC-48 Resume a short session elsewhere | EA-01 | EA-09, EA-10 | F-13 variation: last durable save and machine revision, no assumed cloud sync |
| SC-49 Preserve an old project | EA-10 | EA-01, EA-09 | F-13: inspect originals, work on copy, report unresolved dependencies |
| SC-50 Share editable ingredients | EA-10 | EA-03 | F-05/F-13: source/dependency/rights review; import into a second project |
| SC-51 Maintain a released game | EA-10 | EA-09 | F-13 variation: reproduce report, identify fixed build, state save-compatibility limits |
| SC-52 Author accessible gameplay | EA-06 | EA-05, EA-09 | F-01/F-12 variation: alternative input/cues tested in play, distinct from editor accessibility |
| SC-53 Organise a large project | EA-10 | EA-01 | F-13: find effective asset; review rename/delete, uncertain unused status |
| SC-54 Isolate an extension conflict | EA-08 | EA-09, EA-10 | F-12: compare configuration/order and restore known working combination |

## Every editor has a place, but not necessarily its own application

| Legacy surface | Engagement areas | Flow | Preserve the job; reconsider the interaction |
|---|---|---|---|
| Workspace, tree, launcher, preferences, help | EA-01, EA-09 | F-01/F-13 | Named discoverable destinations; Game/Files together; contextual help and focus return |
| Main file: startup, keys, movement, graphics, plugins | EA-01, EA-08 | F-01/F-12 | Inspect effective settings; direct links to their owners; no mandatory setup archaeology |
| Custom cursor | EA-01, EA-06 | F-01 | Actual-size hotspot/transparency preview, test in the game |
| Board canvas/properties/vectors/programs/sprites/images | EA-02, EA-05, EA-06 | F-02/F-03 | Selective overlays; separate visibility, locking and runtime enablement |
| Lighting/shading and board image export | EA-02, EA-06 | F-03 | Explain baking and distinguish clean output from editor overlays |
| Tile painting, grabber, tileset/browser/autotile | EA-03 | F-04 | Sheet and contextual pixel work, import preview, identity-safe revision |
| Animated tile and tile bitmap | EA-03, EA-06 | F-05 | Sequence/composition without disguising stamp or synchronisation semantics |
| Animation editor and wizard | EA-03, EA-06 | F-06 | Frame sources, timing, transparency and sound, with explicit creation consequences |
| Character/item sprite graphics and vector bases | EA-04, EA-06 | F-06 | Directional assignment, anchors, collision versus activation |
| Character stats/variables/profile/moves/equipment/levels | EA-04 | F-07 | Starting data, bindings, progression and actual unlock tests |
| Item and all four use contexts | EA-04, EA-05, EA-07 | F-08 | Context flags visible together, shared fields disclosed, acquire/use/decline tests |
| Enemy/tactics/rewards | EA-07 | F-09 | Follow behaviour and reward links, test selected battle rules |
| Special move | EA-07 | F-09 | Cost, target effects, program, animation, status and usage remain distinct |
| Status effect | EA-07 | F-09 | Explain configured and observed timing; no assumed zero-duration/stacking semantics |
| Battle background | EA-06, EA-07 | F-10 | Image and named sound roles; visual preview is not executed battle |
| Bard/audio audition | EA-06 | F-10 | Reusable audition tool plus contextual in-game verification |
| Program, reference, fixtures, formatting/update wizards | EA-05, EA-09, EA-10 | F-11 | First-class code, reversible conversion, inspectable fixtures |
| Visual event builder | EA-05 | F-11 | Short common-action path without arbitrary reverse conversion claims |
| Legacy skin | EA-06 | F-12 | Window/button graphics; not evidence of a general layout designer |
| Plugin-specific editors (future contribution surface) | EA-08 | F-12 | Shared document services, unavailable-provider preservation; API unresolved |
| Packaging/setup/layout upgrades/file associations | EA-10 | F-13 | Preserve source; explicit recipient/output; test generated package |
| Embedded web browser | EA-01 | F-13 boundary | Inventory marks obsolete: ordinary external help links, not a recreated browser |

## From direction to design: questions, not premature requirements

1. **Focused versus full:** how does a nested visit return to its origin, and can it expand to comparison work without losing edits? Local where a local data home exists; shared otherwise; effective scope always visible.
2. **Comparison versus documents:** do data editors open as individual documents, one collection, or both? Test a single effect and a bulk tuning task before choosing.
3. **Testing placement:** contextual preview, dedicated test workspace, or both? Distinguish static explanation, simulated calculation, actual runner and ordinary game start.
4. **Identity and revision:** what guarantees support rename, replacement, cross-document save and undo? Do not promise atomic project-wide operations because a mock has one Apply button.
5. **Host fitness:** compare the same journeys in a Code-based distribution and a custom workbench. Measure discoverability, preserved context, accessibility, visual editing, debugging, start/save/test time and maintenance cost. No workbench winner is selected by resemblance to a screenshot; Electron is already selected as the desktop shell.
6. **Model boundaries:** existing legacy representations constrain compatibility, not future product vocabulary. New storage/override/plugin/layout needs require their own decisions rather than silently appearing in a mock.

Recommended next prototype set (research order, not feature priority): F-09 effect-to-fight; F-04 shared artwork revision; F-01 discovery and startup; F-13 recipient handoff. Include an unfamiliar creator and an experienced code-first creator. Observe wrong turns and recovery, not just task time or preference. If a mock supports only a paper transition, label it; never report it as engine execution.

## Key source files

- [54-scenario inventory](creator-scenario-inventory.md)
- [Prior creator journeys and context/promotion discussion](creator-journey-workspace-rehearsal.md)
- [Ten flow studies and authority notes](README.md)
- [Decisions](decisions.md)
- [Research pilot and evidence discipline](../../../docs/editor-research-pilot.md)
- [Editor capability inventory](../../../docs/editor-features.md)
- [Guardrails, especially G2 and G7](../../../docs/guardrails.md)

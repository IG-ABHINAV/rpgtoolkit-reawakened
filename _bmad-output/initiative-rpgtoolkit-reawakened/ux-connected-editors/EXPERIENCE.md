---
name: Connected editors experience
status: proposed
sources:
  - ../research-editor-ux-for-beginners/engagement-area-map.md
  - ../research-editor-ux-for-beginners/engagement-user-flows.md
  - ../research-editor-ux-for-beginners/creator-journey-workspace-rehearsal.md
  - ../research-editor-ux-for-beginners/creator-scenario-inventory.md
---
# Connected editors — experience proposal

## Foundation

This is a paper proposal, not an accepted architecture, implementation audit, usability finding or feature commitment. Its creative direction is game-maker clarity, flexible workspaces and direct visual editing, not a clone of any product. Specialist editors remain independently usable. The same creative task can begin in a board, artwork, database, code or a project file. No mandatory setup sequence, persona mode, AI, account or network is implied. The [scenario coverage](flow-coverage.md) specifies 54 individual entry/outcome variations and traces them to F-01–F-13; these are invented research situations, not observed people.

The target is a desktop-sized, multi-panel authoring experience shared across the Electron desktop host accepted by ADR 0013, the intended browser host and a VS Code extension. [ADR 0021](../../../docs/adr/0021-monaco-code-editor.md) selects Monaco for standalone/browser code editing; VS Code retains its native text editor. Dock Spawn remains a candidate, and Monaco's version and integration details remain open. G2 requires shared `editor-ui` to access host capabilities through platform services, not host imports. The visual reference is [DESIGN.md](DESIGN.md); spacing, panel treatment and keyboard focus refer respectively to `{spacing.unit}`, `{components.panel}` and `{components.focusRing}`. The two spines take precedence over conceptual [wireframes](wireframes.html) if they conflict. All behavior below is proposed, including labels and panel arrangements.

**Owner follow-up:** [Connected authoring and small RPGCode tests](connected-authoring-and-tests.md) extends this spine with accepted direction for a shared context-sensitive tileset browser and repeatable unit/component/integration/gameplay testing. It governs those additions over the earlier schematic wireframes; exact API, fixture representation and interaction details remain proposals. The [planning handoff](editor-epic-handoff.md) records that the former CodeMirror stack choice is superseded by the Monaco decision, not evidence of an implemented switch.

## Information Architecture

| Destination / entry | Main work and return |
|---|---|
| [Workspace](wireframes.html#workspace): Welcome, Game, Files, Outline, Problems, help | Open/create/import; choose Game or Files or show both; search all; open recent work and effective startup. Game is intent-oriented, Files exposes real assets. No artificial separate document when both navigate to the same asset. |
| [Board](wireframes.html#board): World, canvas, layers and inspector | Compose places, objects, vectors, images, links and atmosphere. Select an object then visit linked artwork or behavior and return to the same selection. |
| [Artwork](wireframes.html#artwork) | Independent sheet drawing, tile/grabber, tileset/terrain, stamps and animation sources; also entered from a board use. |
| [Animation](wireframes.html#animation) | Frame sequence, look/stance assignment, sprite geometry and sound; reached from artwork or a person/item. |
| [Database](wireframes.html#database) | Characters, people, items, enemies, moves, effects and backgrounds in focused detail or management/comparison; shared definitions are not placed instances. |
| [Effects](wireframes.html#effects) | Focused effect → move → enemy → encounter and selected rules/test trace; reachable from Database and board battle settings. |
| [Events](wireframes.html#events) | Program code, optional structured actions, reference, variables, migration and fixture/debugging; direct code remains a normal entry. |
| [Settings](wireframes.html#settings) | Search effective project/startup/input/movement/cursor/display/audio/battle/plugin settings and their owners; personal editor preferences are distinct. |
| [Appearance](wireframes.html#appearance) | Legacy window/button skin, contextual images/audio and, only where a provider supports it, full screen layout. |
| [Delivery](wireframes.html#delivery) | Preserve/import, editable project, editable asset pack, playable distribution and recipient validation; each has its own output. |

Help opens at the current field or command and returns focus. Ordinary external documentation links replace the obsolete embedded browser; the proposal does not recreate it. File association, setup/package and layout upgrade are explicit operating-system/host capabilities, not implied browser operations.

## Voice and Tone

Use names for work and consequences before format jargon; expose the technical name on demand. Avoid a confidence claim when references, persistence or provider behavior are unknown.

| Situation | Proposed copy |
|---|---|
| Shared change | “Shared tile • 8 known uses. Some script references may not be discoverable.” |
| Local field unavailable | “This field is shared by all uses. Open shared definition or cancel.” |
| Broken destination | “Inn board not found. Choose another, locate it, create a new board, or keep this unresolved.” |
| Failure | “Couldn't save Village. Your changes are still open. Retry or use the recovery options available in this host.” |
| Unknown data | “Provider unavailable. Data retained; editing and test are unavailable.” |
| Test boundary | “Animation preview” / “Test this program” / “Play from here” / “Play from game start” — never just “works.” |

## Component Patterns

### Workspace and visits

A proposed default workspace has project/outline/assets at left, document or visual canvas in the center, contextual properties at right and collapsible Problems/test/output below; dock position and visibility are adjustable. A compact header identifies project, active document, dirty state and save status. A contextual **Select / Create / Open** control is available on reference fields. Selecting an existing asset attaches only on confirmation; creating one asks its name and destination before creation, then confirms attachment. Missing references remain unresolved unless the creator explicitly locates, replaces or creates something; cancellation returns unchanged.

A focused editor visit carries origin, purpose, selected asset or instance, field, effective scope, pending edits and return target. **Show full view** expands the same subject to list, filtering, comparison and relevant bulk operations without losing the visit; **Return to task** returns to the origin. A proposed **Back to focused view** narrows it without discarding changes. If origin was closed, renamed or invalidated, offer reopen/locate origin or keep working in full view, never attach silently. Whether the host can maintain a single document/undo identity across views needs verification.

Local placement values and shared definitions are labeled at field level. The owner direction is local by default **only where the model has a local home**, configurable for genuine local/shared boundaries; preferences change initial focus, never field meaning. When no local override exists, show the shared owner and impact; do not fabricate a local value. “Make unique” needs supported copy, reference and persistence semantics. Referenced definitions can still be opened directly in full view.

### Board, art and motion

- **Board:** toolbar offers Select, Paint, Shape, Place Thing and Pan; selecting is non-mutating, painting or moving commits an edit. Outline and canvas share selection; properties expose coordinates, floor/layer, source and effective activation. Layers have independent visibility and lock controls; neither means runtime disabled. Separate collision, walk-behind/occlusion, trigger, path, image and lighting overlays, with labels and non-color indicators. Board settings own size, startup marker, links, entry program, threads, audio and battles; entry program and threads are not conflated. Doors/stairs choose destination and arrival; return link is separately inspected. Resize previews cropped content; cancel leaves it intact. Isometric coordinate presentation remains explicit; conversion needs supported preview and data guarantees.
- **Artwork:** left set/asset list, center sheet at pixel zoom with grid and editable selection, right tool/colour/metadata inspector, bottom repeat/neighbor preview and optional frame strip. Select tiles without painting; pencil, fill, erase and numeric pixel tools change only the chosen source. From a board seam, lock neighboring cells as context and decide shared change versus a supported unique copy before drawing. Standalone New Sheet works with no board. Grabber previews grid dimensions, margins, gaps, transparency and selected cells before import; review destination and cancel without writing. Curation shows original index, known uses and uncertain raw-script references before reorder/replace/merge/delete. Terrain-role/autotile assignment and preview are proposed, with generated behavior only where supported; solidity is not guessed from colors. Stamps are visual compositions, not behavior-bearing objects; report whether placement copies cells or links a supported assembly, including per-cell shading. A pack includes editable sources and dependencies only with explicit rights review.
- **Animation and looks:** sheet grid/stance compass at left, preview at center, timeline or accessible frame list below, timing/geometry/sound inspector at right. Select is not frame mutation. Create animation/import wizard previews frame slicing, direction labels and transparency; duplicate/reorder frame and inspect sound marker attached to frame identity. Show movement speed, animation timing and idle delay as distinct controls with units. Show collision base and activation/talk range separately over a sprite and board sample; offer numeric vertex editing. Multi-cell water/fountain has whole-region preview and visible synchronization status; synchronized channels are conditional on actual model/provider, never simulated as if available. Preview is not gameplay.

**Smaller specialist tasks, same workspace (proposed):**

- **Pixel and tile utilities:** A multi-cell selection confines drawing while allowing a single stroke across cell boundaries. Fill explicitly targets selection, cell or connected artwork. Mirror, rotate, replace colour, wrap-edge drawing and offset preview the affected pixels before Apply; selection and playback add no undo entry. Terrain setup names edge/corner roles, flags missing roles, and tests an island, corner and narrow passage without guessing the variant order. These operations depend on the applicable asset format and editor capabilities.
- **Image/animation conversion:** Grabber's transparency controls compare source alpha, chosen colour key and opaque mode with a before/after mask; a selected key is never silently applied to every frame. For GIF, choose keep-linked or import editable frames where supported and review timing/conversion before committing; native animation timing and GIF delays are not assumed interchangeable. A missing sound or image is identified on its frame, and changing frame order keeps its associated data together.
- **World, resize and camera:** World view displays known directional and program links with a list alternative; moving a world-view card changes layout only, not board coordinates. Resize shows the anchoring edge, cropped cells and affected objects before Apply. Pan, zoom, fit, grid and minimap are view controls; isometric invalid cells and clipped selections are visibly identified before an edit.
- **Program reference and update:** Search command help alongside the exact program; formatting is a separately reviewable edit. An update/migration wizard previews the original and result, reports unsupported fragments, and retains the original on cancel or failure. It never equates a successful syntax parse with a successful run.
- **Packaging, setup and file association:** Delivery offers a distinct setup ZIP only where the host supports it, with file list, destination and recipient requirements. Registering a file association is a separate explicit operating-system action, not a side effect of opening a project. Layout/format upgrade previews affected files and compatibility, preserves originals and applies only after confirmation; no automatic legacy-write capability is implied.

### Database, effects and sound

- **Database:** type list and searchable records at left, selected record in center, relevant links/use/scope at right. Full view adds selectable comparison table; bulk tuning first lists exact selected rows, old/new values, units and excluded exceptions. Apply only after review; atomic multi-document undo is conditional. Focused visit still labels shared edits.
- **Characters:** separate profile, starting stats and imported variable bindings, level curve plus accessible table, move/unlock conditions, equipment slots, look and party ownership. Never regenerate a binding from a display rename without a diff. Combination/unlock rules come from the current applicable spec or selected provider. “Add to game” opens explicit startup/party setup; multiple starting members/inventory depend on a supported native or generated representation.
- **Items:** list Menu, Battle, Board and Equipment use cards together; show any fields shared across contexts. Item definition is separate from placed Pickup/Chest, instance activation, contents and saved state. Price is not shop stock; a supported shop program or stock owner supplies the latter. Test acquisition, intended use, full health, ineligible equipment, cancellation and removal against an explicit state; do not predeclare consumption behavior.
- **Enemies/moves/effects:** enemy detail links tactics, AI/program, weaknesses/strengths, run/defeat, moves and rewards. A move keeps cost, targets, effects, program, animation and use contexts distinct. An effect shows name, rounds, speed/slow charge, disable, HP/SMP removal and program as configured, plus known uses; show negative restoration notes only as field documentation. No inference about zero duration, stacking or execution. A battle background offers image/bitmap preview, music and separate cursor, selection, fighter-ready and unavailable sound roles. Audio picker provides labeled Play/Stop/Loop for audition; select and save are separate, and actual playback must be checked in the chosen host.
- **Encounter:** distinguish global encounter pool/system from board battle allowance, skill and background. Test panel records selected provider, party, enemies, starting inputs, seed and trace when the actual provider supports them. Compare observed runs and jump from trace to responsible field, retaining fixture. Do not apply stock predictions to custom rules or silently fall back on missing plugins.

### Events, settings and interface

- **Events:** actions/outline at left, Blocks or Code document in center, reference/parameters and test state at right. Structured actions can express supported common operations with visible ordering, waits, conditions and consequences. **Show as code** reveals the representation. Unsupported or handwritten code remains exact; editing it never silently regenerates it from blocks. Source authority, reversible conversion and fixture persistence depend on a later contract. Import/migration presents old/new diff and preserves original; fixtures explicitly name board, position, party, variables and inventory. Debugging shows observed branch, watches and location when supported, not invented intent.
- **Settings:** searchable categorized settings, effective value, source (default/convention/imported/override where known) and owner link. A keyboard capture or labeled key list shows conflicts before apply; cursor asset picker previews transparency and hotspot at actual size. Editing stages changes; Apply validates and makes a pending document change, Save persists, Cancel discards the staged edit. Startup points to its actual owning board/party/program rather than duplicating a second editable value. The UI can use schema-driven fields inspired by `contributes.configuration`; actual schema, storage and ownership contracts remain open.
- **Appearance and plugins:** Skin edits window/button graphics and preview, not a whole screen. A provider-supported screen layout may position text, images and buttons and bind representative data; test real inputs separately. Plugin manager reviews identity, version, origin, capabilities and ordering before explicit enable/change. Provider-contributed forms or specialist editors are conditional on an agreed API and host support; their changes need normal save, undo and validation lifecycle. Missing providers retain inspectable data; migration offers a diff, cancel and preserved original, not silent reinterpretation. A file appearing in a directory does not authorize enabling code. Legacy native DLL support is not implied.

## State Patterns

| State | Proposed treatment |
|---|---|
| Empty | Offer blank, explained template or import when available; assets can be drawn/imported without a starter library. Rights-cleared starter content is conditional. |
| Selecting vs editing | Selection, camera movement and promotion are view state; actual paint, property change or reference attachment is a named pending edit. |
| Dirty / saving / saved | Document tab and header say “Unsaved changes”, “Saving” or “Saved”; saved means confirmed by the actual host, not previewed or queued. |
| Cancel / undo | Dialog Cancel abandons its uncommitted choices; document undo reverses supported committed edits and displays its scope. Multi-document transaction, undo and backup are conditional, not assumed. |
| Failed save / launch | Keep draft open, identify document and offer retry and host-supported recovery; do not launch stale data. |
| Interrupted work | On reopening, list only actually available durable save, host backup or draft with time/source; compare before choosing. Neither autosave nor a draft is an independent backup; no cross-device synchronization is assumed. |
| External or contributor conflict | Preserve both versions, show baseline/local/external when available and a semantic review of references; keep local, accept external, manually reconcile or cancel. Do not imply text merge guarantees a valid project. |
| Unsupported / missing | Preserve original data; show named limitation, repair choices and known/uncertain references. Do not silently replace missing media, providers or dynamic links. |
| In-progress long action | Identify operation and affected output, permit cancellation where supported, and do not report a partial build as complete. |

## Interaction Primitives

- Click/keyboard select, then an explicit edit tool or field changes the document. Drag is an accelerator with keyboard/numeric equivalents. Escape dismisses the top transient action or cancels an uncommitted gesture; it does not silently discard a dirty document.
- **Open**, **Choose**, **Create**, **Make unique**, **Compare**, **Show full view**, **Return**, **Save** and **Cancel** have consistent meanings across specialist editors. Search and command discovery are available without removing visible core actions.
- Local help, direct forms, drawing and code are complete routes wherever their underlying capabilities exist; no assistant gate. Optional conversation, if a service exists, states what material will be sent, proposes a scoped diff, permits rejection of unrelated edits and never runs or changes files without consent.
- **Preview** is visual/audio or a calculation only. **Test program** uses a stated fixture; **Test battle** uses a provider-supported setup; **Play from here** starts near an explicit safe position; **Play from game start** uses configured startup. Show selected revision, starting state and system as applicable. Save relevant edits first; a failed save prevents launch. A fixture with an injected key does not prove a full quest.

## Accessibility Floor

Propose WCAG 2.2 AA as a target to verify, not a conformance claim. Every command, selection, canvas operation, timeline item, geometry vertex and dialog has a labeled keyboard route and visible `{components.focusRing}`; focus enters a visit, returns to its initiator, and is restored meaningfully if the origin disappears. Screen readers receive type, selection, scope, value, dirty/error and changed status; avoid repeated live announcements during animation. Provide logical reading order, scalable text and panels, non-color state and patterns, reduced motion, image descriptions and numeric/table equivalents for graphs, spatial position, frame order and colors. Audio preview has labeled controls and audio-free authoring/test paths where supported. Accessible **editor** controls do not prove accessible **games**: separately test remapped player inputs, cues beyond color/sound and timing alternatives in actual play.

## Responsive & Platform

At reduced desktop width, collapse docks to labeled tabs or drawers; preserve active document, selection, focus and return context. Reopen panels via visible controls, never hover only. On larger screens, creators can place panels side by side; the default uses `{components.panel}` and `{spacing.unit}` without fixing a host-specific docking library. The VS Code extension integrates with host tabs, focus, shortcuts and document/save services; Electron desktop and the intended browser host provide task semantics through their own platform services. File access, external editor, audio, recovery, offline operation, plugin UI and packaging must be reported per actual host; do not promise identical guarantees. Mobile authoring is not selected in this proposal; if a host cannot perform an operation it says so and preserves work.

## Key Flows

### Morgan stages the guard (F-02, F-08, F-11)
1. Morgan writes a scene beat and leaves an unresolved key reference without creating an assumed quest format. On the board she places a guard and chooses its interaction; placement and shared definition are labeled.
2. She opens the key picker, creates a key deliberately, saves and returns with it selected. The event checks already admitted, then key held, then refusal; activation eligibility remains separate from the key check. She chooses where the guard moves, not an implicit disappearance.
3. She runs named fixtures for no key, key held and admitted, then tests the attached guard on the real board and travels through the passage.
4. **Climax:** the refusal is audible/visible without the key and passage works when intended; a fixture-injected key alone does not prove a complete acquisition quest. Failed save stops testing; missing key stays unresolved rather than silently recreated.

### Casey repairs a roof (F-04, F-05)
1. Casey selects a seam on the village board, opens the sheet with neighboring cells locked, and sees “shared” plus known uses.
2. She chooses a supported unique copy for this placement, paints pixels, checks repeat preview, saves and returns to the exact board selection. If uniqueness is unsupported she chooses shared or cancels instead.
3. **Climax:** the board shows the adjusted join while other uses remain unchanged only where the actual copy/reference operation supports that guarantee. An external version arriving during the edit is preserved alongside the local version until reviewed.

### Avery balances poison (F-09, F-10)
1. Avery opens Poison, inspects its raw configured rounds and shared uses, then links it to Venom Bite, an enemy and a board's eligible encounter.
2. Avery selects the actual battle provider, a party, seed and audio background, and runs a supported fixture twice, comparing trace events including reapplication and effect removal. A missing provider blocks the test; no stock formula or zero-round meaning is guessed.
3. **Climax:** a trace event returns Avery to the responsible effect or move with the same fixture ready for the next test. Audio audition alone is not evidence of battle playback.

### Rowan preserves and hands off (F-01, F-13)
1. Rowan imports a copy of an old project, reviews missing main files and plugin dependencies, then uses Game and Files together to find the effective start and settings.
2. Rowan changes a conflicting key after reviewing the conflict, saves, tests the intended start, and chooses an editable project rather than a playable build. Preflight shows files, dependencies, rights and destination.
3. **Climax:** a clean recipient context opens the intended revision; the report lists what was and was not checked. Originals remain intact; a hosted link or save compatibility is not claimed without evidence.

### Riley starts in code (F-11, F-12)
Riley opens a program directly, uses command help, runs an explicit small fixture, then links it to a board object. A visual view may explain representable actions; the unsupported handwritten exception remains exact and authoritative until a real conversion contract says otherwise. **Climax:** the integrated activation is tested without forcing a round trip through Blocks. If an extension owns a needed field, its provider and availability remain visible.

## Iteration log: four cross-editor paper rehearsals

| Journey | Initial approach | Friction found | Revised proposal |
|---|---|---|---|
| Board → key → event | Separate file editors, return manually | Creator loses guard, scope and unfinished condition | Focused asset visit with Select/Create/Open, explicit attachment and return; promote for comparison without losing subject. |
| Board → art → board | Open sheet and immediately paint | One seam may mutate many uses; external change can destroy draft | Scope/known-use review first, neighbor context, conditional unique copy and two-version comparison. |
| Effect → battle → effect | Preview effect on a static card | Card cannot prove selected system, stacking or actual result | Link chain and provider-specific named fixture/trace; retain seed and return to field, leave unknown rules unknown. |
| Legacy project → release | One generic Export button | Editable project, ingredient pack and playable game get conflated; source or progress at risk | Preservation-first import, distinct output profiles, explicit preflight and clean-recipient check with save-compatibility limits. |

## Mock boundaries and open constraints

The linked atlas is a conceptual layout reference, not an executable prototype, not complete interaction states and not proof of runtime, accessibility or host support. In particular it does not mock every picker, keyboard alternative, conflict comparison, import/migration diff, fixture/trace, localization exercise, teaching reset, release compatibility or provider failure; this spine and coverage table describe those proposals. No new architecture, data model, storage format, plugin contribution API, cross-document transaction, cloud sync, full layout designer, localization model or synchronized animation channel is selected. Before implementation, verify current normative specs, host capabilities and evidence with real creators, including keyboard-only and no-assistant journeys.

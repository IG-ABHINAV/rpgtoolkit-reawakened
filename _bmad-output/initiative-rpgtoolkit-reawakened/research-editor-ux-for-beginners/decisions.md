# Editor UX for beginners: design decisions so far

**Status:** working record from the 2026-10-16/17 design sessions (a party-mode round table with Sally, Winston, Amelia and John, driven by Jensen). Nothing here is an ADR. Items marked **Decided** were agreed by Jensen in conversation; **Proposed** items are the round table's recommendation and need an owner call; **Open** items are unresolved.

**Clean-room note (G7).** This folder describes legacy behaviour in our own words and proposes new designs. It names no legacy source files or identifiers.

## 1. The goal, in Jensen's words

Create editors that **anybody can use**: easy to use, using modern solutions to the things that made the legacy editors hard to follow. The job is to walk the legacy editors one by one and work out how each should flow.

- **Audience: beginners and hobbyists.** Decided. (Matches the project brief's first user: "the next beginner", success = finish a small game and send a friend the link.)
- **Scope: complete editing capability**, not a cut-down beginner subset. Decided. Easy things become one-click; hard things stay possible.
- **What the document is for:** how to make the editors easy to use, because reviews say they were hard. The essay in `rpgtoolkit/docs/editor-ux-proposals.md` is input, not the plan. Decided.
- **Legacy compatibility:** write-back remains **Open**. ADR 0005 says it is not promised. The room recommended import-first, but Jensen's answer "beginner and hobbyist" concerned the audience—not permission to remove writers. Silence was not approval.
- **Play architecture:** Jensen answered **"no"** when asked whether the runtime consumes a live document model. That does not select save-on-Play or prohibit every embedded preview. Save-first testing and current-board Play below are **Proposed**, not owner decisions.

## 2. Evidence about why the editors are hard

| Evidence | What it says | Kind |
|---|---|---|
| lingy, "Some free alternatives to RPG Maker", Publish0x, 2022-07-25 | "I always hated the RPG Toolkit because I found it very unintuitive. It was simply impossible for me to understand this part." Also: the tool is "really very important for beginner developers"; many schoolmates used it in high school. Judges tools by time to a first game (gave up on one after 30 minutes). | Discoverability |
| SourceForge review, 2010-12-22 | "to someone who knows nothing about anything, the RPG Toolkit seems daunting... and it is... you will have to work for it." | Discoverability |
| Nostalgia-Discord and forum corpora, mined 2026-10-17 ([evidence](evidence/community-pain-points.md)) | Reports include machine/archive loss, lost projects, failed tile saves, and crashes around opening or running projects. Jensen explicitly identified the nostalgia threads as lost-work evidence. The sampled keyword search found no explicit autosave request; it cannot establish absence across the community. | Safety: recovery must cover both failed edits and long-term project backups |
| Legacy behaviour (functional guide) | No autosave, in-place rewrite saves, 1-step undo in some editors and none in others, no validation before runtime, silent do-nothing traps (wrong layer, a flag that must be ticked). | Safety and discoverability |

Every editor therefore has two jobs: **make the next action understandable** and **make mistakes recoverable**. “Nothing is ever lost” is an aspiration, not a guarantee against lost machines or deleted backups. Draft recovery, atomic writes and undo do not replace an independent project backup.

Not evidence of an editor problem: a commenter's "not as powerful as Sphere, not as popular as RM2k(3)" is reputation, not UX. (Source URL not recovered.)

## 3. Method

For each editor, the same four moves:

1. **Name the job** in the author's words, not the file type.
2. **Walk the legacy flow** honestly, click by click; mark confusion and danger.
3. **Redesign the flow**, with a sketch.
4. **Check the data underneath**: what it costs, what it breaks, what the native format must hold.

Then **run scenario walkthroughs** ("what is the flow when a user wants to do X?") against the whole design and list the holes. Jensen found this exercise the most useful thing we did. Keep doing it.

Order editors by a first-time author's real path (project, board, tiles, a person, a script, Play), not by file type.

## 4. Decisions by area

### 4.1 Foundation (done once, every editor inherits)

- **Nothing is ever lost:** atomic save, autosave drafts with recovery, undo in every editor. Proposed. Fits AD-19 (`editor-model` command stack, host `backup`).
- **Proposed Play contract:** save relevant edits, then test the **current board** from an explicit test spot or board test marker; offer a separate **Play from start**. Never infer a spawn from the last incidental canvas click. A save failure must not silently launch stale data. This is an interaction design, not an implemented runtime contract; see [project shell](flows/07-project-shell-and-sharing.md).
- **Near-the-cause feedback:** a mistake shows next to where it was made, before Play. Examples: a door on a floor the player never reaches; a route through a wall (red dot); an unreachable destination. Proposed.

### 4.2 Board editor

- **No New Board dialog.** "New board" drops the author into a ready board (sensible default size and layers; resize any time from any edge). Proposed.
- **Project style as a default**, not a restriction: picture-based Top-down / Isometric choice for new boards; imported boards keep their actual coordinate system and pixel placement. Fine snapping remains available. Proposed.
- **Layers named by job**, not number: Ground (and extra floors), Above player. Proposed. The legacy format already stores layer titles.
- **Left panel organised by what you place**, not by tool mode: Walls, Things that happen, People and items. Scroll and Zoom are camera, not content, and leave the mode list. A pick of kind shows only the tools that apply; no grayed-out matrix. Proposed.
- **Figma-style outline** replaces the five right-hand tabs: one tree (Floor > Walls / Things that happen / People and items), click a row to select on canvas and vice versa; show/hide/lock/rename/reorder work the same on every row. Proposed (Jensen supplied the Figma direction).
- **Properties panel on the right** changes with the selection and has a fixed section order for anything that happens: **Name, When, Then, Only if, Placement**. Nothing selected shows board properties. Decided in direction ("on the right side you can have properties such as triggers").
- **Vector types dissolve by meaning:** Solid = **Walls**; Under = **Walk-behind areas**; Stairs = a **Stairs** gallery item (a kind of trigger); Waypoint = a person's **Route**. Proposed.
- **Walls and walk-behind, either way:** whole tiles **or actual vector vertices**, on layers. **Decided by Jensen.** A common geometric model, tile-brush merging, off-grid editing policy and default snapping are **Proposed implementation/design choices**, not approved restrictions on switching tools.
- **Show layer membership visibly.** Proposed. Being on a different layer from the initial player is not itself an error—the player may reach it using stairs. Warn about a demonstrably blocked/unreachable interaction, not every upstairs wall.
- **Auto-solid tiles** (mark water, trunks, walls solid once in the tileset, boards inherit it) is the strongest beginner win and is **Open** (needs the tileset-properties design and Jensen's call).
- **World view:** boards as frames on a canvas; a door's destination draws as an arrow to the destination board (Figma prototype-arrow idea); click to open, drag to relink. Proposed.

### 4.3 People, doors and things that happen

- **Gallery of placeable things:** Door, Sign, Chest, Stairs, Person and Pickup. Proposed. Equipment and consumables are **item definitions**; a placed Pickup refers to one of them. A Chest is a board Thing with contents and persistent opened state, not an inventory item kind.
- **Triggers read as sentences** with dropdown blanks: "When the player **steps on** this, **go to** **[Inn]** at **[pick the spot]**." Then-steps are an ordered list of blocks; **+ Then...** adds more. Proposed.
- **Create-on-the-fly destinations.** "Go to" offers **+ New board...** first; it creates the board, jumps there, and offers to place the return door. Proposed (found by the "make a village" walkthrough).
- **A Person is one gesture:** pick a **look**, give a line, place. Collision and talk range are visible shapes with handles by default. The legacy spread across four editors (animation, item, sprite graphics, board panel, script) collapses into one flow. Proposed.
- **"What he does":** stand still / wander / walk a route / face the player. **Route = dots drawn on the map**, tile by tile, with loop / back-and-forth / once, wait-at-a-spot markers, speed in words, and red dots where blocked. The same route serves a cutscene block "Walk along route". Proposed (Jensen supplied the dotted-route screenshot).
- **Appears only if** is a sentence over a named variable. Proposed.
- **Meaning-based UI:** Database > People edits reusable Person definitions (item-compatible on legacy import); Database > Items offers Consumable, Equipment, Key item and Advanced item. Board Things include Chest and Pickup, which refer to item definitions. Proposed synthesis after review.
- **Person definition vs placed instance** (Figma component and instance): place five villagers from one "Villager"; change the look once; each carries its own lines as overrides. Duplicate asks "Same person" or "New person like him". Proposed. Prefabs/houses are the same mechanism and are needed early (a house is ~30 tiles plus walls, roof and door).

### 4.4 Scripts and blocks

- **Common things are one-click blocks; code stays available** (Jensen: "writing code is important in many situations, but we should make the often things simple one click items"). Decided.
- **Exploratory corpus signal:** 2,550 distinct program texts; `send` appears in 44%, `wait` 32%, `mwin` 31%. Among 2,521 texts with detected parenthesised identifiers, 51% had no detected identifier outside the top 10 and 62.4% none outside the top 30. **This is not proof those programs can be represented fully by that many blocks**: the regex ignores some syntax, strings and semantic control flow. See [method and caveats](evidence/command-census.md).
- **Tier 1 (one click on any trigger):** Go to board, Say something, Play a sound, Give item or gold, Start a battle, Fade, Wait. Tier 2 (small designers): Message with choices; custom screens (about 200 programs hand-draw text, colour, font, rectangles). Tier 3: write code, with **Show as code** as the on-ramp. Proposed.
- **Generated snippets kept together under Programs, possibly grouped by board.** **Decided in direction** (Jensen's proposal). Exact path `Prg/_generated/<Board>/`, readable names, stable IDs, reuse/promotion, metadata storage, orphan checks and handling non-board owners are **Proposed**. Existing inline code must still import; the user did not remove it from scope.
- **Block structure round trip:** a marked region inside the script vs a sidecar file vs a native block format. **Open.** See `reawakened-fit.md` §2: ADR 0004 allows a third path (blocks stored as data, lowered through the same AST), which the round table had not seen. Needs an owner call before any block work.
- **Character generator: maybe later.** Decided ("maybe later, was pretty cool"). Document it as a future option; do not ship a disabled “coming soon” button in the beginner flow.

### 4.5 Characters, enemies, items (the Database)

- **One master-detail screen** for characters, enemies, items, moves and effects (list, detail form in grouped boxes), taken from the RPG Maker Database screenshot. Take: master-detail; a single Images box (face, walking sprite, battler together); traits as a list of modifiers. Leave: numbered slots and "Change Maximum", `None` shown as a value, cryptic category names (System 1/2, Types, Terms), a raw Type/Content table. Traits become **sentences** ("Takes 50% less fire damage"). Proposed.

### 4.6 The project file by convention

- **Hide the main game file behind defaults and conventions; allow overrides.** **Decided in direction**, Jensen's project-file analogy. The particular startup names, start-board flag, party ordering, project-manifest format and legacy-import strategy in [flow 08](flows/08-project-file-by-convention.md) are **Proposed**, not selected architecture. A hidden `.gam` can still be the storage mechanism.

### 4.7 Plugin-defined editors

- **Battle-system plugins need robust or custom editing.** **Decided in direction**. The three-level support model in [flow 09](flows/09-plugin-editors.md)—command controls, declarative forms, specialist panels—is **Proposed**. It does not require every shared Database field to become plugin-owned, nor select a new plugin API or trust tier.

### 4.8 Tile-making, not merely tile importing

- **Reduce tedious tile and animated-tile creation.** Jensen specifically challenged the remaining effort and the old editor's quality. **Decided problem to solve**; the solutions remain proposed. [Flow 10](flows/10-tile-making-without-the-grind.md) adds sheet-first drawing across tile boundaries, source editing in board context with shared/unique scope, selected frames → Make animated tile, duplicate/delta frame editing and one multi-cell waterfall timeline. Preserve editable source and verify synchronisation rather than promising automatic art or an already implemented region format.
- **Reusable tileset creation remains a required workflow.** Jensen explicitly confirmed that reducing tile-making friction must preserve authorable sets that can be reused. Mario is a design reference for a reusable vocabulary of pieces and assemblies, not a request for Nintendo's assets or NES constraints. The [tileset lifecycle](flows/03-tiles-and-art-sources.md#workflow-create-a-reusable-tileset-then-build-many-boards) proposes independent kit authoring, multi-board references, animated entries, visual stamps and portable packs; exact pack/update/identity mechanics remain proposals.
- **Command of the isometric tile world & procedural generation (2026-11-09).** **Decided in direction** (Jensen): the tile and asset ecosystem should combine kitbash-friendly edits ("Tile Edits So Simple, ANYONE Can Do Them!"), Tilesetter-style procedural blob/transition generation with a live sandbox, and 3-plane isometric projection (Pikuma 2:1 dimetric math) plus tall-isometric diamond decomposition. Also support direct full-image/backdrop and prop placement on boards alongside tile grids, pulled from a unified **Asset & Tileset Viewer**.
- **New native formats use `.tkr<something>` YAML; art packs are editor-only for now (2026-11-09).** **Decided by Jensen:** any new native file formats created for TK Reawakened use a `.tkr<something>` extension (e.g., `.tkrpack`, `.tkrtile`) and are authored in **YAML**. Scene asset/art packs are **editor-only** for now: pasting an asset from a pack into a board lowers/emits standard board primitives (layer images, tiles, `.tst`/`.iso`/`.tbm` assets, and translated `solid`/`under` vectors) that `@tk-reawakened/core` already loads and renders with zero runtime engine changes.
- **Boundary intelligence (2026-11-09).** **Decided in direction** (Jensen): the board editor should derive walls from what the author already did — click the floor and wall the rest, a walkable/solid brush, tracing from tile roles, and tracing image regions. The architecture is **Proposed** in [flow 11](flows/11-tile-asset-and-board-architecture.md#7-boundary-intelligence).

## 5. Walkthrough findings: "make a village"

A paper walkthrough of a first-timer building a village with an inn, a talking person and a door exposed the following dependencies. “Designed” means an interaction is specified; **Conditional** means it depends on an unresolved asset/model/host contract. None of these exercises was a usability test with a beginner or a run of a finished editor.

| Rank | Hole | Proposed fix |
|---|---|---|
| 1 | **Content sources.** No tiles, people or sounds to start from | A licensed starter library (G6: CC0 or Bronze-or-better), plus import with grid detection |
| 2 | **Dangling destinations.** A door needs a board that does not exist | Create-on-the-fly with return door (§4.3) |
| 3 | **Who is the player, where do they start?** | A new project contains a default hero and a start board |
| 4 | **Houses and other multi-tile things** | Stamps / components early |
| 5 | **Play starts at the game's beginning** | Play from the board being edited |
| also | Where tiles are flagged solid (the tileset editor) | Right-click a tile in the palette; part of the sheet-import design |

## 6. Open questions for the owner

1. **Block storage.** Generate RPGCode text with markers, a sidecar, or native data lowered through the AST (ADR 0004)? Jensen was offered the first two ("generate RPGCode" vs "new block format") and did not choose.
2. **Auto-solid tiles:** yes or no.
3. **Isometric painting:** how walls and tile mode behave on diamond cells, including the rotated mode's invalid cells.
4. **Floors and stairs:** how a second floor or a cellar works for someone who does not know what a layer is.
5. **Components and instances:** how "edit all" versus "edit this one" is made clear; this also decides the "used in N places" tags.
6. **Board properties:** which of the many board settings (links, music, threads, battle data, ambient light, enter program) live in the panel and which in a settings page.
7. **Starter library:** what it contains and who supplies licensed art.
8. **Priority conflict:** the visual event builder is P2 in the parity list, but this design makes blocks core. See `reawakened-fit.md`.
9. **Persistence:** which authoring features require added metadata or a native format? ADR 0005 permits one but does not require one; hiding `.gam` alone is not sufficient justification. **Update (2026-11-09, Decided by Jensen):** when new formats are created, they use `.tkr<something>` extensions in **YAML**; art/scene packs (`.tkrpack` / `.tkrtile`) live in the editor layer (`editor-model` / `editor-ui`) for now and compile/paste down into existing engine primitives so the runtime engine needs no new format reader yet.
10. **Plugin editor contract:** how declarative forms and custom panels share documents, validation, undo, previews and migrations without creating separate editors per plugin.
11. **Play and legacy write:** confirm the proposed save-first/current-board actions and whether legacy writers are wanted. Earlier replies overstated these as owner decisions; this record corrects that.

## 7. Sources used in the sessions

- `rpgtoolkit/docs/editor-ux-proposals.md` (the essay) and the functional guide `rpgtoolkit/docs/architecture/editor/guide/` (legacy behaviour, secondary reference).
- Corpus census over `rpgtoolkit-archive` (see `evidence/command-census.md`).
- RPG Maker Database and Character Generator screenshots; a dotted-route screenshot (Jensen, 2026-10-16/17). Images are not stored here.
- `docs/editor-features.md`, `docs/guardrails.md`, ADR 0004 and 0005, the architecture spine, and the editor epics in this repository (see `reawakened-fit.md`).

## 8. Engagement-area direction — 2026-11-07

- **Accepted direction:** RPG Maker's clarity of purpose, VS Code's workspace flexibility, and Figma-like direct visual editing. A game maker first, with connected specialist tools and discoverable depth. Jensen's confirmation: “Sally. yes you got it.”
- **Owner-selected navigation flexibility:** game-oriented content and actual files/folders are alternative views of the same project; creators may use either or both. This does not select their panel arrangement or a new identity/storage model.
- **Owner observation:** reopened 3.1.0 was more capable than remembered, but cumbersome; settings and the project list were hard to discover behind cryptic buttons, and the board was visually busy.
- **Requested next work:** map all scenarios to engagement areas, compare legacy Toolkit capability with possible future experience, document user flows and a reusable prompt, then end the party.
- **Delivered research:** [engagement map](engagement-area-map.md), [expanded flows](engagement-user-flows.md), and [continuation prompt](engagement-design-prompt.md). These proposals do not supersede normative specs or establish implementation status.
- **Still open:** a Code - OSS/VSCodium-style workbench versus a custom workbench; focused versus full editors; database/comparison layout; testing surface; document transactions; native-format additions; plugin-editor APIs. These UX discussions did not select a workbench composition, roadmap, or feature priority. Separately, [ADR 0013](../../../docs/adr/0013-desktop-shell-electron.md) has already selected Electron as the desktop shell for the editor and player.
- **Evidence correction:** the additional Status Effect Editor screenshot supplied during this session closes that visual-coverage gap for the visible form only. Save/reopen and runtime semantics remain unverified by the capture.

## 9. UI implementation starting points — 2026-11-08

**Status: design direction, not a selected workbench composition or implementation claim.** Electron is already the selected desktop shell under [ADR 0013](../../../docs/adr/0013-desktop-shell-electron.md). [ADR 0021](../../../docs/adr/0021-monaco-code-editor.md) selects Monaco for standalone and browser code editing; its version and integration details remain open.

Jensen: “lets log these as initial places to start to build our UI. Also a settings system that is similar to vscode's might make the editors a little easier to port as well. using vscode's json schema design”

### Custom workbench candidate

- **Electron** is the selected desktop host and **Monaco Editor** is selected for standalone/browser code editing. **Dock Spawn** remains a candidate docking system. The workbench composition remains to be evaluated against the engagement flows; this is not a decision to fork Code - OSS/VSCodium.
- Keep RPG Maker's approachable game-making experience, VS Code's workspace flexibility, and direct visual editing as the purpose. Choosing components does not settle the user experience.
- Monaco supplies code editing, not VS Code's whole workbench or extension host. Project navigation, document lifecycle, commands, language tooling integration, and recovery still need deliberate integration.
- Dock Spawn remains provisional: assess maintenance, licensing and dependencies under G6, keyboard/accessibility support, resizing, layout persistence, and moving editors without losing document, canvas, or selection state.

### Shared editors, different hosts

- Preserve the ability to deliver the same game editors in a standalone application and a VS Code extension. This builds on G2, not an exception to it: shared `editor-ui` reaches host capabilities only through platform services; host packages own adapters and chrome.
- Share authoring interactions and editing logic rather than requiring identical window layouts. Standalone/browser hosts use Monaco for code; VS Code uses native text editors and may supply contributed navigation views and custom-editor webviews for visual documents.
- Do not embed the entire standalone workbench inside VS Code or maintain separate implementations of the game editors. Exact view placement and host integration remain design work.

### Schema-driven settings direction

- Explore a shared declarative settings catalogue inspired by VS Code's `contributes.configuration`: stable setting IDs, types, defaults, descriptions, constraints, and grouping. Use it to support discoverable, searchable settings controls and a JSON editing route.
- Aim to reuse definitions for standalone settings and VS Code configuration contributions, with host adapters responsible for reading, writing, and change notifications. Shared editor features consume settings through platform services, not direct `vscode` or Electron imports.
- VS Code's configuration contribution format includes its own UI metadata and scope semantics; adopting JSON Schema alone does not reproduce those behaviours. Determine the compatible subset and any mapping before promising drop-in portability.
- Keep **editor preferences** separate from **authored game data**. A personal grid-display preference must not silently become a game rule, nor should battle or startup definitions be relocated into machine settings merely to reuse a form.
- Still open: user/workspace/resource scope, precedence and reset behaviour, storage paths, JSON versus JSONC, validation and migration behaviour, extension-contributed settings, and which metadata can map unchanged between hosts.

### Proof for integration and remaining choices

Use the existing [engagement flows](engagement-user-flows.md) to prototype board/code split editing, a connected effect → move → enemy task, and moving a focused editor into a broader workspace without losing context. Add a settings rehearsal: find a preference, change it through the UI and JSON, see validation, reset it, and verify equivalent effective values in both hosts. These are proposed checks, not completed tests or new scheduled tickets.

References: [G2 host boundary](../../../docs/guardrails.md#g2--hard-package-boundaries), [Monaco decision](../../../docs/adr/0021-monaco-code-editor.md), [Monaco](https://github.com/microsoft/monaco-editor), [Dock Spawn](https://github.com/coderespawn/dock-spawn), [VS Code configuration contributions](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration). No runtime implementation audit was performed for this note.

## Key source files

- [Engagement map and evidence boundaries](engagement-area-map.md)
- [Original scenario inventory](creator-scenario-inventory.md)
- [Creator journey discussion](creator-journey-workspace-rehearsal.md)

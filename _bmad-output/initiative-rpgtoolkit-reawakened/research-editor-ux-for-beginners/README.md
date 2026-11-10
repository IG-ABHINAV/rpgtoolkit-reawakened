# Editors for tomorrow: beginner and hobbyist UX research

**Start with the [morning brief](morning-brief.md), or open the [clickable interaction study](interaction-study.html).** The HTML is self-contained: open it locally in a browser, no install or service needed. It demonstrates selected interactions, not a game engine or a production editor; session changes reset on reload.

This folder captures Jensen's design discussion and extends it through task walkthroughs: **what does someone actually do when they want to make a village, a door, a hero, a fight or animated water?** Complete authoring capability stays the goal. Common tasks get short paths; specialist work remains available.

**Broader discovery map:** the [creator scenario inventory](creator-scenario-inventory.md) explores 54 situations across creator intents, working methods, project stages and recovery needs. It reconciles the [experience bank](../../../docs/editor-experience-bank.md), these studies and current planning, with evidence and uncertainty attached. It is a discovery draft—not a golden path, UI specification, priority list or feature commitment.

**2026-11-07 party handoff:** [Engagement-area map](engagement-area-map.md) maps all 54 scenarios and the editor families to creator activities, legacy capabilities, and possible future experiences. Read the [expanded user flows](engagement-user-flows.md), then use the [design prompt](engagement-design-prompt.md) to continue. The owner confirmed RPG Maker's clarity of purpose, VS Code's workspace flexibility, and Figma-like direct editing as a direction—not a workbench composition. Game and Files views may be used separately or together. Separately, [ADR 0013](../../../docs/adr/0013-desktop-shell-electron.md) already selects Electron as the desktop shell for the editor and player.

**2026-11-08 concrete design proposal:** [Connected editors review package](../ux-connected-editors/ux-connected-editors.md) brings the flows into a cohesive workspace with ten wireframes, editor interactions, complete scenario coverage and shared-host architecture/settings design. New choices remain proposals for review, not implementation commitments.

## Read by the job

| I want to… | Study |
|---|---|
| Arrange a board like a drawing tool, with layers, tile/vector walls and Properties | [01 · Board editor](flows/01-board-editor.md) |
| Make a door, conversation, choice or quest without first writing code | [02 · Scripts and blocks](flows/02-scripts-and-blocks.md) |
| Create reusable tilesets and animated entries, use them across boards/projects, organise art and paint terrain | [03 · Tiles and art sources](flows/03-tiles-and-art-sources.md#workflow-create-a-reusable-tileset-then-build-many-boards) |
| Create people, heroes, items, equipment, starting party and inventory | [04 · Characters, items and Database](flows/04-characters-items-database.md) |
| Assign a character's look or edit animation frames and directions | [05 · Animation and looks](flows/05-animation-and-looks.md) |
| Make enemies, moves, effects, encounters and a test fight | [06 · Battle and effects](flows/06-battle-and-effects.md) |
| Start, recover, navigate, test and share a project | [07 · Project shell and sharing](flows/07-project-shell-and-sharing.md) |
| Never have to open `main.gam`, but change conventions when necessary | [08 · Project file by convention](flows/08-project-file-by-convention.md) |
| Use a battle plugin's specialist editor inside the same application | [09 · Plugin-provided editors](flows/09-plugin-editors.md) |
| Actually **make** tiles and animated regions without repetitive asset setup | [10 · Tile-making without the grind](flows/10-tile-making-without-the-grind.md) |
| See how the tile studio, asset viewer, scene-asset pasting and boundary tracing fit the packages | [11 · Tile, asset and board architecture](flows/11-tile-asset-and-board-architecture.md) |

The ten studies are indexed separately to keep related decisions readable; the shared tile import, timeline, Database and document services are not ten unrelated implementations.

**Focused task walkthroughs:** [Make a house kit, build a forest maze, and connect an NPC interaction to battle](walkthroughs-house-forest-and-npc.md). These paper exercises cover kit creation as well as placement, and expose shared/local edit scope, visual terrain versus traversability, and the unresolved battle-result continuation contract.

**Creator journey discussion:** [Workspace rehearsals and the legacy asset workflow](creator-journey-workspace-rehearsal.md) — the guard-at-the-entrance encounter from Morgan, Casey and Avery's starting points, stress-tested with Rowan and Riley, and compared with the legacy asset editors. Notes for a later team perspective round; not validated research, selected workspace modes or epic changes.

**Illustrated keepsake:** [Make the thing, not the file](party-editors-for-tomorrow/party-editors-for-tomorrow.html) — one self-contained HTML walkthrough of house kits, forest terrain, NPC battles, sight encounters, reusable RPGCode templates and the final locked chest. Original illustrations, chapter navigation and expandable contract notes; no game/editor execution or external assets.

## The working synthesis

- **Board:** left Project / Outline / Assets dock, centre canvas, contextual Properties on the right. Tiles and vertex shapes are alternate authoring tools, not a forced choice of user skill level.
- **Things that happen:** place a named Door, Person, Chest or Pickup; configure When / Then / Only if where it is selected. Generated snippets stay together under Programs, optionally grouped by board. The exact path and block metadata format remain proposals.
- **Artwork:** sheet-first drawing across tile boundaries; edit a shared tile in board context with an explicit scope; select frames to Make animated tile; one timeline for a whole waterfall region. Imports and starter packs help, but do not replace a good art-making workflow.
- **Project:** defaults work without opening the main file. Effective settings show whether a value is a convention, imported value or override. Hiding a file does not itself require a new format.
- **Extensions:** shared forms where sufficient, specialist plugin panels where needed, all using the normal document lifecycle, validation, asset references and preview services. No stock-only editor API or new trust tier is selected here.

## Authority and evidence

[Decisions](decisions.md) records what Jensen actually selected, what the room proposed and what is still open. Earlier chat used “settled” too freely. **Import-only, save-first/current-board Play, components and a native block/manifest format are recommendations or open questions—not owner-approved architecture.** No ADR, spec, ticket or production source was changed by this research.

[Architecture fit](reawakened-fit.md) maps dependencies and conflicts with existing plans. [Review resolution](evidence/review-resolution.md) records corrections following an independent review; [original findings](evidence/review-notes.md) remain as review history, not a description of the corrected state.

| Evidence | What it supports / does not prove |
|---|---|
| [Community pain points](evidence/community-pain-points.md) | Recoverability, scripting/import/linking/packaging friction and affection for flexibility. Selected historical messages are not a controlled usability study |
| [Command scan](evidence/command-census.md), [script](evidence/command-census.py) | Transition and dialogue identifiers occur frequently. Lexical detection is **not** full semantic or block-convertible program coverage |
| [Publish0x roundup](https://www.publish0x.com/lingy/some-free-alternatives-to-rpg-maker-xlqyrqq) | One reviewer explicitly calls the Toolkit unintuitive; it does not identify the exact step where they failed |
| [SourceForge reviews](https://sourceforge.net/projects/rpgtoolkit/reviews/) | One review describes the beginner learning burden; not a comparative usability measurement |
| [Editor capability inventory](../../../docs/editor-features.md) and [normative spec](../../../docs/spec/README.md) | Existing feature/behaviour coverage, not evidence that a proposed new interaction has been tested |

Legacy functional-guide citations in the studies are research motivation only. Any behaviour not already in approved repo docs must be promoted through the clean-room extraction process before implementation relies on it. No legacy source code or component artwork is included here. The HTML's geometric demonstration artwork is original.

## How to use this research next

1. Try the HTML's four studies: board selection and generated code; pixel-frame editing/playback; default/override inspection; plugin-specific panels.
2. Review the paper tasks most relevant to the editor being designed. Statuses mean **Designed interaction**, **Conditional dependency**, **Gap**, or **Verified legacy/spec fact**—never “implemented”. Older “Covered” wording means only described coverage within that paper scenario.
3. Resolve the smallest shared dependencies before writing implementation stories: document transactions, stable identity/reference handling, block source/generated ownership, and plugin authoring contributions.
4. Test the proposed tasks with real first-time creators. Measure task completion, wrong turns and recovery as well as time and clicks. No thirty-minute completion target here is a measured result.

## Verification

The HTML has been exercised in Chromium: selection-to-inspector, dialogue-to-snippet changes, geometry tool selection, painting/undo, frame duplication/playback, copy/restore, project overrides/reset and preserved edits across illustrative plugin panels. Desktop and narrow-screen screenshots were inspected. It does not test imports, generated files, engine execution, real plugin loading or publishing.

Final documentation checks and remaining limits are recorded in [review resolution](evidence/review-resolution.md).

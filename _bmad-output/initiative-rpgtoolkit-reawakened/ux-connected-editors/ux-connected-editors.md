---
status: proposal
updated: 2026-11-08
---
# Connected editors: design review

**Design proposal with a separate implementation backlog.** This package turns the recent engagement research into a cohesive possible editor experience. It includes the small specialist editors, direct code and artwork paths, failure/recovery, and a standalone/VS Code architecture—not just a board-editor makeover. Proposed layouts are not ratified architecture; the [editor delivery plan](editor-delivery-plan.md) records the subsequent owner-requested story breakdown and remaining decision gates.

## Start here

1. Open [the ten-screen wireframe atlas](wireframes.html) locally in a browser. GitHub displays HTML source rather than running it; download/open the file from this branch. It is self-contained and needs no dependencies. Only navigation links work; depicted controls are static illustrations.
2. Read [EXPERIENCE.md](EXPERIENCE.md) for editor interactions, ownership, return paths, recovery, accessibility and five named journeys. Four iteration notes explain how the first layout ideas changed after paper rehearsal.
3. Read [DESIGN.md](DESIGN.md) for the shared visual/layout grammar. Neutral wireframe styling is not approved branding.
4. Use [scenario coverage](flow-coverage.md) to trace every SC-01–SC-54 scenario to an entry, concrete outcome and F-01–F-13 flow.
5. Read [architecture.md](architecture.md) for host responsibilities, document/undo/save lifecycle, schema-driven settings, provider limits and prototype evidence to collect.
6. Read the [owner-approved connected-authoring and testing direction](connected-authoring-and-tests.md): shared tileset-browser actions, contextual runs, RPGCode unit/integration tests, and tiny component fixtures with player action lists.
7. Follow the [editor delivery plan](editor-delivery-plan.md) for the five epic breakdowns, first runnable proofs and provider gates. The [earlier editor-epic handoff](editor-epic-handoff.md) is the dated pre-inception reconnaissance, not the current queue.

## Core proposal

Find things on the left; make them in the centre; inspect or visit linked definitions on the right; open previews, timelines and test output below when relevant. These are movable regions, not rigid modes. Game and Files navigate the same project, separately or together.

The interaction that ties the suite together is a **focused visit**: open a linked asset from the current task, see its actual shared/local scope, make a change, widen to full comparison work if needed, and return without losing origin or pending edits. Independent full editors remain normal entry points.

The hardest cases are shared art changes, code/visual ownership, effect-to-encounter testing, and multi-document failures. The proposal makes those boundaries visible rather than concealing them behind a generic Apply button.

## Architecture correction carried into the research

[ADR 0013](../../../docs/adr/0013-desktop-shell-electron.md) selects Electron for desktop editor and player applications. [ADR 0021](../../../docs/adr/0021-monaco-code-editor.md) selects Monaco for standalone/browser code editing, superseding the earlier CodeMirror stack choice; VS Code retains native text editing. **Dock Spawn remains a candidate, and Monaco's version and integration, workbench composition, settings mappings and layouts remain open.** Supporting VS Code and browser hosts through shared editor UI remains the architectural direction. These choices do not claim implementation delivery.

## What review should decide

- Does this connected workshop feel like a game maker first, with deeper tooling within reach?
- Are focused visits and explicit scope enough to make related editors comfortable without burying full-editor work?
- Which compositions deserve an interactive prototype, especially shared art and effect-to-fight?
- Which settings belong to personal preferences versus authored game setup, and which scopes should be portable?

These questions are for PR discussion, not requests to pause the delivery. The proposal does not approve a new format, provider API, universal code/block round-trip, cross-document transaction or cloud sync.

## Evidence and limits

Inputs are the owner's observations/screenshots, existing editor capability documentation and synthetic research flows. This is not a fresh audit of shipped Reawakened features or a claim of observed creator usability. Proposed checks in architecture.md have not been executed against functioning editor hosts.

The atlas is an authored, static visual reference. It uses no third-party screenshots, game assets, remote scripts or installed UI libraries. Browser smoke verification checks this artifact's rendering/navigation only, not the game engine or editor implementation.

Artifact checks completed: all ten atlas navigation links exercised in Chromium/Edge; board/effect desktop layouts and a 768px stacked settings layout visually inspected, with no page-width overflow at 768px. Both Mermaid diagrams parsed with the real Mermaid parser. The coverage table contains 54 unique SC rows and all 13 F references. Local document links and anchors were checked mechanically. No game runtime or production editor tests were run for this documentation-only package.

## Art-editor reuse

The owner's follow-up asks whether existing MIT art editors can replace some custom work. [The source-checked shortlist](art-editor-reuse.md) covers miniPaint, Pixelorama and PixelCraft, distinguishes embedding from external editing, and sets concrete tile/sheet/undo/save experiments before adoption. Their top-level MIT licences are verified; dependency clearance and integration fitness are not.

## Key source files

- [Engagement map](../research-editor-ux-for-beginners/engagement-area-map.md)
- [Expanded user flows](../research-editor-ux-for-beginners/engagement-user-flows.md)
- [Reusable design prompt](../research-editor-ux-for-beginners/engagement-design-prompt.md)
- [Research decisions and settings direction](../research-editor-ux-for-beginners/decisions.md)
- [Original studies and source index](../research-editor-ux-for-beginners/README.md)
- [Editor capability inventory](../../../docs/editor-features.md)
- [Guardrails](../../../docs/guardrails.md)

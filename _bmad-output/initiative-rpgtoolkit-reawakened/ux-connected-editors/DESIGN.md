---
name: Connected Game Workshop
description: Proposed editor workbench; game-making first, specialist depth within reach.
status: proposal
updated: 2026-11-08
colors:
  surface: '#ffffff'
  surface-secondary: '#f3f4f5'
  ink: '#202124'
  muted: '#53565a'
  border: '#777b80'
typography:
  body:
    font-family: system-ui, sans-serif
    font-size: 14px
  code:
    font-family: ui-monospace, monospace
    font-size: 14px
rounded:
  panel: 4px
spacing:
  unit: 4px
  group: 16px
components:
  panel: Bordered region with a visible heading; docking belongs to the host.
  focusRing: Visible two-pixel outline, offset from the target; never colour alone.
sources:
  - ../research-editor-ux-for-beginners/decisions.md
  - ../research-editor-ux-for-beginners/engagement-area-map.md
---

# Connected Game Workshop

## Brand & Style

A proposed working name for this design, not a product rename. The owner-selected direction is RPG Maker clarity, VS Code workspace flexibility, and direct visual manipulation. This document makes that concrete without selecting a framework, theme, or host. The monochrome tokens above are **wireframe scaffolding**, not approved brand colours.

The product presents a game and the things being made, not a collection of configuration files. Files remain first-class for people who want them. It should be possible to create a tileset, effect, or program without opening a board first.

[EXPERIENCE.md](EXPERIENCE.md) owns behaviour; this document owns presentation. These proposal spines take precedence over the illustrative [wireframe atlas](wireframes.html); neither overrides normative repository specs or owner decisions.

## Colors

Use neutral framing so game art dominates. Selection, dirty state, warnings, shared scope and disabled capabilities carry text or shape as well as colour. The final theme should adapt to the host's light, dark and high-contrast themes; this atlas does not select one. Production contrast requires measurement in each actual host/theme, not inference from these wireframes.

## Typography

Plain labels before specialised terminology: **Moves**, **Effects**, **When spoken to**, **Used by**. Keep RPGCode and file paths in monospace, not entire inspectors. Allow text scaling; a long asset name wraps or expands rather than disappearing behind an icon. Put units beside numeric controls and distinguish configured values from observed test results.

## Layout & Spacing

The stable grammar is **find → make → inspect → try**, not a required sequence:

- Left: named Game, Files, Assets and search views. Game and Files can coexist; neither is a separate project.
- Centre: tabbed documents. Visual canvases, record forms, code and comparisons are peers.
- Right: selection inspector or focused related record, with explicit scope and return destination.
- Bottom: optional preview, timeline, diagnostics or test results. It opens for a task, not permanently by default.
- Top: current project, named command/search entry, save status and explicit test entry choices.

Use one visible task toolbar for the active editor rather than one toolbar for every feature. The board has labelled overlay controls and separate visibility/locking/runtime enablement. Hiding an overlay never alters the game.

Proposed desktop proportions: a roughly 220px navigator, flexible centre, roughly 280px inspector. They are starting measurements, not minimum product requirements. Closing the inspector gives space back to the canvas. Narrow-host layouts stack or reveal one region at a time with named navigation; they do not shrink fields to unreadability. Preserve DOM/focus order when the layout changes.

The atlas is a reading document, not a docking prototype: below 900px its regions stack. This proves legibility of the proposal, not production small-screen editing fitness.

## Elevation & Depth

Persistent neighbours use borders, not floating windows. A focused visit stays beside its origin when there is room. Full-editor promotion opens a document view of the same working record; a repeated click does not create another independent unsaved copy. Reserve modal decisions for destructive/conflicting choices, not ordinary asset browsing.

## Shapes

Small corner radii and visible separators express work areas. No decorative card around every field. Use grouping headings and space to communicate ownership before adding borders.

## Components

| Component | Visual contract |
|---|---|
| Document header | Name, record/file kind, dirty/saved state, ownership/scope, reachable save action |
| Context trail | Origin task plus named return link; a relationship path is not a claim about storage nesting |
| Scope banner | “Shared definition · used by …” versus a supported local instance; never offer imaginary local overrides |
| Inspector | Selection name, grouped properties, labelled advanced sections, direct related-record links |
| Collection view | Searchable list and detail; explicit Compare selection for multi-record work |
| Dependency review | Changed record, known uses, unresolved/dynamic uses, before/after consequences |
| Test strip | Mode, fixture/entry, source revision and unsaved-state policy; no generic Play ambiguity |
| Settings row | Label/help, value, effective source, override/reset affordance; schema metadata informs both forms and JSON |
| Recovery notice | What failed, what remains safe, what action preserves work; never a false “Saved” badge |
| Tool availability | Missing provider/capability explanation beside preserved data; not an empty panel |

## Do's and Don'ts

- Do show **Open full editor**, **Return to Venom Bite**, **Find uses**, and **Preview** in words.
- Do distinguish a preview image, a calculated estimate and a run of the game.
- Do let people pin side views, compare records and restore a layout without resetting documents.
- Do keep the simplest default useful without customising panels or installing extensions.
- Don't copy VS Code's icon density or RPG Maker's database wholesale.
- Don't make a universal property grid the only interface for pixels, movement, timing or relationships.
- Don't treat wireframe controls, illustrative values or example test results as functioning runtime features.

## Visual coverage

The atlas has ten concrete compositions: workspace, board, artwork, animation, database, effects, events/code, settings, delivery/recovery, appearance/audio. Each shows a different authoring problem inside the same layout grammar. Character/item/enemy/move variations, cursor details, import steps, plugin-loss states and specialist recovery states are specified in EXPERIENCE.md rather than individually mocked. Flow coverage identifies those variants; the proposal is not a pixel-complete screen inventory.

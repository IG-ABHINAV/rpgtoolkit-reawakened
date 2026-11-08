---
type: story
title: "Build workspace navigation visits and folder-aware pickers"
ticket: 4
status: draft
---

## Scope

Implement project tree open, rename, delete, refresh and collapse; external files use host-supported application dispatch; views retain context and focus, Select/Create/Open requires confirmation, references remain unresolved on cancel, and reserved-folder links include subfolders.

## Acceptance

Keyboard users can show/hide/resize panels and navigate tabs, select or create with explicit attachment, and return after origin loss without silently changing data; host capability failures are surfaced.

## Verification

Both hosts navigate one project from Game and Files, open one document from two routes, return from a linked visit, and safely copy an outside asset into its reserved folder.

## Decisions and prerequisites

11.1 chooses dock integration; contextual tileset browser and animated-tile board brush are provided by 12.2, not a duplicate browser.

Prerequisites: 11.3.

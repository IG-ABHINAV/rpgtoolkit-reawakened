---
type: story
title: "Board canvas navigation layers and tile tools"
ticket: 10
status: draft
---

# Board canvas navigation layers and tile tools

## Scope

Complete board creation, coordinate-aware canvas navigation, layer visibility and P0 tile drawing, selection, flood, erase, rectangle and dropper with basic undo and redo.

New blank/template board with coordinate system, dimensions, layers, background and remembered dialog preference; pan, wheel, zoom, grid, layer visibility/current layer; draw/select/move/copy/flood/erase/rectangle/dropper, full-grid TBM stamps, 2D and isometric snapping, reversible edits, and appropriate T-33 preferences.

## Acceptance and verification

Editing representative 2D and both isometric boards exercises snapping, visible layers, brush tools and reversible document edits without treating selection or pan as mutations.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.2, 11.5 and 4.18. The isometric compositor must exist before either isometric layout is accepted; the 2D tracer alone is not its provider.

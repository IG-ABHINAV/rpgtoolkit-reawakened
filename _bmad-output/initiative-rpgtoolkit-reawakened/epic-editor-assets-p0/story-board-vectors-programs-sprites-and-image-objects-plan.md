---
type: story
title: "Board vectors programs sprites and image objects"
ticket: 11
status: draft
---

# Board vectors programs sprites and image objects

## Scope

Implement P0 board object modes, geometry tools, overlays and full inspectors for vectors, programs, sprite placements and images with linked definitions and basic undo.

Cover vector point construction/close/open/snap/insert/delete/resume, selection, point table, subdivide and rectangles; all vector types/under/stairs/layer/order/visibility; program file or inline, triggers and conditions; sprite item, anchor, programs and conditions; image file, pixel location, layer and color key; placeholders, overlays, linked visits, basic undo and accessible alternatives.

## Acceptance and verification

A board saves and reloads each object type with its geometry, scope, links and conditions intact, and accessible edits and undo preserve unrelated objects.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 10, 3. Follow the 11.1 contract where applicable; inspect actual supported formats and correct documented provider gaps within scope under G7.

---
type: story
title: "Tile bitmap stamp and per tile shading editor"
ticket: 8
status: draft
---

# Tile bitmap stamp and per tile shading editor

## Scope

Create and edit sized tile bitmap stamps with tile draw and erase, per-cell RGB shading, grid and preview using the shared browser.

Support width/height in tiles, drawing and erasing from the shared browser, per-cell RGB −255 to +255 with hue/lightness controls and visible grid/redraw; save a whole stamp and preserve unrelated data.

## Acceptance and verification

A shaded multi-cell bitmap saves and reopens with its dimensions and tile cells intact and can be selected as a whole stamp brush.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 2. None newly identified; check the linked proposal and actual providers before implementation.

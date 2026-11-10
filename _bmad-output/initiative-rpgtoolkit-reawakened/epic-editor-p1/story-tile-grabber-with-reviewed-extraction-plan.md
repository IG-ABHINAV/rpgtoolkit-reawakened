---
type: story
title: "Tile grabber with reviewed extraction"
ticket: 4
status: draft
risk: medium
---

## Intent

Extract standard, isometric and pixel-doubled legacy 16-pixel tiles from images into a selected tileset with explicit preview and staged confirmation.

## Scope and acceptance

Support drag or accessible selection, grid and selection colours and source-key picking; keep original image intact on failure and cancellation.

## Verification

Selection and whole-image cases check grid-origin movement, half-tile offset, transparency, partial edge padding, skip-blank and skip-partial options, cancel, save, reopen and runner render.

## Dependencies and decisions

Prerequisites: 3, 2.3. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-37 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

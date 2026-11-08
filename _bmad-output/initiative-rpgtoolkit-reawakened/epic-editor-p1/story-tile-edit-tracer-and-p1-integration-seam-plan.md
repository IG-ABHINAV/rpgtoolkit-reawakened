---
type: story
title: "Tile edit tracer and P1 integration seam"
ticket: 1
status: draft
risk: medium
---

## Intent

Open a real tileset through the shared browser, edit one pixel in a shared document, save and reopen it, then paint that tile on a board while establishing the P1 feature registration seam.

## Scope and acceptance

Follow the approved entry 2 art decision before implementing this tracer; retain browser context, explicit menu and keyboard actions, existing 1-based index and writer residue; entry 1 owns registry wiring and a stable feature-registration interface for later modules.

## Verification

Both web and VS Code hosts show the saved pixel on the intended board, undo/redo and reopening preserve one document identity, and brush selection alone changes nothing.

## Dependencies and decisions

Prerequisites: 2, 2.2, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-36 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

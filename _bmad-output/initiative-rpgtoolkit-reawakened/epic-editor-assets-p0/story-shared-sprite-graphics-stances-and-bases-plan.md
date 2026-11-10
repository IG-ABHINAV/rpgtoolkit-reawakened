---
type: story
title: "Shared sprite graphics stances and bases"
ticket: 4
status: draft
---

# Shared sprite graphics stances and bases

## Scope

Build the shared character and item sprite graphics editor for stances, previews, assignment wizard, movement timing and collision and activation bases.

Support eight walk and idle directions, character battle and custom stances, ANM/GIF selection and preview, filename-template assignment, seconds-per-step and idle delay, and separate collision/activation polygons with crosshair, editable points, defaults and import; share one component without copying documents.

## Acceptance and verification

A character and an item share the same stance and polygon editing component, save and reopen distinct assets, and expose keyboard and numeric geometry alternatives.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 11.3, 11.4, 2.6 and 16.12 for animated GIF decoding. Follow the 11.1 contract and verify the existing ANM and GIF providers rather than implementing a second decoder.

---
type: story
title: "Animation frames playback and creation wizard"
ticket: 7
status: draft
---

# Animation frames playback and creation wizard

## Scope

Edit animation frames, per-frame image transparency and sound, delay and size, including image and tile composition wizards using the shared browser.

Support frame append/insert/delete/navigation/playback, per-frame image/key/sound, global delay and size; image wizard sorts and inserts, tile wizard composes 4×4 frames via the shared browser and named generated TBMs, initializes size and transparency from first frame, and preserves frame-associated data during reorder; stage until confirmed.

## Acceptance and verification

Image and multi-tile wizard results save and reopen with ordered frame-associated sound and transparency while cancellation leaves source and destination unchanged.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 2, 8, 11.1. Follow the 11.1 contract where applicable; inspect actual supported formats and correct documented provider gaps within scope under G7.

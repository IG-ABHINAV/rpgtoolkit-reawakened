---
type: story
title: "Battle background editor"
ticket: 11
status: draft
risk: medium
---

## Intent

Edit battle background image or tile bitmap, music and four separately labelled menu sounds with host-capability-aware preview and linked pickers.

## Scope and acceptance

Keep selection separate from playback, show Play/Stop/Loop where host supports it and do not claim audio preview proves battle playback.

## Verification

A BKG round-trips all six links and loads in a real battle, while preview cancellation and missing or unsupported audio are reported without mutating references.

## Dependencies and decisions

Prerequisites: 10. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-63 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

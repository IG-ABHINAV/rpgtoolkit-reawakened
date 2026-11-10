---
type: story
title: "Animated tile authoring"
ticket: 6
status: draft
risk: medium
---

## Intent

Create and edit TAN files with ordered tile-reference frames, speed and playback using the shared tileset browser.

## Scope and acceptance

Use documented speed 1–200, preserve frame order and keyboard controls; region-level synchronous animation requires its own actual provider and is not invented.

## Verification

A sequence including an empty middle frame saves and reopens with its exact frame count and speed, and its board playback advances through the actual runner.

## Dependencies and decisions

Prerequisites: 5, 12.2. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-39 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

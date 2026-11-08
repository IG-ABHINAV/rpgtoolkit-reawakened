---
type: story
title: "Board shading and lighting"
ticket: 12
status: draft
risk: high
---

## Intent

Add shading paint and light node editing, per-node colour, cast layer and explicit light-to-shading conversion on the existing board object model.

## Scope and acceptance

Provide the documented spotlight, gradient, clipped-gradient, RGB -255..255 controls, grey/zero, keyboard and numeric access; bake uses the spec and does not silently destroy source.

## Verification

A board with both light and shade saves, reopens and renders in the runner, and cancellation and supported undo preserve the editable light before an explicit bake.

## Dependencies and decisions

Prerequisites: 1, 4.13, 12.1, 12.11. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-23, T-26 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

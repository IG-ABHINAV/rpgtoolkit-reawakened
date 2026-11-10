---
type: story
title: "Explicit board coordinate and legacy upgrades"
ticket: 15
status: draft
risk: high
---

## Intent

Implement confirmed and previewed stacked-to-rotated and tile-to-pixel conversions plus pre-vector board upgrade, moving tiles and every applicable object while retaining originals.

## Scope and acceptance

Reuse and verify core pre-vector conversion; do not treat automatic read-time conversion as permission to rewrite the original; any missing coordinate specification requires docs-first evidence and ruling.

## Verification

Real legacy fixtures verify pixel positions and vectors, converted tile types, programs and shading, untouched script literals, cancel and failure preservation, and upgraded board reopen and runner rendering.

## Dependencies and decisions

Prerequisites: 14, 2.8, 2.16. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-30, T-31 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

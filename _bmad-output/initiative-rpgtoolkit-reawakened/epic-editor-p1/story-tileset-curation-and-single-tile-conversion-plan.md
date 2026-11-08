---
type: story
title: "Tileset curation and single tile conversion"
ticket: 5
status: draft
risk: high
---

## Intent

Provide staged two-set curation, single-tile conversion and safe impact disclosure for indexed legacy tile references.

## Scope and acceptance

Work on copies until OK, warn that changed indices affect references and show known and unknown dynamic references; never promise a safe reorder merely from static references; use 12.2 browser rather than another model.

## Verification

Tests cover wildcard GPH import, export, duplicate removal, insert/delete/blank/move/reorder, display width, supported TST and ISO transfer directions, cancel and reopened rendered indices.

## Dependencies and decisions

Prerequisites: 4. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-38 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

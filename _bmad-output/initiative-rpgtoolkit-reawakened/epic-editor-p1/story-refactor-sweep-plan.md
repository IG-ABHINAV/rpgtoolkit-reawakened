---
type: story
title: "Refactor sweep"
ticket: 18
status: draft
risk: medium
---

## Intent

Remove duplication and address cleanup findings from the completed P1 entries without adding deferred feature scope.

## Scope and acceptance

All earlier stories are prerequisites; new feature scope belongs in a new story rather than being hidden here.

## Verification

Review maps each change to completed work and focused regression cases exercise affected document, browser, board and asset seams.

## Dependencies and decisions

Prerequisites: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; CAP-16 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

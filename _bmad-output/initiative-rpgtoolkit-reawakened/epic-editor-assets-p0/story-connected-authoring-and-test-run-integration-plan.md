---
type: story
title: "Connected authoring and test run integration"
ticket: 12
status: draft
---

# Connected authoring and test run integration

## Scope

Connect board placements, character and item definitions, artwork, programs and run actions using shared visits and explicit save and revision boundaries.

Use foundation focused visits and pickers for select/create/open with confirmation and return; distinguish local placements from shared definitions and unknown uses, refresh views of one authored document, keep running games revision-fixed, and distinguish preview, board test and normal startup.

## Acceptance and verification

A creator visits and edits a placed item's linked definition and program, returns to the original board selection, saves and runs the chosen board or normal game with the correct revision.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 3, 5, 6, 7, 8, 11, 11.8, 11.9. None newly identified; check the linked proposal and actual providers before implementation.

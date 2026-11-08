---
type: story
title: "Board edit save and render tracer"
ticket: 1
status: draft
---

# Board edit save and render tracer

## Scope

Open a small authored board, change one tile, save and reopen it through the shared document lifecycle, and present it using the core board compositor in both web and VS Code hosts.

Use the 11.2/11.3 shared model, one document per URI, host-owned save and undo, and the public AD-29 compositor; preserve unknown board data and report unsupported versions rather than upgrading.

## Acceptance and verification

A host-conformance proof observes the changed tile after save and reopen in each host and compares its compositor output with the matching engine view.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 11.2, 11.3, 2.5, 4.14. Follow the 11.1 contract where applicable; inspect actual supported formats and correct documented provider gaps within scope under G7.

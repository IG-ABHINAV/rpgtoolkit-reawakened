---
type: story
title: "Package game and install descriptor"
ticket: 9
status: draft
---

# Package game and install descriptor

## Scope

Provide a host-capability-aware packaging workflow over the existing distribution writer that outputs a playable TPK and sibling install descriptor with explicit preflight and exclusions.

Reuse canonical writer and package reader with manifest schema/main/index and sibling descriptor; expose preflight, file list, revision and destination, enforce existing untrusted-input limits and explicit test-only exclusion, surface host capability and failures; never write an EXE or claim setup/signing.

## Acceptance and verification

A freshly authored saved project produces a valid package and descriptor, rejects unsafe or incomplete inputs, excludes test-only material, and boots the produced archive in the web runner without folder access.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 11.1, 11.3, 11.4, 9.7. Follow the 11.1 contract where applicable; inspect actual supported formats and correct documented provider gaps within scope under G7.

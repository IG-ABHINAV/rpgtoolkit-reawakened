---
type: story
title: "P0 author to packaged game acceptance"
ticket: 14
status: draft
---

# P0 author to packaged game acceptance

## Scope

Prove the complete P0 creator journey from a new game through all P0 editors to a packaged playable web-runner game in both editor hosts.

Create and configure a new project independently in each supported host, author board, character, item, animation and tile bitmap and script, save and reopen, package via 12.9, then boot and interact with those exact package bytes in the web runner; exercise error paths and accessible routes, and hand the same proof to Epic 15 for desktop.

## Acceptance and verification

A fresh authored game created independently in VS Code and PWA survives save and reopen, uses every P0 asset editor, packages successfully and plays the actual output in the web runner.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.13, 11.6, 11.7, 11.8, 11.10 and 9.16. The new-project wizard must exist before this fresh-project journey. Desktop consumes this proof in 15.10.

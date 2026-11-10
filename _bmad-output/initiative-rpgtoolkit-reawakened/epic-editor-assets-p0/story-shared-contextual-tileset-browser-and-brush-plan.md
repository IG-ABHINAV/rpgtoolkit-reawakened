---
type: story
title: "Shared contextual tileset browser and brush"
ticket: 2
status: draft
---

# Shared contextual tileset browser and brush

## Scope

Provide one retained-context browser and targetable brush selection for boards, tile bitmaps and animations with accessible explicit source-edit and brush actions.

Keep last active editor and browser selection/scroll despite focus changes; offer visible default plus keyboard and context-menu actions, no broadcast, no source mutation on selection, and an explicit unavailable P1 source editor action.

## Acceptance and verification

Switching boards preserves browser selection without painting, targets only the active board, exposes both keyboard and menu actions, and explains unavailable source editing until the P1 provider exists.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 1, 11.4. None newly identified; check the linked proposal and actual providers before implementation.

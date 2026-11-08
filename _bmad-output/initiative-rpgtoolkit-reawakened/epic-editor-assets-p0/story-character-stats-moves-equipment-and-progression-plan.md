---
type: story
title: "Character stats moves equipment and progression"
ticket: 5
status: draft
---

# Character stats moves equipment and progression

## Scope

Author character identity, stat bindings, profile, special-move unlocks, equipment and level growth with shared sprite graphics and connected references.

Cover all starting stats and explicit variable bindings, profile image/tile/bitmap, up to 200 moves and unlock rules, equipment slots and accessory names, and level thresholds, growth and program; never regenerate bindings on display-name change.

## Acceptance and verification

A character with nondefault bindings, move rules, equipment and growth saves and reopens without changing unrelated legacy fields or regenerating bindings on rename.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 4. None newly identified; check the linked proposal and actual providers before implementation.

---
type: story
title: "Enemy definition editor"
ticket: 9
status: draft
risk: high
---

## Intent

Edit enemy stats, standard and custom battle stances, move strengths and weaknesses, AI or program, run and defeat programs, critical chance and rewards using shared sprite and linked-asset services.

## Scope and acceptance

Use 12.4 sprite stance editing without inventing character-only battle geometry on enemy data; add-to-game opens the actual encounter-pool owner, and old text versions require same-version writer evidence or an explicit owner ruling.

## Verification

A representative enemy is edited, navigated from an encounter, saved, reopened and loaded by the real battle provider with unedited fields and residue intact.

## Dependencies and decisions

Prerequisites: 1, 2.6, 11.3, 11.4, 11.6, 12.4. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-56 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

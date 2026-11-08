---
type: story
title: "Expanded board clipboard"
ticket: 13
status: draft
risk: medium
---

## Intent

Add copy, cut, paste and select-all for tile and shade regions and whole vectors, programs, sprites and images to the existing board commands.

## Scope and acceptance

Use platform-services clipboard and AD-19 command ownership; P0 already owns basic board undo, so do not replace it or claim cross-document atomicity.

## Verification

Every supported selection survives copy and cut/paste with undo/redo and reload, while partial point sets and lights are explicitly rejected without mutation.

## Dependencies and decisions

Prerequisites: 12, 12.11. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-28 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

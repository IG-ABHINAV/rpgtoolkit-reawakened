---
type: story
title: "Special move and status effect editors"
ticket: 10
status: draft
risk: high
---

## Intent

Edit linked SPC and STE definitions including use contexts, signed damage and costs, status duration and changes, programs, animation and descriptions.

## Scope and acceptance

Follow battle-data.md for raw usable-byte mapping and avoid claims about unspecified zero-duration or plugin-specific rules; preserve unsupported provider data.

## Verification

Each format opens, edits, saves, reopens and loads through the chosen real battle provider with correct inverted usability flags, signed values and preserved untouched fields.

## Dependencies and decisions

Prerequisites: 9, 2.7. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-57, T-58 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

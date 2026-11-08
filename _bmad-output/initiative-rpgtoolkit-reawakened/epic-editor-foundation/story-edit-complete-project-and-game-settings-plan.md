---
type: story
title: "Edit complete project and game settings"
ticket: 6
status: draft
---

## Scope

Cover all fields in editor-features T-10–14 including physical bindings and conflicts, 50 runtime keys, cursor hotspot/key, pathfinding, enemy pool and encounter mode, display/debug colors and plugin/menu/battle choices; distinguish effective and owning sources and use the existing `audioSettings.defaultSoundFont` persistence contract.

## Acceptance

Apply stages a document edit, Save persists and Cancel leaves unchanged; unavailable plugin data survives and no code is enabled silently; unsupported legacy values and version loss are disclosed.

## Verification

Both hosts edit and reopen representative fields in every T-10 through T-14 category while preserving unknown data and a runner loads the resulting project.

## Decisions and prerequisites

The project SoundFont uses `audioSettings.defaultSoundFont` in `docs/spec/formats/main-file.md#tkr-audio-settings-extension`; the existing reader/writer already owns its nullable and residue-preserving encoding. 11.1 may settle UI scope and ownership, not choose a competing persistence home.

Prerequisites: 11.3, 11.4 and 21.2 (the existing game-file audio-settings reader/writer and boot contract).

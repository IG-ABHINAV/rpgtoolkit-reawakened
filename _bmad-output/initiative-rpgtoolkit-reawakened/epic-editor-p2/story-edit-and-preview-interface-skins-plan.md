---
type: story
title: "Edit and preview interface skins"
ticket: 4
status: draft
risk: medium
---

# Edit and preview interface skins

## Scope

Implement window and button graphic authoring against the exact document and preview semantics approved by 14.1. The existing `.gam` `skinButton` and `skinWindow` fields are legacy data ignored by the engine, not evidence of a working runtime skin consumer.

Preserve unknown format residue and save version; selection or preview is not an edit, and failed saves retain the draft.

## Acceptance and verification

Both hosts open, change, save and reopen a skin retaining other fields and show the changed window and button graphics without claiming full-screen layout editing.

## Dependencies and decisions

Requires 14.1, 11.3 and 11.4. Do not start until 14.1 names persistence and preview ownership and pins any required runtime provider; preserve legacy data and distinguish an editor-only preview from gameplay support.

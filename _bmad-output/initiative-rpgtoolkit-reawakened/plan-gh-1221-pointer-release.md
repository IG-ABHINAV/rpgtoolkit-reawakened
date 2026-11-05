---
title: 'Release button slots on the same target'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'built'
baseline_revision: '7d5b874610a7e5f066c68dc3d8b620bd228bedb3'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pointer presses activate on-screen button slots immediately, preventing cancellation.

**Approach:** Activate once on primary-button release over the enabled slot pressed, preserving cancellation and snapshot determinism. Keep board movement behavior intact. Implement from ACT-4, ACT-8 and A11Y-6 without consulting legacy source.

</frozen-after-approval>

## Implementation Notes

Oneshot: the change is focused on a single input path and its save migration and regression tests.

The primary press identity cannot be recovered from `pointer.downX/downY`: another button press overwrites those coordinates. Schema 4 saves the nullable slot id; version 2 and 3 inputs migrate with no pending press. The normative contract was committed separately before implementation.

## Plan Change Log

## Review Triage Log

Quick independent review: no findings.

CI-repair review: the reviewer questioned whether the pending slot should be hashed. It changes the next release's outcome and is saved state, so including it is required for deterministic replay. Added an otherwise-identical state/hash comparison and restore check; the reviewer confirmed that addition. Replacing the release with a second press, restoring an old corpus pin, and making the compared pending slots equal each made its respective test fail; all perturbations were restored.

## Verification

Focused input tests exercise release, cancellation, disabled targets, focus loss, unrelated buttons and save/restore. Golden, closing and save/load checks passed. Normalizing the two new battle saves back to schema 3 produced the exact previous fixture bytes; recorded closing and epic-8 outputs differed only in state hashes, while scripted and actor/audio recordings changed only hashes. Save/load changed four hashes and its byte length.

CI repair: the blocked-script integration test now checks no queue entry on press, exactly one on release and no movement. All ten fetched-corpus states have a null pending slot; after removing it and restoring input schema/version 3, their computed hashes reproduce all ten previous pins exactly. The updated hashes therefore reflect the saved input shape, not a changed corpus outcome.

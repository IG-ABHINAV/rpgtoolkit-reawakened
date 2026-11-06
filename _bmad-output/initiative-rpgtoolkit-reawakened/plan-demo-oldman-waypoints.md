---
title: 'Correct demo old man waypoint movement'
type: 'bugfix'
ticket: ''
created: '2026-11-05'
status: 'in-progress'
baseline_revision: 'daccf697825f1629b64f42990bc3cbfd85cded47'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The demo's old man follows a direct path through walls instead of the authored linked patrol because movement flags are not applied correctly.

**Approach:** Restore documented symbolic constants and movement flag semantics, then exercise the real game and collision behavior with regression coverage.

</frozen-after-approval>

## Implementation Notes

Oneshot: a focused fix to existing constant and movement handling plus regression coverage.

The lexer now substitutes every documented constant. Movement flags match their documented numeric values; pathfinding produces collision-aware path moves and queue clearing is honored. The real demo's corrected patrol exposed a separate E-43 issue: item activation was checked only at step completion even when the moving player already intersected an item. Item checks now run while moving without changing board-region timing. Issues #1605 and #1606 track the defects.

Focused Bun suites: 187 passed. A real-engine, authored-main demo smoke rasterized the old man's actual tileset frames at ticks 69 and 189; his displayed sprite moved 28 pixels and changed animation frame. The demo fixture has no original main file.

## Plan Change Log

## Review Triage Log

## Verification

Run focused script and engine tests, and smoke the demo's rendered patrol.

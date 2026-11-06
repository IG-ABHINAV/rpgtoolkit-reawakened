---
title: 'Correct script animation source dimensions'
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

Script animations must sample the actual decoded picture or tile cell rather than the animation header dimensions. Both ordinary and pinned animations retain their existing destination, colours, compositing and GIF surface semantics; save state remains unchanged. Real-engine authored PNG and tileset regressions prove the source, destination, pixels and a later command surviving rasterisation.

</frozen-after-approval>

## Implementation Notes

One-shot: a focused rendering change using existing texture and cell-size resolvers. The spec is clarified first because tile-frame sizing distinguishes sprite placement from script-animation destinations.

Resolved source dimensions from decoded pictures and tile cells in both ordinary and pinned draws; GIF frames retain their surface dimensions. Tile-bitmap frames request images and wait for their composed pixels, including every cell dependency.

## Plan Change Log

## Review Triage Log

- Medium, patched: cached tile bitmap bytes were considered ready before their composed image's tile dependencies arrived. The engine now prepares animations before ticks and waits until composition succeeds; #1321 tracks the discovered defect and the multi-dependency regression proves it.
- Medium, patched: an unrelated fade terminal-tick assertion was accidentally replaced; restored the assertion.
- Follow-up independent review found no further issues.

## Verification

Run the focused engine tests, inspect individual durations, and exercise ordinary and pinned paths. Preserve goldens and save fields.

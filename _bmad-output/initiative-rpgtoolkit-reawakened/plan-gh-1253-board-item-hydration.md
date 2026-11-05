---
title: 'Hydrate board item sprites on entry'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'built'
baseline_revision: '7d5b874610a7e5f066c68dc3d8b620bd228bedb3'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['independent']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Load each arriving board's item definitions, create the corresponding sprite state, start eligible item-owned multitask programs and make the authored activation program and appearance available. Board program overrides take precedence over the item file. Preserve player and board transition behavior; the owner authorized the narrow item-thread `source` resolution in shared movement dispatch but excluded #1298 pixelmovement semantics.

## Boundaries & Constraints

**Always:** honor loading conditions and G1–G7; retain item slot identity and tear down old board item threads on transition.

**Never:** inspect GPL source, change #1298 semantics, or silently narrow the acceptance proof.

</frozen-after-approval>

## Code Map

- `packages/core/src/engine/engine.ts` loads active boards, resolves assets and installs sprites in `arrive`.
- `packages/core/src/sprites/model.ts` and `runtime.ts` derive item state and item-owned threads.
- `packages/core/src/triggers/runtime.ts` activates board item programs against runtime sprite geometry.
- `packages/core/test/board-item-hydration.test.ts` drives authored bytes through the engine.

## Tasks & Acceptance

- [x] Request and parse item definitions before arriving, instantiate their item sprites and start their multitask programs without replacing players.
- [x] Apply board program overrides with item-file fallback and preserve separate placement identities.
- [x] Given an authored board with an item, when the engine boots, then its sprite, animation and thread are present and an activation input runs its program.
- [x] Given a board transition, when an old board is left, then its item threads stop and the new board's items are installed.
- [x] Verify against the real demo and run focused tests, smoke and independent review; document provenance, review and outstanding decisions in the PR.

## Implementation Notes

Issue #1324 tracks duplicate placement identity and recovery concerns discovered during implementation.

The owner authorized the narrow shared movement alias edit; #1298 pixelmovement behavior is unchanged. The real demo test follows its wandering oldman and observes `oldman.prg` starting.

## Plan Change Log

## Review Triage Log

Independent review found and prompted fixes for item-thread teardown, source alias resolution, loading-variable normalization, runtime binding and ordinary-load rebinding. A follow-up review found no remaining evidence-backed blocking findings. #1324 tracks legacy duplicate-ID save recovery; #1327 tracks runtime ownership and is addressed by this branch.

## Verification

Real-engine authored asset and input tests; demo probe; focused tests, typecheck, and independent review.

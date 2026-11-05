---
title: 'Render animated GIF sprite frames'
type: 'bugfix'
ticket: ''
created: '2026-11-05'
status: 'built'
baseline_revision: '568618127a43c82484c2ea138b0bc53ca46aa60a'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Animated GIF files used for sprite walk or idle animations must draw the current decoded page rather than a marker. Frame changes, transparency and the presented pixels must work for both character and item sprites, without changing existing binary animation behavior.

## Boundaries & Constraints

**Always:** follow G1–G7; derive behavior from `docs/spec/formats/animation.md#animated-gif` and `docs/spec/engine/plugins-and-battle.md#e-54`. Preserve deterministic drawing, surface lifecycle, save/load and reset correctness. Use existing animation decoding.

**Never:** inspect GPL source or modify #1298 pixelmovement semantics. Coordinate shared-file overlap with #1253 and #1298.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Character GIF | Two visually distinct pages on a walk/idle animation | Current page is named in draw list and rendered with correct pixels | Existing missing/invalid asset diagnostics remain |
| Item GIF | Multiple sprites share a GIF | Both render current page correctly without invalidating each other | No leak or stale resources on lifecycle changes |
| Save or reset | Cached GIF sprite data across state replacement | Reconstructed draw source remains valid and deterministic | Never reference missing/stale surface |

</frozen-after-approval>

## Code Map

- `packages/core/src/engine/engine.ts`: `decodeSpriteAnimation`, `requestSpriteFrameAssets`, `spriteFrameFor`, state replacement and draw preparation; GIF decoding already returns `gifPixels` but rejects those frames.
- `packages/core/src/render/animation.ts`: shared animation decoder and script-owned GIF page surface handling; reuse decoding, not script lifetime ownership.
- `packages/core/src/render/compose.ts`: `SpriteFrame`, `emitSprite` currently only name asset/tile sources; draw commands support surface references.
- `packages/core/test/sprite-artwork.test.ts`: authored character boot and pixel inspection helpers; extend for real GIF pages and lifecycle.

## Tasks & Acceptance

- [x] `engine.ts`, `render/compose.ts` — provide page pixels as replayable sprite frame sources with stable ownership and restoration; retain existing tile and texture rendering.
- [x] `sprite-artwork.test.ts` — authored two-page GIF character test names correct source and checks presented frame pixels; test shared sprite and state lifecycle as appropriate.
- [x] Given a character with a two-page GIF, when its animation advances, then both distinct pages render at correct times and no marker rectangle appears.
- [x] Given a shared GIF and state lifecycle, when rendering after save/load or reset, then references remain valid and correct without resource growth.
- [x] Run focused tests, real-path smoke, typecheck/lint and golden as appropriate; independent review and documented PR.

## Implementation Notes

GIF page textures use private content-derived keys and the existing picture-pixel port, not saved surface IDs. The live web texture provider consults that port even when no corresponding package bytes exist. The repository's FNV-1a 64-bit convention has a theoretical collision risk; see PR.

## Plan Change Log

## Review Triage Log

Independent review identified a surface-ID cache collision on reset/load; the implementation changed to content-derived picture keys. The pre-existing general surface cache issue is #1365. A second review found live texture lookup skipped generated pages; the provider and a real-engine integration test were added. Final independent review reported no remaining findings.

## Verification

46 focused core and runner-web tests passed; both GIF tests ran under one second individually. `pnpm golden`, TypeScript build, core test typecheck, and ESLint on changed TypeScript passed.

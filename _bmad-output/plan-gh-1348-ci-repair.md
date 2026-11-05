---
title: 'Repair board-item hydration CI'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'built'
baseline_revision: 'bb38b98b4f7e8f832b07bfff525642bcc222e1b8'
route: 'oneshot'
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

Repair #1348's failing CI while preserving real board-item behavior and meaningful regression evidence. Compare old and new state, drawing and pixels against authored game assets; update baselines only for changes proven intentional. Fix missing test fixtures or actual regressions rather than accepting broken output. Do not inspect GPL source or touch the other worker's #1254 work.

</frozen-after-approval>

## Implementation Notes

Existing CI run 41971025852 reports consistent demo board state and draw changes across runtimes; S-01 and S-01c pass exactly. The earlier missing-S-01 hypothesis concerned an older state and does not describe this run. Preserve other scenes and games. Worktree ownership was confirmed with render-bugs.

Compared independently captured runs at common ancestor 7d5b874610a7e5f066c68dc3d8b620bd228bedb3 and PR head bb38b98b4f7e8f832b07bfff525642bcc222e1b8, using the same assets and plan. Before tick 90 the title is unchanged. At tick 90 the new state adds the authored `item/oldman.itm` at (214,300), its handle and item thread, six requests and the inline `itempath` effect; the remaining changed fields are the resulting surface, VM effect/global and thread data. At tick 120 and 600 all 122 existing draw commands remain and 25 are added: the old man's `tiles/char.tst` tile 41 at (198,332) and 24 foreground occlusion strips. Exactly 330 pixels differ in rectangle (202,332)–(226,351), within that sprite. The old man is visible in the reviewed board PNG. The closing harness intentionally uses a no-op sprite effect applier, so the `itempath` effect does not make him wander there; the real-runtime demo test separately covers movement and activation.

An initial comparison with current main included 108 unrelated title pixels changed by merged #1272. Repeating against the PR's actual common ancestor eliminated that unrelated difference; no title baseline is changed here. Only demo state/draw hashes and its board PNG are updated.

After #1336 and #1332 merged, compared the integrated engine against main `6a363da5938b98f0764802a8d522741912e972c0`, with the same fixtures and closing plan. Tick 30 and 60 states and the title draw/pixels are unchanged. At ticks 90, 120 and 600 the differing fields are item sprite/handle, six asset request IDs, surface pixels/revision, and the item-owned VM thread, effect and global. At ticks 120/600 all 122 prior draw commands remain; the 25 added commands are the same old-man tile and occlusion strips. The 330 differing pixels remain entirely inside (202,332)–(226,351). Thus the mainline movement state hashes were deliberately combined with the previously reviewed item rendering; no other game baseline was edited.

The merge keeps `state.world.movement` when replacing the board and passes the item thread ID to sprite effects while using the runtime movement mode. A real-engine test makes a hydrated item thread select itself and move exactly eight pixels after setting pixel pushing; the recovery test resumes an item program and checks every restored movement-default case remains intact.

## Plan Change Log

## Review Triage Log

Independent quick review found no actionable findings; it checked the captured state, draw list, image and unchanged baseline consumers. CI and publication were outside that static review.

Two independent reviews of integration head `80eaea341202fbfbb7986bca2c7d78a072df941b` found and prompted fixes for: (1) resolved item keys not matching authored recovery slots (#1381), (2) item `sourceHandle()` keys not accepted by item commands or explicit child-program context (#1382), and (3) the special script global `__proto__` lost while copying loading variables (#1383). The new real-engine tests failed before the fixes and passed afterward. The checkpoint test also exposed existing ledger rejection of the documented signed `-1` item reserved field (#1384); the real hydrated board now checkpoints and resumes its item program. Source identity uses the already-required authored slot value, with no ledger schema change.

The identity fix changes only four state fields relative to the prior integrated demo capture at ticks 90/120/600: the item's `id` and `source` and its thread's source/target. The old-man filename now remains `oldman.itm` rather than the resolved asset key. All title/board/later draw lists and RGBA buffers are byte-identical to the earlier reviewed capture; only the three corresponding state hashes were deliberately updated.

## Verification

Focused real-demo item activation passed; `node --test packages/runner-headless/test/closing.test.ts` passed all six tests, including extra-settled-request coverage; Node and Bun closing each matched all eight baselines with batches 600/30/7; five selected browser files passed all eight tests, including the six previously failing paths. Existing CI run 41971025852 demonstrates the old state/draw/pixel baselines detect this changed behavior.

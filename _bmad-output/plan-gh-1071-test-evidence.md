---
title: 'Make test evidence falsifiable'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'built'
baseline_revision: '568618127a43c82484c2ea138b0bc53ca46aa60a'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Evidence tests can pass when the behavior they claim to prove is removed, historical references can drift, and scratch-only experiments cannot be rerun.

**Approach:** Establish a review rule requiring a demonstrated negative perturbation for each new evidence test, preserve independently checked historical behavior, and apply the rule to #1055's hash projection and extra settled boot-request evidence. Commit reusable proof rather than scratch-only claims. Follow the owner's #1068 disposition when a literal duplicate request is unreachable.

</frozen-after-approval>

## Implementation Notes

One-shot: apply an explicit review rule and focused protections to existing evidence tests without changing runtime contracts or goldens.

Tracking issue: #1071. The `ticket` frontmatter is intentionally empty because this is a loose plan, not a ticket-tree entry; the plan template reserves it for a tree entry or leaf stem.

The pre-#1047 projection at `5080d940^` retained both the request counter and all screen surfaces. Fixed, compact vectors preserve that exact projection independently of the current optimized hash and mutable game-state defaults.

#1068 was closed as not planned after the owner accepted the reachable extra distinct program request in place of an impossible normal duplicate-main-key request. The committed core and eight-game closing tests exercise that real case; they do not prove the extra request occurred for games that stop before reaching a board. Their actual assertion sensitivity is checked by restoring the old counter-hashing behavior, rebuilding consumed dist, and observing both tests fail before restoring.

## Plan Change Log

## Review Triage Log

- Medium, patched: the fixed oracle fixture initially omitted script surface `-1`; added both screen surfaces and verified an isolated removal of `-1` fails.
- Medium, patched: initial review snapshot lacked the results below; recorded actual red/green outcomes and limitations.
- False: empty `ticket` frontmatter does not create an untracked BMAD ticket; this is a loose plan for existing GitHub issue #1071, and the rendered template explicitly requires an empty value outside the ticket tree.
- Independent delta review found no remaining issue.

## Verification

- Fixed-vector test: `pnpm dlx node@24.21.0 --test --test-name-pattern='pre-1047 projection' packages/core/test/surface-hash.test.ts`. Temporarily dropping only the old projection's counter failed `282dce3445b8ff5a != 90a6b9c5d3e5a4bf`; dropping only screen `-1` failed `c5b339e4bbc65125 != 90a6b9c5d3e5a4bf`. Restored: 1 passed, 0.99 ms.
- Settled-request tests: after temporarily reintroducing `engine.nextRequestId` into the production hash, `pnpm build && pnpm dlx node@24.21.0 --test --test-name-pattern='extra settled boot request' packages/core/test/engine-boot.test.ts packages/runner-headless/test/closing.test.ts` failed both specific equality assertions, including the demo closing state hash. Restored and rebuilt: 2 passed, including all eight committed records, with the closing test taking 15.8 s. The test explicitly documents why eight full replays exceed one second.
- `pnpm typecheck`, `pnpm lint`, `pnpm provenance`: passed. Fixture fetch and build succeeded; no golden was rewritten.

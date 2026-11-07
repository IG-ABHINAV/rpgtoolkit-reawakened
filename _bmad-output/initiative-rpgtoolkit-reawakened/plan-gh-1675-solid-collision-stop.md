---
title: 'Stop blocked actor steps and stale-position jitter'
type: 'bugfix'
ticket: '#1675'
tracker_id: '#1675'
created: '2026-11-07'
status: 'built'
baseline_revision: '8f840e65'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-core', 'quick-oracle']
review_loop_iteration: 0
context: ['{project-root}/docs/guardrails.md', '{project-root}/docs/spec/engine/movement-and-collision.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A direct sprite collision leaves the player's in-flight step active, so after NPC dialogue the player cannot accept another direction and repeatedly freezes the NPC. Actors also retain stale previous coordinates on stationary simulation ticks, causing visible interpolation jitter.

**Approach:** End a directly blocked step at its last safe position regardless of whether the obstacle is a wall, solid item or actor. Advance interpolation history once per movement tick, including cadence, frozen and idle ticks, while retaining ordinary interpolation during actual movement. Preserve existing collision priority, freeze duration, script ownership and path diversion/wait contracts.

**Owner decisions (2026-11-07):** “The steps should be stopped if the space in front is now occupied by a solid item. This includes any walls, other actors, items....” Use a separate actor-fix PR, not Save/Load PR #1669. No dialogue-specific cancellation or input override.

</frozen-after-approval>

## Implementation Notes

One-shot: the expected production change is approximately 20 lines in the existing movement owner, plus focused behavior regressions under 80 lines. Medium risk because collision completion and prior-position state participate in deterministic replay. Issues #1675 (collision) and #1674 (jitter) track the independently observed defects.

Baseline investigation used the real fetched demo package and no legacy engine source. It reproduced the screenshot's player position (309,278), NPC (313,293), a finished conversation with no VM block and a still-active southward step. A stationary NPC retained prev (309,293); emitted draw destinations changed as alpha advanced and jumped back on wrap.

Document the owner collision amendment and interpolation lifecycle in their own commit before implementation (G7). Keep existing deterministic route diversion/wait behavior; blocked direct steps must complete without reporting successful step distance. Reuse existing movement and rendering APIs and regression helpers. No changes to public data shapes, Save/Load policy, mobile CI, or unrelated pending work.

Implemented the collision stop in the movement owner after loser selection, preserving frozen/queue behavior. Prior-position history advances only when stale, without allocating a replacement on already-stationary ticks. Updated the independent authored oracle and regenerated its collision cases: a new explicit attempt, rather than the old stuck step, is now required to refreeze a thawed NPC. Docs-first commit: `4123c8e3`.

Both new regressions failed on the baseline for the guarded behavior and pass with the fix; individually they run in milliseconds. The real package probe moves the player from (309,278) to (309,214) after dismissing dialogue and advances the NPC's patrol. The actual Electron renderer was also exercised through controlled fixed-tick input replay: the same player retreat succeeds, the NPC's drawn position changes from (329,293) to (330,285), the message closes, diagnostics remain empty, and stationary actor destinations are identical at alpha 0, 0.25, 0.5, 0.75 and 0.99.

Verification completed: 3486 strict tests passed with zero skips; typecheck, lint, provenance (0 violations), authored-fixture reproducibility, Node golden/closing and Bun golden/closing passed. All eight closing baselines remain unchanged. Two independent same-model-level review slices reported no findings.

Final integration gates also passed: script dogfood baselines, command-docs validation and dependency graph (0 violations). No script baseline or golden changes were needed.

Perturbation proof after implementation: retaining the initiating active step instead of completing it, and retaining stale `prev` instead of advancing it, both compile but make their respective new regression fail (active move versus null; rendered x [40,42,44] versus [44,44,44]). Restoring both guards and rebuilding gives 2/2 focused passes in 2.834 ms and 1.234 ms. No perturbation remains.

## Plan Change Log

## Review Triage Log

- `quick-core`: no findings after reviewing collision ordering/completion, queue/freeze semantics, history lifecycle and behavioral regressions.
- `quick-oracle`: no findings after reviewing the owner amendment, independent oracle, regenerated facts and fresh-attempt refreeze case.
- Additional security and UX lenses were skipped: no public API, host permission or UI control changes.

## Verification

- Run focused movement regressions before implementation: solid item/actor interruption and stationary-alpha cases must fail on the baseline.
- Run focused movement/input/render regressions, typecheck and lint after implementation.
- Exercise the actual demo package: dismiss NPC conversation, retreat with held input, observe player displacement and NPC patrol recovery; inspect emitted draws across alpha wrap.
- Run strict unit tests, provenance and deterministic golden/closing gates. Explain any intentional fixture changes rather than blindly recording them.
- Independently review the final diff against owner intent; commit and prepare the separate actor-fix PR.

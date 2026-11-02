---
title: "Consume cursor-map navigation keys once"
type: bugfix
ticket: ''
created: '2026-11-02'
status: in-progress
baseline_revision: 4fd37fcbbbb540871eae4e41c2a5fec3547c2bc2
route: oneshot
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - docs/guardrails.md
  - docs/spec/engine/display-input-audio.md
  - docs/spec/engine/rpgcode-functions.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A queued arrow key remains unclaimed while `cursorMapRun()` stays blocked, so later waits phases repeatedly apply the same key and move the selection again.

**Approach:** Consume each recognized queued cursor-map key sequence once while leaving the runner blocked until selection. Specify this behavior before code and prove it through the engine's real key-input path.

</frozen-after-approval>

## Implementation Notes

One-shot is appropriate: the defect has a single resolver/claim cause and a focused engine regression; the implementation is a small wait-result plumbing change with no architecture or public API expansion.

- Added the normative cursor-map key-consumption rule before runtime code in `docs/spec/engine/rpgcode-functions.md#reawakened-cursor-map-runner`; committed as `acf90815`.
- `pollCursorMapKey` now reports a claimed navigation sequence without resolving the wait; `resolveWait` applies the shared claim and leaves the runner parked. Both engine and standalone scheduler paths use this existing callback.
- Added a direct resolver assertion and an engine-level regression through `Engine.advance`; one host-shaped `ARROWRIGHT` press is checked across multiple waits phases, then a second distinct press is checked.

## Verification

**Commands and results:**
- The focused engine regression failed before the runtime change (`0 !== 1`), passed after it, and failed again when `pollCursorMapKey` was deliberately perturbed to return `null`; restored behavior passed. The direct resolver test also passed.
- `pnpm fixtures:fetch`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm fixtures:check`, `pnpm test:strict`, `pnpm golden`, `pnpm closing`, `pnpm dump:check`, `pnpm oracle:check`, `pnpm graph:test`, `pnpm graph`, `pnpm licence:test`, `pnpm licence`, `pnpm audit --prod`, `pnpm provenance:test`, `pnpm provenance`, `pnpm fixtures:test`, `pnpm catalogue:check`, `pnpm command-docs:test`, `pnpm command-docs:check`, `pnpm no-skips:test`, `pnpm icons:test`, and `pnpm golden:bun` passed. Oracle checks passed after installing Pillow in the external `$HOME/.venvs/tkr-tools` environment. The strict suite ran 2,970 tests with zero skips; save/load and reference renderer goldens matched, and closing matched 8/8 baselines. No golden changes were produced.
- Independent PR review and hosted CI are pending; no merge is authorized before both are satisfied.

---
title: 'Respect startup board-thread lifetime'
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
context: ['docs/guardrails.md', 'docs/spec/engine/main-loop-and-startup.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Board-scope threads created by a startup program can run before the initial board and survive into it, contrary to the owner's ruling. Saved-game board threads must not be mistaken for those temporary threads.

**Approach:** Apply the approved startup thread lifetime at the scheduler and first-board boundary, preserving persistent threads, freshly loaded board and item threads, saved-game Load and debugger behavior.

## Boundaries & Constraints

**Always:** Follow G1–G7; implement only against the doc-first owner ruling in `docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence` and `#reawakened-board-entry`. Test real engine phases with deterministic ticks and an actual save/load reply. Demonstrate sensitivity by removing the guard and restoring it. Explain any intentionally changed goldens.

**Never:** Inspect legacy source, change movement semantics (#1298), kill saved board threads, or add a schema/hash field without establishing necessity and separately documenting migration.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behavior |
|---|---|---|
| Startup completes | Startup creates persistent and non-persistent threads and waits | Non-persistent thread executes no instruction and is destroyed; persistent survives; board and item threads start fresh. |
| Saved Load | Saved game contains live board threads | Load preserves and resumes those saved threads rather than treating them as temporary startup threads. |
| Debug stepping | Startup and child threads paused/resumed | Same lifetime and no-execution rule as ordinary advance. |
| Startup loads an actual board | Live board exists during startup | Do not suppress board-owned threads belonging to that real board. |

</frozen-after-approval>

## Code Map

- `docs/spec/engine/main-loop-and-startup.md`: corrected owner ruling committed first as `cf686643`.
- `packages/core/src/engine/engine.ts`: `stepBoot`, normal phase dispatch and debugger `runOpenThreads`; `arrive` performs board startup. `applyLoadedGame` replaces the state on Load.
- `packages/core/src/script/vm.ts`: `runThreadsPhase` snapshots ready threads, including previously created children; an earlier blocking program may finish within the same phase, so a later guard in `stepBoot` alone is insufficient.
- `packages/core/test/engine-boot.test.ts`: authored `authorGame`, `bootEngine`, `run`, board-thread fixture and recovery tests.
- `packages/core/test/save-load.test.ts`: actual Save/Load blob harness and continuation tests.

## Tasks & Acceptance


Investigation: `runWaitsPhase` can wake the startup blocker while the ready list already contains its board child; `runThreadsPhase` continues that list when the blocker finishes, before `stepBoot` runs. The debugger snapshots the same list. Exclude pre-board startup children from both paths and recheck saved debugger cursors; cleanup only at `stepBoot` is too late. A restored save and a real board loaded during startup must not be treated as the pre-board slot.
- Implement a shared normal/debug scheduler exclusion while no board exists during startup, then discard startup-created board threads before first board entry, retaining persistent threads and saved restored state.
- Add real-path tests for all matrix rows, including the same tick where a previously waiting startup blocker finishes; prove board/item thread startup and a real Load continuation. Perturb the relevant guards and require targeted tests to fail.
- Update `CHANGELOG.md`; verify no unrelated changes and no movement changes.

## Implementation Notes

Issue #1253's item hydration is not yet on main. The new authored item integration test deliberately fails on main and passes in `/tmp/tkr-1173-item-integration`, a detached checkout of PR #1348 head `bb38b98b4f7e8f832b07bfff525642bcc222e1b8` with this change applied. This PR depends on #1348 and must remain draft until the dependency is integrated and review is satisfied.

An independent review exposed #1366: the initial board can replace a board loaded by startup without retiring its threads. The arrival condition now cleans up any actual previous board; #1348 independently includes the same condition.

Integrated #1348 at main `8ea70aa108e25d6e127eef66a2d1cd06d595e4a4`; the authored startup item test now runs on this branch rather than an auxiliary integration checkout. The old CI run also exposed a message-window lifecycle test that made an ordinary board-scope thread before any board existed; changed that fixture to a persistent thread, preserving its existing assertions while honoring the approved startup rule. The old browser mode-2 test was superseded by #1336's tick-precise live movement test.

## Plan Change Log

## Review Triage Log

- High, patched: startup-loaded board threads survived initial-board replacement (#1366). An authored regression observes that thread run, then checks its program is absent and the initial board thread runs; reverting the arrival condition makes it fail.
- High, dependency: first-board item test fails without #1348. User authorized a combined detached integration proof; the PR stays draft and cannot merge before #1348.
- Medium, patched: debugger cursor recheck had no targeted test. A JSON-round-tripped cursor containing a real startup child is injected into the live engine; removing the recheck causes the child's marker to appear. This is not an end-to-end engine snapshot/restore test.
- Medium, patched: persistent-thread tests proved only survival. The same persistent child now writes a marker and then sleeps, and tests assert both execution and survival.
- High, dependency: independent reviewer separately identified the same #1348 merge-order requirement; retained as above.
- Both independent reviewers rechecked the deltas and reported no additional blocking finding; #1348 remains a merge prerequisite.

## Verification

- Normal and step-debug startup tests plus an actual startup Load pass; removing scheduler exclusion or removal each makes both startup tests fail on `temporaryran`; deleting saved board threads at restore makes the Load continuation fail 1 vs 2.
- Preventing persistent threads from being scheduled makes both startup tests fail their execution marker; restoring the guard passes.
- Existing startup Send/recovery test passes. Full engine-boot and save-load suites: 150 passed.
- Item integration test passes against #1348 plus this change, and fails when item program resolution is disabled; it fails on main without #1348. Integration typecheck and lint pass.
- After review fixes: six targeted lifecycle tests, `pnpm typecheck`, `pnpm lint`, `pnpm provenance`, and `pnpm closing` passed; closing matches 8/8 baselines, with no golden rewrites. The item test is excluded from that main-based run because it is known to fail without #1348.

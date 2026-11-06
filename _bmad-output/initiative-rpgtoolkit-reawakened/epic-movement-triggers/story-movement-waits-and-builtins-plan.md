---
title: 'Movement waits and movement and input built-ins'
type: 'feature'
ticket: 7
created: '2026-10-18'
status: done
baseline_revision: 'ebe6e0db'
route: 'full'
route_source: 'pinned'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '/Users/jensen/projects/rpgtoolkit-reawakened/docs/guardrails.md'
  - '/Users/jensen/projects/rpgtoolkit-reawakened/docs/spec/engine/rpgcode-functions.md'
  - '/Users/jensen/projects/rpgtoolkit-reawakened/docs/spec/engine/movement-and-collision.md'
  - '/Users/jensen/projects/rpgtoolkit-reawakened/docs/spec/engine/display-input-audio.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Movement command calls still rely on test doubles, so scripts cannot start real actor movement, wait for completion, or use the movement/input catalogue surface.

**Approach:** Reuse the existing movement wait, effect-only command seam, and sequence-number input claim protocol. Register the complete movement/input command set through the world pack, including by-reference outputs and `multiRun` collection.

## Boundaries & Constraints

**Always:** Keep VM state plain JSON data and waits explicit; use actor/runtime APIs and section-owner effects; movement waits resolve from deterministic absolute ticks; `get` and `clearBuffer` claim/prune through the existing engine protocol; document every implemented command with plain-language then deterministic help.

**Never:** Mutate sprites or input sections directly from built-in callbacks; add a second key-consumption path; change stance behavior owned by 5.10; use host APIs, promises, generators, or legacy GPL source.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Direction move | player/item id and direction | enqueue one real move and park until its absolute end tick | invalid direction/target is a located bad-arg |
| Path/waypoint move | board goal or waypoint points | enqueue deterministic path/waypoint queue and wait for completion | unreachable path returns documented failure without hanging |
| Multi-run | `multiRun` begin, several movement calls, `multiRun` end | collect all moves and park once until every move completes | empty batch completes without a wait |
| Location/path outputs | actor/path query with by-reference destinations | return current coordinates and write all requested refs | missing actor/path writes deterministic zero/empty outputs |
| Input buffer | queued key sequence and `get`/`clearBuffer` | claim lowest eligible sequence, then prune only claimed records | no eligible key remains waiting/returns documented empty value |
| Buttons | set/check/clear button operations | effects update button slots; checks return state; clear removes/disable deterministically | unknown slot is a deterministic no-op/false per spec |
| Save/restore | snapshot while movement wait is pending | restored thread and wait resume at the same tick/result | malformed state remains rejected by existing save validation |

</frozen-after-approval>

## Code Map

- `packages/core/src/ports/wait.ts` -- saveable `movement` wait and input view/claim contract.
- `packages/core/src/script/waits.ts` -- deterministic movement and key wait polling; extend only where required by the documented protocol.
- `packages/core/src/script/vm.ts` -- effect/control handling for movement and `multiRun`; preserve explicit step-machine state and collect semantics.
- `packages/core/src/script/packs/world.ts` -- existing effect-only world pack pattern and command documentation helpers; add the movement/input owner pack surface here or a tightly coupled pack module.
- `packages/core/src/sprites/runtime.ts` and `packages/core/src/sprites/movement.ts` -- actor lookup, direction/path/point/waypoint enqueue APIs and movement cadence.
- `packages/core/src/input/input.ts` and `packages/core/src/save/sections/input.ts` -- input sequence queue, button slots, and owner-side pruning.
- `packages/core/src/engine/engine.ts` -- waits phase claim collection/pruning and movement phase order; do not introduce direct section mutation from commands.
- `packages/core/src/script/catalogue-responders.ts` / `catalogue-stubs.ts` -- catalogue ownership layering; replace only this ticket's movement/input stubs and keep generated ownership checks clean.
- `packages/core/test/movement-input.test.ts`, `packages/core/test/movement.test.ts`, `packages/core/test/script-catalogue*.test.ts` -- existing input, movement and responder patterns; add real VM end-to-end fixture coverage.
- `packages/core/test/fixtures/movement/movement-waits.json` -- authored per-tick movement-wait cases; every in-scope case must drive the real core.
- `docs/spec/engine/rpgcode-functions.md`, `movement-and-collision.md`, `display-input-audio.md` -- normative command rows and wait/input semantics.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/script/packs/movement.ts` -- implement the movement/input built-in catalogue through effects, waits, requests, and by-reference outputs -- keep section ownership and command docs deterministic.
- [x] `packages/core/src/script/vm.ts` and wait/engine integration -- replace movement test-double behavior with real movement wait scheduling, preserve `multiRun`, claim/prune semantics, and snapshot/restore.
- [x] `packages/core/src/script/catalogue-responders.ts` / generated catalogue output -- ensure every owned name has one real responder and no duplicate stub.
- [x] `packages/core/test` plus authored fixtures -- exercise movement command, catalogue, wait and effect paths; authored fixture oracle remains the per-tick fixture gate.
- [x] `docs/spec/engine/rpgcode-functions.md` -- update command help rows only where the implementation clarifies ownership or deterministic behavior; plain-language first.

**Acceptance Criteria:**
- Given a script movement call, when the VM executes it, then the real actor queue advances through the movement phase and the caller remains in a saveable movement wait until completion.
- Given a `multiRun` batch, when the batch closes, then all collected moves are started and one wait resolves only after every move's absolute end tick.
- Given queued keys and multiple consumers, when `wait`, `get`, or `clearBuffer` polls, then claims are lowest-sequence and pruning removes only claimed entries.
- Given button and location/path calls, when a script runs them, then outputs and effects match the normative rows with no direct section mutation in callbacks.
- Given a snapshot taken mid-wait, when it is restored and advanced with identical inputs, then per-tick state and final outputs match uninterrupted execution.
- Given the catalogue checks, when they run, then every in-scope name resolves to the real responder with no duplicate owner or generic stub.

## Implementation Notes

Proposed ruling (pending owner review): movement command waits use the actor's queued move duration as the absolute `until` tick recorded by the VM, rather than polling actor queue emptiness. Evidence: `WaitMove` is explicitly an absolute tick payload and AD-26 requires one coupled wait; rejected alternative: queue-empty polling would not be stable across collisions or snapshot/restore.

Proposed ruling (pending owner review): stance commands use a `sprite.stance` wait resolved from the 5.10 animation owner's `stanceComplete` result. Evidence: 5.10 owns stance progression and emits completion; rejected alternative: deriving a duration in the command would duplicate animation timing and diverge on hold/release.

Golden/corpus drift ruling (recorded after replay): `sample-man-wander-demo`
changed from `72cecfb9e0cca6b3` to `bf852aca0a053503` and
`sample-wander-basic` changed from `6c07077b8ac4f38b` to
`278c0fcbe086ed7f`. Replay confirms both changes are caused by the real
movement pack replacing the catalogue test-double: `wander` now consumes
its deterministic direction and emits sprite movement effects, while
`man_wander.prg` executes the real `itemPath` branch and reaches the
following input wait. The generic one-tick movement wait assertion was
removed from the corpus test because that host has no hydrated sprite;
the real engine movement-wait cases remain covered by the authored scene.
Rejected alternative: retaining the old hashes or generic wait would pin
test-double behaviour and violate G5.

Subsequent movement-fix drift was independently checked against instrumented
snapshots. At tick 4, `sample-man-wander-demo` changed from
`3a2b9726d53375d0` to `fdb36a6da14c36be`: only VM globals
`tkmv_pause_thread` and `tkmv_pathfind` changed from zero to absent, and
effect flags changed from 0 to 5. In the closing demo, state hashes changed
at tick 90 from `ebc4debc8737c323` to `d8d5a0f1bae97949`, tick 120 from
`bba581070de709d7` to `16ed8fa10754acc5`, and tick 600 from
`fb98aa7b960d5fdf` to `7eea2b34522c760d`: only global `waypoint`
changed from zero to absent and effect flags from 0 to 16. All other state,
draws and pixels were unchanged; ticks 30 and 60 were unchanged.

Fixture scene coverage (all six `movement-waits` cases are asserted through
the core movement runtime per tick; no cases are deferred to another owner):

| Case | Real-core assertion |
|---|---|
| `pause-thread-flag-waits-for-completion` | path queue, per-tick actor position/state, movement completion at tick 23, wake/locate at tick 24 |
| `without-the-flag-the-thread-continues` | concurrent path progression, sleep wake at tick 10, per-tick position/state |
| `blocking-thread-implies-the-wait` | two real push steps, blocking movement wait, completion at tick 15, continuation at tick 16 |
| `multirun-one-wait-over-both-sprites` | both real paths, coupled wait until slower actor completion at tick 31, continuation at tick 32 |
| `waypoint-path-copy-two-cycles` | copied waypoint queue, both cycles, per-tick positions and completion |
| `waypoint-link-sees-live-edit` | linked waypoint route after the tick-12 vector edit, per-tick positions and completion |

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- expected: success.
- `pnpm lint` -- expected: success.
- `pnpm fixtures:fetch && pnpm test:strict` -- expected: success.
- `pnpm fixtures:author:check && pnpm fixtures:test` -- expected: success.
- `pnpm golden && pnpm golden:bun` -- expected: success.
- `pnpm graph && pnpm licence && pnpm provenance` -- expected: success.
- `pnpm catalogue:check && pnpm command-docs:check` -- expected: success.


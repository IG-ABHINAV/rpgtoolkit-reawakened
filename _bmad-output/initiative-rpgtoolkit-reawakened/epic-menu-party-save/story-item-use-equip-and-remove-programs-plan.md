---
title: 'Item use, equip and remove programs'
type: 'feature'
ticket: 5
created: '2026-10-22'
status: done
baseline_revision: '1be218bae605d09e7707ecae5441203d0a4da0ca'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - 'docs/spec/engine/plugins-and-battle.md#epic-85-item-action-proposal'
  - 'docs/spec/formats/save-game.md#game-ledger-and-savable-continuation'
  - 'docs/spec/engine/interruption-recovery.md#recovery-and-pause'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Menu item use and equipment program actions lack a shared resumable operation, and RPGCode can select the wrong same-source stack (#1198).

**Approach:** Implement the independently reviewed contract merged in #1199 across both provider languages, script adapters, owner operations and save/recovery. Return displaced equipment to its exact retained inventory stack. The owner selected shared validated use and prevalidated replacement; exact-stack return is the engineering choice, not an additional owner ruling.

## Boundaries & Constraints

**Always:** Follow G1–G7 and the normative item-action contract, including atomic preflight, staged actor and inventory publication, current identity revalidation, exact program and event order, deterministic continuation, and all specified error distinctions. Use clean-room documentation only.

**Never:** Change hook-free E-81 primitives, duplicate battle effects, silently replace a selected stack, claim rollback of item-program or external native-hook side effects, or serialize unanswered host requests. Do not merge without independent review.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Menu use | Live party actor and available menu-usable stack | Clamp HP/SMP once, run use program, consume exact stack | Preflight refusal is atomic; changed stack after effects interrupts |
| Replacement | Empty or occupied slot, eligible available incoming item | Run old remove, atomically publish final projection, return displaced unit to exact stack, run new equip | Changed identity, overflow, invalid hook or projection fails with specified status and retained prior effects |
| Same stack | Available quantity including maximum safe integer | Net unchanged; programs run in order; no quantity events | No overflowing intermediate quantity |
| Removal | Empty slot or occupied slot | Empty is a no-op; occupied runs remove and returns exact stack | Validate before program and revalidate before commit |
| Continuation | Native or RPGCode caller, cold assets, yielding or nested programs | Resume on same thread, dispatch completion on the next budgeted VM step | Preserve missing-program versus hook-local errors and cleanup on handler transfer, kill or replacement |
| Restore | Request-free saved phase; changed source/IR; interruption recovery | Resume valid saved action exactly once; restart compatibility discards pending work; recovery retains durable ledger only | Validate saved shape and all provider identities before resume |
| Identity | Duplicate handles and same-source stacks | Exact then unique case-insensitive handle; filename canonical/sole-stack fallback | Ambiguity yields located menu.state-invalid; never pick an arbitrary stack |

</frozen-after-approval>

## Code Map

- `packages/core/src/menu/inventory.ts`, `equipment.ts`, `ports.ts` — inventory ownership, canonical catalog and event publication; retain primitives and add composed action preparation/commit.
- `packages/core/src/actors/rules.ts`, `port.ts`, `object.ts`, `engine/engine.ts` — factor actor equipment prepare/commit, stage hook-emitted events and reconcile the final projection before either owner publishes.
- `packages/core/src/script/vm.ts`, `state.ts`, `plugin.ts`, `restore-check.ts`, `waits.ts` — provider transitions, program frames, scheduler, saved continuations and restoration identity checks.
- `packages/core/src/script/packs/inventory.ts` — preserve legacy adapter signatures/location mapping, fix #1198 selection, request cold assets and route calls to composed operations.
- `packages/core/src/save/state.ts`, `snapshot.ts`, `equipment-check.ts`, `engine/recovery.ts` — migrate VM shape, validate and restore pending actions, retain existing durable-only recovery and equipment gate.
- `packages/core/test/menu-state.test.ts`, `actor-rules.test.ts`, `actor-behaviour.test.ts`, `save-equipment-check.test.ts`, `battle-actions.test.ts`, `battle-item-stack-identity.test.ts` — reuse existing owner, program, save and battle harnesses; add authored focused cross-layer fixtures.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/actors/{rules,port,object}.ts`, `packages/core/src/engine/engine.ts` — stage hook results and queued events, validate the canonical actor projection and publish atomically.
- [ ] `packages/core/src/menu/{inventory,equipment,ports}.ts` — implement shared preflight, safe clamping, exact-stack commit and event payloads without changing primitive semantics.
- [ ] `packages/core/src/script/{plugin,state,vm,waits,restore-check}.ts`, `packages/core/src/script/packs/inventory.ts` — implement both provider protocols, nested saveable action phases, cold asset acquisition, cleanup and adapter resolution.
- [ ] `packages/core/src/save/{state,snapshot}.ts` and recovery integration — bump and migrate VM schema, validate continuations, preserve request and restart/recovery rules.
- [ ] `packages/core/test/` — assert every matrix scenario and the detailed fixtures in the merged contract, including perturbation of each guarded transition or revalidation.
- [ ] `docs/spec/engine/plugins-and-battle.md`, related command docs, `CHANGELOG.md` — remove obsolete not-implemented claims and accurately describe shipped behavior.

**Acceptance Criteria:**
- Given native and RPGCode providers, when each invokes the same action, then results, effects, hook order and queued events agree, including save and restore at each phase.
- Given interleaving, invalid or unavailable assets, hook errors and thread abandonment, when execution resumes, then the contract's exact refusal/interruption/cleanup behavior holds without loss or duplication.
- Given battle item use, when consumption completes, then the existing Epic 7 inventory path applies no duplicate stat effects and seeded results remain stable.
- Given full and focused checks and an independently reviewed PR, when the work is handed off, then the actual results and unresolved CI/review state are reported without merging.

## Implementation Notes

## Plan Change Log

Rebaselined from the pre-contract draft after #1199 merged and the ticket resolver repairs landed; baseline is the current origin/main commit. The original draft's owner direction, exact-stack engineering choice and #1198 defect are retained above.

## Review Triage Log

## Verification

**Commands:**
- Run focused behavioral tests for item actions, actor staging, provider scheduling, saves/recovery, adapters and battle consumption, including per-test duration and specified perturbations.
- Run the applicable CONTRIBUTING gates, including build, typecheck, lint, strict tests, golden, graph, catalogue, command documentation, licence and provenance; record actual outcomes.

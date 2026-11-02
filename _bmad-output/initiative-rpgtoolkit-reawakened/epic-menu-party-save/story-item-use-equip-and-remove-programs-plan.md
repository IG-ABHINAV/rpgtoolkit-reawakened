---
title: "Item use, equip and remove programs"
type: 'feature'
ticket: 5
created: '2026-10-22'
risk: "high"
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-73"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-81"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-82"
  - "spec - docs/spec/formats/item.md"
status: draft
blocked_at: "2026-10-31"
blocked_reason: "Complete the doc-first contract amendments, including provider continuations and outcomes, and obtain independent review before implementation; the owner choices require no further clarification."
---

## Intent

Deliver item-use and equipment-program behavior through the existing inventory and actor owners, without moving battle rules or its item program out of Epic 7.

## Boundaries

Apply documented HP/SMP effects, use/equip/remove programs, quantity changes, bonuses, caps, and event order. Do not implement screen navigation or duplicate battle inventory state.

## Acceptance

Script and Epic 7 battle fixtures demonstrate valid use, invalid targets, successful and refused equip/remove, exact program/effect order, one-time quantity consumption, and the approved displaced-item contract. Exercise the shared menu-use action and the existing battle inventory path without applying battle effects twice.

## Verification

Run deterministic tests at each side-effect boundary; assert final state and queued event sequences and replay from a saved point. Cover exact-handle selection among same-source stacks, displaced zero-quantity and maximum-quantity stacks, same old/new stack with correct net quantities, synchronous hook mutation, explicit waits, and instruction-budget preemption while another action changes the item or equipment.

## Implementation map

Compose entry 4's existing inventory and actor operations with a saveable script continuation. Preserve Epic 7's battle-owned effects, program and existing `battleconsume` owner path; board-item activation is a separate path and must not be conflated with inventory-item use.

## Owner direction and doc-first proposal — 2026-11-02

**Owner chose:** (A) a shared, validated item-use action for replacement menus, and (A) occupied-slot replacement with the new item prevalidated. Both TypeScript and RPGCode providers must have equivalent semantics. These choices do not settle the action's spelling, parameters, result, continuation or failure protocol. E-81's menu order remains HP/SMP, use program, then consume; battle order remains HP/SMP, consume, animation and program. Battle behavior stays in `stock_battle`, and the inventory owner must not apply battle stat effects a second time.

**Owner's exact additional wording:** “there is still a way to get the handle of the item that was being replaced or that the item goes back into the inventory.” The owner offered return to inventory as one alternative; returning to the exact existing stack is the engineering design chosen here, not an additional owner ruling. No further choice between both guarantees is required.

**Existing identity and ownership evidence:** E-81 and `docs/spec/formats/save-game.md` specify one stack per `(source, handle)`, with a separately allocated stable numeric `id`/`entryId`; quantity counts available, unequipped units. Equipment records reference the stack's `itemId`; even a zero-quantity stack is retained while equipped. The derived actor equipment reference is distinct from both the display handle and inventory stack ID. In `packages/core/src/menu/inventory.ts`, `equip` currently refuses an occupied slot, and `unequip` finds that existing stack by `itemId`, increments its available quantity, preserves its source, handle and ID, and emits `itemAdded`. No separate per-copy identity exists.

**Existing equip adapter identity defect:** tracked independently as #1198. `packages/core/src/script/packs/inventory.ts:177-182` finds a matching handle but then selects the first stack with that source, which can be a different handle or have zero available quantity. Coordinate the fix with #589.

**Implementation design:** after prevalidation succeeds, return the displaced unit to its existing retained `(source, handle)` stack, preserving its `entryId`. The existing stack handle remains readable naturally; this is not a claim that the owner mandated both return and a separate handle-access guarantee. There is no per-copy handle.

**Contract work before implementation:** complete and independently review doc-first amendments to E-80/E-81/E-82 and affected script rules. The existing synchronous native provider has only wait/open/complete transitions; specify how both native and RPGCode providers invoke a shared action that can run a yielding program, how the caller resumes, its arguments and result, and the plain-data saved continuation. An action's preflight refusal must remain atomic under E-81; distinguish it from a composed operation interrupted or failing after a program has run, where already completed script side effects cannot be assumed rolled back. Do not silently change E-81 primitive equip/unequip semantics or place hooks inside E-82's primitive operations.

**Engineering constraints to resolve in that amendment:** prevalidate the incoming item, actor, slot, quantity and the displaced stack's capacity to accept its returned unit; use net quantity for a same-stack replacement, not an overflowing intermediate increment. Revalidate stack identity, quantity, slot and capacity after every hook returns, including synchronously mutating hooks, and at every continuation boundary where execution can interleave, including VM budget preemption. Define safe outcomes for changes after preflight without losing or duplicating the displaced item, and preserve documented hook order, context, events, caps and G1 save/restore. A review of this proposal alone does not unblock implementation. Keep #585 dependent on this ticket; #1195 remains deferred.

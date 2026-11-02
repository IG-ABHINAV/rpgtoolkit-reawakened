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
blocked_reason: "Owner selected a shared validated menu-use action and prevalidated occupied-slot replacement; displaced-item wording needs clarification and the doc-first contract must be reviewed before implementation."
---

## Intent

Deliver item-use and equipment-program behavior through the existing inventory and actor owners, without moving battle rules or its item program out of Epic 7.

## Boundaries

Apply documented HP/SMP effects, use/equip/remove programs, quantity changes, bonuses, caps, and event order. Do not implement screen navigation or duplicate battle inventory state.

## Acceptance

Script and Epic 7 battle fixtures demonstrate valid use, invalid targets, successful and refused equip/remove, exact program/effect order, one-time quantity consumption, and the approved displaced-item contract. Exercise the shared menu-use action and the existing battle inventory path without applying battle effects twice.

## Verification

Run deterministic tests at each side-effect boundary; assert final state and queued event sequences and replay from a saved point. Include item uses that do not consume when the documented operation fails.

## Implementation map

Compose entry 4's existing inventory and actor operations with a saveable script continuation. Preserve Epic 7's battle-owned effects, program and existing `battleconsume` owner path; board-item activation is a separate path and must not be conflated with inventory-item use.

## Owner direction and doc-first proposal — 2026-11-02

**Owner chose:** (A) a shared, validated item-use action for replacement menus, and (A) occupied-slot replacement with the new item prevalidated. Both TypeScript and RPGCode providers must have equivalent semantics. These choices do not settle the action's spelling, parameters, result, continuation or failure protocol. E-81's menu order remains HP/SMP, use program, then consume; battle order remains HP/SMP, consume, animation and program. Battle behavior stays in `stock_battle`, and the inventory owner must not apply battle stat effects a second time.

**Owner's exact additional wording:** “there is still a way to get the handle of the item that was being replaced or that the item goes back into the inventory.” This is an **or**, not an approval of both guarantees. Clarification required: is return of the displaced item to inventory required, is access to its handle sufficient on its own, or should both be guaranteed? Does “handle” mean the existing stack's script/display name, the numeric `entryId`, or an independently addressable item instance? Do not infer a per-copy instance identity.

**Existing identity and ownership evidence:** E-81 and `docs/spec/formats/save-game.md` specify one stack per `(source, handle)`, with a separately allocated stable numeric `id`/`entryId`; quantity counts available, unequipped units. Equipment records reference the stack's `itemId`; even a zero-quantity stack is retained while equipped. The derived actor equipment reference is distinct from both the display handle and inventory stack ID. In `packages/core/src/menu/inventory.ts`, `equip` currently refuses an occupied slot, and `unequip` finds that existing stack by `itemId`, increments its available quantity, preserves its source, handle and ID, and emits `itemAdded`. No separate per-copy identity exists.

**Recommendation, not an owner ruling:** after prevalidation succeeds, return the displaced unit to its existing retained `(source, handle)` stack, preserving its `entryId`, and make the displaced stack's handle and ID available through the existing read/event or program-context surfaces where those surfaces support it. This preserves the item and its observable stack identity without inventing a per-copy handle; do not assume the current action result exposes either. The owner has not yet selected both preservation and handle access as mandatory guarantees. Specify how the identity is exposed only after clarification and a cross-check of the existing surfaces.

**Contract work before implementation:** amend E-80/E-81/E-82 and the affected script rules in a separate doc-first change after the displaced-item clarification. Define the shared action's arguments/results and equivalent provider exposure; distinguish validation refusal from errors or interruptions after a program starts, including an item or equipment changed by a yielding hook. Reconcile replacement and hook ordering with the current primitive operations, context inheritance, queued events, caps and G1 save/restore; do not promise rollback of script side effects without an explicit rule. Update the ticket and acceptance after those decisions. Keep #585 dependent on this ticket; #1195 remains deferred.

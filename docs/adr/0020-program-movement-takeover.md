# ADR 0020 — A program takes over player movement once

* **Status:** Accepted by the owner, 2026-11-07; implementation and migration design remain tracked by #1643
* **Date:** 2026-11-07
* **Context documents:** [Movement queue and program takeover](../spec/engine/movement-and-collision.md#reawakened-program-movement-takeover), [click movement](../spec/engine/display-input-audio.md#reawakened-click-movement-freeze), [G1 and G3](../guardrails.md)
* **Ticket:** [#1643](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1643)

## Summary

1. A program that does not take over movement leaves the player's existing route alone, unless an existing item/stop-movement entry rule clears it.
2. When the program first takes over that player's movement, remove all inherited queued movement and any continuing waypoint before applying its movement instruction.
3. Clear once on takeover, not on every command. The program's later commands keep their ordinary append/clear behavior.

## Context

Issue #1643 reports that a non-stopping trigger which issues no movement silences later regions along an inherited click route. Its investigation proposes tracking movement ownership, but that representation and the historical-save migration were not owner-approved.

The owner stated: “I would say if a program did something to change the movement of the player, all queued movement would be removed.” Asked whether to clear once on takeover or on every movement command, the owner selected **Once on takeover**: discard inherited movement when the program first takes over, then preserve the program's ordinary append/clear semantics.

This is a Reawakened behavior decision. The documented 3.1 source-read establishes that a non-stopping board program can leave a click route intact; it does not establish this once-per-program takeover policy for mixed movement queues.

## Decision

1. Apply the [normative takeover rule](../spec/engine/movement-and-collision.md#reawakened-program-movement-takeover) per program execution and targeted player. The first accepted movement instruction clears the complete pending queue and linked/repeating waypoint, regardless of whether they came from input or another script. It then applies the new instruction.
2. Subsequent movement instructions in that execution append normally unless their own flags or documented behavior clear or replace movement. Multiple directions within one command are not separate takeovers.
3. Nested calls share the enclosing execution's takeover. Waiting or crossing a tick does not reset it. A separately started program execution has its own takeover. No particular state representation is selected here.
4. Preserve active-step, collision, placement, board-transition, held-input and movement-setting rules. Clearing a queue does not itself interrupt an active step, and a rejected command does not clear it. Changing speed, walking/push mode or facing alone is not a travel instruction.
5. A trigger that issued no movement must not suppress the resumed inherited route merely because that route remains queued after the program returns. Movement issued inside the trigger remains subject to R-52's non-recursion rule.

## Day-one rules

- Clear all inherited queued sources, not just pointer-marked moves; remove a continuing waypoint so it cannot regenerate the old route.
- Preserve the program's own sequence: after takeover, queued east then north remains east then north unless an explicit clear/replacement intervenes.
- Preserve takeover progress across normal save/restore and recovery paths that retain the program continuation; do not let a restored later command clear the program's earlier queued commands again.
- Verify consecutive untouched click-route regions, an actual takeover, multiple commands, mixed inherited sources, waypoints, command refusal, nested calls, waits, cancellation and save/restore through real engine consumers.

## Consequences

- This supersedes the narrower #1312 amendment that cleared only pointer movement while retaining inherited non-pointer moves. Its deadlock-prevention intent remains, but the target is now complete inherited-queue replacement once.
- Existing programs that deliberately appended their first movement command to another execution's queued player route change behavior; subsequent commands retain the existing E-22 contract.
- Runtime code and the movement oracle have not been changed by this documentation decision. Their current behavior is not proof that the new rule is implemented.

## Alternatives rejected

- Clear only the pointer route: retains inherited script movement contrary to the owner's direction.
- Clear on every movement command: silently discards the program's own earlier queued commands.
- Clear on entry to every program: destroys an inherited route even when a non-stopping program never takes over movement.
- Suppress triggers until any inherited queue drains: reproduces #1643 when the trigger never issued movement.

## Deferred

- The exact saveable takeover/suppression representation, section versions, and migration of old in-flight saves that lack the necessary information. Do not fabricate historical ownership.
- Suppression lifetime when unrelated executions append movement, or when a trigger installs a linked/forever waypoint. This ruling does not approve the earlier per-move provenance proposal or a blanket queue-drain substitute.
- Aligning the P-8 oracle model, its generator/manifest and behavioral fixtures with the final suppression contract. Existing P-8 describes queue-drain locking and must not be treated as approval of blanket suppression for an untouched inherited route.
- #1180's reported historical per-frame click-walking quirks, and #1281/#1300/#1290's collision and linked-edge decisions, remain separate.

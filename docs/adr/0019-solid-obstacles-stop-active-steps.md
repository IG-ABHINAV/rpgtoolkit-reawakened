# ADR 0019 — Solid obstacles stop active movement steps

* **Status:** Accepted by the owner, 2026-11-07
* **Date:** 2026-11-07
* **Context documents:** [Movement, collision and activation](../spec/engine/movement-and-collision.md#reawakened-solid-step-stop), [G7](../guardrails.md#g7--clean-room-provenance)
* **Tickets:** [#1675](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1675), [#1674](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1674)

## Summary

1. A blocked direct step ends where the actor last stood safely; walls, solid items and other actors all stop it.
2. The player can choose another direction after a collision instead of being trapped trying to finish an impossible step.
3. Interpolation uses only the immediately preceding simulation tick, so a stationary actor does not repeatedly slide back toward an old position.

## Context

A real demo-package reproduction left the player at (309,278) and the NPC at (313,293) after their conversation. The script had finished, but the player's unfinished southward step could not enter the NPC's solid base. New direction input was refused while that step remained active, and repeated collisions froze the NPC again. Separately, stale previous coordinates caused visible NPC jitter on stationary ticks.

The owner ruled: “The steps should be stopped if the space in front is now occupied by a solid item. This includes any walls, other actors, items....” This is a Reawakened behavior decision, not a claim of runtime-verified legacy behavior.

## Decision

1. Amend E-133's uninterrupted-step rule and R-51's direct-collision result: collision terminates the blocked direct step at the last safe position. Preserve ordinary input sampling between steps.
2. Retain existing collision priority, the loser's 120-tick freeze, queued movement and path diversion/wait contracts. Ending a blocked step does not report a successful step or successful step distance.
3. Before each actor's movement update, previous-position history advances to the current position when necessary, including frozen, idle and cadence-only ticks. Actual motion can then set the prior position for that tick's interpolation.

## Day-one rules

- Apply the collision stop through the movement owner, not a dialogue-only workaround or an input-preemption exception.
- Do not move an actor into solid geometry to complete its step.
- A stationary tick must not interpolate an old displacement again; presentation alpha remains outside simulation inputs and canonical hashes.

## Consequences

- Direct-collision completion changes deterministic movement state and events; behavior regressions and replay gates cover the change.
- Collision losers may still wait for their existing freeze to expire; that is distinct from a permanently active blocked step.
- The interpolation fix can change intermediate presentation and prior-position state; check stationary and moving render outputs rather than altering the host loop.

## Alternatives rejected

- Cancel only on NPC conversation: leaves the same defect against other solid actors and items.
- Let fresh keys interrupt any active step: weakens normal step-boundary input semantics unnecessarily.
- Keep retrying the blocked direct step forever: prevents retreat and can indefinitely refreeze the other actor.

## Deferred

No broader pathfinding, sliding, freeze-priority or mobile scheduling redesign is part of this decision.

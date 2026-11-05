---
type: epic
title: "Host Capabilities, Display Planes and Touch Control Surface"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-12"]
assignee: ""
risk: medium
tracker_id: "#1355"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1355"
---

# Host Capabilities, Display Planes and Touch Control Surface

## Description

Replaces fragile OS and platform-string sniffing with a deterministic, typed **Host Capabilities contract** (`HostFeatures`),
implements the **Three-Plane Display Geometry model** (`HostDisplayGeometry`) for responsive viewports and hardware safe
areas, and establishes the **Two-Tier Touch Control Surface** (Tier 1 author-owned custom HUDs in margins vs. Tier 2
runner fallback gamepad for legacy games).

## Outcome

Games can adapt responsively to touchscreens, gamepads, hardware keyboards, safe areas (notches/home bars), and wide
mobile aspect ratios without breaking core determinism or requiring copyleft platform dependencies. The normative
specification in `docs/spec/engine/host-capabilities-and-viewports.md` is fully satisfied.

## Done when

1. `createEngine` accepts `features` and `displayGeometry` at boot as plain JSON, recording them in `state.features` and
   `state.display` with deterministic state hashing (G1, G3).
2. The RPGCode functions `hasFeature()`, `pointerType()`, `viewWidth()`, `viewHeight()`, `marginWidth()`, `safeAreaInset()`,
   and `displayAspect()` are exposed, and querying unknown features safely returns 0 without raising runtime errors.
3. Mid-session hardware changes (gamepad connection/disconnection) and window resizes / phone rotations emit AD-14 events
   (`device.*` and `viewport.resized`).
4. Games that register custom touch controls or check `hasFeature("touch")` run with zero runner chrome, with controls
   positioned cleanly in lateral letterbox margins.
5. Legacy Toolkit 3.1 games running on touch devices render the runner fallback virtual D-pad and action buttons outside
   the 4:3 gameplay frame within the pillarbox margins.

## Boundaries

`core` remains 100% platform-agnostic and I/O-free (G2). The runner gathers physical window metrics and hardware facts and
passes them as plain JSON data across the engine boundary. The core never learns a runner's name.

## References

- spec - docs/spec/engine/host-capabilities-and-viewports.md
- spec - docs/spec/engine/runners.md#boundary
- ruling - docs/adr/0017-input-actions-devices-and-accessibility.md
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-14, AD-33
- constraint - docs/guardrails.md, G1, G2, G3, G4

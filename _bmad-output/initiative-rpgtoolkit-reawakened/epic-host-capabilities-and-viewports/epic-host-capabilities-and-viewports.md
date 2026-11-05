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
4. Games that explicitly declare or register custom touch controls run without fallback runner chrome; checking
   `hasFeature("touch")` alone does not suppress it.
5. Touch games without a custom-control declaration get a fallback virtual D-pad and action buttons in safe pillarbox
   margins when they fit, and a translucent overlay on the game when they do not.

## Boundaries

`core` remains 100% platform-agnostic and I/O-free (G2). The runner gathers physical window metrics and hardware facts and
passes them as plain JSON data across the engine boundary. The core never learns a runner's name.

## References

- spec - docs/spec/engine/host-capabilities-and-viewports.md
- spec - docs/spec/engine/runners.md#boundary
- ruling - docs/adr/0017-input-actions-devices-and-accessibility.md
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-14, AD-33
- constraint - docs/guardrails.md, G1, G2, G3, G4

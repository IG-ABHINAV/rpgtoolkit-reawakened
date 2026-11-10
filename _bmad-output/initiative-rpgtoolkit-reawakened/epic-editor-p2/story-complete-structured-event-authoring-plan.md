---
type: story
title: "Complete structured event authoring"
ticket: 3
status: draft
risk: high
---

# Complete structured event authoring

## Scope

Adds categorized command templates, typed asset and scalar inputs, insertion, deletion, ordering, conditions and waits within the ruled representable subset, with explicit code display and safe handling of nonrepresentable text.

Cover Text, Display, Player, Fight, Control, Items, Variables, Input and Info within the approved supported subset; do not silently drop unrepresentable content.

Implement the T-45 screen-layout canvas using 14.1's approved representation, with selectable placed elements, coordinate inspection and numeric/keyboard placement. Save/reopen and undo must preserve the layout and corresponding generated program; run representative output and compare it with the authored placement, without promising arbitrary source-to-layout roundtrip.

## Acceptance and verification

Representative commands from every supported category generate clean runnable RPGCode, keyboard editing and undo work, and handwritten unsupported content is never silently regenerated.

## Dependencies and decisions

Requires 14.2, 11.4. Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.

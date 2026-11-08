---
type: story
title: "Teach a first board in both hosts"
ticket: 8
status: draft
risk: medium
---

# Teach a first board in both hosts

## Scope

Adds tip-of-day and an accessible nine-step first-board tutorial with progress state using foundation help entry points, guiding creation, editing, saving and an explicitly scoped run in browser and VS Code without requiring visual programming.

Explain local versus shared edits and save failures; provide keyboard navigation, restart and help return, with no assumption of identical host capabilities.

The nine-step proof is: (1) create a project using 11.10; (2) locate Game and Files views; (3) create a board using 12.10; (4) select a tileset brush; (5) paint and navigate the canvas; (6) inspect layer visibility; (7) set the initial board and player start using 12.3; (8) save and reopen; (9) compare an explicitly configured board test with normal startup through 11.8. Use authored licensed starter assets and include keyboard equivalents and recovery from a cancelled step.

## Acceptance and verification

A new author follows the nine steps end to end in each host, controls tips and preserves tutorial progress on cancellation, and sees the difference between preview, board test and normal startup.

## Dependencies and decisions

Requires 11.4, 11.8, 11.10, 11.11, 12.3 and 12.10. Foundation 11.11 owns contextual manual and quick-reference entry points; this story owns tutorial and tip presentation and state. Follow approved contracts and capability declarations; do not assume unimplemented provider behavior.

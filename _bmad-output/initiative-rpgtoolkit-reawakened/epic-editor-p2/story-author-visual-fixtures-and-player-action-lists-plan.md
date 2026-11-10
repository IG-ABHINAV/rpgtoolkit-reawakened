---
type: story
title: "Author visual fixtures and player action lists"
ticket: 7
status: draft
risk: high
---

# Author visual fixtures and player action lists

## Scope

Authors version-controlled small real-engine fixtures, accessible placements and ordered movement and interaction actions plus observable assertions against the ruled 11.9 test representation.

Use 11.9 APIs and script-spec; arrange a tiny board, actor, state, provider and seed, ordered keyboard-accessible actions and bounded assertions; do not mock collision or transitions, duplicate the runner, or leak test-only helpers into game distributions.

## Acceptance and verification

A creator saves and reruns isolated wall and door cases with seeded bounded ticks and located expected/actual diagnostics, and deliberately broken collision or transition makes its own assertion fail.

## Dependencies and decisions

Requires 14.1, 11.9, 12.1. Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.

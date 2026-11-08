---
type: story
title: "Refactor sweep for beginner tools"
ticket: 9
status: draft
risk: low
---

# Refactor sweep for beginner tools

## Scope

Removes duplication and deferred cleanup identified in the completed P2 story plans and reviews without adding deferred feature scope.

Consult the completed plans and review findings; cleanup only, never absorb missing feature work.

## Acceptance and verification

The sweep records its reviewed findings, removes applicable dead weight and keeps every existing P2 behavior and host boundary intact.

## Dependencies and decisions

Requires 14.1–14.8 and 14.11–14.14. Follow approved contracts and capability declarations; do not assume unimplemented provider behavior.

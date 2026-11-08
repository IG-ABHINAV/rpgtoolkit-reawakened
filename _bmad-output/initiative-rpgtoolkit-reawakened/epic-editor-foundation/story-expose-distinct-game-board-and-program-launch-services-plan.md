---
type: story
title: "Expose distinct game board and program launch services"
ticket: 8
status: draft
---

## Scope

Adapt the existing web runner and fixture seam through platform services, with explicit board, position, party and program preferences for font, size, window graphic and board; report stalls and unpredictable references where provider can expose them.

## Acceptance

Run game from startup differs from test board or program; launch snapshots identify revision and do not silently hot reload; missing capabilities and unresolved assets explain refusal.

## Verification

A real game launch and a fixture-backed program launch run in both hosts, a board launch identifies its state, and failed saves prevent launching stale revisions.

## Decisions and prerequisites

Contract 11.1 must rule how the documented legacy sys_test.prg behavior maps to safe test inputs and host execution; do not equate preview with execution.

Prerequisites: 11.3, 11.4, 9.3, 9.16.

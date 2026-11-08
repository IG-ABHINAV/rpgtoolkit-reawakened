---
type: story
title: "Refactor sweep"
status: draft
risk: medium
ticket: 9
---

## Scope

Remove duplicated desktop wiring and obsolete paths identified by completed stories or reviews without widening behavior.

## Acceptance

Desktop adapters remain the only host-specific implementations, shared registrations have one owner and review findings in scope are resolved without hiding defects.

## Verification

Inspect completed story changes and run the existing relevant conformance and integration checks after cleanup.

## Prerequisites and decisions

Wait for all 15.1–15.8; scope excludes deferred feature work.

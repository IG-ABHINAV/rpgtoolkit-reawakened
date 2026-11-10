---
type: story
title: "Author and execute real engine RPGCode creator tests"
ticket: 9
status: draft
---

## Scope

Extend the existing TOOL-5 framework rather than create an editor-only runner; build versioned inspectable fixture data, input actions, observable state/event projections, bounded wait, deterministic seed, isolated board/party/variables/provider, and source revision reporting. Refactor the existing Node-specific project discovery and file loading behind a host-neutral input seam so the same framework runs from browser and VS Code platform services without a second runner.

## Acceptance

A test driver advances waiting programs without blocking, failures show expected/actual and last action, changing the guarded outcome makes its assertion fail, and shipped game manifests exclude test-only code; visual authorship is not a prerequisite.

## Verification

A code-authored fresh fixture runs passing and deliberately failing wall or door assertions with deterministic ticks, source-located results and identical supported headless and visible inputs.

## Decisions and prerequisites

10.8 is blocked and partial: F-A/F-D/F-E/F-G and PKG-7 must be resolved by that provider; 11.1 specifies missing gameplay capabilities and this story implements and proves them rather than claiming they exist.

Prerequisites: 11.1, 11.7, 11.8, 10.8.

---
type: story
title: "Three-platform editor behavior measurements"
status: draft
risk: high
ticket: 7
---

## Scope

Record ADR 0013 as the ruled shell and measure editor-specific behavior using actual macOS, Windows and Linux systems and the 12.1 board tracer.

## Acceptance

For every OS record system/version/architecture, app revision, board open/edit/save/reopen, read/write/watch behavior, dialogs, explicit association and drop, including failures and reproducible evidence.

## Verification

Execute the same real project scenario on each OS, reproduce external change and record observable results; review the written decision and matrix with an operator.

## Prerequisites and decisions

Requires 12.1 and access to all three OSes; do not treat virtual unit simulations as OS proof or reopen shell choice.

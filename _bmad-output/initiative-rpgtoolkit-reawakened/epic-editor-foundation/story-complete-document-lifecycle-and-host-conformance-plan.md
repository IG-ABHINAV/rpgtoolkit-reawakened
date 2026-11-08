---
type: story
title: "Complete document lifecycle and host conformance"
ticket: 3
status: draft
---

## Scope

Extend 11.2 controller and host adapters without duplicating document identity; cover canceled close, failed writes, backup availability, external modification and explicit resolution.

## Acceptance

Each edit has stable identity; view switching and hidden webviews do not lose state; save failures and conflicts retain local work and truthful host capability reporting.

## Verification

The same conformance suite exercises undo and redo by editId, save timing, conflict and recovery behavior on web and VS Code including hidden views and one model per URI.

## Decisions and prerequisites

Conformance follows 11.1; no promise of cross-document atomicity or universal durable backup.

Prerequisites: 11.2.

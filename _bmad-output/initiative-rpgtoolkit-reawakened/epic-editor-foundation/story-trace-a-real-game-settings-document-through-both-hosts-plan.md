---
type: story
title: "Trace a real game settings document through both hosts"
ticket: 2
status: draft
---

## Scope

Create the shared model, UI and host adapter seams with one URI instance and the smallest genuine settings edit; use the existing main-file reader/writer, preserve residue/version and expose host failures.

## Acceptance

Both adapters exercise identical editor-ui behavior and persisted bytes, including a failing save that preserves the dirty model; dependency boundaries prohibit UI host imports.

## Verification

A real authored .gam opens in web and VS Code including vscode.dev, an edited field saves and reopens without loss, and the runner reads the saved file.

## Decisions and prerequisites

Use 11.1 rulings; provider 2.9 names reader/layout and existing core writer must be checked against supported versions.

Prerequisites: 11.1, 2.9.

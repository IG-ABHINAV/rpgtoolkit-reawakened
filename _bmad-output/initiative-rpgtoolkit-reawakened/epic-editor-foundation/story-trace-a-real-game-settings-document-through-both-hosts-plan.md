---
type: story
title: "Trace a real game settings document through both hosts"
ticket: 2
status: draft
---

## Scope

Close the real-settings tracer. Jensen split this story on 2026-11-10 into 11.16 (toolchain, [#1831](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1831)), 11.17 (model and UI over an in-memory platform-services double, [#1832](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1832)) and 11.18 (web and VS Code adapters, [#1833](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1833)). This story keeps the original acceptance and waits for all three: it runs the whole path once, from a clean checkout, on a real authored `.gam`, and adds no feature code. A gap found goes back to the slice that owns it.

## Acceptance

Both adapters exercise identical editor-ui behavior and persisted bytes, including a failing save that preserves the dirty model; dependency boundaries prohibit UI host imports.

## Verification

A real authored .gam opens in web and VS Code including vscode.dev, an edited field saves and reopens without loss, and the runner reads the saved file.

## Decisions and prerequisites

Use 11.1 rulings (closed 2026-11-10); provider 2.9 names reader/layout and existing core writer must be checked against supported versions, which 11.17 does.

Prerequisites: 11.16, 11.17, 11.18, 2.9. 11.1 is reached through 11.16.

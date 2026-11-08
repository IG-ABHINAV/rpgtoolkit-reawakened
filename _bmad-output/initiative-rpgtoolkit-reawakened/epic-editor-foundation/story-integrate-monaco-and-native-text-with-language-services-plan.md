---
type: story
title: "Integrate Monaco and native text with language services"
ticket: 7
status: draft
---

## Scope

Use the transport-free LSP with correct browser worker and VS Code native transports; implement token styles, bookmarks, quick-reference and keyboard accessibility using existing command documentation, preserve encoding and unknown text.

## Acceptance

Native VS Code and shared views have one authoritative text identity, language failures do not prevent editing, and real program content survives save and reopen in both hosts.

## Verification

In both hosts a .prg edits and saves with live coloring, symbols and comments navigation, call tips, command reference insertion, header template and distraction-free mode, even without Epic 22.

## Decisions and prerequisites

ADR 0021 selects Monaco, not its integration version; 22.9 may add grammar later and is not a prerequisite.

Prerequisites: 11.3, 11.5, 10.1, 10.5.

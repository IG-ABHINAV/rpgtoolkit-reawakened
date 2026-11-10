---
type: story
title: "Offer a shared Git surface in browser and desktop hosts"
ticket: 15
status: draft
---

## Scope

Decide the Git engine, then implement [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d13--git-integration) D13.3 through the platform-services `scm` interface: the status of changed documents, a diff preview in the same read-only view as history (D12.6), stage, commit and a read-only log, in the browser/PWA and desktop hosts. The engine choice is a G6 decision and precedes any implementation: the desktop host may use the user's installed `git`, and an in-browser implementation needs a licence inventory and an ADR before it is a dependency. Push, pull, remotes and credentials are out of scope.

VS Code is not part of this story: D13.2 keeps the built-in Git, and the extension only cooperates (files appear as ordinary changes, the history folder is offered for ignoring, a checkpoint group can be handed to the Source Control view).

## Acceptance

The editor works fully without Git; with the capability present the four operations work on a real project under Git; a binary document's diff is the editor's preview and a conflict is never auto-resolved into markers; nothing about history depends on Git, or Git on history.

## Verification

With a project under Git, a changed document appears with its status, its diff previews in the read-only viewer, and a staged commit records the change; with the `scm` capability absent the features are absent and the reason is shown; the chosen engine passes the G6 licence inventory and its own ADR is accepted first.

## Decisions and prerequisites

ADR 0022 D13 is accepted (owner approval, 2026-11-09) and allocates the standalone surface here, **outside epic 11's closing path**: 11.12 and 11.13 do not wait for it, because the epic envelope has no Git item, the engine is an unevaluated G6 decision, and a surface without push or remote cannot address the whole-machine loss the research evidences. The `hitl` flag marks the engine decision the owner must rule before implementation.

Prerequisites: 11.1, 11.3, 11.14.

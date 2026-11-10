---
type: story
title: "Keep document history, checkpoint groups and package exclusion"
ticket: 14
status: draft
---

## Scope

Implement [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d12--history-and-checkpoint-groups) D12 in shared code on top of `fs`: a per-document history entry for every successful save (reason, time, SHA-256 content hash, checkpoint group id), checkpoint groups that record every touched document before the first write, named project checkpoints, the document and project timelines with read-only preview and restore, and the reserved in-project folder with its ignore offer. The first task is one measured editing hour: count accepted-edit gestures per hour through the 11.2/11.3 tracer (or a scripted board-painting hour that calls `writeBoard` on a corpus board) and derive entries per hour for 10, 60 and 300 s merge windows, so the retention floors and the autosave merge window are set from the resulting MB/day rather than guessed. D12.8 fixes the structure, not the numbers.

The package exclusion is part of this story: `docs/spec/formats/packaging-and-paths.md` says a package holds every file under the project folder and its "Not included" row names only `Saved\`, so the table and the exporter both need the history folder (and, with 12.9, test-only files) named and checked. Record the measured numbers in ADR 0022 D12.8 as part of the change.

## Acceptance

History is the same in every host, survives a host change with the project, and never appears in a produced package; autosave cannot destroy the previous version; a multi-document operation is recoverable as one action with an honest per-file report; nothing promises cross-document atomicity and no delta format is invented in the first release.

## Verification

One measured editing hour's entry counts set the merge window and the retention floors, and the numbers are recorded in ADR 0022 D12.8; a multi-file wizard operation restores to its pre-operation content as one group and reports each file separately; a restore is itself restorable; a produced package contains neither the history folder nor test-only files, and the exporter check fails when either is present.

## Decisions and prerequisites

ADR 0022 D12 is accepted (owner approval, 2026-11-09): in-project folder confirmed, retention numbers deliberately unset until measured, and autosave and retention are user-only settings entries (D6.3). VS Code's own Timeline keeps working beside it.

This story is on epic 11's closing path: it is a prerequisite of the refactor sweep (11.12) and the closing acceptance (11.13), because the foundation cannot claim to close while an accepted host-independent store is unbuilt. Flagged for the owner in the PR that allocated it; the epic envelope's Done-when says nothing about history and was left unchanged.

Prerequisites: 11.1, 11.3, 11.5.

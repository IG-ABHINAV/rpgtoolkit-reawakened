---
type: story
title: "Desktop document lifecycle and file watching"
status: draft
risk: high
ticket: 3
---

## Scope

Implement file operations, native dialogs and subscriptions against the shared 11.3 lifecycle, including clean and dirty external updates and resource disposal.

## Acceptance

Save/reload/close/rename and watches report actual results; a dirty conflict preserves local and external content pending explicit resolution, failed or cancelled saves remain dirty, and repeated opens share one model per URI.

## Verification

Run shared host conformance and real temp-directory watch tests including external edit, rename, deletion, save failure and cancel.

## Prerequisites and decisions

Use 11.3 conflict/document protocol; if a recovery mode is unsupported, report that rather than inventing backup.

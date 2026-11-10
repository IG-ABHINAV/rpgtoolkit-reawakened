---
type: story
title: "Desktop project entry and file association"
status: draft
risk: high
ticket: 4
---

## Scope

Wire project-open dialog, OS drag-and-drop and editor-specific file association to the shared project opener with close/dirty lifecycle.

## Acceptance

A permitted project opens through each supported entry route, invalid paths and cancelled transitions leave current work untouched, and association is opt-in with explicit result or explanatory failure.

## Verification

On supported OS environments register explicitly, launch a real project from its association and drop it onto the window, including dirty and invalid cases.

## Prerequisites and decisions

OS platform capabilities and registration/packaging mechanism require documented decisions and human access; T-82 never implies player association.

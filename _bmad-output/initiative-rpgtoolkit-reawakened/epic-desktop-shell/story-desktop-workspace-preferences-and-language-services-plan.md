---
type: story
title: "Desktop workspace preferences and language services"
status: draft
risk: medium
ticket: 5
---

## Scope

Wire the shared workspace Game/Files, preferences, Monaco program view and language transport to the desktop platform-services adapter.

## Acceptance

Both workspace navigation modes open the same document identity; preference persists and can be changed; syntax and diagnostic feedback originate in the shared language service.

## Verification

Open a project, navigate from both views to the same file, edit a program, check language diagnostics, change a preference and reopen.

## Prerequisites and decisions

Depend on 11.4/11.5/11.7; Monaco is selected for standalone and VS Code retains native text.

---
type: story
title: "Desktop editor end-to-end acceptance"
status: draft
risk: high
ticket: 10
---

## Scope

Exercise the full independently installed desktop editor across each supported OS with the real shared editor, board, runner and release.

## Acceptance

Each OS proves signed install/update, project open via dialog/drop/association, `.gam` and board edit/save/reopen, dirty conflict safety, program language feedback, preview and creator test with identified revisions, and independent player state.

Run 12.14's shared P0 creator journey on the desktop host: create a project, author and save/reopen board, character, item, animation, tile bitmap and script, then package and run those exact output bytes. Reuse that suite rather than limiting desktop proof to the early board tracer.

## Verification

Run and record the full real-device/OS journey with artifact digests and positive and failure outcomes; link reproducible evidence for every acceptance condition.

## Prerequisites and decisions

Requires 15.9, 12.14 and authorised signed artifacts, three OS environments and human operation; missing prerequisites block acceptance.

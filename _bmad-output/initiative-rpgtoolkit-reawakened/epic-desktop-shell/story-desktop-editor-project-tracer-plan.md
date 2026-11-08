---
type: story
title: "Desktop editor project tracer"
status: draft
risk: high
ticket: 1
---

## Scope

Create `host-desktop`, secure Electron app bootstrap and a platform-services instance around the 11.2 real `.gam` shared model and UI; own shared desktop registration here, not another editor implementation.

## Acceptance

A user opens an existing authored `.gam`, changes one supported game setting, saves, quits and reopens the same changed value; the UI bundle is the shared build and the player remains a separate application.

## Verification

Launch the real app with a small authored project and assert persisted bytes and reopened value; exercise failed save without falsely displaying Saved.

## Prerequisites and decisions

11.1 contract and 11.2 tracer are prerequisites; do not implement a replacement model.
